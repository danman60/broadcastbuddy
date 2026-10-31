# Auto Director (BB cuts cameras, operator tees up the next shot)

**Purpose (owner 2026-10-30 20:54–20:59 ET, verbatim):** "2; countfown on tablet multivew" ·
"Like you're cycling shots and I'm teeing them up, as long as i know where you're going" ·
"Beat deduction is cool" · "Override should turn it off and hotkey turns on. Sounds like a tablet update"

This exists so that BB cycles OBS program between the camera scenes while the operator always knows
where it is going next (countdown on the tablet) and can tee up that camera before the cut.

## Facts this plan rests on (verified 2026-10-30)
- Tablet tiles are VIDEO: OBS Multiview on DART's virtual display, cast to CSController. Tile taps are
  OBS's own multiview click-to-switch. The toolbar (REC … CAM, NEXT) is native Compose in
  `CSController/app/src/main/java/com/compsync/controller/ui/DisplayScreen.kt`.
- BB → tablet state: wsHub `type:'state'` message, fields at top level; tablet parses in
  `WsController.kt` `parseState`.
- BB sees every program change: `obsConnection.ts` handles `CurrentProgramSceneChanged`.
  BB switches with `setCurrentScene(name)`.
- OBS audio meters: `InputVolumeMeters` ~50/s raw, throttled to 20/s (METER_THROTTLE_MS) before callbacks.
- Scene names on the operator's multiview photo: Cam1, Cam2, Cam3, StartingSoon.

## Behaviour
- ON via assignable Xbox action `autoDirector` and a keyboard hotkey (Settings → Hotkeys). Toggle.
- While ON: the live scene holds for at least `minShotSec` (default 6); after that the director cuts
  on the next detected beat/onset, or at `maxShotSec` (default 14) if none comes.
- NEXT is chosen the moment a cut lands (round-robin over ticked scenes, skipping the live one), so the
  operator has the whole shot to tee it up. It is shown on the tablet as `AUTO → Cam2 · 7`.
- Any program change BB did not make (tablet tap, OBS, deck, hotkey scene switch) = human override →
  director OFF. The tablet chip disappears.
- Rotation = scenes ticked in Settings → Camera → Auto Director (no default guessing: if none
  ticked, turning ON logs and shows "no scenes ticked" and stays OFF).

## Steps (acceptance check after each)
1. **Service** `src/main/services/autoDirector.ts`: state {on, live, next, cutAtMs}, timer tick 100 ms,
   `toggle()`, `onProgramChanged(name)` (ignore if it is the cut we just sent, else OFF),
   `onAudio(levels)` onset detector (envelope vs rolling mean, refractory 250 ms).
   ✔ unit-free check: dev run with OBS absent logs "auto director: OBS not connected" and stays OFF.
2. **Wire OBS**: program-changed + raw meter callbacks (unthrottled hook for the director only).
   ✔ log shows `auto director: cut Cam1 → Cam2 (beat|max)` and ignores its own cut.
3. **Settings + types**: `autoDirector?: { scenes: string[]; minShotSec: number; maxShotSec: number }`;
   UI section with scene checkboxes from OBS scene list + two number inputs.
   ✔ screenshot of the section.
4. **Triggers**: Xbox action `autoDirector`, hotkey, wsHub command `autoDirectorToggle` (tablet/deck).
   ✔ pressing the mapped button logs ON/OFF.
5. **State to tablet**: add `autoDirector: {on, live, next, secondsLeft}` to wsHub state, pushed every
   1 s while ON and on every change.
6. **CSController**: parse it; toolbar chip `AUTO → <next> · <s>` (hidden when off); tapping chip sends
   `autoDirectorToggle`. Build APK, Drive, version bump so builds are distinguishable.
7. **DART verify (owner present, not during a show)**: ON → chip counts down → cut lands on beat →
   tap a tile → OFF. Read BB log + photo of tablet.

## Deviations log
- 2026-10-30 21:40 ET — Owner: "countdown inaccurate" / "switches randomly at 9 or 8 or 7 s left". DART log
  showed beat cuts at 6–9 s while the countdown ran to maxShot 14. Fix: each shot commits a cut time
  (random min..max) when it goes live; countdown counts to it; beat may snap only within ±400 ms.
  State carries msLeft (tablet counts locally), nextTile + tiles (from OBS MultiviewLayout 6–9 = scenes-only
  grids) so the tablet draws a big countdown on NEXT's tile, yellow "3 2 1" for the last 3 s.
