import { test, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'

// Throwaway spec: capture full-window screenshots of every major panel/view
// for a visual layout audit. Drives the real renderer UI (header + Tools menu)
// into each state, then shoots a PNG. Not a regression assertion spec.

const OUT = '/tmp/bb-overnight/ui'

let app: ElectronApplication
let window: Page

test.beforeAll(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  app = await electron.launch({
    args: [path.join(__dirname, '..'), '--disable-gpu', '--no-sandbox'],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForTimeout(1500)
  await window.setViewportSize({ width: 1440, height: 900 })

  // Seed a session with several triggers so panels have content.
  await window.evaluate(async () => window.api.triggerClearAll())
  await window.evaluate(async () => window.api.sessionNew('UI Audit Session', false))
  const triggers = [
    { name: 'Opening Number', title: 'Rise Up', subtitle: 'Elite Senior Large Group', category: 'Session A', order: 0 },
    { name: 'Solo — Jane Doe', title: 'Defying Gravity', subtitle: 'Jane Doe · Contemporary', category: 'Session A', order: 1 },
    { name: 'Duo', title: 'Shallow', subtitle: 'A. Smith & B. Lee', category: 'Session B', order: 2 },
    { name: 'Finale', title: 'This Is Me', subtitle: 'Full Company', category: 'Session B', order: 3 },
  ]
  for (const t of triggers) {
    await window.evaluate(async (tr) => {
      return window.api.triggerAdd({
        id: '', name: tr.name, title: tr.title, subtitle: tr.subtitle,
        category: tr.category, order: tr.order, logoDataUrl: '', type: 'lower_third',
      } as any)
    }, t)
  }
  await window.evaluate(async () => window.api.overlayUpdateStyling({
    animation: 'slide', accentColor: '#3b82f6',
  }))
  await window.waitForTimeout(600)
})

test.afterAll(async () => {
  if (app) await app.close()
})

async function shot(name: string) {
  await window.waitForTimeout(400)
  await window.screenshot({ path: path.join(OUT, name), fullPage: false })
}

async function openTools() {
  const tools = window.locator('button:has-text("Tools")').first()
  await tools.click()
  await window.waitForTimeout(250)
}

async function clickMenuItem(text: string) {
  const item = window.locator('button', { hasText: text }).last()
  await item.click()
  await window.waitForTimeout(500)
}

async function closeOverlayView() {
  // Settings/Brand Kit/Import overlays carry a "Close" button.
  const close = window.locator('button:has-text("Close")').first()
  if (await close.count()) {
    try { await close.click({ timeout: 1500 }) } catch { /* ignore */ }
  }
  await window.waitForTimeout(300)
}

test('capture main layout', async () => {
  await shot('01-main-layout.png')
})

test('expand all right-column panels and capture the column in segments', async () => {
  // Each panel is a collapsible section keyed by .panel-section-title.
  const titles = window.locator('.panel-section-title')
  const n = await titles.count()
  for (let i = 0; i < n; i++) {
    try { await titles.nth(i).click({ timeout: 800 }) } catch { /* ignore */ }
  }
  await window.waitForTimeout(400)

  const right = window.locator('.right-panel')
  if (await right.count()) {
    await right.evaluate((el) => { (el as HTMLElement).scrollTop = 0 })
    await shot('02-right-panel-top.png')
    await right.evaluate((el) => { (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight / 3 })
    await shot('03-right-panel-mid.png')
    await right.evaluate((el) => { (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight * 2 / 3 })
    await shot('04-right-panel-lower.png')
    await right.evaluate((el) => { (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight })
    await shot('05-right-panel-bottom.png')
    await right.evaluate((el) => { (el as HTMLElement).scrollTop = 0 })
  }
})

test('capture Settings view', async () => {
  await openTools()
  await clickMenuItem('Settings')
  await shot('06-settings.png')
  await closeOverlayView()
})

test('capture Brand Kit view', async () => {
  await openTools()
  await clickMenuItem('Brand Kit')
  await shot('07-brand-kit.png')
  await closeOverlayView()
})

test('capture Import view', async () => {
  await openTools()
  await clickMenuItem('Import')
  await shot('08-import.png')
  await closeOverlayView()
})

test('capture Start-of-Day Checklist', async () => {
  await openTools()
  await clickMenuItem('Start-of-Day Checklist')
  await shot('09-day-checklist.png')
  // Day checklist closes via its own control; press Escape as a fallback.
  await window.keyboard.press('Escape').catch(() => {})
  const close = window.locator('button:has-text("Close"), button:has-text("Done"), button:has-text("Dismiss")').first()
  if (await close.count()) { try { await close.click({ timeout: 1000 }) } catch {} }
  await window.waitForTimeout(300)
})

test('capture Visual Editor view', async () => {
  // Visual Editor opens by clicking the OverlayPreview.
  const preview = window.locator('.overlay-preview').first()
  if (await preview.count()) {
    await preview.click()
    await window.waitForTimeout(700)
    await shot('10-visual-editor.png')
    const close = window.locator('button:has-text("Close")').first()
    if (await close.count()) { try { await close.click({ timeout: 1000 }) } catch {} }
    await window.keyboard.press('Escape').catch(() => {})
    await window.waitForTimeout(300)
  }
})

test('capture Compact Mode', async () => {
  await openTools()
  await clickMenuItem('Compact Mode')
  await window.waitForTimeout(600)
  await shot('11-compact-mode.png')
  // Toggle back off.
  await openTools()
  await clickMenuItem('Compact Mode')
  await window.waitForTimeout(400)
})
