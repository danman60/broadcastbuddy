// Browser-source inline-JS behaviors — the applyState() logic served to OBS.
// This is un-type-checked JS embedded in overlay.ts that runs LIVE in the OBS
// browser source, so it's the least-verified, most production-critical code.
// Drive state from the control window, assert the rendered DOM/behavior in a
// real Chromium tab.

import { test, expect, _electron as electron, ElectronApplication, Page, chromium, Browser } from '@playwright/test'
import path from 'path'

let app: ElectronApplication
let win: Page
let browser: Browser
let overlay: Page

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(__dirname, '..'), '--disable-gpu', '--no-sandbox'],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  const settings = await win.evaluate(async () => window.api.settingsGet())
  const httpPort = settings.server?.httpPort || 19080
  await win.evaluate(async () => {
    await window.api.triggerClearAll()
    await window.api.triggerAdd({ id: 'bs1', name: 'BS', title: 'Hello World Typewriter', subtitle: 'sub', category: '', order: 0, logoDataUrl: '' })
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

async function settle() { await overlay.waitForTimeout(350) }

test('ticker scroll duration is computed from speed (1920/speed*2, min 10)', async () => {
  await win.evaluate(() => window.api.tickerShow('scroll me', 60, '#000', '#fff')); await settle()
  let dur = await overlay.locator('#ticker-text').evaluate((el: HTMLElement) => el.style.animationDuration)
  expect(dur).toBe('64s') // 1920/60*2 = 64
  await win.evaluate(() => window.api.tickerShow('scroll me', 120, '#000', '#fff')); await settle()
  dur = await overlay.locator('#ticker-text').evaluate((el: HTMLElement) => el.style.animationDuration)
  expect(dur).toBe('32s') // 1920/120*2 = 32
  await win.evaluate(() => window.api.tickerShow('scroll me', 1000, '#000', '#fff')); await settle()
  dur = await overlay.locator('#ticker-text').evaluate((el: HTMLElement) => el.style.animationDuration)
  expect(dur).toBe('10s') // clamped to min 10
  await win.evaluate(() => window.api.tickerHide()); await settle()
})

test('clock renders 24h vs 12h formats', async () => {
  await win.evaluate(() => window.api.overlayClockUpdate({ format: '24h', showSeconds: false }))
  await win.evaluate(() => window.api.overlayClockToggle()); await settle()
  let t = (await overlay.locator('#bb-clock-time').textContent()) || ''
  expect(t).toMatch(/^\d{2}:\d{2}$/) // HH:MM, no AM/PM
  expect(t).not.toMatch(/[AP]M/)
  await win.evaluate(() => window.api.overlayClockUpdate({ format: '12h', showSeconds: true })); await settle()
  t = (await overlay.locator('#bb-clock-time').textContent()) || ''
  expect(t).toMatch(/[AP]M$/) // ends with AM/PM
  await win.evaluate(() => window.api.overlayClockToggle()); await settle()
})

test('counter pop-in: value change while visible adds the advance class', async () => {
  await win.evaluate(() => window.api.overlayCounterToggle()) // show (seeds lastCounterValue)
  await settle()
  await win.evaluate(() => window.api.overlayCounterSet(99, 'ENTRY')) // change → advance
  await overlay.waitForTimeout(120)
  const cls = await overlay.locator('#bb-counter').evaluate((el) => el.className)
  expect(cls).toContain('advance')
  expect(await overlay.locator('#bb-counter-number').textContent()).toBe('99')
  await win.evaluate(() => window.api.overlayCounterToggle()); await settle()
})

test('typewriter animation eventually reveals the full title', async () => {
  await win.evaluate(() => window.api.overlayUpdateStyling({ animation: 'typewriter', animationDuration: 0.5 }))
  await win.evaluate(() => window.api.overlayFireLT())
  // The reveal is progressive; after enough time the full title is present and
  // the cursor span is cleaned up.
  await expect(overlay.locator('#lt')).toHaveClass(/visible/)
  await expect(overlay.locator('#lt-title')).toHaveText('Hello World Typewriter', { timeout: 4000 })
  await win.evaluate(() => window.api.overlayHideLT()); await settle()
  await win.evaluate(() => window.api.overlayUpdateStyling({ animation: 'slide' }))
})

test('feature card entrance + exit lifecycle classes', async () => {
  await win.evaluate(() => window.api.overlayFeatureShow({ kicker: 'UP NEXT', title: 'Entrance Test' }))
  await overlay.waitForTimeout(150)
  let cls = await overlay.locator('#bb-feature-card').evaluate((el) => el.className)
  expect(cls).toContain('visible')
  expect(cls).toContain('entering')
  await win.evaluate(() => window.api.overlayFeatureHide())
  await overlay.waitForTimeout(200)
  cls = await overlay.locator('#bb-feature-card').evaluate((el) => el.className)
  expect(cls).toContain('exiting') // exit animation in progress
  await overlay.waitForTimeout(800)
  await expect(overlay.locator('#bb-feature-card')).not.toHaveClass(/visible/)
})
