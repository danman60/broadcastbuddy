// Voice-driven PTZ director.
//
// Push-to-talk → an offline Windows SAPI grammar (bundled voice-helper.exe) →
// recognized command → existing cameraDirector primitives. Fully guarded: every
// path no-ops unless `voiceEnabled` is set, so a normal operator is unaffected.
//
// Wire protocol with the helper = newline-delimited JSON over stdio (see
// docs/superpowers/specs/2026-06-23-voice-ptz-director-design.md):
//   BB → helper : {t:'grammar',verbs,shots} | {t:'listen',on} | {t:'mic',deviceId} | {t:'ping'}
//   helper → BB : {t:'ready'} | {t:'result',camera,verb,target,confidence} |
//                 {t:'reject',reason,confidence} | {t:'error',reason} | {t:'pong'}
//
// BB owns the confidence floor (so it's tunable without rebuilding the exe) and the
// command→primitive routing. The helper only recognizes speech against the grammar.

import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { app, BrowserWindow } from 'electron'
import * as settings from './settings'
import {
  setActiveCamera,
  recallCameraPreset,
  slowZoomPush,
  zoomCameraVelocity,
  goHomeViaCamera,
  sweepBetweenPresets,
  setCameraAiEnable,
  stopAllCameraMotion,
  abortCameraMoves,
  getActiveCameraId,
} from './cameraDirector'
import { getMoves, replayMoveByLabel } from './shotRecorder'
import { IPC, VoiceResult, VoiceStatus, VoiceShot } from '../../shared/types'
import { SWEEP_DEFAULT_MS, SLOW_ZOOM_DEFAULT_MS, SLOW_ZOOM_IN_FACTOR } from '../../shared/cameraMoves'
import { createLogger } from '../logger'

const logger = createLogger('voiceDirector')

// ── Canonical verb vocabulary ────────────────────────────────────────────────
// The helper recognizes these spoken phrases; each maps to a canonical verb id BB
// routes on. Synonyms collapse to one id. Kept in sync with the C# helper grammar.
export const VOICE_VERBS: Array<{ id: string; phrases: string[]; needsTarget?: boolean }> = [
  { id: 'select', phrases: ['camera one', 'camera two'] }, // handled via the camera prefix too
  { id: 'recall', phrases: ['shot', 'go to shot', 'preset', 'go to preset'], needsTarget: true },
  { id: 'pushIn', phrases: ['push in'] },
  { id: 'slowPushIn', phrases: ['slow push in', 'slow push'] },
  { id: 'pullOut', phrases: ['pull out', 'zoom out'] },
  { id: 'zoomIn', phrases: ['zoom in'] },
  { id: 'wide', phrases: ['wide', 'go wide', 'home'] },
  // 'sweep' deliberately NOT pushed: its "<n> to <n>" phrase makes Windows SAPI's grammar
  // compiler fail ("'' rule reference not defined") and that kills the WHOLE grammar
  // (verified on FIRMAMENT 2026-10-29). Sweeps stay on deck/panel.
  { id: 'track', phrases: ['track', 'follow'] },
  { id: 'stop', phrases: ['stop'] },
]

interface VoiceMsgResult {
  t: 'result'
  camera?: number | null
  verb: string
  target?: string | null
  from?: number | null
  to?: number | null
  confidence: number
}
interface VoiceMsgReject { t: 'reject'; reason?: string; confidence?: number }
interface VoiceMsgError { t: 'error'; reason?: string }
type VoiceMsg = VoiceMsgResult | VoiceMsgReject | VoiceMsgError | { t: 'ready' } | { t: 'pong' }

let helper: ChildProcessWithoutNullStreams | null = null
let helperReady = false
let listening = false
let stdoutBuf = ''
let restartTimer: NodeJS.Timeout | null = null
let lastResult: VoiceResult | undefined

// ── Helper executable location ───────────────────────────────────────────────
// Bundled next to the app resources on Windows; a dev override path is checked too.
function helperPath(): string | null {
  const candidates = [
    join(process.resourcesPath || '', 'voice-helper', 'voice-helper.exe'),
    join(app.getAppPath(), '..', 'voice-helper', 'voice-helper.exe'),
    join(app.getAppPath(), 'resources', 'voice-helper', 'voice-helper.exe'),
  ]
  return candidates.find((p) => p && existsSync(p)) ?? null
}

function enabled(): boolean {
  // Voice runs on the explicit opt-in alone — a camera need NOT be configured. This
  // lets recognition + on-screen feedback be tested with no PTZ attached; the command
  // router's camera primitives are all individually guarded (no-op without a reachable
  // camera), so firing them dry is harmless.
  return settings.getAll().voiceEnabled === true
}

function pushStatus(extra?: Partial<VoiceStatus>): void {
  const status: VoiceStatus = {
    helper: helper ? (helperReady ? 'ready' : 'starting') : 'down',
    listening,
    wake: wakeActive(),
    lastResult,
    ...extra,
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.VOICE_STATE, status)
  }
}

/** Hands-free wake mode active = enabled + a non-empty wake word configured. */
function wakeActive(): boolean {
  const s = settings.getAll()
  return s.voiceWakeEnabled === true && !!(s.voiceWakeWord && s.voiceWakeWord.trim())
}

/** The configured wake word, lower-cased, or '' when wake mode is off. */
function wakeWord(): string {
  if (!wakeActive()) return ''
  return (settings.getAll().voiceWakeWord || '').trim().toLowerCase()
}

// Camera preset slots that are always speakable ("shot 3" / "preset 3") even with no
// Voice panel shots configured — the 8 slots the CameraPanel preset grid saves to.
const ALWAYS_SPOKEN_SLOTS = 8

// ── Grammar (built from settings, pushed on (re)start + label change) ─────────
function buildGrammar(): { t: 'grammar'; verbs: typeof VOICE_VERBS; shots: Record<string, string[]>; wakeWord: string } {
  const s = settings.getAll()
  const shots: Record<string, string[]> = { '1': [], '2': [] }
  for (const camKey of ['1', '2'] as const) {
    const list = (s.voiceShots?.[Number(camKey) as 1 | 2] ?? []) as VoiceShot[]
    const tokens: string[] = Array.from({ length: ALWAYS_SPOKEN_SLOTS }, (_, i) => String(i + 1))
    for (const shot of list) {
      tokens.push(String(shot.id)) // numbered "shot <id>" always available
      if (shot.label && shot.label.trim()) tokens.push(shot.label.trim().toLowerCase())
    }
    // Recorded-move labels are recallable on either camera (they may drive both).
    for (const mv of getMoves()) {
      if (mv.label && mv.label.trim()) tokens.push(mv.label.trim().toLowerCase())
    }
    shots[camKey] = Array.from(new Set(tokens))
  }
  // wakeWord non-empty → the helper makes it a REQUIRED prefix on every utterance
  // and listens continuously; empty → classic PTT grammar (no prefix).
  return { t: 'grammar', verbs: VOICE_VERBS, shots, wakeWord: wakeWord() }
}

function send(obj: unknown): void {
  if (!helper || helper.killed) return
  try {
    helper.stdin.write(JSON.stringify(obj) + '\n')
  } catch (err) {
    logger.warn(`helper stdin write failed: ${err instanceof Error ? err.message : err}`)
  }
}

/** (Re)push the grammar to the helper. Call after shot labels change. */
export function refreshGrammar(): void {
  if (!enabled() || !helper) return
  send(buildGrammar())
  logger.info('voice grammar refreshed')
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
/** Start the helper if voice is enabled + the exe is present. Idempotent. */
export function startVoiceDirector(): void {
  if (helper || !enabled()) return
  const exe = helperPath()
  if (!exe) {
    logger.warn('voice-helper.exe not found — voice director disabled')
    pushStatus()
    return
  }
  try {
    helper = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  } catch (err) {
    logger.error(`failed to spawn voice-helper: ${err instanceof Error ? err.message : err}`)
    helper = null
    return
  }
  helperReady = false
  stdoutBuf = ''
  logger.info(`voice-helper started (${exe})`)
  pushStatus()

  helper.stdout.on('data', (chunk: Buffer) => {
    stdoutBuf += chunk.toString('utf8')
    let nl: number
    while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, nl).trim()
      stdoutBuf = stdoutBuf.slice(nl + 1)
      if (line) handleHelperLine(line)
    }
  })
  helper.stderr.on('data', (chunk: Buffer) => {
    logger.warn(`voice-helper stderr: ${chunk.toString('utf8').trim()}`)
  })
  helper.on('exit', (code) => {
    logger.warn(`voice-helper exited (code ${code})`)
    helper = null
    helperReady = false
    listening = false
    pushStatus()
    // Auto-relaunch while still enabled (additive — manual controls unaffected).
    if (enabled() && !restartTimer) {
      restartTimer = setTimeout(() => {
        restartTimer = null
        startVoiceDirector()
      }, 2000)
    }
  })
}

/** Stop the helper (voice disabled or app shutdown). */
export function stopVoiceDirector(): void {
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
  if (helper && !helper.killed) {
    try {
      helper.kill()
    } catch {
      /* ignore */
    }
  }
  helper = null
  helperReady = false
  listening = false
}

/** React to a voiceEnabled toggle. */
export function applyVoiceEnabled(): void {
  if (enabled()) startVoiceDirector()
  else stopVoiceDirector()
  pushStatus()
}

// ── Push-to-talk (deck via WS, or renderer test button via IPC) ──────────────
export function pttDown(): void {
  if (!enabled() || !helper || !helperReady) return
  if (wakeActive()) return // already listening continuously — PTT is redundant
  listening = true
  send({ t: 'listen', on: true })
  pushStatus()
}

export function pttUp(): void {
  if (!helper) return
  if (wakeActive()) return // continuous listening stays on; don't flip it off
  listening = false
  send({ t: 'listen', on: false })
  pushStatus()
}

export function getStatus(): VoiceStatus {
  return {
    helper: helper ? (helperReady ? 'ready' : 'starting') : 'down',
    listening,
    wake: wakeActive(),
    lastResult,
  }
}

/**
 * React to a wake-word setting change (word edited or hands-free toggled). Re-push
 * the grammar (which now carries — or drops — the required wake prefix) and tell the
 * helper to start/stop CONTINUOUS recognition. No-op unless the helper is up.
 */
export function applyWakeMode(): void {
  if (!helper || !helperReady) {
    pushStatus()
    return
  }
  send(buildGrammar())
  const on = wakeActive()
  send({ t: 'wake', on })
  listening = on // continuous listening reflects hands-free state
  logger.info(`voice wake mode ${on ? `ON ("${wakeWord()}")` : 'OFF'}`)
  pushStatus()
}

// ── Helper message handling ──────────────────────────────────────────────────
function handleHelperLine(line: string): void {
  let msg: VoiceMsg
  try {
    msg = JSON.parse(line) as VoiceMsg
  } catch {
    logger.warn(`voice-helper: bad JSON line: ${line.slice(0, 120)}`)
    return
  }
  switch (msg.t) {
    case 'ready':
      helperReady = true
      send(buildGrammar())
      send({ t: 'mic', deviceId: settings.getAll().voiceMicDeviceId || '' })
      // Hands-free: kick the helper into continuous recognition immediately.
      if (wakeActive()) {
        send({ t: 'wake', on: true })
        listening = true
      }
      logger.info(`voice-helper ready, grammar pushed${wakeActive() ? ` (wake "${wakeWord()}")` : ''}`)
      pushStatus()
      break
    case 'result':
      routeResult(msg)
      break
    case 'reject':
      emitResult({ ok: false, camera: getActiveCameraId(), verb: 'reject', text: 'rejected', confidence: msg.confidence ?? 0, reason: msg.reason || 'low-confidence' })
      break
    case 'error':
      logger.warn(`voice-helper error: ${msg.reason}`)
      break
    case 'pong':
      break
  }
}

// ── Command routing ──────────────────────────────────────────────────────────
function routeResult(msg: VoiceMsgResult): void {
  const s = settings.getAll()
  const floor = typeof s.voiceConfidenceFloor === 'number' ? s.voiceConfidenceFloor : 0.6
  if (msg.confidence < floor) {
    emitResult({ ok: false, camera: getActiveCameraId(), verb: msg.verb, text: 'low confidence', confidence: msg.confidence, reason: 'below-floor' })
    return
  }

  // Camera prefix → set active first; the verb then lands on it (all primitives
  // resolve via the active host).
  let camera = getActiveCameraId()
  if (msg.camera === 1 || msg.camera === 2) {
    camera = setActiveCamera(msg.camera)
  }

  const verb = msg.verb
  const targetTok = (msg.target ?? '').toString().trim().toLowerCase()

  const reject = (reason: string, text: string): void =>
    emitResult({ ok: false, camera, verb, target: targetTok || undefined, text, confidence: msg.confidence, reason })
  const ok = (text: string): void =>
    emitResult({ ok: true, camera, verb, target: targetTok || undefined, text, confidence: msg.confidence })

  switch (verb) {
    case 'select':
      ok(`CAM${camera}`)
      break
    case 'recall': {
      const slot = resolveShotSlot(camera, targetTok)
      if (slot == null) {
        // Not a preset slot — maybe a recorded MOVE label → replay it.
        if (targetTok && replayMoveByLabel(targetTok)) {
          ok(`▸ ${targetTok.toUpperCase()} (move)`)
          break
        }
        return reject('unset-shot', `${targetTok ? `"${targetTok}"` : 'shot'} not set`)
      }
      recallCameraPreset(slot)
      ok(`CAM${camera} ▸ ${targetTok ? targetTok.toUpperCase() : `SHOT ${slot}`}`)
      break
    }
    case 'pushIn':
      slowZoomPush(SLOW_ZOOM_DEFAULT_MS, SLOW_ZOOM_IN_FACTOR)
      ok(`CAM${camera} ▸ PUSH IN`)
      break
    case 'slowPushIn':
      slowZoomPush(numOr(s.voiceSlowPushMs, 15000), numOr(s.voiceSlowPushFactor, 1.3))
      ok(`CAM${camera} ▸ SLOW PUSH IN`)
      break
    case 'pullOut':
      zoomNudge('out', numOr(s.voiceZoomSpeed, 3), numOr(s.voiceZoomNudgeMs, 600))
      ok(`CAM${camera} ▸ PULL OUT`)
      break
    case 'zoomIn':
      zoomNudge('in', numOr(s.voiceZoomSpeed, 3), numOr(s.voiceZoomNudgeMs, 600))
      ok(`CAM${camera} ▸ ZOOM IN`)
      break
    case 'wide':
      goHomeViaCamera()
      ok(`CAM${camera} ▸ WIDE`)
      break
    case 'sweep': {
      // resolveShotSlot handles numeric tokens (slots 1-8 always pass); an unknown
      // label or out-of-range number → null → reject.
      const from = resolveShotSlot(camera, (msg.from ?? '').toString())
      const to = resolveShotSlot(camera, (msg.to ?? '').toString())
      if (from == null || to == null) return reject('unset-shot', 'sweep shots not set')
      sweepBetweenPresets(from, to, SWEEP_DEFAULT_MS)
      ok(`CAM${camera} ▸ SWEEP ${from}→${to}`)
      break
    }
    case 'track':
      setCameraAiEnable(true)
      ok(`CAM${camera} ▸ TRACK`)
      break
    case 'stop':
      abortCameraMoves() // kill any in-flight sweep/glide legs too
      stopAllCameraMotion()
      ok(`CAM${camera} ▸ STOP`)
      break
    default:
      reject('unknown-verb', `unknown: ${verb}`)
  }
}

/** Bounded velocity zoom: ramp toward a rail, auto-stop after `ms`. */
function zoomNudge(dir: 'in' | 'out', speed: number, ms: number): void {
  zoomCameraVelocity(dir, speed)
  setTimeout(() => zoomCameraVelocity(dir, 0, true), Math.max(150, ms))
}

/** Map a spoken shot token (a number string or a saved label) to a preset slot. */
function resolveShotSlot(camera: 1 | 2, token: string): number | null {
  const tok = token.trim().toLowerCase()
  if (!tok) return null
  const list = (settings.getAll().voiceShots?.[camera] ?? []) as VoiceShot[]
  // numeric "shot 3"
  if (/^\d+$/.test(tok)) {
    const id = Number(tok)
    return (id >= 1 && id <= ALWAYS_SPOKEN_SLOTS) || list.some((sh) => sh.id === id) ? id : null
  }
  // labeled "drummer"
  const hit = list.find((sh) => (sh.label ?? '').trim().toLowerCase() === tok)
  return hit ? hit.id : null
}

function numOr(v: unknown, dflt: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt
}

function emitResult(r: VoiceResult): void {
  lastResult = r
  logger.info(`voice ${r.ok ? 'OK' : 'REJECT'}: ${r.text} (conf ${r.confidence.toFixed(2)})`)
  pushStatus({ lastResult: r })
}
