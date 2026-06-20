#!/usr/bin/env python3
"""Closed-loop director: converge to a GOOD frame of the dancer group.
Loops: grab -> YOLO in-stage union -> center (pan/tilt) + zoom-to-fill -> repeat.
Run with venv python. Saves final to /tmp/ld_final.jpg."""
import subprocess, sys, re
from ultralytics import YOLO
import cv2

MODEL = "/home/danman60/projects/obsbot-control/sim/models/yolov8m.pt"
SRC = "Video Capture Device 2"
W, H = 1920, 1080
STEPS = int(sys.argv[1]) if len(sys.argv) > 1 else 6
model = YOLO(MODEL)

def grab(path):
    subprocess.run(["python3", "obsshot.py", "shot", SRC, path, str(W)], capture_output=True)

def cam(*args):
    return subprocess.run(["bash", "cam.sh", *map(str, args)], capture_output=True, text=True).stdout

def cur_zoom():
    s = cam("state")
    m = re.search(r"zoom=([\d.]+)", s)
    return float(m.group(1)) if m else 2.5

def detect_union(img):
    r = model.predict(img, conf=0.30, classes=[0], verbose=False)[0]
    bs = []
    for b in r.boxes.xyxy:
        x1, y1, x2, y2 = [float(v) for v in b]
        cy = (y1 + y2) / 2; bh = (y2 - y1) / H
        if cy < 0.15 * H or cy > 0.92 * H or bh < 0.04:   # stage mask
            continue
        bs.append((x1, y1, x2, y2))
    if not bs:
        return None
    return (min(b[0] for b in bs), min(b[1] for b in bs),
            max(b[2] for b in bs), max(b[3] for b in bs), len(bs))

def main():
    for step in range(1, STEPS + 1):
        f = f"/tmp/ld_{step}.jpg"; grab(f); img = cv2.imread(f)
        u = detect_union(img)
        if not u:
            print(f"[{step}] no dancers -> hold"); continue
        ux1, uy1, ux2, uy2, n = u
        ucx, ucy = (ux1 + ux2) / 2, (uy1 + uy2) / 2
        uw, uh = ux2 - ux1, uy2 - uy1
        ex, ey = ucx - W / 2, ucy - H / 2
        frac = uh / H; wfrac = uw / W
        # center: stronger gain, cap 25
        yaw = max(-25, min(25, round(ex / 28)))
        pitch = max(-18, min(18, round(ey / 38)))
        moved = ""
        if abs(yaw) >= 2 or abs(pitch) >= 2:
            cam("move", yaw, pitch, 450); moved = f"pan(yaw={yaw},pitch={pitch})"
        # zoom-to-fill: target group height ~65% of frame, but never if width would clip
        z = cur_zoom(); newz = z
        if wfrac > 0.9:
            newz = max(1.6, z * 0.85); moved += " ZOOMOUT(wide group)"
        elif frac < 0.5 and wfrac < 0.7:
            newz = min(8, z * 1.25); moved += " ZOOMIN"
        elif frac > 0.85:
            newz = max(1.6, z * 0.9); moved += " ZOOMOUT"
        if abs(newz - z) > 0.1:
            cam("zoom", round(newz, 1))
        print(f"[{step}] n={n} ctr=({int(ucx)},{int(ucy)}) err=({int(ex)},{int(ey)}) "
              f"fill={frac:.0%}/{wfrac:.0%}w z={z}->{round(newz,1)} {moved or 'GOOD-deadzone'}")
    grab("/tmp/ld_final.jpg"); print("final -> /tmp/ld_final.jpg")

main()
