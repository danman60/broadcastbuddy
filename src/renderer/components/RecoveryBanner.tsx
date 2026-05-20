import { useEffect, useState } from 'react'
import { initStoreListeners, loadInitialState } from '../store/useStore'
import { IPC } from '../../shared/types'
import type { RecoveryStatus } from '../../shared/types'

/**
 * Crash-recovery banner. On mount, asks main whether an unclean shutdown left a
 * recoverable snapshot. Also listens for the RECOVERY_CHECK push (main fires it
 * once during startup, which may arrive before this component mounts — the
 * on-mount fetch covers that race). Offers Restore / Dismiss.
 */
export function RecoveryBanner() {
  const [status, setStatus] = useState<RecoveryStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.recoveryCheck().then((s) => {
      if (s?.available) setStatus(s as RecoveryStatus)
    }).catch(() => { /* ignore */ })

    const onPush = (s: unknown) => {
      const rs = s as RecoveryStatus
      if (rs?.available) setStatus(rs)
    }
    window.api.on(IPC.RECOVERY_CHECK, onPush)
    return () => window.api.removeAllListeners(IPC.RECOVERY_CHECK)
  }, [])

  if (!status?.available) return null

  function fmtTime(iso: string | null): string {
    if (!iso) return 'unknown'
    try {
      return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    } catch {
      return 'unknown'
    }
  }

  async function restore() {
    setBusy(true)
    try {
      const res = await window.api.recoveryRestore()
      if (res?.restored) {
        // Re-pull state into the renderer store so the restored triggers/overlay show.
        loadInitialState()
        initStoreListeners()
      }
    } finally {
      setBusy(false)
      setStatus(null)
    }
  }

  async function dismiss() {
    setBusy(true)
    try {
      await window.api.recoveryDismiss()
    } finally {
      setBusy(false)
      setStatus(null)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        background: 'rgba(102,126,234,0.18)',
        border: '1px solid #667eea',
        borderRadius: 8,
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        backdropFilter: 'blur(6px)',
        maxWidth: '90%',
      }}
    >
      <span style={{ fontSize: 13 }}>
        Restore previous session
        {status.sessionName ? ` "${status.sessionName}"` : ''} ({status.triggerCount} trigger{status.triggerCount === 1 ? '' : 's'},
        last active {fmtTime(status.lastActive)})?
      </span>
      <button className="btn btn-primary btn-sm" disabled={busy} onClick={restore}>Restore</button>
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={dismiss}>Dismiss</button>
    </div>
  )
}
