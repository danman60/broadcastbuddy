import { useStore } from '../store/useStore'
import type { OverlayStyling, BackgroundStyle, AnimationType } from '../../shared/types'
import { FONTS } from '../../shared/fonts'
import '../styles/styling.css'

export function StylingPanel() {
  const overlayState = useStore((s) => s.overlayState)
  const styling = overlayState?.lowerThird.styling

  if (!styling) return null

  function update(changes: Partial<OverlayStyling>) {
    window.api.overlayUpdateStyling(changes)
  }

  return (
    <div className="panel-section">
      <div className="panel-section-title">Styling</div>
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
              style={{ width: 80 }}
            >
              <option value={400}>Normal</option>
              <option value={600}>Semi</option>
              <option value={700}>Bold</option>
              <option value={800}>Extra</option>
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

        {/* Background style + animation */}
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
            <label>Animation</label>
            <select
              value={styling.animation}
              onChange={(e) => update({ animation: e.target.value as AnimationType })}
            >
              <option value="slide">Slide</option>
              <option value="fade">Fade</option>
              <option value="zoom">Zoom</option>
              <option value="rise">Rise</option>
              <option value="typewriter">Typewriter</option>
              <option value="bounce">Bounce</option>
              <option value="split">Split</option>
              <option value="blur">Blur</option>
              <option value="random">Random</option>
            </select>
          </div>
        </div>

        {/* Border radius + auto-hide */}
        <div className="styling-row">
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
          <div className="styling-field">
            <label>Auto-hide (sec)</label>
            <input
              type="number"
              value={styling.autoHideSeconds}
              onChange={(e) => update({ autoHideSeconds: Number(e.target.value) })}
              min={0}
              max={60}
              style={{ width: 70 }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
