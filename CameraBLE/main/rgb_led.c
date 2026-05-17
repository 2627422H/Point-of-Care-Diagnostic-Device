#include "rgb_led.h"

#include "driver/ledc.h"
#include "esp_log.h"
#include "esp_err.h"

static const char *TAG = "rgb_led";

/* ── Pin assignments ──────────────────────────────────────────────────────── */
#define LED_RED_GPIO    29
#define LED_GREEN_GPIO  28
#define LED_BLUE_GPIO   30

/* ── LEDC config ──────────────────────────────────────────────────────────── */
#define LEDC_TIMER      LEDC_TIMER_0
#define LEDC_MODE       LEDC_LOW_SPEED_MODE
#define LEDC_FREQ_HZ    5000
#define LEDC_DUTY_RES   LEDC_TIMER_13_BIT   /* 0–8191 */
#define LEDC_DUTY_MAX   8191
#define LEDC_CH_RED     LEDC_CHANNEL_0
#define LEDC_CH_GREEN   LEDC_CHANNEL_1
#define LEDC_CH_BLUE    LEDC_CHANNEL_2

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
        {
            .gpio_num   = LED_RED_GPIO,
            .speed_mode = LEDC_MODE,
            .channel    = LEDC_CH_RED,
            .timer_sel  = LEDC_TIMER,
            .duty       = 0,
            .hpoint     = 0,
        },
        {
            .gpio_num   = LED_GREEN_GPIO,
            .speed_mode = LEDC_MODE,
            .channel    = LEDC_CH_GREEN,
            .timer_sel  = LEDC_TIMER,
            .duty       = 0,
            .hpoint     = 0,
        },
        {
            .gpio_num   = LED_BLUE_GPIO,
            .speed_mode = LEDC_MODE,
            .channel    = LEDC_CH_BLUE,
            .timer_sel  = LEDC_TIMER,
            .duty       = 0,
            .hpoint     = 0,
        },
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

void rgb_led_off(void)    { rgb_led_set(0,   0,   0);   }
void rgb_led_red(void)    { rgb_led_set(255, 0,   0);   }
void rgb_led_green(void)  { rgb_led_set(0,   255, 0);   }
void rgb_led_blue(void)   { rgb_led_set(0,   0,   255); }
void rgb_led_white(void)  { rgb_led_set(255, 255, 255); }
void rgb_led_yellow(void) { rgb_led_set(255, 180, 0);   }
void rgb_led_cyan(void)   { rgb_led_set(0,   255, 180); }
void rgb_led_purple(void) { rgb_led_set(128, 0,   255); }
