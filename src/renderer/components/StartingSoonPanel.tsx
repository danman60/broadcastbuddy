import { useState } from 'react'
import { useStore } from '../store/useStore'
import type { StartingSoonState } from '../../shared/types'
import '../styles/startingSoon.css'

export function StartingSoonPanel() {
  const overlayState = useStore((s) => s.overlayState)
  const [collapsed, setCollapsed] = useState(true)

  if (!overlayState) return null

  const ss = overlayState.startingSoon

  function update(changes: Partial<StartingSoonState>) {
    window.api.startingSoonUpdate(changes)
  }

  function toggleShow() {
    if (ss.visible) {
      window.api.startingSoonHide()
    } else {
      window.api.startingSoonShow()
    }
  }

  // Set countdown target to X minutes from now
  function setCountdownMinutes(minutes: number) {
    const target = new Date(Date.now() + minutes * 60 * 1000).toISOString()
    update({ countdownTarget: target })
  }

  return (
    <div className={`panel-section${collapsed ? ' collapsed' : ''}`}>
      <div className="panel-section-title" onClick={() => setCollapsed(!collapsed)}>
        Starting Soon
        {ss.visible && <span className="ss-live-badge">LIVE</span>}
        <span className="chevron">{collapsed ? '\u25B8' : '\u25BE'}</span>
      </div>
      {!collapsed && (
        <div className="starting-soon-panel">
          {/* Title + Subtitle */}
          <div className="ss-field">
            <label>Title</label>
            <input
              type="text"
              value={ss.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder="Starting Soon"
            />
          </div>
          <div className="ss-field">
            <label>Subtitle</label>
            <input
              type="text"
              value={ss.subtitle}
              onChange={(e) => update({ subtitle: e.target.value })}
              placeholder="The show begins shortly..."
            />
          </div>

          {/* Countdown */}
          <div className="ss-countdown-section">
            <label>
              <input
                type="checkbox"
                checked={ss.showCountdown}
                onChange={(e) => update({ showCountdown: e.target.checked })}
              />
              Show Countdown
            </label>
            {ss.showCountdown && (
              <div className="ss-countdown-presets">
                {[5, 10, 15, 30].map((m) => (
                  <button
                    key={m}
                    className="btn btn-ghost btn-sm"
                    onClick={() => setCountdownMinutes(m)}
                  >
                    {m}m
                  </button>
                ))}
                <div className="ss-field" style={{ marginTop: 4 }}>
                  <label>Custom time</label>
                  <input
                    type="datetime-local"
                    value={ss.countdownTarget ? new Date(ss.countdownTarget).toISOString().slice(0, 16) : ''}
                    onChange={(e) => {
                      const val = e.target.value
                      update({ countdownTarget: val ? new Date(val).toISOString() : '' })
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Colors */}
          <div className="ss-colors">
            <div className="ss-color-field">
              <label>BG</label>
              <input
                type="color"
                value={ss.backgroundColor}
                onChange={(e) => update({ backgroundColor: e.target.value })}
              />
            </div>
            <div className="ss-color-field">
              <label>Text</label>
              <input
                type="color"
                value={ss.textColor}
                onChange={(e) => update({ textColor: e.target.value })}
              />
            </div>
            <div className="ss-color-field">
              <label>Accent</label>
              <input
                type="color"
                value={ss.accentColor}
                onChange={(e) => update({ accentColor: e.target.value })}
              />
            </div>
          </div>

          {/* Show/Hide */}
          <button
            className={`btn btn-sm ss-toggle ${ss.visible ? 'btn-danger' : 'btn-primary'}`}
            onClick={toggleShow}
          >
            {ss.visible ? 'Hide Starting Soon' : 'Show Starting Soon'}
          </button>
        </div>
      )}
    </div>
  )
}
