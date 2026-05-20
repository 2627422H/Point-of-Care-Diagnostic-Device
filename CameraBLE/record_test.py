#!/usr/bin/env python3
"""
record_test.py – Trigger an LED fade recording session and verify the curve.

The script provisions the ESP32 over BLE (or skips BLE with --ip), triggers
the LED fade via HTTP, captures every MJPEG frame during the fade window,
then measures mean brightness per frame and compares it to the expected curve.

Output per run (saved under --out-dir):
    frames/frame_NNNNN_TTTTT.jpg   – raw JPEG frames with ms timestamp
    brightness.csv                 – timestamp_ms, mean_brightness, expected_brightness
    curve_plot.png                 – brightness vs time with expected overlay

Requirements:
    pip install bleak requests pillow numpy matplotlib

Usage examples:
    # Full BLE provisioning + exponential fade for 5 s
    python record_test.py --ssid MyNet --password Pass

    # Skip BLE (already provisioned), sigmoid curve for 8 s
    python record_test.py --ip 172.20.10.13 --curve sigmoid --duration 8000

    # All four curves back-to-back
    python record_test.py --ip 172.20.10.13 --all-curves
"""

import argparse
import asyncio
import csv
import io
import math
import time
from pathlib import Path

import numpy as np
import requests
from PIL import Image
from bleak import BleakClient, BleakScanner

# ── BLE constants (must match ble_server.c) ──────────────────────────────────
DEVICE_NAME = "ESP32-CAM"
SSID_UUID   = "fb349b5f-8000-0080-0010-000000000011"
PASS_UUID   = "fb349b5f-8000-0080-0010-000000000012"
IP_UUID     = "fb349b5f-8000-0080-0010-000000000013"

MJPEG_BOUNDARY = b"--frame"

# ── Curve definitions (must match rgb_led.h) ─────────────────────────────────
CURVES = {
    "linear":      0,
    "exponential": 1,
    "logarithmic": 2,
    "sigmoid":     3,
}

def expected_brightness(curve_name: str, t: float) -> float:
    """Normalised brightness [0,1] at normalised time t ∈ [0,1]."""
    if curve_name == "linear":
        return max(0.0, 1.0 - t)
    elif curve_name == "exponential":
        return math.exp(-4.605 * t)          # reaches ~1 % at t=1
    elif curve_name == "logarithmic":
        return 1.0 - math.log(1.0 + 9.0 * t) / math.log(10.0)
    elif curve_name == "sigmoid":
        return 1.0 / (1.0 + math.exp(12.0 * (t - 0.5)))
    return 1.0 - t


# ── Phase 1: BLE provisioning ────────────────────────────────────────────────

async def get_ip_over_ble(ssid: str, password: str, device_name: str) -> str:
    print(f"Scanning for '{device_name}'...")
    device = await BleakScanner.find_device_by_name(device_name, timeout=15.0)
    if device is None:
        raise RuntimeError(f"Could not find '{device_name}'. Is the ESP32 powered and advertising?")
    print(f"Found: {device.name} [{device.address}]")

    ip_received = asyncio.Event()
    ip_result   = {"value": None}

    def on_ip_notify(_, data: bytearray):
        ip_str = data.decode("utf-8").strip("\x00")
        print(f"ESP32 IP: {ip_str}")
        ip_result["value"] = ip_str
        ip_received.set()

    async with BleakClient(device, timeout=20.0) as client:
        print(f"Connected (MTU={client.mtu_size})")
        await client.start_notify(IP_UUID, on_ip_notify)
        await client.write_gatt_char(SSID_UUID, ssid.encode("utf-8"), response=False)
        await asyncio.sleep(0.2)
        await client.write_gatt_char(PASS_UUID, password.encode("utf-8"), response=False)
        print("Credentials sent. Waiting for WiFi IP...")
        try:
            await asyncio.wait_for(ip_received.wait(), timeout=30.0)
        except asyncio.TimeoutError:
            raise RuntimeError("Timed out waiting for IP address.")
        await client.stop_notify(IP_UUID)

    return ip_result["value"]


# ── Phase 2: recording session ────────────────────────────────────────────────

def run_recording_session(ip: str, curve_name: str, duration_ms: int,
                           r: int, g: int, b: int, step_ms: int,
                           out_dir: Path) -> dict:
    """
    Trigger a fade on the ESP32, capture MJPEG frames for the duration,
    measure brightness per frame.  Returns a results dict.
    """
    stream_url = f"http://{ip}/stream"
    record_url = f"http://{ip}/record"

    frames_dir = out_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    # Wait for HTTP server to be ready using the index page (quick response).
    # Do NOT open /stream yet — it occupies the httpd worker and blocks /record.
    print(f"Waiting for HTTP server at http://{ip}/...")
    for attempt in range(15):
        try:
            requests.get(f"http://{ip}/", timeout=5)
            break
        except requests.exceptions.RequestException:
            print(f"  Not ready, retrying... ({attempt+1}/15)")
            time.sleep(2)
    else:
        raise RuntimeError("HTTP server not reachable after 30 s.")

    # Trigger the fade BEFORE opening the stream (httpd is single-threaded).
    params = {
        "curve":    CURVES[curve_name],
        "r": r, "g": g, "b": b,
        "duration": duration_ms,
        "step":     step_ms,
    }
    rec_resp = requests.get(record_url, params=params, timeout=5)
    rec_resp.raise_for_status()
    record_start = time.monotonic()
    session_info = rec_resp.json()
    print(f"Recording started: {session_info}")

    # Now open the stream — from this point the httpd worker is occupied.
    resp = requests.get(stream_url, stream=True, timeout=10)
    resp.raise_for_status()

    # Capture frames until duration + 20 % buffer.
    capture_window = duration_ms / 1000.0 * 1.2
    print(f"Capturing for {capture_window:.1f} s...")

    results = []   # list of (timestamp_ms, mean_brightness, jpeg_bytes)
    buf     = b""
    frame_n = 0

    for chunk in resp.iter_content(chunk_size=4096):
        if time.monotonic() - record_start > capture_window:
            break

        buf += chunk

        while True:
            boundary_pos = buf.find(MJPEG_BOUNDARY)
            if boundary_pos == -1:
                break
            header_end = buf.find(b"\r\n\r\n", boundary_pos)
            if header_end == -1:
                break
            header_end += 4

            content_length = None
            for line in buf[boundary_pos:header_end].split(b"\r\n"):
                if line.lower().startswith(b"content-length:"):
                    content_length = int(line.split(b":")[1].strip())
                    break
            if content_length is None:
                buf = buf[boundary_pos + len(MJPEG_BOUNDARY):]
                break

            frame_end = header_end + content_length
            if len(buf) < frame_end:
                break

            jpeg       = buf[header_end:frame_end]
            buf        = buf[frame_end:]
            ts_ms      = int((time.monotonic() - record_start) * 1000)
            frame_n   += 1

            if not (jpeg[:2] == b"\xff\xd8" and jpeg[-2:] == b"\xff\xd9"):
                continue

            # Measure mean brightness (convert to greyscale).
            img        = Image.open(io.BytesIO(jpeg)).convert("L")
            brightness = float(np.array(img).mean())

            t_norm     = min(ts_ms / duration_ms, 1.0)
            expected   = expected_brightness(curve_name, t_norm) * 255.0

            results.append((ts_ms, brightness, expected))

            path = frames_dir / f"frame_{frame_n:05d}_{ts_ms:06d}ms.jpg"
            path.write_bytes(jpeg)
            print(f"  t={ts_ms:5d} ms | brightness={brightness:6.1f} | "
                  f"expected={expected:6.1f} | Δ={brightness-expected:+.1f}")

    return {"curve": curve_name, "duration_ms": duration_ms,
            "frames": frame_n, "results": results,
            "session": session_info}


# ── Phase 3: analysis & plotting ─────────────────────────────────────────────

def save_results(data: dict, out_dir: Path):
    curve_name   = data["curve"]
    results      = data["results"]
    duration_ms  = data["duration_ms"]

    # CSV
    csv_path = out_dir / "brightness.csv"
    with open(csv_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["timestamp_ms", "mean_brightness", "expected_brightness"])
        w.writerows(results)
    print(f"Saved {csv_path}")

    if not results:
        print("No frames captured — nothing to plot.")
        return

    # Plot
    try:
        import matplotlib.pyplot as plt

        ts       = [r[0] for r in results]
        measured = [r[1] for r in results]
        expected = [r[2] for r in results]

        fig, ax = plt.subplots(figsize=(10, 5))
        ax.plot(ts, measured, "b.-", label="Measured brightness", linewidth=1.5, markersize=3)
        ax.plot(ts, expected, "r--", label=f"Expected ({curve_name})", linewidth=2)
        ax.set_xlabel("Time (ms)")
        ax.set_ylabel("Mean brightness (0–255)")
        ax.set_title(f"LED fade verification – {curve_name} curve")
        ax.legend()
        ax.grid(True, alpha=0.3)

        # Shade the region beyond duration.
        ax.axvline(duration_ms, color="grey", linestyle=":", alpha=0.7, label="Fade end")

        plot_path = out_dir / "curve_plot.png"
        fig.savefig(plot_path, dpi=150, bbox_inches="tight")
        print(f"Saved {plot_path}")
        plt.show()

    except ImportError:
        print("[WARN] matplotlib not installed — skipping plot. pip install matplotlib")

    # Summary stats
    if results:
        peak   = max(r[1] for r in results)
        final  = results[-1][1]
        actual_decay = (peak - final) / peak * 100 if peak > 0 else 0
        print(f"\nSummary: {data['frames']} frames | "
              f"peak={peak:.1f} | final={final:.1f} | "
              f"decay={actual_decay:.1f}%")


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ble_group = parser.add_argument_group("BLE provisioning (skip with --ip)")
    ble_group.add_argument("--ssid",     help="WiFi SSID to send to ESP32")
    ble_group.add_argument("--password", help="WiFi password")
    ble_group.add_argument("--device",   default=DEVICE_NAME,
                           help=f"BLE device name (default: {DEVICE_NAME})")

    parser.add_argument("--ip",       help="Skip BLE, connect directly to this IP")
    parser.add_argument("--curve",    default="exponential",
                        choices=list(CURVES.keys()),
                        help="Fade curve shape (default: exponential)")
    parser.add_argument("--duration", type=int, default=10000,
                        help="Fade duration in ms (default: 10000)")
    parser.add_argument("--step",     type=int, default=10,
                        help="LED update interval in ms (default: 10)")
    parser.add_argument("--r",        type=int, default=255)
    parser.add_argument("--g",        type=int, default=255)
    parser.add_argument("--b",        type=int, default=255)
    parser.add_argument("--out-dir",  type=Path, default=Path("./recording"),
                        help="Output directory (default: ./recording)")
    parser.add_argument("--all-curves", action="store_true",
                        help="Run all four curves back-to-back (5 s each, 3 s gap)")

    args = parser.parse_args()

    try:
        # Get IP.
        if args.ip:
            ip = args.ip
        elif args.ssid and args.password:
            ip = asyncio.run(get_ip_over_ble(args.ssid, args.password, args.device))
        else:
            parser.error("Provide either --ip or both --ssid and --password.")

        curves = list(CURVES.keys()) if args.all_curves else [args.curve]

        for curve_name in curves:
            run_dir = args.out_dir / curve_name
            run_dir.mkdir(parents=True, exist_ok=True)

            print(f"\n{'='*50}")
            print(f"  Curve: {curve_name}  |  Duration: {args.duration} ms")
            print(f"{'='*50}")

            data = run_recording_session(
                ip=ip,
                curve_name=curve_name,
                duration_ms=args.duration,
                r=args.r, g=args.g, b=args.b,
                step_ms=args.step,
                out_dir=run_dir,
            )
            save_results(data, run_dir)

            if args.all_curves and curve_name != curves[-1]:
                print("\nPausing 3 s before next curve...")
                time.sleep(3)

    except KeyboardInterrupt:
        print("\nInterrupted.")
    except RuntimeError as e:
        print(f"Error: {e}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
