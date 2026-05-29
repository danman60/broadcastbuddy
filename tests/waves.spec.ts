// Wave 5–8 IPC surface (item 3).
//
// Exercises the main-process handlers behind the ported features that DON'T
// need live OBS / a tablet / Supabase: record control (fails soft when OBS is
// down), slow-zoom + transition-revert state, the overlay elements
// (clock/counter/feature/grid), day checklist, operator chat (disabled by
// default), event log, crash recovery, startup report, and settings backup.
//
// These assert the handlers are wired and return the documented shapes without
// throwing. OBS-dependent calls are verified to FAIL SOFT (no throw, structured
// error), not to succeed — live OBS behaviour is the user's job on FIRMAMENT.

import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'

let app: ElectronApplication
let win: Page

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(__dirname, '..'), '--disable-gpu', '--no-sandbox'],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  await win.evaluate(async () => window.api.triggerClearAll())
})

test.afterAll(async () => {
  await app?.close()
})

// ── Wave 5: OBS record control + audio meters ─────────────────────────────────

test('record status returns a RecordState shape', async () => {
  const s = await win.evaluate(() => window.api.obsRecordStatus())
  expect(s).toHaveProperty('active')
  expect(typeof s.active).toBe('boolean')
  expect(s).toHaveProperty('timecode')
})

test('record start/stop/toggle fail soft when OBS is disconnected', async () => {
  const start = await win.evaluate(() => window.api.obsStartRecord())
  expect(start).toHaveProperty('success')
  expect(start.success).toBe(false) // OBS not connected in test env
  const stop = await win.evaluate(() => window.api.obsStopRecord())
  expect(stop.success).toBe(false)
  const toggle = await win.evaluate(() => window.api.obsToggleRecord())
  expect(toggle.success).toBe(false)
})

// ── Wave 2: slow zoom + transition auto-revert ────────────────────────────────

test('slow-zoom status returns both scene flags', async () => {
  const s = await win.evaluate(() => window.api.obsSlowZoomStatus())
  expect(s).toHaveProperty('wideZoomedIn')
  expect(s).toHaveProperty('tightZoomedIn')
  expect(typeof s.wideZoomedIn).toBe('boolean')
})

test('slow-zoom triggers fail soft (OBS down) and return a status', async () => {
  const w = await win.evaluate(() => window.api.obsSlowZoomTriggerWide())
  expect(w).toHaveProperty('wideZoomedIn')
  const t = await win.evaluate(() => window.api.obsSlowZoomTriggerTight())
  expect(t).toHaveProperty('tightZoomedIn')
})

test('transition auto-revert get/set round-trips', async () => {
  const before = await win.evaluate(() => window.api.obsTransitionRevertGet())
  expect(before).toHaveProperty('enabled')
  const set = await win.evaluate(() => window.api.obsTransitionRevertSet(true))
  expect(set.enabled).toBe(true)
  const after = await win.evaluate(() => window.api.obsTransitionRevertGet())
  expect(after.enabled).toBe(true)
  // restore
  await win.evaluate((v: boolean) => window.api.obsTransitionRevertSet(v), before.enabled)
})

// ── Wave 7: overlay elements (clock / counter / feature card / grid) ──────────

test('clock toggle returns visibility and round-trips back off', async () => {
  const on = await win.evaluate(() => window.api.overlayClockToggle())
  expect(typeof on.visible).toBe('boolean')
  const off = await win.evaluate(() => window.api.overlayClockToggle())
  expect(off.visible).toBe(!on.visible)
})

test('counter set + bump update overlay state', async () => {
  await win.evaluate(() => window.api.overlayCounterToggle())
  await win.evaluate(() => window.api.overlayCounterSet(10, 'ENTRY'))
  let st = await win.evaluate(() => window.api.overlayGetState())
  expect(st.counter.value).toBe(10)
  expect(st.counter.label).toBe('ENTRY')
  const bumped = await win.evaluate(() => window.api.overlayCounterBump(3))
  expect(bumped.value).toBe(13)
  st = await win.evaluate(() => window.api.overlayGetState())
  expect(st.counter.value).toBe(13)
  await win.evaluate(() => window.api.overlayCounterToggle())
})

test('feature up-next / that-was fire from neighbouring triggers', async () => {
  // Need >=2 triggers and a selected position for a neighbour to exist.
  await win.evaluate(async () => {
    await window.api.triggerClearAll()
    await window.api.triggerAdd({ id: 'w-a', name: 'A', title: 'First', subtitle: '', category: '', order: 0, logoDataUrl: '' })
    await window.api.triggerAdd({ id: 'w-b', name: 'B', title: 'Second', subtitle: '', category: '', order: 1, logoDataUrl: '' })
    await window.api.triggerSelect(0)
  })
  const up = await win.evaluate(() => window.api.overlayFeatureUpNext('UP NEXT'))
  expect(up).toHaveProperty('fired')
  expect(up.fired).toBe(true) // neighbour (index 1) exists
  const st = await win.evaluate(() => window.api.overlayGetState())
  expect(st.featureCard.visible).toBe(true)
  await win.evaluate(() => window.api.overlayFeatureHide())
})

test('grid toggle returns visibility', async () => {
  const on = await win.evaluate(() => window.api.overlayGridToggle())
  expect(typeof on.visible).toBe('boolean')
  await win.evaluate(() => window.api.overlayGridToggle())
})

// ── Wave 8: day checklist ─────────────────────────────────────────────────────

test('day checklist should-show returns a decision + date', async () => {
  const r = await win.evaluate(() => window.api.dayChecklistShouldShow())
  expect(r).toHaveProperty('should')
  expect(r).toHaveProperty('date')
  expect(typeof r.should).toBe('boolean')
})

test('day checklist get returns a populated view; set-item persists', async () => {
  const view = await win.evaluate(() => window.api.dayChecklistGet('2026-05-28', 'start'))
  expect(view).toHaveProperty('items')
  expect(Array.isArray(view.items)).toBe(true)
  expect(view.items.length).toBeGreaterThan(0)
  const firstId = view.items[0].id
  const updated = await win.evaluate((id: string) => window.api.dayChecklistSetItem('2026-05-28', 'start', id, 'checked'), firstId)
  expect(updated.state.items[firstId]).toBe('checked')
})

// ── Wave 8: operator chat (disabled by default — no Supabase project) ─────────

test('chat get-state reports disabled/disconnected by default', async () => {
  const s = await win.evaluate(() => window.api.chatGetState())
  expect(s).toHaveProperty('enabled')
  expect(s).toHaveProperty('connected')
  expect(s.enabled).toBe(false)
  expect(s.connected).toBe(false)
  expect(Array.isArray(s.messages)).toBe(true)
})

test('chat reconfigure does not throw when unconfigured', async () => {
  const s = await win.evaluate(() => window.api.chatReconfigure())
  expect(s).toHaveProperty('enabled')
})

// ── Wave 6: operator resilience (events / recovery / startup / backup) ────────

test('event log returns recent records', async () => {
  const events = await win.evaluate(() => window.api.eventsGetRecent(20))
  expect(Array.isArray(events)).toBe(true)
  // The app records session/startup events on boot, so there should be some.
  if (events.length > 0) {
    expect(events[0]).toHaveProperty('kind')
    expect(events[0]).toHaveProperty('message')
  }
})

test('crash recovery check returns a status', async () => {
  const r = await win.evaluate(() => window.api.recoveryCheck())
  expect(r).toHaveProperty('available')
  expect(typeof r.available).toBe('boolean')
})

test('startup report is fetchable (object or null)', async () => {
  const r = await win.evaluate(() => window.api.startupGetReport())
  if (r) {
    expect(r).toHaveProperty('checks')
    expect(Array.isArray(r.checks)).toBe(true)
  }
})

test('settings backup now + list round-trip', async () => {
  const now = await win.evaluate(() => window.api.backupNow())
  expect(now).toHaveProperty('ok')
  const list = await win.evaluate(() => window.api.backupList())
  expect(Array.isArray(list)).toBe(true)
  if (now.ok) {
    expect(list.length).toBeGreaterThan(0)
    expect(list[0]).toHaveProperty('file')
    expect(list[0]).toHaveProperty('createdAt')
  }
})
