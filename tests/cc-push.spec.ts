// CC live-push path: CC opens a WS to the hub and sends
// {type:'broadcast_package', data}. The hub forwards it to the renderer
// (cc:package-pushed); BroadcastPackagePanel auto-applies via ccApplyPackage.
// This exercises the REAL push chain (cc-integration.spec tested ccApplyPackage
// directly via IPC; this drives it through the WS push CC actually uses).

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
  await win.waitForTimeout(1800) // let BroadcastPackagePanel mount + register its listener
  const settings = await win.evaluate(async () => window.api.settingsGet())
  wsPort = settings.server?.wsPort || 19081
  await win.evaluate(async () => window.api.triggerClearAll())
})

test.afterAll(async () => { await app?.close() })

test('a broadcast_package pushed over WS is auto-applied to the overlay', async () => {
  const pkg = {
    eventId: 'push-evt-1',
    version: '2.0',
    generatedAt: '2026-05-29T00:00:00Z',
    event: { eventName: 'Pushed Event', eventType: 'recital', venueName: 'Hall', eventDate: '2026-06-01T18:00:00Z' },
    client: { organization: 'Acme', brandColor: '#0099ff', logoUrl: null },
    company: { name: 'StreamStage', logoUrl: null, primaryColor: null, secondaryColor: null },
    triggers: [
      { type: 'lower_third', name: 'Pushed Speaker', subtitle: 'Keynote', shiftName: 'AM' },
      { type: 'title_card', name: 'Welcome' },
    ],
    checklist: [],
    overlayConfig: null,
    streaming: { streamKey: null, rtmpUrl: null, livestreamUrl: null, embedCode: null },
  }

  // Push it over a raw WS client (no network — null logos avoid any fetch).
  const { WebSocket } = await import('ws')
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`)
    const to = setTimeout(() => { ws.terminate(); reject(new Error('ws timeout')) }, 4000)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'broadcast_package', data: pkg }))
      setTimeout(() => { clearTimeout(to); ws.close(); resolve() }, 600)
    })
    ws.on('error', (e) => { clearTimeout(to); reject(e as Error) })
  })

  // Renderer forwards → ccApplyPackage → overlay triggers. Allow the async apply.
  await win.waitForTimeout(1500)
  const list = await win.evaluate(() => window.api.triggerList())
  expect(list.triggers.length).toBe(2)
  expect(list.triggers[0].title).toBe('Pushed Speaker')
  expect(list.triggers[0].category).toBe('AM') // shiftName → category
  expect(list.triggers[1].name).toBe('Welcome')

  // Brand color applied as accent.
  const st = await win.evaluate(() => window.api.overlayGetState())
  expect(st.lowerThird.styling.accentColor).toBe('#0099ff')

  await win.evaluate(() => window.api.triggerClearAll())
})
