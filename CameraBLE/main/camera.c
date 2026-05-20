#include <string.h>
#include "camera.h"

#include "esp_log.h"
#include "esp_err.h"
#include "esp_attr.h"
#include "esp_cache.h"
#include "esp_ldo_regulator.h"
#include "driver/i2c_master.h"
#include "driver/isp.h"
#include "esp_cam_ctlr_csi.h"
#include "esp_cam_ctlr.h"
#include "esp_sccb_intf.h"
#include "esp_sccb_i2c.h"
#include "esp_cam_sensor.h"
#include "esp_cam_sensor_detect.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "esp_heap_caps.h"

static const char *TAG = "camera";

/* ── Hardware constants ───────────────────────────────────────────────────── */
#define CAM_H_RES               800
#define CAM_V_RES               640
#define CAM_BYTES_PER_PIXEL     2   /* RGB565 */
#define CAM_FRAME_BUF_SIZE      (CAM_H_RES * CAM_V_RES * CAM_BYTES_PER_PIXEL)
#define CAM_FRAME_BUF_ALIGN     64

#define LDO_CHAN_ID             3
#define LDO_VOLTAGE_MV          2500

#define I2C_SDA_GPIO            7
#define I2C_SCL_GPIO            8
#define SCCB_FREQ_HZ            (10 * 1000)

#define CSI_LANE_BITRATE_MBPS   400
#define CAM_FORMAT_NAME         "MIPI_2lane_24Minput_RAW8_800x640_50fps"

/* ── Module state ─────────────────────────────────────────────────────────── */
static esp_cam_ctlr_handle_t    s_cam_handle   = NULL;
static isp_proc_handle_t        s_isp_proc     = NULL;

static uint8_t *s_cap_buf   = NULL;
static uint8_t *s_proc_buf  = NULL;
static esp_cam_sensor_device_t *s_sensor = NULL;

static SemaphoreHandle_t s_frame_sem = NULL;

static volatile uint32_t s_isr_count       = 0;
static volatile uint32_t s_get_trans_count = 0;

/* ─────────────────────────────────────────────────────────────────────────── */

static bool IRAM_ATTR on_get_new_trans(esp_cam_ctlr_handle_t handle,
                                       esp_cam_ctlr_trans_t *trans, void *user_data)
{
    s_get_trans_count++;
    trans->buffer = s_cap_buf;
    trans->buflen = CAM_FRAME_BUF_SIZE;
    return false;
}

static bool IRAM_ATTR on_trans_finished(esp_cam_ctlr_handle_t handle,
                                        esp_cam_ctlr_trans_t *trans,
                                        void *user_data)
{
    s_isr_count++;
    uint8_t *tmp = s_cap_buf;
    s_cap_buf    = s_proc_buf;
    s_proc_buf   = tmp;

    BaseType_t higher_woken = pdFALSE;
    xSemaphoreGiveFromISR(s_frame_sem, &higher_woken);
    return (bool)higher_woken;
}

static esp_cam_sensor_device_t *detect_sensor(esp_sccb_io_handle_t *out_sccb,
                                              i2c_master_bus_handle_t i2c_bus)
{
    extern esp_cam_sensor_detect_fn_t __esp_cam_sensor_detect_fn_array_start;
    extern esp_cam_sensor_detect_fn_t __esp_cam_sensor_detect_fn_array_end;

    esp_cam_sensor_config_t cam_cfg = {
        .reset_pin = -1,
        .pwdn_pin  = -1,
        .xclk_pin  = -1,
    };

    for (esp_cam_sensor_detect_fn_t *p = &__esp_cam_sensor_detect_fn_array_start;
         p < &__esp_cam_sensor_detect_fn_array_end; ++p) {

        sccb_i2c_config_t i2c_cfg = {
            .scl_speed_hz    = SCCB_FREQ_HZ,
            .device_address  = p->sccb_addr,
            .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        };
        ESP_ERROR_CHECK(sccb_new_i2c_io(i2c_bus, &i2c_cfg, &cam_cfg.sccb_handle));
        cam_cfg.sensor_port = p->port;

        esp_cam_sensor_device_t *cam = (*(p->detect))(&cam_cfg);
        if (cam) {
            *out_sccb = cam_cfg.sccb_handle;
            return cam;
        }
        esp_sccb_del_i2c_io(cam_cfg.sccb_handle);
    }
    return NULL;
}

/* ─────────────────────────────────────────────────────────────────────────── */

esp_err_t camera_init(void)
{
    esp_err_t ret;

    /* 1 -- LDO for MIPI PHY ----------------------------------------------- */
    esp_ldo_channel_handle_t ldo_handle = NULL;
    esp_ldo_channel_config_t ldo_cfg = {
        .chan_id    = LDO_CHAN_ID,
        .voltage_mv = LDO_VOLTAGE_MV,
    };
    ESP_ERROR_CHECK(esp_ldo_acquire_channel(&ldo_cfg, &ldo_handle));
    ESP_LOGI(TAG, "MIPI PHY LDO ch%d = %d mV", LDO_CHAN_ID, LDO_VOLTAGE_MV);

    /* 2 -- Allocate two frame buffers in PSRAM ----------------------------- */
    s_cap_buf = (uint8_t *)heap_caps_aligned_alloc(
                    CAM_FRAME_BUF_ALIGN, CAM_FRAME_BUF_SIZE,
                    MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    s_proc_buf = (uint8_t *)heap_caps_aligned_alloc(
                    CAM_FRAME_BUF_ALIGN, CAM_FRAME_BUF_SIZE,
                    MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!s_cap_buf || !s_proc_buf) {
        ESP_LOGE(TAG, "Failed to allocate frame buffers in PSRAM");
        return ESP_ERR_NO_MEM;
    }
    memset(s_cap_buf,  0, CAM_FRAME_BUF_SIZE);
    memset(s_proc_buf, 0, CAM_FRAME_BUF_SIZE);
    esp_cache_msync(s_cap_buf,  CAM_FRAME_BUF_SIZE, ESP_CACHE_MSYNC_FLAG_DIR_C2M);
    esp_cache_msync(s_proc_buf, CAM_FRAME_BUF_SIZE, ESP_CACHE_MSYNC_FLAG_DIR_C2M);
    ESP_LOGI(TAG, "Frame buffers @ cap=%p proc=%p (%u bytes each)",
             s_cap_buf, s_proc_buf, CAM_FRAME_BUF_SIZE);

    vTaskDelay(pdMS_TO_TICKS(100));

    /* 3 -- I2C / SCCB ----------------------------------------------------- */
    i2c_master_bus_config_t i2c_bus_cfg = {
        .clk_source                   = I2C_CLK_SRC_DEFAULT,
        .sda_io_num                   = I2C_SDA_GPIO,
        .scl_io_num                   = I2C_SCL_GPIO,
        .i2c_port                     = I2C_NUM_0,
        .flags.enable_internal_pullup = true,
    };
    i2c_master_bus_handle_t i2c_bus = NULL;
    ESP_ERROR_CHECK(i2c_new_master_bus(&i2c_bus_cfg, &i2c_bus));

    esp_sccb_io_handle_t sccb_io = NULL;
    s_sensor = detect_sensor(&sccb_io, i2c_bus);
    if (!s_sensor) {
        ESP_LOGE(TAG, "No camera sensor detected on I2C");
        return ESP_ERR_NOT_FOUND;
    }
    ESP_LOGI(TAG, "Camera sensor detected");

    /* Select capture format */
    esp_cam_sensor_format_array_t fmt_array = {0};
    esp_cam_sensor_query_format(s_sensor, &fmt_array);

    const esp_cam_sensor_format_t *chosen = NULL;
    for (int i = 0; i < (int)fmt_array.count; i++) {
        ESP_LOGI(TAG, "  fmt[%d] = %s", i, fmt_array.format_array[i].name);
        if (strcmp(fmt_array.format_array[i].name, CAM_FORMAT_NAME) == 0) {
            chosen = &fmt_array.format_array[i];
        }
    }
    if (!chosen) {
        ESP_LOGE(TAG, "Format '%s' not found", CAM_FORMAT_NAME);
        return ESP_ERR_INVALID_ARG;
    }
    ESP_ERROR_CHECK(esp_cam_sensor_set_format(s_sensor, chosen));
    ESP_LOGI(TAG, "Sensor format set: %s", chosen->name);

    /*
     * OV5647 exposure / gain registers:
     *
     *   0x3503 = 0x00  -> AEC and AGC fully automatic
     *   0x3406 = 0x00  -> AWB automatic
     *
     *   0x3a18/0x3a19  -> AEC gain ceiling (max auto gain).
     *                     Default is very low (0x00/0x08 = 8x).
     *                     Raise to 0x00/0xf8 = 248x to allow the sensor
     *                     to brighten dark scenes automatically.
     *
     *   0x350a/0x350b  -> Manual gain registers (only used when AGC=manual).
     *                     Not needed here since AGC is auto, but writing
     *                     0x00/0x3f sets a sensible starting point (16x).
     *
     * NOTE: The image is currently dark because the default gain ceiling
     * is too restrictive. Raising it lets the sensor expose brighter.
     */
    esp_cam_sensor_reg_val_t rv;

    /* Full auto AEC + AGC */
    rv.regaddr = 0x3503; rv.value = 0x00;
    esp_cam_sensor_ioctl(s_sensor, ESP_CAM_SENSOR_IOC_S_REG, &rv);

    /* Full auto AWB */
    rv.regaddr = 0x3406; rv.value = 0x00;
    esp_cam_sensor_ioctl(s_sensor, ESP_CAM_SENSOR_IOC_S_REG, &rv);

    /* Raise AEC gain ceiling to 248x so dark scenes can be exposed properly */
    rv.regaddr = 0x3a18; rv.value = 0x00;
    esp_cam_sensor_ioctl(s_sensor, ESP_CAM_SENSOR_IOC_S_REG, &rv);
    rv.regaddr = 0x3a19; rv.value = 0xf8;
    esp_cam_sensor_ioctl(s_sensor, ESP_CAM_SENSOR_IOC_S_REG, &rv);

    /* Set minimum exposure lines to avoid underexposure floor */
    rv.regaddr = 0x3a0f; rv.value = 0x50;   /* AEC stable range high limit */
    esp_cam_sensor_ioctl(s_sensor, ESP_CAM_SENSOR_IOC_S_REG, &rv);
    rv.regaddr = 0x3a10; rv.value = 0x48;   /* AEC stable range low limit  */
    esp_cam_sensor_ioctl(s_sensor, ESP_CAM_SENSOR_IOC_S_REG, &rv);
    rv.regaddr = 0x3a1b; rv.value = 0x50;   /* AEC fast zone high          */
    esp_cam_sensor_ioctl(s_sensor, ESP_CAM_SENSOR_IOC_S_REG, &rv);
    rv.regaddr = 0x3a1e; rv.value = 0x48;   /* AEC fast zone low           */
    esp_cam_sensor_ioctl(s_sensor, ESP_CAM_SENSOR_IOC_S_REG, &rv);

    ESP_LOGI(TAG, "Sensor: auto AEC/AGC/AWB, gain ceiling 248x");

    /* 4 -- ISP processor -------------------------------------------------- */
    esp_isp_processor_cfg_t isp_cfg = {
        .clk_hz                 = 80 * 1000 * 1000,
        .input_data_source      = ISP_INPUT_DATA_SOURCE_CSI,
        .input_data_color_type  = ISP_COLOR_RAW8,
        .output_data_color_type = ISP_COLOR_RGB565,
        .has_line_start_packet  = false,
        .has_line_end_packet    = false,
        .h_res                  = CAM_H_RES,
        .v_res                  = CAM_V_RES,
    };
    ESP_ERROR_CHECK(esp_isp_new_processor(&isp_cfg, &s_isp_proc));
    ESP_ERROR_CHECK(esp_isp_enable(s_isp_proc));
    ESP_LOGI(TAG, "ISP enabled");

    /*
     * Demosaic: converts RAW8 Bayer to RGB. Must be explicitly enabled —
     * without this the output is greyscale.
     */
    esp_isp_demosaic_config_t demosaic_cfg = {
        .grad_ratio = { .integer = 0, .decimal = 0 },
    };
    ret = esp_isp_demosaic_configure(s_isp_proc, &demosaic_cfg);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Demosaic configure failed: %s", esp_err_to_name(ret));
        return ret;
    }
    ESP_ERROR_CHECK(esp_isp_demosaic_enable(s_isp_proc));
    ESP_LOGI(TAG, "ISP demosaic enabled");

    /*
     * Colour correction: boost brightness and saturation slightly to
     * compensate for the sensor's tendency to underexpose indoors.
     *   brightness: -127..127, positive = brighter
     *   saturation: 0..255, 128 = neutral, 160 = slightly vivid
     *   contrast:   0..255, 128 = neutral
     */
    esp_isp_color_config_t color_cfg = {
        .color_contrast   = { .val = 128 },
        .color_saturation = { .val = 128 },
        .color_hue        = 0,
        .color_brightness = 20,             /* lift shadows */
    };
    ret = esp_isp_color_configure(s_isp_proc, &color_cfg);
    if (ret != ESP_OK) {
        ESP_LOGW(TAG, "Color configure failed (%s)", esp_err_to_name(ret));
    } else {
        ret = esp_isp_color_enable(s_isp_proc);
        if (ret != ESP_OK) {
            ESP_LOGW(TAG, "Color enable failed (%s)", esp_err_to_name(ret));
        } else {
            ESP_LOGI(TAG, "ISP colour correction enabled");
        }
    }

    /* NOTE: WBG (white balance gain) is NOT supported on ESP32-P4 < v3.0.
     * It is intentionally omitted here to avoid the "not supported" warning. */

    /* 5 -- MIPI-CSI controller -------------------------------------------- */
    esp_cam_ctlr_csi_config_t csi_cfg = {
        .ctlr_id                = 0,
        .h_res                  = CAM_H_RES,
        .v_res                  = CAM_V_RES,
        .lane_bit_rate_mbps     = CSI_LANE_BITRATE_MBPS,
        .input_data_color_type  = CAM_CTLR_COLOR_RAW8,
        .output_data_color_type = CAM_CTLR_COLOR_RGB565,
        .data_lane_num          = 2,
        .byte_swap_en           = false,
        .queue_items            = 1,
    };
    ret = esp_cam_new_csi_ctlr(&csi_cfg, &s_cam_handle);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "CSI controller init failed: %s", esp_err_to_name(ret));
        return ret;
    }

    esp_cam_ctlr_evt_cbs_t cbs = {
        .on_get_new_trans  = on_get_new_trans,
        .on_trans_finished = on_trans_finished,
    };
    ESP_ERROR_CHECK(esp_cam_ctlr_register_event_callbacks(s_cam_handle, &cbs, NULL));
    ESP_ERROR_CHECK(esp_cam_ctlr_enable(s_cam_handle));
    ESP_LOGI(TAG, "CSI controller enabled");

    /* 6 -- Semaphore + start CSI ------------------------------------------ */
    s_frame_sem = xSemaphoreCreateBinary();
    if (!s_frame_sem) {
        ESP_LOGE(TAG, "Failed to create frame semaphore");
        return ESP_ERR_NO_MEM;
    }

    ret = esp_cam_ctlr_start(s_cam_handle);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Camera controller start failed: %s", esp_err_to_name(ret));
        return ret;
    }
    ESP_LOGI(TAG, "CSI controller started");

    /* 7 -- Start sensor streaming ----------------------------------------- */
    int stream_en = 1;
    ret = esp_cam_sensor_ioctl(s_sensor, ESP_CAM_SENSOR_IOC_S_STREAM, &stream_en);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Sensor stream start failed: %s", esp_err_to_name(ret));
        return ret;
    }
    ESP_LOGI(TAG, "Sensor streaming");

    /* Wait for AE/AGC to converge (~1.5 s at 50 fps) */
    ESP_LOGI(TAG, "Waiting 1.5 s for sensor AE to settle...");
    vTaskDelay(pdMS_TO_TICKS(1500));

    ESP_LOGI(TAG, "Camera ready -- %dx%d RGB565 @ 50fps sensor, streamed at 10fps",
             CAM_H_RES, CAM_V_RES);
    return ESP_OK;
}

esp_err_t camera_lock_exposure(void)
{
    if (!s_sensor) return ESP_ERR_INVALID_STATE;
    /* OV5647 reg 0x3503: bit0=AEC manual, bit1=AGC manual.
     * Setting 0x07 freezes AEC + AGC at their current auto-converged values. */
    esp_cam_sensor_reg_val_t rv = { .regaddr = 0x3503, .value = 0x07 };
    esp_err_t ret = esp_cam_sensor_ioctl(s_sensor, ESP_CAM_SENSOR_IOC_S_REG, &rv);
    if (ret == ESP_OK) ESP_LOGI(TAG, "Exposure locked (manual AEC+AGC)");
    return ret;
}

esp_err_t camera_unlock_exposure(void)
{
    if (!s_sensor) return ESP_ERR_INVALID_STATE;
    esp_cam_sensor_reg_val_t rv = { .regaddr = 0x3503, .value = 0x00 };
    esp_err_t ret = esp_cam_sensor_ioctl(s_sensor, ESP_CAM_SENSOR_IOC_S_REG, &rv);
    if (ret == ESP_OK) ESP_LOGI(TAG, "Exposure unlocked (auto AEC+AGC)");
    return ret;
}

esp_err_t camera_capture_frame(const uint8_t **frame_buf, size_t *frame_size)
{
    xSemaphoreTake(s_frame_sem, 0);

    if (xSemaphoreTake(s_frame_sem, pdMS_TO_TICKS(2000)) != pdTRUE) {
        ESP_LOGE(TAG, "Timeout waiting for camera frame (isr=%lu get=%lu)",
                 (unsigned long)s_isr_count, (unsigned long)s_get_trans_count);
        return ESP_ERR_TIMEOUT;
    }

    esp_cache_msync(s_proc_buf, CAM_FRAME_BUF_SIZE, ESP_CACHE_MSYNC_FLAG_DIR_M2C);
    *frame_buf  = s_proc_buf;
    *frame_size = CAM_FRAME_BUF_SIZE;
    return ESP_OK;
}