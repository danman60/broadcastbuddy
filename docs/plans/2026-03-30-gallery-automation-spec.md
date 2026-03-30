# Gallery Builder — Automation Spec

**Derived from:** Manual runbook (`2026-03-30-gallery-runbook.md`) for 7Attitudes recital
**Method:** Work backwards from every manual step, compare to existing `galleryService.ts`, identify gaps

---

## Pipeline Overview (what actually worked)

```
1. Select sources (photos, video, program)
2. Upload photos direct to R2
3. Extract audio from video → transcribe → routine windows
4. Read EXIF timestamps (from R2 or local)
5. Detect clock offset (density-jump method)
6. Match photos to routine windows
7. Create gallery + sections on CC (bulk)
8. Register matched photos in CC DB (bulk, metadata only)
9. Publish
```

---

## Step-by-step: What exists vs what's needed

### Step 1: Source Selection
**Exists:** `browseVideo()`, `browsePhotoFolder()` — file/folder pickers
**Gap:** None for basic flow. Future: browse multiple video files (recital had 2 MKVs)
**Future:** Program image picker for OCR (step 7 enrichment)

| Change | Priority | Effort |
|--------|----------|--------|
| Support multiple video files (Act 1, Act 2, etc.) | P1 | Small — array instead of single path |
| Program image picker | P2 | Small — reuse file picker |

---

### Step 2: Upload Photos Direct to R2
**Exists:** `uploadToCC()` sends photo bytes through CC API via FormData
**BROKEN:** CC API has 4.5MB Vercel limit. Photos avg 4.3MB, some 7.4MB. This is the #1 failure mode.
**What worked manually:** rclone → R2 S3 API, 8 parallel transfers, 30GB in 2.5 hours

| Change | Priority | Effort |
|--------|----------|--------|
| **Add `@aws-sdk/client-s3` for direct R2 upload** | **P0** | Medium — new dependency, S3 PutObject with parallelism |
| Upload preserves original filename in R2 key | P0 | Small — already in key generation |
| Progress reporting per-file and overall | P1 | Small — exists for CC upload, adapt for S3 |
| Resume/retry on failure (track uploaded files) | P1 | Medium — need upload state persistence |
| R2 credentials in electron-store settings | P0 | Small — add to settings panel |

**Implementation:**
```typescript
// New: src/main/services/r2Upload.ts
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

// Upload all photos to R2 unsorted, preserving subfolder structure
// Key pattern: galleries/{slug}/unsorted/{subfolder}/{filename}
// Parallel uploads (configurable, default 8)
// Returns: { uploaded: number, failed: string[], r2Keys: Map<localPath, r2Key> }
```

---

### Step 3: Routine Detection — Audio Transcription
**Exists:** `analyzeVideo()` — Gemini Files API upload + video analysis prompt
**WRONG APPROACH:** Gemini video analysis doesn't work for 3+ hour recitals (file too large, expensive, slow). Audio transcription is 10x faster and more accurate for announcement-based events.
**What worked manually:** ffmpeg extract audio → faster-whisper small model → parse "Welcome to the stage, [title]" announcements

| Change | Priority | Effort |
|--------|----------|--------|
| **Add audio extraction via ffmpeg** | **P0** | Medium — spawn ffmpeg child process, output WAV |
| **Add faster-whisper transcription** | **P0** | Large — bundle Python + faster-whisper, spawn child process, parse stdout JSON |
| Parse transcript for announcement patterns | P0 | Medium — regex/fuzzy match "welcome to the stage" + routine names |
| Fuzzy match announcements to trigger names | P1 | Medium — levenshtein or token overlap scoring |
| Keep Gemini as fallback for events without announcements | P2 | None — already exists |
| Support multiple video files (Act 1 + Act 2 with separate timebases) | P1 | Medium — track video_start per file |

**Implementation:**
```typescript
// New: src/main/services/audioTranscription.ts

// 1. extractAudio(videoPath) → wavPath
//    Spawns: ffmpeg -i video.mkv -vn -acodec pcm_s16le -ar 16000 -ac 1 output.wav
//    Returns WAV path

// 2. transcribe(wavPath) → TranscriptSegment[]
//    Spawns: python -c "from faster_whisper import WhisperModel; ..."
//    Or: bundled faster-whisper binary
//    Returns: [{text, start_sec, end_sec, confidence}]

// 3. parseAnnouncements(segments, triggerNames) → RoutineWindow[]
//    Pattern: "welcome to the stage" + fuzzy match to trigger name
//    Returns: [{name, start_sec, source: 'transcript'|'interpolated', confidence}]

// 4. buildRoutineWindows(announcements) → RoutineBoundary[]
//    Each routine: start = announcement time, end = next announcement time
//    Last routine: end = start + 10 minutes
```

**Bundling decision (from runbook):** Ship faster-whisper + base/small model with installer. Spawn as child process. No cloud dependency.

---

### Step 4: EXIF Timestamp Reading
**Exists:** `readExifTimestamps()` — reads from local filesystem, sequential, ExifReader library
**Gap:** Can't read from R2 when photos are already uploaded (common for post-event processing)
**What worked manually:** boto3 S3 range reads (first 64KB), 20 threads, 167 files/sec

| Change | Priority | Effort |
|--------|----------|--------|
| **Add R2 EXIF reading (S3 range requests)** | **P1** | Medium — S3 GetObject with Range header, parse EXIF from partial download |
| Parallelize local EXIF reading (currently sequential) | P1 | Small — worker_threads or Promise.all with concurrency limit |
| Auto-detect source: if photos already in R2, read from there | P2 | Small — check R2 listing vs local folder |

**Implementation:**
```typescript
// Extend readExifTimestamps() to accept source: 'local' | 'r2'
// For R2: GetObject with Range: bytes=0-65535, parse EXIF from buffer
// Use p-limit or manual semaphore for 20-thread concurrency
```

---

### Step 5: Clock Offset Detection
**Exists:** `detectClockOffset()` — sampling algorithm (10 samples, candidate offsets, score)
**BROKEN:** Failed in practice. With wide routine windows and sparse samples, couldn't distinguish candidates. Returned 0 when actual offset was 486s.
**What worked manually:** Find first show photo (density jump after pre-show gap), compare to first routine system time.

| Change | Priority | Effort |
|--------|----------|--------|
| **Replace sampling with density-jump method** | **P0** | Medium |
| Keep manual override (already exists) | — | — |
| Cross-verification against Act 2 data point | P2 | Small |

**Implementation:**
```typescript
// New algorithm:
// 1. Sort photos by captureTime
// 2. Find density jump: look for gap > 5 minutes followed by rapid shooting
//    Pre-show: sparse test shots. Show start: continuous shooting.
//    The transition point = first show photo.
// 3. First show photo camera time - first routine system time = offset
// 4. Verify: apply offset, check what % of photos fall within routine windows
//    If < 80%, warn user and suggest manual adjustment

function detectClockOffsetV2(
  photos: { captureTime: Date }[],
  boundaries: RoutineBoundary[],
): { offsetMs: number; confidence: number; method: string } {
  // Sort by time
  const sorted = [...photos].sort((a, b) => a.captureTime.getTime() - b.captureTime.getTime())

  // Find density jump: gap > 5min then rapid shooting (< 30s between consecutive)
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].captureTime.getTime() - sorted[i-1].captureTime.getTime()
    if (gap > 5 * 60 * 1000) {
      // Check next 10 photos are within 2 minutes (rapid shooting)
      const nextBatch = sorted.slice(i, i + 10)
      if (nextBatch.length >= 5) {
        const batchSpan = nextBatch[nextBatch.length-1].captureTime.getTime() - nextBatch[0].captureTime.getTime()
        if (batchSpan < 2 * 60 * 1000) {
          // Found it: sorted[i] is first show photo
          const firstShowPhoto = sorted[i].captureTime.getTime()
          const firstRoutine = new Date(boundaries[0].timestampStart).getTime()
          return {
            offsetMs: firstShowPhoto - firstRoutine,
            confidence: 0.9,
            method: 'density-jump'
          }
        }
      }
    }
  }

  // Fallback: brute-force histogram alignment
  return bruteForceOffset(sorted, boundaries)
}
```

---

### Step 6: Photo-to-Routine Matching
**Exists:** `matchPhotos()` — works correctly. Maps adjusted timestamps to routine windows with buffer.
**Gap:** Missing pre-show/intermission/post-show classification. Current code only has exact/gap/unmatched.

| Change | Priority | Effort |
|--------|----------|--------|
| Add pre-show/intermission/post-show categories | P1 | Small — check if before first routine, between acts, or after last |
| Multi-act support (detect act break as large gap between routines) | P1 | Small |

---

### Step 7: Gallery + Section Creation on CC
**Exists:** `uploadToCC()` — creates gallery + routines via CC API sequentially
**Gap:** Doesn't include program enrichment (choreographer, dancers, category). Only sends name/description.
**What worked manually:** Merged program OCR data with timeline data, sent via sectionBulkCreate with full metadata.

| Change | Priority | Effort |
|--------|----------|--------|
| Use `sectionBulkCreate` tRPC endpoint (or equivalent REST) instead of per-routine POST | P1 | Small — single batch call |
| Include choreographer, dancers, category from program data | P1 | Small — add fields to payload |
| **Add program OCR** (Gemini Vision on program image → structured routine data) | **P2** | Medium — Gemini vision prompt, parse JSON output |
| Auto-detect Solo/Group/Duo from performer field | P2 | Small — name pattern heuristic |

**Program OCR implementation:**
```typescript
// New: src/main/services/programOcr.ts
// Input: image file (photo of printed program)
// Process: Gemini Vision API → structured JSON
// Output: [{num, routine, performers, choreographer}]
// Merge with transcript-based timeline to get full section data
```

---

### Step 8: Register Photos in CC DB (Bulk)
**Exists:** `uploadToCC()` uploads file bytes AND registers in one step via CC API
**WRONG:** File bytes should never touch CC API. Upload is step 2 (direct to R2). Registration is metadata-only.
**What worked manually:** Bulk SQL insert of 7,214 gallery_media rows with r2_key, capture_time, section_id. No file bytes.

| Change | Priority | Effort |
|--------|----------|--------|
| **New bulk media registration endpoint** (CC side — POST r2Keys + metadata, no file bytes) | **P0** | Medium — CC needs new endpoint or use existing mediaCreate in batch |
| BB sends: [{r2Key, originalFilename, captureTime, sectionName, sortOrder}] | P0 | Small |
| Batch size: 500 per request | P1 | Small |
| Update gallery/section photo counts after bulk insert | P1 | Small — CC endpoint handles this |

---

### Step 9: Publish
**Exists:** Final step in `uploadToCC()` — `POST /api/v1/gallery/{id}/publish`
**Gap:** None. Works as-is.

---

## New Pipeline Flow (replaces `runFullPipeline`)

```
async function runGalleryPipeline(config: PipelineConfig): Promise<PipelineResult> {
  // 1. Create gallery on CC
  const gallery = await createGalleryOnCC(config.title, config.eventId)

  // 2. Upload photos direct to R2 (parallel, resumable)
  const uploadResult = await uploadPhotosToR2(config.photoFolder, gallery.slug)
  // Returns Map<filename, r2Key> for all uploaded files

  // 3. Extract audio from video(s)
  const wavPaths = await Promise.all(
    config.videoPaths.map(v => extractAudio(v))
  )

  // 4. Transcribe audio → routine windows
  const transcripts = await Promise.all(
    wavPaths.map(w => transcribe(w))
  )
  const routineWindows = parseAnnouncements(
    transcripts,
    config.triggerNames,
    config.videoPaths.map(v => getVideoStartTime(v))
  )

  // 5. Read EXIF (from R2 if already uploaded, else local)
  const exifData = uploadResult.r2Keys.size > 0
    ? await readExifFromR2(gallery.slug)
    : await readExifFromLocal(config.photoFolder)

  // 6. Detect clock offset
  const offset = detectClockOffsetV2(exifData, routineWindows)
  // Show to user for confirmation, allow manual adjustment

  // 7. Match photos to routines
  const matches = matchPhotos(exifData, routineWindows, offset.offsetMs)

  // 8. Create sections on CC (bulk, with program data if available)
  const sections = await createSectionsOnCC(gallery.id, routineWindows, config.programData)

  // 9. Register photos in CC DB (bulk, metadata only)
  await registerPhotosInCC(gallery.id, matches, sections)

  // 10. Publish
  await publishGallery(gallery.id)
}
```

---

## Priority Matrix

| P0 (Must have — current flow is broken) | Effort |
|------------------------------------------|--------|
| Direct R2 upload (`@aws-sdk/client-s3`) | Medium |
| Audio extraction (ffmpeg spawn) | Medium |
| Faster-whisper transcription (child process) | Large |
| Clock offset v2 (density-jump) | Medium |
| Bulk media registration (metadata-only) | Medium |
| R2 credentials in settings | Small |

| P1 (Should have — manual workarounds exist) | Effort |
|----------------------------------------------|--------|
| EXIF from R2 (range reads) | Medium |
| Parallel local EXIF reading | Small |
| Multi-video support (Act 1 + 2) | Medium |
| Announcement parsing (fuzzy match) | Medium |
| Bulk section creation with enrichment | Small |
| Pre-show/intermission classification | Small |
| Upload resume/retry | Medium |

| P2 (Nice to have — future events) | Effort |
|------------------------------------|--------|
| Program OCR (Gemini Vision) | Medium |
| Auto Solo/Group/Duo detection | Small |
| Trigger fire timestamps (replaces all detection) | Large (BB + CC) |
| Offset cross-verification | Small |

---

## Dependencies

```
P0 items can be built independently:
  R2 upload ──────────────── no deps
  Audio extraction ────────── ffmpeg bundled or system
  Transcription ──────────── faster-whisper bundled (largest effort)
  Offset v2 ──────────────── no deps
  Bulk registration ───────── CC needs new endpoint

P1 items depend on P0:
  EXIF from R2 ────────────── needs R2 client from upload step
  Multi-video ─────────────── needs transcription step
  Announcement parsing ────── needs transcription step
```

---

## What to delete from current code

- `detectClockOffset()` — replace entirely with density-jump v2
- Upload-via-CC-API path in `uploadToCC()` — replace with R2 direct + bulk register
- Single video assumption throughout — refactor to video array

## What to keep

- `browseVideo()`, `browsePhotoFolder()` — fine as-is
- `getPhotoCaptureTime()`, `scanPhotos()` — keep for local EXIF
- `matchPhotos()` — core logic is correct, just add categories
- `analyzeVideo()` (Gemini) — keep as fallback, not primary
- `generateR2Key()`, `generateR2ThumbKey()` — keep
- Progress reporting pattern — keep, extend to new steps
- `runFullPipeline()` structure — keep pattern, replace internals
