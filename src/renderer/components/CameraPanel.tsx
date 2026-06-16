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
    return (
      <div className="camera-off">
        <div className="camera-off-icon">📷</div>
        <div>Camera off</div>
        <div className="camera-off-hint">Enable in Settings (Auto Mode or a camera host) to control the OBSBOT.</div>
      </div>
    )
  }

  return <CameraPanelActive />
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
    if (!zoneRef.current) return
    const manager: NippleManager = nipplejs.create({
      zone: zoneRef.current,
      mode: 'static',
      position: { left: '50%', top: '50%' },
      color: 'rgba(129,140,248,0.9)',
      size: 96,
      restJoystick: true,
    })
    nippleRef.current = manager

    // vector.x = right(+)/left(-); vector.y = up(+)/down(-) (screen-up positive).
    // v1 handlers receive a SINGLE event object { type, target, data }.
    manager.on('move', (evt) => {
      const v = evt?.data?.vector
      if (!v) return
      const mult = panSpeedRef.current
      const yaw = v.x * GIMBAL_SCALE * mult
      const pitch = v.y * GIMBAL_SCALE * mult // up on stick → tilt up (no inversion)
      // Interlock: any deflection forces AI off + latches manual.
      maybeLatchManual()
      control.setGimbal(yaw, pitch)
    })

    manager.on('end', () => {
      // Crisp stop on release — don't wait for the next tick.
      control.setGimbal(0, 0)
      control.stopAllNow()
    })

    return () => {
      manager.destroy()
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
  const toggleAi = useCallback(async () => {
    const next = !aiEnabledRef.current
    aiEnabledRef.current = next
    setAiEnabled(next)
    await window.api.cameraSetAiEnable({ on: next })
  }, [])

  const setAi = useCallback(async (on: boolean) => {
    aiEnabledRef.current = on
    setAiEnabled(on)
    await window.api.cameraSetAiEnable({ on })
  }, [])

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
