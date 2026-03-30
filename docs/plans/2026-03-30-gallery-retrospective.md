# Gallery Builder Retrospective — First Event

**Event:** 7Attitudes Competitive Showcase (2026-03-29)
**Processing:** 2026-03-30 (two sessions, ~10 hours total)
**Inputs:** 7,214 photos (30GB), 2 MKV recordings (20GB), 2 program images
**Output:** Gallery with 53 routines, 7,143 sorted photos, thumbnails, lower third overlays

---

## What Went Wrong (ordered by impact)

### 1. CRITICAL: Photo-routine matching used timestamps instead of gaps
**What happened:** v1 matching took transcript timestamps ("welcome to the stage" at 1235s) and used them as routine boundaries. Photos between boundary timestamps got assigned to that routine.
**Why it failed:** Announcer timestamp ≠ photographer timing. The announcer speaks, then there's applause, then performers take the stage, then the photographer starts shooting. The transcript gives you when the announcer spoke, not when the photographer stopped/started. Interpolated timestamps (11 of 53 routines) were even worse — just evenly spaced between anchors.
**Result:** Photos bled across boundaries. CAR WASH included 26 photos that belonged to IF THEY COULD SEE ME NOW. Error cascaded through every routine.
**Fix:** Gap detection. Sort photos by timestamp, find gaps > 15 seconds (stage transitions). Photographer naturally stops during costume changes. This is deterministic and independent of transcript quality.
**For next time:** Gap detection is the PRIMARY method. Transcripts are for naming the gaps, not defining them.

### 2. CRITICAL: Gemini Vision OCR misaligned table columns
**What happened:** Gemini extracted the program image (routine/performers/choreographer table) but shifted the performer and choreographer columns. Two error patterns:
- Routines 36-37: performers swapped
- Routines 40-51: performers shifted by 1 position (each routine got the next routine's data)
**Why it failed:** The program image has three columns with varying text widths. When text in one column wraps or is short, Gemini misaligns the column assignment. This is a known weakness of vision-based table extraction.
**Result:** 18 of 53 routines had wrong performer/choreographer. Discovered only when Dan checked manually.
**Fix:** Manually verified all 53 against the PNG images. Corrected `recital-program.json` and `recital-timeline-v3.json`, updated DB.
**For next time:**
- Extract row-by-row, not as a bulk table. Prompt: "For row N, what is the routine name, performer, and choreographer?"
- Include routine number in every extracted row for alignment verification
- Cross-validate: check that solo performer names appear in exactly one routine
- Show the user a preview table before proceeding — 2 minutes of human review catches what the model misses

### 3. HIGH: Clock offset detection algorithm was broken
**What happened:** The app's `detectClockOffset()` used a sampling algorithm: pick 10 photos, generate candidate offsets from window midpoints, score each. It returned 0s when the actual offset was +486s (8.1 minutes).
**Why it failed:** With 10 samples across 53 routine windows (each ~2-4 min wide), the correct offset doesn't dominate the scoring. Many wrong offsets score similarly because the windows are wide enough to catch random photos. The 30-second buffer made it worse.
**Result:** All photos assigned to wrong routines until manual offset detection.
**Fix:** Replaced with density-jump method: find the transition from pre-show (sparse shots) to show (rapid continuous shooting). First show photo time − first routine time = offset.
**For next time:** Density-jump is the default. Also offer: user takes a photo of their phone clock screen → instant offset with zero math. BB app should also display a reference timecode the photographer can snap.

### 4. HIGH: Upload path went through CC API (4.5MB limit)
**What happened:** The app's `uploadToCC()` sent photo file bytes through the CC API as multipart form data.
**Why it failed:** Vercel serverless functions have a 4.5MB body limit. Photos averaged 4.3MB, some up to 7.4MB. Any photo over the limit fails silently.
**Result:** Had to manually upload 30GB via rclone to R2, bypassing CC entirely.
**Fix:** New `r2Upload.ts` service — direct S3 upload to R2 with 8-parallel semaphore. CC API is metadata-only (create gallery, register keys, publish).
**For next time:** This is the permanent architecture. File bytes never touch Vercel.

### 5. MEDIUM: Trigger import created 85 wrong routines instead of 53
**What happened:** CC's broadcast_triggers table had 85 entries for this event. These came from the original trigger import in BB, which conflated performer names with routine titles (e.g., "KEIRA GUPPY" as a routine instead of a performer of "IF THEY COULD SEE ME NOW").
**Why it failed:** The extraction logic in both CC web and BB app treats every line as a separate trigger, even when some lines are performer names under a routine title.
**Result:** Gallery created with 85 sections instead of 53. Had to delete and recreate.
**Fix:** OCR'd the actual program to get the correct 53 routines with proper name/performer/choreographer separation.
**For next time:** Fix the trigger extraction logic in both CC and BB. Or better: use the program OCR as the source of truth for routines, not the trigger list.

### 6. MEDIUM: recital-clock-offset.json saved wrong value
**What happened:** The failed sampling algorithm wrote 0s offset to `recital-clock-offset.json`. Later code read this file and used the wrong value.
**Why it failed:** The algorithm returned 0 as "no offset detected" rather than failing/warning. The file was treated as authoritative.
**Result:** Confusion between sessions — crash transcript said 486s but the file said 0s.
**For next time:** Offset detection should return a confidence score. If confidence < 0.5, warn the user and do NOT save to file. Require explicit user confirmation before persisting.

### 7. LOW: Initial DB check said tables didn't exist
**What happened:** First Supabase MCP query said gallery tables don't exist. Wasted time planning a migration.
**Why it failed:** Query used `SELECT to_regclass('public."Gallery"')` — wrong schema. Tables are in `commandcentered` schema, not `public`.
**Result:** ~20 minutes of unnecessary investigation + collab messages.
**For next time:** Always query `commandcentered` schema explicitly. Or just try the API call and see if it works.

### 8. LOW: SD card unavailable during processing
**What happened:** SD card was removed between sessions. Had to read EXIF from R2 (range reads) instead of local filesystem.
**Why it failed:** Physical media — someone moved the card reader.
**Result:** EXIF extraction still worked (R2 range reads at 167 files/sec) but added complexity.
**For next time:** Upload photos AND extract EXIF before removing the SD card. Or: the app should extract EXIF as part of the upload step, storing timestamps in a manifest file alongside the R2 keys.

---

## What Worked Well

1. **rclone direct to R2** — 30GB uploaded with zero failures, survived SSH disconnect via detached process
2. **Audio transcription** — faster-whisper identified 37 of 53 routines from announcements. Much better than trying to upload 20GB of video to Gemini.
3. **Gap detection (v2)** — produced exact 53-routine match with clean boundaries, deterministic
4. **Collab between sessions** — BB and CC sessions coordinated via collab relay, data flowed correctly
5. **EXIF from R2 range reads** — boto3 partial downloads (64KB header) at 167 files/sec, no local files needed
6. **Thumbnail backfill** — Pillow on FIRMAMENT processed 7,214 photos in ~4 minutes, rclone uploaded 413MB of thumbnails
7. **Runbook** — logging every step as we went made the retrospective and automation spec possible

---

## Pipeline for Next Event (what the app must do)

```
USER ACTIONS:
1. Plug in SD card
2. Open BB Gallery Builder
3. Select photo folder (SD card DCIM)
4. Select video file(s) (OBS recordings)
5. Take a photo of phone clock (optional — for offset)
6. Select program image (optional — for performer enrichment)
7. Click "Process"
8. Review results, adjust if needed
9. Click "Publish"

APP DOES AUTOMATICALLY:
1. Scan photos, read EXIF timestamps → manifest with capture times
2. Upload originals + thumbnails to R2 (parallel, resumable)
3. Extract audio from video → WAV
4. Transcribe audio → segments
5. Parse announcements → routine names + approximate timestamps
6. Gap-detect photo boundaries → exact routine segments
7. Match routine names from transcript to gap segments (ordering)
8. If program image provided: OCR for performer/choreographer enrichment
9. Detect clock offset (density-jump or user reference photo)
10. Create gallery + sections on CC
11. Bulk register media with section assignments
12. Publish
```

### Critical Design Rules (learned from this event)
- **Gap detection for cut points, transcript for naming** — never the reverse
- **File bytes direct to R2** — CC API is metadata only
- **Thumbnails at ingest** — generate alongside upload, not as a backfill
- **EXIF in manifest** — extract once during upload, store with R2 keys, never re-read
- **OCR row-by-row** — never bulk table extraction
- **Offset needs user confirmation** — auto-detect + show preview, don't silently apply
- **Program is source of truth for routines** — not triggers, not announcements
- **Pre-show/intermission are first-class categories** — not "unmatched"

---

## Time Breakdown (what took the longest)

| Step | Time | Automated? |
|------|------|-----------|
| Photo upload to R2 | 2.5 hours | Yes (rclone) — app needs native S3 upload |
| Audio extraction + transcription | ~15 min | Yes (ffmpeg + faster-whisper) |
| EXIF extraction | ~2 min | Yes (boto3 range reads) |
| Photo matching v1 (wrong) | ~1 min | Yes but broken — replaced |
| Photo matching v2 (gap) | ~1 min | Yes, correct |
| Program OCR + correction | ~2 hours | Partially — OCR worked, but manual correction of 18 entries took time |
| Thumbnail generation | ~4 min | Yes (Pillow on FIRMAMENT) |
| Thumbnail upload | ~10 min | Yes (rclone) |
| DB operations (sections, media) | ~30 min | Via SQL/MCP — app needs bulk API |
| Debugging wrong offsets/assignments | ~3 hours | Avoidable with better algorithms |
| Cross-session coordination | ~1 hour | Collab relay — would be eliminated if BB does everything |

**Total wall clock:** ~10 hours across 2 sessions
**Estimated with automation:** ~3 hours (2.5h upload + 30min processing + human review)
**Estimated with trigger timestamps:** ~2.5 hours (upload time dominates, no offset detection needed)

---

## Open Items for Next Event

1. [ ] **CC bulk-register endpoint** — POST /api/v1/gallery/{id}/media/bulk-register
2. [ ] **End-to-end app test** — install on Windows, run full pipeline
3. [ ] **faster-whisper bundling** — package Python + model with Electron installer
4. [ ] **ffmpeg bundling** — include in extraResources or detect system install
5. [ ] **Program OCR improvement** — row-by-row extraction with cross-validation
6. [ ] **Trigger extraction fix** — CC + BB conflate performers with routine titles
7. [ ] **Offset reference photo** — BB displays timecode for photographer to snap
8. [ ] **Upload resume** — track uploaded files, skip on retry
9. [ ] **Gallery preview in app** — show matched photos per routine before publishing
10. [ ] **Trigger fire timestamps** — makes offset detection and transcript matching obsolete
