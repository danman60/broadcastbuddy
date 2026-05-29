// Overlay composition + late-join — two operator-critical paths:
//  1. Multiple overlay elements visible at once (a live show runs several).
//  2. Late-join: when OBS reactivates a scene it RELOADS the browser source,
//     which reconnects and must render the CURRENT active state (not blank).
//     This is the scene-switch-during-show path.

import { test, expect, _electron as electron, ElectronApplication, Page, chromium, Browser } from '@playwright/test'
import path from 'path'

let app: ElectronApplication
let win: Page
let browser: Browser
let overlay: Page
let httpPort = 19080

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(__dirname, '..'), '--disable-gpu', '--no-sandbox'],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  const settings = await win.evaluate(async () => window.api.settingsGet())
  httpPort = settings.server?.httpPort || 19080
  await win.evaluate(async () => {
    await window.api.triggerClearAll()
    await window.api.triggerAdd({ id: 'comp1', name: 'C', title: 'Ada Lovelace', subtitle: 'sub', category: '', order: 0, logoDataUrl: '' })
    await window.api.triggerSelect(0)
  })
  browser = await chromium.launch()
  overlay = await browser.newPage()
  await overlay.goto(`http://127.0.0.1:${httpPort}/overlay`)
  await overlay.waitForTimeout(1200)
})

test.afterAll(async () => {
  await browser?.close()
  await app?.close()
})

test('multiple overlay elements render simultaneously', async () => {
  await win.evaluate(async () => {
    await window.api.overlayFireLT()
    await window.api.tickerShow('live ticker', 60, '#000', '#fff')
    if (!(await window.api.overlayGetState()).clock.visible) await window.api.overlayClockToggle()
    if (!(await window.api.overlayGetState()).counter.visible) await window.api.overlayCounterToggle()
  })
  await overlay.waitForTimeout(500)
  await expect(overlay.locator('#lt')).toHaveClass(/visible/)
  await expect(overlay.locator('#ticker')).toHaveClass(/visible/)
  await expect(overlay.locator('#bb-clock')).toHaveClass(/visible/)
  await expect(overlay.locator('#bb-counter')).toHaveClass(/visible/)
  await expect(overlay.locator('#lt-title')).toHaveText('Ada Lovelace')
})

test('late-join: a freshly-opened browser source renders the ACTIVE state', async () => {
  // State is already active from the previous test (LT fired, ticker/clock on).
  // Simulate OBS reactivating the scene → a brand-new browser-source page.
  const late = await browser.newPage()
  await late.goto(`http://127.0.0.1:${httpPort}/overlay`)
  // On connect the hub pushes full state; the page must apply it (not stay blank).
  await expect(late.locator('#lt')).toHaveClass(/visible/, { timeout: 5000 })
  await expect(late.locator('#lt-title')).toHaveText('Ada Lovelace')
  await expect(late.locator('#ticker')).toHaveClass(/visible/)
  await expect(late.locator('#bb-clock')).toHaveClass(/visible/)
  await late.close()
})

test('clearing elements hides them in the live overlay', async () => {
  await win.evaluate(async () => {
    await window.api.overlayHideLT()
    await window.api.tickerHide()
    if ((await window.api.overlayGetState()).clock.visible) await window.api.overlayClockToggle()
    if ((await window.api.overlayGetState()).counter.visible) await window.api.overlayCounterToggle()
  })
  await overlay.waitForTimeout(500)
  await expect(overlay.locator('#lt')).not.toHaveClass(/visible/)
  await expect(overlay.locator('#ticker')).not.toHaveClass(/visible/)
  await expect(overlay.locator('#bb-clock')).not.toHaveClass(/visible/)
  await expect(overlay.locator('#bb-counter')).not.toHaveClass(/visible/)
})

test('cleanup', async () => {
  await win.evaluate(() => window.api.triggerClearAll())
})
