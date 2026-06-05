# BroadcastBuddy — Operator Live Walkthrough (eyes-only items)

Everything testable remotely was verified overnight (overlay elements/animations, CC apply, auto-save, OBS record control, OBS auto-connect, cast watchdog respawn — see `docs/plans/2026-06-04-overnight-e2e-stagecoach.md`). The items below need a human at the OBS/tablet because they're visual or need OBS scene config — they can't be driven remotely.

Machine: DART. BB launches elevated via `schtasks /run /tn LaunchBroadcastBuddy` (or the "BroadcastBuddy (Admin)" desktop shortcut). OBS on `127.0.0.1:4455` (pw `123456`). Tablet `192.168.0.131`.

## 1. Overlay actually composites in OBS
- In OBS, confirm a Browser source pointing at `http://localhost:19080/overlay` exists in the program scene (1920×1080, transparent).
- In BB, select a trigger → **Fire** (or Space). The lower third should appear in OBS program output, bottom-left, with the session's styling.
- Toggle Clock / Counter / Grid (or Stream Deck) → confirm each renders in OBS.
- Fire a `title_card`/`feature` trigger → confirm the full-screen feature card composites.
- Verdict: overlay HTML renders correctly (verified headless); this confirms it's wired into the OBS scene.

## 2. Audio meters
- BB right column → audio meters. Speak / play audio through an OBS audio input.
- Confirm the dBFS bars move and peak-hold behaves. (Renderer-only visual — couldn't verify remotely.)

## 3. Slow zoom + transition revert  (needs OBS scene config)
- Requires two scenes (a WIDE and a TIGHT framing) and a **Move** transition, with their names set in BB's slowZoom settings (electron-store `slowZoom`: scene/transition names). Confirm those names match your OBS.
- BB → **Wide Zoom IN** / **Tight Zoom IN** → OBS should ease between the framings via the Move transition.
- After a non-Cut transition ends, BB auto-reverts the active transition to **Cut** (~500ms settle) — confirm the "Revert" pill and that the next manual cut is hard.
- NOTE: left untested overnight on purpose — firing it blindly would have flipped your live OBS program scene without knowing your scene names.

## 4. Stream control + replay buffer
- **Start/Stop Stream**: only with a throwaway/test RTMP target set — do not test against the real livestream endpoint. Confirm BB's stream state pill tracks OBS.
- **Save Replay**: enable Replay Buffer in OBS first (it was off overnight, so `saveReplay` correctly fail-softed). Then BB → Save Replay → confirm OBS writes a replay clip.

## 5. Overlay Mode floating panels  (fixed overnight)
- BB → Tools ▾ → Overlay Mode. The main window hides; floating always-on-top panels appear over OBS.
- Drive Fire/Hide/Next/Clock/Counter from a panel → confirm the panel's LIVE/OFF dots, counter, and OBS indicators update **live** (this was broken — panels used to freeze at their mount snapshot; fixed in `e144daf`).
- Close panels via the panel's Exit → main window restores.

## 6. Tablet cast (verified remotely; visual confirm)
- Cast to tablet is running (~26 fps verified). Confirm the tablet shows the OBS/extended-display output and touch passes through.
- Watchdog: if `wifi-display-server.exe` is killed it now respawns in ~2-3s (verified). No action needed — just awareness.

## Reliability fixes shipped overnight (no action, just FYI)
- Edits now persist across BB restart (auto-load most-recent session on boot + debounced auto-save).
- OBS auto-connects on startup and now **auto-reconnects** if OBS drops mid-show (3s retry).
- Cast watchdog recovers a killed/crashed `wifi-display-server` quickly (was ~20s / sometimes never).
- Overlay Mode panels receive live state.
