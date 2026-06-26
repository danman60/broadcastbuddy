import { test, expect } from '@playwright/test'
import { launchApp, closeApp, api, mkUserDataDir, Harness } from './zz-harness'

/**
 * Durability across an app restart. The operator force-quits BroadcastBuddy and
 * relaunches mid-show all the time; settings, the saved session, and notes must
 * survive. We launch → write → close → relaunch the SAME userData dir → assert
 * the state came back.
 */

const userDataDir = mkUserDataDir()
const token = `persist-${Date.now()}`
let sessionId = ''
let noteId = ''

test('seed state, then restart and verify it persisted', async () => {
  test.setTimeout(90000)
  // ── First launch: write everything. ──
  let h: Harness = await launchApp(userDataDir)
  await api(h.window, 'settingsSet', 'voiceWakeWord', token)
  await api(h.window, 'settingsSet', 'cameraHost2', '10.9.9.9')

  const session = await api<{ id: string }>(h.window, 'sessionNew', token)
  await api(h.window, 'triggerClearAll')
  await api(h.window, 'triggerAdd', { id: 'persist-trig', title: 'Persisted Routine', type: 'lower_third' })
  // Notes are part of session state — add BEFORE the save so they're persisted.
  const note = await api<{ id: string }>(h.window, 'notesAdd', `note ${token}`)
  noteId = note.id
  await api(h.window, 'sessionSave')
  sessionId = session.id
  await closeApp(h)

  // ── Second launch: same userData dir → state must come back. ──
  h = await launchApp(userDataDir)
  const settings = await api<Record<string, unknown>>(h.window, 'settingsGet')
  expect(settings.voiceWakeWord).toBe(token)
  expect(settings.cameraHost2).toBe('10.9.9.9')

  const list = await api<Array<{ id: string; name: string }>>(h.window, 'sessionList')
  expect(list.some((s) => s.id === sessionId)).toBe(true)

  const notes = await api<Array<{ id: string }>>(h.window, 'notesList')
  expect(notes.some((n) => n.id === noteId)).toBe(true)

  // Loading the persisted session restores its triggers.
  await api(h.window, 'sessionLoad', sessionId)
  const triggers = await api<{ triggers: Array<{ id: string }> }>(h.window, 'triggerList')
  expect(triggers.triggers.some((t) => t.id === 'persist-trig')).toBe(true)

  await closeApp(h)
})
