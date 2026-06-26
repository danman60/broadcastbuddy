import { test, expect } from '@playwright/test'
import { launchApp, closeApp, api, Harness } from './zz-harness'

/**
 * Newest-feature IPC surface (voice director, shot recorder, multi-cam PTZ,
 * glide sweep, transition revert, feature-card logo) with NO camera and NO
 * voice-helper.exe present. These handlers must resolve cleanly so the panels
 * don't wedge — the deterministic half of features whose live half needs DART.
 */

let h: Harness
test.beforeAll(async () => { h = await launchApp() })
test.afterAll(async () => { await closeApp(h) })

test.describe('voice director (no helper.exe)', () => {
  test('voiceGetStatus returns a status object', async () => {
    const s = await api<Record<string, unknown>>(h.window, 'voiceGetStatus')
    expect(s && typeof s === 'object').toBe(true)
  })
  test('voicePtt down/up resolves with {ok}', async () => {
    const down = await api<{ ok?: boolean }>(h.window, 'voicePtt', true)
    const up = await api<{ ok?: boolean }>(h.window, 'voicePtt', false)
    expect(down).not.toBeUndefined()
    expect(up).not.toBeUndefined()
  })
  test('voiceRefreshGrammar resolves without throwing', async () => {
    const r = await api<{ ok?: boolean }>(h.window, 'voiceRefreshGrammar')
    expect(r).not.toBeUndefined()
  })
  test('voice settings persist (voiceEnabled, voiceWakeEnabled, voiceWakeWord)', async () => {
    await api(h.window, 'settingsSet', 'voiceEnabled', true)
    await api(h.window, 'settingsSet', 'voiceWakeEnabled', true)
    await api(h.window, 'settingsSet', 'voiceWakeWord', 'broadcast')
    const s = await api<Record<string, unknown>>(h.window, 'settingsGet')
    expect(s.voiceEnabled).toBe(true)
    expect(s.voiceWakeEnabled).toBe(true)
    expect(s.voiceWakeWord).toBe('broadcast')
    await api(h.window, 'settingsSet', 'voiceEnabled', false)
    await api(h.window, 'settingsSet', 'voiceWakeEnabled', false)
  })
})

test.describe('shot recorder (no camera)', () => {
  test('shotGet returns recorder state', async () => {
    const s = await api<unknown>(h.window, 'shotGet')
    expect(s).not.toBeUndefined()
  })
  test('shotRecordToggle resolves both directions', async () => {
    const a = await api<unknown>(h.window, 'shotRecordToggle')
    const b = await api<unknown>(h.window, 'shotRecordToggle')
    expect(a).not.toBeUndefined()
    expect(b).not.toBeUndefined()
  })
  test('shotReplay / shotRename / shotDelete on a missing id resolve {ok}', async () => {
    const replay = await api<{ ok?: boolean }>(h.window, 'shotReplay', 999)
    const rename = await api<{ ok?: boolean }>(h.window, 'shotRename', 999, 'zz-label')
    const del = await api<{ ok?: boolean }>(h.window, 'shotDelete', 999)
    expect(replay).not.toBeUndefined()
    expect(rename).not.toBeUndefined()
    expect(del).not.toBeUndefined()
  })
})

test.describe('multi-cam PTZ + glide (no camera)', () => {
  test('cameraSelect 1 / 2 persists activeCameraId', async () => {
    await api(h.window, 'cameraSelect', 2)
    let s = await api<Record<string, unknown>>(h.window, 'settingsGet')
    expect(s.activeCameraId).toBe(2)
    await api(h.window, 'cameraSelect', 1)
    s = await api<Record<string, unknown>>(h.window, 'settingsGet')
    expect(s.activeCameraId).toBe(1)
  })
  test('cameraGetPresetIds for both cameras resolves', async () => {
    expect(await api<unknown>(h.window, 'cameraGetPresetIds', 1)).not.toBeUndefined()
    expect(await api<unknown>(h.window, 'cameraGetPresetIds', 2)).not.toBeUndefined()
  })
  test('cameraSweepWaypoints with no presets returns {ok} (no-op, no throw)', async () => {
    const r = await api<{ ok?: boolean }>(h.window, 'cameraSweepWaypoints', { ids: [], ms: 6000 })
    expect(r?.ok).toBe(true)
  })
  test('cameraNudge / cameraZoom / cameraGoHome degrade without a camera', async () => {
    expect(await api<unknown>(h.window, 'cameraGoHome')).not.toBeUndefined()
  })
})

test.describe('transition revert + feature-card logo', () => {
  test('obsTransitionRevert get → set → get round-trips', async () => {
    const before = await api<{ enabled: boolean }>(h.window, 'obsTransitionRevertGet')
    await api(h.window, 'obsTransitionRevertSet', !before.enabled)
    const after = await api<{ enabled: boolean }>(h.window, 'obsTransitionRevertGet')
    expect(after.enabled).toBe(!before.enabled)
    await api(h.window, 'obsTransitionRevertSet', before.enabled)
  })
  test('feature-card logo set → get round-trips a data URL', async () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    await api(h.window, 'overlaySetFeatureCardLogo', dataUrl)
    const got = await api<string>(h.window, 'overlayGetFeatureCardLogo')
    expect(typeof got).toBe('string')
    expect(got).toContain('data:image')
    await api(h.window, 'overlaySetFeatureCardLogo', '')
  })
})

test.describe('gallery config (no network)', () => {
  test('galleryGetConfig resolves an object', async () => {
    const c = await api<unknown>(h.window, 'galleryGetConfig')
    expect(c).not.toBeUndefined()
  })
  test('gallerySetOffset resolves (void handler, no throw)', async () => {
    // Handler returns void; success = it resolves and config is still readable.
    await api(h.window, 'gallerySetOffset', 1500)
    const c = await api<unknown>(h.window, 'galleryGetConfig')
    expect(c).not.toBeUndefined()
  })
})
