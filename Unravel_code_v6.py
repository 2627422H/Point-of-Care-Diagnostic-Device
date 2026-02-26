#Load liraries from venv
import os
import site
import sys

# Path to your virtual environment
venv_path = os.path.join(os.path.dirname(__file__), 'venv')

# Add site-packages from the virtual environment
site_packages = os.path.join(venv_path, 'Lib', 'site-packages') if os.name == 'nt' else os.path.join(venv_path, 'lib', f'python{sys.version_info.major}.{sys.version_info.minor}', 'site-packages')

# Prepend to sys.path
if site_packages not in sys.path:
    sys.path.insert(0, site_packages)


# === 1. IMPORTS === #
import tkinter as tk
from tkinter import ttk, filedialog
import matplotlib.pyplot as plt
import matplotlib as mpl
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
import numpy as np
import cv2
from PIL import Image, ImageTk
import threading
import time
from vmbpy import VmbSystem, PixelFormat
import pandas as pd
import os
import io


# === 2. GLOBAL CONSTANTS & VARIABLES === #
IMAGE_DISPLAY_SIZE = (400, 300)  # Image window size
DURATION = 20                    # Default analysis time in seconds

#Fonts and line widths
mpl.rcParams.update({
    "axes.titlesize": 6,
    "axes.labelsize": 4,
    "xtick.labelsize": 4,
    "ytick.labelsize": 4,
    "legend.fontsize": 4,
    "lines.linewidth": 0.5
})

analysis_running = False
stop_requested = False
roi_list = []
time_data = []

# Initial camera settings
exposure_time = 6500  # Exposure time in microseconds
gain = 2.0  # Gain value
# Will hold the original (rectangle-free) image
base_image = None

# === 3. ROI CLASS === #
class ROI:
    """Stores coordinates, color, graph line, and UI entries for one ROI"""
    def __init__(self, master, graph_ax, index):
        self.index = index
        self.graph_ax = graph_ax
        self.brightness_values = []

        self.colors_rgb = [
            (255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0), (255, 165, 0), (128, 0, 128),
            (0, 255, 255), (255, 192, 203), (165, 42, 42), (128, 128, 128), (0, 128, 0),
            (75, 0, 130), (255, 20, 147), (70, 130, 180), (240, 230, 140), (0, 0, 0)
        ]

        self.color_rgb = self.colors_rgb[index]  # For Matplotlib (RGB)
        self.color_bgr = (self.color_rgb[2], self.color_rgb[1], self.color_rgb[0])  # For OpenCV (BGR)

        self.entries = []

        # UI frame for this ROI
        self.frame = ttk.Frame(master)
        ttk.Label(self.frame, text=f"ROI {index+1}:", width=6).pack(side="left", padx=(0,2))

        for _ in range(4):
            entry = ttk.Entry(self.frame, width=6)
            entry.pack(side="left", padx=(0,2))
            entry.bind("<KeyRelease>", update_rois_live)
            self.entries.append(entry)

        self.x1 = self.y1 = self.x2 = self.y2 = 0
        self.line, = graph_ax.plot([], [], color=tuple(c/255 for c in self.color_rgb), label=f"ROI {index+1}")

    def update_coordinates(self):
        """Pull coordinates from entry boxes"""
        try:
            self.x1, self.x2 = int(self.entries[0].get()), int(self.entries[1].get())
            self.y1, self.y2 = int(self.entries[2].get()), int(self.entries[3].get())
        except ValueError:
            pass  # Invalid input ignored

    def draw_rectangle(self, image):
        if coordinate_mode.get() == "percentage":
            resized_x1 = map_value(self.x1, 0, 100, 0, IMAGE_DISPLAY_SIZE[0])
            resized_x2 = map_value(self.x2, 0, 100, 0, IMAGE_DISPLAY_SIZE[0])
            resized_y1 = map_value(self.y1, 0, 100, 0, IMAGE_DISPLAY_SIZE[1])
            resized_y2 = map_value(self.y2, 0, 100, 0, IMAGE_DISPLAY_SIZE[1])
        else:
            resized_x1, resized_x2 = self.x1, self.x2
            resized_y1, resized_y2 = self.y1, self.y2

        cv2.rectangle(image, (resized_x1, resized_y1), (resized_x2, resized_y2), self.color_bgr, 2)


    def update_graph(self, time_data):
        """Update graph line with latest data"""
        self.line.set_xdata(time_data)
        self.line.set_ydata(self.brightness_values)

# === 4. UTILITY FUNCTIONS === #
def update_tk_image(image):
    """Convert OpenCV image to ImageTk format"""
    img_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

    # Convert to uint8 if necessary
    if img_rgb.dtype == np.uint16:
        img_rgb = (img_rgb / 256).astype(np.uint8)

    return ImageTk.PhotoImage(Image.fromarray(img_rgb))

def moving_average(data):
    """Returns a smoothed version of the data with the same length,
    averaging over smaller windows at the edges."""
    window_size = int(average_entry.get())
    n = len(data)

    if n == 0:
        return []

    smoothed = []
    for i in range(n):
        # Determine window range around current point
        start = max(0, i - window_size // 2)
        end = min(n, i + window_size // 2 + 1)
        window = data[start:end]
        smoothed.append(sum(window) / len(window))

    return smoothed

def map_value(value, in_min, in_max, out_min, out_max):
    return int(out_min + (float(value - in_min) * (out_max - out_min) / (in_max - in_min)))

# === 5. CAMERA HANDLING === #
def capture_image():
    """Takes a snapshot from the camera"""
    with VmbSystem.get_instance() as vmb:
        cams = vmb.get_all_cameras()
        if not cams:
            print("No cameras found.")
            return None

        with cams[0] as cam:
            cam.set_pixel_format(PixelFormat.Mono8)
            update_camera_settings()
            disable_auto_controls(cam)
            adjust_camera_settings(cam)
            time.sleep(0.2)
            verify_settings(cam)
            frame = cam.get_frame()
            if frame.get_status() != 'Complete':
                print(f"⚠️ Frame status: {frame.get_status()}")
            image = frame.as_numpy_ndarray()

            if image is None or image.size == 0:
                print("Warning: Captured image is empty.")
                return np.zeros(IMAGE_DISPLAY_SIZE + (3,), dtype=np.uint8)

            return resize_image(cv2.cvtColor(image, cv2.COLOR_GRAY2BGR), IMAGE_DISPLAY_SIZE)

def update_camera_settings():
    global exposure_time, gain
    exposure_time = exposure_time_entry.get() 
    gain = gain_entry.get()
    
def disable_auto_controls(cam):
    """Disable auto features that could override settings."""
    print("\n--- Disabling Auto Controls ---")
    features_to_disable = ["GainAuto", "ExposureAuto"]
    for feature_name in features_to_disable:
        try:
            feature = cam.get_feature_by_name(feature_name)
            if feature.is_writeable():
                feature.set("Off")
                print(f"{feature_name} disabled.")
            else:
                print(f"{feature_name} is not writable.")
        except Exception as e:
            print(f"Failed to disable {feature_name}: {e}")

def adjust_camera_settings(cam):
    """Adjust camera settings directly on the chip."""
    def try_set_feature(feature_name, value):
        try:
            feature = cam.get_feature_by_name(feature_name)
            if feature.is_writeable():
                feature.set(value)
                print(f"{feature_name} set to: {feature.get()} (Expected: {value})")
            else:
                print(f"{feature_name} is not writable.")
        except Exception as e:
            print(f"Failed to set {feature_name}: {e}")

    print("\n--- Adjusting Camera Settings ---")

    # Adjust settings
    try_set_feature("ExposureTime", exposure_time)
    try_set_feature("Gain", gain)

def verify_settings(cam):
    """Verify if settings are correctly applied."""
    print("\n--- Verifying Settings ---")
    settings_to_check = ["ExposureTime", "Gain"]
    for setting in settings_to_check:
        try:
            feature = cam.get_feature_by_name(setting)
            print(f"{setting}: {feature.get()}")
        except Exception as e:
            print(f"Failed to fetch {setting}: {e}")

def resize_image(image, target_size):
    """Resize while preserving aspect ratio"""
    h, w = image.shape[:2]
    scale = min(target_size[0] / w, target_size[1] / h)
    return cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

# === 6. ROI MANAGEMENT === #
def update_rois_live(event=None):
    """Redraw rectangles based on current entry values"""
    global base_image, tk_image

    if analysis_running:
        return

    if base_image is None or base_image.size == 0:
        return
    
    image_display = base_image.copy()
    for roi in roi_list:
        roi.update_coordinates()
        roi.draw_rectangle(image_display)
    tk_image = update_tk_image(image_display)
    label_image.config(image=tk_image)

def update_roi_list(event=None):
    """Handle changing number of ROIs"""
    global roi_list, time_data
    time_data.clear()
    ax.clear()
    ax.set_title("Brightness Over Time")
    ax.set_xlabel("Time (s)")
    ax.set_ylabel("Brightness (0–1024)")
    ax.tick_params(axis='both')
    canvas.draw()

    for roi in roi_list:
        roi.frame.destroy()

    roi_list = [ROI(roi_input_frame, ax, i) for i in range(roi_count_var.get())]
    for roi in roi_list:
        roi.frame.pack(fill="x", padx=5, pady=2)
    update_rois_live()

# === 7. ANALYSIS FUNCTIONS === #
def analyze_brightness():
    """Runs ROI brightness analysis over time"""
    global analysis_running, tk_image, time_data, stop_requested, base_image

    stop_requested = False
    analysis_running = True
    duration = float(duration_entry.get())
    time_data.clear()

    # Reset plot
    ax.clear()
    ax.set_title("Brightness Over Time")
    ax.set_xlabel("Time (s)")
    ax.set_ylabel("Brightness (0–1024)")
    ax.tick_params(axis='both')
    ax.set_xlim(0, duration)
    ax.set_ylim(0, 1024)

    # Reset data
    for roi in roi_list:
        roi.brightness_values.clear()
        roi.line, = ax.plot([], [], color=tuple(c/255 for c in roi.color_rgb), label=f"ROI {roi.index+1}")

    with VmbSystem.get_instance() as vmb:
        cams = vmb.get_all_cameras()
        if not cams:
            print("No cameras found.")
            return

        with cams[0] as cam:
            cam.set_pixel_format(PixelFormat.Mono10)
            update_camera_settings()
            disable_auto_controls(cam)
            adjust_camera_settings(cam)
            verify_settings(cam)
            start_time = time.time()

            while time.time() - start_time < duration and not stop_requested:
                current_time = time.time() - start_time
                time_data.append(current_time)

                frame = cam.get_frame()
                image = frame.as_numpy_ndarray()

                for roi in roi_list:
                    if coordinate_mode.get() == "percentage":
                        x1 = map_value(roi.x1, 0, 100, 0, image.shape[1])  # columns = width = x
                        x2 = map_value(roi.x2, 0, 100, 0, image.shape[1])
                        y1 = map_value(roi.y1, 0, 100, 0, image.shape[0])  # rows = height = y
                        y2 = map_value(roi.y2, 0, 100, 0, image.shape[0])
                    else:
                        x1 = map_value(roi.x1, 0, IMAGE_DISPLAY_SIZE[0], 0, image.shape[1])
                        x2 = map_value(roi.x2, 0, IMAGE_DISPLAY_SIZE[0], 0, image.shape[1])
                        y1 = map_value(roi.y1, 0, IMAGE_DISPLAY_SIZE[1], 0, image.shape[0])
                        y2 = map_value(roi.y2, 0, IMAGE_DISPLAY_SIZE[1], 0, image.shape[0])
                    brightness = np.mean(image[y1:y2, x1:x2])
                    roi.brightness_values.append(brightness)
                    roi.update_graph(time_data)

                canvas.draw()

    if not stop_requested:
        for roi in roi_list:
            window_size = int(average_entry.get())
            smoothed = moving_average(roi.brightness_values)
            ax.plot(time_data, smoothed, linestyle="dashed", color=tuple(c/255 for c in roi.color_rgb), label=f"Smoothed ROI {roi.index+1}")
        ax.legend(loc="upper right")
    else:
        ax.clear()
        ax.set_title("Brightness Over Time")
        ax.set_xlabel("Time (s)")
        ax.set_ylabel("Brightness (0–1024)")
        ax.tick_params(axis='both')
    canvas.draw()
    image8 = (image / 4).astype(np.uint8)
    resized_image = resize_image(image8, IMAGE_DISPLAY_SIZE)
    base_image = cv2.cvtColor(resized_image, cv2.COLOR_GRAY2BGR)
    update_rois_live()
    analysis_running = False

def stop_analysis():
    """Sets a flag to stop current analysis run"""
    global stop_requested
    stop_requested = True

def export_data():
    """Save brightness data for all ROIs to CSV, prompting the user for file location"""
    if not roi_list or not time_data:
        print("No data available to export.")
        return

    # Prompt user for filename
    path = filedialog.asksaveasfilename(
        defaultextension=".csv",
        filetypes=[("CSV files", "*.csv")],
        title="Save Brightness Data As"
    )
    if not path:
        print("Export cancelled.")
        return

    data = {"Time (s)": time_data}
    for roi in roi_list:
        smoothed = moving_average(roi.brightness_values)
        data[f"ROI {roi.index+1} Brightness"] = roi.brightness_values
        data[f"ROI {roi.index+1} Smoothed"] = smoothed

    df = pd.DataFrame(data)
    df.to_csv(path, index=False, float_format="%.8f")
    print(f"✅ Brightness data exported to {path}")


def import_roi_csv():
    """Load ROI coordinates from a CSV"""
    global exposure_time, gain
    file_path = filedialog.askopenfilename(filetypes=[("CSV files", "*.csv")])
    if not file_path:
        return

    try:
        with open(file_path, "r") as f:
            lines = f.readlines()

        # Defaults in case headers are missing
        imported_mode = coordinate_mode.get()

        # Parse header lines
        while lines and lines[0].startswith("#"):
            line = lines.pop(0).strip()
            if line.startswith("#mode="):
                imported_mode = line.split("=")[-1]
            elif line.startswith("#exposure="):
                imported_exposure = float(line.split("=")[-1])
            elif line.startswith("#gain="):
                imported_gain = float(line.split("=")[-1])

        coordinate_mode.set(imported_mode)
        exposure_time = imported_exposure
        gain = imported_gain

        # Update GUI entry fields after importing
        exposure_time_entry.delete(0, tk.END)
        exposure_time_entry.insert(0, str(exposure_time))

        gain_entry.delete(0, tk.END)
        gain_entry.insert(0, str(gain))

        apply_camera_settings()  
        df = pd.read_csv(io.StringIO("".join(lines)))

        if not all(col in df.columns for col in ['x1', 'x2', 'y1', 'y2']):
            print("CSV must contain x1, x2, y1, y2")
            return

        roi_count_var.set(len(df))
        update_roi_list()

        for i, roi in enumerate(roi_list):
            if i < len(df):
                for j, key in enumerate(['x1', 'x2', 'y1', 'y2']):
                    roi.entries[j].delete(0, tk.END)
                    roi.entries[j].insert(0, str(df.iloc[i][key]))
        update_rois_live()

    except Exception as e:
        print(f"Error loading ROI CSV: {e}")


def export_roi_csv():
    """Save current ROI coordinates to CSV"""
    global exposure_time, gain
    if not roi_list:
        print("No ROIs to export.")
        return

    coords = []
    for roi in roi_list:
        roi.update_coordinates()
        coords.append({'x1': roi.x1, 'x2': roi.x2,'y1': roi.y1, 'y2': roi.y2})

    df = pd.DataFrame(coords)
    df.attrs["mode"] = coordinate_mode.get()
    path = filedialog.asksaveasfilename(defaultextension=".csv", filetypes=[("CSV files", "*.csv")])
    if path:
        with open(path, "w") as f:
            f.write(f"#mode={coordinate_mode.get()}\n")  # header
            f.write(f"#exposure={exposure_time}\n")
            f.write(f"#gain={gain}\n")
            df.to_csv(f, index=False)
        print(f"ROI coordinates exported to {path}")


def close_program():
    """Graceful exit with cleanup"""
    global analysis_running
    analysis_running = False
    time.sleep(0.5)
    plt.close("all")
    with VmbSystem.get_instance() as vmb:
        cams = vmb.get_all_cameras()
        if cams:
            with cams[0] as cam:
                cam.stop_streaming()
    root.quit()
    root.destroy()
    print("Closed.")

def apply_camera_settings():
    """Apply current camera settings and refresh the image preview"""
    global base_image, tk_image

    print("Applying camera settings...")

    try:
        image = capture_image()
        if image is None or image.size == 0:
            print("⚠️ Failed to capture image — using fallback blank image.")
            image = np.zeros(IMAGE_DISPLAY_SIZE + (3,), dtype=np.uint8)

        base_image = image.copy()
        tk_image = update_tk_image(base_image)
        label_image.config(image=tk_image)
        update_rois_live()

    except Exception as e:
        print(f"❌ Error applying settings or capturing image: {e}")

def toggle_mode():
    current = coordinate_mode.get()
    if current == "percentage":
        coordinate_mode.set("pixels")
    else:
        coordinate_mode.set("percentage")
    
    for roi in roi_list:
        roi.update_coordinates()
        # Convert entries
        for i, val in enumerate([roi.x1, roi.x2, roi.y1, roi.y2]):
            if current == "percentage":
                # convert from % to px
                if i < 2:  # x values
                    val = int(map_value(val, 0, 100, 0, IMAGE_DISPLAY_SIZE[0]))
                else:  # y values
                    val = int(map_value(val, 0, 100, 0, IMAGE_DISPLAY_SIZE[1]))
            else:
                # convert from px to %
                if i < 2:
                    val = int(map_value(val, 0, IMAGE_DISPLAY_SIZE[0], 0, 100))
                else:
                    val = int(map_value(val, 0, IMAGE_DISPLAY_SIZE[1], 0, 100))
            roi.entries[i].delete(0, tk.END)
            roi.entries[i].insert(0, str(val))

        roi.update_coordinates()

    update_rois_live()
    

# === 8. UI SETUP === #
root = tk.Tk()
root.title("ROI Analysis Tool")
root.geometry("900x600")
coordinate_mode = tk.StringVar(value="percentage")  # percentage or pixels

# Grid configuration for the main window
root.columnconfigure(0, weight=0)
root.columnconfigure(1, weight=2)
root.rowconfigure(0, weight=0)
root.rowconfigure(1, weight=2)

# Helper: Labeled Entry Creator
def make_labeled_entry(parent, label, default):
    container = ttk.Frame(parent)
    container.pack( anchor='w', pady=(0,5))
    
    ttk.Label(container, text=label, width=16).pack(side="left", padx=(0, 3))
    entry = ttk.Entry(container, width=8)
    entry.insert(0, str(default))
    entry.pack(side="left")
    return entry

# === LEFT COLUMN === #
frame_controls = ttk.LabelFrame(root, borderwidth=2, relief="solid", text='Regions of Interest')
frame_controls.grid(row=0, column=0, rowspan=2, sticky="nsew", padx=5, pady=5)


# ┌──────────── FRAME: ROIs ───────────┐
frame_rois = ttk.Frame(frame_controls)
frame_rois.pack(fill="x", padx=10, pady=10)

# ROI Count Dropdown
roi_count_frame = ttk.Frame(frame_rois)
roi_count_frame.pack(fill="x", pady=(0, 5))

ttk.Label(roi_count_frame, text="Number of ROIs:", width=16).pack(side="left")
roi_count_var = tk.IntVar(value=3)
roi_dropdown = ttk.Combobox(
    roi_count_frame, textvariable=roi_count_var,
    values=list(range(1, 17)), state="readonly", width=8
)
roi_dropdown.pack(side='left')

# Coordinate Mode
mode_frame = ttk.Frame(frame_rois)
mode_frame.pack(fill="x", pady=(0, 5))

ttk.Label(mode_frame, text="Coordinate Mode:").pack(side="left", padx=(0, 5))
mode_label = ttk.Label(mode_frame, textvariable=coordinate_mode)
mode_label.pack(side="left")

# ROI Entry Inputs Container
roi_input_frame = ttk.Frame(frame_rois)
roi_input_frame.pack(fill="x", pady=(10, 10))

# ROI Entry Header Labels
header = ttk.Frame(roi_input_frame)
header.pack(fill="x", pady=(0, 5))

for name in ["  ", "  x1", "  x2", "  y1", "  y2"]:
    ttk.Label(header, text=name, width=6).pack(side="left", padx=(0,2))

# Update ROI inputs on dropdown change
roi_dropdown.bind("<<ComboboxSelected>>", update_roi_list)


ttk.Button(frame_rois, text="Toggle Coordinate Mode", command=toggle_mode, width=16).pack(fill='x',pady=(0, 5))
ttk.Button(frame_rois, text="Import ROIs", command=import_roi_csv, width=16).pack(fill='x',pady=(0, 5))
ttk.Button(frame_rois, text="Export ROIs", command=export_roi_csv, width=16).pack(fill='x',pady=(0, 5))

ttk.Button(frame_controls, text="Close Program", command=close_program, width=16).pack(side='bottom', fill='x', padx=10, pady=10)


# === Right COLUMN === #
# ┌──────────── FRAME: IMAGE PREVIEW ────────────┐
frame_image_and_controls = ttk.LabelFrame(root, borderwidth=1, relief="solid", text='Camera Preview')
frame_image_and_controls.grid(row=0, column=1, sticky="nsew", padx=5, pady=5)

# ┌──────────── FRAME: Camera settings ───────────┐
camera_settings_frame = ttk.Frame(frame_image_and_controls)
camera_settings_frame.pack(side='left', anchor='n', padx=10, pady=10)

# Camera setting inputs
exposure_time_entry = make_labeled_entry(camera_settings_frame, "Exposure (µs):", exposure_time)
gain_entry = make_labeled_entry(camera_settings_frame, "Gain:", gain)

# Apply settings button
ttk.Button(camera_settings_frame, text="Update Image", command=apply_camera_settings, width=16).pack(fill='x', pady=(0,5))

frame_image = ttk.Frame(frame_image_and_controls)
frame_image.pack(padx=10, pady=10)

# ┌──────────── FRAME: GRAPH ────────────┐
frame_graph = ttk.LabelFrame(root, borderwidth=1, relief="solid", text='Experiment')
frame_graph.grid(row=1, column=1, sticky="nsew", padx=5, pady=5)




# ┌──────────── FRAME: Graph controls ───────────┐
frame_graph_controls = ttk.Frame(frame_graph)
frame_graph_controls.pack(side='left', anchor='n', padx=10, pady=10)

duration_entry = make_labeled_entry(frame_graph_controls, "Duration (s):", 10)
average_entry = make_labeled_entry(frame_graph_controls, "Average points:", 11)

buttons = [
    ("Run", lambda: threading.Thread(target=analyze_brightness, daemon=True).start()),
    ("Stop", stop_analysis),
    ("Export Data", export_data),
]

for i, (label, cmd) in enumerate(buttons):
    btn = ttk.Button(frame_graph_controls, text=label, command=cmd)
    btn.pack(fill='x',pady=(0,5))

# Graph Figure Setup
fig, ax = plt.subplots(figsize=(4.5, 2.8), dpi=120)
ax.set_title("Brightness Over Time")
ax.set_xlabel("Time (s)")
ax.set_ylabel("Brightness (0–1024)")
ax.tick_params(axis='both')

canvas = FigureCanvasTkAgg(fig, master=frame_graph)
canvas.get_tk_widget().pack(expand=True, fill="both")
frame_graph.pack_propagate(False)


# -- Capture initial image -- #
update_roi_list()
image = capture_image()
base_image = image.copy()
tk_image = update_tk_image(image)
label_image = tk.Label(frame_image, image=tk_image)
label_image.pack(expand=True)

# === 9. MAIN LOOP === #
root.mainloop()
