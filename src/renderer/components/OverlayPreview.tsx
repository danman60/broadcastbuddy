import { useRef, useEffect, useCallback } from 'react'
import { useStore } from '../store/useStore'
import type { AnimationType } from '../../shared/types'
import '../styles/preview.css'

const ANIMATIONS: AnimationType[] = ['slide', 'fade', 'zoom', 'rise', 'typewriter', 'bounce', 'split', 'blur', 'sparkle']

const EASING_MAP: Record<string, string> = {
  ease: 'ease',
  'ease-in': 'ease-in',
  'ease-out': 'ease-out',
  'ease-in-out': 'ease-in-out',
  linear: 'linear',
  bounce: 'cubic-bezier(0.34,1.56,0.64,1)',
  elastic: 'cubic-bezier(0.68,-0.55,0.27,1.55)',
}

function pickAnimation(setting: AnimationType): AnimationType {
  if (setting === 'random') {
    return ANIMATIONS[Math.floor(Math.random() * ANIMATIONS.length)]
  }
  return setting
}

export function OverlayPreview() {
  const overlayState = useStore((s) => s.overlayState)
  const ltRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  const rescale = useCallback(() => {
    const lt = ltRef.current
    const canvas = canvasRef.current
    if (!lt || !canvas) return

    // Temporarily remove scale to measure natural width
    const currentTransform = lt.style.transform
    lt.style.transform = 'none'
    const ltWidth = lt.scrollWidth
    const available = canvas.clientWidth * 0.9
    lt.style.transform = currentTransform

    if (ltWidth > available && available > 0) {
      lt.style.setProperty('--p-scale', String(available / ltWidth))
    } else {
      lt.style.setProperty('--p-scale', '1')
    }
  }, [])

  useEffect(() => {
    rescale()
  }, [
    overlayState?.lowerThird.title,
    overlayState?.lowerThird.subtitle,
    overlayState?.lowerThird.visible,
    overlayState?.lowerThird.styling.fontFamily,
    overlayState?.lowerThird.styling.fontSize,
    rescale,
  ])

  if (!overlayState) return null

  const lt = overlayState.lowerThird
  const s = lt.styling
  const ticker = overlayState.ticker

  const anim = pickAnimation(s.animation)
  const bgClass = `preview-lt-card preview-bg-${s.backgroundStyle}`
  const animClass = [
    'preview-lt',
    `preview-anim-${anim}`,
    lt.visible ? 'visible' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className="overlay-preview" onClick={() => useStore.getState().setShowVisualEditor(true)} title="Click to open Visual Editor">
      <div className="preview-label">Preview (click to edit layout)</div>
      <div className="preview-canvas" ref={canvasRef}>
        {/* Company logo */}
        {overlayState.companyLogo.visible && overlayState.companyLogo.dataUrl && (
          <img className="preview-company-logo" src={overlayState.companyLogo.dataUrl} alt="" />
        )}

        {/* Client logo */}
        {overlayState.clientLogo.visible && overlayState.clientLogo.dataUrl && (
          <img className="preview-client-logo" src={overlayState.clientLogo.dataUrl} alt="" />
        )}

        {/* Lower third */}
        <div
          className={animClass}
          ref={ltRef}
          style={{
            transitionDuration: `${s.animationDuration ?? 0.5}s`,
            transitionTimingFunction: EASING_MAP[s.animationEasing] || 'ease',
          }}
        >
          <div
            className={bgClass}
            style={{
              '--p-bg': s.backgroundColor,
              '--p-text': s.textColor,
              '--p-accent': s.accentColor,
              '--p-radius': `${s.borderRadius * 0.15}px`,
              '--p-font': s.fontFamily,
            } as React.CSSProperties}
          >
            <div className="preview-lt-title" style={{ fontWeight: s.fontWeight }}>
              {lt.title || 'Title'}
            </div>
            {(lt.subtitle || !lt.title) && (
              <div className="preview-lt-subtitle">
                {lt.subtitle || 'Subtitle'}
              </div>
            )}
          </div>
        </div>

        {/* Ticker */}
        {ticker.visible && (
          <div
            className="preview-ticker"
            style={{ background: ticker.backgroundColor, color: ticker.textColor }}
          >
            <span className="preview-ticker-text">{ticker.text || 'Ticker text'}</span>
          </div>
        )}
      </div>
    </div>
  )
}
