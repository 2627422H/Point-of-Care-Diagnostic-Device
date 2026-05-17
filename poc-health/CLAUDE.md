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
│   ├── _layout.tsx          # Root layout — auth gate + AppState listener
│   ├── lock.tsx             # Biometric / PIN lock screen
│   └── (tabs)/
│       ├── _layout.tsx      # Tab bar (Results / New Test / History / Profile / Help)
│       ├── index.tsx        # Results dashboard
│       ├── new-test.tsx     # BLE connect + run test
│       ├── history.tsx      # Test history list + trend chart
│       ├── profile.tsx      # User info and stats (persisted)
│       └── help.tsx         # In-app FAQ and user guide
├── components/
│   ├── ConnectionBadge.tsx  # Connected/disconnected indicator
│   ├── EstrogenChart.tsx    # 30-day line chart (react-native-chart-kit)
│   └── SymptomRow.tsx       # Symptom name + progress bar + severity label
├── constants/theme.ts       # Colors, spacing, radii, font sizes
├── hooks/useBluetooth.ts    # BLE scan / connect / test lifecycle (mock default)
├── hooks/useBluetooth.ble.ts # Real BLE implementation (swap in for dev builds)
├── store/useAppStore.ts     # Reactive store with AsyncStorage persistence
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

## BLE integration — finalised constants

All BLE specifics live in `hooks/useBluetooth.ble.ts`. The following constants are set to match the firmware in `CameraBLE/main/ble_server.c`:

| Constant | Value | Purpose |
|---|---|---|
| `POC_DEVICE_NAME_PREFIX` | `'ESP32-CAM'` | BLE advertisement name prefix to scan for |
| `POC_SERVICE_UUID` | `fb349b5f-...-000000000010` | GATT service |
| `POC_CMD_CHARACTERISTIC_UUID` | `fb349b5f-...-000000000015` | Write: start command |
| `POC_RESULT_CHARACTERISTIC_UUID` | `fb349b5f-...-000000000014` | Notify: test result |
| `BATTERY_SERVICE_UUID` | `0000180f-...` | Standard BLE Battery Service |
| `BATTERY_LEVEL_UUID` | `00002a19-...` | Battery level (0–100) |

**Firmware TODO**: Add characteristics `0014` (notify) and `0015` (write) to `ble_server.c`. When a start command arrives, run the optical measurement, then notify `0014` with base64-encoded JSON: `{"estrogen":320.5,"cycleDay":14,"battery":82}`.

Still needs replacing: `deriveSymptoms()` — currently a heuristic threshold model; replace with a validated clinical algorithm.

## State management
`store/useAppStore.ts` is a minimal hand-rolled reactive store backed by `@react-native-async-storage/async-storage`. All test results and profile data are persisted automatically — no extra calls needed in components. If the app grows, replace it with **Zustand** — the interface shape (`results`, `device`, `connectionState`, `testStatus`, `name`, `cycleLength` + setters) should stay the same so consumers don't change.

## Design tokens
All colours, spacing, and typography live in `constants/theme.ts`. The brand palette is a warm salmon-red (`#C85450`) on a cream background (`#FFF7F5`), matching the Figma POC.

## Permissions
- **iOS**: `NSBluetoothAlwaysUsageDescription` is set in `app.json`.  
- **Android**: `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, and `ACCESS_FINE_LOCATION` are declared in `app.json` and requested at runtime in `hooks/useBluetooth.ts`.

## Adding test results manually (dev)
Edit the `SEED_HISTORY` array in `store/useAppStore.ts` to add synthetic past results without a physical device.
