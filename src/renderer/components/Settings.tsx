import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import type { AppSettings } from '../../shared/types'
import '../styles/settings.css'

export function Settings() {
  const { settings, setSettings, setShowSettings } = useStore()

  const [httpPort, setHttpPort] = useState(9876)
  const [wsPort, setWsPort] = useState(9877)
  const [apiKey, setApiKey] = useState('')
  const [geminiKey, setGeminiKey] = useState('')

  // OBS connection
  const [obsHost, setObsHost] = useState('127.0.0.1')
  const [obsPort, setObsPort] = useState(4455)
  const [obsPassword, setObsPassword] = useState('')
  const [obsConnected, setObsConnected] = useState(false)
  const [obsError, setObsError] = useState('')

  useEffect(() => {
    if (settings) {
      setHttpPort(settings.server.httpPort)
      setWsPort(settings.server.wsPort)
      setApiKey(settings.deepseekApiKey)
      setGeminiKey(settings.geminiApiKey || '')
      if (settings.obsConnection) {
        setObsHost(settings.obsConnection.host)
        setObsPort(settings.obsConnection.port)
        setObsPassword(settings.obsConnection.password)
      }
    }
    checkObsStatus()
  }, [settings])

  async function checkObsStatus() {
    const status = await window.api.obsStatus()
    setObsConnected(status?.connected || false)
  }

  async function handleObsConnect() {
    setObsError('')
    const result = await window.api.obsConnect(obsHost, obsPort, obsPassword || undefined)
    if (result.connected) {
      setObsConnected(true)
      // Save connection settings
      await window.api.settingsSet('obsConnection', { host: obsHost, port: obsPort, password: obsPassword })
    } else {
      setObsError(result.error || 'Connection failed')
    }
  }

  async function handleObsDisconnect() {
    await window.api.obsDisconnect()
    setObsConnected(false)
  }

  async function handleSave() {
    await window.api.settingsSet('server', { httpPort, wsPort })
    await window.api.settingsSet('deepseekApiKey', apiKey)
    await window.api.settingsSet('geminiApiKey', geminiKey)
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
          <div className="settings-group-title">OBS Connection</div>
          <div className="settings-field-inline">
            <label style={{ minWidth: 100 }}>Host</label>
            <input
              type="text"
              value={obsHost}
              onChange={(e) => setObsHost(e.target.value)}
              placeholder="127.0.0.1"
            />
          </div>
          <div className="settings-field-inline">
            <label style={{ minWidth: 100 }}>Port</label>
            <input
              type="number"
              value={obsPort}
              onChange={(e) => setObsPort(Number(e.target.value))}
            />
          </div>
          <div className="settings-field-inline">
            <label style={{ minWidth: 100 }}>Password</label>
            <input
              type="password"
              value={obsPassword}
              onChange={(e) => setObsPassword(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            {obsConnected ? (
              <>
                <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600 }}>Connected</span>
                <button className="btn btn-ghost btn-sm" onClick={handleObsDisconnect}>
                  Disconnect
                </button>
              </>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={handleObsConnect}>
                Connect to OBS
              </button>
            )}
          </div>
          {obsError && (
            <p style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{obsError}</p>
          )}
          <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            Enable OBS WebSocket in OBS: Tools &gt; WebSocket Server Settings.
            Notes will include recording timecodes when connected.
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
          <div className="settings-field">
            <label>Gemini API Key</label>
            <input
              type="password"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              placeholder="AIza..."
            />
            <p style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
              Used for Gallery Builder video analysis
            </p>
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
