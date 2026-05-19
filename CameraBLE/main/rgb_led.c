#include "rgb_led.h"

#include "driver/ledc.h"
#include "esp_log.h"
#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "rgb_led";

/* ── Pin assignments ──────────────────────────────────────────────────────── */
#define LED_RED_GPIO    29
#define LED_GREEN_GPIO  28
#define LED_BLUE_GPIO   30

/* ── LEDC config ──────────────────────────────────────────────────────────── */
#define LEDC_TIMER      LEDC_TIMER_0
#define LEDC_MODE       LEDC_LOW_SPEED_MODE
#define LEDC_FREQ_HZ    5000
#define LEDC_DUTY_RES   LEDC_TIMER_13_BIT
#define LEDC_DUTY_MAX   8191
#define LEDC_CH_RED     LEDC_CHANNEL_0
#define LEDC_CH_GREEN   LEDC_CHANNEL_1
#define LEDC_CH_BLUE    LEDC_CHANNEL_2

/* ── Rainbow task state ───────────────────────────────────────────────────── */
static TaskHandle_t s_rainbow_task = NULL;
static volatile bool s_rainbow_active = false;

esp_err_t rgb_led_init(void)
{
    ledc_timer_config_t timer_cfg = {
        .speed_mode      = LEDC_MODE,
        .timer_num       = LEDC_TIMER,
        .duty_resolution = LEDC_DUTY_RES,
        .freq_hz         = LEDC_FREQ_HZ,
        .clk_cfg         = LEDC_AUTO_CLK,
    };
    ESP_ERROR_CHECK(ledc_timer_config(&timer_cfg));

    ledc_channel_config_t channels[] = {
        { .gpio_num = LED_RED_GPIO,   .speed_mode = LEDC_MODE,
          .channel  = LEDC_CH_RED,   .timer_sel  = LEDC_TIMER,
          .duty = 0, .hpoint = 0 },
        { .gpio_num = LED_GREEN_GPIO, .speed_mode = LEDC_MODE,
          .channel  = LEDC_CH_GREEN, .timer_sel  = LEDC_TIMER,
          .duty = 0, .hpoint = 0 },
        { .gpio_num = LED_BLUE_GPIO,  .speed_mode = LEDC_MODE,
          .channel  = LEDC_CH_BLUE,  .timer_sel  = LEDC_TIMER,
          .duty = 0, .hpoint = 0 },
    };
    for (int i = 0; i < 3; i++) {
        ESP_ERROR_CHECK(ledc_channel_config(&channels[i]));
    }

    ESP_LOGI(TAG, "RGB LED ready (R=GPIO%d G=GPIO%d B=GPIO%d)",
             LED_RED_GPIO, LED_GREEN_GPIO, LED_BLUE_GPIO);
    return ESP_OK;
}

void rgb_led_set(uint8_t r, uint8_t g, uint8_t b)
{
    ledc_set_duty(LEDC_MODE, LEDC_CH_RED,   (r * LEDC_DUTY_MAX) / 255);
    ledc_set_duty(LEDC_MODE, LEDC_CH_GREEN, (g * LEDC_DUTY_MAX) / 255);
    ledc_set_duty(LEDC_MODE, LEDC_CH_BLUE,  (b * LEDC_DUTY_MAX) / 255);
    ledc_update_duty(LEDC_MODE, LEDC_CH_RED);
    ledc_update_duty(LEDC_MODE, LEDC_CH_GREEN);
    ledc_update_duty(LEDC_MODE, LEDC_CH_BLUE);
}

void rgb_led_off(void)    { rgb_led_rainbow_stop(); rgb_led_set(0,   0,   0);   }
void rgb_led_red(void)    { rgb_led_rainbow_stop(); rgb_led_set(255, 0,   0);   }
void rgb_led_green(void)  { rgb_led_rainbow_stop(); rgb_led_set(0,   255, 0);   }
void rgb_led_blue(void)   { rgb_led_rainbow_stop(); rgb_led_set(0,   0,   255); }
void rgb_led_white(void)  { rgb_led_rainbow_stop(); rgb_led_set(255, 255, 255); }
void rgb_led_yellow(void) { rgb_led_rainbow_stop(); rgb_led_set(255, 180, 0);   }
void rgb_led_cyan(void)   { rgb_led_rainbow_stop(); rgb_led_set(0,   255, 180); }
void rgb_led_purple(void) { rgb_led_rainbow_stop(); rgb_led_set(128, 0,   255); }

/* ── HSV → RGB helper ─────────────────────────────────────────────────────── */
static void hsv_to_rgb(uint16_t hue, uint8_t *r, uint8_t *g, uint8_t *b)
{
    /* hue: 0–359 */
    uint8_t region = hue / 60;
    uint8_t rem    = (hue % 60) * 255 / 60;
    uint8_t p = 0, q = 255 - rem, t = rem;

    switch (region) {
    case 0: *r = 255; *g = t;   *b = p;   break;
    case 1: *r = q;   *g = 255; *b = p;   break;
    case 2: *r = p;   *g = 255; *b = t;   break;
    case 3: *r = p;   *g = q;   *b = 255; break;
    case 4: *r = t;   *g = p;   *b = 255; break;
    default:*r = 255; *g = p;   *b = q;   break;
    }
}

/* ── Rainbow cycling task ─────────────────────────────────────────────────── */
/*
 * step_ms controls the speed of the cycle:
 *   10 ms/step = full cycle in ~3.6 s  (fast)
 *   20 ms/step = full cycle in ~7.2 s  (medium)
 *   40 ms/step = full cycle in ~14.4 s (slow)
 *
 * The value is passed as a uint32_t cast through pvParameters.
 */
static void rainbow_task(void *pvParameters)
{
    uint32_t step_ms = (uint32_t)(uintptr_t)pvParameters;
    uint16_t hue = 0;

    while (s_rainbow_active) {
        uint8_t r, g, b;
        hsv_to_rgb(hue, &r, &g, &b);
        rgb_led_set(r, g, b);
        hue = (hue + 1) % 360;
        vTaskDelay(pdMS_TO_TICKS(step_ms));
    }

    /* Turn off when stopped. */
    ledc_set_duty(LEDC_MODE, LEDC_CH_RED,   0);
    ledc_set_duty(LEDC_MODE, LEDC_CH_GREEN, 0);
    ledc_set_duty(LEDC_MODE, LEDC_CH_BLUE,  0);
    ledc_update_duty(LEDC_MODE, LEDC_CH_RED);
    ledc_update_duty(LEDC_MODE, LEDC_CH_GREEN);
    ledc_update_duty(LEDC_MODE, LEDC_CH_BLUE);

    s_rainbow_task = NULL;
    vTaskDelete(NULL);
}

void rgb_led_rainbow_start(uint32_t step_ms)
{
    /* Stop any existing rainbow task first. */
    rgb_led_rainbow_stop();

    s_rainbow_active = true;
    xTaskCreate(rainbow_task, "rainbow", 2048,
                (void *)(uintptr_t)step_ms, 5, &s_rainbow_task);
}

void rgb_led_rainbow_stop(void)
{
    if (s_rainbow_active) {
        s_rainbow_active = false;
        /* Give the task time to exit cleanly. */
        vTaskDelay(pdMS_TO_TICKS(50));
    }
}
