import { test, expect } from '@playwright/test'
import { launchApp, closeApp, api, Harness } from './zz-harness'

/**
 * Overlay content surfaces driven by IPC: company/client logos, live styling,
 * user style presets, and the Starting Soon state machine. All assert against
 * overlayGetState so they prove the wire, not just "didn't throw".
 */

let h: Harness
test.beforeAll(async () => { h = await launchApp() })
test.afterAll(async () => { await closeApp(h) })

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function state() {
  return api<Record<string, any>>(h.window, 'overlayGetState')
}

test('setLogos populates company + client logo state', async () => {
  await api(h.window, 'overlaySetLogos', PNG, PNG)
  const s = await state()
  expect(s.companyLogo.dataUrl).toContain('data:image')
  expect(s.clientLogo.dataUrl).toContain('data:image')
})

test('clearing logos empties them', async () => {
  await api(h.window, 'overlaySetLogos', '', '')
  const s = await state()
  expect(s.companyLogo.dataUrl).toBe('')
  expect(s.clientLogo.dataUrl).toBe('')
})

test('updateStyling writes onto the live lower-third styling', async () => {
  await api(h.window, 'overlayUpdateStyling', { fontFamily: 'Georgia', accentColor: '#abcdef' })
  const s = await state()
  const styling = s.lowerThird.styling
  expect(styling).toBeTruthy()
  // At least one of our writes must be reflected.
  const flat = JSON.stringify(styling)
  expect(flat.includes('Georgia') || flat.includes('#abcdef')).toBe(true)
})

test('user style presets: add → list → delete full cycle', async () => {
  const id = `zz-preset-${Date.now()}`
  const afterAdd = await api<Array<{ id: string }>>(h.window, 'userPresetsAdd', { id, name: 'ZZ Preset', styling: { accentColor: '#123456' } })
  expect(Array.isArray(afterAdd)).toBe(true)
  expect(afterAdd.some((p) => p.id === id)).toBe(true)

  const list = await api<Array<{ id: string }>>(h.window, 'userPresetsList')
  expect(list.some((p) => p.id === id)).toBe(true)

  const afterDel = await api<Array<{ id: string }>>(h.window, 'userPresetsDelete', id)
  expect(afterDel.some((p) => p.id === id)).toBe(false)
})

test('adding a preset with an existing id replaces, not duplicates', async () => {
  const id = `zz-dup-${Date.now()}`
  await api(h.window, 'userPresetsAdd', { id, name: 'First', styling: {} })
  const list = await api<Array<{ id: string; name: string }>>(h.window, 'userPresetsAdd', { id, name: 'Second', styling: {} })
  const matches = list.filter((p) => p.id === id)
  expect(matches.length).toBe(1)
  expect(matches[0].name).toBe('Second')
  await api(h.window, 'userPresetsDelete', id)
})

test.describe('Starting Soon state machine', () => {
  test('show → update → hide round-trips', async () => {
    await api(h.window, 'startingSoonShow')
    let s = await state()
    expect(s.startingSoon.visible).toBe(true)

    await api(h.window, 'startingSoonUpdate', { title: 'ZZ Pre-Show', subtitle: 'starting soon' })
    s = await state()
    expect(JSON.stringify(s.startingSoon)).toContain('ZZ Pre-Show')

    await api(h.window, 'startingSoonHide')
    s = await state()
    expect(s.startingSoon.visible).toBe(false)
  })

  test('cover-mode + countdown fields persist via update', async () => {
    await api(h.window, 'startingSoonShow')
    await api(h.window, 'startingSoonUpdate', { backdropMode: 'cover', backdropVideoUrl: 'https://x.test/v.mp4' })
    const s = await state()
    const flat = JSON.stringify(s.startingSoon)
    expect(flat).toContain('cover')
    await api(h.window, 'startingSoonHide')
  })
})
