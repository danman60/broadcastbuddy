// Auto Director (plan docs/plans/2026-10-31-auto-director.md). Owner 2026-10-30: "Like you're
// cycling shots and I'm teeing them up, as long as i know where you're going".
//
// While ON, BB cuts OBS program round-robin over the ticked scenes. Each shot gets a committed cut
// time (random within min..max) the moment it goes live, so the tablet countdown is the truth; the
// cut snaps to an audio onset (beat / hit) up to BEAT_SNAP_MS early, else lands on 0.
// (Owner 2026-10-30: "switches randomly at 9 or 8 or 7 s left" — the first build cut on any beat
// after minShot while counting down to maxShot.) NEXT is picked when a cut lands so the operator
// can tee that camera up; the tablet draws the countdown big on NEXT's multiview tile.
// Any program change BB didn't make (tablet tile tap, OBS, deck) is a human override → OFF.
import * as obs from './obsConnection'
import * as settings from './settings'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createLogger } from '../logger'
import type { AppSettings, AudioInputLevel } from '../../shared/types'

const logger = createLogger('autoDirector')

export interface AutoDirectorState {
  on: boolean
  live: string | null
  next: string | null
  secondsLeft: number | null
  msLeft: number | null // to the committed cut; tablet counts down locally from receipt
  nextTile: number | null // NEXT's position in the OBS multiview grid (row-major), null if not shown
  tiles: number | null // multiview grid side (2 = 2×2), null when the layout isn't scenes-only
  message?: string
}

type Cfg = NonNullable<AppSettings['autoDirector']>
const DEFAULTS: Cfg = { scenes: [], minShotSec: 6, maxShotSec: 14 }

let on = false
let live: string | null = null
let next: string | null = null
let liveSince = 0 // when the live shot started (diagnostic; the cut is driven by cutAt)
let cutAt = 0
let sceneOrder: string[] = [] // OBS scene dock order = multiview tile order
let tiles: number | null = null
const BEAT_SNAP_MS = 400
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
  const msLeft = on ? Math.max(0, cutAt - Date.now()) : null
  const i = next ? sceneOrder.indexOf(next) : -1
  return {
    on,
    live,
    next,
    secondsLeft: msLeft === null ? null : Math.ceil(msLeft / 1000),
    msLeft,
    nextTile: on && tiles && i >= 0 && i < tiles * tiles ? i : null,
    tiles,
    message: message || undefined,
  }
}

/** Commit the next cut time for the shot that just went live. */
function commitCut(): void {
  const c = cfg()
  const span = Math.max(0, c.maxShotSec - c.minShotSec)
  liveSince = Date.now()
  cutAt = liveSince + (c.minShotSec + Math.round(Math.random() * span)) * 1000
}

/** OBS MultiviewLayout → grid side for the scenes-only layouts (6..9 = 4/9/16/25 scenes). The layouts
 *  with preview+program on top use a different geometry, so no tile overlay there. */
function readMultiviewGrid(): number | null {
  for (const f of ['user.ini', 'global.ini']) {
    try {
      const ini = readFileSync(join(process.env.APPDATA ?? '', 'obs-studio', f), 'utf8')
      const m = ini.match(/^MultiviewLayout=(\d+)/m)
      if (m) return ({ 6: 2, 7: 3, 8: 4, 9: 5 } as Record<number, number>)[Number(m[1])] ?? null
    } catch { /* try next file */ }
  }
  return null
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

function cut(reason: 'beat' | 'time'): void {
  if (!next || pendingCut) return
  pendingCut = next
  logger.info(`auto director: cut ${live} → ${next} (${reason}, ${Date.now() - cutAt} ms vs countdown)`)
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
  try {
    const r = (await obs.sendRequest('GetSceneList')) as { scenes?: Array<{ sceneName: string; sceneIndex: number }> }
    sceneOrder = (r?.scenes ?? []).sort((a, b) => b.sceneIndex - a.sceneIndex).map((s) => s.sceneName)
  } catch {
    sceneOrder = []
  }
  tiles = readMultiviewGrid()
  on = true
  commitCut()
  next = pickNext(live)
  pendingCut = null
  tick = setInterval(onTick, 50)
  logger.info(`auto director: ON (live ${live}, next ${next}, ${c.minShotSec}-${c.maxShotSec} s, scenes ${c.scenes.join(', ')}, multiview grid ${tiles ?? 'n/a'}, order ${sceneOrder.join(', ')})`)
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
  const now = Date.now()
  // Never late: a beat may pull the cut up to BEAT_SNAP_MS early, otherwise it lands at 0
  // (DART 2026-10-30: a ±400 ms window + 200 ms tick put every no-beat cut ~0.5 s after "0").
  if (now >= cutAt) cut('time')
  else if (now >= cutAt - BEAT_SNAP_MS && now - lastOnset < 150) cut('beat')
  if (now - lastPush >= 1000) changed() // resync the tablet's local countdown
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
    commitCut()
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
