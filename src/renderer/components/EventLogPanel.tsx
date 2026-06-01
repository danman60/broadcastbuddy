import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { IPC } from '../../shared/types'
import type { EventLogRecord, EventLogKind } from '../../shared/types'

const KIND_COLORS: Record<EventLogKind, string> = {
  session: '#60a5fa',
  overlay: '#a78bfa',
  obs: '#34d399',
  wifi: '#22d3ee',
  gallery: '#fbbf24',
  chat: '#f472b6',
  cc: '#818cf8',
  system: '#94a3b8',
  error: '#f87171',
}

const KINDS: EventLogKind[] = ['session', 'overlay', 'obs', 'wifi', 'gallery', 'chat', 'cc', 'system', 'error']

export function EventLogPanel() {
  const compactMode = useStore((s) => s.compactMode)
  const [collapsed, setCollapsed] = useState(false)
  const [events, setEvents] = useState<EventLogRecord[]>([])
  const [filter, setFilter] = useState<EventLogKind | ''>('')
  const filterRef = useRef<EventLogKind | ''>('')

  useEffect(() => {
    if (compactMode) setCollapsed(true)
  }, [compactMode])

  useEffect(() => { filterRef.current = filter }, [filter])

  // Backfill on mount + when filter changes (main returns newest-first).
  useEffect(() => {
    window.api
      .eventsGetRecent(500, filter || undefined)
      .then((rows) => setEvents(rows as EventLogRecord[]))
      .catch(() => { /* ignore */ })
  }, [filter])

  // Live append on EVENTS_NEW. The main process emits in chronological order;
  // we prepend (newest first) and respect the active kind filter.
  useEffect(() => {
    const onNew = (rec: unknown) => {
      const r = rec as EventLogRecord
      if (filterRef.current && r.kind !== filterRef.current) return
      setEvents((prev) => [r, ...prev].slice(0, 500))
    }
    window.api.on(IPC.EVENTS_NEW, onNew)
    return () => window.api.removeAllListeners(IPC.EVENTS_NEW)
  }, [])

  function fmtTime(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    } catch {
      return ''
    }
  }

  return (
    <div className={`panel-section${collapsed ? ' collapsed' : ''}`}>
      <div className="panel-section-title" onClick={() => setCollapsed(!collapsed)}>
        Event Log
        <span style={{ fontSize: 10, fontWeight: 600, marginLeft: 8, color: 'var(--text-dim)' }}>
          {events.length}
        </span>
        <span className="chevron">{collapsed ? '▸' : '▾'}</span>
      </div>
      {!collapsed && (
        <div style={{ padding: '6px 12px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as EventLogKind | '')}
              onClick={(e) => e.stopPropagation()}
              style={{ flex: 1, fontSize: 11 }}
            >
              <option value="">All kinds</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>
          <div
            style={{
              maxHeight: 220,
              overflowY: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: 6,
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              fontFamily: 'monospace',
            }}
          >
            {events.length === 0 ? (
              <p style={{ fontSize: 11, color: 'var(--text-dim)' }}>No events yet.</p>
            ) : (
              events.map((e, i) => (
                <div key={`${e.t}-${i}`} style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'baseline' }}>
                  <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>{fmtTime(e.t)}</span>
                  <span
                    style={{
                      color: KIND_COLORS[e.kind] ?? '#94a3b8',
                      fontWeight: 600,
                      flexShrink: 0,
                      minWidth: 52,
                    }}
                  >
                    {e.kind}
                  </span>
                  <span style={{ wordBreak: 'break-word' }}>{e.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
