# Point-of-Care-Diagnostic-Device

#CameraBLE

# ESP32-P4-NANO BLE Camera Streaming

BLE camera streaming project for the **ESP32-P4-NANO**.  
Captures frames from an **OV5647 MIPI CSI-2 camera**, JPEG-encodes them using the ESP32-P4 hardware encoder, and streams them over BLE to a Mac (or any BLE central) using **NimBLE** via the onboard **ESP32-C6** co-processor.

---

# Features

- OV5647 MIPI CSI-2 camera support
- RAW8 → RGB565 ISP processing
- Hardware JPEG encoding on ESP32-P4
- BLE streaming using NimBLE notifications
- SDIO communication between ESP32-P4 and ESP32-C6
- PSRAM-backed frame buffers
- macOS Python receiver example included

---

# Hardware

| Component | Details |
|---|---|
| SoC | ESP32-P4-NANO |
| BLE co-processor | ESP32-C6 (SDIO-connected via esp_hosted) |
| Camera | OV5647 — MIPI CSI-2, RAW8, 800×640 @ 50 fps |
| Camera I2C | SDA = GPIO7, SCL = GPIO8 |
| MIPI LDO | Channel 3, 2500 mV |
| SDIO (P4 ↔ C6) | CMD = 14, CLK = 15, D0-D3 = 16-19, RST = 54 |

---

# Software Stack

- ESP-IDF v5.5.2 (pinned as git submodule)
- NimBLE with ATT MTU 512
- Hardware JPEG encoder (ESP32-P4 built-in)

## IDF Component Manager Dependencies

Defined in `main/idf_component.yml`:

- `espressif/esp_cam_sensor >= 0.7`
- `espressif/esp_hosted ~2`
- `espressif/esp_wifi_remote >= 0.10`

---

# Camera Pipeline

```text
OV5647 MIPI CSI-2 RAW8
    ↓
ESP32-P4 CSI bridge
    ↓
ISP (RAW8 → RGB565)
    ↓
DW-GDMA → PSRAM frame buffer
    ↓
Hardware JPEG encoder (quality 95)
    ↓
NimBLE notifications
```

---

# BLE Packet Format

Each BLE notification contains a 6-byte header followed by JPEG payload data.

## Chunk Header

```text
[frame_id : u16][chunk_idx : u16][total_chunks : u16][JPEG payload...]
```

## Fields

| Field | Size | Description |
|---|---|---|
| frame_id | 2 B LE | Wraps at 0xFFFF |
| chunk_idx | 2 B LE | 0-based chunk index |
| total_chunks | 2 B LE | Total chunks in frame |
| payload | variable | JPEG bytes |

---

# Getting Started

## 1. Clone the Repository

```bash
git clone --recursive https://github.com/StefVuck/cam_ble.git
cd cam_ble
```

If already cloned:

```bash
git submodule update --init --recursive
```

---

## 2. Set Up ESP-IDF

```bash
cd esp-idf
./install.sh esp32p4
source export.sh
cd ..
```

---

## 3. Fetch Dependencies

```bash
idf.py update-dependencies
```

---

## 4. Build and Flash

```bash
idf.py -p /dev/cu.usbserial-XXXX flash monitor
```

---

## 5. Receive Frames on macOS

```bash
python3 -m venv venv && source venv/bin/activate
pip install bleak pillow requests
python3 receive_frames.py --ssid "network name" --password "network password"
```

---

# Project Structure

```text
.
├── main/
├── esp-idf/
├── receive_frames.py
├── sdkconfig.defaults
├── CMakeLists.txt
└── README.md
```

---

# Notes

- Designed for high-throughput BLE image streaming experiments
- Uses ESP32-P4 hardware JPEG acceleration
- Optimized for PSRAM buffering and chunked transmission
- Tested with macOS BLE central (Python + Bleak)

---

# License

Add your license here.
