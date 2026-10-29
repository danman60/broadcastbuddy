# BroadcastBuddy operator features

Branch: `wf/operator-features`. Worktree: `BroadcastBuddy-wf-ops`.

Implemented default-off camera undo, dock crash recovery, and optional voice mic
levels. Settings are exposed in General > OBS Dock and Camera > Voice Control.
Shared recovery actions update both the main window and the dock.

FIRMAMENT helper built only in `D:\Shared\voice-helper-build-wf`; default and named
mic smoke tests passed ping/pong, about five level messages/second, and meter-off.
The compiled exe is in this branch's resources folder. Voice grammar unchanged.

Build and web typecheck pass; node typecheck has only the three known baseline
errors. All 10 operator cases and four existing recovery regressions are verified
(nine operator cases in the final full run, one passing targeted selector rerun).
300/500 px dock/panel PNGs reviewed and held locally; no new clipping/overflow.
All test processes and the heavy slot are closed. See
`docs/wf-wf-operator-features-REPORT.md` for evidence, settings, and limits.
No DART access or deployment. Physical PTZ, spoken SAPI with meter enabled,
OBS CEF, and a new Windows installer remain unverified.
