// Session load → live browser source propagation. Loading a saved session must
// push its styling to the OBS browser source (operators load saved "looks"
// mid-setup). Validates loadSessionState → notifyChange → broadcast end-to-end.

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
    await window.api.triggerAdd({ id: 'sy1', name: 'Sync', title: 'Sync Title', subtitle: 's', category: '', order: 0, logoDataUrl: '' })
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

test('loading a session pushes its styling to the OBS browser source', async () => {
  // Create a session, give it a distinctive look, save it.
  await win.evaluate(() => window.api.sessionNew('sync-test', true))
  await win.evaluate(() => window.api.overlayUpdateStyling({ accentColor: '#aa0011', fontSize: 33 }))
  const saved = await win.evaluate(() => window.api.sessionSave())
  expect(saved).toBeTruthy()
  const id = saved!.id

  // Change the live styling to something else.
  await win.evaluate(() => window.api.overlayUpdateStyling({ accentColor: '#00bb22', fontSize: 20 }))
  let st = await win.evaluate(() => window.api.overlayGetState())
  expect(st.lowerThird.styling.accentColor).toBe('#00bb22')

  // Load the saved session — styling should revert to the saved look.
  await win.evaluate((sid) => window.api.sessionLoad(sid), id)
  st = await win.evaluate(() => window.api.overlayGetState())
  expect(st.lowerThird.styling.accentColor).toBe('#aa0011') // restored in state
  expect(st.lowerThird.styling.fontSize).toBe(33)

  // And the live browser source reflects the loaded styling once fired.
  await win.evaluate(() => window.api.triggerSelect(0))
  await win.evaluate(() => window.api.overlayFireLT())
  await overlay.waitForTimeout(400)
  const accent = await overlay.locator('#lt-card').evaluate((el: HTMLElement) => el.style.getPropertyValue('--accent-color').trim())
  expect(accent).toBe('#aa0011')
  await win.evaluate(() => window.api.overlayHideLT())
})

test('cleanup', async () => {
  await win.evaluate(() => window.api.triggerClearAll())
})
