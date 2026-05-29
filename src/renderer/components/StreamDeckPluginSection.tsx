import { useEffect, useState } from 'react'
import type { StreamDeckStatus } from '../../shared/types'

// Settings section: detect Stream Deck + one-click install the bundled plugin.
// Windows-only (matches the installer service). Ported from CompSync.

export function StreamDeckPluginSection() {
  const [status, setStatus] = useState<StreamDeckStatus | null>(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState(false)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    try {
      setStatus(await window.api.streamdeckGetStatus())
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function install() {
    setBusy(true)
    setMsg('')
    setErr(false)
    try {
      const r = await window.api.streamdeckInstallPlugin()
      if (r.ok) {
        setMsg(`Installed ${r.filesCopied ?? 0} files`)
        await refresh()
      } else {
        setErr(true)
        setMsg(r.error || 'Install failed')
      }
    } catch (e) {
      setErr(true)
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const canInstall = !!status?.supported && !!status?.streamDeckInstalled && !!status?.bundledAvailable && !busy
  const yn = (v: boolean | undefined) => (v ? 'Yes' : 'No')

  return (
    <div className="settings-group">
      <div className="settings-group-title">Stream Deck Plugin</div>
      {!status ? (
        <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>Checking…</p>
      ) : !status.supported ? (
        <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          One-click install is Windows-only. On other platforms, copy the plugin folder manually.
        </p>
      ) : (
        <>
          <div style={{ fontSize: 12, lineHeight: 1.7, marginBottom: 8 }}>
            <div>Stream Deck installed: <strong>{yn(status.streamDeckInstalled)}</strong></div>
            <div>Plugin installed: <strong>{yn(status.pluginInstalled)}</strong></div>
            <div>Bundled plugin available: <strong>{yn(status.bundledAvailable)}</strong></div>
          </div>
          <button className="btn" disabled={!canInstall} onClick={install}>
            {busy ? 'Installing…' : status.pluginInstalled ? 'Reinstall plugin' : 'Install plugin'}
          </button>
          {!status.streamDeckInstalled && (
            <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
              Stream Deck software not detected — install it first.
            </p>
          )}
          {!status.bundledAvailable && (
            <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
              No bundled plugin found in this build.
            </p>
          )}
          {msg && (
            <p style={{ fontSize: 11, marginTop: 6, color: err ? '#fca5a5' : '#22c55e' }}>{msg}</p>
          )}
        </>
      )}
    </div>
  )
}
