// Headless runtime test of the starting-soon PRE-SHOW MEDIA stack.
//
// Mirrors tests/overlay-statemachine.spec.ts: launch the Electron control
// surface, render the passive OBS browser source (GET /overlay) in a real
// Chromium tab, drive media state via window.api on the Electron window, and
// assert two things end-to-end:
//   (a) overlayGetState().startingSoon.media reflects the pushed values.
//   (b) when startingSoon is shown, the browser-source DOM reacts — each
//       sub-element's container gains visibility per applyStartingSoonMedia().
//
// Ground truth from src/main/services/overlay.ts (applyStartingSoonMedia):
//   - #ss-welcome  : style.display 'block'  when visible && showWelcome &&
//                    (welcomeLine || venueName); else 'none'. NOT a class.
//   - #ss-social   : .visible class         when visible && showSocialBar &&
//                    socialBar (non-empty).
//   - #ss-sponsors : .visible class         when visible && showSponsors &&
//                    sponsorLogos.length > 0.
//   - #ss-slideshow: .visible class         when visible && showSlideshow &&
//                    slideshowPhotos.length > 0.
// Every gate requires startingSoon.visible to be true — content + flag alone
// does not light the DOM. Tests set BOTH where the gate demands it.

import { test, expect, _electron as electron, ElectronApplication, Page, chromium, Browser } from '@playwright/test'
import path from 'path'

let app: ElectronApplication
let win: Page // Electron control window (drives state via window.api)
let browser: Browser
let overlay: Page // Chromium tab rendering http://127.0.0.1:<httpPort>/overlay

// 1x1 transparent PNG data URL — a valid <img src> so length-gated sub-elements
// (sponsors/slideshow) have real content without touching the filesystem.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQAY3Y2wAAAAAElFTkSuQmCC'

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

  // Clean slate.
  await win.evaluate(async () => {
    await window.api.triggerClearAll()
  })

  browser = await chromium.launch()
  overlay = await browser.newPage()
  await overlay.goto(`http://127.0.0.1:${httpPort}/overlay`)
  // Overlay opens its WS + identifies on load; let it connect and receive the
  // initial full-state push.
  await overlay.waitForTimeout(1200)
})

test.afterAll(async () => {
  // Leave the scene hidden so we don't wedge any media timers.
  await win?.evaluate(() => window.api.startingSoonHide()).catch(() => {})
  await browser?.close()
  await app?.close()
})

// Let a pushed state propagate WS → browser source → DOM.
async function settle() {
  await overlay.waitForTimeout(350)
}

// Push a media patch (merged onto the existing media by updateStartingSoon).
async function setMedia(media: Record<string, unknown>) {
  await win.evaluate((m) => window.api.startingSoonUpdate({ media: m as any }), media)
  await settle()
}

async function show() {
  await win.evaluate(() => window.api.startingSoonShow())
  await settle()
}

async function hide() {
  await win.evaluate(() => window.api.startingSoonHide())
  await settle()
}

// Read the authoritative main-process media object.
async function getMedia() {
  return win.evaluate(async () => (await window.api.overlayGetState()).startingSoon.media)
}

// ── State plumbing: startingSoonUpdate → main-process state ───────────────────

test('media patch reflects in overlayGetState().startingSoon.media', async () => {
  await setMedia({
    showWelcome: true,
    welcomeLine: 'Welcome to the Spring Recital',
    venueName: 'Roy Thomson Hall',
    showSocialBar: true,
    socialBar: '@studio • #recital2026 • site.com',
    showSponsors: true,
    sponsorLogos: [PNG],
    sponsorIntervalSec: 4,
    showSlideshow: true,
    slideshowPhotos: [PNG, PNG],
    slideshowIntervalSec: 4,
  })
  const m = await getMedia()
  expect(m).toBeTruthy()
  expect(m!.showWelcome).toBe(true)
  expect(m!.welcomeLine).toBe('Welcome to the Spring Recital')
  expect(m!.venueName).toBe('Roy Thomson Hall')
  expect(m!.showSocialBar).toBe(true)
  expect(m!.socialBar).toBe('@studio • #recital2026 • site.com')
  expect(m!.showSponsors).toBe(true)
  expect(m!.sponsorLogos).toHaveLength(1)
  expect(m!.sponsorIntervalSec).toBe(4)
  expect(m!.showSlideshow).toBe(true)
  expect(m!.slideshowPhotos).toHaveLength(2)
})

test('partial media patch merges, does not clobber other fields', async () => {
  await setMedia({ socialBar: 'changed bar text' })
  const m = await getMedia()
  expect(m!.socialBar).toBe('changed bar text')
  // Previously-set fields survive the merge (updateStartingSoon spreads media).
  expect(m!.showWelcome).toBe(true)
  expect(m!.welcomeLine).toBe('Welcome to the Spring Recital')
  expect(m!.sponsorLogos).toHaveLength(1)
})

// ── DOM reaction: all four sub-elements when shown with flags + content ───────

test('all media sub-elements light up when shown with flags + content', async () => {
  // Restore full content (prior test changed socialBar, still non-empty/fine).
  await setMedia({
    showWelcome: true,
    welcomeLine: 'Welcome to the Spring Recital',
    venueName: 'Roy Thomson Hall',
    showSocialBar: true,
    socialBar: '@studio • #recital2026',
    showSponsors: true,
    sponsorLogos: [PNG],
    showSlideshow: true,
    slideshowPhotos: [PNG, PNG],
  })
  await show()

  await expect(overlay.locator('#starting-soon')).toHaveClass(/visible/)
  // welcome uses inline display, not a class.
  await expect(overlay.locator('#ss-welcome')).toHaveCSS('display', 'block')
  await expect(overlay.locator('#ss-social')).toHaveClass(/visible/)
  await expect(overlay.locator('#ss-sponsors')).toHaveClass(/visible/)
  await expect(overlay.locator('#ss-slideshow')).toHaveClass(/visible/)
  await overlay.screenshot({ path: 'test-results/ss-media-all-on.png' })
})

test('content renders in the welcome + social sub-elements', async () => {
  // (depends on the prior "all on" state)
  await expect(overlay.locator('#ss-welcome')).toContainText('Welcome to the Spring Recital')
  await expect(overlay.locator('#ss-welcome .ss-venue')).toHaveText('Roy Thomson Hall')
  await expect(overlay.locator('#ss-social')).toHaveText('@studio • #recital2026')
})

// ── DOM reaction: per-flag toggling while shown ───────────────────────────────

test('toggling showWelcome off hides only the welcome line', async () => {
  await setMedia({ showWelcome: false })
  await expect(overlay.locator('#ss-welcome')).toHaveCSS('display', 'none')
  // Siblings stay up.
  await expect(overlay.locator('#ss-social')).toHaveClass(/visible/)
  await expect(overlay.locator('#ss-sponsors')).toHaveClass(/visible/)
  await expect(overlay.locator('#ss-slideshow')).toHaveClass(/visible/)
  // And back on.
  await setMedia({ showWelcome: true })
  await expect(overlay.locator('#ss-welcome')).toHaveCSS('display', 'block')
})

test('toggling each show* flag off drops its container .visible class', async () => {
  await setMedia({ showSocialBar: false })
  await expect(overlay.locator('#ss-social')).not.toHaveClass(/visible/)
  await setMedia({ showSponsors: false })
  await expect(overlay.locator('#ss-sponsors')).not.toHaveClass(/visible/)
  await setMedia({ showSlideshow: false })
  await expect(overlay.locator('#ss-slideshow')).not.toHaveClass(/visible/)

  // Re-enabling brings them back (content is still present from earlier).
  await setMedia({ showSocialBar: true, showSponsors: true, showSlideshow: true })
  await expect(overlay.locator('#ss-social')).toHaveClass(/visible/)
  await expect(overlay.locator('#ss-sponsors')).toHaveClass(/visible/)
  await expect(overlay.locator('#ss-slideshow')).toHaveClass(/visible/)
})

test('flag on but empty content stays hidden (gate needs both)', async () => {
  // Sponsors flag on but no logos → not visible.
  await setMedia({ showSponsors: true, sponsorLogos: [] })
  await expect(overlay.locator('#ss-sponsors')).not.toHaveClass(/visible/)
  // Social flag on but empty string → not visible.
  await setMedia({ showSocialBar: true, socialBar: '' })
  await expect(overlay.locator('#ss-social')).not.toHaveClass(/visible/)
  // Restore content → visible again.
  await setMedia({ sponsorLogos: [PNG], socialBar: 'back' })
  await expect(overlay.locator('#ss-sponsors')).toHaveClass(/visible/)
  await expect(overlay.locator('#ss-social')).toHaveClass(/visible/)
})

test('hiding starting-soon tears down all media containers', async () => {
  await hide()
  await expect(overlay.locator('#starting-soon')).not.toHaveClass(/visible/)
  // Every media gate requires startingSoon.visible — all collapse on hide.
  await expect(overlay.locator('#ss-welcome')).toHaveCSS('display', 'none')
  await expect(overlay.locator('#ss-social')).not.toHaveClass(/visible/)
  await expect(overlay.locator('#ss-sponsors')).not.toHaveClass(/visible/)
  await expect(overlay.locator('#ss-slideshow')).not.toHaveClass(/visible/)
})

test('re-showing after hide restores the media containers from persisted state', async () => {
  // Media flags/content persist in main-process state across hide/show.
  await show()
  await expect(overlay.locator('#starting-soon')).toHaveClass(/visible/)
  await expect(overlay.locator('#ss-social')).toHaveClass(/visible/)
  await expect(overlay.locator('#ss-sponsors')).toHaveClass(/visible/)
  await expect(overlay.locator('#ss-slideshow')).toHaveClass(/visible/)
})
