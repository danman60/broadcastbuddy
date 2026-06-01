// Phase B — Trigger type end-to-end.
//
// A trigger carries a `type` ('lower_third' | 'title_card' | 'feature'). The
// type only changes the VISUAL form rendered when fired — playlist position
// logic is unchanged:
//   - lower_third (or undefined) → lower-third overlay (baseline)
//   - title_card / feature       → full-screen FEATURE CARD with the trigger's
//                                  title/subtitle
//
// These assert the main-process fire routing (overlay.fireLowerThird) branches
// on the selected trigger's type, that CC_APPLY_PACKAGE carries `type` onto BB
// triggers, and that next/prev position advance is type-agnostic.

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

test.beforeEach(async () => {
  // Reset overlay between tests so feature/lower-third visibility doesn't leak.
  await win.evaluate(async () => {
    await window.api.triggerClearAll()
    await window.api.overlayHideLT()
    await window.api.overlayFeatureHide()
  })
})

// ── lower_third (baseline) renders the lower third ────────────────────────────

test('firing a lower_third trigger shows the lower third, not the feature card', async () => {
  await win.evaluate(async () => {
    await window.api.triggerAdd({ id: 'lt-1', name: 'Ada', title: 'Keynote', subtitle: 'Opening', category: '', order: 0, logoDataUrl: '', type: 'lower_third' })
    await window.api.triggerSelect(0)
    await window.api.overlayFireLT()
  })
  const st = await win.evaluate(() => window.api.overlayGetState())
  expect(st.lowerThird.visible).toBe(true)
  expect(st.lowerThird.title).toBe('Keynote')
  expect(st.featureCard.visible).toBe(false)
})

test('firing a trigger with no type defaults to the lower third', async () => {
  await win.evaluate(async () => {
    await window.api.triggerAdd({ id: 'lt-untyped', name: 'Grace', title: 'Untyped', subtitle: '', category: '', order: 0, logoDataUrl: '' })
    await window.api.triggerSelect(0)
    await window.api.overlayFireLT()
  })
  const st = await win.evaluate(() => window.api.overlayGetState())
  expect(st.lowerThird.visible).toBe(true)
  expect(st.featureCard.visible).toBe(false)
})

// ── title_card / feature render the full-screen feature card ──────────────────

test('firing a title_card trigger shows the FEATURE CARD, not the lower third', async () => {
  await win.evaluate(async () => {
    await window.api.triggerAdd({ id: 'tc-1', name: 'Welcome', title: 'Spring Showcase', subtitle: 'Acme Studio', category: 'INTRO', order: 0, logoDataUrl: '', type: 'title_card' })
    await window.api.triggerSelect(0)
    await window.api.overlayFireLT()
  })
  const st = await win.evaluate(() => window.api.overlayGetState())
  expect(st.featureCard.visible).toBe(true)
  expect(st.featureCard.title).toBe('Spring Showcase')
  expect(st.featureCard.subtitle).toBe('Acme Studio')
  expect(st.featureCard.kicker).toBe('INTRO') // category → kicker
  // The lower third must NOT be shown for a title_card.
  expect(st.lowerThird.visible).toBe(false)
})

test('firing a feature trigger shows the FEATURE CARD', async () => {
  await win.evaluate(async () => {
    await window.api.triggerAdd({ id: 'ft-1', name: 'Star', title: 'Featured Performer', subtitle: 'Solo', category: '', order: 0, logoDataUrl: '', type: 'feature' })
    await window.api.triggerSelect(0)
    await window.api.overlayFireLT()
  })
  const st = await win.evaluate(() => window.api.overlayGetState())
  expect(st.featureCard.visible).toBe(true)
  expect(st.featureCard.title).toBe('Featured Performer')
  expect(st.lowerThird.visible).toBe(false)
})

test('feature trigger falls back to name when title is empty', async () => {
  await win.evaluate(async () => {
    await window.api.triggerAdd({ id: 'ft-noname', name: 'OnlyName', title: '', subtitle: '', category: '', order: 0, logoDataUrl: '', type: 'feature' })
    await window.api.triggerSelect(0)
    await window.api.overlayFireLT()
  })
  const st = await win.evaluate(() => window.api.overlayGetState())
  expect(st.featureCard.visible).toBe(true)
  expect(st.featureCard.title).toBe('OnlyName')
})

// ── CC_APPLY_PACKAGE carries type onto BB triggers ────────────────────────────

function makePackage() {
  return {
    eventId: 'evt-type-1',
    version: '2.0',
    generatedAt: new Date('2026-06-01T00:00:00Z').toISOString(),
    event: { eventName: 'Type Test', eventType: 'recital', venueName: 'Hall', eventDate: '2026-06-01T18:00:00Z' },
    client: { organization: 'Acme', brandColor: null, logoUrl: null },
    company: { name: 'StreamStage', logoUrl: null, primaryColor: null, secondaryColor: null },
    triggers: [
      { type: 'lower_third', name: 'Ada', title: 'Keynote' },
      { type: 'title_card', name: 'Welcome', title: 'Spring Showcase' },
      { type: 'feature', name: 'Star', title: 'Featured' },
      { name: 'Legacy', title: 'NoType' }, // no type → defaults lower_third
    ],
    checklist: [],
    overlayConfig: null,
    streaming: { streamKey: null, rtmpUrl: null, livestreamUrl: null, embedCode: null },
  }
}

test('ccApplyPackage carries trigger type from package triggers onto BB triggers', async () => {
  const result = await win.evaluate(async (pkg) => window.api.ccApplyPackage(pkg as any, 'evt-type-1'), makePackage())
  expect(result.success).toBe(true)
  expect(result.triggerCount).toBe(4)

  const list = await win.evaluate(async () => window.api.triggerList())
  const [t0, t1, t2, t3] = list.triggers
  expect(t0.type).toBe('lower_third')
  expect(t1.type).toBe('title_card')
  expect(t2.type).toBe('feature')
  expect(t3.type).toBe('lower_third') // absent type defaults to lower_third
})

test('a CC-applied title_card trigger fires as a feature card', async () => {
  await win.evaluate(async (pkg) => window.api.ccApplyPackage(pkg as any, 'evt-type-1'), makePackage())
  await win.evaluate(async () => {
    await window.api.triggerSelect(1) // the title_card
    await window.api.overlayFireLT()
  })
  const st = await win.evaluate(() => window.api.overlayGetState())
  expect(st.featureCard.visible).toBe(true)
  expect(st.featureCard.title).toBe('Spring Showcase')
  expect(st.lowerThird.visible).toBe(false)
})

// ── Playlist position logic is type-agnostic ──────────────────────────────────

test('next/prev advance position regardless of trigger type', async () => {
  await win.evaluate(async () => {
    await window.api.triggerClearAll()
    await window.api.triggerAdd({ id: 'p-0', name: 'A', title: 'A', subtitle: '', category: '', order: 0, logoDataUrl: '', type: 'lower_third' })
    await window.api.triggerAdd({ id: 'p-1', name: 'B', title: 'B', subtitle: '', category: '', order: 1, logoDataUrl: '', type: 'title_card' })
    await window.api.triggerAdd({ id: 'p-2', name: 'C', title: 'C', subtitle: '', category: '', order: 2, logoDataUrl: '', type: 'feature' })
    await window.api.triggerSelect(0)
  })
  let status = await win.evaluate(() => window.api.playlistGetStatus())
  expect(status.current).toBe(1) // 1-based
  expect(status.total).toBe(3)

  await win.evaluate(() => window.api.triggerNext())
  status = await win.evaluate(() => window.api.playlistGetStatus())
  expect(status.current).toBe(2) // advanced past the title_card position

  await win.evaluate(() => window.api.triggerNext())
  status = await win.evaluate(() => window.api.playlistGetStatus())
  expect(status.current).toBe(3) // advanced onto the feature position

  await win.evaluate(() => window.api.triggerPrev())
  status = await win.evaluate(() => window.api.playlistGetStatus())
  expect(status.current).toBe(2) // prev backs up normally
})
