# Multi-PTZ control — plan (2026-06-22)

Goal: control TWO OBSBOT PTZ cameras easily/seamlessly. Switch which camera the
single Xbox controller drives, easily. Same via Stream Deck. In-app selector too.

## Model
- **Active camera** (`activeCameraId` 1|2, default 1): the camera that manual control,
  Xbox, deck moves, sweeps, slow-zoom target. Switching is the mechanism — no per-control
  cam param needed (keeps it "easy").
- **Program/auto camera = cam 1**: routine auto-framing cadence (applyRoutineForTrigger,
  reArm/subjectLost/present) always targets cam 1. Cam 2 is a manual/operator camera.
- Both directors stay CONNECTED simultaneously (per-host map) so switching is instant,
  no teardown/reconnect.

## Settings (shared/types.ts)
- `cameraHost2?: string` — 2nd camera IP (no default; cam2 off unless set).
- `cameraPort2?: number` — 2nd camera port (default 80).
- `activeCameraId?: 1 | 2` — default 1.

## Main (cameraDirector.ts)
- Replace single `directorPromise/directorHost/cadence` globals with
  `directors: Map<host,Promise<Director|null>>` + `cadences: Map<host,RoutineCadence>`.
- `getDirector(host)` caches per host; resolves port by host (cam2 → cameraPort2).
- `getCadence(host)`, `invalidateDirector(host?)` (clear one or all).
- `resolveCameraHostFor(id)`, `getActiveCameraId()`, `resolveCameraHost()` = active host,
  `resolveProgramCameraHost()` = cam1 host, `setActiveCamera(id)`.
- `isCameraFeatureActive` = autoMode OR cameraHost OR cameraHost2.
- applyRoutineForTrigger + withCadence → program (cam1) host + getCadence(cam1).
- withCam / sweep / slowZoom / goHome / saveHome / getCameraState → active host.

## Wiring
- wsHub: `cameraSelect {id}` → setActiveCamera. (existing camera cmds already route to active)
- ipc.ts + IPC_CHANNELS + preload + renderer types.d.ts: `CAMERA_SELECT`.
- Renderer CameraPanel: CAM 1 / CAM 2 toggle (shows active) + cam2 host field + discover.
- gamepad.ts: a button (e.g. "Back"/select, or both-bumpers) toggles active cam → CAMERA_SELECT.
- Stream Deck: `camera-select-1` / `camera-select-2` actions → sendCommand('cameraSelect',{id});
  svg.cameraSelect icon; register in plugin.ts; manifest entries. Existing camera actions
  act on active cam automatically.

## Verify
- tsc clean. Build asar + plugin. Camera hardware DOWN (venue) → structural verify only;
  field-test both cams + switching when a camera is back.
