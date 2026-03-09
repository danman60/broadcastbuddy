import { useState } from 'react'
import { useStore } from '../store/useStore'
import type { StartingSoonState } from '../../shared/types'
import '../styles/startingSoon.css'

export function StartingSoonPanel() {
  const overlayState = useStore((s) => s.overlayState)
  const [collapsed, setCollapsed] = useState(true)
  const [mins, setMins] = useState(10)
  const [secs, setSecs] = useState(0)

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

  function startCountdown() {
    const totalSecs = mins * 60 + secs
    if (totalSecs <= 0) return
    const target = new Date(Date.now() + totalSecs * 1000).toISOString()
    update({ countdownTarget: target, countdownSeconds: totalSecs })
  }

  function setPreset(minutes: number) {
    setMins(minutes)
    setSecs(0)
    const target = new Date(Date.now() + minutes * 60 * 1000).toISOString()
    update({ countdownTarget: target, countdownSeconds: minutes * 60 })
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
          <div className="ss-field">
            <label>Completion Text</label>
            <input
              type="text"
              value={ss.completionText}
              onChange={(e) => update({ completionText: e.target.value })}
              placeholder="We're Live!"
            />
            <span className="ss-hint">Shown when countdown reaches 00:00</span>
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
              <>
                {/* Exact time input */}
                <div className="ss-time-input">
                  <div className="ss-time-field">
                    <input
                      type="number"
                      min={0}
                      max={180}
                      value={mins}
                      onChange={(e) => setMins(Math.max(0, Number(e.target.value)))}
                      onPointerDown={(e) => e.stopPropagation()}
                    />
                    <span>min</span>
                  </div>
                  <span className="ss-time-sep">:</span>
                  <div className="ss-time-field">
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={secs}
                      onChange={(e) => setSecs(Math.min(59, Math.max(0, Number(e.target.value))))}
                      onPointerDown={(e) => e.stopPropagation()}
                    />
                    <span>sec</span>
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={startCountdown}>
                    Set
                  </button>
                </div>

                {/* Quick presets */}
                <div className="ss-countdown-presets">
                  {[5, 10, 15, 30].map((m) => (
                    <button
                      key={m}
                      className="btn btn-ghost btn-sm"
                      onClick={() => setPreset(m)}
                    >
                      {m}m
                    </button>
                  ))}
                </div>
              </>
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
