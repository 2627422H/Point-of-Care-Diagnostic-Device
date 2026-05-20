#include <stdio.h>
#include <string.h>
#include "esp_log.h"
#include "esp_err.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_heap_caps.h"
#include "driver/jpeg_encode.h"

#include "camera.h"
#include "ble_server.h"
#include "wifi_stream.h"
#include "rgb_led.h"

static const char *TAG = "cam_main";

#define CAM_H_RES       800
#define CAM_V_RES       640
#define JPEG_OUT_BUF_KB 800
#define JPEG_QUALITY    40
#define TARGET_FRAME_MS 50

/*
 * LED status scheme:
 *
 *   BLUE pulse (slow, 1.5 s) – BLE advertising, waiting for phone
 *   BLUE solid               – phone connected via BLE
 *   CYAN pulse (fast, 0.6 s) – credentials received, connecting to WiFi
 *   GREEN solid              – WiFi connected, MJPEG stream ready
 *   RED solid                – error
 *   LED taken over by fade   – recording session in progress
 *   OFF                      – initialising
 */

void app_main(void)
{
    ESP_ERROR_CHECK(rgb_led_init());
    rgb_led_off();

    /* NVS */
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    /* Camera */
    ESP_ERROR_CHECK(camera_init());

    /* JPEG encoder */
    jpeg_encode_engine_cfg_t enc_eng_cfg = { .timeout_ms = 2000 };
    jpeg_encoder_handle_t jpeg_enc = NULL;
    ESP_ERROR_CHECK(jpeg_new_encoder_engine(&enc_eng_cfg, &jpeg_enc));

    jpeg_encode_memory_alloc_cfg_t jpeg_mem_cfg = {
        .buffer_direction = JPEG_ENC_ALLOC_OUTPUT_BUFFER,
    };
    size_t  jpeg_buf_alloc_size = 0;
    uint8_t *jpeg_buf = jpeg_alloc_encoder_mem(
                            JPEG_OUT_BUF_KB * 1024, &jpeg_mem_cfg,
                            &jpeg_buf_alloc_size);
    if (!jpeg_buf) {
        ESP_LOGE(TAG, "Failed to allocate JPEG output buffer");
        rgb_led_red();
        return;
    }
    ESP_LOGI(TAG, "JPEG encoder ready (buf=%zu bytes, quality=%d)",
             jpeg_buf_alloc_size, JPEG_QUALITY);

    /* Phase 1: BLE — slow blue pulse while advertising, waiting for phone */
    rgb_led_pulse_start(0, 0, 255, 1500);
    ESP_ERROR_CHECK(ble_server_init());
    ESP_LOGI(TAG, "BLE advertising. Connect and send WiFi credentials.");

    while (!ble_server_credentials_received()) {
        vTaskDelay(pdMS_TO_TICKS(200));
    }
    ESP_LOGI(TAG, "Credentials received: SSID='%s'", ble_server_get_ssid());

    /* Phase 2: WiFi — fast cyan pulse while connecting */
    rgb_led_pulse_start(0, 200, 255, 600);
    char ip[16] = {0};
    ret = wifi_connect(ble_server_get_ssid(), ble_server_get_password(), ip);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "WiFi connection failed");
        rgb_led_red();
        return;
    }

    vTaskDelay(pdMS_TO_TICKS(200));
    ble_server_notify_ip(ip);
    vTaskDelay(pdMS_TO_TICKS(2000));

    /* Phase 3: stream starting — solid green once ready */
    ret = wifi_stream_start();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Stream start failed");
        rgb_led_red();
        return;
    }
    ESP_LOGI(TAG, "MJPEG stream at http://%s/stream", ip);
    rgb_led_green();   /* solid green = streaming ready */

    uint32_t   frame_id  = 0;
    TickType_t last_tick = xTaskGetTickCount();

    while (1) {
        TickType_t elapsed = xTaskGetTickCount() - last_tick;
        if (elapsed < pdMS_TO_TICKS(TARGET_FRAME_MS)) {
            vTaskDelay(pdMS_TO_TICKS(TARGET_FRAME_MS) - elapsed);
        }
        last_tick = xTaskGetTickCount();

        const uint8_t *frame_buf  = NULL;
        size_t         frame_size = 0;
        ret = camera_capture_frame(&frame_buf, &frame_size);
        if (ret != ESP_OK) {
            ESP_LOGE(TAG, "Capture error: %s", esp_err_to_name(ret));
            continue;
        }

        jpeg_encode_cfg_t enc_cfg = {
            .src_type      = JPEG_ENCODE_IN_FORMAT_RGB565,
            .sub_sample    = JPEG_DOWN_SAMPLING_YUV422,
            .image_quality = JPEG_QUALITY,
            .width         = CAM_H_RES,
            .height        = CAM_V_RES,
        };
        uint32_t jpeg_out_size = 0;
        ret = jpeg_encoder_process(jpeg_enc, &enc_cfg,
                                   frame_buf, (uint32_t)frame_size,
                                   jpeg_buf,  (uint32_t)jpeg_buf_alloc_size,
                                   &jpeg_out_size);
        if (ret != ESP_OK) {
            ESP_LOGE(TAG, "JPEG encode error: %s", esp_err_to_name(ret));
            continue;
        }

        ret = wifi_stream_push_frame(jpeg_buf, jpeg_out_size);
        if (ret == ESP_OK) {
            ESP_LOGI(TAG, "Frame %lu: %lu bytes",
                     (unsigned long)frame_id, (unsigned long)jpeg_out_size);
        } else {
            ESP_LOGW(TAG, "Stream push failed: %s", esp_err_to_name(ret));
        }

        frame_id++;
    }

    jpeg_del_encoder_engine(jpeg_enc);
}
