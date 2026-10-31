# Auto Director tablet handoff

2026-10-31 ET. Review branch: `astra/dir-queue-ui`. No BB application or wire-contract change was needed; existing `upcoming`, `msLeft` and tile mapping supply the complete tablet experience. Do not merge or publish from this worktree.

Real Electron built from this branch and launched under xvfb against isolated OBS on 4455, with HTTP/WS 19080/19081. Settings > Camera rendered Cam1, Cam2, Cam3 and StartingSoon. Tablet DIR, F3, actual OBS human override and queue advance were exercised. The captured Cam2 to Cam3 cut logged 49 ms vs countdown. Settings UI inspection found no console errors; existing shell contrast/tiny-label issues remain.

APK: `../CSController-astra-dirq/app/build/outputs/apk/debug/app-debug.apk` (8 / 0.5.0-director-cues). Design, full proof, cut lines, checklist and operator guide are in the sibling CSController worktree's HANDOFF.md and docs/. Screenshots are held there under docs/screenshots, ignored by git; never uploaded. Real cast video and the physical Fire tablet remain unproven. Further edge checks and cleanup are recorded in that handoff.

The pre-existing untracked brief and shared node_modules symlink are retained and are not part of this documentation commit.
