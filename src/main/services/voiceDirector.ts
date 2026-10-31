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
  setCameraAiEnable,
  stopAllCameraMotion,
  abortCameraMoves,
  getActiveCameraId,
} from './cameraDirector'
import { getMoves, replayMoveByLabel, toggleCycle, isCycling, cancelReplay } from './shotRecorder'
import * as autoDirector from './autoDirector'
import * as obs from './obsConnection'
import { setVoiceMicSilent } from './showMonitor'
import { IPC, VoiceResult, VoiceStatus, VoiceShot } from '../../shared/types'
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
  { id: 'autoDirect', phrases: ['autodirect', 'auto direct', 'auto director'] },
  { id: 'cycle', phrases: ['cycle moves', 'cycle shots', 'cycle'] },
]

interface VoiceMsgResult {
  t: 'result'
  camera?: number | null
  verb: string
  target?: string | null
  confidence: number
}
interface VoiceMsgReject { t: 'reject'; reason?: string; confidence?: number }
interface VoiceMsgError { t: 'error'; reason?: string }
type VoiceMsg = VoiceMsgResult | VoiceMsgReject | VoiceMsgError | { t: 'ready' } | { t: 'pong' } | { t: 'mic'; name?: string }

let helper: ChildProcessWithoutNullStreams | null = null
let helperReady = false
let listening = false
let stdoutBuf = ''
let restartTimer: NodeJS.Timeout | null = null
let lastResult: VoiceResult | undefined
let onVoiceChanged: (() => void) | null = null

// ── Program cuts by voice (owner 2026-10-31: "camera one go camera two go for when I want to be
// driving a camera and voice directing the switching"). One "take:<scene>" verb per OBS scene.
const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
let takeVerbs: Array<{ id: string; phrases: string[] }> = []

/** Spoken phrases that cut to `scene`: "Cam2" → "camera two go"; "StartingSoon" → "starting soon go". */
export function takePhrases(scene: string): string[] {
  const m = scene.trim().match(/^cam(?:era)?\s*(\d{1,2})$/i)
  if (m && Number(m[1]) <= 10) {
    const w = NUM_WORDS[Number(m[1])]
    return [`camera ${w} go`, `cam ${w} go`, `take camera ${w}`]
  }
  const spoken = scene.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase().replace(/\s+/g, ' ').trim()
  return /^[a-z ]+$/.test(spoken) ? [`${spoken} go`, `take ${spoken}`] : [] // shortcut: names with digits/symbols aren't voiced
}

/** Re-read OBS scenes and push them into the grammar. Called on OBS connect and helper start. */
export async function refreshSceneVerbs(): Promise<void> {
  if (!obs.isConnected()) return
  try {
    const r = (await obs.sendRequest('GetSceneList')) as { scenes?: Array<{ sceneName: string }> }
    takeVerbs = (r?.scenes ?? []).map((x) => ({ id: `take:${x.sceneName}`, phrases: takePhrases(x.sceneName) })).filter((v) => v.phrases.length)
    refreshGrammar()
  } catch (err) {
    logger.warn(`voice: scene list failed: ${err instanceof Error ? err.message : err}`)
  }
}

/** WS hub hook so the OBS dock sees helper state + last heard command live. */
export function setOnVoiceChanged(cb: (() => void) | null): void {
  onVoiceChanged = cb
}

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
  onVoiceChanged?.()
}

/** Hands-free voice mode: listens continuously. The wake word is optional (owner 2026-10-31:
 *  "I don't want to have to say BB as a wake word ... just always listening to the boom headset"). */
function wakeActive(): boolean {
  return settings.getAll().voiceWakeEnabled === true
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
function buildGrammar(): { t: 'grammar'; verbs: Array<{ id: string; phrases: string[]; needsTarget?: boolean }>; shots: Record<string, string[]>; wakeWord: string } {
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
  // Bare "camera one" (select) only matters with two PTZs; with one it does nothing and SAPI
  // ends "camera one go" early on it (DART 2026-10-31: "camera one go" → select CAM1 @ 0.89).
  const verbs = VOICE_VERBS.filter((v) => v.id !== 'select' || !!(s.cameraHost2 ?? '').trim())
  return { t: 'grammar', verbs: [...verbs, ...takeVerbs], shots, wakeWord: wakeWord() }
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

/** Picker changed → helper reopens its capture device (label; '' = Windows default). */
export function applyMic(): void {
  if (helper && helperReady) send({ t: 'mic', deviceId: settings.getAll().voiceMicDeviceId || '' })
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
      void refreshSceneVerbs()
      logger.info(`voice-helper ready, grammar pushed${wakeActive() ? ` (wake "${wakeWord()}")` : ''}`)
      pushStatus()
      break
    case 'result':
      routeResult(msg)
      break
    case 'reject':
      emitResult({ ok: false, camera: getActiveCameraId(), verb: 'reject', text: msg.reason === 'mic-silent' ? 'MIC SILENT — check the voice mic' : 'rejected', confidence: msg.confidence ?? 0, reason: msg.reason || 'low-confidence' })
      break
    case 'error':
      logger.warn(`voice-helper error: ${msg.reason}`)
      break
    case 'mic':
      logger.info(`voice-helper mic: ${msg.name || 'Windows default'}`)
      break
    case 'pong':
      break
  }
}

// ── Command routing ──────────────────────────────────────────────────────────
const STRICT_VERBS = new Set(['wide', 'track', 'pushIn', 'slowPushIn', 'pullOut', 'zoomIn', 'autoDirect', 'cycle'])
const STRICT_VERB_FLOOR = 0.8

function routeResult(msg: VoiceMsgResult): void {
  const s = settings.getAll()
  const base = typeof s.voiceConfidenceFloor === 'number' ? s.voiceConfidenceFloor : 0.6
  // Short bare verbs ("wide", "track") are what random talk lands on ("pizza delivery tonight" →
  // wide @ 0.60 on DART 2026-10-29) → they need a firmer match. recall/stop keep the operator floor.
  // Only hands-free hears random talk; under push-to-talk the operator chose to speak, and the
  // strict floor rejected a real "push in" @ 0.62 on the KH-23 headset (DART 2026-10-30).
  // The strict floor sits 0.15 above the operator's slider (capped at 0.8) so lowering the slider
  // lowers it too — a hard 0.8 rejected real headset "push in" @ 0.66–0.77 (DART 2026-10-31).
  const floor = wakeActive() && (STRICT_VERBS.has(msg.verb) || msg.verb.startsWith('take:')) ? Math.max(base, Math.min(STRICT_VERB_FLOOR, base + 0.15)) : base
  // Hands-free hears the room: show audio drove 88 PTZ commands in 20 min ("stop", "track",
  // "pull out" @ 0.9+, DART 2026-10-31 13:13-13:33). Only "camera N …" commands act; cuts
  // ("camera N go") and "autodirect" are whole distinctive phrases and pass as-is.
  if (wakeActive() && msg.camera == null && !msg.verb.startsWith('take:') && msg.verb !== 'autoDirect') {
    emitResult({ ok: false, camera: getActiveCameraId(), verb: msg.verb, text: `ignored: say "camera N ${msg.verb}"`, confidence: msg.confidence, reason: 'needs-camera-prefix' })
    return
  }
  if (msg.confidence < floor) {
    emitResult({ ok: false, camera: getActiveCameraId(), verb: msg.verb, text: 'low confidence', confidence: msg.confidence, reason: 'below-floor' })
    return
  }

  if (msg.verb.startsWith('take:')) {
    // A program cut, not a PTZ command: leave the active PTZ camera alone. Like any cut BB's
    // Auto Director didn't make, this turns the director off.
    const scene = msg.verb.slice(5)
    const camera = getActiveCameraId()
    obs.setCurrentScene(scene).then(
      () => emitResult({ ok: true, camera, verb: 'take', target: scene, text: `CUT ▸ ${scene}`, confidence: msg.confidence }),
      (err) => emitResult({ ok: false, camera, verb: 'take', target: scene, text: `cut to ${scene} failed`, confidence: msg.confidence, reason: err instanceof Error ? err.message : String(err) }),
    )
    return
  }

  // "camera N <verb>": N is the OBS camera number ("camera three push in", Cam3 = the PTZ).
  // One PTZ → every motion verb lands on it whatever N is. Two PTZs → N 1|2 picks the host.
  // shortcut: no camera-number→PTZ map; add one when a second PTZ joins with a scene number ≠ 1|2.
  let camera = getActiveCameraId()
  if ((msg.camera === 1 || msg.camera === 2) && (s.cameraHost2 ?? '').trim()) {
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
      // Keeps zooming until "stop" (or the lens rail) — owner 2026-10-31.
      zoomCameraVelocity('in', 1) // slowest optical speed
      ok(`CAM${camera} ▸ PUSH IN (say stop)`)
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
    case 'track':
      setCameraAiEnable(true)
      ok(`CAM${camera} ▸ TRACK`)
      break
    case 'stop':
      abortCameraMoves() // kill any in-flight sweep/glide legs too
      cancelReplay() // and a running move / cycle
      stopAllCameraMotion()
      ok(`CAM${camera} ▸ STOP`)
      break
    case 'autoDirect':
      void autoDirector.start().then((st) =>
        st.on ? ok('AUTO DIRECTOR ON') : reject('director-failed', 'auto director did not start'))
      break
    case 'cycle':
      if (getMoves().length === 0) return reject('no-moves', 'no saved moves to cycle')
      if (!isCycling()) toggleCycle()
      ok(`CAM${camera} ▸ CYCLE MOVES (say stop)`)
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
  r = { ...r, at: Date.now() }
  lastResult = r
  setVoiceMicSilent(r.reason === 'mic-silent')
  logger.info(`voice ${r.ok ? 'OK' : 'REJECT'}: ${r.text} (conf ${r.confidence.toFixed(2)})`)
  pushStatus({ lastResult: r })
}
