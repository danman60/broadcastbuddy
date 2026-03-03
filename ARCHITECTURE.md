# Electron → OBS Overlay Architecture (Reusable Pattern)

Extracted from **CompSyncElectronApp**. Use this as a blueprint for any Electron app that controls OBS browser source overlays.

---

## Core Concept

The Electron app acts as a **control surface**. OBS displays a **browser source** that is entirely passive — it never polls, never decides what to show. All logic lives in Electron. The browser source just renders whatever state is pushed to it.

```
┌──────────────────────────────────────────────┐
│            Electron App (Main Process)        │
│                                               │
│  ┌────────────┐   ┌────────────────────────┐ │
│  │ Express     │   │ WebSocket Hub          │ │
│  │ :9876       │   │ :9877                  │ │
│  │ Serves HTML │   │ Broadcasts state JSON  │ │
│  └──────┬─────┘   └──────────┬─────────────┘ │
│         │                    │                │
│  ┌──────┴────────────────────┴──────────────┐│
│  │        Overlay State Machine             ││
│  │  { lowerThird: { visible, text, ... } }  ││
│  └──────────────────────────────────────────┘│
│         ↑                                     │
│  ┌──────┴──────────────────────────────────┐ │
│  │    IPC Handlers (from renderer UI)       │ │
│  └──────────────────────────────────────────┘│
└──────────────────────────────────────────────┘
        ↕ IPC                    ↓ WS push
┌──────────────┐        ┌──────────────────┐
│ Renderer UI  │        │ OBS Browser Src  │
│ (React)      │        │ (passive HTML)   │
│ Fire / Hide  │        │ Renders state    │
│ Edit fields  │        │ CSS transitions  │
└──────────────┘        └──────────────────┘
```

---

## The Three Servers

Every overlay Electron app runs **three things** on localhost:

### 1. Express HTTP Server (port 9876)

Serves the overlay HTML page that OBS loads as a browser source.

```typescript
// src/main/services/overlay.ts
import express from 'express'

const app = express()

// OBS hits this URL as a Browser Source
app.get('/overlay', (_req, res) => {
  res.type('html').send(buildOverlayHTML())
})

// Optional: JSON endpoint for debugging
app.get('/current', (_req, res) => {
  res.json(getOverlayState())
})

app.listen(9876, '127.0.0.1')
```

**The HTML is fully self-contained** — all CSS and JS are inlined into the response. No external files, no CDN links. This guarantees OBS can render it with zero network dependencies.

### 2. WebSocket Hub (port 9877)

Pushes state changes to all connected clients (overlay browser source, Stream Deck plugin, etc).

```typescript
// src/main/services/wsHub.ts
import { WebSocketServer, WebSocket } from 'ws'

const wss = new WebSocketServer({ port: 9877, host: '127.0.0.1' })
const clients = new Map<WebSocket, string>()  // ws → client type

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString())

    if (msg.type === 'identify') {
      clients.set(ws, msg.client)  // 'overlay' or 'streamdeck'
      // Send full state immediately on connect
      ws.send(JSON.stringify(buildStateMessage()))
    }

    if (msg.type === 'command') {
      handleCommand(msg.action, msg.element)
    }
  })

  ws.on('close', () => clients.delete(ws))
})

// Called whenever overlay state changes
export function broadcastState(): void {
  const payload = JSON.stringify(buildStateMessage())
  for (const [ws] of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload)
    }
  }
}
```

**Heartbeat** — ping every 30s, terminate dead connections:

```typescript
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate()
    ws.isAlive = false
    ws.ping()
  })
}, 30000)

wss.on('connection', (ws) => {
  ws.isAlive = true
  ws.on('pong', () => { ws.isAlive = true })
})
```

### 3. Electron Main Process

Orchestrates everything. Holds the overlay state, handles IPC from the renderer, and triggers broadcasts.

---

## Overlay State Machine

The single source of truth. A plain object that represents what the overlay should show right now.

```typescript
// src/main/services/overlay.ts

interface OverlayState {
  lowerThird: {
    visible: boolean
    entryNumber: string
    routineTitle: string
    dancers: string
    studioName: string
    category: string
    animation: 'slide' | 'fade' | 'zoom' | 'rise' | 'random'
    autoHideSeconds: number  // 0 = manual hide only
  }
  // Add more elements as needed:
  counter: { visible: boolean; current: number; total: number }
  clock: { visible: boolean }
  logo: { visible: boolean; url: string }
}

let overlayState: OverlayState = { /* defaults */ }
let onChangeCallback: (() => void) | null = null

// Called by wsHub to register the broadcast trigger
export function setOnStateChange(cb: () => void): void {
  onChangeCallback = cb
}

function notifyChange(): void {
  onChangeCallback?.()
}
```

**Key principle:** Every mutation to `overlayState` must call `notifyChange()` at the end. This triggers `wsHub.broadcastState()` which pushes the new state to the browser source.

---

## Trigger Flows

### Manual Fire (Button Click)

```
Renderer UI → IPC → Main Process → State Mutation → WS Broadcast → Browser Source
```

```typescript
// Renderer: user clicks "Fire"
window.api.overlayFireLT()

// Preload: bridges IPC
contextBridge.exposeInMainWorld('api', {
  overlayFireLT: () => ipcRenderer.invoke('overlay:fire-lt'),
  overlayHideLT: () => ipcRenderer.invoke('overlay:hide-lt'),
  overlayToggle: (el: string) => ipcRenderer.invoke('overlay:toggle', el),
})

// Main: IPC handler
ipcMain.handle('overlay:fire-lt', () => {
  fireLowerThird()
})

// Main: state mutation
let autoHideTimer: NodeJS.Timeout | null = null

export function fireLowerThird(): void {
  overlayState.lowerThird.visible = true

  // Auto-hide after N seconds
  if (autoHideTimer) clearTimeout(autoHideTimer)
  const seconds = overlayState.lowerThird.autoHideSeconds
  if (seconds > 0) {
    autoHideTimer = setTimeout(() => {
      hideLowerThird()
    }, seconds * 1000)
  }

  notifyChange()  // → broadcastState() → browser source updates
}

export function hideLowerThird(): void {
  overlayState.lowerThird.visible = false
  if (autoHideTimer) { clearTimeout(autoHideTimer); autoHideTimer = null }
  notifyChange()
}
```

### Auto-Fire (Timed Trigger After Event)

Used when advancing to the next routine — fire the lower third automatically after a delay.

```typescript
let autoFireEnabled = false

export function nextRoutine(): void {
  advanceToNextEntry()
  updateOverlayData(currentRoutine)  // populate text fields

  if (autoFireEnabled) {
    setTimeout(() => fireLowerThird(), 3000)  // 3s delay
  }
}
```

### External Trigger (Stream Deck / WebSocket Command)

Any WebSocket client can send a command:

```typescript
// wsHub.ts — handle incoming commands
function handleCommand(action: string, element?: string): void {
  switch (action) {
    case 'fireLT':    fireLowerThird(); break
    case 'hideLT':    hideLowerThird(); break
    case 'toggleLT':  toggleElement('lowerThird'); break
    case 'nextFull':  recording.nextFull(); break
    // ...
  }
}
```

---

## Browser Source (OBS Side)

The overlay HTML served by Express. This is the **entire client** — no build step, no framework, just vanilla HTML/CSS/JS inlined into a single response.

### HTML Structure

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 1920px;
      height: 1080px;
      background: transparent;  /* OBS chroma-keys this */
      overflow: hidden;
      font-family: 'Segoe UI', sans-serif;
    }

    /* Lower Third — bottom left */
    .lower-third {
      position: absolute;
      bottom: 80px;
      left: 60px;
      opacity: 0;
      transition: opacity 0.5s ease, transform 0.5s ease;
    }
    .lower-third.visible { opacity: 1; }

    /* Animation variants */
    .lower-third.anim-slide { transform: translateX(-100px); }
    .lower-third.anim-slide.visible { transform: translateX(0); }

    .lower-third.anim-zoom { transform: scale(0.5); }
    .lower-third.anim-zoom.visible { transform: scale(1); }

    .lower-third.anim-fade { transform: none; }
    .lower-third.anim-fade.visible { opacity: 1; }

    .lower-third.anim-rise { transform: translateY(40px); }
    .lower-third.anim-rise.visible { transform: translateY(0); }
  </style>
</head>
<body>
  <div id="lt" class="lower-third">
    <div class="lt-title" id="lt-title"></div>
    <div class="lt-subtitle" id="lt-subtitle"></div>
  </div>

  <script>
    const WS_URL = 'ws://127.0.0.1:9877'
    let ws = null
    let reconnectTimer = null

    function connect() {
      ws = new WebSocket(WS_URL)

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'identify', client: 'overlay' }))
        if (reconnectTimer) { clearInterval(reconnectTimer); reconnectTimer = null }
      }

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.type === 'state') applyState(msg)
      }

      ws.onclose = () => {
        if (!reconnectTimer) {
          reconnectTimer = setInterval(connect, 3000)
        }
      }
    }

    function applyState(msg) {
      const lt = msg.overlay.lowerThird
      const el = document.getElementById('lt')

      // Update text content
      document.getElementById('lt-title').textContent = lt.routineTitle || ''
      document.getElementById('lt-subtitle').textContent = lt.dancers || ''

      // Set animation class
      el.className = 'lower-third'
      if (lt.animation) el.classList.add('anim-' + lt.animation)

      // Toggle visibility (CSS transition handles animation)
      if (lt.visible) {
        requestAnimationFrame(() => el.classList.add('visible'))
      }
    }

    connect()
  </script>
</body>
</html>
```

### OBS Setup

1. **Add Browser Source** → URL: `http://127.0.0.1:9876/overlay`
2. **Width:** 1920, **Height:** 1080
3. **Custom CSS:** (leave empty or minimal)
4. **Shutdown source when not visible:** ON
5. **Refresh browser when scene becomes active:** ON

The browser source sits as a layer above the camera/content in OBS. Transparent background means only the lower third elements are visible.

---

## IPC Channel Convention

Use a namespaced string enum to keep channels organized:

```typescript
// src/shared/types.ts
export const IPC = {
  // Overlay control
  OVERLAY_FIRE_LT:     'overlay:fire-lt',
  OVERLAY_HIDE_LT:     'overlay:hide-lt',
  OVERLAY_TOGGLE:      'overlay:toggle',
  OVERLAY_GET_STATE:   'overlay:get-state',
  OVERLAY_AUTO_FIRE:   'overlay:auto-fire-toggle',

  // Settings
  SETTINGS_GET:        'settings:get',
  SETTINGS_SET:        'settings:set',

  // State sync (main → renderer)
  STATE_UPDATE:        'state:update',
  OVERLAY_STATE:       'overlay:state-update',
} as const
```

**Pattern:** `ipcMain.handle()` for request/response, `mainWindow.webContents.send()` for push events to renderer.

---

## Preload Security

Context isolation is ON, nodeIntegration is OFF. The preload script exposes a minimal API:

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Overlay
  overlayFireLT: () => ipcRenderer.invoke(IPC.OVERLAY_FIRE_LT),
  overlayHideLT: () => ipcRenderer.invoke(IPC.OVERLAY_HIDE_LT),
  overlayToggle: (el: string) => ipcRenderer.invoke(IPC.OVERLAY_TOGGLE, el),
  overlayGetState: () => ipcRenderer.invoke(IPC.OVERLAY_GET_STATE),
  overlayAutoFireToggle: () => ipcRenderer.invoke(IPC.OVERLAY_AUTO_FIRE),

  // Settings
  settingsGet: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  settingsSet: (k: string, v: unknown) => ipcRenderer.invoke(IPC.SETTINGS_SET, k, v),

  // Event listeners (main → renderer)
  on: (channel: string, cb: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => cb(...args))
  },
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel)
  },
})
```

---

## Renderer State Management

Zustand store in the renderer syncs with main process via IPC events:

```typescript
// src/renderer/store/useStore.ts
import { create } from 'zustand'

interface AppStore {
  overlayState: OverlayState | null
  settings: AppSettings | null
  setOverlayState: (s: OverlayState) => void
  setSettings: (s: AppSettings) => void
}

export const useStore = create<AppStore>((set) => ({
  overlayState: null,
  settings: null,
  setOverlayState: (s) => set({ overlayState: s }),
  setSettings: (s) => set({ settings: s }),
}))

// In main renderer entry:
window.api.on('overlay:state-update', (state) => {
  useStore.getState().setOverlayState(state)
})
```

---

## Settings Persistence

Use `electron-store` for settings that survive app restarts:

```typescript
// src/main/services/settings.ts
import Store from 'electron-store'

const store = new Store<AppSettings>({
  defaults: {
    overlay: {
      autoHideSeconds: 8,
      animation: 'slide',
      // field visibility toggles, colors, fonts, etc.
    },
    server: {
      httpPort: 9876,
      wsPort: 9877,
    },
  },
})

export function get<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return store.get(key)
}

export function set<K extends keyof AppSettings>(key: K, val: AppSettings[K]): void {
  store.set(key, val)
}
```

---

## Startup Sequence

Order matters. In `src/main/index.ts`:

```typescript
app.whenReady().then(async () => {
  // 1. Load settings
  const settings = settingsService.get('overlay')

  // 2. Initialize overlay state with defaults from settings
  overlay.init(settings)

  // 3. Start HTTP server (overlay page)
  overlay.startServer(settings.server.httpPort)

  // 4. Start WebSocket hub
  wsHub.start(settings.server.wsPort)

  // 5. Wire the state change callback
  overlay.setOnStateChange(() => wsHub.broadcastState())

  // 6. Create the Electron window (renderer)
  createWindow()

  // 7. Register IPC handlers
  registerIpcHandlers()
})
```

**Shutdown:**

```typescript
app.on('before-quit', () => {
  wsHub.stop()
  overlay.stopServer()
})
```

---

## WebSocket Message Protocol

### Client → Hub

```typescript
// Identify on connect
{ type: 'identify', client: 'overlay' | 'streamdeck' | 'external' }

// Trigger an action
{ type: 'command', action: string, element?: string, data?: Record<string, unknown> }
```

### Hub → Clients (Broadcast)

```typescript
{
  type: 'state',
  overlay: OverlayState,    // Full overlay state
  // Add app-specific fields:
  // recording: { active, elapsed },
  // currentEntry: { ... },
}
```

**Design rule:** Always broadcast the FULL state, not deltas. The overlay applies the complete state on every message. This keeps the browser source stateless and eliminates sync bugs.

---

## Animation System

### CSS-Driven

All animations use CSS transitions + class toggling. No JavaScript animation libraries needed.

```css
/* Base: invisible */
.lower-third {
  opacity: 0;
  transition: opacity 0.5s ease, transform 0.5s ease;
}

/* Visible: fully shown */
.lower-third.visible {
  opacity: 1;
}

/* Animation variant modifiers (set BEFORE adding .visible) */
.lower-third.anim-slide        { transform: translateX(-100px); }
.lower-third.anim-slide.visible { transform: translateX(0); }

.lower-third.anim-zoom         { transform: scale(0.5); }
.lower-third.anim-zoom.visible  { transform: scale(1); }
```

### Triggering

```javascript
// In applyState():
el.className = 'lower-third'                     // Reset
el.classList.add('anim-' + animation)             // Set variant
requestAnimationFrame(() => {
  el.classList.add('visible')                     // Trigger transition
})
```

**`requestAnimationFrame` is critical** — without it, the browser may batch the class additions and skip the transition.

### Random Animation

```typescript
const ANIMATIONS = ['slide', 'fade', 'zoom', 'rise']

function pickAnimation(setting: string): string {
  if (setting === 'random') {
    return ANIMATIONS[Math.floor(Math.random() * ANIMATIONS.length)]
  }
  return setting
}
```

---

## Auto-Hide Timer Pattern

```typescript
let autoHideTimer: NodeJS.Timeout | null = null

export function fireLowerThird(): void {
  overlayState.lowerThird.visible = true

  // Clear any existing timer
  if (autoHideTimer) clearTimeout(autoHideTimer)

  const seconds = settings.overlay.autoHideSeconds
  if (seconds > 0) {
    autoHideTimer = setTimeout(() => {
      overlayState.lowerThird.visible = false
      autoHideTimer = null
      notifyChange()
    }, seconds * 1000)
  }

  notifyChange()
}

export function hideLowerThird(): void {
  overlayState.lowerThird.visible = false
  if (autoHideTimer) { clearTimeout(autoHideTimer); autoHideTimer = null }
  notifyChange()
}
```

---

## Stream Deck Integration (Optional)

A Stream Deck plugin connects as another WebSocket client:

```typescript
// streamdeck-plugin/src/connection.ts
const ws = new WebSocket('ws://localhost:9877')

ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'identify', client: 'streamdeck' }))
}

// Send commands
export function sendCommand(action: string): void {
  ws.send(JSON.stringify({ type: 'command', action }))
}

// Receive state for button visuals
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.type === 'state') updateButtonVisuals(msg)
}
```

The hub treats Stream Deck like any other client — same broadcast, same protocol.

---

## Tech Stack Reference

```json
{
  "dependencies": {
    "electron": "^33.x",
    "express": "^4.21",
    "ws": "^8.19",
    "electron-store": "^6.0",
    "zustand": "^4.5",
    "react": "^18.x",
    "react-dom": "^18.x"
  },
  "devDependencies": {
    "electron-vite": "latest",
    "electron-builder": "latest",
    "typescript": "^5.x",
    "@types/express": "latest",
    "@types/ws": "latest"
  }
}
```

**Build tooling:** `electron-vite` for dev + build, `electron-builder` for packaging (NSIS installer on Windows).

---

## File Structure Template

```
src/
├── main/
│   ├── index.ts              # App lifecycle, startup sequence
│   ├── ipc.ts                # All ipcMain.handle() registrations
│   └── services/
│       ├── overlay.ts        # State machine + Express server
│       ├── wsHub.ts          # WebSocket broadcast hub
│       └── settings.ts       # electron-store persistence
├── preload/
│   └── index.ts              # contextBridge API
├── renderer/
│   ├── main.tsx              # React entry, IPC listeners
│   ├── App.tsx               # Root component
│   ├── store/
│   │   └── useStore.ts       # Zustand store
│   └── components/
│       ├── OverlayControls.tsx   # Fire/Hide/Toggle buttons
│       └── OverlaySettings.tsx   # Animation, timing, field config
└── shared/
    └── types.ts              # IPC channels, OverlayState interface
```

---

## Summary: What Makes This Work

1. **Express serves a self-contained HTML page** — OBS loads it as a browser source
2. **WebSocket hub pushes full state** — overlay never polls, never decides
3. **Overlay is stateless** — it applies whatever state arrives, no local logic
4. **CSS transitions handle all animation** — no JS animation needed
5. **Single state object** — one mutation function, one broadcast, one apply
6. **Auto-hide is a server-side timer** — not in the browser source
7. **Any client can trigger** — UI buttons, Stream Deck, external scripts via WebSocket
