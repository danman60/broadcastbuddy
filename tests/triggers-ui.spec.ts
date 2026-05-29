import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'
import type { Trigger } from '../src/shared/types'

// Trigger CRUD + reorder + selection through BOTH the renderer UI
// (TriggerList / TriggerEditor DOM) and the IPC bridge (window.api.*).
//
// Hard assertions lean on IPC (window.api.triggerList / overlayGetState) which
// are the source of truth; DOM assertions confirm the renderer reflects state.
// Launch pattern mirrors tests/app.spec.ts exactly.

let app: ElectronApplication
let window: Page

test.beforeAll(async () => {
  app = await electron.launch({
    args: [
      path.join(__dirname, '..'),
      '--disable-gpu',
      '--no-sandbox',
    ],
    env: {
      ...process.env,
      NODE_ENV: 'production',
    },
  })
  window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  // Give the renderer a moment to hydrate.
  await window.waitForTimeout(1500)

  // Clean slate — clear any persisted/leftover triggers.
  await window.evaluate(async () => {
    await window.api.triggerClearAll()
  })
  await window.waitForTimeout(300)
})

test.afterAll(async () => {
  // Best-effort cleanup so we don't leave triggers behind for other suites.
  if (window) {
    await window.evaluate(async () => {
      await window.api.triggerClearAll()
    }).catch(() => {})
  }
  if (app) await app.close()
})

// Helper: read the authoritative trigger list via IPC.
async function listTriggers(): Promise<{ triggers: Trigger[]; selectedIndex: number }> {
  return window.evaluate(async () => window.api.triggerList())
}

// ── Tests ────────────────────────────────────────────────────────

test('trigger list starts empty (IPC + DOM)', async () => {
  const result = await listTriggers()
  expect(Array.isArray(result.triggers)).toBe(true)
  expect(result.triggers.length).toBe(0)

  // DOM: TriggerList renders the empty-state placeholder.
  const empty = window.locator('.trigger-list-empty')
  await expect(empty).toBeVisible()
})

test('add a trigger via the UI "+ Add" button', async () => {
  const addBtn = window.locator('.trigger-list-header button:has-text("Add")')
  await expect(addBtn).toBeVisible()
  await addBtn.click()
  await window.waitForTimeout(400)

  // IPC is the source of truth: exactly one trigger now exists.
  const result = await listTriggers()
  expect(result.triggers.length).toBe(1)
  // handleAdd seeds name as `Trigger {n}` (n = prior length + 1) → "Trigger 1".
  expect(result.triggers[0].name).toBe('Trigger 1')

  // DOM: a selectable trigger item is rendered with that name.
  const item = window.locator('.trigger-item').first()
  await expect(item).toBeVisible()
  await expect(item.locator('.trigger-item-name')).toHaveText('Trigger 1')
})

test('select the trigger via UI click → overlay reflects selection', async () => {
  // Ensure the trigger from the previous test still exists; add if running solo.
  let result = await listTriggers()
  if (result.triggers.length === 0) {
    await window.locator('.trigger-list-header button:has-text("Add")').click()
    await window.waitForTimeout(400)
    result = await listTriggers()
  }

  const item = window.locator('.trigger-item').first()
  await item.click()
  await window.waitForTimeout(400)

  // IPC: selectedIndex points at the first entry.
  result = await listTriggers()
  expect(result.selectedIndex).toBe(0)

  // DOM: the item carries the .selected class and the editor opens for it.
  await expect(item).toHaveClass(/selected/)
  const editor = window.locator('.trigger-editor')
  await expect(editor).toBeVisible()
})

test('edit trigger fields in the TriggerEditor → IPC reflects edits', async () => {
  // Make sure something is selected.
  let result = await listTriggers()
  if (result.triggers.length === 0) {
    await window.locator('.trigger-list-header button:has-text("Add")').click()
    await window.waitForTimeout(400)
  }
  await window.locator('.trigger-item').first().click()
  await window.waitForTimeout(300)

  const editor = window.locator('.trigger-editor')
  await expect(editor).toBeVisible()

  // Confirmed placeholders from TriggerEditor.tsx.
  const nameInput = editor.locator('input[placeholder="Display name..."]')
  const primaryInput = editor.locator('input[placeholder="Song name, speaker name, act title..."]')
  const secondaryInput = editor.locator('input[placeholder="Dancers, company/role, description..."]')

  await nameInput.fill('Edited Speaker')
  await window.waitForTimeout(200)
  await primaryInput.fill('Jane Doe')
  await window.waitForTimeout(200)
  await secondaryInput.fill('Keynote, ExampleCo')
  await window.waitForTimeout(300)

  // IPC: the edited fields persisted to the trigger model.
  result = await listTriggers()
  const t = result.triggers[result.selectedIndex >= 0 ? result.selectedIndex : 0]
  expect(t.name).toBe('Edited Speaker')
  expect(t.title).toBe('Jane Doe')
  expect(t.subtitle).toBe('Keynote, ExampleCo')

  // DOM: the list item name updates to the new name.
  await expect(window.locator('.trigger-item').first().locator('.trigger-item-name'))
    .toHaveText('Edited Speaker')
})

test('firing the selected trigger pushes its fields into overlay state', async () => {
  // Ensure a trigger is selected (re-add + edit if running this test alone).
  let result = await listTriggers()
  if (result.triggers.length === 0) {
    await window.evaluate(async () => {
      await window.api.triggerAdd({
        id: 'ui-fire-seed', name: 'Edited Speaker', title: 'Jane Doe',
        subtitle: 'Keynote, ExampleCo', category: '', order: 0, logoDataUrl: '',
      })
      await window.api.triggerSelect(0)
    })
    await window.waitForTimeout(300)
    result = await listTriggers()
  } else {
    await window.evaluate(async () => window.api.triggerSelect(0))
    await window.waitForTimeout(200)
  }

  await window.evaluate(async () => window.api.overlayFireLT())
  await window.waitForTimeout(400)

  const state = await window.evaluate(async () => window.api.overlayGetState())
  expect(state.lowerThird.visible).toBe(true)
  expect(state.lowerThird.title).toBe('Jane Doe')

  // Hide again to leave overlay clean.
  await window.evaluate(async () => window.api.overlayHideLT())
  await window.waitForTimeout(200)
  const after = await window.evaluate(async () => window.api.overlayGetState())
  expect(after.lowerThird.visible).toBe(false)
})

test('reorder triggers via IPC → DOM list order updates', async () => {
  // Reset to a known set of three named triggers.
  await window.evaluate(async () => {
    await window.api.triggerClearAll()
    await window.api.triggerAdd({ id: 'ord-a', name: 'Alpha', title: 'A', subtitle: '', category: '', order: 0, logoDataUrl: '' })
    await window.api.triggerAdd({ id: 'ord-b', name: 'Bravo', title: 'B', subtitle: '', category: '', order: 1, logoDataUrl: '' })
    await window.api.triggerAdd({ id: 'ord-c', name: 'Charlie', title: 'C', subtitle: '', category: '', order: 2, logoDataUrl: '' })
  })
  await window.waitForTimeout(400)

  // Sanity: initial order in DOM.
  await expect(window.locator('.trigger-item').nth(0).locator('.trigger-item-name')).toHaveText('Alpha')

  // Move Charlie to the front via IPC (same op the drag-drop handler performs).
  const reordered = await window.evaluate(async () =>
    window.api.triggerReorder(['ord-c', 'ord-a', 'ord-b'])
  )
  expect(reordered.map((t) => t.id)).toEqual(['ord-c', 'ord-a', 'ord-b'])
  await window.waitForTimeout(400)

  // DOM reflects the new order.
  const names = await window.locator('.trigger-item .trigger-item-name').allTextContents()
  expect(names).toEqual(['Charlie', 'Alpha', 'Bravo'])
})

test('delete a trigger via the UI delete button', async () => {
  // Ensure the three-trigger set exists (re-seed if running solo).
  let result = await listTriggers()
  if (result.triggers.length < 1) {
    await window.evaluate(async () => {
      await window.api.triggerAdd({ id: 'del-a', name: 'DelAlpha', title: 'A', subtitle: '', category: '', order: 0, logoDataUrl: '' })
    })
    await window.waitForTimeout(300)
    result = await listTriggers()
  }
  const before = result.triggers.length

  // Click the first item's delete button (text "x").
  const firstDelete = window.locator('.trigger-item').first().locator('.trigger-item-delete')
  await expect(firstDelete).toBeVisible()
  await firstDelete.click()
  await window.waitForTimeout(400)

  result = await listTriggers()
  expect(result.triggers.length).toBe(before - 1)
})

test('clearAll empties triggers (IPC + DOM empty state)', async () => {
  await window.evaluate(async () => window.api.triggerClearAll())
  await window.waitForTimeout(400)

  const result = await listTriggers()
  expect(result.triggers.length).toBe(0)

  // DOM: empty-state placeholder returns; editor shows the no-selection state.
  await expect(window.locator('.trigger-list-empty')).toBeVisible()
  await expect(window.locator('.trigger-editor-empty')).toBeVisible()
})
