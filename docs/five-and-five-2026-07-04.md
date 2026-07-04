# Five and Five — BroadcastBuddy PTZ surface (2026-07-04)

Scope: Xbox stick calibration, slow preset-to-preset moves, Stream Deck camera buttons, tablet CSController PTZ popup, shot recorder, voice director, multi-cam.

## KILLER FEATURES

1. **[industry-standard] Camera STOP button everywhere + abortable moves** (~1hr)
   - `voiceDirector.ts:387-389` (only stop entry point), `wsHub.ts` (no `cameraStop` case), `cameraDirector.ts:692-707` (sweep loop has no abort flag)
   - Every hardware PTZ controller has a panic STOP; today an in-flight 20s waypoint glide or replay on-air is uncancellable from deck/tablet — and even voice stop can't abort the sweep loop's remaining legs.
   - Build: WS `cameraStop` action + deck key + per-host abort token checked in sweep/replay loops.

2. **[boring-overlooked] PTZ activity state in the WS broadcast** (~half-day)
   - `wsHub.ts:50-64` (`buildStateMessage` has zero camera state), `camera.ts:176-179` (deck comment admits "no recording state back"), `shotRecorder.ts:60-69`
   - Xbox Back starts a recording with no visible confirmation; nothing shows "sweep in flight / replaying / active cam = 2". Add `camera:{activeCam, recording, replayingMoveId, sweepRunning}` to the state broadcast so deck faces + tablet popup render live status.

3. **[creative] Trigger-fired choreographed moves** (~half-day)
   - `cameraDirector.ts:329-356` (`applyRoutineForTrigger` runs on every fire), `wsHub.ts:182-198` (sweep primitive), `shotRecorder.ts:131-159` (replay by id)
   - Attach an optional camera move (sweep from/to/waypoints or recorded-move id) to a trigger — the finale's audience sweep fires itself with the routine while the operator is busy with lower thirds.

4. **[creative] Xbox controller haptic confirms** (~1hr)
   - `gamepad.ts:210-299` (`pad.vibrationActuator.playEffect()` available in Chromium), `:286` (record toggle currently silent), `:236-249` (AI-off latch only flashes UI)
   - Operator's eyes are on stage, not panel — rumble on record-start (double-pulse stop), preset recall, AI-latch. Invisible mode changes become felt ones, zero new hardware.

5. **[industry-standard] Preset thumbnails + stored-slot verification** (~half-day)
   - `CameraPanel.tsx:399` (blind numbered buttons), `:648` (live video preview to snapshot), `cameraDirector.ts:1087-1102` (`getCameraPresetIds` exists, only VoicePanel uses it)
   - Snapshot the UVC preview on preset save, grey out slots deleted on-camera — deck moves like `from:2,to:3` never sweep to a garbage pose. No pose read-back needed.

## STREAMLINES

6. **cancelReplay leaves camera moving — stop touched cameras on cancel** (~10min)
   - `shotRecorder.ts:171-179` — cancel clears timers incl. the scheduled gimbalStop; an already-fired velocity command keeps the camera panning indefinitely. On-air safety fix.

7. **Delete dead camera settings: cameraBreathing + cameraTrackingSpeed** (~10min)
   - `Settings.tsx:553,398,401`, `settings.ts:49,52`, `types.ts:447` — breathing documented REMOVED in `cameraDirector.ts:269-273`; trackingSpeed read nowhere. Two knobs that do nothing.

8. **Centralize duplicated move magic constants** (~1hr)
   - Sweep 6000ms in `wsHub.ts:189` + `camera.ts:92,105` + `voiceDirector.ts:379`; slow-zoom 10000/1.5 in 3 files; pull-out 0.67; nudge speed 40 — one `shared/cameraMoves.ts`, retune once not five places.

9. **One calibration for both control surfaces** (~1hr)
   - `CameraPanel.tsx:26` (`GIMBAL_SCALE = 178` for on-screen joystick) vs gamepad capped at 30 — same camera, wildly different max speed by which stick you grab. Route nipplejs through `cameraStickMaxSpeed`/deadzone/expo so the Settings group governs ALL manual pan/tilt.

10. **Dead activeCamRef + stale ×178 comments** (~10min)
    - `CameraPanel.tsx:126-127,369` (ref written never read); `cameraControl.ts:22,37-38,130,141` (comments still claim ×178 scaling — misleads next calibration change).
