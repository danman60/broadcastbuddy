/**
 * LAN-bound POST sink for CSController (Android tablet) logs.
 *
 * Android logs are painful to read remotely without ADB. The tablet POSTs
 * batched log lines here; we write them into the app log with a [tablet]
 * prefix.
 *
 * Bound to 0.0.0.0:8766, POST only. No GETs, no secrets leaked on LAN.
 *
 * Protocol:
 *   POST /tablet-log
 *   Content-Type: application/json
 *   Body: { host?: string, logs: Array<{ ts?: number, level?: string, tag?: string, msg: string }> }
 *   Response: { ok: true, accepted: N }
 */

import http, { IncomingMessage, ServerResponse } from 'http'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { createLogger } from '../logger'

const logger = createLogger('tablet-log')

// Routine tablet logs (VideoDecoder stats every 5s) used to land in main.log,
// flooding it so the failure-window detail rotated out within ~1 day. Route
// info/debug tablet lines to a SEPARATE dedicated file so main.log keeps the
// real signal. error/warn still go to main.log so problems stay visible.
let tabletLogPath: string | null = null
let tabletLogFailures = 0
const MAX_TABLET_LOG_FAILURES_BEFORE_QUIET = 5

function getTabletLogPath(): string {
  if (tabletLogPath) return tabletLogPath
  tabletLogPath = path.join(app.getPath('userData'), 'logs', 'tablet.log')
  try {
    fs.mkdirSync(path.dirname(tabletLogPath), { recursive: true })
  } catch { /* best-effort */ }
  return tabletLogPath
}

/** Best-effort append to tablet.log — never throws. */
function writeTabletLogLine(line: string): void {
  if (tabletLogFailures >= MAX_TABLET_LOG_FAILURES_BEFORE_QUIET) return
  try {
    fs.appendFile(getTabletLogPath(), line + '\n', (err) => {
      if (err) {
        tabletLogFailures++
        if (tabletLogFailures === MAX_TABLET_LOG_FAILURES_BEFORE_QUIET) {
          logger.warn(`tablet.log write failures (${tabletLogFailures}) — muting further warnings`)
        }
      }
    })
  } catch {
    tabletLogFailures++
  }
}

const PORT = 8766
const HOST = '0.0.0.0'
const MAX_BODY_BYTES = 256 * 1024
const MAX_LOGS_PER_REQUEST = 500

interface TabletLogEntry {
  ts?: number
  level?: string
  tag?: string
  msg?: string
}

let server: http.Server | null = null

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  try {
    const json = JSON.stringify(body)
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(json),
      'Cache-Control': 'no-store',
    })
    res.end(json)
  } catch {
    try {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('serialization failed')
    } catch {}
  }
}

function normalizeLevel(raw: unknown): 'debug' | 'info' | 'warn' | 'error' {
  const s = typeof raw === 'string' ? raw.toLowerCase() : ''
  if (s === 'e' || s === 'error' || s === 'err') return 'error'
  if (s === 'w' || s === 'warn' || s === 'warning') return 'warn'
  if (s === 'd' || s === 'debug') return 'debug'
  return 'info'
}

function handleTabletLog(req: IncomingMessage, res: ServerResponse): void {
  const chunks: Buffer[] = []
  let total = 0
  let aborted = false

  req.on('data', (chunk: Buffer) => {
    total += chunk.length
    if (total > MAX_BODY_BYTES && !aborted) {
      aborted = true
      sendJson(res, 413, { error: 'body too large' })
      req.destroy()
      return
    }
    chunks.push(chunk)
  })

  req.on('end', () => {
    if (aborted) return
    let parsed: { host?: string; logs?: TabletLogEntry[] }
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
    } catch {
      sendJson(res, 400, { error: 'invalid json' })
      return
    }

    const host = typeof parsed.host === 'string' && parsed.host.length > 0 ? parsed.host : 'tablet'
    const logs = Array.isArray(parsed.logs) ? parsed.logs.slice(0, MAX_LOGS_PER_REQUEST) : []

    let accepted = 0
    for (const entry of logs) {
      if (!entry || typeof entry.msg !== 'string' || entry.msg.length === 0) continue
      const level = normalizeLevel(entry.level)
      const tag = typeof entry.tag === 'string' && entry.tag.length > 0 ? entry.tag : 'log'
      const line = `[tablet:${host}] ${tag}: ${entry.msg}`
      // Real problems (error/warn) stay in main.log so they remain visible.
      // Routine/info/debug (incl. the 5s VideoDecoder stats) go ONLY to the
      // dedicated tablet.log so they stop overwriting main.log.
      if (level === 'error') logger.error(line)
      else if (level === 'warn') logger.warn(line)
      else {
        const stamp = new Date().toISOString()
        writeTabletLogLine(`${stamp} [${level}] ${line}`)
      }
      accepted++
    }

    sendJson(res, 200, { ok: true, accepted })
  })

  req.on('error', (err) => {
    if (aborted) return
    aborted = true
    logger.warn(`tabletLogServer: request error: ${err.message}`)
    try { sendJson(res, 500, { error: 'request error' }) } catch {}
  })
}

export function startTabletLogServer(): void {
  if (server) return
  server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0]

    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (url === '/tablet-log' && req.method === 'POST') {
      handleTabletLog(req, res)
      return
    }

    if (url === '/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, service: 'tabletLogServer', port: PORT })
      return
    }

    sendJson(res, 404, { error: 'unknown route' })
  })

  server.on('error', (err) => {
    logger.warn(`tabletLogServer: listen error on ${HOST}:${PORT}: ${err.message}`)
  })

  server.listen(PORT, HOST, () => {
    logger.info(`tabletLogServer listening on http://${HOST}:${PORT}/tablet-log`)
  })
}

export function stopTabletLogServer(): void {
  if (!server) return
  server.close(() => logger.info('tabletLogServer stopped'))
  server = null
}

export const TABLET_LOG_PORT = PORT
