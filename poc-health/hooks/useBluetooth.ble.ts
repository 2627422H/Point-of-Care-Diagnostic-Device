import { useEffect, useRef, useCallback } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import { BleManager, Device, State } from 'react-native-ble-plx';
import { useAppStore } from '../store/useAppStore';
import type { DeviceInfo, TestResult, Symptom } from '../types';

// Update these to match your actual POC device's BLE profile
const POC_DEVICE_NAME_PREFIX = 'POC_';
const POC_SERVICE_UUID = '0000180d-0000-1000-8000-00805f9b34fb'; // placeholder: Heart Rate service
const POC_CHARACTERISTIC_UUID = '00002a37-0000-1000-8000-00805f9b34fb'; // placeholder

const manager = new BleManager();

async function requestAndroidPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Platform.Version >= 31) {
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ]);
    return Object.values(results).every((r) => r === PermissionsAndroid.RESULTS.GRANTED);
  }
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

function parseTestResult(value: string): Partial<TestResult> {
  // TODO: implement your device's actual packet format.
  // This stub decodes a JSON payload of the shape:
  // { "estrogen": 400, "cycleDay": 17, "battery": 78 }
  try {
    const decoded = atob(value);
    const data = JSON.parse(decoded) as {
      estrogen: number;
      cycleDay: number;
      battery: number;
    };
    return {
      estrogenLevel: data.estrogen,
      cycleDay: data.cycleDay,
    };
  } catch {
    return {};
  }
}

function deriveSymptoms(estrogenLevel: number): Symptom[] {
  // Heuristic symptom forecasting based on estrogen level.
  // Replace with a proper algorithm or server-side model.
  const isHigh = estrogenLevel > 350;
  const isMid = estrogenLevel > 200;
  return [
    {
      id: 's1',
      name: 'Cramping',
      icon: '🔴',
      severity: isHigh ? 'Moderate' : 'Mild',
      value: isHigh ? 0.45 : 0.25,
    },
    {
      id: 's2',
      name: 'Bloating',
      icon: '💧',
      severity: isHigh ? 'High' : isMid ? 'Moderate' : 'Mild',
      value: isHigh ? 0.75 : isMid ? 0.55 : 0.2,
    },
    {
      id: 's3',
      name: 'Fatigue',
      icon: '⚡',
      severity: isMid ? 'Moderate' : 'Mild',
      value: isMid ? 0.5 : 0.2,
    },
    {
      id: 's4',
      name: 'Mood changes',
      icon: '☀️',
      severity: isHigh ? 'Moderate' : 'Mild',
      value: isHigh ? 0.4 : 0.2,
    },
  ];
}

export function useBluetooth() {
  const { setConnectionState, setDevice, setTestStatus, addResult } = useAppStore();
  const connectedDevice = useRef<Device | null>(null);
  const _connectionStateRef = useRef<string>('disconnected');

  useEffect(() => {
    const sub = manager.onStateChange((state) => {
      if (state !== State.PoweredOn) {
        setConnectionState('disconnected');
      }
    }, true);
    return () => sub.remove();
  }, [setConnectionState]);

  const scan = useCallback(async () => {
    const granted = await requestAndroidPermissions();
    if (!granted) return;

    _connectionStateRef.current = 'scanning';
    setConnectionState('scanning');

    manager.startDeviceScan(null, null, async (error, device) => {
      if (error || !device) return;
      if (!device.name?.startsWith(POC_DEVICE_NAME_PREFIX)) return;

      manager.stopDeviceScan();
      setConnectionState('connecting');

      try {
        const connected = await device.connect();
        await connected.discoverAllServicesAndCharacteristics();
        connectedDevice.current = connected;

        const deviceInfo: DeviceInfo = {
          id: connected.id,
          name: connected.name ?? 'POC Device',
          batteryPercent: 78, // read from battery service characteristic if available
        };
        setDevice(deviceInfo);
        setConnectionState('connected');
        setTestStatus('ready');
      } catch {
        setConnectionState('disconnected');
      }
    });

    // Stop scanning after 15 seconds
    setTimeout(() => {
      manager.stopDeviceScan();
      if (_connectionStateRef.current === 'scanning') {
        setConnectionState('disconnected');
      }
    }, 15000);
  }, [setConnectionState, setDevice, setTestStatus]);

  const disconnect = useCallback(async () => {
    if (connectedDevice.current) {
      await connectedDevice.current.cancelConnection().catch(() => {});
      connectedDevice.current = null;
    }
    setDevice(null);
    setConnectionState('disconnected');
    setTestStatus('idle');
  }, [setDevice, setConnectionState, setTestStatus]);

  const startTest = useCallback(async () => {
    const device = connectedDevice.current;
    if (!device) return;

    setTestStatus('running');

    try {
      // Write a "start" command to the device (adjust UUID to your device spec)
      await device.writeCharacteristicWithResponseForService(
        POC_SERVICE_UUID,
        POC_CHARACTERISTIC_UUID,
        btoa(JSON.stringify({ command: 'start' })),
      );

      // Subscribe to notifications for the result
      device.monitorCharacteristicForService(
        POC_SERVICE_UUID,
        POC_CHARACTERISTIC_UUID,
        (error, characteristic) => {
          if (error || !characteristic?.value) {
            setTestStatus('error');
            return;
          }

          const partial = parseTestResult(characteristic.value);
          if (!partial.estrogenLevel) return;

          const result: TestResult = {
            id: Date.now().toString(),
            timestamp: Date.now(),
            estrogenLevel: partial.estrogenLevel,
            cycleDay: partial.cycleDay ?? 1,
            symptoms: deriveSymptoms(partial.estrogenLevel),
          };

          addResult(result);
          setTestStatus('complete');
        },
      );
    } catch {
      setTestStatus('error');
    }
  }, [setTestStatus, addResult]);

  return { scan, disconnect, startTest };
}
