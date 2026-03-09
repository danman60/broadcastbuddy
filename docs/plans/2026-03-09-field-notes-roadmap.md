# BroadcastBuddy Field Notes Roadmap — 2026-03-09

## Bugs (Fix Now)

- [x] **1. Slider drag vs panel drag conflict** — Duration slider in AnimationPanel gets intercepted by panel/window drag. Add `stopPropagation` on range input pointer events.
- [x] **2. Session name badge won't dismiss** — `header-session-name` in Header.tsx has no click handler. Add click-to-dismiss.
- [x] **3. Compact mode still shows preview** — Hide `OverlayPreview` entirely when `compactMode === true`.
- [x] **4. Animation quality** — Sparkle has no sparkle (just brightness fade). Typewriter uses clip-path block reveal, not character-by-character. Rework both + polish all animations.

## Near-term Features

- [x] **5. Stream key / link storage** — StreamInfoPanel with per-session storage, copy buttons, show/hide key.
- [x] **6. Notes with OBS timecodes** — NotesPanel with OBS WebSocket v5 raw client, `GetRecordStatus` timecode stamping.
- [x] **7. Stream Deck draggable buttons** — Already done. Plugin manifest provides 7 individual draggable button actions.
- [x] **8. Starting Soon overlay section** — Full scene with countdown timer, preset durations, custom time, colors. Browser source renders full-screen with animated countdown.
- [x] **12. Visual overlay editor spec** — Written at `docs/plans/2026-03-09-visual-overlay-editor-spec.md`.

## Future Work

- [ ] **9+10+11. Command Center integration** — Preload event data, logos, streaming links, chat links, flight checklist from CC API (`~/projects/CommandCentered`, 110+ endpoints). Tenant-specific branding (StreamStage first). Flight checklist configurable from CC.
- [ ] **13. OBSN screen share integration** — Pull in OBSN-style screen share URLs as browser sources.
- [ ] **14+15. Tablet production view** — Split layout: video feeds left, audio faders + trigger buttons right. Android/tablet app with fire buttons and OBS preview windows.
- [ ] **16. CDN viewership + integrated chat** — Sync with custom CDN for viewer stats and embedded chat window.
- [ ] **17. Remotion event animations** — Render-on-demand master event animation (logo + title) via Remotion MCP.
- [ ] **18. Wi-Fi Display integration** — Integrate `~/projects/WifiDisplay` (Rust streaming server + virtual display driver + Android client) into BroadcastBuddy for wireless display casting.
