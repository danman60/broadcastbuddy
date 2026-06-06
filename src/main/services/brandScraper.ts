import sharp from 'sharp'
import { createLogger } from '../logger'
import * as settings from './settings'

const logger = createLogger('brandScraper')

export interface BrandKit {
  colors: string[]         // hex colors found, ranked most-brand-like first
  fonts: string[]          // font family names found
  logoUrl: string | null   // best-guess logo URL
  siteName: string
}

export async function scrapeWebsite(url: string): Promise<BrandKit> {
  logger.info(`Scraping brand kit from: ${url}`)

  // Normalize URL
  if (!url.startsWith('http')) {
    url = 'https://' + url
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  let html: string
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    })
    // Cap processed HTML — huge pages combined with regex extraction can stall
    // the main process; brand metadata lives in the head/early body anyway.
    html = (await response.text()).slice(0, 3_000_000)
  } catch (err) {
    throw new Error(`Failed to fetch ${url}: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearTimeout(timeout)
  }

  // Extract font families
  const fonts = extractFonts(html)

  // Extract logo
  const logoUrl = extractLogo(html, url)

  // Extract site name
  const siteName = extractSiteName(html)

  // ── Colors: brand-signal-first extraction ──────────────────────
  // The old method just regex-scraped every #hex on the page, which is
  // dominated by utility greys and rarely matches the *visual* brand. New
  // approach ranks by brand-signal: theme-color meta + CSS brand vars +
  // header/hero/button declarations + the dominant colors of the og:image
  // (which visually represents the site). Falls back to the raw scan.
  let colors: string[]
  try {
    colors = await extractBrandColors(html, url, logoUrl)
    if (colors.length < 3) {
      // Backfill from the raw scan so the palette is never thin.
      const fallback = extractColors(html)
      colors = dedupeColors([...colors, ...fallback]).slice(0, 8)
    }
  } catch (err) {
    logger.warn('Brand-color extraction failed, falling back to raw scan:', err)
    colors = extractColors(html)
  }

  const result: BrandKit = { colors, fonts, logoUrl, siteName }
  logger.info(`Brand kit extracted: ${colors.length} colors, ${fonts.length} fonts, logo: ${!!logoUrl}`)
  return result
}

/**
 * Fetch a remote logo/image URL and return it as a base64 data URL so the
 * renderer can store it as the CLIENT logo (same shape as logoBrowse()).
 * Returns '' on any failure (caller treats empty as "no logo imported").
 */
export async function fetchImageAsDataUrl(imageUrl: string): Promise<string> {
  if (!imageUrl) return ''
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)
  try {
    const res = await fetch(imageUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    })
    if (!res.ok) return ''
    const contentType = res.headers.get('content-type') || guessMimeFromUrl(imageUrl)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0 || buf.length > 8_000_000) return ''
    return `data:${contentType};base64,${buf.toString('base64')}`
  } catch (err) {
    logger.warn('fetchImageAsDataUrl failed:', err)
    return ''
  } finally {
    clearTimeout(timeout)
  }
}

function guessMimeFromUrl(u: string): string {
  const ext = u.split('?')[0].split('.').pop()?.toLowerCase()
  if (ext === 'svg') return 'image/svg+xml'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  return 'image/png'
}

export async function scrapeWithAI(url: string): Promise<BrandKit & { aiSuggestion?: string }> {
  const kit = await scrapeWebsite(url)

  const apiKey = settings.get('deepseekApiKey')
  if (!apiKey) return kit

  try {
    const { default: OpenAI } = await import('openai')
    const client = new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com' })

    const prompt = `Given this brand data extracted from ${url}:
Colors: ${kit.colors.join(', ')}
Fonts: ${kit.fonts.join(', ')}
Site name: ${kit.siteName}

Suggest the best overlay styling for a lower-third broadcast overlay that matches this brand.
Return a JSON object with: backgroundColor (hex), textColor (hex), accentColor (hex), fontFamily (CSS value), backgroundStyle (solid/gradient/glass/accent-bar).
Return ONLY the JSON, no explanation.`

    const response = await client.chat.completions.create({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 256,
    })

    const content = response.choices[0]?.message?.content?.trim()
    return { ...kit, aiSuggestion: content || undefined }
  } catch (err) {
    logger.warn('AI brand analysis failed, returning basic scrape:', err)
    return kit
  }
}

// ── Extraction helpers ───────────────────────────────────────────

function extractColors(html: string): string[] {
  const colorSet = new Set<string>()

  // Hex colors (#xxx, #xxxxxx)
  const hexMatches = html.matchAll(/#([0-9a-fA-F]{3,8})\b/g)
  for (const m of hexMatches) {
    const hex = m[1]
    if (hex.length === 3 || hex.length === 6) {
      const normalized = hex.length === 3
        ? '#' + hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
        : '#' + hex
      // Skip very common non-brand colors
      const lower = normalized.toLowerCase()
      if (lower !== '#000000' && lower !== '#ffffff' && lower !== '#333333' && lower !== '#666666') {
        colorSet.add(lower)
      }
    }
  }

  // rgb/rgba colors
  const rgbMatches = html.matchAll(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/g)
  for (const m of rgbMatches) {
    const hex = '#' + [m[1], m[2], m[3]].map(n =>
      parseInt(n).toString(16).padStart(2, '0')
    ).join('')
    colorSet.add(hex)
  }

  return Array.from(colorSet).slice(0, 12)
}

// ── Brand-signal color extraction ──────────────────────────────────
// Rank candidate colors by how brand-representative they are, instead of
// flat-scanning every hex on the page. Signal sources (weighted):
//   1. <meta name="theme-color">           — the site's declared chrome color
//   2. CSS brand custom-properties          — --primary/--brand/--accent/...
//   3. header/hero/button/link declarations — visual surfaces the user sees
//   4. dominant colors of the og:image      — visual representation of the brand
// Each candidate accumulates a score; we dedupe near-duplicates (keeping the
// highest score) and return the top hits, brand color first.

interface ScoredColor {
  hex: string
  score: number
}

async function extractBrandColors(
  html: string,
  baseUrl: string,
  logoUrl: string | null,
): Promise<string[]> {
  const scores = new Map<string, number>()
  const add = (raw: string | null | undefined, weight: number) => {
    const hex = normalizeColor(raw)
    if (!hex || isUtilityColor(hex)) return
    scores.set(hex, (scores.get(hex) ?? 0) + weight)
  }

  // 1. theme-color meta — strongest single signal of intended brand chrome.
  for (const m of html.matchAll(/<meta[^>]{0,300}name=["']theme-color["'][^>]{0,300}content=["']([^"']+)["']/gi)) {
    add(m[1], 100)
  }
  for (const m of html.matchAll(/<meta[^>]{0,300}content=["']([^"']+)["'][^>]{0,300}name=["']theme-color["']/gi)) {
    add(m[1], 100)
  }

  // 2. CSS brand custom properties (--primary, --brand, --accent, --color-*).
  for (const m of html.matchAll(
    /--(?:color-)?(primary|brand|accent|secondary|main|theme|highlight)[\w-]*\s*:\s*([^;}\n]+)/gi,
  )) {
    const name = m[1].toLowerCase()
    const weight = name === 'primary' || name === 'brand' || name === 'main' ? 80 : 60
    add(m[2], weight)
  }

  // 3. Visual-surface declarations: header / hero / nav / button / link blocks.
  //    Capture background[-color] and color inside selectors that name brand
  //    surfaces. Bounded windows keep this ReDoS-safe.
  for (const m of html.matchAll(
    /(?:header|hero|banner|navbar|\.nav|button|\.btn|\.cta|a:hover|\.primary)[^{}]{0,200}\{([^{}]{0,800})\}/gi,
  )) {
    const block = m[1]
    for (const bg of block.matchAll(/background(?:-color)?\s*:\s*([^;}\n]+)/gi)) {
      // Pull the first color token out of shorthand (e.g. "url(...) #ff0 ...").
      add(firstColorToken(bg[1]), 50)
    }
    for (const c of block.matchAll(/(?<!background-)\bcolor\s*:\s*([^;}\n]+)/gi)) {
      add(firstColorToken(c[1]), 30)
    }
  }

  // 4. og:image dominant colors — the visual face of the brand. Resize to a
  //    tiny thumbnail and quantize via sharp's dominant + a coarse histogram.
  const ogImage = extractOgImage(html, baseUrl) || logoUrl
  if (ogImage) {
    try {
      const imgColors = await dominantColorsFromImage(ogImage)
      imgColors.forEach((hex, i) => add(hex, 70 - i * 12)) // 70, 58, 46, ...
    } catch (err) {
      logger.warn('og:image color extraction failed:', err)
    }
  }

  // Rank, then dedupe near-duplicates keeping the highest score.
  const ranked: ScoredColor[] = Array.from(scores.entries())
    .map(([hex, score]) => ({ hex, score }))
    .sort((a, b) => b.score - a.score)

  const out: ScoredColor[] = []
  for (const c of ranked) {
    if (!out.some((o) => colorDistance(o.hex, c.hex) < 28)) out.push(c)
    if (out.length >= 8) break
  }
  return out.map((c) => c.hex)
}

function extractOgImage(html: string, baseUrl: string): string | null {
  const patterns = [
    /<meta[^>]{0,300}property=["']og:image["'][^>]{0,300}content=["']([^"']+)["']/i,
    /<meta[^>]{0,300}content=["']([^"']+)["'][^>]{0,300}property=["']og:image["']/i,
    /<meta[^>]{0,300}name=["']twitter:image["'][^>]{0,300}content=["']([^"']+)["']/i,
  ]
  for (const p of patterns) {
    const m = html.match(p)
    if (m?.[1]) return resolveUrl(m[1], baseUrl)
  }
  return null
}

async function dominantColorsFromImage(imageUrl: string): Promise<string[]> {
  // SVGs have no raster pixels to sample meaningfully here — skip.
  if (/\.svg(\?|$)/i.test(imageUrl)) return []
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  let buf: Buffer
  try {
    const res = await fetch(imageUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    })
    if (!res.ok) return []
    buf = Buffer.from(await res.arrayBuffer())
  } finally {
    clearTimeout(timeout)
  }
  if (buf.length === 0 || buf.length > 12_000_000) return []

  // Downscale to a small thumbnail, read raw RGB, build a coarse 4-bit/channel
  // histogram, and return the most frequent *saturated* buckets (so we surface
  // the brand color, not the dominant off-white/grey background).
  const W = 48
  const { data, info } = await sharp(buf)
    .resize(W, W, { fit: 'inside' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const counts = new Map<number, { count: number; r: number; g: number; b: number; sat: number }>()
  const ch = info.channels
  for (let i = 0; i + ch - 1 < data.length; i += ch) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    const sat = max === 0 ? 0 : (max - min) / max
    const cur = counts.get(key)
    if (cur) {
      cur.count++; cur.r += r; cur.g += g; cur.b += b
    } else {
      counts.set(key, { count: 1, r, g, b, sat })
    }
  }

  const buckets = Array.from(counts.values())
    .map((v) => ({
      hex: rgbToHex(Math.round(v.r / v.count), Math.round(v.g / v.count), Math.round(v.b / v.count)),
      // Favour colored (saturated) buckets over near-grey ones, but keep some
      // weight on raw frequency so a strong flat brand color still wins.
      weight: v.count * (0.35 + v.sat),
      sat: v.sat,
    }))
    .filter((b) => !isUtilityColor(b.hex))
    .sort((a, b) => b.weight - a.weight)

  const out: string[] = []
  for (const b of buckets) {
    if (!out.some((o) => colorDistance(o, b.hex) < 28)) out.push(b.hex)
    if (out.length >= 4) break
  }
  return out
}

// ── Color utilities ────────────────────────────────────────────────

function normalizeColor(raw: string | null | undefined): string | null {
  if (!raw) return null
  const v = raw.trim().toLowerCase()
  const hex = v.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/)
  if (hex) {
    const h = hex[1]
    return h.length === 3 ? `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : `#${h}`
  }
  const rgb = v.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  if (rgb) return rgbToHex(+rgb[1], +rgb[2], +rgb[3])
  return null
}

function firstColorToken(value: string): string | null {
  const hex = value.match(/#[0-9a-fA-F]{3,6}\b/)
  if (hex) return normalizeColor(hex[0])
  const rgb = value.match(/rgba?\([^)]+\)/)
  if (rgb) return normalizeColor(rgb[0])
  return null
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}

// Reject near-black, near-white, and low-saturation greys — these are utility
// colors (text/borders/backgrounds), almost never the visual brand color.
function isUtilityColor(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex)
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const sat = max === 0 ? 0 : (max - min) / max
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  if (lum > 0.96 || lum < 0.05) return true     // near-white / near-black
  if (sat < 0.12 && lum > 0.15 && lum < 0.9) return true // grey
  return false
}

function dedupeColors(colors: string[]): string[] {
  const out: string[] = []
  for (const raw of colors) {
    const hex = normalizeColor(raw)
    if (!hex) continue
    if (!out.some((o) => colorDistance(o, hex) < 24)) out.push(hex)
  }
  return out
}

function resolveUrl(u: string, baseUrl: string): string {
  if (u.startsWith('//')) return 'https:' + u
  if (u.startsWith('/')) return new URL(baseUrl).origin + u
  if (!u.startsWith('http')) {
    try { return new URL(u, baseUrl).href } catch { return u }
  }
  return u
}

function extractFonts(html: string): string[] {
  const fontSet = new Set<string>()

  // font-family declarations
  const fontMatches = html.matchAll(/font-family:\s*([^;}"]+)/gi)
  for (const m of fontMatches) {
    const families = m[1].split(',').map(f => f.trim().replace(/['"]/g, ''))
    for (const f of families) {
      if (f && !['inherit', 'initial', 'sans-serif', 'serif', 'monospace', 'cursive'].includes(f.toLowerCase())) {
        fontSet.add(f)
      }
    }
  }

  // Google Fonts links
  const gfMatches = html.matchAll(/fonts\.googleapis\.com\/css2?\?family=([^"&]+)/g)
  for (const m of gfMatches) {
    const families = decodeURIComponent(m[1]).split('|').map(f => f.split(':')[0].replace(/\+/g, ' '))
    for (const f of families) {
      if (f) fontSet.add(f)
    }
  }

  return Array.from(fontSet).slice(0, 8)
}

function extractLogo(html: string, baseUrl: string): string | null {
  // Look for common logo patterns
  const patterns = [
    /property="og:image"\s+content="([^"]+)"/i,
    /name="og:image"\s+content="([^"]+)"/i,
    // Quantifiers are bounded ({1,400}/{0,200}) to prevent catastrophic
    // backtracking (ReDoS) on hostile/malformed HTML — tags are short.
    /<link[^>]{1,400}rel="icon"[^>]{1,400}href="([^"]+)"/i,
    /<link[^>]{1,400}rel="apple-touch-icon"[^>]{1,400}href="([^"]+)"/i,
    /<img[^>]{1,400}class="[^"]{0,200}logo[^"]{0,200}"[^>]{1,400}src="([^"]+)"/i,
    /<img[^>]{1,400}id="[^"]{0,200}logo[^"]{0,200}"[^>]{1,400}src="([^"]+)"/i,
    /<img[^>]{1,400}alt="[^"]{0,200}logo[^"]{0,200}"[^>]{1,400}src="([^"]+)"/i,
    /src="([^"]{0,200}logo[^"]{0,200}\.(png|svg|jpg|webp))"/i,
  ]

  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]) {
      let logoUrl = match[1]
      // Resolve relative URLs
      if (logoUrl.startsWith('//')) {
        logoUrl = 'https:' + logoUrl
      } else if (logoUrl.startsWith('/')) {
        const origin = new URL(baseUrl).origin
        logoUrl = origin + logoUrl
      }
      return logoUrl
    }
  }

  return null
}

function extractSiteName(html: string): string {
  const ogMatch = html.match(/property="og:site_name"\s+content="([^"]+)"/i)
  if (ogMatch) return ogMatch[1]

  const titleMatch = html.match(/<title>([^<]+)<\/title>/i)
  if (titleMatch) return titleMatch[1].split(/[|\-–—]/)[0].trim()

  return ''
}
