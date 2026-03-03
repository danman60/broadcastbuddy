import { useStore } from '../store/useStore'
import '../styles/controls.css'

export function OverlayControls() {
  const overlayState = useStore((s) => s.overlayState)
  const isVisible = overlayState?.lowerThird.visible ?? false

  return (
    <div className="panel-section">
      <div className="panel-section-title">Overlay Controls</div>
      <div className="overlay-controls">
        <button className="btn-fire" onClick={() => window.api.overlayFireLT()}>
          Fire
        </button>
        <button className="btn-hide" onClick={() => window.api.overlayHideLT()}>
          Hide
        </button>
        <button className="btn-nav" onClick={() => window.api.triggerPrev()}>
          Prev
        </button>
        <button className="btn-nav" onClick={() => window.api.triggerNext()}>
          Next
        </button>
        <div className="controls-status">
          <span className={`status-dot ${isVisible ? 'live' : ''}`} />
          {isVisible ? 'LIVE' : 'OFF'}
        </div>
      </div>
    </div>
  )
}
