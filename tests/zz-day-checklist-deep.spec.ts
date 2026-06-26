import { test, expect } from '@playwright/test'
import { launchApp, closeApp, api, Harness } from './zz-harness'

/**
 * Day checklist lifecycle (start + end). The operator's pre/post-show ritual:
 * each item toggles independently, the whole list dismisses and reopens, and
 * shouldShow reflects whether today's start checklist still needs showing.
 */

let h: Harness
test.beforeAll(async () => { h = await launchApp() })
test.afterAll(async () => { await closeApp(h) })

const DATE = '2026-06-26'

for (const kind of ['start', 'end'] as const) {
  test(`${kind}-of-day checklist: get → toggle item → verify state`, async () => {
    const view = await api<{ kind: string; items: Array<{ id: string }>; state: { items?: Record<string, string> } }>(
      h.window, 'dayChecklistGet', DATE, kind,
    )
    expect(view.kind).toBe(kind)
    expect(Array.isArray(view.items)).toBe(true)
    expect(view.items.length).toBeGreaterThan(0)

    const id = view.items[0].id
    const checked = await api<{ state: { items: Record<string, string> } }>(h.window, 'dayChecklistSetItem', DATE, kind, id, 'checked')
    expect(checked.state.items[id]).toBe('checked')

    // Toggle a second state if one exists (e.g. 'na'/'unchecked').
    const unchecked = await api<{ state: { items: Record<string, string> } }>(h.window, 'dayChecklistSetItem', DATE, kind, id, 'unchecked')
    expect(unchecked.state.items[id]).toBe('unchecked')
  })

  test(`${kind}-of-day checklist: dismiss marks the day dismissed`, async () => {
    const dismissed = await api<{ state: Record<string, unknown> }>(h.window, 'dayChecklistDismiss', DATE, kind)
    expect(dismissed.state).toBeTruthy()
  })

  test(`${kind}-of-day checklist: reopen returns a fresh view for today`, async () => {
    const view = await api<{ kind: string; items: unknown[] }>(h.window, 'dayChecklistReopen', kind)
    expect(view.kind).toBe(kind)
    expect(Array.isArray(view.items)).toBe(true)
  })
}

test('dayChecklistShouldShow returns a defined result', async () => {
  const should = await api<{ should?: boolean } | boolean>(h.window, 'dayChecklistShouldShow')
  expect(should).not.toBeUndefined()
})

test('independent items do not clobber each other', async () => {
  const view = await api<{ items: Array<{ id: string }> }>(h.window, 'dayChecklistGet', DATE, 'start')
  if (view.items.length < 2) test.skip()
  const [a, b] = view.items
  await api(h.window, 'dayChecklistSetItem', DATE, 'start', a.id, 'checked')
  const after = await api<{ state: { items: Record<string, string> } }>(h.window, 'dayChecklistSetItem', DATE, 'start', b.id, 'checked')
  expect(after.state.items[a.id]).toBe('checked')
  expect(after.state.items[b.id]).toBe('checked')
})
