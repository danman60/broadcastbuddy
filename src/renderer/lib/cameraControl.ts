/**
 * cameraControl — the SHARED command sender for the PTZ panel.
 *
 * Two parallel command paths share one 10Hz flush:
 *
 *  1) ACTIVE-camera path (`desired`): the on-screen nipplejs joystick + zoom
 *     rocker write `setGimbal`/`setZoom`; the flush pushes them via the
 *     active-camera IPC (cameraNudgeXY / cameraZoomVelocity — main routes to
 *     whichever PTZ is currently selected).
 *
 *  2) PER-CAMERA path (`desiredFor[1|2]`): the Xbox gamepad drives BOTH cameras
 *     at once — left stick → cam 1, right stick → cam 2 — via `setGimbalFor` /
 *     `setZoomFor`; the flush pushes them through the explicit per-camera IPC
 *     (cameraNudgeXYFor / cameraZoomVelocityFor) so neither stick is gated on
 *     the active-camera selection.
 *
 * A single `setInterval` flush (default 10Hz) reads all of this state and
 * pushes one gimbal + one zoom command per camera per tick, so no two input
 * sources ever fight on the wire.
 *
 * Magnitudes are already scaled by the caller (joystick / gamepad map their
 * normalized [-1..1] axes to gimbal velocity ×maxSpeed (Settings-calibrated,
 * default 30) and zoom speed ×10). This
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
  yaw: number // signed gimbal velocity, already scaled by the sender (≤±178 hw limit)
  pitch: number // signed gimbal velocity, already scaled by the sender (≤±178 hw limit)
  zoom: ZoomCommand | null // null = no zoom this tick
}

/** Which physical PTZ a per-camera command targets. */
export type CameraId = 1 | 2

const DEFAULT_RATE_HZ = 10

const desired: DesiredState = { yaw: 0, pitch: 0, zoom: null }

// Track what we last SENT so the flush can:
//  - skip redundant identical gimbal commands,
//  - send exactly one stop when motion ends,
//  - send exactly one stopZoom when zoom ends.
let lastSentMoving = false
let lastSentZooming = false

// ── PER-CAMERA path (gamepad drives cam 1 + cam 2 simultaneously) ──
// Same shape + dedup discipline as the active path, tracked independently per cam.
const desiredFor: Record<CameraId, DesiredState> = {
  1: { yaw: 0, pitch: 0, zoom: null },
  2: { yaw: 0, pitch: 0, zoom: null },
}
const lastSentMovingFor: Record<CameraId, boolean> = { 1: false, 2: false }
const lastSentZoomingFor: Record<CameraId, boolean> = { 1: false, 2: false }

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

/** Push a per-camera gimbal velocity (or a single stop) to main. */
function flushGimbalFor(cam: CameraId): void {
  const d = desiredFor[cam]
  const moving = !near0(d.yaw) || !near0(d.pitch)
  if (moving) {
    void window.api.cameraNudgeXYFor({ camera: cam, yaw: Math.round(d.yaw), pitch: Math.round(d.pitch) })
    lastSentMovingFor[cam] = true
  } else if (lastSentMovingFor[cam]) {
    void window.api.cameraNudgeXYFor({ camera: cam, yaw: 0, pitch: 0, stop: true })
    lastSentMovingFor[cam] = false
  }
}

/** Push a per-camera zoom velocity (or a single stopZoom) to main. */
function flushZoomFor(cam: CameraId): void {
  const d = desiredFor[cam]
  if (d.zoom && d.zoom.speed > 0) {
    void window.api.cameraZoomVelocityFor({ camera: cam, dir: d.zoom.dir, speed: d.zoom.speed })
    lastSentZoomingFor[cam] = true
  } else if (lastSentZoomingFor[cam]) {
    void window.api.cameraZoomVelocityFor({ camera: cam, dir: 'in', speed: 0, stop: true })
    lastSentZoomingFor[cam] = false
  }
}

function tick(): void {
  flushGimbal()
  flushZoom()
  flushGimbalFor(1)
  flushGimbalFor(2)
  flushZoomFor(1)
  flushZoomFor(2)
}

/** Set the desired gimbal velocity (signed, already scaled by the sender). */
export function setGimbal(yaw: number, pitch: number): void {
  desired.yaw = yaw
  desired.pitch = pitch
}

/** Set the desired zoom command (or null to stop zooming). */
export function setZoom(zoom: ZoomCommand | null): void {
  desired.zoom = zoom
}

/** Set a per-camera desired gimbal velocity (signed, already scaled by the sender). */
export function setGimbalFor(cam: CameraId, yaw: number, pitch: number): void {
  const d = desiredFor[cam]
  d.yaw = yaw
  d.pitch = pitch
}

/** Set a per-camera desired zoom command (or null to stop zooming). */
export function setZoomFor(cam: CameraId, zoom: ZoomCommand | null): void {
  desiredFor[cam].zoom = zoom
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
  // Clear + stop BOTH per-camera states (gamepad-driven cam 1 + cam 2).
  for (const cam of [1, 2] as CameraId[]) {
    const d = desiredFor[cam]
    d.yaw = 0
    d.pitch = 0
    d.zoom = null
    if (lastSentMovingFor[cam]) {
      void window.api.cameraNudgeXYFor({ camera: cam, yaw: 0, pitch: 0, stop: true })
      lastSentMovingFor[cam] = false
    }
    if (lastSentZoomingFor[cam]) {
      void window.api.cameraZoomVelocityFor({ camera: cam, dir: 'in', speed: 0, stop: true })
      lastSentZoomingFor[cam] = false
    }
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
