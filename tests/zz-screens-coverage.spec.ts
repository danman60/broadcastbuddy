import { test, expect } from '@playwright/test'
import { launchApp, closeApp, nativeClick, Harness } from './zz-harness'

/**
 * Screen coverage — every top-level screen and modal renders without crashing
 * and is captured to tests/screenshots/. Drives the real UI via native clicks
 * (see nativeClick in the harness — robust against the div-onClick quirk and
 * fleet CPU load). afterEach forcibly returns to the bare main layout so an
 * aria-modal left open can't cascade-fail later tests.
 */

const SHOTS = 'tests/screenshots'

let h: Harness
test.beforeAll(async () => { h = await launchApp() })
test.afterAll(async () => { await closeApp(h) })

test.afterEach(async () => {
  const w = h.window
  try {
    // Close any open overlay (Settings / Brand Kit / Import) + editors.
    for (let i = 0; i < 4; i++) {
      const closed = await nativeClick(w, '.settings-overlay button, [role="dialog"] button, .editor-close', 'Close')
      if (!closed) break
      await w.waitForTimeout(100)
    }
    await w.keyboard.press('Escape').catch(() => {})
    // Exit compact if left on.
    if (await w.locator('.app-layout.compact').count()) {
      await nativeClick(w, '.header button', 'Compact')
      await w.waitForTimeout(120)
    }
    await w.waitForTimeout(60)
  } catch { /* best-effort */ }
})

test('main layout renders core regions', async () => {
  const w = h.window
  await expect(w.locator('.header')).toBeVisible()
  await expect(w.locator('.left-panel')).toBeVisible()
  await expect(w.locator('.right-panel')).toBeVisible()
  await expect(w.locator('.show-rail')).toBeVisible()
  await expect(w.locator('.center-column')).toBeVisible()
  await w.screenshot({ path: `${SHOTS}/01-main-layout.png`, fullPage: true })
})

test('show-rail tabbed cards switch (Content + Broadcast)', async () => {
  const w = h.window
  const tabs = w.locator('.tabbed-card .settings-tab')
  const n = await tabs.count()
  expect(n).toBeGreaterThanOrEqual(4)
  const labels = await tabs.allTextContents()
  for (const label of labels) {
    await nativeClick(w, '.tabbed-card .settings-tab', label.trim())
    await w.waitForTimeout(100)
  }
  await w.screenshot({ path: `${SHOTS}/02-rail-tabs.png` })
})

test('Camera rail card expands and renders', async () => {
  const w = h.window
  await nativeClick(w, '.panel-section-title', 'Camera (OBSBOT)')
  await w.waitForTimeout(500)
  const off = await w.locator('.camera-off').count()
  const active = await w.locator('.camera-panel').count()
  expect(off + active).toBeGreaterThan(0)
  await w.screenshot({ path: `${SHOTS}/03-camera-card.png` })
  await nativeClick(w, '.panel-section-title', 'Camera (OBSBOT)') // collapse
  await w.waitForTimeout(150)
})

test('Settings opens and every tab renders', async () => {
  const w = h.window
  await nativeClick(w, '.header button', 'Settings')
  await expect(w.locator('.settings-overlay').first()).toBeVisible({ timeout: 10000 })
  const tabs = w.locator('.settings-overlay .settings-tabbar .settings-tab')
  const labels = await tabs.allTextContents()
  expect(labels.length).toBeGreaterThanOrEqual(5)
  for (const label of labels) {
    await nativeClick(w, '.settings-overlay .settings-tab', label.trim())
    await w.waitForTimeout(160)
    await w.screenshot({ path: `${SHOTS}/04-settings-${label.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.png` })
  }
  // Camera tab hosts Voice Control + Shot Recorder.
  await nativeClick(w, '.settings-overlay .settings-tab', 'Camera')
  await w.waitForTimeout(300)
  const body = w.locator('.settings-body')
  await expect(body.getByText('Voice Control', { exact: false }).first()).toBeVisible({ timeout: 8000 })
  await expect(body.getByText('Shot Recorder', { exact: false }).first()).toBeVisible({ timeout: 8000 })
  await w.screenshot({ path: `${SHOTS}/04-settings-camera-voice-shot.png` })
})

test('Brand Kit modal opens and shows its panel', async () => {
  const w = h.window
  await nativeClick(w, '.header button', 'Tools')
  await w.waitForTimeout(150)
  await nativeClick(w, 'button', 'Brand Kit')
  await expect(w.locator('.settings-overlay h2:has-text("Brand Kit")')).toBeVisible({ timeout: 10000 })
  await w.screenshot({ path: `${SHOTS}/05-brand-kit.png` })
})

test('Import modal opens and shows its panel', async () => {
  const w = h.window
  await nativeClick(w, '.header button', 'Tools')
  await w.waitForTimeout(150)
  await nativeClick(w, 'button', 'Import')
  await expect(w.locator('.settings-overlay h2:has-text("Import")')).toBeVisible({ timeout: 10000 })
  await w.screenshot({ path: `${SHOTS}/06-import.png` })
})

test('Starting Soon Editor opens', async () => {
  const w = h.window
  await nativeClick(w, '.header button', 'Tools')
  await w.waitForTimeout(150)
  await nativeClick(w, 'button', 'Starting Soon Editor')
  await w.waitForTimeout(500)
  await w.screenshot({ path: `${SHOTS}/07-starting-soon-editor.png` })
})

test('Visual Editor opens from overlay preview', async () => {
  const w = h.window
  await nativeClick(w, '.overlay-preview')
  await w.waitForTimeout(500)
  await w.screenshot({ path: `${SHOTS}/08-visual-editor.png` })
})

test('Day checklist opens (start)', async () => {
  const w = h.window
  await nativeClick(w, '.header button', 'Tools')
  await w.waitForTimeout(150)
  await nativeClick(w, 'button', 'Start-of-Day Checklist')
  await w.waitForTimeout(500)
  await w.screenshot({ path: `${SHOTS}/09-checklist-start.png` })
})

test('compact mode toggles window layout', async () => {
  const w = h.window
  await nativeClick(w, '.header button', 'Compact')
  await expect(w.locator('.app-layout.compact')).toBeVisible({ timeout: 10000 })
  await w.screenshot({ path: `${SHOTS}/10-compact.png` })
})
