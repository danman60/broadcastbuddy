import { useEffect, useState } from 'react'
import type { ReadinessReport } from '../../shared/types'
import '../styles/readiness.css'

/**
 * Pre-show readiness card (show rail, readinessView === 'panel'). Rows are computed
 * in main (readiness.ts) from live state; this just polls and paints them.
 */
export function ReadinessPanel() {
  const [report, setReport] = useState<ReadinessReport | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => window.api.readinessGet().then((r) => { if (alive) setReport(r) }).catch(() => {})
    load()
    const t = setInterval(load, 3000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const issues = report ? report.rows.filter((r) => r.status === 'warn' || r.status === 'bad').length : 0

  return (
    <div className="panel-section readiness-panel" data-ready={report?.ready ? '1' : '0'}>
      <div className="panel-section-title" style={{ cursor: 'default' }}>
        Pre-show readiness
        {report && (
          <span className={`readiness-badge ${report.ready ? 'ok' : 'bad'}`}>
            {report.ready ? 'READY' : `${issues} TO FIX`}
          </span>
        )}
      </div>
      {!report && <div className="readiness-empty">Checking…</div>}
      {report && (
        <ul className="readiness-rows">
          {report.rows.map((r) => (
            <li key={r.id} className={`readiness-row ${r.status}`}>
              <span className="readiness-dot" />
              <span className="readiness-label">{r.label}</span>
              <span className="readiness-detail" title={r.detail}>{r.detail}</span>
              {r.fix && <span className="readiness-fix">{r.fix}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
