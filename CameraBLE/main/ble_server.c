#include "ble_server.h"
#include "rgb_led.h"

#include <string.h>
#include <assert.h>
#include "esp_log.h"
#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

/* NimBLE */
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "host/ble_hs.h"
#include "host/ble_uuid.h"
#include "host/util/util.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"

static const char *TAG = "ble_server";

#define DEVICE_NAME  "ESP32-CAM"

/* ── Max field lengths ────────────────────────────────────────────────────── */
#define MAX_SSID_LEN      64
#define MAX_PASSWORD_LEN  64
#define MAX_IP_LEN        16

/* ── 128-bit UUIDs ────────────────────────────────────────────────────────── */
/* Service: ESP32-CAM Provisioning
 * fb349b5f-8000-0080-0010-000000000010 */
static const ble_uuid128_t s_svc_uuid =
    BLE_UUID128_INIT(0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00,
                     0x80, 0x00, 0x00, 0x80, 0x5f, 0x9b, 0x34, 0xfb);

/* SSID characteristic (write)
 * fb349b5f-8000-0080-0010-000000000011 */
static const ble_uuid128_t s_ssid_chr_uuid =
    BLE_UUID128_INIT(0x11, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00,
                     0x80, 0x00, 0x00, 0x80, 0x5f, 0x9b, 0x34, 0xfb);

/* Password characteristic (write)
 * fb349b5f-8000-0080-0010-000000000012 */
static const ble_uuid128_t s_pass_chr_uuid =
    BLE_UUID128_INIT(0x12, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00,
                     0x80, 0x00, 0x00, 0x80, 0x5f, 0x9b, 0x34, 0xfb);

/* IP address characteristic (read + notify)
 * fb349b5f-8000-0080-0010-000000000013 */
static const ble_uuid128_t s_ip_chr_uuid =
    BLE_UUID128_INIT(0x13, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00,
                     0x80, 0x00, 0x00, 0x80, 0x5f, 0x9b, 0x34, 0xfb);

/* ── Runtime state ────────────────────────────────────────────────────────── */
static uint16_t s_conn_handle     = BLE_HS_CONN_HANDLE_NONE;
static uint16_t s_ip_chr_handle   = 0;
static uint8_t  s_addr_type       = 0;
static bool     s_ip_subscribed   = false;

static char s_ssid[MAX_SSID_LEN]         = {0};
static char s_password[MAX_PASSWORD_LEN] = {0};
static char s_ip[MAX_IP_LEN]             = {0};
static bool s_credentials_received       = false;

static int gap_event(struct ble_gap_event *event, void *arg);

/* ── GATT access callbacks ────────────────────────────────────────────────── */

static int ssid_chr_access(uint16_t conn_handle, uint16_t attr_handle,
                           struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    if (ctxt->op == BLE_GATT_ACCESS_OP_WRITE_CHR) {
        uint16_t len = OS_MBUF_PKTLEN(ctxt->om);
        if (len >= MAX_SSID_LEN) { len = MAX_SSID_LEN - 1; }
        ble_hs_mbuf_to_flat(ctxt->om, s_ssid, len, NULL);
        s_ssid[len] = '\0';
        ESP_LOGI(TAG, "Received SSID: %s", s_ssid);
    }
    return 0;
}

static int pass_chr_access(uint16_t conn_handle, uint16_t attr_handle,
                           struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    if (ctxt->op == BLE_GATT_ACCESS_OP_WRITE_CHR) {
        uint16_t len = OS_MBUF_PKTLEN(ctxt->om);
        if (len >= MAX_PASSWORD_LEN) { len = MAX_PASSWORD_LEN - 1; }
        ble_hs_mbuf_to_flat(ctxt->om, s_password, len, NULL);
        s_password[len] = '\0';
        ESP_LOGI(TAG, "Received password (length=%d)", len);
        /* Password arriving signals that credentials are complete. */
        s_credentials_received = true;
    }
    return 0;
}

static int ip_chr_access(uint16_t conn_handle, uint16_t attr_handle,
                         struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    if (ctxt->op == BLE_GATT_ACCESS_OP_READ_CHR) {
        int rc = os_mbuf_append(ctxt->om, s_ip, strlen(s_ip));
        return rc == 0 ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    return 0;
}

static const struct ble_gatt_svc_def s_gatt_svcs[] = {
    {
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &s_svc_uuid.u,
        .characteristics = (struct ble_gatt_chr_def[]) {
            {
                .uuid      = &s_ssid_chr_uuid.u,
                .access_cb = ssid_chr_access,
                .flags     = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_NO_RSP,
            },
            {
                .uuid      = &s_pass_chr_uuid.u,
                .access_cb = pass_chr_access,
                .flags     = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_NO_RSP,
            },
            {
                .uuid       = &s_ip_chr_uuid.u,
                .access_cb  = ip_chr_access,
                .val_handle = &s_ip_chr_handle,
                .flags      = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_NOTIFY,
            },
            { 0 },
        },
    },
    { 0 },
};

/* ── Advertising ──────────────────────────────────────────────────────────── */
static void start_advertising(void)
{
    struct ble_hs_adv_fields fields = {0};
    fields.flags            = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
    fields.name             = (uint8_t *)DEVICE_NAME;
    fields.name_len         = strlen(DEVICE_NAME);
    fields.name_is_complete = 1;
    fields.tx_pwr_lvl_is_present = 1;
    fields.tx_pwr_lvl       = BLE_HS_ADV_TX_PWR_LVL_AUTO;

    int rc = ble_gap_adv_set_fields(&fields);
    if (rc != 0) {
        ESP_LOGE(TAG, "adv set fields failed: %d", rc);
        return;
    }

    struct ble_gap_adv_params adv_params = {0};
    adv_params.conn_mode = BLE_GAP_CONN_MODE_UND;
    adv_params.disc_mode = BLE_GAP_DISC_MODE_GEN;

    rc = ble_gap_adv_start(s_addr_type, NULL, BLE_HS_FOREVER,
                           &adv_params, gap_event, NULL);
    if (rc != 0) {
        ESP_LOGE(TAG, "adv start failed: %d", rc);
    } else {
        ESP_LOGI(TAG, "Advertising as \"%s\"", DEVICE_NAME);
    }
}

/* ── GAP event handler ────────────────────────────────────────────────────── */
static int gap_event(struct ble_gap_event *event, void *arg)
{
    switch (event->type) {
    case BLE_GAP_EVENT_CONNECT:
        if (event->connect.status == 0) {
            s_conn_handle = event->connect.conn_handle;
            ESP_LOGI(TAG, "Connected, conn_handle=%d", s_conn_handle);
            ble_att_set_preferred_mtu(512);
            ble_gattc_exchange_mtu(s_conn_handle, NULL, NULL);
            rgb_led_blue();   /* solid blue = phone connected */
        } else {
            ESP_LOGW(TAG, "Connection failed, resuming advertising");
            start_advertising();
            rgb_led_pulse_start(0, 0, 255, 1500);  /* back to blue pulse */
        }
        break;

    case BLE_GAP_EVENT_DISCONNECT:
        ESP_LOGI(TAG, "Disconnected (reason=0x%02x)", event->disconnect.reason);
        s_conn_handle   = BLE_HS_CONN_HANDLE_NONE;
        s_ip_subscribed = false;
        /* Only re-advertise if we haven't handed off to WiFi yet. */
        if (!s_credentials_received) {
            start_advertising();
            rgb_led_pulse_start(0, 0, 255, 1500);  /* blue pulse = advertising again */
        }
        break;

    case BLE_GAP_EVENT_SUBSCRIBE:
        if (event->subscribe.attr_handle == s_ip_chr_handle) {
            s_ip_subscribed = (event->subscribe.cur_notify != 0);
            ESP_LOGI(TAG, "IP notifications %s",
                     s_ip_subscribed ? "ENABLED" : "DISABLED");
        }
        break;

    case BLE_GAP_EVENT_MTU:
        ESP_LOGI(TAG, "MTU updated: conn=%d mtu=%d",
                 event->mtu.conn_handle, event->mtu.value);
        break;

    default:
        break;
    }
    return 0;
}

static void on_sync(void)
{
    int rc = ble_hs_id_infer_auto(0, &s_addr_type);
    assert(rc == 0);

    uint8_t addr[6] = {0};
    ble_hs_id_copy_addr(s_addr_type, addr, NULL);
    ESP_LOGI(TAG, "BLE address: %02x:%02x:%02x:%02x:%02x:%02x",
             addr[5], addr[4], addr[3], addr[2], addr[1], addr[0]);

    start_advertising();
}

static void on_reset(int reason)
{
    ESP_LOGW(TAG, "BLE host reset (reason=%d)", reason);
}

static void nimble_host_task(void *arg)
{
    nimble_port_run();
    nimble_port_freertos_deinit();
}

/* ── Public API ───────────────────────────────────────────────────────────── */

esp_err_t ble_server_init(void)
{
    esp_err_t ret = nimble_port_init();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "nimble_port_init failed: %s", esp_err_to_name(ret));
        return ret;
    }

    ble_hs_cfg.sync_cb  = on_sync;
    ble_hs_cfg.reset_cb = on_reset;

    ble_svc_gap_init();
    ble_svc_gatt_init();

    int rc = ble_gatts_count_cfg(s_gatt_svcs);
    if (rc != 0) { return ESP_FAIL; }
    rc = ble_gatts_add_svcs(s_gatt_svcs);
    if (rc != 0) { return ESP_FAIL; }

    rc = ble_svc_gap_device_name_set(DEVICE_NAME);
    assert(rc == 0);

    nimble_port_freertos_init(nimble_host_task);

    ESP_LOGI(TAG, "NimBLE provisioning stack initialised");
    return ESP_OK;
}

bool ble_server_credentials_received(void)
{
    return s_credentials_received;
}

const char *ble_server_get_ssid(void)
{
    return s_ssid;
}

const char *ble_server_get_password(void)
{
    return s_password;
}

esp_err_t ble_server_notify_ip(const char *ip_str)
{
    strncpy(s_ip, ip_str, MAX_IP_LEN - 1);
    s_ip[MAX_IP_LEN - 1] = '\0';
    ESP_LOGI(TAG, "WiFi IP: %s", s_ip);

    if (s_conn_handle == BLE_HS_CONN_HANDLE_NONE) {
        ESP_LOGW(TAG, "No BLE client connected to notify IP");
        return ESP_ERR_INVALID_STATE;
    }

    if (!s_ip_subscribed) {
        ESP_LOGW(TAG, "Client not subscribed to IP notifications");
        return ESP_ERR_INVALID_STATE;
    }

    struct os_mbuf *om = ble_hs_mbuf_from_flat(s_ip, strlen(s_ip));
    if (!om) { return ESP_ERR_NO_MEM; }

    int rc = ble_gatts_notify_custom(s_conn_handle, s_ip_chr_handle, om);
    if (rc != 0) {
        ESP_LOGE(TAG, "IP notify failed: %d", rc);
        return ESP_FAIL;
    }

    ESP_LOGI(TAG, "IP address notified to client");
    return ESP_OK;
}