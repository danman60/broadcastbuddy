import { useState } from 'react'
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

  async function handleScrape(useAI: boolean) {
    if (!url.trim()) return
    setError(null)
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
