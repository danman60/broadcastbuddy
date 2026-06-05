// Full operator show-lifecycle integration test (one app instance + a restart).
//
// Per-feature specs each prove one handler in isolation. This drives a realistic
// operator session THROUGH ONE LIVE app instance — apply a CC package, navigate
// the playlist, fire mixed trigger types, toggle the HUD elements, fire ad-hoc,
// edit styling, let auto-save persist into the *adopted* session, then CLOSE and
// RELAUNCH on the SAME userDataDir to prove the full live state survives a restart
// with zero manual load. The point is the cross-feature invariants the isolated
// specs can't see:
//   - CC apply auto-selects index 0 AND populates the lower-third title from it.
//   - title_card/feature triggers render the feature card, NOT the lower third,
//     without disturbing playlist position.
//   - ad-hoc fire is transient: it must not mutate triggers[] or selectedIndex.
//   - the session auto-save writes to is the SAME one CC_APPLY_PACKAGE adopted
//     (not a stray file), and it carries the operator's later styling edit.
//   - on restart, startup auto-load restores exactly what was live.
//
// Verified against source before asserting:
//   - CC_APPLY_PACKAGE handler (src/main/ipc.ts:651) — auto-select 0, adopt session
//     named `<org> (live)` only when none loaded, applies overlayConfig styling.
//   - overlay.fireLowerThird (src/main/services/overlay.ts:386) — title_card/feature
//     → showFeatureCard, lowerThird.visible=false.
//   - applyOverlayConfigToStyling (src/main/services/overlayConfigApply.ts) — copies
//     animation/accentColor (accentColor only if present in overlayConfig).
//   - startup auto-load (src/main/index.ts:175) — getMostRecentSession() → loadSessionState.

import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'

// Single isolated profile, shared across BOTH launches in this file (close +
// relaunch on the same dir is the persistence proof).
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-lifecycle-'))

const APP_ROOT = path.join(__dirname, '..')

async function launch(): Promise<{ app: ElectronApplication; win: Page }> {
  const app = await electron.launch({
    args: [APP_ROOT, `--user-data-dir=${userDataDir}`, '--disable-gpu', '--no-sandbox'],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  return { app, win }
}

// A realistic CC package: 5 mixed-type triggers + overlayConfig (animation +
// accentColor). No logoUrls → no outbound fetch (offline/deterministic).
function makePackage() {
  return {
    eventId: 'evt-lifecycle-1',
    version: '2.0',
    generatedAt: new Date('2026-06-05T00:00:00Z').toISOString(),
    event: { eventName: 'Summer Gala', eventType: 'recital', venueName: 'Grand Hall', eventDate: '2026-06-06T18:00:00Z' },
    client: { organization: 'Starlight Studio', brandColor: '#22ccaa', logoUrl: null },
    company: { name: 'StreamStage', logoUrl: null, primaryColor: '#112233', secondaryColor: null },
    triggers: [
      { type: 'lower_third', name: 'Grace Hopper', title: 'Grace Hopper', subtitle: 'Solo — Contemporary', shiftName: 'Session A' },
      { type: 'lower_third', name: 'Katherine Johnson', title: 'Katherine Johnson', subtitle: 'Solo — Jazz', shiftName: 'Session A' },
      { type: 'title_card', name: 'Intermission', title: 'Intermission' },
      { type: 'feature', name: 'Awards Ceremony', title: 'Awards Ceremony', subtitle: 'Main stage' },
      { type: 'lower_third', name: 'Mae Jemison', title: 'Mae Jemison', subtitle: 'Group — Ballet', shiftName: 'Session B' },
    ],
    checklist: [{ id: 'c1', label: 'Mic check', checked: false, category: 'Audio', sortOrder: 0 }],
    overlayConfig: { animation: 'zoom', accentColor: '#ff5500', fontSize: 40 },
    streaming: { streamKey: 'sk_live', rtmpUrl: 'rtmp://ingest/live', livestreamUrl: 'https://watch.streamstage.live/gala', embedCode: '<iframe src="gala"></iframe>' },
    drive: { eventFolderId: null, eventFolderUrl: 'https://drive/folder', clientFolderId: null, clientFolderUrl: null },
  }
}

let app: ElectronApplication
let win: Page

test.beforeAll(async () => {
  const launched = await launch()
  app = launched.app
  win = launched.win
})

test.afterAll(async () => {
  if (app) await app.close()
})

// Helpers — all reads go through the same IPC the UI uses.
const state = () => win.evaluate(async () => window.api.overlayGetState())
const triggers = () => win.evaluate(async () => window.api.triggerList())
const current = () => win.evaluate(async () => window.api.sessionGetCurrent())

async function userDataPath(): Promise<string> {
  return app.evaluate(({ app }) => app.getPath('userData'))
}

test('STEP 1: fresh boot — no session, no triggers', async () => {
  const cur = await current()
  expect(cur).toBeNull()
  const list = await triggers()
  expect(list.triggers.length).toBe(0)
})

test('STEP 2: apply CC package — triggers load, auto-select 0, styling + session adopted', async () => {
  const result = await win.evaluate(async (pkg) => window.api.ccApplyPackage(pkg as any, 'evt-lifecycle-1'), makePackage())
  expect(result.success).toBe(true)
  expect(result.triggerCount).toBe(5)

  const list = await triggers()
  expect(list.triggers.length).toBe(5)
  expect(list.selectedIndex).toBe(0) // auto-select first

  const st = await state()
  // Auto-select fed the lower-third from trigger 0.
  expect(st.lowerThird.title).toBe('Grace Hopper')
  // overlayConfig styling applied.
  expect(st.lowerThird.styling.animation).toBe('zoom')
  // accentColor: client.brandColor first, then overlayConfig.accentColor overrides.
  expect(st.lowerThird.styling.accentColor).toBe('#ff5500')

  // A session was adopted, named from client org.
  const cur = await current()
  expect(cur).not.toBeNull()
  expect(cur!.name).toBe('Starlight Studio (live)')
})

test('STEP 3: fire lower third → visible; next/prev navigates + retitles', async () => {
  await win.evaluate(async () => window.api.overlayFireLT())
  let st = await state()
  expect(st.lowerThird.visible).toBe(true)

  await win.evaluate(async () => window.api.triggerNext())
  let list = await triggers()
  expect(list.selectedIndex).toBe(1)
  st = await state()
  expect(st.lowerThird.title).toBe('Katherine Johnson')

  await win.evaluate(async () => window.api.triggerPrev())
  list = await triggers()
  expect(list.selectedIndex).toBe(0)
  st = await state()
  expect(st.lowerThird.title).toBe('Grace Hopper')
})

test('STEP 4: navigate to a title_card/feature trigger and fire → feature card renders, not lower third', async () => {
  // Move to index 2 (title_card 'Intermission').
  await win.evaluate(async () => window.api.triggerSelect(2))
  let list = await triggers()
  expect(list.selectedIndex).toBe(2)
  expect(list.triggers[2].type).toBe('title_card')

  await win.evaluate(async () => window.api.overlayFireLT())
  const st = await state()
  // title_card → feature card visible, lower third suppressed (overlay.ts:396).
  expect(st.featureCard.visible).toBe(true)
  expect(st.featureCard.title).toBe('Intermission')
  expect(st.lowerThird.visible).toBe(false)

  // Playlist position untouched by the feature-card fire.
  list = await triggers()
  expect(list.selectedIndex).toBe(2)

  // Reset to a lower-third trigger for later steps and clear the feature card.
  await win.evaluate(async () => window.api.overlayFeatureHide())
  await win.evaluate(async () => window.api.triggerSelect(0))
})

test('STEP 5: toggle clock, counter, grid; show ticker → each visible flag flips', async () => {
  const before = await state()
  expect(before.clock.visible).toBe(false)
  expect(before.counter.visible).toBe(false)
  expect(before.gridVisible).toBe(false)

  await win.evaluate(async () => window.api.overlayClockToggle())
  await win.evaluate(async () => window.api.overlayCounterToggle())
  await win.evaluate(async () => window.api.overlayGridToggle())
  await win.evaluate(async () => window.api.tickerShow('LIVE NOW — Summer Gala', 80))

  const st = await state()
  expect(st.clock.visible).toBe(true)
  expect(st.counter.visible).toBe(true)
  expect(st.gridVisible).toBe(true)
  expect(st.ticker.visible).toBe(true)
  expect(st.ticker.text).toBe('LIVE NOW — Summer Gala')
})

test('STEP 6: ad-hoc fire — transient lower third + last-adhoc readout, playlist UNCHANGED', async () => {
  const listBefore = await triggers()
  const idxBefore = listBefore.selectedIndex
  const countBefore = listBefore.triggers.length

  await win.evaluate(async () => window.api.overlayFireAdhoc('Quick Announcement', 'Doors close in 5'))

  const st = await state()
  expect(st.lowerThird.visible).toBe(true)
  expect(st.lowerThird.title).toBe('Quick Announcement')
  expect(st.lowerThird.subtitle).toBe('Doors close in 5')

  const last = await win.evaluate(async () => window.api.overlayGetLastAdhoc())
  expect(last).not.toBeNull()
  expect(last.title).toBe('Quick Announcement')
  expect(last.subtitle).toBe('Doors close in 5')

  // INVARIANT: ad-hoc must not mutate the playlist.
  const listAfter = await triggers()
  expect(listAfter.selectedIndex).toBe(idxBefore)
  expect(listAfter.triggers.length).toBe(countBefore)
  // And the trigger array contents are unchanged (no ad-hoc leaked in).
  expect(listAfter.triggers.map((t: any) => t.name)).toEqual(listBefore.triggers.map((t: any) => t.name))
})

test('STEP 7: edit styling (distinctive animation + accentColor), wait past auto-save debounce', async () => {
  await win.evaluate(async () => window.api.overlayUpdateStyling({ animation: 'sparkle', accentColor: '#0099ff' }))
  const st = await state()
  expect(st.lowerThird.styling.animation).toBe('sparkle')
  expect(st.lowerThird.styling.accentColor).toBe('#0099ff')
  // Wait > 800ms debounce so the adopted session is written to disk.
  await win.waitForTimeout(1100)
})

test('STEP 8: on-disk session file reflects applied triggers + edited styling (auto-save into adopted session)', async () => {
  const cur = await current()
  expect(cur).not.toBeNull()
  const id = cur!.id

  const filePath = path.join(await userDataPath(), 'sessions', `${id}.json`)
  expect(fs.existsSync(filePath)).toBe(true)

  const persisted = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  // The auto-save target is the SAME session CC adopted.
  expect(persisted.name).toBe('Starlight Studio (live)')
  // Applied triggers persisted.
  expect(persisted.triggers.length).toBe(5)
  expect(persisted.triggers[0].title).toBe('Grace Hopper')
  expect(persisted.triggers[3].name).toBe('Awards Ceremony')
  // Operator's later styling edit persisted (NOT the package's original 'zoom').
  expect(persisted.styling.animation).toBe('sparkle')
  expect(persisted.styling.accentColor).toBe('#0099ff')

  // INVARIANT: exactly one session file exists — auto-save didn't fork a new one.
  const files = fs.readdirSync(path.join(await userDataPath(), 'sessions')).filter((f) => f.endsWith('.json'))
  expect(files).toEqual([`${id}.json`])
})

test('STEP 9: close + relaunch on SAME userDataDir → full live state auto-restored', async () => {
  // Capture identity to compare after restart.
  const before = await current()
  const beforeId = before!.id

  await app.close()

  const relaunched = await launch()
  app = relaunched.app
  win = relaunched.win

  // Startup auto-load (index.ts:175) restored the most-recent session with NO manual load.
  const cur = await current()
  expect(cur).not.toBeNull()
  expect(cur!.id).toBe(beforeId) // same session
  expect(cur!.name).toBe('Starlight Studio (live)')

  const list = await triggers()
  expect(list.triggers.length).toBe(5)
  expect(list.triggers[0].title).toBe('Grace Hopper')
  expect(list.triggers[4].name).toBe('Mae Jemison')
  // selectedIndex was 0 at save time → restored to 0.
  expect(list.selectedIndex).toBe(0)

  const st = await state()
  // The edited styling survived the restart — the core "edits persist" invariant.
  expect(st.lowerThird.styling.animation).toBe('sparkle')
  expect(st.lowerThird.styling.accentColor).toBe('#0099ff')
  // Auto-select fed the lower-third from restored trigger 0.
  expect(st.lowerThird.title).toBe('Grace Hopper')
})
