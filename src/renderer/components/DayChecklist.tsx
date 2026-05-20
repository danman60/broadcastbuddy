import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import type { DayChecklistView, DayChecklistItemState } from '../../shared/types'

/**
 * Operator Start-of-Day / End-of-Day checklist modal.
 *
 * This is the operator's OWN pre-show setup / post-show teardown list — gear,
 * stream key, backups — distinct from the CC-pushed broadcast-package checklist
 * (BroadcastPackagePanel). Item definitions are static in the main process;
 * per-day check/skip/na state persists to userData.
 *
 * Open state is driven by store.showDayChecklist ('start' | 'end' | null):
 *   - Start-of-day auto-opens on the first app launch of a new calendar day
 *     (App.tsx → dayChecklistShouldShow).
 *   - End-of-day opens on demand (Header → Tools menu).
 */

const STATE_LABELS: Record<DayChecklistItemState, string> = {
  open: 'Open',
  checked: 'Done',
  skipped: 'Skipped',
  na: 'N/A',
}

const STATE_COLORS: Record<DayChecklistItemState, string> = {
  open: 'var(--text-dim)',
  checked: '#22c55e',
  skipped: '#f59e0b',
  na: '#9ca3af',
}

export function DayChecklist() {
  const kind = useStore((s) => s.showDayChecklist)
  const setShowDayChecklist = useStore((s) => s.setShowDayChecklist)
  const [view, setView] = useState<DayChecklistView | null>(null)

  useEffect(() => {
    if (!kind) {
      setView(null)
      return
    }
    window.api.dayChecklistGet('', kind).then(setView).catch(() => { /* ignore */ })
  }, [kind])

  if (!kind || !view) return null

  const title = kind === 'start' ? 'Start of Day — Setup' : 'End of Day — Teardown'
  const subtitle = kind === 'start'
    ? 'Run through your pre-show setup before going live.'
    : 'Confirm teardown before you pack up.'

  async function setItem(itemId: string, value: DayChecklistItemState) {
    if (!kind) return
    const next = await window.api.dayChecklistSetItem('', kind, itemId, value)
    setView(next)
  }

  async function dismiss() {
    if (kind) await window.api.dayChecklistDismiss('', kind)
    setShowDayChecklist(null)
  }

  const total = view.items.length
  const done = view.items.filter((it) => {
    const st = view.state.items[it.id] ?? 'open'
    return st !== 'open'
  }).length

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true">
      <div className="settings-header">
        <div>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
            {subtitle} <span style={{ marginLeft: 8 }}>{done}/{total} handled · {view.date}</span>
          </div>
        </div>
        <button className="btn btn-ghost" onClick={dismiss}>Done</button>
      </div>
      <div className="settings-body">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 640 }}>
          {view.items.map((it) => {
            const st: DayChecklistItemState = view.state.items[it.id] ?? 'open'
            return (
              <div
                key={it.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '10px 12px',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                  background: st === 'checked' ? 'rgba(34,197,94,0.08)' : 'var(--bg-tertiary)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {it.label}
                    <span style={{ fontSize: 10, fontWeight: 600, color: STATE_COLORS[st] }}>
                      {STATE_LABELS[st]}
                    </span>
                  </div>
                  {it.detail && (
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3, lineHeight: 1.4 }}>
                      {it.detail}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button
                    className={st === 'checked' ? 'btn-sm btn-loop-active' : 'btn-sm btn-loop-off'}
                    title="Mark done"
                    onClick={() => setItem(it.id, st === 'checked' ? 'open' : 'checked')}
                  >
                    Done
                  </button>
                  <button
                    className={st === 'skipped' ? 'btn-sm btn-loop-active' : 'btn-sm btn-loop-off'}
                    title="Skip"
                    onClick={() => setItem(it.id, st === 'skipped' ? 'open' : 'skipped')}
                  >
                    Skip
                  </button>
                  <button
                    className={st === 'na' ? 'btn-sm btn-loop-active' : 'btn-sm btn-loop-off'}
                    title="Not applicable"
                    onClick={() => setItem(it.id, st === 'na' ? 'open' : 'na')}
                  >
                    N/A
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
