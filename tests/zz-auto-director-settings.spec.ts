import { test, expect } from '@playwright/test'
import { launchApp, closeApp, api, nativeClick, Harness } from './zz-harness'
import type { Locator } from '@playwright/test'

// The Start-of-Day checklist dialog sits over Settings at launch and intercepts
// pointer events, so buttons are clicked through the DOM (see zz-harness nativeClick).
const tap = (l: Locator) => l.evaluate((el) => (el as HTMLElement).click())

/**
 * Settings → Camera → Auto Director matrix. Runs against a throwaway OBS on
 * 127.0.0.1:4455 (no auth) when one is listening; the connected assertions are
 * skipped otherwise. Screenshots go to SHOT_DIR (default tests/screenshots).
 */

const SHOT_DIR = process.env.SHOT_DIR || 'tests/screenshots'
const OBS_HOST = process.env.OBS_HOST || '127.0.0.1'
const OBS_PORT = Number(process.env.OBS_PORT || 4455)

let h: Harness
let obsUp = false
const consoleErrors: string[] = []
test.setTimeout(120000)
test.beforeAll(async () => {
  h = await launchApp()
  h.window.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`${m.type()}: ${m.text()}`) })
  // Tall window so the whole matrix fits one element screenshot (xvfb screen must be taller).
  await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 1500))
  // Dismiss the Start-of-Day checklist dialog so it doesn't sit over Settings.
  await nativeClick(h.window, '.settings-overlay:not([aria-label="Settings"]) button', 'Done')
  await h.window.waitForTimeout(300)
  const r = await api<{ connected: boolean }>(h.window, 'obsConnect', OBS_HOST, OBS_PORT, undefined)
  obsUp = r.connected
})
test.afterAll(async () => {
  await closeApp(h)
  expect(consoleErrors, 'renderer console errors/warnings').toEqual([])
})

async function openAutoDirector() {
  const w = h.window
  await nativeClick(w, '.header button', 'Settings')
  await expect(w.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await nativeClick(w, '.settings-overlay[aria-label="Settings"] .settings-tab', 'Camera')
  await w.waitForTimeout(700) // obsSceneNames/obsTransitionNames round-trip
  const group = w.locator('.settings-group', { has: w.locator('.ad-block') })
  await group.scrollIntoViewIfNeeded()
  return group
}

test('connected: scenes listed, controls edit, values persist after save', async () => {
  test.skip(!obsUp, 'no throwaway OBS on 4455')
  const w = h.window
  const group = await openAutoDirector()
  await expect(group.getByRole('switch', { name: 'Cam1 in rotation' })).toBeVisible()
  await group.screenshot({ path: `${SHOT_DIR}/settings-ad-connected-initial.png` })

  // Every control he had: in rotation, how often, per-scene min/max/transition,
  // order, default min/max, default transition, transition ms, beat snap.
  for (const n of ['Cam1', 'Cam2', 'Cam3', 'StartingSoon']) await tap(group.getByRole('switch', { name: `${n} in rotation` }))
  await tap(group.getByRole('switch', { name: 'StartingSoon in rotation' })) // back off
  await tap(group.getByRole('button', { name: 'Weighted random' }))
  await tap(group.getByRole('radiogroup', { name: 'Cam1 how often' }).getByRole('button', { name: 'Often' }))
  await tap(group.getByRole('radiogroup', { name: 'Cam3 how often' }).getByRole('button', { name: 'Rarely' }))
  await group.getByLabel('Cam2 min seconds').fill('8')
  await group.getByLabel('Cam2 max seconds').fill('20')
  await group.getByLabel('Cam2 transition').selectOption('Fade')
  await group.getByLabel('Default min seconds').fill('5')
  await group.getByLabel('Default max seconds').fill('12')
  await group.getByLabel('Default transition').selectOption('Cut')
  await group.getByLabel('Transition length ms').fill('250')
  await tap(group.getByRole('switch', { name: 'Snap cuts to the beat' }))
  await expect(group.locator('.ad-pill')).toHaveCount(3)
  await expect(group.locator('.ad-pill').first()).toContainText('Cam1')
  await expect(group.locator('.ad-pill').first()).toContainText('50%') // 3 of 3+2+1
  await group.screenshot({ path: `${SHOT_DIR}/settings-ad-connected-weighted.png` })
  await w.screenshot({ path: `${SHOT_DIR}/settings-ad-connected-window.png` })

  await nativeClick(w, '.settings-overlay[aria-label="Settings"] .btn-primary', 'Save Settings')
  await expect(w.getByRole('dialog', { name: 'Settings' })).toBeHidden({ timeout: 20000 })
  const s = await api<{ autoDirector: Record<string, unknown> }>(w, 'settingsGet')
  expect(s.autoDirector).toEqual({
    scenes: ['Cam1', 'Cam2', 'Cam3'],
    minShotSec: 5,
    maxShotSec: 12,
    sceneTimes: { Cam1: { weight: 3 }, Cam3: { weight: 1 }, Cam2: { min: 8, max: 20, transition: 'Fade' } },
    order: 'weighted',
    transition: 'Cut',
    transitionMs: 250,
    beatSnap: false,
  })

  // Reopen: the UI reads the saved values back.
  const again = await openAutoDirector()
  await expect(again.getByRole('button', { name: 'Weighted random' })).toHaveAttribute('aria-pressed', 'true')
  await expect(again.getByRole('switch', { name: 'Cam2 in rotation' })).toHaveAttribute('aria-checked', 'true')
  await expect(again.getByRole('switch', { name: 'StartingSoon in rotation' })).toHaveAttribute('aria-checked', 'false')
  await expect(again.getByLabel('Cam2 min seconds')).toHaveValue('8')
  await expect(again.getByLabel('Transition length ms')).toHaveValue('250')
  await expect(again.getByRole('switch', { name: 'Snap cuts to the beat' })).toHaveAttribute('aria-checked', 'false')
  await tap(again.getByRole('button', { name: 'In order' }))
  await expect(again.locator('.ad-arrow')).toHaveCount(3) // 2 arrows + loop
  await again.screenshot({ path: `${SHOT_DIR}/settings-ad-connected-sequence.png` })
  await nativeClick(w, '.settings-overlay[aria-label="Settings"] button', 'Close')
})

test('disconnected: explanatory empty state, saved rotation still shown, defaults editable', async () => {
  const w = h.window
  if (obsUp) await api(w, 'obsDisconnect')
  await w.waitForTimeout(300)
  const group = await openAutoDirector()
  await expect(group.locator('.ad-empty')).toContainText("OBS isn't connected")
  await expect(group.getByLabel('Default min seconds')).toBeVisible()
  await expect(group.getByRole('switch', { name: 'Snap cuts to the beat' })).toBeVisible()
  if (obsUp) await expect(group.locator('.ad-pill')).toHaveCount(3) // rotation saved above survives
  await group.screenshot({ path: `${SHOT_DIR}/settings-ad-disconnected.png` })
  await nativeClick(w, '.settings-overlay[aria-label="Settings"] button', 'Close')
})
