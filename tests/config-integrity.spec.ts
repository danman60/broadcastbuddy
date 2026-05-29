// Static config integrity (pure, no Electron). Catches real config-bug classes:
// a duplicate IPC channel value (two handlers → silent overwrite), a preset
// missing a required styling key (undefined CSS var in OBS — the exact class of
// the earlier animationDuration/animationEasing bug), and duplicate font entries.
import { test, expect } from '@playwright/test'
import { IPC } from '../src/shared/types'
import { PRESETS } from '../src/shared/presets'
import { FONTS, buildGoogleFontsUrl } from '../src/shared/fonts'

test('IPC channel values are unique and non-empty', () => {
  const values = Object.values(IPC)
  expect(values.length).toBeGreaterThan(0)
  for (const v of values) {
    expect(typeof v).toBe('string')
    expect((v as string).length).toBeGreaterThan(0)
  }
  // A duplicate value → ipcMain.handle collision (second silently wins).
  expect(new Set(values).size).toBe(values.length)
})

test('presets: unique ids + every styling carries the required keys', () => {
  const REQUIRED = [
    'fontFamily', 'fontSize', 'fontWeight', 'textColor', 'backgroundColor',
    'backgroundStyle', 'accentColor', 'borderRadius', 'animation',
    'animationDuration', 'animationEasing', 'autoHideSeconds',
  ]
  expect(PRESETS.length).toBeGreaterThan(0)
  const ids = PRESETS.map((p) => p.id)
  expect(new Set(ids).size).toBe(ids.length) // unique ids
  for (const p of PRESETS) {
    expect(typeof p.name).toBe('string')
    for (const key of REQUIRED) {
      expect(p.styling, `preset "${p.id}" missing styling.${key}`).toHaveProperty(key)
    }
  }
})

test('fonts: non-empty, well-formed, unique value + label', () => {
  expect(FONTS.length).toBeGreaterThan(0)
  for (const f of FONTS) {
    expect(typeof f.value).toBe('string')
    expect(f.value.length).toBeGreaterThan(0)
    expect(typeof f.label).toBe('string')
    expect(typeof f.google).toBe('boolean')
  }
  expect(new Set(FONTS.map((f) => f.value)).size).toBe(FONTS.length)
  expect(new Set(FONTS.map((f) => f.label)).size).toBe(FONTS.length)
})

test('buildGoogleFontsUrl returns a string', () => {
  expect(typeof buildGoogleFontsUrl()).toBe('string')
})
