// OBS auto-reconnect regression (shipped this session).
//
// Fix under test — src/main/services/obsConnection.ts:
//   After a SUCCESSFUL (Identified) connection drops, BB auto-reconnects every
//   RECONNECT_DELAY_MS (3s). Scoping:
//     - lastConnect is set ONLY on Identified, so an OBS that was never up at
//       boot does not spawn an endless retry loop (negative-scope guard).
//     - disconnect() latches intentionalDisconnect + clears lastConnect, so a
//       deliberate disconnect suppresses reconnect.
//
// Strategy: stand up a MINIMAL obs-websocket v5 mock server in-process (a `ws`
// WebSocketServer on a free port) that does just enough handshake to reach
// Identified — on client connect send op:0 Hello with NO auth challenge, await
// the client's op:1 Identify, then send op:2 Identified. (op:6 requests such as
// the post-identify GetSceneTransitionList are ignored; BB tolerates the
// request timeout.) BB connects via the obsConnect IPC.
//
// Cases:
//   1. connected handshake → obsStatus connected.
//   2. drop the mock's client socket → BB auto-reconnects within ~5s (a NEW
//      client connection arrives at the mock AND obsStatus is connected again).
//   3. deliberate obsDisconnect → NO further reconnect arrives within ~5s.
//   4. negative scope: connecting to a port with NO server never reaches
//      Identified → no runaway loop, obsStatus stays disconnected, test is fast.

import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'
import { WebSocketServer, WebSocket, AddressInfo } from 'ws'

let app: ElectronApplication
let window: Page

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(__dirname, '..'), '--disable-gpu', '--no-sandbox'],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForTimeout(1500)
})

test.afterAll(async () => {
  if (app) await app.close()
})

// ── Minimal obs-ws v5 mock ────────────────────────────────────────────────
interface MockObs {
  port: number
  connectionCount: () => number
  closeCurrentClient: () => void
  stop: () => Promise<void>
}

function startMockObs(): Promise<MockObs> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    let connections = 0
    let currentClient: WebSocket | null = null

    wss.on('connection', (socket: WebSocket) => {
      connections++
      currentClient = socket

      // op:0 Hello — rpcVersion present, NO authentication field (no challenge),
      // so the client identifies without a password.
      socket.send(JSON.stringify({
        op: 0,
        d: { obsWebSocketVersion: '5.0.0', rpcVersion: 1 },
      }))

      socket.on('message', (raw: Buffer) => {
        let msg: { op?: number }
        try { msg = JSON.parse(raw.toString()) } catch { return }
        if (msg.op === 1) {
          // op:1 Identify received → reply op:2 Identified.
          socket.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }))
        }
        // op:6 requests (e.g. GetSceneTransitionList) are ignored on purpose.
      })

      socket.on('close', () => {
        if (currentClient === socket) currentClient = null
      })
    })

    wss.on('listening', () => {
      const port = (wss.address() as AddressInfo).port
      resolve({
        port,
        connectionCount: () => connections,
        closeCurrentClient: () => { currentClient?.terminate() },
        stop: () => new Promise<void>((res) => {
          for (const c of wss.clients) c.terminate()
          wss.close(() => res())
        }),
      })
    })
  })
}

async function obsConnected(): Promise<boolean> {
  const s = await window.evaluate(() => window.api.obsStatus())
  return s.connected
}

async function waitFor(pred: () => Promise<boolean>, timeoutMs: number, pollMs = 150): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await pred()) return true
    await window.waitForTimeout(pollMs)
  }
  return false
}

test('full lifecycle: connect → drop → auto-reconnect → deliberate disconnect suppresses reconnect', async () => {
  const mock = await startMockObs()
  try {
    // 1. Connect + Identify.
    const res = await window.evaluate((port) => window.api.obsConnect('127.0.0.1', port), mock.port)
    expect(res.connected).toBe(true)
    expect(await obsConnected()).toBe(true)
    expect(mock.connectionCount()).toBe(1)

    // 2. Simulate an OBS drop — terminate the server-side client socket. BB's
    //    close handler fires (lastConnect armed from Identify) → schedules a
    //    reconnect 3s later. Mock keeps listening, so the retry connects + re-IDs.
    mock.closeCurrentClient()
    expect(await waitFor(async () => !(await obsConnected()), 3000)).toBe(true)

    // Within ~5s a second connection arrives and BB is Identified again.
    const reconnected = await waitFor(
      async () => mock.connectionCount() >= 2 && (await obsConnected()),
      6000,
    )
    expect(reconnected).toBe(true)
    expect(mock.connectionCount()).toBeGreaterThanOrEqual(2)
    expect(await obsConnected()).toBe(true)

    // 3. Deliberate disconnect → suppress reconnect. Record the connection count
    //    at disconnect time; no NEW connection should arrive afterwards.
    const countAtDisconnect = mock.connectionCount()
    await window.evaluate(() => window.api.obsDisconnect())
    expect(await obsConnected()).toBe(false)

    // Wait well past two reconnect windows (3s each) — count must not grow.
    await window.waitForTimeout(5000)
    expect(mock.connectionCount()).toBe(countAtDisconnect)
    expect(await obsConnected()).toBe(false)
  } finally {
    await mock.stop()
  }
})

test('negative scope: connecting to a dead port never Identifies and spawns no reconnect loop', async () => {
  // 127.0.0.1:65002 has no listener → ECONNREFUSED, never Identified, so
  // lastConnect is never armed → the close handler must NOT schedule a retry.
  const start = Date.now()
  const res = await window.evaluate(() => window.api.obsConnect('127.0.0.1', 65002))
  expect(res.connected).toBe(false)
  expect(typeof res.error).toBe('string')
  // Must resolve fast (immediate refusal, not a hung 10s timeout / retry spam).
  expect(Date.now() - start).toBeLessThan(8000)

  // Stays disconnected over a window that would have spanned multiple 3s retries.
  await window.waitForTimeout(5000)
  expect(await obsConnected()).toBe(false)

  // Leave OBS state clean for any later specs.
  await window.evaluate(() => window.api.obsDisconnect())
})
