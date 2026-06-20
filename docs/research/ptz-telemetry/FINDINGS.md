# OBSBOT Framing Findings — 7Attitudes (live, 2026-06-20)

Method: OBS WebSocket `GetSourceScreenshot` (read-only, source `Video Capture Device 2` = OBSBOT)
+ camera REST via DART (`192.168.2.91/camera/sdk`) + telemetry logger.
Camera NOT in live stream → free rein to drive.

## Toolchain (reusable)
- OBSBOT in OBS = input **`Video Capture Device 2`** (IDed by zoom-nudge: only feed that moved).
- Screenshot via tunnel `ssh -L 4455:127.0.0.1:4455 dart` + `obsshot.py shot "Video Capture Device 2" out.jpg`.
- Preset recall = `PUT /ptz/preset {operation:"call",id:1}` (op is **call**, not "recall").
- Home = preset 1: pitch 6.07, yaw -29.7, roll -3.45, ratio **2.5** (wide full stage).
- AI group = `PUT /ai/workmode {mode:"humanTrackingGroupMode"}`; tier = `PUT /ai/human/zoomtype {type:...}`.
- Tier set returns **500 unless AI workmode already locked on subjects** (no clear subject → wm reverts `none`).

## R1 — LARGE GROUP number (~10 dancers, full-stage spread, dynamic)
| Step | Mode | Zoom | Result | Frame |
|---|---|---|---|---|
| 0 | Static Home wide, AI off | 2.5× | ✅ holds all, margin both sides | R1-largegroup-00 |
| 1 | AI group engage (default) | 4.7× | ❌ auto-zoomed in, clipped right-edge dancer | R1-largegroup-01 |
| 2 | AI group + tier P24 | 5.0× | ❌ still clipping edges | R1-largegroup-02 |
| 3 | AI group + P24 (steady) | 5.0× | ❌❌ **panned to chase a breakaway dancer to stage-left, abandoned whole group** | R1-largegroup-03 |
| 4 | Revert static Home wide | 2.5× | ✅ holds all again | R1-largegroup-04 |

### Key corrections to prior assumptions
1. **`P24` is NOT a fixed 2.6×.** It's a headcount/portrait target; AI derives zoom from the live
   subject bounding box. Tight/close group → ~2.6×; wide dynamic spread → 5.0×. Tier alone does
   NOT guarantee a safe-wide shot. (Crash-session "P24=2.6×" was measured on a tighter group.)
2. **AI group mode chases outliers.** A breakaway dancer pulls the whole frame off the ensemble.
   So the operator's "hold wide + AI pan-only" fallback also fails for big numbers — pan-only would
   still chase the outlier.
3. **For a large spread group the correct behavior is: static Home wide (2.5×), AI OFF.** No zoom,
   no pan. It already frames the entire ensemble with margin.

### Emerging cadence rule (to verify on solo/small numbers)
- Large group (full-stage spread) → **static Home wide, AI off**. Do not zoom, do not track.
- Solo / duet / trio / small group → AI tracking likely useful (zoom-in adds value, low outlier risk).
  DATA STILL NEEDED: capture an AI sweep on a solo + a small group to confirm AI holds them.
- If we keep AI for small numbers, we likely need a **max-zoom clamp** so it never exceeds a safe
  ratio even when its tier math overshoots.

## R2 — SMALL KIDS GROUP — operator wants "PAN ACROSS FACES" (not static wide)
Operator directive: for a kids group, don't hold a static wide (faces tiny) — slowly **pan the
camera across their faces**. AI is wrong (chases). Answer = scripted gimbal pan, AI off.

PROVEN MECHANIC (frames PANFACES-*):
- AI OFF (`/ai/workmode none`).
- Zoom **~7×** (manual `PUT /ptz/zoom {ratio:7,speed:8}`) → little kids' faces readable, full body.
- **Tilt DOWN to center faces** — `POST /ptz/gimbalcontrol {pitch:+22,...}`. ⚠️ PITCH SIGN INVERTED
  on this rig/preset: **positive pitch = DOWN, negative = UP** (opposite of RestCamera.ts comment
  `pitch<0=down`). Verify per mount; here Home preset roll=-3.45 may explain it.
- Slow pan = `POST /ptz/gimbalcontrol {yaw:±8}` held ~1.5s then `{stop:true}`. yaw+ = right, yaw- = left.
  ~8 velocity = smooth slow traverse. Traversed the row cleanly, faces in frame.
- Endpoint is **POST** /ptz/gimbalcontrol (PUT → 404).

### Pan-faces cadence (VERIFIED LIVE — the rebuild recipe)
1. Next → snap Home wide (preset 1, establish whole group). AI off.
2. Zoom in at **Home's pitch** (~3.6–5×). Do NOT free-tilt down.
3. **Yaw-ONLY pan** L↔R across the stage band, slow (`POST /ptz/gimbalcontrol {yaw:±10–14}`,
   hold then `{stop:true}`). Stays on the performer band, faces readable, no clipping.
4. Big spread/dynamic group instead → just hold Home wide static (R1).

⚠️ **DO NOT tilt down to chase faces live.** Verified failure (PANFAIL-tiltdown-overshoot-into-
audience): a down-tilt overshoots the stage-front edge straight into the AUDIENCE (little kids sit
near the apron, close to the house). The safe rig is: pitch FIXED at stage level (Home's 6°),
vary zoom + yaw only. If a lower face-level pitch is wanted, store it as a PRESET (bounded pose)
and recall it — never live free-tilt.
- pitch sign on this rig: **positive = DOWN, negative = UP** (inverted vs RestCamera.ts comment).

## EXPOSURE — root cause of "can't change" (operator complaint)
- `PUT /image/exposure/auto/compensation {evbias:<float>}` works ONLY when:
  (a) exposure mode = **auto**, and (b) value is a **FLOAT** (`-1.7` OK; int `-2` → **400**).
- BB UI "can't change exposure" = it's sending an **int** (or value while mode≠auto) → 400. FIX in BB:
  send evbias as float + ensure mode=auto before write.
- `value=...` field name → 400 (must be `evbias`). GET compensation 500s if mode≠auto.
- The live overexposure was mostly the intense RED stage wash maxing auto-exposure (evbias already
  -1.7). Blue/green numbers exposed fine. evbias is a weak lever vs blown highlights.
- NOTE: left camera in expmode=**manual** during testing — restore to auto for the operator.

## AI FINE-TUNE DATASET (everything needed to tune the OBSBOT AI)

### Full tunable surface (REST)
| Knob | Endpoint | Values | Notes |
|---|---|---|---|
| Work mode | `PUT /ai/workmode {mode}` | none · humanTrackingSingleMode · humanTrackingGroupMode · animal*/object* | group = multi; single = onlyme lock |
| Framing tier | `PUT /ai/human/zoomtype {type}` | normal · shot · halfBody · P7 · P9 · fullBody · P16 · **P24(widest)** | TARGET only; actual zoom is bbox-derived. Set 500s unless AI locked. Untested wider candidates: P7/P9 |
| Track speed | `PUT /ai/trackspeed {speed[,horizontalSpeed,verticalSpeed]}` | superLazy · lazy · slow · fast · crazy · customized(H/V 1–10) | crazy = violent, grabs audience |
| Only-me | `PUT /ai/human/onlyme {enable}` | bool | true = lock 1 subject; false = group |

### Behavior characterized live (the tuning truth)
1. **Auto-zoom overshoots.** Group mode derives zoom from subject bbox → 4.7–6.1× on full-width
   kid lines, clips edge dancers. P24 (widest tier) still gave 5.0–6.1×. Tier ≠ fixed ratio.
2. **Chases breakaways.** One dancer running to the wing pulls the whole frame off the ensemble
   (R1: framed 1 kid at stage-left, lost the group).
3. **No audience/performer discrimination + no stage geo-fence.** trackspeed=crazy → AI locked
   onto AUDIENCE faces and swung/tilted DOWN off the stage into the dark house seats
   (frame AI-FAIL-trackspeed-crazy-locked-AUDIENCE-swung-offstage). Instant, catastrophic.
4. **Drops out unpredictably.** Subjects unclear/dim → reverts mode→none + zooms to ~2.5 wide,
   abandoning the track mid-routine.
5. trackspeed: crazy=aggressive (audience grab); slow/lazy=calmer but the bbox-zoom + boundary
   problems remain regardless of speed.

### The missing knob (gap)
- **No tracking REGION / pan-tilt LIMIT endpoint exists** in the REST surface. Without a stage
  geo-fence the AI cannot be constrained to performers-only. This is the structural reason the
  built-in AI is unsafe at a venue with the audience in shot.

### VERDICT for rebuild
- **Built-in AI group mode = NOT viable here.** Overshoots zoom, chases outliers, grabs audience,
  no boundary, drops out. No amount of tier/trackspeed tuning fixes the boundary + bbox-zoom faults.
- **Big spread group → static Home wide (2.5×), AI off.** (R1 proved it holds all, margin.)
- **Kids group / "pan across faces" → SCRIPTED gimbal pan, AI off** (PANFACES mechanic): zoom face
  tier + tilt down + slow yaw sweep. Predictable, stays on stage, never grabs audience. This is the
  direction to BUILD — a deterministic pan engine, not the OBSBOT AI.

## STAGE BOUNDARY (operator: "draw the stage as boundary")
The OBSBOT has NO geo-fence endpoint → the boundary must be enforced by OUR control layer:
clamp every pan/tilt/zoom move to the stage rectangle. Absolute angle is NOT live-readable on
this rig, BUT **presets store absolute pitch/yaw/roll/ratio** — so the boundary = a set of stored
edge poses, and the rebuild clamps within them.

### Method (verified)
`PUT /ptz/preset {operation:"set", id, name:<base64>}` stores the live absolute pose.
`GET /ptz/preset` → `presetList[]` returns `{id,pitch,yaw,roll,ratio,name}`. Read back = the angle.
- `set` REQUIRES a `name` (base64); without it → 400 "[name] Key not found".

### Measured reference poses
| Pose | pitch | yaw | ratio | meaning |
|---|---|---|---|---|
| Home (preset 1) | 6.07 | -29.7 | 2.5 | stage center, safe wide (audience only a sliver at bottom) |
| sample down (preset 10) | 1.22 | -29.7 | 5.9 | tilted down from home |
- **Pitch axis: higher value = UP, lower = DOWN.** (Home 6.07 center; down-tilt lowers it.)
- Yaw -29.7 = stage-center bearing from this camera position.
- At wide zoom (~1.7) tilted down, the stage occupies the UPPER band and the AUDIENCE fills the
  lower ~half (frame BOUNDARY-widedown). So the **bottom/front boundary** (audience exclusion)
  sits just below Home's pitch — a down-tilt of more than a few degrees from Home crosses into the
  house. Keep tilt ≥ ~Home pitch for safety; store an exact front-edge preset on a LIT stage.

### Rebuild boundary spec
1. Calibration step (operator, once per venue, lit stage): aim to each stage edge, store presets —
   `stageTop`, `stageBottom`(front lip, audience just out), `stageLeft`, `stageRight`. Read pitch/yaw.
2. Clamp: pitchMin=stageBottom.pitch, pitchMax=stageTop.pitch, yawMin/Max from L/R. Every gimbal
   move (manual OR any auto-pan) clamped to [min,max]. Zoom clamped so the frame bottom never
   crosses stageBottom at the current pitch.
3. The pan-faces engine sweeps yaw within [yawMin,yawMax] at a fixed in-bounds pitch — structurally
   cannot reach the audience.

## TODO this show
- [ ] Capture AI sweep on a SOLO (does single-subject track hold head-to-toe, no overshoot?).
- [ ] Capture AI sweep on a SMALL group (3-5) — does P24/P16 hold without chasing?
- [ ] Note per routine whether it's static-wide-correct vs AI-useful.
