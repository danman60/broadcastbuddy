# Current Work — BroadcastBuddy

## 2026-06-19 PM/overnight — Ancaster show + post-show fixes (next: 7Att Sat 11:00, Stagecoach Sun 17:30)

**Ancaster ran.** Stream had a poster-stuck-on-watch-page scare (CC-side: watch player only mounts on `stream_event.status==='LIVE'`; CF auto-detect missed it. CC shipped a time-gate — player auto-reveals 30 min pre-show — covers tomorrow, no BB go-live POST needed). OBS key/server verified correct mid-show; root was OBS not restarted after key set.

**THE Stream Deck saga — RESOLVED (`4dbb52a`):** the deck was never broken. Next presses always reached BB + advanced the engine (camera framing + OBS markers fired); the BB **window** just didn't refresh on WS/hotkey advances — `setOnStateChange` only called `wsHub.broadcastState()`, never `pushState()`. So deck face + wire updated, on-screen playlist stayed frozen → looked dead. Fix: callback now also `pushState()`. Deck **and** F6 both advance + refresh UI now (verified via live WS monitor: 5→6→7→8→9, lt:false). Deck phantom "Stream Deck Alpha" device existed but wasn't the cause.

**Tonight's commits (all pushed origin/main):**
- `c36604c` camera manual WB/exposure/focus controls (RestCamera image endpoints)
- `f0052f3` full camera control suite (tracking/subject/framing/onlyMe/zoom) + **stream-key-on-session-load fix** (was in-memory only → OBS kept old key) + **"Sync Key→OBS" button**
- `36f2006` camera SD-record button (`PUT /record/control`)
- `ff195aa` **camera routine-cadence state machine** (IDLE_WIDE→ESTABLISH→PUSH→AUTO_HOLD; always group/multi, never single-lock, onlyMe off, full-body; breathing removed; replaces dancerCount→tier derivation). In `@compsync/camera` `src/director/RoutineCadence.ts` (dryRun-verified offline).
- `76080ed` **chat fix** — CC viewer-chat self-arms from creds+chatChannel (was gated behind saved `tenantId` → empty all night); ISO timestamp parse fix. Stole CSE pattern.
- `daff9eb` **playlist advance consolidation** — `nextRoutine`/`prevRoutine` now delegate to `nextTrigger`/`prevTrigger`; Auto-Fire (default OFF) is the ONLY fire switch. One advance for every surface.
- `4dbb52a` UI-refresh fix (above).

**DEPLOYED to DART:** through `daff9eb` (asar 10:52 PM). `4dbb52a` deploy in flight at wrap. DART on **battery, no charger** (was ~90%); ssh `dart` (100.90.103.121) drops when it's off the network → tailscale "offline" — operator must keep it on WiFi/hotspot for remote work.

**OPEN / TOMORROW (bench-first, NO mid-show installs):**
- **Camera cadence BENCH (~5 min at venue, needs the Tail 2):** (1) handoff jump when AI flips on at AUTO_HOLD; (2) push speed/target feel (consts target 45/speed 2/2.5s in RoutineCadence.ts); (3) group AutoZoom actually holds a full line (else Wider nudge→P16/P24); (4) subject-lost timing (3s).
- **Subject-lost auto-poll NOT wired** — the self-heal (auto-return-to-wide + re-arm when dancers leave/enter mid-routine, so operator stops re-pressing Auto). Needs a `GET /ai/workmode` poll seeing `none`; bench the readback shape then wire. TODO in RoutineCadence.onSubjectPresent. Without it cadence only reacts to explicit advance.
- **Chat:** confirm populates with a live CC stream (watch BB log `CC viewer-chat feed status = SUBSCRIBED`). Verify 7Att + Stagecoach `stream_events` linked (event_id set) so package carries `chatChannel`.
- **Stagecoach (Sun): 0 triggers — programme not received.** Build session when user sends it.
- **Advance tomorrow:** deck Next OR F6 (both work post-`4dbb52a`). Auto-Fire OFF = advance without firing LT.
- CC items (not BB): chat-viewport-cap on watch site; stream-start time-gate (shipped `241862f`).
- Camera SD-record: **can't record SD while UVC feeds OBS** (hardware-exclusive, documented [[project-obsbot-sd-uvc-exclusive]]). HDMI-out + capture card on a Tail Air would free UVC → enable SD record (Tail 2 has no HDMI).

---

## 2026-06-19 FRESH RESTART snapshot (show day — Ancaster tonight 6:15 PM)

**Reason for /fresh:** very long session (chat wiring → OBS auto-sync → toast → pre-show cover → weekend show-prep). Clearing context.

**Show-day state (all verified via primary source this session):**
- **DART BB = latest `d379eab`** (installed, not running; operator relaunches from desktop shortcut).
- **Ancaster (tonight):** session `ancasterda2026.json` populated — stream key + rtmp + watch link (`watch/ancaster-dance-arts-2026`, title-verified) from `commandcentered.stream_events`, 33 triggers, no BOM. Auto-loads (newest updatedAt).
- **7Attitudes (Sat):** session `7attitudes2026.json` populated — key + rtmp + `watch/7attitudes-soaking-wet-2026`, 21 triggers, name dash normalized. **Operator must SELECT it Sat** (Ancaster wins boot). Backdrop MP4 hosted: `https://pub-86d237cf0ae94ad7bf69c6a1c365f0bb.r2.dev/assets/starting-soon/7attitudes-soaking-wet.mp4` (intro, not seamless loop).
- **Tablet APK:** stays on `WiFiDirect-2026-06-13` (HEAD 46a293c). Decision: **use proper router/AP (same subnet), standard Connect — NOT the WiFi-Direct toggle** (that's the June13 wifi-display breakage). No rebuild. Real getLocalIp multi-homed fix (Phase 2, docs/plans/2026-06-16) still UNBUILT / bench-first.

**Open items:**
- **Stagecoach (Sun): programme not received → 0 triggers.** Build its session same as 7Att once user sends it.
- Optional: Sat-morning bump of 7Att `updatedAt` so it auto-loads instead of operator-select.
- 7Att seamless-hold backdrop variant (current is intro w/ exit fade).
- CC watch-page beauty pass (all 3) was building CC-side by claude:15 (separate repo).
- Features this session live on DART: CC live chat (`25876d9`), OBS auto-sync (`448846d`), verified stream-key toast (`4ac11c2`), pre-show cover backdrop+countdown (`d379eab`).

---

## 2026-06-18 Session (PM-5) — Weekend events readiness: OBS auto-sync + 7Attitudes session

**Goal:** make the 3 weekend livestreams ready in BB (keys/triggers/URLs + OBS sync on connect). Verified data vs CC DB primary source (schema `commandcentered`, not `public`).

**Data readiness (CC `commandcentered.stream_events`, all 3):** stream key + rtmp (`rtmps://live.cloudflare.com:443/live/`) + event_id link + public + chat = ✅ all 3. Triggers in CC `broadcast_triggers` = **0 for all 3** (131 global triggers belong to 2 unrelated March events). So lower-thirds come from LOCAL BB sessions, not CC.

**Shipped + deployed to DART:**
- **Pre-show cover backdrop + countdown-over-backdrop** `d379eab` — full-frame opaque `#ss-backdrop` (`<video>` loop) + `#ss-backdrop-scrim` in starting-soon overlay; `StartingSoonState.backdropVideoUrl`/`backdropMode:'cover'|'none'`; countdown/title raised to z5 (draws over MP4 or HTML backdrop); video TRUE-unloads on hide (pause+removeAttribute(src)+load → zero CPU when inactive); StartingSoonPanel "Cover Mode" + backdrop-URL controls; CC_APPLY + STARTING_SOON_UPDATE pass the fields. Spec: `docs/plans/2026-06-19-preshow-cover-countdown.md`. Built FIRMAMENT + installed DART (asar: ss-backdrop + backdropMode + ss-backdrop-scrim HIT). Screenshot DM'd. Decouples countdown (always live HTML top layer) from backdrop (MP4 for rich Remotion loops / HTML for live designs). Out-of-scope (later): CC package carrying backdropVideoUrl per event; LLM-generated SS ("deterministic form + LLM style eyes").
  - **7Att backdrop asset rendered + hosted:** `StartingSoon7A` → MP4 (2.37MB, 30s, 1080p) at `https://pub-86d237cf0ae94ad7bf69c6a1c365f0bb.r2.dev/assets/starting-soon/7attitudes-soaking-wet.mp4` (R2 streamstage-galleries, curl 200 video/mp4). Operator pastes into Cover Mode. CAVEAT: it's an INTRO (fades out frames 750–900), not a seamless loop — needs a hold variant for long pre-show loops.
- **Verified stream-key-synced toast** `4ac11c2` — `pushStreamSettingsToObs` now reads back via OBS `GetStreamServiceSettings` and confirms server(+key) match before emitting `'obs:stream-key-synced'` → app-level green toast "✓ Stream key synced to OBS — <event>" (App.tsx + `.obs-sync-toast` in header.css). Fires on all 3 push paths (apply / OBS-connect / manual) with active event name; ONLY on verified read-back. Built FIRMAMENT + installed DART (asar verified: obs-sync-toast + GetStreamServiceSettings hit). NOTE: build subagent committed+pushed+built then punted before install — deploy chain (copy→scp→`/S` install→verify) hand-finished via base64 `-EncodedCommand` PS (avoids ssh quote-mangling on spaced paths). Screenshot DM'd.
- **OBS auto-sync** `448846d` — `pushStreamSettingsToObs()` (ipc.ts +67/-12). Pushes stream key/rtmp → OBS via `SetStreamServiceSettings` on (a) OBS-connect (`onConnected`, re-pushes saved streamConfig) and (b) `CC_APPLY_PACKAGE` (when `isConnected()`). No-op unless both rtmp+key present; never StartStream; catch+logged. Built on FIRMAMENT, installed (app.asar 16:39), `pushStreamSettingsToObs` verified in asar. Closes the long-standing CC-handoff TODO.
- **7Attitudes session** `7attitudes2026.json` on DART (`%APPDATA%\broadcast-buddy\sessions\`, 21 triggers, no BOM). Built from the studio's emailed programme (Jun 18 11:12 update + 13:58 page-4 fix): "Let's Get Soaking Wet!", Sat Jun 20, 20 routines single act. Matches Ancaster trigger convention (title=routine, subtitle=name=dancer group, category "Act 1", type lower_third, dancerCount 8, title_card at order 0); reused Ancaster styling + StreamStage company logo. `updatedAt` set OLDER than Ancaster so Friday boot still auto-loads Ancaster; operator selects 7Att Saturday.

**Event identity resolved:** Saturday = 7Attitudes "Let's Get Soaking Wet!" (streamEvent `46c104ab` → event `8a8101d3`). User initially said "Lindsay" — misspoke; confirmed same show. (There are 3 separate "7Attitudes" events in CC; the only one with triggers, `8c6a2155` "competitive showcase" 85, is a DIFFERENT March show — not Saturday's.)

**Open:**
- **Stagecoach (Sun) — 0 triggers, programme not received yet.** Build session same way once user sends it.
- 7Att/Ancaster triggers are local-on-DART only, not in CC `broadcast_triggers` — fine for BB on-stream LTs; revisit only if the CC watch page needs them.
- **Saturday operator flow:** relaunch BB (`448846d`) → load "7 Attitudes — Let's Get Soaking Wet!" session → apply CC 7Att package (fills key/rtmp/watch/chatChannel) → OBS auto-syncs.

---

## 2026-06-18 Session (PM-4) — CC live viewer-chat wired into BB (commit `25876d9`)

**Task (from CC INBOX, claude:15):** consume CC's Supabase Realtime chat for this weekend's 3 livestreams (Fri Jun 19→Sun Jun 21, all on DART). Two streams, contract-matched.

**DEPLOYED to DART** (app.asar 16:25, build `25876d9`) — installer `BroadcastBuddy-Setup-2026-06-18-chat.exe` (114.8 MB) built on FIRMAMENT, perMachine `/S` install. Verify hits: `bb-chat-overlay` ✅ `chat-message` ✅. Operator must relaunch from desktop shortcut.

**CC side DONE + e2e-tested** (CC commit `ad93631`): viewer `'chat'` publish on `livestream:<streamEventId>` + `chatChannel` in package `.realtime`. CC also linked all 3 `stream_events.event_id` (were NULL → CF key + chatChannel came through empty). bbEventId now = parent Event id = BB package `bbChannel`. 3 chatChannels: Ancaster `livestream:eff3025e-…`, 7Attitudes `livestream:46c104ab-…`, Stagecoach `livestream:db39f490-…`.

**Shipped (commit `25876d9` on origin/main, tsc clean, electron-vite build pass):**
- **Stream 1 viewer feed:** ccRelay 2nd channel `livestream:<streamEventId>` broadcast event `'chat'`, payload `{id,name,text,timestamp,isAdmin,isPinned}` → mapped to BB `ChatMessage` → `chatBridge.ingestExternalMessage` → operator ChatPanel. Config-gated on `chatChannel`; dormant if absent; torn down in disconnect.
- **Stream 2 pinned overlay:** existing `bb:<tenantId>:<eventId>` channel, NEW broadcast event `'chat-message'`, payload `{messageId,author,text,pinned}` → `applyRelayedChatMessage` → `OverlayState.chatMessage` → `.bb-chat-overlay` DOM (lower-left, server-side auto-hide). pinned:true show / false hide.
- `chatChannel` read config-driven from package `.realtime.chatChannel`. No streamEventIds hardcoded.
- Operator UI: ChatPanel "Screen" button fires overlay; "Hide Chat" in OverlayControls.
- Files (10): types.ts, ccRelay.ts, chatBridge.ts, overlay.ts, overlaySource.ts, ipc.ts, preload/index.ts, renderer/types.d.ts, ChatPanel.tsx, OverlayControls.tsx.

**Correction logged:** INBOX claim "chatBridge already subscribes `livestream:{competitionId}` event `'chat'`" was STALE — real chatBridge uses postgres_changes on `chat_messages` (`bb-chat:${eventId}`). CC viewer feed added as separate additive subscription, not a repoint.

**Open / next before Fri 6:15:**
- Both contract sides done + deployed. Remaining = **live chat validation on DART**: operator relaunches BB from desktop shortcut → load a weekend event (package carries `chatChannel`) → verify (1) CC viewer chat shows in operator ChatPanel, (2) pin/Screen burns `.bb-chat-overlay` on stream, (3) Hide clears it.
- **CC watch-page beauty pass** (all 3) building CC-side by claude:15 — auto-screenshots on done; no BB action.

---

## 2026-06-18 Session (PM-3) — Live camera testing on DART; build `59cf0f1` deployed

**Active task:** Live OBSBOT Tail 2 testing on DART for tomorrow's Ancaster recital (Fri Jun 19 6:15 PM). Iterating camera UX/behavior with operator at the machine.

**DART current state:** build `59cf0f1` installed (app.asar 14:46). Camera live at **192.168.0.163** (cameraHost preset in config, no BOM). cameraAutoMode currently True. Ancaster session loaded (33 triggers). **Operator must relaunch BB from desktop shortcut after each install — GUI won't launch over ssh** (see [[project-dart-deploy-mechanics]]).

**Shipped + deployed this session (commit chain on origin/main):**
- `20bc141` camera follows current routine via select/Next/Prev (no LT fire); dancerCount derived from routine name on import/startup; group breathing (AI-tier oscillation) + kill-switch
- `31913bb` persistent PTZ panel in main window (right-panel "Camera (OBSBOT)" section)
- `389638d` network auto-discovery/pairing + tabbed Settings (CSE pattern)
- `93bd971` OBS-recording routine markers (marker event w/ recordTimecode on every routine change → future DaVinci Resolve markers) + Stream Deck Next/Prev = advance-no-fire (nextRoutine/prevRoutine)
- `095ca4e` discovery validates OBSBOT JSON body (router x.x.x.1 was false-matching)
- `7dc2b9b` AUTO toggle syncs cameraAutoMode + applies current routine tracking on enable
- `afe1f56` persistent PTZ joystick fixes (hide on modal, contain z-index, recreate on scroll — nipplejs in scrolling main window)
- `59cf0f1` Recenter = return to STAGE VIEW (recalls Home preset, AI off) not factory-up; per-command camera logging (withCam logs discrete cmds, excludes 10Hz)

**VERIFIED WORKING on real hardware this session:** joystick aim (after scroll-recreate fix), AI lock + follow on a solo routine with a human in frame, camera connects/discovers.

**Open / next:**
- **Confirm `59cf0f1` behavior:** Recenter/Go-Home/F4 now go to stage view (operator sets stage view first: aim full stage → Set Home). Was just deployed; operator relaunching to test.
- **"Reset to straight up"** was the factory `/ptz/reset` (mechanical centre = up on this mount); fixed by repointing Recenter → Home preset. Verify resolved.
- **Tracking caveat:** OBSBOT reverts workmode to `none` if no clear human in frame at set-time; group routines (24/32) use multi-mode (won't chase one tester). Solos (5) = single-subject lock. Real dancers on stage behave differently than one tester.
- **Live gimbal ANGLE is not loggable** — Tail 2 REST SDK has no live pan/tilt read-back (velocity-only; only presets store absolute pose). Command logging is the substitute.
- **Marker export to DaVinci Resolve** — capture shipped (`marker` events w/ OBS recordTimecode, filter recording=true). Export tool (EDL/CSV or DaVinci MCP) to be built AFTER the show off real data. OBS must be recording when advancing routines.
- **Breathing still hardware-unverified.**
- obsbot-control local commit `1cdf88e` (no remote). DART deploy mechanics + standing kill/restart authorization in [[project-dart-deploy-mechanics]].

**Reason for /fresh:** very long live-testing session (15+ build/deploy cycles), clearing context.

---

## 2026-06-18 Session (PM-2) — DART deployed `389638d`: discovery + tabbed settings + persistent PTZ + Ancaster loaded

**All on DART now (app.asar 13:52, build `389638d`):**
- **Camera network auto-discovery/pairing** — `discoverCamera()` (cameraDirector.ts) scans private /24 subnets for OBSBOT REST signature `GET /camera/sdk/ai/workmode → 200` (verified live on .163). Auto-sets `cameraHost`, handles venue DHCP change (the #1 field risk). `CAMERA_DISCOVER` ipc + preload + types.d.ts. CameraPanel off-state auto-discovers on mount + "Find Camera" btn; active panel "Find" btn (rescan if IP moves). No mDNS/extra deps.
- **Persistent PTZ panel** — CameraPanel embedded as "Camera (OBSBOT)" right-panel section (App.tsx), always visible (not just Overlay Mode). Preview never auto-grabs UVC.
- **Tabbed Settings** — CSE pattern stolen: SETTINGS_TABS map + show/hide `.settings-group` by title effect (Settings.tsx) + tab CSS (settings.css). Tabs: General/OBS/Camera/Import & Media/Network/Tools.
- **Ancaster Dance Arts session** loaded on DART — `ancasterda2026.json`, 33 triggers (title card + 32 routines in programme order), updatedAt bumped to 2026-06-19T05:00 so boot auto-loads it (StageCoachGlobal was winning). dancerCount derived per routine (5 solo/2 duet/1 trio/24 group). Verified: log "Auto-loaded most-recent session: Ancaster Dance Arts".
- **OBSBOT confirmed live** at 192.168.0.163 (HTML `<title>OBSBOT`, REST signature 200). Camera was OFF in config (host empty) — discovery now auto-fills on launch.

**Commits:** BB `20bc141` (routine-tracking+derive+breathing) → `31913bb` (persistent PTZ) → `389638d` (discovery+tabs). obsbot-control `1cdf88e` (solo/duet/trio chase + breathing, local-only).

**Next:** user launches BB → confirm camera auto-discovered + PTZ active → hardware test framing/breathing/PTZ. Venue router test tomorrow (Ancaster Fri Jun 19 6:15 PM). Breathing still hardware-unverified.

---

## 2026-06-18 Session (PM) — Camera follows CURRENT routine without firing lower thirds

**Goal:** during a show, operator advances the playlist to track which routine is live → OBSBOT auto-frames the group/solo by dancer count — but NO lower third fires on the OBS output (graphics off during recital).

**Changes (built, tsc clean, NOT yet committed / NOT yet on DART):**
- **Decoupled camera from the visible fire.** `applyRoutineForTrigger()` now runs on `selectTrigger()` + `nextTrigger()`/`prevTrigger()` (current-routine selection/nav) — overlay.ts. Previously it fired ONLY inside `fireLowerThird()` (the visible overlay). `fireLowerThird` call kept too (harmless idempotent re-apply; covers autoFire/manual fire). Selection never sets `lowerThird.visible` → zero on-screen graphics.
- **dancerCount auto-derived from routine NAME on import/startup.** New `deriveDancerCount(name)` in cameraDirector.ts: Solo→1, Duet→2 (keyword or bare "A & B"/"A/B"), Trio→3, Quartet→4, any other named routine→8 (group default = multi full-body, never stuck), no name→undefined. Runs in `fillDancerCounts()` at every chokepoint: `setTriggers`, `addTrigger` (CC package + manual create), `loadSessionState` (startup restore). Explicit counts (FieldMapper/TriggerEditor/CC) ALWAYS win — derivation only fills `undefined`.
- **Why name-parse:** no numeric dancer counts exist anywhere — Ancaster is a standalone recital, not in CompPortal; `adaRoutines.json` has only act/num/group/song. Routine TYPE (all the camera framing needs) is encoded in the 32 group names. Validated parse: 5 solo→1, 2 duet→2, 1 trio→3, rest→group 8.
- Recital framing floor (`fullBody`) already enforced in `@compsync/camera` framingProfile.ts — solos = single-subject full-body track, groups = multi full-body widening. No tight crops ever. Q "solos tighter?" = moot, floor clamps it.

**Framing tuning (obsbot-control @compsync/camera, dist rebuilt clean):**
- **Solo** → trackingSpeed 2→**3 (Fast)**: chase the lone dancer, head-to-toe, single-subject onlyMe. Safety space = fullBody headroom (already).
- **Duet/Trio** → trackingSpeed 2→**3 (Fast)**: keep ALL in frame as they spread, multi, fullBody.
- **GROUP BREATHING (NEW)** — slow near-imperceptible AutoZoom in/out so a group shot is never static. **AI-tier oscillation** (NOT manual /ptz/zoom — avoids contention with AI AutoZoom): alternates `setAutoZoom` between base tier + one step wider, both ≥ recital floor, so the group stays framed. fullBody↔P16 (small_group), P16↔P24 (large_group), P24↔P16 (production). Half-cycle 14s (~28s full breath, TUNABLE). Solo/duet/trio do NOT breathe.
  - `breathingPartnerTier()` in framingTier.ts; `breathe`/`breathingTiers` on FramingProfile; `Director.applyBreathTier(tier)` primitive.
  - BB `cameraDirector.ts`: `startBreathing`/`stopBreathing` timer (unref'd); started in `applyRoutineForTrigger` for group routines when `cameraBreathing !== false`; stopped on solo/duet/trio select, `goHomeViaCamera` (F4 panic), and `invalidateDirector`. Read fresh each routine change.
  - **Kill-switch:** `cameraBreathing` setting (default true) — Settings UI "Group Breathing" checkbox under OBSBOT Camera group. types.ts + settings.ts + Settings.tsx + generic settingsSet IPC.

**🔴 BREATHING IS HARDWARE-UNVERIFIED — MUST test on DART+Tail2 before the show.** AI-tier oscillation is the safer of two approaches (chosen over manual-zoom-AutoZoom-off) but how smoothly the Tail 2 transitions between AutoZoom tiers is untested. F4 / breathing-off is the kill path.

**Files this change:** BB — overlay.ts, cameraDirector.ts, settings.ts, shared/types.ts, renderer/components/Settings.tsx. obsbot-control — profiles/framingTier.ts, profiles/framingProfile.ts, director/Director.ts (dist rebuilt).

**Next:** commit + push (both repos; obsbot-control has NO remote — local commit only) → Windows build on FIRMAMENT (sync obsbot-control to D:\projects\obsbot-control per the junction/devDep gotcha) → deploy DART → **hardware test:** (1) selecting/advancing playlist frames camera, NO lower third; (2) solo chase, duet/trio hold spread; (3) group breathing smooth + kill-switch + F4 stop. Then venue router test (Fri Jun 19, Ancaster 6:15 PM).

---

## 2026-06-18 Session — OBSBOT Tail 2 hardware bring-up (DART) — ALL CONTROL VERIFIED LIVE

**Camera physically plugged into DART (USB-C). Bring-up done; first live test = recital TOMORROW (2026-06-19).**

**Verified on real hardware:**
- **USB-C = UVC video ONLY** (Class Camera + audio + COM5 serial). `/usb/mode` is only `uvc`/`mtp` — NO RNDIS/network over USB. Single-cable "USB=video+control" assumption is DEAD.
- **Control = REST over Wi-Fi.** Camera in station mode joined DART home LAN at `http://192.168.0.163:80/camera/sdk`. (NOT 192.168.88.10 — that's AP-mode only.) `@compsync/camera` RestCamera HAL targets exactly these endpoints.
- **PTZ + zoom CONFIRMED live:** ran full locate-wide→pan-center→zoom on a target via UVC ffmpeg stills. `/ptz/gimbalcontrol` velocity (yaw neg=pan left, pitch pos=tilt up), `/ptz/zoom` ratio+speed (USE speed:10 — low speed creeps).
- **AI tracking + framing CONFIRMED:** `/ai/workmode` single+group STICK *only with a human in frame* (empty room → reverts `none`; PUT returns 200 either way — that was the whole "blocker"). `/ai/human/zoomtype fullBody` works once tracking active. Tiers A/B/C all GREEN.
- **OBSBOT Center OVERRIDES REST** (reset my zoom while open) — **MUST be CLOSED during shows.** REST control works concurrent with OBS consuming the UVC video (separate channels: video=USB, control=Wi-Fi).
- UVC is single-consumer (OBS vs ffmpeg fight for video); video+control coexist fine.

**🔴 CRITICAL recital-day gotcha — camera IP changes at venue.** `192.168.0.163` is DART's *home* LAN. At the venue (different router) the Tail 2 gets a different DHCP IP → BB `cameraHost` must be re-set or control is dead. Options offered to user: (a) set camera STATIC IP tonight (most reliable), (b) re-probe venue subnet on-site (ARP-scan for REST :80), (c) add BB auto-discovery (net-new code). **User decision pending — this is the #1 risk for tomorrow.**

**Recital-day checklist:** camera on same Wi-Fi as DART → get IP → BB cameraHost; OBSBOT Center CLOSED; OBS pulls video over USB-C UVC; AI single+fullBody (never tighter — recital floor); AI engages with dancers in frame.

**Open items (user to decide before tomorrow):** static IP vs on-site re-probe vs BB auto-discovery; whether to wire+verify BB `cameraHost` control end-to-end through the app (not yet done — all testing was raw REST). Durable findings saved to memory `project_obsbot_tail2_capture` (CompPortal memory dir).

**Reason for /fresh:** long session (asteroid deploy → field logging → Tail 2 bring-up); clearing context before recital-day work.

---

## 2026-06-16 Session — Field logging + PTZ build/deploy to DART
**Goal met:** DART now runs `572fbbb` (logging + PTZ), built on FIRMAMENT, deployed + verified live.
- **Weekend failure diagnosed** (June 13 event): no-router transports failed. Wi-Fi Direct = experimental/unverified. Phone-hotspot connect failed; operator fell back to legacy "ScreenDesk" which worked over the same hotspot → BB is the fault, not the network. Root cause candidates: multi-homed `getLocalIp()` (wifiDisplay.ts:108-110, 192.168/10 tie at priority 0 → can advertise unreachable OBS-LAN IP) and/or hotspot AP isolation. Failure-window logs had rotated out (tablet video-stats flood `main.log` in ~1 day).
- **Phase 1 field logging shipped** (`572fbbb`, additive only): new `net` EventKind → events.jsonl. Records discovery start (ALL IP candidates + chosen + advertised host), deduped discovery replies, WS hub bind, client connect/disconnect, Direct/Wi-Fi-Direct/BLE start/stop/error (no secrets). Tablet logs routed to dedicated `<userData>/logs/tablet.log` so they stop overwriting main.log. **Verified live on DART** — boot emitted "Discovery listener started" w/ candidates [192.168.0.161 p0, 172.28.128.1 p2, 100.90.103.121 p3] = DART is multi-homed (3 ifaces), confirms the tie-break risk.
- **Build/deploy:** FIRMAMENT obsbot-control dist rebuilt first (src newer than dist), then BB npm install + `@rollup/rollup-win32-x64-msvc` fix + dist:installer. Installed on DART (app.asar 23:33), PTZ verified (OBSBOT/framing/PTZ panel/gamepad in asar), SD plugin redeployed (manifest + 26 icons), BB relaunched healthy (4 procs, wifi-display stable). ASTEROID also got `2b153e0` June 13 (pre-PTZ; not updated this session — DART-only per user).
- **Plan for Phase 2-4** (connection fix, bench repro, disarm experimental transports): `docs/plans/2026-06-16-connect-reliability-and-logging.md`. NOT built — bench work, do NOT ship to a show machine until hotspot repro passes.

### Open threads (not in this goal)
- **3 upcoming events to load on DART** (parallel track): only **Ancaster Dance Arts** has programme data (32 routines, `RemotionVideo/src/data/adaRoutines.json`). Other 2 events: names + scanned programmes still needed from user. "Loaded" = CC broadcast-package per event pushed to BB.
- Connection FIX (getLocalIp hotspot preference + one-button connect) — Phase 2, bench-first.
- CC handoff item: auto-push CF stream key → OBS on CC_APPLY_PACKAGE (ipc.ts ~694-707).

---

## Prior Session — OBSBOT Tail 2 PTZ camera integration

## Last Session Summary
Built the OBSBOT Tail 2 automated-capture stack: a shared `@compsync/camera` control package (separate repo `~/projects/obsbot-control`) + full integration into BroadcastBuddy. Goal = "plug in the Tail 2 → camera auto-frames each routine by dancer count, operator can override." Dual-app framework: same `@compsync/camera` module will also go into CompSyncElectronApp (CSE) later — **BB ships first** (recital test ~2026-06-20/21). Camera-enabled Windows installer built + staged.

## What Changed (BroadcastBuddy, all pushed to origin/main through 7ec7ce2)
- `051e74b` per-routine `Trigger.dancerCount` + guarded camera-on-trigger-fire (`fireLowerThird()` overlay.ts:387 → `applyRoutineForTrigger`). FieldMapper "Dancer Count" target, TriggerEditor numeric input, Settings "OBSBOT Camera" group, `cameraDirector.ts` service.
- `89e26b0` Set Home / Go Wide buttons (OverlayControls) + **F4 panic hotkey**.
- `e3d7291` Wave 1 — settings (`cameraAutoMode`/`cameraTrackingSpeed`/`cameraFramingMode`/`cameraPort`), 9 camera IPC channels, auto-mode guard, default host `192.168.88.10`, `camera:probe`.
- `fc8e76d` CameraPanel — nipplejs on-screen joystick + **Xbox gamepad** + zoom rocker + preset grid (P2–8, click=recall/long-press=save) + AUTO/MANUAL toggle + Home/Recenter + status + **live `<video>` preview** (getUserMedia device picker). Shared 10Hz command sender; stick-grab→AI-off interlock; disconnect→stop.
- `96522d2` / `d66b393` / `7ec7ce2` Windows-installer build fixes (see Gotchas).

Companion repo `~/projects/obsbot-control` (`@compsync/camera`) — commits `a01edd6`→`a9ec815`, **LOCAL ONLY, no git remote**: OSC+REST HALs + ICamera, dancerCount→routineType→framingProfile (recital floor `fullBody`), `goHome`/`saveHome`/`endRoutine`, `gimbalVelocityXY`/`gimbalStopAll`/`zoomVelocity`/`stopZoom`, osc made optional+lazy. Docs: `docs/OSC_COMMAND_MAP.md`, `docs/REST_API.md` (51 endpoints). SDK: `sdk/` (Tail 2 RESTful HTML, untracked).

## Build Status
PASSING. BB `npm run build` clean. Windows NSIS installer built on firmament 2026-06-15 23:25 ET → `/mnt/firmament/BroadcastBuddy-Setup-2026-06-15.exe` (115 MB, = `D:\Shared`). Pre-existing tsc errors in `ccRelay.ts`/`chatBridge.ts` (Supabase WS types) — NOT ours, electron-vite build ignores them.

## Known Bugs & Issues
- `RestCamera.getGimbalPos()` returns the stored preset list, NOT live pan/tilt (SDK has no live-pose GET) → CameraPanel numeric gimbal readout is best-effort. Status dot + zoom work.
- All camera control unverified on real hardware (no Tail 2 yet) — see hardware-test list.

## Incomplete Work
- **CSE (CompSyncElectronApp) integration NOT done** — `@compsync/camera` not yet wired. CSE is the truly-autonomous home: `state.getCurrentRoutine()` → `Routine.sizeCategory`/`dancers` (native CompPortal data) → `Director.applyRoutine()`. No package/import needed there.
- **BB CC-broadcast-package does NOT carry `dancerCount`** — `BroadcastPackage.triggers[]` (types.ts:670) + apply builder (ipc.ts:682-694) lack it. So applying a CompPortal event leaves counts empty. For BB to auto-frame from CompPortal-loaded data: add `dancerCount` to CompPortal's package generator + map it in BB `ipc.ts:686`. (For a standalone recital, count via import-mapping or manual TriggerEditor already works.)
- `obsbot-control` has no git remote — pending decision: create private `danman60/obsbot-control`?
- Group virtual-PTZ sim render never finished (CPU slow) — rerun on GPU. Solo sim succeeded (100% YOLO detection on dark KMSD wide footage).

## Tests
- No unit tests. Sim validation: `obsbot-control/sim/` virtual-PTZ on real KMSD wide footage — solo render done (`virtual-ptz-1.mp4`, `debug-1.mp4`), 100% detection. Group pending.
- Untested: ALL camera control on real hardware. Dry-run examples (OSC + REST) pass.

## Next Steps (priority order)
1. **Decide BB count source for recital**: (a) close CC-package `dancerCount` gap for CompPortal-connected auto-framing, or (b) leave manual/import count for the standalone recital. (User was mid-decision at wrap.)
2. Wire `@compsync/camera` into **CSE**, fired by `getCurrentRoutine()`, framing from `sizeCategory`.
3. When Tail 2 arrives: hardware-test gates (below).
4. Optional: rerun group sim on GPU; create obsbot-control remote.

## Gotchas for Next Session
- **Windows installer build (firmament, the build box — NEVER NSIS on Linux):** repo at `D:\projects\BroadcastBuddy`; obsbot-control must be synced to `D:\projects\obsbot-control` (tar via `/mnt/firmament`=`D:\Shared`, exclude node_modules/reference/sim/.git/sdk; build with `npm install --omit=optional && npm run build`). The KILLER bug (cost 3 attempts): a `file:../obsbot-control` dep is a Windows JUNCTION; electron-builder resolves the junction's REAL path (outside project root) and throws `"X must be under D:\projects\BroadcastBuddy"` before any files-exclude applies. FIX = vite `externalizeDepsPlugin({ exclude:['@compsync/camera'] })` (bundles into out/main) **+** `@compsync/camera` in **devDependencies** (electron-builder packages production deps only → never walks the junction). Also `@rollup/rollup-win32-x64-msvc` optionalDep for the Windows rollup bug.
- Camera is OFF by default — no behavior change unless `cameraAutoMode` true OR `cameraHost` set. Real operators unaffected.
- Hardware-test gates: RNDIS bring-up (single-USB-C / host→192.168.88.10), AI-vs-manual gimbal arbitration (override vs auto-disable), command rate Hz/latency (10Hz assumed), USB-C gimbal power, preset slot count (OSC doc said 1-3), zoom-stop precision. Gamepad: prefer WIRED over BT; needs window focus + a button-press before getGamepads() returns.
- ESM `@compsync/camera` into CJS electron-vite main = dynamic `import()` (static require → ERR_REQUIRE_ESM).
- Full durable context: memory `project_obsbot_tail2_capture` (CompPortal memory dir).

## Files Touched This Session (BroadcastBuddy)
src/shared/types.ts, src/main/services/cameraDirector.ts, src/main/services/settings.ts, src/main/services/overlay.ts, src/main/services/llmService.ts, src/main/services/hotkeys.ts, src/main/ipc.ts, src/preload/index.ts, src/renderer/types.d.ts, src/renderer/components/FieldMapper.tsx, src/renderer/components/TriggerEditor.tsx, src/renderer/components/Settings.tsx, src/renderer/components/OverlayControls.tsx, src/renderer/components/PanelApp.tsx, src/renderer/components/CameraPanel.tsx (new), src/renderer/lib/cameraControl.ts (new), src/renderer/lib/gamepad.ts (new), src/renderer/styles/camera.css (new), src/main/services/overlayPanels.ts, electron.vite.config.ts, package.json
