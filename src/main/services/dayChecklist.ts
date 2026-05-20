/**
 * Operator Start-of-Day / End-of-Day checklist state.
 *
 * Distinct from the CC-pushed broadcast-package checklist BB already has — this
 * is the operator's OWN pre-show setup and post-show teardown list (OBS drive,
 * audio, stream key, gear packed, etc.). Item definitions live in
 * dayChecklistItems.ts; this module just persists per-day check/skip/na state.
 *
 * Persistence lives in its own JSON (broadcastbuddy-day-checklist.json) in
 * userData so it never touches electron-store settings or the session files.
 *
 * Auto-show policy: the renderer shows the start-of-day modal on the first app
 * open of a new calendar day. The "last shown" date is tracked in settings
 * (dayChecklistLastShown) by the renderer/IPC layer, not here — this module is
 * pure state. End-of-day is always operator-initiated (Tools menu / Header).
 *
 * Structure ported from CompSyncElectronApp/src/main/services/dayChecklist.ts,
 * stripped of all competition/routine coupling.
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { createLogger } from '../logger'
import type { DayChecklistKind, DayChecklistItemState, DayChecklistDayState, DayChecklistPersistedState } from '../../shared/types'

const logger = createLogger('dayChecklist')

const FILE_NAME = 'broadcastbuddy-day-checklist.json'

/** Local YYYY-MM-DD in operator-local time (never UTC). */
export function todayKey(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function stateKey(date: string, kind: DayChecklistKind): string {
  return `${date}|${kind}`
}

function getFilePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

let cache: DayChecklistPersistedState | null = null

function load(): DayChecklistPersistedState {
  if (cache) return cache
  const p = getFilePath()
  try {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf-8')
      const parsed = JSON.parse(raw) as DayChecklistPersistedState
      if (parsed && typeof parsed === 'object' && parsed.days) {
        cache = parsed
        return cache
      }
    }
  } catch (err) {
    logger.warn(`failed to read ${p}: ${err instanceof Error ? err.message : err}`)
  }
  cache = { days: {} }
  return cache
}

function save(): void {
  if (!cache) return
  const p = getFilePath()
  try {
    const dir = path.dirname(p)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const tmp = p + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2))
    fs.renameSync(tmp, p)
  } catch (err) {
    logger.error(`failed to save ${p}: ${err instanceof Error ? err.message : err}`)
  }
}

function getOrCreateDay(date: string, kind: DayChecklistKind): DayChecklistDayState {
  const s = load()
  const k = stateKey(date, kind)
  const existing = s.days[k]
  if (existing) return existing
  const fresh: DayChecklistDayState = {
    date,
    items: {},
    dismissed: false,
    lastUpdatedAt: Date.now(),
  }
  s.days[k] = fresh
  save()
  return fresh
}

/** Renderer asks for the state for a given date/kind. Never mutates. */
export function getDayState(date: string, kind: DayChecklistKind): DayChecklistDayState {
  const s = load()
  const k = stateKey(date, kind)
  return (
    s.days[k] ?? {
      date,
      items: {},
      dismissed: false,
      lastUpdatedAt: 0,
    }
  )
}

export function setItemState(
  date: string,
  kind: DayChecklistKind,
  itemId: string,
  value: DayChecklistItemState,
): DayChecklistDayState {
  const day = getOrCreateDay(date, kind)
  day.items[itemId] = value
  day.lastUpdatedAt = Date.now()
  save()
  return day
}

/** Operator dismissed the modal for this date/kind — don't auto-show again. */
export function markDismissed(date: string, kind: DayChecklistKind): DayChecklistDayState {
  const day = getOrCreateDay(date, kind)
  day.dismissed = true
  day.lastUpdatedAt = Date.now()
  save()
  return day
}

/** Manual re-open (Tools menu / Header). Returns today's state for the kind. */
export function manualReopen(kind: DayChecklistKind): DayChecklistDayState {
  const date = todayKey()
  return getDayState(date, kind)
}

/** Clear cache — used by tests; no-op in prod. */
export function _resetForTests(): void {
  cache = null
}
