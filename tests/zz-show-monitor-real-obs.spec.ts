// Show monitor against a REAL OBS (2026-10-29). Opt-in only — needs an explicit
// throwaway OBS: OBS_REAL_PORT=<ws port, no auth> OBS_REAL_PID=<its pid>. Never
// point this at a show machine: it starts/stops recording and SIGSTOPs the pid.

import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'
import { WebSocket } from 'ws'

const PORT = Number(process.env.OBS_REAL_PORT)
const PID = Number(process.env.OBS_REAL_PID)
test.skip(!PORT || !PID, 'set OBS_REAL_PORT + OBS_REAL_PID for a throwaway OBS')

let app: ElectronApplication
let win: Page
let hub: WebSocket
let lastState: any = null

const api = (fn: string, ...args: unknown[]) =>
  win.evaluate(([f, a]) => (window as any).api[f as string](...(a as unknown[])), [fn, args] as const)
const ids = (h: any) => h.alerts.map((a: any) => a.id)
// camera alerts ignored: this rig has no OBSBOT; only OBS-side alerts are under test
const obsAlerts = (h: any) => ids(h).filter((i: string) => !i.startsWith('cam'))

async function waitHealth(pred: (h: any) => boolean, ms = 20000): Promise<any> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (lastState?.health && pred(lastState.health)) return lastState.health
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('health never matched; last=' + JSON.stringify(lastState?.health))
}

// Separate obs-ws client = "OBS stopped recording on its own" (not via BB).
async function obsDirect(requestType: string): Promise<void> {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`)
  await new Promise<void>((resolve, reject) => {
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString())
      if (m.op === 0) ws.send(JSON.stringify({ op: 1, d: { rpcVersion: 1 } }))
      if (m.op === 2) ws.send(JSON.stringify({ op: 6, d: { requestType, requestId: 'x' } }))
      if (m.op === 7) { ws.close(); m.d.requestStatus.result ? resolve() : reject(new Error(JSON.stringify(m.d))) }
    })
    ws.on('error', reject)
  })
}

test.beforeAll(async () => {
  console.log(`REAL OBS target: ws://127.0.0.1:${PORT} pid ${PID}`)
  app = await electron.launch({
    args: [path.join(__dirname, '..'), '--disable-gpu', '--no-sandbox'],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  hub = new WebSocket('ws://127.0.0.1:19081')
  await new Promise((r) => hub.on('open', r))
  hub.send(JSON.stringify({ type: 'identify', client: 'test' }))
  hub.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.type === 'state') lastState = m })
  await api('obsConnect', '127.0.0.1', PORT)
})

test.afterAll(async () => {
  try { process.kill(PID, 'SIGCONT') } catch { /* gone */ }
  try { await obsDirect('StopRecord') } catch { /* not recording */ }
  hub?.close()
  await app?.close()
})

test('BB starts a real recording; timecode advances', async () => {
  await waitHealth((h) => h.obs)
  hub.send(JSON.stringify({ type: 'command', action: 'toggleRecord' }))
  const h1 = await waitHealth((h) => h.recording && /^\d\d:\d\d:\d\d$/.test(h.recTimecode))
  const h2 = await waitHealth((h) => h.recording && h.recTimecode !== h1.recTimecode)
  expect(obsAlerts(h2)).toEqual([])
  console.log('timecodes', h1.recTimecode, '→', h2.recTimecode)
})

test('OBS stops recording on its own → RECORDING STOPPED alert', async () => {
  try { await obsDirect('StartRecord') } catch { /* already recording */ }
  await waitHealth((x) => x.recording)
  await obsDirect('StopRecord')
  const h = await waitHealth((x) => ids(x).includes('rec-stopped'))
  console.log('alert:', h.alerts.map((a: any) => a.text))
})

test('OBS frozen (SIGSTOP) → NOT RESPONDING; unfreeze → clears', async () => {
  hub.send(JSON.stringify({ type: 'command', action: 'ackAlerts' }))
  await obsDirect('StartRecord')
  await waitHealth((x) => x.recording && !ids(x).includes('rec-stopped'))
  const t0 = Date.now()
  process.kill(PID, 'SIGSTOP')
  const h = await waitHealth((x) => ids(x).includes('obs-down'), 30000)
  console.log(`obs-down after ${Math.round((Date.now() - t0) / 1000)}s:`, h.alerts.map((a: any) => a.text))
  process.kill(PID, 'SIGCONT')
  await waitHealth((x) => !ids(x).includes('obs-down') && x.recording, 30000)
})
