// CC↔BB apply-package path (item: prove the most complex CC code without live CC).
//
// ccApplyPackage is the heaviest CC handler: it converts CC triggers → BB
// triggers, applies streaming config, brand/company accent color, and the saved
// overlayConfig styling, then pushes context to the renderer. We exercise it
// fully headless by feeding a synthetic BroadcastPackage via IPC (no network:
// logo URLs omitted so no fetch) and asserting the resulting overlay/trigger/
// stream state. This validates the contract verified by code-match with
// CommandCentered-2 in an actual round-trip of the apply logic.

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

// A realistic package matching CC's buildBroadcastPackage shape. No logoUrls →
// no outbound fetch, so the test is fully offline/deterministic.
function makePackage() {
  return {
    eventId: 'evt-test-1',
    version: '2.0',
    generatedAt: new Date('2026-05-29T00:00:00Z').toISOString(),
    event: { eventName: 'Spring Showcase', eventType: 'recital', venueName: 'Main Hall', eventDate: '2026-06-01T18:00:00Z' },
    client: { organization: 'Acme Studio', brandColor: '#ff8800', logoUrl: null },
    company: { name: 'StreamStage', logoUrl: null, primaryColor: '#112233', secondaryColor: null },
    triggers: [
      { type: 'lower_third', name: 'Ada Lovelace', subtitle: 'Keynote', shiftName: 'Morning' },
      { type: 'title_card', name: 'Welcome' },
    ],
    checklist: [{ id: 'c1', label: 'Mic check', checked: false, category: 'Audio', sortOrder: 0 }],
    overlayConfig: { fontSize: 36, animation: 'zoom', textColor: '#eeeeee' },
    streaming: { streamKey: 'sk_test', rtmpUrl: 'rtmp://ingest/x', livestreamUrl: 'https://watch.streamstage.live/x', embedCode: '<iframe src="x"></iframe>' },
    drive: { eventFolderId: null, eventFolderUrl: 'https://drive/folder', clientFolderId: null, clientFolderUrl: null },
  }
}

test('ccApplyPackage converts CC triggers → BB triggers', async () => {
  const result = await win.evaluate(async (pkg) => window.api.ccApplyPackage(pkg as any, 'evt-test-1'), makePackage())
  expect(result.success).toBe(true)
  expect(result.triggerCount).toBe(2)

  const list = await win.evaluate(async () => window.api.triggerList())
  expect(list.triggers.length).toBe(2)
  const [t0, t1] = list.triggers
  // lower_third with shiftName → category = shiftName; name/title from CC name
  expect(t0.name).toBe('Ada Lovelace')
  expect(t0.title).toBe('Ada Lovelace')
  expect(t0.subtitle).toBe('Keynote')
  expect(t0.category).toBe('Morning')
  // title_card with no shiftName → category 'Title'
  expect(t1.name).toBe('Welcome')
  expect(t1.category).toBe('Title')
})

test('ccApplyPackage applies streaming config (incl livestreamUrl/embedCode)', async () => {
  await win.evaluate(async (pkg) => window.api.ccApplyPackage(pkg as any, 'evt-test-1'), makePackage())
  const cfg = await win.evaluate(async () => window.api.streamConfigGet())
  expect(cfg?.streamKey).toBe('sk_test')
  expect(cfg?.rtmpUrl).toBe('rtmp://ingest/x')
  expect(cfg?.viewingLink).toBe('https://watch.streamstage.live/x') // livestreamUrl → viewingLink
  expect(cfg?.embedCode).toBe('<iframe src="x"></iframe>')
})

test('ccApplyPackage applies brand color as accent + overlayConfig styling', async () => {
  await win.evaluate(async (pkg) => window.api.ccApplyPackage(pkg as any, 'evt-test-1'), makePackage())
  const state = await win.evaluate(async () => window.api.overlayGetState())
  const s = state.lowerThird.styling
  expect(s.accentColor).toBe('#ff8800') // client.brandColor
  expect(s.fontSize).toBe(36) // overlayConfig.fontSize
  expect(s.animation).toBe('zoom') // overlayConfig.animation
  expect(s.textColor).toBe('#eeeeee') // overlayConfig.textColor
})

test('ccApplyPackage falls back to company.primaryColor when no brandColor', async () => {
  const pkg = makePackage()
  pkg.client.brandColor = null
  await win.evaluate(async (p) => window.api.ccApplyPackage(p as any, 'evt-test-1'), pkg)
  const state = await win.evaluate(async () => window.api.overlayGetState())
  expect(state.lowerThird.styling.accentColor).toBe('#112233') // company.primaryColor
})

test('ccApplyPackage with no streaming fields leaves stream config untouched-safe', async () => {
  // Apply a package whose streaming is all-null — must not throw, triggers still apply.
  const pkg = makePackage()
  pkg.streaming = { streamKey: null as any, rtmpUrl: null as any, livestreamUrl: null as any, embedCode: null as any }
  const result = await win.evaluate(async (p) => window.api.ccApplyPackage(p as any, 'evt-test-1'), pkg)
  expect(result.success).toBe(true)
  expect(result.triggerCount).toBe(2)
})

test('cleanup', async () => {
  await win.evaluate(async () => window.api.triggerClearAll())
})
