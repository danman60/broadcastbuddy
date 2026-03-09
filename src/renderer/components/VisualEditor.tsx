import { useState, useRef, useCallback, useEffect } from 'react'
import { useStore } from '../store/useStore'
import type { OverlayLayout, ElementPosition } from '../../shared/types'
import { DEFAULT_LAYOUT } from '../../shared/types'
import '../styles/visualEditor.css'

type ElementKey = keyof OverlayLayout

interface DragState {
  element: ElementKey
  startX: number
  startY: number
  startPos: ElementPosition
}

export function VisualEditor({ onClose }: { onClose: () => void }) {
  const overlayState = useStore((s) => s.overlayState)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<ElementKey | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [layout, setLayout] = useState<OverlayLayout>({ ...DEFAULT_LAYOUT })

  useEffect(() => {
    if (overlayState?.lowerThird.styling.layout) {
      setLayout({ ...DEFAULT_LAYOUT, ...overlayState.lowerThird.styling.layout })
    }
  }, [])

  // Convert mouse event to canvas percentage coordinates
  const toCanvasPercent = useCallback(
    (clientX: number, clientY: number): { px: number; py: number } => {
      const canvas = canvasRef.current
      if (!canvas) return { px: 0, py: 0 }
      const rect = canvas.getBoundingClientRect()
      return {
        px: ((clientX - rect.left) / rect.width) * 100,
        py: ((clientY - rect.top) / rect.height) * 100,
      }
    },
    [],
  )

  function handleMouseDown(e: React.MouseEvent, element: ElementKey) {
    e.stopPropagation()
    e.preventDefault()
    setSelected(element)
    const { px, py } = toCanvasPercent(e.clientX, e.clientY)
    setDrag({
      element,
      startX: px,
      startY: py,
      startPos: { ...layout[element] },
    })
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!drag) return
    const { px, py } = toCanvasPercent(e.clientX, e.clientY)
    const dx = px - drag.startX
    const dy = py - drag.startY
    const newX = Math.max(0, Math.min(95, drag.startPos.x + dx))
    const newY = Math.max(0, Math.min(98, drag.startPos.y + dy))
    setLayout((prev) => ({
      ...prev,
      [drag.element]: { ...prev[drag.element], x: newX, y: newY },
    }))
  }

  function handleMouseUp() {
    setDrag(null)
  }

  function handleCanvasClick(e: React.MouseEvent) {
    if (e.target === canvasRef.current) {
      setSelected(null)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose()
      return
    }
    if (!selected) return
    const step = e.shiftKey ? 2 : 0.5
    setLayout((prev) => {
      const pos = { ...prev[selected] }
      switch (e.key) {
        case 'ArrowLeft':
          pos.x = Math.max(0, pos.x - step)
          break
        case 'ArrowRight':
          pos.x = Math.min(95, pos.x + step)
          break
        case 'ArrowUp':
          pos.y = Math.max(0, pos.y - step)
          break
        case 'ArrowDown':
          pos.y = Math.min(98, pos.y + step)
          break
        default:
          return prev
      }
      e.preventDefault()
      return { ...prev, [selected]: pos }
    })
  }

  function handleSave() {
    window.api.overlayUpdateStyling({ layout })
    onClose()
  }

  function handleReset() {
    setLayout({ ...DEFAULT_LAYOUT })
  }

  if (!overlayState) return null

  const lt = overlayState.lowerThird
  const s = lt.styling

  return (
    <div
      className="ve-overlay"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      ref={(el) => el?.focus()}
    >
      <div className="ve-header">
        <span className="ve-title">Visual Overlay Editor</span>
        <div className="ve-actions">
          <button className="btn btn-ghost btn-sm" onClick={handleReset}>
            Reset
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleSave}>
            Save Layout
          </button>
        </div>
      </div>

      <div className="ve-body">
        <div className="ve-canvas-wrapper">
          <div
            className="ve-canvas"
            ref={canvasRef}
            onClick={handleCanvasClick}
          >
            {/* Safe zone guide */}
            <div className="ve-safe-zone" />

            {/* Company logo */}
            <div
              className={`ve-element ve-logo ${selected === 'companyLogo' ? 'selected' : ''}`}
              style={{ left: `${layout.companyLogo.x}%`, top: `${layout.companyLogo.y}%` }}
              onMouseDown={(e) => handleMouseDown(e, 'companyLogo')}
            >
              {overlayState.companyLogo.dataUrl ? (
                <img src={overlayState.companyLogo.dataUrl} alt="" className="ve-logo-img" />
              ) : (
                <span className="ve-placeholder">Company Logo</span>
              )}
              <span className="ve-label">Company Logo</span>
            </div>

            {/* Client logo */}
            <div
              className={`ve-element ve-logo ${selected === 'clientLogo' ? 'selected' : ''}`}
              style={{ left: `${layout.clientLogo.x}%`, top: `${layout.clientLogo.y}%` }}
              onMouseDown={(e) => handleMouseDown(e, 'clientLogo')}
            >
              {overlayState.clientLogo.dataUrl ? (
                <img src={overlayState.clientLogo.dataUrl} alt="" className="ve-logo-img" />
              ) : (
                <span className="ve-placeholder">Client Logo</span>
              )}
              <span className="ve-label">Client Logo</span>
            </div>

            {/* Lower third */}
            <div
              className={`ve-element ve-lower-third ${selected === 'lowerThird' ? 'selected' : ''}`}
              style={{ left: `${layout.lowerThird.x}%`, top: `${layout.lowerThird.y}%` }}
              onMouseDown={(e) => handleMouseDown(e, 'lowerThird')}
            >
              <div
                className="ve-lt-card"
                style={{
                  background: s.backgroundStyle === 'gradient'
                    ? `linear-gradient(135deg, ${s.backgroundColor}, ${s.accentColor})`
                    : s.backgroundStyle === 'glass'
                      ? 'rgba(0,0,0,0.6)'
                      : s.backgroundColor,
                  color: s.textColor,
                  borderRadius: `${s.borderRadius * 0.4}px`,
                  borderLeft: s.backgroundStyle === 'accent-bar' ? `3px solid ${s.accentColor}` : undefined,
                  fontFamily: s.fontFamily,
                }}
              >
                <div className="ve-lt-title" style={{ fontWeight: s.fontWeight }}>
                  {lt.title || 'Title'}
                </div>
                {(lt.subtitle || !lt.title) && (
                  <div className="ve-lt-subtitle">{lt.subtitle || 'Subtitle'}</div>
                )}
              </div>
              <span className="ve-label">Lower Third</span>
            </div>

            {/* Ticker */}
            <div
              className={`ve-element ve-ticker ${selected === 'ticker' ? 'selected' : ''}`}
              style={{
                left: `${layout.ticker.x}%`,
                top: `${layout.ticker.y}%`,
                width: layout.ticker.width ? `${layout.ticker.width}%` : '100%',
              }}
              onMouseDown={(e) => handleMouseDown(e, 'ticker')}
            >
              <div
                className="ve-ticker-bar"
                style={{
                  background: overlayState.ticker.backgroundColor,
                  color: overlayState.ticker.textColor,
                }}
              >
                {overlayState.ticker.text || 'Ticker text scrolls here...'}
              </div>
              <span className="ve-label">Ticker</span>
            </div>
          </div>
        </div>

        {/* Properties panel */}
        {selected && (
          <div className="ve-props">
            <div className="ve-props-title">{selected}</div>
            <div className="ve-props-field">
              <label>X</label>
              <input
                type="number"
                step={0.1}
                value={Number(layout[selected].x.toFixed(1))}
                onChange={(e) =>
                  setLayout((prev) => ({
                    ...prev,
                    [selected]: { ...prev[selected], x: Number(e.target.value) },
                  }))
                }
              />
              <span>%</span>
            </div>
            <div className="ve-props-field">
              <label>Y</label>
              <input
                type="number"
                step={0.1}
                value={Number(layout[selected].y.toFixed(1))}
                onChange={(e) =>
                  setLayout((prev) => ({
                    ...prev,
                    [selected]: { ...prev[selected], y: Number(e.target.value) },
                  }))
                }
              />
              <span>%</span>
            </div>
            <p className="ve-props-hint">
              Arrow keys to nudge. Shift+arrow for larger steps.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
