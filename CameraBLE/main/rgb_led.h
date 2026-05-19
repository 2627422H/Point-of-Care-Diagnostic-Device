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

/** Solid colour shortcuts - each one stops any active rainbow cycle. */
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
