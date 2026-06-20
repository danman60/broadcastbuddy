import { useState, useRef, useEffect } from 'react'
import { useStore } from '../store/useStore'
import type { RecordState, CCEvent, BroadcastPackage } from '../../shared/types'
import { IPC } from '../../shared/types'
import { HeaderAudioMeter } from './AudioMeters'
import { HeaderSystemStats } from './SystemStats'
import '../styles/header.css'

export function Header() {
  const { currentSession, sessionList, setCurrentSession, setSessionList, setShowSettings, setShowBrandKit, setShowImport, compactMode, setCompactMode, setShowDayChecklist, setShowStartingSoonEditor } = useStore()
  const settings = useStore((s) => s.settings)
  const [showLoadMenu, setShowLoadMenu] = useState(false)
  // Command Center upcoming events, merged into the Load dropdown.
  const [ccEvents, setCcEvents] = useState<CCEvent[]>([])
  const [ccLoading, setCcLoading] = useState(false)
  const [ccError, setCcError] = useState('')
  const [ccApplyingId, setCcApplyingId] = useState<string | null>(null)
  const [showToolsMenu, setShowToolsMenu] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [wifiDisplayRunning, setWifiDisplayRunning] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recTimecode, setRecTimecode] = useState('')
  const [recBusy, setRecBusy] = useState(false)

  // Poll WiFi display status on mount so the Tablet badge reflects autoStart.
  useEffect(() => {
    window.api?.wifiDisplayStatus?.().then((s) => {
      if (s) setWifiDisplayRunning(!!s.running)
    }).catch(() => {})
  }, [])

  // Record state: seed from a one-shot status query, then react to live
  // RecordStateChanged pushes (OBS Outputs subscription → main → renderer).
  useEffect(() => {
    window.api?.obsRecordStatus?.().then((s) => {
      if (s) {
        setRecording(!!s.active)
        setRecTimecode(s.timecode || '')
      }
    }).catch(() => {})
    const onUpdate = (next: unknown) => {
      const s = next as RecordState
      setRecording(!!s.active)
      if (!s.active) setRecTimecode('')
    }
    window.api.on(IPC.OBS_RECORD_STATE_UPDATE, onUpdate)
    return () => window.api.removeAllListeners(IPC.OBS_RECORD_STATE_UPDATE)
  }, [])

  // While recording, poll the live OBS timecode for the elapsed readout. OBS
  // is the clock source — no local timer that can drift from the real file.
  useEffect(() => {
    if (!recording) return
    let cancelled = false
    const tick = () => {
      window.api?.obsGetTimecode?.().then((tc) => {
        if (!cancelled && tc) setRecTimecode(tc)
      }).catch(() => {})
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => { cancelled = true; clearInterval(id) }
  }, [recording])

  async function handleToggleRecord(): Promise<void> {
    if (recBusy) return
    setRecBusy(true)
    try {
      const res = await window.api.obsToggleRecord()
      if (!res?.success) {
        showToast(res?.error || 'OBS not connected')
      } else {
        // Optimistic flip; the RecordStateChanged push reconciles authoritatively.
        setRecording(!!res.active)
        showToast(res.active ? 'Recording started' : 'Recording stopped')
      }
    } catch {
      showToast('Record toggle failed')
    } finally {
      setRecBusy(false)
    }
  }

  // Trim OBS's HH:MM:SS.mmm timecode down to HH:MM:SS for the badge.
  function fmtTimecode(tc: string): string {
    const dot = tc.indexOf('.')
    return dot >= 0 ? tc.slice(0, dot) : tc
  }

  // One-press recovery: stop → start. Operator workflow when the tablet
  // stream gets a capture-error loop or the tablet went silent. Falls back to
  // opening Settings if no monitor has been picked yet.
  async function handleTabletRestart(): Promise<void> {
    try {
      try { await window.api.wifiDisplayStop() } catch {}
      const result = await window.api.wifiDisplayStart()
      if (result && (result as { error?: string }).error) {
        // No monitor configured (or other start failure) — bounce to Settings.
        setWifiDisplayRunning(false)
        setShowSettings(true)
        showToast((result as { error?: string }).error || 'Open Settings to pick a monitor')
        return
      }
      setWifiDisplayRunning(!!(result as { running?: boolean }).running)
      // Also kick a discover-request so any silent tablet re-announces.
      try { await window.api.wifiDisplayPingTablet() } catch {}
      showToast('Tablet display restarted')
    } catch (err) {
      showToast('Tablet restart failed')
    }
  }

  // Inline input states
  const [showNewInput, setShowNewInput] = useState(false)
  const [newSessionName, setNewSessionName] = useState('')
  const newInputRef = useRef<HTMLInputElement>(null)

  const [showSaveInput, setShowSaveInput] = useState(false)
  const [saveSessionName, setSaveSessionName] = useState('')
  const saveInputRef = useRef<HTMLInputElement>(null)

  // Auto-focus inputs when shown
  useEffect(() => {
    if (showNewInput && newInputRef.current) {
      newInputRef.current.focus()
      newInputRef.current.select()
    }
  }, [showNewInput])

  useEffect(() => {
    if (showSaveInput && saveInputRef.current) {
      saveInputRef.current.focus()
      saveInputRef.current.select()
    }
  }, [showSaveInput])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2000)
  }

  // Handle "New" button - show inline input
  function handleNewClick() {
    setShowNewInput(true)
    setNewSessionName('Untitled Session')
  }

  // Submit new session
  async function submitNewSession() {
    const name = newSessionName.trim()
    if (!name) {
      setShowNewInput(false)
      return
    }
    const session = await window.api.sessionNew(name)
    setCurrentSession(session)
    const list = await window.api.sessionList()
    setSessionList(list)
    setShowNewInput(false)
    showToast('New session created')
  }

  // Cancel new session input
  function cancelNewSession() {
    setShowNewInput(false)
    setNewSessionName('')
  }

  async function handleSave() {
    // If no current session, show input to name it first
    if (!currentSession) {
      setShowSaveInput(true)
      setSaveSessionName('Untitled Session')
      return
    }

    const session = await window.api.sessionSave()
    if (session) {
      setCurrentSession(session)
      const list = await window.api.sessionList()
      setSessionList(list)
      showToast('Session saved')
    } else {
      showToast('Failed to save')
    }
  }

  // Submit save with new name (when no session exists)
  async function submitSaveSession() {
    const name = saveSessionName.trim()
    if (!name) {
      setShowSaveInput(false)
      return
    }

    // Create new session, preserving existing triggers
    const newSession = await window.api.sessionNew(name, true)
    setCurrentSession(newSession)

    // Then save current state to it
    const session = await window.api.sessionSave()
    if (session) {
      setCurrentSession(session)
      const list = await window.api.sessionList()
      setSessionList(list)
      setShowSaveInput(false)
      showToast('Session saved')
    } else {
      showToast('Failed to save')
    }
  }

  // Cancel save input
  function cancelSaveSession() {
    setShowSaveInput(false)
    setSaveSessionName('')
  }

  async function handleLoad(id: string) {
    const session = await window.api.sessionLoad(id)
    if (session) {
      setCurrentSession(session)
      showToast('Session loaded')
    }
    setShowLoadMenu(false)
  }

  // Fetch CC upcoming events when the Load dropdown opens (only if connected).
  const ccConfig = settings?.ccConfig
  const ccConnected = !!(ccConfig?.baseUrl && ccConfig?.apiKey && ccConfig?.tenantId)
  useEffect(() => {
    if (!showLoadMenu || !ccConnected) return
    let cancelled = false
    setCcLoading(true)
    setCcError('')
    window.api
      .ccFetchEvents(ccConfig!.baseUrl, ccConfig!.apiKey, ccConfig!.tenantId)
      .then((res) => {
        if (cancelled) return
        if (!res.success) {
          setCcError(res.error || 'Failed to fetch events')
          setCcEvents([])
        } else {
          setCcEvents(res.events || [])
        }
      })
      .catch((err) => {
        if (!cancelled) setCcError((err as Error).message)
      })
      .finally(() => {
        if (!cancelled) setCcLoading(false)
      })
    return () => { cancelled = true }
  }, [showLoadMenu, ccConnected, ccConfig?.baseUrl, ccConfig?.apiKey, ccConfig?.tenantId])

  // Apply a CC event — mirrors BroadcastPackagePanel.applyPackage exactly:
  // ccFetchPackage → ccApplyPackage.
  async function handleLoadCCEvent(eventId: string) {
    if (!ccConnected) return
    setCcApplyingId(eventId)
    setCcError('')
    try {
      const result = await window.api.ccFetchPackage(
        ccConfig!.baseUrl, ccConfig!.apiKey, ccConfig!.tenantId, eventId,
      )
      if (!result.success) {
        setCcError(result.error || 'Failed to fetch package')
        return
      }
      const pkg = result.package as BroadcastPackage
      const applyResult = await window.api.ccApplyPackage(pkg, eventId)
      if (applyResult.success) {
        showToast(`Loaded ${applyResult.triggerCount} triggers from "${pkg.event.eventName}"`)
        setShowLoadMenu(false)
      } else {
        setCcError('Failed to apply package')
      }
    } catch (err) {
      setCcError((err as Error).message)
    } finally {
      setCcApplyingId(null)
    }
  }

  return (
    <div className="header">
      <div className="header-left">
        <span className="header-title">{compactMode ? 'BB' : 'BroadcastBuddy'}</span>
        {!compactMode && currentSession && (
          <span
            className="header-session-name"
            onClick={() => setCurrentSession(null)}
            title="Click to dismiss"
          >
            {currentSession.name}
          </span>
        )}
      </div>

      {/* Always-visible inline monitoring (CSE-style): audio level + system. */}
      <div className="header-center">
        <HeaderAudioMeter />
        <HeaderSystemStats />
      </div>

      <div className="header-right">
        {/* New Session Input */}
        {showNewInput ? (
          <div className="header-input-group">
            <input
              ref={newInputRef}
              type="text"
              value={newSessionName}
              onChange={(e) => setNewSessionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitNewSession()
                if (e.key === 'Escape') cancelNewSession()
              }}
              onBlur={cancelNewSession}
              className="header-input"
              placeholder="Session name"
            />
          </div>
        ) : (
          <button className="btn btn-ghost btn-sm" onClick={handleNewClick}>New</button>
        )}

        {/* Save Session Input (only shown when no session exists) */}
        {showSaveInput ? (
          <div className="header-input-group">
            <input
              ref={saveInputRef}
              type="text"
              value={saveSessionName}
              onChange={(e) => setSaveSessionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitSaveSession()
                if (e.key === 'Escape') cancelSaveSession()
              }}
              onBlur={cancelSaveSession}
              className="header-input"
              placeholder="Session name"
            />
          </div>
        ) : (
          <button className="btn btn-ghost btn-sm" onClick={handleSave}>Save</button>
        )}

        {/* Load Menu */}
        <div style={{ position: 'relative' }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowLoadMenu(!showLoadMenu)}
          >
            Load
          </button>
          {showLoadMenu && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: 4,
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                minWidth: 240,
                maxHeight: 360,
                overflowY: 'auto',
                zIndex: 50,
              }}
            >
              {/* ── Local saved sessions ── */}
              <div
                style={{
                  padding: '6px 12px',
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.8px',
                  color: 'var(--text-secondary)',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                Saved Sessions
              </div>
              {sessionList.length === 0 ? (
                <div style={{ padding: 12, color: 'var(--text-dim)', fontSize: 12 }}>
                  No saved sessions
                </div>
              ) : (
                sessionList.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleLoad(s.id)}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '8px 12px',
                      background: 'none',
                      color: 'var(--text-primary)',
                      textAlign: 'left',
                      fontSize: 13,
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    {s.name}
                  </button>
                ))
              )}

              {/* ── Command Center upcoming events ── */}
              <div
                style={{
                  padding: '6px 12px',
                  marginTop: 2,
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.8px',
                  color: 'var(--text-secondary)',
                  borderTop: '1px solid var(--border)',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                Command Center Events
              </div>
              {!ccConnected ? (
                <div style={{ padding: 12, color: 'var(--text-dim)', fontSize: 11 }}>
                  Connect Command Center in Settings
                </div>
              ) : ccLoading ? (
                <div style={{ padding: 12, color: 'var(--text-dim)', fontSize: 11 }}>
                  Loading events…
                </div>
              ) : ccError ? (
                <div style={{ padding: 12, color: 'var(--danger)', fontSize: 11 }}>
                  {ccError}
                </div>
              ) : ccEvents.length === 0 ? (
                <div style={{ padding: 12, color: 'var(--text-dim)', fontSize: 11 }}>
                  No upcoming events
                </div>
              ) : (
                ccEvents.map((ev) => (
                  <button
                    key={ev.id}
                    onClick={() => handleLoadCCEvent(ev.id)}
                    disabled={ccApplyingId !== null}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '8px 12px',
                      background: 'none',
                      color: 'var(--text-primary)',
                      textAlign: 'left',
                      fontSize: 13,
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>
                      {ccApplyingId === ev.id ? 'Applying…' : ev.eventName}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                      {ev.client?.organization}
                      {ev.venueName ? ` · ${ev.venueName}` : ''}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Record toggle — start/stop OBS recording. Blinks red while live and
            shows elapsed timecode (OBS is the clock source). */}
        <button
          className={`btn btn-sm header-rec-btn${recording ? ' recording' : ''}`}
          onClick={handleToggleRecord}
          disabled={recBusy}
          title={recording ? 'Click to stop recording' : 'Click to start recording'}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <span className="header-rec-dot" />
          {recording
            ? (recTimecode ? `REC ${fmtTimecode(recTimecode)}` : 'REC')
            : 'REC'}
        </button>

        {/* Tablet (WiFi display) — click to restart + ping tablet */}
        <button
          className="btn btn-ghost btn-sm"
          onClick={handleTabletRestart}
          title="Click to restart tablet display + re-announce to tablet"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: wifiDisplayRunning ? '#22c55e' : '#fbbf24',
              display: 'inline-block',
            }}
          />
          Tablet
        </button>

        {/* View / mode switches pulled out of the Tools grab-bag (inline) */}
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setCompactMode(!compactMode)}
          title="Toggle compact mode"
        >
          ⊟ Compact{compactMode ? ' ON' : ''}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => void window.api.overlayModeToggle()}
          title="Hide the main window and float always-on-top control panels over OBS"
        >
          ⧉ Overlay
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setShowSettings(true)}
          title="Open settings"
        >
          ⚙ Settings
        </button>

        {/* Tools Menu */}
        <div style={{ position: 'relative' }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowToolsMenu(!showToolsMenu)}
          >
            Tools ▼
          </button>
          {showToolsMenu && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: 4,
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                minWidth: 160,
                zIndex: 50,
              }}
            >
              <button
                onClick={() => { setShowBrandKit(true); setShowToolsMenu(false) }}
                style={{
                  display: 'block', width: '100%', padding: '8px 12px',
                  background: 'none', color: 'var(--text-primary)',
                  textAlign: 'left', fontSize: 13, borderBottom: '1px solid var(--border)',
                }}
              >
                Brand Kit
              </button>
              <button
                onClick={() => { setShowImport(true); setShowToolsMenu(false) }}
                style={{
                  display: 'block', width: '100%', padding: '8px 12px',
                  background: 'none', color: 'var(--text-primary)',
                  textAlign: 'left', fontSize: 13, borderBottom: '1px solid var(--border)',
                }}
              >
                Import
              </button>
              <button
                onClick={() => { setShowStartingSoonEditor(true); setShowToolsMenu(false) }}
                style={{
                  display: 'block', width: '100%', padding: '8px 12px',
                  background: 'none', color: 'var(--text-primary)',
                  textAlign: 'left', fontSize: 13, borderBottom: '1px solid var(--border)',
                }}
              >
                Starting Soon Editor
              </button>
              <button
                onClick={() => { setShowDayChecklist('start'); setShowToolsMenu(false) }}
                style={{
                  display: 'block', width: '100%', padding: '8px 12px',
                  background: 'none', color: 'var(--text-primary)',
                  textAlign: 'left', fontSize: 13, borderBottom: '1px solid var(--border)',
                }}
              >
                Start-of-Day Checklist
              </button>
              <button
                onClick={() => { setShowDayChecklist('end'); setShowToolsMenu(false) }}
                style={{
                  display: 'block', width: '100%', padding: '8px 12px',
                  background: 'none', color: 'var(--text-primary)',
                  textAlign: 'left', fontSize: 13,
                }}
              >
                End-of-Day Checklist
              </button>
            </div>
          )}
        </div>
      </div>

      {toast && <div className="header-toast">{toast}</div>}
    </div>
  )
}
