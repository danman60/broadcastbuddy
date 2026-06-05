import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'

// Auto-save persistence regression (shipped this session).
//
// src/main/services/overlay.ts notifyChange() now schedules a debounced
// (800ms) session.saveSession(), GUARDED so it only persists when a session
// is loaded (session.getCurrentSession() truthy). This spec verifies:
//   1. With a session loaded, a styling change is persisted to disk
//      (sessions/<id>.json) after the debounce window.
//   2. The negative guard: with NO session loaded, a styling change does
//      NOT create any session file and leaves currentSession null.

let app: ElectronApplication
let window: Page

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
})

test.afterAll(async () => {
  if (app) await app.close()
})

async function userDataPath(): Promise<string> {
  return app.evaluate(({ app }) => app.getPath('userData'))
}

async function sessionsDir(): Promise<string> {
  return path.join(await userDataPath(), 'sessions')
}

async function getCurrent(): Promise<{ id: string } | null> {
  return window.evaluate(async () => window.api.sessionGetCurrent())
}

test('NEGATIVE GUARD: styling change with no session loaded does not persist a session', async () => {
  // Fresh app: no session loaded yet. Confirm currentSession is null.
  const before = await getCurrent()
  expect(before).toBeNull()

  // Snapshot the sessions dir contents (may be empty / not yet created).
  const dir = await sessionsDir()
  const filesBefore = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
    : []

  // Drive a styling change via the same IPC the UI uses.
  await window.evaluate(async () => {
    return window.api.overlayUpdateStyling({ animation: 'fade', accentColor: '#abcdef' })
  })
  // Wait > debounce window.
  await window.waitForTimeout(1100)

  // Still no session.
  const after = await getCurrent()
  expect(after).toBeNull()

  // No new session files written.
  const filesAfter = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
    : []
  expect(filesAfter.sort()).toEqual(filesBefore.sort())
})

test('POSITIVE: styling change with a session loaded is persisted to disk after debounce', async () => {
  // Create/load a session so currentSession is truthy.
  await window.evaluate(async () => {
    return window.api.sessionNew('autosave-test', false)
  })
  const cur = await getCurrent()
  expect(cur).not.toBeNull()
  const id = cur!.id
  expect(typeof id).toBe('string')

  // Change styling to distinctive values via the styling-update IPC.
  await window.evaluate(async () => {
    return window.api.overlayUpdateStyling({ animation: 'sparkle', accentColor: '#123456' })
  })

  // Wait past the 800ms debounce.
  await window.waitForTimeout(1100)

  // Read the persisted session JSON from userData/sessions/<id>.json.
  const dir = await sessionsDir()
  const filePath = path.join(dir, `${id}.json`)
  expect(fs.existsSync(filePath)).toBe(true)

  const persisted = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  expect(persisted.styling.animation).toBe('sparkle')
  expect(persisted.styling.accentColor).toBe('#123456')
})
