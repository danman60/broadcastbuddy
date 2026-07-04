/**
 * gamepad — raw Web Gamepad API driver for the PTZ control panel (zero deps).
 *
 * A requestAnimationFrame poll re-reads navigator.getGamepads() EVERY frame
 * (never cached — Chrome returns a fresh snapshot each call). This driver runs
 * BOTH PTZ cameras at once off one controller: the LEFT stick flies camera 1
 * and the RIGHT stick flies camera 2 (both written EVERY frame to the per-camera
 * desiredState in cameraControl.ts via setGimbalFor). Continuous motion goes
 * through cameraControl; discrete actions (slow-zoom glides, record toggle,
 * presets, home, AI) fire through GamepadCallbacks.
 *
 * W3C "standard" mapping (https://w3c.github.io/gamepad/#remapping):
 *   axes:    0 LX · 1 LY · 2 RX · 3 RY
 *   buttons: 0 A · 1 B · 2 X · 3 Y · 4 LB · 5 RB · 6 LT · 7 RT · 8 Back · 9 Start
 *            10 LS · 11 RS · 12 Up · 13 Down · 14 Left · 15 Right · 16 Guide
 *
 * Mapping implemented (DUAL camera — both live at once, NOT active-cam-gated):
 *   - LEFT stick  → camera 1 pan/tilt (tilt inverted: stick-up = tilt-up).
 *   - RIGHT stick → camera 2 pan/tilt (tilt inverted: stick-up = tilt-up).
 *   - LT(6) HOLD → camera 1 zoom IN, velocity-dependent (light pull = crawl,
 *     full pull = still-slow max). Release = crisp zoom stop.
 *   - RT(7) HOLD → camera 2 zoom IN (same velocity mapping).
 *   - LB(4) HOLD → camera 1 slow zoom OUT (constant slow speed). Release stops.
 *   - RB(5) HOLD → camera 2 slow zoom OUT. Trigger wins if both held.
 *   - Back(8) edge → onRecordToggle() (start/stop recording a manual move).
 *   - A/B/X/Y (0–3) → recall preset 1–4 (edge-triggered).
 *   - D-pad (12–15) → recall preset 5–8 (edge-triggered).
 *   - Guide(16) → goHome. Start/Menu(9) → toggle AI. LS(10) → cycle tracking speed.
 *   - RS(11) → cycle stick AXIS LOCK free → pan-only → tilt-only (both sticks).
 *
 * REMOVED vs. the single-active-camera driver:
 *   - LB-as-SAVE-preset modifier (LB is now cam-1 slow pull-out; presets recall only).
 *   - RB-as-fine-mode ×0.3 (RB is now cam-2 slow pull-out). No fine mode.
 *   - Back-as-toggle-active-camera (Back now records). Both sticks are always live,
 *     so there's no "active camera" to toggle for the gamepad path.
 *   - Trigger/right-stick-Y proportional zoom (triggers are now discrete slow-zoom
 *     glides; the right stick is camera 2's pan/tilt).
 *
 * Interlock (per-stick, v2): each stick disables ITS OWN camera's AI on the first
 * deflection past the deadzone (edge-triggered — not every frame):
 *   - LEFT stick deflects  → cameraSetAiEnableFor({camera:1, on:false})  (Cam 1 AI off)
 *   - RIGHT stick deflects → cameraSetAiEnableFor({camera:2, on:false})  (Cam 2 AI off)
 * The latch resets when that stick returns to center, so re-deflecting after a
 * manual AUTO re-enable disables that camera's AI again. The single global
 * onManualLatched still fires (on either stick) to drive the panel's manual-latch
 * UI; onManualLatchedFor(cam) additionally notifies the renderer per camera.
 * This closes the v1 gap where driving the non-active camera didn't stop its AI.
 *
 * Disconnect: gamepaddisconnected → immediately stopAllNow() + clear state.
 */

import * as control from './cameraControl'

// Default max gimbal velocity at full stick deflection (operator-tunable via
// Settings → cameraStickMaxSpeed). Gimbal accepts ±180; 178 was near-max and made
// on-air moves jerky. 30 ≈ 23°/s max pan (0.78°/s per unit), so a half-deflection
// with default expo crawls at ~6°/s — deliberate, cinematic.
export const DEFAULT_STICK_MAX_SPEED = 30
// Hold-to-zoom: trigger analog value → zoom-in velocity (camera-native 0–10
// scale, capped LOW so even a full pull reads as a slow cinematic push).
const ZOOM_TRIGGER_DEADZONE = 0.08
const ZOOM_IN_MAX_SPEED = 4 // full trigger pull
const ZOOM_OUT_SPEED = 2 // bumper hold — constant slow pull-out
const TRACKING_SPEED_MODES = 6 // 0–5

export interface GamepadCallbacks {
  /** Recall stored preset n (1-based). */
  onRecallPreset: (n: number) => void
  /** Go to Home (safe wide). */
  onGoHome: () => void
  /** Toggle AUTO/MANUAL (AI tracking). */
  onToggleAi: () => void
  /** Cycle tracking-speed mode (0–5). */
  onCycleTrackingSpeed: (mode: number) => void
  /** Start/stop recording a manual move (Back button edge). */
  onRecordToggle: () => void
  /** Cycle stick axis lock free → pan-only → tilt-only (RS click). */
  onCycleAxisLock: () => void
  /** Interlock latched manual (a stick deflection forced AI off) — global UI latch. */
  onManualLatched: () => void
  /** Per-camera interlock latch: that stick's first deflection forced that camera's AI off. */
  onManualLatchedFor: (cam: 1 | 2) => void
  /** Connection state changed — pass the pad label or null. */
  onConnection: (label: string | null) => void
}

export type AxisLock = 'free' | 'pan' | 'tilt'

export interface GamepadConfig {
  deadzone: number // 0–1 (default 0.12)
  expo: number // 0–1 (default 0.6)
  maxSpeed?: number // max gimbal velocity at full deflection, 1–178 (default 30)
  // Axis lock: 'pan' = pan only (tilt zeroed — no more up/down drift during a
  // simple pan), 'tilt' = tilt only, 'free' = both. Applies to BOTH sticks.
  axisLock?: AxisLock
}

interface ButtonEdges {
  // last-frame pressed snapshot for edge detection
  pressed: boolean[]
}

// ── Haptic confirms ──────────────────────────────────────────────────────────
// The operator's eyes are on the stage/program monitor, not the panel — mode
// changes must be FELT. Chromium exposes dual-rumble via vibrationActuator.
// All calls are fire-and-forget + guarded: a pad with no actuator no-ops.
interface HapticActuator {
  playEffect?: (type: string, params: Record<string, number>) => Promise<unknown>
}
function rumble(pad: Gamepad, durationMs: number, strong: number, weak: number): void {
  const act = (pad as Gamepad & { vibrationActuator?: HapticActuator }).vibrationActuator
  if (!act?.playEffect) return
  void act.playEffect('dual-rumble', {
    duration: durationMs,
    strongMagnitude: strong,
    weakMagnitude: weak,
  }).catch(() => { /* actuator busy/unsupported — ignore */ })
}
/** Two short pulses — used for record toggle so it's distinct from a preset tap. */
function rumbleDouble(pad: Gamepad): void {
  rumble(pad, 120, 0.9, 0.6)
  setTimeout(() => rumble(pad, 120, 0.9, 0.6), 200)
}

/** Scaled radial deadzone + expo on a 2D stick vector. */
function applyDeadzoneExpo(
  x: number,
  y: number,
  deadzone: number,
  expo: number,
): { x: number; y: number } {
  const m = Math.hypot(x, y)
  if (m < deadzone) return { x: 0, y: 0 }
  // Rescale magnitude so it ramps 0→1 across [deadzone, 1].
  const scaled = (m - deadzone) / (1 - deadzone)
  const ux = x / m
  const uy = y / m
  // Expo curve on the (already rescaled) magnitude.
  const e = expo
  const curved = (1 - e) * scaled + e * scaled * scaled * scaled
  return { x: ux * curved, y: uy * curved }
}

export class GamepadController {
  private raf = 0
  private running = false
  private edges: ButtonEdges = { pressed: [] }
  private connectedLabel: string | null = null
  private trackingMode = 2 // default 'slow'
  private aiEnabled = true
  // Per-stick AI interlock latches (edge-triggered; reset when the stick centers).
  private latched1 = false // LEFT stick has disabled Cam 1 AI since last centered
  private latched2 = false // RIGHT stick has disabled Cam 2 AI since last centered

  constructor(
    private cb: GamepadCallbacks,
    private cfg: GamepadConfig,
  ) {}

  /** Begin polling. Wires connect/disconnect listeners. Idempotent. */
  start(): void {
    if (this.running) return
    this.running = true
    window.addEventListener('gamepadconnected', this.onConnected)
    window.addEventListener('gamepaddisconnected', this.onDisconnected)
    // Pick up an already-connected pad (after the activation gesture).
    this.detectExisting()
    this.raf = requestAnimationFrame(this.loop)
  }

  /** Stop polling + flush a stop so the camera doesn't drift. */
  stop(): void {
    if (!this.running) return
    this.running = false
    cancelAnimationFrame(this.raf)
    window.removeEventListener('gamepadconnected', this.onConnected)
    window.removeEventListener('gamepaddisconnected', this.onDisconnected)
    control.stopAllNow()
  }

  /** Sync external AI state (so the interlock doesn't re-latch needlessly). */
  setAiEnabled(on: boolean): void {
    this.aiEnabled = on
  }

  updateConfig(cfg: GamepadConfig): void {
    this.cfg = cfg
  }

  private onConnected = (e: GamepadEvent): void => {
    this.connectedLabel = e.gamepad.id
    this.cb.onConnection(e.gamepad.id)
  }

  private onDisconnected = (): void => {
    this.connectedLabel = null
    this.edges.pressed = []
    this.latched1 = false
    this.latched2 = false
    control.stopAllNow()
    this.cb.onConnection(null)
  }

  private detectExisting(): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : []
    for (const p of pads) {
      if (p) {
        this.connectedLabel = p.id
        this.cb.onConnection(p.id)
        return
      }
    }
  }

  /** Find the first live pad. Re-read every frame (Chrome snapshots are stale). */
  private firstPad(): Gamepad | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : []
    for (const p of pads) if (p) return p
    return null
  }

  private edgePress(index: number, pressed: boolean): boolean {
    const prev = this.edges.pressed[index] ?? false
    this.edges.pressed[index] = pressed
    return pressed && !prev
  }

  private loop = (): void => {
    if (!this.running) return
    const pad = this.firstPad()
    if (pad) {
      if (this.connectedLabel !== pad.id) {
        this.connectedLabel = pad.id
        this.cb.onConnection(pad.id)
      }
      this.processPad(pad)
    }
    this.raf = requestAnimationFrame(this.loop)
  }

  private processPad(pad: Gamepad): void {
    const btn = (i: number): GamepadButton | undefined => pad.buttons[i]
    const pressed = (i: number): boolean => !!btn(i)?.pressed
    const analog = (i: number): number => btn(i)?.value ?? 0

    const scale = this.cfg.maxSpeed ?? DEFAULT_STICK_MAX_SPEED
    const lock = this.cfg.axisLock ?? 'free'

    // ── Camera 1 pan/tilt from the LEFT stick (tilt inverted: stick-up = tilt-up) ──
    const lx = pad.axes[0] ?? 0
    const ly = pad.axes[1] ?? 0
    const lStick = applyDeadzoneExpo(lx, ly, this.cfg.deadzone, this.cfg.expo)
    const yaw1 = lock === 'tilt' ? 0 : lStick.x * scale
    const pitch1 = lock === 'pan' ? 0 : -lStick.y * scale // invert: up on stick → tilt up

    // ── Camera 2 pan/tilt from the RIGHT stick (tilt inverted: stick-up = tilt-up) ──
    const rx = pad.axes[2] ?? 0
    const ry = pad.axes[3] ?? 0
    const rStick = applyDeadzoneExpo(rx, ry, this.cfg.deadzone, this.cfg.expo)
    const yaw2 = lock === 'tilt' ? 0 : rStick.x * scale
    const pitch2 = lock === 'pan' ? 0 : -rStick.y * scale // invert: up on stick → tilt up

    // ── Per-stick interlock: each stick disables ITS OWN camera's AI on first
    // deflection (edge), and re-arms when that stick returns to center. ──
    const left = yaw1 !== 0 || pitch1 !== 0
    const right = yaw2 !== 0 || pitch2 !== 0

    if (left && !this.latched1) {
      this.latched1 = true
      rumble(pad, 80, 0.4, 0.7) // felt confirm: Cam 1 AI is now OFF (manual)
      void window.api.cameraSetAiEnableFor({ camera: 1, on: false })
      this.cb.onManualLatchedFor(1)
    } else if (!left) {
      this.latched1 = false
    }
    if (right && !this.latched2) {
      this.latched2 = true
      rumble(pad, 80, 0.4, 0.7) // felt confirm: Cam 2 AI is now OFF (manual)
      void window.api.cameraSetAiEnableFor({ camera: 2, on: false })
      this.cb.onManualLatchedFor(2)
    } else if (!right) {
      this.latched2 = false
    }

    // ── Global UI latch: any deflection drives the panel's manual-latch indicator. ──
    if ((left || right) && this.aiEnabled) {
      this.aiEnabled = false
      void window.api.cameraSetAiEnable({ on: false })
      this.cb.onManualLatched()
    }

    // ── Write per-camera desiredState every frame (cameraControl flushes both) ──
    control.setGimbalFor(1, yaw1, pitch1)
    control.setGimbalFor(2, yaw2, pitch2)

    // ── HOLD-to-zoom: trigger = velocity-dependent zoom IN, bumper = slow zoom
    // OUT. Written to the per-camera desiredState every frame — cameraControl's
    // 10Hz flush dedupes and sends ONE crisp stop on release. Trigger wins if
    // both are held on the same side.
    const zoomFor = (cam: 1 | 2, trigger: number, bumperHeld: boolean): void => {
      if (trigger > ZOOM_TRIGGER_DEADZONE) {
        const speed = Math.max(1, Math.min(ZOOM_IN_MAX_SPEED, Math.ceil(trigger * ZOOM_IN_MAX_SPEED)))
        control.setZoomFor(cam, { dir: 'in', speed })
      } else if (bumperHeld) {
        control.setZoomFor(cam, { dir: 'out', speed: ZOOM_OUT_SPEED })
      } else {
        control.setZoomFor(cam, null)
      }
    }
    zoomFor(1, analog(6), pressed(4)) // LT / LB → camera 1
    zoomFor(2, analog(7), pressed(5)) // RT / RB → camera 2

    // ── Edge-triggered buttons ──
    // A/B/X/Y → recall preset 1–4
    for (let i = 0; i < 4; i++) {
      if (this.edgePress(i, pressed(i))) {
        rumble(pad, 60, 0.3, 0.5) // felt confirm: preset recall accepted
        this.cb.onRecallPreset(i + 1)
      }
    }
    // D-pad 12–15 → recall preset 5–8
    for (let i = 12; i <= 15; i++) {
      if (this.edgePress(i, pressed(i))) {
        rumble(pad, 60, 0.3, 0.5)
        this.cb.onRecallPreset(i - 12 + 5)
      }
    }

    // Guide(16) → goHome
    if (this.edgePress(16, pressed(16))) this.cb.onGoHome()

    // Back(8) → start/stop recording a manual move (double pulse: unmistakable)
    if (this.edgePress(8, pressed(8))) {
      rumbleDouble(pad)
      this.cb.onRecordToggle()
    }

    // Start/Menu(9) → toggle AI (the operator's explicit re-enable path)
    if (this.edgePress(9, pressed(9))) {
      this.aiEnabled = !this.aiEnabled
      this.cb.onToggleAi()
    }

    // LS(10) → cycle tracking speed 0–5
    if (this.edgePress(10, pressed(10))) {
      this.trackingMode = (this.trackingMode + 1) % TRACKING_SPEED_MODES
      this.cb.onCycleTrackingSpeed(this.trackingMode)
    }

    // RS(11) → cycle stick axis lock free → pan-only → tilt-only (felt confirm)
    if (this.edgePress(11, pressed(11))) {
      rumble(pad, 100, 0.6, 0.6)
      this.cb.onCycleAxisLock()
    }
  }
}
