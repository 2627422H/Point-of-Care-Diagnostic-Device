# POC Health — Claude Guide

## What this app is
A React Native (Expo) app for a women's health Point-of-Care (POC) device that measures **estrogen levels** via a saliva cartridge. The app pairs to the device over **Bluetooth Low Energy (BLE)**, runs a test, and displays:
- Current estrogen level (pg/ml) and days since last test
- Symptom forecast (cramping, bloating, fatigue, mood) derived from the reading
- 30-day estrogen cycle chart

## Project structure
```
poc-health/
├── app/
│   ├── _layout.tsx          # Root layout (expo-router)
│   └── (tabs)/
│       ├── _layout.tsx      # Tab bar (Results / New Test / Profile)
│       ├── index.tsx        # Results dashboard
│       ├── new-test.tsx     # BLE connect + run test
│       └── profile.tsx      # User info and stats
├── components/
│   ├── ConnectionBadge.tsx  # Connected/disconnected indicator
│   ├── EstrogenChart.tsx    # 30-day line chart (react-native-chart-kit)
│   └── SymptomRow.tsx       # Symptom name + progress bar + severity label
├── constants/theme.ts       # Colors, spacing, radii, font sizes
├── hooks/useBluetooth.ts    # BLE scan / connect / test lifecycle
├── store/useAppStore.ts     # Simple in-memory reactive store + seed data
└── types/index.ts           # Shared TypeScript types
```

## Running the app

### Expo Go (mock BLE — default)
`hooks/useBluetooth.ts` is a mock that simulates scanning → connecting → testing with
realistic delays. No native modules. Safe for Expo Go:

```bash
npx expo start
```

### Dev build (real BLE)
When you have the physical device, swap in the real hook:

```bash
cp hooks/useBluetooth.ble.ts hooks/useBluetooth.ts
npx expo install expo-dev-client
npx expo run:ios          # or run:android
```

The real implementation lives in `hooks/useBluetooth.ble.ts`.

## BLE integration — what needs updating
All BLE specifics live in `hooks/useBluetooth.ts`. When you have the real device spec, update:

| Constant | Purpose |
|---|---|
| `POC_DEVICE_NAME_PREFIX` | Prefix of the BLE device name to scan for |
| `POC_SERVICE_UUID` | GATT service UUID for test results |
| `POC_CHARACTERISTIC_UUID` | GATT characteristic UUID to write commands / read results |
| `parseTestResult()` | Decode the raw BLE packet into `{ estrogen, cycleDay }` |
| `deriveSymptoms()` | Map estrogen level → symptom severity (replace with real algorithm) |

The battery level is currently hardcoded to 78. Read from the **Battery Service** (UUID `0x180F`, characteristic `0x2A19`) on the device.

## State management
`store/useAppStore.ts` is a minimal hand-rolled reactive store. If the app grows, replace it with **Zustand** — the interface shape (`results`, `device`, `connectionState`, `testStatus` + setters) should stay the same so consumers don't change.

## Design tokens
All colours, spacing, and typography live in `constants/theme.ts`. The brand palette is a warm salmon-red (`#C85450`) on a cream background (`#FFF7F5`), matching the Figma POC.

## Permissions
- **iOS**: `NSBluetoothAlwaysUsageDescription` is set in `app.json`.  
- **Android**: `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, and `ACCESS_FINE_LOCATION` are declared in `app.json` and requested at runtime in `hooks/useBluetooth.ts`.

## Adding test results manually (dev)
Edit the `SEED_HISTORY` array in `store/useAppStore.ts` to add synthetic past results without a physical device.
