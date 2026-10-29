# Streamlines handoff

Branch: `wf/streamlines`. Base: `b0e3004`. No deployment or device access.

- Untouched full suite: 424 passed, 22 failed, 6 skipped, 10 did not run.
- Baseline titles/log/results and fired-overlay PNG held in `.wf-streamlines/`.
- Item 1: lower-third, ad-hoc and feature-card scheduling share one helper; timer handles remain separate.
- Item 2: next/previous use one navigation body; framing, markers and delayed auto-fire keep their order.
- Item 3: heartbeat liveness uses a typed WeakMap; the 30-second ping/termination cycle is unchanged.
- Item 4: IPC is split into domain files; 191 handlers and all 210 registration statements match verbatim and in order, except relative imports. Nine helper bodies are unchanged.
- Item 5: already implemented at the base commit. `overlaySource.ts` is byte-identical; its boundary and only application caller are documented in `docs/overlay-source-boundary.md`.
- Graph callers reviewed. Final build, typechecks, full suite and image comparison pending.
- Next: dock assets, then final verification and report.
