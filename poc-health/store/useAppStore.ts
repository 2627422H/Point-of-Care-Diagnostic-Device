import { useState, useCallback } from 'react';
import type { TestResult, DeviceInfo, ConnectionState, TestStatus } from '../types';

const DAY = 24 * 60 * 60 * 1000;

// Seed data mirroring the POC design (30-day cycle, estrogen peaks around D14–D17)
const SEED_HISTORY: TestResult[] = [
  // ── Current cycle ──────────────────────────────────────────────────────
  {
    id: '1',
    timestamp: Date.now() - 2 * DAY,
    estrogenLevel: 465,
    cycleDay: 14,
    symptoms: [
      { id: 's1', name: 'Cramping', severity: 'Mild',     icon: 'pulse', value: 0.25 },
      { id: 's2', name: 'Bloating', severity: 'High',     icon: 'water', value: 0.75 },
      { id: 's3', name: 'Fatigue',  severity: 'Moderate', icon: 'flash', value: 0.5  },
      { id: 's4', name: 'Mood changes', severity: 'Moderate', icon: 'sunny', value: 0.4 },
    ],
  },
  {
    id: '2',
    timestamp: Date.now() - 7 * DAY,
    estrogenLevel: 310,
    cycleDay: 9,
    symptoms: [
      { id: 's1', name: 'Cramping', severity: 'Mild',     icon: 'pulse', value: 0.2  },
      { id: 's2', name: 'Bloating', severity: 'Moderate', icon: 'water', value: 0.55 },
      { id: 's3', name: 'Fatigue',  severity: 'Moderate', icon: 'flash', value: 0.5  },
      { id: 's4', name: 'Mood changes', severity: 'Mild', icon: 'sunny', value: 0.2  },
    ],
  },
  {
    id: '3',
    timestamp: Date.now() - 12 * DAY,
    estrogenLevel: 95,
    cycleDay: 4,
    symptoms: [
      { id: 's1', name: 'Cramping', severity: 'Mild', icon: 'pulse', value: 0.25 },
      { id: 's2', name: 'Bloating', severity: 'Mild', icon: 'water', value: 0.2  },
      { id: 's3', name: 'Fatigue',  severity: 'Mild', icon: 'flash', value: 0.2  },
      { id: 's4', name: 'Mood changes', severity: 'Mild', icon: 'sunny', value: 0.2 },
    ],
  },
  // ── Previous cycle ─────────────────────────────────────────────────────
  {
    id: '4',
    timestamp: Date.now() - 18 * DAY,
    estrogenLevel: 80,
    cycleDay: 28,
    symptoms: [
      { id: 's1', name: 'Cramping', severity: 'Mild', icon: 'pulse', value: 0.25 },
      { id: 's2', name: 'Bloating', severity: 'Mild', icon: 'water', value: 0.2  },
      { id: 's3', name: 'Fatigue',  severity: 'Mild', icon: 'flash', value: 0.2  },
      { id: 's4', name: 'Mood changes', severity: 'Mild', icon: 'sunny', value: 0.15 },
    ],
  },
  {
    id: '5',
    timestamp: Date.now() - 24 * DAY,
    estrogenLevel: 285,
    cycleDay: 22,
    symptoms: [
      { id: 's1', name: 'Cramping', severity: 'Mild',     icon: 'pulse', value: 0.25 },
      { id: 's2', name: 'Bloating', severity: 'Moderate', icon: 'water', value: 0.55 },
      { id: 's3', name: 'Fatigue',  severity: 'Moderate', icon: 'flash', value: 0.5  },
      { id: 's4', name: 'Mood changes', severity: 'Mild', icon: 'sunny', value: 0.2  },
    ],
  },
  {
    id: '6',
    timestamp: Date.now() - 31 * DAY,
    estrogenLevel: 520,
    cycleDay: 15,
    symptoms: [
      { id: 's1', name: 'Cramping', severity: 'Moderate', icon: 'pulse', value: 0.45 },
      { id: 's2', name: 'Bloating', severity: 'High',     icon: 'water', value: 0.75 },
      { id: 's3', name: 'Fatigue',  severity: 'Moderate', icon: 'flash', value: 0.5  },
      { id: 's4', name: 'Mood changes', severity: 'Moderate', icon: 'sunny', value: 0.4 },
    ],
  },
  {
    id: '7',
    timestamp: Date.now() - 37 * DAY,
    estrogenLevel: 210,
    cycleDay: 9,
    symptoms: [
      { id: 's1', name: 'Cramping', severity: 'Mild',     icon: 'pulse', value: 0.25 },
      { id: 's2', name: 'Bloating', severity: 'Moderate', icon: 'water', value: 0.55 },
      { id: 's3', name: 'Fatigue',  severity: 'Moderate', icon: 'flash', value: 0.5  },
      { id: 's4', name: 'Mood changes', severity: 'Mild', icon: 'sunny', value: 0.2  },
    ],
  },
  // ── Two cycles ago ─────────────────────────────────────────────────────
  {
    id: '8',
    timestamp: Date.now() - 50 * DAY,
    estrogenLevel: 75,
    cycleDay: 2,
    symptoms: [
      { id: 's1', name: 'Cramping', severity: 'Mild', icon: 'pulse', value: 0.25 },
      { id: 's2', name: 'Bloating', severity: 'Mild', icon: 'water', value: 0.2  },
      { id: 's3', name: 'Fatigue',  severity: 'Mild', icon: 'flash', value: 0.2  },
      { id: 's4', name: 'Mood changes', severity: 'Mild', icon: 'sunny', value: 0.15 },
    ],
  },
  {
    id: '9',
    timestamp: Date.now() - 57 * DAY,
    estrogenLevel: 490,
    cycleDay: 16,
    symptoms: [
      { id: 's1', name: 'Cramping', severity: 'Moderate', icon: 'pulse', value: 0.45 },
      { id: 's2', name: 'Bloating', severity: 'High',     icon: 'water', value: 0.75 },
      { id: 's3', name: 'Fatigue',  severity: 'Moderate', icon: 'flash', value: 0.5  },
      { id: 's4', name: 'Mood changes', severity: 'Moderate', icon: 'sunny', value: 0.4 },
    ],
  },
  {
    id: '10',
    timestamp: Date.now() - 63 * DAY,
    estrogenLevel: 340,
    cycleDay: 10,
    symptoms: [
      { id: 's1', name: 'Cramping', severity: 'Mild',     icon: 'pulse', value: 0.25 },
      { id: 's2', name: 'Bloating', severity: 'Moderate', icon: 'water', value: 0.55 },
      { id: 's3', name: 'Fatigue',  severity: 'Moderate', icon: 'flash', value: 0.5  },
      { id: 's4', name: 'Mood changes', severity: 'Mild', icon: 'sunny', value: 0.2  },
    ],
  },
  {
    id: '11',
    timestamp: Date.now() - 72 * DAY,
    estrogenLevel: 115,
    cycleDay: 27,
    symptoms: [
      { id: 's1', name: 'Cramping', severity: 'Mild', icon: 'pulse', value: 0.25 },
      { id: 's2', name: 'Bloating', severity: 'Mild', icon: 'water', value: 0.2  },
      { id: 's3', name: 'Fatigue',  severity: 'Mild', icon: 'flash', value: 0.2  },
      { id: 's4', name: 'Mood changes', severity: 'Mild', icon: 'sunny', value: 0.15 },
    ],
  },
  {
    id: '12',
    timestamp: Date.now() - 79 * DAY,
    estrogenLevel: 430,
    cycleDay: 13,
    symptoms: [
      { id: 's1', name: 'Cramping', severity: 'Moderate', icon: 'pulse', value: 0.45 },
      { id: 's2', name: 'Bloating', severity: 'High',     icon: 'water', value: 0.75 },
      { id: 's3', name: 'Fatigue',  severity: 'Moderate', icon: 'flash', value: 0.5  },
      { id: 's4', name: 'Mood changes', severity: 'Moderate', icon: 'sunny', value: 0.4 },
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
