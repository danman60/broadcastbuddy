// Config-integrity for the operator day-checklist item definitions (pure, no
// Electron). Duplicate ids within a kind would collide in the persisted state
// map (keyed by date|kind|itemId) — so uniqueness is a real correctness check.
import { test, expect } from '@playwright/test'
import { getItems, getItemsForKind } from '../src/main/services/dayChecklistItems'

for (const kind of ['start', 'end'] as const) {
  test(`${kind} checklist: non-empty, well-formed, unique ids`, () => {
    const items = getItemsForKind(kind)
    expect(items.length).toBeGreaterThan(0)
    for (const it of items) {
      expect(typeof it.id).toBe('string')
      expect(it.id.length).toBeGreaterThan(0)
      expect(typeof it.label).toBe('string')
      expect(it.label.length).toBeGreaterThan(0)
    }
    const ids = items.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length) // no duplicate ids within the kind
  })
}

test('getItems() returns both lists matching getItemsForKind', () => {
  const all = getItems()
  expect(all.start).toEqual(getItemsForKind('start'))
  expect(all.end).toEqual(getItemsForKind('end'))
})
