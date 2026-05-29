// Logo + ticker coverage for the OBS browser source (company/client logos and
// the scrolling ticker/crawl).
//
// Two-page pattern (mirrors tests/overlay-statemachine.spec.ts):
//   - `win`    : the Electron control window — drives state via window.api → IPC
//                → overlay state machine → wsHub.broadcastState.
//   - `overlay`: a real Chromium tab rendering http://127.0.0.1:<port>/overlay,
//                the PASSIVE browser source OBS would load. It connects to the
//                WS hub, identifies as `overlay`, and renders pushed full-state.
//
// Logos use tiny inline base64 PNG data URLs (no file on disk). The control API
// is overlaySetLogos(company, client) — it sets BOTH slots at once and marks a
// slot visible iff its dataUrl is non-empty (see setCompanyLogo/setClientLogo).
// The ticker API is tickerShow(text, speed, bg, textColor) / tickerUpdate /
// tickerHide.

import { test, expect, _electron as electron, ElectronApplication, Page, chromium, Browser } from '@playwright/test'
import path from 'path'

let app: ElectronApplication
let win: Page // Electron control window (drives state via window.api)
let browser: Browser
let overlay: Page // Chromium tab rendering http://127.0.0.1:<port>/overlay

// 1x1 transparent PNGs (distinct strings so we can assert the right slot got
// the right src). Both are valid PNG data URLs requiring no file on disk.
const PNG_A =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const PNG_B =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

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

  // Clean slate. No triggers — applyTriggerToOverlay() would otherwise stamp a
  // per-trigger logo into the client-logo slot and pollute these assertions.
  await win.evaluate(async () => {
    await window.api.triggerClearAll()
    await window.api.overlaySetLogos('', '')
    await window.api.tickerHide()
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

// ── (a) Logo state via overlaySetLogos ────────────────────────────────────────

test('logos: overlaySetLogos sets company + client dataUrl and marks both visible', async () => {
  await win.evaluate(({ a, b }) => window.api.overlaySetLogos(a, b), { a: PNG_A, b: PNG_B })
  const state = await win.evaluate(() => window.api.overlayGetState())
  expect(state.companyLogo.dataUrl).toBe(PNG_A)
  expect(state.companyLogo.visible).toBe(true)
  expect(state.clientLogo.dataUrl).toBe(PNG_B)
  expect(state.clientLogo.visible).toBe(true)
})

test('logos: empty dataUrl clears the slot and marks it not visible', async () => {
  // Keep company, clear client.
  await win.evaluate(({ a }) => window.api.overlaySetLogos(a, ''), { a: PNG_A })
  const state = await win.evaluate(() => window.api.overlayGetState())
  expect(state.companyLogo.dataUrl).toBe(PNG_A)
  expect(state.companyLogo.visible).toBe(true)
  expect(state.clientLogo.dataUrl).toBe('')
  expect(state.clientLogo.visible).toBe(false)
})

// ── (b) Ticker state via tickerShow / tickerUpdate / tickerHide ────────────────

test('ticker: tickerShow sets text + visible and the styling fields', async () => {
  await win.evaluate(() => window.api.tickerShow('BREAKING: logo + ticker test', 80, '#112233', '#eeeeee'))
  const state = await win.evaluate(() => window.api.overlayGetState())
  expect(state.ticker.visible).toBe(true)
  expect(state.ticker.text).toBe('BREAKING: logo + ticker test')
  expect(state.ticker.speed).toBe(80)
  expect(state.ticker.backgroundColor).toBe('#112233')
  expect(state.ticker.textColor).toBe('#eeeeee')
})

test('ticker: tickerUpdate patches fields without hiding', async () => {
  await win.evaluate(() => window.api.tickerUpdate({ text: 'UPDATED crawl copy', speed: 120 }))
  const state = await win.evaluate(() => window.api.overlayGetState())
  expect(state.ticker.text).toBe('UPDATED crawl copy')
  expect(state.ticker.speed).toBe(120)
  expect(state.ticker.visible).toBe(true)
})

test('ticker: tickerHide clears visibility but keeps the text', async () => {
  await win.evaluate(() => window.api.tickerHide())
  const state = await win.evaluate(() => window.api.overlayGetState())
  expect(state.ticker.visible).toBe(false)
  expect(state.ticker.text).toBe('UPDATED crawl copy')
})

// ── (c) Browser-source DOM reflects pushed logo + ticker state ─────────────────

test('browser source: company + client logos get visible class + src set', async () => {
  await win.evaluate(({ a, b }) => window.api.overlaySetLogos(a, b), { a: PNG_A, b: PNG_B })
  await settle()
  await expect(overlay.locator('#company-logo')).toHaveClass(/visible/)
  await expect(overlay.locator('#client-logo')).toHaveClass(/visible/)
  expect(await overlay.locator('#company-logo').getAttribute('src')).toBe(PNG_A)
  expect(await overlay.locator('#client-logo').getAttribute('src')).toBe(PNG_B)
  await overlay.screenshot({ path: 'test-results/lt-00-logos.png' })
})

test('browser source: clearing a logo removes its visible class', async () => {
  await win.evaluate(({ a }) => window.api.overlaySetLogos(a, ''), { a: PNG_A })
  await settle()
  await expect(overlay.locator('#company-logo')).toHaveClass(/visible/)
  await expect(overlay.locator('#client-logo')).not.toHaveClass(/visible/)
})

test('browser source: ticker gets visible class + ticker-text textContent', async () => {
  await win.evaluate(() => window.api.tickerShow('ON-AIR crawl: welcome to the broadcast', 60, '#1a1a2e', '#ffffff'))
  await settle()
  await expect(overlay.locator('#ticker')).toHaveClass(/visible/)
  await expect(overlay.locator('#ticker-text')).toHaveText('ON-AIR crawl: welcome to the broadcast')
  await overlay.screenshot({ path: 'test-results/lt-01-ticker.png' })
  await win.evaluate(() => window.api.tickerHide())
  await settle()
  await expect(overlay.locator('#ticker')).not.toHaveClass(/visible/)
})
