import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'

/**
 * Operator Day Checklist — IPC lifecycle + DayChecklist renderer mount.
 *
 * Covers both halves of the feature:
 *   1. The DAY_CHECKLIST_* IPC handlers (get / set-item / dismiss / reopen)
 *      via window.api.dayChecklist* — assert the DayChecklistView shape and
 *      that state persists across a re-get.
 *   2. The DayChecklist React component — opened through the Header → Tools
 *      menu ("Start-of-Day Checklist"), which sets store.showDayChecklist and
 *      causes the modal to mount. Asserts the dialog renders without error.
 *
 * Item definitions are static in the main process (src/main/services/
 * dayChecklistItems.ts): start = 6 items (first id 'obs-record-path'),
 * end = 5 items (first id 'recording-stopped'). An empty date string falls
 * back to dayChecklist.todayKey() in the IPC layer, but these tests pass a
 * fixed date ('2026-05-29') so persistence assertions are deterministic.
 */

let app: ElectronApplication
let window: Page

const DATE = '2026-05-29'

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
  await window.waitForTimeout(2000)

  // Clean slate for triggers (matches app.spec.ts convention).
  await window.evaluate(async () => {
    await window.api.triggerClearAll()
  })
})

test.afterAll(async () => {
  if (app) await app.close()
})

// ── IPC: get returns a view with items ───────────────────────────

test('IPC: dayChecklistGet(start) returns a view with start items', async () => {
  const view = await window.evaluate(async (date) => {
    return window.api.dayChecklistGet(date, 'start')
  }, DATE)

  expect(view).toBeTruthy()
  expect(view.kind).toBe('start')
  expect(view.date).toBe(DATE)
  expect(Array.isArray(view.items)).toBe(true)
  expect(view.items.length).toBe(6)
  // Each item has id + label
  for (const it of view.items) {
    expect(typeof it.id).toBe('string')
    expect(typeof it.label).toBe('string')
  }
  expect(view.items[0].id).toBe('obs-record-path')

  // state shape
  expect(view.state).toBeTruthy()
  expect(view.state).toHaveProperty('items')
  expect(view.state).toHaveProperty('dismissed')
})

test('IPC: dayChecklistGet(end) returns a view with end items', async () => {
  const view = await window.evaluate(async (date) => {
    return window.api.dayChecklistGet(date, 'end')
  }, DATE)

  expect(view.kind).toBe('end')
  expect(view.date).toBe(DATE)
  expect(view.items.length).toBe(5)
  expect(view.items[0].id).toBe('recording-stopped')
})

// ── IPC: set-item persists, re-get reflects ──────────────────────

test('IPC: dayChecklistSetItem(checked) persists and re-get reflects it', async () => {
  const itemId = 'obs-record-path'

  const afterSet = await window.evaluate(async ({ date, itemId }) => {
    return window.api.dayChecklistSetItem(date, 'start', itemId, 'checked')
  }, { date: DATE, itemId })

  // set-item returns the full DayChecklistView
  expect(afterSet.kind).toBe('start')
  expect(afterSet.state.items[itemId]).toBe('checked')

  // Independent re-get must reflect the persisted state
  const reGet = await window.evaluate(async (date) => {
    return window.api.dayChecklistGet(date, 'start')
  }, DATE)
  expect(reGet.state.items[itemId]).toBe('checked')
})

test('IPC: dayChecklistSetItem supports skipped and na states', async () => {
  const afterSkip = await window.evaluate(async (date) => {
    return window.api.dayChecklistSetItem(date, 'start', 'audio-levels', 'skipped')
  }, DATE)
  expect(afterSkip.state.items['audio-levels']).toBe('skipped')

  const afterNa = await window.evaluate(async (date) => {
    return window.api.dayChecklistSetItem(date, 'start', 'stream-key', 'na')
  }, DATE)
  expect(afterNa.state.items['stream-key']).toBe('na')

  // Re-get confirms all three distinct states coexist
  const view = await window.evaluate(async (date) => {
    return window.api.dayChecklistGet(date, 'start')
  }, DATE)
  expect(view.state.items['obs-record-path']).toBe('checked')
  expect(view.state.items['audio-levels']).toBe('skipped')
  expect(view.state.items['stream-key']).toBe('na')
})

// ── IPC: dismiss marks dismissed ─────────────────────────────────

test('IPC: dayChecklistDismiss marks the day dismissed', async () => {
  // NB: don't assert the initial dismissed state — dayChecklist persists to
  // userData, so a prior run may have left this date dismissed. Assert the
  // dismiss transition + persistence instead (run-order independent).
  const afterDismiss = await window.evaluate(async (date) => {
    return window.api.dayChecklistDismiss(date, 'start')
  }, DATE)
  expect(afterDismiss.state.dismissed).toBe(true)

  // Persisted: re-get still shows dismissed
  const reGet = await window.evaluate(async (date) => {
    return window.api.dayChecklistGet(date, 'start')
  }, DATE)
  expect(reGet.state.dismissed).toBe(true)
})

// ── IPC: reopen returns today's view ─────────────────────────────

test('IPC: dayChecklistReopen returns a view for today', async () => {
  const view = await window.evaluate(async () => {
    return window.api.dayChecklistReopen('end')
  })
  expect(view.kind).toBe('end')
  expect(typeof view.date).toBe('string')
  // todayKey() format: YYYY-MM-DD
  expect(view.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(view.items.length).toBe(5)
})

// ── Component: DayChecklist mounts when opened via Tools menu ─────

test('Component: DayChecklist mounts when opened from Tools menu', async () => {
  // App body must be present before/after the interaction (no crash).
  await expect(window.locator('body')).toBeVisible()

  // Open Tools menu, then click the Start-of-Day Checklist entry.
  await window.locator('button:has-text("Tools")').click()
  await window.waitForTimeout(300)

  const startBtn = window.locator('button:has-text("Start-of-Day Checklist")')
  await startBtn.waitFor({ state: 'visible', timeout: 2000 })
  await startBtn.click()
  await window.waitForTimeout(500)

  await window.screenshot({ path: 'test-results/daychecklist-open.png' })

  // The modal renders as a .settings-overlay dialog with the start title.
  const dialog = window.locator('.settings-overlay[role="dialog"]')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Start of Day')

  // Body still present — component mounted without error.
  await expect(window.locator('body')).toBeVisible()

  // Dismiss via the header "Done" button (calls dayChecklistDismiss + closes).
  const doneBtn = dialog.locator('button.btn-ghost:has-text("Done")')
  if (await doneBtn.isVisible().catch(() => false)) {
    await doneBtn.click()
    await window.waitForTimeout(300)
  }
})

test('Component: closing the checklist removes the dialog', async () => {
  // After the prior test dismissed it, the dialog should be gone.
  const dialog = window.locator('.settings-overlay[role="dialog"]')
  const stillOpen = await dialog.isVisible().catch(() => false)
  expect(stillOpen).toBe(false)
  await expect(window.locator('body')).toBeVisible()
})
