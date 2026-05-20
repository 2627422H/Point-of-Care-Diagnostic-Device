#pragma once

#include <stdint.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Initialise the LEDC peripheral for the RGB LED.
 * Call once at startup before any rgb_led_* functions.
 */
esp_err_t rgb_led_init(void);

/**
 * Set the LED to an explicit RGB colour (0-255 per channel).
 * Stops any active rainbow cycle.
 */
void rgb_led_set(uint8_t r, uint8_t g, uint8_t b);

/**
 * Start a smooth rainbow colour cycle in a background FreeRTOS task.
 *
 * @param step_ms  Delay in ms between each hue step (1 step = 1/360 of cycle).
 *                 Suggested values:
 *                   10  -> fast  (~3.6 s per full cycle)
 *                   20  -> medium (~7.2 s per full cycle)
 *                   40  -> slow  (~14.4 s per full cycle)
 */
void rgb_led_rainbow_start(uint32_t step_ms);

/**
 * Stop the rainbow cycle. LED turns off.
 */
void rgb_led_rainbow_stop(void);

/** Brightness curve shapes for rgb_led_fade_start(). */
typedef enum {
    RGB_LED_CURVE_LINEAR      = 0,  /* constant rate drop to zero          */
    RGB_LED_CURVE_EXPONENTIAL = 1,  /* fast initial drop, long dim tail    */
    RGB_LED_CURVE_LOGARITHMIC = 2,  /* very fast initial drop, slow tail   */
    RGB_LED_CURVE_SIGMOID     = 3,  /* slow start, fast middle, slow end   */
} rgb_led_curve_t;

/**
 * Fade the LED from (r,g,b) to black over duration_ms using the chosen curve.
 * step_ms sets the update interval (e.g. 20 ms = 50 Hz).
 * Stops any active rainbow or fade before starting.
 * The curve type and parameters are designed to be driven from the app over BLE.
 */
void rgb_led_fade_start(uint8_t r, uint8_t g, uint8_t b,
                        rgb_led_curve_t curve,
                        uint32_t duration_ms, uint32_t step_ms);

/** Stop an in-progress fade. LED turns off. */
void rgb_led_fade_stop(void);

/**
 * Pulse the LED between off and (r,g,b) using a smooth sine wave.
 * period_ms is the full on→off→on cycle time.
 * Useful for status indication (e.g. BLE advertising, WiFi connecting).
 */
void rgb_led_pulse_start(uint8_t r, uint8_t g, uint8_t b, uint32_t period_ms);

/** Stop an in-progress pulse. LED turns off. */
void rgb_led_pulse_stop(void);

/** Solid colour shortcuts - each one stops any active rainbow or fade. */
void rgb_led_off(void);
void rgb_led_red(void);
void rgb_led_green(void);
void rgb_led_blue(void);
void rgb_led_white(void);
void rgb_led_yellow(void);
void rgb_led_cyan(void);
void rgb_led_purple(void);

#ifdef __cplusplus
}
#endif
