import React, { useCallback, useEffect, useRef, useState } from 'react'
import nipplejs from 'nipplejs'
import { useStore } from '../store/useStore'
import * as control from '../lib/cameraControl'
import { GamepadController, AxisLock } from '../lib/gamepad'
import '../styles/camera.css'
import '../styles/voice.css'

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
  const stickMaxSpeed = settings?.cameraStickMaxSpeed ?? 30
  const rateHz = settings?.cameraCommandRateHz ?? 10
  const savedDeviceId = settings?.cameraPreviewDeviceId ?? ''

  const [reachable, setReachable] = useState<boolean | null>(null)
  const [resolvedHost, setResolvedHost] = useState<string>('')
  const [probing, setProbing] = useState(false)
  const [aiEnabled, setAiEnabled] = useState<boolean>(settings?.cameraAutoMode === true)
  const [manualFlash, setManualFlash] = useState(false)
  const [pttHeld, setPttHeld] = useState(false)
  const pttRelease = (): void => {
    if (!pttHeld) return
    setPttHeld(false)
    void window.api.voicePtt(false)
  }
  const [panSpeed, setPanSpeed] = useState(0.7) // joystick magnitude multiplier 0–1
  // Stick axis lock (both Xbox sticks + on-screen joystick): 'pan' = pan only
  // (kills the up/down drift while panning), 'tilt' = tilt only.
  const [axisLock, setAxisLock] = useState<AxisLock>('free')
  const [zoomSpeed, setZoomSpeed] = useState(0.6) // zoom rocker speed multiplier 0–1
  const [savedFlashId, setSavedFlashId] = useState<number | null>(null)
  const [padLabel, setPadLabel] = useState<string | null>(null)
  // Multi-cam: which PTZ (1|2) the controls/Xbox drive. Mirrors activeCameraId.
  const [activeCam, setActiveCam] = useState<1 | 2>(settings?.activeCameraId === 2 ? 2 : 1)
  // Collapsible sub-sections — PTZ (above) stays open; these start collapsed.
  const [trackingCollapsed, setTrackingCollapsed] = useState(true)
  const [imageCollapsed, setImageCollapsed] = useState(true)
  const [previewCollapsed, setPreviewCollapsed] = useState(true)

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
        const lk = axisLockRef.current
        control.setGimbal(
          lk === 'tilt' ? 0 : v.x * stickMaxRef.current * mult,
          lk === 'pan' ? 0 : v.y * stickMaxRef.current * mult,
        )
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
    // Capture-phase scroll on window catches ANY scrolling ancestor (.show-rail,
    // panel-body): the old '.right-panel' hook stopped firing once the layout moved
    // the camera into the show rail, so every grab read as full-up (DART 2026-10-30).
    const schedule = (): void => {
      if (recreateTimer) clearTimeout(recreateTimer)
      recreateTimer = setTimeout(create, 150)
    }
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    // The panel stays mounted while its card is collapsed (keeps the Xbox loop alive), so the
    // zone can be created at 0×0; re-align when it gets a real size on expand.
    const ro = new ResizeObserver(schedule)
    if (zoneRef.current) ro.observe(zoneRef.current)

    return () => {
      ro.disconnect()
      if (recreateTimer) clearTimeout(recreateTimer)
      window.removeEventListener('scroll', schedule, { capture: true })
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

  // Same for the calibrated max speed — the on-screen joystick obeys the same
  // Settings → Xbox Controller cap as the gamepad (one calibration, all sticks).
  const stickMaxRef = useRef(stickMaxSpeed)
  useEffect(() => {
    stickMaxRef.current = stickMaxSpeed
  }, [stickMaxSpeed])
  const axisLockRef = useRef<AxisLock>(axisLock)
  useEffect(() => { axisLockRef.current = axisLock }, [axisLock])

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
        onGoHome: () => { void window.api.cameraGoHome() },
        onToggleAi: () => { void toggleAi() },
        onCycleTrackingSpeed: (mode) => { void window.api.cameraSetTrackingSpeed({ mode }) },
        // Back → start/stop recording a manual move.
        onRecordToggle: () => { void window.api.shotRecordToggle() },
        // RS click → cycle stick axis lock (UI segmented control mirrors it).
        onCycleAxisLock: () => {
          setAxisLock((cur) => (cur === 'free' ? 'pan' : cur === 'pan' ? 'tilt' : 'free'))
        },
        onManualLatched: () => {
          setAiEnabled(false)
          setManualFlash(true)
          setTimeout(() => setManualFlash(false), 1500)
        },
        // Per-stick: that camera's own stick forced its AI off (gamepad already
        // issued cameraSetAiEnableFor). Flash the manual indicator for feedback.
        onManualLatchedFor: () => {
          setManualFlash(true)
          setTimeout(() => setManualFlash(false), 1500)
        },
        onConnection: (label) => setPadLabel(label),
      },
      { deadzone, expo, maxSpeed: stickMaxSpeed, axisLock },
    )
    gamepadRef.current = ctrl
    ctrl.start()
    return () => {
      ctrl.stop()
      gamepadRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Push live deadzone/expo/max-speed/axis-lock edits into the controller.
  useEffect(() => {
    gamepadRef.current?.updateConfig({ deadzone, expo, maxSpeed: stickMaxSpeed, axisLock })
  }, [deadzone, expo, stickMaxSpeed, axisLock])

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
    // AUTO tracks whoever is framed right now — no routine re-apply, which snapped to the
    // wide Home preset and pushed back in (owner 2026-10-30: "hitting auto causes the whole camera to jerk").
  }, [setSettings])

  const setAi = useCallback(async (on: boolean) => {
    aiEnabledRef.current = on
    setAiEnabled(on)
    await window.api.cameraSetAiEnable({ on })
    const updated = await window.api.settingsSet('cameraAutoMode', on)
    setSettings(updated)
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

  // Preset thumbnails: snap a small frame from the UVC preview at save time (the
  // Tail 2 has no pose read-back, so the preview IS the only "what does this preset
  // look at" source). Keyed `${camera}:${slot}`; absent when the preview was closed.
  const captureFrameRef = useRef<(() => string | null) | null>(null)
  const presetThumbs = settings?.cameraPresetThumbs ?? {}

  // Which preset slots actually exist ON the camera (null until fetched / unreachable).
  // Recalling an unset slot is a no-op at best and a garbage pose at worst — grey them.
  const [onCameraIds, setOnCameraIds] = useState<number[] | null>(null)
  const refreshPresetIds = useCallback(async () => {
    try {
      const res = await window.api.cameraGetPresetIds({ camera: activeCam })
      setOnCameraIds(res.ok && res.reachable ? res.ids : null)
    } catch {
      setOnCameraIds(null)
    }
  }, [activeCam])
  useEffect(() => { void refreshPresetIds() }, [refreshPresetIds])

  const savePreset = (n: number): void => {
    void window.api.cameraSavePreset({ id: n })
    flashSaved(n)
    // Thumbnail: only when the preview stream is live (section open).
    const thumb = captureFrameRef.current?.()
    if (thumb) {
      const next = { ...(settings?.cameraPresetThumbs ?? {}), [`${activeCam}:${n}`]: thumb }
      void persist('cameraPresetThumbs', next)
    }
    // The slot now exists on-camera — refresh the stored-slot list (small delay
    // so the camera has committed the save).
    setTimeout(() => void refreshPresetIds(), 800)
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

  // Multi-cam: switch which PTZ the controls/Xbox/deck drive (main persists it).
  const selectCamera = useCallback(async (id: 1 | 2) => {
    setActiveCam(id)
    await window.api.cameraSelect(id)
  }, [])

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
  // Store the CURRENT camera pose as the wide Home (safety) preset. Confirm first —
  // Home is the safety-net shot; overwriting it with a bad framing breaks the fallback.
  const setHome = (): void => {
    if (window.confirm('Overwrite the wide Home shot with the current camera view?\n\nFrame the full stage first — Home is the safety shot the camera falls back to.')) {
      void window.api.cameraSetHome()
    }
  }

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

      {/* ── Multi-camera select (which PTZ the controls / Xbox / deck drive) ── */}
      <div className="camera-row">
        <span className="camera-label">Camera</span>
        <div className="camera-segment">
          <button className={activeCam === 1 ? 'active' : ''} onClick={() => void selectCamera(1)}>Cam 1</button>
          <button
            className={activeCam === 2 ? 'active' : ''}
            onClick={() => void selectCamera(2)}
            disabled={!(settings?.cameraHost2 || '').trim()}
            title={(settings?.cameraHost2 || '').trim() ? 'Drive PTZ camera 2' : 'Set Camera 2 IP below to enable'}
          >Cam 2</button>
        </div>
        <span className="camera-manual-flash" style={{ opacity: 0.6 }}>Xbox: L stick = Cam 1 · R stick = Cam 2</span>
      </div>

      {/* ── Stick axis lock: kill tilt drift during a pure pan (and vice versa).
          Applies to both Xbox sticks + this joystick. RS click cycles it too. ── */}
      <div className="camera-row">
        <span className="camera-label">Axis</span>
        <div className="camera-segment">
          <button className={axisLock === 'free' ? 'active' : ''} onClick={() => setAxisLock('free')}>Free</button>
          <button className={axisLock === 'pan' ? 'active' : ''} onClick={() => setAxisLock('pan')} title="Pan only — tilt locked">Pan only</button>
          <button className={axisLock === 'tilt' ? 'active' : ''} onClick={() => setAxisLock('tilt')} title="Tilt only — pan locked">Tilt only</button>
        </div>
        {axisLock !== 'free' && (
          <span className="camera-manual-flash" style={{ opacity: 0.8 }}>
            {axisLock === 'pan' ? 'tilt locked' : 'pan locked'} (RS click cycles)
          </span>
        )}
      </div>
      <div className="camera-row">
        <span className="camera-label">Cam 2 IP</span>
        <input
          className="camera-text"
          type="text"
          defaultValue={settings?.cameraHost2 || ''}
          placeholder="192.168.x.x (empty = off)"
          onBlur={(e) => void persist('cameraHost2', e.target.value.trim())}
        />
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

      {/* ── Voice push-to-talk (same IPC as Settings → Voice "Hold to Talk") ── */}
      {settings?.voiceEnabled && (
        <button
          type="button"
          className={'voice-ptt-btn' + (pttHeld ? ' held' : '')}
          onPointerDown={() => { if (pttHeld) return; setPttHeld(true); void window.api.voicePtt(true) }}
          onPointerUp={pttRelease}
          onPointerLeave={pttRelease}
          onPointerCancel={pttRelease}
        >
          {pttHeld ? '● Listening — release to send' : 'Hold to Talk'}
        </button>
      )}

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
        {presetIds.map((n) => {
          const thumb = presetThumbs[`${activeCam}:${n}`]
          // null = unknown (unreachable / not fetched) → don't grey anything.
          const unset = onCameraIds != null && !onCameraIds.includes(n)
          return (
            <button
              key={n}
              className={'camera-preset-btn' + (savedFlashId === n ? ' saved-flash' : '') + (unset ? ' unset' : '')}
              style={thumb ? {
                backgroundImage: `linear-gradient(rgba(10,10,20,0.35), rgba(10,10,20,0.55)), url(${thumb})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              } : undefined}
              title={unset ? `P${n} — not stored on the camera (long-press to save the current view)` : `P${n}`}
              onPointerDown={() => onPresetPointerDown(n)}
              onPointerUp={() => onPresetPointerUp(n)}
              onPointerLeave={() => {
                if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
              }}
              onContextMenu={(e) => onPresetContextMenu(e, n)}
            >
              {savedFlashId === n ? 'saved' : `P${n}`}
            </button>
          )
        })}
      </div>

      {/* ── Set Home / Home / Recenter ── */}
      <div className="camera-home-row">
        <button className="camera-btn" onClick={setHome} title="Frame the full stage, then save it as the wide Home (safety) shot">⌂+ Set Home</button>
        <button className="camera-btn danger" onClick={goHome}>⌂ Home (safe wide)</button>
        <button className="camera-btn" onClick={recenter}>Recenter</button>
      </div>

      {/* ── Tracking / Subject / Framing / Zoom (collapsed by default) ── */}
      <div className={`panel-section${trackingCollapsed ? ' collapsed' : ''}`}>
        <div className="panel-section-title" onClick={() => setTrackingCollapsed(!trackingCollapsed)}>
          Tracking
          <span className="chevron">{trackingCollapsed ? '▸' : '▾'}</span>
        </div>
        {!trackingCollapsed && <CameraTrackingControls />}
      </div>

      {/* ── Image: White Balance / Exposure / Focus (collapsed by default) ── */}
      <div className={`panel-section${imageCollapsed ? ' collapsed' : ''}`}>
        <div className="panel-section-title" onClick={() => setImageCollapsed(!imageCollapsed)}>
          Image
          <span className="chevron">{imageCollapsed ? '▸' : '▾'}</span>
        </div>
        {!imageCollapsed && <CameraImageControls />}
      </div>

      {/* ── Preview + Gamepad (collapsed by default) ── */}
      <div className={`panel-section${previewCollapsed ? ' collapsed' : ''}`}>
        <div className="panel-section-title" onClick={() => setPreviewCollapsed(!previewCollapsed)}>
          Preview
          <span className="chevron">{previewCollapsed ? '▸' : '▾'}</span>
        </div>
        {!previewCollapsed && (
          <>
            {/* ── Gamepad indicator ── */}
            <div className="camera-gamepad">
              <span className={'pad-dot' + (padLabel ? ' on' : '')} />
              <span className="pad-label">
                {padLabel ? padLabel : 'No controller — press a button to activate'}
              </span>
            </div>

            {/* ── Live preview ── */}
            <CameraPreview savedDeviceId={savedDeviceId} onPersistDevice={(id) => void persist('cameraPreviewDeviceId', id)} registerCapture={(fn) => { captureFrameRef.current = fn }} />
          </>
        )}
      </div>
    </div>
  )
}

// ── Live preview sub-component (pure renderer; no native dep) ──────────────────
function CameraPreview({
  savedDeviceId,
  onPersistDevice,
  registerCapture,
}: {
  savedDeviceId: string
  onPersistDevice: (id: string) => void
  /** Hands the parent a frame-grab fn (small JPEG data URL, null when no live stream) — used for preset thumbnails. */
  registerCapture?: (fn: (() => string | null) | null) => void
}): React.ReactElement {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Expose a frame-grabber to the parent for preset thumbnails. 160×90 JPEG keeps
  // each thumb ~4-8KB in settings.
  useEffect(() => {
    if (!registerCapture) return
    registerCapture(() => {
      const v = videoRef.current
      if (!v || !streamRef.current || v.videoWidth === 0) return null
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 160
        canvas.height = 90
        const ctx = canvas.getContext('2d')
        if (!ctx) return null
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
        return canvas.toDataURL('image/jpeg', 0.6)
      } catch {
        return null
      }
    })
    return () => registerCapture(null)
  }, [registerCapture])
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
