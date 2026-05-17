import { useState, useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, PermissionsAndroid } from 'react-native';

export type StreamPhase =
  | 'idle'
  | 'scanning'
  | 'ble_connected'
  | 'wifi_setup'
  | 'provisioning'
  | 'connecting'
  | 'streaming'
  | 'complete'
  | 'error';

const DEVICE_NAME  = 'ESP32-CAM';
const SERVICE_UUID = 'fb349b5f-8000-0080-0010-000000000010';
const SSID_UUID    = 'fb349b5f-8000-0080-0010-000000000011';
const PASS_UUID    = 'fb349b5f-8000-0080-0010-000000000012';
const IP_UUID      = 'fb349b5f-8000-0080-0010-000000000013';
const WIFI_KEY     = 'poc_wifi_credentials';

// Lazy singleton — created only when first needed so module-level import
// doesn't crash in Expo Go where the native module isn't linked.
let _ble: import('react-native-ble-plx').BleManager | null = null;
function getBle(): import('react-native-ble-plx').BleManager | null {
  if (_ble) return _ble;
  try {
    const { BleManager } = require('react-native-ble-plx');
    _ble = new BleManager();
    return _ble;
  } catch {
    return null;
  }
}

function strToBase64(str: string): string {
  return Buffer.from(str, 'utf8').toString('base64');
}
function base64ToStr(b64: string): string {
  return Buffer.from(b64, 'base64').toString('utf8');
}
function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function requestAndroidPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if ((Platform.Version as number) >= 31) {
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    return Object.values(results).every(
      (r) => r === PermissionsAndroid.RESULTS.GRANTED
    );
  }
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export function useStreamSession() {
  const [phase, setPhase]           = useState<StreamPhase>('idle');
  const [streamUrl, setStreamUrl]   = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const cancelledRef = useRef(false);
  const deviceRef    = useRef<any>(null);

  function safeSetPhase(p: StreamPhase) {
    if (!cancelledRef.current) setPhase(p);
  }

  // ── Mock flow (Expo Go / no native BLE) ─────────────────────────────────────
  async function mockFlow(ssid?: string, password?: string) {
    if (!ssid) {
      await delay(2000);
      if (cancelledRef.current) return;
      safeSetPhase('ble_connected');
      await delay(400);
      if (cancelledRef.current) return;

      let stored: string | null = null;
      try { stored = await AsyncStorage.getItem(WIFI_KEY); } catch {}
      if (!stored) { safeSetPhase('wifi_setup'); return; }

      const creds = JSON.parse(stored);
      await mockProvision(creds.ssid, creds.password);
    } else {
      await mockProvision(ssid, password!);
    }
  }

  async function mockProvision(ssid: string, password: string) {
    safeSetPhase('provisioning');
    await delay(1500);
    if (cancelledRef.current) return;
    safeSetPhase('connecting');
    await delay(1000);
    if (cancelledRef.current) return;
    // No real device — stream URL stays null; LiveCamera won't render.
    safeSetPhase('streaming');
  }

  // ── Real BLE flow ────────────────────────────────────────────────────────────
  async function bleProvision(ssid: string, password: string) {
    const ble = getBle();
    if (!ble || !deviceRef.current) return;
    safeSetPhase('provisioning');

    const device = deviceRef.current;
    try {
      const ip = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Timed out waiting for IP address')),
          30_000
        );

        const sub = device.monitorCharacteristicForService(
          SERVICE_UUID, IP_UUID,
          (err: any, char: any) => {
            if (err) { clearTimeout(timeout); sub.remove(); reject(err); return; }
            if (char?.value) {
              const ip = base64ToStr(char.value).replace(/\0/g, '').trim();
              clearTimeout(timeout); sub.remove(); resolve(ip);
            }
          }
        );

        device
          .writeCharacteristicWithoutResponseForService(SERVICE_UUID, SSID_UUID, strToBase64(ssid))
          .then(() => delay(200))
          .then(() =>
            device.writeCharacteristicWithoutResponseForService(SERVICE_UUID, PASS_UUID, strToBase64(password))
          )
          .catch((err: any) => { clearTimeout(timeout); sub.remove(); reject(err); });
      });

      if (cancelledRef.current) return;
      safeSetPhase('connecting');
      setStreamUrl(`http://${ip}/stream`);
      safeSetPhase('streaming');
    } catch (err: any) {
      if (!cancelledRef.current) {
        setErrorMessage(err?.message ?? 'Provisioning failed');
        safeSetPhase('error');
      }
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  const start = useCallback(async () => {
    cancelledRef.current = false;
    setStreamUrl(null);
    setErrorMessage('');
    safeSetPhase('scanning');

    const ble = getBle();

    // Fall back to mock if native BLE isn't available (Expo Go).
    if (!ble) {
      await mockFlow();
      return;
    }

    const granted = await requestAndroidPermissions();
    if (!granted) {
      setErrorMessage('Bluetooth permission denied');
      safeSetPhase('error');
      return;
    }

    // Wait for Bluetooth radio to be ready.
    await new Promise<void>((resolve) => {
      const { State } = require('react-native-ble-plx');
      const sub = ble.onStateChange((state: string) => {
        if (state === 'PoweredOn') { sub.remove(); resolve(); }
      }, true);
    });

    if (cancelledRef.current) return;

    // Scan for ESP32-CAM.
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ble.stopDeviceScan();
          reject(new Error(`Could not find '${DEVICE_NAME}'. Make sure the device is on and nearby.`));
        }, 15_000);

        ble.startDeviceScan(null, null, async (err: any, scanned: any) => {
          if (err) { clearTimeout(timeout); ble.stopDeviceScan(); reject(err); return; }
          if (scanned?.name === DEVICE_NAME || scanned?.localName === DEVICE_NAME) {
            clearTimeout(timeout);
            ble.stopDeviceScan();
            try {
              const connected = await scanned.connect({ timeout: 20_000 });
              await connected.discoverAllServicesAndCharacteristics();
              deviceRef.current = connected;
              safeSetPhase('ble_connected');
              resolve();
            } catch (e) { reject(e); }
          }
        });
      });
    } catch (err: any) {
      if (!cancelledRef.current) {
        setErrorMessage(err?.message ?? 'BLE connection failed');
        safeSetPhase('error');
      }
      return;
    }

    if (cancelledRef.current || !deviceRef.current) return;

    let stored: string | null = null;
    try { stored = await AsyncStorage.getItem(WIFI_KEY); } catch {}

    if (!stored) { safeSetPhase('wifi_setup'); return; }

    const { ssid, password } = JSON.parse(stored);
    await bleProvision(ssid, password);
  }, []);

  const submitWifiCredentials = useCallback(async (ssid: string, password: string) => {
    try { await AsyncStorage.setItem(WIFI_KEY, JSON.stringify({ ssid, password })); } catch {}
    if (deviceRef.current) {
      await bleProvision(ssid, password);
    } else {
      await mockProvision(ssid, password);
    }
  }, []);

  const stop = useCallback(() => {
    deviceRef.current?.cancelConnection().catch(() => {});
    deviceRef.current = null;
    safeSetPhase('complete');
  }, []);

  const reset = useCallback(() => {
    cancelledRef.current = true;
    const ble = getBle();
    ble?.stopDeviceScan();
    deviceRef.current?.cancelConnection().catch(() => {});
    deviceRef.current = null;
    setPhase('idle');
    setStreamUrl(null);
    setErrorMessage('');
  }, []);

  return { phase, streamUrl, errorMessage, start, stop, reset, submitWifiCredentials };
}
