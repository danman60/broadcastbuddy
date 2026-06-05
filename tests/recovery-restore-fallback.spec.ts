// Crash-recovery FALLBACK regression (shipped this session).
//
// Fix under test — src/main/ipc.ts RECOVERY_RESTORE handler:
//   When a crash snapshot's saved session file is GONE (loadSession returns
//   null), the fallback now calls session.newSession('<name> (recovered)')
//   BEFORE overlay.loadSessionState(...). Without that, currentSession would
//   still point at the session auto-loaded on boot (index.ts step 12b) and the
//   debounced auto-save would overwrite THAT unrelated session with the
//   recovered triggers — corrupting it.
//
// To exercise the fallback deterministically we PLANT, in an isolated empty
// userDataDir BEFORE launch:
//   1. A real "other" session file (sessions/<otherId>.json) so the boot
//      auto-load (getMostRecentSession) adopts it as currentSession.
//   2. A recovery snapshot (recovery-snapshot.json) whose currentSessionId
//      points at a session file that does NOT exist on disk → loadSession()
//      returns null → fallback branch.
//   3. The dirty marker (session.dirty) so checkAndRecover() arms the pending
//      snapshot at boot.
//
// Asserts:
//   (a) recovery:restore returns { restored: true }
//   (b) session:get-current is now a NEW session whose name ends '(recovered)'
//   (c) the planted "other" session keeps ITS OWN triggers — it never adopts the
//       recovered triggers (the corruption the fix prevents).
//   (d) after a styling edit + >800ms debounce, the recovered triggers are
//       persisted to the RECOVERED session's file (not the other one), and the
//       other file still holds only its own trigger.
//
// Note on byte-equality: BB auto-loads the most-recent session on boot, which
// fires a debounced auto-save that REWRITES the other file (same triggers, but
// re-serialized with a refreshed updatedAt). That is normal, non-corrupting
// behavior — so the invariant under test is trigger IDENTITY, not raw bytes. We
// snapshot the other file AFTER boot settles and assert its trigger set is
// stable across the restore + recovered-session auto-save.

import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'

let app: ElectronApplication
let window: Page

// Isolated, empty userData planted with our recovery fixtures before launch.
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-recovery-'))

// The "other" session that boot auto-load should adopt. Its file stays on disk;
// the fix must NOT corrupt it.
const OTHER_SESSION_ID = 'other-real-session-id'
const otherSession = {
  id: OTHER_SESSION_ID,
  name: 'Boot Auto-Loaded Session',
  triggers: [
    { id: 't-other', name: 'OtherTrig', title: 'Other Title', subtitle: 'Other Sub', category: '', order: 0, logoDataUrl: '' },
  ],
  styling: {
    fontFamily: "'Segoe UI', sans-serif", fontSize: 28, fontWeight: 600,
    textColor: '#ffffff', backgroundColor: '#1a1a2e', backgroundStyle: 'solid',
    accentColor: '#222222', borderRadius: 8, animation: 'slide',
    animationDuration: 0.5, animationEasing: 'ease', autoHideSeconds: 8,
  },
  companyLogoDataUrl: '',
  clientLogoDataUrl: '',
  selectedIndex: 0,
  playedIds: [],
  loopMode: 'none',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

// The snapshot's currentSessionId points at a session file that does NOT exist
// → loadSession() returns null → RECOVERY_RESTORE takes the fallback branch.
const MISSING_SESSION_ID = 'gone-session-id-not-on-disk'
const recoveredTriggers = [
  { id: 't-rec-1', name: 'RecTrig1', title: 'Recovered Title 1', subtitle: 'Recovered Sub 1', category: '', order: 0, logoDataUrl: '' },
  { id: 't-rec-2', name: 'RecTrig2', title: 'Recovered Title 2', subtitle: 'Recovered Sub 2', category: '', order: 1, logoDataUrl: '' },
]

let otherSessionPath: string

function otherTriggerIds(): string[] {
  const json = JSON.parse(fs.readFileSync(otherSessionPath, 'utf-8'))
  return json.triggers.map((t: { id: string }) => t.id).sort()
}

test.beforeAll(async () => {
  // Plant fixtures BEFORE launch.
  const sessionsDir = path.join(userDataDir, 'sessions')
  fs.mkdirSync(sessionsDir, { recursive: true })
  otherSessionPath = path.join(sessionsDir, `${OTHER_SESSION_ID}.json`)
  fs.writeFileSync(otherSessionPath, JSON.stringify(otherSession, null, 2), 'utf-8')

  // Recovery snapshot — shape = RecoverySnapshot (crashRecovery.ts). triggers
  // is non-empty so checkAndRecover() keeps it; overlayState carries the styling
  // the fallback reads (snap.overlayState.lowerThird.styling).
  const snapshot = {
    savedAt: new Date().toISOString(),
    currentSessionId: MISSING_SESSION_ID,
    currentSessionName: 'My Recital Show',
    triggers: recoveredTriggers,
    overlayState: {
      lowerThird: {
        visible: false, name: '', title: '', subtitle: '', label: '',
        styling: {
          fontFamily: "'Segoe UI', sans-serif", fontSize: 33, fontWeight: 700,
          textColor: '#ffffff', backgroundColor: '#1a1a2e', backgroundStyle: 'solid',
          accentColor: '#ff00aa', borderRadius: 8, animation: 'zoom',
          animationDuration: 0.5, animationEasing: 'ease', autoHideSeconds: 8,
        },
      },
      companyLogo: { visible: false, dataUrl: '' },
      clientLogo: { visible: false, dataUrl: '' },
      ticker: { visible: false, text: '', speed: 60, backgroundColor: '#1a1a2e', textColor: '#ffffff' },
      startingSoon: { visible: false, title: 'Starting Soon', subtitle: '', countdownTarget: '', countdownSeconds: 0, showCountdown: true, completionText: "We're Live!", backgroundColor: '#1a1a2e', textColor: '#ffffff', accentColor: '#667eea' },
      clock: { visible: false, format: '12h', showSeconds: true },
      counter: { visible: false, value: 1, label: '' },
      featureCard: { visible: false, kicker: 'UP NEXT', title: '', subtitle: '', logoDataUrl: '', animateIn: 'slide-up', firedAt: 0 },
      gridVisible: false,
    },
  }
  fs.writeFileSync(path.join(userDataDir, 'recovery-snapshot.json'), JSON.stringify(snapshot), 'utf-8')
  // Dirty marker — its presence (any content) makes checkAndRecover() treat the
  // launch as unclean and arm the snapshot.
  fs.writeFileSync(path.join(userDataDir, 'session.dirty'), new Date().toISOString(), 'utf-8')

  app = await electron.launch({
    args: [
      path.join(__dirname, '..'),
      `--user-data-dir=${userDataDir}`,
      '--disable-gpu',
      '--no-sandbox',
    ],
    env: { ...process.env, NODE_ENV: 'production' },
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

test('boot auto-loads the planted "other" session (precondition for the fix)', async () => {
  // Step 12b auto-load adopts the most-recent session — our planted one.
  const cur = await window.evaluate(async () => window.api.sessionGetCurrent())
  expect(cur).not.toBeNull()
  expect(cur!.id).toBe(OTHER_SESSION_ID)
})

test('recovery:check exposes the planted pending snapshot', async () => {
  const status = await window.evaluate(async () => window.api.recoveryCheck())
  expect(status.available).toBe(true)
  expect(status.triggerCount).toBe(2)
  expect(status.sessionName).toBe('My Recital Show')
})

test('FALLBACK: restore adopts a fresh "(recovered)" session and leaves the other session\'s triggers intact', async () => {
  // Let any boot auto-save settle, then snapshot the other session's triggers.
  await window.waitForTimeout(1100)
  expect(otherTriggerIds()).toEqual(['t-other'])

  // (a) restore returns { restored: true }.
  const res = await window.evaluate(async () => window.api.recoveryRestore())
  expect(res.restored).toBe(true)

  // (b) current session is now a NEW session ending in '(recovered)'.
  const cur = await window.evaluate(async () => window.api.sessionGetCurrent())
  expect(cur).not.toBeNull()
  expect(cur!.id).not.toBe(OTHER_SESSION_ID)
  expect(cur!.name).toMatch(/\(recovered\)$/)
  expect(cur!.name).toBe('My Recital Show (recovered)')

  // (c) the other session still holds only its own trigger — restore did not
  //     repoint currentSession at it nor write recovered triggers into it.
  expect(otherTriggerIds()).toEqual(['t-other'])
})

test('the recovered triggers persist into the RECOVERED session file after a styling edit + debounce', async () => {
  // Capture the recovered session id.
  const cur = await window.evaluate(async () => window.api.sessionGetCurrent())
  const recoveredId = cur!.id
  expect(recoveredId).not.toBe(OTHER_SESSION_ID)

  // Drive a styling change → schedules the 800ms debounced auto-save.
  await window.evaluate(async () => window.api.overlayUpdateStyling({ accentColor: '#0099ff' }))
  await window.waitForTimeout(1100)

  const sessionsDir = path.join(await userDataPath(), 'sessions')

  // The recovered session file now exists and holds the recovered triggers.
  const recoveredPath = path.join(sessionsDir, `${recoveredId}.json`)
  expect(fs.existsSync(recoveredPath)).toBe(true)
  const recoveredPersisted = JSON.parse(fs.readFileSync(recoveredPath, 'utf-8'))
  expect(recoveredPersisted.triggers.map((t: { id: string }) => t.id).sort())
    .toEqual(['t-rec-1', 't-rec-2'])
  expect(recoveredPersisted.styling.accentColor).toBe('#0099ff')

  // The other session never adopted the recovered triggers — the auto-save
  // landed in the recovered session's own file, NOT the other one.
  expect(otherTriggerIds()).toEqual(['t-other'])
})
