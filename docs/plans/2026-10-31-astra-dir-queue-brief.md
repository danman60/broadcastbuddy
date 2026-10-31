# Astra brief — Auto Director shot queue: the experience on the tablet

Sprint launch (owner 2026-10-31 00:08 ET via sysadmin: "We want Astra running on all these sessions till its usage
is gone"). Pre-approved; budget self-stop OFF for this sprint (still stop at 3% left).

Use the bootstrap skill (`~/.claude/skills/bootstrap/SKILL.md`) in EXISTING PROJECT mode, input mode "I have a
spec", skip the interview.

## How you work
- You do the work yourself. No helper agents.
- Senior work: design, wiring across BB ↔ tablet, the real-UI test. Local models optional, never critical path.
- Something clickable on the emulator within the first hour. Keep `docs/WORKLOG.md` short.
- Commit and push your branch at the end of every step. `HANDOFF.md` short and true at every commit.

## Purpose (owner's words, verbatim, 2026-10-30)
- 23:51 ET: "I feel like a elegant, beautiful UI experience to know what shots are coming up in director would be
  great as well so director is actually picking the next three shots maybe and you know what shot's coming up in all
  three visually"
- 21:3x ET: "and i wanted big numbers on the actual boxes" · "and big 3 2 1"
- 20:5x ET: "Like you're cycling shots and I'm teeing them up, as long as i know where you're going"
- "Override should turn it off and hotkey turns on."

This exists so that the operator, glancing at the tablet, knows which three shots the director will take next and
when, beautifully, so he can tee each camera up in time.

## What exists (read these first; extend, don't rebuild)
- BB (Electron, TypeScript): `src/main/services/autoDirector.ts`. It already decides a queue of 3 shots (scene and
  hold length fixed when queued). It sends state over the wsHub (`src/main/services/wsHub.ts`, `buildStateMessage`)
  as `autoDirector: {on, live, next, secondsLeft, msLeft, nextTile, tiles, liveTotalMs, upcoming[{scene,inMs,holdMs,tile}], message}`.
  Settings UI: `src/renderer/components/Settings.tsx` (search `adScenes`). Plan + deviations:
  `docs/plans/2026-10-31-auto-director.md`.
- Tablet (Android, Kotlin, Compose): CSController `app/src/main/java/com/compsync/controller/ui/DisplayScreen.kt`.
  - The video is a cast of the OBS Multiview, a 2×2 scenes-only grid, stretched to the video Box. Tile i sits at
    column i%grid, row i/grid; touches map the same way.
  - Current first version, not yet seen on a real device: `DirectorQueueRow` (strip LIVE › NEXT › THEN › AFTER),
    `AutoDirectorTileCountdown` (big countdown on NEXT's tile, numbered badges on the next two), and the DIR chip in
    `ButtonRow`.
  - Parsing: `network/WsController.kt` (`parseState`, `CompSyncState`, `DirShot`).
- Tablet scene names on the owner's multiview: Cam1, Cam2, Cam3, StartingSoon.

## Design freedom
You are the designer of this experience: the layout, hierarchy, motion, colour, type and how the queue reads at a
glance across a room. Explore more than one direction, pick the strongest and record why in
`docs/design/DIR-QUEUE-DIRECTION.md` (CSController repo). The first version is a starting point, not a template. You
may drop the strip, move it, or merge it into the tiles. Design skills are available to you in `~/.codex-astra/skills`
(`design-taste-frontend`, `impeccable`, `transitions-dev`), and the anti-slop check (taste Gate + impeccable
`craft-floor.md`) runs on the result.

Fixed points, each traced to the owner:
- Show the next three decided shots and when each happens ("you know what shot's coming up in all three").
- Big numbers on the multiview tiles themselves ("big numbers on the actual boxes").
- A big 3 2 1 before the cut ("big 3 2 1").
- The countdown must match the real cut. He reported "it said 8s left and still switch" and "glitching out between
  1/0". The tablet counts locally from `msLeft`; keep that accuracy.
- DIR on/off still works from the tablet (tap) and stays off after a human override.
- It must not cover what the operator needs in the tiles: he taps tiles to switch program (OBS click-to-switch
  through the cast), so overlays must not consume touches.

## Repos and branches (already created; work only here)
- CSController worktree `~/projects/CSController-astra-dirq`, branch `astra/dir-queue-ui`.
- BroadcastBuddy worktree `~/projects/BroadcastBuddy-astra-dirq`, branch `astra/dir-queue-ui`. Only change BB if the
  tablet needs data it doesn't have. Keep the state message backward compatible (tablet v0.3/v0.4 still parse it).
- Push both branches. Do NOT merge to main and do NOT push main; the Claude session reviews and merges.
- Bump tablet `versionCode` / `versionName` in `app/build.gradle.kts` (currently 7 / 0.4.0-shot-queue).

## Tests: real UI, proportionate (no mocks, no unit-test frameworks)
- Run real BB from the worktree (`npx electron-vite build`, then launch it under xvfb-run as the existing Playwright
  specs do; see `tests/zz-camera-voice.spec.ts` for the launch pattern). Real ports 19080/19081.
- A throwaway local OBS (`/usr/bin/obs`) with its own config dir (e.g. HOME pointed at a scratch dir), under xvfb, with
  obs-websocket enabled and no auth, 4 scenes Cam1/Cam2/Cam3/StartingSoon, and multiview layout 2×2 scenes-only.
  Never touch `~/.config/obs-studio` or any OBS you did not start. Kill only PIDs you started.
- Tablet: Android emulator AVD `dantv-mobile-tablet` (`~/Android/Sdk/emulator/emulator`). The tablet connects to BB
  over WS at the host from the emulator (10.0.2.2). There is no video cast in the emulator; the overlays must still
  render in the video area so you can judge them.
- Proof: turn DIR on, then capture emulator screenshots (`adb exec-out screencap -p`) at about 10 s, 3 s and 1 s
  before a cut, and just after the cut. Log BB's `auto director: cut … (… ms vs countdown)` lines next to them.
  Screenshots are held: save them under `docs/screenshots/` in the CSController worktree; never send them anywhere.
- Check the BB Settings → Camera → Auto Director table renders with OBS connected (screenshot) — first time it has
  been seen with real OBS.

## Hard limits
- Never SSH to or touch DART (the show machine), FIRMAMENT, or the physical tablet. No Drive uploads, no email,
  no Telegram.
- No production anything; no R2 update publish (`scripts/publish-update.mjs` is off-limits).
- Don't touch broker/GPU state, `~/.config/obs-studio`, or other tmux windows.
- Never invent data fields or scene names beyond the four above.

## Deliverables
- Both branches pushed with the design direction doc, the built APK path (`app/build/outputs/apk/debug/app-debug.apk`)
  noted in HANDOFF.md, emulator screenshots, and the cut-timing log lines.
- `HANDOFF.md` in the CSController worktree: what changed, what was proven on the emulator, what remains unproven
  (real cast video under the overlays, the real Fire tablet).
- Report `~/projects/docs/DONE-CHECKLIST.md` item by item (pass / fail / n-a with evidence) at the end of HANDOFF.md.
