/**
 * gamepad — raw Web Gamepad API driver for the PTZ control panel (zero deps).
 *
 * A requestAnimationFrame poll re-reads navigator.getGamepads() EVERY frame
 * (never cached — Chrome returns a fresh snapshot each call). The left stick
 * drives pan/tilt, triggers + right-stick-Y drive zoom, face/d-pad buttons
 * recall presets, etc. All motion is written to the SHARED desiredState in
 * cameraControl.ts so the gamepad and the on-screen joystick share one throttle.
 *
 * W3C "standard" mapping (https://w3c.github.io/gamepad/#remapping):
 *   axes:    0 LX · 1 LY · 2 RX · 3 RY
 *   buttons: 0 A · 1 B · 2 X · 3 Y · 4 LB · 5 RB · 6 LT · 7 RT · 8 Back · 9 Start
 *            10 LS · 11 RS · 12 Up · 13 Down · 14 Left · 15 Right · 16 Guide
 *
 * Mapping implemented (see the table in the build report):
 *   - Left stick → pan/tilt (tilt inverted: stick-up = tilt-up).
 *   - LT(6)/RT(7) analog → zoom out/in; right-stick-Y also → zoom.
 *   - A/B/X/Y (0–3) → recall preset 1–4 (edge-triggered).
 *   - D-pad (12–15) → recall preset 5–8 (edge-triggered).
 *   - LB(4) + face button → SAVE preset (setPreset) instead of recall.
 *   - Guide(16) → goHome. Start/Menu(9) → toggle AI. LS(10) → cycle tracking speed.
 *   - RB(5) held → fine mode ×0.3.
 *
 * Interlock: any stick deflection past the deadzone OR analog zoom flips AI OFF
 * and latches manual; AI is only re-enabled via the Menu button or the on-screen
 * AUTO toggle (both call back through onToggleAi / setAiEnabled here).
 *
 * Disconnect: gamepaddisconnected → immediately stopAllNow() + clear state.
 */

import * as control from './cameraControl'

const GIMBAL_SCALE = 178 // normalized magnitude → ±178 gimbal velocity limit
const ZOOM_SCALE = 10 // normalized magnitude → 0–10 zoom speed
const FINE_FACTOR = 0.3 // RB held → fine movement
const TRIGGER_THRESHOLD = 0.05 // analog trigger dead floor
const TRACKING_SPEED_MODES = 6 // 0–5

export interface GamepadCallbacks {
  /** Recall stored preset n (1-based). */
  onRecallPreset: (n: number) => void
  /** Save current pose as preset n (1-based). */
  onSavePreset: (n: number) => void
  /** Go to Home (safe wide). */
  onGoHome: () => void
  /** Toggle AUTO/MANUAL (AI tracking). */
  onToggleAi: () => void
  /** Cycle tracking-speed mode (0–5). */
  onCycleTrackingSpeed: (mode: number) => void
  /** Interlock latched manual (a stick/zoom deflection forced AI off). */
  onManualLatched: () => void
  /** Connection state changed — pass the pad label or null. */
  onConnection: (label: string | null) => void
}

export interface GamepadConfig {
  deadzone: number // 0–1 (default 0.12)
  expo: number // 0–1 (default 0.6)
}

interface ButtonEdges {
  // last-frame pressed snapshot for edge detection
  pressed: boolean[]
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
  private fineHeld = false
  private trackingMode = 2 // default 'slow'
  private aiEnabled = true

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

    this.fineHeld = pressed(5) // RB → fine mode
    const fine = this.fineHeld ? FINE_FACTOR : 1

    // ── Pan/Tilt from the left stick (tilt inverted: stick-up = tilt-up) ──
    const lx = pad.axes[0] ?? 0
    const ly = pad.axes[1] ?? 0
    const stick = applyDeadzoneExpo(lx, ly, this.cfg.deadzone, this.cfg.expo)
    const yaw = stick.x * GIMBAL_SCALE * fine
    const pitch = -stick.y * GIMBAL_SCALE * fine // invert: up on stick → tilt up

    // ── Zoom: triggers (LT out / RT in) + right-stick-Y ──
    const lt = analog(6)
    const rt = analog(7)
    const ry = pad.axes[3] ?? 0
    const ryDz = Math.abs(ry) < this.cfg.deadzone ? 0 : ry
    let zoom: control.ZoomCommand | null = null
    if (rt > TRIGGER_THRESHOLD) {
      zoom = { dir: 'in', speed: rt * ZOOM_SCALE * fine }
    } else if (lt > TRIGGER_THRESHOLD) {
      zoom = { dir: 'out', speed: lt * ZOOM_SCALE * fine }
    } else if (ryDz !== 0) {
      // Right-stick-up (negative Y) → zoom in.
      zoom = { dir: ryDz < 0 ? 'in' : 'out', speed: Math.abs(ryDz) * ZOOM_SCALE * fine }
    }

    // ── Interlock: any manual deflection forces AI off + latches manual ──
    const deflected = yaw !== 0 || pitch !== 0 || zoom !== null
    if (deflected && this.aiEnabled) {
      this.aiEnabled = false
      void window.api.cameraSetAiEnable({ on: false })
      this.cb.onManualLatched()
    }

    // ── Write the SHARED desiredState (cameraControl flushes at the rate) ──
    control.setGimbal(yaw, pitch)
    control.setZoom(zoom)

    // ── Edge-triggered buttons ──
    const lbHeld = pressed(4) // LB + face = SAVE instead of recall

    // A/B/X/Y → preset 1–4
    for (let i = 0; i < 4; i++) {
      if (this.edgePress(i, pressed(i))) {
        if (lbHeld) this.cb.onSavePreset(i + 1)
        else this.cb.onRecallPreset(i + 1)
      }
    }
    // D-pad 12–15 → preset 5–8
    for (let i = 12; i <= 15; i++) {
      if (this.edgePress(i, pressed(i))) {
        const presetN = i - 12 + 5
        if (lbHeld) this.cb.onSavePreset(presetN)
        else this.cb.onRecallPreset(presetN)
      }
    }

    // Guide(16) → goHome
    if (this.edgePress(16, pressed(16))) this.cb.onGoHome()

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
  }
}
