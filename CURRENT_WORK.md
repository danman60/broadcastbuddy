# Current Work - BroadcastBuddy

## Active Task
Gallery / Photo Sorting system — sorting pipeline built, UI pending.

## Recent Changes (2026-03-29)

### Gallery Photo Sorting Pipeline
- **New types**: `RoutineBoundary`, `PhotoMatch`, `GalleryConfig`, `GalleryProgress` in `shared/types.ts`
- **New IPC channels**: `GALLERY_BROWSE_VIDEO`, `GALLERY_BROWSE_PHOTOS`, `GALLERY_ANALYZE_VIDEO`, `GALLERY_READ_EXIF`, `GALLERY_MATCH_PHOTOS`, `GALLERY_SET_OFFSET`, `GALLERY_GET_CONFIG`, `GALLERY_UPLOAD_TO_CC`, `GALLERY_PROGRESS`
- **New service**: `src/main/services/galleryService.ts` — full pipeline:
  - Gemini video analysis (Files API upload → routine boundary detection)
  - EXIF extraction (exifreader, ported from CompSync)
  - Clock offset detection (sampling algorithm from CompSync)
  - Photo-to-routine matching (exact/gap/unmatched tiers)
  - CC gallery upload (create gallery, create routines, upload photos, publish)
  - Manual offset override for known camera clock skew
- **IPC handlers** wired in `ipc.ts`
- **Preload API** bindings in `preload/index.ts`
- **Dependency**: `exifreader` installed
- **Build**: passes clean (electron-vite build)

### CC Gallery Spec
- Full spec written to `~/projects/CommandCentered/INBOX.md`
- Gallery hosted at `gallery.streamstage.live` via CC repo
- R2 buckets for photo storage (not Supabase)
- DB models: galleries, gallery_routines, gallery_photos
- API endpoints for BB to upload to

## Previous Commits
- `89064b9` — sync tracking files before Linux migration
- `c3d5e89` — streaming config fix for link/embed, client logo sync
- `5caa65d` — full CC sync v2: package type, checklist two-way sync, overlay config, WebSocket push

## Pending
- **Apply CC migration to Supabase** — broadcast_triggers + production_checklist_items tables
- **CC gallery API endpoints** — spec delivered to CC INBOX.md with exact contracts

## Future Work
- **Trigger fire timestamps** — record firedAt + obsTimecode on every trigger fire, use as recording windows for photo matching (Gemini becomes fallback for post-hoc analysis)
- VDO.Ninja integration
- Tablet production view + Android app
- CDN viewership + integrated chat
- Remotion render-on-demand event animations
- Wi-Fi Display integration
