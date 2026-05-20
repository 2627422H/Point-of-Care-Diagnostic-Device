#pragma once

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Connect to WiFi using the provided credentials.
 * Blocks until connected or times out (~15 s).
 *
 * @param ssid      Null-terminated SSID string.
 * @param password  Null-terminated password string.
 * @param out_ip    Buffer of at least 16 bytes; filled with the assigned IP.
 *
 * Returns ESP_OK on success.
 */
esp_err_t wifi_connect(const char *ssid, const char *password, char *out_ip);

/**
 * Start the MJPEG HTTP streaming server on port 80.
 * After this returns, clients can connect to http://<ip>/stream
 *
 * Returns ESP_OK on success.
 */
esp_err_t wifi_stream_start(void);

/**
 * Push a new JPEG frame to all connected HTTP streaming clients.
 * Can be called from any task.
 *
 * @param data  Pointer to JPEG data.
 * @param len   Length of JPEG data in bytes.
 *
 * Returns ESP_OK on success.
 */
esp_err_t wifi_stream_push_frame(const uint8_t *data, size_t len);

/**
 * Sample brightness from a raw RGB565 frame and record it if a recording
 * session is currently active.  Call this from the capture loop with the
 * raw frame buffer BEFORE JPEG encoding.
 *
 * @param rgb565  Raw RGB565 frame buffer.
 * @param len     Buffer length in bytes (width * height * 2).
 */
void wifi_stream_record_sample(const uint8_t *rgb565, size_t len);

#ifdef __cplusplus
}
#endif
