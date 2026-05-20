#include "wifi_stream.h"

#include <string.h>
#include "esp_log.h"
#include "esp_err.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_http_server.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "freertos/semphr.h"
#include "esp_heap_caps.h"

static const char *TAG = "wifi_stream";

/* ── WiFi connection ──────────────────────────────────────────────────────── */
#define WIFI_CONNECTED_BIT  BIT0
#define WIFI_FAIL_BIT       BIT1
#define WIFI_MAX_RETRIES    5

static EventGroupHandle_t s_wifi_event_group = NULL;
static int                s_retry_count      = 0;

static void wifi_event_handler(void *arg, esp_event_base_t event_base,
                               int32_t event_id, void *event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        if (s_retry_count < WIFI_MAX_RETRIES) {
            esp_wifi_connect();
            s_retry_count++;
            ESP_LOGW(TAG, "WiFi disconnected, retrying (%d/%d)...",
                     s_retry_count, WIFI_MAX_RETRIES);
        } else {
            xEventGroupSetBits(s_wifi_event_group, WIFI_FAIL_BIT);
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        s_retry_count = 0;
        xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

esp_err_t wifi_connect(const char *ssid, const char *password, char *out_ip)
{
    s_wifi_event_group = xEventGroupCreate();

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_t *netif = esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    esp_event_handler_instance_t instance_any_id;
    esp_event_handler_instance_t instance_got_ip;
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT,
                                                        ESP_EVENT_ANY_ID,
                                                        &wifi_event_handler,
                                                        NULL,
                                                        &instance_any_id));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT,
                                                        IP_EVENT_STA_GOT_IP,
                                                        &wifi_event_handler,
                                                        NULL,
                                                        &instance_got_ip));

    wifi_config_t wifi_cfg = {0};
    strncpy((char *)wifi_cfg.sta.ssid,     ssid,     sizeof(wifi_cfg.sta.ssid) - 1);
    strncpy((char *)wifi_cfg.sta.password, password, sizeof(wifi_cfg.sta.password) - 1);
    wifi_cfg.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_cfg));
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "Connecting to SSID: %s", ssid);

    EventBits_t bits = xEventGroupWaitBits(s_wifi_event_group,
                                           WIFI_CONNECTED_BIT | WIFI_FAIL_BIT,
                                           pdFALSE, pdFALSE,
                                           pdMS_TO_TICKS(15000));

    if (bits & WIFI_CONNECTED_BIT) {
        esp_netif_ip_info_t ip_info;
        esp_netif_get_ip_info(netif, &ip_info);
        snprintf(out_ip, 16, IPSTR, IP2STR(&ip_info.ip));
        ESP_LOGI(TAG, "Connected! IP: %s", out_ip);
        return ESP_OK;
    }

    ESP_LOGE(TAG, "Failed to connect to WiFi");
    return ESP_FAIL;
}

/* ── MJPEG streaming server ───────────────────────────────────────────────── */

/*
 * MJPEG (Motion JPEG) streams frames as a multipart HTTP response.
 * Each frame is sent as:
 *
 *   --frame\r\n
 *   Content-Type: image/jpeg\r\n
 *   Content-Length: <len>\r\n
 *   \r\n
 *   <jpeg bytes>
 *   \r\n
 *
 * This is natively supported by browsers, OpenCV (VideoCapture), and VLC.
 */

#define MJPEG_BOUNDARY      "frame"
#define MJPEG_PART_HEADER   "--" MJPEG_BOUNDARY "\r\nContent-Type: image/jpeg\r\nContent-Length: %zu\r\n\r\n"
#define MJPEG_PART_TAIL     "\r\n"

/* Latest frame buffer – protected by mutex.
 * We keep only the most recent frame so a slow client doesn't block capture. */
#define MAX_JPEG_SIZE  (800 * 1024)  /* 800 KB – enough for 800×640 Q85 */

static SemaphoreHandle_t s_frame_mutex  = NULL;
static SemaphoreHandle_t s_frame_ready  = NULL;   /* signalled on every push */
static uint8_t          *s_frame_buf   = NULL;
static size_t            s_frame_len   = 0;
static uint32_t          s_frame_seq   = 0;   /* incremented each push */

static httpd_handle_t    s_httpd       = NULL;

esp_err_t wifi_stream_push_frame(const uint8_t *data, size_t len)
{
    if (!s_frame_buf || !s_frame_mutex) {
        return ESP_ERR_INVALID_STATE;
    }
    if (len > MAX_JPEG_SIZE) {
        ESP_LOGW(TAG, "Frame too large (%zu), truncating", len);
        len = MAX_JPEG_SIZE;
    }

    xSemaphoreTake(s_frame_mutex, portMAX_DELAY);
    memcpy(s_frame_buf, data, len);
    s_frame_len = len;
    s_frame_seq++;
    xSemaphoreGive(s_frame_mutex);

    xSemaphoreGive(s_frame_ready);   /* wake any waiting stream handler */
    return ESP_OK;
}

/* HTTP handler for GET /stream */
static esp_err_t stream_handler(httpd_req_t *req)
{
    char part_hdr[128];
    esp_err_t ret;

    ret = httpd_resp_set_type(req, "multipart/x-mixed-replace;boundary=" MJPEG_BOUNDARY);
    if (ret != ESP_OK) { return ret; }

    /* Disable response buffering so frames are sent immediately. */
    httpd_resp_set_hdr(req, "Cache-Control", "no-cache");
    httpd_resp_set_hdr(req, "Connection",    "keep-alive");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

    ESP_LOGI(TAG, "Stream client connected");

    uint8_t *local_buf = heap_caps_malloc(MAX_JPEG_SIZE, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!local_buf) {
        ESP_LOGE(TAG, "Stream: failed to allocate local buffer");
        return ESP_ERR_NO_MEM;
    }

    uint32_t last_seq = UINT32_MAX; /* force first frame send */

    while (true) {
        /* Wait for a new frame. */
        uint32_t seq;
        size_t   len;

        xSemaphoreTake(s_frame_mutex, portMAX_DELAY);
        seq = s_frame_seq;
        len = s_frame_len;
        if (seq != last_seq && len > 0) {
            memcpy(local_buf, s_frame_buf, len);
        }
        xSemaphoreGive(s_frame_mutex);

        if (seq == last_seq || len == 0) {
            /* Block until push_frame signals a new frame (100 ms timeout). */
            xSemaphoreTake(s_frame_ready, pdMS_TO_TICKS(100));
            continue;
        }
        last_seq = seq;

        /* Send MJPEG part header. */
        int hdr_len = snprintf(part_hdr, sizeof(part_hdr), MJPEG_PART_HEADER, len);
        ret = httpd_resp_send_chunk(req, part_hdr, hdr_len);
        if (ret != ESP_OK) { break; }

        /* Send JPEG data. */
        ret = httpd_resp_send_chunk(req, (const char *)local_buf, len);
        if (ret != ESP_OK) { break; }

        /* Send boundary tail. */
        ret = httpd_resp_send_chunk(req, MJPEG_PART_TAIL, strlen(MJPEG_PART_TAIL));
        if (ret != ESP_OK) { break; }
    }

    free(local_buf);
    ESP_LOGI(TAG, "Stream client disconnected");
    return ret;
}

/* HTTP handler for GET / – simple status page */
static esp_err_t index_handler(httpd_req_t *req)
{
    const char *html =
        "<html><body>"
        "<h2>ESP32-CAM Stream</h2>"
        "<img src='/stream' style='max-width:100%%'/>"
        "</body></html>";
    httpd_resp_set_type(req, "text/html");
    return httpd_resp_sendstr(req, html);
}

esp_err_t wifi_stream_start(void)
{
    /* Allocate the shared frame buffer. */
    s_frame_buf   = heap_caps_malloc(MAX_JPEG_SIZE, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    s_frame_mutex = xSemaphoreCreateMutex();
    s_frame_ready = xSemaphoreCreateBinary();
    if (!s_frame_buf || !s_frame_mutex || !s_frame_ready) {
        ESP_LOGE(TAG, "Failed to allocate stream resources");
        return ESP_ERR_NO_MEM;
    }

    /* Disable WiFi power-save so the radio is always on — eliminates the
     * latency spikes caused by DTIM sleep between beacons. */
    esp_wifi_set_ps(WIFI_PS_NONE);
    s_frame_len = 0;
    s_frame_seq = 0;

    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port      = 80;
    config.max_uri_handlers = 4;
    /* Allow the stream handler to block in the URI handler task. */
    config.stack_size       = 16384;
    config.lru_purge_enable = true;

    ESP_ERROR_CHECK(httpd_start(&s_httpd, &config));

    httpd_uri_t stream_uri = {
        .uri      = "/stream",
        .method   = HTTP_GET,
        .handler  = stream_handler,
        .user_ctx = NULL,
    };
    httpd_register_uri_handler(s_httpd, &stream_uri);

    httpd_uri_t index_uri = {
        .uri      = "/",
        .method   = HTTP_GET,
        .handler  = index_handler,
        .user_ctx = NULL,
    };
    httpd_register_uri_handler(s_httpd, &index_uri);

    ESP_LOGI(TAG, "HTTP server started. Stream at http://<ip>/stream");
    return ESP_OK;
}
