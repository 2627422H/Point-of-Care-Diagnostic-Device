import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface RecordingRun {
  id: string;
  timestamp: number;
  curve: 0 | 1 | 2 | 3;
  durationMs: number;
  framesCapured: number;
  brightnessData: { t: number; b: number }[];
}

export const CURVE_LABELS: Record<0 | 1 | 2 | 3, string> = {
  0: 'Linear',
  1: 'Exponential',
  2: 'Logarithmic',
  3: 'Sigmoid',
};

const KEY = 'poc_recording_runs';
const MAX_RUNS = 50;

let _runs: RecordingRun[] = [];
let _loaded = false;
const _listeners = new Set<() => void>();

function notify() { _listeners.forEach((fn) => fn()); }

async function load() {
  if (_loaded) return;
  _loaded = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) _runs = JSON.parse(raw);
  } catch {}
  notify();
}

export async function saveRecordingRun(run: RecordingRun): Promise<void> {
  _runs = [run, ..._runs].slice(0, MAX_RUNS);
  notify();
  try { await AsyncStorage.setItem(KEY, JSON.stringify(_runs)); } catch {}
}

export async function deleteRecordingRun(id: string): Promise<void> {
  _runs = _runs.filter((r) => r.id !== id);
  notify();
  try { await AsyncStorage.setItem(KEY, JSON.stringify(_runs)); } catch {}
}

export function useRecordingStore() {
  const [, rerender] = useState(0);
  useEffect(() => {
    const fn = () => rerender((n) => n + 1);
    _listeners.add(fn);
    load();
    return () => { _listeners.delete(fn); };
  }, []);
  return { runs: _runs };
}
