// Pre-show readiness view (2026-10-29, ten-and-ten feature 6) — both designs behind
// settings.readinessView ('off' | 'panel' | 'dock'). Real BB app, LOCAL fakes only:
// in-process obs-ws v5 mock (answers GetRecordDirectory from a mutable path), fake
// OBSBOT HTTP server, and a raw WS client that identifies as the OBS browser source.

import { test, expect, _electron as electron, chromium, ElectronApplication, Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'
import http from 'http'
import { WebSocketServer, WebSocket, AddressInfo } from 'ws'

let app: ElectronApplication
let win: Page
// The folder row is amber under 50 GB free, so the "all green" path needs a roomy filesystem:
// first candidate with ≥ 50 GB wins (this box: /tmp 44 GB, /mnt/firmament 110 GB).
const freeGB = (d: string) => { try { const f = fs.statfsSync(d); return (f.bavail * f.bsize) / 1e9 } catch { return -1 } }
const recBase = [os.tmpdir(), '/mnt/firmament/tmp', os.homedir()].find((d) => { try { fs.mkdirSync(d, { recursive: true }); return freeGB(d) >= 50 } catch { return false } }) || os.tmpdir()
const recDir = fs.mkdtempSync(path.join(recBase, 'bb-rec-'))
const roomy = freeGB(recDir) >= 50
const obsState = { outputActive: false, outputBytes: 0, outputTimecode: '', streaming: false, recordDirectory: recDir }
let obsWss: WebSocketServer
let obsPort = 0
let camServer: http.Server
let camPort = 0
let overlayWs: WebSocket | null = null
const consoleErrors: string[] = []
let saved = { cameraHost: '', cameraPort: 80, cameraAutoMode: false, compactMode: false }

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
        if (requestType === 'GetRecordStatus') responseData = { outputActive: obsState.outputActive, outputBytes: obsState.outputBytes, outputTimecode: obsState.outputTimecode }
        if (requestType === 'GetStreamStatus') responseData = { outputActive: obsState.streaming }
        if (requestType === 'GetRecordDirectory') responseData = { recordDirectory: obsState.recordDirectory }
        s.send(JSON.stringify({ op: 7, d: { requestType, requestId, requestStatus: { result: true, code: 100 }, responseData } }))
      })
    })
    obsWss.on('listening', () => { obsPort = (obsWss.address() as AddressInfo).port; resolve() })
  })
}

function startFakeCam(): Promise<void> {
  return new Promise((resolve) => {
    camServer = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(req.method === 'GET' ? '{"mode":"normal"}' : '{}')
    })
    camServer.listen(0, '127.0.0.1', () => { camPort = (camServer.address() as AddressInfo).port; resolve() })
  })
}

function connectOverlay(): Promise<void> {
  return new Promise((resolve) => {
    overlayWs = new WebSocket('ws://127.0.0.1:19081')
    overlayWs.on('open', () => { overlayWs!.send(JSON.stringify({ type: 'identify', client: 'overlay' })); resolve() })
  })
}

type Report = { ready: boolean; rows: Array<{ id: string; label: string; status: string; detail: string; fix?: string }> } | null
const rowOf = (r: Report, id: string) => r?.rows.find((x) => x.id === id)
async function waitReport(pred: (r: Report) => boolean, ms = 15000): Promise<Report> {
  const end = Date.now() + ms
  let last: Report = null
  while (Date.now() < end) {
    last = (await api('readinessGet')) as Report
    if (pred(last)) return last
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('readiness never matched; last=' + JSON.stringify(last))
}

test.beforeAll(async () => {
  await startMockObs()
  await startFakeCam()
  console.log(`fakes: OBS ws://127.0.0.1:${obsPort}  camera http://127.0.0.1:${camPort}  recDir ${recDir}`)
  app = await electron.launch({
    args: [path.join(__dirname, '..'), '--disable-gpu', '--no-sandbox'],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  win = await app.firstWindow()
  win.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('app: ' + m.text()) })
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  await api('dayChecklistDismiss', '', 'start')
  // This box's real config is in play: park the operator's camera/compact settings for the run.
  const s = (await api('settingsGet')) as any
  saved = { cameraHost: s.cameraHost || '', cameraPort: s.cameraPort ?? 80, cameraAutoMode: s.cameraAutoMode === true, compactMode: s.compactMode === true }
  await api('settingsSet', 'cameraHost', '')
  await api('settingsSet', 'cameraAutoMode', false)
  if (saved.compactMode) await win.locator('button', { hasText: 'Compact' }).click()
})

test.afterAll(async () => {
  console.log('console errors:', consoleErrors.length ? consoleErrors.join('\n') : 'none')
  try { await api('settingsSet', 'readinessView', 'off') } catch { /* closing */ }
  for (const [k, v] of Object.entries(saved)) { try { await api('settingsSet', k, v) } catch { /* closing */ } }
  overlayWs?.close()
  await app?.close()
  obsWss?.close()
  camServer?.close()
  fs.rmSync(recDir, { recursive: true, force: true })
})

test('default off: no report, no strip in the dock', async () => {
  expect(((await api('settingsGet')) as any).readinessView).toBe('off')
  expect(await api('readinessGet')).toBeNull()
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 300, height: 600 } })
  await page.goto('http://127.0.0.1:19080/dock')
  await expect(page.locator('.chip', { hasText: 'OBS' })).toBeVisible()
  await expect(page.locator('#ready')).toBeHidden()
  await expect(win.locator('.readiness-panel')).toHaveCount(0)
  await browser.close()
})

async function pickView(view: 'off' | 'panel' | 'dock'): Promise<void> {
  await win.locator('button', { hasText: 'Settings' }).first().click()
  const sel = win.locator('.settings-group', { hasText: 'Pre-show Readiness' }).locator('select')
  await sel.selectOption(view)
  await expect.poll(async () => ((await api('settingsGet')) as any).readinessView).toBe(view)
  await win.screenshot({ path: `tests/screenshots/readiness-settings-${view}.png` })
  await win.locator('.settings-header button', { hasText: 'Close' }).click()
}

test('panel: rows tick themselves from live state and go READY', async () => {
  await pickView('panel')
  // Before anything is wired: OBS/overlay/session red, each red row has a fix line.
  let r = await waitReport((x) => !!x && rowOf(x, 'obs')?.status === 'bad')
  for (const row of r!.rows.filter((x) => x.status === 'bad' || x.status === 'warn')) expect(row.fix, row.id).toBeTruthy()
  expect(rowOf(r, 'cam1')?.status).toBe('off')
  expect(rowOf(r, 'voice')?.status).toBe('off')
  await expect(win.locator('.readiness-panel .readiness-badge')).toContainText('TO FIX')
  await win.locator('.readiness-panel').screenshot({ path: 'tests/screenshots/readiness-panel-red.png' })

  // Wire the show up: OBS + camera + session with triggers + overlay source + a dock.
  await api('settingsSet', 'cameraHost', '127.0.0.1')
  await api('settingsSet', 'cameraPort', camPort)
  await api('obsConnect', '127.0.0.1', obsPort)
  await api('sessionNew', 'Readiness Test', false)
  await api('triggerAdd', { id: 'rd-1', name: 'One', title: 'One', subtitle: 'FROM ONE', category: '', order: 1, logoDataUrl: '' })
  await api('triggerAdd', { id: 'rd-2', name: 'Two', title: 'Two', subtitle: 'FROM TWO', category: '', order: 2, logoDataUrl: '' })
  await connectOverlay()
  const browser = await chromium.launch()
  const dock = await browser.newPage({ viewport: { width: 300, height: 600 } })
  await dock.goto('http://127.0.0.1:19080/dock')

  console.log(`recDir ${recDir} · ${Math.round(freeGB(recDir))} GB free · expecting ${roomy ? 'READY' : 'amber folder row'}`)
  r = await waitReport((x) => rowOf(x, 'rec')?.status === (roomy ? 'ok' : 'warn') && rowOf(x, 'overlay')?.status === 'ok' && rowOf(x, 'dock')?.status === 'ok' && rowOf(x, 'cam1')?.status === 'ok', 20000)
  console.log('rows:', r!.rows.map((x) => `${x.id}=${x.status} (${x.detail})`).join(' | '))
  expect(r!.ready).toBe(roomy)
  expect(rowOf(r, 'rec')?.detail).toContain(recDir)
  expect(rowOf(r, 'session')?.detail).toBe('Readiness Test · 2 triggers')
  await expect(win.locator('.readiness-panel .readiness-badge')).toHaveText(roomy ? 'READY' : '1 TO FIX')
  await expect(win.locator('.readiness-panel .readiness-row.bad')).toHaveCount(0)
  await win.screenshot({ path: 'tests/screenshots/readiness-panel-main.png' })
  await win.locator('.readiness-panel').screenshot({ path: 'tests/screenshots/readiness-panel-ready.png' })
  // The dock itself shows nothing in 'panel' mode.
  await expect(dock.locator('#ready')).toBeHidden()
  await browser.close()
})

test('panel: recording folder unwritable → red with a plain-English fix', async () => {
  obsState.recordDirectory = path.join(recDir, 'does-not-exist')
  const r = await waitReport((x) => rowOf(x, 'rec')?.status === 'bad')
  expect(rowOf(r, 'rec')?.fix).toMatch(/Recording path/)
  expect(r!.ready).toBe(false)
  await expect(win.locator('.readiness-panel .readiness-row.bad .readiness-fix')).toContainText('Recording path')
  await win.locator('.readiness-panel').screenshot({ path: 'tests/screenshots/readiness-panel-rec-bad.png' })
  obsState.recordDirectory = recDir
  await waitReport((x) => rowOf(x, 'rec')?.status !== 'bad')
})

test('dock: one READY chip when all pass; rows + fix lines when not; 300/500 px no overflow', async () => {
  await pickView('dock')
  await expect(win.locator('.readiness-panel')).toHaveCount(0)
  const browser = await chromium.launch()
  for (const width of [300, 500]) {
    const page = await browser.newPage({ viewport: { width, height: 760 } })
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('dock: ' + m.text()) })
    page.on('pageerror', (e) => consoleErrors.push('dock pageerror: ' + e.message))
    await page.goto('http://127.0.0.1:19080/dock')
    test.skip(!roomy, 'no filesystem with ≥ 50 GB free on this box — READY chip path not exercised')
    await expect(page.locator('#ready')).toHaveClass(/ok/, { timeout: 15000 })
    await expect(page.locator('#readyText')).toHaveText('● READY · voice off')
    await expect(page.locator('#readyRows')).toBeHidden() // collapsed
    const overflow = async () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    expect(await overflow()).toBe(false)
    await page.screenshot({ path: `tests/screenshots/readiness-dock-ready-${width}.png`, fullPage: true })
    await page.locator('#readyHead').click() // tap → expand the checks
    await expect(page.locator('#readyRows .rrow')).toHaveCount(8)
    expect(await overflow()).toBe(false)
    await page.screenshot({ path: `tests/screenshots/readiness-dock-open-${width}.png`, fullPage: true })
    await page.close()
  }
  // Break the overlay source: strip turns amber/red and auto-expands with the fix.
  overlayWs?.close(); overlayWs = null
  const page = await browser.newPage({ viewport: { width: 300, height: 760 } })
  await page.goto('http://127.0.0.1:19080/dock')
  await expect(page.locator('#ready')).toHaveClass(/bad/, { timeout: 15000 })
  await expect(page.locator('#readyText')).toContainText('1 TO FIX')
  expect(consoleErrors.filter((e) => e.startsWith('dock'))).toEqual([])
  await expect(page.locator('#readyRows')).toBeVisible()
  await expect(page.locator('.rrow.bad .fix')).toContainText('/overlay')
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
  await page.screenshot({ path: 'tests/screenshots/readiness-dock-tofix-300.png', fullPage: true })
  await browser.close()
})
