# Current Work - BroadcastBuddy

## Last Session Summary (2026-05-20)
**Wave 1 port from CompSyncElectronApp → BroadcastBuddy: WiFi display + tablet pack.** Goal is to bring BB to parity with the field-hardened features in CompSyncElectronApp (the user calls it "CS Controller" colloquially, but the source-of-truth Electron repo is `~/projects/CompSyncElectronApp`; the `~/projects/CSController` repo is the Android tablet receiver). Strategy: port features directly into BB now, extract shared packages once 2–3 features have landed (workspace decision deferred until shape is obvious from real usage).

Ported wifiDisplay.ts (~500 LOC) + tabletLogServer.ts (~160 LOC) from CompSync. Wired into BB main/preload/ipc/renderer. Added Tablet button to Header (one-tap stop→start→ping recovery). Added full WiFi display section to Settings (monitor select, bitrate, fps, encoder, ports, client IP, autostart, Ping Tablet button). Copied wifi-display-server.exe + 3 mingw DLLs into BB resources/ and added extraResources to electron-builder. TypeScript build clean (656K out, no errors).

CSController APK made dual-source aware: discovery payload's optional new `app` field tells the tablet which host found it. Defaults to "CompSync" when absent so existing CompSync hosts work unchanged. BB sends `app: "BroadcastBuddy"`. UI strings on ConnectionScreen genericized ("CompSync Remote Control" → "Tablet Remote Control"; "Searching for CompSync..." → "Searching for host (CompSync / BroadcastBuddy)..."; "Server Found" → "${srv.app} Found").

## Wave Plan (port order from CompSyncElectronApp) — ALL WAVES DONE 2026-05-20
1. **DONE** WiFi display + tablet pack (committed `d07d711`)
2. **DONE** Slow zoom + transition revert — slowZoom.ts (wide/tight scene toggle via OBS Move Transition), obsConnection.ts auto-revert-to-Cut state machine (500ms settle after any non-Cut transition end). OverlayControls buttons + Revert pill. Settings live in electron-store (no Settings UI section yet — operator edits scene/transition names via JSON; deferred follow-up).
3. **DONE** Photo pipeline hardening — faststart mp4 (ffmpegFaststart.ts), import dedup manifest (importManifest.ts), clock-offset sanity (year-range reject + 24h cap), lightweight 2-tier priority upload. SKIPPED: child-process upload (reserved flag `r2Config.useChildProcessUpload`, not wired — needs v4 signer or worker AWS bundle); full per-routine round-robin photo tier (too coupled to CompSync jobQueue).
4. **DONE** Chat + pinning — chatBridge.ts (Supabase Realtime, config-injected, OFF by default; no-ops without config), ChatPanel.tsx, Settings "Operator Chat" group. Pinning fires message as lower-third. Needs a BB Supabase project + `chat_messages` table (schema in chatBridge.ts header comment) before it can be enabled.

Bonus (same session): Up Next / That Was buttons (fire neighbour trigger with label chip, no playlist advance); 8 richer OverlayStyling fields (text-transform, letter-spacing, separate subtitle styling, shadow/glow, label colors, 100–900 weights); overlay leveling grid (rule-of-thirds + diagonals + crosshair, toggle button, default off).

Still deferred (domain-divergent, need Programme/Trigger abstraction): routine-aware cut/next, routine-window photo sync (the deep CompSync versions). Up-next/that-was shipped in the lightweight trigger-neighbour form.

## Parity ports waves 5-8 (DONE 2026-05-20, committed aa1d549/6ff87e0/e329c79/524b885)
After a full feature-parity scan vs CompSyncElectronApp, ported ALL generic-value gaps (skipped competition-only items like ffmpeg track-splitting, media reconciler, take state machine, tethered/WPD ingest, comp-state drift — those are dead code in BB's recital/corporate domain).

- **Wave 5** OBS record control (start/stop/toggle/status + RecordStateChanged push; REC button in Header with live timecode) + audio meters (InputVolumeMeters subscription, bitmask 65613, AudioMeters component, dBFS bars + peak hold).
- **Wave 6** Operator resilience: events.ts (durable JSONL event stream + EventLogPanel), crashRecovery.ts (dirty-marker + 30s snapshot + RecoveryBanner), startup.ts (runStartupChecks + StartupToast), backup.ts (hourly settings backups + Settings restore UI).
- **Wave 7** Overlay elements: on-air clock, counter badge (pop-in, optional sync to trigger order), full-screen feature card (kicker/title/subtitle/logo, slide/fade/zoom + sparkle; up-next/that-was populate from neighbour trigger). Existing wave-4 chip left intact.
- **Wave 8** Day checklist (per-day operator start/end-of-day, auto-shows start-of-day on new calendar day), chat moderation (hide/ban-author/livestream-pin), Stream Deck plugin (port fixed to 19081, up-next/that-was/grid/slow-zoom actions + property inspector + README; wsHub gained slowZoomWide/Tight commands).

## Still NOT done / deferred
- **Don't-port (competition-only):** ffmpeg multi-judge track-split, media reconciler, take/re-rec state machine, tethered camera + WPD/MTP, live drive-monitor folder watch, comp-state drift, control-room bridge, EXIF/matcher worker pools. Correctly absent from BB.
- **Open judgment calls (user to decide):** starting-soon media stack (sponsor carousel/social bar/visualizer — corporate MIGHT want); whether the feature card replaces or coexists with the chip (currently coexist).
- **Stream Deck plugin** static action PNGs are placeholders (buttons render via SVG setImage at runtime; cosmetic only). Plugin not added to electron-builder extraResources (optional, noted in its README).
- **child-process upload** still a reserved flag, not wired (needs v4 signer).

## Build / test status
electron-vite build clean (EXIT 0) after every wave. NSIS installer built on Linux+wine (96MB, bundles wifi-display-server.exe + 3 mingw DLLs in resources). Copied to `/mnt/firmament/BroadcastBuddy-Setup-2026-05-20.exe` (stale Mar-29 build also still at FIRMAMENT root, untouched).

STILL NOTHING runtime-tested. To verify: install the FIRMAMENT exe on Windows, connect OBS, exercise record control / audio meters / slow zoom / transition revert / overlay elements / starting-soon media. Chat needs a BB Supabase project + `chat_messages` table. Photo hardening needs an SD import. No QA-agent run yet. Build correctness ≠ feature correctness.

## Also done this session
- Starting-soon pre-show media (sponsor carousel, slideshow, social bar, welcome) — commit `bb83367`. Audio visualizer deferred.
- CSController committed + pushed (`2f7798e`, master): dual-source + codec selection + remote logging (bundled prior-session work).
- Windows NSIS installer built + staged to FIRMAMENT.

## Last Session Before This (Gallery v2)
Gallery Builder pipeline upgrade + first event processing for 7Attitudes recital. Replaced broken Gemini/CC-API pipeline with transcription + direct R2 upload. Processed 7,214 photos into 53 routines, fixed OCR and matching bugs, generated thumbnails, coordinated with CC and Remotion sessions.

## What Changed (this session, WiFi display port)
- `src/main/services/wifiDisplay.ts` — NEW, ~500 LOC ported from CompSync. UDP discovery (port 5002, type `compsync-discover` payload with new `app: "BroadcastBuddy"` field), child-process supervision of wifi-display-server.exe, capture-error watchdog (5/7s → auto-restart, cap 3), unexpected-exit auto-restart (cap 3), topology-change debounce restart, tablet IP drift one-shot adoption, pre-spawn taskkill of stale binary to free UDP 5000/5001, Windows ABOVENORMAL priority bump, opt-in HEVC NVENC (off by default, no bundled ffmpeg yet).
- `src/main/services/tabletLogServer.ts` — NEW, ~160 LOC. POST `/tablet-log` on `0.0.0.0:8766` ingests batched Android log lines into electron-log with `[tablet:<host>]` prefix.
- `src/shared/types.ts` — added `MonitorInfo`, `WifiDisplayState`, `WifiDisplaySettings`, `DEFAULT_WIFI_DISPLAY`; extended `AppSettings.wifiDisplay`; added 6 IPC channels (`WIFI_DISPLAY_*` + `PING_TABLET`).
- `src/main/services/settings.ts` — `wifiDisplay` default block; added `getSettings()`/`setSettings()` convenience wrappers so future CompSync-port code lands with no rewrite.
- `src/main/index.ts` — imports + wiring: `wifiDisplay.killOrphanedProcess()` early, `startTabletLogServer()` + auto-start during `whenReady`, `cleanup` + `stopTabletLogServer` on `before-quit`.
- `src/main/ipc.ts` — 6 handlers (GET_MONITORS, START, STOP, STATUS, SET_MONITOR, PING_TABLET).
- `src/preload/index.ts` — matching `wifiDisplay*` bridge methods.
- `src/renderer/components/Header.tsx` — Tablet button (green dot=running, amber=stopped). Click = stop → start → ping. Falls back to opening Settings if no monitor configured.
- `src/renderer/components/Settings.tsx` — Tablet Display section with monitor select / bitrate / fps / encoder / IP / ports / autostart / Start-Stop-Ping controls.
- `resources/wifi-display-server.exe` + `libstdc++-6.dll` + `libgcc_s_seh-1.dll` + `libwinpthread-1.dll` — copied from CompSync (5.8MB exe + 27MB DLLs).
- `package.json` — `build.extraResources` added so electron-builder bundles the binary + DLLs into the installer.

CSController repo (`~/projects/CSController`):
- `app/src/main/java/com/compsync/controller/ui/ConnectionScreen.kt` — `DiscoveredServer` gained `app: String = "CompSync"`. JSON parsed via `obj.optString("app", "CompSync")` so old payloads still work. Three display strings genericized for dual-source.

**CSController NOT committed.** When I went to commit, the working tree had ~8 files with substantial prior uncommitted work from a prior session (VideoCodec enum + selector UI, RemoteLogger.kt extraction, tabletLogPort wiring across MainActivity/DisplayScreen/TouchSender/UdpReceiver/build.gradle.kts/AndroidManifest, plus VideoDecoder.kt enum addition). The dual-source `app` field landed inside ConnectionScreen.kt which already had pending VideoCodec changes. The combined working tree builds clean (APK = 9.6MB, `BUILD SUCCESSFUL in 1m44s`) but committing only my line would break HEAD because it would reference VideoCodec which isn't in HEAD yet. Punted on splitting — user should review `git status` in `~/projects/CSController` and commit the coordinated set themselves (probably as separate commits per logical change, with mine being one line plus three display strings).

## Previous Session
- `ac48b61` Gallery pipeline v2 — r2Upload.ts, audioTranscription.ts, density-jump offset, gap matching, R2 settings UI, GalleryPanel transcription flow (10 files)
- `721a876` Retrospective + runbook updates (4 files)
- [DB only] 18 gallery_sections updated with corrected performer/choreographer data
- [DB only] 7,143 gallery_media rows re-inserted with gap-based section assignments
- [DB only] 7,214 thumbnail_r2_key values set
- [R2 only] 7,214 thumbnails uploaded to `{dir}/thumbs/{filename}`

## Build Status
PASSING — tsc clean, electron-vite build clean (main 168ms, preload 15ms, renderer 406ms)

## Known Bugs & Issues
- `src/main/services/galleryService.ts:220` matchPhotos() still uses timestamp-based matching. The gap-detection method was done in Python externally. Need to port gap detection into the app's matchPhotos() function.
- `src/main/services/audioTranscription.ts` — requires system Python 3.10+ with faster-whisper. No detection/error message if missing on Windows.
- `recital-clock-offset.json` on FIRMAMENT still has wrong value (0s). Not used by app but could confuse future sessions.
- CC bulk-register endpoint doesn't exist yet — app's uploadToCC() still has the old sequential CC API path

## Incomplete Work
- `src/main/services/r2Upload.ts` — needs multipart upload for files > 5GB (CC-2 inbox request). Current PutObject caps at 5GB. Recital MKVs are 10-11GB each.
- `src/renderer/components/GalleryPanel.tsx` — UI has transcription step wired but the full v2 pipeline orchestrator (GALLERY_RUN_PIPELINE_V2 IPC) is not implemented yet
- Gallery not published yet — CC-2 finished page refactor, waiting on Dan's preview approval

## Tests
- No automated tests (project uses QA agent for E2E testing)
- App not tested on Windows yet — installer built but pipeline untested end-to-end

## Next Steps (priority order)
1. **Add multipart upload to r2Upload.ts** — CreateMultipartUpload + UploadPart + CompleteMultipartUpload for video files > 5GB. Progress callback per chunk.
2. **Port gap detection into app** — replace timestamp matching in matchPhotos() with the proven gap-based algorithm
3. **Implement GALLERY_RUN_PIPELINE_V2** — full orchestrator: transcribe → EXIF → gap-match → R2 upload → CC register
4. **Preview and publish gallery** — review gallery.streamstage.live/spring-recital-2026
5. **Windows end-to-end test** — build installer on FIRMAMENT, install, run pipeline with test data
6. **CC bulk-register endpoint** — collab with CC for POST /api/v1/gallery/{id}/media/bulk-register

## Gotchas for Next Session
- SD card on FIRMAMENT N: drive may or may not be mounted — check before accessing
- R2 credentials are in `~/.env.keys` on SpyBalloon, also configured via rclone on FIRMAMENT
- Gallery ID: `bb4123c5-0c81-44f4-96ac-cea125926682`, tenant: `00000000-0000-0000-0000-000000000001`
- CC gallery tables are in `commandcentered` schema (not `public`) — always query explicitly
- `recital-clock-offset.json` is WRONG (says 0s, actual is +486s) — don't trust it
- RemotionVideo-1 session was rendering 53 ProRes overlays + DaVinci Resolve Lua markers — check if complete
- Collab relay daemon may need restart if sessions were closed

## Files Touched This Session
- `src/main/services/r2Upload.ts` — NEW (S3 upload, thumbnails, batch)
- `src/main/services/audioTranscription.ts` — NEW (ffmpeg, faster-whisper, announcements)
- `src/main/services/galleryService.ts` — density-jump offset, pre-show/intermission matching
- `src/main/services/settings.ts` — r2Config defaults
- `src/main/ipc.ts` — 3 new handlers (browse-videos, transcribe, upload-r2)
- `src/preload/index.ts` — 3 new bridge methods
- `src/shared/types.ts` — R2Config, TranscriptSegment, expanded GalleryConfig/PhotoMatch/IPC
- `src/renderer/components/GalleryPanel.tsx` — transcription-first UI
- `src/renderer/components/Settings.tsx` — R2 credentials panel
- `package.json` — @aws-sdk/client-s3, sharp
- `docs/plans/2026-03-30-gallery-retrospective.md` — NEW (full post-mortem)
- `docs/plans/2026-03-30-gallery-runbook.md` — updated with all corrections
- `docs/plans/2026-03-30-gallery-automation-spec.md` — NEW (pipeline spec)
