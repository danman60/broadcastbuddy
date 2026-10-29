# BroadcastBuddy operator features

Branch: `wf/operator-features`. Worktree: `BroadcastBuddy-wf-ops`.

Implemented default-off camera undo, dock crash recovery, and optional voice mic
levels. Settings are exposed in General > OBS Dock and Camera > Voice Control.
Shared recovery actions update both the main window and the dock.

FIRMAMENT helper built only in `D:\Shared\voice-helper-build-wf`; default and named
mic smoke tests passed ping/pong, about five level messages/second, and meter-off.
The compiled exe is in this branch's resources folder. Voice grammar unchanged.

Build and web typecheck pass; node typecheck has only the three known baseline
errors. Four existing recovery regressions and seven operator cases passed. Three
operator cases hit a checklist/Settings selector collision, now corrected in the
harness. The corrected run is queued behind `heavy`; final UI review is pending.
See `docs/wf-wf-operator-features-REPORT.md`. No DART access or deployment.
