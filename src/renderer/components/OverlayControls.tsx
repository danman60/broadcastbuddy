import { useEffect, useState, useCallback } from 'react'
import { useStore } from '../store/useStore'
import '../styles/controls.css'

export function OverlayControls() {
  const overlayState = useStore((s) => s.overlayState)
  const { triggers, selectedIndex } = useStore()
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
        {upNext && (
          <div className="controls-up-next">
            Up next: <span className="controls-up-next-name">{upNext.title || upNext.name}</span>
          </div>
        )}
      </div>
      <div className="controls-shortcuts-hint">
        Space: fire/hide | Arrows: prev/next | Shift+Right: next+fire | Esc: hide
      </div>
    </div>
  )
}
