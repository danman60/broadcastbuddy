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

  // Fetch autoFire state on mount
  useEffect(() => {
    window.api.playlistGetStatus().then((s) => setAutoFire(s.autoFire))
  }, [])

  async function handleAutoFireToggle() {
    const enabled = await window.api.playlistAutoFireToggle()
    setAutoFire(enabled)
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

  return (
    <div className="panel-section">
      <div className="panel-section-title">Playlist Controls</div>
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
      <div className="controls-shortcuts-hint">
        Space: fire/hide | Arrows: prev/next | Shift+Right: next+fire | Esc: hide
      </div>
    </div>
  )
}
