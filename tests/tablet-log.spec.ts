// Tablet log sink — the HTTP POST endpoint (0.0.0.0:8766/tablet-log) that the
// CSController Android app posts batched logs to. Untested; real LAN endpoint.

import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'

let app: ElectronApplication
let win: Page
const URL = 'http://127.0.0.1:8766/tablet-log'

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(__dirname, '..'), '--disable-gpu', '--no-sandbox'],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500) // tablet log server starts during whenReady
})

test.afterAll(async () => { await app?.close() })

test('accepts a batch of log entries → {ok, accepted}', async () => {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ host: 'tablet-1', logs: [
      { msg: 'hello from tablet', level: 'info', tag: 'app' },
      { msg: 'a warning', level: 'warn' },
      { msg: 'an error', level: 'error', tag: 'net' },
    ] }),
  })
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.ok).toBe(true)
  expect(body.accepted).toBe(3)
})

test('skips entries with empty/missing msg', async () => {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ host: 'tablet-1', logs: [
      { msg: 'kept' },
      { msg: '' },        // skipped
      { level: 'info' },  // no msg → skipped
    ] }),
  })
  const body = await res.json()
  expect(body.ok).toBe(true)
  expect(body.accepted).toBe(1)
})

test('invalid JSON body → 400', async () => {
  const res = await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{ not json' })
  expect(res.status).toBe(400)
  const body = await res.json()
  expect(body.error).toBeTruthy()
})

test('missing host defaults gracefully (still accepts)', async () => {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ logs: [{ msg: 'no host provided' }] }),
  })
  expect(res.status).toBe(200)
  expect((await res.json()).accepted).toBe(1)
})
