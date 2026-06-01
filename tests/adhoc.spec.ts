// Phase D — Ad-hoc freeform overlay.
//
// Type anything → fire it live to OBS as a ONE-OFF lower-third (no saved
// trigger). Inputs exist in BB (local box) and CC (relay 'adhoc' broadcast).
// These tests drive the real path end-to-end against the BUILT out/ bundle:
//   window.api.overlayFireAdhoc → IPC OVERLAY_FIRE_ADHOC → overlay.fireAdhoc →
//   state mutation + WS broadcast → browser-source applyState() → DOM.
//
// We assert:
//   - fireAdhoc makes the overlay visible with the given title/subtitle (state
//     + browser-source DOM),
//   - it does NOT alter the saved triggers array / selectedIndex,
//   - getLastAdhoc returns the last fired content,
//   - the relay onAdhoc handler path fires an ad-hoc overlay (the IPC handler
//     and the relay callback both call overlay.fireAdhoc(title, subtitle) — we
//     exercise that shared function with a payload-shaped invocation),
//   - auto-hide still applies.
//
// Ports 19080/19081; workers=1.

import { test, expect, _electron as electron, ElectronApplication, Page, chromium, Browser } from '@playwright/test'
import path from 'path'

let app: ElectronApplication
let win: Page // Electron control window (drives state via window.api)
let browser: Browser
let overlay: Page // Chromium tab rendering http://127.0.0.1:<port>/overlay

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(__dirname, '..'), '--disable-gpu', '--no-sandbox'],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)

  const settings = await win.evaluate(async () => window.api.settingsGet())
  const httpPort = settings.server?.httpPort || 9876

  // Seed two known triggers + select index 1 so we can prove ad-hoc leaves the
  // saved playlist untouched. Use a long auto-hide so a fired overlay stays up.
  await win.evaluate(async () => {
    await window.api.triggerClearAll()
    await window.api.triggerAdd({ id: 'ah-1', name: 'Saved One', title: 'Saved One', subtitle: 'Sub One', category: '', order: 0, logoDataUrl: '' })
    await window.api.triggerAdd({ id: 'ah-2', name: 'Saved Two', title: 'Saved Two', subtitle: 'Sub Two', category: '', order: 1, logoDataUrl: '' })
    await window.api.triggerSelect(1)
    await window.api.overlayUpdateStyling({ autoHideSeconds: 0 })
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

async function settle() {
  await overlay.waitForTimeout(350)
}

test('fireAdhoc makes the overlay visible with the given title/subtitle', async () => {
  await win.evaluate(() => window.api.overlayFireAdhoc('Adhoc Headline', 'Adhoc Subline'))
  await settle()
  const state = await win.evaluate(() => window.api.overlayGetState())
  expect(state.lowerThird.visible).toBe(true)
  expect(state.lowerThird.title).toBe('Adhoc Headline')
  expect(state.lowerThird.subtitle).toBe('Adhoc Subline')

  // Browser-source DOM reflects the pushed state.
  await expect(overlay.locator('#lt')).toHaveClass(/visible/)
  await expect(overlay.locator('#lt-title')).toHaveText('Adhoc Headline')
  await expect(overlay.locator('#lt-subtitle')).toHaveText('Adhoc Subline')
})

test('fireAdhoc does NOT alter the saved triggers array / selectedIndex', async () => {
  const before = await win.evaluate(() => window.api.triggerList())
  expect(before.triggers.length).toBe(2)
  expect(before.selectedIndex).toBe(1)

  await win.evaluate(() => window.api.overlayFireAdhoc('Transient Only', ''))
  await settle()

  const after = await win.evaluate(() => window.api.triggerList())
  expect(after.triggers.length).toBe(2)
  expect(after.triggers[0].title).toBe('Saved One')
  expect(after.triggers[1].title).toBe('Saved Two')
  expect(after.selectedIndex).toBe(1)
})

test('getLastAdhoc returns the last fired content', async () => {
  await win.evaluate(() => window.api.overlayFireAdhoc('Last Title', 'Last Subtitle'))
  await settle()
  const last = await win.evaluate(() => window.api.overlayGetLastAdhoc())
  expect(last).not.toBeNull()
  expect(last!.title).toBe('Last Title')
  expect(last!.subtitle).toBe('Last Subtitle')
  expect(typeof last!.at).toBe('number')
})

test('relay onAdhoc handler path fires an ad-hoc overlay (payload-shaped invoke)', async () => {
  // ipc.ts wires ccRelay.setOnAdhoc((payload) => overlay.fireAdhoc(payload.title,
  // payload.subtitle)). That handler delegates to the same overlay.fireAdhoc the
  // IPC channel uses, so a payload-shaped fire exercises the identical path.
  const payload = { title: 'Relay Adhoc', subtitle: 'From CC' }
  await win.evaluate((p) => window.api.overlayFireAdhoc(p.title, p.subtitle), payload)
  await settle()
  const state = await win.evaluate(() => window.api.overlayGetState())
  expect(state.lowerThird.visible).toBe(true)
  expect(state.lowerThird.title).toBe('Relay Adhoc')
  expect(state.lowerThird.subtitle).toBe('From CC')
  await expect(overlay.locator('#lt-title')).toHaveText('Relay Adhoc')
})

test('auto-hide still applies to an ad-hoc fire', async () => {
  // Set a 1s auto-hide, fire, confirm visible, then confirm it hides itself.
  await win.evaluate(() => window.api.overlayUpdateStyling({ autoHideSeconds: 1 }))
  await win.evaluate(() => window.api.overlayFireAdhoc('Auto Hide Me', ''))
  await settle()
  await expect(overlay.locator('#lt')).toHaveClass(/visible/)
  // Wait past the 1s timer (+ propagation).
  await overlay.waitForTimeout(1500)
  await expect(overlay.locator('#lt')).not.toHaveClass(/visible/)
  // Restore manual-only for any later state.
  await win.evaluate(() => window.api.overlayUpdateStyling({ autoHideSeconds: 0 }))
})

test('cleanup', async () => {
  await win.evaluate(async () => {
    await window.api.overlayHideLT()
    await window.api.triggerClearAll()
  })
})
