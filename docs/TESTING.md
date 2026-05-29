# BroadcastBuddy — Test Suite

Headless Playwright + Electron suite. **211 tests across 23 specs**, all green as of 2026-05-29.

## Run it

```bash
cd ~/projects/BroadcastBuddy
xvfb-run -a npx playwright test --workers=1
```

- **`xvfb-run` is required** — Electron needs a display; the host has none.
- **`--workers=1` is required** — every spec launches its own Electron instance that binds the fixed overlay ports (HTTP **19080** / WS **19081**). Parallel workers collide on those ports. Do not remove this flag.
- Single spec: `xvfb-run -a npx playwright test <name> --workers=1` (e.g. `overlay-statemachine`).
- tsc (separate, composite — run per config; clear stale buildinfo if errors reappear):
  `rm -f out/**/*.tsbuildinfo && npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json`

## How the headless overlay tests work

The OBS browser source is a passive HTML page served at `GET /overlay` that opens a WebSocket to the hub and renders pushed state. Several specs use a **dual-page** pattern: launch Electron (the control surface), launch a real Chromium tab pointed at `http://127.0.0.1:19080/overlay`, drive state from the Electron window via `window.api.*` (IPC), and assert the rendered DOM in the Chromium tab. This exercises the real path IPC → state → WS broadcast → browser-source `applyState()` → DOM, with no OBS.

## Coverage map (specs)

| Spec | Covers |
|---|---|
| `app.spec` | launch, header, panels, core IPC, HTTP + WS servers |
| `overlay-statemachine` | browser-source state machine + WS command path (incl. plugin commands, OBS fail-soft) |
| `browser-source-behaviors` | OBS-side inline JS: ticker duration math, clock 12h/24h, counter pop-in, typewriter, feature-card entrance/exit |
| `browser-source-styling` | styling → CSS custom props + bg/shadow/glow classes + label chip |
| `triggers-ui` | trigger CRUD/reorder/select via UI + IPC |
| `session-roundtrip` | session save/load round-trip (atomic write) |
| `import-flow` | document import (TXT) + ExtractionResult shape |
| `styling-presets` | presets + template gallery apply + styling round-trip |
| `playlist` | next/prev, loop/ping-pong, auto-fire, up-next/that-was |
| `resilience-ui` | recovery banner, startup, event log, system panel, settings sections |
| `waves` | wave 5-8 IPC (record/slow-zoom/transition/clock/counter/feature/day-checklist/chat/events/recovery/startup/backup), stream control, system monitor, streamdeck status, PDF parse |
| `cc-integration` | ccApplyPackage (trigger conversion, streaming, accent, overlayConfig) — no live CC |
| `wshub-timers` | hub full-state-on-identify, multi-client broadcast, server-side auto-hide timer |
| `obs-connection` | connect-fail / disconnect / timecode / push-key fail-soft |
| `brand-scraper` | colour/font/logo extraction vs local fixture + ReDoS regression |
| `starting-soon-media` / `starting-soon-core` | pre-show media stack + countdown/title/colors |
| `logo-ticker` | company/client logos + ticker state + DOM |
| `animation-panel` | every animation type/duration/easing → styling + #lt class |
| `daychecklist-ui` | day-checklist IPC lifecycle + component mount |
| `edge-cases` / `misc-ipc` | counter clamp, event-log limit/filter, ticker merge, playlist reset, notes, window resize |

## Out of scope (cannot be tested headless — operator's job on FIRMAMENT)

Live OBS (record/audio-meters/slow-zoom/stream/replay against real obs-websocket), the global hotkeys (need a real desktop), the Stream Deck device, tablet WiFi display, and large-file R2 multipart upload. The suite verifies these paths **fail soft** when their dependency is absent; it cannot verify the success path without the hardware.

## Conventions

- Each spec cleans up the state it creates (`triggerClearAll`, delete notes, etc.). Note: `dayChecklist` persists to `userData`, so its tests are written run-order-independent.
- OBS-dependent IPC is asserted to FAIL SOFT (structured error, no throw), not to succeed.
- Prefer IPC-level assertions over fragile DOM selectors; use real class/text selectors confirmed against the component source.
