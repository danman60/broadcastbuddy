// Shared main-window and dock recovery actions. Preview and restore use the same
// prepared state so the position on the button is the position actually resumed.
import { BrowserWindow } from 'electron'
import { IPC, type RecoveryStatus, type Session } from '../../shared/types'
import * as recovery from './crashRecovery'
import * as session from './session'
import * as overlay from './overlay'
import { recordEvent } from './events'

let prepared: { snapshot: recovery.RecoverySnapshot; saved: Session | null } | null = null
let onChanged: (() => void) | null = null
export function setOnRecoveryChanged(cb: () => void): void { onChanged = cb }

function pending() {
  const snapshot = recovery.getPendingSnapshot()
  if (!snapshot) { prepared = null; return null }
  if (prepared?.snapshot !== snapshot) {
    prepared = { snapshot, saved: snapshot.currentSessionId ? session.readSession(snapshot.currentSessionId) : null }
  }
  return prepared
}

export function getRecoveryStatus(): RecoveryStatus {
  const p = pending()
  if (!p) return { available: false, triggerCount: 0, performer: 0, sessionName: null, lastActive: null }
  const source = p.saved ?? p.snapshot
  const count = source.triggers?.length || 0
  const index = source.selectedIndex
  const validIndex = typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < count
  return {
    available: true, triggerCount: count,
    performer: count ? (validIndex ? index : 0) + 1 : 0,
    sessionName: p.saved?.name ?? p.snapshot.currentSessionName,
    lastActive: p.snapshot.savedAt,
  }
}

function notify(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.RECOVERY_CHECK, getRecoveryStatus())
      win.webContents.send(IPC.SESSION_UPDATED, session.getCurrentSession())
    }
  }
  onChanged?.()
}

export function restoreRecovery(): { restored: boolean } {
  const p = pending()
  if (!p) return { restored: false }
  const { saved, snapshot: snap } = p
  const selectedIndex = (getRecoveryStatus().performer ?? 0) - 1
  if (saved) {
    session.setCurrentSession(saved)
    overlay.loadSessionState(saved.triggers, saved.styling, saved.companyLogoDataUrl, saved.clientLogoDataUrl,
      selectedIndex, saved.playedIds, saved.loopMode, saved.notes, saved.streamConfig)
  } else if (snap.triggers?.length && snap.overlayState?.lowerThird?.styling) {
    // Adopt a fresh session BEFORE loading state so auto-save cannot overwrite the boot session.
    session.newSession(snap.currentSessionName ? `${snap.currentSessionName} (recovered)` : 'Recovered session')
    overlay.loadSessionState(snap.triggers, snap.overlayState.lowerThird.styling,
      snap.overlayState.companyLogo.dataUrl, snap.overlayState.clientLogo.dataUrl,
      selectedIndex, snap.playedIds, snap.loopMode)
  } else {
    return { restored: false } // keep the prompt available for an explicit dismiss
  }
  recordEvent('system', 'Previous session restored after unclean shutdown')
  recovery.discardSnapshot()
  notify()
  return { restored: true }
}

export function dismissRecovery(): { ok: boolean } {
  recovery.discardSnapshot()
  notify()
  return { ok: true }
}
