// WebSocket hub backbone + server-side auto-hide timer.
//
// The hub (:wsPort) is the backbone: the OBS browser source, the Stream Deck
// plugin, and any external client connect to it. On identify it must push the
// FULL current state, and every state change must broadcast to ALL connected
// clients. Auto-hide is a SERVER-side timer (per ARCHITECTURE.md) — not in the
// browser source. These are core behaviors exercised here with raw ws clients.

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
    await window.api.triggerAdd({ id: 'h1', name: 'Hub One', title: 'Hub One', subtitle: 'Sub', category: '', order: 0, logoDataUrl: '' })
    await window.api.triggerSelect(0)
  })
})

test.afterAll(async () => { await app?.close() })

// Open a ws client, identify, and resolve with the FIRST 'state' message.
async function connectAndGetInitialState(): Promise<any> {
  const { WebSocket } = await import('ws')
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`)
    const to = setTimeout(() => { ws.terminate(); reject(new Error('no initial state')) }, 4000)
    ws.on('open', () => ws.send(JSON.stringify({ type: 'identify', client: 'overlay' })))
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'state') { clearTimeout(to); ws.close(); resolve(msg) }
    })
    ws.on('error', (e) => { clearTimeout(to); reject(e as Error) })
  })
}

test('hub pushes full state on identify (overlay + playlist)', async () => {
  const msg = await connectAndGetInitialState()
  expect(msg.type).toBe('state')
  expect(msg.overlay).toBeTruthy()
  expect(msg.overlay.lowerThird).toHaveProperty('visible')
  expect(msg.overlay).toHaveProperty('ticker')
  expect(msg.overlay).toHaveProperty('clock')
  // wsHub.buildStateMessage attaches a playlist summary.
  expect(msg.playlist).toBeTruthy()
  expect(msg.playlist.total).toBe(1)
})

test('hub broadcasts a state change to ALL connected clients', async () => {
  const { WebSocket } = await import('ws')
  // Connect two clients, wait for each initial state, then fire LT and assert
  // both receive a state with lowerThird.visible === true.
  function client(): Promise<{ ws: any; next: () => Promise<any> }> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`)
      const queue: any[] = []
      let waiter: ((m: any) => void) | null = null
      const to = setTimeout(() => reject(new Error('connect timeout')), 4000)
      ws.on('open', () => { clearTimeout(to); ws.send(JSON.stringify({ type: 'identify', client: 'external' })); resolve({ ws, next }) })
      ws.on('message', (raw: Buffer) => {
        const m = JSON.parse(raw.toString())
        if (m.type !== 'state') return
        if (waiter) { const w = waiter; waiter = null; w(m) } else queue.push(m)
      })
      ws.on('error', (e: Error) => reject(e))
      function next(): Promise<any> {
        if (queue.length) return Promise.resolve(queue.shift())
        return new Promise((res) => { waiter = res })
      }
    })
  }

  // Ensure starting hidden.
  await win.evaluate(() => window.api.overlayHideLT())
  await win.waitForTimeout(200)

  const a = await client()
  const b = await client()
  await a.next() // drain initial state
  await b.next()

  await win.evaluate(() => window.api.overlayFireLT())

  const ma = await Promise.race([a.next(), new Promise((_, r) => setTimeout(() => r(new Error('a no broadcast')), 3000))]) as any
  const mb = await Promise.race([b.next(), new Promise((_, r) => setTimeout(() => r(new Error('b no broadcast')), 3000))]) as any
  expect(ma.overlay.lowerThird.visible).toBe(true)
  expect(mb.overlay.lowerThird.visible).toBe(true)

  a.ws.close(); b.ws.close()
  await win.evaluate(() => window.api.overlayHideLT())
})

test('server-side auto-hide timer hides the lower third', async () => {
  // Auto-hide runs in the main process (not the browser source). Set a short
  // window, fire, and confirm it hides on its own.
  await win.evaluate(() => window.api.overlayUpdateStyling({ autoHideSeconds: 1 }))
  await win.evaluate(() => window.api.overlayFireLT())
  let st = await win.evaluate(() => window.api.overlayGetState())
  expect(st.lowerThird.visible).toBe(true)
  await win.waitForTimeout(1500) // > autoHideSeconds
  st = await win.evaluate(() => window.api.overlayGetState())
  expect(st.lowerThird.visible).toBe(false)
  // restore manual-hide default
  await win.evaluate(() => window.api.overlayUpdateStyling({ autoHideSeconds: 0 }))
})

test('auto-hide disabled (0) keeps the lower third up', async () => {
  await win.evaluate(() => window.api.overlayUpdateStyling({ autoHideSeconds: 0 }))
  await win.evaluate(() => window.api.overlayFireLT())
  await win.waitForTimeout(1200)
  const st = await win.evaluate(() => window.api.overlayGetState())
  expect(st.lowerThird.visible).toBe(true)
  await win.evaluate(() => window.api.overlayHideLT())
})

test('cleanup', async () => {
  await win.evaluate(() => window.api.triggerClearAll())
})
