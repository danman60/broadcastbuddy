import { test, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'

// Throwaway: capture the REAL main control surface (past the start-of-day
// checklist + startup toast) for the UI redesign. Not a regression spec.
const OUT = '/tmp/bb-ui/after'
let app: ElectronApplication
let window: Page

test.beforeAll(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  app = await electron.launch({ args: [path.join(__dirname, '..'), '--disable-gpu', '--no-sandbox'], env: { ...process.env, NODE_ENV: 'production' } })
  window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForTimeout(1500)
  await window.setViewportSize({ width: 1600, height: 1000 })

  // Dismiss the start-of-day checklist (top-right "Done") + startup toast (×).
  for (const sel of ['button:has-text("Done")', '.startup-toast button', 'button[aria-label="Close"]']) {
    const b = window.locator(sel).first()
    if (await b.count()) { try { await b.click({ timeout: 1200 }) } catch {} }
  }
  await window.keyboard.press('Escape').catch(() => {})
  await window.waitForTimeout(400)

  // Seed content so panels aren't empty.
  await window.evaluate(async () => window.api.triggerClearAll()).catch(() => {})
  await window.evaluate(async () => window.api.sessionNew('UI Audit', false)).catch(() => {})
  const triggers = [
    { name: 'Opening Number', title: 'Rise Up', subtitle: 'Elite Senior Large Group', category: 'Act 1', order: 0 },
    { name: 'Solo — Jane', title: 'Defying Gravity', subtitle: 'Jane Doe · Contemporary', category: 'Act 1', order: 1 },
    { name: 'Duo', title: 'Shallow', subtitle: 'A. Smith & B. Lee', category: 'Act 2', order: 2 },
    { name: 'Finale', title: 'This Is Me', subtitle: 'Full Company', category: 'Act 2', order: 3 },
  ]
  for (const t of triggers) {
    await window.evaluate(async (tr) => window.api.triggerAdd({ id: '', logoDataUrl: '', type: 'lower_third', ...tr } as any), t).catch(() => {})
  }
  await window.waitForTimeout(700)
})

test.afterAll(async () => { if (app) await app.close() })

async function shot(name: string) { await window.waitForTimeout(350); await window.screenshot({ path: path.join(OUT, name), fullPage: false }) }

test('main layout', async () => {
  // Make sure the checklist is really gone.
  const done = window.locator('button:has-text("Done")').first()
  if (await done.count()) { try { await done.click({ timeout: 800 }) } catch {} }
  await shot('01-main.png')
})

test('expand every panel + segment the right column', async () => {
  const titles = window.locator('.panel-section-title')
  const n = await titles.count()
  for (let i = 0; i < n; i++) { try { await titles.nth(i).click({ timeout: 700 }) } catch {} }
  await window.waitForTimeout(500)
  await shot('02-all-expanded.png')

  const right = window.locator('.right-panel')
  if (await right.count()) {
    const h = await right.evaluate((el) => (el as HTMLElement).scrollHeight)
    for (const [i, frac] of [0, 0.5, 1].entries()) {
      await right.evaluate((el, f) => { (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight * f }, frac)
      await shot(`03-right-${i}.png`)
    }
  }
})
