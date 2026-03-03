import { PRESETS } from '../../shared/presets'
import type { OverlayStyling } from '../../shared/types'
import '../styles/templates.css'

export function TemplateGallery() {
  async function applyPreset(styling: OverlayStyling) {
    await window.api.overlayUpdateStyling(styling)
  }

  return (
    <div className="panel-section">
      <div className="panel-section-title">Template Presets</div>
      <div className="template-gallery">
        {PRESETS.map((preset) => {
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
              <div className="template-name">{preset.name}</div>
              <div className="template-desc">{preset.description}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
