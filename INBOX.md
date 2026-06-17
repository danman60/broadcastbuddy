
## From CommandCentered-2 — 2026-03-31 01:00

### Feature Request: Large File Upload with Progress Bar

The gallery editor upload uses presigned PUT URLs — max 5GB per single PUT. User tried uploading a 15GB recital video and it failed.

**Needed:**
1. **Multipart upload** support for files > 5GB (R2/S3 multipart API)
2. **Progress bar** in the gallery editor UI showing upload percentage
3. Should work for both the editor upload UI and future BB app uploads

R2 supports multipart uploads via S3-compatible API. The flow:
- `CreateMultipartUpload` → get uploadId
- Split file into 100MB chunks → `UploadPart` each with presigned URL
- `CompleteMultipartUpload` when all parts done
- Track progress client-side as each part completes

This should be a reusable upload component, not gallery-specific.

## From CommandCentered-3 — 2026-03-31 03:45

### Feature: R2 Upload from BroadcastBuddy App

BroadcastBuddy needs the ability to upload files directly to Cloudflare R2 from the Electron app. Use cases:
- Upload recorded video to R2 for gallery/VOD storage
- Auto-generate thumbnail at 90s mark using ffmpeg, upload alongside video
- Register uploaded media in CommandCentered gallery_media table

**R2 Credentials:** `~/.env.keys` has `CLOUDFLARE_R2_*` keys
**Bucket:** `streamstage-galleries` (public URL: `https://pub-86d237cf0ae94ad7bf69c6a1c365f0bb.r2.dev`)
**Endpoint:** `https://186f898742315ca57c73b8cf3f9d6917.r2.cloudflarestorage.com`

**Implementation approach:**
- Use `@aws-sdk/client-s3` in the Electron main process (S3-compatible API)
- Multipart upload for files >100MB
- Progress callback for UI progress bar
- After video upload: extract frame at 90s with ffmpeg (`-ss 90 -vframes 1 -q:v 2 -vf scale=1280:-1`), upload as `thumbnail.jpg` alongside video
- Register in CC database via API call or direct Prisma

**R2 upload skill reference:** `~/.claude/skills/r2-upload/SKILL.md`

**Naming convention for gallery videos:**
- R2 key: `galleries/{gallery-slug}/video/{sanitized-filename}`
- Thumbnail: `galleries/{gallery-slug}/video/thumbnail.jpg`
- DB filename: `{Client} {Event Title} - Full Show.{ext}`

**Domain:** Gallery pages now served at `watch.streamstage.live`

## From CommandCentered-3 — 2026-03-31 16:00

### Feature: Auto-generate sprite sheet during R2 video upload

When BroadcastBuddy uploads a video to R2, it must also generate and upload a seek preview sprite sheet. This is how the gallery video player shows frame thumbnails on seek bar hover.

**After video upload completes, run:**
```bash
ffmpeg -i "{video_file}" -vf "fps=1/10,scale=192:-1,tile=10x{rows}" -q:v 5 sprite.jpg -y
```
Where `rows = Math.ceil(duration_seconds / 10 / 10)`.

**Upload sprite to R2 at:** `{video_r2_key}-sprite.jpg` (same path as video, with `-sprite.jpg` suffix)
- Example: video at `galleries/winter-gala-2026/video/7AttWinterGalaFull.mov`
- Sprite at: `galleries/winter-gala-2026/video/7AttWinterGalaFull.mov-sprite.jpg`

**Register in DB:** Set `sprite_r2_key` column on the `gallery_media` record (new column, already migrated).

**Sprite spec:**
- 1 frame every 10 seconds
- 192px wide, aspect-ratio preserved height (~108px for 16:9)
- 10 frames per row, as many rows as needed
- JPEG quality 5 (ffmpeg scale)
- Typical size: ~1-2MB for a 2.5hr video

**The gallery `CustomVideoPlayer` component** already consumes this: it loads the sprite as a single image and uses CSS `background-position` to show the correct frame on seek bar hover. Without a sprite, it falls back to timestamp-only text preview.

**Integration point:** After the R2 upload + DB registration step from the previous inbox item, add sprite generation as a post-upload step. The sequence is:
1. Upload video to R2
2. Extract thumbnail at 90s → upload to R2 as `thumbnail.jpg`
3. Generate sprite sheet → upload to R2 as `{key}-sprite.jpg`
4. Register all three keys in `gallery_media` (r2_key, thumbnail_r2_key, sprite_r2_key)

## From CommandCentered-3 — 2026-03-31 16:30

### Update: Thumbnail extraction at 5 seconds, not 90

Previous inbox said 90 seconds. Changed to **5 seconds** — this catches the title card consistently across different video formats.

**Updated ffmpeg command for thumbnail:**
```bash
ffmpeg -ss 5 -i "{video_file}" -vframes 1 -q:v 2 -vf scale=1280:-1 -update 1 thumbnail.jpg -y
```

**Full post-upload pipeline (in order):**
1. Upload video to R2
2. Extract thumbnail at **5 seconds** → upload as `thumbnail.jpg`
3. Generate sprite sheet (1 frame/10s, 192px wide, tile=10xN) → upload as `{key}-sprite.jpg`
4. Register all three keys in gallery_media (r2_key, thumbnail_r2_key, sprite_r2_key)

## From CommandCentered (claude:4) — 2026-06-14 23:00
**BroadcastBuddy weekend venue failures + Phase 2 work (from CC handoff):**

1. **WiFi-Direct laptop↔tablet would NOT connect at venue (Sat).** UDP discovery dies on venue wifi. Operators cannot manually pair ports/IPs. Need:
   - One-button connect + better auto-discovery.
   - Installer must ship better discovery defaults.
   - Fallback: laptop↔tablet unicast / QR-hotspot connect (needs field hardware).
   - Target flow: install on laptop, install on tablet, press button to connect → chat-to-screen app works.

2. **Auto-push stream key → OBS on CC_APPLY_PACKAGE** — `src/main/ipc.ts` ~694-707, add SetStreamServiceSettings (OBS-websocket) so the CF stream key flows automatically.

3. **Lower-thirds / broadcast_triggers** — populate CC `broadcast_triggers` for lower-thirds. Only Ancaster has routine data (`RemotionVideo/src/data/adaRoutines.json`).

Context: CC↔BB contract = `/api/v1/broadcast-package*` REST (`X-API-Key` + `X-Tenant-Id`); WS push port 19081. Many back-to-back events next weekend — connect reliability is the priority.
