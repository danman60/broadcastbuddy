import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import type { SystemStats as Stats, DiskAlert } from '../../shared/types'
import { IPC } from '../../shared/types'

// CPU/RAM/disk health readout. Seeds from a one-shot systemGetStats(), then
// updates on the ~5s SYSTEM_STATS push. Low-disk / drive-lost alerts surface a
// banner. Ported (simplified) from CompSync's SystemStats panel.

function cpuColor(pct: number): string {
  if (pct >= 90) return '#ef4444'
  if (pct >= 70) return '#f59e0b'
  return '#22c55e'
}

function diskColor(freeGB: number): string {
  if (freeGB < 0) return '#ef4444'
  if (freeGB < 10) return '#ef4444'
  if (freeGB < 30) return '#f59e0b'
  return '#22c55e'
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', background: color, transition: 'width 0.4s ease' }} />
    </div>
  )
}

// Shared system-stats subscription (one-shot seed + ~5s push) and disk alert.
// Consumed by both the full panel and the compact header widget.
function useSystemStats(): { stats: Stats | null; alert: DiskAlert | null } {
  const [stats, setStats] = useState<Stats | null>(null)
  const [alert, setAlert] = useState<DiskAlert | null>(null)

  useEffect(() => {
    window.api.systemGetStats().then(setStats).catch(() => {})
    const onStats = (p: unknown) => setStats(p as Stats)
    const onAlert = (p: unknown) => {
      const a = p as DiskAlert
      setAlert(a.level === 'ok' ? null : a)
    }
    window.api.on(IPC.SYSTEM_STATS, onStats)
    window.api.on(IPC.SYSTEM_DISK_ALERT, onAlert)
    return () => {
      window.api.removeAllListeners(IPC.SYSTEM_STATS)
      window.api.removeAllListeners(IPC.SYSTEM_DISK_ALERT)
    }
  }, [])

  return { stats, alert }
}

/**
 * Compact always-visible CPU / RAM / Disk readout for the top bar. Mirrors
 * CSE's inline header meters (label · mini track · value). Reuses
 * useSystemStats — no duplicate IPC.
 */
export function HeaderSystemStats() {
  const { stats, alert } = useSystemStats()
  if (!stats) return null

  const diskPct = stats.diskTotalGB > 0 ? (1 - stats.diskFreeGB / stats.diskTotalGB) * 100 : 0
  const diskLost = stats.driveLost || stats.diskFreeGB < 0
  const diskBad = !diskLost && (stats.diskFreeGB < 10)

  return (
    <div className="header-stats" title={alert ? alert.message : 'System CPU / RAM / Disk'}>
      <div className="header-meter-group" title={`CPU ${stats.cpuPercent}%`}>
        <span className="header-meter-label">CPU</span>
        <div className="header-meter-track">
          <div className="header-meter-fill" style={{ width: `${Math.min(100, stats.cpuPercent)}%`, background: cpuColor(stats.cpuPercent) }} />
        </div>
        <span className="header-meter-value">{stats.cpuPercent}%</span>
      </div>
      <div className="header-meter-group" title={`RAM ${stats.memPercent}%`}>
        <span className="header-meter-label">RAM</span>
        <div className="header-meter-track">
          <div className="header-meter-fill" style={{ width: `${Math.min(100, stats.memPercent)}%`, background: cpuColor(stats.memPercent) }} />
        </div>
        <span className="header-meter-value">{stats.memPercent}%</span>
      </div>
      <div className={`header-meter-group${diskBad ? ' disk-warn' : ''}`} title={diskLost ? 'Drive lost' : `${stats.diskFreeGB} GB free`}>
        <span className="header-meter-label">DSK</span>
        <div className="header-meter-track">
          <div className="header-meter-fill" style={{ width: `${diskLost ? 0 : Math.min(100, diskPct)}%`, background: diskColor(stats.diskFreeGB) }} />
        </div>
        <span className="header-meter-value">{diskLost ? '—' : `${stats.diskFreeGB}G`}</span>
      </div>
    </div>
  )
}

export function SystemStats() {
  const compactMode = useStore((s) => s.compactMode)
  const [collapsed, setCollapsed] = useState(false)
  const { stats, alert } = useSystemStats()

  useEffect(() => {
    if (compactMode) setCollapsed(true)
  }, [compactMode])

  const diskPct = stats && stats.diskTotalGB > 0 ? (1 - stats.diskFreeGB / stats.diskTotalGB) * 100 : 0
  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, marginBottom: 6 }
  const labelStyle: React.CSSProperties = { width: 38, color: 'var(--text-dim)' }
  const valStyle: React.CSSProperties = { width: 70, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }

  return (
    <div className={`panel-section${collapsed ? ' collapsed' : ''}`}>
      <div className="panel-section-title" onClick={() => setCollapsed(!collapsed)}>
        System
        {alert && (
          <span style={{ fontSize: 10, fontWeight: 600, marginLeft: 8, color: '#ef4444' }}>
            {alert.level === 'drive-lost' ? 'drive lost' : 'low disk'}
          </span>
        )}
        <span className="chevron">{collapsed ? '▸' : '▾'}</span>
      </div>
      {!collapsed && (
        <div style={{ padding: '6px 12px 10px' }}>
          {!stats ? (
            <p style={{ fontSize: 11, color: 'var(--text-dim)' }}>Reading system stats…</p>
          ) : (
            <>
              {alert && (
                <div style={{ fontSize: 11, color: '#fca5a5', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4, padding: '4px 8px', marginBottom: 8 }}>
                  ⚠ {alert.message}
                </div>
              )}
              <div style={rowStyle}>
                <span style={labelStyle}>CPU</span>
                <Bar pct={stats.cpuPercent} color={cpuColor(stats.cpuPercent)} />
                <span style={valStyle}>{stats.cpuPercent}%</span>
              </div>
              <div style={rowStyle}>
                <span style={labelStyle}>RAM</span>
                <Bar pct={stats.memPercent} color={cpuColor(stats.memPercent)} />
                <span style={valStyle}>{stats.memPercent}%</span>
              </div>
              <div style={rowStyle}>
                <span style={labelStyle}>Disk</span>
                <Bar pct={diskPct} color={diskColor(stats.diskFreeGB)} />
                <span style={valStyle}>
                  {stats.driveLost || stats.diskFreeGB < 0 ? '—' : `${stats.diskFreeGB} GB free`}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
