import { createLogger } from '../logger'
import * as settings from './settings'

const logger = createLogger('brandScraper')

export interface BrandKit {
  colors: string[]         // hex colors found
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
    html = await response.text()
  } catch (err) {
    throw new Error(`Failed to fetch ${url}: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearTimeout(timeout)
  }

  // Extract colors from inline styles and CSS
  const colors = extractColors(html)

  // Extract font families
  const fonts = extractFonts(html)

  // Extract logo
  const logoUrl = extractLogo(html, url)

  // Extract site name
  const siteName = extractSiteName(html)

  const result: BrandKit = { colors, fonts, logoUrl, siteName }
  logger.info(`Brand kit extracted: ${colors.length} colors, ${fonts.length} fonts, logo: ${!!logoUrl}`)
  return result
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
    /<link[^>]+rel="icon"[^>]+href="([^"]+)"/i,
    /<link[^>]+rel="apple-touch-icon"[^>]+href="([^"]+)"/i,
    /<img[^>]+class="[^"]*logo[^"]*"[^>]+src="([^"]+)"/i,
    /<img[^>]+id="[^"]*logo[^"]*"[^>]+src="([^"]+)"/i,
    /<img[^>]+alt="[^"]*logo[^"]*"[^>]+src="([^"]+)"/i,
    /src="([^"]*logo[^"]*\.(png|svg|jpg|webp))"/i,
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
