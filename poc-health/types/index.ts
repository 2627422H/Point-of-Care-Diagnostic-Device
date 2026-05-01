export type ConnectionState = 'connected' | 'disconnected' | 'scanning' | 'connecting';

export type Severity = 'None' | 'Mild' | 'Moderate' | 'High';

export interface Symptom {
  id: string;
  name: string;
  icon: string;
  severity: Severity;
  value: number; // 0–1
}

export interface TestResult {
  id: string;
  timestamp: number; // Unix ms
  estrogenLevel: number; // pg/ml
  cycleDay: number; // D1–D30
  symptoms: Symptom[];
}

export interface DeviceInfo {
  id: string;
  name: string;
  batteryPercent: number;
  firmwareVersion?: string;
}

export type TestStatus = 'idle' | 'ready' | 'running' | 'complete' | 'error';
