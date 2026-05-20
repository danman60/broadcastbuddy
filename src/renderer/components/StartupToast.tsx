import { useEffect, useState } from 'react'
import { IPC } from '../../shared/types'
import type { StartupReport } from '../../shared/types'

/**
 * Small startup toast. Shows only when startup checks produced warnings or
 * failures (an all-ok run stays silent — the Event Log records it anyway).
 * Auto-dismisses after 12s; manual dismiss available.
 */
export function StartupToast() {
  const [report, setReport] = useState<StartupReport | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    window.api.startupGetReport().then((r) => {
      if (r) setReport(r as StartupReport)
    }).catch(() => { /* ignore */ })

    const onPush = (r: unknown) => setReport(r as StartupReport)
    window.api.on(IPC.STARTUP_REPORT, onPush)
    return () => window.api.removeAllListeners(IPC.STARTUP_REPORT)
  }, [])

  useEffect(() => {
    if (!report) return
    const t = setTimeout(() => setDismissed(true), 12_000)
    return () => clearTimeout(t)
  }, [report])

  if (!report || dismissed) return null
  const problems = report.checks.filter((c) => c.status !== 'ok')
  if (problems.length === 0) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 12,
        right: 12,
        zIndex: 1000,
        background: 'rgba(30,30,46,0.96)',
        border: '1px solid #f59e0b',
        borderRadius: 8,
        padding: '10px 14px',
        maxWidth: 360,
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <strong style={{ fontSize: 12 }}>Startup checks</strong>
        <button className="btn btn-ghost btn-sm" onClick={() => setDismissed(true)}>✕</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {problems.map((c) => (
          <div key={c.name} style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'baseline' }}>
            <span style={{ color: c.status === 'fail' ? '#f87171' : '#fbbf24', fontWeight: 600, minWidth: 36 }}>
              {c.status}
            </span>
            <span>
              <strong>{c.name}</strong>
              <span style={{ color: 'var(--text-dim)', marginLeft: 6 }}>{c.detail}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
