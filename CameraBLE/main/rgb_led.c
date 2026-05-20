#include "rgb_led.h"

#include <math.h>
#include <stdlib.h>
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

/* ── Animation task state ─────────────────────────────────────────────────── */
static TaskHandle_t  s_rainbow_task   = NULL;
static volatile bool s_rainbow_active = false;

static TaskHandle_t  s_fade_task      = NULL;
static volatile bool s_fade_active    = false;

static TaskHandle_t  s_pulse_task     = NULL;
static volatile bool s_pulse_active   = false;

/* Stop all background animation tasks and wait for them to exit. */
static void stop_animations(void)
{
    bool had = (s_rainbow_active || s_fade_active || s_pulse_active);
    s_rainbow_active = false;
    s_fade_active    = false;
    s_pulse_active   = false;
    if (had) vTaskDelay(pdMS_TO_TICKS(50));
}

/* Non-blocking: clear animation flags and immediately override LED via rgb_led_set().
 * The animation task will exit on its next step; LEDC duty is already overwritten. */
void rgb_led_stop_all(void)
{
    s_rainbow_active = false;
    s_fade_active    = false;
    s_pulse_active   = false;
}

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

void rgb_led_off(void)    { stop_animations(); rgb_led_set(0,   0,   0);   }
void rgb_led_red(void)    { stop_animations(); rgb_led_set(255, 0,   0);   }
void rgb_led_green(void)  { stop_animations(); rgb_led_set(0,   255, 0);   }
void rgb_led_blue(void)   { stop_animations(); rgb_led_set(0,   0,   255); }
void rgb_led_white(void)  { stop_animations(); rgb_led_set(255, 255, 255); }
void rgb_led_yellow(void) { stop_animations(); rgb_led_set(255, 180, 0);   }
void rgb_led_cyan(void)   { stop_animations(); rgb_led_set(0,   255, 180); }
void rgb_led_purple(void) { stop_animations(); rgb_led_set(128, 0,   255); }

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
    stop_animations();
    s_rainbow_active = true;
    xTaskCreate(rainbow_task, "rainbow", 2048,
                (void *)(uintptr_t)step_ms, 5, &s_rainbow_task);
}

void rgb_led_rainbow_stop(void)
{
    if (s_rainbow_active || s_fade_active) {
        stop_animations();
    }
}

/* ── LED fade ─────────────────────────────────────────────────────────────── */

typedef struct {
    float           r, g, b;    /* initial brightness (0–255 float) */
    rgb_led_curve_t curve;
    uint32_t        duration_ms;
    uint32_t        step_ms;
} fade_params_t;

/* Map normalised time t ∈ [0,1] → normalised brightness ∈ [0,1] per curve. */
static float eval_curve(rgb_led_curve_t curve, float t)
{
    switch (curve) {
    case RGB_LED_CURVE_LINEAR:
        return 1.0f - t;
    case RGB_LED_CURVE_EXPONENTIAL:
        /* tau chosen so B(1) ≈ 1 % (e^-4.605) */
        return expf(-4.605f * t);
    case RGB_LED_CURVE_LOGARITHMIC:
        /* fast initial drop, slow tail: 1 - ln(1 + 9t)/ln(10) */
        return 1.0f - (logf(1.0f + 9.0f * t) / logf(10.0f));
    case RGB_LED_CURVE_SIGMOID:
        /* S-shaped: slow start, fast middle, slow end */
        return 1.0f / (1.0f + expf(12.0f * (t - 0.5f)));
    default:
        return 1.0f - t;
    }
}

static void fade_task(void *pvParameters)
{
    fade_params_t *p = (fade_params_t *)pvParameters;
    float r0 = p->r, g0 = p->g, b0 = p->b;
    rgb_led_curve_t curve       = p->curve;
    uint32_t        duration_ms = p->duration_ms;
    uint32_t        step_ms     = p->step_ms;
    free(p);

    uint32_t elapsed_ms = 0;

    while (s_fade_active && elapsed_ms <= duration_ms) {
        float t       = (float)elapsed_ms / (float)duration_ms;
        float bright  = eval_curve(curve, t);

        rgb_led_set((uint8_t)(r0 * bright),
                    (uint8_t)(g0 * bright),
                    (uint8_t)(b0 * bright));

        vTaskDelay(pdMS_TO_TICKS(step_ms));
        elapsed_ms += step_ms;
    }

    ledc_set_duty(LEDC_MODE, LEDC_CH_RED,   0);
    ledc_set_duty(LEDC_MODE, LEDC_CH_GREEN, 0);
    ledc_set_duty(LEDC_MODE, LEDC_CH_BLUE,  0);
    ledc_update_duty(LEDC_MODE, LEDC_CH_RED);
    ledc_update_duty(LEDC_MODE, LEDC_CH_GREEN);
    ledc_update_duty(LEDC_MODE, LEDC_CH_BLUE);

    s_fade_active = false;
    s_fade_task   = NULL;
    vTaskDelete(NULL);
}

void rgb_led_fade_start(uint8_t r, uint8_t g, uint8_t b,
                        rgb_led_curve_t curve,
                        uint32_t duration_ms, uint32_t step_ms)
{
    stop_animations();

    fade_params_t *p = malloc(sizeof(fade_params_t));
    if (!p) return;
    p->r           = (float)r;
    p->g           = (float)g;
    p->b           = (float)b;
    p->curve       = curve;
    p->duration_ms = duration_ms;
    p->step_ms     = step_ms;

    s_fade_active = true;
    xTaskCreate(fade_task, "led_fade", 2048, p, 5, &s_fade_task);
}

void rgb_led_fade_stop(void)
{
    if (s_fade_active) stop_animations();
}

/* ── LED pulse ────────────────────────────────────────────────────────────── */

typedef struct {
    float    r, g, b;
    uint32_t period_ms;
} pulse_params_t;

static void pulse_task(void *pvParameters)
{
    pulse_params_t *p = (pulse_params_t *)pvParameters;
    float    r0        = p->r;
    float    g0        = p->g;
    float    b0        = p->b;
    uint32_t period_ms = p->period_ms;
    free(p);

    const uint32_t step_ms = 20;  /* 50 Hz */
    uint32_t t = 0;

    while (s_pulse_active) {
        /* sine wave: starts at 0, peaks at period/2, returns to 0 */
        float phase  = 3.14159f * t / period_ms;  /* 0 → π over one period */
        float bright = sinf(phase);

        rgb_led_set((uint8_t)(r0 * bright),
                    (uint8_t)(g0 * bright),
                    (uint8_t)(b0 * bright));

        vTaskDelay(pdMS_TO_TICKS(step_ms));
        t = (t + step_ms) % (period_ms * 2);  /* full 0→π→0 cycle = 2×period */
    }

    ledc_set_duty(LEDC_MODE, LEDC_CH_RED,   0);
    ledc_set_duty(LEDC_MODE, LEDC_CH_GREEN, 0);
    ledc_set_duty(LEDC_MODE, LEDC_CH_BLUE,  0);
    ledc_update_duty(LEDC_MODE, LEDC_CH_RED);
    ledc_update_duty(LEDC_MODE, LEDC_CH_GREEN);
    ledc_update_duty(LEDC_MODE, LEDC_CH_BLUE);

    s_pulse_task   = NULL;
    vTaskDelete(NULL);
}

void rgb_led_pulse_start(uint8_t r, uint8_t g, uint8_t b, uint32_t period_ms)
{
    stop_animations();

    pulse_params_t *p = malloc(sizeof(pulse_params_t));
    if (!p) return;
    p->r         = (float)r;
    p->g         = (float)g;
    p->b         = (float)b;
    p->period_ms = period_ms;

    s_pulse_active = true;
    xTaskCreate(pulse_task, "led_pulse", 2048, p, 5, &s_pulse_task);
}

void rgb_led_pulse_stop(void)
{
    if (s_pulse_active) stop_animations();
}
