# Gallery Builder Runbook — First Event

**Event:** 7Attitudes Competitive Showcase, 85 routines (Act 1 + Act 2), 7,214 photos, 3-hour OBS recording
**Date:** 2026-03-29 (event) / 2026-03-30 (processing)
**Status:** Manual run — tracking each step to automate for next time

---

## Step 1: Source Files
- [x] SD card mounted on FIRMAMENT at `N:\DCIM` (Panasonic, folders 350_PANA thru 354_PANA)
- [ ] OBS recording location: ___
- [ ] Program PDF/image location: ___
- [x] Photo count: 7,214 JPGs, 30.19GB total, ~4.3MB avg (some up to 7.4MB)
- [ ] Video duration: ~3 hours
- [x] All photos from March 29 — entire SD card is this event, no date filtering needed

## Step 2: Create Gallery on CC
- [x] `POST /api/v1/gallery` via `commandcentered.vercel.app`
- [x] Gallery ID: `bb4123c5-0c81-44f4-96ac-cea125926682`
- [x] Gallery slug: `spring-recital-2026`
- [x] R2 bucket: `streamstage-galleries`
- [x] 85 routines created from CC broadcast_triggers (event: `8c6a2155-c6f8-4798-b582-bc73c6c457a4` — "7att competitive showcase")
- [x] +1 Unsorted routine (sortOrder 999)
- [x] API key: `bb_dev_key` / Tenant: `00000000-0000-0000-0000-000000000001`
- [x] Routine source: Supabase query `commandcentered.broadcast_triggers WHERE event_id = '8c6a2155...'`

## Step 3: Upload All Photos (unsorted) — DIRECT TO R2
- [x] Method: rclone on FIRMAMENT → R2 S3-compatible API (8 parallel transfers)
- [x] rclone installed at `D:\Shared\rclone\rclone-v1.73.3-windows-amd64\rclone.exe`
- [x] rclone remote configured: `r2` (Cloudflare S3-compatible)
- [x] R2 key pattern: `galleries/spring-recital-2026/unsorted/{subfolder}/{original_filename}`
- [x] EXIF preserved: yes — original files uploaded unmodified
- [x] Total uploaded: **7,214 / 7,214** (30.19GB) — **COMPLETE**
- [x] Upload speed: ~3.4 MB/s (~27 Mbps), ~46 photos/min
- [x] Time taken: ~2.5 hours (started ~23:02, finished ~01:30 ET)
- [x] Process: detached via `Start-Process` (Session 0), survived SSH disconnect
- [x] Zero failures

### Step 3 Manual Commands Used
```bash
# Install rclone on FIRMAMENT
ssh firmament "powershell -Command \"Invoke-WebRequest -Uri 'https://downloads.rclone.org/rclone-current-windows-amd64.zip' -OutFile 'D:\\Shared\\rclone.zip'; Expand-Archive -Path 'D:\\Shared\\rclone.zip' -DestinationPath 'D:\\Shared\\rclone' -Force\""

# Configure R2 remote
ssh firmament "\"D:\\Shared\\rclone\\...\\rclone.exe\" config create r2 s3 provider Cloudflare access_key_id <key> secret_access_key <secret> endpoint https://<account>.r2.cloudflarestorage.com region auto"

# Start detached upload
ssh firmament "powershell -Command \"Start-Process -FilePath 'rclone.exe' -ArgumentList 'copy','N:\\DCIM','r2:streamstage-galleries/galleries/spring-recital-2026/unsorted/','--include','*.jpg','--include','*.JPG','--transfers','8' -WindowStyle Hidden\""

# Check progress
ssh firmament "\"rclone.exe\" size r2:streamstage-galleries/galleries/spring-recital-2026/unsorted/ --json"
```

## Step 4: Routine Detection
- [x] Method: **Local audio transcription** (faster-whisper small model on SPYBALLOON 3060)
- [x] Trigger names from CC: 85 triggers in broadcast_triggers table
- [x] Video files: 2 MKVs on L: drive on FIRMAMENT
  - `2026-03-29 12-44-31.mkv` — 10.92 GB, 98 min (Act 1)
  - `2026-03-29 14-39-03.mkv` — 9.16 GB, 82 min (Act 2)
- [x] Audio extracted via ffmpeg → 16kHz mono WAV (~150-180MB each, ~2 min extraction)
- [x] Transcribed with faster-whisper small model: 749 + 774 segments
- [x] Announcement pattern: "Welcome to the stage, [routine title]"
- [x] **37 routines confirmed from transcript** — announcer says routine titles for group numbers
- [x] **48 routines interpolated** — solo dancer names (not announced by title, spaced between confirmed anchors)
- [x] Timeline saved: `/mnt/firmament/recital-timeline.json`

### Key Finding
- Announcer always says routine TITLE, not dancer NAME
- Solo entries in the trigger list use dancer names (e.g. "KEIRA GUPPY") but announcer says the song name
- Program PDF would have both dancer name + song title — needed to match solos precisely
- Interpolation fills gaps but timestamps are approximate for clustered solos

### Commands Used
```bash
# Extract audio
ssh firmament "ffmpeg -i \"L:\\2026-03-29 12-44-31.mkv\" -vn -acodec pcm_s16le -ar 16000 -ac 1 \"D:\\Shared\\recital-part1.wav\" -y"

# Transcribe (on SPYBALLOON with CUDA)
python3 -c "from faster_whisper import WhisperModel; ..."
# Small model, beam_size=5, language='en'
```

## Step 5: Photo-to-Routine Matching
- [x] Clock offset determined: **+486s (+8.1 min) camera ahead of system clock**
- [x] Method: found first show photo (photo #100 in 350_PANA at 13:13:12 camera time), compared to Car Wash routine #1 start (13:05:06 system time from transcript)
- [x] Pre-show burst: photos 0-29 at 12:05:18-12:05:53 (test shots), then gap until show start at ~photo 100
- [x] 350_PANA: 999 photos, 12:05:18 → 13:31:06 camera time (pre-show + Act 1 start)
- [x] EXIF extracted from R2 (not SD card) — 7,214 photos, all have timestamps, range 12:05:18–16:07:39
- [x] Script: `/mnt/firmament/extract-r2-exif.py` (boto3 range reads, 20 threads, ~167 files/sec)
- [x] Output: `/mnt/firmament/r2-exif-timestamps.json`
- [x] Applied -486s offset and ran full matching against 53 routine windows
- [x] Match results: **7,074 exact / 99 pre-show / 41 intermission / 0 gap / 0 unmatched**
- [x] Script: `/mnt/firmament/match-photos-to-routines.py`
- [x] Output: `/mnt/firmament/photo-routine-assignments.json`
- [ ] Cross-check needed: verify offset against Part 2 (The Incredibles at ~14:53:36 camera time)
- [x] Routine time windows ready from Step 4 (42 confirmed + 11 interpolated, 53 total)

### Clock Offset Detection — Method Used + Lessons
**What worked:** Find the first real show photo, compare to first routine system time. Simple subtraction.
- Pre-show photos (test burst) easily distinguished by timestamp gap
- Photo #100 at 13:13:12 camera ≈ Car Wash start at 13:05:06 system → offset = +486s

**What failed:** The sampling algorithm from CompSync. With 17 samples across wide 3-min windows, couldn't distinguish candidates.

**Better approaches for automation (future):**
1. Find photo density jump (pre-show gap → rapid shooting = show start) → compare to first routine time
2. User takes a reference photo of a clock/phone screen → instant offset
3. BB app displays a timecode overlay for photographer to snap
4. Read EXIF from ALL photos, build density histogram, find the offset that maximizes alignment with routine windows
5. Trigger fire timestamps make this moot — exact windows, offset detection trivially works

## Step 5b: CC Database Readiness (BLOCKER)
- [ ] Gallery tables do NOT exist in Supabase — Prisma migration never applied
- [ ] Tables needed: `galleries`, `gallery_sections`, `gallery_media` (all in `commandcentered` schema)
- [ ] Enums needed: `GalleryPreset`, `GalleryAccess`, `GalleryMediaType`
- [ ] Code exists: API routes, tRPC router (`gallery.ts`), frontend pages, types — all reference Prisma models
- [ ] Need to verify `galleryRouter` is registered in main tRPC app router
- [ ] Collab message sent to CC-2 session (2026-03-30 ~13:35 ET) requesting migration
- [ ] `recital-clock-offset.json` has WRONG value (0s from failed algorithm) — correct offset is +486s from manual method

### What's built in CC code (confirmed via GitNexus + file reads)
- `app/src/app/api/v1/gallery/route.ts` — POST create gallery
- `app/src/app/api/v1/gallery/[galleryId]/routines/route.ts` — routines CRUD
- `app/src/app/api/v1/gallery/[galleryId]/upload/route.ts` — upload
- `app/src/app/api/v1/gallery/[galleryId]/routines/[routineId]/photos/upload/route.ts` — photo upload
- `app/src/app/api/v1/gallery/[galleryId]/publish/route.ts` — publish
- `app/src/server/routers/gallery.ts` — full tRPC router (list, get, create, sections CRUD, media CRUD, publish, seedFromTriggers)
- `app/src/app/gallery/[slug]/page.tsx` — public gallery with lightbox
- `app/src/app/(dashboard)/galleries/page.tsx` — dashboard page
- `app/src/types/galleryDesign.ts` — GalleryDesign interface
- `app/prisma/schema.prisma` lines 3113-3219 — Gallery, GallerySection, GalleryMedia models

### Key schema note
- Crash transcript says "gallery_routines" but schema uses **`gallery_sections`** — same concept, different name
- `sectionBulkCreate` tRPC endpoint exists for bulk inserting routines/sections
- `mediaCreate` tRPC endpoint registers R2 files in DB (r2Key, thumbnailR2Key, captureTime, etc.)
- `seedFromTriggers` endpoint can populate sections from broadcast_triggers (but those are the wrong 85 — need the correct 53 from program OCR)

## Step 6: Assign Photos to Routines
- [x] Method: Python script on SpyBalloon + CC collab for DB writes
- [x] 53 sections payload prepared: `/mnt/firmament/gallery-sections-payload.json` (28 Act 1 + 25 Act 2, categories: 31 Solo, 15 Group, 7 Duo/Trio)
- [x] Photo assignments prepared: `/mnt/firmament/photo-routine-assignments.json` (7,214 entries)
- [x] Collab message sent to CC-2 with full swap plan (delete 87 wrong sections, insert 53 correct, register 7,214 media)
- [x] CC-2 executed section swap: deleted 87 wrong sections, inserted 53 correct ones (2026-03-30 ~13:55 ET)
- [x] CC-2 registered 7,214 gallery_media rows: 7,074 with section assignments, 140 unassigned (pre-show + intermission)
- [x] All 53 sections have photo_count updated, gallery total_photos = 7,214
- [x] Photos stay in R2 `unsorted/` — DB section_id assignment only, no file moves
- [x] Thumbnails: using **Cloudflare Image Resizing** (on-the-fly, edge-cached, no pre-generation). thumbnail_r2_key stays NULL — CF transforms at URL level. Fallback: sharp batch on FIRMAMENT.
- [ ] Publish: holding until CC gallery page refactor (lazy-load sections, not 7K at once). CC-2 will publish when ready (~1 hour from 13:58 ET)
- [ ] Delete test gallery `f6d31f09` — CC-2 handling

### EXIF Extraction Method (for future automation)
- Used boto3 S3 range reads from R2 (first 64KB per file) — EXIF is in JPEG header
- 20 concurrent threads, ~167 files/sec throughput
- Ran on SpyBalloon (not FIRMAMENT) — R2 accessible from any machine with credentials
- R2 credentials from `~/.env.keys`
- Zero SD card access required — photos already in R2 with EXIF preserved

## Step 7: Program Enrichment
- [x] Choreographer names: included in gallery_sections (from recital-program.json OCR)
- [x] Dancer/performer names: included in gallery_sections subtitle + dancers fields
- [x] Source: Program image OCR (`/mnt/firmament/2.jpg` Act 1, `/mnt/firmament/3.jpg` Act 2)

## Step 8: Gallery Publish
- [ ] Gallery URL: `https://gallery.streamstage.live/spring-recital-2026`
- [ ] Thumbnail generation: Cloudflare Image Resizing (on-the-fly, no pre-gen)
- [ ] CC-2 refactoring gallery page for lazy-load before publish
- [ ] Client notified: yes/no

---

## Pain Points
1. **Vercel deployment protection** blocks API calls via `tickets.streamstage.live` — domain not registered in Vercel project. Had to use `commandcentered.vercel.app` instead.
2. **Vercel 413 body limit** (4.5MB) blocks photo upload via CC API. Photos avg 4.3MB, some 7.4MB. Solution: upload direct to R2, bypass CC API for file transfer entirely.
3. **BB app not installed/tested** — installer built but silent install on FIRMAMENT didn't fully work. Unpacked build exists at `D:\projects\BroadcastBuddy\release\win-unpacked\`.
4. **No session data on FIRMAMENT** — BB never run there, triggers only exist in CC Supabase.
5. **Photos not yet registered in CC DB** — files are in R2 but gallery_media table is empty. Need a bulk register step.

## What to Automate Next
- [x] Step that took the longest: **Upload (2.5 hrs)** — already automated via rclone, but BB app should handle this natively with direct R2 upload (not through CC API)
- [ ] Step most error-prone: **Photo-to-routine matching** — not done yet
- [ ] Step that should be one-click in BB: **Full pipeline: browse SD card → upload to R2 → analyze video → match → register in CC**

---

## Automation Status (BB Gallery Builder)

| Step | Built in BB | Works | Notes |
|------|------------|-------|-------|
| Browse video (multi) | Yes | Untested | File picker, supports multiple Act files |
| **Audio transcription** | **Yes** | **Untested** | **ffmpeg extract + faster-whisper + announcement parsing** |
| Gemini analysis | Yes (fallback) | Untested | Files API upload + prompt — secondary to transcription |
| Browse photo folder | Yes | Untested | File picker |
| EXIF read | Yes | Untested | exifreader (local), range-read from R2 (future) |
| Clock offset detection | **Yes (v2)** | **Untested** | **Density-jump method (replaced broken sampling)** |
| Photo matching | **Yes (v2)** | **Untested** | **Exact/gap/pre-show/intermission/unmatched** |
| **Direct R2 upload** | **Yes** | **Untested** | **@aws-sdk/client-s3, 8 parallel, with thumbnail gen** |
| **Thumbnail gen at ingest** | **Yes** | **Untested** | **sharp 400px wide 80% JPEG, uploaded alongside original** |
| Create gallery on CC | Yes | Untested | Needs working domain |
| Register photos in CC DB | **Partial** | — | **Need CC bulk register endpoint (BB caller ready)** |
| Publish | Yes | Untested | POST /publish |
| **R2 settings UI** | **Yes** | **Untested** | **Endpoint, keys, bucket in Settings panel** |
| Program OCR | No | — | Future: Gemini vision |
| Trigger fire timestamps | No | — | Future: replaces Gemini |

## Key Architecture Decisions

### 1. BB uploads direct to R2, not through CC API
CC API is only for metadata (create gallery, create routines, register photo keys, publish). File bytes never touch Vercel serverless functions. Vercel has a 4.5MB body limit — photos avg 4.3MB, some 7.4MB. This is the permanent pattern, not a workaround.

### 2. Audio transcription for routine detection, not video analysis
- A 3-hour video is too large to upload to Gemini (~15GB+)
- The audio alone tells the full story — there's an announcement before every routine ("next up is Car Wash")
- Extract audio (ffmpeg → wav), transcribe locally, parse announcements to get timestamps
- Gemini becomes a fallback for events without clear audio announcements

### 3. Transcription bundled inside BB Electron app
- **Decision:** Bundle faster-whisper (already working locally) as a child process in the Electron app
- **Why not Gemini/cloud:** Adds latency, cost, upload time. Local is instant for audio.
- **Why not sherpa-onnx/whisper.cpp/Transformers.js:** We already have faster-whisper proven and working. Don't introduce a new tool when existing one works.
- **Why not VibeVoice:** 14GB model, overkill for catching announcements. Base/small Whisper is plenty.
- **Implementation:** Ship faster-whisper + base model with installer, spawn as child process, pipe results back to Electron via stdout JSON
- **Model:** base or small — only needs to catch spoken routine names between music, not word-perfect transcription

### Options Evaluated for Bundled Transcription
| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **faster-whisper (bundled Python)** | Already working locally, GPU support, proven quality | Needs Python runtime bundled | **CHOSEN** — proven, minimal risk |
| whisper.cpp (WASM) | No native deps, runs in-process | 3hr audio = ~6hr on CPU, too slow | Rejected |
| whisper.cpp (native addon) | Fast, GPU support | Native compilation per platform, maintenance burden | Maybe later |
| Transformers.js (whisper) | Pure JS, zero install | Slowest option, limited model support | Rejected |
| sherpa-onnx | Node bindings, single binary, GPU optional | New dependency we haven't used | Backup option |
| VibeVoice ASR 7B | Best quality, diarization | 14GB model, overkill for this use case | Rejected for gallery |
| Gemini cloud | No local compute needed | Upload time for video, cost, latency, 3hr file too big | Fallback only |
| OpenAI Whisper API | High quality, fast | Cloud dependency, cost per minute | Rejected — want local |

### 4. Routine detection pipeline (in-app)
1. User selects video file(s) in Gallery Builder
2. BB extracts audio via ffmpeg (bundled) → wav
3. BB transcribes via faster-whisper (bundled) → timestamped segments
4. BB parses transcript — matches announcements to trigger names → routine timestamps
5. Routine windows created: each announcement = start, next announcement = end
6. EXIF matching runs against those windows
7. Photos sorted into routines, uploaded to R2 with routine-specific keys
