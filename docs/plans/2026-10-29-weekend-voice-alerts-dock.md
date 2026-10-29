# 2026-10-29 — Weekend readiness: voice presets, show alerts, OBS dock

Purpose (owner, 2026-10-29 06:58 ET): "voice control tested beforehand ... to jump to different presets",
"better alert monitoring on whether the OBS bot has stopped recording or stopped responding",
"something more elegant like a plug-in or dock for OBS. It's very difficult to switch to the full app during production".

Base: `main` (shared-ptz unbuildable — its @compsync/camera Oct source is gone; restored the Jun 21 package from
the 2026-09-01 repo-backup bundle into /mnt/data/projects-relocated/obsbot-control).

## Steps

1. **Voice presets on real SAPI** — DONE 423ba5f. Acceptance: voice-helper/test/voicetest.ps1 on FIRMAMENT,
   12/12 phrases recognized conf ≥ 0.98, junk rejected. Found + fixed: sweep verb crashed the SAPI grammar
   compiler whenever shots existed (dropped from voice); "preset" lead ignored; slots 1-8 needed Voice-panel setup.
2. **Show monitor** (`src/main/services/showMonitor.ts`) — 3 s poll. Alerts: OBS not responding (disconnected or
   GetRecordStatus fails), recording stopped, recording stalled (outputBytes flat), stream dropped, camera 1/2 not
   responding (GET /camera/sdk/ai/workmode fails 2x). Native Windows notification on each new alert. State in the
   WS `state` message (`health`); `ackAlerts` WS command silences. Acceptance: headless BB + fake OBS WS server /
   fake camera HTTP → each alert appears in WS state and clears on recovery.
3. **OBS dock** (`GET /dock`, plain HTML over the existing WS hub) — alert banner + beep, status row (OBS, REC
   timecode, stream, cams, voice), cam select, presets 1-8, STOP/AUTO/WIDE, hold-to-talk, LT fire/hide/next/prev.
   OBS: View → Docks → Custom Browser Docks → `http://127.0.0.1:19080/dock`. Acceptance: screenshot at dock
   widths 300 / 500 px, buttons send the right WS commands (verified in BB log).
4. **Deploy to DART** — BLOCKED: DART offline on Tailscale (last seen 2026-10-24). Needs FIRMAMENT `--dir` build
   + asar swap + `resources/voice-helper/voice-helper.exe` copy.

## Deviations
- (log here)
