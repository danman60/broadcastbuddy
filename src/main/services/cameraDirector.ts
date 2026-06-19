/**
 * cameraDirector — GUARDED, OPT-IN OBSBOT camera control.
 *
 * Entirely dormant unless the camera feature is ACTIVE. The feature is active
 * when EITHER the operator flips Auto Mode on (`cameraAutoMode === true`) OR a
 * `cameraHost` IP is configured. When active, the host resolves to the operator's
 * `cameraHost` if set, otherwise the OBSBOT USB/RNDIS default `192.168.88.10`
 * (plug-and-play — no IP typing). See `resolveCameraHost` / `isCameraFeatureActive`.
 *
 * Two distinct guard layers:
 *  - applyRoutineForTrigger (auto-frame on trigger fire) requires `cameraAutoMode`
 *    to be TRUE in addition to a resolvable host + numeric dancerCount. With Auto
 *    Mode off the trigger path is a complete no-op (byte-identical to today).
 *  - Manual control / save-home / go-home / probe activate on the broader
 *    isCameraFeatureActive signal (auto-mode OR host) — the operator can drive the
 *    camera by hand the moment the feature is on.
 *
 * Design constraints (this is a SHIPPING production app):
 *  - ZERO behaviour change when the feature is inactive → every entry point
 *    early-returns before touching the camera package.
 *  - A camera failure must NEVER throw into the show flow → every async step is
 *    wrapped in try/catch and only logged. Helpers are fire-and-forget (detached).
 *  - The ESM-only `@compsync/camera` package is loaded via a dynamic import()
 *    (this file is bundled CJS) so a static ESM import can't break the build.
 *  - Isolated here so the feature is easy to remove or extend.
 */
import * as os from 'os'
import { createLogger } from '../logger'
import * as settings from './settings'
import type { AppSettings } from '../../shared/types'

const logger = createLogger('camera')

// OBSBOT USB/RNDIS single-cable fixed address — the SDK default. Used as the
// host fallback when the feature is active but no cameraHost was typed.
const DEFAULT_CAMERA_HOST = '192.168.88.10'

// Continuous 10Hz commands — excluded from per-command logging so the joystick/zoom
// stream doesn't flood the log. Discrete pose commands (recenter/preset/home/ai) log.
const QUIET_CAM_LABELS = new Set(['nudge', 'zoom', 'nudge-xy', 'zoom-velocity'])

// Lazily-resolved package module + connected Director singleton, keyed by the
// host they were built for (so a host change rebuilds rather than reusing a
// stale connection).
type CameraModule = typeof import('@compsync/camera')

// The subset of the ICamera HAL we drive for manual control (lives on Director.cam).
interface CameraHal {
  gimbalVelocity: (dir: 'up' | 'down' | 'left' | 'right', speed: number) => void
  gimbalVelocityXY: (yaw: number, pitch: number) => void
  gimbalStop: (dir: 'up' | 'down' | 'left' | 'right') => void
  gimbalStopAll: () => void
  zoomTo: (target: number, speed: number) => void
  zoomVelocity: (dir: 'in' | 'out', speed: number) => void
  stopZoom: () => void | Promise<void>
  resetGimbal: () => void
  setAiEnable: (enable: boolean) => void
  triggerPreset: (n: number) => void
  setPreset: (id: number, name?: string) => void
  deletePreset: (id: number) => void
  setTrackingSpeed: (mode: number) => void
  setZoom: (level: number) => void
  setAiMode: (mode: 0 | 1) => void
  setAutoZoom: (aiMode: 0 | 1, tier: number) => void
  setOnlyMe: (on: boolean) => void
  setExposureMode: (mode: 'auto' | 'manual') => void
  setEvBias: (ev: number) => void
  setManualIso: (iso: number) => void
  setManualShutter: (shutter: string) => void
  setWhiteBalance: (mode: 'auto' | 'daylight' | 'fluorescent' | 'tungsten' | 'cloudy' | 'manual', temperature?: number) => void
  setAfMode: (mode: 'afc' | 'afs' | 'mf') => void
  setManualFocus: (position: number) => void
  getGimbalPos: (deviceIndex?: number) => void | Promise<unknown>
  getZoomInfo: (deviceIndex?: number) => void | Promise<unknown>
  connect: () => Promise<void>
}

/** Manual image-control command from the operator panel (white balance / exposure / focus). */
export type CameraImageControl =
  | { kind: 'exposureMode'; mode: 'auto' | 'manual' }
  | { kind: 'evBias'; ev: number }
  | { kind: 'iso'; iso: number }
  | { kind: 'shutter'; shutter: string }
  | { kind: 'whiteBalance'; mode: 'auto' | 'daylight' | 'fluorescent' | 'tungsten' | 'cloudy' | 'manual'; temperature?: number }
  | { kind: 'afMode'; mode: 'afc' | 'afs' | 'mf' }
  | { kind: 'manualFocus'; position: number }

// The applied-routine shape the Director returns — only the breathing fields we use.
interface AppliedRoutine {
  type: string
  profile: {
    breathe: boolean
    breathingTiers: [string, string]
  }
}

interface CameraDirector {
  applyRoutine: (r: { dancerCount: number }) => AppliedRoutine
  applyBreathTier: (tier: string) => void
  saveHome: (name?: string) => unknown
  goHome: () => unknown
  cam: CameraHal
}

let cameraModulePromise: Promise<CameraModule | null> | null = null
let directorPromise: Promise<CameraDirector | null> | null = null
let directorHost: string | null = null

async function loadCameraModule(): Promise<CameraModule | null> {
  if (!cameraModulePromise) {
    cameraModulePromise = (async () => {
      try {
        // Dynamic import keeps the ESM-only package out of the static CJS graph.
        return (await import('@compsync/camera')) as CameraModule
      } catch (err) {
        logger.error('Failed to load @compsync/camera module:', err)
        return null
      }
    })()
  }
  return cameraModulePromise
}

/**
 * Is the camera feature considered ACTIVE? True when the operator opted in via
 * Auto Mode OR explicitly configured a host IP. When false, EVERY entry point in
 * this module is a complete no-op (the camera stays fully off).
 */
export function isCameraFeatureActive(s: AppSettings = settings.getAll()): boolean {
  const autoMode = s.cameraAutoMode === true
  const host = (s.cameraHost || '').trim()
  return autoMode || host.length > 0
}

/**
 * Resolve the camera host to dial. Returns the operator-typed `cameraHost` when
 * set, otherwise the OBSBOT default `192.168.88.10` — but ONLY when the feature
 * is active. Returns null when the feature is inactive (guard preserved: no host,
 * no camera). Callers treat null as "feature off, do nothing".
 */
export function resolveCameraHost(s: AppSettings = settings.getAll()): string | null {
  if (!isCameraFeatureActive(s)) return null
  const host = (s.cameraHost || '').trim()
  return host || DEFAULT_CAMERA_HOST
}

function resolvePort(s: AppSettings = settings.getAll()): number {
  const p = s.cameraPort
  return typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : 80
}

function resolveFramingMode(s: AppSettings = settings.getAll()): 'recital' | 'competition' {
  return s.cameraFramingMode === 'competition' ? 'competition' : 'recital'
}

/**
 * Build (once per host) a connected Director. Returns null on any failure —
 * callers treat null as "camera unavailable, do nothing". The Director is built
 * with the operator's framing mode + port from settings.
 */
async function getDirector(host: string): Promise<CameraDirector | null> {
  if (directorHost !== host) {
    // Host changed (or first use) → drop any prior singleton and rebuild.
    directorHost = host
    directorPromise = null
  }
  if (!directorPromise) {
    directorPromise = (async () => {
      try {
        const mod = await loadCameraModule()
        if (!mod) return null
        const { Director, RestCamera } = mod
        const s = settings.getAll()
        const cam = new RestCamera({ host, port: resolvePort(s), dryRun: false })
        const director = new Director(cam, { mode: resolveFramingMode(s) }) as unknown as CameraDirector
        await director.cam.connect()
        logger.info(`OBSBOT camera connected at ${host}`)
        return director
      } catch (err) {
        logger.error(`Failed to connect OBSBOT camera at ${host}:`, err)
        return null
      }
    })()
  }
  return directorPromise
}

/** Drop any cached Director so the next call rebuilds (after a settings change). */
function invalidateDirector(): void {
  stopBreathing() // the old Director is going away — kill its breathing loop
  directorHost = null
  directorPromise = null
}

// ── Group breathing oscillation ──────────────────────────────────
// A slow, near-imperceptible AutoZoom in/out on GROUP routines so the shot is
// never perfectly static. Implemented as an AI-tier toggle (NOT a manual /ptz/zoom
// loop) so it never contends with AI AutoZoom — both ends are AutoZoom tiers ≥ the
// recital floor, so the group always stays framed. Solos/duets/trios do not breathe.
let breathTimer: ReturnType<typeof setInterval> | null = null
let breathIndex = 0

// Half-cycle = base→partner; full in-and-out breath ≈ 2× this. ~14s half → ~28s
// full cycle: slow enough to read as "alive", not as a zoom move. TUNABLE.
const BREATH_HALF_PERIOD_MS = 14_000

function stopBreathing(): void {
  if (breathTimer) {
    clearInterval(breathTimer)
    breathTimer = null
  }
}

/**
 * Start the breathing oscillation between two AutoZoom tiers. The base tier is
 * already applied by applyRoutine(); this steps to the partner first, then alternates
 * on a slow timer. Detached/guarded — a tick failure is logged, never thrown.
 */
function startBreathing(director: CameraDirector, tiers: [string, string]): void {
  stopBreathing()
  breathIndex = 0 // 0 = base (currently applied); first tick steps to the partner
  breathTimer = setInterval(() => {
    try {
      breathIndex = breathIndex === 0 ? 1 : 0
      director.applyBreathTier(tiers[breathIndex])
    } catch (err) {
      logger.error('Camera breathing tick failed:', err)
    }
  }, BREATH_HALF_PERIOD_MS)
  // Never let the breathing timer hold the process open.
  if (typeof breathTimer.unref === 'function') breathTimer.unref()
}

/**
 * Fire-and-forget camera framing for a trigger going live. No-op (returns
 * immediately) unless ALL of: Auto Mode is ON, a host resolves, and the trigger
 * carries a numeric dancerCount. With Auto Mode off this is byte-identical to the
 * pre-feature fire path. Never throws — failures are logged only.
 */
/**
 * Derive a routine's dancer count from its NAME when no explicit count was set.
 * Recital programmes encode the routine TYPE in the name (Solo / Duet / Trio /
 * Group / class names) — and that type is all the camera framing needs
 * (dancerCount → routineType → framingProfile). This is a FALLBACK only: an
 * explicit count (FieldMapper / TriggerEditor / CC package) always wins, so this
 * never overwrites a real number.
 *
 * Returns:
 *   1  for a solo
 *   2  for a duet (keyword, or a bare "A & B" / "A/B" two-name title)
 *   3  for a trio
 *   4  for a quartet
 *   8  for any other named routine (group default → multi full-body framing)
 *   undefined when there's no name to read (camera stays put — no-op).
 *
 * Tunable: the group default (8) lands in the small_group band (full-body, multi)
 * which is the safe recital default — wide enough that the camera always frames a
 * group rather than getting stuck. Bands live in @compsync/camera routineType.ts.
 */
export function deriveDancerCount(name: string | undefined): number | undefined {
  if (!name || !name.trim()) return undefined
  const n = name.toLowerCase()

  // Explicit size keywords win first (a name like "Jazz/Tap Group" is a group,
  // not a duet — so group/ensemble/etc. are checked before the "&" / "/" rule).
  if (/\bsolo\b/.test(n)) return 1
  if (/\bduets?\b/.test(n)) return 2
  if (/\btrios?\b/.test(n)) return 3
  if (/\bquartets?\b/.test(n)) return 4
  if (/\b(group|groups|finale|production|ensemble|company|team|line|troupe|class|squad)\b/.test(n)) return 8

  // No size keyword: a bare two-name title ("Cassia & Rowan", "Anna/Beth") reads
  // as a duet. Guard against matching "&"/"/" inside a larger group title — only
  // fires when the title is short and contains exactly one separator.
  const sep = (n.match(/\s[&/]\s|&|\//g) || []).length
  if (sep === 1 && name.trim().split(/\s+/).length <= 5) return 2

  // Named routine, no size signal → group default (wide full-body, never stuck).
  return 8
}

export function applyRoutineForTrigger(dancerCount: number | undefined): void {
  try {
    const s = settings.getAll()
    // Auto-Mode guard: trigger-driven framing ONLY when the operator opted in.
    if (s.cameraAutoMode !== true) return // feature/auto OFF — complete no-op
    const host = resolveCameraHost(s)
    if (!host) return
    if (typeof dancerCount !== 'number' || Number.isNaN(dancerCount)) return

    // Run async, detached — the show flow does not await the camera.
    void (async () => {
      try {
        const director = await getDirector(host)
        if (!director) return
        const applied = director.applyRoutine({ dancerCount })
        logger.info(`Applied camera routine (dancerCount=${dancerCount}, type=${applied?.type})`)

        // GROUP BREATHING — start the slow AutoZoom oscillation for group routines
        // when the operator hasn't disabled it. Solos/duets/trios (breathe=false)
        // and breathing-off both fall through to stopBreathing(), so switching from a
        // group to a solo cleanly halts any in-flight breath.
        const breathingOn = settings.getAll().cameraBreathing !== false // default ON
        if (breathingOn && applied?.profile?.breathe && applied.profile.breathingTiers) {
          startBreathing(director, applied.profile.breathingTiers)
          logger.info(`Camera breathing started (${applied.profile.breathingTiers.join('<->')})`)
        } else {
          stopBreathing()
        }
      } catch (err) {
        logger.error('Camera applyRoutine failed:', err)
      }
    })()
  } catch (err) {
    // Defensive — must never throw into the caller (trigger fire).
    logger.error('applyRoutineForTrigger guard failed:', err)
  }
}

/**
 * Store the camera's CURRENT pose as the Home (wide stage) preset. The operator
 * manually frames the full stage, then calls this to capture it. No-op unless the
 * camera feature is active. Detached + try/catch — never throws into the UI.
 */
export function saveHomeViaCamera(): void {
  try {
    const host = resolveCameraHost()
    if (!host) return // feature OFF — complete no-op

    void (async () => {
      try {
        const director = await getDirector(host)
        if (!director) return
        director.saveHome()
        logger.info('Saved camera Home preset (operator-framed wide stage)')
      } catch (err) {
        logger.error('Camera saveHome failed:', err)
      }
    })()
  } catch (err) {
    logger.error('saveHomeViaCamera guard failed:', err)
  }
}

/**
 * Safety / panic: recall the static wide Home preset with AI tracking OFF. Used
 * between routines or as the operator's instant override. No-op unless the camera
 * feature is active. Detached + try/catch — never throws into the UI.
 */
export function goHomeViaCamera(): void {
  try {
    const host = resolveCameraHost()
    if (!host) return // feature OFF — complete no-op

    stopBreathing() // panic / between routines — halt any group breathing

    void (async () => {
      try {
        const director = await getDirector(host)
        if (!director) return
        director.goHome()
        logger.info('Camera went to Home (safety wide, AI off)')
      } catch (err) {
        logger.error('Camera goHome failed:', err)
      }
    })()
  } catch (err) {
    logger.error('goHomeViaCamera guard failed:', err)
  }
}

// ── Connection probe ────────────────────────────────────────────────────────

export interface CameraProbeResult {
  ok: boolean
  host: string
  reachable: boolean
  error?: string
}

/**
 * Probe the camera connection. Resolves the host, (re)builds the Director's
 * RestCamera, runs connect() (a real GET /ai/workmode), and reports reachability.
 * NEVER throws — always resolves a result object. Backs a connection-status
 * indicator (UI added later).
 */
// ── Auto-discovery ───────────────────────────────────────────────
// Scan the private /24 subnet(s) this machine is on for the OBSBOT and return
// its IP. The camera answers GET <host>/camera/sdk/ai/workmode with 200 — that's
// the discovery signature (verified on real Tail 2). Works at any venue regardless
// of DHCP, no mDNS/extra deps. Used to auto-fill cameraHost when the camera's IP
// changes (the #1 field-failure risk).

export interface CameraDiscoverResult {
  found: boolean
  host?: string
  scanned: number
  subnets: string[]
}

/** The /24 prefixes (e.g. "192.168.0") for each non-internal PRIVATE IPv4 iface.
 * Skips Tailscale CGNAT (100.64/10), link-local, and public addresses. */
function privateSubnetPrefixes(): string[] {
  const prefixes = new Set<string>()
  const ifaces = os.networkInterfaces()
  for (const list of Object.values(ifaces)) {
    if (!list) continue
    for (const ni of list) {
      if (ni.internal || ni.family !== 'IPv4') continue
      const m = ni.address.match(/^(\d+)\.(\d+)\.(\d+)\.\d+$/)
      if (!m) continue
      const A = Number(m[1]), B = Number(m[2])
      const isPrivate =
        A === 10 || (A === 172 && B >= 16 && B <= 31) || (A === 192 && B === 168)
      if (isPrivate) prefixes.add(`${m[1]}.${m[2]}.${m[3]}`)
    }
  }
  return [...prefixes]
}

/** Probe one IP for the OBSBOT REST signature. Returns the IP on a 200, else null. */
async function probeObsbot(ip: string, port: number, timeoutMs: number): Promise<string | null> {
  const portPart = port === 80 ? '' : `:${port}`
  const url = `http://${ip}${portPart}/camera/sdk/ai/workmode`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) return null
    // A 200 is NOT enough: a router/gateway (typically x.x.x.1) answers ANY path
    // with its admin HTML page (200 + "<!DOCTYPE …"). The OBSBOT returns the REST
    // JSON `{"mode": "..."}`. Require a JSON body carrying `mode` so the gateway's
    // HTML catch-all can't masquerade as the camera.
    const text = await res.text()
    try {
      const body = JSON.parse(text)
      if (body && typeof body === 'object' && 'mode' in body) return ip
    } catch {
      /* HTML / non-JSON → not the camera */
    }
    return null
  } catch {
    return null // unreachable / timeout / non-OBSBOT — not the camera
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Discover the OBSBOT on the local network. Scans each private /24 in chunks,
 * returns the first host answering the REST signature. Never throws.
 */
export async function discoverCamera(): Promise<CameraDiscoverResult> {
  const port = resolvePort(settings.getAll())
  const subnets = privateSubnetPrefixes()
  const CHUNK = 64
  const TIMEOUT_MS = 1200
  let scanned = 0
  try {
    for (const prefix of subnets) {
      const ips = Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`)
      for (let i = 0; i < ips.length; i += CHUNK) {
        const chunk = ips.slice(i, i + CHUNK)
        const results = await Promise.all(chunk.map((ip) => probeObsbot(ip, port, TIMEOUT_MS)))
        scanned += chunk.length
        const hit = results.find((r) => r !== null)
        if (hit) {
          logger.info(`Camera discovered at ${hit} (scanned ${scanned} on ${subnets.join(', ')})`)
          return { found: true, host: hit, scanned, subnets }
        }
      }
    }
  } catch (err) {
    logger.error('Camera discovery failed:', err)
  }
  logger.info(`Camera discovery: none found (scanned ${scanned}, subnets ${subnets.join(', ') || 'none'})`)
  return { found: false, scanned, subnets }
}

/** Drop the cached Director (after a host change) so the next call reconnects. */
export function resetCameraConnection(): void {
  invalidateDirector()
}

export async function probeCameraConnection(): Promise<CameraProbeResult> {
  try {
    const host = resolveCameraHost()
    if (!host) {
      return { ok: false, host: '', reachable: false, error: 'Camera feature is off' }
    }
    const director = await getDirector(host)
    if (!director) {
      return { ok: false, host, reachable: false, error: 'Could not connect to camera' }
    }
    // getDirector already ran connect() successfully if it returned non-null;
    // run it again for a fresh reachability read.
    try {
      await director.cam.connect()
      return { ok: true, host, reachable: true }
    } catch (err) {
      return {
        ok: false,
        host,
        reachable: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  } catch (err) {
    return {
      ok: false,
      host: '',
      reachable: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ── Manual control (each guarded + detached + try/catch, reuses the singleton) ─
// All are fire-and-forget no-ops unless the camera feature is active. They drive
// the underlying ICamera HAL (director.cam) directly.

/** Run `fn` against the connected HAL, detached + guarded. No-op when inactive. */
function withCam(label: string, fn: (cam: CameraHal) => void): void {
  try {
    const host = resolveCameraHost()
    if (!host) return // feature OFF — complete no-op

    void (async () => {
      try {
        const director = await getDirector(host)
        if (!director) return
        fn(director.cam)
        // Log discrete pose-affecting commands (so the test log shows exactly what
        // moved the camera, e.g. a recenter/preset that sent it "up"). Skip the
        // continuous 10Hz joystick/zoom velocity labels — they would flood the log.
        if (!QUIET_CAM_LABELS.has(label)) logger.info(`Camera cmd: ${label}`)
      } catch (err) {
        logger.error(`Camera ${label} failed:`, err)
      }
    })()
  } catch (err) {
    logger.error(`${label} guard failed:`, err)
  }
}

/** Nudge the gimbal in a direction at a velocity, or stop that axis. */
export function nudgeCamera(
  dir: 'up' | 'down' | 'left' | 'right',
  speed: number,
  stop = false,
): void {
  withCam('nudge', (cam) => {
    if (stop) cam.gimbalStop(dir)
    else cam.gimbalVelocity(dir, speed)
  })
}

/** Ramp zoom to an abstract target (0–100) at a speed (0–10). */
export function zoomCamera(target: number, speed: number): void {
  withCam('zoom', (cam) => cam.zoomTo(target, speed))
}

/**
 * Recentre = RETURN TO THE STAGE VIEW. Recalls the operator-set Home (wide stage)
 * preset with AI off — NOT the camera's factory gimbal reset (which points at the
 * unit's mechanical centre, i.e. "straight up" on this mount). The recital wants the
 * camera to always fall back to the stage shot, so Recenter and Go-Home are the same
 * return-to-stage action. (Set the stage view first via Set Home.)
 */
export function recenterCamera(): void {
  goHomeViaCamera()
}

/** Recall stored preset n. */
export function recallCameraPreset(n: number): void {
  withCam('recall-preset', (cam) => cam.triggerPreset(n))
}

/** Store the current pose as preset id (with optional name). */
export function saveCameraPreset(id: number, name?: string): void {
  withCam('save-preset', (cam) => cam.setPreset(id, name))
}

/** Delete stored preset id. */
export function deleteCameraPreset(id: number): void {
  withCam('delete-preset', (cam) => cam.deletePreset(id))
}

/** Set the OBSBOT tracking-speed mode (0–5). */
export function setCameraTrackingSpeed(mode: number): void {
  withCam('set-tracking-speed', (cam) => cam.setTrackingSpeed(mode))
}

/** Tracking / framing / zoom controls (the live "OBSBOT Center replacement" suite). */
export type CameraControl =
  | { kind: 'trackingSpeed'; mode: number }
  | { kind: 'aiMode'; mode: 0 | 1 }
  | { kind: 'autoZoom'; aiMode: 0 | 1; tier: number }
  | { kind: 'onlyMe'; on: boolean }
  | { kind: 'zoomLevel'; level: number }

export function setCameraControl(c: CameraControl): void {
  withCam(`ctrl:${c.kind}`, (cam) => {
    switch (c.kind) {
      case 'trackingSpeed': cam.setTrackingSpeed(c.mode); break
      case 'aiMode': cam.setAiMode(c.mode); break
      case 'autoZoom': cam.setAutoZoom(c.aiMode, c.tier); break
      case 'onlyMe': cam.setOnlyMe(c.on); break
      case 'zoomLevel': cam.setZoom(c.level); break
    }
  })
}

/** Apply a manual image control (white balance / exposure / focus) from the operator panel. */
export function setCameraImageControl(c: CameraImageControl): void {
  withCam(`image:${c.kind}`, (cam) => {
    switch (c.kind) {
      case 'exposureMode': cam.setExposureMode(c.mode); break
      case 'evBias': cam.setEvBias(c.ev); break
      case 'iso': cam.setManualIso(c.iso); break
      case 'shutter': cam.setManualShutter(c.shutter); break
      case 'whiteBalance': cam.setWhiteBalance(c.mode, c.temperature); break
      case 'afMode': cam.setAfMode(c.mode); break
      case 'manualFocus': cam.setManualFocus(c.position); break
    }
  })
}

/**
 * 2D joystick gimbal velocity (BOTH axes in one command) or a crisp two-axis
 * stop. THIS is the high-rate (~10Hz) path the on-screen joystick + gamepad
 * drive — not the single-axis nudgeCamera above. Signed velocities, clamped by
 * the HAL to ±178. yaw>0 = right, pitch>0 = up. No-op when inactive.
 *
 * The handler that calls this fires it detached and does NOT await camera I/O,
 * so the ~10Hz invoke loop stays cheap.
 */
export function nudgeCameraXY(yaw: number, pitch: number, stop = false): void {
  withCam('nudge-xy', (cam) => {
    if (stop) cam.gimbalStopAll()
    else cam.gimbalVelocityXY(yaw, pitch)
  })
}

/** Hold-to-zoom velocity toward a rail, or stop the zoom ramp. */
export function zoomCameraVelocity(dir: 'in' | 'out', speed: number, stop = false): void {
  withCam('zoom-velocity', (cam) => {
    if (stop) void cam.stopZoom()
    else cam.zoomVelocity(dir, speed)
  })
}

/** Master AI tracking on/off (used by the auto/manual interlock + toggle). */
export function setCameraAiEnable(on: boolean): void {
  withCam('set-ai-enable', (cam) => cam.setAiEnable(on))
}

/**
 * Live camera state for the panel status readout. Awaits the RestCamera's real
 * GET read-backs (getGimbalPos/getZoomInfo) and NEVER throws — always resolves a
 * result object. Returns `reachable: false` when the feature is off or the
 * camera can't be reached.
 *
 * HAL note: RestCamera.getGimbalPos() returns the stored PRESET list (`{ presetlist }`),
 * NOT the instantaneous live pan/tilt — the OBSBOT SDK has no live-pose GET. So
 * `gimbal` is best-effort and may be absent; `zoom` reads the live ratio.
 */
export interface CameraStateResult {
  ok: boolean
  reachable: boolean
  gimbal?: { pan: number; tilt: number }
  zoom?: number
  error?: string
}

export async function getCameraState(): Promise<CameraStateResult> {
  try {
    const host = resolveCameraHost()
    if (!host) return { ok: false, reachable: false, error: 'Camera feature is off' }
    const director = await getDirector(host)
    if (!director) return { ok: false, reachable: false, error: 'Could not connect to camera' }

    const result: CameraStateResult = { ok: true, reachable: true }

    // Zoom — live ratio. RestCamera returns { ratio } (abstract), guard the shape.
    try {
      const zoomInfo = (await director.cam.getZoomInfo()) as { ratio?: number } | undefined
      if (zoomInfo && typeof zoomInfo.ratio === 'number') result.zoom = zoomInfo.ratio
    } catch (err) {
      logger.warn(`getCameraState zoom read failed: ${err instanceof Error ? err.message : String(err)}`)
    }

    // Gimbal — best-effort. The SDK returns the preset list, not live pose; if a
    // pan/tilt pair surfaces (future HAL), pass it through. Otherwise omit.
    try {
      const pos = (await director.cam.getGimbalPos()) as
        | { pan?: number; tilt?: number; pitch?: number; yaw?: number }
        | undefined
      if (pos && typeof pos === 'object') {
        const pan = typeof pos.pan === 'number' ? pos.pan : typeof pos.yaw === 'number' ? pos.yaw : undefined
        const tilt = typeof pos.tilt === 'number' ? pos.tilt : typeof pos.pitch === 'number' ? pos.pitch : undefined
        if (typeof pan === 'number' && typeof tilt === 'number') result.gimbal = { pan, tilt }
      }
    } catch (err) {
      logger.warn(`getCameraState gimbal read failed: ${err instanceof Error ? err.message : String(err)}`)
    }

    return result
  } catch (err) {
    return { ok: false, reachable: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Persist the Auto-Mode opt-in and react to the change:
 *  - OFF → also go to Home (safety wide) so the camera doesn't sit AI-tracking.
 *  - ON  → ensure a Director exists / probe so the connection is warm.
 * Persists `cameraAutoMode`. Never throws.
 */
export async function setCameraAutoMode(on: boolean): Promise<CameraProbeResult | { ok: boolean }> {
  try {
    settings.set('cameraAutoMode', on)
    if (!on) {
      // Turning off — release the gimbal to the safe wide shot (if a host exists).
      goHomeViaCamera()
      return { ok: true }
    }
    // Turning on — warm the connection and report reachability.
    invalidateDirector()
    return await probeCameraConnection()
  } catch (err) {
    logger.error('setCameraAutoMode failed:', err)
    return { ok: false }
  }
}
