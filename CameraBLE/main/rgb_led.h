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
 * Set the LED to an explicit RGB colour (0–255 per channel).
 */
void rgb_led_set(uint8_t r, uint8_t g, uint8_t b);

/** Convenience colour shortcuts */
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
