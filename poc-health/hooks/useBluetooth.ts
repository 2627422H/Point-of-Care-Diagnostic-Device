// Mock BLE hook — safe for Expo Go. No native modules are imported.
// To switch to the real BLE implementation, replace this file with useBluetooth.ble.ts.

import { useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { TestResult } from '../types';

function mockDelay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function mockTestResult(): TestResult {
  const estrogen = Math.round(200 + Math.random() * 350);
  const cycleDay = Math.round(1 + Math.random() * 29);
  const isHigh = estrogen > 350;
  const isMid = estrogen > 200;
  return {
    id: Date.now().toString(),
    timestamp: Date.now(),
    estrogenLevel: estrogen,
    cycleDay,
    symptoms: [
      { id: 's1', name: 'Cramping', icon: '🔴', severity: isHigh ? 'Moderate' : 'Mild', value: isHigh ? 0.45 : 0.25 },
      { id: 's2', name: 'Bloating', icon: '💧', severity: isHigh ? 'High' : isMid ? 'Moderate' : 'Mild', value: isHigh ? 0.75 : isMid ? 0.55 : 0.2 },
      { id: 's3', name: 'Fatigue', icon: '⚡', severity: isMid ? 'Moderate' : 'Mild', value: isMid ? 0.5 : 0.2 },
      { id: 's4', name: 'Mood changes', icon: '☀️', severity: isHigh ? 'Moderate' : 'Mild', value: isHigh ? 0.4 : 0.2 },
    ],
  };
}

export function useBluetooth() {
  const { setConnectionState, setDevice, setTestStatus, addResult } = useAppStore();

  const scan = useCallback(async () => {
    setConnectionState('scanning');
    await mockDelay(2000);

    setConnectionState('connecting');
    await mockDelay(1200);

    setDevice({ id: 'mock-device', name: 'POC_DEMO', batteryPercent: 78 });
    setConnectionState('connected');
    setTestStatus('ready');
  }, [setConnectionState, setDevice, setTestStatus]);

  const disconnect = useCallback(async () => {
    setDevice(null);
    setConnectionState('disconnected');
    setTestStatus('idle');
  }, [setDevice, setConnectionState, setTestStatus]);

  const startTest = useCallback(async () => {
    setTestStatus('running');
    await mockDelay(3500);
    const result = mockTestResult();
    addResult(result);
    setTestStatus('complete');
  }, [setTestStatus, addResult]);

  return { scan, disconnect, startTest };
}
