import { test, expect } from '@playwright/test'
import { launchApp, closeApp, nativeClick, Harness } from './zz-harness'

/**
 * Runtime-error oracle. Tour every screen/panel while collecting console errors
 * and uncaught page exceptions, then assert the ErrorBoundary fallback
 * ("Something went wrong") never rendered and no React error escaped. Catches
 * render crashes that a happy-path assertion would miss.
 */

let h: Harness
const consoleErrors: string[] = []
const pageErrors: string[] = []

test.beforeAll(async () => {
  h = await launchApp()
  h.window.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
  h.window.on('pageerror', (err) => pageErrors.push(err.message))
})
test.afterAll(async () => { await closeApp(h) })

test('tour every screen without an uncaught render crash', async () => {
  const w = h.window
  test.setTimeout(60000)

  // Rail tabbed cards.
  const railLabels = await w.locator('.tabbed-card .settings-tab').allTextContents()
  for (const l of railLabels) { await nativeClick(w, '.tabbed-card .settings-tab', l.trim()); await w.waitForTimeout(80) }

  // Camera card expand/collapse.
  await nativeClick(w, '.panel-section-title', 'Camera (OBSBOT)')
  await w.waitForTimeout(250)
  await nativeClick(w, '.panel-section-title', 'Camera (OBSBOT)')

  // Settings — every tab.
  await nativeClick(w, '.header button', 'Settings')
  await w.waitForTimeout(200)
  const sLabels = await w.locator('.settings-overlay .settings-tabbar .settings-tab').allTextContents()
  for (const l of sLabels) { await nativeClick(w, '.settings-overlay .settings-tab', l.trim()); await w.waitForTimeout(120) }
  await nativeClick(w, '.settings-overlay button', 'Close')
  await w.waitForTimeout(150)

  // Modals via Tools.
  for (const item of ['Brand Kit', 'Import', 'Starting Soon Editor']) {
    await nativeClick(w, '.header button', 'Tools')
    await w.waitForTimeout(120)
    await nativeClick(w, 'button', item)
    await w.waitForTimeout(250)
    await nativeClick(w, '.settings-overlay button, [role="dialog"] button, .editor-close', 'Close')
    await w.keyboard.press('Escape').catch(() => {})
    await w.waitForTimeout(120)
  }

  // Visual editor.
  await nativeClick(w, '.overlay-preview')
  await w.waitForTimeout(250)
  await w.keyboard.press('Escape').catch(() => {})

  await expect(w.locator('text=Something went wrong')).toHaveCount(0)
})

test('no uncaught page exceptions were thrown during the tour', async () => {
  expect(pageErrors, pageErrors.join('\n')).toHaveLength(0)
})

test('no unexpected console errors (network/asset/probe noise filtered)', async () => {
  const ignore = /favicon|ERR_|net::|Failed to load resource|404|camera|OBS|obs|websocket|WebSocket|ECONN|fetch|discovery|supabase|DevTools|Autofill|GPU|Electron Security/i
  const real = consoleErrors.filter((e) => !ignore.test(e))
  expect(real, real.join('\n')).toHaveLength(0)
})
