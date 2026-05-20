# BroadcastBuddy Stream Deck Plugin

Fire BroadcastBuddy overlays from physical Elgato Stream Deck keys. The plugin
opens a WebSocket to BroadcastBuddy's command hub and sends the same
`{ type: 'command', action: '...' }` messages any WS client can send — BB
treats Stream Deck as just another `'streamdeck'` client.

## Actions

| Key | Action sent to BB | What it does |
| --- | --- | --- |
| Fire LT | `fireLT` | Fire the current lower third |
| Hide LT | `hideLT` | Hide the lower third |
| Toggle LT | `toggleLT` | Toggle the lower third on/off |
| Next | `nextTrigger` | Advance to the next trigger |
| Prev | `prevTrigger` | Go to the previous trigger |
| Next + Fire | `nextFull` | Advance and fire in one press |
| Toggle Ticker | `toggleTicker` | Toggle the ticker crawl |
| Up Next | `upNext` | Fire the UP NEXT lower third |
| That Was | `thatWas` | Fire the THAT WAS lower third |
| Toggle Grid | `toggleGrid` | Toggle the operator leveling grid (never on the live feed) |
| Slow Zoom (Wide) | `slowZoomWide` | OBS Move-Transition slow zoom on the Wide scene |
| Slow Zoom (Tight) | `slowZoomTight` | OBS Move-Transition slow zoom on the Tight scene |

These action strings match BroadcastBuddy's WS command handler in
`src/main/services/wsHub.ts`. If you add a key here, add the matching `case` in
that switch.

## Connecting to BroadcastBuddy

The plugin connects to `ws://<host>:<port>` — default **`localhost:19081`**
(BB's WebSocket hub; see `server.wsPort` in BB settings). Buttons show
`OFFLINE` until BroadcastBuddy is running and reachable.

To point the plugin at a BB instance on another machine, click any
BroadcastBuddy key in the Stream Deck app and set **BB Host** / **WS Port** in
the property inspector. These are global settings shared by every BB key.

## Build

The plugin source is TypeScript (Elgato Node SDK), bundled to
`com.broadcastbuddy.streamdeck.sdPlugin/bin/plugin.js` with rollup. It is **not**
part of the BroadcastBuddy electron-vite build — build it separately:

```bash
cd streamdeck-plugin
npm install
npm run build      # → com.broadcastbuddy.streamdeck.sdPlugin/bin/plugin.js
```

## Install

1. Build (above) so `bin/plugin.js` exists.
2. Copy the `com.broadcastbuddy.streamdeck.sdPlugin` folder into the Stream Deck
   plugins directory:
   - **Windows:** `%APPDATA%\Elgato\StreamDeck\Plugins\`
   - **macOS:** `~/Library/Application Support/com.elgato.StreamDeck/Plugins/`
3. Restart the Stream Deck app. The **BroadcastBuddy** category appears in the
   action list.
4. Drag actions onto keys. Set host/port in the property inspector if BB is on
   another machine.

(During development you can instead symlink the `.sdPlugin` folder and run
`npm run watch`, then restart the Stream Deck app to reload.)

## Note on packaging

This folder ships separately from the BroadcastBuddy installer. It is **not**
referenced in electron-vite inputs. If you want the `.sdPlugin` folder bundled
into the BB installer for operators, add it to `package.json` →
`build.extraResources` (optional — not done by default).
