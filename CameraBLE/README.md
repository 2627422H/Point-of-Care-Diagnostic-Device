# cam_ble

ESP32-P4-NANO BLE camera streaming project.
Captures frames from an OV5647 MIPI CSI-2 camera, JPEG-encodes them in hardware, and streams them over BLE to a Mac (or any BLE central) using NimBLE via the on-board ESP32-C6 co-processor.

## Hardware

| Component | Details |
|---|---|
| SoC | ESP32-P4-NANO |
| BLE co-processor | ESP32-C6 (SDIO-connected, via `esp_hosted`) |
| Camera | OV5647 — MIPI CSI-2, RAW8, 800×640 @ 50 fps |
| Camera I2C | SDA=GPIO7, SCL=GPIO8 |
| MIPI LDO | Channel 3, 2500 mV |
| SDIO (P4↔C6) | CMD=14, CLK=15, D0-D3=16-19, RST=54 |

## Software stack

- ESP-IDF **v5.5.2** (pinned as git submodule)
- IDF Component Manager dependencies (see `main/idf_component.yml`):
  - `espressif/esp_cam_sensor` ≥ 0.7
  - `espressif/esp_hosted` ~2
  - `espressif/esp_wifi_remote` ≥ 0.10
- NimBLE with ATT MTU 512
- Hardware JPEG encoder (ESP32-P4 built-in)

## Pipeline

```
OV5647 MIPI CSI-2 RAW8
  → ESP32-P4 CSI bridge
  → ISP (demosaic RAW8 → RGB565)
  → DW-GDMA → PSRAM frame buffer
  → HW JPEG encoder (quality 95)
  → NimBLE notifications (6-byte header + JPEG chunks)
```

BLE chunk header (little-endian):

```
[frame_id : u16][chunk_idx : u16][total_chunks : u16][JPEG payload...]
```

## Getting started

### 1. Clone (with esp-idf submodule)

```bash
git clone --recursive https://github.com/StefVuck/cam_ble.git
cd cam_ble
```

If you already cloned without `--recursive`:

```bash
git submodule update --init --recursive
```

### 2. Set up the IDF environment

```bash
cd esp-idf
./install.sh esp32p4
source export.sh
cd ..
```

### 3. Fetch managed components

```bash
idf.py update-dependencies
```

### 4. Build and flash

```bash
idf.py -p /dev/cu.usbserial-XXXX flash monitor
```

### 5. Receive frames on macOS

```bash
python3 -m venv venv && source venv/bin/activate
pip install bleak pillow
python receive_frames.py
```

## BLE protocol

| Field | Size | Description |
|---|---|---|
| `frame_id` | 2 B LE | Wraps at 0xFFFF |
| `chunk_idx` | 2 B LE | 0-based chunk index |
| `total_chunks` | 2 B LE | Total chunks in this frame |
| payload | variable | JPEG bytes for this chunk |

Reassemble all chunks with the same `frame_id` in order to recover the JPEG.
