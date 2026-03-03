# BroadcastBuddy

## What This Is

Electron app for controlling OBS lower third overlays. The Electron UI is the control surface — OBS displays a passive browser source that renders whatever state is pushed to it via WebSocket.

## Architecture Reference

See `ARCHITECTURE.md` for the full reusable pattern extracted from CompSyncElectronApp.

## Tech Stack

- **Electron 33** + TypeScript + React 18 + Zustand
- **Express** (port 9876) — serves overlay HTML to OBS browser source
- **ws** (port 9877) — WebSocket hub broadcasting state
- **electron-store** — persistent settings
- **electron-vite** — build tooling
- **electron-builder** — packaging (NSIS installer)

## Key Patterns

- Overlay state lives in main process only
- Browser source is stateless — full state pushed on every change
- CSS transitions handle all animation (no JS animation libs)
- Auto-hide timers run server-side, not in the browser source
- Any WebSocket client can trigger overlays (UI, Stream Deck, scripts)

## Git

- Branch: `main`
- Author: `danieljohnabrahamson@gmail.com`
- Push to main after commits
