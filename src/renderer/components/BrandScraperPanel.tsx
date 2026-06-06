import { useState } from 'react'
import { buildBrandStyling, buildBrandTicker, buildBrandStartingSoon } from '../../shared/brandKit'
import type { UserStylePreset } from '../../shared/types'
import '../styles/brandscraper.css'

interface BrandResult {
  colors: string[]
  fonts: string[]
  logoUrl: string | null
  siteName: string
  aiSuggestion?: string
}

export function BrandScraperPanel() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<BrandResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null) // transient success line
  const [busy, setBusy] = useState(false) // apply/import/preset in flight

  async function handleScrape(useAI: boolean) {
    if (!url.trim()) return
    setError(null)
    setStatus(null)
    setLoading(true)

    try {
      const data = useAI
        ? await window.api.brandScrapeAI(url)
        : await window.api.brandScrape(url)
      setResult(data)

      // If AI returned a suggestion, try to apply it
      if (useAI && data.aiSuggestion) {
        try {
          let json = data.aiSuggestion.trim()
          if (json.startsWith('```')) {
            json = json.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
          }
          const parsed = JSON.parse(json)
          await window.api.overlayUpdateStyling(parsed)
        } catch {
          // AI suggestion parsing failed — still show raw results
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scrape failed')
    } finally {
      setLoading(false)
    }
  }

  async function applyColor(color: string, target: 'bg' | 'text' | 'accent') {
    const updates: Record<string, string> = {}
    if (target === 'bg') updates.backgroundColor = color
    if (target === 'text') updates.textColor = color
    if (target === 'accent') updates.accentColor = color
    await window.api.overlayUpdateStyling(updates)
  }

  async function applyFont(font: string) {
    await window.api.overlayUpdateStyling({ fontFamily: `'${font}', sans-serif` })
  }

  // ── One brand style applied to the WHOLE display ────────────────
  async function applyBrandKit() {
    if (!result) return
    setBusy(true)
    setStatus(null)
    setError(null)
    try {
      const brand = { colors: result.colors, fonts: result.fonts, siteName: result.siteName }
      // 1. Complete lower-third + feature-card theme (global styling + elements).
      await window.api.overlayUpdateStyling(buildBrandStyling(brand))
      // 2. Ticker strip colors.
      await window.api.tickerUpdate(buildBrandTicker(brand))
      // 3. Starting-Soon scene (gradient design + base colors).
      await window.api.startingSoonUpdate(buildBrandStartingSoon(brand))
      setStatus('Brand kit applied to lower-third, ticker, feature card & Starting Soon')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed')
    } finally {
      setBusy(false)
    }
  }

  // ── Save the brand-derived styling as a named user preset ───────
  async function createPreset() {
    if (!result) return
    const defaultName = result.siteName || 'Brand Preset'
    const name = window.prompt('Preset name', defaultName)
    if (!name) return
    setBusy(true)
    setStatus(null)
    setError(null)
    try {
      const brand = { colors: result.colors, fonts: result.fonts, siteName: result.siteName }
      const preset: UserStylePreset = {
        id: `user-${Date.now()}`,
        name,
        description: `Brand kit from ${result.siteName || url}`,
        styling: buildBrandStyling(brand),
        source: 'user',
        createdAt: new Date().toISOString(),
      }
      await window.api.userPresetsAdd(preset)
      window.dispatchEvent(new CustomEvent('user-presets-changed'))
      setStatus(`Saved preset "${name}" — find it in Template Presets`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save preset failed')
    } finally {
      setBusy(false)
    }
  }

  // ── Import scraped logo as the CLIENT logo ──────────────────────
  async function importLogo() {
    if (!result?.logoUrl) return
    setBusy(true)
    setStatus(null)
    setError(null)
    try {
      const dataUrl = await window.api.brandFetchLogo(result.logoUrl)
      if (!dataUrl) {
        setError('Could not fetch that logo image')
        return
      }
      const state = await window.api.overlayGetState()
      const company = state?.companyLogo?.dataUrl || ''
      await window.api.overlaySetLogos(company, dataUrl)
      setStatus('Logo imported as Client Logo (top-right)')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import logo failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel-section">
      <div className="panel-section-title">Brand Kit Scraper</div>
      <div className="brand-scraper">
        <div className="brand-url-row">
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label>Website URL</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="example.com"
              onKeyDown={(e) => e.key === 'Enter' && handleScrape(false)}
            />
          </div>
        </div>
        <div className="brand-actions">
          <button
            className="btn btn-primary btn-sm"
            onClick={() => handleScrape(false)}
            disabled={loading}
          >
            {loading ? 'Scanning...' : 'Scan Website'}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => handleScrape(true)}
            disabled={loading}
          >
            Scan + AI Suggest
          </button>
        </div>

        {error && <div className="import-error">{error}</div>}

        {result && (
          <div className="brand-results">
            {result.siteName && (
              <div className="brand-site-name">{result.siteName}</div>
            )}

            {/* Primary one-click actions — theme the whole display, save it,
                import the logo. */}
            <div className="brand-kit-actions">
              <button
                className="btn btn-primary btn-sm"
                onClick={applyBrandKit}
                disabled={busy || result.colors.length === 0}
                title="Theme lower-third, ticker, feature card & Starting Soon from this brand"
              >
                Apply Brand Kit
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={createPreset}
                disabled={busy || result.colors.length === 0}
                title="Save this brand styling as a named preset"
              >
                Create Preset
              </button>
              {result.logoUrl && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={importLogo}
                  disabled={busy}
                  title="Fetch the scraped logo and set it as the Client logo"
                >
                  Import as Client Logo
                </button>
              )}
            </div>

            {status && <div className="brand-status">{status}</div>}

            {result.colors.length > 0 && (
              <div>
                <label>Colors (click to apply)</label>
                <div className="brand-colors">
                  {result.colors.map((color, i) => (
                    <div
                      key={i}
                      className="brand-color-chip"
                      style={{ background: color }}
                      title={`${color} — click: bg, shift: text, alt: accent`}
                      onClick={(e) => {
                        if (e.shiftKey) applyColor(color, 'text')
                        else if (e.altKey) applyColor(color, 'accent')
                        else applyColor(color, 'bg')
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {result.fonts.length > 0 && (
              <div>
                <label>Fonts (click to apply)</label>
                <div className="brand-fonts">
                  {result.fonts.map((font, i) => (
                    <button
                      key={i}
                      className="brand-font-chip"
                      style={{ fontFamily: font }}
                      onClick={() => applyFont(font)}
                    >
                      {font}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {result.logoUrl && (
              <div>
                <label>Logo found</label>
                <img
                  className="brand-logo-preview"
                  src={result.logoUrl}
                  alt="Logo"
                  onError={(e) => (e.currentTarget.style.display = 'none')}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
