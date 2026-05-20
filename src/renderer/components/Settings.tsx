import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import type { AppSettings, MonitorInfo, WifiDisplaySettings } from '../../shared/types'
import { DEFAULT_WIFI_DISPLAY } from '../../shared/types'
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

  // R2 / Storage
  const [r2Endpoint, setR2Endpoint] = useState('')
  const [r2AccessKeyId, setR2AccessKeyId] = useState('')
  const [r2SecretAccessKey, setR2SecretAccessKey] = useState('')
  const [r2Bucket, setR2Bucket] = useState('streamstage-galleries')

  // WiFi Display (tablet stream)
  const [monitors, setMonitors] = useState<MonitorInfo[]>([])
  const [wifi, setWifi] = useState<WifiDisplaySettings>(DEFAULT_WIFI_DISPLAY)
  const [wifiRunning, setWifiRunning] = useState(false)
  const [wifiError, setWifiError] = useState('')

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
      if (settings.r2Config) {
        setR2Endpoint(settings.r2Config.endpoint || '')
        setR2AccessKeyId(settings.r2Config.accessKeyId || '')
        setR2SecretAccessKey(settings.r2Config.secretAccessKey || '')
        setR2Bucket(settings.r2Config.bucket || 'streamstage-galleries')
      }
      if (settings.wifiDisplay) {
        setWifi(settings.wifiDisplay)
      }
    }
    checkObsStatus()
    refreshMonitors()
    refreshWifiStatus()
  }, [settings])

  async function refreshMonitors() {
    try {
      const m = await window.api.wifiDisplayGetMonitors()
      setMonitors(m || [])
    } catch {
      setMonitors([])
    }
  }

  async function refreshWifiStatus() {
    try {
      const s = await window.api.wifiDisplayStatus()
      setWifiRunning(!!s?.running)
    } catch {
      setWifiRunning(false)
    }
  }

  function updateWifi(patch: Partial<WifiDisplaySettings>) {
    setWifi((prev) => ({ ...prev, ...patch }))
  }

  async function handleWifiStart() {
    setWifiError('')
    // Persist settings first so the service reads the latest values.
    await window.api.settingsSet('wifiDisplay', wifi)
    const result = await window.api.wifiDisplayStart()
    if (result && (result as { error?: string }).error) {
      setWifiError((result as { error?: string }).error || 'Start failed')
      setWifiRunning(false)
    } else {
      setWifiRunning(!!(result as { running?: boolean }).running)
    }
  }

  async function handleWifiStop() {
    setWifiError('')
    await window.api.wifiDisplayStop()
    setWifiRunning(false)
  }

  async function handleWifiPingTablet() {
    try {
      await window.api.wifiDisplayPingTablet()
    } catch {}
  }

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
    await window.api.settingsSet('r2Config', { endpoint: r2Endpoint, accessKeyId: r2AccessKeyId, secretAccessKey: r2SecretAccessKey, bucket: r2Bucket })
    await window.api.settingsSet('wifiDisplay', wifi)
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

        <div className="settings-group">
          <div className="settings-group-title">R2 / Storage (Gallery Photos)</div>
          <div className="settings-field">
            <label>R2 Endpoint</label>
            <input
              type="text"
              value={r2Endpoint}
              onChange={(e) => setR2Endpoint(e.target.value)}
              placeholder="https://xxxxx.r2.cloudflarestorage.com"
            />
          </div>
          <div className="settings-field">
            <label>Access Key ID</label>
            <input
              type="text"
              value={r2AccessKeyId}
              onChange={(e) => setR2AccessKeyId(e.target.value)}
              placeholder="R2 access key"
            />
          </div>
          <div className="settings-field">
            <label>Secret Access Key</label>
            <input
              type="password"
              value={r2SecretAccessKey}
              onChange={(e) => setR2SecretAccessKey(e.target.value)}
              placeholder="R2 secret key"
            />
          </div>
          <div className="settings-field">
            <label>Bucket</label>
            <input
              type="text"
              value={r2Bucket}
              onChange={(e) => setR2Bucket(e.target.value)}
              placeholder="streamstage-galleries"
            />
          </div>
          <p style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
            Photos upload direct to R2 — CC API is metadata only
          </p>
        </div>

        <div className="settings-group">
          <div className="settings-group-title">Tablet Display (WiFi)</div>
          <p style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            Stream a monitor to a wireless tablet via wifi-display-server. Touch input on
            the tablet controls the PC. Pair with the CSController APK.
          </p>
          <div className="settings-field">
            <label>Monitor</label>
            <select
              value={wifi.monitorIndex ?? ''}
              onChange={(e) => updateWifi({ monitorIndex: e.target.value === '' ? null : parseInt(e.target.value) })}
            >
              <option value="">Select monitor...</option>
              {monitors.map((m, i) => (
                <option key={m.id} value={i}>
                  {m.label || `Display ${i + 1}`} ({m.width}x{m.height})
                </option>
              ))}
            </select>
          </div>
          <div className="settings-field-inline">
            <label style={{ minWidth: 100 }}>Bitrate (kbps)</label>
            <input
              type="number"
              min={1000}
              max={10000}
              step={500}
              value={wifi.bitrate}
              onChange={(e) => updateWifi({ bitrate: parseInt(e.target.value) || 3000 })}
            />
          </div>
          <div className="settings-field-inline">
            <label style={{ minWidth: 100 }}>FPS</label>
            <select
              value={wifi.fps}
              onChange={(e) => updateWifi({ fps: parseInt(e.target.value) })}
            >
              <option value={15}>15</option>
              <option value={24}>24</option>
              <option value={30}>30</option>
              <option value={60}>60</option>
            </select>
          </div>
          <div className="settings-field-inline">
            <label style={{ minWidth: 100 }}>Encoder</label>
            <select
              value={wifi.encoder ?? 'openh264'}
              onChange={(e) => updateWifi({ encoder: e.target.value as 'openh264' | 'hevc-nvenc' })}
            >
              <option value="openh264">H.264 (OpenH264)</option>
              <option value="hevc-nvenc">H.265/HEVC (NVENC)</option>
            </select>
          </div>
          <div className="settings-field-inline">
            <label style={{ minWidth: 100 }}>Client IP</label>
            <input
              type="text"
              value={wifi.clientIp || ''}
              placeholder="broadcast (leave empty)"
              onChange={(e) => updateWifi({ clientIp: e.target.value || null })}
            />
          </div>
          <div className="settings-field-inline">
            <label style={{ minWidth: 100 }}>Video Port</label>
            <input
              type="number"
              value={wifi.videoPort}
              onChange={(e) => updateWifi({ videoPort: parseInt(e.target.value) || 5000 })}
            />
          </div>
          <div className="settings-field-inline">
            <label style={{ minWidth: 100 }}>Touch Port</label>
            <input
              type="number"
              value={wifi.touchPort}
              onChange={(e) => updateWifi({ touchPort: parseInt(e.target.value) || 5001 })}
            />
          </div>
          <div className="settings-field-inline">
            <label style={{ minWidth: 100 }}>Auto-start</label>
            <input
              type="checkbox"
              checked={wifi.autoStart}
              onChange={(e) => updateWifi({ autoStart: e.target.checked })}
            />
            <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 8 }}>
              Start tablet stream when BroadcastBuddy launches
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            {wifiRunning ? (
              <>
                <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600 }}>Running</span>
                <button className="btn btn-ghost btn-sm" onClick={handleWifiStop}>Stop</button>
                <button className="btn btn-ghost btn-sm" onClick={handleWifiPingTablet}>Ping Tablet</button>
              </>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={handleWifiStart}>
                Start Streaming
              </button>
            )}
          </div>
          {wifiError && (
            <p style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{wifiError}</p>
          )}
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
