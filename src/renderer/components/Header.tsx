import { useState, useRef, useEffect } from 'react'
import { useStore } from '../store/useStore'
import '../styles/header.css'

export function Header() {
  const { currentSession, sessionList, setCurrentSession, setSessionList, setShowSettings } = useStore()
  const [showLoadMenu, setShowLoadMenu] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

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

    // Create new session first
    const newSession = await window.api.sessionNew(name)
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

  return (
    <div className="header">
      <div className="header-left">
        <span className="header-title">BroadcastBuddy</span>
        {currentSession && (
          <span className="header-session-name">{currentSession.name}</span>
        )}
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
                minWidth: 200,
                maxHeight: 300,
                overflowY: 'auto',
                zIndex: 50,
              }}
            >
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
            </div>
          )}
        </div>

        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setShowSettings(true)}
        >
          Settings
        </button>
      </div>

      {toast && <div className="header-toast">{toast}</div>}
    </div>
  )
}
