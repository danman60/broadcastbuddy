import { useState } from 'react'
import { useStore } from '../store/useStore'
import type { AnimationType, EasingType, OverlayStyling } from '../../shared/types'
import '../styles/animation.css'

const ANIMATIONS: { value: AnimationType; label: string }[] = [
  { value: 'slide', label: 'Slide' },
  { value: 'fade', label: 'Fade' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'rise', label: 'Rise' },
  { value: 'typewriter', label: 'Typewriter' },
  { value: 'bounce', label: 'Bounce' },
  { value: 'split', label: 'Split' },
  { value: 'blur', label: 'Blur' },
  { value: 'sparkle', label: 'Sparkle' },
  { value: 'random', label: 'Random' },
]

const EASINGS: { value: EasingType; label: string }[] = [
  { value: 'ease', label: 'Ease' },
  { value: 'ease-in', label: 'Ease In' },
  { value: 'ease-out', label: 'Ease Out' },
  { value: 'ease-in-out', label: 'Ease In-Out' },
  { value: 'linear', label: 'Linear' },
  { value: 'bounce', label: 'Bounce' },
  { value: 'elastic', label: 'Elastic' },
]

export function AnimationPanel() {
  const overlayState = useStore((s) => s.overlayState)
  const styling = overlayState?.lowerThird.styling
  const [collapsed, setCollapsed] = useState(false)

  if (!styling) return null

  function update(changes: Partial<OverlayStyling>) {
    window.api.overlayUpdateStyling(changes)
  }

  const current = styling.animation
  const duration = styling.animationDuration ?? 0.5
  const easing = styling.animationEasing ?? 'ease'

  return (
    <div className={`panel-section${collapsed ? ' collapsed' : ''}`}>
      <div className="panel-section-title" onClick={() => setCollapsed(!collapsed)}>
        Animation
        <span className="chevron">{collapsed ? '\u25B8' : '\u25BE'}</span>
      </div>
      {!collapsed && (
        <div className="animation-panel">
          {/* Animation type grid */}
          <div className="anim-grid">
            {ANIMATIONS.map((a) => (
              <button
                key={a.value}
                className={`anim-chip ${current === a.value ? 'active' : ''} ${a.value === 'random' ? 'anim-chip-random' : ''}`}
                onClick={() => update({ animation: a.value })}
              >
                {a.label}
              </button>
            ))}
          </div>

          {/* Duration + Easing row */}
          <div className="anim-settings-row">
            <div className="anim-field">
              <label>Duration</label>
              <div className="anim-duration-group">
                <input
                  type="range"
                  min={0.1}
                  max={2}
                  step={0.1}
                  value={duration}
                  onChange={(e) => update({ animationDuration: Number(e.target.value) })}
                />
                <span className="anim-duration-val">{duration.toFixed(1)}s</span>
              </div>
            </div>
            <div className="anim-field">
              <label>Easing</label>
              <select
                value={easing}
                onChange={(e) => update({ animationEasing: e.target.value as EasingType })}
              >
                {EASINGS.map((e) => (
                  <option key={e.value} value={e.value}>{e.label}</option>
                ))}
              </select>
            </div>
            <div className="anim-field">
              <label>Auto-hide</label>
              <div className="anim-duration-group">
                <input
                  type="number"
                  value={styling.autoHideSeconds}
                  onChange={(e) => update({ autoHideSeconds: Number(e.target.value) })}
                  min={0}
                  max={60}
                  style={{ width: 60 }}
                />
                <span className="anim-duration-val">sec</span>
              </div>
            </div>
          </div>

          {/* Quick preview button */}
          <button
            className="btn btn-ghost btn-sm anim-test-btn"
            onClick={() => {
              window.api.overlayHideLT()
              setTimeout(() => window.api.overlayFireLT(), 400)
            }}
          >
            Test Animation
          </button>
        </div>
      )}
    </div>
  )
}
