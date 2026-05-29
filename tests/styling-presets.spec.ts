import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'
import { PRESETS } from '../src/shared/presets'
import { DEFAULT_STYLING } from '../src/shared/types'
import type { OverlayStyling } from '../src/shared/types'

// Overlay styling + presets + template gallery.
//
// The TemplateGallery component applies a preset by calling
//   window.api.overlayUpdateStyling(preset.styling)
// (see src/renderer/components/TemplateGallery.tsx -> applyPreset).
// We drive that same IPC path here and assert the resulting
// overlayGetState().lowerThird.styling reflects the preset, then verify
// individual fields round-trip through overlayUpdateStyling.

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
  // Give the renderer a moment to hydrate
  await window.waitForTimeout(1500)
  // Clean slate
  await window.evaluate(async () => {
    return window.api.triggerClearAll()
  })
})

test.afterAll(async () => {
  // Restore default styling so state is left clean for any later runs.
  if (window) {
    await window.evaluate(async (styling) => {
      return window.api.overlayUpdateStyling(styling)
    }, DEFAULT_STYLING as OverlayStyling).catch(() => {})
    await window.evaluate(async () => {
      return window.api.triggerClearAll()
    }).catch(() => {})
  }
  if (app) await app.close()
})

// ── Helper: apply a full styling object via the same IPC the UI uses ──
async function applyStyling(styling: Partial<OverlayStyling>) {
  await window.evaluate(async (s) => {
    return window.api.overlayUpdateStyling(s)
  }, styling)
}

async function getStyling(): Promise<OverlayStyling> {
  const state = await window.evaluate(async () => {
    return window.api.overlayGetState()
  })
  return state.lowerThird.styling
}

// ── Tests ────────────────────────────────────────────────────────

test('PRESETS source is non-empty and well-formed', async () => {
  expect(Array.isArray(PRESETS)).toBe(true)
  expect(PRESETS.length).toBeGreaterThan(0)
  for (const p of PRESETS) {
    expect(typeof p.id).toBe('string')
    expect(typeof p.name).toBe('string')
    expect(p.styling).toBeTruthy()
    // Every preset must carry the animation-timing fields under test.
    expect(typeof p.styling.animationDuration).toBe('number')
    expect(typeof p.styling.animationEasing).toBe('string')
  }
})

test('overlay state exposes a styling object with timing fields', async () => {
  const styling = await getStyling()
  expect(styling).toHaveProperty('fontFamily')
  expect(styling).toHaveProperty('fontSize')
  expect(styling).toHaveProperty('animation')
  expect(styling).toHaveProperty('animationDuration')
  expect(styling).toHaveProperty('animationEasing')
  expect(typeof styling.animationDuration).toBe('number')
  expect(typeof styling.animationEasing).toBe('string')
})

test('applying each preset reflects in overlay styling state', async () => {
  for (const preset of PRESETS) {
    await applyStyling(preset.styling)
    const styling = await getStyling()
    expect(styling.fontFamily).toBe(preset.styling.fontFamily)
    expect(styling.fontSize).toBe(preset.styling.fontSize)
    expect(styling.fontWeight).toBe(preset.styling.fontWeight)
    expect(styling.backgroundStyle).toBe(preset.styling.backgroundStyle)
    expect(styling.animation).toBe(preset.styling.animation)
    expect(styling.animationDuration).toBe(preset.styling.animationDuration)
    expect(styling.animationEasing).toBe(preset.styling.animationEasing)
    expect(styling.accentColor).toBe(preset.styling.accentColor)
  }
})

test('Template Presets panel is rendered in the UI', async () => {
  // TemplateGallery renders a ".panel-section-title" with the literal text.
  const title = window.locator('.panel-section-title:has-text("Template Presets")')
  await expect(title).toBeVisible()

  // Expand if collapsed, then confirm at least one template card exists.
  const cards = window.locator('.template-card')
  if ((await cards.count()) === 0) {
    await title.click()
    await window.waitForTimeout(300)
  }
  const count = await cards.count()
  expect(count).toBeGreaterThan(0)
  // One card per preset.
  expect(count).toBe(PRESETS.length)
})

test('template card names match the PRESETS source', async () => {
  const title = window.locator('.panel-section-title:has-text("Template Presets")')
  const cards = window.locator('.template-card')
  if ((await cards.count()) === 0) {
    await title.click()
    await window.waitForTimeout(300)
  }
  const names = await window.locator('.template-card .template-name').allTextContents()
  for (const preset of PRESETS) {
    expect(names).toContain(preset.name)
  }
})

test('clicking a template card applies its styling to overlay state', async () => {
  const title = window.locator('.panel-section-title:has-text("Template Presets")')
  const cards = window.locator('.template-card')
  if ((await cards.count()) === 0) {
    await title.click()
    await window.waitForTimeout(300)
  }

  // Pick a preset whose name we can target deterministically.
  const target = PRESETS.find((p) => p.name === 'Neon') ?? PRESETS[0]
  const card = window.locator('.template-card', { hasText: target.name }).first()
  await card.click()
  await window.waitForTimeout(400)

  const styling = await getStyling()
  expect(styling.fontFamily).toBe(target.styling.fontFamily)
  expect(styling.accentColor).toBe(target.styling.accentColor)
  expect(styling.animation).toBe(target.styling.animation)
  expect(styling.animationDuration).toBe(target.styling.animationDuration)
  expect(styling.animationEasing).toBe(target.styling.animationEasing)
})

test('overlayUpdateStyling round-trips individual fields (partial merge)', async () => {
  // Start from a known full preset, then patch single fields.
  await applyStyling(PRESETS[0].styling)

  await applyStyling({ fontSize: 44 })
  let styling = await getStyling()
  expect(styling.fontSize).toBe(44)
  // Other fields from the preset must be preserved (partial merge).
  expect(styling.fontFamily).toBe(PRESETS[0].styling.fontFamily)
  expect(styling.accentColor).toBe(PRESETS[0].styling.accentColor)

  await applyStyling({ accentColor: '#abcdef' })
  styling = await getStyling()
  expect(styling.accentColor).toBe('#abcdef')
  expect(styling.fontSize).toBe(44) // prior patch survives
})

test('overlayUpdateStyling round-trips animation timing fields', async () => {
  await applyStyling({
    animation: 'bounce',
    animationDuration: 1.25,
    animationEasing: 'elastic',
  })
  const styling = await getStyling()
  expect(styling.animation).toBe('bounce')
  expect(styling.animationDuration).toBe(1.25)
  expect(styling.animationEasing).toBe('elastic')
})

test('overlayUpdateStyling round-trips richer title/subtitle fields', async () => {
  await applyStyling({
    titleTextTransform: 'uppercase',
    titleLetterSpacing: 2,
    subtitleFontSize: 18,
    subtitleColor: '#123456',
    textShadow: true,
    textGlow: true,
    labelColor: '#fefefe',
    labelBackgroundColor: '#010203',
  })
  const styling = await getStyling()
  expect(styling.titleTextTransform).toBe('uppercase')
  expect(styling.titleLetterSpacing).toBe(2)
  expect(styling.subtitleFontSize).toBe(18)
  expect(styling.subtitleColor).toBe('#123456')
  expect(styling.textShadow).toBe(true)
  expect(styling.textGlow).toBe(true)
  expect(styling.labelColor).toBe('#fefefe')
  expect(styling.labelBackgroundColor).toBe('#010203')
})
