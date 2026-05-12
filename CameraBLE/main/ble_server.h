#pragma once

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Initialise the NimBLE stack and register the provisioning GATT service.
 * Call once before any other ble_* functions.
 *
 * The GATT service exposes three characteristics:
 *   1. SSID     (write)  – client writes the WiFi SSID
 *   2. Password (write)  – client writes the WiFi password
 *   3. IP       (read/notify) – ESP32 writes its IP address once connected
 */
esp_err_t ble_server_init(void);

/**
 * Returns true once WiFi credentials have been received from the BLE client
 * and are ready to use.
 */
bool ble_server_credentials_received(void);

/**
 * Returns the SSID received from the BLE client.
 * Valid only after ble_server_credentials_received() returns true.
 */
const char *ble_server_get_ssid(void);

/**
 * Returns the password received from the BLE client.
 * Valid only after ble_server_credentials_received() returns true.
 */
const char *ble_server_get_password(void);

/**
 * Call this after the ESP32 has connected to WiFi and obtained an IP.
 * Stores the IP string and notifies any connected BLE client.
 *
 * @param ip_str  Null-terminated IPv4 address string, e.g. "192.168.1.42"
 */
esp_err_t ble_server_notify_ip(const char *ip_str);

#ifdef __cplusplus
}
#endif