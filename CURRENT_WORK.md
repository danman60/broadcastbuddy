# Current Work - BroadcastBuddy

## Session 2026-10-29 — weekend prep (show Oct 31 / Nov 1)
Asks: voice-to-preset tested beforehand; alerts when OBS/recording/OBSBOT stops; an OBS dock instead of app-switching.

**Branch:** back on `main`. `shared-ptz` (5a49408, unpushed) is UNBUILDABLE: its @compsync/camera Oct source
(/mnt/data/projects-relocated/obsbot-control) is gone; only the Jun 21 package survives (restored from the
2026-09-01 repo-backup bundle into that path). Don't deploy shared-ptz.

**Shipped (pushed):**
- `423ba5f` voice: grammar NEVER compiled on real SAPI once any shot existed (sweep phrase → "'' rule reference
  not defined") — sweep dropped from voice; slots 1-8 always speakable; "preset N" works. Real-SAPI test
  `voice-helper/test/voicetest.ps1` on FIRMAMENT: 12/12, conf ≥ 0.98, junk rejected.
- `712e0a0` showMonitor alerts (OBS not responding, rec stopped/stalled, stream dropped, cam 1/2 not responding;
  OS notification) + OBS dock `http://127.0.0.1:19080/dock`. Spec `tests/zz-show-monitor-dock.spec.ts` 5/5.

- `098c828` real-OBS spec `tests/zz-show-monitor-real-obs.spec.ts` (opt-in, throwaway OBS only): 3/3 vs OBS 30.0.2
  ws 5.3.4. Freezing OBS 6 s → "OBS NOT RESPONDING" in 6 s; the freeze also tripped OBS's 5 s NVENC encoder timeout
  ("An encoder error occurred while recording") → recording dies; BB flagged it (STALLED / STOPPED).

**Elvis & Co 2026 lower thirds:** session `mvtihmlqxn2loa` "Elvis & Co 2026 — Lower Thirds", 26 triggers (12
Competitor, 14 Performer), title = name, subtitle = each elvisandco.ca artist page's "From" field verbatim (uppercased);
Sound of Sting / The Tonettes / The Casino Brothers have no "From" → blank subtitle. Animation sparkle 0.8 s, client
logo = site logo. Staged `D:\Shared\bb-deploy-2026-10-29\sessions\mvtihmlqxn2loa.json` → copy into
`%APPDATA%\broadcast-buddy\sessions\` on the show machine, then Load in BB. Not on site pages: 2025 winners.

**Deploy:** canonical `--dir` build staged `D:\Shared\bb-deploy-2026-10-29` (app.asar 39,387,263 + unpacked +
voice-helper). DART is BACKUP (owner 2026-10-29); primary show machine not yet named. DART OFFLINE on Tailscale since ~2026-10-24. On DART: stop BB, swap asar +
app.asar.unpacked, replace `resources\voice-helper`, operator relaunch. Then OBS → View → Docks → Custom Browser
Docks → `http://127.0.0.1:19080/dock`. Enable Voice in Settings (voiceEnabled default false).

**Full suite 2026-10-29 07:22:** 438 pass / 17 fail — all 17 fail identically on pre-change 4e85ea5 (pre-existing: app header/Tools menu, cc-relay, overlay counter/feature, ui-screens, resilience-ui, chat state).

**Not tested:** real mic + real Tail 2 on DART; dock inside OBS's CEF (beep needs one click in dock to unlock audio).

---

## Last Session Summary (2026-07-04)
Big PTZ session: merged ui-redesign → main (branch deleted), slowed Xbox sticks,
added joystick calibration UI + configurable slow-move deck action, then built the
full 5-and-5 (docs/five-and-five-2026-07-04.md) — all 10 items. Deployed to DART
via first-ever asar swap (canonical FIRMAMENT --dir build). Deck plugin files copied
to DART. CSController APK staged for tablet (HTTP + Drive) — adb network debugging
off on the Fire, so install pending operator action.

## What Changed (all on main, PUSHED)
- `60d81dc` — Xbox stick max gimbal velocity 178 → 30 (jerky fix)
- `45fca20` — Settings > Camera > "Xbox Controller" calibration group (max speed/
  deadzone/expo, live-applied); deck "Slow Move (P to P)" action w/ per-key
  from/to/seconds/waypoints PI (pi/camera-move.html); wsHub cameraSweep waypoints
- `9ca5b85` — 5-and-5 buildout:
  - PANIC STOP: wsHub `cameraStop` + deck key; sweeps abortable (moveGeneration)
  - PTZ activity in WS state (`camera:{activeCam,recording,replayingMoveId,sweepRunning}`);
    deck REC face live, Select Cam active highlight
  - Trigger-attached camera moves (sweep/replay) — TriggerEditor UI, fire-time only
  - Xbox haptics: rumble preset/AI-latch, double-pulse record
  - Preset thumbnails (UVC snapshot on save, settings cameraPresetThumbs) +
    grey-out slots not stored on camera (cameraGetPresetIds)
  - cancelReplay now stops commanded cameras (was: stranded gimbal panning)
  - Dead settings removed (cameraBreathing, cameraTrackingSpeed)
  - shared/cameraMoves.ts constants (+ deck moveDefaults.ts mirror)
  - On-screen joystick obeys cameraStickMaxSpeed (GIMBAL_SCALE 178 deleted)

## Deploy State
- DART: app.asar SWAPPED (39,367,687 / 2026-07-04 16:52; old kept as .bak).
  **BB is STOPPED on DART — operator must relaunch from desktop.**
  Deck plugin bin/manifest/pi copied — **operator must restart Stream Deck app.**
- Tablet (kftrwi-1, 100.72.217.68): CSController-2026-07-04.apk on Drive APKs folder
  + served at http://100.122.177.91:8899/CSController.apk (SpyBalloon, session-temp).
  adb watcher runs; needs "ADB over network" ON, or install via Silk from URL.

## Hardware-Untested (verify at next camera session)
Haptics, STOP under a live glide, preset thumbs/grey-out, trigger moves, waypoint
glide pacing, deck REC/active faces, new stick calibration feel.

## Build Status
PASSING — app tsc + electron-vite + deck rollup all green at 9ca5b85.

---

# Previous Session (2026-07-02/03)

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
