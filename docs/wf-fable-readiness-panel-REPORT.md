# Report — pre-show readiness view (branch `fable/readiness-panel`, 2026-10-29)

Ten-and-ten 2026-10-29 feature 6: a pre-show checklist that ticks ITSELF from live state.
Two designs behind one setting, both OFF by default. Nothing on DART was touched.

## Setting
`readinessView: 'off' | 'panel' | 'dock'` — `src/shared/types.ts` AppSettings, default `'off'` in
`src/main/services/settings.ts`. UI: Settings → General → "Pre-show Readiness" → Show checks (select; saves
on change, no Save button needed). Screenshots: `tests/screenshots/readiness-settings-panel.png`, `…-dock.png`.

## What it does (both designs share `src/main/services/readiness.ts`)
Rows, each green / amber / red / grey(off = not configured, never blocks READY), with a plain-English
fix line on amber/red:

| row | source | green | amber | red |
|---|---|---|---|---|
| OBS | showMonitor.getHealth().obs | connected | — | not connected → "Start OBS, then check Settings → OBS Connection…" |
| Recording folder | OBS `GetRecordDirectory` + `fs.accessSync(W_OK)` + `statfs` (same thresholds as systemMonitor) | writable, ≥ 50 GB | OBS down / reading / < 50 GB | not writable / < 20 GB → "OBS → Settings → Output → Recording path…" |
| Camera 1 / 2 | health.cams (cam 2 row only when cameraHost2 set) | answering | checking… | not answering → "Power the OBSBOT and check it is on this network at <ip>" |
| Voice | voiceDirector.getStatus() + helper mic name (new `getMicName()`) | ready · <mic> | starting… | helper down → toggle Voice off/on, restart BB |
| Voice mic | last hold result / `voice-mic-silent` alert | heard "<text>" | not tested yet → "Hold to talk once and say preset 1" | heard silence → pick the right mic |
| Session | session.getCurrentSession() + overlay.getTriggers() | <name> · N triggers | — | none loaded / 0 triggers |
| Overlay source | wsHub identified client `overlay` | connected | — | not connected → refresh the browser source http://127.0.0.1:19080/overlay |
| OBS dock | wsHub identified client `obs-dock` | connected | not connected → add the dock URL | — |

READY = no amber/red rows. Polled every 3 s only while the view is on (record folder is the only new
OBS request; everything else reuses showMonitor / voiceDirector / wsHub state). Turning the view off
stops the poll and clears the dock strip on the next tick.

### 'panel' — card in the show rail (`src/renderer/components/ReadinessPanel.tsx`, `styles/readiness.css`)
Top of the right-hand rail, same `.panel-section` chrome as the other cards; badge READY (green) or
"N TO FIX" (amber); IPC `readinessGet` polled every 3 s. Screenshots: `readiness-panel-main.png` (whole
window), `readiness-panel-ready.png`, `readiness-panel-red.png` (nothing wired), `readiness-panel-rec-bad.png`.

### 'dock' — strip at the top of the OBS dock (`src/main/services/dockPage.ts`)
`readiness` rides the WS state message only when the view is 'dock'. All pass → one green chip
"● READY · voice off" (off rows named, collapsed; tap → the rows). Anything amber/red → "● N TO FIX",
auto-expanded with the fix lines; tap to hide. Screenshots: `readiness-dock-ready-300.png`, `-500.png`
(collapsed), `readiness-dock-open-300/500.png` (expanded), `readiness-dock-tofix-300.png`.

## Tests — `tests/zz-readiness.spec.ts` (real Electron, local fakes: obs-ws v5 mock, fake OBSBOT HTTP, raw
WS client identifying as `overlay`, Chromium on /dock identifying as `obs-dock`)
`flock /tmp/bb-electron-test.lock xvfb-run -a npx playwright test tests/zz-readiness.spec.ts --workers=1 --reporter=line`
→ **4 passed (14.5 s)**, console errors: none.
1. default off: `readinessGet` null, no strip in the dock, no card in the app — pass
2. panel: picks the view through the real Settings select; red rows each carry a fix; wires OBS + camera +
   session (2 triggers) + overlay + dock → READY; detail shows the record folder + free GB — pass
3. panel: record folder set to a missing path → red with "Recording path" fix; restored → clears — pass
4. dock: READY chip collapsed at 300 and 500 px, tap expands 8 rows, no horizontal overflow; overlay client
   dropped → "1 TO FIX" auto-expanded with the /overlay fix, no dock console errors — pass
Regression: `zz-show-monitor-dock`, `checklist-items`, `daychecklist-ui` → 17 passed.
Typecheck: web 0 errors; node 3 (the pre-existing ccRelay ×2 + chatBridge). `npx electron-vite build` ok.
Note: the "all green" path needs a filesystem with ≥ 50 GB free for the mock record folder; the spec picks
/mnt/firmament/tmp on this box (/tmp has 44 GB) and skips the READY-chip assertions if none exists.

## DONE checklist
1 real browser desktop — pass (Electron window 1100×800 + Chromium dock; screenshots above) · 2 phone width — pass
(dock 300/500 px, the OBS dock's real widths) · 3 click every control — pass (Settings select, dock strip header,
Close) · 4 roles — n/a (single operator) · 5 no data — pass (`readiness-panel-red.png`: nothing wired, every row
explains itself) · 6 break it — pass (unwritable folder, overlay dropped, OBS down at start) · 7 logs — pass
(main.log: no readiness warnings; GetRecordDirectory failures are logged, not thrown) · 8 console — pass (none) ·
9 build/typecheck — pass (lint: no lint script in repo) · 10 fake data — pass (fixtures only in the spec; the spec
parks + restores this box's camera/compact settings) · 11 debug logs — pass (none left) · 12 live DB — n/a ·
13 prod path — pass (branch only, never main, DART untouched) · 14 backup — pass (branch commit) · 15 secrets — pass ·
16 screenshots — held in tests/screenshots, read by me, not sent · 17 see "Not verified".

## Not verified
- On a real OBS: `GetRecordDirectory` on Windows paths (statfs on `D:\…` uses the drive-root trick from systemMonitor),
  the strip inside OBS's CEF dock, and the native Voice/Voice-mic rows (voice-helper.exe is Windows-only; here they
  are grey "off").
- Camera 2 row (cameraHost2 unset in the spec). Voice "starting…" and "helper down" states.
- Not deployed anywhere; DART untouched.
