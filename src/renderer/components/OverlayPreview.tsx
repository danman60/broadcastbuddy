import { useRef, useEffect, useCallback, useState } from 'react'
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
  const [, setClockTick] = useState(0)

  // Tick once a second so the preview clock stays current (only when shown).
  const clockVisible = overlayState?.clock?.visible ?? false
  useEffect(() => {
    if (!clockVisible) return
    const id = setInterval(() => setClockTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [clockVisible])

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
  const clock = overlayState.clock
  const counter = overlayState.counter
  const featureCard = overlayState.featureCard
  const ss = overlayState.startingSoon
  const ssMedia = ss?.media

  // Render the clock string the same way the browser source does.
  const clockText = (() => {
    if (!clock?.visible) return ''
    const now = new Date()
    const h = now.getHours()
    const m = String(now.getMinutes()).padStart(2, '0')
    const sec = String(now.getSeconds()).padStart(2, '0')
    if (clock.format === '24h') {
      return clock.showSeconds ? `${String(h).padStart(2, '0')}:${m}:${sec}` : `${String(h).padStart(2, '0')}:${m}`
    }
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 || 12
    return clock.showSeconds ? `${h12}:${m}:${sec} ${ampm}` : `${h12}:${m} ${ampm}`
  })()

  const anim = pickAnimation(s.animation)
  const bgClass = [
    'preview-lt-card',
    `preview-bg-${s.backgroundStyle}`,
    s.textShadow ? 'preview-text-shadow' : '',
    s.textGlow ? 'preview-text-glow' : '',
    lt.label ? 'has-label' : '',
  ].filter(Boolean).join(' ')
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
              '--p-subtitle-color': s.subtitleColor || s.textColor,
              '--p-label-color': s.labelColor || '#1a1a2e',
              '--p-label-bg': s.labelBackgroundColor || '#667eea',
            } as React.CSSProperties}
          >
            {lt.label && (
              <div className="preview-lt-label">{lt.label}</div>
            )}
            <div
              className="preview-lt-title"
              style={{
                fontWeight: s.fontWeight,
                textTransform: (s.titleTextTransform || 'none') as React.CSSProperties['textTransform'],
                letterSpacing: `${(s.titleLetterSpacing || 0) * 0.15}px`,
              }}
            >
              {lt.title || 'Title'}
            </div>
            {(lt.subtitle || !lt.title) && (
              <div
                className="preview-lt-subtitle"
                style={s.subtitleFontSize ? { fontSize: `${s.subtitleFontSize * 0.21}px` } : undefined}
              >
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

        {/* On-air clock */}
        {clock?.visible && (
          <div className="preview-clock">
            <span className="preview-clock-time">{clockText}</span>
          </div>
        )}

        {/* Counter */}
        {counter?.visible && (
          <div className="preview-counter">
            <span className="preview-counter-number">{counter.value}</span>
            {counter.label && <span className="preview-counter-label">{counter.label}</span>}
          </div>
        )}

        {/* Starting-soon pre-show media (welcome / social / sponsor indicator) */}
        {ss?.visible && ssMedia && (
          <div className="preview-ss-media">
            {ssMedia.showWelcome && (ssMedia.welcomeLine || ssMedia.venueName) && (
              <div className="preview-ss-welcome" style={{ color: ss.textColor }}>
                {ssMedia.welcomeLine}
                {ssMedia.venueName && <span className="preview-ss-venue">{ssMedia.venueName}</span>}
              </div>
            )}
            {ssMedia.showSponsors && ssMedia.sponsorLogos.length > 0 && (
              <div className="preview-ss-sponsors">
                <img src={ssMedia.sponsorLogos[0]} alt="" />
                {ssMedia.sponsorLogos.length > 1 && (
                  <span className="preview-ss-sponsor-count">1/{ssMedia.sponsorLogos.length}</span>
                )}
              </div>
            )}
            {ssMedia.showSocialBar && ssMedia.socialBar && (
              <div className="preview-ss-social" style={{ color: ss.textColor }}>{ssMedia.socialBar}</div>
            )}
          </div>
        )}

        {/* Full-screen feature card */}
        {featureCard?.visible && (
          <div className={`preview-feature-card preview-fc-${featureCard.animateIn}`}>
            {featureCard.logoDataUrl && (
              <img className="preview-fc-logo" src={featureCard.logoDataUrl} alt="" />
            )}
            <div className="preview-fc-kicker">{featureCard.kicker}</div>
            <div className="preview-fc-title">{featureCard.title}</div>
            {featureCard.subtitle && (
              <div className="preview-fc-subtitle">{featureCard.subtitle}</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
