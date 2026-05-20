import { useState, useEffect } from 'react'
import { useStore } from '../store/useStore'
import type { OverlayStyling, BackgroundStyle, TextTransform } from '../../shared/types'
import { FONTS } from '../../shared/fonts'
import '../styles/styling.css'

export function StylingPanel() {
  const overlayState = useStore((s) => s.overlayState)
  const compactMode = useStore((s) => s.compactMode)
  const styling = overlayState?.lowerThird.styling
  const [collapsed, setCollapsed] = useState(false)

  // Auto-collapse in compact mode
  useEffect(() => {
    if (compactMode) setCollapsed(true)
  }, [compactMode])

  if (!styling) return null

  function update(changes: Partial<OverlayStyling>) {
    window.api.overlayUpdateStyling(changes)
  }

  return (
    <div className={`panel-section${collapsed ? ' collapsed' : ''}`}>
      <div className="panel-section-title" onClick={() => setCollapsed(!collapsed)}>
        Styling
        <span className="chevron">{collapsed ? '\u25B8' : '\u25BE'}</span>
      </div>
      {!collapsed && (
        <div className="styling-panel">
          {/* Font */}
          <div className="styling-row">
            <div className="styling-field flex-1">
              <label>Font Family</label>
              <select
                value={styling.fontFamily}
                onChange={(e) => update({ fontFamily: e.target.value })}
              >
                {FONTS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
            <div className="styling-field">
              <label>Size</label>
              <input
                type="number"
                value={styling.fontSize}
                onChange={(e) => update({ fontSize: Number(e.target.value) })}
                min={14}
                max={60}
                style={{ width: 70 }}
              />
            </div>
            <div className="styling-field">
              <label>Weight</label>
              <select
                value={styling.fontWeight}
                onChange={(e) => update({ fontWeight: Number(e.target.value) })}
                style={{ width: 90 }}
              >
                <option value={100}>Thin</option>
                <option value={200}>ExtraLight</option>
                <option value={300}>Light</option>
                <option value={400}>Normal</option>
                <option value={500}>Medium</option>
                <option value={600}>Semi</option>
                <option value={700}>Bold</option>
                <option value={800}>Extra</option>
                <option value={900}>Black</option>
              </select>
            </div>
          </div>

          {/* Colors */}
          <div className="styling-row">
            <div className="color-swatch">
              <label>Text</label>
              <input
                type="color"
                value={styling.textColor}
                onChange={(e) => update({ textColor: e.target.value })}
              />
            </div>
            <div className="color-swatch">
              <label>Background</label>
              <input
                type="color"
                value={styling.backgroundColor}
                onChange={(e) => update({ backgroundColor: e.target.value })}
              />
            </div>
            <div className="color-swatch">
              <label>Accent</label>
              <input
                type="color"
                value={styling.accentColor}
                onChange={(e) => update({ accentColor: e.target.value })}
              />
            </div>
          </div>

          {/* Background style */}
          <div className="styling-row">
            <div className="styling-field flex-1">
              <label>Background Style</label>
              <select
                value={styling.backgroundStyle}
                onChange={(e) => update({ backgroundStyle: e.target.value as BackgroundStyle })}
              >
                <option value="solid">Solid</option>
                <option value="gradient">Gradient</option>
                <option value="glass">Glass</option>
                <option value="accent-bar">Accent Bar</option>
              </select>
            </div>
            <div className="styling-field flex-1">
              <label>Border Radius: {styling.borderRadius}px</label>
              <input
                type="range"
                min={0}
                max={24}
                value={styling.borderRadius}
                onChange={(e) => update({ borderRadius: Number(e.target.value) })}
              />
            </div>
          </div>

          {/* Title text transform + letter spacing */}
          <div className="styling-row">
            <div className="styling-field flex-1">
              <label>Title Case</label>
              <select
                value={styling.titleTextTransform || 'none'}
                onChange={(e) => update({ titleTextTransform: e.target.value as TextTransform })}
              >
                <option value="none">As typed</option>
                <option value="uppercase">UPPERCASE</option>
                <option value="lowercase">lowercase</option>
                <option value="capitalize">Capitalize</option>
              </select>
            </div>
            <div className="styling-field flex-1">
              <label>Letter Spacing: {styling.titleLetterSpacing ?? 0}px</label>
              <input
                type="range"
                min={-2}
                max={12}
                value={styling.titleLetterSpacing ?? 0}
                onChange={(e) => update({ titleLetterSpacing: Number(e.target.value) })}
              />
            </div>
          </div>

          {/* Subtitle own styling */}
          <div className="styling-row">
            <div className="styling-field">
              <label>Subtitle Size</label>
              <input
                type="number"
                value={styling.subtitleFontSize || 0}
                onChange={(e) => update({ subtitleFontSize: Number(e.target.value) })}
                min={0}
                max={48}
                style={{ width: 70 }}
                title="0 = auto (70% of title size)"
              />
            </div>
            <div className="color-swatch">
              <label>Subtitle Color</label>
              <input
                type="color"
                value={styling.subtitleColor || styling.textColor}
                onChange={(e) => update({ subtitleColor: e.target.value })}
              />
            </div>
            <div className="styling-field" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn-sm btn-loop-off"
                onClick={() => update({ subtitleColor: '' })}
                title="Reset subtitle color to inherit the text color"
              >
                Inherit
              </button>
            </div>
          </div>

          {/* Legibility treatments */}
          <div className="styling-row">
            <label className="styling-checkbox" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={!!styling.textShadow}
                onChange={(e) => update({ textShadow: e.target.checked })}
              />
              Drop Shadow
            </label>
            <label className="styling-checkbox" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={!!styling.textGlow}
                onChange={(e) => update({ textGlow: e.target.checked })}
              />
              Accent Glow
            </label>
          </div>

          {/* Label chip (UP NEXT / THAT WAS / pinned) colors */}
          <div className="styling-row">
            <div className="color-swatch">
              <label>Label Text</label>
              <input
                type="color"
                value={styling.labelColor || '#1a1a2e'}
                onChange={(e) => update({ labelColor: e.target.value })}
              />
            </div>
            <div className="color-swatch">
              <label>Label Background</label>
              <input
                type="color"
                value={styling.labelBackgroundColor || '#667eea'}
                onChange={(e) => update({ labelBackgroundColor: e.target.value })}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
