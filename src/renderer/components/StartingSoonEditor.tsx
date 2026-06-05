import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useStore } from '../store/useStore'
import type {
  SSElementKey,
  SSElementLayout,
  SSElementPlacement,
  SSDesign,
  StartingSoonState,
} from '../../shared/types'
import '../styles/startingSoonEditor.css'

// ── Element catalogue ──────────────────────────────────────────────
// Only elements BB's starting-soon overlay actually renders are listed (no
// dead controls). logo / eventCard / upNext / pinnedChat / timeDate / ticker
// from CompSync are NOT rendered in BB's SS scene → intentionally omitted.
const ELEMENT_LABELS: Record<SSElementKey, string> = {
  title: 'Title',
  subtitle: 'Subtitle',
  countdown: 'Countdown',
  welcome: 'Welcome Line',
  social: 'Social Bar',
  sponsors: 'Sponsor Carousel',
  slideshow: 'Photo Slideshow',
  visualizer: 'Visualizer',
}

const ELEMENT_ORDER: SSElementKey[] = [
  'title', 'subtitle', 'countdown', 'welcome', 'social', 'sponsors', 'slideshow', 'visualizer',
]

// Default drop position (% center point) when an element is first dragged /
// pulled out of the centered flex flow. Roughly matches the stacked layout.
const DEFAULT_POS: Record<SSElementKey, { x: number; y: number }> = {
  title: { x: 50, y: 38 },
  subtitle: { x: 50, y: 47 },
  countdown: { x: 50, y: 60 },
  welcome: { x: 50, y: 22 },
  social: { x: 50, y: 90 },
  sponsors: { x: 50, y: 78 },
  slideshow: { x: 50, y: 50 },
  visualizer: { x: 50, y: 96 },
}

// ── One-tap design packs (ported/trimmed from CompSync PRO_PACKS) ──
interface ProPack {
  id: string
  name: string
  vibe: string
  gradientColors: string[]
  gradientAngle: number
  titleFont: string
  subtitleFont: string
  countdownWeight: number
  titleColor: string
  subtitleColor: string
  accentColor: string
}

const PRO_PACKS: ProPack[] = [
  {
    id: 'broadcast', name: 'Broadcast', vibe: 'Indigo cinematic',
    gradientColors: ['#0a0e2a', '#1f1947', '#3b3585', '#4f4a9b'], gradientAngle: 135,
    titleFont: "'Segoe UI', sans-serif", subtitleFont: "'Segoe UI', sans-serif",
    countdownWeight: 200, titleColor: '#ffffff', subtitleColor: '#c5cae9', accentColor: '#667eea',
  },
  {
    id: 'theater', name: 'Theater', vibe: 'Velvet wine',
    gradientColors: ['#0a0a0f', '#2a0a1f', '#4a0e2f', '#1a0a14'], gradientAngle: 145,
    titleFont: 'Georgia, serif', subtitleFont: "'Segoe UI', sans-serif",
    countdownWeight: 300, titleColor: '#f8eedc', subtitleColor: '#e3c89b', accentColor: '#b5476b',
  },
  {
    id: 'festival', name: 'Festival', vibe: 'Cinematic teal',
    gradientColors: ['#0a3344', '#1a6b8e', '#0a3344', '#0e1d2a'], gradientAngle: 120,
    titleFont: "'Arial Black', sans-serif", subtitleFont: "'Segoe UI', sans-serif",
    countdownWeight: 700, titleColor: '#ffffff', subtitleColor: '#9bd1e2', accentColor: '#48cae4',
  },
  {
    id: 'studio', name: 'Studio', vibe: 'Neutral corporate',
    gradientColors: ['#1a1a1f', '#2d2d35', '#3a3a44', '#1a1a1f'], gradientAngle: 135,
    titleFont: "'Segoe UI', sans-serif", subtitleFont: "'Segoe UI', sans-serif",
    countdownWeight: 900, titleColor: '#ffffff', subtitleColor: '#b8b8c8', accentColor: '#8a8ad0',
  },
  {
    id: 'sunset', name: 'Sunset', vibe: 'Warm gradient',
    gradientColors: ['#1a0000', '#8b0000', '#ff4500', '#1a0000'], gradientAngle: 135,
    titleFont: "'Segoe UI', sans-serif", subtitleFont: "'Segoe UI', sans-serif",
    countdownWeight: 400, titleColor: '#ffffff', subtitleColor: '#ffd6a5', accentColor: '#ff7b54',
  },
  {
    id: 'aurora', name: 'Aurora', vibe: 'Green / violet',
    gradientColors: ['#11998e', '#38ef7d', '#667eea', '#764ba2'], gradientAngle: 135,
    titleFont: "'Segoe UI', sans-serif", subtitleFont: "'Segoe UI', sans-serif",
    countdownWeight: 300, titleColor: '#ffffff', subtitleColor: '#d7f9e9', accentColor: '#38ef7d',
  },
]

const FONT_CHOICES = [
  "'Segoe UI', sans-serif",
  'Georgia, serif',
  "'Arial Black', sans-serif",
  "'Times New Roman', serif",
  "'Courier New', monospace",
  'Verdana, sans-serif',
  'Tahoma, sans-serif',
]

interface DragState {
  element: SSElementKey
  startX: number
  startY: number
  startPos: { x: number; y: number }
}

export function StartingSoonEditor({ onClose }: { onClose: () => void }) {
  const overlayState = useStore((s) => s.overlayState)
  const settings = useStore((s) => s.settings)
  const stageRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<SSElementKey | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)

  const httpPort = settings?.server?.httpPort ?? 19080
  const overlayUrl = useMemo(() => `http://127.0.0.1:${httpPort}/overlay`, [httpPort])

  const ss = overlayState?.startingSoon
  const layout: SSElementLayout = ss?.layout ?? {}
  const design: SSDesign = ss?.design ?? {}

  // Push partial starting-soon state to the live overlay + main store.
  const update = useCallback((changes: Partial<StartingSoonState>) => {
    window.api.startingSoonUpdate(changes)
  }, [])

  const updateLayout = useCallback((next: SSElementLayout) => {
    update({ layout: next })
  }, [update])

  const setPlacement = useCallback((key: SSElementKey, p: Partial<SSElementPlacement> | null) => {
    const current = useStore.getState().overlayState?.startingSoon?.layout ?? {}
    const next: SSElementLayout = { ...current }
    if (p === null) {
      delete next[key]
    } else {
      const existing = next[key] ?? { x: DEFAULT_POS[key].x, y: DEFAULT_POS[key].y }
      next[key] = { ...existing, ...p }
    }
    updateLayout(next)
  }, [updateLayout])

  // Ensure the scene is shown while editing so the iframe preview is populated.
  useEffect(() => {
    if (ss && !ss.visible) window.api.startingSoonShow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toStagePercent = useCallback((clientX: number, clientY: number) => {
    const stage = stageRef.current
    if (!stage) return { px: 50, py: 50 }
    const rect = stage.getBoundingClientRect()
    return {
      px: ((clientX - rect.left) / rect.width) * 100,
      py: ((clientY - rect.top) / rect.height) * 100,
    }
  }, [])

  function handleMouseDown(e: React.MouseEvent, key: SSElementKey) {
    e.stopPropagation()
    e.preventDefault()
    setSelected(key)
    const existing = layout[key]
    const start = existing ? { x: existing.x, y: existing.y } : DEFAULT_POS[key]
    const { px, py } = toStagePercent(e.clientX, e.clientY)
    setDrag({ element: key, startX: px, startY: py, startPos: start })
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!drag) return
    const { px, py } = toStagePercent(e.clientX, e.clientY)
    const nx = Math.max(2, Math.min(98, drag.startPos.x + (px - drag.startX)))
    const ny = Math.max(2, Math.min(98, drag.startPos.y + (py - drag.startY)))
    setPlacement(drag.element, { x: Math.round(nx * 10) / 10, y: Math.round(ny * 10) / 10 })
  }

  function handleMouseUp() {
    setDrag(null)
  }

  function applyPack(pack: ProPack) {
    update({
      design: {
        presetId: pack.id,
        gradientColors: pack.gradientColors,
        gradientAngle: pack.gradientAngle,
        titleFont: pack.titleFont,
        subtitleFont: pack.subtitleFont,
        countdownWeight: pack.countdownWeight,
      },
      textColor: pack.titleColor,
      accentColor: pack.accentColor,
    })
  }

  function resetLayout() {
    update({ layout: {}, design: {} })
    setSelected(null)
  }

  if (!ss) return null

  // Box geometry for the drag proxy of each element.
  function boxStyle(key: SSElementKey): React.CSSProperties {
    const p = layout[key]
    const pos = p ? { x: p.x, y: p.y } : DEFAULT_POS[key]
    return { left: `${pos.x}%`, top: `${pos.y}%` }
  }

  const elementEnabled: Record<SSElementKey, boolean> = {
    title: !!ss.title,
    subtitle: !!ss.subtitle,
    countdown: ss.showCountdown,
    welcome: !!ss.media?.showWelcome,
    social: !!ss.media?.showSocialBar,
    sponsors: !!ss.media?.showSponsors,
    slideshow: !!ss.media?.showSlideshow,
    visualizer: !!ss.media?.showVisualizer,
  }

  const sel = selected ? layout[selected] : undefined

  return (
    <div className="sse-overlay" onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}>
      <div className="sse-header">
        <span className="sse-title">Starting Soon — Scene Editor</span>
        <div className="sse-actions">
          <button className="btn btn-ghost btn-sm" onClick={resetLayout} title="Clear all placement + design">Reset</button>
          <button className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
        </div>
      </div>

      <div className="sse-body">
        {/* Left rail: element list + design packs */}
        <div className="sse-rail">
          <div className="sse-rail-section">
            <div className="sse-rail-title">Elements</div>
            {ELEMENT_ORDER.map((key) => {
              const p = layout[key]
              const placed = !!p
              const hidden = p?.show === false
              const enabled = elementEnabled[key]
              return (
                <div
                  key={key}
                  className={`sse-el-row${selected === key ? ' selected' : ''}${enabled ? '' : ' disabled'}`}
                  onClick={() => setSelected(key)}
                >
                  <span className="sse-el-name">{ELEMENT_LABELS[key]}</span>
                  {!enabled && <span className="sse-el-off">off</span>}
                  <button
                    className={`sse-el-vis${hidden ? ' hidden' : ''}`}
                    title={hidden ? 'Show element' : 'Hide element'}
                    onClick={(e) => { e.stopPropagation(); setPlacement(key, { show: hidden ? true : false }) }}
                  >
                    {hidden ? '✕' : '👁'}
                  </button>
                  {placed && (
                    <button
                      className="sse-el-reset"
                      title="Reset to centered flow"
                      onClick={(e) => { e.stopPropagation(); setPlacement(key, null) }}
                    >↺</button>
                  )}
                </div>
              )
            })}
            <p className="sse-hint">Drag an element on the stage to position it. Elements marked “off” are disabled in the Starting Soon panel.</p>
          </div>

          <div className="sse-rail-section">
            <div className="sse-rail-title">Design Packs</div>
            <div className="sse-pack-grid">
              {PRO_PACKS.map((pack) => (
                <button
                  key={pack.id}
                  className={`sse-pack${design.presetId === pack.id ? ' active' : ''}`}
                  onClick={() => applyPack(pack)}
                  title={pack.vibe}
                >
                  <span
                    className="sse-pack-swatch"
                    style={{ background: `linear-gradient(${pack.gradientAngle}deg, ${pack.gradientColors.join(', ')})` }}
                  />
                  <span className="sse-pack-name">{pack.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Selected element styling */}
          {selected && (
            <div className="sse-rail-section">
              <div className="sse-rail-title">{ELEMENT_LABELS[selected]} Style</div>
              <div className="sse-prop-row">
                <label>X</label>
                <input type="number" step={0.5} value={sel ? Number(sel.x.toFixed(1)) : DEFAULT_POS[selected].x}
                  onChange={(e) => setPlacement(selected, { x: Number(e.target.value) })} />
                <span>%</span>
              </div>
              <div className="sse-prop-row">
                <label>Y</label>
                <input type="number" step={0.5} value={sel ? Number(sel.y.toFixed(1)) : DEFAULT_POS[selected].y}
                  onChange={(e) => setPlacement(selected, { y: Number(e.target.value) })} />
                <span>%</span>
              </div>
              {(selected === 'title' || selected === 'subtitle' || selected === 'countdown' || selected === 'welcome' || selected === 'social') && (
                <>
                  <div className="sse-prop-row">
                    <label>Size</label>
                    <input type="number" min={8} max={240} value={sel?.fontSize ?? ''}
                      placeholder="auto"
                      onChange={(e) => setPlacement(selected, { fontSize: e.target.value ? Number(e.target.value) : undefined })} />
                    <span>px</span>
                  </div>
                  <div className="sse-prop-row">
                    <label>Weight</label>
                    <select value={sel?.fontWeight ?? ''}
                      onChange={(e) => setPlacement(selected, { fontWeight: e.target.value ? Number(e.target.value) : undefined })}>
                      <option value="">auto</option>
                      {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => (
                        <option key={w} value={w}>{w}</option>
                      ))}
                    </select>
                  </div>
                  <div className="sse-prop-row">
                    <label>Color</label>
                    <input type="color" value={sel?.color || ss.textColor}
                      onChange={(e) => setPlacement(selected, { color: e.target.value })} />
                  </div>
                </>
              )}
            </div>
          )}

          {/* Global design overrides */}
          <div className="sse-rail-section">
            <div className="sse-rail-title">Typography</div>
            <div className="sse-prop-row">
              <label>Title font</label>
              <select value={design.titleFont || ''}
                onChange={(e) => update({ design: { ...design, titleFont: e.target.value || undefined } })}>
                <option value="">default</option>
                {FONT_CHOICES.map((f) => <option key={f} value={f}>{f.replace(/'/g, '').split(',')[0]}</option>)}
              </select>
            </div>
            <div className="sse-prop-row">
              <label>Sub font</label>
              <select value={design.subtitleFont || ''}
                onChange={(e) => update({ design: { ...design, subtitleFont: e.target.value || undefined } })}>
                <option value="">default</option>
                {FONT_CHOICES.map((f) => <option key={f} value={f}>{f.replace(/'/g, '').split(',')[0]}</option>)}
              </select>
            </div>
            <div className="sse-prop-row">
              <label>CD weight</label>
              <select value={design.countdownWeight || ''}
                onChange={(e) => update({ design: { ...design, countdownWeight: e.target.value ? Number(e.target.value) : undefined } })}>
                <option value="">default</option>
                {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Stage: live overlay iframe + drag proxies */}
        <div className="sse-stage-wrap">
          <div className="sse-stage" ref={stageRef}>
            <iframe className="sse-iframe" src={overlayUrl} title="Live overlay" />
            <div className="sse-drag-layer">
              {ELEMENT_ORDER.map((key) => {
                if (!elementEnabled[key]) return null
                const p = layout[key]
                if (p?.show === false) return null
                return (
                  <div
                    key={key}
                    className={`sse-box${selected === key ? ' selected' : ''}${p ? ' placed' : ''}`}
                    style={boxStyle(key)}
                    onMouseDown={(e) => handleMouseDown(e, key)}
                  >
                    <span className="sse-box-label">{ELEMENT_LABELS[key]}</span>
                  </div>
                )
              })}
            </div>
          </div>
          <p className="sse-stage-hint">Live overlay preview (port {httpPort}). Drag the labelled handles to position. Unplaced elements keep the default centered layout.</p>
        </div>
      </div>
    </div>
  )
}
