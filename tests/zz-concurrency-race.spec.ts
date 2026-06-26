import { test, expect } from '@playwright/test'
import { launchApp, closeApp, api, Harness } from './zz-harness'

/**
 * Concurrency / rapid-fire. The operator (and Stream Deck, and Xbox, and voice)
 * can all hit the command bus at once. State must stay consistent and the main
 * process must never wedge. We fire bursts and assert a coherent final state.
 */

let h: Harness
test.beforeAll(async () => { h = await launchApp() })
test.afterAll(async () => { await closeApp(h) })

async function state() {
  return api<Record<string, any>>(h.window, 'overlayGetState')
}

test('rapid fire/hide lower-third burst leaves a coherent final state', async () => {
  await h.window.evaluate(async () => {
    for (let i = 0; i < 25; i++) {
      window.api.overlayFireAdhoc(`burst ${i}`, 'sub')
      window.api.overlayHideLT()
    }
    await window.api.overlayHideLT()
  })
  const s = await state()
  expect(typeof s.lowerThird.visible).toBe('boolean')
  // last op was hide → must be hidden
  expect(s.lowerThird.visible).toBe(false)
})

test('concurrent counter bumps settle to the correct sum', async () => {
  await api(h.window, 'overlayCounterSet', 0)
  await h.window.evaluate(async () => {
    const ops: Promise<unknown>[] = []
    for (let i = 0; i < 20; i++) ops.push(Promise.resolve(window.api.overlayCounterBump(1)))
    await Promise.all(ops)
  })
  const s = await state()
  expect(s.counter.value).toBe(20)
  await api(h.window, 'overlayCounterSet', 0)
})

test('parallel trigger adds all land (no lost writes)', async () => {
  await api(h.window, 'triggerClearAll')
  await h.window.evaluate(async () => {
    const ops: Promise<unknown>[] = []
    for (let i = 0; i < 15; i++) {
      ops.push(Promise.resolve(window.api.triggerAdd({ id: `race-${i}`, title: `R${i}`, type: 'lower_third' } as any)))
    }
    await Promise.all(ops)
  })
  const list = await api<{ triggers: unknown[] }>(h.window, 'triggerList')
  expect(list.triggers.length).toBe(15)
  await api(h.window, 'triggerClearAll')
})

test('rapid clock + grid + counter toggles do not desync booleans', async () => {
  const before = await state()
  await h.window.evaluate(async () => {
    for (let i = 0; i < 10; i++) {
      window.api.overlayClockToggle()
      window.api.overlayGridToggle()
      window.api.overlayCounterToggle()
    }
  })
  await h.window.waitForTimeout(200)
  const after = await state()
  // even number of toggles → back to original for each
  expect(after.clock.visible).toBe(before.clock.visible)
  expect(after.gridVisible).toBe(before.gridVisible)
  expect(after.counter.visible).toBe(before.counter.visible)
})

test('interleaved feature show/up-next/that-was/hide ends hidden', async () => {
  await h.window.evaluate(async () => {
    for (let i = 0; i < 8; i++) {
      window.api.overlayFeatureShow({ title: `F${i}`, subtitle: '' })
      window.api.overlayFeatureUpNext('UP NEXT')
      window.api.overlayFeatureThatWas('THAT WAS')
    }
    await window.api.overlayFeatureHide()
  })
  const s = await state()
  expect(s.featureCard.visible).toBe(false)
})

test('burst of settings writes all persist (last-writer-wins per key)', async () => {
  await h.window.evaluate(async () => {
    const ops: Promise<unknown>[] = []
    for (let i = 0; i < 12; i++) ops.push(Promise.resolve(window.api.settingsSet('voiceWakeWord', `w${i}`)))
    await Promise.all(ops)
  })
  const s = await api<Record<string, unknown>>(h.window, 'settingsGet')
  expect(typeof s.voiceWakeWord).toBe('string')
  expect((s.voiceWakeWord as string).startsWith('w')).toBe(true)
})
