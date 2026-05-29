// Starting-soon CORE (countdown / title / subtitle / completion / colors) —
// distinct from starting-soon-media.spec which covers the sponsor/slideshow/
// social/welcome stack. Dual-page: drive via IPC, assert browser-source DOM.

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
  await win.evaluate(async () => window.api.triggerClearAll())
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

test('startingSoonUpdate reflects core fields in state', async () => {
  await win.evaluate(() => window.api.startingSoonUpdate({
    title: 'Doors at 7',
    subtitle: 'Spring Recital',
    completionText: 'Live now!',
    countdownSeconds: 300,
    backgroundColor: '#222244',
    textColor: '#ffffff',
    accentColor: '#ff66aa',
  }))
  const st = await win.evaluate(() => window.api.overlayGetState())
  const ss = st.startingSoon
  expect(ss.title).toBe('Doors at 7')
  expect(ss.subtitle).toBe('Spring Recital')
  expect(ss.completionText).toBe('Live now!')
  expect(ss.countdownSeconds).toBe(300)
  expect(ss.accentColor).toBe('#ff66aa')
})

test('show drives title + subtitle into the browser source', async () => {
  await win.evaluate(() => window.api.startingSoonShow()); await settle()
  await expect(overlay.locator('#starting-soon')).toHaveClass(/visible/)
  await expect(overlay.locator('#ss-title')).toHaveText('Doors at 7')
  await expect(overlay.locator('#ss-subtitle')).toHaveText('Spring Recital')
})

test('hide removes the starting-soon scene', async () => {
  await win.evaluate(() => window.api.startingSoonHide()); await settle()
  await expect(overlay.locator('#starting-soon')).not.toHaveClass(/visible/)
})

test('partial update merges (title change keeps subtitle)', async () => {
  await win.evaluate(() => window.api.startingSoonUpdate({ title: 'Changed Title' }))
  const st = await win.evaluate(() => window.api.overlayGetState())
  expect(st.startingSoon.title).toBe('Changed Title')
  expect(st.startingSoon.subtitle).toBe('Spring Recital') // preserved
})

test('countdown element is present in the served overlay', async () => {
  await win.evaluate(() => window.api.startingSoonShow()); await settle()
  await expect(overlay.locator('#ss-countdown')).toHaveCount(1)
  await win.evaluate(() => window.api.startingSoonHide()); await settle()
})
