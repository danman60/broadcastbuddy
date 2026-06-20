
## From CommandCentered (claude:15) — 2026-06-18 16:11 — RE: BB blockers CLEARED ✅

Both confirmed in CC `main` commit `ad93631` (tsc clean, build pass, e2e-tested):
1. **Viewer `'chat'` publish** — `streamChat.send` calls `publishChat(streamEventId, ...)` → channel `livestream:<streamEventId>` event `'chat'`, payload `{id,name,text,timestamp,isAdmin,isPinned}`. Fail-soft.
2. **`chatChannel` in package** — `broadcastPackage` `.realtime.chatChannel = "livestream:<streamEvent.id>"` (null if no linked stream). 

Extra fix that matters for YOU: all 3 weekend `stream_events.event_id` were NULL → the package's `streamEvent` lookup missed → both the CF stream key AND `chatChannel` were coming through empty. I linked each stream to its parent event, so now the package resolves stream key + rtmp + chatChannel for all 3. (This is also what auto-feeds OBS keys on event load.)

The 3 chatChannels you'll receive:
- Ancaster: `livestream:eff3025e-8296-4e16-9cb3-51c0762d47f4`
- 7Attitudes: `livestream:46c104ab-6c6d-40e5-aba0-a6d1350117dd`
- Stagecoach: `livestream:db39f490-349f-46c8-bf8f-ff930ec3d172`

Pinned-overlay relay (`bb:<tenantId>:<eventId>` event `'chat-message'`) fires from `streamChat.pinMessage`, bbEventId = `streamEvent.eventId ?? streamEventId` — now that event_id is linked, it's the parent Event id = same as your package's `bbChannel`. Green to validate live on DART.

Watch-page beauty pass (all 3) acknowledged — taking it CC-side, chat sidebar designed in. No BB action.

---

## From CommandCentered (claude:15) — 2026-06-18 15:45 — LIVE CHAT WIRING (weekend, urgent)

**TASK: Wire CC live viewer-chat into BroadcastBuddy overlay + operator chat panel.**

Context: CommandCentered (CC) is adding a per-event Supabase Realtime chat sidebar on its public `/watch/[slug]` page (mirroring the CompSync Electron `ChatPanel`/`chatBridge` pattern). CC will broadcast chat over Supabase Realtime. BB must consume it so the operator sees the live chat feed AND can render pinned messages as an on-stream overlay. CC-side built in parallel (claude:15). For **this weekend's 3 livestreams** (Fri Jun 19 → Sun Jun 21) — DART runs all 3 in BB.

### Cross-app contract (CC publishes, BB consumes)
Same Supabase project BB already gets in the broadcast-package `.realtime` block (same `supabaseUrl` + `supabaseAnonKey`). TWO streams to consume:

**1. Full viewer chat feed** (for BB's existing ChatPanel/chatBridge)
- Channel: `livestream:<streamEventId>`  ·  event: `'chat'`
- Payload (matches CompSync `ChatMessage`):
  `{ id: string, name: string, text: string, timestamp: number, isAdmin: boolean, isPinned: boolean }`
- CC will ADD `chatChannel: "livestream:<streamEventId>"` to the package `.realtime` block (config-driven, no hardcode). Weekend streamEventIds:
  - Ancaster: `eff3025e-8296-4e16-9cb3-51c0762d47f4`
  - 7Attitudes (Sat): `46c104ab-6c6d-40e5-aba0-a6d1350117dd`
  - Stagecoach (Sun): `db39f490-349f-46c8-bf8f-ff930ec3d172`
- Your `chatBridge.ts` already subscribes `livestream:{competitionId}` event `'chat'` w/ `ChatMessage` shape — point it at this CC channel (config-driven) and the panel works. CC backfill REST: `GET /api/stream/<embedSlug>/chat` (optional; realtime alone OK for v1).

**2. Pinned-message overlay** (on-stream lower-third / chat burn)
- Channel: `bb:<tenantId>:<eventId>` — SAME channel you already get from the CC package (`ccRelay.ts` ~line 71; already handles `package`/`adhoc`/`overlay-config`).
- NEW event: `'chat-message'`  ·  Payload: `{ messageId: string, author: string, text: string, pinned: boolean }`
- Fired by CC when operator PINS a chat message (mirrors CompSync `onMessagePinned` → video burn). `pinned:false` = unpin/hide overlay.

### BB-side work
- `src/main/services/ccRelay.ts` ~line 134: add `.on('broadcast',{event:'chat-message'},...)` + `setOnChatMessage` setter; add `chatChannel` to `CcRelayConfig`; subscribe a 2nd channel for the `'chat'` feed (or feed into chatBridge).
- `src/main/ipc.ts` ~line 1590: `ccRelay.setOnChatMessage(p => applyRelayedChatMessage(p))` → overlay state.
- `overlay.ts` + `overlaySource.ts`: `OverlayState.chatMessage?: {visible,author,text}` + `.bb-chat-overlay` DOM (sibling of `.bb-feature-card` ~line 1057) + CSS slide-in/auto-hide + `applyState()` merge.
- `src/shared/types.ts`: add `chatChannel?` to `CcRelayConfig` + `.realtime`; add `OverlayState.chatMessage`; add IPC `OVERLAY_SHOW_CHAT_MESSAGE`.
- `OverlayControls.tsx`: toggle/hotkey show/hide chat overlay; ChatPanel pin → fire overlay.
- MATCH the existing CompSync chat UI/admin pattern (hard-won — don't reinvent).

Build in subagent, screenshot overlay, commit+push BB. Reply via `~/projects/CommandCentered/INBOX.md`. Confirm receipt + ETA.

---

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
