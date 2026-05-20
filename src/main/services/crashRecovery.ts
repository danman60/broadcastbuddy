/**
 * Crash recovery — detect unclean shutdown and offer to restore last state.
 *
 * On launch we write a "dirty" marker file. A clean before-quit clears it. If
 * the marker is still present at the next launch the previous run crashed or
 * was force-quit. While running we persist a periodic snapshot of the
 * restorable state ({currentSessionId, triggers, overlayState}) so an unclean
 * restart can offer "Restore previous session?".
 *
 * Adapted from CompSyncElectronApp's dirty-flag / heartbeat pattern — BB's
 * restorable state is the overlay/session state (not CompSync recording/take).
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { Trigger, OverlayState } from '../../shared/types'
import { createLogger } from '../logger'
import { recordEvent } from './events'

const logger = createLogger('crashRecovery')

const SNAPSHOT_INTERVAL_MS = 30_000

interface RecoverySnapshot {
  savedAt: string // ISO
  currentSessionId: string | null
  currentSessionName: string | null
  triggers: Trigger[]
  overlayState: OverlayState
}

export interface RecoveryStatus {
  available: boolean
  triggerCount: number
  sessionName: string | null
  lastActive: string | null // ISO
}

let dirtyPath: string | null = null
let snapshotPath: string | null = null
let snapshotTimer: NodeJS.Timeout | null = null
let snapshotProvider: (() => RecoverySnapshot | null) | null = null
let pendingSnapshot: RecoverySnapshot | null = null

function getDirtyPath(): string {
  if (!dirtyPath) dirtyPath = path.join(app.getPath('userData'), 'session.dirty')
  return dirtyPath
}

function getSnapshotPath(): string {
  if (!snapshotPath) snapshotPath = path.join(app.getPath('userData'), 'recovery-snapshot.json')
  return snapshotPath
}

/** Source of the live restorable state — wired from index.ts. */
export function setSnapshotProvider(fn: () => RecoverySnapshot | null): void {
  snapshotProvider = fn
}

export type { RecoverySnapshot }

/** Write the dirty marker at launch. */
export function markDirty(): void {
  try {
    fs.writeFileSync(getDirtyPath(), new Date().toISOString(), 'utf-8')
  } catch (err) {
    logger.warn(`Failed to write dirty marker: ${err instanceof Error ? err.message : err}`)
  }
}

/** Clear the dirty marker on clean before-quit. */
export function clearDirty(): void {
  try {
    fs.rmSync(getDirtyPath(), { force: true })
  } catch (err) {
    logger.warn(`Failed to clear dirty marker: ${err instanceof Error ? err.message : err}`)
  }
}

function writeSnapshot(): void {
  if (!snapshotProvider) return
  let snap: RecoverySnapshot | null = null
  try {
    snap = snapshotProvider()
  } catch (err) {
    logger.warn(`Snapshot provider threw: ${err instanceof Error ? err.message : err}`)
    return
  }
  if (!snap) return
  // Skip empty snapshots — nothing worth restoring.
  if (!snap.triggers.length && !snap.currentSessionId) return
  try {
    fs.writeFileSync(getSnapshotPath(), JSON.stringify(snap), 'utf-8')
  } catch (err) {
    logger.warn(`Failed to write snapshot: ${err instanceof Error ? err.message : err}`)
  }
}

/** Start the periodic snapshot loop. */
export function startSnapshots(): void {
  if (snapshotTimer) return
  snapshotTimer = setInterval(writeSnapshot, SNAPSHOT_INTERVAL_MS)
  if (snapshotTimer.unref) snapshotTimer.unref()
}

export function stopSnapshots(): void {
  if (snapshotTimer) {
    clearInterval(snapshotTimer)
    snapshotTimer = null
  }
}

/**
 * Detect an unclean shutdown. If the dirty marker survived and a non-empty
 * snapshot exists, load it into `pendingSnapshot` so the renderer can offer a
 * restore. Always (re)writes a fresh dirty marker for the current run.
 */
export function checkAndRecover(): RecoveryStatus {
  const dirty = fs.existsSync(getDirtyPath())
  // (Re)arm the marker for this run regardless of what we found.
  markDirty()

  if (!dirty) {
    discardSnapshot()
    return { available: false, triggerCount: 0, sessionName: null, lastActive: null }
  }

  let snap: RecoverySnapshot | null = null
  try {
    if (fs.existsSync(getSnapshotPath())) {
      snap = JSON.parse(fs.readFileSync(getSnapshotPath(), 'utf-8')) as RecoverySnapshot
    }
  } catch (err) {
    logger.warn(`Failed to read snapshot: ${err instanceof Error ? err.message : err}`)
  }

  if (!snap || (!snap.triggers?.length && !snap.currentSessionId)) {
    pendingSnapshot = null
    return { available: false, triggerCount: 0, sessionName: null, lastActive: null }
  }

  pendingSnapshot = snap
  logger.info(`Unclean shutdown detected — snapshot available (${snap.triggers?.length || 0} triggers)`)
  recordEvent('system', 'Unclean shutdown detected — recovery snapshot available', {
    triggerCount: snap.triggers?.length || 0,
    sessionName: snap.currentSessionName,
  })
  return {
    available: true,
    triggerCount: snap.triggers?.length || 0,
    sessionName: snap.currentSessionName,
    lastActive: snap.savedAt,
  }
}

export function getPendingSnapshot(): RecoverySnapshot | null {
  return pendingSnapshot
}

export function discardSnapshot(): void {
  pendingSnapshot = null
  try {
    fs.rmSync(getSnapshotPath(), { force: true })
  } catch { /* best-effort */ }
}
