# BroadcastBuddy streamlines report

Branch: `wf/streamlines`. Base: `b0e3004`. Model: GPT-6.

Verified: 2026-10-29 16:50 EDT.

The full-suite regression gate passed: **424 passed / 22 failed before; 447 passed / 13 failed after; no new failing title**. All six slices are handled in separate commits. No production deployment, real device access or customer data was used. Screenshots are held locally and excluded from the commits.

## Changes

No new settings are needed for these behavior-preserving cleanups. Settings defaults, shared types and renderer source are unchanged.

| Item | Result | Setting | Test name and result | Screenshot | Not verified |
| --- | --- | --- | --- | --- | --- |
| 1 | One auto-hide scheduler for lower-third fire, ad-hoc fire and feature cards. Timer handles remain independent. Commit `0501e18`. | Existing `autoHideSeconds`; no new setting. | PASS: `wshub-timers.spec.ts` / `server-side auto-hide timer hides the lower third`; `adhoc.spec.ts` / `auto-hide still applies to an ad-hoc fire`; `robustness.spec.ts` / `auto-hide timer RESETS on rapid re-fire (does not hide early)`; focused test 2 also checks feature auto-hide. | Fired-overlay pair below. | Live OBS compositing. |
| 2 | Next/previous share one navigation body, retaining framing, markers, notification and the 300 ms auto-fire delay. Commit `519ad72`. | Existing Auto-Fire and loop modes; no new setting. | PASS: `playlist.spec.ts` / `triggerNext and triggerPrev move selectedIndex and clamp at the ends`; its loop and ping-pong tests; `trigger-type.spec.ts` / `next/prev advance position regardless of trigger type`; focused test 2. | `tests/screenshots/streamlines-after-dock-fired-300.png`. | Real camera movement and live recording markers. |
| 3 | A typed WeakMap replaces socket liveness casts. The 30-second ping/termination cycle is unchanged. Commit `06127d3`. | None. | PASS: `zz-streamlines.spec.ts` / `real heartbeat retains a responsive client and disconnects a silent client`; `robustness.spec.ts` / `hub survives malformed / hostile WS input without crashing`. | N/A: internal liveness state. | Hardware Stream Deck/tablet clients. |
| 4 | IPC moves into domain files; the 78-line `ipc.ts` keeps the entry point and public helper exports. Commit `394e762`. | None. | Full-suite gate PASS, 447/13 with no new failing title. Representative handler check: `misc-ipc.spec.ts` / `windowResize changes the main window bounds` PASS. Audit: 191 handlers, 210 registration statements and nine helper bodies unchanged; registration order retained. | N/A: code movement; dock and overlay proofs exercise the moved handlers. | Live integrations, native Windows dialogs and SAPI. |
| 5 | Already implemented at base: `buildOverlayHTML` lives in `overlaySource.ts`. File retained byte for byte; boundary documented. Commit `f0fed1c`. | None. | PASS: `overlay-statemachine.spec.ts` / `lower third: fire pushes visible + trigger text to the browser source`; `http-endpoints.spec.ts` / `/overlay HTML injects the real wsPort (regression guard for the 9877 bug)`. | Fired-overlay pair below. | Live OBS/CEF rendering. |
| 6 | Real dock HTML/JS assets; Express retains `/dock`, injects the WS port and serves `/dock.js`. Builds parse the script. Commit `992bb0b`. | Existing server ports; no new setting. | All four `zz-streamlines.spec.ts` tests below PASS in the focused run and complete suite. `node --check` and build parsing PASS. | `tests/screenshots/streamlines-after-dock-{300,390,500,1440}.png` and `streamlines-after-dock-fired-{300,500}.png`. | Windows installer and OBS CEF. |

## Verification method

The full baseline ran before application edits:

```sh
heavy -- bash -c 'npx electron-vite build && flock /tmp/bb-electron-test.lock xvfb-run -a npx playwright test --workers=1 --reporter=line'
```

Both full runs use fresh, separate `XDG_CONFIG_HOME` directories under `.wf-streamlines/`. Hardware opt-in environment variables are unset. Added coverage uses real Electron and Chromium with local OBS/camera fake servers, clicks/typing, and no mock libraries. Existing tests are unchanged.

The graph was copied from the main checkout into this worktree, then queried with `explain`, `affected` and `query` before editing. Its nested-function/caller gaps were supplemented with source search and a TypeScript syntax-tree move audit. No shared infrastructure was changed.

The extracted dock markup matches the original cooked template except for the external script tag. The extracted script matches except for reading the injected port from that tag. Evidence: `.wf-streamlines/dock-move-audit.json`. The build emits both assets under `out/main/chunks/`; the existing packaging includes `out/**/*`.

Static evidence: `.wf-streamlines/static-audit.json`, `ipc-move-audit.txt`, `ipc-helper-audit.json`, `graph-review.txt` and `graph-visual-review.txt`. Original source copies match the base commit. Application callers were checked; existing exported interfaces remain available.

The first post-change full run was terminated with exit 143 at test 249 before producing a summary. Its artifacts are preserved under `.wf-streamlines/final-interrupted*`; it is not used as a completed comparison. The complete rerun uses `.wf-streamlines/final-retry-profile/`.

## Focused real UI coverage

`tests/zz-streamlines.spec.ts`: **4 passed** in the initial focused run, the complete suite and the final focused run. Each focused run took 1.3 minutes. Local evidence: `.wf-streamlines/focused.log` and `.wf-streamlines/verified.log`.

After the complete suite, a test-only addition pinned default styling for a reproducible overlay capture and recorded blocked resource URLs. Those four tests were rerun successfully. Application code was unchanged.

1. `empty dock fits desktop and narrow widths; fired lower third is captured`: checks `/dock.js`, configured WS port, empty-state controls, widths 300/390/500/1440, populated 300/500 states and the live overlay. The final version also captures the baseline fixture at 1280 x 720 with explicit default styling.
2. `dock controls, refresh, navigation, auto-hide and ad-hoc remain usable`: clicks both cameras, all eight presets, WIDE/AUTO/STOP, hold-to-talk, next/previous, FIRE/HIDE; checks refresh and timers for lower thirds, ad-hoc content and feature cards.
3. `dock shows disconnection and acknowledgment then reconnects`: closes its Electron instance, acknowledges the offline alert, then starts one replacement instance and observes reconnection.
4. `real heartbeat retains a responsive client and disconnects a silent client`: waits through actual 30-second heartbeat intervals, verifies the silent client closes while the responsive client remains, then fires/hides through the dock.

The browser console contains no JavaScript exceptions. The final capture records one `net::ERR_FAILED` resource error and identifies the blocked host as `fonts.googleapis.com`; the test deliberately blocks external resources. The existing full-suite runtime-console checks also passed. The overlay's external font-loading code is unchanged.

## Baseline

Untouched build: passed. Full suite: **424 passed, 22 failed, 6 skipped, 10 did not run** (15.7 minutes).
This is the measured baseline for this worktree, not the historical 438/17 result.

Local evidence: `.wf-streamlines/baseline.log`, `.wf-streamlines/baseline-failures.json`, `.wf-streamlines/baseline-results/`.

Failing titles:

1. `tests/_ui-screens.spec.ts › capture Brand Kit view`
2. `tests/_ui-screens.spec.ts › capture Compact Mode`
3. `tests/app.spec.ts › Tools menu opens and shows options`
4. `tests/app.spec.ts › Command Center panel exists`
5. `tests/cc-push.spec.ts › a broadcast_package pushed over WS is auto-applied to the overlay`
6. `tests/cc-relay.spec.ts › applying a realtime package with no tenantId stays dormant (needs tenant)`
7. `tests/overlay-composition.spec.ts › multiple overlay elements render simultaneously`
8. `tests/overlay-composition.spec.ts › late-join: a freshly-opened browser source renders the ACTIVE state`
9. `tests/overlay-controls.spec.ts › Counter button toggles the counter badge`
10. `tests/overlay-controls.spec.ts › Counter +/− buttons increment and decrement the value`
11. `tests/overlay-controls.spec.ts › Feature: Up Next button shows the feature card`
12. `tests/overlay-statemachine.spec.ts › WS command: featureUpNext drives the feature card from a neighbour`
13. `tests/overlay-statemachine.spec.ts › WS command: toggleOverlayMode opens then closes the Overlay Mode panels`
14. `tests/resilience-ui.spec.ts › System panel renders and shows CPU/RAM/Disk rows after stats load`
15. `tests/resilience-ui.spec.ts › Settings overlay shows Stream Deck Plugin + Global Hotkeys sections`
16. `tests/triggers-ui.spec.ts › clearAll empties triggers (IPC + DOM empty state)`
17. `tests/waves.spec.ts › chat get-state reports disabled/disconnected by default`
18. `tests/zz-screens-coverage.spec.ts › main layout renders core regions`
19. `tests/zz-show-monitor-dock.spec.ts › healthy: OBS up, recording, camera answering, no alerts`
20. `tests/zz-show-monitor-dock.spec.ts › recording stalled → alert`
21. `tests/zz-show-monitor-dock.spec.ts › recording stopped → alert; ack dismisses it`
22. `tests/zz-show-monitor-dock.spec.ts › dock renders and its buttons drive the camera`

## Final full suite

Build: passed. Full suite: **447 passed, 13 failed, 6 skipped, 0 did not run** (10.4 minutes).

**No new failing title.** All 13 final failures occur in the 22-title baseline set. Nine baseline failing titles passed this time, and the ten previously unrun tests executed. Results varied across runs; no legacy tests were changed.

Local evidence: `.wf-streamlines/final.log`, `.wf-streamlines/final-failures.json`, `.wf-streamlines/run-comparison.json`, `.wf-streamlines/final-results/`.

Failing titles:

1. `tests/_ui-screens.spec.ts › capture Brand Kit view`
2. `tests/_ui-screens.spec.ts › capture Compact Mode`
3. `tests/app.spec.ts › Tools menu opens and shows options`
4. `tests/app.spec.ts › Command Center panel exists`
5. `tests/cc-push.spec.ts › a broadcast_package pushed over WS is auto-applied to the overlay`
6. `tests/cc-relay.spec.ts › applying a realtime package with no tenantId stays dormant (needs tenant)`
7. `tests/overlay-controls.spec.ts › Counter button toggles the counter badge`
8. `tests/overlay-controls.spec.ts › Counter +/− buttons increment and decrement the value`
9. `tests/overlay-controls.spec.ts › Feature: Up Next button shows the feature card`
10. `tests/resilience-ui.spec.ts › System panel renders and shows CPU/RAM/Disk rows after stats load`
11. `tests/resilience-ui.spec.ts › Settings overlay shows Stream Deck Plugin + Global Hotkeys sections`
12. `tests/triggers-ui.spec.ts › clearAll empties triggers (IPC + DOM empty state)`
13. `tests/waves.spec.ts › chat get-state reports disabled/disconnected by default`

## Screenshots and logs

- Baseline fired lower third: `tests/screenshots/streamlines-baseline-lower-third.png` (inspected locally).
- First capture after all six slices: `tests/screenshots/streamlines-first-after-lower-third.png`, retained from the interrupted full run. **0 differing pixels out of 921,600** at 1280 x 720. Evidence: `.wf-streamlines/first-after-overlay-comparison.json`.
- Final isolated capture: `tests/screenshots/streamlines-verified-lower-third-controlled.png`, also copied to `streamlines-after-lower-third.png`. Inspected locally: matching content and layout, no clipping. **3,006 pixels differ (0.326%)**, all within the text and card-edge regions; no differences elsewhere. RGB edge differences are consistent with browser rasterization/capture timing. Evidence: `.wf-streamlines/overlay-comparison.json`, `.wf-streamlines/controlled-overlay-comparison.json` and `.wf-streamlines/visual-verified-overlay-state.json`. This capture is not claimed to be pixel-identical.
- The raw complete-suite capture, `tests/screenshots/streamlines-final-suite-lower-third.png`, differed by 17,677 pixels and displayed larger type. Its existing test inherits styling from preceding files and only waits 350 ms after firing. This prompted the explicit-style isolated capture above; the raw image and its comparison are preserved in `.wf-streamlines/final-suite-overlay-comparison.json`.
- Dock screenshots: `tests/screenshots/streamlines-verified-dock-{300,390,500,1440}.png` and `streamlines-verified-dock-fired-{300,500}.png`. Focused and complete-suite captures also remain under `streamlines-focus-` and `streamlines-after-`. Inspected locally: all controls fit; the existing narrow-width ellipsis is preserved. No new decoration, placeholders or layout changes were introduced.
- `npx tsc --noEmit -p tsconfig.web.json`: passed with zero errors. Node typecheck: exactly the three allowed pre-existing TS2322 errors at `ccRelay.ts:220`, `ccRelay.ts:282` and `chatBridge.ts:180`; no new errors.
- Build passed and emitted both dock assets. The existing audioTranscription mixed static/dynamic import warning remains.
- Baseline main-process log contains no `EADDRINUSE`, unhandled/uncaught exception or overlay-server error entries.
- No repository-wide lint command is configured. Dock JS syntax checking and `git diff --check` are the applicable static checks.

## DONE checklist

Reviewed against `~/projects/docs/DONE-CHECKLIST.md`. Results are scoped to these behavior-preserving changes; the pre-existing full-suite failures are listed separately.

| # | Result | Evidence |
| --- | --- | --- |
| 1 | PASS | Real Chromium dock at 1440 px, served by real Electron. Focused test 1 and `streamlines-focus-dock-1440.png`. |
| 2 | PASS; real device N/A | Real browser at 390 px, plus 300 and 500 px. This task does not change a phone-side flow or use physical devices. |
| 3 | PASS | All 19 dock buttons exercised: two camera selectors, eight presets, WIDE/AUTO/STOP, hold-to-talk, four lower-third controls and ACKNOWLEDGE. Focused tests 1-3. |
| 4 | N/A | Local desktop/dock path has no login or role variants. |
| 5 | PASS | Focused test 1 opens an empty playlist and checks all preset controls and page width before seeding explicit test fixtures. |
| 6 | PASS | Focused tests 2-4 cover refresh, app disconnection, acknowledgment, reconnection and a silent WS client. Existing robustness tests cover malformed WS input and rapid re-fire. |
| 7 | PASS | Baseline, final and focused logs reviewed. Zero port collisions, unhandled/uncaught exceptions or overlay-server errors. Both full logs contain only the same expected error categories: localhost OBS refusal, deliberately malformed WS input and the tablet-log error fixture. See `.wf-streamlines/server-log-review.json`. |
| 8 | PASS with expected harness noise | Zero JavaScript exceptions; one resource `ERR_FAILED` corresponds to the deliberately blocked Google Fonts host. Full-suite `zz-runtime-errors.spec.ts` / `no unexpected console errors (network/asset/probe noise filtered)` also passes. See `.wf-streamlines/visual-verified-console.json`. |
| 9 | PASS against agreed gate | Build and web typecheck pass. Node typecheck retains exactly the three explicitly allowed errors. `node --check src/main/assets/dock.js` and `git diff --check` pass; no lint script is configured. |
| 10 | PASS | No product data/copy added. Invented fixture strings exist only in `tests/zz-streamlines.spec.ts` and isolated test profiles. |
| 11 | PASS | No production debug logging added. Console/server captures are test evidence only. |
| 12 | PASS | No live database or customer data accessed. |
| 13 | PASS | Only `wf/streamlines` is pushed. No main merge/push, production deployment or DART access. |
| 14 | PASS | Base `b0e3004`, worktree branch, original source copies and six separate commits preserve rollback points. No database changes. |
| 15 | PASS | No credentials loaded or new secrets added; test profiles/evidence are ignored. Screenshots stay local. |
| 16 | N/A | The explicit instruction to hold screenshots locally overrides screenshot delivery through `shot`/`shot-approve`. None sent or committed. |
| 17 | PASS | Report distinguishes passing focused checks, unchanged baseline failures, measured image comparison and unverified live hardware/Windows/OBS CEF paths. |
