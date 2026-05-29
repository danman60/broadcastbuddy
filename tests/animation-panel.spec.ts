// Lower-third animation styling — end-to-end.
//
// Two-page pattern (mirrors tests/overlay-statemachine.spec.ts):
//   - `win`     : the Electron control surface. Drives state via window.api
//                 (overlayUpdateStyling / overlayGetState / overlayFireLT).
//   - `overlay` : a real Chromium tab rendering GET /overlay — the PASSIVE
//                 OBS browser source. It opens a WS to the hub, identifies as
//                 `overlay`, and re-renders whatever full-state push it gets.
//
// We assert two layers per case:
//   1. State layer — overlayGetState().lowerThird.styling reflects what we set.
//   2. DOM layer   — after a fire, the #lt element carries `anim-<type>` and
//                    the --anim-dur CSS var matches the duration we pushed.
//
// What applyState() actually does (src/main/services/overlay.ts):
//   - el = #lt; el.className = 'lower-third'; el.classList.add('anim-' + anim)
//   - anim === 'random' picks one of the 9 concrete types at render time, so a
//     'random' fire never yields an `anim-random` class — we only assert it is
//     one of the known set.
//   - --anim-dur = (animationDuration || 0.5) + 's', set on #lt.
//   - --anim-ease mapped: bounce -> cubic-bezier(0.34,1.56,0.64,1),
//     elastic -> cubic-bezier(0.68,-0.55,0.27,1.55), everything else passthrough.
//   - updateStyling() calls notifyChange() -> broadcastState, so the overlay
//     re-runs applyState on every styling change; we still fire the LT first so
//     the element is `visible` and the assertions are unambiguous.

import { test, expect, _electron as electron, ElectronApplication, Page, chromium, Browser } from '@playwright/test'
import path from 'path'
import type { AnimationType, EasingType } from '../src/shared/types'

let app: ElectronApplication
let win: Page
let browser: Browser
let overlay: Page

const ALL_ANIMS: AnimationType[] = ['slide', 'fade', 'zoom', 'rise', 'typewriter', 'bounce', 'split', 'blur', 'sparkle']
const CONCRETE_ANIMS = ALL_ANIMS // the 9 'random' may resolve to

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(__dirname, '..'), '--disable-gpu', '--no-sandbox'],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)

  const settings = await win.evaluate(async () => window.api.settingsGet())
  const httpPort = settings.server?.httpPort || 9876

  // Clean slate + a selected trigger so a fired lower third has text.
  await win.evaluate(async () => {
    await window.api.triggerClearAll()
    await window.api.triggerAdd({
      id: 'anim-1', name: 'Anim One', title: 'Katherine Johnson', subtitle: 'Orbital mechanics',
      category: '', order: 0, logoDataUrl: '',
    })
    await window.api.triggerSelect(0)
  })

  browser = await chromium.launch()
  overlay = await browser.newPage()
  await overlay.goto(`http://127.0.0.1:${httpPort}/overlay`)
  await overlay.waitForTimeout(1200)
})

test.afterAll(async () => {
  await browser?.close()
  await app?.close()
})

// Allow a pushed state to propagate WS -> browser source -> DOM.
async function settle() {
  await overlay.waitForTimeout(350)
}

// Push styling, fire the lower third, let it render. The fire makes #lt
// `visible`; applyState runs on both the styling push and the fire push.
async function applyAndFire(changes: Record<string, unknown>) {
  await win.evaluate(async (c) => {
    await window.api.overlayHideLT()
    await window.api.overlayUpdateStyling(c as any)
  }, changes)
  await settle()
  await win.evaluate(() => window.api.overlayFireLT())
  await settle()
}

async function ltClasses(): Promise<string[]> {
  return overlay.locator('#lt').evaluate((el) => Array.from(el.classList))
}

async function ltAnimDur(): Promise<string> {
  return overlay.locator('#lt').evaluate((el) =>
    (el as HTMLElement).style.getPropertyValue('--anim-dur').trim()
  )
}

async function ltAnimEase(): Promise<string> {
  return overlay.locator('#lt').evaluate((el) =>
    (el as HTMLElement).style.getPropertyValue('--anim-ease').trim()
  )
}

async function stateStyling() {
  return win.evaluate(async () => (await window.api.overlayGetState()).lowerThird.styling)
}

test('baseline: overlay page is connected and #lt exists', async () => {
  await expect(overlay.locator('#lt')).toHaveCount(1)
})

// Every concrete (non-random) animation type maps to anim-<type> on #lt,
// and overlayGetState reflects the chosen type.
for (const anim of CONCRETE_ANIMS) {
  test(`animation '${anim}': state + #lt carries anim-${anim}`, async () => {
    await applyAndFire({ animation: anim })

    const styling = await stateStyling()
    expect(styling.animation).toBe(anim)

    await expect(overlay.locator('#lt')).toHaveClass(/visible/)
    const classes = await ltClasses()
    expect(classes).toContain('anim-' + anim)
  })
}

test('animationDuration: state reflects value and --anim-dur matches', async () => {
  await applyAndFire({ animation: 'slide', animationDuration: 1.2 })

  const styling = await stateStyling()
  expect(styling.animationDuration).toBe(1.2)

  // applyState sets --anim-dur = durVal + 's'.
  expect(await ltAnimDur()).toBe('1.2s')

  // A second value, to prove it tracks rather than being a constant.
  await applyAndFire({ animationDuration: 0.3 })
  expect((await stateStyling()).animationDuration).toBe(0.3)
  expect(await ltAnimDur()).toBe('0.3s')
})

test('animationEasing: passthrough easing maps straight through', async () => {
  const easing: EasingType = 'ease-in-out'
  await applyAndFire({ animation: 'fade', animationEasing: easing })

  expect((await stateStyling()).animationEasing).toBe(easing)
  expect(await ltAnimEase()).toBe('ease-in-out')
})

test('animationEasing: bounce + elastic map to cubic-bezier curves', async () => {
  await applyAndFire({ animation: 'fade', animationEasing: 'bounce' as EasingType })
  expect((await stateStyling()).animationEasing).toBe('bounce')
  expect(await ltAnimEase()).toBe('cubic-bezier(0.34,1.56,0.64,1)')

  await applyAndFire({ animationEasing: 'elastic' as EasingType })
  expect((await stateStyling()).animationEasing).toBe('elastic')
  expect(await ltAnimEase()).toBe('cubic-bezier(0.68,-0.55,0.27,1.55)')
})

test("animation 'random': state stores 'random', #lt resolves to a concrete type", async () => {
  await applyAndFire({ animation: 'random' as AnimationType })

  // State keeps the literal 'random' — resolution happens in the browser source.
  expect((await stateStyling()).animation).toBe('random')

  await expect(overlay.locator('#lt')).toHaveClass(/visible/)
  const classes = await ltClasses()
  const animClass = classes.find((c) => c.startsWith('anim-'))
  expect(animClass).toBeTruthy()
  // Never 'anim-random' — applyState picks one of the 9 concrete types.
  expect(animClass).not.toBe('anim-random')
  expect(CONCRETE_ANIMS.map((a) => 'anim-' + a)).toContain(animClass)
})

test('combined: type + duration + easing all reflected together on #lt', async () => {
  await applyAndFire({ animation: 'zoom', animationDuration: 0.8, animationEasing: 'linear' as EasingType })

  const styling = await stateStyling()
  expect(styling.animation).toBe('zoom')
  expect(styling.animationDuration).toBe(0.8)
  expect(styling.animationEasing).toBe('linear')

  const classes = await ltClasses()
  expect(classes).toContain('anim-zoom')
  expect(await ltAnimDur()).toBe('0.8s')
  expect(await ltAnimEase()).toBe('linear')
})
