/**
 * cameraDirector — GUARDED, OPT-IN OBSBOT camera framing on trigger fire.
 *
 * Entirely dormant unless the operator sets a `cameraHost` in settings. When a
 * host IS configured, firing a trigger that carries a numeric `dancerCount`
 * drives the OBSBOT Tail 2 into the right framing via the local
 * `@compsync/camera` package (Director + RestCamera over HTTP).
 *
 * Design constraints (this is a SHIPPING production app):
 *  - ZERO behaviour change when `cameraHost` is empty/unset → applyRoutineForTrigger()
 *    early-returns before touching anything.
 *  - A camera failure must NEVER throw into the show flow → every async step is
 *    wrapped in try/catch and only logged.
 *  - The ESM-only `@compsync/camera` package is loaded via a dynamic import()
 *    (this file is bundled CJS) so a static ESM import can't break the build.
 *  - Isolated here so the feature is easy to remove or extend.
 */
import { createLogger } from '../logger'
import * as settings from './settings'

const logger = createLogger('camera')

// Lazily-resolved package module + connected Director singleton, keyed by the
// host they were built for (so a host change rebuilds rather than reusing a
// stale connection).
type CameraModule = typeof import('@compsync/camera')
let cameraModulePromise: Promise<CameraModule | null> | null = null
let directorPromise: Promise<unknown | null> | null = null
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
 * Build (once per host) a connected Director. Returns null on any failure —
 * callers treat null as "camera unavailable, do nothing".
 */
async function getDirector(host: string): Promise<{ applyRoutine: (r: { dancerCount: number }) => unknown } | null> {
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
        const director = new Director(new RestCamera({ host, dryRun: false }))
        await director.cam.connect()
        logger.info(`OBSBOT camera connected at ${host}`)
        return director
      } catch (err) {
        logger.error(`Failed to connect OBSBOT camera at ${host}:`, err)
        return null
      }
    })()
  }
  return directorPromise as Promise<{ applyRoutine: (r: { dancerCount: number }) => unknown } | null>
}

/**
 * Fire-and-forget camera framing for a trigger going live. No-op (returns
 * immediately) unless BOTH a camera host is configured AND the trigger carries
 * a numeric dancerCount. Never throws — failures are logged only.
 */
export function applyRoutineForTrigger(dancerCount: number | undefined): void {
  try {
    const host = (settings.get('cameraHost') || '').trim()
    if (!host) return // feature OFF — complete no-op, byte-identical fire path
    if (typeof dancerCount !== 'number' || Number.isNaN(dancerCount)) return

    // Run async, detached — the show flow does not await the camera.
    void (async () => {
      try {
        const director = await getDirector(host)
        if (!director) return
        director.applyRoutine({ dancerCount })
        logger.info(`Applied camera routine (dancerCount=${dancerCount})`)
      } catch (err) {
        logger.error('Camera applyRoutine failed:', err)
      }
    })()
  } catch (err) {
    // Defensive — must never throw into the caller (trigger fire).
    logger.error('applyRoutineForTrigger guard failed:', err)
  }
}
