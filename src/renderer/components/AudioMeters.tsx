import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import type { AudioInputLevel } from '../../shared/types'
import { IPC } from '../../shared/types'
import { mulToDb, dBToPercent, dBToClass, formatDB } from '../../shared/audioLevels'
import '../styles/meters.css'

interface InputMeter {
  inputName: string
  /** loudest channel of the input, in dBFS */
  dB: number
  /** peak-hold, in dBFS, decaying over time */
  peakDb: number
}

// Peak-hold decay (dB/sec) once a channel falls below its held peak.
const PEAK_DECAY_DB_PER_SEC = 20

// Shared OBS audio-level subscription + peak-hold/stall logic. Both the
// full panel and the compact header widget consume this — single IPC wiring.
function useAudioMeters(): { meters: InputMeter[]; hasLevels: boolean } {
  const [meters, setMeters] = useState<InputMeter[]>([])
  const peakHoldRef = useRef<Map<string, { db: number; ts: number }>>(new Map())
  const lastFrameRef = useRef<number>(0)
  const [hasLevels, setHasLevels] = useState(false)

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

  // Stall detection: no frame in ~1.5s → treat meters as inactive.
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

  return { meters, hasLevels }
}

/**
 * Compact always-visible audio readout for the top bar. Shows a single
 * combined level bar (loudest input) + peak tick + dB, mirroring CSE's inline
 * header meters. Reuses useAudioMeters — no duplicate IPC.
 */
export function HeaderAudioMeter() {
  const { meters, hasLevels } = useAudioMeters()
  // Collapse all inputs into the single loudest channel for the bar; show the
  // input count when more than one input is reporting.
  const loud = hasLevels && meters.length > 0
    ? meters.reduce((a, b) => (b.dB > a.dB ? b : a))
    : null

  return (
    <div className="header-meter-group" title={loud ? `Audio: ${loud.inputName} ${formatDB(loud.dB)}` : 'No audio levels'}>
      <span className="header-meter-label">AUD</span>
      <div className="header-audio-bar">
        {loud && (
          <>
            <div
              className={`header-audio-fill ${dBToClass(loud.dB)}`}
              style={{ width: `${dBToPercent(loud.dB)}%` }}
            />
            <div
              className="header-audio-peak"
              style={{ left: `${dBToPercent(loud.peakDb)}%` }}
            />
          </>
        )}
      </div>
      <span className="header-meter-value">{loud ? formatDB(loud.dB) : '—'}</span>
    </div>
  )
}

export function AudioMeters() {
  const compactMode = useStore((s) => s.compactMode)
  const [collapsed, setCollapsed] = useState(false)
  const { meters, hasLevels } = useAudioMeters()

  useEffect(() => {
    if (compactMode) setCollapsed(true)
  }, [compactMode])

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
