import { WebSocketServer, WebSocket } from 'ws'
import { BrowserWindow } from 'electron'
import {
  getOverlayState,
  fireLowerThird,
  hideLowerThird,
  nextTrigger,
  prevTrigger,
  nextRoutine,
  prevRoutine,
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
  applyCurrentRoutineFraming,
} from './overlay'
import * as slowZoom from './slowZoom'
import * as obs from './obsConnection'
import * as overlayPanels from './overlayPanels'
import * as settings from './settings'
import { goHomeViaCamera, setCameraAiEnable, recallCameraPreset, sweepBetweenPresets, slowZoomPush, setActiveCamera, nudgeCamera, zoomCameraVelocity, abortCameraMoves, stopAllCameraMotionFor, getCameraActivity, setOnCameraActivityChanged, startBounce, stopBounce, isBounceRunning, getActiveCameraId, startSweepLoop } from './cameraDirector'
import { SWEEP_DEFAULT_MS, SLOW_ZOOM_DEFAULT_MS, SLOW_ZOOM_IN_FACTOR, TABLET_NUDGE_SPEED } from '../../shared/cameraMoves'
import { pttDown as voicePttDown, pttUp as voicePttUp } from './voiceDirector'
import { toggleRecording as shotRecordToggle, replayMove as shotReplay, cancelReplay as shotCancelReplay, getState as getShotState, setOnShotStateChanged } from './shotRecorder'
import { WsStateMessage, AnimationType } from '../../shared/types'
import { createLogger } from '../logger'
import { recordEvent } from './events'

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
  const shot = getShotState()
  const activity = getCameraActivity()
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
    camera: {
      activeCam: activity.activeCam,
      recording: shot.recording,
      replayingMoveId: shot.replayingMoveId,
      sweepRunning: activity.sweepRunning,
      bounceRunning: activity.bounceRunning,
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
    case 'nextRoutine':
      nextRoutine()
      break
    case 'prevRoutine':
      prevRoutine()
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
    // Camera deck buttons mirror the in-app Camera panel EXACTLY — same functions,
    // no parallel logic. cameraWide == the "Go Wide / Panic" hotkey (goHomeViaCamera).
    // cameraAuto/cameraManual == the dashboard AUTO/MANUAL toggle (AI enable + persist
    // cameraAutoMode + apply-current / go-wide). All no-op unless a camera host is set.
    case 'cameraWide':
      goHomeViaCamera()
      break
    case 'cameraAuto':
      setCameraAiEnable(true)
      settings.set('cameraAutoMode', true)
      applyCurrentRoutineFraming()
      break
    case 'cameraManual':
      setCameraAiEnable(false)
      settings.set('cameraAutoMode', false)
      goHomeViaCamera()
      break
    case 'cameraPreset': {
      // Camera position hotkey: recall a saved OBSBOT preset pose (same path as the
      // in-app preset grid). data.id = preset slot 1-8. No-op unless a camera host is set.
      const id = Number(data?.id)
      if (Number.isInteger(id) && id >= 1 && id <= 254) recallCameraPreset(id)
      break
    }
    case 'cameraSweep': {
      // Custom choreographed move: snap to preset `from`, slow-pan to preset `to`
      // over `ms` (default 6s). Audience Sweep = 2->3; Stage Sweep = 4->5.
      // Optional `waypoints` (array of preset ids) turns the move into a paced
      // multi-hop glide through those presets — the slow-reposition primitive.
      const from = Number(data?.from)
      const to = Number(data?.to)
      const ms = Number(data?.ms) > 0 ? Number(data?.ms) : SWEEP_DEFAULT_MS
      const rawWaypoints = data?.waypoints
      const waypoints = Array.isArray(rawWaypoints)
        ? rawWaypoints.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 254)
        : undefined
      if (Number.isInteger(from) && Number.isInteger(to)) {
        sweepBetweenPresets(from, to, ms, waypoints && waypoints.length > 0 ? waypoints : undefined)
      }
      break
    }
    case 'cameraStop': {
      // PANIC STOP — halt everything camera-motion on BOTH PTZs: abort in-flight
      // sweep/glide legs, kill bounce programs, cancel a running shot replay
      // (which also stops its cameras), cancel slow zooms, stop gimbal + zoom
      // velocity. Deck/tablet/script safe-button. No-op per camera without a host.
      abortCameraMoves()
      stopBounce(1)
      stopBounce(2)
      shotCancelReplay()
      stopAllCameraMotionFor(1)
      stopAllCameraMotionFor(2)
      break
    }
    case 'cameraLoop': {
      // ENDLESS preset ping-pong toggle — {from, to, ms?, waypoints?} starts the
      // unattended A↔B loop; {on:false} or a repeat press while a move program
      // is running stops it (abort generation).
      if (data?.on === false || getCameraActivity().sweepRunning) {
        abortCameraMoves()
        break
      }
      const from = Number(data?.from)
      const to = Number(data?.to)
      const ms = Number(data?.ms) > 0 ? Number(data?.ms) : SWEEP_DEFAULT_MS
      const rawWp = data?.waypoints
      const wp = Array.isArray(rawWp)
        ? rawWp.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 254)
        : undefined
      if (Number.isInteger(from) && Number.isInteger(to)) startSweepLoop(from, to, ms, wp)
      break
    }
    case 'cameraBounce': {
      // BOUNCE program toggle — continuous smooth velocity ping-pong (auto-pan).
      // {on:false} or a repeat press while running stops it; otherwise
      // {camera?, preset?, yaw?, pitch?, legSec?, easeSec?} starts one on the
      // active (or given) camera. All params optional with slow-pan defaults.
      const cam: 1 | 2 = Number(data?.camera) === 2 ? 2 : Number(data?.camera) === 1 ? 1 : getActiveCameraId()
      if (data?.on === false || isBounceRunning()) {
        stopBounce(1)
        stopBounce(2)
        break
      }
      startBounce({
        camera: cam,
        preset: Number.isInteger(Number(data?.preset)) && Number(data?.preset) >= 1 ? Number(data?.preset) : undefined,
        yaw: Number.isFinite(Number(data?.yaw)) && Number(data?.yaw) !== 0 ? Number(data?.yaw) : 8,
        pitch: Number.isFinite(Number(data?.pitch)) ? Number(data?.pitch) : 0,
        legSec: Number(data?.legSec) > 0 ? Number(data?.legSec) : 15,
        easeSec: Number(data?.easeSec) > 0 ? Number(data?.easeSec) : undefined,
      })
      break
    }
    case 'cameraSelect': {
      // Multi-cam: choose which PTZ (1|2) the camera controls/Xbox/deck drive. All
      // subsequent camera commands route to this active camera. No-op for bad ids.
      const id = Number(data?.id)
      if (id === 1 || id === 2) setActiveCamera(id)
      break
    }
    case 'cameraSlowZoom': {
      // PTZ optical slow PUSH from current zoom over `ms` (default 10s), keeping
      // any AI tracking active. Closed-loop (zoom has read-back). Second press
      // cancels an in-flight push. No-op unless a camera host is set.
      const ms = Number(data?.ms) > 0 ? Number(data?.ms) : SLOW_ZOOM_DEFAULT_MS
      const factor = Number(data?.factor) > 1 ? Number(data?.factor) : SLOW_ZOOM_IN_FACTOR
      slowZoomPush(ms, factor)
      break
    }
    case 'cameraNudge': {
      // Live PTZ pad from the tablet popup. data.dir = up/down/left/right,
      // data.stop = release-to-halt (press = velocity move, release = stop).
      // Drives the ACTIVE camera via the same path as the in-app joystick.
      // No-op unless a camera host is set. gimbal speed 1-100 (default 40).
      const dir = data?.dir
      const stop = data?.stop === true
      const speed = Number(data?.speed) > 0 ? Number(data?.speed) : TABLET_NUDGE_SPEED
      if (dir === 'up' || dir === 'down' || dir === 'left' || dir === 'right') {
        nudgeCamera(dir, speed, stop)
      }
      break
    }
    case 'cameraZoom': {
      // Hold-to-zoom from the tablet popup. data.dir = in/out, data.stop = release.
      // Active-camera zoom velocity (0-10, default 5). No-op unless a host is set.
      const dir = data?.dir === 'out' ? 'out' : 'in'
      const stop = data?.stop === true
      const speed = Number(data?.speed) > 0 ? Number(data?.speed) : 5
      zoomCameraVelocity(dir, speed, stop)
      break
    }
    case 'voicePttDown':
      // Push-to-talk DOWN (Stream Deck "Hold to Direct" keyDown): open the mic.
      // No-op unless voice is enabled + the helper is ready.
      voicePttDown()
      break
    case 'voicePttUp':
      // Push-to-talk UP (deck keyUp): stop listening, recognize, execute best match.
      voicePttUp()
      break
    case 'shotRecordToggle':
      // Deck "Record Shot": start/stop recording a manual PTZ move.
      shotRecordToggle()
      break
    case 'shotReplay': {
      // Deck "Play Shot N": replay a recorded move by id.
      const id = Number(data?.id)
      if (Number.isInteger(id) && id > 0) shotReplay(id)
      break
    }
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

  // Rebroadcast state on PTZ activity transitions (record/replay/sweep/active-cam)
  // so deck faces + the tablet popup show live camera status.
  setOnShotStateChanged(broadcastState)
  setOnCameraActivityChanged(broadcastState)

  wss.on('listening', () => {
    recordEvent('net', 'WS hub listening', { host: '0.0.0.0', port })
  })

  wss.on('connection', (ws, req) => {
    (ws as unknown as { isAlive: boolean }).isAlive = true

    const remoteIp = req.socket.remoteAddress || 'unknown'
    recordEvent('net', 'Client connected', { ip: remoteIp })

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

    ws.on('close', (code, reason) => {
      const clientType = clients.get(ws) || 'unknown'
      clients.delete(ws)
      logger.info(`Client disconnected: ${clientType}`)
      recordEvent('net', 'Client disconnected', {
        ip: remoteIp,
        code,
        reason: reason ? reason.toString() : '',
      })
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
