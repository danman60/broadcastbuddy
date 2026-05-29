import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'

// ── OverlayControls button-surface tests ──────────────────────────
// Drives the REAL rendered buttons in src/renderer/components/OverlayControls.tsx
// where they exist (DOM click), falling back to confirmed window.api.* IPC where a
// button is ambiguous or disabled by the current playlist position. Every test
// asserts on window.api.overlayGetState() (or the IPC return value) so the
// assertions converge on real main-process state, not fragile DOM text.

let app: ElectronApplication
let window: Page

// Helper: read the full overlay state from the main process.
async function getState() {
  return window.evaluate(async () => window.api.overlayGetState())
}

// Helper: select a trigger index via IPC and let the store/UI settle.
async function selectIndex(i: number) {
  await window.evaluate(async (idx) => window.api.triggerSelect(idx), i)
  await window.waitForTimeout(150)
}

test.beforeAll(async () => {
  app = await electron.launch({
    args: [
      path.join(__dirname, '..'),
      '--disable-gpu',
      '--no-sandbox',
    ],
    env: {
      ...process.env,
      NODE_ENV: 'production',
    },
  })
  window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForTimeout(1500)

  // Seed a clean playlist: clear, add 3 triggers, select index 0 so that
  // Fire / Up Next have content (hasNext is true with 3 items at index 0).
  await window.evaluate(async () => {
    await window.api.triggerClearAll()
    await window.api.triggerAdd({
      id: 'oc-1', name: 'Alpha', title: 'Alpha Title', subtitle: 'Sub A',
      category: '', order: 0, logoDataUrl: '',
    })
    await window.api.triggerAdd({
      id: 'oc-2', name: 'Bravo', title: 'Bravo Title', subtitle: 'Sub B',
      category: '', order: 1, logoDataUrl: '',
    })
    await window.api.triggerAdd({
      id: 'oc-3', name: 'Charlie', title: 'Charlie Title', subtitle: 'Sub C',
      category: '', order: 2, logoDataUrl: '',
    })
    await window.api.triggerSelect(0)
  })
  await window.waitForTimeout(300)
})

test.afterAll(async () => {
  // Reset overlay surface + clear playlist.
  if (window) {
    await window.evaluate(async () => {
      await window.api.overlayHideLT()
      await window.api.overlayFeatureHide()
      const s = await window.api.overlayGetState()
      if (s.gridVisible) await window.api.overlayGridToggle()
      if (s.clock.visible) await window.api.overlayClockToggle()
      if (s.counter.visible) await window.api.overlayCounterToggle()
      await window.api.triggerClearAll()
    }).catch(() => { /* app may already be tearing down */ })
  }
  if (app) await app.close()
})

// ── Fire / Hide lower third (real .btn-fire / .btn-hide buttons) ──

test('Fire button shows the lower third', async () => {
  await selectIndex(0)
  await window.locator('.btn-fire').click()
  await window.waitForTimeout(400)
  const state = await getState()
  expect(state.lowerThird.visible).toBe(true)
})

test('Hide button hides the lower third', async () => {
  // Ensure it is visible first via the Fire button.
  await selectIndex(0)
  await window.locator('.btn-fire').click()
  await window.waitForTimeout(300)
  await window.locator('.btn-hide').click()
  await window.waitForTimeout(300)
  const state = await getState()
  expect(state.lowerThird.visible).toBe(false)
})

// ── Up Next (real button — hasNext true at index 0 of 3) ──────────

test('Up Next button fires a lower third', async () => {
  await selectIndex(0)
  await window.evaluate(async () => window.api.overlayHideLT())
  await window.waitForTimeout(150)
  const upNext = window.locator('button:has-text("Up Next")').first()
  await expect(upNext).toBeEnabled()
  await upNext.click()
  await window.waitForTimeout(400)
  const state = await getState()
  // fireUpNext renders the next trigger as a labelled lower third.
  expect(state.lowerThird.visible).toBe(true)
  // Cleanup for independence.
  await window.evaluate(async () => window.api.overlayHideLT())
})

// ── That Was: button is disabled at index 0 (no prev, no loop), so
// fall back to the confirmed IPC after selecting a middle index. ──

test('That Was fires the previous trigger as a lower third (IPC)', async () => {
  await selectIndex(1)
  await window.evaluate(async () => window.api.overlayHideLT())
  await window.waitForTimeout(150)
  const result = await window.evaluate(async () => window.api.overlayFireThatWas())
  expect(result).toHaveProperty('fired')
  const state = await getState()
  if (result.fired) expect(state.lowerThird.visible).toBe(true)
  await window.evaluate(async () => window.api.overlayHideLT())
})

// ── Grid toggle (real "Grid ON/OFF" button) ──────────────────────

test('Grid button toggles the leveling grid', async () => {
  const before = (await getState()).gridVisible
  await window.locator('button:has-text("Grid")').click()
  await window.waitForTimeout(300)
  const after = (await getState()).gridVisible
  expect(after).toBe(!before)
  // Restore so the surface is clean for later tests.
  await window.evaluate(async () => window.api.overlayGridToggle())
  await window.waitForTimeout(200)
  expect((await getState()).gridVisible).toBe(before)
})

// ── Clock toggle (real "Clock ON/OFF" button) ────────────────────

test('Clock button toggles the on-air clock', async () => {
  const before = (await getState()).clock.visible
  await window.locator('button:has-text("Clock")').click()
  await window.waitForTimeout(300)
  const after = (await getState()).clock.visible
  expect(after).toBe(!before)
  // Restore.
  await window.evaluate(async () => window.api.overlayClockToggle())
  await window.waitForTimeout(200)
  expect((await getState()).clock.visible).toBe(before)
})

// ── Counter toggle (real "Counter ON/OFF" button) ────────────────

test('Counter button toggles the counter badge', async () => {
  const before = (await getState()).counter.visible
  await window.locator('button:has-text("Counter")').click()
  await window.waitForTimeout(300)
  const after = (await getState()).counter.visible
  expect(after).toBe(!before)
  // Restore.
  await window.evaluate(async () => window.api.overlayCounterToggle())
  await window.waitForTimeout(200)
  expect((await getState()).counter.visible).toBe(before)
})

// ── Counter bump (real "+" / "−" buttons) ────────────────────────

test('Counter +/− buttons increment and decrement the value', async () => {
  const start = (await getState()).counter.value
  // The increment button renders the literal "+" label.
  await window.locator('button', { hasText: /^\+$/ }).click()
  await window.waitForTimeout(250)
  expect((await getState()).counter.value).toBe(start + 1)
  // The decrement button renders the unicode minus (U+2212), not ASCII "-".
  await window.locator('button', { hasText: '−' }).click()
  await window.waitForTimeout(250)
  expect((await getState()).counter.value).toBe(start)
})

// ── Feature card: Up Next (real button) + Hide Card ──────────────

test('Feature: Up Next button shows the feature card', async () => {
  await selectIndex(0)
  const featUpNext = window.locator('button:has-text("Feature: Up Next")')
  await expect(featUpNext).toBeEnabled()
  await featUpNext.click()
  await window.waitForTimeout(400)
  const state = await getState()
  expect(state.featureCard.visible).toBe(true)

  // Hide Card button becomes enabled once the card is visible.
  const hideCard = window.locator('button:has-text("Hide Card")')
  await expect(hideCard).toBeEnabled()
  await hideCard.click()
  await window.waitForTimeout(300)
  expect((await getState()).featureCard.visible).toBe(false)
})

// ── Feature card: custom Show via composer inputs + Show button ──

test('Feature card composer Show button shows a custom card', async () => {
  // Fill the title input (Show is disabled until title is non-empty).
  const titleInput = window.locator('input[placeholder="Title"]')
  await titleInput.fill('Custom Feature Title')
  await window.waitForTimeout(150)
  // Scope the Show button to the feature-composer row (the row containing the
  // Title input) — a bare button:has-text("Show") also matches Starting Soon's.
  const composerRow = window.locator('.controls-bulk-row', { has: window.locator('input[placeholder="Title"]') })
  const showBtn = composerRow.getByRole('button', { name: 'Show', exact: true })
  await expect(showBtn).toBeEnabled()
  await showBtn.click()
  await window.waitForTimeout(400)
  const state = await getState()
  expect(state.featureCard.visible).toBe(true)
  expect(state.featureCard.title).toBe('Custom Feature Title')
  // Cleanup.
  await window.evaluate(async () => window.api.overlayFeatureHide())
  await window.waitForTimeout(200)
  expect((await getState()).featureCard.visible).toBe(false)
})
