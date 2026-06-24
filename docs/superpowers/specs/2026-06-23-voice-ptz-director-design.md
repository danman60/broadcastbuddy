# Voice-Driven PTZ Director — Design (v1)

**Date:** 2026-06-23
**Project:** BroadcastBuddy
**Status:** Approved design, pre-implementation

## Goal

Operator directs the two OBSBOT PTZ cameras by **spoken command** during a live show.
Hold a push-to-talk key, speak a bounded command ("camera two push in", "shot three",
"sweep shot two to shot three", "track"), release — BB executes the move on the named
camera. Offline, low-latency, zero accidental fires.

## Scope (v1)

**IN:**
- Deterministic spoken verbs mapped to existing `cameraDirector` primitives.
- Targets = **numbered "shots"** (saved PTZ presets) per camera, with optional typed labels.
- Two cameras, addressed by "camera one / camera two" prefix (bare verb = active camera).
- Push-to-talk via a Stream Deck "Hold to Direct" key.
- Windows SAPI grammar-based recognition (offline, bounded grammar).

**OUT (v1, explicitly deferred):**
- Vision / subject-semantic targeting ("zoom in on **the drummer**" by recognizing a
  person). v1 cannot identify *who* anyone is. A "drummer" shot is a **fixed camera
  position** the operator saved and labeled — not a tracked human. Moving subjects are
  handled by framing a shot then saying "track" (existing OBSBOT AI lock), which follows
  whoever is in frame without knowing who they are.
- LLM-based natural-language parsing. Grammar is bounded and deterministic.
- Voice-driven shot *labeling* (labels are typed in the UI, not spoken).

## Why this model

Two target types cover the real shows without any vision/LLM:
1. **Fixed spots → named preset slots.** On a band/recital stage, positions don't move
   (drum kit is always stage-right). Aim the camera once, save as a shot, optionally
   label it. The spoken word recalls a saved pose. SAPI never "understands" the word — it
   is an entry in a bounded grammar mapping to a preset slot.
2. **Moving people → the "track" verb.** Frame a shot (or manual aim), say "track" → hands
   off to the camera's existing person-lock (OBSBOT AI), which follows the human in frame.
   No identity needed.

The only thing genuinely sacrificed is singling out one *specific moving* person among
several by description when their position is not fixed. Point-frame-then-track covers the
rest. Accepted for v1.

## Architecture

```
Stream Deck "HOLD TO DIRECT" key
   │ keyDown / keyUp  (existing plugin → WS hub)
   ▼
BB main (Electron, DART/Windows)
   │  - keyDown: helper "listen on"
   │  - keyUp:   helper "listen off → return best match"
   │  - owns grammar = fixed verbs + current shot labels per camera
   │  - rebuilds + pushes grammar to helper whenever shot labels change
   ▼
voice-helper.exe  (C#, System.Speech.Recognition, bundled in NSIS installer)
   │  - loads SAPI grammar pushed by BB
   │  - recognizes ONLY while key held
   │  - returns {camera, verb, target, confidence} over stdio / named pipe
   ▼
BB command router (voiceDirector.ts)  →  existing cameraDirector primitives
   ▼
feedback: BB heard-toast + deck key flash; reject tone below confidence floor
```

### New components

| Component | Where | Job |
|---|---|---|
| `voice-helper.exe` | new C# project, bundled | SAPI grammar recognition, stdio/pipe protocol, listen on/off, return best match + confidence |
| `voiceDirector.ts` | `src/main/services/` | helper process lifecycle (launch/relaunch/health), grammar build from settings, command→primitive mapping, confidence gating, feedback emit |
| Deck "Hold to Direct" action | streamdeck-plugin | keyDown→`voicePttDown`, keyUp→`voicePttUp` over WS hub; green/red flash on result |
| WS hub cases | `wsHub.ts` | `voicePttDown` / `voicePttUp` |
| Voice/Shots panel | `src/renderer/components/` | per-camera shot list, save-as-shot, typed label, mic device picker, confidence-floor slider, push-duration tunables |
| Settings | `shared/types.ts`, `settings.ts` | shot labels per camera, mic device id, confidence floor, slow-push duration/factor |

Everything downstream of the command router already exists:
`setActiveCamera`, `recallCameraPreset`, `saveCameraPreset`, `slowZoomPush`,
`zoomCameraVelocity`, `sweepBetweenPresets` (to be fixed — see below),
`goHomeViaCamera`, `setCameraAutoMode`, gimbal/zoom stop.

## Grammar + command mapping

Grammar shape: `(camera <N>)? <verb> (<target>)?` — camera prefix optional (omitted =
active camera). Number words map to ints in the bounded grammar.

| Spoken | Parsed | Primitive |
|---|---|---|
| "camera two" | select active cam 2 | `setActiveCamera(2)` |
| "camera one shot three" / "shot three" | recall preset 3 | `recallCameraPreset(3)` |
| "push in" | standard slow push (~10s) | `slowZoomPush(10000, 1.5)` |
| "slow push in" | very gradual push (~15s, gentle) | `slowZoomPush(15000, 1.3)` |
| "pull out" / "zoom out" | zoom out | `zoomCameraVelocity('out', …)` |
| "zoom in" | zoom in (manual, not the slow push) | `zoomCameraVelocity('in', …)` |
| "wide" / "go wide" / "home" | recall stage-home | `goHomeViaCamera()` |
| "sweep shot two to shot three" | glide preset 2→3 | `sweepBetweenPresets(2,3,…)` (fixed path) |
| "track" / "follow" | AI-lock person in frame | `setCameraAutoMode(true)` |
| "stop" | halt motion / cancel push | zoom + gimbal stop |
| (labeled) "camera two drummer" | recall labeled preset | `recallCameraPreset(slotForLabel)` |

- **Confidence floor:** matches below threshold → no action + reject tone. Never guess a
  camera move on stream.
- **`sweep` fix folded in:** current `sweepBetweenPresets` uses the broken open-loop
  velocity engine (tilt drift + end-jerk, documented in CURRENT_WORK). Voice "sweep" must
  use the **recall-A → recall-B** native coordinated move (the post-show fix). This rewrite
  is in scope for this build (small). If native recall speed is unacceptable and a slow
  glide is required, that is a separate follow-up (stepped intermediate presets) — v1 ships
  the native recall.

## Shot labels

- New "Voice / Shots" panel. Per camera: list of preset slots, each with optional text label.
- Save a shot = aim camera (joystick/AI) → "Save as Shot N" → optional typed label
  (`saveCameraPreset`).
- On any label add/rename, BB rebuilds SAPI grammar and pushes to helper. Numbered
  "shot N" always valid even unlabeled.
- Labels are **typed, not spoken** — keeps command grammar bounded and reliable.

## Feedback

Operator is watching OBS/stage, not the BB window:
- **Heard-toast** in BB: `CAM2 ▸ PUSH IN` (parsed + executed command).
- **Deck key flash:** green pulse accept, red reject.
- **Reject tone:** short distinct beep on below-floor / no-match → no camera move. Silence
  is never ambiguous.

## Failure / edge handling

- **Helper crash/not running:** BB auto-relaunches `voice-helper.exe`; deck key shows
  disabled; voice silently no-ops. Voice is purely additive — manual deck/joystick
  unaffected.
- **No mic / wrong device:** mic device picked in Voice panel (reuse existing getUserMedia
  device-list pattern); launch preflight check.
- **Camera offline:** command parses, primitive no-ops (as today); toast `CAM2 ▸ (no camera)`.
- **Empty target shot:** said "shot five", slot unset → reject tone + `shot 5 not set`.
- **Two cameras:** "camera N" routes explicitly; bare verb → active camera. Voice never
  changes which camera is program/auto (cam1 stays program per the multi-PTZ model). Voice
  drives the active/manual camera exactly like the joystick does.
- **Latency target:** key-release → camera move < ~500ms.

## Packaging

`voice-helper.exe` is a new build artifact bundled into the NSIS installer alongside the
asar. Build mechanics follow the existing FIRMAMENT → `/mnt/firmament/deploy` → scp →
dart-swap flow. The C# helper is compiled on the Windows build box (FIRMAMENT). Manifest
change to the Stream Deck plugin (new "Hold to Direct" action) requires plugin reinstall on
DART (same as prior camera-action additions).

## Out of scope / future

- Vision subject-ID ("the drummer" as a tracked human) — v2, wires the YOLO director POC.
- Slow-glide sweep (preset-to-preset over a fixed long duration with a smooth ease).
- Voice-driven labeling.
- Wake-word / hands-free activation (v1 is push-to-talk only).

## Test plan (hardware-gated, on DART + camera)

1. PTT key opens/closes mic; nothing recognized when key not held.
2. Each verb fires its primitive on the addressed camera; "camera N" prefix routes; bare
   verb hits active camera.
3. Number-word shots recall correct presets; labeled shots recall by label.
4. Confidence floor rejects garbage (crew chatter during hold) with reject tone, no move.
5. "sweep" performs a smooth native recall-A→recall-B (no tilt drift / end-jerk).
6. "push in" vs "slow push in" durations distinct; "stop" cancels mid-push.
7. Helper crash → auto-relaunch; voice no-ops while down; manual controls unaffected.
8. Latency key-release→move < ~500ms.
