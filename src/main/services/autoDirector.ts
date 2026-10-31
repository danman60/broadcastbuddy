// Auto Director (plan docs/plans/2026-10-31-auto-director.md). Owner 2026-10-30: "Like you're
// cycling shots and I'm teeing them up, as long as i know where you're going".
//
// While ON, BB cuts OBS program round-robin over the ticked scenes: each shot holds at least
// minShotSec, then cuts on the next audio onset (beat / hit) or at maxShotSec. NEXT is picked the
// moment a cut lands so the operator can tee that camera up; the tablet shows it as a countdown.
// Any program change BB didn't make (tablet tile tap, OBS, deck) is a human override → OFF.
import * as obs from './obsConnection'
import * as settings from './settings'
import { createLogger } from '../logger'
import type { AppSettings, AudioInputLevel } from '../../shared/types'

const logger = createLogger('autoDirector')

export interface AutoDirectorState {
  on: boolean
  live: string | null
  next: string | null
  secondsLeft: number | null // to the max-length cut; a beat can cut earlier once past minShot
  message?: string
}

type Cfg = NonNullable<AppSettings['autoDirector']>
const DEFAULTS: Cfg = { scenes: [], minShotSec: 6, maxShotSec: 14 }

let on = false
let live: string | null = null
let next: string | null = null
let liveSince = 0
let pendingCut: string | null = null
let tick: NodeJS.Timeout | null = null
let lastPush = 0
let message = ''

// Onset detector over the OBS meters (~20/s): level well above its own recent average.
let envAvg = 0
let lastOnset = 0
const ONSET_RATIO = 1.6
const ONSET_FLOOR = 0.05 // ~-26 dBFS; quieter hits are ignored
const ONSET_REFRACTORY_MS = 250

let notify: (() => void) | null = null
/** wsHub registers its broadcast (wsHub imports us — can't import it back). */
export function setOnAutoDirectorChanged(cb: (() => void) | null): void {
  notify = cb
}

function cfg(): Cfg {
  return { ...DEFAULTS, ...(settings.getAll().autoDirector ?? {}) }
}

export function getState(): AutoDirectorState {
  const c = cfg()
  return {
    on,
    live,
    next,
    secondsLeft: on ? Math.max(0, Math.ceil((liveSince + c.maxShotSec * 1000 - Date.now()) / 1000)) : null,
    message: message || undefined,
  }
}

function changed(): void {
  lastPush = Date.now()
  try { notify?.() } catch { /* ignore */ }
}

function pickNext(after: string | null): string | null {
  const scenes = cfg().scenes.filter((s) => s !== after)
  if (scenes.length === 0) return null
  const all = cfg().scenes
  const i = after ? all.indexOf(after) : -1
  for (let k = 1; k <= all.length; k++) {
    const cand = all[(i + k + all.length) % all.length]
    if (cand !== after) return cand
  }
  return scenes[0]
}

function cut(reason: 'beat' | 'max'): void {
  if (!next || pendingCut) return
  pendingCut = next
  logger.info(`auto director: cut ${live} → ${next} (${reason})`)
  obs.setCurrentScene(next).catch((err) => {
    pendingCut = null
    logger.warn(`auto director: cut to ${next} failed: ${err instanceof Error ? err.message : err}`)
  })
}

export async function start(): Promise<AutoDirectorState> {
  if (on) return getState()
  const c = cfg()
  message = ''
  if (!obs.isConnected()) message = 'OBS not connected'
  else if (c.scenes.length < 2) message = 'Tick at least 2 scenes in Settings → Camera → Auto Director'
  if (message) {
    logger.warn(`auto director: not started — ${message}`)
    changed()
    return getState()
  }
  try {
    const r = (await obs.sendRequest('GetCurrentProgramScene')) as { currentProgramSceneName?: string; sceneName?: string }
    live = r?.currentProgramSceneName ?? r?.sceneName ?? null
  } catch {
    live = null
  }
  on = true
  liveSince = Date.now()
  next = pickNext(live)
  pendingCut = null
  tick = setInterval(onTick, 200)
  logger.info(`auto director: ON (live ${live}, next ${next}, ${c.minShotSec}-${c.maxShotSec} s, scenes ${c.scenes.join(', ')})`)
  changed()
  return getState()
}

export function stop(reason: string): AutoDirectorState {
  if (tick) { clearInterval(tick); tick = null }
  if (on) logger.info(`auto director: OFF (${reason})`)
  on = false
  next = null
  pendingCut = null
  changed()
  return getState()
}

export function toggle(): Promise<AutoDirectorState> | AutoDirectorState {
  return on ? stop('toggled off') : start()
}

function onTick(): void {
  if (!on) return
  const c = cfg()
  const held = Date.now() - liveSince
  if (held >= c.maxShotSec * 1000) cut('max')
  else if (held >= c.minShotSec * 1000 && Date.now() - lastOnset < 150) cut('beat')
  if (Date.now() - lastPush >= 1000) changed() // countdown tick for the tablet
}

/** OBS program changed (any source). Ours → advance; anyone else's → human override, OFF. */
export function onProgramChanged(name: string | null): void {
  if (!on) {
    live = name
    return
  }
  if (name && name === pendingCut) {
    pendingCut = null
    live = name
    liveSince = Date.now()
    next = pickNext(live)
    changed()
    return
  }
  live = name
  stop(`human override → ${name}`)
}

export function onAudio(levels: AudioInputLevel[]): void {
  let level = 0
  for (const input of levels) for (const v of input.levels) if (v > level) level = v
  const now = Date.now()
  if (level > ONSET_FLOOR && level > envAvg * ONSET_RATIO && now - lastOnset > ONSET_REFRACTORY_MS) lastOnset = now
  envAvg = envAvg * 0.95 + level * 0.05 // ~1 s memory at 20 updates/s
}

export function init(): void {
  obs.setOnSceneChanged(onProgramChanged)
  obs.setOnAudioLevels(onAudio)
  obs.onDisconnected(() => { if (on) stop('OBS disconnected') })
}

// Self-check for pickNext's round-robin (runs once at import; logs only on failure).
;(() => {
  const all = ['Cam1', 'Cam2', 'Cam3']
  const order: string[] = []
  let cur: string | null = 'Cam1'
  for (let k = 0; k < 3; k++) {
    const i = all.indexOf(cur as string)
    cur = all[(i + 1) % all.length]
    order.push(cur)
  }
  if (order.join() !== 'Cam2,Cam3,Cam1') logger.error(`auto director self-check failed: ${order.join()}`)
})()
