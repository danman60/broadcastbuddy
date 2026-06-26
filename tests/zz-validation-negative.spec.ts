import { test, expect } from '@playwright/test'
import { launchApp, closeApp, api, Harness } from './zz-harness'

/**
 * Negative / empty / invalid-input handling. Every handler should degrade
 * gracefully (return null/error/no-op) rather than throw an uncaught error that
 * would crash the main process mid-show. These are the "what the operator does
 * wrong under pressure" cases.
 */

let h: Harness
test.beforeAll(async () => { h = await launchApp() })
test.afterAll(async () => { await closeApp(h) })

test('sessionLoad with a nonexistent id returns falsy, not a throw', async () => {
  const res = await api<unknown>(h.window, 'sessionLoad', 'does-not-exist-zzzz')
  expect(res === null || res === undefined || res === false).toBe(true)
})

test('sessionNew with empty name still returns a session object', async () => {
  const res = await api<{ id?: string }>(h.window, 'sessionNew', '')
  expect(res).toBeTruthy()
})

test('triggerDelete on a missing id is a safe no-op', async () => {
  await api(h.window, 'triggerClearAll')
  const arr = await api<unknown[]>(h.window, 'triggerDelete', 'missing-zzzz')
  expect(Array.isArray(arr)).toBe(true)
  expect(arr.length).toBe(0)
})

test('triggerUpdate on a missing id does not create a phantom trigger', async () => {
  await api(h.window, 'triggerClearAll')
  await api(h.window, 'triggerUpdate', 'missing-zzzz', { title: 'ghost' })
  const list = await api<{ triggers: unknown[] }>(h.window, 'triggerList')
  expect(list.triggers.length).toBe(0)
})

test('triggerReorder with unknown ids does not throw or corrupt', async () => {
  await api(h.window, 'triggerClearAll')
  await api(h.window, 'triggerAdd', { id: 'r1', title: 'One', type: 'lower_third' })
  await api(h.window, 'triggerReorder', ['bogus', 'r1', 'also-bogus'])
  const list = await api<{ triggers: Array<{ id: string }> }>(h.window, 'triggerList')
  // The real trigger must survive a reorder referencing junk ids.
  expect(list.triggers.some((t) => t.id === 'r1')).toBe(true)
  await api(h.window, 'triggerClearAll')
})

test('counterSet accepts negative and large values', async () => {
  await api(h.window, 'overlayCounterSet', -5)
  let s = await api<{ counter: { value: number } }>(h.window, 'overlayGetState')
  expect(s.counter.value).toBe(-5)
  await api(h.window, 'overlayCounterSet', 999999)
  s = await api<{ counter: { value: number } }>(h.window, 'overlayGetState')
  expect(s.counter.value).toBe(999999)
  await api(h.window, 'overlayCounterSet', 0)
})

test('tickerShow with empty text does not throw', async () => {
  await api(h.window, 'tickerShow', '')
  const s = await api<{ ticker: { visible: boolean } }>(h.window, 'overlayGetState')
  expect(typeof s.ticker.visible).toBe('boolean')
  await api(h.window, 'tickerHide')
})

test('settingsSet with an unknown key persists without throwing', async () => {
  await api(h.window, 'settingsSet', 'zzUnknownKey', { nested: true })
  const s = await api<Record<string, unknown>>(h.window, 'settingsGet')
  expect(s.zzUnknownKey).toBeTruthy()
})

test('notesAdd with empty string returns a note (or no-op) without throwing', async () => {
  const before = await api<unknown[]>(h.window, 'notesList')
  const res = await api<unknown>(h.window, 'notesAdd', '')
  expect(res).not.toBeUndefined()
  const after = await api<unknown[]>(h.window, 'notesList')
  expect(Array.isArray(after)).toBe(true)
  expect(after.length).toBeGreaterThanOrEqual(before.length)
})

test('notesDelete on a missing id is a safe no-op (list stays intact)', async () => {
  // Handler returns void; success = it doesn't throw and the list is still valid.
  await api(h.window, 'notesDelete', 'missing-note-zzzz')
  const list = await api<unknown[]>(h.window, 'notesList')
  expect(Array.isArray(list)).toBe(true)
})

test('importDocument on a missing path rejects (caught by ImportPanel try/catch)', async () => {
  // The handler surfaces the parser error; the only real caller (ImportPanel)
  // wraps the call in try/catch and only ever passes a real file-picker path. We
  // assert the rejection is observable so the contract is documented.
  let threw = false
  try {
    await api(h.window, 'importDocument', '/no/such/file/zzzz.pdf')
  } catch {
    threw = true
  }
  expect(threw).toBe(true)
})

test('overlayFeatureHide when nothing is shown is idempotent', async () => {
  await api(h.window, 'overlayFeatureHide')
  await api(h.window, 'overlayFeatureHide')
  const s = await api<{ featureCard: { visible: boolean } }>(h.window, 'overlayGetState')
  expect(s.featureCard.visible).toBe(false)
})

test('overlayHideLT when nothing is fired is idempotent', async () => {
  await api(h.window, 'overlayHideLT')
  const s = await api<{ lowerThird: { visible: boolean } }>(h.window, 'overlayGetState')
  expect(s.lowerThird.visible).toBe(false)
})

test('dayChecklistSetItem with an unknown item id does not throw', async () => {
  const res = await api<unknown>(h.window, 'dayChecklistSetItem', '2026-01-01', 'start', 'unknown-item-zzzz', 'checked')
  expect(res).not.toBeUndefined()
})

test('chatPin / chatUnpin on a missing message id are safe no-ops', async () => {
  await api(h.window, 'chatPin', 'missing-msg-zzzz')
  await api(h.window, 'chatUnpin', 'missing-msg-zzzz')
  const s = await api<{ messages?: unknown[] }>(h.window, 'chatGetState')
  expect(s).toBeTruthy()
})
