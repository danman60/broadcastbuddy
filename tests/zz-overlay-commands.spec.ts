import { test, expect } from '@playwright/test'
import { launchApp, closeApp, api, Harness } from './zz-harness'

/**
 * Overlay command IPC surface — clock, counter, feature card, ticker, grid,
 * chat message. Driven through window.api and verified against overlayGetState.
 * These paths back the OBS browser source and remain live even though several
 * of their operator buttons were relocated/removed in the ui-redesign — so this
 * documents and guards the contract independent of button placement.
 */

let h: Harness
test.beforeAll(async () => { h = await launchApp() })
test.afterAll(async () => { await closeApp(h) })

async function state() {
  return api<Record<string, any>>(h.window, 'overlayGetState')
}

test('clock toggle flips visibility and update sets format', async () => {
  const before = (await state()).clock.visible
  await api(h.window, 'overlayClockToggle')
  expect((await state()).clock.visible).toBe(!before)
  await api(h.window, 'overlayClockUpdate', { format: '24h', showSeconds: true })
  const s = (await state()).clock
  expect(s.format).toBe('24h')
  expect(s.showSeconds).toBe(true)
  // restore
  await api(h.window, 'overlayClockToggle')
  expect((await state()).clock.visible).toBe(before)
})

test('counter toggle, set, and bump update state', async () => {
  const before = (await state()).counter.visible
  await api(h.window, 'overlayCounterToggle')
  expect((await state()).counter.visible).toBe(!before)

  await api(h.window, 'overlayCounterSet', 5)
  expect((await state()).counter.value).toBe(5)

  await api(h.window, 'overlayCounterBump', 1)
  expect((await state()).counter.value).toBe(6)
  await api(h.window, 'overlayCounterBump', -2)
  expect((await state()).counter.value).toBe(4)

  // restore
  await api(h.window, 'overlayCounterSet', 0)
  await api(h.window, 'overlayCounterToggle')
  expect((await state()).counter.visible).toBe(before)
})

test('feature card: show → up-next → that-was → hide', async () => {
  await api(h.window, 'overlayFeatureShow', { title: 'Finale', subtitle: 'All Cast', kicker: 'NOW' })
  let fc = (await state()).featureCard
  expect(fc.visible).toBe(true)
  expect(fc.title).toBe('Finale')

  await api(h.window, 'overlayFeatureUpNext', 'UP NEXT')
  fc = (await state()).featureCard
  expect(fc.visible).toBe(true)

  await api(h.window, 'overlayFeatureThatWas', 'THAT WAS')
  fc = (await state()).featureCard
  expect(fc.visible).toBe(true)

  await api(h.window, 'overlayFeatureHide')
  expect((await state()).featureCard.visible).toBe(false)
})

test('ticker show/update/hide round-trips', async () => {
  await api(h.window, 'tickerShow', 'zz ticker copy')
  let t = (await state()).ticker
  expect(t.visible).toBe(true)
  expect(t.text).toContain('zz ticker')

  await api(h.window, 'tickerUpdate', { text: 'updated copy', speed: 120 })
  t = (await state()).ticker
  expect(t.text).toContain('updated copy')

  await api(h.window, 'tickerHide')
  expect((await state()).ticker.visible).toBe(false)
})

test('grid toggle flips off-stream leveling grid', async () => {
  const before = (await state()).gridVisible
  await api(h.window, 'overlayGridToggle')
  expect((await state()).gridVisible).toBe(!before)
  await api(h.window, 'overlayGridToggle')
  expect((await state()).gridVisible).toBe(before)
})

test('chat message show/hide drives the on-stream card', async () => {
  await api(h.window, 'overlayShowChatMessage', 'Fan', 'Hello stream')
  let cm = (await state()).chatMessage
  expect(cm.visible).toBe(true)
  expect(cm.text).toContain('Hello stream')
  await api(h.window, 'overlayHideChatMessage')
  expect((await state()).chatMessage.visible).toBe(false)
})

test('lower third fire → hide round-trip', async () => {
  // Ensure at least one trigger exists to fire from, then drive raw LT state.
  await api(h.window, 'overlayFireAdhoc', 'Ad-hoc Title', 'Ad-hoc Sub')
  const lt = (await state()).lowerThird
  expect(lt.visible).toBe(true)
  await api(h.window, 'overlayHideLT')
  expect((await state()).lowerThird.visible).toBe(false)
})
