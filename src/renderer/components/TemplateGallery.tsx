import { useState, useEffect, useCallback } from 'react'
import { useStore } from '../store/useStore'
import { PRESETS } from '../../shared/presets'
import type { OverlayStyling, UserStylePreset } from '../../shared/types'
import '../styles/templates.css'

// Built-in presets and user presets share this shape in the gallery.
interface GalleryPreset {
  id: string
  name: string
  description: string
  styling: OverlayStyling
  isUser: boolean
}

export function TemplateGallery() {
  const compactMode = useStore((s) => s.compactMode)
  const [collapsed, setCollapsed] = useState(false)
  const [userPresets, setUserPresets] = useState<UserStylePreset[]>([])

  // Auto-collapse in compact mode
  useEffect(() => {
    if (compactMode) setCollapsed(true)
  }, [compactMode])

  const loadUserPresets = useCallback(async () => {
    try {
      const list = await window.api.userPresetsList()
      setUserPresets(list ?? [])
    } catch {
      setUserPresets([])
    }
  }, [])

  // Load on mount + refresh when BrandScraperPanel saves a new one.
  useEffect(() => {
    loadUserPresets()
    const onChanged = () => loadUserPresets()
    window.addEventListener('user-presets-changed', onChanged)
    return () => window.removeEventListener('user-presets-changed', onChanged)
  }, [loadUserPresets])

  async function applyPreset(styling: OverlayStyling) {
    await window.api.overlayUpdateStyling(styling)
  }

  async function deletePreset(e: React.MouseEvent, id: string) {
    e.stopPropagation() // don't apply when deleting
    await window.api.userPresetsDelete(id)
    loadUserPresets()
  }

  const builtIn: GalleryPreset[] = PRESETS.map((p) => ({ ...p, isUser: false }))
  const user: GalleryPreset[] = userPresets.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    styling: p.styling,
    isUser: true,
  }))
  const all = [...user, ...builtIn]

  return (
    <div className={`panel-section${collapsed ? ' collapsed' : ''}`}>
      <div className="panel-section-title" onClick={() => setCollapsed(!collapsed)}>
        Template Presets
        <span className="chevron">{collapsed ? '▸' : '▾'}</span>
      </div>
      {!collapsed && (
        <div className="template-gallery">
          {all.map((preset) => {
            const s = preset.styling
            const bgStyle =
              s.backgroundStyle === 'gradient'
                ? `linear-gradient(135deg, ${s.backgroundColor}, ${s.accentColor})`
                : s.backgroundStyle === 'glass'
                  ? 'rgba(0,0,0,0.6)'
                  : s.backgroundColor
            const borderLeft =
              s.backgroundStyle === 'accent-bar' ? `3px solid ${s.accentColor}` : 'none'

            return (
              <div
                key={preset.id}
                className="template-card"
                onClick={() => applyPreset(preset.styling)}
              >
                {preset.isUser && (
                  <button
                    className="template-delete"
                    title="Delete preset"
                    onClick={(e) => deletePreset(e, preset.id)}
                  >
                    {'×'}
                  </button>
                )}
                <div
                  className="template-preview"
                  style={{
                    background: bgStyle,
                    borderLeft,
                    borderRadius: s.borderRadius,
                    fontFamily: s.fontFamily,
                    color: s.textColor,
                  }}
                >
                  <div>
                    <div className="template-preview-title">Sample Title</div>
                    <div className="template-preview-sub">Subtitle text</div>
                  </div>
                </div>
                <div className="template-name">
                  {preset.name}
                  {preset.isUser && <span className="template-badge">SAVED</span>}
                </div>
                <div className="template-desc">{preset.description}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
