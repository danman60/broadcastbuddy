# Current Work - BroadcastBuddy

## Last Session Summary
Gallery Builder pipeline upgrade + first event processing for 7Attitudes recital. Replaced broken Gemini/CC-API pipeline with transcription + direct R2 upload. Processed 7,214 photos into 53 routines, fixed OCR and matching bugs, generated thumbnails, coordinated with CC and Remotion sessions.

## What Changed
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
