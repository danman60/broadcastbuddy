// Show monitor alerts + OBS dock (2026-10-29).
//
// Real BB app, LOCAL fakes only (never a real OBS/camera): an in-process obs-ws v5
// mock that answers GetRecordStatus/GetStreamStatus from a mutable object, and a
// fake OBSBOT HTTP server on 127.0.0.1 that logs every request. A raw WS client
// watches the `state.health` BB broadcasts; the /dock page is driven in Chromium.

import { test, expect, _electron as electron, chromium, ElectronApplication, Page } from '@playwright/test'
import path from 'path'
import http from 'http'
import { WebSocketServer, WebSocket, AddressInfo } from 'ws'

let app: ElectronApplication
let win: Page
const obsState = { outputActive: true, outputBytes: 1000, outputTimecode: '00:00:05.000', streaming: false }
let obsWss: WebSocketServer
let obsPort = 0
let camServer: http.Server
let camPort = 0
const camRequests: string[] = []
let hub: WebSocket
let lastState: any = null

const api = (fn: string, ...args: unknown[]) =>
  win.evaluate(([f, a]) => (window as any).api[f as string](...(a as unknown[])), [fn, args] as const)

function startMockObs(): Promise<void> {
  return new Promise((resolve) => {
    obsWss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    obsWss.on('connection', (s) => {
      s.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.0.0', rpcVersion: 1 } }))
      s.on('message', (raw: Buffer) => {
        const m = JSON.parse(raw.toString())
        if (m.op === 1) s.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }))
        if (m.op !== 6) return
        const { requestType, requestId } = m.d
        let responseData: unknown = {}
        if (requestType === 'GetRecordStatus') responseData = { ...obsState }
        if (requestType === 'GetStreamStatus') responseData = { outputActive: obsState.streaming }
        s.send(JSON.stringify({ op: 7, d: { requestType, requestId, requestStatus: { result: true, code: 100 }, responseData } }))
      })
    })
    obsWss.on('listening', () => { obsPort = (obsWss.address() as AddressInfo).port; resolve() })
  })
}

function startFakeCam(): Promise<void> {
  return new Promise((resolve) => {
    camServer = http.createServer((req, res) => {
      camRequests.push(`${req.method} ${req.url}`)
      res.setHeader('content-type', 'application/json')
      res.end(req.method === 'GET' ? '{"mode":"normal"}' : '{}')
    })
    camServer.listen(0, '127.0.0.1', () => { camPort = (camServer.address() as AddressInfo).port; resolve() })
  })
}

async function waitHealth(pred: (h: any) => boolean, ms = 15000): Promise<any> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (lastState?.health && pred(lastState.health)) return lastState.health
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('health never matched; last=' + JSON.stringify(lastState?.health))
}
const ids = (h: any) => h.alerts.map((a: any) => a.id)

test.beforeAll(async () => {
  await startMockObs()
  await startFakeCam()
  console.log(`fakes: OBS ws://127.0.0.1:${obsPort}  camera http://127.0.0.1:${camPort}`)
  app = await electron.launch({
    args: [path.join(__dirname, '..'), '--disable-gpu', '--no-sandbox'],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  await api('settingsSet', 'cameraHost', '127.0.0.1')
  await api('settingsSet', 'cameraPort', camPort)
  await api('obsConnect', '127.0.0.1', obsPort)
  hub = new WebSocket('ws://127.0.0.1:19081')
  await new Promise((r) => hub.on('open', r))
  hub.send(JSON.stringify({ type: 'identify', client: 'test' }))
  hub.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.type === 'state') lastState = m })
})

test.afterAll(async () => {
  try { await api('settingsSet', 'cameraHost', '') } catch { /* closing */ }
  try { await api('settingsSet', 'cameraPort', 80) } catch { /* closing */ }
  hub?.close()
  await app?.close()
  obsWss?.close()
  camServer?.close()
})

test('healthy: OBS up, recording, camera answering, no alerts', async () => {
  const grow = setInterval(() => { obsState.outputBytes += 5000 }, 1000)
  try {
    const h = await waitHealth((x) => x.obs && x.recording && x.cams[1] === true)
    expect(h.alerts).toEqual([])
    expect(h.recTimecode).toBe('00:00:05')
  } finally { clearInterval(grow) }
})

test('recording stalled → alert', async () => {
  const h = await waitHealth((x) => ids(x).includes('rec-stalled'))
  expect(h.alerts.find((a: any) => a.id === 'rec-stalled').text).toMatch(/STALLED/)
})

test('recording stopped → alert; ack dismisses it', async () => {
  obsState.outputActive = false
  await waitHealth((x) => ids(x).includes('rec-stopped') && !ids(x).includes('rec-stalled'))
  hub.send(JSON.stringify({ type: 'command', action: 'ackAlerts' }))
  await waitHealth((x) => !ids(x).includes('rec-stopped'))
})

test('BB stops the recording itself → no RECORDING STOPPED alarm', async () => {
  obsState.outputActive = true
  await waitHealth((x) => x.recording)
  hub.send(JSON.stringify({ type: 'command', action: 'toggleRecord' })) // mock ToggleRecord → outputActive absent = stopped
  await new Promise((r) => setTimeout(r, 500))
  obsState.outputActive = false
  await waitHealth((x) => !x.recording)
  await new Promise((r) => setTimeout(r, 6500)) // two more polls
  expect(ids(lastState.health)).not.toContain('rec-stopped')
})

test('dock renders and its buttons drive the camera', async () => {
  const browser = await chromium.launch()
  for (const width of [300, 500]) {
    const page = await browser.newPage({ viewport: { width, height: 760 } })
    await page.goto('http://127.0.0.1:19080/dock')
    await expect(page.locator('.chip', { hasText: 'OBS' })).toHaveClass(/ok/)
    await expect(page.locator('.chip', { hasText: 'CAM1' })).toHaveClass(/ok/)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    expect(overflow).toBe(false)
    await page.screenshot({ path: `tests/screenshots/dock-${width}.png`, fullPage: true })
    await page.close()
  }
  const page = await browser.newPage({ viewport: { width: 320, height: 760 } })
  await page.goto('http://127.0.0.1:19080/dock')
  await page.waitForTimeout(800)
  const before = camRequests.length
  await page.locator('#presets button', { hasText: '3' }).click()
  await expect.poll(() => camRequests.slice(before).join('\n'), { timeout: 5000 }).toMatch(/preset/i)
  console.log('camera requests after preset 3:', camRequests.slice(before))
  await expect(page.locator('#moving')).toContainText('moving to preset 3')
  await expect(page.locator('#presets button', { hasText: '3' })).toHaveClass(/moving/)
  // next performer line (title · subtitle of the trigger after the selected one)
  await win.evaluate(async () => {
    const api = (window as any).api
    await api.triggerAdd({ id: 'dock-n1', name: 'Dock One', title: 'Dock One', subtitle: 'FROM ONE', category: '', order: 900, logoDataUrl: '' })
    await api.triggerAdd({ id: 'dock-n2', name: 'Dock Two', title: 'Dock Two', subtitle: 'FROM TWO', category: '', order: 901, logoDataUrl: '' })
    const list = (await api.triggerList()).triggers
    await api.triggerSelect(list.findIndex((t: any) => t.id === 'dock-n1'))
  })
  await expect(page.locator('#next')).toContainText('NEXT: Dock Two · FROM TWO')
  await page.screenshot({ path: 'tests/screenshots/dock-moving-next.png', fullPage: true })
  await win.evaluate(async () => { const api = (window as any).api; await api.triggerDelete('dock-n1'); await api.triggerDelete('dock-n2') })
  await browser.close()
})

test('camera stops answering → camera alert; OBS gone → OBS alert', async () => {
  camServer.close()
  camServer.closeAllConnections()
  await waitHealth((x) => ids(x).includes('cam1-down') && x.cams[1] === false)
  for (const c of obsWss.clients) c.terminate()
  obsWss.close()
  await waitHealth((x) => ids(x).includes('obs-down') && !x.obs)
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 320, height: 760 } })
  await page.goto('http://127.0.0.1:19080/dock')
  await expect(page.locator('#alerts')).toBeVisible()
  await expect(page.locator('#alertList')).toContainText('CAMERA 1')
  await expect(page.locator('#alertList')).toContainText('OBS NOT RESPONDING')
  await page.screenshot({ path: 'tests/screenshots/dock-alerts.png', fullPage: true })
  await browser.close()
})
