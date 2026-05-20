/**
 * Structured operator event log / telemetry.
 *
 * Records meaningful app + operator events (session loaded, lower-third fired,
 * OBS connected, wifi-display restarted, recording started, errors, etc.) into
 * a rolling in-memory ring buffer (cap RING_SIZE) AND appends them to a
 * newline-delimited JSON file under userData so the timeline survives a
 * restart. Surfaced live in the renderer EventLogPanel.
 *
 * Adapted from CompSyncElectronApp/src/main/services/events.ts — BB drops the
 * competition routine kinds and keeps generic ones (session/overlay/obs/wifi/
 * gallery/chat/system/error).
 *
 * Rules:
 * - Events are pure JSON-safe data (no functions, no circular refs).
 * - No secrets — never put API keys / passwords in meta.
 * - Writing must never throw — telemetry is best-effort.
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { createLogger } from '../logger'

const logger = createLogger('events')

export type EventKind =
  | 'session'
  | 'overlay'
  | 'obs'
  | 'wifi'
  | 'gallery'
  | 'chat'
  | 'system'
  | 'error'

export interface EventRecord {
  t: string // ISO timestamp
  kind: EventKind
  message: string
  meta?: Record<string, unknown>
}

const RING_SIZE = 2000
const recent: EventRecord[] = []

// Size-based roll-over so the JSONL file can't grow unbounded over a long show.
const MAX_LOG_BYTES = 10 * 1024 * 1024
let currentLogBytes = -1
let rotating = false
let logPath: string | null = null
let writeFailures = 0
const MAX_WRITE_FAILURES_BEFORE_QUIET = 5

// Live subscriber — index.ts wires this to BrowserWindow fanout so the
// renderer EventLogPanel receives events in real time.
type EmitListener = (record: EventRecord) => void
let emitListener: EmitListener | null = null

export function setOnEvent(cb: EmitListener | null): void {
  emitListener = cb
}

function getPath(): string {
  if (logPath) return logPath
  logPath = path.join(app.getPath('userData'), 'logs', 'events.jsonl')
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
  } catch { /* best-effort */ }
  return logPath
}

function seedLogBytes(p: string): void {
  if (currentLogBytes >= 0) return
  try {
    currentLogBytes = fs.statSync(p).size
  } catch {
    currentLogBytes = 0
  }
}

function rotateIfNeeded(p: string): void {
  if (rotating || currentLogBytes < MAX_LOG_BYTES) return
  rotating = true
  currentLogBytes = 0
  fs.rename(p, p + '.1', () => { rotating = false })
}

export function recordEvent(kind: EventKind, message: string, meta?: Record<string, unknown>): void {
  const record: EventRecord = { t: new Date().toISOString(), kind, message }
  if (meta && Object.keys(meta).length) record.meta = meta

  recent.push(record)
  if (recent.length > RING_SIZE) recent.shift()

  if (emitListener) {
    try { emitListener(record) } catch { /* never let UI fanout break recording */ }
  }

  if (writeFailures >= MAX_WRITE_FAILURES_BEFORE_QUIET) return

  try {
    const line = JSON.stringify(record) + '\n'
    const p = getPath()
    seedLogBytes(p)
    rotateIfNeeded(p)
    fs.appendFile(p, line, (err) => {
      if (err) {
        writeFailures++
        if (writeFailures === MAX_WRITE_FAILURES_BEFORE_QUIET) {
          logger.warn(`${writeFailures} write failures — muting further warnings`)
        }
      } else {
        currentLogBytes += Buffer.byteLength(line)
      }
    })
  } catch {
    writeFailures++
  }
}

export function getRecent(limit = 500, kind?: EventKind): EventRecord[] {
  const src = kind ? recent.filter((e) => e.kind === kind) : recent
  return src.slice(-limit).reverse() // newest first
}
