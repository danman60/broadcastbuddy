// Backbone robustness under load + races — the failure modes that only show up
// live: many WS clients during rapid state changes, the auto-hide timer reset
// on rapid re-fire, and trigger-list consistency at scale.

import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'

let app: ElectronApplication
let win: Page
let wsPort = 19081

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(__dirname, '..'), '--disable-gpu', '--no-sandbox'],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  const settings = await win.evaluate(async () => window.api.settingsGet())
  wsPort = settings.server?.wsPort || 19081
  await win.evaluate(async () => {
    await window.api.triggerClearAll()
    await window.api.triggerAdd({ id: 'r1', name: 'R', title: 'R', subtitle: '', category: '', order: 0, logoDataUrl: '' })
    await window.api.triggerSelect(0)
  })
})

test.afterAll(async () => { await app?.close() })

test('hub stays healthy with many clients during rapid state changes', async () => {
  const { WebSocket } = await import('ws')
  const N = 8
  const clients: Array<{ ws: any; received: number; errored: boolean; closed: boolean }> = []

  await Promise.all(
    Array.from({ length: N }, () => new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`)
      const rec = { ws, received: 0, errored: false, closed: false }
      clients.push(rec)
      const to = setTimeout(() => reject(new Error('connect timeout')), 4000)
      ws.on('open', () => { clearTimeout(to); ws.send(JSON.stringify({ type: 'identify', client: 'external' })); resolve() })
      ws.on('message', () => { rec.received++ })
      ws.on('error', () => { rec.errored = true })
      ws.on('close', () => { rec.closed = true })
    })),
  )

  // Fire 15 rapid state changes from the control surface.
  await win.evaluate(async () => {
    for (let i = 0; i < 15; i++) {
      if (i % 2 === 0) await window.api.overlayGridToggle()
      else await window.api.overlayCounterBump(1)
    }
  })
  await win.waitForTimeout(800)

  // Every client must still be open, error-free, and have received broadcasts.
  for (const c of clients) {
    expect(c.errored).toBe(false)
    expect(c.closed).toBe(false)
    expect(c.received).toBeGreaterThan(0)
  }
  clients.forEach((c) => c.ws.close())

  // Hub still responsive afterward.
  const st = await win.evaluate(() => window.api.overlayGetState())
  expect(st).toBeTruthy()
})

test('hub survives malformed / hostile WS input without crashing', async () => {
  const { WebSocket } = await import('ws')
  // Any localhost client can connect — feed the hub garbage and confirm it
  // stays alive (parse is try/caught, unknown commands hit the default case).
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`)
    const to = setTimeout(() => { ws.terminate(); reject(new Error('timeout')) }, 4000)
    ws.on('open', () => {
      ws.send('{ this is not json')                                   // malformed
      ws.send(JSON.stringify({ type: 'command', action: 'nonExistentAction' })) // unknown command
      ws.send(JSON.stringify({ type: 'command' }))                    // missing action
      ws.send(JSON.stringify({ type: 'weird', foo: 1 }))              // unknown message type
      ws.send(JSON.stringify({ type: 'command', action: 'fireLT' }))  // a valid one after the garbage
      setTimeout(() => { clearTimeout(to); ws.close(); resolve() }, 600)
    })
    ws.on('error', (e) => { clearTimeout(to); reject(e as Error) })
  })

  // Hub still alive + the valid command landed.
  const st = await win.evaluate(() => window.api.overlayGetState())
  expect(st).toBeTruthy()
  expect(st.lowerThird.visible).toBe(true) // the trailing valid fireLT worked
  await win.evaluate(() => window.api.overlayHideLT())

  // A fresh client can still connect + get state — hub not wedged.
  const ok = await new Promise<boolean>((resolve) => {
    const ws2 = new WebSocket(`ws://127.0.0.1:${wsPort}`)
    const to = setTimeout(() => { ws2.terminate(); resolve(false) }, 3000)
    ws2.on('open', () => { ws2.send(JSON.stringify({ type: 'identify', client: 'overlay' })) })
    ws2.on('message', () => { clearTimeout(to); ws2.close(); resolve(true) })
    ws2.on('error', () => { clearTimeout(to); resolve(false) })
  })
  expect(ok).toBe(true)
})

test('auto-hide timer RESETS on rapid re-fire (does not hide early)', async () => {
  await win.evaluate(() => window.api.overlayUpdateStyling({ autoHideSeconds: 2 }))
  await win.evaluate(() => window.api.overlayFireLT()) // hides at ~t+2s
  await win.waitForTimeout(1000) // t≈1s
  await win.evaluate(() => window.api.overlayFireLT()) // re-fire → timer reset → hides at ~t+3s
  await win.waitForTimeout(1500) // t≈2.5s — would be hidden if the first timer hadn't been cleared
  let st = await win.evaluate(() => window.api.overlayGetState())
  expect(st.lowerThird.visible).toBe(true) // still up — timer was reset
  await win.waitForTimeout(1200) // t≈3.7s — past the reset window
  st = await win.evaluate(() => window.api.overlayGetState())
  expect(st.lowerThird.visible).toBe(false)
  await win.evaluate(() => window.api.overlayUpdateStyling({ autoHideSeconds: 0 }))
})

test('trigger list stays consistent under churn (add 50 / reorder / delete 25)', async () => {
  await win.evaluate(async () => {
    await window.api.triggerClearAll()
    for (let i = 0; i < 50; i++) {
      await window.api.triggerAdd({ id: `c-${i}`, name: `N${i}`, title: `T${i}`, subtitle: '', category: '', order: i, logoDataUrl: '' })
    }
  })
  let list = await win.evaluate(() => window.api.triggerList())
  expect(list.triggers.length).toBe(50)

  // Reverse order.
  const reversedIds = list.triggers.map((t: { id: string }) => t.id).reverse()
  const reordered = await win.evaluate((ids) => window.api.triggerReorder(ids as string[]), reversedIds)
  expect(reordered[0].id).toBe('c-49')
  expect(reordered[49].id).toBe('c-0')

  // Delete the first 25 (now c-49..c-25).
  await win.evaluate(async (ids) => {
    for (const id of (ids as string[]).slice(0, 25)) await window.api.triggerDelete(id)
  }, reordered.map((t: { id: string }) => t.id))

  list = await win.evaluate(() => window.api.triggerList())
  expect(list.triggers.length).toBe(25)
  // Order values should be unique + contiguous-ish (no duplicate ids).
  const ids = list.triggers.map((t: { id: string }) => t.id)
  expect(new Set(ids).size).toBe(25)

  await win.evaluate(() => window.api.triggerClearAll())
})
