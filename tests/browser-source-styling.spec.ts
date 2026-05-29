// Styling → browser-source CSS pipeline. applyState() maps OverlayStyling into
// CSS custom properties + classes on #lt-card. This is what the operator's
// styling config actually renders in OBS — validate the mapping end-to-end.

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
    await window.api.triggerAdd({ id: 'st-a', name: 'A', title: 'First', subtitle: 'one', category: '', order: 0, logoDataUrl: '' })
    await window.api.triggerAdd({ id: 'st-b', name: 'B', title: 'Second', subtitle: 'two', category: '', order: 1, logoDataUrl: '' })
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
const cssVar = (name: string) =>
  overlay.locator('#lt-card').evaluate((el, n) => (el as HTMLElement).style.getPropertyValue(n).trim(), name)

test('styling maps to CSS custom properties on the card', async () => {
  await win.evaluate(() => window.api.overlayUpdateStyling({
    accentColor: '#abcdef',
    fontSize: 40,
    backgroundColor: '#123456',
    textColor: '#fedcba',
    fontWeight: 800,
    borderRadius: 14,
    titleTextTransform: 'uppercase',
  }))
  await win.evaluate(() => window.api.overlayFireLT()); await settle()

  expect(await cssVar('--accent-color')).toBe('#abcdef')
  expect(await cssVar('--font-size')).toBe('40px')
  expect(await cssVar('--bg-color')).toBe('#123456')
  expect(await cssVar('--text-color')).toBe('#fedcba')
  expect(await cssVar('--font-weight')).toBe('800')
  expect(await cssVar('--border-radius')).toBe('14px')
  expect(await cssVar('--title-transform')).toBe('uppercase')
  await win.evaluate(() => window.api.overlayHideLT()); await settle()
})

test('background style + shadow/glow map to card classes', async () => {
  await win.evaluate(() => window.api.overlayUpdateStyling({ backgroundStyle: 'glass', textShadow: true, textGlow: true }))
  await win.evaluate(() => window.api.overlayFireLT()); await settle()
  const cls = await overlay.locator('#lt-card').evaluate((el) => el.className)
  expect(cls).toContain('bg-glass')
  expect(cls).toContain('text-shadow')
  expect(cls).toContain('text-glow')
  await win.evaluate(() => window.api.overlayUpdateStyling({ backgroundStyle: 'solid', textShadow: false, textGlow: false }))
  await win.evaluate(() => window.api.overlayHideLT()); await settle()
})

test('label chip renders for UP NEXT (has-label + label text)', async () => {
  await win.evaluate(() => window.api.triggerSelect(0))
  const r = await win.evaluate(() => window.api.overlayFireUpNext('UP NEXT'))
  expect(r.fired).toBe(true) // neighbour (index 1) exists
  await settle()
  await expect(overlay.locator('#lt')).toHaveClass(/visible/)
  await expect(overlay.locator('#lt-label')).toHaveText('UP NEXT')
  const cls = await overlay.locator('#lt-card').evaluate((el) => el.className)
  expect(cls).toContain('has-label')
  await win.evaluate(() => window.api.overlayHideLT()); await settle()
})

test('no label → no has-label class, empty chip', async () => {
  await win.evaluate(() => window.api.triggerSelect(0))
  await win.evaluate(() => window.api.overlayFireLT()); await settle()
  await expect(overlay.locator('#lt-label')).toHaveText('')
  const cls = await overlay.locator('#lt-card').evaluate((el) => el.className)
  expect(cls).not.toContain('has-label')
  await win.evaluate(() => window.api.overlayHideLT()); await settle()
})
