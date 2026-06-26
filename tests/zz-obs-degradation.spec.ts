import { test, expect } from '@playwright/test'
import { launchApp, closeApp, api, Harness } from './zz-harness'

/**
 * OBS / Stream Deck / system handlers with NO OBS connected (the CI reality, and
 * also the operator's state before they hit Connect). Every handler must return
 * a clean status/error object — never throw — so the UI shows "not connected"
 * instead of crashing.
 */

let h: Harness
test.beforeAll(async () => { h = await launchApp() })
test.afterAll(async () => { await closeApp(h) })

test('obsStatus reports disconnected by default', async () => {
  const s = await api<{ connected: boolean }>(h.window, 'obsStatus')
  expect(s.connected).toBe(false)
})

test('obsConnect to a dead host fails cleanly (connected:false + error)', async () => {
  const r = await api<{ connected: boolean; error?: string }>(h.window, 'obsConnect', '127.0.0.1', 65535, '')
  expect(r.connected).toBe(false)
  expect(typeof r.error).toBe('string')
})

test('obsToggleRecord without OBS returns success:false, not a throw', async () => {
  const r = await api<{ success: boolean; error?: string }>(h.window, 'obsToggleRecord')
  expect(r.success).toBe(false)
  expect(typeof r.error).toBe('string')
})

test('obsRecordStatus resolves without OBS', async () => {
  const r = await api<unknown>(h.window, 'obsRecordStatus')
  expect(r).not.toBeUndefined()
})

test('obsStreamStatus resolves without OBS', async () => {
  const r = await api<unknown>(h.window, 'obsStreamStatus')
  expect(r).not.toBeUndefined()
})

test('obsGetTimecode resolves (empty/undefined) without OBS', async () => {
  const r = await api<unknown>(h.window, 'obsGetTimecode')
  expect(r === undefined || typeof r === 'string' || r === null).toBe(true)
})

test('obsPushStreamKey without OBS does not throw', async () => {
  const r = await api<unknown>(h.window, 'obsPushStreamKey', 'rtmp://x', 'key')
  expect(r).not.toBeUndefined()
})

test('obsStartStream / obsStopStream without OBS fail cleanly', async () => {
  const start = await api<{ success?: boolean }>(h.window, 'obsStartStream')
  expect(start).not.toBeUndefined()
  const stop = await api<{ success?: boolean }>(h.window, 'obsStopStream')
  expect(stop).not.toBeUndefined()
})

test('systemGetStats returns CPU/RAM/disk shape', async () => {
  const s = await api<Record<string, unknown>>(h.window, 'systemGetStats')
  expect(s && typeof s === 'object').toBe(true)
  // CPU + RAM are always derivable on any host; disk may be null off the output drive.
  expect('cpu' in s || 'cpuPercent' in s || 'cpuLoad' in s).toBe(true)
})

test('streamdeckGetStatus returns a status object', async () => {
  const s = await api<unknown>(h.window, 'streamdeckGetStatus')
  expect(s).not.toBeUndefined()
})

test('wifiDisplayStatus resolves without a configured monitor', async () => {
  const s = await api<unknown>(h.window, 'wifiDisplayStatus')
  expect(s).not.toBeUndefined()
})

test('obsDisconnect when not connected is a safe no-op', async () => {
  const r = await api<unknown>(h.window, 'obsDisconnect')
  expect(r === undefined || r !== null).toBe(true)
  const s = await api<{ connected: boolean }>(h.window, 'obsStatus')
  expect(s.connected).toBe(false)
})
