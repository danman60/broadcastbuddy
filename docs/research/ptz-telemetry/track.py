#!/usr/bin/env python3
"""Validate multi-object TRACKING (ByteTrack) on a continuous frame sequence.
Feeds frames in order with persist=True; reports per-frame track IDs + ID stability.
Answers: do dancer IDs stay consistent across a routine on our stage footage?"""
import sys, glob, os
from ultralytics import YOLO
import cv2

MODEL = "/home/danman60/projects/obsbot-control/sim/models/yolov8m.pt"

def main():
    indir = sys.argv[1] if len(sys.argv) > 1 else "burst"
    outdir = sys.argv[2] if len(sys.argv) > 2 else "track-out"
    os.makedirs(outdir, exist_ok=True)
    model = YOLO(MODEL)
    files = sorted(glob.glob(os.path.join(indir, "*.jpg")))
    seen_ids = {}          # id -> frames present
    per_frame = []
    for f in files:
        img = cv2.imread(f)
        if img is None:
            continue
        r = model.track(img, persist=True, conf=0.25, classes=[0],
                        tracker="bytetrack.yaml", verbose=False)[0]
        ids = []
        if r.boxes is not None and r.boxes.id is not None:
            ids = sorted(int(i) for i in r.boxes.id)
        per_frame.append((os.path.basename(f), ids))
        for i in ids:
            seen_ids[i] = seen_ids.get(i, 0) + 1
        for b, i in zip(r.boxes.xyxy, (r.boxes.id if r.boxes.id is not None else [])):
            x1, y1, x2, y2 = map(int, b)
            cv2.rectangle(img, (x1, y1), (x2, y2), (0, 255, 0), 2)
            cv2.putText(img, f"#{int(i)}", (x1, y1 - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
        cv2.imwrite(os.path.join(outdir, "trk_" + os.path.basename(f)), img)
    nfr = len(per_frame)
    print(f"frames: {nfr}  unique track IDs ever: {len(seen_ids)}")
    # IDs present in >=50% of frames = 'stable'
    stable = {i: c for i, c in seen_ids.items() if c >= nfr * 0.5}
    print(f"stable IDs (present >=50% frames): {len(stable)} -> {sorted(stable)}")
    print(f"id -> #frames present: {dict(sorted(seen_ids.items()))}")
    print("--- per frame (id list) ---")
    for fn, ids in per_frame:
        print(f"{fn:10} n={len(ids):2} ids={ids}")

main()
