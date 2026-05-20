import { useEffect, useState, useCallback } from 'react'
import { useStore } from '../store/useStore'
import type { LoopMode, SlowZoomStatus } from '../../shared/types'
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
  const [slowZoom, setSlowZoom] = useState<SlowZoomStatus>({ wideZoomedIn: false, tightZoomedIn: false })
  const [zoomBusy, setZoomBusy] = useState<'wide' | 'tight' | null>(null)
  const [transitionRevert, setTransitionRevert] = useState(false)
  const gridVisible = overlayState?.gridVisible ?? false

  // Broadcast-chrome elements (clock / counter / feature card)
  const clock = overlayState?.clock
  const counter = overlayState?.counter
  const featureCard = overlayState?.featureCard
  const [counterLabel, setCounterLabel] = useState('')
  const [fcKicker, setFcKicker] = useState('UP NEXT')
  const [fcTitle, setFcTitle] = useState('')
  const [fcSubtitle, setFcSubtitle] = useState('')

  // Keep the editable counter-label input in sync with state.
  useEffect(() => {
    if (counter) setCounterLabel(counter.label)
  }, [counter?.label])

  // Fetch autoFire + OBS controls state on mount
  useEffect(() => {
    window.api.playlistGetStatus().then((s) => setAutoFire(s.autoFire))
    window.api.obsSlowZoomStatus?.().then((s: SlowZoomStatus) => setSlowZoom(s)).catch(() => { /* OBS may be disconnected */ })
    window.api.obsTransitionRevertGet?.().then((r: { enabled: boolean }) => setTransitionRevert(r.enabled)).catch(() => { /* ignore */ })

    // Push-update from main when slow-zoom state drifts (operator changes scene
    // out from under us, or zoom completes elsewhere).
    const onZoomUpdate = (status: unknown) => setSlowZoom(status as SlowZoomStatus)
    window.api.on?.('obs:slow-zoom-status-update', onZoomUpdate)
    return () => {
      window.api.removeAllListeners?.('obs:slow-zoom-status-update')
    }
  }, [])

  async function handleSlowZoomWide() {
    setZoomBusy('wide')
    try {
      const status = await window.api.obsSlowZoomTriggerWide()
      setSlowZoom(status)
    } finally {
      setZoomBusy(null)
    }
  }

  async function handleSlowZoomTight() {
    setZoomBusy('tight')
    try {
      const status = await window.api.obsSlowZoomTriggerTight()
      setSlowZoom(status)
    } finally {
      setZoomBusy(null)
    }
  }

  async function handleTransitionRevertToggle() {
    const next = !transitionRevert
    const result = await window.api.obsTransitionRevertSet(next)
    setTransitionRevert(result.enabled)
  }

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

  // ── Counter ──
  async function handleCounterToggle() {
    await window.api.overlayCounterToggle()
  }
  async function handleCounterBump(delta: number) {
    await window.api.overlayCounterBump(delta)
  }
  async function handleCounterSetValue(value: number) {
    if (Number.isFinite(value)) await window.api.overlayCounterSet(value, counterLabel)
  }
  async function handleCounterSetLabel() {
    await window.api.overlayCounterSet(counter?.value ?? 1, counterLabel)
  }
  async function handleCounterSyncTrigger() {
    // Set counter from the selected trigger's 1-based order index.
    if (selectedIndex >= 0) await window.api.overlayCounterSet(selectedIndex + 1, counterLabel)
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
        <>
          <div className="overlay-controls">
            <button className="btn-fire" onClick={() => window.api.overlayFireLT()}>
              Fire
            </button>
            <button className="btn-hide" onClick={() => window.api.overlayHideLT()}>
              Hide
            </button>
            <div className="controls-divider" />
            <button className="btn-nav" onClick={() => window.api.triggerPrev()}>
              Prev
            </button>
            <button className="btn-nav" onClick={() => window.api.triggerNext()}>
              Next
            </button>
            <button
              className="btn-nav"
              onClick={() => window.api.triggerNextFull()}
              title="Advance + Fire (Ctrl+Enter or Shift+Right)"
              style={{ fontWeight: 700 }}
            >
              Next+Fire
            </button>
            <div className="controls-divider" />
            <button
              className={`btn-sm ${autoFire ? 'btn-auto-fire-on' : 'btn-auto-fire-off'}`}
              onClick={handleAutoFireToggle}
              title="Auto-fire on Next/Prev"
            >
              Auto {autoFire ? 'ON' : 'OFF'}
            </button>
            <button
              className={`btn-sm ${loopActive ? 'btn-loop-active' : 'btn-loop-off'}`}
              onClick={handleLoopCycle}
              title="Cycle loop mode: Off → Loop → Ping-Pong"
            >
              {LOOP_LABELS[loopMode as LoopMode] || 'Loop: Off'}
            </button>
          </div>
          <div className="controls-info-row">
            <div className="controls-status">
              <span className={`status-dot ${isVisible ? 'live' : ''}`} />
              {isVisible ? 'LIVE' : 'OFF'}
            </div>
            {total > 0 && (
              <div className="controls-playlist-pos">
                {current} / {total}
              </div>
            )}
            {playedCount > 0 && (
              <div className="controls-played-badge">
                {playedCount} played
              </div>
            )}
            {upNext && (
              <div className="controls-up-next">
                Up next: <span className="controls-up-next-name">{upNext.title || upNext.name}</span>
              </div>
            )}
          </div>
          {/* Bulk operations */}
          <div className="controls-bulk-row">
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
          {/* Graphics — Up Next / That Was + leveling grid */}
          <div className="controls-bulk-row" style={{ marginTop: 8, alignItems: 'center', gap: 6 }}>
            <button
              className="btn-bulk"
              onClick={handleUpNext}
              disabled={!hasNext}
              title="Fire the NEXT trigger as a lower-third labelled UP NEXT (does not advance position)"
            >
              Up Next
            </button>
            <button
              className="btn-bulk"
              onClick={handleThatWas}
              disabled={!hasPrev}
              title="Fire the PREVIOUS trigger as a lower-third labelled THAT WAS (does not advance position)"
            >
              That Was
            </button>
            <button
              className={`btn-sm ${gridVisible ? 'btn-auto-fire-on' : 'btn-auto-fire-off'}`}
              onClick={handleGridToggle}
              title="Toggle the rule-of-thirds leveling grid on the OBS browser source (operator-only — turn off before going live)"
              style={{ marginLeft: 'auto' }}
            >
              Grid {gridVisible ? 'ON' : 'OFF'}
            </button>
          </div>
          {/* OBS camera helpers — slow zoom + transition auto-revert */}
          <div className="controls-bulk-row" style={{ marginTop: 8, alignItems: 'center', gap: 6 }}>
            <button
              className={`btn-bulk ${slowZoom.wideZoomedIn ? 'btn-loop-active' : ''}`}
              onClick={handleSlowZoomWide}
              disabled={zoomBusy !== null}
              title="Toggle slow zoom on the Wide camera (Move Transition in OBS)"
            >
              {zoomBusy === 'wide' ? 'Wide…' : `Wide Zoom ${slowZoom.wideZoomedIn ? 'OUT' : 'IN'}`}
            </button>
            <button
              className={`btn-bulk ${slowZoom.tightZoomedIn ? 'btn-loop-active' : ''}`}
              onClick={handleSlowZoomTight}
              disabled={zoomBusy !== null}
              title="Toggle slow zoom on the Tight camera (Move Transition in OBS)"
            >
              {zoomBusy === 'tight' ? 'Tight…' : `Tight Zoom ${slowZoom.tightZoomedIn ? 'OUT' : 'IN'}`}
            </button>
            <button
              className={`btn-sm ${transitionRevert ? 'btn-auto-fire-on' : 'btn-auto-fire-off'}`}
              onClick={handleTransitionRevertToggle}
              title="Auto-snap OBS back to Cut transition 500ms after any non-Cut transition fires"
              style={{ marginLeft: 'auto' }}
            >
              Revert: {transitionRevert ? 'ON' : 'OFF'}
            </button>
          </div>
          {/* Broadcast chrome — on-air clock */}
          <div className="controls-bulk-row" style={{ marginTop: 8, alignItems: 'center', gap: 6 }}>
            <button
              className={`btn-sm ${clock?.visible ? 'btn-auto-fire-on' : 'btn-auto-fire-off'}`}
              onClick={handleClockToggle}
              title="Show/hide the on-air wall clock"
            >
              Clock {clock?.visible ? 'ON' : 'OFF'}
            </button>
            <button
              className="btn-bulk"
              onClick={() => handleClockFormat(clock?.format === '24h' ? '12h' : '24h')}
              title="Toggle 12h / 24h time format"
            >
              {clock?.format === '24h' ? '24h' : '12h'}
            </button>
            <button
              className={`btn-sm ${clock?.showSeconds ? 'btn-auto-fire-on' : 'btn-auto-fire-off'}`}
              onClick={handleClockSeconds}
              title="Toggle seconds display"
            >
              Secs {clock?.showSeconds ? 'ON' : 'OFF'}
            </button>
          </div>
          {/* Broadcast chrome — counter badge */}
          <div className="controls-bulk-row" style={{ marginTop: 8, alignItems: 'center', gap: 6 }}>
            <button
              className={`btn-sm ${counter?.visible ? 'btn-auto-fire-on' : 'btn-auto-fire-off'}`}
              onClick={handleCounterToggle}
              title="Show/hide the numeric counter badge"
            >
              Counter {counter?.visible ? 'ON' : 'OFF'}
            </button>
            <button className="btn-bulk" onClick={() => handleCounterBump(-1)} title="Decrement counter">
              −
            </button>
            <input
              type="number"
              value={counter?.value ?? 1}
              onChange={(e) => handleCounterSetValue(parseInt(e.target.value, 10))}
              title="Counter value"
              style={{ width: 56, textAlign: 'center', padding: '4px 6px', fontSize: 12 }}
            />
            <button className="btn-bulk" onClick={() => handleCounterBump(1)} title="Increment counter">
              +
            </button>
            <input
              type="text"
              value={counterLabel}
              onChange={(e) => setCounterLabel(e.target.value)}
              onBlur={handleCounterSetLabel}
              placeholder="Label (e.g. ENTRY)"
              title="Counter label"
              style={{ flex: 1, minWidth: 80, padding: '4px 6px', fontSize: 12 }}
            />
            <button
              className="btn-bulk"
              onClick={handleCounterSyncTrigger}
              disabled={selectedIndex < 0}
              title="Set counter to the selected trigger's order number"
            >
              Sync #{selectedIndex >= 0 ? selectedIndex + 1 : '-'}
            </button>
          </div>
          {/* Broadcast chrome — full-screen feature card */}
          <div className="controls-bulk-row" style={{ marginTop: 8, alignItems: 'center', gap: 6 }}>
            <button
              className="btn-bulk"
              onClick={handleFeatureUpNext}
              disabled={!hasNext}
              title="Show the NEXT trigger as a full-screen UP NEXT feature card (does not advance position)"
            >
              Feature: Up Next
            </button>
            <button
              className="btn-bulk"
              onClick={handleFeatureThatWas}
              disabled={!hasPrev}
              title="Show the PREVIOUS trigger as a full-screen THAT WAS feature card (does not advance position)"
            >
              Feature: That Was
            </button>
            <button
              className={`btn-sm ${featureCard?.visible ? 'btn-auto-fire-on' : 'btn-auto-fire-off'}`}
              onClick={handleFeatureHide}
              disabled={!featureCard?.visible}
              title="Hide the full-screen feature card"
              style={{ marginLeft: 'auto' }}
            >
              Hide Card
            </button>
          </div>
          {/* Feature card composer */}
          <div className="controls-bulk-row" style={{ marginTop: 6, alignItems: 'center', gap: 6 }}>
            <input
              type="text"
              value={fcKicker}
              onChange={(e) => setFcKicker(e.target.value)}
              placeholder="Kicker"
              title="Feature card kicker (UP NEXT / THAT WAS / custom)"
              style={{ width: 90, padding: '4px 6px', fontSize: 12 }}
            />
            <input
              type="text"
              value={fcTitle}
              onChange={(e) => setFcTitle(e.target.value)}
              placeholder="Title"
              title="Feature card title"
              style={{ flex: 1, minWidth: 80, padding: '4px 6px', fontSize: 12 }}
            />
            <input
              type="text"
              value={fcSubtitle}
              onChange={(e) => setFcSubtitle(e.target.value)}
              placeholder="Subtitle"
              title="Feature card subtitle"
              style={{ flex: 1, minWidth: 80, padding: '4px 6px', fontSize: 12 }}
            />
            <button
              className="btn-bulk"
              onClick={handleFeatureShow}
              disabled={!fcTitle.trim()}
              title="Show a custom full-screen feature card"
            >
              Show
            </button>
          </div>
          <div className="controls-shortcuts-hint">
            Space: fire/hide | Arrows: prev/next | Shift+Right: next+fire | Esc: hide
          </div>
        </>
      )}
    </div>
  )
}
