import { useState } from 'react'
import { useStore } from '../store/useStore'
import '../styles/ticker.css'

export function TickerControls() {
  const overlayState = useStore((s) => s.overlayState)
  const ticker = overlayState?.ticker

  const [text, setText] = useState('')
  const [speed, setSpeed] = useState(60)
  const [bgColor, setBgColor] = useState('#1a1a2e')
  const [textColor, setTextColor] = useState('#ffffff')

  async function handleShow() {
    if (!text.trim()) return
    await window.api.tickerShow(text, speed, bgColor, textColor)
  }

  async function handleHide() {
    await window.api.tickerHide()
  }

  return (
    <div className="panel-section">
      <div className="panel-section-title">Ticker / Crawl</div>
      <div className="ticker-controls">
        <div className="ticker-input-row">
          <div className="field flex-1">
            <label>Ticker Text</label>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Breaking news, announcements, sponsor messages..."
            />
          </div>
        </div>
        <div className="ticker-input-row">
          <div className="field">
            <label>Speed (px/s)</label>
            <input
              type="number"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              min={20}
              max={200}
              style={{ width: 80 }}
            />
          </div>
          <div className="field">
            <label>Background</label>
            <input
              type="color"
              value={bgColor}
              onChange={(e) => setBgColor(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Text Color</label>
            <input
              type="color"
              value={textColor}
              onChange={(e) => setTextColor(e.target.value)}
            />
          </div>
        </div>
        <div className="ticker-actions">
          <button className="btn btn-success btn-sm" onClick={handleShow}>
            Show Ticker
          </button>
          <button className="btn btn-danger btn-sm" onClick={handleHide}>
            Hide Ticker
          </button>
          <div className="ticker-status">
            <span
              className={`status-dot ${ticker?.visible ? 'live' : ''}`}
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: ticker?.visible ? 'var(--success)' : 'var(--text-dim)',
                display: 'inline-block',
              }}
            />
            {ticker?.visible ? 'SCROLLING' : 'OFF'}
          </div>
        </div>
      </div>
    </div>
  )
}
