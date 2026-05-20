#include "wifi_stream.h"
#include "rgb_led.h"
#include "camera.h"

#include <string.h>
#include <stdlib.h>
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
#define WIFI_MAX_RETRIES    10

static EventGroupHandle_t s_wifi_event_group = NULL;
static int                s_retry_count      = 0;

static void wifi_event_handler(void *arg, esp_event_base_t event_base,
                               int32_t event_id, void *event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        wifi_event_sta_disconnected_t *disc = (wifi_event_sta_disconnected_t *)event_data;
        ESP_LOGW(TAG, "Disconnected: reason=%d (%s)", disc->reason,
                 disc->reason == 2   ? "AUTH_EXPIRE" :
                 disc->reason == 15  ? "4WAY_HANDSHAKE_TIMEOUT (wrong password?)" :
                 disc->reason == 201 ? "NO_AP_FOUND (SSID not visible)" :
                 disc->reason == 202 ? "AUTH_FAIL (wrong password or auth mode)" :
                 disc->reason == 203 ? "ASSOC_FAIL" :
                 disc->reason == 204 ? "HANDSHAKE_TIMEOUT" : "other");
        if (s_retry_count < WIFI_MAX_RETRIES) {
            esp_wifi_connect();
            s_retry_count++;
            ESP_LOGW(TAG, "Retrying (%d/%d)...", s_retry_count, WIFI_MAX_RETRIES);
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
    wifi_cfg.sta.threshold.authmode  = WIFI_AUTH_WPA_PSK;
    wifi_cfg.sta.sae_pwe_h2e         = WPA3_SAE_PWE_BOTH;
    wifi_cfg.sta.pmf_cfg.capable     = true;
    wifi_cfg.sta.pmf_cfg.required    = false;
    /* Scan all channels on both bands before connecting — prevents NO_AP_FOUND
     * when the hotspot is on a non-default channel or band. */
    wifi_cfg.sta.scan_method         = WIFI_ALL_CHANNEL_SCAN;
    wifi_cfg.sta.sort_method         = WIFI_CONNECT_AP_BY_SIGNAL;

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_cfg));
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "Connecting to SSID: %s", ssid);

    /* 30 s — hotspots (especially phones) can take longer to accept a station. */
    EventBits_t bits = xEventGroupWaitBits(s_wifi_event_group,
                                           WIFI_CONNECTED_BIT | WIFI_FAIL_BIT,
                                           pdFALSE, pdFALSE,
                                           pdMS_TO_TICKS(30000));

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

static void ae_unlock_task(void *arg)
{
    uint32_t delay_ms = *(uint32_t *)arg;
    free(arg);
    vTaskDelay(pdMS_TO_TICKS(delay_ms));
    camera_unlock_exposure();
    vTaskDelete(NULL);
}

/* HTTP handler for GET /record?curve=<0-3>&r=<0-255>&g=<0-255>&b=<0-255>
 *                              &duration=<ms>&step=<ms>
 *
 * Triggers an LED fade and returns JSON with the session parameters so the
 * Python script can timestamp the recording window.
 *
 * curve: 0=linear  1=exponential  2=logarithmic  3=sigmoid
 */
static esp_err_t record_handler(httpd_req_t *req)
{
    char query[128] = {0};
    httpd_req_get_url_query_str(req, query, sizeof(query));

    char p[16];
    uint8_t  r = 255, g = 255, b = 255;
    int      curve       = RGB_LED_CURVE_EXPONENTIAL;
    uint32_t duration_ms = 5000;
    uint32_t step_ms     = 20;

    if (httpd_query_key_value(query, "r",        p, sizeof(p)) == ESP_OK) r           = (uint8_t)atoi(p);
    if (httpd_query_key_value(query, "g",        p, sizeof(p)) == ESP_OK) g           = (uint8_t)atoi(p);
    if (httpd_query_key_value(query, "b",        p, sizeof(p)) == ESP_OK) b           = (uint8_t)atoi(p);
    if (httpd_query_key_value(query, "curve",    p, sizeof(p)) == ESP_OK) curve       = atoi(p);
    if (httpd_query_key_value(query, "duration", p, sizeof(p)) == ESP_OK) duration_ms = (uint32_t)atoi(p);
    if (httpd_query_key_value(query, "step",     p, sizeof(p)) == ESP_OK) step_ms     = (uint32_t)atoi(p);

    /* Lock AEC/AGC so the camera measures absolute brightness, not compensated. */
    camera_lock_exposure();
    rgb_led_fade_start(r, g, b, (rgb_led_curve_t)curve, duration_ms, step_ms);

    /* Spawn a one-shot task to re-enable auto-exposure after the fade ends. */
    uint32_t *unlock_ms = malloc(sizeof(uint32_t));
    if (unlock_ms) {
        *unlock_ms = duration_ms + 500;
        xTaskCreate(ae_unlock_task, "ae_unlock", 2048, unlock_ms, 3, NULL);
    }

    char resp[200];
    snprintf(resp, sizeof(resp),
             "{\"status\":\"ok\",\"curve\":%d,\"r\":%d,\"g\":%d,\"b\":%d,"
             "\"duration_ms\":%lu,\"step_ms\":%lu}",
             curve, r, g, b, (unsigned long)duration_ms, (unsigned long)step_ms);

    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_sendstr(req, resp);
}

/* HTTP handler for GET /snapshot – returns the latest JPEG frame.
 * React Native's Image component polls this; each request completes quickly
 * so the httpd is never blocked long-term. */
static esp_err_t snapshot_handler(httpd_req_t *req)
{
    if (!s_frame_buf || !s_frame_mutex) {
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Not ready");
        return ESP_FAIL;
    }

    uint8_t *local = heap_caps_malloc(MAX_JPEG_SIZE, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!local) {
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "OOM");
        return ESP_FAIL;
    }

    xSemaphoreTake(s_frame_mutex, portMAX_DELAY);
    size_t len = s_frame_len;
    if (len > 0) memcpy(local, s_frame_buf, len);
    xSemaphoreGive(s_frame_mutex);

    if (len == 0) {
        free(local);
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "No frame yet");
        return ESP_FAIL;
    }

    httpd_resp_set_type(req, "image/jpeg");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    esp_err_t ret = httpd_resp_send(req, (const char *)local, (ssize_t)len);
    free(local);
    return ret;
}

/* HTTP handler for GET / – full-screen MJPEG viewer with RN bridge messaging */
static esp_err_t index_handler(httpd_req_t *req)
{
    /* Single-quoted HTML inside a double-quoted C string — no escaping needed.
     * The ReactNativeWebView bridge is injected by react-native-webview; the
     * guard (window.ReactNativeWebView&&...) makes the page work in plain
     * Safari too. */
    static const char html[] =
        "<!DOCTYPE html><html>"
        "<head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1.0,maximum-scale=1.0'>"
        "<style>"
        "*{margin:0;padding:0;box-sizing:border-box}"
        "body{background:#000;width:100vw;height:100vh;display:flex;"
        "align-items:center;justify-content:center;overflow:hidden}"
        "#s{max-width:100%;max-height:100%;object-fit:contain;display:block}"
        "</style></head>"
        "<body><img id='s' src='/stream'>"
        "<script>"
        "var img=document.getElementById('s');"
        "var cv=document.createElement('canvas');"
        "cv.width=8;cv.height=8;"
        "var ctx=cv.getContext('2d'),last=null;"
        "function poll(){"
        "try{"
        "ctx.drawImage(img,0,0,8,8);"
        "var d=ctx.getImageData(0,0,8,8).data,h=0;"
        "for(var i=0;i<d.length;i++)h=(h*31+d[i])|0;"
        "if(last!==null&&h!==last&&window.ReactNativeWebView){"
        "var br=0;"
        "for(var j=0;j<d.length;j+=4)br+=d[j]*299+d[j+1]*587+d[j+2]*114;"
        "window.ReactNativeWebView.postMessage(JSON.stringify({t:'f',b:Math.round(br/64000)}));"
        "}"
        "last=h;"
        "}catch(e){}"
        "requestAnimationFrame(poll);"
        "}"
        "img.onload=function(){"
        "if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify({t:'ok'}));"
        "poll();"
        "};"
        "img.onerror=function(){"
        "if(window.ReactNativeWebView)"
        "window.ReactNativeWebView.postMessage(JSON.stringify({t:'err'}));"
        "};"
        "</script></body></html>";

    httpd_resp_set_type(req, "text/html");
    httpd_resp_set_hdr(req, "Cache-Control", "no-cache");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
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
    config.max_uri_handlers = 8;
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

    httpd_uri_t record_uri = {
        .uri     = "/record",
        .method  = HTTP_GET,
        .handler = record_handler,
    };
    httpd_register_uri_handler(s_httpd, &record_uri);

    httpd_uri_t snapshot_uri = {
        .uri     = "/snapshot",
        .method  = HTTP_GET,
        .handler = snapshot_handler,
    };
    httpd_register_uri_handler(s_httpd, &snapshot_uri);

    ESP_LOGI(TAG, "HTTP server started. Stream at http://<ip>/stream  Snapshot at http://<ip>/snapshot");
    return ESP_OK;
}
