#!/usr/bin/env python3
"""Run YOLOv8 person-detection on captured stage frames → validate whether our own
CV director can SEE dancers under colored stage lighting. Outputs per-frame person
counts + confidences, annotated images, and a summary. Run with the venv python."""
import sys, glob, os, json
from ultralytics import YOLO
import cv2

MODEL = "/home/danman60/projects/obsbot-control/sim/models/yolov8m.pt"
CONF = 0.25  # low-ish: stage lighting is hard, see what it can pull

def main():
    indir = sys.argv[1] if len(sys.argv) > 1 else "frames"
    outdir = sys.argv[2] if len(sys.argv) > 2 else "detect-out"
    os.makedirs(outdir, exist_ok=True)
    model = YOLO(MODEL)
    files = sorted(glob.glob(os.path.join(indir, "*.jpg")))
    rows = []
    for f in files:
        img = cv2.imread(f)
        if img is None:
            continue
        r = model.predict(img, conf=CONF, classes=[0], verbose=False)[0]  # class0=person
        boxes = r.boxes
        n = len(boxes)
        confs = sorted([round(float(c), 2) for c in boxes.conf], reverse=True) if n else []
        rows.append({"file": os.path.basename(f), "persons": n, "confs": confs})
        # annotate
        for b in boxes.xyxy:
            x1, y1, x2, y2 = map(int, b)
            cv2.rectangle(img, (x1, y1), (x2, y2), (0, 255, 0), 2)
        cv2.putText(img, f"persons={n}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
        cv2.imwrite(os.path.join(outdir, "det_" + os.path.basename(f)), img)
    counts = [r["persons"] for r in rows]
    summary = {
        "frames": len(rows),
        "frames_with_>=1": sum(1 for c in counts if c >= 1),
        "frames_zero": sum(1 for c in counts if c == 0),
        "max_persons": max(counts) if counts else 0,
        "mean_persons": round(sum(counts) / len(counts), 2) if counts else 0,
    }
    json.dump({"summary": summary, "rows": rows}, open(os.path.join(outdir, "report.json"), "w"), indent=2)
    print(json.dumps(summary, indent=2))
    for r in rows:
        print(f'{r["file"]:42} persons={r["persons"]:2}  {r["confs"][:8]}')

main()
