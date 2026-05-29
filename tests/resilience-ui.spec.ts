import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'

// Operator resilience UI + IPC coverage:
//  - RecoveryBanner / StartupToast mount without crashing (both render null
//    unless main has a pending snapshot / startup problems — so we assert the
//    backing IPC instead of a fragile always-present DOM node).
//  - EventLogPanel + System (SystemStats) panels render in the right panel.
//  - eventsGetRecent + systemGetStats IPC return valid records/stats.
//  - Settings overlay (opened via Tools menu) renders the Stream Deck Plugin
//    and Global Hotkeys sections.
//
// Launch pattern mirrors tests/app.spec.ts exactly. Ports are read from
// settingsGet() — never hardcoded. Runs with --workers=1 so fixed ports
// don't collide.

let app: ElectronApplication
let window: Page

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
  // Clean slate so trigger-count assertions and the recovery banner state are
  // deterministic for this run.
  await window.evaluate(async () => {
    await window.api.triggerClearAll()
  })
})

test.afterAll(async () => {
  if (app) await app.close()
})

// ── Crash recovery (IPC-level — banner DOM is conditional) ───────────────────

test('IPC: recoveryCheck returns a well-formed RecoveryStatus', async () => {
  const status = await window.evaluate(async () => {
    return window.api.recoveryCheck()
  })
  expect(status).toBeTruthy()
  expect(status).toHaveProperty('available')
  expect(typeof status.available).toBe('boolean')
  expect(status).toHaveProperty('triggerCount')
  expect(typeof status.triggerCount).toBe('number')
})

test('RecoveryBanner mounts cleanly (no error overlay, app body present)', async () => {
  // RecoveryBanner returns null when no snapshot is pending. Its on-mount
  // recoveryCheck() must not throw / crash the renderer — verify the app body
  // is intact and any rendered banner is well-formed when present.
  const body = window.locator('.app-body')
  await expect(body).toBeVisible()
  const banner = window.locator('button:has-text("Restore")')
  const count = await banner.count()
  // Banner is optional. If it rendered, the Dismiss action must exist too.
  if (count > 0) {
    await expect(window.locator('button:has-text("Dismiss")')).toBeVisible()
  }
})

// ── Startup report (IPC-level — toast DOM is conditional) ────────────────────

test('IPC: startupGetReport returns a report or null without throwing', async () => {
  const report = await window.evaluate(async () => {
    return window.api.startupGetReport()
  })
  // May be null if startup checks haven't run yet; if present it must carry
  // a checks array.
  if (report !== null) {
    expect(report).toHaveProperty('ranAt')
    expect(report).toHaveProperty('checks')
    expect(Array.isArray(report.checks)).toBe(true)
  }
})

// ── Event log ────────────────────────────────────────────────────────────────

test('IPC: eventsGetRecent returns an array of records', async () => {
  const rows = await window.evaluate(async () => {
    return window.api.eventsGetRecent(50)
  })
  expect(Array.isArray(rows)).toBe(true)
  // If any events have been recorded, each carries t/kind/message.
  if (rows.length > 0) {
    const r = rows[0]
    expect(r).toHaveProperty('t')
    expect(r).toHaveProperty('kind')
    expect(r).toHaveProperty('message')
  }
})

test('EventLogPanel renders in the right panel', async () => {
  const title = window.locator('.panel-section-title', { hasText: 'Event Log' })
  await expect(title).toBeVisible()
})

// ── System stats panel ───────────────────────────────────────────────────────

test('IPC: systemGetStats returns CPU/RAM/disk fields', async () => {
  const stats = await window.evaluate(async () => {
    return window.api.systemGetStats()
  })
  expect(stats).toBeTruthy()
  expect(stats).toHaveProperty('cpuPercent')
  expect(typeof stats.cpuPercent).toBe('number')
  expect(stats).toHaveProperty('memPercent')
  expect(typeof stats.memPercent).toBe('number')
  expect(stats).toHaveProperty('diskFreeGB')
  expect(stats).toHaveProperty('diskTotalGB')
  expect(stats).toHaveProperty('driveLost')
})

test('System panel renders and shows CPU/RAM/Disk rows after stats load', async () => {
  const title = window.locator('.panel-section-title', { hasText: 'System' })
  await expect(title).toBeVisible()

  // Ensure the panel is expanded (its title toggles collapse).
  const panel = title.locator('xpath=ancestor::*[contains(@class,"panel-section")][1]')
  const isCollapsed = await panel.evaluate((el) => el.classList.contains('collapsed'))
  if (isCollapsed) {
    await title.click()
    await window.waitForTimeout(200)
  }

  // The component seeds from systemGetStats() on mount, then swaps the
  // "Reading system stats…" placeholder for CPU/RAM/Disk rows. Give it a beat,
  // then assert the readout labels are present.
  await expect(panel.locator('text=CPU')).toBeVisible({ timeout: 4000 })
  await expect(panel.locator('text=RAM')).toBeVisible()
  await expect(panel.locator('text=Disk')).toBeVisible()
})

// ── Settings: Stream Deck Plugin + Global Hotkeys sections ───────────────────

test('Settings overlay shows Stream Deck Plugin + Global Hotkeys sections', async () => {
  // Open Settings via the Tools menu (mirrors app.spec.ts).
  await window.locator('button:has-text("Tools")').click()
  const settingsBtn = window.locator('button:has-text("Settings")').last()
  try {
    await settingsBtn.waitFor({ state: 'visible', timeout: 1000 })
    await settingsBtn.click()
  } catch {
    await window.locator('button:has-text("Tools")').click()
    await window.waitForTimeout(300)
    await settingsBtn.click({ timeout: 2000 })
  }
  await window.waitForTimeout(500)

  const overlay = window.locator('.settings-overlay')
  await expect(overlay).toBeVisible()

  const streamDeck = overlay.locator('.settings-group-title', { hasText: 'Stream Deck Plugin' })
  await expect(streamDeck).toBeVisible()

  const hotkeys = overlay.locator('.settings-group-title', { hasText: 'Global Hotkeys' })
  await expect(hotkeys).toBeVisible()

  // Close the overlay so app-level state is clean for any later runs.
  const closeBtn = overlay.locator('button:has-text("Close")')
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click()
    await window.waitForTimeout(300)
  }
})

// ── Cleanup ──────────────────────────────────────────────────────────────────

test('cleanup: clear triggers created during this run', async () => {
  await window.evaluate(async () => {
    await window.api.triggerClearAll()
  })
  const result = await window.evaluate(async () => {
    return window.api.triggerList()
  })
  expect(result).toHaveProperty('triggers')
  expect(Array.isArray(result.triggers)).toBe(true)
})
