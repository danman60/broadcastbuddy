// Show monitor — polls OBS + the OBSBOT cameras and raises operator alerts:
// OBS not responding, recording stopped / stalled, stream dropped, camera not
// responding. Alerts ride the WS state message (`health`) so the OBS dock and any
// other client can show them, and each NEW alert pops a native OS notification
// (visible over OBS — the operator rarely has BB in front during production).

import { Notification } from 'electron'
import * as obs from './obsConnection'
import { pingCamera } from './cameraDirector'
import { recordEvent } from './events'
import { createLogger } from '../logger'
import type { ShowAlert, ShowHealth } from '../../shared/types'

const logger = createLogger('showMonitor')

const POLL_MS = 3000
const CAM_FAILS_TO_ALERT = 2 // ~6 s of misses before "camera not responding"
const STALL_POLLS_TO_ALERT = 2 // recording bytes flat for ~6 s

let timer: NodeJS.Timeout | null = null
let polling = false
let onChange: (() => void) | null = null

const alerts = new Map<string, ShowAlert>()
let obsSeen = false // only alert on OBS loss once BB has actually talked to OBS
let recActive = false
let recTimecode = ''
let lastBytes = -1
let flatPolls = 0
let streamActive = false
const camOk: Record<1 | 2, boolean | null> = { 1: null, 2: null }
const camFails: Record<1 | 2, number> = { 1: 0, 2: 0 }

export function setOnHealthChanged(cb: () => void): void {
  onChange = cb
}

function raise(id: string, text: string): void {
  if (alerts.has(id)) return
  alerts.set(id, { id, text, since: Date.now(), acked: false })
  logger.warn(`ALERT ${id}: ${text}`)
  recordEvent('alert', text, { id })
  try {
    if (Notification.isSupported()) {
      new Notification({ title: 'BroadcastBuddy ALERT', body: text, urgency: 'critical' }).show()
    }
  } catch (err) {
    logger.warn(`notification failed: ${err instanceof Error ? err.message : err}`)
  }
  onChange?.()
}

function clear(id: string): void {
  if (!alerts.delete(id)) return
  logger.info(`cleared ${id}`)
  recordEvent('alert', `Cleared: ${id}`, { id })
  onChange?.()
}

/** Operator ack: silences every alert; one-shot events (recording stopped) are dismissed. */
export function ackAlerts(): void {
  alerts.delete('rec-stopped')
  alerts.delete('stream-down')
  for (const a of alerts.values()) a.acked = true
  onChange?.()
}

export function getHealth(): ShowHealth {
  return {
    obs: obs.isConnected(),
    recording: recActive,
    recTimecode,
    streaming: streamActive,
    cams: { 1: camOk[1], 2: camOk[2] },
    alerts: [...alerts.values()],
  }
}

async function pollObs(): Promise<void> {
  if (!obs.isConnected()) {
    if (obsSeen) raise('obs-down', 'OBS NOT RESPONDING — BB lost its OBS connection')
    return
  }
  let rec: { outputActive?: boolean; outputBytes?: number; outputTimecode?: string } | null
  try {
    rec = (await obs.sendRequest('GetRecordStatus')) as typeof rec
  } catch {
    if (obsSeen) raise('obs-down', 'OBS NOT RESPONDING — requests timing out')
    return
  }
  obsSeen = true
  clear('obs-down')

  const active = !!rec?.outputActive
  recTimecode = active ? (rec?.outputTimecode || '').replace(/\.\d+$/, '') : ''
  if (recActive && !active) raise('rec-stopped', 'OBS RECORDING STOPPED')
  if (active) clear('rec-stopped')
  recActive = active

  const bytes = typeof rec?.outputBytes === 'number' ? rec.outputBytes : -1
  if (active && bytes >= 0 && bytes === lastBytes) {
    if (++flatPolls >= STALL_POLLS_TO_ALERT) raise('rec-stalled', 'RECORDING STALLED — file not growing')
  } else {
    flatPolls = 0
    clear('rec-stalled')
  }
  lastBytes = active ? bytes : -1

  try {
    const st = (await obs.sendRequest('GetStreamStatus')) as { outputActive?: boolean } | null
    const live = !!st?.outputActive
    if (streamActive && !live) raise('stream-down', 'STREAM DROPPED')
    if (live) clear('stream-down')
    streamActive = live
  } catch {
    /* covered by the record request above */
  }
}

async function pollCam(id: 1 | 2): Promise<void> {
  const ok = await pingCamera(id)
  if (ok === null) {
    // not configured → no alert, no status
    camOk[id] = null
    camFails[id] = 0
    clear(`cam${id}-down`)
    return
  }
  if (ok) {
    camFails[id] = 0
    camOk[id] = true
    clear(`cam${id}-down`)
  } else if (++camFails[id] >= CAM_FAILS_TO_ALERT) {
    camOk[id] = false
    raise(`cam${id}-down`, `CAMERA ${id} (OBSBOT) NOT RESPONDING`)
  }
}

async function tick(): Promise<void> {
  if (polling) return
  polling = true
  const before = JSON.stringify(getHealth())
  try {
    await Promise.all([pollObs(), pollCam(1), pollCam(2)])
  } catch (err) {
    logger.error('poll failed:', err)
  } finally {
    polling = false
  }
  if (JSON.stringify(getHealth()) !== before) onChange?.()
}

export function startShowMonitor(): void {
  if (timer) return
  timer = setInterval(() => void tick(), POLL_MS)
  void tick()
  logger.info('show monitor started')
}

export function stopShowMonitor(): void {
  if (timer) clearInterval(timer)
  timer = null
}
