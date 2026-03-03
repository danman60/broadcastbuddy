import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import type { AppSettings } from '../../shared/types'
import '../styles/settings.css'

export function Settings() {
  const { settings, setSettings, setShowSettings } = useStore()

  const [httpPort, setHttpPort] = useState(9876)
  const [wsPort, setWsPort] = useState(9877)
  const [apiKey, setApiKey] = useState('')

  useEffect(() => {
    if (settings) {
      setHttpPort(settings.server.httpPort)
      setWsPort(settings.server.wsPort)
      setApiKey(settings.deepseekApiKey)
    }
  }, [settings])

  async function handleSave() {
    await window.api.settingsSet('server', { httpPort, wsPort })
    await window.api.settingsSet('deepseekApiKey', apiKey)
    const updated = await window.api.settingsGet()
    setSettings(updated)
    setShowSettings(false)
  }

  return (
    <div className="settings-overlay">
      <div className="settings-header">
        <h2>Settings</h2>
        <button className="btn btn-ghost" onClick={() => setShowSettings(false)}>
          Close
        </button>
      </div>
      <div className="settings-body">
        <div className="settings-group">
          <div className="settings-group-title">Server</div>
          <div className="settings-field-inline">
            <label style={{ minWidth: 100 }}>HTTP Port</label>
            <input
              type="number"
              value={httpPort}
              onChange={(e) => setHttpPort(Number(e.target.value))}
            />
          </div>
          <div className="settings-field-inline">
            <label style={{ minWidth: 100 }}>WebSocket Port</label>
            <input
              type="number"
              value={wsPort}
              onChange={(e) => setWsPort(Number(e.target.value))}
            />
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            Restart app after changing ports.
          </p>
        </div>

        <div className="settings-group">
          <div className="settings-group-title">AI / Document Import</div>
          <div className="settings-field">
            <label>DeepSeek API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
            />
          </div>
        </div>

        <div style={{ marginTop: 8 }}>
          <button className="btn btn-primary" onClick={handleSave}>
            Save Settings
          </button>
        </div>
      </div>
    </div>
  )
}
