# Camera Director — Build Plan + Session Capture (2026-06-20)

Origin: live 7Attitudes recital (Sat 2026-06-20) used as a data-capture + prototyping session,
followed by an architecture discussion. Goal: replace the OBSBOT Tail 2 built-in AI (which fails
on groups) with our own camera director, controllable by **plain-English camera rules**, shared by
BroadcastBuddy first and CompPortal later.

Companion docs (same dir as the data): `docs/research/ptz-telemetry/FINDINGS.md` (raw findings) and
`DIRECTOR-BUILD-SPEC.md` (build spec + detection validation). This file = the integrated plan +
ruthless session log so nothing is lost.

---

> **The DEFINITIVE behavior + architecture spec is the ADDENDUM at the bottom of this file
> (design session 2026-06-20 PM). Sections 1–6 are the original session log + first-pass plan;
> the addendum supersedes where they differ.**

## 0. The one-line conclusion
OBSBOT native AI tracks a SINGLE dancer excellently but cannot frame GROUPS (overshoots zoom,
clips edge dancers, chases breakaways, locks onto the AUDIENCE, has no stage geo-fence, and silently
drops out). We CAN build our own director — proven live today — and the right design is a **hybrid
router**: solos → OBSBOT AI; groups → our director; both driven by a **deterministic policy profile
compiled from the operator's plain-English rules**.

---

## 1. SESSION A — live R&D log (2026-06-20 ~12:15–13:40 EDT)

### Setup discovered / built
- Camera = OBSBOT Tail 2 at `http://192.168.2.91/camera/sdk` (REST over Wi-Fi via DART).
- OBS consumes the camera UVC; OBSBOT appears in OBS as input **`Video Capture Device 2`** (IDed by
  nudging zoom and seeing which OBS source moved — the other two dshow inputs are static house cams).
- **Read-only vision without fighting the UVC feed:** OBS WebSocket v5 (`127.0.0.1:4455`, pw `123456`)
  `GetSourceScreenshot` → we see exactly what the camera sees, zero disruption to the live stream.
  Reached from the dev box via SSH tunnel `ssh -L 4455:127.0.0.1:4455 dart`. Tool: `obsshot.py`.
- Control via DART SSH → PowerShell → camera REST. Tool: `cam.sh`.
- Two passive loggers ran: 2s telemetry JSONL + periodic frame capture.

### What we did, in order, and what each proved
1. **Tier sweep on a large group (R1).** Engaged `humanTrackingGroupMode`; swept tiers.
   - AI engage auto-zoomed 2.5→4.7× → clipped the right-edge dancer.
   - Tier P24 → 5.0× (NOT the 2.6× a prior session measured) → still clipping. **Tier is NOT a
     fixed ratio — the AI derives zoom from the subject bounding box, so a wide spread overshoots.**
   - At P24/5.0× the AI then **panned to chase a breakaway dancer to the wing and abandoned the
     whole group** (framed 1 kid, lost the ensemble).
   - Reverted to static Home wide (2.5×) → held all dancers with margin. **Static wide works; AI
     group framing does not.**
2. **Exposure ("can't change") root-caused.** `PUT /image/exposure/auto/compensation {evbias}`
   works ONLY if exposure mode=auto AND evbias is a **FLOAT** (`-1.7` OK; int `-2` → HTTP 400).
   BB's UI sends an int → 400 → "can't change." Also `value=` field name → 400 (must be `evbias`);
   GET compensation 500s if mode≠auto. The live overexposure was mostly the intense RED stage wash
   maxing auto-exposure (evbias was already -1.7); blue/green numbers exposed fine.
3. **Pan-across-faces (operator's stated want for kids groups).**
   - First attempt free-tilted DOWN to center faces → **overshot the stage-front edge into the
     AUDIENCE** (little kids sit near the apron). Verified failure.
   - Working mechanic: AI off, zoom to a face-readable level, keep pitch FIXED at stage level
     (Home's), **yaw-ONLY pan** across the row → stays on the performer band, never the house.
   - Rig quirk: **pitch sign inverted vs the HAL comment — positive pitch = DOWN, negative = UP.**
   - Endpoint is **POST** `/ptz/gimbalcontrol` (PUT → 404). Preset recall op = `"call"` (not
     "recall"); `set` requires a base64 `name` field.
4. **AI fine-tune probe.** Mapped the full tunable surface: `workmode`, `human/zoomtype` (tiers
   normal→shot→halfBody→P7→P9→fullBody→P16→P24), `trackspeed` (superLazy→crazy + custom H/V 1–10),
   `human/onlyme`. trackspeed=crazy + group → AI grabbed audience faces and swung off-stage. No
   REST endpoint exposes detection boxes (only tracking mode + AF focus window) and **no geo-fence
   exists** → built-in AI cannot be constrained to the stage.
5. **Detection validation (the build go/no-go).** YOLOv8m (`obsbot-control/sim/models/yolov8m.pt`)
   on captured OBS frames:
   - Live routine (40-frame burst): **97.5% frames detected, mean 4.8 dancers**, boxes tight
     head-to-toe at 0.80–0.95 conf under red/blue/purple washes.
   - **Audience is detected as persons** (12 boxes on the crowd in an off-stage frame) → geo-fence
     + house mask are mandatory.
   - **Detect-zoom matters:** camera-min (1.6×, stage tiny in a black theater) → 0.34–0.69, misses
     dancers; stage-filling (~2.0–2.5×) → 4/4 every frame at 0.79–0.85. Detect at stage-filling zoom.
6. **Tracking validation.** ultralytics `model.track(persist=True, bytetrack)` → stable per-dancer
   IDs when detection is good (6 dancers held #1–#6 across consecutive frames). Degrades when
   DETECTION drops (dark/fast) — **tracking quality follows detection quality**. FPS matters: 0.77
   fps churns IDs, 2.4 fps holds in good light; production needs local UVC at 15–30 fps + Kalman
   gap-fill. A truss light got tracked as a false ID → run the stage mask BEFORE the tracker.
7. **Live closed-loop director (POC).** `director_persist.py`: grab OBS frame → YOLO → stage mask
   (drop top-15% truss, bottom-8% apron, <4%-tall noise) → union bbox → recenter (pan/tilt) +
   zoom-to-fill → drive PTZ. Ran LIVE on real numbers:
   - Converged on a 10-dancer group: centered to ~frame-center, zoomed 2.5→3.9× holding full width,
     no clip. (OBSBOT clipped the same kind of group.)
   - Held the full-cast beach **finale** (~13–17 detected) wide — pulled out to keep everyone when
     they spanned 82% width. "Never lose a dancer" working.
   - Operator policy locked in: **always subtle slow push-in, recenter every step, pull out fast if
     the group spreads / nears an edge.**

### Honest retro
Strong technical outcome; weak responsiveness. Operator had to prod ("camera isn't moving") four
times — too much analysis/doc-writing before putting visible motion on screen. Several avoidable
fumbles (PUT vs POST, preset name field, float evbias, pitch sign) that reading `RestCamera.ts`
first would have prevented. Lessons: drive the camera early + continuously; read the control layer
before driving it; narrate less during a live show.

---

## 2. SESSION B — architecture / vision (operator)

Operator's stated intent:
- Build the director into **BroadcastBuddy now**, then into the **CompPortal repo later**.
- **Semantically describe camera rules + movement in plain English**, and have the system follow it.
- **OBSBOT native is GOOD at single-dancer tracking** — keep using it for solos. It only failed to
  reproduce what's needed for GROUPS.

### Resulting architecture

**Hybrid, route by routine type:**
- Solo / duet → delegate to **OBSBOT AI** (`humanTrackingSingleMode`/onlyme) — it's genuinely good.
- Group (3+ / spread) → **our director** (detect/mask/track/union/boundary/push).
- Router input = routine size. BB derives dancerCount from the routine name today; CompPortal has it
  natively (`Routine.sizeCategory`/`dancers`) — cleaner there.
- TODO (gap): we validated GROUP behavior thoroughly but only inferred solo quality — capture solo
  OBSBOT tracking with our own eyes/data before trusting the solo branch.

**Semantic rules → deterministic profile (the key idea):**
- Operator describes intent in plain English (e.g. "big groups stay wide and slowly drift, never
  lose anyone; solos let the OBSBOT chase tight and close; pan across faces for the little ones").
- **Claude compiles** that into a deterministic **policy profile** (JSON). The **runtime loop stays
  fully deterministic — NO LLM in the live control path** (latency + nondeterminism are unacceptable
  during a live show). "Deterministic form, LLM eyes."
- Re-describe anytime → recompile. Operator never edits numbers.

Proposed profile schema (draft):
```json
{
  "venue": { "boundary": { "stageTop": {"pitch":..,"yaw":..},
                            "stageBottom": {"pitch":..,"yaw":..},
                            "stageLeft": {"yaw":..}, "stageRight": {"yaw":..} },
             "audienceMaskBottomFrac": 0.92, "trussMaskTopFrac": 0.15 },
  "defaults": { "detectZoom": 2.5, "fps": 15, "neverLose": true,
                "smoothing": { "centerGainX": 32, "centerGainY": 42, "deadzonePx": 35 } },
  "byType": {
    "solo":  { "brain": "obsbot", "obsbotMode": "single", "tier": "fullBody", "trackspeed": "fast" },
    "duet":  { "brain": "obsbot", "obsbotMode": "single", "tier": "fullBody" },
    "group": { "brain": "director", "framing": "fill", "fillTargetH": 0.65,
               "pushRatePerSec": 0.03, "pullW": 0.80, "pullH": 0.86, "panMode": "recenter" },
    "kids":  { "brain": "director", "framing": "panFaces", "faceZoom": 4.5,
               "panSweepYaw": 10, "pitch": "stageLevel" }
  }
}
```
(Field names illustrative; finalize during build.)

**Where it lives:**
- Director core (detect → mask → track → policy → boundary-clamp → drive) + the router go in the
  shared **`@compsync/camera`** package (repo `obsbot-control`). BB consumes it first; CompPortal
  inherits the same brain (matches the existing dual-app port plan).
- Runs as a service on DART, **local UVC capture** for real FPS (not OBS-screenshot-over-tunnel,
  which capped at ~2 fps in the POC).
- Per-venue one-time **stage-boundary calibration** (store edge presets, read absolute pitch/yaw).

---

## 3. Control reference (REST quirks — read before touching the camera)
- OBS source for the OBSBOT = `Video Capture Device 2`. OBS WS read-only screenshot = non-disruptive.
- Gimbal: **POST** `/ptz/gimbalcontrol {stop,pitch,roll,yaw}` velocity. **pitch+ = DOWN, − = UP**
  (inverted vs HAL comment). yaw+ = right, − = left. ~8–14 = slow pan; send `{stop:true}` to halt.
- Zoom: `PUT /ptz/zoom {ratio,speed}` (low speed = subtle). Min effective ratio ~1.6–2.0.
- Preset recall: `PUT /ptz/preset {operation:"call",id}`. Store: `{operation:"set",id,name:<base64>}`
  (`name` REQUIRED, else 400). `GET /ptz/preset` → `presetList[]` w/ absolute pitch/yaw/roll/ratio
  (the ONLY way to read absolute angle on this rig).
- AI: `PUT /ai/workmode {mode}` (none|humanTrackingSingleMode|humanTrackingGroupMode|...);
  `PUT /ai/human/zoomtype {type}` (tier; 500s unless AI locked on a subject);
  `PUT /ai/human/onlyme {enable}`; `PUT /ai/trackspeed {speed[,horizontalSpeed,verticalSpeed]}`.
- Exposure: `PUT /image/exposure/auto/compensation {evbias:<FLOAT>}` needs mode=auto + float.
- AI reverts to `none` with no clear subject; tier set fails then. Plan for re-acquire.

---

## 4. Phased rollout
**Phase 0 — bench harness (no live show):** TV plays recorded dance footage (today's OBS recording),
OBSBOT wide on it; run the director against it to tune gains/push/pull/mask freely. Validated
approach (YOLO detects on-screen people). For pure software dev, run against the video files directly
(`sim/` virtual-PTZ). Caveat: TV is 2D — can't rehearse real stage depth or the audience boundary.

**Phase 1 — director core in `@compsync/camera`:** port `director_persist.py` logic to the package
(detect/mask/track/union/clamp/drive), local UVC capture, perf check (yolov8m vs yolov8n on DART;
need ≥3 fps, ideally 15+). Output: a runnable group director.

**Phase 2 — hybrid router + profile:** routine-type routing (solo→OBSBOT, group→director);
load a JSON policy profile; semantic-description→profile compiler (Claude-assisted, offline).
Validate solo OBSBOT branch with real capture.

**Phase 3 — BB integration:** wire the director as a BB service; venue boundary-calibration UI;
operator describes rules → profile → live. (Also fix the BB exposure int→float bug while here.)

**Phase 4 — CompPortal:** inherit `@compsync/camera`; feed native `sizeCategory`/`dancers` to the
router (no name-parsing needed).

---

## 5. Open questions / risks
- Solo OBSBOT quality unverified by us — capture before trusting the solo branch.
- DART compute for YOLO at FPS (GPU? yolov8n fallback?). Frame-grab latency (local UVC vs OBS WS).
- Detection in heavy backlit silhouette + near-blackout is weak (correctly near-empty, but transitions
  cause dropout) — needs Kalman gap-fill + hold-last-good tuning.
- Stage-boundary calibration must be quick + repeatable per venue (lit-stage step).
- Smoothing: avoid jitter (deadzone + EMA) vs. responsiveness to fast movement — tune on the TV rig.
- Semantic-profile schema needs to be expressive enough for real director language without becoming
  a programming language. Iterate with the operator on real phrasings.

## 6. Assets from today (on disk; raw dirs gitignored)
- `docs/research/ptz-telemetry/`: FINDINGS.md, DIRECTOR-BUILD-SPEC.md, obsshot.py, cam.sh, detect.py,
  track.py, director_persist.py, frames/ (curated evidence, committed), numbers/burst/fastburst/hires
  (raw), detect-*/track-* (annotated + JSON), telemetry jsonl. `.venv` = local YOLO env (gitignored).
- Next-venue data: **Stagecoach (Sun)** = 2nd lighting set + lit-stage boundary calibration + solo
  capture.

---

# ADDENDUM (design session 2026-06-20 PM) — DEFINITIVE SPEC

This addendum is authoritative. Captured from the operator's creative direction; decisions made
inline (operator delegated the open calls).

## A. Definitive behavior spec (the contract)

### State machine (per routine)
1. **WIDE** — full calibrated stage shot. Every routine STARTS here. Also the universal fallback.
2. Dance begins → **ZOOM-IN** with genre character → frame up.
3. **SOLO** → frame = full body + small safety room → **chase** the dancer around the stage.
   Routine ends → return to WIDE.
4. **GROUP** (any size) → genre zoom-in → frame the group → **motion-track + keep ALL in frame**,
   subtle push in/out for life. Routine ends → return to WIDE.

### Genre = the move personality (drives zoom-in speed + push dynamics)
| Genre | Character |
|---|---|
| Hip hop | punchy, quick zoom; snap recenter; hit-driven |
| Lyrical / ballet | slow, controlled; long eases; symmetry/line respect (ballet) |
| Jazz / tap | medium |
| (unknown) | neutral default = medium |

### Framing target — the "80% rule"
Scale zoom so dancers reach ~**80% of the frame edge** (≈10% margin each side) on the limiting
dimension → frame always *full*, never clipped. Continuously readjust as they move:
- **Huddle** (small union) → zoom IN until they fill (~80%).
- **Spread / run wide** (large union) → zoom OUT until ~80% — or to full WIDE if they exceed it
  (never clip).
Two zoom layers, kept separate:
- **Macro** = fit the union to 80% (huddle/spread).
- **Micro** = subtle push in/out for life (beat-timed; do NOT conflate with macro).

### Hard guardrails (priority over all framing)
1. **Lost subject/group → snap to WIDE immediately** (1–2 frame debounce so a single-frame blip
   doesn't strobe; effectively instant). WIDE disappoints no one; a lost dancer does.
2. **Never chase a splitter.** A dancer breaking from the group → **zoom OUT to fit everyone incl.
   the splitter.** Never abandon the group for one.
3. **Count safety check** (only when count is known): expected N from metadata. If framing fewer
   than N → someone's lost → **WIDE**. BUT drive this off the **tracker (IDs), not raw detections**,
   and distinguish:
   - tracked dancer near the 80% edge then vanished → left frame → **widen**;
   - count dropped but IDs alive + everyone mid-frame → **occlusion (huddle)** → hold/zoom in
     (do NOT fire wide — this is the moment you want tight).
4. **Wide-as-recount** resolves staggered entrances/exits: if detected < expected, widen toward
   full-wide; at full-wide the whole stage is visible — if still < expected, the missing dancers are
   genuinely offstage → hold WIDE calmly until they return. Wide = safety net AND truth-check.
5. When in doubt → WIDE.

### Solo note
Solo count-check = "1 in frame." OBSBOT native single-track is good at the chase → solo MAY just use
OBSBOT + our wide-guardrail on top; group framing is fully ours. (Verify OBSBOT solo quality with our
own capture before committing — not yet done.)

## B. Architecture & ownership — three layers

**1. Engine (the crown jewel) → owned in `@compsync/camera` (repo `obsbot-control`).**
Pure CV director, metadata-AGNOSTIC: detect → track → frame → state machine → guardrails → genre
move-profiles → beat timing → drive PTZ. Built ONCE, versioned, both apps depend on it. Neither app
"owns" the brain — they consume it.

**2. Context provider (thin adapter) → per app.** Engine consumes one normalized interface, all
fields optional:
```
RoutineContext {
  expectedDancerCount?   // CompPortal: exact (entry_participants). BB: name-parse/manual/operator-tag. else undefined
  genre?                 // CompPortal: dance_categories.name. BB: operator tag. else undefined
  beatMap?, musicPosMs?  // either app: if a music file exists (pre-analyzed)
  title?, order?
}
```
- **CompPortal** owns its provider (richest): `getLiveState` → genre + exact count + music beat-map +
  order, plus the photo-per-routine tie-in.
- **BroadcastBuddy** owns its provider (degraded): count via name-parse or operator tag; genre via
  operator tag if set; else pixel-only.

**3. Host service → per deployment.** The running process on DART (camera REST + OBS + context feed).
Same engine; CompPortal feeds competition state, BB feeds recital session state.

### Graceful degradation (answers "not exclusive to rich data")
| Have | Engine behavior | Lacking it |
|---|---|---|
| genre | full per-genre personality | neutral medium default |
| count | count-safety-check (lose one → wide) | edge-detect + tracker + wide-as-recount only |
| music file | beat-sync | smooth time-based moves |
Pixel-only floor is always: frame group, 80%-fit, never-clip, lost→wide. Metadata only adds smarts.

### DECISIONS MADE (operator delegated)
- Engine home = **`@compsync/camera`**. Build engine-first against **CompPortal's data shape** (the
  superset); BB's provider just "supplies less."
- **Enable operator genre/count tagging in BB session triggers** (recommended ON) so recitals can
  opt into beat-sync + genre moves. Cheap; closes most of the recital gap.
- **Drop multi-crop-from-wide** — PTZ is committed for the foreseeable; single PTZ delivers stream
  + per-routine photos.
- CompPortal is the **lead consumer** (product, richest data, full feature expression); BB is the
  second consumer (recitals, thinner context, same engine).

## C. Beat-sync (confirmed in scope)
- **Pre-analyze the music FILE, don't do realtime DSP.** Music known in advance (`musicFileUrl`).
  Offline per routine (cached): beat grid + downbeats, onset/hit times, RMS energy envelope, section
  bounds (intro/build/drop/breakdown/finale). Tools: `librosa` (fast) or `madmom` (better downbeats).
- **Runtime:** playback position → musical clock → schedule moves on upcoming beats/sections.
- **Anticipation is the unlock:** start a move EARLY (lead time = move duration) so it LANDS on the
  beat — reacting to a beat is always late/robotic.
- **Style × beat:** style = move vocabulary; beat = timing. Hip hop punch-zoom ON the drop; lyrical
  push eases across the phrase + settles still on the resolution; energy envelope modulates speed/
  zoom amount.
- **Fallback:** no beat data → smooth time-based moves. Beat-sync is enhancement, never a dependency,
  always subordinate to guardrails.
- **VERIFY (gating risk):** playback-position precision in GameDay/liveCompetition timing must be
  ~±50–100ms for tight sync. Check how precise + update rate before committing to tight sync.

## D. CompPortal wiring (verified file:line)
- Per-routine live data hook: **`liveCompetition.getLiveState`** (`src/server/routers/
  liveCompetition.ts:2128`) already returns **`category` (dance_categories.name = genre)** + title +
  `musicDurationMs` + timing for the live routine.
- ADD to that query's include: `entry_size_categories {min_participants,max_participants}` and/or a
  `entry_participants.count(where entry_id)` → exact dancer count. (`competition_entries`
  `schema.prisma:643`; `entry_participants` `:1405`; `entry_size_categories` `:1430`;
  `dance_categories` `:1091`.)
- **Genre is FREE-TEXT per tenant** (not an enum) → engine needs a **normalization map** (raw string
  → canonical genre → move profile) + safe default for unknown. Required or the killer feature
  no-ops on a typo ("Hip Hop" vs "hip-hop").
- **Photos per routine:** OBSBOT UVC → OBS (stream) + per-routine frame grab → existing CompPortal
  gallery/analysis pipeline; tag each grab with `current_entry_id` (from `live_competition_state`
  `schema.prisma:2753`) → photos auto-associate to the routine. One camera, both deliverables.
- No dedicated PTZ/camera-control code exists in CompPortal yet (verified grep + graphify); the
  "camera" references are the photo/EXIF gallery pipeline. Camera fields (IP/presets/boundary) get
  added during the port.

## E. Updated rollout (supersedes §4)
- **P0 bench:** TV plays recorded footage (today's + Stagecoach) → tune engine (gains, 80%-fit, push,
  guardrails, count-check-via-tracker) off-show. Software-only: run engine on the video files.
- **P1 engine core** in `@compsync/camera`: vision pipeline (consider yolov8-**pose** for arms/lifts),
  state machine, 80% framing, guardrails, local UVC capture, perf check on DART (yolov8m vs n; ≥3fps,
  aim 15+). Build against CompPortal's RoutineContext superset.
- **P2 genre + beat:** genre move-profiles + normalization map; offline music beat-analysis;
  beat-sync timing (after verifying playback precision).
- **P3 CompPortal integration:** provider off `getLiveState` (+ size/count), photo-per-routine
  tagging, venue boundary calibration. Lead deployment.
- **P4 BroadcastBuddy provider:** degraded context + operator genre/count tagging in session
  triggers; fix the BB exposure int→float bug.
- **Ongoing — the moat:** every show → labeled footage → fine-tune a **dance-under-stage-light**
  detector + a framing-preference model from operator thumbs-up/down. Compounds per season.
