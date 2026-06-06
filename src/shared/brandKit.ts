// ── Brand Kit → complete overlay theme ──────────────────────────────────────
// Maps a scraped palette + fonts + (optional) logo into a COMPLETE
// OverlayStyling that themes every surface: lower-third, ticker, feature card,
// and the Starting-Soon scene. Pure functions (no IPC) so the renderer can
// compute the theme and the panel just applies the pieces through existing
// setters (overlayUpdateStyling / tickerUpdate / startingSoonUpdate).

import type { OverlayStyling, SSDesign, StartingSoonState } from './types'
import { DEFAULT_STYLING } from './types'

export interface ScrapedBrand {
  colors: string[]
  fonts: string[]
  siteName: string
}

// ── Color helpers ───────────────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

function saturation(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

function darken(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  const f = (n: number) => Math.max(0, Math.round(n * (1 - amount)))
  const c = (n: number) => f(n).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** True if text is legible (WCAG-ish) on a background. */
function readableOn(text: string, bg: string): boolean {
  const l1 = luminance(text), l2 = luminance(bg)
  const lighter = Math.max(l1, l2), darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05) >= 3.5
}

const CSS_FALLBACK = "'Segoe UI', sans-serif"

function fontStack(font: string | undefined): string {
  if (!font) return DEFAULT_STYLING.fontFamily
  // Already a stack? keep it. Otherwise wrap with a generic fallback.
  if (font.includes(',')) return font
  return `'${font.replace(/['"]/g, '')}', ${CSS_FALLBACK}`
}

/**
 * Choose a sensible role mapping from the scraped palette:
 *   - background = the darkest brand-ish color (deep, readable surface)
 *   - text       = white or near-white that reads on that background
 *   - accent     = the most saturated / brand-representative color
 */
export function mapPalette(colors: string[]): { background: string; text: string; accent: string } {
  const palette = colors.filter(Boolean)
  if (palette.length === 0) {
    return {
      background: DEFAULT_STYLING.backgroundColor,
      text: DEFAULT_STYLING.textColor,
      accent: DEFAULT_STYLING.accentColor,
    }
  }

  // Accent = most saturated color (the visual brand hit). The scraper already
  // ranks brand-first, so a tie breaks toward the earlier (higher-ranked) one.
  const accent = [...palette].sort((a, b) => saturation(b) - saturation(a))[0]

  // Background = darkest color; if everything is light, darken the accent so
  // the lower-third still has a deep, legible surface.
  let background = [...palette].sort((a, b) => luminance(a) - luminance(b))[0]
  if (luminance(background) > 0.45) background = darken(accent, 0.7)

  // Text = white unless that fails contrast (very light bg), then near-black.
  const text = readableOn('#ffffff', background) ? '#ffffff' : '#111111'

  return { background, text, accent }
}

/**
 * Produce a COMPLETE OverlayStyling themed to the brand. Sets global
 * font/colors AND populates `elements` so the ticker, lower-third, and feature
 * card all inherit the brand fonts/colors (requirement: "style every font in
 * ticker/thirds/cards after the client").
 */
export function buildBrandStyling(brand: ScrapedBrand, base?: OverlayStyling): OverlayStyling {
  const { background, text, accent } = mapPalette(brand.colors)
  const headingFont = fontStack(brand.fonts[0])
  const start = base ?? DEFAULT_STYLING

  return {
    ...start,
    fontFamily: headingFont,
    textColor: text,
    backgroundColor: background,
    accentColor: accent,
    // Gradient reads as more "designed"/branded than flat fill.
    backgroundStyle: 'gradient',
    // Chip label uses accent bg + a legible label color.
    labelColor: readableOn('#ffffff', accent) ? '#ffffff' : '#111111',
    labelBackgroundColor: accent,
    elements: {
      lowerThird: {
        card: {
          backgroundColor: background,
          borderColor: accent,
          borderWidth: 0,
        },
        sub: {
          title: { color: text, fontWeight: 700 },
          subtitle: { color: text },
          label: { color: readableOn('#ffffff', accent) ? '#ffffff' : '#111111' },
        },
      },
      featureCard: {
        sub: {
          kicker: { color: accent, fontWeight: 700 },
          title: { color: text, fontWeight: 800 },
          subtitle: { color: text },
        },
      },
    },
  }
}

/** Ticker colors derived from the brand (accent strip, legible text). */
export function buildBrandTicker(brand: ScrapedBrand): { backgroundColor: string; textColor: string } {
  const { accent, text, background } = mapPalette(brand.colors)
  // Ticker strip = accent if it's dark enough to read white on, else the bg.
  const stripBg = readableOn('#ffffff', accent) ? accent : background
  return { backgroundColor: stripBg, textColor: readableOn('#ffffff', stripBg) ? '#ffffff' : text }
}

/**
 * Starting-Soon updates derived from the brand: gradient design + base colors
 * so the full-screen pre-show surface matches the brand too.
 */
export function buildBrandStartingSoon(brand: ScrapedBrand): Partial<StartingSoonState> {
  const { background, text, accent } = mapPalette(brand.colors)
  const headingFont = fontStack(brand.fonts[0])
  const bodyFont = fontStack(brand.fonts[1] || brand.fonts[0])
  const design: SSDesign = {
    presetId: 'brand-kit',
    gradientColors: [darken(background, 0.15), background, accent],
    gradientAngle: 135,
    titleFont: headingFont,
    subtitleFont: bodyFont,
    countdownWeight: 800,
  }
  return {
    backgroundColor: background,
    textColor: text,
    accentColor: accent,
    design,
  }
}
