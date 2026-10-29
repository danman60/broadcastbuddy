# Ten and ten — BroadcastBuddy (2026-10-29, weekend show prep)

Owner: "pick 10 and 10 and go". Picked = show-safe items; built, tested on DART, deployed (bf6a1ea).

## Features
1. [industry-standard] Firmer confidence for bare verbs (wide/track/zoom ≥ 0.8) — voiceDirector.ts routeResult — **BUILT** (DART: "what time is the next act" → wide @0.75 blocked; commands 0.92-0.95 pass)
2. [boring-overlooked] No RECORDING STOPPED alarm on BB's own stop — showMonitor.ts pollObs — **BUILT** (DART real OBS: BB stop → none; OBS stop → alarm)
3. [creative] Dock "CAMn moving to preset N" after recall — cameraDirector.ts recallCameraPresetFor — **BUILT** (DART: note 14 s, camera arrived 15 s)
4. [creative] Undo to previous preset after a false voice fire — voiceDirector.ts emitResult — after show (feature 5-15M, 0.7-2%)
5. [industry-standard] Dock NEXT performer (title · from) — wsHub.ts playlist — **BUILT** (DART: "Bobby Allynn · DENVER, CO")
6. [industry-standard] Auto-ticking pre-show readiness checks — dayChecklistItems.ts — after show (feature)
7. [boring-overlooked] Alert after a crash restart — crashRecovery.ts / showMonitor.ts — **BUILT** (DART: fired after force-close)
8. [boring-overlooked] Live mic level meter — voice-helper Program.cs — after show (changes helper protocol)
9. [creative] Voice "confirm on dock" mode — voiceDirector.ts routeResult — not built (feature 1 covers the false fire)
10. [industry-standard] Crash resume from the dock — crashRecovery.ts / RecoveryBanner — after show (feature)

## Streamlines
1. Dead voice sweep branch — voiceDirector.ts — **DONE**
2. Wake-mode doc comment on wrong function — voiceDirector.ts — **DONE**
3. Triple auto-hide timer — overlay.ts — after show (lower-third path)
4. getSettings/setSettings aliases — settings.ts — SKIPPED: used by 6 services, not only wifiDisplay as reported; churn for no gain
5. next/prevTrigger duplicate bodies — overlay.ts — after show (lower-third path)
6. isAlive casts — wsHub.ts — skipped (cosmetic, WS hub is show path)
7. Split ipc.ts (2100 lines) — after show
8. Split overlay.ts — after show
9. Dock HTML as a static file — dockPage.ts — after show
10. Retire duplicate 'select' verb — voiceDirector.ts — after show (needs real-SAPI retest)
