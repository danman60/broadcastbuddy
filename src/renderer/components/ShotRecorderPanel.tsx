import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { RecordedMove, ShotRecorderState } from '../../shared/types'
import '../styles/voice.css'

/**
 * ShotRecorderPanel — record/replay manual camera "moves", mounted inside Settings'
 * Camera tab as a `.settings-group` directly after Voice Control. Matches the
 * VoicePanel / CameraPanel token palette (accent indigo, recording red, dark inputs).
 *
 *  - one big Record toggle: idle "● Record Shot" → recording pulsing red
 *    "■ Stop & Save (N cmds)" with the live eventCount from onShotState,
 *  - on stop, an inline label prompt (auto-name "Move N" if left blank) → shotRename,
 *  - a recorded-moves list (id / editable label / duration / cmd count) with
 *    ▶ Play / ✎ rename / ✕ delete, highlighting the row that is replaying,
 *  - a replaying indicator, and a small open-loop drift note.
 *
 * State comes from a main→renderer push (onShotState) carrying status only; the
 * moves list is (re)loaded via shotGet() on mount and whenever a push lands with
 * recording=false (record-stop / delete / rename all settle there).
 */

function fmtDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

export function ShotRecorderPanel(): React.ReactElement {
  const [state, setState] = useState<ShotRecorderState>({
    recording: false,
    replayingMoveId: null,
    eventCount: 0,
  })
  const [moves, setMoves] = useState<RecordedMove[]>([])

  // Inline label prompt shown after a record-stop that saved a move.
  const [pendingLabel, setPendingLabel] = useState<{ id: number; value: string } | null>(null)
  // Inline rename editor (existing move).
  const [editing, setEditing] = useState<{ id: number; value: string } | null>(null)
  const [busy, setBusy] = useState(false)

  // refreshMoves stays stable; called on mount and after every settling push.
  const refreshMoves = useCallback(async () => {
    try {
      const res = await window.api.shotGet()
      setMoves(res.moves)
      setState(res.state)
    } catch {
      /* recorder optional */
    }
  }, [])

  // Track the previous recording flag so we only re-pull the list on the
  // recording→idle edge (avoids a fetch on every live eventCount tick).
  const wasRecording = useRef(false)

  useEffect(() => {
    void refreshMoves()
    window.api.onShotState((s) => {
      setState(s)
      if (wasRecording.current && !s.recording) {
        void refreshMoves()
      }
      wasRecording.current = s.recording
    })
    return () => {
      window.api.removeAllListeners('shot:state')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Record toggle ──
  const toggleRecord = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await window.api.shotRecordToggle()
      // Stop returns the saved move; offer an inline label prompt for it.
      if (res.ok && res.move) {
        setPendingLabel({ id: res.move.id, value: '' })
      }
      await refreshMoves()
    } finally {
      setBusy(false)
    }
  }, [busy, refreshMoves])

  // ── Inline label prompt (after stop) ──
  const commitPendingLabel = useCallback(async () => {
    if (!pendingLabel) return
    const label = pendingLabel.value.trim()
    if (label) {
      try {
        await window.api.shotRename(pendingLabel.id, label)
      } catch {
        /* ignore */
      }
    }
    setPendingLabel(null)
    await refreshMoves()
  }, [pendingLabel, refreshMoves])

  // ── Per-move actions ──
  const playMove = (id: number): void => {
    void window.api.shotReplay(id)
  }

  const deleteMove = useCallback(async (id: number) => {
    try {
      await window.api.shotDelete(id)
    } catch {
      /* ignore */
    }
    await refreshMoves()
  }, [refreshMoves])

  const commitRename = useCallback(async () => {
    if (!editing) return
    const label = editing.value.trim()
    try {
      await window.api.shotRename(editing.id, label)
    } catch {
      /* ignore */
    }
    setEditing(null)
    await refreshMoves()
  }, [editing, refreshMoves])

  const replayingMove = moves.find((m) => m.id === state.replayingMoveId) ?? null

  return (
    <div className="voice-panel" style={{ colorScheme: 'dark' }}>
      {/* ── Record toggle ── */}
      <button
        type="button"
        className={'shot-record-btn' + (state.recording ? ' recording' : '')}
        disabled={busy}
        onClick={() => void toggleRecord()}
      >
        {state.recording
          ? `■ Stop & Save (${state.eventCount} cmds)`
          : '● Record Shot'}
      </button>
      <p className="voice-help" style={{ marginTop: -2 }}>
        Press Record, drive the cameras with the Xbox sticks / joystick, press Stop — the
        move is saved and replayable.
      </p>

      {/* ── Inline label prompt (after a stop that saved a move) ── */}
      {pendingLabel && (
        <div className="voice-add-row" style={{ borderTop: 'none', paddingTop: 0 }}>
          <span className="voice-shot-id" title="New move">{pendingLabel.id}</span>
          <input
            className="voice-text"
            type="text"
            autoFocus
            value={pendingLabel.value}
            placeholder={`optional name (blank = "Move ${pendingLabel.id}")`}
            onChange={(e) => setPendingLabel({ id: pendingLabel.id, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitPendingLabel()
              if (e.key === 'Escape') setPendingLabel(null)
            }}
          />
          <button className="voice-btn" onClick={() => void commitPendingLabel()} title="Save the name (or keep the auto name)">
            Save
          </button>
        </div>
      )}

      {/* ── Replaying indicator ── */}
      {state.replayingMoveId !== null && (
        <div className="voice-toast ok" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="voice-dot" style={{ background: 'var(--accent, #6366f1)', animation: 'voice-pulse 1s ease-in-out infinite' }} />
          Replaying: {replayingMove?.label || `Move ${state.replayingMoveId}`}
        </div>
      )}

      {/* ── Recorded moves list ── */}
      <div className="voice-section-title">Recorded moves</div>
      <div className="voice-shots">
        {moves.length === 0 ? (
          <span className="voice-shots-empty">No moves recorded yet.</span>
        ) : (
          moves.map((m) => {
            const playing = state.replayingMoveId === m.id
            const isEditing = editing?.id === m.id
            return (
              <div className={'voice-shot-row' + (playing ? ' shot-playing' : '')} key={m.id}>
                <span className="voice-shot-id">{m.id}</span>
                {isEditing ? (
                  <input
                    className="voice-text"
                    type="text"
                    autoFocus
                    value={editing.value}
                    placeholder={`Move ${m.id}`}
                    onChange={(e) => setEditing({ id: m.id, value: e.target.value })}
                    onBlur={() => void commitRename()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename()
                      if (e.key === 'Escape') setEditing(null)
                    }}
                  />
                ) : (
                  <span className="shot-name" title={m.label || `Move ${m.id}`}>
                    {m.label || `Move ${m.id}`}
                  </span>
                )}
                <span className="shot-meta" title="Duration">{fmtDuration(m.durationMs)}</span>
                <span className="shot-meta" title="Command count">{m.events.length} cmds</span>
                <button
                  className={'voice-btn small' + (playing ? ' shot-playing-btn' : '')}
                  onClick={() => playMove(m.id)}
                  title="Replay this move on the camera"
                >
                  ▶ Play
                </button>
                <button
                  className="voice-btn small"
                  onClick={() => setEditing({ id: m.id, value: m.label || '' })}
                  title="Rename this move"
                >
                  ✎
                </button>
                <button
                  className="voice-shot-del"
                  onClick={() => void deleteMove(m.id)}
                  title="Delete this move"
                >
                  ✕
                </button>
              </div>
            )
          })
        )}
      </div>

      <p className="voice-help">
        Replay is open-loop on the Tail 2 (no live pose read-back) — repeatable but may
        drift from the exact path.
      </p>
    </div>
  )
}
