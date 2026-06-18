import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import type { ChatState } from '../../shared/types'

const EMPTY_STATE: ChatState = { connected: false, enabled: false, messages: [], pinned: [], livestreamPinned: [], bannedAuthors: [] }

export function ChatPanel() {
  const compactMode = useStore((s) => s.compactMode)
  const [collapsed, setCollapsed] = useState(false)
  const [state, setState] = useState<ChatState>(EMPTY_STATE)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (compactMode) setCollapsed(true)
  }, [compactMode])

  useEffect(() => {
    window.api.chatGetState().then((s) => setState(s as ChatState)).catch(() => { /* ignore */ })
    const onUpdate = (next: unknown) => setState(next as ChatState)
    window.api.on('chat:state-update', onUpdate)
    return () => window.api.removeAllListeners('chat:state-update')
  }, [])

  async function handleSend() {
    const text = draft.trim()
    if (!text) return
    const res = await window.api.chatSend(text)
    if (res?.ok) setDraft('')
  }

  function fmtTime(ms: number): string {
    try {
      return new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    } catch {
      return ''
    }
  }

  return (
    <div className={`panel-section${collapsed ? ' collapsed' : ''}`}>
      <div className="panel-section-title" onClick={() => setCollapsed(!collapsed)}>
        Operator Chat
        {state.enabled && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              marginLeft: 8,
              color: state.connected ? '#22c55e' : '#f59e0b',
            }}
          >
            {state.connected ? 'connected' : 'connecting…'}
          </span>
        )}
        <span className="chevron">{collapsed ? '▸' : '▾'}</span>
      </div>
      {!collapsed && (
        <div style={{ padding: '6px 12px 10px' }}>
          {!state.enabled ? (
            <p style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
              Configure Supabase chat in Settings to enable. Supply a Supabase URL,
              anon key, and event ID, then toggle Enable.
            </p>
          ) : (
            <>
              {/* Message list */}
              <div
                style={{
                  maxHeight: 180,
                  overflowY: 'auto',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: 6,
                  marginBottom: 6,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                {state.messages.length === 0 ? (
                  <p style={{ fontSize: 11, color: 'var(--text-dim)' }}>No messages yet.</p>
                ) : (
                  state.messages.map((m) => {
                    const lsPinned = !!m.livestreamPinned
                    return (
                      <div
                        key={m.id}
                        style={{
                          fontSize: 12,
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 6,
                          background: m.pinned ? 'rgba(102,126,234,0.12)' : lsPinned ? 'rgba(34,197,94,0.12)' : 'transparent',
                          borderRadius: 4,
                          padding: '2px 4px',
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontWeight: 600 }}>{m.author}</span>
                          <span style={{ color: 'var(--text-dim)', fontSize: 10, marginLeft: 6 }}>
                            {fmtTime(m.createdAt)}
                          </span>
                          <div style={{ wordBreak: 'break-word' }}>{m.text}</div>
                        </div>
                        <div style={{ display: 'flex', flexShrink: 0, gap: 3, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <button
                            className="btn-sm btn-loop-off"
                            title={m.pinned ? 'Unpin operator overlay' : 'Pin to screen as a lower-third (operator)'}
                            onClick={() => (m.pinned ? window.api.chatUnpin(m.id) : window.api.chatPin(m.id))}
                          >
                            {m.pinned ? 'Unpin' : 'Pin'}
                          </button>
                          <button
                            className={lsPinned ? 'btn-sm btn-loop-active' : 'btn-sm btn-loop-off'}
                            title={lsPinned ? 'Remove from public livestream overlay' : 'Pin for the PUBLIC livestream overlay (max 3)'}
                            onClick={() => (lsPinned ? window.api.chatLivestreamUnpin(m.id) : window.api.chatLivestreamPin(m.id))}
                          >
                            {lsPinned ? 'LS✓' : 'LS'}
                          </button>
                          <button
                            className="btn-sm btn-loop-off"
                            title="Show this message as an on-stream chat overlay"
                            onClick={() => window.api.overlayShowChatMessage(m.author, m.text)}
                          >
                            Screen
                          </button>
                          <button
                            className="btn-sm btn-loop-off"
                            title="Hide this message"
                            onClick={() => window.api.chatHide(m.id)}
                          >
                            Hide
                          </button>
                          <button
                            className="btn-sm btn-loop-off"
                            title={`Ban ${m.author} (hides all their messages)`}
                            onClick={() => window.api.chatBanAuthor(m.author)}
                          >
                            Ban
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Composer */}
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSend() }}
                  placeholder="Message the booth…"
                  style={{ flex: 1 }}
                />
                <button className="btn-sm btn-loop-active" onClick={handleSend}>Send</button>
              </div>

              {/* Banned authors managed list */}
              {state.bannedAuthors.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 4 }}>
                    Banned authors
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {state.bannedAuthors.map((a) => (
                      <span
                        key={a}
                        style={{
                          fontSize: 11,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          background: 'rgba(239,68,68,0.15)',
                          borderRadius: 4,
                          padding: '2px 6px',
                        }}
                      >
                        {a}
                        <button
                          className="btn-sm btn-loop-off"
                          title={`Unban ${a}`}
                          onClick={() => window.api.chatUnbanAuthor(a)}
                          style={{ padding: '0 4px', lineHeight: 1.4 }}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
