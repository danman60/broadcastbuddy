# Pre-Show Cover + Live Countdown Overlay — Spec

**Date:** 2026-06-19  ·  **Status:** spec → implement this session  ·  **Scope:** BB-only, additive

## Goal
A full-frame "pre-show cover" that completely covers the OBS program, with a beautiful live HTML countdown timer drawing over it. The backdrop slot accepts **either** a looping MP4 (e.g. a rendered Remotion `StartingSoon7A`) **or** the existing HTML starting-soon design. The countdown is always a live HTML top layer — it draws over any backdrop. The cover is zero-cost when inactive (the video element unloads on hide), so it never taxes CPU/RAM during the live show.

## Why this shape (decided with user)
- Countdown decoupled from backdrop → one live timer composites over MP4 **or** HTML.
- BB already serves the overlay as an OBS browser source with WS state push; the starting-soon already renders full-frame (`.starting-soon` = fixed inset 0) with a working countdown. So this is an **extension**, not new infra.
- MP4-vs-HTML is not either/or: the MP4 is just a *backdrop layer* inside the same BB-controlled cover. HTML backdrop for designs that run live; MP4 for rich baked Remotion loops.
- CPU concern is moot during pre-show (no camera AI / no lower-third work, machine idle except encode) **provided** the backdrop video truly unloads when hidden. We enforce that in the browser source (pause + clear `src` on hide) — not relying on OBS source lifecycle, because the overlay browser source must stay live for in-show lower-thirds.

## Existing pieces (reuse, do not reinvent)
- `StartingSoonState` (src/shared/types.ts:230) — countdown (`countdownTarget`/`countdownSeconds`/`showCountdown`/`completionText`), title/subtitle, design/layout.
- `StartingSoonMedia` (types.ts:168) — already has `videoUrl?`/`showVideo?` (an **inset** framed window today, z-index:0).
- `overlaySource.ts` — renders `.starting-soon`, `#ss-countdown` (with `style-flipboard` final-30s treatment), inset video, ambient bg (z-index:-1). `applyStartingSoon()` (line ~1630) drives it; countdown interval at ~1117/1773.
- IPC: `STARTING_SOON_SHOW`/`HIDE`/`UPDATE` (ipc.ts:723-735), `updateStartingSoon` merge path (ipc.ts:133).
- `StartingSoonPanel.tsx` (form config) + `StartingSoonEditor.tsx` (drag/design scene editor).

## Changes

### 1. Types (src/shared/types.ts) — `StartingSoonState`
Add a backdrop-cover slot (distinct from the existing inset `media.videoUrl`):
```
backdropVideoUrl?: string   // full-frame looping MP4 URL (http(s) or BB-served). Empty/absent = no video backdrop.
backdropMode?: 'cover' | 'none'   // 'cover' = full-frame object-fit:cover opaque backdrop. Default 'none'.
```
Keep `media.videoUrl` (inset) untouched — different feature.

### 2. Browser source (src/main/services/overlaySource.ts)
- Add a full-frame backdrop element as the FIRST child of `.starting-soon`:
  `<video id="ss-backdrop" loop muted playsinline></video>` — CSS: `position:absolute; inset:0; width:100%; height:100%; object-fit:cover; z-index:0; background:#000;` (opaque so it covers program below; the HTML starting-soon ambient/text sit above it via their own z-index, countdown highest).
- Raise countdown/title/welcome above the backdrop: ensure `.ss-countdown`, `.ss-title`, `.ss-subtitle`, `.ss-welcome` z-index ≥ 2. Add a subtle radial **scrim** (`#ss-backdrop-scrim`, z-index:1) behind the countdown when a video backdrop is active, for legibility over busy footage (only shown when `backdropMode==='cover' && backdropVideoUrl`).
- In `applyStartingSoon(ss, ...)`:
  - If `ss.backdropMode==='cover' && ss.backdropVideoUrl`: set `video.src = ss.backdropVideoUrl` ONLY if changed (avoid restart on every state push), `video.play()`, show scrim.
  - Else / on hide (`!ss.visible`): `video.pause(); video.removeAttribute('src'); video.load();` (true unload → zero decode cost), hide scrim. This is the load-bearing "unmounts when inactive" guarantee — verify the `src` is cleared on hide.
- Countdown polish ("beautiful, draws over any backdrop"): keep the existing flipboard final-30s treatment; ensure legibility over video via the scrim + a text-shadow. Large, centered, broadcast-clean. No new countdown engine — reuse the existing interval/target logic.

### 3. Operator controls (src/renderer/components/StartingSoonPanel.tsx)
- Add a "Backdrop video (full-frame loop)" URL input + a "Cover mode" toggle that sets `backdropMode` to `'cover'`/`'none'` and `backdropVideoUrl`. Wire through `window.api.startingSoonUpdate({ backdropVideoUrl, backdropMode })`.
- Preview note: when cover mode on + URL set, the SS overlay shows the looping MP4 full-frame with the countdown over it.

### 4. IPC / merge (src/main/ipc.ts ~133, STARTING_SOON_UPDATE)
- Ensure the `updateStartingSoon` merge passes through `backdropVideoUrl`/`backdropMode` (string/enum validated). No new IPC channel — reuse `STARTING_SOON_UPDATE`.

### 5. Countdown-over-anything (the "regardless" ask)
- Because the countdown is its own top layer inside the SS overlay, it already composites over the HTML backdrop. With the full-frame video backdrop + raised z-index + scrim, it now also composites over the MP4. Same single live timer either way. ✓

## Out of scope (later)
- CC broadcast-package carrying `backdropVideoUrl` per event (CC side, claude:15) → auto-fill on apply.
- Auto-creating a dedicated OBS scene via obs-websocket. Not needed: the existing overlay browser source is already the top OBS layer; full-frame opaque backdrop covers program when active; video unload handles CPU.
- LLM-generated starting-soon (the "deterministic form + LLM style eyes" end-state) — separate future track.
- Serving a locally-picked MP4 file via BB Express (v1 accepts an http(s) URL or BB-served URL; the Remotion render would be hosted).

## Verification
- tsc clean; electron-vite build pass.
- Screenshot the SS overlay with countdown over a full-frame backdrop → DM.
- Hide → confirm `#ss-backdrop` has no `src` (zero decode) — note in browser source comment/log.
- Deploy to DART; verify `ss-backdrop` + `backdropMode` strings land in asar.
```
```
