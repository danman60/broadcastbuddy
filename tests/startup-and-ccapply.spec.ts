import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'

// ── Regression: startup auto-load + CC-apply session adoption ───────────────
//
// Covers behaviors shipped in commits a1e0aea + ba5f359:
//
//   1. STARTUP AUTO-LOAD (src/main/index.ts step 12b): on boot, if no session
//      is currently set, the most-recent saved session is auto-loaded into the
//      overlay via overlay.loadSessionState(), WITHOUT any manual sessionLoad
//      call. loadSessionState() forces lowerThird.visible=false.
//
//   2. CC-APPLY AUTO-SELECT (src/main/ipc.ts CC_APPLY_PACKAGE): after applying a
//      package with triggers, selectedIndex===0 and the lowerThird.title is
//      populated from trigger 0 (no empty card / disabled Up Next).
//
//   3. CC-APPLY SESSION ADOPTION GUARD (ba5f359 MED fix): CC apply only
//      adopts+force-saves a NEW session when NO session is loaded. When a
//      session is already loaded, apply must NOT immediately overwrite that
//      session's file, and the current session id must stay the same.
//
// Each launch uses an isolated mkdtemp userData dir so the startup auto-load
// can't leak sessions between cases (mirrors autosave-persistence.spec.ts).
// All state assertions go through window.api.* (preload bridge) or by reading
// the on-disk sessions/<id>.json, never hardcoded ports.

// Helpers bound to a specific app+window pair so multiple launches don't collide.
async function userDataPath(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ app }) => app.getPath('userData'))
}
async function sessionsDir(app: ElectronApplication): Promise<string> {
  return path.join(await userDataPath(app), 'sessions')
}
async function launch(userDataDir: string): Promise<{ app: ElectronApplication; win: Page }> {
  const app = await electron.launch({
    args: [
      path.join(__dirname, '..'),
      `--user-data-dir=${userDataDir}`,
      '--disable-gpu',
      '--no-sandbox',
    ],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  return { app, win }
}

// ── 1. STARTUP AUTO-LOAD ────────────────────────────────────────────────────
test('STARTUP AUTO-LOAD: most-recent session is restored on boot with no manual load', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-startup-autoload-'))

  // --- First launch: create + save a session with triggers and styling. ---
  let { app, win } = await launch(userDataDir)

  await win.evaluate(async () => {
    await window.api.triggerClearAll()
    await window.api.sessionNew('AutoLoadShow', false)
    await window.api.triggerAdd({
      id: 'al-t0', name: 'Grace Hopper', title: 'Grace Hopper',
      subtitle: 'Rear Admiral', category: 'Speakers', order: 0, logoDataUrl: '',
    } as any)
    await window.api.triggerAdd({
      id: 'al-t1', name: 'Alan Turing', title: 'Alan Turing',
      subtitle: 'Cryptanalyst', category: 'Speakers', order: 1, logoDataUrl: '',
    } as any)
    await window.api.overlayUpdateStyling({ accentColor: '#0fa1de', fontSize: 44 })
    await window.api.sessionSave()
  })

  const savedId = await win.evaluate(async () => (await window.api.sessionGetCurrent())!.id)
  expect(typeof savedId).toBe('string')

  // Confirm the file landed on disk before relaunch.
  const dir = await sessionsDir(app)
  expect(fs.existsSync(path.join(dir, `${savedId}.json`))).toBe(true)

  await app.close()

  // --- Second launch: SAME userDataDir. No manual sessionLoad call. ---
  ;({ app, win } = await launch(userDataDir))

  // session:get-current must be non-null on boot (auto-loaded), same id.
  const current = await win.evaluate(async () => window.api.sessionGetCurrent())
  expect(current).not.toBeNull()
  expect(current!.id).toBe(savedId)
  expect(current!.name).toBe('AutoLoadShow')

  // Overlay triggers match the saved session WITHOUT any manual load.
  const list = await win.evaluate(async () => window.api.triggerList())
  expect(list.triggers.length).toBe(2)
  const titles = list.triggers.map((t: any) => t.title).sort()
  expect(titles).toEqual(['Alan Turing', 'Grace Hopper'])

  // Styling restored.
  const styling = await win.evaluate(async () => (await window.api.overlayGetState()).lowerThird.styling)
  expect(styling.accentColor).toBe('#0fa1de')
  expect(styling.fontSize).toBe(44)

  // loadSessionState() forces lowerThird NOT visible on boot.
  const visible = await win.evaluate(async () => (await window.api.overlayGetState()).lowerThird.visible)
  expect(visible).toBe(false)

  await app.close()
  fs.rmSync(userDataDir, { recursive: true, force: true })
})

// A realistic BroadcastPackage (mirrors cc-integration.spec.ts). No logoUrls →
// no outbound fetch, fully offline.
function makePackage(orgOverride?: string | null) {
  return {
    eventId: 'evt-ccapply-1',
    version: '2.0',
    generatedAt: new Date('2026-05-29T00:00:00Z').toISOString(),
    event: { eventName: 'Spring Showcase', eventType: 'recital', venueName: 'Main Hall', eventDate: '2026-06-01T18:00:00Z' },
    client: { organization: orgOverride === undefined ? 'Acme Studio' : orgOverride, brandColor: '#ff8800', logoUrl: null },
    company: { name: 'StreamStage', logoUrl: null, primaryColor: '#112233', secondaryColor: null },
    triggers: [
      { type: 'lower_third', name: 'Ada Lovelace', subtitle: 'Keynote', shiftName: 'Morning' },
      { type: 'lower_third', name: 'Edsger Dijkstra', subtitle: 'Panel', shiftName: 'Afternoon' },
    ],
    checklist: [{ id: 'c1', label: 'Mic check', checked: false, category: 'Audio', sortOrder: 0 }],
    overlayConfig: { fontSize: 36, animation: 'zoom', textColor: '#eeeeee' },
    streaming: { streamKey: 'sk_test', rtmpUrl: 'rtmp://ingest/x', livestreamUrl: 'https://watch.streamstage.live/x', embedCode: '<iframe src="x"></iframe>' },
    drive: { eventFolderId: null, eventFolderUrl: 'https://drive/folder', clientFolderId: null, clientFolderUrl: null },
  }
}

// ── 2. CC-APPLY AUTO-SELECT ─────────────────────────────────────────────────
test('CC-APPLY AUTO-SELECT: index 0 selected + lowerThird title populated from trigger 0', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-ccapply-select-'))
  const { app, win } = await launch(userDataDir)

  // Fresh profile: no session loaded (auto-load is a no-op on empty profile).
  const before = await win.evaluate(async () => window.api.sessionGetCurrent())
  expect(before).toBeNull()

  const result = await win.evaluate(async (pkg) => window.api.ccApplyPackage(pkg as any, 'evt-ccapply-1'), makePackage())
  expect(result.success).toBe(true)
  expect(result.triggerCount).toBe(2)

  // Auto-selected index 0.
  const list = await win.evaluate(async () => window.api.triggerList())
  expect(list.selectedIndex).toBe(0)

  // lowerThird.title populated (non-empty) from trigger 0.
  const lt = await win.evaluate(async () => (await window.api.overlayGetState()).lowerThird)
  expect(typeof lt.title).toBe('string')
  expect(lt.title.length).toBeGreaterThan(0)
  expect(lt.title).toBe('Ada Lovelace') // trigger 0 name → title

  await app.close()
  fs.rmSync(userDataDir, { recursive: true, force: true })
})

// ── 3A. CC-APPLY SESSION ADOPTION — no session loaded → adopts new session ───
test('CC-APPLY ADOPTION (no session): apply adopts a session named from client org', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-ccapply-adopt-'))
  const { app, win } = await launch(userDataDir)

  // Fresh profile: confirm no session before apply.
  const before = await win.evaluate(async () => window.api.sessionGetCurrent())
  expect(before).toBeNull()

  await win.evaluate(async (pkg) => window.api.ccApplyPackage(pkg as any, 'evt-ccapply-1'), makePackage('Acme Studio'))

  // A session was adopted.
  const after = await win.evaluate(async () => window.api.sessionGetCurrent())
  expect(after).not.toBeNull()
  // Named "<org> (live)" per ipc.ts, falling back to 'CC Package' when no org.
  expect(after!.name).toBe('Acme Studio (live)')

  // The adopted session is force-saved to disk.
  const dir = await sessionsDir(app)
  expect(fs.existsSync(path.join(dir, `${after!.id}.json`))).toBe(true)

  await app.close()
  fs.rmSync(userDataDir, { recursive: true, force: true })
})

// ── 3A'. CC-APPLY ADOPTION fallback name when no org ─────────────────────────
test("CC-APPLY ADOPTION (no session, no org): falls back to 'CC Package'", async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-ccapply-adopt-noorg-'))
  const { app, win } = await launch(userDataDir)

  const before = await win.evaluate(async () => window.api.sessionGetCurrent())
  expect(before).toBeNull()

  await win.evaluate(async (pkg) => window.api.ccApplyPackage(pkg as any, 'evt-ccapply-1'), makePackage(null))

  const after = await win.evaluate(async () => window.api.sessionGetCurrent())
  expect(after).not.toBeNull()
  expect(after!.name).toBe('CC Package')

  await app.close()
  fs.rmSync(userDataDir, { recursive: true, force: true })
})

// ── 3B. CC-APPLY GUARD — session loaded → does NOT immediately overwrite it ──
test('CC-APPLY GUARD (session loaded): apply does not adopt a new session nor immediately overwrite the loaded one', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-ccapply-guard-'))
  const { app, win } = await launch(userDataDir)

  // Create + save a known session "ShowA" with its own triggers.
  await win.evaluate(async () => {
    await window.api.triggerClearAll()
    await window.api.sessionNew('ShowA', false)
    await window.api.triggerAdd({
      id: 'showa-t0', name: 'ShowA Performer', title: 'ShowA Performer',
      subtitle: 'Solo', category: 'Routines', order: 0, logoDataUrl: '',
    } as any)
    await window.api.sessionSave()
  })

  const showAId = await win.evaluate(async () => (await window.api.sessionGetCurrent())!.id)
  const dir = await sessionsDir(app)
  const showAPath = path.join(dir, `${showAId}.json`)
  expect(fs.existsSync(showAPath)).toBe(true)

  // Capture the ShowA file contents + the set of session files before apply.
  const showABefore = fs.readFileSync(showAPath, 'utf-8')
  const filesBefore = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  expect(filesBefore).toContain(`${showAId}.json`)

  // Apply a DIFFERENT package while ShowA is loaded.
  await win.evaluate(async (pkg) => window.api.ccApplyPackage(pkg as any, 'evt-ccapply-1'), makePackage('Acme Studio'))

  // Read the ShowA file IMMEDIATELY (well under the 800ms auto-save debounce)
  // to prove the apply did NOT force-save over it.
  const showAImmediate = fs.readFileSync(showAPath, 'utf-8')
  expect(showAImmediate).toBe(showABefore)

  // Robust intent assertions (debounce-independent):
  // (a) current session id is STILL ShowA — apply did not adopt a new session.
  const current = await win.evaluate(async () => window.api.sessionGetCurrent())
  expect(current).not.toBeNull()
  expect(current!.id).toBe(showAId)
  expect(current!.name).toBe('ShowA')

  // (b) apply created NO new session file (no "Acme Studio (live)" / "CC Package").
  const filesAfter = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  expect(filesAfter).toEqual(filesBefore)

  await app.close()
  fs.rmSync(userDataDir, { recursive: true, force: true })
})
