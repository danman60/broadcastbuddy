# Streamlines handoff

Branch: `wf/streamlines`. Base: `b0e3004`. No deployment or device access.

- Untouched full suite: 424 passed, 22 failed, 6 skipped, 10 did not run.
- Baseline titles/log/results and fired-overlay PNG held in `.wf-streamlines/`.
- Item 1: lower-third, ad-hoc and feature-card scheduling share one helper; timer handles remain separate.
- Item 2: next/previous use one navigation body; framing, markers and delayed auto-fire keep their order.
- Item 3: heartbeat liveness uses a typed WeakMap; the 30-second ping/termination cycle is unchanged.
- Item 4: IPC is split into domain files; 191 handlers and all 210 registration statements match verbatim and in order, except relative imports. Nine helper bodies are unchanged.
- Item 5: already implemented at the base commit. `overlaySource.ts` is byte-identical; its boundary and only application caller are documented in `docs/overlay-source-boundary.md`.
- Item 6: dock HTML/JS are packaged assets, Express retains `/dock` and serves `/dock.js`, and each build parses the JS. Added real Electron dock/timer/heartbeat coverage with local fakes.
- Final full suite: 447 passed, 13 failed, 6 skipped, 0 did not run. No new failing title; both lists are in `docs/wf-wf-streamlines-REPORT.md`.
- Build passed; web typecheck is clean; node typecheck has exactly the three allowed pre-existing errors. Four focused real UI tests also passed.
- Graph callers and verbatim move audits passed. Dock screenshots inspected at 300/390/500/1440 px.
- Final focused rerun: all four tests passed. Fired-overlay comparison: first post-change capture is pixel-identical; the isolated default-style capture differs only at text/card edges (0.326%). Details and paths are in the report.
- No implementation or verification work remains. Local screenshots/logs are held under `.wf-streamlines/` and `tests/screenshots/`; no production or device verification was attempted.
