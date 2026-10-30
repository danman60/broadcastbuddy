// Shot recorder — record a manual PTZ "move" and replay it.
//
// While recording, we subscribe to cameraDirector's command sink and timestamp
// every pose-affecting command (gimbal velocity, zoom, slow push/pull, preset
// recall) issued by ANY source (Xbox sticks, on-screen joystick, voice). On stop
// we persist the timed event list as a "recorded move". Replay re-emits the same
// commands with the same timing through the per-camera primitives.
//
// HARDWARE CAVEAT (documented, accepted): the OBSBOT Tail 2 has no live pose
// read-back, so replay is OPEN-LOOP velocity playback — it reproduces the command
// timeline, not a closed-loop trajectory, so it can drift from the original path
// (same root cause as the old velocity sweep). Reliable enough for repeatable
// flourishes; not frame-exact. Recorded moves are recallable by voice + hotkey.

import { BrowserWindow } from 'electron'
import * as settings from './settings'
import {
  setCameraCommandSink,
  setCommandSinkSuppressed,
  nudgeCameraXYFor,
  zoomCameraVelocityFor,
  slowZoomPushFor,
  recallCameraPresetFor,
  stopAllCameraMotionFor,
  saveCameraPresetFor,
  setCameraAiEnableFor,
  getActiveCameraId,
  waitForPresetPose,
  RecordedCmd,
} from './cameraDirector'
import { IPC, RecordedMove, RecordedMoveEvent, ShotRecorderState } from '../../shared/types'
import { createLogger } from '../logger'

const logger = createLogger('shotRecorder')

const MAX_MOVE_MS = 120_000 // hard cap a single recording at 2 minutes
const MAX_EVENTS = 4000
// Each move's start pose lives in camera preset slot START_SLOT_BASE + move id.
// shortcut: Tail 2 slots stop at 254, so move ids above 54 get no start snap; reuse slots if that ever matters.
const START_SLOT_BASE = 200

let recording = false
let recordStartMs = 0
let recordStart: RecordedMove['start'] | undefined
let buffer: RecordedMoveEvent[] = []
let autoStopTimer: NodeJS.Timeout | null = null
const replayTimers = new Set<NodeJS.Timeout>()
let replayingId: number | null = null
let replayGen = 0 // bumped on every replay/cancel so a pending start-pose wait can't start a stale move
// Cameras the CURRENT replay has already sent commands to — cancelReplay must
// stop these, or a cleared end-timer strands a gimbal panning at velocity.
let replayUsedCameras = new Set<1 | 2>()

// Notified after the saved-move list changes (so the voice grammar can rebuild).
// Registered from index.ts to avoid a shotRecorder↔voiceDirector import cycle.
let onMovesChanged: (() => void) | null = null
export function setOnMovesChanged(cb: (() => void) | null): void {
  onMovesChanged = cb
}
function movesChanged(): void {
  try {
    onMovesChanged?.()
  } catch {
    /* ignore */
  }
}

function now(): number {
  return Date.now()
}

// Notified on every recorder state change (recording/replaying transitions) so
// the WS hub can rebroadcast PTZ activity to deck faces + the tablet popup.
// Injected by wsHub at startup (wsHub imports us — can't import it back).
let onStateChanged: (() => void) | null = null
export function setOnShotStateChanged(cb: (() => void) | null): void {
  onStateChanged = cb
}

function pushState(): void {
  const state: ShotRecorderState = {
    recording,
    replayingMoveId: replayingId,
    eventCount: buffer.length,
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.SHOT_STATE, state)
  }
  try {
    onStateChanged?.()
  } catch {
    /* ignore */
  }
}

export function getState(): ShotRecorderState {
  return { recording, replayingMoveId: replayingId, eventCount: buffer.length }
}

// ── Recording ────────────────────────────────────────────────────────────────
export function startRecording(): void {
  if (recording) return
  buffer = []
  // The Tail 2 can't report its pose, so the start position is saved on the camera itself.
  const camera = getActiveCameraId()
  const slot = START_SLOT_BASE + nextMoveId(getMoves())
  recordStart = slot <= 254 ? { camera, slot } : undefined
  if (recordStart) saveCameraPresetFor(camera, slot, 'BB move start')
  recordStartMs = now()
  recording = true
  setCameraCommandSink((cmd: RecordedCmd) => {
    if (!recording) return
    if (buffer.length >= MAX_EVENTS) return
    buffer.push({ tMs: now() - recordStartMs, camera: cmd.camera, kind: cmd.kind, args: cmd.args })
  })
  autoStopTimer = setTimeout(() => stopRecording(), MAX_MOVE_MS)
  logger.info('shot recording started')
  pushState()
}

/** Stop recording and persist the move (if it captured anything). Returns it. */
export function stopRecording(label?: string): RecordedMove | null {
  if (!recording) return null
  recording = false
  setCameraCommandSink(null)
  if (autoStopTimer) {
    clearTimeout(autoStopTimer)
    autoStopTimer = null
  }
  const events = buffer
  buffer = []
  if (events.length === 0) {
    logger.info('shot recording stopped — empty, discarded')
    pushState()
    return null
  }
  const moves = getMoves()
  const id = nextMoveId(moves)
  const durationMs = events[events.length - 1].tMs
  const move: RecordedMove = {
    id,
    label: label?.trim() || '',
    durationMs,
    events,
    createdAt: new Date().toISOString(),
    start: recordStart && recordStart.slot === START_SLOT_BASE + id ? recordStart : undefined,
  }
  settings.set('recordedMoves', [...moves, move])
  movesChanged()
  logger.info(`shot recorded: move ${id} (${events.length} cmds, ${durationMs}ms)`)
  pushState()
  return move
}

/** Toggle recording (deck/hotkey/Back button). */
export function toggleRecording(): void {
  if (recording) stopRecording()
  else startRecording()
}

// ── Replay ───────────────────────────────────────────────────────────────────
export function replayMove(moveId: number): void {
  const move = getMoves().find((m) => m.id === moveId)
  if (!move) {
    logger.warn(`replayMove: move ${moveId} not found`)
    return
  }
  cancelReplay() // only one replay at a time
  replayingId = moveId
  setCommandSinkSuppressed(true) // don't re-record our own replay
  const usedCameras = new Set<1 | 2>()
  replayUsedCameras = usedCameras
  // Snap to the recorded start pose first (AI off so the tracker doesn't pull away), wait until the
  // camera reports it has ARRIVED (a fixed 1.5 s started the move mid-travel), then run the move.
  const gen = ++replayGen
  const run = (waitedMs: number): void => {
    if (gen !== replayGen) return // cancelled / superseded while snapping
    if (waitedMs) logger.info(`move ${moveId}: at start pose after ${waitedMs} ms`)
    for (const ev of move.events) {
      const t = setTimeout(() => {
        emit(ev)
        usedCameras.add(ev.camera)
      }, ev.tMs)
      replayTimers.add(t)
    }
    // After the move finishes: stop every camera it touched, then clear state.
    const end = setTimeout(() => {
      for (const cam of usedCameras) stopAllCameraMotionFor(cam)
      setCommandSinkSuppressed(false)
      replayingId = null
      replayTimers.clear()
      pushState()
    }, move.durationMs + 250)
    replayTimers.add(end)
  }
  if (move.start) {
    setCameraAiEnableFor(move.start.camera, false)
    recallCameraPresetFor(move.start.camera, move.start.slot)
    usedCameras.add(move.start.camera)
    void waitForPresetPose(move.start.camera, move.start.slot).then(run)
  } else {
    run(0)
  }
  logger.info(`replaying move ${moveId} (${move.events.length} cmds, ${move.durationMs}ms)`)
  pushState()
}

/** Replay by spoken/typed label (voice recall). Returns true if a move matched. */
export function replayMoveByLabel(label: string): boolean {
  const tok = label.trim().toLowerCase()
  if (!tok) return false
  const move = getMoves().find((m) => (m.label ?? '').trim().toLowerCase() === tok)
  if (!move) return false
  replayMove(move.id)
  return true
}

export function cancelReplay(): void {
  replayGen++
  for (const t of replayTimers) clearTimeout(t)
  replayTimers.clear()
  if (replayingId != null) {
    // Clearing the timers also killed the scheduled end-of-replay stop — halt
    // every camera this replay already commanded so nothing keeps panning.
    for (const cam of replayUsedCameras) stopAllCameraMotionFor(cam)
    replayUsedCameras = new Set()
    setCommandSinkSuppressed(false)
    replayingId = null
    pushState()
  }
}

function emit(ev: RecordedMoveEvent): void {
  const a = ev.args || {}
  switch (ev.kind) {
    case 'gimbal':
      nudgeCameraXYFor(ev.camera, num(a.yaw), num(a.pitch))
      break
    case 'gimbalStop':
      nudgeCameraXYFor(ev.camera, 0, 0, true)
      break
    case 'zoom':
      zoomCameraVelocityFor(ev.camera, a.dir === 'out' ? 'out' : 'in', num(a.speed))
      break
    case 'zoomStop':
      zoomCameraVelocityFor(ev.camera, 'in', 0, true)
      break
    case 'slowPush':
      slowZoomPushFor(ev.camera, num(a.ms) || 10000, num(a.factor) || 1.5)
      break
    case 'slowPull':
      slowZoomPushFor(ev.camera, num(a.ms) || 10000, num(a.factor) || 0.7)
      break
    case 'recall':
      recallCameraPresetFor(ev.camera, num(a.n))
      break
    // 'home' / 'stop' are not replayed (they'd fight the move); end-of-replay stops cams.
  }
}

function num(v: number | string | undefined): number {
  return typeof v === 'number' ? v : typeof v === 'string' ? Number(v) || 0 : 0
}

// ── Persistence ──────────────────────────────────────────────────────────────
export function getMoves(): RecordedMove[] {
  return (settings.getAll().recordedMoves ?? []) as RecordedMove[]
}

export function deleteMove(moveId: number): void {
  settings.set('recordedMoves', getMoves().filter((m) => m.id !== moveId))
  movesChanged()
  pushState()
}

export function renameMove(moveId: number, label: string): void {
  settings.set(
    'recordedMoves',
    getMoves().map((m) => (m.id === moveId ? { ...m, label: label.trim() } : m)),
  )
  movesChanged()
  pushState()
}

function nextMoveId(moves: RecordedMove[]): number {
  return moves.reduce((mx, m) => Math.max(mx, m.id), 0) + 1
}
