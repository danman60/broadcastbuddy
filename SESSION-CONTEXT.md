# BroadcastBuddy — Session Context

## Origin

Extracted from **CompSyncElectronApp** (`~/projects/CompSyncElectronApp/`). That app is a full competition portal with recording pipelines, FFmpeg encoding, CSV imports, and more. BroadcastBuddy strips it down to just the overlay control pattern.

## CompSync Architecture (Reference)

The parts of CompSync relevant to BroadcastBuddy:

### Services That Matter
- `src/main/services/overlay.ts` — Express server (port 9876) + overlay state machine + auto-hide timers
- `src/main/services/wsHub.ts` — WebSocket hub (port 9877) + client tracking + heartbeat
- `src/main/services/settings.ts` — electron-store persistence
- `src/main/ipc.ts` — All IPC handler registrations (~450 lines)
- `src/preload/index.ts` — Context bridge API

### Services to SKIP (not needed for BroadcastBuddy)
- `recording.ts` — OBS recording pipeline, file handling
- `ffmpeg.ts` — Audio splitting, encoding queue
- `state.ts` — Competition/routine data tree (CSV-based)
- `obs.ts` — OBS WebSocket connection (obs-websocket-js) for recording control
- `hotkeys.ts` — Global keyboard shortcuts

### CompSync Overlay Elements
1. **Counter** (top-right) — entry number, current/total
2. **Clock** (below counter) — live time
3. **Logo** (top-left) — studio/competition logo
4. **Lower Third** (bottom-left) — entry #, title, dancers, studio, category

### CompSync Overlay Settings
```typescript
{
  autoHideSeconds: 8,
  animation: 'random' | 'slide' | 'zoom' | 'fade' | 'rise' | 'sparkle',
  logoUrl: '',
  defaultCounter: true,
  defaultClock: false,
  defaultLogo: true,
  showEntryNumber: true,
  showRoutineTitle: true,
  showDancers: true,
  showStudioName: true,
  showCategory: true,
}
```

### CompSync Trigger Paths
1. **Manual** — UI button or Stream Deck fires `overlay:fire-lt` IPC
2. **Auto-fire** — `scheduleAutoFire()` fires 3s after `next()` if toggle is ON
3. **nextFull()** — 5s hardcoded delay after recording start

### CompSync Stream Deck Plugin
- Location: `CompSyncElectronApp/streamdeck-plugin/`
- Actions: NextFull, NextRoutine, Prev, Skip, Record, Stream, SaveReplay, overlay toggles
- Connects as WebSocket client to port 9877
- Renders live SVG on buttons based on state broadcasts

## BroadcastBuddy Scope

### What to Build
- Electron control UI for managing lower third text, styling, and triggers
- Express server serving self-contained overlay HTML
- WebSocket hub for state broadcast
- CSS animation system (slide, fade, zoom, rise, random)
- Auto-hide timer with configurable duration
- Settings persistence (electron-store)
- Field-level visibility toggles

### What NOT to Build (initially)
- OBS recording/streaming control
- FFmpeg encoding pipeline
- CSV/data import
- Stream Deck plugin (add later)
- Multiple overlay element types (start with lower third only)

## Key Dependencies

```json
{
  "electron": "^33.x",
  "express": "^4.21",
  "ws": "^8.19",
  "electron-store": "^6.0",
  "zustand": "^4.5",
  "react": "^18.x",
  "react-dom": "^18.x",
  "electron-vite": "latest",
  "electron-builder": "latest",
  "typescript": "^5.x"
}
```

## File Structure Target

```
BroadcastBuddy/
├── CLAUDE.md
├── ARCHITECTURE.md          # Reusable overlay pattern doc
├── SESSION-CONTEXT.md       # This file
├── package.json
├── electron.vite.config.ts
├── tsconfig.json
├── src/
│   ├── main/
│   │   ├── index.ts
│   │   ├── ipc.ts
│   │   └── services/
│   │       ├── overlay.ts       # State + Express server
│   │       ├── wsHub.ts         # WebSocket broadcast
│   │       └── settings.ts      # electron-store
│   ├── preload/
│   │   └── index.ts
│   ├── renderer/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── store/
│   │   │   └── useStore.ts
│   │   └── components/
│   │       ├── OverlayControls.tsx
│   │       └── OverlaySettings.tsx
│   └── shared/
│       └── types.ts
└── resources/
    └── icon.png
```
