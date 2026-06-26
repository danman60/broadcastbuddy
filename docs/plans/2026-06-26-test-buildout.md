# Test Buildout — 2026-06-26

Autonomous test-authoring session. Goal: fresh, extensive deterministic Playwright
(Electron) tests covering every screen/role/flow; run, triage, fix small revertable
bugs, log real bugs here.

## Environment
- Electron 33 + electron-vite. Tests = `@playwright/test` `_electron.launch` on the
  built app (`out/main/index.js`). Build first: `npm run build`.
- Linux runner → `xvfb-run -a npx playwright test --workers=1`.
- No hardware in CI: OBS, OBSBOT camera, voice-helper.exe (Windows/net48), Stream Deck
  all absent. New specs only assert UI rendering + IPC handlers that degrade gracefully.

## Existing suite (baseline)
- 45 spec files, **309 tests** pre-existing. Many predate the `ui-redesign` branch and
  carry **stale selectors** (e.g. `summary:has-text("Command Center")` — CC moved into
  the Load dropdown; `Tools` → `Tools ▼`).
- Baseline run: `/tmp/bb-baseline.log`.

## New specs authored this session (prefix `zz-`)
- `tests/zz-harness.ts` — shared launch helper; **isolated `--user-data-dir`** per run
  (deterministic, never pollutes the operator's real sessions/settings).
- `tests/zz-ipc-contracts.spec.ts` — 17 deterministic IPC round-trips: sessions CRUD,
  triggers CRUD+nav, settings round-trip (+ multi-cam settings), notes, day-checklist,
  events, backups, recovery, playlist, overlay state, user-presets, stream-config,
  shot recorder state, camera handlers degrade-gracefully.
- `tests/zz-screens-coverage.spec.ts` — every screen/modal renders + screenshots:
  main layout, rail tabbed cards, camera card, Settings (all tabs), Brand Kit, Import,
  Starting Soon Editor, Visual Editor, day checklist, compact mode.
- `tests/zz-camera-voice.spec.ts` — NEWEST feature surface (was 0% covered): camera
  active panel forced via seeded host, Cam1/Cam2 multi-cam selector, AUTO/MANUAL,
  joystick/zoom/Set Home, activeCameraId persistence, Voice Control + Shot Recorder
  sections in Settings, voiceEnabled persistence.

Coverage gap closed: no prior spec referenced VoicePanel / ShotRecorder / CameraPanel /
multi-cam / cameraSelect.

## Baseline triage (existing 309-test suite: 294 pass / 15 fail)
ALL 15 failures are pre-existing test fragility, NOT app bugs:
1. **Stale selectors (ui-redesign drift)** — `app.spec.ts` Command Center summary
   (moved into Load dropdown), `Tools` → `Tools ▼`; `overlay-controls.spec`
   Counter/Clock buttons (removed from OverlayControls — now preview-only);
   `_ui-screens` Brand/Visual/Compact captures.
2. **Shared-userData state leak** — the existing suite does NOT isolate userData,
   so `compactMode:true` and `chat enabled:true` got persisted to
   `~/.config/broadcast-buddy/config.json` and leaked across spec files, breaking
   default-state assertions (waves chat-disabled, cc-relay dormant, triggers-ui,
   resilience-ui — all show header "BB"/"Compact ON" in their failure snapshots).
   Confirmed by reading the on-disk store. The zz suite fixes this class entirely
   via per-run `--user-data-dir`.

**Zero real app bugs found** — the app is healthy; the legacy suite is fragile.

## Key harness findings (baked into zz-harness.ts)
- Per-run isolated `--user-data-dir` (deterministic, no real-config pollution).
- Playwright force-click fires on `<button>` but NOT on the redesign's
  `<div onClick>` section headers, and auto-wait click stalls 30s under fleet CPU
  load (load avg 8+ from other sessions on this box). Fix = `nativeClick()` helper
  doing `element.click()` via evaluate (trusted click, zero actionability wait).

## zz suite results (74 tests as of first full run)
- Green: ipc-contracts(17), overlay-commands(8), concurrency(6), camera-voice(7),
  camera-voice-shot-ipc(20→fix 1), screens-coverage(10), runtime-errors(3),
  validation-negative, viewport-a11y, obs-degradation, broadcast-package.
- Fixed mid-run: `gallerySetOffset` (void handler — assertion corrected),
  trigger/session return-shape assumptions, positional vs object IPC args.
- Investigating: `zz-persistence-restart` (relaunch same userData dir).
