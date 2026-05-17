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

// MJPEG frame boundary written by wifi_stream.c
const MJPEG_BOUNDARY = '--frame';

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
  return btoa(
    encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
  );
}
function base64ToStr(b64: string): string {
  return decodeURIComponent(
    Array.from(atob(b64))
      .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('')
  );
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
  const [phase, setPhase]             = useState<StreamPhase>('idle');
  const [streamUrl, setStreamUrl]     = useState<string | null>(null);
  const [frameCount, setFrameCount]   = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [streamError, setStreamError] = useState<string | null>(null);
  const [connectStatus, setConnectStatus] = useState<string | null>(null);
  const [bleMode, setBleMode]         = useState(false);

  const streamStartRef = useRef<number>(0);
  const cancelledRef   = useRef(false);
  const deviceRef      = useRef<any>(null);
  const xhrRef         = useRef<XMLHttpRequest | null>(null);
  const frameCountRef  = useRef(0);
  const xhrOffsetRef   = useRef(0);

  function safeSetPhase(p: StreamPhase) {
    if (!cancelledRef.current) setPhase(p);
  }

  // ── XHR stream reader (runs in RN, no WebView needed) ───────────────────────
  // Mirrors the Python script's retry logic: up to 10 attempts, 2s apart.
  function startXhrStream(url: string, attempt = 1) {
    if (cancelledRef.current) return;

    const MAX_ATTEMPTS = 10;
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    if (attempt === 1) {
      frameCountRef.current = 0;
      xhrOffsetRef.current = 0;
    }

    setConnectStatus(attempt === 1 ? 'Connecting…' : `Retry ${attempt}/${MAX_ATTEMPTS}…`);

    xhr.open('GET', url, true);

    xhr.onreadystatechange = () => {
      if (xhr.readyState === 2) {
        setConnectStatus(`HTTP ${xhr.status}`);
      }
    };

    xhr.onprogress = () => {
      const text = xhr.responseText;
      const chunk = text.slice(xhrOffsetRef.current);
      xhrOffsetRef.current = text.length;

      let pos = 0;
      while (pos < chunk.length) {
        const idx = chunk.indexOf(MJPEG_BOUNDARY, pos);
        if (idx === -1) break;
        frameCountRef.current += 1;
        setFrameCount(frameCountRef.current);
        pos = idx + MJPEG_BOUNDARY.length;
      }
    };

    xhr.onerror = () => {
      if (cancelledRef.current) return;
      if (attempt < MAX_ATTEMPTS) {
        setTimeout(() => startXhrStream(url, attempt + 1), 2000);
      } else {
        setStreamError('Could not connect after 10 attempts — is the ESP32 HTTP server running?');
        setConnectStatus('Failed');
      }
    };

    xhr.ontimeout = () => {
      if (cancelledRef.current) return;
      if (attempt < MAX_ATTEMPTS) {
        setTimeout(() => startXhrStream(url, attempt + 1), 2000);
      } else {
        setStreamError('Connection timed out after 10 attempts');
        setConnectStatus('Timeout');
      }
    };

    xhr.send();
  }

  function stopXhr() {
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
  }

  // ── Mock flow ────────────────────────────────────────────────────────────────
  async function mockFlow() {
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
  }

  async function mockProvision(_ssid: string, _password: string) {
    safeSetPhase('provisioning');
    await delay(1500);
    if (cancelledRef.current) return;
    safeSetPhase('connecting');
    await delay(1000);
    if (cancelledRef.current) return;
    streamStartRef.current = Date.now();
    setConnectStatus('Mock mode — no real device');
    safeSetPhase('streaming');
  }

  // ── Real BLE flow ────────────────────────────────────────────────────────────
  async function bleProvision(ssid: string, password: string) {
    if (!deviceRef.current) return;
    safeSetPhase('provisioning');

    const device = deviceRef.current;
    try {
      const ip = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Timed out waiting for IP — did the ESP32 join WiFi?')),
          30_000
        );

        const sub = device.monitorCharacteristicForService(
          SERVICE_UUID, IP_UUID,
          (err: any, char: any) => {
            if (err) { clearTimeout(timeout); sub.remove(); reject(err); return; }
            if (char?.value) {
              const ip = base64ToStr(char.value).replace(/\0/g, '').trim();
              if (ip) { clearTimeout(timeout); sub.remove(); resolve(ip); }
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
      streamStartRef.current = Date.now();
      const url = `http://${ip}/stream`;
      setStreamUrl(url);
      startXhrStream(url);
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
    stopXhr();
    setStreamUrl(null);
    setFrameCount(0);
    setErrorMessage('');
    setStreamError(null);
    setConnectStatus(null);
    setBleMode(false);
    safeSetPhase('scanning');

    const ble = getBle();
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

    await new Promise<void>((resolve) => {
      const sub = ble.onStateChange((state: string) => {
        if (state === 'PoweredOn') { sub.remove(); resolve(); }
      }, true);
    });

    if (cancelledRef.current) return;

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ble.stopDeviceScan();
          reject(new Error(`'${DEVICE_NAME}' not found — is the device on?`));
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
              setBleMode(true);
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
    stopXhr();
    deviceRef.current?.cancelConnection().catch(() => {});
    deviceRef.current = null;
    safeSetPhase('complete');
  }, []);

  const reset = useCallback(() => {
    cancelledRef.current = true;
    stopXhr();
    getBle()?.stopDeviceScan();
    deviceRef.current?.cancelConnection().catch(() => {});
    deviceRef.current = null;
    setPhase('idle');
    setStreamUrl(null);
    setFrameCount(0);
    setErrorMessage('');
    setStreamError(null);
    setConnectStatus(null);
    setBleMode(false);
  }, []);

  const fps = frameCount > 0
    ? (frameCount / Math.max(1, (Date.now() - streamStartRef.current) / 1000)).toFixed(1)
    : '0.0';

  return {
    phase, streamUrl, frameCount, fps,
    errorMessage, streamError, connectStatus, bleMode,
    start, stop, reset, submitWifiCredentials,
  };
}
