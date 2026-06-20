# Our-Own-AI Camera Director — Build Spec (grounded in 7Attitudes live data, 2026-06-20)

Replaces the OBSBOT built-in AI (proven unusable: overshoots zoom, chases outliers, grabs
audience, no geo-fence, random dropout — see FINDINGS.md). We own the full loop, so we run our own.

## Feasibility — VALIDATED on real stage footage today
YOLOv8m (existing `obsbot-control/sim/models/yolov8m.pt`) on captured OBS frames:
- **Live routine (40-frame continuous burst): 39/40 = 97.5% detected, mean 4.8 dancers.**
- Mixed 99-frame set: 78% ≥1 person; the 22 zeros = blackout / logo / empty-stage transitions
  (correct — no dancers present).
- Lit stages: tight head-to-toe boxes at **0.80–0.95 conf**, up to 14 dancers. Colored washes
  (red/blue/purple) handled. Weak only on heavy backlit silhouette + near-blackout.
- **Audience IS detected as persons** (off-stage frame = 12 boxes all on the crowd). ⇒ detection
  alone WILL grab the house. **Geo-fence + audience mask are mandatory, not optional.**
Reports: `detect-frames/report.json`, `detect-burst/report.json`. Annotated: `detect-*/det_*.jpg`.

## Architecture (deterministic CV director — no training needed)
Loop @ ~3–5 Hz, runs ON DART (local to OBS + camera):
```
1. GRAB   live frame  (local UVC tap or OBS GetSourceScreenshot — proven)
2. DETECT YOLO person boxes (sim/virtual_ptz.py detect_people — proven)
3. FILTER drop boxes outside the STAGE rect (pixel mask) → performers only, no audience
4. POLICY union bbox of performers → target pan/tilt/zoom (rules below)
5. CLAMP  target to stage boundary (calibrated presets)
6. DRIVE  gimbal velocity + zoom REST toward target, smoothed (proven control path)
```
~70% exists: detection + virtual-PTZ framing math in `obsbot-control/sim/`. Build = wire it to
LIVE in/out + add the policy + boundary clamp.

## Framing policy (fixes every OBSBOT fault)
- **Zoom from union bbox + fixed margin, with MAX-ZOOM CLAMP.** (OBSBOT overshot to 5–6×, clipped
  edges. Never zoom tighter than keeps the whole union + margin in frame.)
- **Frame the GROUP, ignore outliers.** Target = centroid/union of the performer cluster. A box
  beyond an outlier-distance threshold (breakaway dancer to the wing) is dropped from the union
  OR triggers hold-wide — never chase it. (OBSBOT chased one kid, lost the group.)
- **Two modes by spread:**
  - union width > ~80% stage → **hold static wide** (Home), no pan (big spread numbers; R1 proved
    static wide holds all).
  - union narrower → **yaw-only pan** to keep cluster centered at a face-readable zoom (kids
    "pan across faces"; PANFACES proved yaw-only at fixed stage pitch is safe).
- **Hysteresis / smoothing** so it doesn't jitter between modes or boxes frame-to-frame.
- **Explicit dropout handling:** 0 in-bounds detections for N frames → hold-last-good, then return
  to Home. No mystery zoom-out. (OBSBOT silently reverted to none + wide.)

## Tracking (boxes ↔ dancers) — VALIDATED live
Two layers:
- **Layer 1 tracker:** ultralytics `model.track(persist=True, tracker="bytetrack.yaml")` (ByteTrack,
  free). IoU + Kalman motion association → stable per-dancer ID, predicts through brief occlusion/
  missed detection, drops one-frame false positives by track-age.
- **Layer 2 framing:** mostly identity-FREE — union bbox / centroid of in-stage tracks, EMA-smoothed,
  deadzone P-controller on the gimbal. IDs used only for breakaway-detect (an ID diverging from the
  cluster) + stable count.

Live results (track-fast/, 30-frame burst @ 2.4 fps):
- Detection good (lit, dancers clear) → **IDs rock-stable**: 6 dancers held #1–#6 across consecutive
  frames; one ID persisted 28/30. (TRACKING-DEMO-*.jpg)
- Detection drops (dark/fast moments) → IDs churn. **Bottleneck is DETECTION recall, not the tracker.**
- **FPS matters:** 0.77 fps (1.3s burst) → IDs churn badly; 2.4 fps → stable in good light. Local UVC
  at 15–30 fps + Kalman gap-fill → solid. Screenshot-rate is too slow for production tracking.
- **False positives on light fixtures/truss get tracked** (saw a fake ID#7 on a top-right truss light).
  ⇒ run the STAGE MASK *before* the tracker so non-stage-floor boxes never become tracks.

## Stage boundary (the geo-fence the OBSBOT lacks)
- One-time venue calibration (lit stage): store presets `stageTop/Bottom/Left/Right` (front lip =
  audience just out). Presets return absolute pitch/yaw/ratio — the only readable angle on this rig.
- Pixel mask: below the stage-front line = audience → drop those detections (data: audience sits in
  the bottom band at Home pitch; off-Home down-tilt fills the frame with crowd).
- Clamp ALL gimbal/zoom moves to the rect. The yaw-pan engine sweeps within [yawL,yawR] at an
  in-bounds pitch ⇒ structurally cannot reach the house.

## Control reference (measured today)
- Camera REST `http://<camIP>/camera/sdk`. OBSBOT in OBS = input `Video Capture Device 2`.
- Gimbal: `POST /ptz/gimbalcontrol {stop,pitch,roll,yaw}` velocity. **pitch+ = DOWN, − = UP**
  (inverted vs HAL comment). yaw+ = right, − = left. ~8–14 = slow pan.
- Zoom: `PUT /ptz/zoom {ratio,speed}`. Preset recall: `PUT /ptz/preset {operation:"call",id}`.
  Preset store: `{operation:"set",id,name:<base64>}` (name REQUIRED).
- AI OFF throughout (`PUT /ai/workmode {mode:"none"}`) — we are the director.
- Exposure: keep auto; `evbias` write needs FLOAT + mode=auto (BB's int → 400 bug).

## Detect-zoom (data-backed parameter)
Detection confidence depends on apparent dancer size:
- Camera-min zoom (1.6×): stage is a small center patch in a black theater, dancers ~30px →
  conf 0.34–0.69, MISSES dancers (4-dancer line read as 1). `hires/hm*.jpg`.
- Stage-filling zoom (~2.0–2.5×, Home): 4/4 every frame at **0.79–0.85**. `hires/home*.jpg`.
⇒ **Director detects at a stage-filling zoom, NOT camera-min.** Full-res 1920×1080 helps small
subjects. If a number ever spreads wider than Home holds, detect-tile or accept lower conf — don't
just zoom to min (too wide = blind).

## Detector source (decided)
OBSBOT exposes NO detection boxes via REST (only tracking MODE + AF focus-window center). Cannot
piggyback its detector → **we run YOLO ourselves** (yolov8m validated; try yolov8n for speed).

## Open perf checks (bench)
- YOLOv8m speed on DART (GPU? else drop to yolov8n). Need ≥3 Hz end-to-end.
- Frame-grab latency: local UVC tap vs OBS WS.
- Smoothing constants (carry from sim/framing_rules.py; tune live).

## Test assets captured today (for offline dev)
- `burst/` 40-frame continuous routine clip (temporal smoothing test).
- `frames/` 99 frames across all lighting + subject types (detection robustness).
- `detect-*/` annotated detections + JSON (ground-truth detection baseline).
- Stagecoach Sunday = second venue/lighting set + lit-stage boundary calibration.
