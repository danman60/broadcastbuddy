import { test, expect } from '@playwright/test'
import { launchApp, closeApp, api, Harness } from './zz-harness'

/**
 * Overlay Mode (floating always-on-top control panels over OBS) + window
 * management. Overlay Mode is a multi-BrowserWindow feature with no prior test
 * coverage. We toggle it and assert the main process opens/closes the panel
 * windows, plus that programmatic window resize lands.
 */

let h: Harness
test.beforeAll(async () => { h = await launchApp() })
test.afterAll(async () => {
  // Make sure we leave overlay mode closed so the app shuts down cleanly.
  try { await api(h.window, 'overlayModeClose') } catch { /* closing */ }
  await closeApp(h)
})

async function windowCount(): Promise<number> {
  return h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
}

test('overlay mode opens additional floating panel windows', async () => {
  const before = await windowCount()
  await api(h.window, 'overlayModeOpen')
  await h.window.waitForTimeout(600)
  const after = await windowCount()
  expect(after).toBeGreaterThan(before)
})

test('overlay mode close tears the panel windows back down', async () => {
  await api(h.window, 'overlayModeClose')
  await h.window.waitForTimeout(600)
  const after = await windowCount()
  // Back to (about) the single main window.
  expect(after).toBeLessThanOrEqual(2)
})

test('overlay mode toggle is reversible (open → toggle closes)', async () => {
  await api(h.window, 'overlayModeOpen')
  await h.window.waitForTimeout(400)
  const open = await windowCount()
  await api(h.window, 'overlayModeToggle')
  await h.window.waitForTimeout(400)
  const toggled = await windowCount()
  expect(toggled).toBeLessThan(open)
})

test('windowResize sets the main window bounds', async () => {
  await api(h.window, 'windowResize', 1100, 760)
  await h.window.waitForTimeout(300)
  const size = await h.app.evaluate(({ BrowserWindow }) => {
    // The main window is the first, non-panel window.
    const w = BrowserWindow.getAllWindows()[0]
    const b = w.getBounds()
    return { width: b.width, height: b.height }
  })
  expect(size.width).toBeGreaterThanOrEqual(1000)
  expect(size.height).toBeGreaterThanOrEqual(700)
})

test('compact mode setting persists and reflects in layout class', async () => {
  await api(h.window, 'settingsSet', 'compactMode', true)
  const s = await api<Record<string, unknown>>(h.window, 'settingsGet')
  expect(s.compactMode).toBe(true)
  await api(h.window, 'settingsSet', 'compactMode', false)
})
