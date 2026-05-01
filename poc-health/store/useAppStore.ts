import { useState, useCallback } from 'react';
import type { TestResult, DeviceInfo, ConnectionState, TestStatus } from '../types';

// Seed data mirroring the POC design (30-day cycle, estrogen peaks around D17)
const SEED_HISTORY: TestResult[] = [
  {
    id: '1',
    timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000,
    estrogenLevel: 400,
    cycleDay: 17,
    symptoms: [
      { id: 's1', name: 'Cramping', icon: '🔴', severity: 'Mild', value: 0.25 },
      { id: 's2', name: 'Bloating', icon: '💧', severity: 'Moderate', value: 0.55 },
      { id: 's3', name: 'Fatigue', icon: '⚡', severity: 'Moderate', value: 0.5 },
      { id: 's4', name: 'Mood changes', icon: '☀️', severity: 'Mild', value: 0.2 },
    ],
  },
];

// Estrogen curve approximation over 30 days (pg/ml)
export const CYCLE_CURVE: { day: string; value: number }[] = [
  { day: 'D1', value: 60 },
  { day: 'D5', value: 120 },
  { day: 'D8', value: 220 },
  { day: 'D10', value: 310 },
  { day: 'D12', value: 420 },
  { day: 'D14', value: 480 },
  { day: 'D17', value: 530 },
  { day: 'D20', value: 410 },
  { day: 'D24', value: 280 },
  { day: 'D27', value: 160 },
  { day: 'D30', value: 80 },
];

interface AppState {
  results: TestResult[];
  device: DeviceInfo | null;
  connectionState: ConnectionState;
  testStatus: TestStatus;
  addResult: (r: TestResult) => void;
  setDevice: (d: DeviceInfo | null) => void;
  setConnectionState: (s: ConnectionState) => void;
  setTestStatus: (s: TestStatus) => void;
}

// Simple in-memory store — replace with Zustand/context if the app grows
let _results: TestResult[] = SEED_HISTORY;
let _device: DeviceInfo | null = null;
let _connectionState: ConnectionState = 'disconnected';
let _testStatus: TestStatus = 'idle';
const _listeners = new Set<() => void>();

function notify() {
  _listeners.forEach((fn) => fn());
}

export function useAppStore(): AppState {
  const [, rerender] = useState(0);

  const subscribe = useCallback(() => {
    const fn = () => rerender((n) => n + 1);
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  }, []);

  // Subscribe on mount
  useState(() => {
    const unsub = subscribe();
    return unsub;
  });

  return {
    results: _results,
    device: _device,
    connectionState: _connectionState,
    testStatus: _testStatus,
    addResult: (r) => { _results = [r, ..._results]; notify(); },
    setDevice: (d) => { _device = d; notify(); },
    setConnectionState: (s) => { _connectionState = s; notify(); },
    setTestStatus: (s) => { _testStatus = s; notify(); },
  };
}
