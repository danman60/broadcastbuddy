import { useState, useEffect } from 'react'
import { useStore } from '../store/useStore'

export function LogoManager() {
  const overlayState = useStore((s) => s.overlayState)
  const compactMode = useStore((s) => s.compactMode)
  const [collapsed, setCollapsed] = useState(false)

  // Auto-collapse in compact mode
  useEffect(() => {
    if (compactMode) setCollapsed(true)
  }, [compactMode])

  const companyLogo = overlayState?.companyLogo.dataUrl || ''
  const clientLogo = overlayState?.clientLogo.dataUrl || ''

  // Persistent graphics / feature-card logo lives in the main process (not on
  // overlayState), so mirror it in local state and load it on mount.
  const [featureCardLogo, setFeatureCardLogo] = useState('')
  useEffect(() => {
    window.api.overlayGetFeatureCardLogo().then((url) => setFeatureCardLogo(url || ''))
  }, [])

  async function browseFeatureCardLogo() {
    const dataUrl = await window.api.logoBrowse()
    if (dataUrl) {
      await window.api.overlaySetFeatureCardLogo(dataUrl)
      setFeatureCardLogo(dataUrl)
    }
  }

  async function clearFeatureCardLogo() {
    await window.api.overlaySetFeatureCardLogo('')
    setFeatureCardLogo('')
  }

  async function browseCompanyLogo() {
    const dataUrl = await window.api.logoBrowse()
    if (dataUrl) {
      await window.api.overlaySetLogos(dataUrl, clientLogo)
    }
  }

  async function browseClientLogo() {
    const dataUrl = await window.api.logoBrowse()
    if (dataUrl) {
      await window.api.overlaySetLogos(companyLogo, dataUrl)
    }
  }

  async function clearCompanyLogo() {
    await window.api.overlaySetLogos('', clientLogo)
  }

  async function clearClientLogo() {
    await window.api.overlaySetLogos(companyLogo, '')
  }

  return (
    <div className={`panel-section${collapsed ? ' collapsed' : ''}`}>
      <div className="panel-section-title" onClick={() => setCollapsed(!collapsed)}>
        Logos
        <span className="chevron">{collapsed ? '\u25B8' : '\u25BE'}</span>
      </div>
      {!collapsed && (
        <div style={{ display: 'flex', gap: 16 }}>
          {/* Company logo */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label>Company Logo (top-left)</label>
            {companyLogo ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <img
                  src={companyLogo}
                  alt="Company"
                  style={{ maxHeight: 40, maxWidth: 100, borderRadius: 4 }}
                />
                <button className="btn btn-ghost btn-sm" onClick={clearCompanyLogo}>
                  Clear
                </button>
              </div>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={browseCompanyLogo}>
                Browse...
              </button>
            )}
          </div>

          {/* Client logo */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label>Client Logo (top-right)</label>
            {clientLogo ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <img
                  src={clientLogo}
                  alt="Client"
                  style={{ maxHeight: 40, maxWidth: 100, borderRadius: 4 }}
                />
                <button className="btn btn-ghost btn-sm" onClick={clearClientLogo}>
                  Clear
                </button>
              </div>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={browseClientLogo}>
                Browse...
              </button>
            )}
          </div>

          {/* Feature card / graphics logo — persistent, independent of the
              per-trigger logo. Used on the full-screen UP NEXT / THAT WAS card. */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label>Feature Card Logo (graphics)</label>
            {featureCardLogo ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <img
                  src={featureCardLogo}
                  alt="Feature card"
                  style={{ maxHeight: 40, maxWidth: 100, borderRadius: 4 }}
                />
                <button className="btn btn-ghost btn-sm" onClick={clearFeatureCardLogo}>
                  Clear
                </button>
              </div>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={browseFeatureCardLogo}>
                Browse...
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
