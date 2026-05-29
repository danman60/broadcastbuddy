// Headless runtime test of the OBS browser source (item 5).
//
// The overlay HTML served at GET /overlay is a PASSIVE client: it opens a
// WebSocket to the hub (:9877), identifies as `overlay`, and renders whatever
// full-state message the hub pushes. No OBS required — we render that exact
// page in a real Chromium tab, drive overlay state from the Electron control
// surface (window.api → IPC → state mutation → wsHub.broadcastState), and
// assert the browser-source DOM reflects the pushed state.
//
// This exercises the real path end-to-end: IPC handler → overlay state machine
// → WS broadcast → browser-source applyState() → DOM.

import { test, expect, _electron as electron, ElectronApplication, Page, chromium, Browser } from '@playwright/test'
import path from 'path'

let app: ElectronApplication
let win: Page // Electron control window (drives state via window.api)
let browser: Browser
let overlay: Page // Chromium tab rendering http://127.0.0.1:<port>/overlay
let wsPort = 9877

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(__dirname, '..'), '--disable-gpu', '--no-sandbox'],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)

  const settings = await win.evaluate(async () => window.api.settingsGet())
  const httpPort = settings.server?.httpPort || 9876
  wsPort = settings.server?.wsPort || 9877

  // Clean slate, then seed a known trigger so the lower third has content.
  await win.evaluate(async () => {
    await window.api.triggerClearAll()
    await window.api.triggerAdd({
      id: 'sm-1', name: 'SM One', title: 'Ada Lovelace', subtitle: 'Mathematician',
      category: '', order: 0, logoDataUrl: '',
    })
    await window.api.triggerSelect(0)
  })

  browser = await chromium.launch()
  overlay = await browser.newPage()
  await overlay.goto(`http://127.0.0.1:${httpPort}/overlay`)
  // Overlay opens its WS + identifies on load; give it time to connect and
  // receive the initial full-state push.
  await overlay.waitForTimeout(1200)
})

test.afterAll(async () => {
  await browser?.close()
  await app?.close()
})

// Let a pushed state propagate WS → browser source → DOM.
async function settle() {
  await overlay.waitForTimeout(350)
}

// Send a {type:'command'} over a fresh WS client (the Stream Deck transport).
async function sendCommand(action: string, data?: Record<string, unknown>) {
  const { WebSocket } = await import('ws')
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`)
    const to = setTimeout(() => { ws.terminate(); reject(new Error('ws timeout')) }, 4000)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'identify', client: 'streamdeck' }))
      ws.send(JSON.stringify({ type: 'command', action, data }))
      setTimeout(() => { clearTimeout(to); ws.close(); resolve() }, 600)
    })
    ws.on('error', (e) => { clearTimeout(to); reject(e as Error) })
  })
  await settle()
}

test('overlay page loads and connects to the hub', async () => {
  await expect(overlay.locator('#lt')).toHaveCount(1)
  await expect(overlay.locator('#ticker')).toHaveCount(1)
  await expect(overlay.locator('#bb-clock')).toHaveCount(1)
  await overlay.screenshot({ path: 'test-results/sm-00-loaded.png' })
})

test('lower third: fire pushes visible + trigger text to the browser source', async () => {
  await win.evaluate(() => window.api.overlayFireLT()); await settle()
  await expect(overlay.locator('#lt')).toHaveClass(/visible/)
  await expect(overlay.locator('#lt-title')).toHaveText('Ada Lovelace')
  await expect(overlay.locator('#lt-subtitle')).toHaveText('Mathematician')
  await overlay.screenshot({ path: 'test-results/sm-01-lt-fired.png' })
})

test('lower third: hide removes the visible class', async () => {
  await win.evaluate(() => window.api.overlayHideLT()); await settle()
  await expect(overlay.locator('#lt')).not.toHaveClass(/visible/)
})

test('ticker: show pushes text + visible, hide clears it', async () => {
  await win.evaluate(() => window.api.tickerShow('BREAKING: headless test', 60, '#000000', '#ffffff')); await settle()
  await expect(overlay.locator('#ticker')).toHaveClass(/visible/)
  await expect(overlay.locator('#ticker-text')).toHaveText('BREAKING: headless test')
  await win.evaluate(() => window.api.tickerHide()); await settle()
  await expect(overlay.locator('#ticker')).not.toHaveClass(/visible/)
})

test('grid: toggle drives the leveling grid visibility', async () => {
  await win.evaluate(() => window.api.overlayGridToggle()); await settle()
  await expect(overlay.locator('#bb-grid')).toHaveClass(/visible/)
  await win.evaluate(() => window.api.overlayGridToggle()); await settle()
  await expect(overlay.locator('#bb-grid')).not.toHaveClass(/visible/)
})

test('clock: toggle shows the on-air clock and renders a time string', async () => {
  await win.evaluate(() => window.api.overlayClockToggle()); await settle()
  await expect(overlay.locator('#bb-clock')).toHaveClass(/visible/)
  const txt = await overlay.locator('#bb-clock-time').textContent()
  expect((txt || '').trim().length).toBeGreaterThan(0)
  await win.evaluate(() => window.api.overlayClockToggle()); await settle()
  await expect(overlay.locator('#bb-clock')).not.toHaveClass(/visible/)
})

test('counter: toggle + set drives the numeric badge', async () => {
  await win.evaluate(() => window.api.overlayCounterToggle()); await settle()
  await expect(overlay.locator('#bb-counter')).toHaveClass(/visible/)
  await win.evaluate(() => window.api.overlayCounterSet(42, 'ENTRY')); await settle()
  await expect(overlay.locator('#bb-counter-number')).toHaveText('42')
  await expect(overlay.locator('#bb-counter-label')).toHaveText('ENTRY')
  await win.evaluate(() => window.api.overlayCounterToggle()); await settle()
  await expect(overlay.locator('#bb-counter')).not.toHaveClass(/visible/)
})

test('feature card: show drives the full-screen graphic + text', async () => {
  await win.evaluate(() => window.api.overlayFeatureShow({ kicker: 'UP NEXT', title: 'Grace Hopper', subtitle: 'Compiler pioneer' })); await settle()
  await expect(overlay.locator('#bb-feature-card')).toHaveClass(/visible/)
  await expect(overlay.locator('#bb-fc-kicker')).toHaveText('UP NEXT')
  await expect(overlay.locator('#bb-fc-title')).toHaveText('Grace Hopper')
  await overlay.screenshot({ path: 'test-results/sm-02-feature-card.png' })
  await win.evaluate(() => window.api.overlayFeatureHide())
  // Exit animation runs ~700ms before the visible class drops.
  await overlay.waitForTimeout(950)
  await expect(overlay.locator('#bb-feature-card')).not.toHaveClass(/visible/)
})

test('starting soon: show drives the pre-show scene', async () => {
  await win.evaluate(() => window.api.startingSoonShow()); await settle()
  await expect(overlay.locator('#starting-soon')).toHaveClass(/visible/)
  await overlay.screenshot({ path: 'test-results/sm-03-starting-soon.png' })
  await win.evaluate(() => window.api.startingSoonHide()); await settle()
  await expect(overlay.locator('#starting-soon')).not.toHaveClass(/visible/)
})

// ── WebSocket command path (Stream Deck / external clients) ───────────────────
// Any WS client can drive overlays by sending {type:'command', action}. This is
// the Stream Deck plugin's transport.

test('WS command: fireLT from a raw client shows the lower third', async () => {
  await win.evaluate(() => window.api.overlayHideLT()); await settle()
  await expect(overlay.locator('#lt')).not.toHaveClass(/visible/)
  await sendCommand('fireLT')
  await expect(overlay.locator('#lt')).toHaveClass(/visible/)
})

test('WS command: toggleGrid from a raw client toggles the grid', async () => {
  const before = await overlay.locator('#bb-grid').evaluate((el) => el.classList.contains('visible'))
  await sendCommand('toggleGrid')
  const after = await overlay.locator('#bb-grid').evaluate((el) => el.classList.contains('visible'))
  expect(after).toBe(!before)
})
