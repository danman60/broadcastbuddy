import { useEffect, useState, useCallback } from 'react'
import { useStore } from '../store/useStore'
import type { LoopMode } from '../../shared/types'
import '../styles/controls.css'

const LOOP_CYCLE: LoopMode[] = ['none', 'loop', 'ping-pong']
const LOOP_LABELS: Record<LoopMode, string> = {
  'none': 'Loop: Off',
  'loop': 'Loop',
  'ping-pong': 'Ping-Pong',
}

export function OverlayControls() {
  const overlayState = useStore((s) => s.overlayState)
  const { triggers, selectedIndex, playedIds, loopMode } = useStore()
  const isVisible = overlayState?.lowerThird.visible ?? false

  const [autoFire, setAutoFire] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const gridVisible = overlayState?.gridVisible ?? false

  // Broadcast-chrome elements (clock / feature card)
  const clock = overlayState?.clock
  const featureCard = overlayState?.featureCard
  const [fcKicker, setFcKicker] = useState('UP NEXT')
  const [fcTitle, setFcTitle] = useState('')
  const [fcSubtitle, setFcSubtitle] = useState('')

  // Fetch autoFire state on mount
  useEffect(() => {
    window.api.playlistGetStatus().then((s) => setAutoFire(s.autoFire))
  }, [])

  async function handleAutoFireToggle() {
    const enabled = await window.api.playlistAutoFireToggle()
    setAutoFire(enabled)
  }

  async function handleUpNext() {
    await window.api.overlayFireUpNext()
  }

  async function handleThatWas() {
    await window.api.overlayFireThatWas()
  }

  async function handleGridToggle() {
    await window.api.overlayGridToggle()
  }

  // ── Clock ──
  async function handleClockToggle() {
    await window.api.overlayClockToggle()
  }
  async function handleClockFormat(format: '12h' | '24h') {
    await window.api.overlayClockUpdate({ format })
  }
  async function handleClockSeconds() {
    await window.api.overlayClockUpdate({ showSeconds: !(clock?.showSeconds ?? true) })
  }

  // ── Feature card ──
  async function handleFeatureUpNext() {
    await window.api.overlayFeatureUpNext()
  }
  async function handleFeatureThatWas() {
    await window.api.overlayFeatureThatWas()
  }
  async function handleFeatureShow() {
    if (!fcTitle.trim()) return
    await window.api.overlayFeatureShow({ kicker: fcKicker, title: fcTitle, subtitle: fcSubtitle, animateIn: 'slide-up' })
  }
  async function handleFeatureHide() {
    await window.api.overlayFeatureHide()
  }

  async function handleLoopCycle() {
    const currentIdx = LOOP_CYCLE.indexOf(loopMode as LoopMode)
    const nextMode = LOOP_CYCLE[(currentIdx + 1) % LOOP_CYCLE.length]
    await window.api.playlistSetLoopMode(nextMode)
  }

  async function handleResetPosition() {
    await window.api.playlistResetPosition()
  }

  async function handleClearPlayed() {
    await window.api.playlistClearPlayed()
  }

  async function handleClearAll() {
    if (!window.confirm('Remove all triggers? This cannot be undone.')) return
    await window.api.triggerClearAll()
  }

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't fire shortcuts when typing in inputs
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return

    switch (e.code) {
      case 'Space':
        e.preventDefault()
        if (isVisible) window.api.overlayHideLT()
        else window.api.overlayFireLT()
        break
      case 'ArrowRight':
        e.preventDefault()
        if (e.shiftKey) window.api.triggerNextFull()
        else window.api.triggerNext()
        break
      case 'ArrowLeft':
        e.preventDefault()
        window.api.triggerPrev()
        break
      case 'Escape':
        e.preventDefault()
        window.api.overlayHideLT()
        break
      case 'Enter':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault()
          window.api.triggerNextFull()
        }
        break
    }
  }, [isVisible])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const current = selectedIndex + 1
  const total = triggers.length
  const upNext = selectedIndex + 1 < triggers.length ? triggers[selectedIndex + 1] : null
  const playedCount = playedIds.length
  const loopActive = loopMode !== 'none'
  // Up Next / That Was wrap in loop/ping-pong; in 'none' mode they need a real
  // neighbour, so disable at the ends of the list.
  const wraps = loopMode !== 'none'
  const hasNext = total > 0 && (wraps || (selectedIndex >= 0 && selectedIndex < total - 1))
  const hasPrev = total > 0 && (wraps || selectedIndex > 0)

  return (
    <div className={`panel-section${collapsed ? ' collapsed' : ''}`}>
      <div className="panel-section-title" onClick={() => setCollapsed(!collapsed)}>
        Playlist Controls
        <span className="chevron">{collapsed ? '\u25B8' : '\u25BE'}</span>
      </div>
      {!collapsed && (
        <div className="ctl">
          {/* ── Hero: Fire / Hide + status ── */}
          <div className="ctl-hero">
            <div className="ctl-hero-actions">
              <button className="btn-fire" onClick={() => window.api.overlayFireLT()}>
                Fire
              </button>
              <button className="btn-hide" onClick={() => window.api.overlayHideLT()}>
                Hide
              </button>
            </div>
            <div className="ctl-hero-status">
              <span className={`status-dot ${isVisible ? 'live' : ''}`} />
              <span className="ctl-live-label">{isVisible ? 'LIVE' : 'OFF'}</span>
              {total > 0 && <span className="controls-playlist-pos">{current} / {total}</span>}
              {playedCount > 0 && <span className="controls-played-badge">{playedCount} played</span>}
              {upNext && (
                <span className="controls-up-next">
                  Up next: <span className="controls-up-next-name">{upNext.title || upNext.name}</span>
                </span>
              )}
            </div>
          </div>

          {/* ── Playlist navigation ── */}
          <div className="ctl-group">
            <span className="ctl-label">Playlist</span>
            <div className="ctl-row">
              <div className="seg">
                <button className="seg-btn" onClick={() => window.api.triggerPrev()}>Prev</button>
                <button className="seg-btn" onClick={() => window.api.triggerNext()}>Next</button>
                <button
                  className="seg-btn seg-accent"
                  onClick={() => window.api.triggerNextFull()}
                  title="Advance + Fire (Ctrl+Enter or Shift+Right)"
                >
                  Next + Fire
                </button>
              </div>
              <button
                className={`toggle ${autoFire ? 'on' : ''}`}
                onClick={handleAutoFireToggle}
                title="Auto-fire on Next/Prev"
              >
                Auto {autoFire ? 'ON' : 'OFF'}
              </button>
              <button
                className={`toggle ${loopActive ? 'on' : ''}`}
                onClick={handleLoopCycle}
                title="Cycle loop mode: Off → Loop → Ping-Pong"
              >
                {LOOP_LABELS[loopMode as LoopMode] || 'Loop: Off'}
              </button>
              <span className="ctl-spacer" />
              <div className="ctl-bulk-cluster">
                <button className="btn-bulk" onClick={handleResetPosition} title="Jump to trigger #1">
                  Reset Pos
                </button>
                <button className="btn-bulk" onClick={handleClearPlayed} title="Clear all played indicators">
                  Clear Played
                </button>
                <button className="btn-bulk btn-bulk-danger" onClick={handleClearAll} title="Remove all triggers">
                  Clear All
                </button>
              </div>
            </div>
          </div>

          {/* ── Lower-third graphics ── */}
          <div className="ctl-group">
            <span className="ctl-label">Graphics</span>
            <div className="ctl-row">
              <div className="seg">
                <button
                  className="seg-btn"
                  onClick={handleUpNext}
                  disabled={!hasNext}
                  title="Fire the NEXT trigger as a lower-third labelled UP NEXT (does not advance position)"
                >
                  Up Next
                </button>
                <button
                  className="seg-btn"
                  onClick={handleThatWas}
                  disabled={!hasPrev}
                  title="Fire the PREVIOUS trigger as a lower-third labelled THAT WAS (does not advance position)"
                >
                  That Was
                </button>
              </div>
              <button
                className={`toggle ${gridVisible ? 'on' : ''}`}
                onClick={handleGridToggle}
                title="Toggle the rule-of-thirds leveling grid on the OBS browser source (operator-only — turn off before going live)"
              >
                Grid {gridVisible ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          {/* ── On-air clock ── */}
          <div className="ctl-group">
            <span className="ctl-label">Clock</span>
            <div className="ctl-row">
              <div className="seg">
                <button
                  className={`seg-btn seg-toggle ${clock?.visible ? 'on' : ''}`}
                  onClick={handleClockToggle}
                  title="Show/hide the on-air wall clock"
                >
                  Clock {clock?.visible ? 'ON' : 'OFF'}
                </button>
                <button
                  className="seg-btn"
                  onClick={() => handleClockFormat(clock?.format === '24h' ? '12h' : '24h')}
                  title="Toggle 12h / 24h time format"
                >
                  {clock?.format === '24h' ? '24h' : '12h'}
                </button>
                <button
                  className={`seg-btn seg-toggle ${clock?.showSeconds ? 'on' : ''}`}
                  onClick={handleClockSeconds}
                  title="Toggle seconds display"
                >
                  Secs {clock?.showSeconds ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>
          </div>

          {/* ── Full-screen feature card ── */}
          <div className="ctl-group">
            <span className="ctl-label">Feature Card</span>
            <div className="ctl-row">
              <div className="seg">
                <button
                  className="seg-btn"
                  onClick={handleFeatureUpNext}
                  disabled={!hasNext}
                  title="Show the NEXT trigger as a full-screen UP NEXT feature card (does not advance position)"
                >
                  Up Next
                </button>
                <button
                  className="seg-btn"
                  onClick={handleFeatureThatWas}
                  disabled={!hasPrev}
                  title="Show the PREVIOUS trigger as a full-screen THAT WAS feature card (does not advance position)"
                >
                  That Was
                </button>
                <button
                  className="seg-btn seg-danger"
                  onClick={handleFeatureHide}
                  disabled={!featureCard?.visible}
                  title="Hide the full-screen feature card"
                >
                  Hide Card
                </button>
              </div>
            </div>
            <div className="ctl-row">
              <input
                type="text"
                className="ctl-text-input ctl-kicker"
                value={fcKicker}
                onChange={(e) => setFcKicker(e.target.value)}
                placeholder="Kicker"
                title="Feature card kicker (UP NEXT / THAT WAS / custom)"
              />
              <input
                type="text"
                className="ctl-text-input"
                value={fcTitle}
                onChange={(e) => setFcTitle(e.target.value)}
                placeholder="Title"
                title="Feature card title"
              />
              <input
                type="text"
                className="ctl-text-input"
                value={fcSubtitle}
                onChange={(e) => setFcSubtitle(e.target.value)}
                placeholder="Subtitle"
                title="Feature card subtitle"
              />
              <button
                className="btn-bulk btn-bulk-accent"
                onClick={handleFeatureShow}
                disabled={!fcTitle.trim()}
                title="Show a custom full-screen feature card"
              >
                Show
              </button>
            </div>
          </div>

          <div className="controls-shortcuts-hint">
            Space: fire/hide | Arrows: prev/next | Shift+Right: next+fire | Esc: hide
          </div>
        </div>
      )}
    </div>
  )
}
