import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import type { AudioInputLevel } from '../../shared/types'
import { IPC } from '../../shared/types'
import '../styles/meters.css'

// OBS magnitude (post-fader peak, 0..1 multiplier) → dBFS. 0 (silence) maps to
// -Infinity, which the bar treats as the floor (-60 dBFS).
function mulToDb(mul: number): number {
  if (mul <= 0) return -Infinity
  return 20 * Math.log10(mul)
}

function dBToPercent(dB: number): number {
  if (dB <= -60) return 0
  if (dB >= 0) return 100
  return ((dB + 60) / 60) * 100
}

// Green = healthy, yellow = approaching clip, red = hot (likely clipping).
function dBToClass(dB: number): string {
  if (dB <= -60) return 'silent'
  if (dB > -6) return 'hot'
  if (dB > -12) return 'medium'
  return 'good'
}

function formatDB(dB: number): string {
  if (dB <= -60) return '-inf'
  return `${Math.round(dB)} dB`
}

interface InputMeter {
  inputName: string
  /** loudest channel of the input, in dBFS */
  dB: number
  /** peak-hold, in dBFS, decaying over time */
  peakDb: number
}

// Peak-hold decay (dB/sec) once a channel falls below its held peak.
const PEAK_DECAY_DB_PER_SEC = 20

export function AudioMeters() {
  const compactMode = useStore((s) => s.compactMode)
  const [collapsed, setCollapsed] = useState(false)
  const [meters, setMeters] = useState<InputMeter[]>([])
  // Per-input peak-hold value + the wall-clock time it was last updated.
  const peakHoldRef = useRef<Map<string, { db: number; ts: number }>>(new Map())
  // Last time a level frame arrived — drives the "OBS not connected / silent"
  // empty state when meters stop flowing.
  const lastFrameRef = useRef<number>(0)
  const [hasLevels, setHasLevels] = useState(false)

  useEffect(() => {
    if (compactMode) setCollapsed(true)
  }, [compactMode])

  useEffect(() => {
    const onLevels = (payload: unknown) => {
      const inputs = (payload as AudioInputLevel[]) ?? []
      const now = Date.now()
      lastFrameRef.current = now
      const hold = peakHoldRef.current
      const next: InputMeter[] = inputs.map((input) => {
        const peakMul = input.levels.length > 0 ? Math.max(...input.levels) : 0
        const dB = mulToDb(peakMul)
        const prev = hold.get(input.inputName)
        let peakDb = dB
        if (prev) {
          const elapsedSec = (now - prev.ts) / 1000
          const decayed = prev.db - PEAK_DECAY_DB_PER_SEC * elapsedSec
          peakDb = Math.max(dB, decayed)
        }
        hold.set(input.inputName, { db: peakDb, ts: now })
        return { inputName: input.inputName, dB, peakDb }
      })
      setMeters(next)
      setHasLevels(true)
    }

    window.api.on(IPC.OBS_AUDIO_LEVELS, onLevels)
    return () => window.api.removeAllListeners(IPC.OBS_AUDIO_LEVELS)
  }, [])

  // Detect a stall: if no frame in ~1.5s, treat meters as inactive so the
  // operator sees "no audio" rather than a frozen bar.
  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() - lastFrameRef.current > 1500) {
        setHasLevels(false)
        setMeters([])
        peakHoldRef.current.clear()
      }
    }, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className={`panel-section${collapsed ? ' collapsed' : ''}`}>
      <div className="panel-section-title" onClick={() => setCollapsed(!collapsed)}>
        Audio Meters
        {hasLevels && (
          <span style={{ fontSize: 10, fontWeight: 600, marginLeft: 8, color: '#22c55e' }}>
            live
          </span>
        )}
        <span className="chevron">{collapsed ? '▸' : '▾'}</span>
      </div>
      {!collapsed && (
        <div style={{ padding: '6px 12px 10px' }}>
          {!hasLevels || meters.length === 0 ? (
            <p style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
              No audio levels. Connect OBS and ensure an audio input is active —
              levels appear here once OBS starts sending meter data.
            </p>
          ) : (
            <div className="audio-meters">
              {meters.map((m) => (
                <div className="audio-meter-row" key={m.inputName}>
                  <span className="audio-meter-label" title={m.inputName}>
                    {m.inputName}
                  </span>
                  <div className="audio-meter-bar">
                    <div
                      className={`audio-meter-fill ${dBToClass(m.dB)}`}
                      style={{ width: `${dBToPercent(m.dB)}%` }}
                    />
                    <div
                      className="audio-meter-peak"
                      style={{ left: `${dBToPercent(m.peakDb)}%` }}
                    />
                  </div>
                  <span className="audio-meter-db">{formatDB(m.dB)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
