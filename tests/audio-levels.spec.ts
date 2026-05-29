// Pure unit test for the audio-meter dBFS conversions — no Electron needed.
import { test, expect } from '@playwright/test'
import { mulToDb, dBToPercent, dBToClass, formatDB } from '../src/shared/audioLevels'

test('mulToDb: magnitude → dBFS', () => {
  expect(mulToDb(1)).toBeCloseTo(0, 5) // full scale
  expect(mulToDb(0)).toBe(-Infinity) // silence → floor
  expect(mulToDb(-0.1)).toBe(-Infinity) // negative guarded
  expect(mulToDb(0.5)).toBeCloseTo(-6.0206, 2) // half ≈ -6 dB
  expect(mulToDb(0.1)).toBeCloseTo(-20, 2)
})

test('dBToPercent: dBFS → bar width with -60 floor / 0 ceiling', () => {
  expect(dBToPercent(0)).toBe(100)
  expect(dBToPercent(-60)).toBe(0)
  expect(dBToPercent(-30)).toBe(50)
  expect(dBToPercent(-90)).toBe(0) // below floor clamps to 0
  expect(dBToPercent(5)).toBe(100) // above 0 clamps to 100
  expect(dBToPercent(-Infinity)).toBe(0)
})

test('dBToClass: colour thresholds', () => {
  expect(dBToClass(-Infinity)).toBe('silent')
  expect(dBToClass(-60)).toBe('silent')
  expect(dBToClass(-3)).toBe('hot') // > -6
  expect(dBToClass(0)).toBe('hot')
  expect(dBToClass(-6)).toBe('medium') // boundary: not > -6, but > -12
  expect(dBToClass(-9)).toBe('medium')
  expect(dBToClass(-12)).toBe('good') // boundary: not > -12
  expect(dBToClass(-30)).toBe('good')
})

test('formatDB: rounds, -inf at floor', () => {
  expect(formatDB(-60)).toBe('-inf')
  expect(formatDB(-Infinity)).toBe('-inf')
  expect(formatDB(-6.4)).toBe('-6 dB')
  expect(formatDB(0)).toBe('0 dB')
})
