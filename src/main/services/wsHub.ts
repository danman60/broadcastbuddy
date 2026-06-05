import { WebSocketServer, WebSocket } from 'ws'
import { BrowserWindow } from 'electron'
import {
  getOverlayState,
  fireLowerThird,
  hideLowerThird,
  nextTrigger,
  prevTrigger,
  nextTriggerFull,
  toggleAutoFire,
  showTicker,
  hideTicker,
  getPlaylistStatus,
  toggleGrid,
  fireUpNext,
  fireThatWas,
  toggleClock,
  toggleCounter,
  fireFeatureUpNext,
  fireFeatureThatWas,
  getStyling,
  updateStyling,
} from './overlay'
import * as slowZoom from './slowZoom'
import * as obs from './obsConnection'
import * as overlayPanels from './overlayPanels'
import { WsStateMessage, AnimationType } from '../../shared/types'
import { createLogger } from '../logger'

const logger = createLogger('wsHub')

// Lower-third entrance animations the tablet's `cycleTransition` advances
// through, in order. 'random' is excluded so cycling stays deterministic.
const CYCLE_ANIMATIONS: AnimationType[] = [
  'slide', 'fade', 'zoom', 'rise', 'typewriter', 'bounce', 'split', 'blur', 'sparkle',
]

let wss: WebSocketServer | null = null
const clients = new Map<WebSocket, string>()
let heartbeatInterval: NodeJS.Timeout | null = null

function buildStateMessage(): WsStateMessage {
  const playlist = getPlaylistStatus()
  return {
    type: 'state',
    overlay: getOverlayState(),
    playlist: {
      current: playlist.current,
      total: playlist.total,
      autoFire: playlist.autoFire,
      upNextTitle: playlist.upNext?.title || null,
      playedIds: playlist.playedIds,
      loopMode: playlist.loopMode,
    },
  }
}

export function broadcastState(): void {
  if (!wss) return
  const payload = JSON.stringify(buildStateMessage())
  for (const [ws] of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload)
    }
  }
}

// Shared toggle bodies — reused by both the flat BB commands (toggleLT etc.)
// and the tablet's CompSync-style `toggleOverlay` + `element` form, so the two
// entry points can never diverge.
function doToggleLT(): void {
  const state = getOverlayState()
  if (state.lowerThird.visible) hideLowerThird()
  else fireLowerThird()
}

// Advance the lower-third entrance animation to the next style in CYCLE_ANIMATIONS,
// wrapping around. Drives the tablet's transition button (BB has no separate
// "transition" concept — the lower-third animation IS the transition).
function doCycleTransition(): void {
  const current = getStyling().animation
  const idx = CYCLE_ANIMATIONS.indexOf(current)
  const next = CYCLE_ANIMATIONS[(idx + 1) % CYCLE_ANIMATIONS.length]
  updateStyling({ animation: next })
  logger.info(`cycleTransition: ${current} → ${next}`)
}

function handleCommand(action: string, data?: Record<string, unknown>): void {
  switch (action) {
    case 'fireLT':
      fireLowerThird()
      break
    case 'hideLT':
      hideLowerThird()
      break
    case 'toggleLT':
      doToggleLT()
      break
    case 'nextTrigger':
      nextTrigger()
      break
    case 'prevTrigger':
      prevTrigger()
      break
    case 'nextFull':
      nextTriggerFull()
      break
    case 'autoFireToggle':
      toggleAutoFire()
      break
    case 'toggleTicker': {
      const state = getOverlayState()
      if (state.ticker.visible) hideTicker()
      else showTicker(data?.text as string || 'Live broadcast')
      break
    }
    case 'toggleGrid':
      toggleGrid()
      break
    case 'toggleOverlayMode': {
      // Toggle the always-on-top Overlay Mode floating panels remotely (Stream
      // Deck / script / SSH) — the panels otherwise require a Tools-menu click,
      // which can't be driven over SSH. The main window is always the first
      // created window; toggle() shows/hides it as it closes/opens the panels.
      const mainWin = BrowserWindow.getAllWindows()[0]
      if (mainWin) overlayPanels.toggle(mainWin)
      break
    }
    case 'upNext':
      fireUpNext((data?.label as string) || 'UP NEXT')
      break
    case 'thatWas':
      fireThatWas((data?.label as string) || 'THAT WAS')
      break
    case 'slowZoomWide':
      // OBS Move-Transition slow zoom on the Wide scene. Fails soft (logged in
      // slowZoom) when OBS is disconnected or the named scenes/transition are
      // missing — the WS command never throws back to the client.
      void slowZoom.triggerWide().catch((err) => logger.warn(`slowZoomWide failed: ${err instanceof Error ? err.message : err}`))
      break
    case 'slowZoomTight':
      void slowZoom.triggerTight().catch((err) => logger.warn(`slowZoomTight failed: ${err instanceof Error ? err.message : err}`))
      break
    case 'toggleClock':
      toggleClock()
      break
    case 'toggleCounter':
      toggleCounter()
      break
    case 'featureUpNext':
      fireFeatureUpNext((data?.kicker as string) || 'UP NEXT')
      break
    case 'featureThatWas':
      fireFeatureThatWas((data?.kicker as string) || 'THAT WAS')
      break
    case 'toggleRecord':
      // OBS recording toggle. Fails soft when OBS is disconnected — never
      // throws back to the WS client.
      void obs.toggleRecording().catch((err) => logger.warn(`toggleRecord failed: ${err instanceof Error ? err.message : err}`))
      break
    case 'saveReplay':
      void obs.saveReplayBuffer().catch((err) => logger.warn(`saveReplay failed: ${err instanceof Error ? err.message : err}`))
      break
    case 'toggleStream':
      // Read current stream status, then start/stop. Fails soft.
      void obs.getStreamStatus()
        .then((status) => (status.streaming ? obs.stopStreaming() : obs.startStreaming()))
        .catch((err) => logger.warn(`toggleStream failed: ${err instanceof Error ? err.message : err}`))
      break
    case 'toggleOverlay': {
      // CompSync-style command from the CSController tablet. The tablet puts the
      // target `element` at the TOP LEVEL of the message; the dispatch site
      // forwards it into `data.element`. Route to the matching flat-command body.
      const element = data?.element as string | undefined
      switch (element) {
        case 'lowerThird':
          doToggleLT()
          break
        case 'counter':
          toggleCounter()
          break
        case 'clock':
          toggleClock()
          break
        default:
          logger.warn(`toggleOverlay: unknown element "${element}"`)
      }
      break
    }
    case 'cycleTransition':
      doCycleTransition()
      break
    case 'getStatus':
      // No-op — state is broadcast automatically
      break
    default:
      logger.warn(`Unknown command: ${action}`)
  }
  // Broadcast updated state after any command
  broadcastState()
}

export function start(port: number): void {
  // Bind 0.0.0.0 (not 127.0.0.1) so remote clients — the CSController tablet's
  // control WS and a remote OBS browser source — can reach the hub, not just
  // same-machine clients. Matches the overlay HTTP server (also 0.0.0.0).
  wss = new WebSocketServer({ port, host: '0.0.0.0' })

  wss.on('connection', (ws) => {
    (ws as unknown as { isAlive: boolean }).isAlive = true

    ws.on('pong', () => {
      (ws as unknown as { isAlive: boolean }).isAlive = true
    })

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())

        if (msg.type === 'identify') {
          clients.set(ws, msg.client)
          logger.info(`Client connected: ${msg.client}`)
          // Send full state immediately
          ws.send(JSON.stringify(buildStateMessage()))
        }

        if (msg.type === 'command') {
          // The CSController tablet puts `element` at the TOP LEVEL of the
          // message (not inside `data`), so merge it into the data object the
          // handler receives. Flat BB commands (toggleLT etc.) ignore it.
          handleCommand(msg.action, { ...msg.data, element: msg.element })
        }

        // Handle broadcast_package pushed from CC's pushToApp mutation
        if (msg.type === 'broadcast_package' && msg.data) {
          logger.info('Received broadcast package push from CC')
          const windows = BrowserWindow.getAllWindows()
          const win = windows.length > 0 ? windows[0] : null
          if (win) {
            // Forward to renderer — BroadcastPackagePanel listens for this
            // and auto-applies via ccApplyPackage
            win.webContents.send('cc:package-pushed', msg.data)
          }
        }
      } catch (err) {
        logger.error('Bad WS message:', err)
      }
    })

    ws.on('close', () => {
      const clientType = clients.get(ws) || 'unknown'
      clients.delete(ws)
      logger.info(`Client disconnected: ${clientType}`)
    })
  })

  // Heartbeat — ping every 30s, kill dead connections
  heartbeatInterval = setInterval(() => {
    if (!wss) return
    wss.clients.forEach((ws) => {
      const extWs = ws as unknown as { isAlive: boolean }
      if (!extWs.isAlive) return ws.terminate()
      extWs.isAlive = false
      ws.ping()
    })
  }, 30000)

  logger.info(`WebSocket hub listening on ws://0.0.0.0:${port}`)
}

export function stop(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval)
    heartbeatInterval = null
  }
  if (wss) {
    wss.close()
    wss = null
    logger.info('WebSocket hub stopped')
  }
  clients.clear()
}
