import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import type { VoiceResult, VoiceShot, VoiceStatus } from '../../shared/types'
import '../styles/voice.css'

/**
 * VoicePanel — push-to-talk voice-director settings, mounted inside Settings'
 * Camera tab as a `.settings-group`. Matches the OBSBOT CameraPanel token palette.
 *
 *  - master enable (voiceEnabled) gates everything below (dim + inert when off),
 *  - live helper status pill (onVoiceState push, voiceGetStatus initial) + a
 *    listening indicator that lights while the PTT key is held,
 *  - a "heard" toast for the last parsed command (green ok / red reject),
 *  - mic picker (audioinput, mirrors CameraPreview's videoinput enumerate),
 *  - confidence floor slider, Hold-to-Talk test button (voicePtt),
 *  - per-camera shots manager (label / recall / delete + "save current view"),
 *  - collapsed Advanced tunables, and a static command cheat-sheet.
 *
 * Settings persist via window.api.settingsSet (returns the updated AppSettings,
 * reflected into the store); shot edits also call voiceRefreshGrammar() so the
 * spoken grammar tracks the labels.
 */

const HELPER_LABEL: Record<VoiceStatus['helper'], string> = {
  starting: 'Starting…',
  ready: 'Ready',
  down: 'Stopped',
}

const CHEATS: Array<[string, string]> = [
  ['camera one / two', 'switch active camera'],
  ['shot N  /  <label>', 'recall a saved shot'],
  ['push in', 'slow zoom in'],
  ['slow push in', 'long, gentle zoom in'],
  ['pull out / zoom out', 'zoom out'],
  ['zoom in', 'zoom in'],
  ['wide / home', 'go to the wide Home shot'],
  ['sweep shot A to shot B', 'choreographed move A→B'],
  ['track / follow', 'enable AI tracking'],
  ['stop', 'halt motion'],
]

export function VoicePanel(): React.ReactElement {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)

  const enabled = settings?.voiceEnabled === true
  const confidenceFloor = settings?.voiceConfidenceFloor ?? 0.6
  const micDeviceId = settings?.voiceMicDeviceId ?? ''
  const shotMap = settings?.voiceShots ?? {}
  const wakeEnabled = settings?.voiceWakeEnabled === true
  const wakeWord = settings?.voiceWakeWord ?? 'broadcast'

  // ── Live helper status (push + initial fetch) ──
  const [status, setStatus] = useState<VoiceStatus>({ helper: 'down', listening: false })
  // Heard toast — last parsed command, fades after ~3s.
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null)
  const [toastFading, setToastFading] = useState(false)
  const toastTimers = useRef<{ fade?: ReturnType<typeof setTimeout>; clear?: ReturnType<typeof setTimeout> }>({})
  const lastToastKey = useRef<string>('')

  // ── Command history (rolling last 12, newest first) + accept/reject tally ──
  const HISTORY_MAX = 12
  const [history, setHistory] = useState<VoiceResult[]>([])
  const [counts, setCounts] = useState<{ accepted: number; rejected: number }>({ accepted: 0, rejected: 0 })
  const resetCounts = useCallback(() => setCounts({ accepted: 0, rejected: 0 }), [])

  useEffect(() => {
    let mounted = true
    void window.api.voiceGetStatus().then((s) => { if (mounted) setStatus(s) }).catch(() => { /* helper optional */ })
    window.api.onVoiceState((s) => {
      setStatus(s)
      const r = s.lastResult
      if (!r) return
      // Dedup repeated pushes of the same result (status updates can re-send).
      const key = `${r.text}|${r.ok}|${r.confidence}`
      if (key === lastToastKey.current) return
      lastToastKey.current = key
      // Record into rolling history (newest first, capped) + accept/reject tally.
      setHistory((prev) => [r, ...prev].slice(0, HISTORY_MAX))
      setCounts((c) => (r.ok ? { ...c, accepted: c.accepted + 1 } : { ...c, rejected: c.rejected + 1 }))
      if (toastTimers.current.fade) clearTimeout(toastTimers.current.fade)
      if (toastTimers.current.clear) clearTimeout(toastTimers.current.clear)
      setToastFading(false)
      setToast({ text: r.text, ok: r.ok })
      toastTimers.current.fade = setTimeout(() => setToastFading(true), 2600)
      toastTimers.current.clear = setTimeout(() => setToast(null), 3000)
    })
    return () => {
      mounted = false
      window.api.removeAllListeners('voice:state')
      if (toastTimers.current.fade) clearTimeout(toastTimers.current.fade)
      if (toastTimers.current.clear) clearTimeout(toastTimers.current.clear)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Settings persistence (returns updated AppSettings → store) ──
  const persist = useCallback(async (key: string, value: unknown) => {
    const updated = await window.api.settingsSet(key, value)
    setSettings(updated)
  }, [setSettings])

  // ── Mic devices (audioinput; mirrors CameraPreview's videoinput enumerate) ──
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const enumerateMics = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      // Chromium's 'default'/'communications' aliases duplicate real devices; "System default" covers them.
      setMics(list.filter((d) => d.kind === 'audioinput' && d.label && d.deviceId !== 'default' && d.deviceId !== 'communications'))
    } catch { /* permission not yet granted */ }
  }, [])
  useEffect(() => { void enumerateMics() }, [enumerateMics])
  const requestMicAccess = useCallback(async () => {
    // Labels are only exposed after a getUserMedia grant.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      for (const t of stream.getTracks()) t.stop()
      await enumerateMics()
    } catch { /* denied — leave list as deviceIds only */ }
  }, [enumerateMics])

  // ── Hold-to-Talk test button ──
  const [held, setHeld] = useState(false)
  const pttDown = useCallback(() => {
    if (!enabled || held) return
    setHeld(true)
    void window.api.voicePtt(true)
  }, [enabled, held])
  const pttUp = useCallback(() => {
    if (!held) return
    setHeld(false)
    void window.api.voicePtt(false)
  }, [held])

  // ── Shots manager ──
  const [activeCam, setActiveCam] = useState<1 | 2>(1)
  const [addLabel, setAddLabel] = useState('')

  // ── Preset-verify badge (Feature A): the slot ids actually stored on the camera ──
  const [presetIds, setPresetIds] = useState<number[] | null>(null)
  const [verifyMsg, setVerifyMsg] = useState<string>('')
  const [verifying, setVerifying] = useState(false)
  const verifyPresets = useCallback(async () => {
    setVerifying(true)
    setVerifyMsg('')
    try {
      const res = await window.api.cameraGetPresetIds({ camera: activeCam })
      if (res.ok && res.reachable) {
        setPresetIds(res.ids)
        setVerifyMsg(`Camera has ${res.ids.length} preset${res.ids.length === 1 ? '' : 's'}`)
      } else {
        setPresetIds(null)
        setVerifyMsg(res.error || 'Camera unreachable')
      }
    } catch {
      setPresetIds(null)
      setVerifyMsg('Verify failed')
    } finally {
      setVerifying(false)
    }
  }, [activeCam])
  // Switching cameras invalidates the last verify + glide (both are per-camera).
  useEffect(() => { setPresetIds(null); setVerifyMsg(''); setGlide([]) }, [activeCam])

  // ── Glide builder (Feature B): ordered list of shot ids → waypoint sweep ──
  const [glide, setGlide] = useState<number[]>([])
  const [glideSec, setGlideSec] = useState(6)
  const addGlideStop = (id: number): void => setGlide((g) => [...g, id])
  const removeGlideStop = (idx: number): void => setGlide((g) => g.filter((_, i) => i !== idx))
  const playGlide = useCallback(() => {
    if (glide.length < 2) return
    void window.api.cameraSweepWaypoints({ ids: glide, ms: Math.max(1, glideSec) * 1000 })
  }, [glide, glideSec])

  const shotsFor = (cam: 1 | 2): VoiceShot[] => (cam === 1 ? shotMap[1] : shotMap[2]) ?? []

  // Next free preset slot for the active camera (presets start at 2; 1 = Home).
  const nextSlotId = useCallback((cam: 1 | 2): number => {
    const used = new Set(shotsFor(cam).map((s) => s.id))
    for (let n = 2; n <= 254; n++) if (!used.has(n)) return n
    return 2
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shotMap])

  // Persist a new shots array for `cam` and refresh the spoken grammar.
  const writeShots = useCallback(async (cam: 1 | 2, next: VoiceShot[]) => {
    const map = { ...shotMap, [cam]: next }
    await persist('voiceShots', map)
    await window.api.voiceRefreshGrammar()
  }, [shotMap, persist])

  const renameShot = useCallback(async (cam: 1 | 2, id: number, label: string) => {
    const next = shotsFor(cam).map((s) => (s.id === id ? { ...s, label: label.trim() || undefined } : s))
    await writeShots(cam, next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writeShots, shotMap])

  const deleteShot = useCallback(async (cam: 1 | 2, id: number) => {
    const next = shotsFor(cam).filter((s) => s.id !== id)
    await writeShots(cam, next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writeShots, shotMap])

  const recallShot = (id: number): void => { void window.api.cameraRecallPreset({ n: id }) }

  // Save current camera pose into the next free slot, then register it as a shot.
  const saveCurrentAsShot = useCallback(async () => {
    const cam = activeCam
    const id = nextSlotId(cam)
    const label = addLabel.trim()
    await window.api.cameraSavePreset({ id, name: label || undefined })
    const next = [...shotsFor(cam), { id, label: label || undefined }].sort((a, b) => a.id - b.id)
    await writeShots(cam, next)
    setAddLabel('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCam, addLabel, nextSlotId, writeShots, shotMap])

  // ── Advanced tunables (collapsed) ──
  const [advOpen, setAdvOpen] = useState(false)

  const statusCls = status.helper // 'starting' | 'ready' | 'down'
  const shots = shotsFor(activeCam)
  const totalCmds = counts.accepted + counts.rejected
  const rejectPct = totalCmds > 0 ? Math.round((counts.rejected / totalCmds) * 100) : 0

  return (
    <div className="voice-panel" style={{ colorScheme: 'dark' }}>
      {/* ── Master enable ── */}
      <div className="voice-row">
        <input
          type="checkbox"
          id="voice-enabled"
          checked={enabled}
          onChange={(e) => void persist('voiceEnabled', e.target.checked)}
        />
        <label htmlFor="voice-enabled" style={{ fontSize: 12, fontWeight: 600 }}>
          Voice Control (push-to-talk)
        </label>
      </div>
      <p className="voice-help" style={{ marginTop: -2 }}>
        Hold the deck PTT key and speak a command. Off-air safe: nothing is heard unless held.
      </p>

      {/* Everything below dims + goes inert when the master toggle is off. */}
      <div className={'voice-panel' + (enabled ? '' : ' disabled')} aria-disabled={!enabled}>
        {/* ── Status pill + listening indicator ── */}
        <div className="voice-status">
          <span className={`voice-status-pill ${statusCls}`}>
            <span className="voice-dot" />
            {HELPER_LABEL[status.helper]}
          </span>
          <span className={'voice-listening' + (status.listening ? ' on' : '')}>
            <span className="voice-dot" />
            {status.wake ? 'Hands-free' : status.listening ? 'Listening' : 'Idle'}
          </span>
        </div>

        {/* ── Heard toast ── */}
        {toast && (
          <div className={`voice-toast ${toast.ok ? 'ok' : 'bad'}${toastFading ? ' fading' : ''}`}>
            {toast.ok ? '✓ ' : '✗ '}{toast.text}
          </div>
        )}

        {/* ── Command history (rolling, newest first) ── */}
        {history.length > 0 && (
          <div className="voice-history" title="Last 12 voice commands (newest on top)">
            {history.map((r, i) => (
              <div className="voice-history-row" key={`${r.text}|${r.confidence}|${i}`}>
                <span className={'voice-history-dot' + (r.ok ? ' ok' : ' bad')} />
                <span className="voice-history-text">{r.text}</span>
                <span className="voice-history-conf">{r.confidence.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Hold to Talk (test) ── */}
        <button
          type="button"
          className={'voice-ptt-btn' + (held ? ' held' : '')}
          disabled={!enabled}
          onPointerDown={pttDown}
          onPointerUp={pttUp}
          onPointerLeave={pttUp}
        >
          {held ? '● Listening — release to send' : 'Hold to Talk (test)'}
        </button>

        {/* ── Mic picker ── */}
        <div className="voice-row">
          <span className="voice-label">Microphone</span>
          <select
            value={micDeviceId}
            onChange={(e) => void persist('voiceMicDeviceId', e.target.value)}
            disabled={!enabled}
          >
            <option value="">System default</option>
            {micDeviceId && !mics.some((m) => m.label === micDeviceId) && <option value={micDeviceId}>{micDeviceId}</option>}
            {mics.map((m) => (
              <option key={m.deviceId} value={m.label}>
                {m.label}
              </option>
            ))}
          </select>
          <button className="voice-btn small" disabled={!enabled} onClick={() => void requestMicAccess()} title="Grant mic access to list device names">
            Detect
          </button>
        </div>

        {/* ── Confidence floor ── */}
        <div className="voice-row">
          <span className="voice-label">Confidence</span>
          <input
            className="voice-slider"
            type="range"
            min={0.3}
            max={0.95}
            step={0.05}
            value={confidenceFloor}
            disabled={!enabled}
            onChange={(e) => void persist('voiceConfidenceFloor', parseFloat(e.target.value))}
          />
          <span className="voice-slider-val">{confidenceFloor.toFixed(2)}</span>
        </div>

        {/* ── Empirical accept/reject readout (tune the floor against this) ── */}
        <div className="voice-tally">
          <span className="voice-tally-text">
            accepted {counts.accepted} · rejected {counts.rejected} ({rejectPct}% reject)
          </span>
          <button
            type="button"
            className="voice-btn small"
            disabled={totalCmds === 0}
            onClick={resetCounts}
            title="Reset the accept/reject counters"
          >
            Reset
          </button>
        </div>

        {/* ── Hands-free wake word (Feature C) ── */}
        <div className="voice-section-title">Hands-free</div>
        <div className="voice-row">
          <input
            type="checkbox"
            id="voice-wake-enabled"
            checked={wakeEnabled}
            disabled={!enabled}
            onChange={(e) => void persist('voiceWakeEnabled', e.target.checked)}
          />
          <label htmlFor="voice-wake-enabled" className="voice-label" style={{ flex: 1 }}>
            Wake word (no PTT key)
          </label>
          <input
            className="voice-text"
            type="text"
            defaultValue={wakeWord}
            placeholder="broadcast"
            disabled={!enabled}
            style={{ maxWidth: 120 }}
            onBlur={(e) => {
              const w = e.target.value.trim() || 'broadcast'
              if (w !== wakeWord) void persist('voiceWakeWord', w)
            }}
          />
        </div>
        <p className="voice-help" style={{ marginTop: -2 }}>
          {wakeEnabled
            ? `Listening continuously — prefix every command, e.g. "${wakeWord} push in".`
            : 'On: the helper listens continuously and every command must start with the wake word.'}
        </p>

        {/* ── Shots manager ── */}
        <div className="voice-section-title voice-section-title-row">
          <span>Shots (spoken: "shot N" or its label)</span>
          <button
            type="button"
            className="voice-btn small"
            disabled={!enabled || verifying}
            onClick={() => void verifyPresets()}
            title="Read the camera's stored presets and flag any saved shot whose slot was deleted on the camera"
          >
            {verifying ? 'Verifying…' : 'Verify'}
          </button>
        </div>
        {verifyMsg && <div className="voice-verify-msg">{verifyMsg}</div>}
        <div className="voice-row">
          <span className="voice-label">Camera</span>
          <div className="voice-segment">
            <button className={activeCam === 1 ? 'active' : ''} onClick={() => setActiveCam(1)}>Cam 1</button>
            <button className={activeCam === 2 ? 'active' : ''} onClick={() => setActiveCam(2)}>Cam 2</button>
          </div>
        </div>

        <div className="voice-shots">
          {shots.length === 0 ? (
            <span className="voice-shots-empty">No shots saved for Camera {activeCam}.</span>
          ) : (
            shots.map((s) => {
              const onCamera = presetIds == null ? null : presetIds.includes(s.id)
              return (
              <div className="voice-shot-row" key={s.id}>
                <span className="voice-shot-id">{s.id}</span>
                {onCamera != null && (
                  <span
                    className={'voice-shot-badge' + (onCamera ? ' ok' : ' missing')}
                    title={onCamera ? 'Preset is stored on the camera' : 'Preset is NOT on the camera — recall will do nothing. Re-save it.'}
                  >
                    {onCamera ? '✓' : '⚠'}
                  </span>
                )}
                <input
                  className="voice-text"
                  type="text"
                  defaultValue={s.label || ''}
                  placeholder={`shot ${s.id} (no label)`}
                  disabled={!enabled}
                  onBlur={(e) => {
                    if ((e.target.value.trim() || '') !== (s.label || '')) {
                      void renameShot(activeCam, s.id, e.target.value)
                    }
                  }}
                />
                <button className="voice-btn small" disabled={!enabled} onClick={() => addGlideStop(s.id)} title="Append this shot to the glide sequence below">
                  +Glide
                </button>
                <button className="voice-btn small" disabled={!enabled} onClick={() => recallShot(s.id)} title="Recall this preset on the camera">
                  Recall
                </button>
                <button className="voice-shot-del" disabled={!enabled} onClick={() => void deleteShot(activeCam, s.id)} title="Remove this shot">
                  ✕
                </button>
              </div>
              )
            })
          )}
        </div>

        {/* Save current view → next free slot. */}
        <div className="voice-add-row">
          <span className="voice-shot-id" title="Auto-assigned next free slot">{nextSlotId(activeCam)}</span>
          <input
            className="voice-text"
            type="text"
            value={addLabel}
            placeholder="optional spoken label (e.g. drummer)"
            disabled={!enabled}
            onChange={(e) => setAddLabel(e.target.value)}
          />
          <button className="voice-btn" disabled={!enabled} onClick={() => void saveCurrentAsShot()} title="Store the current camera view into the next slot as a shot">
            Save current view as Shot {nextSlotId(activeCam)}
          </button>
        </div>

        {/* ── Glide builder (Feature B): waypoint sweep across ≥2 real presets ── */}
        <div className="voice-section-title">Glide (cinematic sweep across shots)</div>
        <p className="voice-help" style={{ marginTop: -2 }}>
          Add shots above with "+Glide", set the duration, then play. The camera glides
          through each saved preset in order (native recalls — smooth, no drift).
        </p>
        <div className="voice-glide-seq">
          {glide.length === 0 ? (
            <span className="voice-shots-empty">No glide stops — add shots with "+Glide".</span>
          ) : (
            glide.map((id, idx) => (
              <span className="voice-glide-chip" key={`${id}-${idx}`}>
                {idx > 0 && <span className="voice-glide-arrow">→</span>}
                <span className="voice-glide-chip-id">{id}</span>
                <button className="voice-glide-chip-del" disabled={!enabled} onClick={() => removeGlideStop(idx)} title="Remove this stop">✕</button>
              </span>
            ))
          )}
        </div>
        <div className="voice-row">
          <span className="voice-label">Duration (s)</span>
          <input
            className="voice-num"
            type="number"
            min={1} max={60} step={1}
            value={glideSec}
            disabled={!enabled}
            onChange={(e) => setGlideSec(Math.max(1, Number(e.target.value) || 6))}
          />
          <button
            type="button"
            className="voice-btn"
            disabled={!enabled || glide.length < 2}
            onClick={playGlide}
            title={glide.length < 2 ? 'Add at least 2 stops' : 'Glide through the sequence now'}
          >
            ▸ Play Glide
          </button>
          <button type="button" className="voice-btn small" disabled={glide.length === 0} onClick={() => setGlide([])} title="Clear the glide sequence">
            Clear
          </button>
        </div>

        {/* ── Advanced (collapsed) ── */}
        <div className="voice-advanced-title" onClick={() => setAdvOpen((v) => !v)}>
          <span style={{ fontSize: 10 }}>{advOpen ? '▼' : '▶'}</span>
          Advanced — zoom / push tunables
        </div>
        {advOpen && (
          <div className="voice-advanced-body">
            <div className="voice-row">
              <span className="voice-label">Zoom speed</span>
              <input
                className="voice-num"
                type="number"
                min={1} max={10} step={1}
                defaultValue={settings?.voiceZoomSpeed ?? 3}
                disabled={!enabled}
                onBlur={(e) => void persist('voiceZoomSpeed', Number(e.target.value) || 3)}
              />
            </div>
            <div className="voice-row">
              <span className="voice-label">Zoom nudge ms</span>
              <input
                className="voice-num"
                type="number"
                min={100} max={3000} step={50}
                defaultValue={settings?.voiceZoomNudgeMs ?? 600}
                disabled={!enabled}
                onBlur={(e) => void persist('voiceZoomNudgeMs', Number(e.target.value) || 600)}
              />
            </div>
            <div className="voice-row">
              <span className="voice-label">Slow-push ms</span>
              <input
                className="voice-num"
                type="number"
                min={2000} max={60000} step={500}
                defaultValue={settings?.voiceSlowPushMs ?? 15000}
                disabled={!enabled}
                onBlur={(e) => void persist('voiceSlowPushMs', Number(e.target.value) || 15000)}
              />
            </div>
            <div className="voice-row">
              <span className="voice-label">Slow-push factor</span>
              <input
                className="voice-num"
                type="number"
                min={1.05} max={3} step={0.05}
                defaultValue={settings?.voiceSlowPushFactor ?? 1.3}
                disabled={!enabled}
                onBlur={(e) => void persist('voiceSlowPushFactor', Number(e.target.value) || 1.3)}
              />
            </div>
          </div>
        )}

        {/* ── Cheat-sheet ── */}
        <div className="voice-section-title">Commands</div>
        <div className="voice-cheats">
          {CHEATS.map(([verb, desc]) => (
            <div key={verb}>
              <span className="voice-verb">"{verb}"</span> — {desc}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
