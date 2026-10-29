// Dock → REAL OBSBOT (2026-10-29). Opt-in: OBSBOT_REAL_HOST=<camera ip>. Moves the
// camera (recalls its saved presets) — only point it at a camera nobody is shooting with.
// BB reaches the camera through a local relay so the test can cut it = "camera died".
// The camera has no live-pose GET, so each preset's saved zoom ratio is the proof of motion.

import { test, expect, _electron as electron, chromium, ElectronApplication, Page } from '@playwright/test'
import path from 'path'
import http from 'http'
import { AddressInfo } from 'net'
import { WebSocket } from 'ws'

const CAM = process.env.OBSBOT_REAL_HOST || ''
test.skip(!CAM, 'set OBSBOT_REAL_HOST to a camera that is not on air')

let app: ElectronApplication
let win: Page
let relay: http.Server
let relayPort = 0
let hub: WebSocket
let lastState: any = null
const presets = new Map<number, number>() // preset id → saved zoom ratio

const api = (fn: string, ...args: unknown[]) =>
  win.evaluate(([f, a]) => (window as any).api[f as string](...(a as unknown[])), [fn, args] as const)
const cam = async (p: string) => (await fetch(`http://${CAM}/camera/sdk/${p}`)).json()

async function waitHealth(pred: (h: any) => boolean, ms = 20000): Promise<any> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (lastState?.health && pred(lastState.health)) return lastState.health
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('health never matched; last=' + JSON.stringify(lastState?.health))
}

function startRelay(): Promise<void> {
  return new Promise((resolve) => {
    relay = http.createServer((req, res) => {
      const up = http.request({ host: CAM, port: 80, path: req.url, method: req.method, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode || 502, r.headers)
        r.pipe(res)
      })
      up.on('error', () => { res.statusCode = 502; res.end() })
      req.pipe(up)
    })
    relay.listen(0, '127.0.0.1', () => { relayPort = (relay.address() as AddressInfo).port; resolve() })
  })
}

test.beforeAll(async () => {
  const list = (await cam('ptz/preset')).presetList as { id: number; ratio: number }[]
  for (const p of list) presets.set(p.id, p.ratio)
  console.log(`REAL CAMERA ${CAM} presets`, [...presets].map(([i, r]) => `${i}:${r}x`).join(' '))
  await startRelay()
  app = await electron.launch({
    args: [path.join(__dirname, '..'), '--disable-gpu', '--no-sandbox'],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  await api('settingsSet', 'cameraHost', '127.0.0.1')
  await api('settingsSet', 'cameraPort', relayPort)
  hub = new WebSocket('ws://127.0.0.1:19081')
  await new Promise((r) => hub.on('open', r))
  hub.send(JSON.stringify({ type: 'identify', client: 'test' }))
  hub.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.type === 'state') lastState = m })
})

test.afterAll(async () => {
  try { await api('settingsSet', 'cameraHost', '') } catch { /* closing */ }
  try { await api('settingsSet', 'cameraPort', 80) } catch { /* closing */ }
  hub?.close()
  await app?.close()
  relay?.close()
})

test('camera healthy → CAM1 chip green, no camera alert', async () => {
  const h = await waitHealth((x) => x.cams[1] === true)
  expect(h.alerts.map((a: any) => a.id)).not.toContain('cam1-down')
})

test('dock preset buttons move the real camera (zoom lands on each preset ratio)', async () => {
  // pick up to 3 dock-reachable presets (1-8) with distinct zoom so each move is visible
  const order: number[] = []
  for (const [id, r] of presets) if (id >= 1 && id <= 8 && !order.some((o) => presets.get(o) === r)) order.push(id)
  expect(order.length).toBeGreaterThanOrEqual(2)
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 320, height: 700 } })
  await page.goto('http://127.0.0.1:19080/dock')
  await expect(page.locator('.chip', { hasText: 'CAM1' })).toHaveClass(/ok/)
  for (const id of order.slice(0, 3)) {
    const want = presets.get(id)!
    const t0 = Date.now()
    await page.locator('#presets button', { hasText: String(id) }).click()
    await expect.poll(async () => (await cam('ptz/zoom')).ratio, { timeout: 25000 }).toBeCloseTo(want, 0) // zoom travels ~0.75x/s on Tail 2: 1x→9.4x ≈ 12 s
    console.log(`dock preset ${id} → zoom ${want}x in ${Date.now() - t0} ms`)
  }
  await browser.close()
})

test('camera stops answering → dock shows CAMERA 1 NOT RESPONDING; back → clears', async () => {
  relay.close()
  relay.closeAllConnections()
  const t0 = Date.now()
  await waitHealth((x) => x.alerts.some((a: any) => a.id === 'cam1-down'))
  console.log(`cam1-down after ${Math.round((Date.now() - t0) / 1000)} s`)
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 320, height: 700 } })
  await page.goto('http://127.0.0.1:19080/dock')
  await expect(page.locator('#alertList')).toContainText('CAMERA 1')
  await page.screenshot({ path: 'tests/screenshots/dock-real-cam-down.png' })
  await new Promise<void>((r) => relay.listen(relayPort, '127.0.0.1', () => r()))
  await waitHealth((x) => x.cams[1] === true && !x.alerts.some((a: any) => a.id === 'cam1-down'))
  await browser.close()
})
