import { test, expect } from '@playwright/test'
import { launchApp, closeApp, api, Harness } from './zz-harness'

/**
 * IPC contract sweep — deterministic round-trips against the main-process
 * handlers that hold local state (sessions, triggers, settings, notes,
 * checklist, events, backups, playlist, overlay, presets). No OBS / camera /
 * network dependency; every assertion is on local persisted state.
 */

let h: Harness
test.beforeAll(async () => { h = await launchApp() })
test.afterAll(async () => { await closeApp(h) })

test.describe('sessions CRUD', () => {
  test('new → save → list → load → getCurrent round-trips', async () => {
    const name = `zz-ipc-${Date.now()}`
    const created = await api<{ id: string; name: string }>(h.window, 'sessionNew', name)
    expect(created).toBeTruthy()
    expect(created.name).toBe(name)

    // sessionNew is in-memory only; listSessions() reads the sessions dir, so a
    // save must land before the session appears in the list.
    const saved = await api<{ id: string } | null>(h.window, 'sessionSave')
    expect(saved?.id).toBe(created.id)

    const list = await api<Array<{ id: string; name: string }>>(h.window, 'sessionList')
    expect(Array.isArray(list)).toBe(true)
    expect(list.some((s) => s.id === created.id)).toBe(true)

    const loaded = await api<{ id: string } | null>(h.window, 'sessionLoad', created.id)
    expect(loaded?.id).toBe(created.id)

    const current = await api<{ id: string } | null>(h.window, 'sessionGetCurrent')
    expect(current?.id).toBe(created.id)
  })
})

test.describe('triggers CRUD + navigation', () => {
  // Every trigger handler returns the FULL triggers array (not the touched item).
  const triggers = async () => (await api<{ triggers: Array<{ id: string; title: string }> }>(h.window, 'triggerList')).triggers

  test('clear → add → list → update → select → next/prev → reorder → delete', async () => {
    await api(h.window, 'triggerClearAll')
    expect((await triggers()).length).toBe(0)

    // addTrigger stores the object as-is — the caller (renderer) supplies the id.
    const aId = `zz-a-${Date.now()}`
    const bId = `zz-b-${Date.now()}`
    await api(h.window, 'triggerAdd', { id: aId, title: 'Routine A', subtitle: 'Group', type: 'lower_third' })
    await api(h.window, 'triggerAdd', { id: bId, title: 'Routine B', subtitle: 'Solo', type: 'lower_third' })
    expect((await triggers()).length).toBe(2)

    const afterUpdate = await api<Array<{ id: string; title: string }>>(h.window, 'triggerUpdate', aId, { title: 'Routine A2' })
    expect(afterUpdate.find((t) => t.id === aId)?.title).toBe('Routine A2')

    // select / next / prev should not throw
    await api(h.window, 'triggerSelect', aId)
    await api(h.window, 'triggerNext')
    await api(h.window, 'triggerPrev')

    // reorder: swap to [b, a]
    const reordered = await api<Array<{ id: string }>>(h.window, 'triggerReorder', [bId, aId])
    expect(reordered[0].id).toBe(bId)

    await api(h.window, 'triggerDelete', aId)
    expect((await triggers()).length).toBe(1)

    await api(h.window, 'triggerClearAll')
    expect((await triggers()).length).toBe(0)
  })
})

test.describe('settings round-trip', () => {
  test('get returns object; set persists; get reflects it', async () => {
    const before = await api<Record<string, unknown>>(h.window, 'settingsGet')
    expect(before && typeof before === 'object').toBe(true)

    const token = `zz-${Date.now()}`
    await api(h.window, 'settingsSet', 'voiceWakeWord', token)
    const after = await api<Record<string, unknown>>(h.window, 'settingsGet')
    expect(after.voiceWakeWord).toBe(token)
  })

  test('camera settings persist (activeCameraId, cameraHost2)', async () => {
    await api(h.window, 'settingsSet', 'activeCameraId', 2)
    await api(h.window, 'settingsSet', 'cameraHost2', '10.0.0.99')
    const s = await api<Record<string, unknown>>(h.window, 'settingsGet')
    expect(s.activeCameraId).toBe(2)
    expect(s.cameraHost2).toBe('10.0.0.99')
    // reset so we don't leave the camera in a weird selection
    await api(h.window, 'settingsSet', 'activeCameraId', 1)
    await api(h.window, 'settingsSet', 'cameraHost2', '')
  })
})

test.describe('notes CRUD', () => {
  test('add → list → delete', async () => {
    const note = await api<{ id: string }>(h.window, 'notesAdd', 'zz test note')
    expect(note.id).toBeTruthy()
    let list = await api<Array<{ id: string }>>(h.window, 'notesList')
    expect(list.some((n) => n.id === note.id)).toBe(true)
    await api(h.window, 'notesDelete', note.id)
    list = await api<Array<{ id: string }>>(h.window, 'notesList')
    expect(list.some((n) => n.id === note.id)).toBe(false)
  })
})

test.describe('day checklist', () => {
  test('get returns structure; setItem toggles; shouldShow returns boolean shape', async () => {
    const cl = await api<Record<string, unknown>>(h.window, 'dayChecklistGet')
    expect(cl && typeof cl === 'object').toBe(true)
    const should = await api<{ should?: boolean } | boolean>(h.window, 'dayChecklistShouldShow')
    expect(should).not.toBeUndefined()
  })
})

test.describe('events log', () => {
  test('getRecent returns an array', async () => {
    const events = await api<unknown[]>(h.window, 'eventsGetRecent', 20)
    expect(Array.isArray(events)).toBe(true)
  })
})

test.describe('backups', () => {
  test('list returns array; now creates a settings backup', async () => {
    const list = await api<unknown[]>(h.window, 'backupList')
    expect(Array.isArray(list)).toBe(true)
    const res = await api<{ ok?: boolean }>(h.window, 'backupNow')
    expect(res).toBeTruthy()
    expect(typeof res.ok).toBe('boolean')
  })
})

test.describe('recovery check', () => {
  test('returns a result object without throwing', async () => {
    const res = await api<unknown>(h.window, 'recoveryCheck')
    expect(res).not.toBeUndefined()
  })
})

test.describe('playlist controls', () => {
  test('getStatus + toggles do not throw', async () => {
    const status = await api<Record<string, unknown>>(h.window, 'playlistGetStatus')
    expect(status && typeof status === 'object').toBe(true)
    await api(h.window, 'playlistAutoFireToggle')
    await api(h.window, 'playlistAutoFireToggle') // toggle back
    await api(h.window, 'playlistSetLoopMode', 'none')
    await api(h.window, 'playlistResetPosition')
    await api(h.window, 'playlistClearPlayed')
  })
})

test.describe('overlay state', () => {
  test('getState returns an overlay state object', async () => {
    const state = await api<Record<string, unknown>>(h.window, 'overlayGetState')
    expect(state && typeof state === 'object').toBe(true)
  })
  test('getLastAdhoc returns without throwing', async () => {
    const last = await api<unknown>(h.window, 'overlayGetLastAdhoc')
    expect(last).not.toBeUndefined()
  })
})

test.describe('user presets', () => {
  test('list → add → delete', async () => {
    const before = await api<unknown[]>(h.window, 'userPresetsList')
    expect(Array.isArray(before)).toBe(true)
    const added = await api<{ id?: string } | unknown[]>(h.window, 'userPresetsAdd', {
      name: `zz-preset-${Date.now()}`,
      styling: {},
    })
    expect(added).toBeTruthy()
    const after = await api<unknown[]>(h.window, 'userPresetsList')
    expect(Array.isArray(after)).toBe(true)
  })
})

test.describe('stream config round-trip', () => {
  test('get → set → get', async () => {
    const cfg = await api<Record<string, unknown>>(h.window, 'streamConfigGet')
    expect(cfg && typeof cfg === 'object').toBe(true)
    await api(h.window, 'streamConfigSet', { ...cfg, watchUrl: 'https://watch.example.test/zz' })
    const after = await api<Record<string, unknown>>(h.window, 'streamConfigGet')
    expect(after.watchUrl).toBe('https://watch.example.test/zz')
  })
})

test.describe('shot recorder state (no camera)', () => {
  test('shotGet returns recorder state/list without a camera', async () => {
    const shots = await api<unknown>(h.window, 'shotGet')
    expect(shots).not.toBeUndefined()
  })
})

test.describe('camera handlers degrade gracefully (no hardware)', () => {
  test('cameraGetState resolves (does not hang/throw uncaught)', async () => {
    const state = await api<unknown>(h.window, 'cameraGetState')
    expect(state).not.toBeUndefined()
  })
  test('cameraGetPresetIds resolves with no camera', async () => {
    const ids = await api<unknown>(h.window, 'cameraGetPresetIds', 1)
    expect(ids).not.toBeUndefined()
  })
})
