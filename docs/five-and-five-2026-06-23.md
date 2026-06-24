# Five and Five — BroadcastBuddy camera/voice subsystem (2026-06-23)

Grounded in the voice/PTZ/shot-recorder code built this session. Status: BUILT this
session where marked; others are roadmap.

## KILLER FEATURES

1. **[industry-standard] Voice command history / audit log** — scrollback of last N
   voice commands + confidence so the operator spots misfires mid-show (not a 3s toast).
   `voiceDirector.ts emitResult` / `VoicePanel.tsx` toast. (~1hr) — **BUILT**
2. **[boring-overlooked] Per-shot saved-pose verification badge** — cross-check
   `getGimbalPos().presetList` against `voiceShots` so deleted-on-camera presets are
   flagged. `VoicePanel.tsx recallShot` / spec stale-grammar race. (~half-day) — *roadmap*
3. **[creative] Slow-glide sweep (stepped intermediate presets)** — real cinematic glide
   for "sweep shot A to shot B" vs today's native A→dwell→B.
   `cameraDirector.ts sweepBetweenPresets`. (multi-session) — *roadmap*
4. **[creative] Wake-word / hands-free PTT** — bounded wake word over the already-continuous
   recognition loop, removes the deck-key dependency for a solo operator.
   `voiceDirector.ts pttDown/Up` + helper `RecognizeAsync(Multiple)`. (multi-session) — *roadmap*
5. **[boring-overlooked] Confidence-floor accept/reject readout** — show the running
   accept/reject ratio next to the slider so the floor is tuned empirically, not by feel.
   `voiceDirector.ts` floor + `VoicePanel.tsx` slider. (~1hr) — **BUILT**

## STREAMLINES

1. **Dedup active vs per-camera primitives** — `stopAllCameraMotion`/`nudgeCameraXY`/
   `zoomCameraVelocity`/`recallCameraPreset`/`slowZoomPush` (active) now delegate to their
   `*For(getActiveCameraId())` twins instead of carrying parallel bodies. `cameraDirector.ts`.
   (~1hr) — **BUILT**
2. **`getStatus()` helper-state mismatch** — returned `'down'` while starting; `pushStatus`
   used `'starting'`. Unified. `voiceDirector.ts getStatus`. (~10min) — **BUILT**
3. **Dead `onSavePreset` gamepad callback** — declared + wired but never invoked after the
   LB-save removal. Removed. `gamepad.ts` / `CameraPanel.tsx`. (~10min) — **BUILT**
4. **Sweep numeric from/to redundant coercion** — unreachable fallback could sweep to an
   UNSET preset instead of rejecting. Now rejects. `voiceDirector.ts` sweep case. (~10min) — **BUILT**
5. **Slow-zoom notify duplication** — `slowZoomPush`/`slowZoomPushFor` copy-pasted the
   sink-notify + factor branch. Folded. `cameraDirector.ts`. (~10min) — **BUILT**

## Safety fix (flagged, BUILT)

- **Second-camera AI auto-off gap** — with both Xbox sticks always live, deflecting the
  right stick drove Cam 2 while its AI kept fighting the operator (interlock only ever
  disabled the active camera). Added `setCameraAiEnableFor(id)`; gamepad now disables the
  AI of whichever camera a stick deflects. `cameraDirector.ts` / `gamepad.ts`.
