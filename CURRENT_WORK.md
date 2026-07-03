# Current Work - BroadcastBuddy

## Last Session Summary (2026-07-02/03)
Built a tablet-side OBSBOT camera control popup on CSController (Android) that drives
BroadcastBuddy's camera over the existing tablet WS channel. E2E-verified on emulator
(commands land on host with correct payloads). Shipped to one of two Fire tablets; the
second (`kftrwi`) went offline before its update.

## What Changed
- **BB `c164204`** — `feat: WS camera nudge + zoom actions for tablet PTZ popup`
  - `src/main/services/wsHub.ts` — 2 new WS actions in `handleCommand`:
    `cameraNudge {dir,stop}` → `nudgeCamera` (gimbal 1-100, default 40);
    `cameraZoom {dir,stop}` → `zoomCameraVelocity` (0-10, default 5).
    Presets/AUTO/MANUAL/select were already wired. No-op unless a camera host is set.
  - **LOCAL ONLY — NOT PUSHED.** ui-redesign push-gate still active (publishing the branch
    also publishes ~15 prior hardware-untested commits the user gated). Push only on OK.
- **CSController `6f7d3d8`** (branch master, **PUSHED**) — `feat: OBSBOT camera control popup`
  - `app/.../ui/DisplayScreen.kt` — `CAM` HUD button → `CameraControlDialog` (first dialog
    in the app) + `HoldButton` (press-hold velocity, stop on release). Cross PTZ pad
    (▲▼◀▶) + hold ZOOM +/− + AUTO/MANUAL + P1–P6 recall.
  - `app/.../network/WsController.kt` — `sendCommand` now carries a `data` payload;
    `sendCameraNudge/Zoom/Preset` helpers.
  - `app/build.gradle.kts` — version **0.2.0-obsbot-cam** (code 4, was 0.1.2/code 3).
- **BB uncommitted (pre-existing, NOT this session):** `INBOX.md` + 6
  `tests/screenshots/*.png` — dirty at session start, unrelated to camera work.

## Build Status
PASSING. BB `npm run build` (electron-vite) green. CSController `assembleDebug` green
(APK 0.2.0 at `app/build/outputs/apk/debug/app-debug.apk`).

## Known Bugs & Issues
- None open in the camera popup. Two layout bugs found + fixed during test:
  ▶ button clipped (pad row overflow → fixed pad column 232dp); ZOOM label wrap/clip
  (Compose Dialog platform-width cap → `usePlatformDefaultWidth=false` + 680dp).

## Incomplete Work
- **`kftrwi` (Fire tablet, Tailscale 100.83.15.43) not updated to 0.2.0** — went offline
  mid-session ("last seen 5m ago"). Still has the earlier CAM build (labeled 0.1.2).
- BB `c164204` not pushed (gate — see above).

## Tests
- Last test: 2026-07-02 ~16:00 EDT, manual E2E on Android emulator (pixel-phone AVD) against
  a headless BB host (xvfb electron-vite preview, `ELECTRON_DISABLE_SANDBOX=1`). Result:
  7 command types received by host with correct payloads (cameraPreset {id}, cameraNudge
  up/left/right stop:false→true, cameraZoom in stop:false→true, cameraAuto). All 4 pan
  dirs + presets + AUTO fire. PASS.
- **Untested: actual camera motion** — no physical Tail 2 reachable this session. The relay
  path (`cameraDirector` → `Director` → HTTP) is the same one the in-app Camera panel uses,
  so it's the proven path; only live gimbal response unverified.

## Next Steps (priority order)
1. **When `kftrwi` (100.83.15.43) is back online:** `adb connect 100.83.15.43:5555` then
   `adb install -r -g <APK>`; verify `versionName=0.2.0-obsbot-cam`. (kftrwi-1 100.72.217.68
   already on 0.2.0.)
2. **Push BB `c164204`** once the user lifts the ui-redesign push-gate.
3. **Live camera test** — with a reachable Tail 2 set `cameraHost`, drive the tablet popup,
   confirm real pan/zoom/preset motion.
4. INBOX has an unprocessed RemotionVideo request (sync `events.jsonl` fire-log to cloud,
   `events.ts:69`) — separate task, still open.

## Gotchas for Next Session
- **Both Fire tablets are `KFTRWI` (model "trona").** `kftrwi`=100.83.15.43,
  `kftrwi-1`=100.72.217.68. USB serial `G001KT0620950FD6` = kftrwi-1. adb tcpip resets on
  reboot → re-plug USB + `adb tcpip 5555` to restore wireless.
- **Tablet↔BB WS channel:** `wsHub.ts` port 19081, `{type:'command', action, data}`.
  Emulator reaches host at `10.0.2.2`; discovery UDP broadcast does NOT cross emulator NAT,
  so use the ConnectionScreen manual IP form (Server IP + WS port) to connect.
- **Compose Dialog width caps** at platform default unless `usePlatformDefaultWidth=false`.
- Headless BB host on Linux needs `ELECTRON_DISABLE_SANDBOX=1` (chrome-sandbox SUID) and
  xvfb; emulator needs `-no-window` + `QT_QPA_PLATFORM=offscreen`; never `pkill -f emulator`
  inside the launch command (kills its own parent shell).

## Files Touched This Session
- BB: `src/main/services/wsHub.ts` (committed c164204)
- CSController: `app/src/main/java/com/compsync/controller/ui/DisplayScreen.kt`,
  `app/src/main/java/com/compsync/controller/network/WsController.kt`,
  `app/build.gradle.kts` (committed 6f7d3d8, pushed)
