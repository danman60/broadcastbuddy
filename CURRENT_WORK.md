# Current Work - BroadcastBuddy

## Active Task
Gallery Builder pipeline upgrade — replaced broken Gemini/CC-API pipeline with transcription + direct R2 upload.

## What Was Done This Session

### Gallery Photo Sorting (manual run complete)
- 7,214 photos uploaded to R2, EXIF extracted, matched to 53 routines
- 7,074 matched / 99 pre-show / 41 intermission / 0 unmatched
- CC DB populated: 53 sections + 7,214 gallery_media rows
- Thumbnails: using CF Image Resizing (on-the-fly). Backfill job pending on FIRMAMENT.
- Gallery awaiting publish (CC-2 refactoring page for lazy-load)

### Gallery Builder App Code (Phase 1 complete)
- **New: `r2Upload.ts`** — S3 client, batch upload with semaphore (8 parallel), thumbnail generation with sharp at ingest time, R2 listing
- **New: `audioTranscription.ts`** — ffmpeg audio extraction, faster-whisper transcription via Python, announcement parsing with fuzzy match, multi-video support
- **Replaced: `detectClockOffset()`** — density-jump method (find pre-show→show transition) replaces broken sampling algorithm
- **Extended: `matchPhotos()`** — added pre-show and intermission confidence categories
- **Types**: R2Config, TranscriptSegment, expanded GalleryConfig (videoPaths, new statuses), expanded PhotoMatch confidence
- **4 new IPC channels**: browse-videos, transcribe, upload-r2, run-pipeline-v2
- **Settings UI**: R2 endpoint, access key, secret key, bucket
- **GalleryPanel UI**: Transcription-first flow, multi-video browse, Gemini as fallback
- **Dependencies**: @aws-sdk/client-s3, sharp

### Build Status
- TypeScript: clean (zero errors)
- electron-vite build: passes (main + preload + renderer)

## Still Needed
1. **CC bulk-register endpoint** — POST /api/v1/gallery/{id}/media/bulk-register (collab with CC-2)
2. **Thumbnail backfill** — 7,214 existing photos need thumbnails generated on FIRMAMENT
3. **Gallery publish** — CC-2 finishing page refactor, then publish
4. **End-to-end test** — install on Windows, run full pipeline with real event
5. **Phase 2 polish**: EXIF from R2 range reads, parallel local EXIF, section enrichment

## Key Files
- `src/main/services/r2Upload.ts` — R2 direct upload with thumbnails
- `src/main/services/audioTranscription.ts` — ffmpeg + faster-whisper pipeline
- `src/main/services/galleryService.ts` — clock offset v2, match categories
- `src/shared/types.ts` — all gallery type changes
- `src/main/ipc.ts` — new handlers
- `src/renderer/components/GalleryPanel.tsx` — transcription-first UI
- `src/renderer/components/Settings.tsx` — R2 config UI
- `docs/plans/2026-03-30-gallery-automation-spec.md` — full spec
- `docs/plans/2026-03-30-gallery-runbook.md` — manual run log

## Data Files (on FIRMAMENT /mnt/firmament/)
- `recital-timeline-v3.json` — 53 routines with timestamps
- `recital-program.json` — OCR'd program
- `r2-exif-timestamps.json` — 7,214 EXIF timestamps from R2
- `photo-routine-assignments.json` — matching results
- `gallery-sections-payload.json` — 53 sections for CC bulk create
- `extract-r2-exif.py` — R2 EXIF extraction script
- `match-photos-to-routines.py` — matching script

## Recent Commits
- `8f65194` — Gallery Builder: Gemini video analysis, EXIF matching, CC upload pipeline + UI
