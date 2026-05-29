// OBS connection lifecycle when no OBS is present (test env). Verifies the
// connect/disconnect/timecode/push paths fail SOFT with structured results
// rather than throwing — the operator-facing contract when OBS is down.

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
})

test.afterAll(async () => { await app?.close() })

test('status reports disconnected at startup', async () => {
  const s = await win.evaluate(() => window.api.obsStatus())
  expect(s.connected).toBe(false)
})

test('connect to a closed port fails soft (structured error, no throw)', async () => {
  // 127.0.0.1:65001 has no listener → immediate ECONNREFUSED (not the 10s timeout).
  const res = await win.evaluate(() => window.api.obsConnect('127.0.0.1', 65001))
  expect(res.connected).toBe(false)
  expect(typeof res.error).toBe('string')
  expect(res.error && res.error.length).toBeGreaterThan(0)
  // Status remains disconnected after a failed connect.
  const s = await win.evaluate(() => window.api.obsStatus())
  expect(s.connected).toBe(false)
})

test('disconnect is a safe no-op when not connected', async () => {
  const res = await win.evaluate(() => window.api.obsDisconnect())
  expect(res.connected).toBe(false)
})

test('getTimecode returns empty string when disconnected', async () => {
  const tc = await win.evaluate(() => window.api.obsGetTimecode())
  expect(tc).toBe('')
})

test('pushStreamKey fails soft when disconnected', async () => {
  const res = await win.evaluate(() => window.api.obsPushStreamKey('rtmp://x', 'key'))
  expect(res.success).toBe(false)
  expect(typeof res.error).toBe('string')
})

test('record status shape when disconnected', async () => {
  const s = await win.evaluate(() => window.api.obsRecordStatus())
  expect(s.active).toBe(false)
  expect(s).toHaveProperty('timecode')
})
