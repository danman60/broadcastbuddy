# Ten and ten — Auto Director (2026-10-31 00:10 ET)

## Features
1. [industry-standard] Skip / swap NEXT from the tablet (~half-day) · autoDirector.ts queue/fillQueue, wsHub.ts:181
2. [industry-standard] Hold / freeze the live shot without turning DIR off (~1hr) · autoDirector.ts onTick
3. [boring-overlooked] Xbox Skip and Hold actions (~1hr) · gamepad.ts runAction
4. [creative] Play a recorded move when a scene goes live (~half-day) · shotRecorder.ts replayMoveByLabel
5. [creative] Pre-aim NEXT camera to its preset while the live shot runs; cut once it arrives (~half-day) · cameraDirector.ts waitForPresetPose
6. [boring-overlooked] Cut history (scene, reason, ms vs countdown) on the tablet (~1hr) · autoDirector.ts cut logger
7. [boring-overlooked] Plain-language reason on the tablet when DIR stops or won't start (~10min) · stop('OBS disconnected') sets no message
8. [industry-standard] No repeat within N shots (~1hr) · pickNext excludes only the previous scene
9. [creative] Tempo-locked beat snap (median gap between beats, predict the next) (~multi-session) · onAudio
10. [industry-standard] RESUME button for 30 s after a human override (~1hr) · stop('human override')

## Streamlines
11. Remove unused liveSince (~10min)
12. Drop secondsLeft/nextTile, derive from upcoming[0] (~1hr)
13. Delete the self-check that tests a copy of pickNext (~10min)
14. Restore transition on OBS SceneTransitionEnded, not a fixed timer (~half-day)
15. Rebuild the queue when DIR settings change mid-run (~1hr)
16. One countdown helper on the tablet, not three (~10min)
17. Read multiview layout + scene order live, re-read on scene list change (~half-day)
18. Show invalid DIR settings instead of silently clamping (~1hr)
19. Shared defaults (6/14 s, weight 2) in one place (~10min)
20. Failed cut retries every 50 ms — back off and show the reason (~10min)
