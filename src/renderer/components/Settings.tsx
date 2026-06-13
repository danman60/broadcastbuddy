import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { useStore } from '../store/useStore'
import type { AppSettings, MonitorInfo, WifiDisplaySettings, BackupInfo, HotkeyConfig } from '../../shared/types'
import { DEFAULT_WIFI_DISPLAY, DEFAULT_HOTKEYS } from '../../shared/types'
import { StreamDeckPluginSection } from './StreamDeckPluginSection'
import '../styles/settings.css'

export function Settings() {
  const { settings, setSettings, setShowSettings } = useStore()

  const [httpPort, setHttpPort] = useState(19080)
  const [wsPort, setWsPort] = useState(19081)
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

  // Wi-Fi Direct (no-router) hotspot mode
  const [directActive, setDirectActive] = useState(false)
  const [directSsid, setDirectSsid] = useState('')
  const [directPass, setDirectPass] = useState('')
  const [directQr, setDirectQr] = useState('')
  const [directBusy, setDirectBusy] = useState(false)
  const [directError, setDirectError] = useState('')
  const [directExpanded, setDirectExpanded] = useState(false)

  // EXPERIMENTAL / UNVERIFIED — true Wi-Fi Direct P2P (host advertiser scaffold).
  // Separate from the Direct hotspot panel above. Known-fragile, no native helper.
  const [p2pActive, setP2pActive] = useState(false)
  const [p2pStatus, setP2pStatus] = useState('')
  const [p2pBusy, setP2pBusy] = useState(false)
  const [p2pError, setP2pError] = useState('')
  const [p2pExpanded, setP2pExpanded] = useState(false)

  // EXPERIMENTAL / UNVERIFIED — Option 2 "BLE auto-advertise" no-router pairing.
  // Advertises the SAME hotspot creds the QR path uses; tablet lists the host
  // over BLE with no QR scan. Lives inside the Direct panel; does not disturb QR.
  const [bleActive, setBleActive] = useState(false)
  const [bleBusy, setBleBusy] = useState(false)
  const [bleError, setBleError] = useState('')

  // Operator chat (Supabase Realtime, off by default)
  const [chatUrl, setChatUrl] = useState('')
  const [chatKey, setChatKey] = useState('')
  const [chatEventId, setChatEventId] = useState('')
  const [chatEnabled, setChatEnabled] = useState(false)

  // Settings backups
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [backupMsg, setBackupMsg] = useState('')

  // Global hotkeys
  const [hotkeys, setHotkeys] = useState<HotkeyConfig>(DEFAULT_HOTKEYS)

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
      if (settings.chatConfig) {
        setChatUrl(settings.chatConfig.supabaseUrl || '')
        setChatKey(settings.chatConfig.supabaseAnonKey || '')
        setChatEventId(settings.chatConfig.eventId || '')
        setChatEnabled(!!settings.chatConfig.enabled)
      }
      if (settings.hotkeys) setHotkeys({ ...DEFAULT_HOTKEYS, ...settings.hotkeys })
    }
    checkObsStatus()
    refreshMonitors()
    refreshWifiStatus()
    refreshDirectStatus()
    refreshBleStatus()
    refreshBackups()
  }, [settings])

  async function refreshBackups() {
    try {
      const list = await window.api.backupList()
      setBackups(list as BackupInfo[])
    } catch { /* ignore */ }
  }

  async function handleBackupNow() {
    const res = await window.api.backupNow()
    setBackupMsg(res?.ok ? `Backed up → ${res.file}` : `Backup failed: ${res?.error ?? 'unknown'}`)
    refreshBackups()
  }

  async function handleBackupRestore(file: string) {
    const res = await window.api.backupRestore(file)
    setBackupMsg(res?.ok ? `Restored ${file} — restart BroadcastBuddy to apply` : `Restore failed: ${res?.error ?? 'unknown'}`)
    refreshBackups()
  }

  function fmtBackupTime(iso: string): string {
    try {
      return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    } catch {
      return iso
    }
  }

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

  async function applyDirectStatus(s: { active: boolean; ssid: string; passphrase: string; qrPayload?: string; error?: string }) {
    setDirectActive(!!s.active)
    setDirectSsid(s.ssid || '')
    setDirectPass(s.passphrase || '')
    setDirectError(s.error || '')
    if (s.active && s.qrPayload) {
      try {
        const url = await QRCode.toDataURL(s.qrPayload, { margin: 1, width: 220 })
        setDirectQr(url)
      } catch {
        setDirectQr('')
      }
    } else {
      setDirectQr('')
    }
  }

  async function refreshDirectStatus() {
    try {
      const s = await window.api.directModeStatus()
      await applyDirectStatus(s)
    } catch {
      setDirectActive(false)
    }
  }

  async function handleDirectStart() {
    setDirectBusy(true)
    setDirectError('')
    try {
      const s = await window.api.directModeStart()
      await applyDirectStatus(s)
    } catch (err) {
      setDirectError(err instanceof Error ? err.message : 'Start failed')
      setDirectActive(false)
    } finally {
      setDirectBusy(false)
    }
  }

  async function handleDirectStop() {
    setDirectBusy(true)
    setDirectError('')
    try {
      const s = await window.api.directModeStop()
      await applyDirectStatus(s)
    } catch (err) {
      setDirectError(err instanceof Error ? err.message : 'Stop failed')
    } finally {
      setDirectBusy(false)
    }
  }

  // EXPERIMENTAL / UNVERIFIED — Option 2 "BLE auto-advertise" no-router pairing.
  async function refreshBleStatus() {
    try {
      const s = await window.api.bleAdvertiseStatus()
      setBleActive(!!s.active)
      setBleError(s.error || '')
    } catch {
      setBleActive(false)
    }
  }

  async function handleBleStart() {
    setBleBusy(true)
    setBleError('')
    try {
      const s = await window.api.bleAdvertiseStart()
      setBleActive(!!s.active)
      if (s.error) setBleError(s.error)
    } catch (err) {
      setBleError(err instanceof Error ? err.message : 'Start failed')
      setBleActive(false)
    } finally {
      setBleBusy(false)
    }
  }

  async function handleBleStop() {
    setBleBusy(true)
    setBleError('')
    try {
      const s = await window.api.bleAdvertiseStop()
      setBleActive(!!s.active)
      if (s.error) setBleError(s.error)
    } catch (err) {
      setBleError(err instanceof Error ? err.message : 'Stop failed')
    } finally {
      setBleBusy(false)
    }
  }

  // EXPERIMENTAL / UNVERIFIED — true Wi-Fi Direct P2P (host advertiser scaffold).
  async function handleP2pStart() {
    setP2pBusy(true)
    setP2pError('')
    try {
      const s = await window.api.wifiDirectP2PStart()
      setP2pActive(s.active)
      setP2pStatus(s.publisherStatus || '')
      if (s.error) setP2pError(s.error)
    } catch (err) {
      setP2pError(err instanceof Error ? err.message : 'Start failed')
      setP2pActive(false)
    } finally {
      setP2pBusy(false)
    }
  }

  async function handleP2pStop() {
    setP2pBusy(true)
    setP2pError('')
    try {
      const s = await window.api.wifiDirectP2PStop()
      setP2pActive(s.active)
      setP2pStatus(s.publisherStatus || '')
      if (s.error) setP2pError(s.error)
    } catch (err) {
      setP2pError(err instanceof Error ? err.message : 'Stop failed')
    } finally {
      setP2pBusy(false)
    }
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
    await window.api.settingsSet('hotkeys', hotkeys)
    await window.api.settingsSet('chatConfig', {
      supabaseUrl: chatUrl.trim(),
      supabaseAnonKey: chatKey.trim(),
      eventId: chatEventId.trim(),
      enabled: chatEnabled,
    })
    // (Re)init the chat bridge from the just-saved config. Connects when
    // enabled + configured, disconnects otherwise.
    try { await window.api.chatReconfigure() } catch { /* chat optional */ }
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

        <div className="settings-group">
          <div
            className="settings-group-title"
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => setDirectExpanded((v) => !v)}
          >
            <span style={{ fontSize: 10 }}>{directExpanded ? '▼' : '▶'}</span>
            Direct (No-Router) Mode
            {directActive && (
              <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600, marginLeft: 6 }}>Active</span>
            )}
          </div>
          {directExpanded && (
            <>
              <p style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                Turn this PC into a Wi-Fi hotspot so a tablet can join with no router. Once the
                tablet is on the hotspot, normal tablet discovery + streaming take over. Windows only.
              </p>
              <div className="settings-field-inline">
                <label style={{ minWidth: 130 }}>Enable Direct Mode</label>
                <input
                  type="checkbox"
                  checked={directActive}
                  disabled={directBusy}
                  onChange={(e) => (e.target.checked ? handleDirectStart() : handleDirectStop())}
                />
                {directBusy && (
                  <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 8 }}>Working…</span>
                )}
              </div>
              {directActive && (
                <div style={{ marginTop: 8 }}>
                  <div className="settings-field-inline">
                    <label style={{ minWidth: 130 }}>Network (SSID)</label>
                    <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{directSsid || '—'}</span>
                  </div>
                  <div className="settings-field-inline">
                    <label style={{ minWidth: 130 }}>Password</label>
                    <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{directPass || '—'}</span>
                  </div>
                  {directQr && (
                    <div style={{ marginTop: 8 }}>
                      <p style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
                        Scan with the tablet to join + connect:
                      </p>
                      <img
                        src={directQr}
                        alt="Direct mode QR"
                        style={{ width: 220, height: 220, background: '#fff', borderRadius: 4 }}
                      />
                    </div>
                  )}

                  {/* EXPERIMENTAL / UNVERIFIED — Option 2 BLE auto-advertise.
                      Broadcasts the SAME creds the QR encodes so the tablet can
                      list this host with no QR scan. Does not affect the QR above. */}
                  <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid var(--border, #333)' }}>
                    <div className="settings-field-inline">
                      <label style={{ minWidth: 130 }}>BLE auto-advertise (experimental)</label>
                      <input
                        type="checkbox"
                        checked={bleActive}
                        disabled={bleBusy}
                        onChange={(e) => (e.target.checked ? handleBleStart() : handleBleStop())}
                      />
                      {bleActive && (
                        <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600, marginLeft: 8 }}>Advertising</span>
                      )}
                      {bleBusy && (
                        <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 8 }}>Working…</span>
                      )}
                    </div>
                    <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                      Unverified — Bluetooth peripheral support varies by adapter. Lets the
                      tablet find this host over BLE with no QR scan.
                    </p>
                    {bleError && (
                      <p style={{ fontSize: 11, color: '#ef4444', marginTop: 2 }}>{bleError}</p>
                    )}
                  </div>
                </div>
              )}
              {directError && (
                <p style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{directError}</p>
              )}
            </>
          )}
        </div>

        {/* ── EXPERIMENTAL / UNVERIFIED: true Wi-Fi Direct P2P ──────────────
            Host advertiser is a SCAFFOLD ONLY (no native helper for full
            connection handling). Separate from the Direct hotspot panel above.
            Collapsed by default. Known-fragile, not verified. */}
        <div className="settings-group">
          <div
            className="settings-group-title"
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => setP2pExpanded((v) => !v)}
          >
            <span style={{ fontSize: 10 }}>{p2pExpanded ? '▼' : '▶'}</span>
            Wi-Fi Direct P2P (experimental, incomplete)
            {p2pActive && (
              <span style={{ fontSize: 11, color: '#eab308', fontWeight: 600, marginLeft: 6 }}>Advertising</span>
            )}
          </div>
          {p2pExpanded && (
            <>
              <p style={{ fontSize: 11, color: '#eab308' }}>
                EXPERIMENTAL / UNVERIFIED. This starts a true Wi-Fi Direct (Wi-Fi P2P)
                advertisement so an Android tablet can discover this PC with no router and
                no Mobile Hotspot. It is a SCAFFOLD ONLY — the host advertisement cannot
                survive on its own and full peer-connection / socket handling needs a native
                helper that is not built. Treat as a tech preview; it is not known to work.
                Windows only.
              </p>
              <div className="settings-field-inline">
                <label style={{ minWidth: 130 }}>Enable P2P Advertise</label>
                <input
                  type="checkbox"
                  checked={p2pActive}
                  disabled={p2pBusy}
                  onChange={(e) => (e.target.checked ? handleP2pStart() : handleP2pStop())}
                />
                {p2pBusy && (
                  <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 8 }}>Working…</span>
                )}
              </div>
              {p2pActive && (
                <div className="settings-field-inline" style={{ marginTop: 8 }}>
                  <label style={{ minWidth: 130 }}>Publisher Status</label>
                  <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{p2pStatus || '—'}</span>
                </div>
              )}
              {p2pError && (
                <p style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{p2pError}</p>
              )}
            </>
          )}
        </div>

        <div className="settings-group">
          <div className="settings-group-title">Operator Chat (Supabase Realtime)</div>
          <p style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            Realtime chat between operators (control room ↔ booth) with the ability
            to pin a message as an on-screen lower-third. Off until configured.
            Requires a Supabase project with a <code>chat_messages</code> table
            (schema documented in chatBridge.ts).
          </p>
          <div className="settings-field">
            <label>Supabase URL</label>
            <input
              type="text"
              value={chatUrl}
              onChange={(e) => setChatUrl(e.target.value)}
              placeholder="https://xxxxx.supabase.co"
            />
          </div>
          <div className="settings-field">
            <label>Anon Key</label>
            <input
              type="password"
              value={chatKey}
              onChange={(e) => setChatKey(e.target.value)}
              placeholder="eyJ..."
            />
          </div>
          <div className="settings-field">
            <label>Event ID</label>
            <input
              type="text"
              value={chatEventId}
              onChange={(e) => setChatEventId(e.target.value)}
              placeholder="Scopes chat to one event"
            />
          </div>
          <div className="settings-field-inline">
            <label style={{ minWidth: 100 }}>Enable</label>
            <input
              type="checkbox"
              checked={chatEnabled}
              onChange={(e) => setChatEnabled(e.target.checked)}
            />
            <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 8 }}>
              Connect to Supabase chat when configured
            </span>
          </div>
        </div>

        <div className="settings-group">
          <div className="settings-group-title">Global Hotkeys</div>
          <p style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            OS-level shortcuts that fire even when BroadcastBuddy is not focused.
            Use Electron accelerator strings (e.g. <code>F9</code>, <code>CommandOrControl+1</code>).
            Leave blank to unbind. Saved on "Save Settings".
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {([
              ['fireLowerThird', 'Fire lower third'],
              ['hideLowerThird', 'Hide lower third'],
              ['nextTrigger', 'Next trigger'],
              ['prevTrigger', 'Previous trigger'],
              ['toggleRecording', 'Toggle recording (OBS)'],
              ['saveReplay', 'Save replay (OBS)'],
            ] as Array<[keyof HotkeyConfig, string]>).map(([key, label]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ flex: 1, fontSize: 12 }}>{label}</label>
                <input
                  type="text"
                  style={{ width: 160 }}
                  value={hotkeys[key]}
                  placeholder="unbound"
                  onChange={(e) => setHotkeys({ ...hotkeys, [key]: e.target.value.trim() })}
                />
              </div>
            ))}
          </div>
        </div>

        <StreamDeckPluginSection />

        <div className="settings-group">
          <div className="settings-group-title">Settings Backups</div>
          <p style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            Timestamped copies of your settings (trigger lists, overlay presets,
            CC / R2 config). Taken automatically on startup and hourly; the last 10
            are kept. Restoring overwrites current settings — restart to apply.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={handleBackupNow}>Backup Now</button>
            <button className="btn btn-ghost btn-sm" onClick={refreshBackups}>Refresh</button>
            {backupMsg && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{backupMsg}</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
            {backups.length === 0 ? (
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>No backups yet.</span>
            ) : (
              backups.map((b) => (
                <div key={b.file} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 11 }}>
                  <span>{fmtBackupTime(b.createdAt)} <span style={{ color: 'var(--text-dim)' }}>({(b.size / 1024).toFixed(1)} KB)</span></span>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleBackupRestore(b.file)}>Restore</button>
                </div>
              ))
            )}
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
