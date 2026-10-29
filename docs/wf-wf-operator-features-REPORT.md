# BroadcastBuddy operator features

Branch `wf/operator-features`; base `b0e3004`. Work performed only in
`/home/danman60/projects/BroadcastBuddy-wf-ops`, plus the explicitly allowed
`D:\Shared\voice-helper-build-wf` on FIRMAMENT. No DART access, production
changes, customer data, client messages, or main-branch pushes.

## Feature 4: undo last camera move

`cameraUndoEnabled` defaults to false. Enable it in Settings > General > OBS Dock.
The dock shows UNDO for the active camera, naming the previous preset when known.
Recalls and Wide (slot 1) maintain separate, volatile histories per camera. Repeating
the same slot preserves the previous distinct slot. Undo consumes that previous
slot once; duplicate clicks do not become redo. Restarting, changing a camera
endpoint, or changing the setting clears the history. No voice grammar change.

WS command: `cameraUndo`. Disabled settings also gate the command server-side.
History tracks commanded slots, not physical camera position or confirmed arrival.

Validation: pending Electron run of `tests/zz-operator-features.spec.ts`.
Screenshots planned: `tests/screenshots/operator-undo-{300,390,500,1440}.png`.
Not verified: actual PTZ travel, camera firmware rejection, OBS CEF rendering.

## Feature 10: crash resume from the dock

`dockRecoveryPrompt` defaults to false. Enable it in Settings > General > OBS Dock.
WS state includes a pending recovery summary. The dock offers “Resume at performer
N/M” and “Dismiss”; both use the same `recoveryActions.ts` functions as the existing
IPC handlers. Both windows clear their prompts and the main session header updates.
Saved session files retain priority. Missing files recover into a new session,
without overwriting the unrelated boot session. New snapshots include playlist
position, played IDs, and loop mode; older fallback snapshots start at performer 1.
The displayed position is the prepared restore position. Resuming does not fire a
lower third. The snapshot writer preserves a pending recovery until a decision.

WS commands: `recoveryRestore`, `recoveryDismiss`, both server-side gated.
Validation: pending Electron saved-session, fallback, legacy, dismiss, duplicate,
main-window synchronization, and pending-snapshot durability scenarios.
Screenshots planned: `tests/screenshots/operator-recovery-{300,390,500,1440}.png`
and `operator-recovery-main-{before,after}.png`.
Not verified: recovery from an operating-system crash during an actual live show.

## Feature 8: live voice mic level

`voiceMeterEnabled` defaults to false. Enable it in Settings > Camera > Voice
Control. Voice Control must also be enabled to start the helper. The panel and dock
show a labeled 0-100 peak meter. No data, stopped helpers, and stale data display
“Level unavailable”; an actual zero remains “0%”. Invalid values are ignored.

BB sends `{t:"meter",on:true}` only after opt-in; disabling sends `on:false`.
The helper emits `{t:"level",peak:0..100}` every 200 ms while requested. A separate
peak window leaves the PTT silent-mic detector intact. Named inputs reuse their
MicStream; the default input gets a metering-only capture while enabled. The default
mapper requires omitting WAVE_MAPPED, which is retained for concrete device IDs.
Old helpers can ignore the extension and keep recognizing existing commands.

FIRMAMENT compile: success (Roslyn, .NET Framework 4.8), exe 27,648 bytes.
SHA-256: `9020f89e632b81a7f62b540f7488627f0ffb236b0b94c4857ec135dac3d06431`.
Only the new build directory was written. The original build script was copied
there and its Set-Location changed. `GrammarFactory.cs` and the BB vocabulary are
unchanged. The project file now includes MicStream.cs for normal builds too.

`voice-helper/test/meter-smoke.ps1`: PASS on FIRMAMENT, default device and named
HyperX QuadCast S. Each run: ping/pong, no unsolicited levels, seven bounded levels
in 1.6 seconds, no levels after meter-off, malformed input tolerated, ping still
responsive. Default device observed 1-2%; named mic observed 0% (quiet).
Linux Electron protocol/UI validation: pending.
Screenshots planned: `tests/screenshots/operator-meter-{300,390,500,1440}.png` and
`operator-voice-{live,unavailable}-{300,390,500,1440}.png`.
Not verified: spoken SAPI command recognition with meter enabled, a new Windows
installer, real OBS CEF, and extended-duration microphone capture.

## Validation and scope

The supplied graph was missing from this worktree; copied its JSON/report from the
sibling checkout into ignored `graphify-out/`. Used explain, affected, and query
before edits; inspected call sites for preset, wide, recovery, helper lifecycle,
and UI state changes. Existing public signatures remain compatible.

All Electron scenarios use isolated temporary profiles and a staged copy of the
actual build. Camera/OBS endpoints and the helper protocol are local test fixtures.
The Windows exe is tested separately on FIRMAMENT. Screenshots and profiles are
held locally and will not be committed or uploaded.

`heavy -- npx tsc --noEmit -p tsconfig.web.json`: PASS, zero errors.
`heavy -- npx tsc --noEmit -p tsconfig.node.json`: the three known baseline errors
only (`ccRelay.ts:220`, `ccRelay.ts:282`, `chatBridge.ts:180`); no new errors.
`heavy -- npx electron-vite build`: PASS. Existing warning: audioTranscription is
both statically and dynamically imported. No linter script is configured.

The first locked Electron run passed all four existing
`tests/recovery-restore-fallback.spec.ts` regressions and seven operator scenarios.
Three operator scenarios stopped at a test selector: the automatic daily checklist
and Settings share a CSS class. The harness now dismisses the checklist with its
real Done button and identifies Settings by its accessible dialog name. A corrected
operator run and the remaining UI review are waiting for a shared `heavy` slot.
Initial output: local `graphify-out/operator-validation.log`.

## Done checklist

Reviewed `/home/danman60/projects/docs/DONE-CHECKLIST.md` item by item.
Final UI-dependent entries await the corrected locked Electron run.

| # | Status | Evidence |
| --- | --- | --- |
| 1 | Pending | Actual Electron main window and Chromium dock at 1440 px; final captures to review. |
| 2 | Pending | Capture helpers cover 300, 390, and 500 px. No phone-side flow or physical phone requirement. |
| 3 | Pending | New toggles, undo, restore/dismiss, plus adjacent camera, PTT, lower-third, shot, and glide controls are covered by the operator spec. |
| 4 | N/A | Local desktop/dock has no account roles or login flow. |
| 5 | Pending | Defaults, unknown undo history, empty shots, absent recovery, and unavailable mic levels are in the spec. |
| 6 | Pending | Invalid preset/level messages, duplicate undo/restore, reload, old helper, and disconnect scenarios are in the spec. |
| 7 | Pending | First-run application logs contain expected synthetic crash alerts; final-run logs still to review. |
| 8 | Pending | First-run console has existing unpackaged Electron CSP and Chromium audio autoplay notices; no page errors. |
| 9 | PASS relative to baseline | Build and web typecheck pass. Node typecheck has exactly the three pre-existing errors above. Lint N/A: no configured script. |
| 10 | PASS | Synthetic performers, sessions, endpoints, and helper are confined to tests and isolated temporary profiles. |
| 11 | PASS | No product debug prints added. The test reports its held artifact directory intentionally. |
| 12 | PASS | No live database or customer records accessed. |
| 13 | Pending | Work is isolated on `wf/operator-features`; branch-only push remains. No merge or deployment. |
| 14 | PASS | Dedicated worktree/branch retains base `b0e3004`; no history rewrite, destructive source operation, or database change. |
| 15 | PASS | No secrets added. Screenshots are ignored and held locally. Test profiles contain synthetic data only. |
| 16 | N/A | The run explicitly requires screenshots to remain local, overriding the checklist's send/approve workflow. Local visual review replaces sending. |
| 17 | PASS | Results and unverified physical/Windows/live-show behaviors are identified per feature above. |
