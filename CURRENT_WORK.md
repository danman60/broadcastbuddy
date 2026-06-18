# Current Work — BroadcastBuddy

## 2026-06-18 Session (PM) — Camera follows CURRENT routine without firing lower thirds

**Goal:** during a show, operator advances the playlist to track which routine is live → OBSBOT auto-frames the group/solo by dancer count — but NO lower third fires on the OBS output (graphics off during recital).

**Changes (built, tsc clean, NOT yet committed / NOT yet on DART):**
- **Decoupled camera from the visible fire.** `applyRoutineForTrigger()` now runs on `selectTrigger()` + `nextTrigger()`/`prevTrigger()` (current-routine selection/nav) — overlay.ts. Previously it fired ONLY inside `fireLowerThird()` (the visible overlay). `fireLowerThird` call kept too (harmless idempotent re-apply; covers autoFire/manual fire). Selection never sets `lowerThird.visible` → zero on-screen graphics.
- **dancerCount auto-derived from routine NAME on import/startup.** New `deriveDancerCount(name)` in cameraDirector.ts: Solo→1, Duet→2 (keyword or bare "A & B"/"A/B"), Trio→3, Quartet→4, any other named routine→8 (group default = multi full-body, never stuck), no name→undefined. Runs in `fillDancerCounts()` at every chokepoint: `setTriggers`, `addTrigger` (CC package + manual create), `loadSessionState` (startup restore). Explicit counts (FieldMapper/TriggerEditor/CC) ALWAYS win — derivation only fills `undefined`.
- **Why name-parse:** no numeric dancer counts exist anywhere — Ancaster is a standalone recital, not in CompPortal; `adaRoutines.json` has only act/num/group/song. Routine TYPE (all the camera framing needs) is encoded in the 32 group names. Validated parse: 5 solo→1, 2 duet→2, 1 trio→3, rest→group 8.
- Recital framing floor (`fullBody`) already enforced in `@compsync/camera` framingProfile.ts — solos = single-subject full-body track, groups = multi full-body widening. No tight crops ever. Q "solos tighter?" = moot, floor clamps it.

**Framing tuning (obsbot-control @compsync/camera, dist rebuilt clean):**
- **Solo** → trackingSpeed 2→**3 (Fast)**: chase the lone dancer, head-to-toe, single-subject onlyMe. Safety space = fullBody headroom (already).
- **Duet/Trio** → trackingSpeed 2→**3 (Fast)**: keep ALL in frame as they spread, multi, fullBody.
- **GROUP BREATHING (NEW)** — slow near-imperceptible AutoZoom in/out so a group shot is never static. **AI-tier oscillation** (NOT manual /ptz/zoom — avoids contention with AI AutoZoom): alternates `setAutoZoom` between base tier + one step wider, both ≥ recital floor, so the group stays framed. fullBody↔P16 (small_group), P16↔P24 (large_group), P24↔P16 (production). Half-cycle 14s (~28s full breath, TUNABLE). Solo/duet/trio do NOT breathe.
  - `breathingPartnerTier()` in framingTier.ts; `breathe`/`breathingTiers` on FramingProfile; `Director.applyBreathTier(tier)` primitive.
  - BB `cameraDirector.ts`: `startBreathing`/`stopBreathing` timer (unref'd); started in `applyRoutineForTrigger` for group routines when `cameraBreathing !== false`; stopped on solo/duet/trio select, `goHomeViaCamera` (F4 panic), and `invalidateDirector`. Read fresh each routine change.
  - **Kill-switch:** `cameraBreathing` setting (default true) — Settings UI "Group Breathing" checkbox under OBSBOT Camera group. types.ts + settings.ts + Settings.tsx + generic settingsSet IPC.

**🔴 BREATHING IS HARDWARE-UNVERIFIED — MUST test on DART+Tail2 before the show.** AI-tier oscillation is the safer of two approaches (chosen over manual-zoom-AutoZoom-off) but how smoothly the Tail 2 transitions between AutoZoom tiers is untested. F4 / breathing-off is the kill path.

**Files this change:** BB — overlay.ts, cameraDirector.ts, settings.ts, shared/types.ts, renderer/components/Settings.tsx. obsbot-control — profiles/framingTier.ts, profiles/framingProfile.ts, director/Director.ts (dist rebuilt).

**Next:** commit + push (both repos; obsbot-control has NO remote — local commit only) → Windows build on FIRMAMENT (sync obsbot-control to D:\projects\obsbot-control per the junction/devDep gotcha) → deploy DART → **hardware test:** (1) selecting/advancing playlist frames camera, NO lower third; (2) solo chase, duet/trio hold spread; (3) group breathing smooth + kill-switch + F4 stop. Then venue router test (Fri Jun 19, Ancaster 6:15 PM).

---

## 2026-06-18 Session — OBSBOT Tail 2 hardware bring-up (DART) — ALL CONTROL VERIFIED LIVE

**Camera physically plugged into DART (USB-C). Bring-up done; first live test = recital TOMORROW (2026-06-19).**

**Verified on real hardware:**
- **USB-C = UVC video ONLY** (Class Camera + audio + COM5 serial). `/usb/mode` is only `uvc`/`mtp` — NO RNDIS/network over USB. Single-cable "USB=video+control" assumption is DEAD.
- **Control = REST over Wi-Fi.** Camera in station mode joined DART home LAN at `http://192.168.0.163:80/camera/sdk`. (NOT 192.168.88.10 — that's AP-mode only.) `@compsync/camera` RestCamera HAL targets exactly these endpoints.
- **PTZ + zoom CONFIRMED live:** ran full locate-wide→pan-center→zoom on a target via UVC ffmpeg stills. `/ptz/gimbalcontrol` velocity (yaw neg=pan left, pitch pos=tilt up), `/ptz/zoom` ratio+speed (USE speed:10 — low speed creeps).
- **AI tracking + framing CONFIRMED:** `/ai/workmode` single+group STICK *only with a human in frame* (empty room → reverts `none`; PUT returns 200 either way — that was the whole "blocker"). `/ai/human/zoomtype fullBody` works once tracking active. Tiers A/B/C all GREEN.
- **OBSBOT Center OVERRIDES REST** (reset my zoom while open) — **MUST be CLOSED during shows.** REST control works concurrent with OBS consuming the UVC video (separate channels: video=USB, control=Wi-Fi).
- UVC is single-consumer (OBS vs ffmpeg fight for video); video+control coexist fine.

**🔴 CRITICAL recital-day gotcha — camera IP changes at venue.** `192.168.0.163` is DART's *home* LAN. At the venue (different router) the Tail 2 gets a different DHCP IP → BB `cameraHost` must be re-set or control is dead. Options offered to user: (a) set camera STATIC IP tonight (most reliable), (b) re-probe venue subnet on-site (ARP-scan for REST :80), (c) add BB auto-discovery (net-new code). **User decision pending — this is the #1 risk for tomorrow.**

**Recital-day checklist:** camera on same Wi-Fi as DART → get IP → BB cameraHost; OBSBOT Center CLOSED; OBS pulls video over USB-C UVC; AI single+fullBody (never tighter — recital floor); AI engages with dancers in frame.

**Open items (user to decide before tomorrow):** static IP vs on-site re-probe vs BB auto-discovery; whether to wire+verify BB `cameraHost` control end-to-end through the app (not yet done — all testing was raw REST). Durable findings saved to memory `project_obsbot_tail2_capture` (CompPortal memory dir).

**Reason for /fresh:** long session (asteroid deploy → field logging → Tail 2 bring-up); clearing context before recital-day work.

---

## 2026-06-16 Session — Field logging + PTZ build/deploy to DART
**Goal met:** DART now runs `572fbbb` (logging + PTZ), built on FIRMAMENT, deployed + verified live.
- **Weekend failure diagnosed** (June 13 event): no-router transports failed. Wi-Fi Direct = experimental/unverified. Phone-hotspot connect failed; operator fell back to legacy "ScreenDesk" which worked over the same hotspot → BB is the fault, not the network. Root cause candidates: multi-homed `getLocalIp()` (wifiDisplay.ts:108-110, 192.168/10 tie at priority 0 → can advertise unreachable OBS-LAN IP) and/or hotspot AP isolation. Failure-window logs had rotated out (tablet video-stats flood `main.log` in ~1 day).
- **Phase 1 field logging shipped** (`572fbbb`, additive only): new `net` EventKind → events.jsonl. Records discovery start (ALL IP candidates + chosen + advertised host), deduped discovery replies, WS hub bind, client connect/disconnect, Direct/Wi-Fi-Direct/BLE start/stop/error (no secrets). Tablet logs routed to dedicated `<userData>/logs/tablet.log` so they stop overwriting main.log. **Verified live on DART** — boot emitted "Discovery listener started" w/ candidates [192.168.0.161 p0, 172.28.128.1 p2, 100.90.103.121 p3] = DART is multi-homed (3 ifaces), confirms the tie-break risk.
- **Build/deploy:** FIRMAMENT obsbot-control dist rebuilt first (src newer than dist), then BB npm install + `@rollup/rollup-win32-x64-msvc` fix + dist:installer. Installed on DART (app.asar 23:33), PTZ verified (OBSBOT/framing/PTZ panel/gamepad in asar), SD plugin redeployed (manifest + 26 icons), BB relaunched healthy (4 procs, wifi-display stable). ASTEROID also got `2b153e0` June 13 (pre-PTZ; not updated this session — DART-only per user).
- **Plan for Phase 2-4** (connection fix, bench repro, disarm experimental transports): `docs/plans/2026-06-16-connect-reliability-and-logging.md`. NOT built — bench work, do NOT ship to a show machine until hotspot repro passes.

### Open threads (not in this goal)
- **3 upcoming events to load on DART** (parallel track): only **Ancaster Dance Arts** has programme data (32 routines, `RemotionVideo/src/data/adaRoutines.json`). Other 2 events: names + scanned programmes still needed from user. "Loaded" = CC broadcast-package per event pushed to BB.
- Connection FIX (getLocalIp hotspot preference + one-button connect) — Phase 2, bench-first.
- CC handoff item: auto-push CF stream key → OBS on CC_APPLY_PACKAGE (ipc.ts ~694-707).

---

## Prior Session — OBSBOT Tail 2 PTZ camera integration

## Last Session Summary
Built the OBSBOT Tail 2 automated-capture stack: a shared `@compsync/camera` control package (separate repo `~/projects/obsbot-control`) + full integration into BroadcastBuddy. Goal = "plug in the Tail 2 → camera auto-frames each routine by dancer count, operator can override." Dual-app framework: same `@compsync/camera` module will also go into CompSyncElectronApp (CSE) later — **BB ships first** (recital test ~2026-06-20/21). Camera-enabled Windows installer built + staged.

## What Changed (BroadcastBuddy, all pushed to origin/main through 7ec7ce2)
- `051e74b` per-routine `Trigger.dancerCount` + guarded camera-on-trigger-fire (`fireLowerThird()` overlay.ts:387 → `applyRoutineForTrigger`). FieldMapper "Dancer Count" target, TriggerEditor numeric input, Settings "OBSBOT Camera" group, `cameraDirector.ts` service.
- `89e26b0` Set Home / Go Wide buttons (OverlayControls) + **F4 panic hotkey**.
- `e3d7291` Wave 1 — settings (`cameraAutoMode`/`cameraTrackingSpeed`/`cameraFramingMode`/`cameraPort`), 9 camera IPC channels, auto-mode guard, default host `192.168.88.10`, `camera:probe`.
- `fc8e76d` CameraPanel — nipplejs on-screen joystick + **Xbox gamepad** + zoom rocker + preset grid (P2–8, click=recall/long-press=save) + AUTO/MANUAL toggle + Home/Recenter + status + **live `<video>` preview** (getUserMedia device picker). Shared 10Hz command sender; stick-grab→AI-off interlock; disconnect→stop.
- `96522d2` / `d66b393` / `7ec7ce2` Windows-installer build fixes (see Gotchas).

Companion repo `~/projects/obsbot-control` (`@compsync/camera`) — commits `a01edd6`→`a9ec815`, **LOCAL ONLY, no git remote**: OSC+REST HALs + ICamera, dancerCount→routineType→framingProfile (recital floor `fullBody`), `goHome`/`saveHome`/`endRoutine`, `gimbalVelocityXY`/`gimbalStopAll`/`zoomVelocity`/`stopZoom`, osc made optional+lazy. Docs: `docs/OSC_COMMAND_MAP.md`, `docs/REST_API.md` (51 endpoints). SDK: `sdk/` (Tail 2 RESTful HTML, untracked).

## Build Status
PASSING. BB `npm run build` clean. Windows NSIS installer built on firmament 2026-06-15 23:25 ET → `/mnt/firmament/BroadcastBuddy-Setup-2026-06-15.exe` (115 MB, = `D:\Shared`). Pre-existing tsc errors in `ccRelay.ts`/`chatBridge.ts` (Supabase WS types) — NOT ours, electron-vite build ignores them.

## Known Bugs & Issues
- `RestCamera.getGimbalPos()` returns the stored preset list, NOT live pan/tilt (SDK has no live-pose GET) → CameraPanel numeric gimbal readout is best-effort. Status dot + zoom work.
- All camera control unverified on real hardware (no Tail 2 yet) — see hardware-test list.

## Incomplete Work
- **CSE (CompSyncElectronApp) integration NOT done** — `@compsync/camera` not yet wired. CSE is the truly-autonomous home: `state.getCurrentRoutine()` → `Routine.sizeCategory`/`dancers` (native CompPortal data) → `Director.applyRoutine()`. No package/import needed there.
- **BB CC-broadcast-package does NOT carry `dancerCount`** — `BroadcastPackage.triggers[]` (types.ts:670) + apply builder (ipc.ts:682-694) lack it. So applying a CompPortal event leaves counts empty. For BB to auto-frame from CompPortal-loaded data: add `dancerCount` to CompPortal's package generator + map it in BB `ipc.ts:686`. (For a standalone recital, count via import-mapping or manual TriggerEditor already works.)
- `obsbot-control` has no git remote — pending decision: create private `danman60/obsbot-control`?
- Group virtual-PTZ sim render never finished (CPU slow) — rerun on GPU. Solo sim succeeded (100% YOLO detection on dark KMSD wide footage).

## Tests
- No unit tests. Sim validation: `obsbot-control/sim/` virtual-PTZ on real KMSD wide footage — solo render done (`virtual-ptz-1.mp4`, `debug-1.mp4`), 100% detection. Group pending.
- Untested: ALL camera control on real hardware. Dry-run examples (OSC + REST) pass.

## Next Steps (priority order)
1. **Decide BB count source for recital**: (a) close CC-package `dancerCount` gap for CompPortal-connected auto-framing, or (b) leave manual/import count for the standalone recital. (User was mid-decision at wrap.)
2. Wire `@compsync/camera` into **CSE**, fired by `getCurrentRoutine()`, framing from `sizeCategory`.
3. When Tail 2 arrives: hardware-test gates (below).
4. Optional: rerun group sim on GPU; create obsbot-control remote.

## Gotchas for Next Session
- **Windows installer build (firmament, the build box — NEVER NSIS on Linux):** repo at `D:\projects\BroadcastBuddy`; obsbot-control must be synced to `D:\projects\obsbot-control` (tar via `/mnt/firmament`=`D:\Shared`, exclude node_modules/reference/sim/.git/sdk; build with `npm install --omit=optional && npm run build`). The KILLER bug (cost 3 attempts): a `file:../obsbot-control` dep is a Windows JUNCTION; electron-builder resolves the junction's REAL path (outside project root) and throws `"X must be under D:\projects\BroadcastBuddy"` before any files-exclude applies. FIX = vite `externalizeDepsPlugin({ exclude:['@compsync/camera'] })` (bundles into out/main) **+** `@compsync/camera` in **devDependencies** (electron-builder packages production deps only → never walks the junction). Also `@rollup/rollup-win32-x64-msvc` optionalDep for the Windows rollup bug.
- Camera is OFF by default — no behavior change unless `cameraAutoMode` true OR `cameraHost` set. Real operators unaffected.
- Hardware-test gates: RNDIS bring-up (single-USB-C / host→192.168.88.10), AI-vs-manual gimbal arbitration (override vs auto-disable), command rate Hz/latency (10Hz assumed), USB-C gimbal power, preset slot count (OSC doc said 1-3), zoom-stop precision. Gamepad: prefer WIRED over BT; needs window focus + a button-press before getGamepads() returns.
- ESM `@compsync/camera` into CJS electron-vite main = dynamic `import()` (static require → ERR_REQUIRE_ESM).
- Full durable context: memory `project_obsbot_tail2_capture` (CompPortal memory dir).

## Files Touched This Session (BroadcastBuddy)
src/shared/types.ts, src/main/services/cameraDirector.ts, src/main/services/settings.ts, src/main/services/overlay.ts, src/main/services/llmService.ts, src/main/services/hotkeys.ts, src/main/ipc.ts, src/preload/index.ts, src/renderer/types.d.ts, src/renderer/components/FieldMapper.tsx, src/renderer/components/TriggerEditor.tsx, src/renderer/components/Settings.tsx, src/renderer/components/OverlayControls.tsx, src/renderer/components/PanelApp.tsx, src/renderer/components/CameraPanel.tsx (new), src/renderer/lib/cameraControl.ts (new), src/renderer/lib/gamepad.ts (new), src/renderer/styles/camera.css (new), src/main/services/overlayPanels.ts, electron.vite.config.ts, package.json
