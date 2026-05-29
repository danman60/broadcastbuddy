import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'

// ── Session lifecycle round-trip ─────────────────────────────────
// Drives the full save/load cycle at the IPC level:
//   sessionNew → add triggers + styling + stream config + notes →
//   sessionSave → sessionList (appears) → sessionNew (clears) →
//   sessionLoad (restores everything). Asserts restored == saved.
//
// All assertions go through window.api.* (the preload bridge). State lives in
// the main process; the renderer is only a control surface. Launch pattern is
// mirrored from app.spec.ts. Ports are read from settingsGet(), never hardcoded.

let app: ElectronApplication
let window: Page

// IDs created during the run, cleaned up in afterAll.
const TRIGGER_A = 'rt-trigger-a'
const TRIGGER_B = 'rt-trigger-b'

test.beforeAll(async () => {
  app = await electron.launch({
    args: [
      path.join(__dirname, '..'),
      '--disable-gpu',
      '--no-sandbox',
    ],
    env: {
      ...process.env,
      NODE_ENV: 'production',
    },
  })
  window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForTimeout(1500)

  // Clean slate: clear any triggers left over from a prior run / other suite.
  await window.evaluate(async () => {
    await window.api.triggerClearAll()
  })
})

test.afterAll(async () => {
  // Best-effort cleanup of created triggers (sessions persist as JSON on disk;
  // there is no delete-session IPC, so we leave the saved session files alone).
  try {
    await window.evaluate(async (ids) => {
      for (const id of ids) {
        await window.api.triggerDelete(id)
      }
      await window.api.triggerClearAll()
    }, [TRIGGER_A, TRIGGER_B])
  } catch { /* window may already be closed */ }
  if (app) await app.close()
})

// Helper: a unique session name per test file run so list assertions are stable.
const SESSION_NAME = `RoundTrip-${Date.now().toString(36)}`

// Holds the saved session captured by the save test so later tests can compare.
let savedSession: any = null

test('sessionNew creates a fresh empty session', async () => {
  const s = await window.evaluate(async (name) => {
    return window.api.sessionNew(name + '-init', false)
  }, SESSION_NAME)

  expect(s).toBeTruthy()
  expect(s).toHaveProperty('id')
  expect(s).toHaveProperty('name')
  expect(s.name).toBe(SESSION_NAME + '-init')
  expect(s).toHaveProperty('createdAt')

  // Fresh session (preserveTriggers=false) resets overlay state → no triggers.
  const list = await window.evaluate(async () => window.api.triggerList())
  expect(Array.isArray(list.triggers)).toBe(true)
  expect(list.triggers.length).toBe(0)
})

test('add triggers, styling, stream config, and notes to the session', async () => {
  // Two triggers.
  await window.evaluate(async (ids) => {
    await window.api.triggerAdd({
      id: ids[0], name: 'Alpha', title: 'Alice Anderson',
      subtitle: 'Keynote Speaker', category: 'Speakers', order: 0, logoDataUrl: '',
    })
    await window.api.triggerAdd({
      id: ids[1], name: 'Bravo', title: 'Bob Brown',
      subtitle: 'Panelist', category: 'Panel', order: 1, logoDataUrl: '',
    })
  }, [TRIGGER_A, TRIGGER_B])

  // Styling.
  await window.evaluate(async () => {
    await window.api.overlayUpdateStyling({
      accentColor: '#abcdef',
      fontSize: 41,
      backgroundStyle: 'glass',
    })
  })

  // Stream config.
  await window.evaluate(async () => {
    await window.api.streamConfigSet({
      streamKey: 'rt-key-123',
      rtmpUrl: 'rtmp://example.test/live',
      viewingLink: 'https://watch.example.test/rt',
      embedCode: '<iframe src="rt"></iframe>',
      chatLink: 'https://chat.example.test/rt',
    })
  })

  // A note.
  await window.evaluate(async () => {
    await window.api.notesAdd('Round-trip note one')
  })

  // Sanity: everything is in the live overlay state now.
  const list = await window.evaluate(async () => window.api.triggerList())
  expect(list.triggers.length).toBe(2)

  const styling = await window.evaluate(async () => (await window.api.overlayGetState()).lowerThird.styling)
  expect(styling.accentColor).toBe('#abcdef')
  expect(styling.fontSize).toBe(41)

  const cfg = await window.evaluate(async () => window.api.streamConfigGet())
  expect(cfg?.streamKey).toBe('rt-key-123')

  const notes = await window.evaluate(async () => window.api.notesList())
  expect(notes.some((n) => n.text === 'Round-trip note one')).toBe(true)
})

test('sessionSave captures triggers, styling, stream config, and notes', async () => {
  savedSession = await window.evaluate(async () => {
    return window.api.sessionSave()
  })

  expect(savedSession).toBeTruthy()
  expect(savedSession).toHaveProperty('id')
  expect(savedSession).toHaveProperty('triggers')
  expect(savedSession.triggers.length).toBe(2)
  expect(savedSession.triggers[0].title).toBe('Alice Anderson')
  expect(savedSession.triggers[1].title).toBe('Bob Brown')

  // Styling captured.
  expect(savedSession.styling.accentColor).toBe('#abcdef')
  expect(savedSession.styling.fontSize).toBe(41)
  expect(savedSession.styling.backgroundStyle).toBe('glass')

  // Stream config captured.
  expect(savedSession.streamConfig).toBeTruthy()
  expect(savedSession.streamConfig.streamKey).toBe('rt-key-123')
  expect(savedSession.streamConfig.rtmpUrl).toBe('rtmp://example.test/live')
  expect(savedSession.streamConfig.viewingLink).toBe('https://watch.example.test/rt')

  // Notes captured.
  expect(Array.isArray(savedSession.notes)).toBe(true)
  expect(savedSession.notes.some((n: { text: string }) => n.text === 'Round-trip note one')).toBe(true)
})

test('sessionList includes the saved session', async () => {
  expect(savedSession).toBeTruthy()
  const list = await window.evaluate(async () => window.api.sessionList())
  expect(Array.isArray(list)).toBe(true)

  const match = list.find((s) => s.id === savedSession.id)
  expect(match).toBeTruthy()
  expect(match?.name).toBe(savedSession.name)
  expect(match).toHaveProperty('updatedAt')
})

test('sessionNew clears the live state (triggers, styling)', async () => {
  await window.evaluate(async () => {
    return window.api.sessionNew('RoundTrip-cleared', false)
  })

  // Triggers cleared.
  const list = await window.evaluate(async () => window.api.triggerList())
  expect(list.triggers.length).toBe(0)

  // Styling reset back to defaults (not the custom 41 / glass we set earlier).
  const styling = await window.evaluate(async () => (await window.api.overlayGetState()).lowerThird.styling)
  expect(styling.fontSize).not.toBe(41)
  expect(styling.accentColor).not.toBe('#abcdef')
})

test('sessionLoad restores triggers, styling, stream config, and notes', async () => {
  expect(savedSession).toBeTruthy()

  const loaded = await window.evaluate(async (id) => {
    return window.api.sessionLoad(id)
  }, savedSession.id)

  expect(loaded).toBeTruthy()
  expect(loaded.id).toBe(savedSession.id)

  // Triggers restored into the live state.
  const list = await window.evaluate(async () => window.api.triggerList())
  expect(list.triggers.length).toBe(2)
  const titles = list.triggers.map((t) => t.title).sort()
  expect(titles).toEqual(['Alice Anderson', 'Bob Brown'])

  // Styling restored.
  const styling = await window.evaluate(async () => (await window.api.overlayGetState()).lowerThird.styling)
  expect(styling.accentColor).toBe('#abcdef')
  expect(styling.fontSize).toBe(41)
  expect(styling.backgroundStyle).toBe('glass')

  // Stream config restored.
  const cfg = await window.evaluate(async () => window.api.streamConfigGet())
  expect(cfg?.streamKey).toBe('rt-key-123')
  expect(cfg?.rtmpUrl).toBe('rtmp://example.test/live')
  expect(cfg?.viewingLink).toBe('https://watch.example.test/rt')

  // Notes restored.
  const notes = await window.evaluate(async () => window.api.notesList())
  expect(notes.some((n) => n.text === 'Round-trip note one')).toBe(true)
})

test('restored state deep-equals the saved session payload', async () => {
  expect(savedSession).toBeTruthy()

  // Pull the current live state and compare the load-relevant fields against
  // what sessionSave captured. This is the core "round-trip" invariant.
  const liveTriggers = await window.evaluate(async () => (await window.api.triggerList()).triggers)
  expect(liveTriggers.map((t) => ({ id: t.id, title: t.title, subtitle: t.subtitle, category: t.category })))
    .toEqual(savedSession.triggers.map((t: any) => ({ id: t.id, title: t.title, subtitle: t.subtitle, category: t.category })))

  const liveStyling = await window.evaluate(async () => (await window.api.overlayGetState()).lowerThird.styling)
  expect(liveStyling.accentColor).toBe(savedSession.styling.accentColor)
  expect(liveStyling.fontSize).toBe(savedSession.styling.fontSize)
  expect(liveStyling.backgroundStyle).toBe(savedSession.styling.backgroundStyle)

  const liveCfg = await window.evaluate(async () => window.api.streamConfigGet())
  expect(liveCfg?.streamKey).toBe(savedSession.streamConfig.streamKey)
  expect(liveCfg?.rtmpUrl).toBe(savedSession.streamConfig.rtmpUrl)
  expect(liveCfg?.embedCode).toBe(savedSession.streamConfig.embedCode)

  const liveNotes = await window.evaluate(async () => window.api.notesList())
  const savedNoteTexts = savedSession.notes.map((n: { text: string }) => n.text).sort()
  const liveNoteTexts = liveNotes.map((n) => n.text).sort()
  expect(liveNoteTexts).toEqual(savedNoteTexts)
})

test('sessionGetCurrent reflects the loaded session', async () => {
  expect(savedSession).toBeTruthy()
  const current = await window.evaluate(async () => window.api.sessionGetCurrent())
  expect(current).toBeTruthy()
  expect(current?.id).toBe(savedSession.id)
})
