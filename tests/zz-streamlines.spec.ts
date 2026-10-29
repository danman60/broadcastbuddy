import { test, expect, _electron as electron, chromium, ElectronApplication, Browser, Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import http from 'http'
import { WebSocket, WebSocketServer, AddressInfo } from 'ws'

const root = path.resolve(__dirname, '..')
const phase = process.env.BB_PROOF_PHASE || 'after'
let app: ElectronApplication
let win: Page
let browser: Browser
let dock: Page
let overlay: Page
let cam: http.Server
let obs: WebSocketServer
const requests: string[] = []
const errors: string[] = []
const api = (fn: string, ...args: unknown[]) => win.evaluate(
  ([name, values]) => (window as any).api[name as string](...(values as unknown[])), [fn, args] as const,
)

test.beforeAll(async () => {
  fs.mkdirSync(path.join(root, '.wf-streamlines'), { recursive: true })
  cam = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`)
    res.setHeader('content-type', 'application/json')
    res.end(req.method === 'GET' ? '{"mode":"normal"}' : '{}')
  })
  await new Promise<void>(resolve => cam.listen(0, '127.0.0.1', resolve))
  obs = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  obs.on('connection', socket => {
    socket.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.0.0', rpcVersion: 1 } }))
    socket.on('message', raw => {
      const m = JSON.parse(raw.toString())
      if (m.op === 1) socket.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }))
      if (m.op === 6) socket.send(JSON.stringify({ op: 7, d: {
        requestId: m.d.requestId, requestType: m.d.requestType,
        requestStatus: { result: true, code: 100 }, responseData: { outputActive: false },
      } }))
    })
  })
  await new Promise<void>(resolve => obs.on('listening', resolve))
  const profile = fs.mkdtempSync(path.join(root, '.wf-streamlines', `visual-${phase}-profile-`))
  app = await electron.launch({
    args: [root, `--user-data-dir=${profile}`, '--disable-gpu', '--no-sandbox'],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  const log = fs.createWriteStream(path.join(root, '.wf-streamlines', `visual-${phase}-server.log`))
  app.process().stdout?.pipe(log, { end: false })
  app.process().stderr?.pipe(log, { end: false })
  app.process().once('close', () => log.end())
  win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await expect(win.locator('.settings-header .btn-ghost')).toBeVisible({ timeout: 10000 })
  await win.locator('.settings-header .btn-ghost').click()
  await api('settingsSet', 'cameraHost', '127.0.0.1')
  await api('settingsSet', 'cameraHost2', '127.0.0.1')
  await api('settingsSet', 'cameraPort', (cam.address() as AddressInfo).port)
  await api('settingsSet', 'cameraPort2', (cam.address() as AddressInfo).port)
  await api('obsConnect', '127.0.0.1', (obs.address() as AddressInfo).port)
  browser = await chromium.launch()
  const context = await browser.newContext()
  // The comparison uses system fonts and never fetches external font/assets.
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
    ? route.continue() : route.abort())
  context.on('page', page => page.on('pageerror', e => errors.push(e.message)))
  dock = await context.newPage()
  await dock.goto('http://127.0.0.1:19080/dock')
  await expect(dock.locator('.chip', { hasText: /^OBS$/ })).toHaveClass(/ok/, { timeout: 10000 })
  await expect(dock.locator('.chip', { hasText: /^CAM2$/ })).toHaveClass(/ok/)
  overlay = await context.newPage()
  await overlay.setViewportSize({ width: 1920, height: 1080 })
  await overlay.goto('http://127.0.0.1:19080/overlay')
})

test.afterAll(async () => {
  await browser?.close()
  await app?.close()
  for (const s of obs?.clients || []) s.terminate()
  obs?.close()
  cam?.close()
  cam?.closeAllConnections()
  expect(errors).toEqual([])
})

test('empty dock fits desktop and narrow widths; fired lower third is captured', async () => {
  for (const width of [300, 390, 500, 1440]) {
    await dock.setViewportSize({ width, height: 900 })
    expect(await dock.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(dock.locator('#presets button')).toHaveCount(8)
    await dock.screenshot({ path: `tests/screenshots/streamlines-${phase}-dock-${width}.png`, fullPage: true })
  }
  for (const [i, title] of ['Streamlines fixture one', 'Streamlines fixture two'].entries()) {
    await api('triggerAdd', { id: `streamlines-${i}`, name: title, title, subtitle: 'Overlay comparison fixture', category: '', order: i, logoDataUrl: '' })
  }
  await api('triggerSelect', 0)
  await api('overlayUpdateStyling', { autoHideSeconds: 0, animation: 'fade', animationDuration: 0.3 })
  await dock.locator('[data-cmd="fireLT"]').click()
  await expect(overlay.locator('#lt')).toHaveClass(/visible/)
  await expect(overlay.locator('#lt-title')).toHaveText('Streamlines fixture one')
  await overlay.waitForTimeout(1500)
  await overlay.screenshot({ path: `tests/screenshots/streamlines-${phase}-overlay.png` })
  await dock.locator('[data-cmd="hideLT"]').click()
  await expect(overlay.locator('#lt')).not.toHaveClass(/visible/)
})

test('dock controls, refresh, navigation, auto-hide and ad-hoc remain usable', async () => {
  await dock.locator('#cam2').click()
  await expect(dock.locator('#cam2')).toHaveClass(/on/)
  await dock.locator('#cam1').click()
  await expect(dock.locator('#cam1')).toHaveClass(/on/)
  for (let i = 1; i <= 8; i++) await dock.locator('#presets button', { hasText: new RegExp(`^${i}$`) }).click()
  await expect.poll(() => requests.filter(r => /preset/i.test(r)).length).toBeGreaterThanOrEqual(8)
  for (const cmd of ['cameraWide', 'cameraAuto', 'cameraStop']) await dock.locator(`[data-cmd="${cmd}"]`).click()
  await dock.locator('#ptt').hover()
  await dock.mouse.down()
  await expect(dock.locator('#ptt')).toHaveClass(/held/)
  await dock.mouse.up()
  await expect(dock.locator('#ptt')).not.toHaveClass(/held/)
  await dock.locator('[data-cmd="nextTrigger"]').click()
  await expect(dock.locator('#lt')).toContainText('Streamlines fixture two')
  await dock.locator('[data-cmd="prevTrigger"]').click()
  await expect(dock.locator('#next')).toContainText('Streamlines fixture two')
  await dock.reload()
  await expect(dock.locator('#next')).toContainText('Streamlines fixture two')
  await api('overlayUpdateStyling', { autoHideSeconds: 1 })
  await dock.locator('[data-cmd="fireLT"]').click()
  await expect(overlay.locator('#lt')).toHaveClass(/visible/)
  await expect(overlay.locator('#lt')).not.toHaveClass(/visible/, { timeout: 4000 })
  const title = win.getByPlaceholder('Title (required)')
  await title.click()
  await title.pressSequentially('Ad-hoc comparison fixture')
  await win.getByRole('button', { name: 'Send to OBS', exact: true }).click()
  await expect(overlay.locator('#lt-title')).toHaveText('Ad-hoc comparison fixture')
  await expect(overlay.locator('#lt')).not.toHaveClass(/visible/, { timeout: 4000 })
  await api('triggerUpdate', 'streamlines-0', { type: 'feature' })
  await dock.locator('[data-cmd="fireLT"]').click()
  await expect.poll(async () => (await api('overlayGetState')).featureCard.visible).toBe(true)
  await expect.poll(async () => (await api('overlayGetState')).featureCard.visible).toBe(false)
})

test('dock shows disconnection and acknowledgment then reconnects', async () => {
  await dock.context().setOffline(true)
  await expect(dock.locator('#alertList')).toContainText('BROADCASTBUDDY NOT RESPONDING', { timeout: 10000 })
  await dock.locator('#ack').click()
  await expect(dock.locator('#alerts')).toHaveClass(/acked/)
  await dock.context().setOffline(false)
  await expect(dock.locator('.chip', { hasText: /^OBS$/ })).toHaveClass(/ok/, { timeout: 10000 })
})

test('real heartbeat retains a responsive client and disconnects a silent client', async () => {
  test.setTimeout(75000)
  const healthy = new WebSocket('ws://127.0.0.1:19081')
  const silent = new WebSocket('ws://127.0.0.1:19081', { autoPong: false })
  let pings = 0
  healthy.on('ping', () => pings++)
  try {
    await Promise.all([healthy, silent].map(socket => new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })))
    await expect.poll(() => silent.readyState, { timeout: 65000, intervals: [1000] }).toBe(WebSocket.CLOSED)
    expect(pings).toBeGreaterThanOrEqual(2)
    expect(healthy.readyState).toBe(WebSocket.OPEN)
    await api('triggerUpdate', 'streamlines-0', { type: 'lower_third' })
    await api('overlayUpdateStyling', { autoHideSeconds: 0 })
    await dock.locator('[data-cmd="fireLT"]').click()
    await expect(overlay.locator('#lt')).toHaveClass(/visible/)
    await dock.locator('[data-cmd="hideLT"]').click()
  } finally {
    healthy.terminate()
    silent.terminate()
  }
})
