/**
 * cameraControl — the SHARED command sender for the PTZ panel.
 *
 * Both the on-screen nipplejs joystick AND the Xbox gamepad write the same
 * `desiredState` here. A single `setInterval` flush (default 10Hz) reads that
 * state and pushes ONE gimbal command + ONE zoom command per tick — so the two
 * input sources share one throttle and can never fight each other on the wire.
 *
 * Magnitudes are already scaled by the caller (joystick / gamepad map their
 * normalized [-1..1] axes to gimbal velocity ×178 and zoom speed ×10). This
 * module only throttles + dedupes the IPC and guarantees a crisp STOP on
 * release (sent immediately, not on the next tick).
 *
 * Guard: every send goes through `window.api.camera*`, which is a no-op in main
 * when the camera feature is inactive. This module never polls when idle —
 * start()/stop() are driven by the panel mount lifecycle.
 */

export interface ZoomCommand {
  dir: 'in' | 'out'
  speed: number // 0–10 (already scaled)
}

export interface DesiredState {
  yaw: number // signed gimbal velocity, already ×178-scaled (±178)
  pitch: number // signed gimbal velocity, already ×178-scaled (±178)
  zoom: ZoomCommand | null // null = no zoom this tick
}

const DEFAULT_RATE_HZ = 10

const desired: DesiredState = { yaw: 0, pitch: 0, zoom: null }

// Track what we last SENT so the flush can:
//  - skip redundant identical gimbal commands,
//  - send exactly one stop when motion ends,
//  - send exactly one stopZoom when zoom ends.
let lastSentMoving = false
let lastSentZooming = false

let timer: ReturnType<typeof setInterval> | null = null
let rateHz = DEFAULT_RATE_HZ

function near0(v: number): boolean {
  return Math.abs(v) < 0.5 // sub-pixel gimbal velocity → treat as zero
}

/** Push the current gimbal velocity (or a single stop) to main. */
function flushGimbal(): void {
  const moving = !near0(desired.yaw) || !near0(desired.pitch)
  if (moving) {
    void window.api.cameraNudgeXY({ yaw: Math.round(desired.yaw), pitch: Math.round(desired.pitch) })
    lastSentMoving = true
  } else if (lastSentMoving) {
    // Transition moving → stopped: one crisp two-axis stop.
    void window.api.cameraNudgeXY({ yaw: 0, pitch: 0, stop: true })
    lastSentMoving = false
  }
}

/** Push the current zoom velocity (or a single stopZoom) to main. */
function flushZoom(): void {
  if (desired.zoom && desired.zoom.speed > 0) {
    void window.api.cameraZoomVelocity({ dir: desired.zoom.dir, speed: desired.zoom.speed })
    lastSentZooming = true
  } else if (lastSentZooming) {
    void window.api.cameraZoomVelocity({ dir: 'in', speed: 0, stop: true })
    lastSentZooming = false
  }
}

function tick(): void {
  flushGimbal()
  flushZoom()
}

/** Set the desired gimbal velocity (signed, already ×178-scaled). */
export function setGimbal(yaw: number, pitch: number): void {
  desired.yaw = yaw
  desired.pitch = pitch
}

/** Set the desired zoom command (or null to stop zooming). */
export function setZoom(zoom: ZoomCommand | null): void {
  desired.zoom = zoom
}

/**
 * Immediately stop ALL motion: clear desiredState and send the stop commands
 * NOW (don't wait for the next tick). Called on joystick/stick release and on
 * gamepad disconnect.
 */
export function stopAllNow(): void {
  desired.yaw = 0
  desired.pitch = 0
  desired.zoom = null
  if (lastSentMoving) {
    void window.api.cameraNudgeXY({ yaw: 0, pitch: 0, stop: true })
    lastSentMoving = false
  }
  if (lastSentZooming) {
    void window.api.cameraZoomVelocity({ dir: 'in', speed: 0, stop: true })
    lastSentZooming = false
  }
}

/** Start the flush loop. rateHz defaults to 10; clamps to a sane 1–30. */
export function start(hz = DEFAULT_RATE_HZ): void {
  if (timer) return
  rateHz = Math.max(1, Math.min(30, hz || DEFAULT_RATE_HZ))
  timer = setInterval(tick, Math.round(1000 / rateHz))
}

/** Stop the flush loop and flush a final stop so the camera doesn't drift. */
export function stop(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  stopAllNow()
}

export function isRunning(): boolean {
  return timer !== null
}

export function getRateHz(): number {
  return rateHz
}
