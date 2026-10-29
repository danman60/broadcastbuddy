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

Validation: PASS, `tests/zz-operator-features.spec.ts` tests
“defaults are off; settings enable dock controls and meter without restarting” and
“undo returns to the prior slot once, includes wide, isolates cameras and ignores
bad input”. Actual HTTP recalls reached the two local camera fixtures. Duplicate
undo, repeated preset, Wide, camera isolation, reload, bad input, and disabling/
reenabling the feature were exercised.
Screenshots: `tests/screenshots/operator-undo-{300,390,500,1440}.png` and
`operator-settings-{300,390,500,1440}.png`; 300/500 px PNGs visually reviewed.
Not verified: actual PTZ travel, camera firmware rejection, OBS CEF rendering,
or a separate UI exercise of the endpoint-change history reset.

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
Validation: PASS, the three “dock recovery {saved|fallback|legacy} restores the
displayed performer and clears the main banner” cases, “dock recovery gate,
dismiss and main-window restore all stay synchronized”, “main-window restore
clears the dock prompt through the shared action”, and “pending snapshot survives
the periodic writer while the operator decides” in the operator spec. The latter
waited across two real 30-second snapshot intervals: pending data stayed intact,
then the resumed position/played IDs/current session were written correctly.
All four `tests/recovery-restore-fallback.spec.ts` regressions also passed,
including persistence after a styling edit and preservation of the other session.
Screenshots: `tests/screenshots/operator-recovery-{300,390,500,1440}.png`
and `operator-recovery-main-{before,after}.png`.
300/500 px dock and both 1440 px main-window PNGs visually reviewed.
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
Linux Electron protocol/UI validation: PASS, “voice levels reach panel and dock;
invalid, stale and old helper data stay unavailable” and the defaults/settings
case. The real child-process stdio fixture covered 0%, 100%, invalid/stale data,
meter on/off, unchanged grammar, stopped helper, and recognition through an
old-helper protocol fixture. Adjacent shot save/rename/verify/recall/delete,
glide, confidence, camera tabs, and advanced disclosure controls were exercised.
“dock controls remain usable and become disabled for new actions when BB
disconnects” also passed, including the unavailable meter after disconnect.
Screenshots: `tests/screenshots/operator-meter-{300,390,500,1440}.png` and
`operator-voice-{live,unavailable}-{300,390,500,1440}.png`.
300/500 px live and unavailable panels and dock meters visually reviewed; the
390 px dock and 1440 px panel were also reviewed. No clipping or horizontal
overflow in the changed controls. Native meters retain numeric/unavailable text.
Not verified: spoken SAPI command recognition with meter enabled, a new Windows
installer, an actual old Windows helper executable in Electron, real OBS CEF,
and extended-duration microphone capture.

## Validation and scope

The supplied graph was missing from this worktree; copied its JSON/report from the
sibling checkout into ignored `graphify-out/`. Used explain, affected, and query
before edits; inspected call sites for preset, wide, recovery, helper lifecycle,
and UI state changes. Existing public signatures remain compatible.

All Electron scenarios use isolated temporary profiles and a staged copy of the
actual build. Camera/OBS endpoints and the helper protocol are local test fixtures.
The Windows exe is tested separately on FIRMAMENT. Screenshots and profiles are
held locally and are not committed or uploaded. The isolated Electron processes,
browser instances, fixture servers, and the held heavy slot were all closed.

`heavy -- npx tsc --noEmit -p tsconfig.web.json`: PASS, zero errors.
`heavy -- npx tsc --noEmit -p tsconfig.node.json`: the three known baseline errors
only (`ccRelay.ts:220`, `ccRelay.ts:282`, `chatBridge.ts:180`); no new errors.
`heavy -- npx electron-vite build`: PASS. Existing warning: audioTranscription is
both statically and dynamically imported. No linter script is configured.

Electron command, after each build and inside `heavy`:

```sh
flock /tmp/bb-electron-test.lock xvfb-run -a npx playwright test tests/zz-operator-features.spec.ts --workers=1 --reporter=line
```

Final result: all 10 operator scenarios verified, plus all four existing recovery
regressions. The corrected full operator run passed nine cases in 1.5 minutes;
one assertion matched Settings' unrelated backup Restore button. After scoping
that assertion to the recovery banner text, its targeted rerun passed in 2.3
seconds. No product changes followed the passing build/typechecks. The earlier
checklist/Settings selector collision was also corrected through real UI actions.

Held evidence:

- `graphify-out/operator-validation.log`: first build, four recovery regressions,
  and initial operator run.
- `graphify-out/operator-validation-recheck.log`: final full operator run.
- `graphify-out/operator-validation-recovery-final.log`: passing targeted recovery
  gate/dismiss rerun (`--grep 'dock recovery gate'`).
- Final application/console logs and synthetic profiles:
  `/tmp/bb-operator-a7TWLi`, `/tmp/bb-operator-s9a8oq`, `/tmp/bb-operator-PS6e2R`.
- All screenshot filenames above are under `tests/screenshots/` and ignored.

Application logs contain the expected synthetic crash alerts and no application
errors. Console review found no page errors. Existing environment notices remain:
unpackaged Electron CSP, Chromium audio autoplay, Node color-environment conflict,
and unavailable Linux desktop notifications under Xvfb. These are not treated as
proof of packaged Windows behavior. No production deployment was attempted.

## Done checklist

Reviewed `/home/danman60/projects/docs/DONE-CHECKLIST.md` item by item after the
final targeted run. The browser review also checked that the additions retain
the existing operator layout, use factual labels, and fit narrow dock widths.

| # | Status | Evidence |
| --- | --- | --- |
| 1 | PASS | Actual Electron main window and Chromium dock at 1440 px; main recovery before/after, dock recovery, and voice-panel PNGs visually reviewed. |
| 2 | PASS | Real browser captures and overflow assertions at 300, 390, and 500 px. Every changed dock/panel area reviewed at 300 and 500; 390 px dock reviewed too. No phone-side flow. |
| 3 | PASS for this scope | Clicked all new toggles and undo/restore/dismiss controls, plus adjacent camera presets/tabs, Wide/Auto/Stop, PTT, lower-third controls, and voice shot/glide controls. This is not an exhaustive regression of unrelated legacy Settings sections. |
| 4 | N/A | Local desktop/dock has no account roles or login flow. |
| 5 | PASS | Defaults, unknown undo history, empty shots, absent recovery, and unavailable mic levels passed real UI assertions. |
| 6 | PASS | Invalid preset/level messages, duplicate undo/restore, reload, stale/old helper, and disconnect scenarios passed. |
| 7 | PASS | Read final application/stdout/console logs in the three held profile directories above; only expected fixture alerts/environment notices. |
| 8 | PASS relative to baseline | No page errors or new product warnings. Existing unpackaged Electron CSP and Chromium audio autoplay notices are recorded above. |
| 9 | PASS relative to baseline | Build and web typecheck pass. Node typecheck has exactly the three pre-existing errors above. Lint N/A: no configured script. |
| 10 | PASS | Synthetic performers, sessions, endpoints, and helper are confined to tests and isolated temporary profiles. |
| 11 | PASS | No product debug prints added. The test reports its held artifact directory intentionally. |
| 12 | PASS | No live database or customer records accessed. |
| 13 | PASS | Only `wf/operator-features` is pushed with `DEPLOY_OK=1`; checkpoint `0c560b6` confirmed on origin. Final report/test-selector follow-up uses the same branch. No main push, merge, or deployment. |
| 14 | PASS | Dedicated worktree/branch retains base `b0e3004`; no history rewrite, destructive source operation, or database change. |
| 15 | PASS | No secrets added. Screenshots are ignored and held locally. Test profiles contain synthetic data only. |
| 16 | N/A | The run explicitly requires screenshots to remain local, overriding the checklist's send/approve workflow. Local visual review replaces sending. |
| 17 | PASS | Results and unverified physical/Windows/live-show behaviors are identified per feature above. |
