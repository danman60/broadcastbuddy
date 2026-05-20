/**
 * Slow Zoom — drives a Move Transition between a base scene and a "zoomed"
 * scene for both Wide and Tight cameras. Operator pre-creates in OBS:
 *   - "Wide" + "Wide Zoomed" scenes (camera at base / +10% scale)
 *   - "Tight" + "Tight Zoomed" scenes (same pattern)
 *   - One Move Transition named "Slow Zoom" (default duration ~10s,
 *     ease-in-out cubic — Move plugin's own settings).
 *
 * Two BB buttons (Wide + Tight) — each toggles its own scene's zoom state
 * independently. Move plugin handles the frame-perfect interpolation natively
 * at OBS render rate.
 *
 * If the configured transition or scene names don't exist in OBS, calls fail
 * soft with a warning — operator just hasn't completed the OBS-side setup yet.
 *
 * Ported from CompSyncElectronApp/src/main/services/slowZoom.ts (2026-05-15).
 */

import * as obs from './obsConnection'
import { getSettings } from './settings'
import { createLogger } from '../logger'
import { DEFAULT_SLOW_ZOOM, SlowZoomStatus } from '../../shared/types'

const logger = createLogger('slowZoom')

let zoomedInWide = false
let zoomedInTight = false

let onStatusChangedCb: ((status: SlowZoomStatus) => void) | null = null
export function setOnStatusChanged(cb: (status: SlowZoomStatus) => void): void {
  onStatusChangedCb = cb
}

function emitStatus(): void {
  if (!onStatusChangedCb) return
  try { onStatusChangedCb(getStatus()) } catch (err) {
    logger.warn(`onStatusChanged callback threw: ${err instanceof Error ? err.message : err}`)
  }
}

export function getStatus(): SlowZoomStatus {
  return { wideZoomedIn: zoomedInWide, tightZoomedIn: zoomedInTight }
}

async function trigger(
  label: 'wide' | 'tight',
  baseScene: string,
  zoomedScene: string,
  isZoomed: boolean,
): Promise<boolean> {
  if (!obs.isConnected()) {
    logger.warn(`Slow zoom (${label}): OBS not connected`)
    return isZoomed
  }
  const settings = getSettings()
  const sz = settings.slowZoom ?? DEFAULT_SLOW_ZOOM
  const transition = sz.transitionName || DEFAULT_SLOW_ZOOM.transitionName
  const durationMs = sz.durationMs || DEFAULT_SLOW_ZOOM.durationMs
  const target = isZoomed ? baseScene : zoomedScene
  try {
    // Order matters: pick the transition first, then set its duration, then
    // cut to the scene. OBS stores transition_duration globally per-current-
    // transition, so without the explicit duration set the Move plugin uses
    // whatever was last assigned (often 2000ms for Cut/Fade) and the zoom
    // snaps instead of slow-panning.
    await obs.setCurrentTransitionByName(transition)
    await obs.setCurrentTransitionDuration(durationMs)
    await obs.setCurrentScene(target)
    const newState = !isZoomed
    logger.info(
      `Slow zoom (${label}): ${isZoomed ? 'OUT' : 'IN'} via "${transition}" (${durationMs}ms) → "${target}"`,
    )

    // Force-revert to Cut after the zoom completes. The Move Transition plugin
    // does not reliably fire SceneTransitionEnded, so the global auto-revert
    // in obsConnection.ts (which catches stinger/fade/wipe) cannot rescue us.
    // Without this, the next scene change after a slow zoom uses the 10s Slow
    // Zoom transition by mistake (CSE operator complaint 2026-05-15).
    const cutName = obs.getCutTransitionName()
    if (cutName) {
      setTimeout(() => {
        obs.setCurrentTransitionByName(cutName)
          .then(() => logger.info(`Slow zoom (${label}): reverted "${transition}" → "${cutName}"`))
          .catch((err) => logger.warn(`Slow zoom (${label}): revert to ${cutName} failed: ${err instanceof Error ? err.message : err}`))
      }, durationMs + 500)
    } else {
      logger.warn(`Slow zoom (${label}): no cut_transition found, leaving "${transition}" armed`)
    }
    return newState
  } catch (err) {
    logger.warn(`Slow zoom (${label}) failed: ${err instanceof Error ? err.message : err}`)
    return isZoomed
  }
}

export async function triggerWide(): Promise<SlowZoomStatus> {
  const settings = getSettings()
  const sz = settings.slowZoom ?? DEFAULT_SLOW_ZOOM
  const base = sz.wideBaseScene || DEFAULT_SLOW_ZOOM.wideBaseScene
  const zoomed = sz.wideZoomedScene || DEFAULT_SLOW_ZOOM.wideZoomedScene
  zoomedInWide = await trigger('wide', base, zoomed, zoomedInWide)
  emitStatus()
  return getStatus()
}

export async function triggerTight(): Promise<SlowZoomStatus> {
  const settings = getSettings()
  const sz = settings.slowZoom ?? DEFAULT_SLOW_ZOOM
  const base = sz.tightBaseScene || DEFAULT_SLOW_ZOOM.tightBaseScene
  const zoomed = sz.tightZoomedScene || DEFAULT_SLOW_ZOOM.tightZoomedScene
  zoomedInTight = await trigger('tight', base, zoomed, zoomedInTight)
  emitStatus()
  return getStatus()
}

/** Clear cached zoom flags — call on OBS (re)connect. */
export function reset(): void {
  zoomedInWide = false
  zoomedInTight = false
  emitStatus()
}

/**
 * Operator-friendly drift correction (ported 2026-05-15): when the operator
 * manually cuts to a scene OTHER than this camera's zoomed scene (different
 * camera, graphics scene, etc.) the cached zoom flag would stay stuck
 * "zoomed", so the next press toggled the wrong way and needed an extra
 * transition. Now we follow live program: if the current scene isn't this
 * camera's Zoomed scene, the flag resets to "not zoomed".
 */
export function onSceneChanged(sceneName: string | null): void {
  if (!sceneName) return
  const settings = getSettings()
  const sz = settings.slowZoom ?? DEFAULT_SLOW_ZOOM
  const wideZoomed = sz.wideZoomedScene || DEFAULT_SLOW_ZOOM.wideZoomedScene
  const tightZoomed = sz.tightZoomedScene || DEFAULT_SLOW_ZOOM.tightZoomedScene
  let changed = false
  if (sceneName !== wideZoomed && zoomedInWide) {
    zoomedInWide = false
    changed = true
    logger.info(`Slow zoom (wide): scene → "${sceneName}" (not "${wideZoomed}") — zoom state reset`)
  }
  if (sceneName !== tightZoomed && zoomedInTight) {
    zoomedInTight = false
    changed = true
    logger.info(`Slow zoom (tight): scene → "${sceneName}" (not "${tightZoomed}") — zoom state reset`)
  }
  if (changed) emitStatus()
}

/** Wire OBS hooks. Call once at startup. */
export function register(): void {
  obs.setOnSceneChanged(onSceneChanged)
  obs.onConnected(() => {
    // Stale cached zoom flags after a reconnect are guaranteed wrong — OBS
    // may have restarted with the operator on whichever scene they were on.
    reset()
  })
}
