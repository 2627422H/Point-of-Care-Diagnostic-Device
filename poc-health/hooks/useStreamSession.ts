import { useState, useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveRecordingRun } from '../store/useRecordingStore';
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

// "--frame" as bytes (ASCII) — matches wifi_stream.c MJPEG_BOUNDARY
const FRAME_BOUNDARY = [0x2D, 0x2D, 0x66, 0x72, 0x61, 0x6D, 0x65] as const;

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
  const [phase, setPhase]               = useState<StreamPhase>('idle');
  const [streamUrl, setStreamUrl]       = useState<string | null>(null);
  const [frameCount, setFrameCount]     = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [streamError, setStreamError]   = useState<string | null>(null);
  const [connectStatus, setConnectStatus] = useState<string | null>(null);
  const [bleMode, setBleMode]           = useState(false);
  const [bytesReceived, setBytesReceived] = useState(0);
  const [useWebViewMode, setUseWebViewMode] = useState(false);
  const [webViewStatus, setWebViewStatus] = useState<string | null>(null);

  const streamStartRef  = useRef<number>(0);
  const cancelledRef    = useRef(false);
  const deviceRef       = useRef<any>(null);
  const abortRef        = useRef<AbortController | null>(null);
  const frameCountRef   = useRef(0);
  const bytesRef        = useRef(0);
  const useWebViewRef   = useRef(false);

  function safeSetPhase(p: StreamPhase) {
    if (!cancelledRef.current) setPhase(p);
  }

  function stopStream() {
    abortRef.current?.abort();
    abortRef.current = null;
  }

  // ── Fetch stream reader ──────────────────────────────────────────────────
  async function startFetchStream(url: string, attempt = 1) {
    if (cancelledRef.current) return;
    const MAX_ATTEMPTS = 10;

    setConnectStatus(attempt === 1 ? 'Connecting…' : `Retry ${attempt}/${MAX_ATTEMPTS}…`);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(url, { signal: controller.signal });
      setConnectStatus(`HTTP ${res.status}`);
      console.log('[stream] fetch ok status=', res.status,
        'body=', !!res.body,
        'content-type=', res.headers.get('content-type'));

      if (!res.body) {
        setStreamError('Streaming not supported on this platform');
        return;
      }

      if (useWebViewRef.current) {
        console.log('[stream] WebView mode active — handing off to MjpegViewer');
        return;
      }

      const reader = res.body.getReader();
      let tail = new Uint8Array(0);

      while (!cancelledRef.current) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value?.length) continue;

        bytesRef.current += value.length;
        setBytesReceived(bytesRef.current);

        const chunk = new Uint8Array(tail.length + value.length);
        chunk.set(tail);
        chunk.set(value, tail.length);

        let i = 0;
        while (i <= chunk.length - FRAME_BOUNDARY.length) {
          let match = true;
          for (let j = 0; j < FRAME_BOUNDARY.length; j++) {
            if (chunk[i + j] !== FRAME_BOUNDARY[j]) { match = false; break; }
          }
          if (match) {
            frameCountRef.current += 1;
            setFrameCount(frameCountRef.current);
            i += FRAME_BOUNDARY.length;
          } else {
            i++;
          }
        }

        tail = chunk.slice(Math.max(0, chunk.length - (FRAME_BOUNDARY.length - 1)));
      }
    } catch (err: any) {
      console.log('[stream] error name=', err?.name, 'msg=', err?.message);
      if (cancelledRef.current || err?.name === 'AbortError') return;
      if (attempt < MAX_ATTEMPTS) {
        const retryDelay = attempt === 1 ? 500 : 2000;
        setTimeout(() => startFetchStream(url, attempt + 1), retryDelay);
      } else {
        setStreamError(`Could not connect after ${MAX_ATTEMPTS} attempts: ${err?.message ?? 'unknown error'}`);
        setConnectStatus('Failed');
      }
    }
  }

  // ── Mock flow ────────────────────────────────────────────────────────────
  async function mockFlow() {
    await delay(2000);
    if (cancelledRef.current) return;
    safeSetPhase('ble_connected');
    await delay(400);
    if (cancelledRef.current) return;
    // Always show WiFi setup so user can enter credentials
    safeSetPhase('wifi_setup');
  }

  async function mockProvision(ssid: string, password: string) {
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

  // ── Real BLE flow ────────────────────────────────────────────────────────
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
              console.log('[BLE] Raw value:', char.value, '→ decoded IP:', ip);
              if (ip) { clearTimeout(timeout); sub.remove(); resolve(ip); }
            }
          }
        );

        device
          .writeCharacteristicWithoutResponseForService(SERVICE_UUID, SSID_UUID, strToBase64(ssid))
          .then(() => delay(200))
          .then(() => {
            console.log('[BLE] Sending SSID:', ssid, 'Password length:', password.length);
            return device.writeCharacteristicWithoutResponseForService(
              SERVICE_UUID, PASS_UUID, strToBase64(password)
            );
          })
          .catch((err: any) => { clearTimeout(timeout); sub.remove(); reject(err); });
      });

      console.log('[BLE] Got IP:', ip);

      if (cancelledRef.current) return;
      safeSetPhase('connecting');
      streamStartRef.current = Date.now();
      const url = `http://${ip}/stream`;
      setStreamUrl(url);
      console.log('[stream] Stream URL set to:', url);
      // MjpegViewer (WebView) handles display and frame counting — no fetch stream needed.
      safeSetPhase('streaming');
    } catch (err: any) {
      if (!cancelledRef.current) {
        setErrorMessage(err?.message ?? 'Provisioning failed');
        safeSetPhase('error');
      }
    }
  }

  // ── WebView mode ─────────────────────────────────────────────────────────
  const enableWebView = useCallback(() => {
    stopStream();
    useWebViewRef.current = true;
    setUseWebViewMode(true);
    setWebViewStatus('WebView mounting…');
  }, []);

  const handleWebViewFrame = useCallback((brightness: number) => {
    frameCountRef.current += 1;
    setFrameCount(frameCountRef.current);
    if (recordingActiveRef.current) {
      brightnessRef.current.push({
        t: Date.now() - recordingStartTimeRef.current,
        b: brightness,
      });
    }
  }, []);

  const handleWebViewStatus = useCallback((msg: string) => {
    setWebViewStatus(msg);
  }, []);

  // ── Public API ───────────────────────────────────────────────────────────
  const start = useCallback(async () => {
    cancelledRef.current = false;
    useWebViewRef.current = false;
    stopStream();
    setStreamUrl(null);
    setFrameCount(0);
    frameCountRef.current = 0;
    setBytesReceived(0);
    bytesRef.current = 0;
    setUseWebViewMode(false);
    setWebViewStatus(null);
    setErrorMessage('');
    setStreamError(null);
    setConnectStatus(null);
    setBleMode(false);
    safeSetPhase('scanning');

    // Clear any previously saved credentials so the WiFi form always appears
    try { await AsyncStorage.removeItem(WIFI_KEY); } catch {}

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

    // Always show WiFi setup so user can enter fresh credentials
    safeSetPhase('wifi_setup');
  }, []);

  const submitWifiCredentials = useCallback(async (ssid: string, password: string) => {
    // Save credentials for reference but we clear them on each start
    try { await AsyncStorage.setItem(WIFI_KEY, JSON.stringify({ ssid, password })); } catch {}
    console.log('[WiFi] Submitting — SSID:', ssid, 'Password length:', password.length);
    if (deviceRef.current) {
      await bleProvision(ssid, password);
    } else {
      await mockProvision(ssid, password);
    }
  }, []);

  const stop = useCallback(() => {
    stopStream();
    deviceRef.current?.cancelConnection().catch(() => {});
    deviceRef.current = null;
    safeSetPhase('complete');
  }, []);

  const reset = useCallback(() => {
    cancelledRef.current = true;
    useWebViewRef.current = false;
    recordingActiveRef.current = false;
    brightnessRef.current = [];
    stopStream();
    getBle()?.stopDeviceScan();
    deviceRef.current?.cancelConnection().catch(() => {});
    deviceRef.current = null;
    setPhase('idle');
    setStreamUrl(null);
    setFrameCount(0);
    frameCountRef.current = 0;
    setBytesReceived(0);
    bytesRef.current = 0;
    setUseWebViewMode(false);
    setWebViewStatus(null);
    setErrorMessage('');
    setStreamError(null);
    setConnectStatus(null);
    setBleMode(false);
  }, []);

  // ── Recording session ────────────────────────────────────────────────────
  const [recordingState, setRecordingState] = useState<'idle' | 'active' | 'done'>('idle');
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [recordingFetching, setRecordingFetching] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordingResult, setRecordingResult] = useState<{
    curve: 0 | 1 | 2 | 3;
    durationMs: number;
    framesCapured: number;
    durationActualMs: number;
    brightnessData: { t: number; b: number }[];
  } | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartFrameRef = useRef(0);
  const recordingStartTimeRef = useRef(0);
  const recordingActiveRef = useRef(false);
  const brightnessRef = useRef<{ t: number; b: number }[]>([]);

  const startRecording = useCallback(async (params: {
    curve: 0 | 1 | 2 | 3;
    duration: number;
    r?: number; g?: number; b?: number;
    step?: number;
    displayUrl?: string | null;  // caller passes the URL actually being displayed
  }) => {
    setRecordingError(null);

    // Prefer the caller's displayUrl (handles manual IP override), fall back to hook streamUrl
    const base = (params.displayUrl ?? streamUrl ?? '')
      .replace('/stream', '')
      .replace(/\/$/, '');
    if (!base) {
      setRecordingError('No device URL — connect to the device first');
      return;
    }

    const { curve, duration, r = 255, g = 255, b = 255, step = 10 } = params;
    const url = `${base}/record?curve=${curve}&r=${r}&g=${g}&b=${b}&duration=${duration}&step=${step}`;

    setRecordingFetching(true);
    try {
      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
      let res: Response;
      try {
        res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
      } catch (err: any) {
        clearTimeout(timeout);
        if (timedOut) throw new Error(`No response from device after 15 s — is it reachable at ${base}?`);
        throw err;
      }
      if (!res.ok) {
        setRecordingError(`Device returned HTTP ${res.status}`);
        setRecordingFetching(false);
        return;
      }
    } catch (err: any) {
      setRecordingError(err?.message ?? 'Network error — check device IP');
      setRecordingFetching(false);
      return;
    }
    setRecordingFetching(false);

    recordingStartFrameRef.current = frameCountRef.current;
    recordingStartTimeRef.current = Date.now();
    brightnessRef.current = [];
    recordingActiveRef.current = true;
    setRecordingState('active');
    setRecordingProgress(0);
    setRecordingResult(null);

    const start = recordingStartTimeRef.current;
    recordingTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      setRecordingProgress(progress);
      if (progress >= 1) {
        clearInterval(recordingTimerRef.current!);
        recordingTimerRef.current = null;
        recordingActiveRef.current = false;

        const framesCapured = frameCountRef.current - recordingStartFrameRef.current;
        const durationActualMs = Date.now() - start;

        // Fetch device-measured brightness data (raw pixels, accurate timestamps).
        const resultBase = (params.displayUrl ?? streamUrl ?? '')
          .replace('/stream', '').replace(/\/$/, '');

        if (resultBase) {
          fetch(`${resultBase}/record_result`)
            .then((r) => r.json())
            .then((json: { active: boolean; count: number; samples: string }) => {
              let brightnessData: { t: number; b: number }[] = [];
              if (!json.active && json.count > 0 && json.samples) {
                brightnessData = json.samples.split(';').map((s) => {
                  const [t, b] = s.split(',').map(Number);
                  return { t, b };
                });
              }
              setRecordingResult({ curve, durationMs: duration, framesCapured, durationActualMs, brightnessData });
              saveRecordingRun({ id: Date.now().toString(), timestamp: Date.now(), curve, durationMs: duration, framesCapured, brightnessData });
              setRecordingState('done');
            })
            .catch(() => {
              setRecordingResult({ curve, durationMs: duration, framesCapured, durationActualMs, brightnessData: [] });
              saveRecordingRun({ id: Date.now().toString(), timestamp: Date.now(), curve, durationMs: duration, framesCapured, brightnessData: [] });
              setRecordingState('done');
            });
        } else {
          setRecordingResult({ curve, durationMs: duration, framesCapured, durationActualMs, brightnessData: [] });
          saveRecordingRun({ id: Date.now().toString(), timestamp: Date.now(), curve, durationMs: duration, framesCapured, brightnessData: [] });
          setRecordingState('done');
        }
      }
    }, 100);
  }, [streamUrl]);

  const resetRecording = useCallback(() => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    recordingTimerRef.current = null;
    recordingActiveRef.current = false;
    brightnessRef.current = [];
    setRecordingState('idle');
    setRecordingProgress(0);
    setRecordingResult(null);
    setRecordingError(null);
    setRecordingFetching(false);
  }, []);

  const fps = frameCount > 0
    ? (frameCount / Math.max(1, (Date.now() - streamStartRef.current) / 1000)).toFixed(1)
    : '0.0';

  return {
    phase, streamUrl, frameCount, fps,
    errorMessage, streamError, connectStatus, bleMode,
    bytesReceived, setBytesReceived, useWebViewMode, webViewStatus,
    recordingState, recordingProgress, recordingFetching, recordingError, recordingResult,
    start, stop, reset, submitWifiCredentials,
    enableWebView, handleWebViewFrame, handleWebViewStatus,
    startRecording, resetRecording,
  };
}