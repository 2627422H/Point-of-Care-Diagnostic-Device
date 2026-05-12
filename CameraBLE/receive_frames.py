#!/usr/bin/env python3
"""
receive_frames.py – Receive and save JPEG frames from the ESP32-CAM WiFi stream.

Flow:
  1. Scan for ESP32-CAM over BLE
  2. Send WiFi credentials to the ESP32
  3. Wait for the ESP32 to connect to WiFi and send back its IP
  4. Connect to the MJPEG HTTP stream and save each frame as a JPEG file

Requirements:
    pip install bleak pillow requests

Usage:
    python receive_frames.py --ssid "MyNetwork" --password "MyPassword"
    python receive_frames.py --ssid "MyNetwork" --password "MyPassword" --show
    python receive_frames.py --ssid "MyNetwork" --password "MyPassword" --save-dir ./frames
"""

import argparse
import asyncio
import io
import os
import time
from pathlib import Path
import time

import requests
from bleak import BleakClient, BleakScanner

# ── BLE UUIDs (must match ble_server.c) ─────────────────────────────────────
DEVICE_NAME = "ESP32-CAM"
SSID_UUID   = "fb349b5f-8000-0080-0010-000000000011"
PASS_UUID   = "fb349b5f-8000-0080-0010-000000000012"
IP_UUID     = "fb349b5f-8000-0080-0010-000000000013"

# MJPEG boundary set in wifi_stream.c
MJPEG_BOUNDARY = b"--frame"


# ── Phase 1: BLE provisioning ────────────────────────────────────────────────

async def get_ip_over_ble(ssid: str, password: str) -> str:
    """Connect to ESP32 over BLE, send WiFi credentials, return the IP."""
    print(f"Scanning for '{DEVICE_NAME}'...")
    device = await BleakScanner.find_device_by_name(DEVICE_NAME, timeout=15.0)
    if device is None:
        raise RuntimeError(
            f"Could not find '{DEVICE_NAME}'. "
            "Make sure the ESP32 is powered and advertising."
        )
    print(f"Found: {device.name}  [{device.address}]")

    ip_received = asyncio.Event()
    ip_address  = {"value": None}

    def ip_notification_handler(sender, data: bytearray):
        ip_str = data.decode("utf-8").strip("\x00")
        print(f"ESP32 IP address: {ip_str}")
        ip_address["value"] = ip_str
        ip_received.set()

    print(f"Connecting to {device.address}...")
    async with BleakClient(device, timeout=20.0) as client:
        print(f"Connected (MTU={client.mtu_size})")

        # Subscribe to IP notifications before sending credentials.
        await client.start_notify(IP_UUID, ip_notification_handler)

        print(f"Sending SSID: {ssid}")
        await client.write_gatt_char(SSID_UUID, ssid.encode("utf-8"), response=False)
        await asyncio.sleep(0.2)

        print("Sending password...")
        await client.write_gatt_char(PASS_UUID, password.encode("utf-8"), response=False)
        print("Credentials sent. Waiting for ESP32 to connect to WiFi...")

        try:
            await asyncio.wait_for(ip_received.wait(), timeout=30.0)
        except asyncio.TimeoutError:
            raise RuntimeError(
                "Timed out waiting for IP. Check the ESP32 serial output for WiFi errors."
            )

        await client.stop_notify(IP_UUID)

    return ip_address["value"]


def receive_frames(ip: str, save_dir, show: bool):
    """Connect to the MJPEG stream and save/display each frame."""
    stream_url = f"http://{ip}/stream"
    print(f"\nConnecting to MJPEG stream at {stream_url}")

    if save_dir:
        save_dir.mkdir(parents=True, exist_ok=True)
        print(f"Saving frames to: {save_dir.resolve()}")

    Image = None
    if show:
        try:
            from PIL import Image as _Image
            Image = _Image
        except ImportError:
            print("[WARN] Pillow not installed, --show ignored. pip install pillow")
            show = False

    # Retry connecting — ESP32 HTTP server may still be starting up.
    resp = None
    for attempt in range(10):
        try:
            resp = requests.get(stream_url, stream=True, timeout=10)
            resp.raise_for_status()
            break
        except requests.exceptions.ConnectionError:
            print(f"  Connection refused, retrying in 2s... ({attempt + 1}/10)")
            time.sleep(2)
        except requests.exceptions.RequestException as e:
            print(f"  Request error: {e}, retrying in 2s... ({attempt + 1}/10)")
            time.sleep(2)

    if resp is None:
        raise RuntimeError("Could not connect to stream after 10 attempts.")

    frame_count = 0
    total_bytes = 0
    t_start     = time.monotonic()

    print("Stream connected. Receiving frames... (Ctrl-C to stop)\n")

    buf = b""

    for chunk in resp.iter_content(chunk_size=4096):
        buf += chunk

        while True:
            boundary_pos = buf.find(MJPEG_BOUNDARY)
            if boundary_pos == -1:
                break

            header_end = buf.find(b"\r\n\r\n", boundary_pos)
            if header_end == -1:
                break
            header_end += 4

            header_section = buf[boundary_pos:header_end]
            content_length = None
            for line in header_section.split(b"\r\n"):
                if line.lower().startswith(b"content-length:"):
                    content_length = int(line.split(b":")[1].strip())
                    break

            if content_length is None:
                buf = buf[boundary_pos + len(MJPEG_BOUNDARY):]
                break

            frame_end = header_end + content_length
            if len(buf) < frame_end:
                break

            jpeg = buf[header_end:frame_end]
            buf  = buf[frame_end:]

            frame_count += 1
            total_bytes += len(jpeg)
            elapsed = time.monotonic() - t_start
            fps     = frame_count / elapsed if elapsed > 0 else 0

            print(f"Frame {frame_count:5d} | {len(jpeg):7d} bytes | {fps:.2f} fps")

            if not (jpeg[:2] == b"\xff\xd8" and jpeg[-2:] == b"\xff\xd9"):
                print("[WARN] Data does not look like a valid JPEG, skipping")
                continue

            if save_dir:
                path = save_dir / f"frame_{frame_count:05d}.jpg"
                path.write_bytes(jpeg)
                print(f"       Saved → {path}")

            if show and Image:
                try:
                    img = Image.open(io.BytesIO(jpeg))
                    img.show()
                except Exception as e:
                    print(f"[WARN] Could not display frame: {e}")

    elapsed = time.monotonic() - t_start
    print(f"\nDone. {frame_count} frames, {total_bytes / 1024:.1f} KB total, "
          f"{elapsed:.1f} s, {frame_count / elapsed:.2f} fps average.")


# ── Entry point ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--ssid",       required=True,
                        help="WiFi network name to send to the ESP32")
    parser.add_argument("--password",   required=True,
                        help="WiFi password to send to the ESP32")
    parser.add_argument("--save-dir",   default="./frames", type=Path,
                        help="Directory to save JPEG frames (default: ./frames). "
                             "Pass empty string to disable saving.")
    parser.add_argument("--show",       action="store_true",
                        help="Open each frame in the system image viewer")
    parser.add_argument("--device",     default=DEVICE_NAME,
                        help=f"BLE device name (default: {DEVICE_NAME})")
    args = parser.parse_args()

    save_dir = args.save_dir if str(args.save_dir) else None

    try:
        # Phase 1: get IP over BLE.
        ip = asyncio.run(get_ip_over_ble(args.ssid, args.password))

        # Phase 2: receive frames over WiFi.
        receive_frames(ip, save_dir, args.show)

    except KeyboardInterrupt:
        print("\nInterrupted.")
    except RuntimeError as e:
        print(f"Error: {e}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()