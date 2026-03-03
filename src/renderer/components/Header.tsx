import { useState } from 'react'
import { useStore } from '../store/useStore'
import '../styles/header.css'

export function Header() {
  const { currentSession, sessionList, setCurrentSession, setSessionList, setShowSettings } = useStore()
  const [showLoadMenu, setShowLoadMenu] = useState(false)

  async function handleNew() {
    const name = window.prompt('Session name:', 'Untitled Session')
    if (!name) return
    const session = await window.api.sessionNew(name)
    setCurrentSession(session)
    const list = await window.api.sessionList()
    setSessionList(list)
  }

  async function handleSave() {
    const session = await window.api.sessionSave()
    if (session) {
      setCurrentSession(session)
      const list = await window.api.sessionList()
      setSessionList(list)
    }
  }

  async function handleLoad(id: string) {
    const session = await window.api.sessionLoad(id)
    if (session) setCurrentSession(session)
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
        <button className="btn btn-ghost btn-sm" onClick={handleNew}>New</button>
        <button className="btn btn-ghost btn-sm" onClick={handleSave}>Save</button>
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
    </div>
  )
}
