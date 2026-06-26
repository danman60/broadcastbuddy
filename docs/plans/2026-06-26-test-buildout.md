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

## zz suite — FINAL (17 files, ~137 tests, ALL GREEN)
Files: ipc-contracts, overlay-commands, overlay-content-ipc, concurrency-race,
camera-voice, camera-voice-shot-ipc, screens-coverage, runtime-errors,
validation-negative, viewport-a11y, obs-degradation, broadcast-package,
day-checklist-deep, fire-flows, chat-moderation-ipc, persistence-restart, + harness.
Run: `npm run build && xvfb-run -a npx playwright test tests/zz-*.spec.ts --workers=1`.

Test-authoring bugs fixed during triage (my wrong assumptions, NOT app bugs):
- IPC return shapes: `triggerList` → `{triggers,selectedIndex}` (not array);
  `triggerAdd/update/reorder/delete` return the full array; `triggerSelect`/`Next`
  take an INDEX not an id; `addTrigger` needs a caller-supplied `id`;
  `sessionNew` is in-memory (must `sessionSave` before it lists).
- Positional vs object args: `overlayFireAdhoc(title,subtitle)`, `tickerShow(text,…)`,
  `overlayShowChatMessage(author,text)`, `overlayFeatureUpNext(kicker)`.
- Void handlers (`gallerySetOffset`, `notesDelete`) → assert side-effect, not return.
- `fireUpNext/ThatWas` preview the NEIGHBOUR routine → need ≥2 triggers.
- `importDocument` rejects on a bad path (ImportPanel try/catches it + only passes
  picker paths) — documented as expected, not changed.

## App change (committed)
`role="dialog" aria-modal="true"` added to Settings / Brand Kit / Import overlays
(a11y; matched DayChecklist). The only app-code change; rebuilt green.

## Commits (branch ui-redesign, LOCAL — push held; see CURRENT_WORK)
- `be25c6a` — 15 zz files + harness + a11y fix + 22 screenshots + this doc.
- `cb1efe2` — fire-flows + chat-moderation-ipc.
- `1bccd0a` — overlay-mode multi-window + window-resize.

## FINAL TALLY: 18 zz files, 141 tests, ALL GREEN.

## Remaining (for a fresh cycle) — NOT yet covered, mostly non-deterministic here
- Import preview/apply-mapping with a synthetic doc (legacy `import-flow.spec`
  partly covers; could add oracle depth with a temp CSV).
- Network/hardware-bound (NOT deterministic on this box): brand-scrape, gallery
  R2/Gemini, wifi-display/BLE/P2P transports, Stream Deck install, live OBS,
  live OBSBOT camera, voice-helper.exe recognition.
- Repair the 15 stale LEGACY specs (selector drift + add userData isolation) so the
  whole 309-test legacy suite goes green — separate cleanup task.
