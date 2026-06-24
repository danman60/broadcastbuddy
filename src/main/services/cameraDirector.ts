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
  zoomToRatio: (ratio: number, speed: number) => void
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
  setRecording: (on: boolean) => void
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

interface CameraDirector {
  saveHome: (name?: string) => unknown
  goHome: () => unknown
  cam: CameraHal
}

/**
 * The routine-lifecycle CADENCE state machine (from @compsync/camera). This REPLACES
 * the old dancerCount → framing-tier model: every routine (solo … production) runs the
 * same ESTABLISH → PUSH → AUTO_HOLD cadence, always group/multi, full-body, onlyMe OFF.
 * The dancer count is no longer used for framing. See RoutineCadence.ts in the package.
 */
interface RoutineCadence {
  onRoutineStart: () => void
  onRoutineEnd: () => void
  onSubjectLost: () => void
  onSubjectPresent: () => void
  reArmGroupAi: () => void
  saveWideHome: (name?: string) => void
  goIdleWide: () => void
  dispose: () => void
  readonly current: string
}

let cameraModulePromise: Promise<CameraModule | null> | null = null
// Multi-camera: one connected Director + cadence PER host, so both PTZ cameras
// stay connected simultaneously and switching the active camera is instant (no
// teardown/reconnect). Keyed by resolved host IP.
const directors = new Map<string, Promise<CameraDirector | null>>()
const cadences = new Map<string, RoutineCadence>()

/** The cadence state machine for a host's Director (null until built). */
function getCadence(host: string): RoutineCadence | null {
  return cadences.get(host) ?? null
}

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
  const host2 = (s.cameraHost2 || '').trim()
  return autoMode || host.length > 0 || host2.length > 0
}

/**
 * The ACTIVE camera id (which PTZ the manual/Xbox/deck controls target). 1 or 2.
 * Default 1. Camera 1 is also the program/auto camera (routine cadence).
 */
export function getActiveCameraId(s: AppSettings = settings.getAll()): 1 | 2 {
  return s.activeCameraId === 2 ? 2 : 1
}

/**
 * Resolve a SPECIFIC camera's host. Camera 1 falls back to the OBSBOT default
 * (192.168.88.10) when active but blank (plug-and-play); camera 2 has NO default —
 * it's off unless an IP is typed. Returns null when the feature is inactive OR the
 * requested camera has no host.
 */
export function resolveCameraHostFor(id: 1 | 2, s: AppSettings = settings.getAll()): string | null {
  if (!isCameraFeatureActive(s)) return null
  if (id === 2) {
    const h = (s.cameraHost2 || '').trim()
    return h || null
  }
  const h = (s.cameraHost || '').trim()
  return h || DEFAULT_CAMERA_HOST
}

/**
 * Resolve the host of the ACTIVE camera (manual/Xbox/deck target). When the active
 * camera (2) has no host configured, falls back to camera 1 so controls aren't dead.
 * Most control entry points resolve through here. Null = feature off / no camera.
 */
export function resolveCameraHost(s: AppSettings = settings.getAll()): string | null {
  if (!isCameraFeatureActive(s)) return null
  return resolveCameraHostFor(getActiveCameraId(s), s) ?? resolveCameraHostFor(1, s)
}

/** Host of the PROGRAM / auto camera (always camera 1) — drives the routine cadence. */
export function resolveProgramCameraHost(s: AppSettings = settings.getAll()): string | null {
  return resolveCameraHostFor(1, s)
}

/** Set which PTZ camera the manual/Xbox/deck controls drive (1 or 2). Persists. */
export function setActiveCamera(id: number): 1 | 2 {
  const v: 1 | 2 = Number(id) === 2 ? 2 : 1
  settings.set('activeCameraId', v)
  logger.info(`Active PTZ camera = ${v}`)
  return v
}

function resolvePort(s: AppSettings = settings.getAll()): number {
  const p = s.cameraPort
  return typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : 80
}

/** HTTP port for a resolved host (camera 2's host uses cameraPort2). */
function resolvePortForHost(host: string, s: AppSettings = settings.getAll()): number {
  const host2 = (s.cameraHost2 || '').trim()
  if (host2 && host === host2) {
    const p2 = s.cameraPort2
    return typeof p2 === 'number' && Number.isFinite(p2) && p2 > 0 ? p2 : 80
  }
  return resolvePort(s)
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
  let promise = directors.get(host)
  if (!promise) {
    promise = (async () => {
      try {
        const mod = await loadCameraModule()
        if (!mod) return null
        const { Director, RestCamera, RoutineCadence } = mod as CameraModule & {
          RoutineCadence: new (cam: unknown, opts?: unknown) => RoutineCadence
        }
        const s = settings.getAll()
        const cam = new RestCamera({ host, port: resolvePortForHost(host, s), dryRun: false })
        const director = new Director(cam, { mode: resolveFramingMode(s) }) as unknown as CameraDirector
        await director.cam.connect()
        // Build the routine-lifecycle cadence on the SAME connected HAL (one per host).
        cadences.set(host, new RoutineCadence(cam, {
          onTransition: (from: string, to: string) =>
            logger.info(`Camera[${host}] cadence: ${from} → ${to}`),
        }))
        logger.info(`OBSBOT camera connected at ${host}`)
        return director
      } catch (err) {
        logger.error(`Failed to connect OBSBOT camera at ${host}:`, err)
        directors.delete(host) // allow a later retry to rebuild
        return null
      }
    })()
    directors.set(host, promise)
  }
  return promise
}

/** Drop cached Director(s) so the next call rebuilds. host omitted = all cameras. */
function invalidateDirector(host?: string): void {
  const hosts = host ? [host] : [...directors.keys(), ...cadences.keys()]
  for (const h of new Set(hosts)) {
    const c = cadences.get(h)
    if (c) {
      try { c.dispose() } catch { /* ignore */ }
      cadences.delete(h)
    }
    directors.delete(h)
  }
}

// ── Breathing oscillation REMOVED ────────────────────────────────
// The old group "breathing" AutoZoom oscillation fought the camera's own AutoZoom
// (two things driving the framing tier) and is gone entirely. The routine-lifecycle
// CADENCE (RoutineCadence) now owns all framing motion: snap-wide → slow push →
// hand off to GROUP AutoZoom, which dynamically frames everyone. No oscillation.

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

/**
 * Routine advance → run the lifecycle CADENCE (the camera "follows" the routine).
 *
 * BB calls this on select / next / prev / fire, so each is treated as a routine
 * START: onRoutineStart() runs ESTABLISH → PUSH → AUTO_HOLD (always group/multi,
 * full-body, onlyMe OFF). The `dancerCount` param is RETAINED only for call-site
 * compatibility (and trigger-name logging) — the cadence does NOT use it: there is
 * no per-routine dancer-count framing tier anymore.
 *
 * No-op unless Auto Mode is ON and a host resolves. With Auto Mode off this is
 * byte-identical to the pre-feature fire path. Never throws — failures logged only.
 */
export function applyRoutineForTrigger(dancerCount?: number | undefined): void {
  try {
    const s = settings.getAll()
    // Auto-Mode guard: trigger-driven framing ONLY when the operator opted in.
    if (s.cameraAutoMode !== true) return // feature/auto OFF — complete no-op
    // Auto-framing always drives the PROGRAM camera (camera 1), independent of which
    // camera the operator is manually steering (active).
    const host = resolveProgramCameraHost(s)
    if (!host) return

    // Run async, detached — the show flow does not await the camera.
    void (async () => {
      try {
        const director = await getDirector(host)
        const cadence = getCadence(host)
        if (!director || !cadence) return
        // Every routine runs the SAME cadence — no count-derived framing.
        cadence.onRoutineStart()
        logger.info(`Camera cadence: onRoutineStart (dancerCount hint=${dancerCount ?? 'n/a'}, ignored for framing)`)
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
 * "Set Wide-Home": store the camera's CURRENT pose as the Home (wide stage) preset
 * that IDLE_WIDE / ESTABLISH recall. The operator manually frames the full stage,
 * then calls this to capture it. Routed through the cadence (same Home preset slot)
 * when available so the state machine and manual save stay in lock-step; falls back
 * to director.saveHome(). No-op unless the camera feature is active. Detached +
 * try/catch — never throws into the UI.
 */
export function saveHomeViaCamera(): void {
  try {
    const host = resolveCameraHost()
    if (!host) return // feature OFF — complete no-op

    void (async () => {
      try {
        const director = await getDirector(host)
        if (!director) return
        const cadence = getCadence(host)
        if (cadence) cadence.saveWideHome()
        else director.saveHome()
        logger.info('Saved camera Wide-Home preset (operator-framed wide stage)')
      } catch (err) {
        logger.error('Camera saveHome failed:', err)
      }
    })()
  } catch (err) {
    logger.error('saveHomeViaCamera guard failed:', err)
  }
}

/** "Set Wide-Home" alias — the operator-facing name for saveHomeViaCamera(). */
export const setWideHomeViaCamera = saveHomeViaCamera

/**
 * Safety / panic: recall the static wide Home preset with AI tracking OFF. Used
 * between routines or as the operator's instant override. No-op unless the camera
 * feature is active. Detached + try/catch — never throws into the UI.
 */
export function goHomeViaCamera(): void {
  try {
    const host = resolveCameraHost()
    if (!host) return // feature OFF — complete no-op

    void (async () => {
      try {
        const director = await getDirector(host)
        if (!director) return
        // Route through the cadence (goIdleWide) when available: it cancels any
        // in-flight ESTABLISH→PUSH→AUTO_HOLD cascade and lost-timer, then does the
        // AI-off + Home recall — keeping the state machine coherent. Falls back to
        // director.goHome() (identical wire) if the cadence isn't built yet.
        const cadence = getCadence(host)
        if (cadence) cadence.goIdleWide()
        else director.goHome()
        logger.info('Camera went to Home (safety wide, AI off, cadence IDLE_WIDE)')
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

// Gimbal velocity calibration (OBSBOT Tail 2, measured live): ~0.78 deg/s per unit,
// and a POSITIVE command DECREASES the coordinate — so invert the delta's sign.
const SWEEP_DEG_PER_UNIT = 0.78

/**
 * Choreographed camera MOVE — the reusable primitive behind named moves
 * (Audience Sweep, Stage Sweep, and future operator-built moves). Snaps to preset
 * `fromId`, then over `durationMs` slowly pans (velocity-interpolates yaw+pitch)
 * toward preset `toId`, then recalls `toId` to land exactly. Fully guarded /
 * detached / no-op unless a camera host is set. Never throws back to the caller.
 */
export function sweepBetweenPresets(fromId: number, toId: number, durationMs: number): void {
  const host = resolveCameraHost()
  if (!host) return
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const clampVel = (v: number): number => Math.max(-60, Math.min(60, Math.round(v)))
  void (async () => {
    try {
      const director = await getDirector(host)
      if (!director) return
      const cam = director.cam
      const raw = (await cam.getGimbalPos()) as
        | { presetList?: Array<{ id: number; yaw: number; pitch: number }>; presetlist?: Array<{ id: number; yaw: number; pitch: number }> }
        | undefined
      const list = raw?.presetList ?? raw?.presetlist ?? []
      const A = list.find((p) => p.id === fromId)
      const B = list.find((p) => p.id === toId)
      cam.triggerPreset(fromId) // snap to the start position (fast)
      await sleep(2000) // let the snap settle
      if (A && B && durationMs > 0) {
        const secs = Math.max(0.5, durationMs / 1000)
        // Flat horizontal sweep: drive YAW only, hold pitch constant. The
        // pan-tilt head couples pitch onto the yaw platform, so a simultaneous
        // yaw+pitch velocity bows the path upward ("arc"). Pure yaw = straight
        // across. The final triggerPreset(toId) corrects any residual pitch
        // difference between the two presets.
        const yawCmd = clampVel(-((B.yaw - A.yaw) / secs) / SWEEP_DEG_PER_UNIT)
        cam.gimbalVelocityXY(yawCmd, 0) // pure horizontal pan
        await sleep(durationMs)
        cam.gimbalStopAll()
      }
      await sleep(150)
      cam.triggerPreset(toId) // land exactly on the end position
      logger.info(`Camera move: sweep ${fromId}->${toId} ${durationMs}ms`)
    } catch (err) {
      logger.error('sweepBetweenPresets failed:', err)
    }
  })()
}

// True while a native zoom ease is gliding; a second press cancels it.
let slowZoomActive = false
// Camera-native zoom speed for the slow push. LOW = slow, smooth cinematic ramp
// ("creeps"). Client-side stepping stuttered; the camera's own speed param is the
// smooth primitive (REST /ptz/zoom {ratio,speed}). Tune 1-3 for slower/faster.
const SLOW_ZOOM_SPEED = 2

/**
 * Slow optical-zoom PUSH from the CURRENT zoom toward a tele target (current ×
 * `factor`, clamped ≤12). Issues ONE native `zoomToRatio(target, lowSpeed)` — the
 * camera eases there smoothly on its own ramp (no client-side stepping, which
 * stuttered). Does NOT touch AI workmode: if tracking is on, the gimbal keeps
 * following while we push in. A second press CANCELS (retargets the live ratio).
 * `durationMs` only sizes the active-guard window. Guarded / no-op without a host.
 */
export function slowZoomPush(durationMs = 10000, factor = 1.5): void {
  const host = resolveCameraHost()
  if (!host) return
  void (async () => {
    try {
      const director = await getDirector(host)
      if (!director) return
      const cam = director.cam
      if (slowZoomActive) {
        // Second press = cancel: camera-native stop (retarget current ratio).
        slowZoomActive = false
        await cam.stopZoom()
        logger.info('Camera slow-zoom push canceled')
        return
      }
      const info = (await cam.getZoomInfo()) as { ratio?: number } | undefined
      const start = info && typeof info.ratio === 'number' ? info.ratio : 1.0
      const target = Math.min(12, Math.max(1, start * factor))
      slowZoomActive = true
      cam.zoomToRatio(target, SLOW_ZOOM_SPEED) // single smooth native ramp
      setTimeout(() => { slowZoomActive = false }, Math.max(1000, durationMs))
      logger.info(`Camera slow-zoom push ${start.toFixed(1)}->${target.toFixed(1)} speed ${SLOW_ZOOM_SPEED}`)
    } catch (err) {
      slowZoomActive = false
      logger.error('slowZoomPush failed:', err)
    }
  })()
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
  | { kind: 'record'; on: boolean }

export function setCameraControl(c: CameraControl): void {
  withCam(`ctrl:${c.kind}`, (cam) => {
    switch (c.kind) {
      case 'trackingSpeed': cam.setTrackingSpeed(c.mode); break
      case 'aiMode': cam.setAiMode(c.mode); break
      case 'autoZoom': cam.setAutoZoom(c.aiMode, c.tier); break
      case 'onlyMe': cam.setOnlyMe(c.on); break
      case 'zoomLevel': cam.setZoom(c.level); break
      case 'record': cam.setRecording(c.on); break
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

// ── Routine cadence: operator self-heal + lifecycle hooks ─────────────────────
// These drive the RoutineCadence state machine directly (not the HAL). All no-op
// when the camera feature/director isn't built yet. Detached + guarded.

/** Run `fn` against the connected cadence, detached + guarded. No-op when inactive. */
function withCadence(label: string, fn: (c: RoutineCadence) => void): void {
  try {
    // Cadence self-heal acts on the PROGRAM camera (camera 1), the auto-tracking cam.
    const host = resolveProgramCameraHost()
    if (!host) return // feature OFF — complete no-op
    void (async () => {
      try {
        await getDirector(host) // ensures the cadence is built
        const cadence = getCadence(host)
        if (!cadence) return
        fn(cadence)
        logger.info(`Camera cadence cmd: ${label} (state=${cadence.current})`)
      } catch (err) {
        logger.error(`Camera cadence ${label} failed:`, err)
      }
    })()
  } catch (err) {
    logger.error(`${label} cadence guard failed:`, err)
  }
}

/**
 * SELF-HEAL: re-arm GROUP AI now (operator pressed "re-arm Auto", or a workmode poll
 * saw the camera revert to `none`). Re-enters AUTO_HOLD directly — group/multi AI,
 * full-body AutoZoom, onlyMe OFF — so the operator never has to manually re-press
 * Auto after the camera drops its subject. See RoutineCadence.reArmGroupAi.
 */
export function reArmCameraGroupAi(): void {
  withCadence('reArmGroupAi', (c) => c.reArmGroupAi())
}

/**
 * Subject-lost signal in. The cadence arms a grace timer (SUBJECT_LOST_MS) and, if
 * the lost state persists, falls back to IDLE_WIDE (static wide). SIGNAL SOURCE is
 * BENCH-TBD: the intended trigger is a GET /ai/workmode poll seeing `none`. No
 * hardware readback wired yet — see RoutineCadence.onSubjectLost TODO.
 */
export function notifyCameraSubjectLost(): void {
  withCadence('onSubjectLost', (c) => c.onSubjectLost())
}

/** Subject-present signal in. Cancels the lost grace timer; self-heals back to AUTO_HOLD if we'd drifted to IDLE_WIDE. */
export function notifyCameraSubjectPresent(): void {
  withCadence('onSubjectPresent', (c) => c.onSubjectPresent())
}

/**
 * Wider/Tighter framing nudge for AUTO_HOLD. Steps the GROUP AutoZoom tier on the HAL
 * (multi mode), NEVER tighter than full body (tier 5, the recital floor). 'wider'
 * opens toward the long-shot tiers (6, 7); 'tighter' steps back toward 5. This drives
 * the SAME AutoZoom channel the cadence hands off to, so it rides on top of tracking.
 */
let groupFramingTier = 5 // current AUTO_HOLD AutoZoom tier (5=fullBody floor … 7=widest)
export function nudgeCameraFraming(dir: 'wider' | 'tighter'): void {
  withCam('framing-nudge', (cam) => {
    const next = dir === 'wider' ? groupFramingTier + 1 : groupFramingTier - 1
    groupFramingTier = Math.max(5, Math.min(7, next)) // clamp [fullBody floor … widest]
    cam.setAutoZoom(1, groupFramingTier) // multi-mode AutoZoom tier
  })
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
