# Pre-show readiness view (ten-and-ten feature 6) — 2026-10-29

Purpose line: "a pre-show readiness view that ticks ITSELF from live state", two designs behind
`readinessView: 'off' | 'panel' | 'dock'` (default off).

## Steps
1. types.ts: `readinessView` on AppSettings; `ReadinessRow`/`ReadinessReport`; `readiness?` on WsStateMessage; IPC `READINESS_GET`.
   Accept: tsc web + node clean (3 pre-existing node errors only).
2. settings.ts default `readinessView: 'off'`.
3. services/readiness.ts (new): poll 3 s while view != off — OBS `GetRecordDirectory` → writable (fs.accessSync W_OK) + free GB (statfs);
   rows from showMonitor.getHealth(), voiceDirector.getStatus()+getMicName(), session/overlay triggers, wsHub client names.
   `getReadiness()` null when off. Accept: spec rows green with fakes; red when record dir unwritable.
4. voiceDirector.ts: remember helper `{t:'mic',name}` → `getMicName()`.
5. wsHub.ts: `getClientNames()`; `readiness` in state when view === 'dock'.
6. dockPage.ts: strip above alerts; collapses to one READY chip when all rows ok. Accept: dock screenshots 300/500 no overflow.
7. ipc.ts + preload: `readinessGet`. ReadinessPanel.tsx + readiness.css in the show rail when view === 'panel'. Settings → General select.
   Accept: panel screenshot matches rail cards.
8. tests/zz-readiness.spec.ts (real Electron, mock OBS/camera/overlay client). Report docs/wf-fable-readiness-panel-REPORT.md.
