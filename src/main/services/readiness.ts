// Pre-show readiness — the checklist that ticks ITSELF from live state (ten-and-ten
// 2026-10-29 feature 6). Every row is derived from services that already poll
// (showMonitor, voiceDirector, wsHub clients, session); the only thing polled here
// is OBS's record directory (writable? free space?). Dormant unless
// `readinessView` is 'panel' or 'dock' — getReadiness() returns null when off.

import fs from 'fs'
import * as obs from './obsConnection'
import * as settings from './settings'
import { getHealth } from './showMonitor'
import { getStatus as getVoiceStatus, getMicName } from './voiceDirector'
import { getCurrentSession } from './session'
import { getTriggers } from './overlay'
import { createLogger } from '../logger'
import type { ReadinessReport, ReadinessRow, ReadinessStatus } from '../../shared/types'

const logger = createLogger('readiness')

const POLL_MS = 3000
const HTTP_PORT = () => settings.get('server')?.httpPort ?? 19080

let timer: NodeJS.Timeout | null = null
let clientNames: () => string[] = () => []
let onChange: (() => void) | null = null
let lastJson = ''

// Record folder as last read from OBS: null = not asked yet / OBS down.
let recDir: { path: string; writable: boolean; freeGB: number } | null = null

function isOn(): boolean {
  const v = settings.get('readinessView')
  return v === 'panel' || v === 'dock'
}

function diskFreeGB(dir: string): number {
  try {
    // Windows statfs wants the drive root (same trick as systemMonitor.diskFor).
    const root = /^[a-zA-Z]:\\/.test(dir) ? dir.slice(0, 3) : dir
    const s = fs.statfsSync(root)
    return (s.bavail * s.bsize) / 1e9
  } catch {
    return -1
  }
}

async function pollRecordDir(): Promise<void> {
  if (!obs.isConnected()) {
    recDir = null
    return
  }
  try {
    const r = (await obs.sendRequest('GetRecordDirectory')) as { recordDirectory?: string } | null
    const p = r?.recordDirectory || ''
    let writable = false
    try {
      fs.accessSync(p, fs.constants.W_OK)
      writable = fs.statSync(p).isDirectory()
    } catch {
      writable = false
    }
    recDir = { path: p, writable, freeGB: writable ? diskFreeGB(p) : -1 }
  } catch (err) {
    logger.warn(`GetRecordDirectory failed: ${err instanceof Error ? err.message : err}`)
    recDir = null
  }
}

function row(id: string, label: string, status: ReadinessStatus, detail: string, fix?: string): ReadinessRow {
  return status === 'ok' || status === 'off' ? { id, label, status, detail } : { id, label, status, detail, fix }
}

export function getReadiness(): ReadinessReport | null {
  if (!isOn()) return null
  const s = settings.getAll()
  const h = getHealth()
  const v = getVoiceStatus()
  const clients = clientNames()
  const port = HTTP_PORT()
  const rows: ReadinessRow[] = []

  rows.push(h.obs
    ? row('obs', 'OBS', 'ok', 'connected')
    : row('obs', 'OBS', 'bad', 'not connected', 'Start OBS, then check Settings → OBS Connection (host, port, password).'))

  if (!h.obs) rows.push(row('rec', 'Recording folder', 'warn', 'unknown until OBS connects', 'Connect OBS so BB can read the recording folder.'))
  else if (!recDir) rows.push(row('rec', 'Recording folder', 'warn', 'reading…', 'Wait a few seconds; if this stays, check OBS → Settings → Output → Recording path.'))
  else if (!recDir.writable) rows.push(row('rec', 'Recording folder', 'bad', `${recDir.path || '(none)'} not writable`, 'OBS → Settings → Output → Recording path: pick a folder on the show drive that exists.'))
  else {
    const gb = Math.round(recDir.freeGB)
    const detail = `${recDir.path} · ${gb} GB free`
    if (recDir.freeGB < 20) rows.push(row('rec', 'Recording folder', 'bad', detail, 'Under 20 GB. Free space on that drive or record to a different one before the show.'))
    else if (recDir.freeGB < 50) rows.push(row('rec', 'Recording folder', 'warn', detail, 'Under 50 GB. Clear old recordings so a full day fits.'))
    else rows.push(row('rec', 'Recording folder', 'ok', detail))
  }

  const cam1 = (s.cameraHost || '').trim()
  if (!cam1 && !s.cameraAutoMode) rows.push(row('cam1', 'Camera 1', 'off', 'no camera set'))
  else rows.push(h.cams[1] === true
    ? row('cam1', 'Camera 1', 'ok', `${cam1 || '192.168.88.10'} answering`)
    : row('cam1', 'Camera 1', h.cams[1] === null ? 'warn' : 'bad', h.cams[1] === null ? 'checking…' : 'not answering', `Power the OBSBOT and check it is on this network at ${cam1 || '192.168.88.10'} (Settings → Camera).`))
  const cam2 = (s.cameraHost2 || '').trim()
  if (cam2) rows.push(h.cams[2] === true
    ? row('cam2', 'Camera 2', 'ok', `${cam2} answering`)
    : row('cam2', 'Camera 2', h.cams[2] === null ? 'warn' : 'bad', h.cams[2] === null ? 'checking…' : 'not answering', `Power camera 2 and check it is reachable at ${cam2} (Settings → Camera).`))

  if (s.voiceEnabled !== true) {
    rows.push(row('voice', 'Voice', 'off', 'off'))
    rows.push(row('mic', 'Voice mic', 'off', 'off'))
  } else {
    const mic = getMicName()
    rows.push(v.helper === 'ready'
      ? row('voice', 'Voice', 'ok', `ready · ${mic || 'default mic'}`)
      : v.helper === 'starting'
        ? row('voice', 'Voice', 'warn', 'starting…', 'Wait a few seconds. If it never turns green, restart BB.')
        : row('voice', 'Voice', 'bad', 'helper not running', 'Settings → Camera → Voice Control: turn Voice off and on; if it stays down, restart BB.'))
    const r = v.lastResult
    if (h.alerts.some((a) => a.id === 'voice-mic-silent') || r?.reason === 'mic-silent') rows.push(row('mic', 'Voice mic', 'bad', `${mic || 'mic'} heard silence`, 'Pick the right mic in Settings → Camera → Voice Control and hold to talk again.'))
    else if (!r) rows.push(row('mic', 'Voice mic', 'warn', 'not tested yet', 'Hold to talk once and say "preset 1" so BB hears the mic.'))
    else rows.push(row('mic', 'Voice mic', 'ok', `heard "${r.text}"`))
  }

  const sess = getCurrentSession()
  const n = getTriggers().length
  if (!sess) rows.push(row('session', 'Session', 'bad', 'none loaded', 'Load today\'s session (header → Sessions) so the lower thirds are ready.'))
  else if (n === 0) rows.push(row('session', 'Session', 'bad', `${sess.name} · 0 triggers`, 'This session has no lower thirds. Import or add the performers.'))
  else rows.push(row('session', 'Session', 'ok', `${sess.name} · ${n} triggers`))

  rows.push(clients.includes('overlay')
    ? row('overlay', 'Overlay source', 'ok', 'connected')
    : row('overlay', 'Overlay source', 'bad', 'not connected', `In OBS, refresh the browser source for http://127.0.0.1:${port}/overlay (or add one).`))
  rows.push(clients.includes('obs-dock')
    ? row('dock', 'OBS dock', 'ok', 'connected')
    : row('dock', 'OBS dock', 'warn', 'not connected', `OBS → Docks → Custom Browser Docks → http://127.0.0.1:${port}/dock.`))

  return { ready: rows.every((x) => x.status === 'ok' || x.status === 'off'), rows, at: Date.now() }
}

async function tick(): Promise<void> {
  if (!isOn()) {
    recDir = null
    if (lastJson) { lastJson = ''; onChange?.() } // turned off → clients drop the strip
    return
  }
  await pollRecordDir()
  const json = JSON.stringify({ ...getReadiness(), at: 0 })
  if (json !== lastJson) {
    lastJson = json
    onChange?.()
  }
}

/** Start the record-folder poll. `clients` = wsHub identified client names; `changed` fires on any row change. */
export function startReadiness(clients: () => string[], changed: () => void): void {
  clientNames = clients
  onChange = changed
  if (timer) return
  timer = setInterval(() => void tick(), POLL_MS)
  void tick()
}

export function stopReadiness(): void {
  if (timer) clearInterval(timer)
  timer = null
}
