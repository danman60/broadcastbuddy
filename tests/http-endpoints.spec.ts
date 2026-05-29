// Express HTTP endpoints (:19080) reflect LIVE state — used by external tools /
// debugging. Also a regression guard: the served /overlay HTML must carry the
// injected wsPort (19081), NOT the old hardcoded 9877 (the overlay-can't-connect
// bug fixed this session).

import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'

let app: ElectronApplication
let win: Page
let httpPort = 19080
let wsPort = 19081

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(__dirname, '..'), '--disable-gpu', '--no-sandbox'],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  const s = await win.evaluate(async () => window.api.settingsGet())
  httpPort = s.server?.httpPort || 19080
  wsPort = s.server?.wsPort || 19081
  await win.evaluate(async () => {
    await window.api.triggerClearAll()
    await window.api.triggerAdd({ id: 'h-1', name: 'H', title: 'Endpoint Title', subtitle: 's', category: '', order: 0, logoDataUrl: '' })
    await window.api.triggerSelect(0)
  })
})

test.afterAll(async () => {
  await win.evaluate(() => window.api.triggerClearAll())
  await app?.close()
})

test('/overlay HTML injects the real wsPort (regression guard for the 9877 bug)', async () => {
  const res = await fetch(`http://127.0.0.1:${httpPort}/overlay`)
  expect(res.status).toBe(200)
  const html = await res.text()
  expect(html).toContain('<html')
  // WS_URL is built as 'ws://' + location.hostname + ':' + <wsPort>, so the port
  // appears as a bare number after the concat — assert it's the injected one,
  // host-derived, and the stale hardcoded 9877 is gone.
  expect(html).toContain('location.hostname')
  expect(html).toContain(String(wsPort)) // injected configured WS port (19081)
  expect(html).not.toContain('9877') // the stale hardcoded port must be gone
})

test('/current reflects a live lower-third state change', async () => {
  await win.evaluate(() => window.api.overlayFireLT())
  await win.waitForTimeout(200)
  let cur = await (await fetch(`http://127.0.0.1:${httpPort}/current`)).json()
  expect(cur.lowerThird.visible).toBe(true)
  expect(cur.lowerThird.title).toBe('Endpoint Title')

  await win.evaluate(() => window.api.overlayHideLT())
  await win.waitForTimeout(200)
  cur = await (await fetch(`http://127.0.0.1:${httpPort}/current`)).json()
  expect(cur.lowerThird.visible).toBe(false)
})

test('/triggers reflects the live trigger list', async () => {
  const res = await fetch(`http://127.0.0.1:${httpPort}/triggers`)
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(Array.isArray(body.triggers)).toBe(true)
  expect(body.triggers.some((t: { title: string }) => t.title === 'Endpoint Title')).toBe(true)
  expect(body).toHaveProperty('selectedIndex')
})
