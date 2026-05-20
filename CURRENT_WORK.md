# Current Work - BroadcastBuddy

## Last Session Summary (2026-05-20)
**Wave 1 port from CompSyncElectronApp → BroadcastBuddy: WiFi display + tablet pack.** Goal is to bring BB to parity with the field-hardened features in CompSyncElectronApp (the user calls it "CS Controller" colloquially, but the source-of-truth Electron repo is `~/projects/CompSyncElectronApp`; the `~/projects/CSController` repo is the Android tablet receiver). Strategy: port features directly into BB now, extract shared packages once 2–3 features have landed (workspace decision deferred until shape is obvious from real usage).

Ported wifiDisplay.ts (~500 LOC) + tabletLogServer.ts (~160 LOC) from CompSync. Wired into BB main/preload/ipc/renderer. Added Tablet button to Header (one-tap stop→start→ping recovery). Added full WiFi display section to Settings (monitor select, bitrate, fps, encoder, ports, client IP, autostart, Ping Tablet button). Copied wifi-display-server.exe + 3 mingw DLLs into BB resources/ and added extraResources to electron-builder. TypeScript build clean (656K out, no errors).

CSController APK made dual-source aware: discovery payload's optional new `app` field tells the tablet which host found it. Defaults to "CompSync" when absent so existing CompSync hosts work unchanged. BB sends `app: "BroadcastBuddy"`. UI strings on ConnectionScreen genericized ("CompSync Remote Control" → "Tablet Remote Control"; "Searching for CompSync..." → "Searching for host (CompSync / BroadcastBuddy)..."; "Server Found" → "${srv.app} Found").

## Wave Plan (port order from CompSyncElectronApp)
1. **DONE** WiFi display + tablet pack (~3d → done in one session)
2. **NEXT** Slow zoom + transition revert (obs.ts + slowZoom.ts, ~1.5d, no domain coupling)
3. SD photo sync + upload pipeline (~7d, biggest data win, needs R2/S3 dual-backend + Routine→Trigger wrapping for matcher)
4. Chat + pinning (~3d, needs separate BB Supabase project; "Wave 2 — port after infra features" per user)

Deferred (domain-divergent, need Programme/Trigger abstraction first): up-next/that-was, routine-aware cut/next, routine-window photo sync.

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
