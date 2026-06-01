// Phase C — CC→BB Supabase Realtime relay (live package push).
//
// CC (on Vercel) can't WS-push to the operator's local BB, so it publishes on a
// Supabase Realtime *broadcast* channel `bb:<tenantId>:<eventId>` and BB
// subscribes via the anon key. The relay is DORMANT until a package's `realtime`
// block arms it. These tests prove the pure logic with NO live network:
//   - default state is disabled/disconnected (unconfigured),
//   - applying a package WITHOUT a realtime block leaves the relay dormant,
//   - applying a package WITH a realtime block arms it (channel computed) and
//     the package still applies identically to a plain CC_APPLY_PACKAGE,
//   - getState shape is correct and nothing throws.
//
// We never assert `connected: true` — that needs a real Supabase project. We do
// assert the relay arms (enabled + channel) and back-compat dormancy. Ports
// 19080/19081; workers=1.

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
  await win.evaluate(async () => window.api.triggerClearAll())
})

test.afterAll(async () => {
  await app?.close()
})

// Base package matching CC's buildBroadcastPackage shape (no logoUrls → offline).
function makePackage() {
  return {
    eventId: 'evt-relay-1',
    version: '2.0',
    generatedAt: new Date('2026-05-29T00:00:00Z').toISOString(),
    event: { eventName: 'Relay Showcase', eventType: 'recital', venueName: 'Main Hall', eventDate: '2026-06-01T18:00:00Z' },
    client: { organization: 'Acme Studio', brandColor: '#ff8800', logoUrl: null },
    company: { name: 'StreamStage', logoUrl: null, primaryColor: '#112233', secondaryColor: null },
    triggers: [
      { type: 'lower_third', name: 'Ada Lovelace', subtitle: 'Keynote', shiftName: 'Morning' },
      { type: 'title_card', name: 'Welcome' },
    ],
    checklist: [{ id: 'c1', label: 'Mic check', checked: false, category: 'Audio', sortOrder: 0 }],
    overlayConfig: { fontSize: 36, animation: 'zoom', textColor: '#eeeeee' },
    streaming: { streamKey: null, rtmpUrl: null, livestreamUrl: null, embedCode: null },
    drive: { eventFolderId: null, eventFolderUrl: null, clientFolderId: null, clientFolderUrl: null },
  }
}

test('ccRelay get-state reports disabled/disconnected by default', async () => {
  const s = await win.evaluate(() => window.api.ccRelayGetState())
  expect(s).toHaveProperty('enabled')
  expect(s).toHaveProperty('connected')
  expect(s).toHaveProperty('channel')
  expect(s.enabled).toBe(false)
  expect(s.connected).toBe(false)
})

test('applying a package WITHOUT a realtime block leaves the relay dormant', async () => {
  // Ensure no tenantId is set so even a stray realtime block wouldn't arm.
  await win.evaluate(() => window.api.settingsSet('ccConfig', { baseUrl: '', apiKey: '', tenantId: '' }))
  const pkg = makePackage()
  const result = await win.evaluate(async (p) => window.api.ccApplyPackage(p as any, 'evt-relay-1'), pkg)
  expect(result.success).toBe(true)
  expect(result.triggerCount).toBe(2)

  const s = await win.evaluate(() => window.api.ccRelayGetState())
  expect(s.enabled).toBe(false)
  expect(s.connected).toBe(false)
})

test('applying a realtime package with no tenantId stays dormant (needs tenant)', async () => {
  // Clear tenant so the relay can't arm even with a realtime block present.
  await win.evaluate(() => window.api.settingsSet('ccConfig', { baseUrl: '', apiKey: '', tenantId: '' }))
  const pkg: any = makePackage()
  pkg.eventId = 'evt-relay-2'
  pkg.realtime = { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon-test-key' }
  const result = await win.evaluate(async (p) => window.api.ccApplyPackage(p, 'evt-relay-2'), pkg)
  expect(result.success).toBe(true)

  const s = await win.evaluate(() => window.api.ccRelayGetState())
  expect(s.enabled).toBe(false)
})

// Run the arming test LAST — it leaves the relay armed (it never connects in
// the test env, but enabled/channel stay set until disconnect). Cleanup resets.
test('applying a package WITH a realtime block arms the relay (channel computed)', async () => {
  // tenantId comes from saved CC connection settings; eventId from the package.
  await win.evaluate(() => window.api.settingsSet('ccConfig', { baseUrl: 'https://cc.example', apiKey: 'k', tenantId: 'tenant-9' }))
  const pkg: any = makePackage()
  pkg.realtime = {
    channel: 'bb:tenant-9:evt-relay-1',
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon-test-key',
  }

  // Must not throw; triggers apply identically to a plain CC_APPLY_PACKAGE.
  const result = await win.evaluate(async (p) => window.api.ccApplyPackage(p, 'evt-relay-1'), pkg)
  expect(result.success).toBe(true)
  expect(result.triggerCount).toBe(2)

  // Relay armed: enabled + channel = bb:<tenant>:<event>. We do NOT assert
  // connected — that requires a live Supabase project.
  const s = await win.evaluate(() => window.api.ccRelayGetState())
  expect(s.enabled).toBe(true)
  expect(s.channel).toBe('bb:tenant-9:evt-relay-1')

  // Same apply effects as the non-relay path (proves "identical" handling).
  const list = await win.evaluate(async () => window.api.triggerList())
  expect(list.triggers.length).toBe(2)
  expect(list.triggers[0].name).toBe('Ada Lovelace')
  const state = await win.evaluate(async () => window.api.overlayGetState())
  expect(state.lowerThird.styling.accentColor).toBe('#ff8800')
  expect(state.lowerThird.styling.fontSize).toBe(36)
})

test('cleanup', async () => {
  await win.evaluate(() => window.api.settingsSet('ccConfig', { baseUrl: '', apiKey: '', tenantId: '' }))
  await win.evaluate(async () => window.api.triggerClearAll())
})
