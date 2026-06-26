import { test, expect } from '@playwright/test'
import { launchApp, closeApp, nativeClick, Harness } from './zz-harness'

/**
 * Viewport + accessibility. The control window gets resized small on cramped
 * venue laptops and toggled into compact mode. Core controls must stay reachable
 * and buttons must carry accessible names (text or title) for keyboard/AT use.
 */

let h: Harness
test.beforeAll(async () => { h = await launchApp() })
test.afterAll(async () => { await closeApp(h) })

const VIEWPORTS = [
  { name: 'desktop', w: 1600, h: 1000 },
  { name: 'laptop', w: 1280, h: 800 },
  { name: 'narrow', w: 1024, h: 720 },
  { name: 'tiny', w: 820, h: 640 },
]

for (const vp of VIEWPORTS) {
  test(`header controls remain reachable at ${vp.name} (${vp.w}x${vp.h})`, async () => {
    await h.window.setViewportSize({ width: vp.w, height: vp.h })
    await h.window.waitForTimeout(250)
    await expect(h.window.locator('.header')).toBeVisible()
    await expect(h.window.locator('button:has-text("Settings")')).toBeVisible()
    await expect(h.window.locator('button:has-text("Tools")')).toBeVisible()
    await h.window.screenshot({ path: `tests/screenshots/vp-${vp.name}.png` })
  })
}

test('compact mode hides the preview and shrinks the left panel', async () => {
  await h.window.setViewportSize({ width: 1280, height: 800 })
  await nativeClick(h.window, '.header button', 'Compact')
  await expect(h.window.locator('.app-layout.compact')).toBeVisible({ timeout: 10000 })
  // Header collapses its title to "BB" in compact mode.
  await expect(h.window.locator('.header-title')).toHaveText('BB')
  await nativeClick(h.window, '.header button', 'Compact')
  await h.window.waitForTimeout(250)
  await expect(h.window.locator('.header-title')).toHaveText('BroadcastBuddy')
})

test('every header button has an accessible name (text or title)', async () => {
  const buttons = h.window.locator('.header button')
  const n = await buttons.count()
  expect(n).toBeGreaterThan(3)
  const unnamed: string[] = []
  for (let i = 0; i < n; i++) {
    const b = buttons.nth(i)
    const text = (await b.textContent())?.trim() || ''
    const title = (await b.getAttribute('title')) || ''
    const aria = (await b.getAttribute('aria-label')) || ''
    if (!text && !title && !aria) unnamed.push(`button#${i}`)
  }
  expect(unnamed, `unnamed header buttons: ${unnamed.join(', ')}`).toHaveLength(0)
})

test('Settings dialog is marked aria-modal for assistive tech', async () => {
  await nativeClick(h.window, '.header button', 'Settings')
  const dialog = h.window.locator('.settings-overlay').first()
  await expect(dialog).toBeVisible({ timeout: 10000 })
  // The redesign tagged the overlay role=dialog aria-modal=true.
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  await nativeClick(h.window, '.settings-overlay button', 'Close')
  await h.window.waitForTimeout(200)
})

test('keyboard focus can reach the first header button', async () => {
  await h.window.locator('button:has-text("Settings")').focus()
  const tag = await h.window.evaluate(() => document.activeElement?.tagName)
  expect(tag).toBe('BUTTON')
})
