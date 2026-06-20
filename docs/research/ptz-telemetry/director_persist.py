#!/usr/bin/env python3
"""PERSISTENT director — operator policy:
 - ALWAYS subtle slow push-in (zoom creeps in when safe)
 - recenter every step (keep group centered)
 - NEVER lose a dancer: pull out fast if the group spreads / nears an edge
Saves each frame to numbers/ (capture continues). One SSH/step via cam.sh frame.
Run with venv python, in background."""
import subprocess, time, re, sys
from ultralytics import YOLO
import cv2

MODEL = "/home/danman60/projects/obsbot-control/sim/models/yolov8m.pt"
SRC = "Video Capture Device 2"
W, H = 1920, 1080
STEPS = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
model = YOLO(MODEL)

# framing targets (fractions of frame)
PUSH_STOP_W = 0.68   # stop pushing once group spans this width
PUSH_STOP_H = 0.74   # or this height
PULL_W = 0.80        # pull out fast if group exceeds this width
PULL_H = 0.86
ZMIN, ZMAX = 1.8, 6.0

def grab(path):
    subprocess.run(["python3", "obsshot.py", "shot", SRC, path, str(W)], capture_output=True)

def cam(*a):
    return subprocess.run(["bash", "cam.sh", *map(str, a)], capture_output=True, text=True).stdout

def init_zoom():
    m = re.search(r"zoom=([\d.]+)", cam("state"))
    return float(m.group(1)) if m else 2.5

def union(img):
    r = model.predict(img, conf=0.30, classes=[0], verbose=False)[0]
    bs = []
    for b in r.boxes.xyxy:
        x1, y1, x2, y2 = [float(v) for v in b]
        cy = (y1 + y2) / 2; bh = (y2 - y1) / H
        if cy < 0.15 * H or cy > 0.92 * H or bh < 0.04:   # stage mask: drop truss/audience/noise
            continue
        bs.append((x1, y1, x2, y2))
    if not bs:
        return None
    return (min(b[0] for b in bs), min(b[1] for b in bs),
            max(b[2] for b in bs), max(b[3] for b in bs), len(bs))

def main():
    z = init_zoom()
    lost = 0
    for step in range(1, STEPS + 1):
        ts = time.strftime("%H%M%S")
        f = f"numbers/{ts}.jpg"; grab(f); img = cv2.imread(f)
        if img is None:
            continue
        u = union(img)
        if not u:
            lost += 1
            # lost a while -> pull to safe wide to re-acquire (never stuck tight on empty)
            if lost == 4 and z > 2.6:
                z = 2.5; cam("frame", 0, 0, 300, z, 4)
            print(f"[{step}] no dancers (lost {lost}) hold z={z}", flush=True)
            time.sleep(2); continue
        lost = 0
        ux1, uy1, ux2, uy2, n = u
        ucx, ucy = (ux1 + ux2) / 2, (uy1 + uy2) / 2
        wf, hf = (ux2 - ux1) / W, (uy2 - uy1) / H
        ex, ey = ucx - W / 2, ucy - H / 2
        # recenter (keep dancers centered so none drift out). modest gain, small deadzone.
        yaw = 0 if abs(ex) < 35 else max(-22, min(22, round(ex / 32)))
        pitch = 0 if abs(ey) < 35 else max(-16, min(16, round(ey / 42)))
        # zoom policy: pull fast if spreading; else subtle push when safe; else hold
        mode = "hold"
        if wf > PULL_W or hf > PULL_H:
            z = max(ZMIN, round(z * 0.88, 2)); mode = "PULL (keep all)"
        elif wf < PUSH_STOP_W and hf < PUSH_STOP_H:
            z = min(ZMAX, round(z * 1.04, 2)); mode = "push-in"
        cam("frame", yaw, pitch, 450, z, 3)
        print(f"[{step}] n={n} ctr=({int(ucx)},{int(ucy)}) fill={wf:.0%}w/{hf:.0%}h "
              f"yaw={yaw} pitch={pitch} z={z} {mode}", flush=True)
        time.sleep(0.3)

main()
