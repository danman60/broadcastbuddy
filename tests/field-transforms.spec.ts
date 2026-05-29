// Pure unit test for the document-import field transforms — no Electron.
import { test, expect } from '@playwright/test'
import { applyFieldMapping } from '../src/shared/fieldTransforms'
import type { FieldMapping, TransformType } from '../src/shared/types'

function map(sourceIds: string[], type: TransformType, params: Record<string, unknown> = {}): FieldMapping {
  return { sourceIds, targetId: 'title', transform: { type, params } }
}

const row = { first: 'John', last: 'Doe', full: 'John Q Doe', long: 'A very long studio name here' }

test('empty / missing sources → empty string', () => {
  expect(applyFieldMapping({}, map(['nope'], 'none'))).toBe('')
  expect(applyFieldMapping(row, map([], 'concat'))).toBe('')
})

test('concat joins present values with the separator (empties dropped)', () => {
  expect(applyFieldMapping(row, map(['first', 'last'], 'concat', { separator: ' ' }))).toBe('John Doe')
  expect(applyFieldMapping(row, map(['first', 'last'], 'concat', { separator: ', ' }))).toBe('John, Doe')
  // missing middle value is filtered out — no doubled/empty separator
  expect(applyFieldMapping(row, map(['first', 'missing', 'last'], 'concat', { separator: '-' }))).toBe('John-Doe')
  expect(applyFieldMapping(row, map(['first', 'last'], 'concat'))).toBe('John Doe') // default sep = space
})

test('format substitutes {n}, out-of-range index → empty token', () => {
  expect(applyFieldMapping(row, map(['first', 'last'], 'format', { template: '{1}, {0}' }))).toBe('Doe, John')
  expect(applyFieldMapping(row, map(['first'], 'format', { template: '{0} {5}' }))).toBe('John ') // {5} → ''
  expect(applyFieldMapping(row, map(['first'], 'format'))).toBe('John') // default template {0}
})

test('extract truncates to maxLength', () => {
  expect(applyFieldMapping(row, map(['long'], 'extract', { maxLength: 6 }))).toBe('A very')
  expect(applyFieldMapping(row, map(['first'], 'extract', { maxLength: 100 }))).toBe('John') // shorter than max
  expect(applyFieldMapping(row, map(['long'], 'extract'))).toBe('A very long studio name here'.slice(0, 50))
})

test('split picks the part by index, out-of-range → empty', () => {
  expect(applyFieldMapping(row, map(['full'], 'split', { delimiter: ' ', part: 0 }))).toBe('John')
  expect(applyFieldMapping(row, map(['full'], 'split', { delimiter: ' ', part: 2 }))).toBe('Doe')
  expect(applyFieldMapping(row, map(['full'], 'split', { delimiter: ' ', part: 9 }))).toBe('') // out of range
})

test('none / default returns the first value', () => {
  expect(applyFieldMapping(row, map(['first', 'last'], 'none'))).toBe('John')
})
