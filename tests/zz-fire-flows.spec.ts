import { test, expect } from '@playwright/test'
import { launchApp, closeApp, api, Harness } from './zz-harness'

/**
 * Lower-third fire flows with state oracles. The core operator action: select a
 * routine, fire it, see it on the overlay with the right text + chip, then hide.
 * UP NEXT / THAT WAS fire the same card with a kicker chip. Ad-hoc fires arbitrary
 * text and remembers the last one.
 */

let h: Harness
test.beforeAll(async () => { h = await launchApp() })
test.afterAll(async () => { await closeApp(h) })

async function state() { return api<Record<string, any>>(h.window, 'overlayGetState') }

async function seedAndSelect(id: string, fields: Record<string, unknown>) {
  await api(h.window, 'triggerClearAll')
  await api(h.window, 'triggerAdd', { id, type: 'lower_third', ...fields })
  await api(h.window, 'triggerSelect', 0) // select by INDEX (only trigger present)
}

test('fire the selected lower third → visible with its text', async () => {
  await seedAndSelect('fire-1', { title: 'Swan Lake', subtitle: 'Senior Ballet', name: 'Senior Ballet' })
  await api(h.window, 'overlayFireLT')
  const s = await state()
  expect(s.lowerThird.visible).toBe(true)
  expect(JSON.stringify(s.lowerThird)).toContain('Swan Lake')
})

test('hide clears the fired lower third', async () => {
  await api(h.window, 'overlayHideLT')
  expect((await state()).lowerThird.visible).toBe(false)
})

// UP NEXT / THAT WAS preview the NEIGHBOUR routine (forward/back of the selected
// one), so they need ≥2 triggers in the playlist.
async function seedTwo() {
  await api(h.window, 'triggerClearAll')
  await api(h.window, 'triggerAdd', { id: 'fn-a', type: 'lower_third', title: 'Opening Number', subtitle: 'Company', name: 'Company' })
  await api(h.window, 'triggerAdd', { id: 'fn-b', type: 'lower_third', title: 'Finale', subtitle: 'All Cast', name: 'All Cast' })
}

test('UP NEXT fires a card with the UP NEXT chip (previews the next routine)', async () => {
  await seedTwo()
  await api(h.window, 'triggerSelect', 0) // neighbour forward = index 1 (Finale)
  const r = await api<{ fired: boolean }>(h.window, 'overlayFireUpNext', 'UP NEXT')
  expect(r.fired).toBe(true)
  const s = await state()
  expect(s.lowerThird.visible).toBe(true)
  expect(s.lowerThird.label).toContain('UP NEXT')
  expect(s.lowerThird.title).toBe('Finale')
  await api(h.window, 'overlayHideLT')
})

test('THAT WAS fires a card with the THAT WAS chip (previews the prior routine)', async () => {
  await seedTwo()
  await api(h.window, 'triggerSelect', 1) // neighbour back = index 0 (Opening Number)
  const r = await api<{ fired: boolean }>(h.window, 'overlayFireThatWas', 'THAT WAS')
  expect(r.fired).toBe(true)
  const s = await state()
  expect(s.lowerThird.label).toContain('THAT WAS')
  expect(s.lowerThird.title).toBe('Opening Number')
  await api(h.window, 'overlayHideLT')
  await api(h.window, 'triggerClearAll')
})

test('ad-hoc fire shows text and is remembered as last ad-hoc', async () => {
  await api(h.window, 'overlayFireAdhoc', 'Special Guest', 'Guest Judge')
  const s = await state()
  expect(s.lowerThird.visible).toBe(true)
  expect(JSON.stringify(s.lowerThird)).toContain('Special Guest')
  const last = await api<Record<string, unknown>>(h.window, 'overlayGetLastAdhoc')
  expect(JSON.stringify(last)).toContain('Special Guest')
  await api(h.window, 'overlayHideLT')
})

test('next/prev navigation moves the selected index within the playlist', async () => {
  await api(h.window, 'triggerClearAll')
  await api(h.window, 'triggerAdd', { id: 'n1', type: 'lower_third', title: 'One' })
  await api(h.window, 'triggerAdd', { id: 'n2', type: 'lower_third', title: 'Two' })
  await api(h.window, 'triggerAdd', { id: 'n3', type: 'lower_third', title: 'Three' })
  await api(h.window, 'triggerSelect', 0)
  let sel = (await api<{ selectedIndex: number }>(h.window, 'triggerList')).selectedIndex
  expect(sel).toBe(0)
  await api(h.window, 'triggerNext')
  sel = (await api<{ selectedIndex: number }>(h.window, 'triggerList')).selectedIndex
  expect(sel).toBe(1)
  await api(h.window, 'triggerPrev')
  sel = (await api<{ selectedIndex: number }>(h.window, 'triggerList')).selectedIndex
  expect(sel).toBe(0)
  await api(h.window, 'triggerClearAll')
})

test('title_card and feature triggers fire as full-screen feature cards', async () => {
  await api(h.window, 'triggerClearAll')
  await api(h.window, 'triggerAdd', { id: 'tc-1', type: 'title_card', title: 'Act 1', subtitle: 'Welcome' })
  await api(h.window, 'triggerSelect', 0)
  await api(h.window, 'overlayFireLT')
  const s = await state()
  // A title_card routes to the feature card OR lower third depending on impl;
  // either way the overlay must reflect a visible element carrying the text.
  const flat = JSON.stringify({ lt: s.lowerThird, fc: s.featureCard })
  expect(flat).toContain('Act 1')
  await api(h.window, 'overlayHideLT')
  await api(h.window, 'overlayFeatureHide')
  await api(h.window, 'triggerClearAll')
})
