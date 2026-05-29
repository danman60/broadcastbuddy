// Small untested IPC behaviors / edge cases. Additive coverage — these lock in
// real behaviors (counter clamp, event-log filtering, ticker merge, playlist
// reset) so future regressions surface.

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

test.afterAll(async () => { await app?.close() })

test('counter bump clamps at zero (never negative)', async () => {
  await win.evaluate(() => window.api.overlayCounterSet(5))
  let st = await win.evaluate(() => window.api.overlayGetState())
  expect(st.counter.value).toBe(5)
  const bumped = await win.evaluate(() => window.api.overlayCounterBump(-10))
  expect(bumped.value).toBe(0) // clamped, not -5
  st = await win.evaluate(() => window.api.overlayGetState())
  expect(st.counter.value).toBe(0)
})

test('counter bump adds positively', async () => {
  await win.evaluate(() => window.api.overlayCounterSet(1))
  const b = await win.evaluate(() => window.api.overlayCounterBump(4))
  expect(b.value).toBe(5)
})

test('event log respects the limit argument', async () => {
  const all = await win.evaluate(() => window.api.eventsGetRecent(500))
  expect(all.length).toBeGreaterThan(0) // boot 'system' event guarantees ≥1
  const one = await win.evaluate(() => window.api.eventsGetRecent(1))
  expect(one.length).toBe(1)
})

test('event log filters by kind', async () => {
  const sys = await win.evaluate(() => window.api.eventsGetRecent(500, 'system'))
  expect(Array.isArray(sys)).toBe(true)
  // The 'BroadcastBuddy started' boot event is kind 'system' → non-empty.
  expect(sys.length).toBeGreaterThan(0)
  for (const r of sys) expect(r.kind).toBe('system')
})

test('ticker update merges fields without clearing text', async () => {
  await win.evaluate(() => window.api.tickerShow('Edge ticker', 60, '#111111', '#eeeeee'))
  await win.evaluate(() => window.api.tickerUpdate({ speed: 120 }))
  const st = await win.evaluate(() => window.api.overlayGetState())
  expect(st.ticker.text).toBe('Edge ticker') // preserved
  expect(st.ticker.speed).toBe(120) // patched
  expect(st.ticker.visible).toBe(true)
  await win.evaluate(() => window.api.tickerHide())
})

test('playlist reset position + clear played', async () => {
  await win.evaluate(async () => {
    await window.api.triggerClearAll()
    await window.api.triggerAdd({ id: 'e-a', name: 'A', title: 'A', subtitle: '', category: '', order: 0, logoDataUrl: '' })
    await window.api.triggerAdd({ id: 'e-b', name: 'B', title: 'B', subtitle: '', category: '', order: 1, logoDataUrl: '' })
    await window.api.triggerSelect(1)
    await window.api.overlayFireLT() // marks a played id
  })
  await win.evaluate(() => window.api.playlistResetPosition())
  let status = await win.evaluate(() => window.api.playlistGetStatus())
  expect(status.current).toBe(1) // 1-indexed → back to first
  await win.evaluate(() => window.api.playlistClearPlayed())
  status = await win.evaluate(() => window.api.playlistGetStatus())
  expect(status.playedIds.length).toBe(0)
})

test('sessionGetCurrent reflects a freshly created session', async () => {
  const s = await win.evaluate(() => window.api.sessionNew('edge-test-session'))
  expect(s.name).toBe('edge-test-session')
  const cur = await win.evaluate(() => window.api.sessionGetCurrent())
  expect(cur?.name).toBe('edge-test-session')
})

test('cleanup', async () => {
  await win.evaluate(() => window.api.triggerClearAll())
})
