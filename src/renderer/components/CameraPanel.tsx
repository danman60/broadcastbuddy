import React, { useCallback, useEffect, useRef, useState } from 'react'
import nipplejs from 'nipplejs'
import { useStore } from '../store/useStore'
import * as control from '../lib/cameraControl'
import { GamepadController } from '../lib/gamepad'
import '../styles/camera.css'

/**
 * CameraPanel — OBSBOT PTZ control surface for Overlay Mode.
 *
 * Off-state (camera feature inactive: no autoMode + no host) renders a calm
 * "Camera off" message with NO polling and NO IPC churn. When active it drives:
 *   - connection probe + live status,
 *   - AUTO/MANUAL (AI tracking) interlock,
 *   - on-screen nipplejs joystick (left) + zoom rocker,
 *   - the shared 10Hz command sender (cameraControl.ts),
 *   - Xbox gamepad (gamepad.ts) writing the SAME desiredState,
 *   - preset grid (click=recall, right-click/long-press=save),
 *   - Home / Recenter,
 *   - a live <video> preview with a device picker.
 *
 * nipplejs joystick + the gamepad both write control.setGimbal/setZoom; the
 * single setInterval flush in cameraControl owns the wire, so they can't fight.
 */

const GIMBAL_SCALE = 178 // joystick normalized [-1..1] → ±178 gimbal velocity
const ZOOM_SCALE = 10 // zoom rocker → 0–10 speed

// nipplejs JoystickManager type isn't exported by name in v1 d.ts; alias loosely.
type NippleManager = ReturnType<typeof nipplejs.create>

export function CameraPanel(): React.ReactElement {
  const settings = useStore((s) => s.settings)
  const autoMode = settings?.cameraAutoMode === true
  const host = (settings?.cameraHost || '').trim()
  // Feature active = autoMode OR a host set (mirrors isCameraFeatureActive in main).
  const featureActive = autoMode || host.length > 0

  if (!featureActive) {
    return <CameraOff />
  }

  return <CameraPanelActive />
}

/**
 * Off-state — the camera feature is inactive (no host + no auto mode). Auto-runs a
 * one-shot network discovery on mount and offers a manual "Find Camera" retry. On a
 * hit it sets cameraHost (persisted in main + reflected in the store) which flips
 * the feature ON → CameraPanelActive mounts and connects. No polling otherwise.
 */
function CameraOff(): React.ReactElement {
  const setSettings = useStore((s) => s.setSettings)
  const [scanning, setScanning] = useState(false)
  const [msg, setMsg] = useState('')
  const autoRan = useRef(false)

  const discover = useCallback(async () => {
    setScanning(true)
    setMsg('Scanning the network for the OBSBOT…')
    try {
      const r = await window.api.cameraDiscover()
      if (r.found && r.host) {
        const s = useStore.getState().settings
        if (s) setSettings({ ...s, cameraHost: r.host })
        setMsg(`Found camera at ${r.host}`)
      } else {
        setMsg(
          `No camera found (scanned ${r.scanned} on ${r.subnets.join(', ') || 'no LAN'}). ` +
          `Power it on + same Wi-Fi as this PC, then retry.`,
        )
      }
    } catch (e) {
      setMsg('Discovery failed: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setScanning(false)
    }
  }, [setSettings])

  useEffect(() => {
    if (autoRan.current) return
    autoRan.current = true
    void discover()
  }, [discover])

  return (
    <div className="camera-off">
      <div className="camera-off-icon">📷</div>
      <div>{scanning ? 'Searching…' : 'Camera off'}</div>
      <div className="camera-off-hint">
        {msg || 'Auto-finds the camera on the network, or set a host in Settings.'}
      </div>
      <button
        className="camera-btn wide"
        disabled={scanning}
        onClick={() => void discover()}
        style={{ marginTop: 8 }}
      >
        {scanning ? 'Scanning…' : 'Find Camera'}
      </button>
    </div>
  )
}

function CameraPanelActive(): React.ReactElement {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)

  const deadzone = settings?.cameraJoystickDeadzone ?? 0.12
  const expo = settings?.cameraExpo ?? 0.6
  const rateHz = settings?.cameraCommandRateHz ?? 10
  const savedDeviceId = settings?.cameraPreviewDeviceId ?? ''

  const [reachable, setReachable] = useState<boolean | null>(null)
  const [resolvedHost, setResolvedHost] = useState<string>('')
  const [probing, setProbing] = useState(false)
  const [aiEnabled, setAiEnabled] = useState<boolean>(settings?.cameraAutoMode === true)
  const [manualFlash, setManualFlash] = useState(false)
  const [panSpeed, setPanSpeed] = useState(0.7) // joystick magnitude multiplier 0–1
  const [zoomSpeed, setZoomSpeed] = useState(0.6) // zoom rocker speed multiplier 0–1
  const [savedFlashId, setSavedFlashId] = useState<number | null>(null)
  const [padLabel, setPadLabel] = useState<string | null>(null)

  const zoneRef = useRef<HTMLDivElement | null>(null)
  const nippleRef = useRef<NippleManager | null>(null)
  const gamepadRef = useRef<GamepadController | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Probe connection ──
  const probe = useCallback(async () => {
    setProbing(true)
    try {
      const res = await window.api.cameraProbe()
      setReachable(res.reachable)
      setResolvedHost(res.host)
    } catch {
      setReachable(false)
    } finally {
      setProbing(false)
    }
  }, [])

  // ── Start the shared sender + initial probe on mount ──
  useEffect(() => {
    control.start(rateHz)
    void probe()
    return () => {
      control.stop()
    }
    // rateHz handled in its own effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Restart the sender if the rate changes.
  useEffect(() => {
    if (control.isRunning()) {
      control.stop()
      control.start(rateHz)
    }
  }, [rateHz])

  // ── nipplejs joystick → shared desiredState ──
  useEffect(() => {
    let manager: NippleManager | null = null
    let recreateTimer: ReturnType<typeof setTimeout> | null = null

    const bind = (m: NippleManager): void => {
      // vector.x = right(+)/left(-); vector.y = up(+)/down(-) (screen-up positive).
      m.on('move', (evt) => {
        const v = evt?.data?.vector
        if (!v) return
        const mult = panSpeedRef.current
        maybeLatchManual() // any deflection forces AI off + latches manual
        control.setGimbal(v.x * GIMBAL_SCALE * mult, v.y * GIMBAL_SCALE * mult)
      })
      m.on('end', () => {
        control.setGimbal(0, 0)
        control.stopAllNow()
      })
    }

    const create = (): void => {
      if (!zoneRef.current) return
      if (manager) { manager.destroy(); manager = null }
      manager = nipplejs.create({
        zone: zoneRef.current,
        mode: 'static',
        position: { left: '50%', top: '50%' },
        color: 'rgba(129,140,248,0.9)',
        size: 96,
        restJoystick: true,
      })
      nippleRef.current = manager
      bind(manager)
    }

    create()

    // nipplejs (static) caches the zone's SCREEN rect at create time. The right-panel
    // scrolls, so after a scroll the dial's grab area drifts away from where it's
    // drawn ("can't grab the dial"). Recreate once scroll/resize settles to re-align.
    const scroller = zoneRef.current?.closest('.right-panel') as HTMLElement | null
    const schedule = (): void => {
      if (recreateTimer) clearTimeout(recreateTimer)
      recreateTimer = setTimeout(create, 150)
    }
    scroller?.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)

    return () => {
      if (recreateTimer) clearTimeout(recreateTimer)
      scroller?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (manager) manager.destroy()
      nippleRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep latest panSpeed readable inside the (once-bound) nipple handler.
  const panSpeedRef = useRef(panSpeed)
  useEffect(() => {
    panSpeedRef.current = panSpeed
  }, [panSpeed])

  // ── Interlock helper: forcing AI off on any manual deflection ──
  const maybeLatchManual = useCallback(() => {
    if (aiEnabledRef.current) {
      aiEnabledRef.current = false
      setAiEnabled(false)
      void window.api.cameraSetAiEnable({ on: false })
      setManualFlash(true)
      setTimeout(() => setManualFlash(false), 1500)
    }
  }, [])
  const aiEnabledRef = useRef(aiEnabled)
  useEffect(() => {
    aiEnabledRef.current = aiEnabled
    gamepadRef.current?.setAiEnabled(aiEnabled)
  }, [aiEnabled])

  // ── Gamepad controller ──
  useEffect(() => {
    const ctrl = new GamepadController(
      {
        onRecallPreset: (n) => { void window.api.cameraRecallPreset({ n }) },
        onSavePreset: (n) => {
          void window.api.cameraSavePreset({ id: n })
          flashSaved(n)
        },
        onGoHome: () => { void window.api.cameraGoHome() },
        onToggleAi: () => { void toggleAi() },
        onCycleTrackingSpeed: (mode) => { void window.api.cameraSetTrackingSpeed({ mode }) },
        onManualLatched: () => {
          setAiEnabled(false)
          setManualFlash(true)
          setTimeout(() => setManualFlash(false), 1500)
        },
        onConnection: (label) => setPadLabel(label),
      },
      { deadzone, expo },
    )
    gamepadRef.current = ctrl
    ctrl.start()
    return () => {
      ctrl.stop()
      gamepadRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Push live deadzone/expo edits into the controller.
  useEffect(() => {
    gamepadRef.current?.updateConfig({ deadzone, expo })
  }, [deadzone, expo])

  // ── AUTO/MANUAL toggle ──
  // AUTO/MANUAL drives BOTH the live AI tracker AND cameraAutoMode (the routine-
  // follow gate) so the dashboard button stays in sync with the Settings "Auto Mode"
  // checkbox — picking AUTO here is what lets routine changes command the camera.
  const toggleAi = useCallback(async () => {
    const next = !aiEnabledRef.current
    aiEnabledRef.current = next
    setAiEnabled(next)
    await window.api.cameraSetAiEnable({ on: next })
    const updated = await window.api.settingsSet('cameraAutoMode', next)
    setSettings(updated)
    // Enabling AUTO: configure the AI tracker for the CURRENT routine (workmode,
    // tracking speed, framing) — bare AI-enable leaves it on stale config.
    if (next) await window.api.cameraApplyCurrent()
  }, [setSettings])

  const setAi = useCallback(async (on: boolean) => {
    aiEnabledRef.current = on
    setAiEnabled(on)
    await window.api.cameraSetAiEnable({ on })
    const updated = await window.api.settingsSet('cameraAutoMode', on)
    setSettings(updated)
    if (on) await window.api.cameraApplyCurrent()
  }, [setSettings])

  // ── Zoom rocker (hold-to-zoom) ──
  const startZoom = useCallback((dir: 'in' | 'out') => {
    maybeLatchManual()
    control.setZoom({ dir, speed: zoomSpeedRef.current * ZOOM_SCALE })
  }, [maybeLatchManual])
  const endZoom = useCallback(() => {
    control.setZoom(null)
    // ensure an immediate stopZoom rather than waiting a tick
    void window.api.cameraZoomVelocity({ dir: 'in', speed: 0, stop: true })
  }, [])
  const zoomSpeedRef = useRef(zoomSpeed)
  useEffect(() => { zoomSpeedRef.current = zoomSpeed }, [zoomSpeed])

  // ── Presets: click = recall, right-click / long-press = save ──
  function flashSaved(id: number): void {
    setSavedFlashId(id)
    setTimeout(() => setSavedFlashId((cur) => (cur === id ? null : cur)), 900)
  }
  const recallPreset = (n: number): void => { void window.api.cameraRecallPreset({ n }) }
  const savePreset = (n: number): void => {
    void window.api.cameraSavePreset({ id: n })
    flashSaved(n)
  }
  const onPresetPointerDown = (n: number): void => {
    longPressTimer.current = setTimeout(() => {
      savePreset(n)
      longPressTimer.current = null
    }, 600)
  }
  const onPresetPointerUp = (n: number): void => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
      recallPreset(n) // short tap = recall
    }
    // long-press already saved + cleared the timer
  }
  const onPresetContextMenu = (e: React.MouseEvent, n: number): void => {
    e.preventDefault()
    savePreset(n)
  }

  // ── Settings persistence helpers ──
  const persist = useCallback(async (key: string, value: unknown) => {
    const updated = await window.api.settingsSet(key, value)
    setSettings(updated)
  }, [setSettings])

  // Re-discover the camera on the network (e.g. its DHCP IP changed at a venue).
  // On a hit, repoints cameraHost; the next probe/action reconnects to the new IP.
  const [scanning, setScanning] = useState(false)
  const findCamera = useCallback(async () => {
    setScanning(true)
    try {
      const r = await window.api.cameraDiscover()
      if (r.found && r.host) await persist('cameraHost', r.host)
    } finally {
      setScanning(false)
    }
  }, [persist])

  // ── Home / Recenter ──
  const goHome = (): void => { void window.api.cameraGoHome() }
  const recenter = (): void => { void window.api.cameraRecenter() }

  // Presets to render (Home reserves slot 1).
  const presetIds = [2, 3, 4, 5, 6, 7, 8]

  return (
    <div className="camera-panel" style={{ colorScheme: 'dark' }}>
      {/* ── Status ── */}
      <div className="camera-status">
        <span
          className={
            'camera-dot ' + (reachable === null ? '' : reachable ? 'ok' : 'bad')
          }
        />
        <span className="camera-host">{resolvedHost || 'resolving…'}</span>
        <button className="camera-btn small" onClick={() => void probe()} disabled={probing}>
          {probing ? '…' : 'Probe'}
        </button>
        <button className="camera-btn small" onClick={() => void findCamera()} disabled={scanning} title="Scan the network for the camera (use if its IP changed)">
          {scanning ? '…' : 'Find'}
        </button>
      </div>

      {/* ── AUTO / MANUAL ── */}
      <div className="camera-row">
        <span className="camera-label">Mode</span>
        <div className="camera-segment">
          <button className={aiEnabled ? 'active' : ''} onClick={() => void setAi(true)}>Auto</button>
          <button className={!aiEnabled ? 'active' : ''} onClick={() => void setAi(false)}>Manual</button>
        </div>
        {manualFlash && <span className="camera-manual-flash">⚠ manual</span>}
      </div>

      {/* ── Joystick + speed/zoom controls ── */}
      <div className="camera-joystick-block">
        <div className="camera-joystick-zone" ref={zoneRef} />
        <div className="camera-controls-col">
          <div>
            <span className="camera-label">Pan/Tilt</span>
            <input
              className="camera-slider"
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={panSpeed}
              onChange={(e) => setPanSpeed(parseFloat(e.target.value))}
            />
          </div>
          <div className="camera-row">
            <span className="camera-label">Zoom</span>
            <div className="camera-zoom-rocker">
              <button
                onPointerDown={() => startZoom('out')}
                onPointerUp={endZoom}
                onPointerLeave={endZoom}
              >−</button>
              <button
                onPointerDown={() => startZoom('in')}
                onPointerUp={endZoom}
                onPointerLeave={endZoom}
              >+</button>
            </div>
          </div>
          <div>
            <span className="camera-label">Zoom spd</span>
            <input
              className="camera-slider"
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={zoomSpeed}
              onChange={(e) => setZoomSpeed(parseFloat(e.target.value))}
            />
          </div>
        </div>
      </div>

      {/* ── Presets ── */}
      <div className="camera-section-title">Presets (tap = go · long-press / right-click = save)</div>
      <div className="camera-preset-grid">
        {presetIds.map((n) => (
          <button
            key={n}
            className={'camera-preset-btn' + (savedFlashId === n ? ' saved-flash' : '')}
            onPointerDown={() => onPresetPointerDown(n)}
            onPointerUp={() => onPresetPointerUp(n)}
            onPointerLeave={() => {
              if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
            }}
            onContextMenu={(e) => onPresetContextMenu(e, n)}
          >
            {savedFlashId === n ? 'saved' : `P${n}`}
          </button>
        ))}
      </div>

      {/* ── Home / Recenter ── */}
      <div className="camera-home-row">
        <button className="camera-btn danger" onClick={goHome}>⌂ Home (safe wide)</button>
        <button className="camera-btn" onClick={recenter}>Recenter</button>
      </div>

      {/* ── Tracking / Subject / Framing / Zoom ── */}
      <CameraTrackingControls />

      {/* ── Image: White Balance / Exposure / Focus ── */}
      <CameraImageControls />

      {/* ── Gamepad indicator ── */}
      <div className="camera-gamepad">
        <span className={'pad-dot' + (padLabel ? ' on' : '')} />
        <span className="pad-label">
          {padLabel ? padLabel : 'No controller — press a button to activate'}
        </span>
      </div>

      {/* ── Live preview ── */}
      <CameraPreview savedDeviceId={savedDeviceId} onPersistDevice={(id) => void persist('cameraPreviewDeviceId', id)} />
    </div>
  )
}

// ── Live preview sub-component (pure renderer; no native dep) ──────────────────
function CameraPreview({
  savedDeviceId,
  onPersistDevice,
}: {
  savedDeviceId: string
  onPersistDevice: (id: string) => void
}): React.ReactElement {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string>(savedDeviceId)
  const [error, setError] = useState<string>('')

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop()
      streamRef.current = null
    }
  }, [])

  const enumerate = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices(list.filter((d) => d.kind === 'videoinput'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not list devices')
    }
  }, [])

  const startStream = useCallback(async (id: string) => {
    stopStream()
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: id ? { deviceId: { exact: id } } : true,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        void videoRef.current.play().catch(() => { /* autoplay guard */ })
      }
      // Labels become available only after a getUserMedia grant.
      await enumerate()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(/denied|NotAllowed/i.test(msg) ? 'Camera permission denied' : msg)
    }
  }, [stopStream, enumerate])

  useEffect(() => {
    void enumerate()
    return () => stopStream()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onPick = (id: string): void => {
    setDeviceId(id)
    onPersistDevice(id)
    void startStream(id)
  }

  return (
    <div className="camera-preview-wrap">
      <div className="camera-section-title">Live preview</div>
      <div className="camera-row">
        <select value={deviceId} onChange={(e) => onPick(e.target.value)}>
          <option value="">Select camera…</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Camera ${d.deviceId.slice(0, 6)}`}
            </option>
          ))}
        </select>
        <button className="camera-btn small" onClick={() => void startStream(deviceId)}>
          {streamRef.current ? 'Restart' : 'Start'}
        </button>
      </div>
      {streamRef.current ? (
        <video ref={videoRef} className="camera-preview-video" muted playsInline />
      ) : (
        <div className="camera-preview-empty">
          {error
            ? error
            : devices.length === 0
              ? 'No video devices found — click Start to grant access'
              : 'Pick a camera to frame the wide shot'}
          {/* keep the video element mounted-but-hidden so srcObject can attach */}
          <video ref={videoRef} style={{ display: 'none' }} muted playsInline />
        </div>
      )}
    </div>
  )
}

// ── Manual image controls: White Balance / Exposure / Focus ──────────────────
// Fire-and-forget against the OBSBOT REST /image/* endpoints (guarded server-side;
// no-op unless the camera is active). Local UI state only — the camera is the
// source of truth; these just push operator intent.
const WB_MODES = ['auto', 'daylight', 'fluorescent', 'tungsten', 'cloudy', 'manual'] as const
const ISO_STEPS = [100, 200, 400, 800, 1600, 3200, 6400]
const SHUTTER_STEPS = ['1/30', '1/50', '1/60', '1/100', '1/120', '1/200', '1/500', '1/1000', '1/2000']

function CameraImageControls(): React.JSX.Element {
  const api = window.api
  const [wb, setWb] = useState<(typeof WB_MODES)[number]>('auto')
  const [temp, setTemp] = useState(5600)
  const [expMode, setExpMode] = useState<'auto' | 'manual'>('auto')
  const [ev, setEv] = useState(0)
  const [iso, setIso] = useState(800)
  const [shutter, setShutter] = useState('1/100')
  const [afMode, setAfMode] = useState<'afc' | 'afs' | 'mf'>('afc')
  const [focus, setFocus] = useState(50)

  return (
    <div className="camera-image-controls">
      <div className="camera-section-title">Image — White Balance · Exposure · Focus</div>

      {/* White Balance */}
      <div className="cam-img-row">
        <label>White Bal</label>
        <select
          value={wb}
          onChange={(e) => {
            const mode = e.target.value as (typeof WB_MODES)[number]
            setWb(mode)
            void api.cameraImageControl({ kind: 'whiteBalance', mode, temperature: mode === 'manual' ? temp : undefined })
          }}
        >
          {WB_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      {wb === 'manual' && (
        <div className="cam-img-row">
          <label>Temp {temp}K</label>
          <input
            type="range" min={2800} max={8000} step={100} value={temp}
            onChange={(e) => setTemp(Number(e.target.value))}
            onMouseUp={() => void api.cameraImageControl({ kind: 'whiteBalance', mode: 'manual', temperature: temp })}
          />
        </div>
      )}

      {/* Exposure mode */}
      <div className="cam-img-row">
        <label>Exposure</label>
        <div className="cam-img-toggle">
          {(['auto', 'manual'] as const).map((m) => (
            <button
              key={m}
              className={'camera-btn' + (expMode === m ? ' active' : '')}
              onClick={() => { setExpMode(m); void api.cameraImageControl({ kind: 'exposureMode', mode: m }) }}
            >{m}</button>
          ))}
        </div>
      </div>
      {expMode === 'auto' ? (
        <div className="cam-img-row">
          <label>EV {ev > 0 ? '+' : ''}{ev.toFixed(1)}</label>
          <input
            type="range" min={-3} max={3} step={0.3} value={ev}
            onChange={(e) => setEv(Number(e.target.value))}
            onMouseUp={() => void api.cameraImageControl({ kind: 'evBias', ev })}
          />
        </div>
      ) : (
        <>
          <div className="cam-img-row">
            <label>ISO</label>
            <select value={iso} onChange={(e) => { const v = Number(e.target.value); setIso(v); void api.cameraImageControl({ kind: 'iso', iso: v }) }}>
              {ISO_STEPS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="cam-img-row">
            <label>Shutter</label>
            <select value={shutter} onChange={(e) => { setShutter(e.target.value); void api.cameraImageControl({ kind: 'shutter', shutter: e.target.value }) }}>
              {SHUTTER_STEPS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </>
      )}

      {/* Focus */}
      <div className="cam-img-row">
        <label>Focus</label>
        <div className="cam-img-toggle">
          {(['afc', 'afs', 'mf'] as const).map((m) => (
            <button
              key={m}
              className={'camera-btn' + (afMode === m ? ' active' : '')}
              onClick={() => { setAfMode(m); void api.cameraImageControl({ kind: 'afMode', mode: m }) }}
            >{m.toUpperCase()}</button>
          ))}
        </div>
      </div>
      {afMode === 'mf' && (
        <div className="cam-img-row">
          <label>Focus {focus}</label>
          <input
            type="range" min={0} max={100} step={1} value={focus}
            onChange={(e) => setFocus(Number(e.target.value))}
            onMouseUp={() => void api.cameraImageControl({ kind: 'manualFocus', position: focus })}
          />
        </div>
      )}
    </div>
  )
}

// ── Tracking / Subject / Framing / Zoom — the live "OBSBOT Center replacement"
// suite so the operator can run the camera entirely from BB with OBSBOT Center
// closed. Fire-and-forget against /ai/* and /ptz/zoom (guarded server-side).
const TRACK_SPEEDS = [
  { mode: 0, label: 'S.Lazy' },
  { mode: 1, label: 'Lazy' },
  { mode: 2, label: 'Slow' },
  { mode: 3, label: 'Fast' },
  { mode: 4, label: 'Crazy' },
]
const FRAMING_TIERS = [
  { tier: 0, label: 'Tight' },
  { tier: 1, label: 'Med' },
  { tier: 2, label: 'Wide' },
  { tier: 3, label: 'Widest' },
]

function CameraTrackingControls(): React.JSX.Element {
  const api = window.api
  const [speed, setSpeed] = useState(3) // Fast default (recital)
  const [subject, setSubject] = useState<0 | 1>(1) // 1 = group default
  const [tier, setTier] = useState(2) // Wide default
  const [onlyMe, setOnlyMe] = useState(false)
  const [zoom, setZoom] = useState(0)
  const [recording, setRecording] = useState(false)

  return (
    <div className="camera-image-controls">
      <div className="camera-section-title">Tracking · Subject · Framing · Zoom</div>

      {/* Follow / tracking speed */}
      <div className="cam-img-row">
        <label>Follow spd</label>
        <div className="cam-img-toggle">
          {TRACK_SPEEDS.map((s) => (
            <button
              key={s.mode}
              className={'camera-btn' + (speed === s.mode ? ' active' : '')}
              onClick={() => { setSpeed(s.mode); void api.cameraControl({ kind: 'trackingSpeed', mode: s.mode }) }}
            >{s.label}</button>
          ))}
        </div>
      </div>

      {/* Subject mode */}
      <div className="cam-img-row">
        <label>Subject</label>
        <div className="cam-img-toggle">
          {([[0, 'Single'], [1, 'Group']] as const).map(([m, lbl]) => (
            <button
              key={m}
              className={'camera-btn' + (subject === m ? ' active' : '')}
              onClick={() => { setSubject(m); void api.cameraControl({ kind: 'aiMode', mode: m }) }}
            >{lbl}</button>
          ))}
        </div>
      </div>

      {/* Framing tier */}
      <div className="cam-img-row">
        <label>Framing</label>
        <div className="cam-img-toggle">
          {FRAMING_TIERS.map((f) => (
            <button
              key={f.tier}
              className={'camera-btn' + (tier === f.tier ? ' active' : '')}
              onClick={() => { setTier(f.tier); void api.cameraControl({ kind: 'autoZoom', aiMode: subject, tier: f.tier }) }}
            >{f.label}</button>
          ))}
        </div>
      </div>

      {/* Only Me lock */}
      <div className="cam-img-row">
        <label>Only Me</label>
        <div className="cam-img-toggle">
          {([[false, 'Off'], [true, 'On']] as const).map(([v, lbl]) => (
            <button
              key={String(v)}
              className={'camera-btn' + (onlyMe === v ? ' active' : '')}
              onClick={() => { setOnlyMe(v); void api.cameraControl({ kind: 'onlyMe', on: v }) }}
            >{lbl}</button>
          ))}
        </div>
      </div>

      {/* Absolute zoom level */}
      <div className="cam-img-row">
        <label>Zoom {zoom}</label>
        <input
          type="range" min={0} max={100} step={1} value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          onMouseUp={() => void api.cameraControl({ kind: 'zoomLevel', level: zoom })}
        />
      </div>

      {/* Record to camera SD card */}
      <div className="cam-img-row">
        <label>SD Record</label>
        <button
          className={'camera-btn' + (recording ? ' danger' : '')}
          style={{ flex: 1 }}
          onClick={() => { const next = !recording; setRecording(next); void api.cameraControl({ kind: 'record', on: next }) }}
        >
          {recording ? '⏺ Recording — Stop' : 'Start SD Recording'}
        </button>
      </div>
    </div>
  )
}
