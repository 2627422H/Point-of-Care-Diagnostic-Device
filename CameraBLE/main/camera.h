#pragma once

#include <stdint.h>
#include <stddef.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Initialise the full camera pipeline in the required order:
 *   1. LDO power
 *   2. ISP processor (provides MCLK to sensor)
 *   3. MIPI-CSI controller
 *   4. OV5647 sensor via I2C / SCCB
 *
 * Returns ESP_OK on success.
 */
esp_err_t camera_init(void);

/**
 * Capture one frame into the internal frame buffer.
 *
 * Blocks until the ISP has finished writing one complete frame then
 * calls esp_cache_msync to make the PSRAM data visible to the CPU.
 *
 * @param[out] frame_buf  Set to a pointer to the RGB565 frame data.
 * @param[out] frame_size Set to the size of the frame in bytes.
 *
 * Returns ESP_OK on success.
 */
esp_err_t camera_capture_frame(const uint8_t **frame_buf, size_t *frame_size);

/**
 * Lock the OV5647 AEC and AGC at their current auto-set values.
 * Call this just before starting an LED fade so the camera measures
 * absolute brightness rather than compensating for the dimming light.
 */
esp_err_t camera_lock_exposure(void);

/**
 * Re-enable automatic AEC and AGC.
 * Call this after a recording session completes.
 */
esp_err_t camera_unlock_exposure(void);

#ifdef __cplusplus
}
#endif
