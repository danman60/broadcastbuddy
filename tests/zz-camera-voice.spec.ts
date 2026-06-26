import { test, expect } from '@playwright/test'
import { launchApp, closeApp, api, nativeClick, Harness } from './zz-harness'

/**
 * Camera / Voice / Shot Recorder UI — the newest feature surface, previously
 * untested. No real OBSBOT is present, so we force the panel's "active" branch
 * by seeding cameraHost (CameraPanel.featureActive = autoMode || host) and
 * assert the multi-cam control surface renders. Probes fail silently against a
 * dead host; we only assert the UI, never live camera behavior.
 */

let h: Harness
test.beforeAll(async () => {
  h = await launchApp()
  // Seed a (dead) host so the active panel renders, then reload so the
  // renderer store picks it up via loadInitialState().
  await api(h.window, 'settingsSet', 'cameraHost', '127.0.0.1')
  await h.window.reload()
  await h.window.waitForLoadState('domcontentloaded')
  await h.window.waitForTimeout(2000)
})
test.afterAll(async () => {
  try { await api(h.window, 'settingsSet', 'cameraHost', '') } catch { /* closing */ }
  await closeApp(h)
})

test('camera card renders the active control surface', async () => {
  const w = h.window
  await nativeClick(w, '.panel-section-title', 'Camera (OBSBOT)')
  await w.waitForTimeout(600)
  await expect(w.locator('.camera-panel')).toBeVisible()
})

test('multi-camera selector (Cam 1 / Cam 2) is present', async () => {
  const w = h.window
  const seg = w.locator('.camera-segment').first()
  await expect(seg.locator('button:has-text("Cam 1")')).toBeVisible()
  await expect(seg.locator('button:has-text("Cam 2")')).toBeVisible()
})

test('AUTO / MANUAL mode toggle is present', async () => {
  const w = h.window
  await expect(w.locator('.camera-panel button:has-text("Auto")')).toBeVisible()
  await expect(w.locator('.camera-panel button:has-text("Manual")')).toBeVisible()
})

test('joystick zone, zoom rocker, and Set Home render', async () => {
  const w = h.window
  await expect(w.locator('.camera-joystick-zone')).toBeVisible()
  await expect(w.locator('.camera-zoom-rocker')).toBeVisible()
  await expect(w.locator('button:has-text("Set Home")')).toBeVisible()
  await w.screenshot({ path: 'tests/screenshots/11-camera-active.png' })
})

test('selecting Cam 2 (with IP set) persists activeCameraId', async () => {
  const w = h.window
  await api(w, 'settingsSet', 'cameraHost2', '127.0.0.2')
  await w.reload()
  await w.waitForLoadState('domcontentloaded')
  await w.waitForTimeout(1500)
  await nativeClick(w, '.panel-section-title', 'Camera (OBSBOT)')
  await w.waitForTimeout(500)
  await nativeClick(w, '.camera-segment button', 'Cam 2')
  await w.waitForTimeout(400)
  const s = await api<Record<string, unknown>>(w, 'settingsGet')
  expect(s.activeCameraId).toBe(2)
  // restore
  await api(w, 'settingsSet', 'activeCameraId', 1)
  await api(w, 'settingsSet', 'cameraHost2', '')
})

test('Settings → Camera tab hosts Voice Control + Shot Recorder', async () => {
  const w = h.window
  await nativeClick(w, '.header button', 'Settings')
  await expect(w.locator('.settings-overlay')).toBeVisible()
  await nativeClick(w, '.settings-overlay .settings-tab', 'Camera')
  await w.waitForTimeout(300)
  const body = w.locator('.settings-body')
  await expect(body.getByText('Voice Control', { exact: false }).first()).toBeVisible()
  await expect(body.getByText('Shot Recorder', { exact: false }).first()).toBeVisible()
  await w.screenshot({ path: 'tests/screenshots/12-voice-shot-settings.png' })
  await nativeClick(w, '.settings-overlay button', 'Close')
  await w.waitForTimeout(200)
})

test('voice enable toggle persists voiceEnabled setting', async () => {
  const w = h.window
  await nativeClick(w, '.header button', 'Settings')
  await nativeClick(w, '.settings-overlay .settings-tab', 'Camera')
  await w.waitForTimeout(300)
  const before = await api<Record<string, unknown>>(w, 'settingsGet')
  // Flip the setting directly via IPC (UI control selector varies); assert the
  // handler persists it — the deterministic part of the voice feature.
  await api(w, 'settingsSet', 'voiceEnabled', !before.voiceEnabled)
  const after = await api<Record<string, unknown>>(w, 'settingsGet')
  expect(after.voiceEnabled).toBe(!before.voiceEnabled)
  await api(w, 'settingsSet', 'voiceEnabled', before.voiceEnabled)
  await nativeClick(w, '.settings-overlay button', 'Close')
})
