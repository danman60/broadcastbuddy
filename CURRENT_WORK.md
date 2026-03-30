# Current Work - BroadcastBuddy

## Active Task
Gallery photo sorting for 7Attitudes recital — manual run complete, app pipeline upgraded.

## Session 2 Summary (2026-03-30 afternoon)

### Data Fixes
- **OCR misalignment fixed:** 18 of 53 routines had wrong performer/choreographer from Gemini Vision table OCR. Verified all 53 against program PNGs — 53/53 correct.
- **Photo assignments reprocessed:** Replaced timestamp-based matching (v1, had bleed-across errors) with gap-detection (v2, clean boundaries). 7,143 photos assigned to 53 sections, 71 pre-show excluded.
- **Thumbnails backfilled:** 7,214 thumbnails generated from SD card via Pillow on FIRMAMENT, uploaded to R2, DB updated.

### App Code (Gallery Pipeline v2) — committed ac48b61
- **New: `r2Upload.ts`** — S3 client, batch upload with 8-parallel semaphore, thumbnail gen with sharp at ingest
- **New: `audioTranscription.ts`** — ffmpeg audio extraction, faster-whisper via Python, announcement fuzzy matching
- **Replaced: `detectClockOffset()`** — density-jump method replaces broken sampling
- **Extended: `matchPhotos()`** — pre-show/intermission categories
- **Settings UI** — R2 credentials panel
- **GalleryPanel UI** — transcription-first flow, multi-video browse, Gemini fallback
- **Deps:** @aws-sdk/client-s3, sharp

### Remotion Overlays (separate session — RemotionVideo-1)
- 53 ProRes 4444 transparent lower third overlays rendering
- DaVinci Resolve Lua marker script for timeline placement
- Using corrected routine data from verified JSON

### Gallery Status
- **CC page refactored** — lazy-load, program-style grid, Act 1/Act 2 rows
- **Ready to publish** — pending Dan's preview approval
- Gallery URL: `https://gallery.streamstage.live/spring-recital-2026`

## Key Lessons Logged in Runbook
1. Gap detection > timestamp matching for photo-routine assignment
2. Gemini Vision OCR misaligns table columns — need row-by-row extraction
3. Density-jump > sampling for clock offset detection
4. Direct R2 upload mandatory (Vercel 4.5MB limit)
5. Audio transcription > Gemini video for long recitals

## Files on FIRMAMENT (/mnt/firmament/)
- `recital-timeline-v3.json` — 53 routines, CORRECTED performers/choreographers
- `recital-program.json` — CORRECTED program data
- `photo-routine-assignments-v2.json` — gap-based assignments (current)
- `r2-exif-timestamps.json` — 7,214 EXIF timestamps
- `thumbnail-backfill.py` — backfill script
- `extract-r2-exif.py` — R2 EXIF extraction script

## Recent Commits
- `ac48b61` — Gallery pipeline v2: transcription, direct R2 upload, thumbnails
- `8f65194` — Gallery Builder: Gemini video analysis, EXIF matching, CC upload

## Still Needed
1. CC bulk-register endpoint (for future galleries — this one was done via direct SQL)
2. End-to-end test of BB app on Windows with real event
3. Phase 2 polish: EXIF from R2 range reads, parallel local EXIF, section enrichment
4. Program OCR improvement (row-by-row extraction to prevent misalignment)
