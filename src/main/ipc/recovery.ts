import { ipcMain } from 'electron'
import { IPC } from '../../shared/types'
import * as overlay from '../services/overlay'
import * as session from '../services/session'
import * as events from '../services/events'
import * as crashRecovery from '../services/crashRecovery'
import * as backup from '../services/backup'
import { getLastStartupReport } from '../services/startup'
import { broadcastState } from '../services/wsHub'
import { pushState } from './common'

export function registerRecoveryHandlers(): void {

  // ── Crash recovery ────────────────────────────────────────────

  ipcMain.handle(IPC.RECOVERY_CHECK, () => {
    // Re-derive status from the pending snapshot (checkAndRecover already ran
    // at startup; this just exposes it on demand without re-arming the marker).
    const snap = crashRecovery.getPendingSnapshot()
    if (!snap) return { available: false, triggerCount: 0, sessionName: null, lastActive: null }
    return {
      available: true,
      triggerCount: snap.triggers?.length || 0,
      sessionName: snap.currentSessionName,
      lastActive: snap.savedAt,
    }
  })

  ipcMain.handle(IPC.RECOVERY_RESTORE, () => {
    const snap = crashRecovery.getPendingSnapshot()
    if (!snap) return { restored: false }
    // Prefer reloading the saved session file (authoritative) if it still
    // exists; fall back to the in-snapshot triggers/state otherwise.
    let restored = false
    if (snap.currentSessionId) {
      const s = session.loadSession(snap.currentSessionId)
      if (s) {
        overlay.loadSessionState(
          s.triggers, s.styling, s.companyLogoDataUrl, s.clientLogoDataUrl,
          s.selectedIndex, s.playedIds, s.loopMode, s.notes, s.streamConfig,
        )
        restored = true
      }
    }
    if (!restored && snap.triggers?.length) {
      const st = snap.overlayState.lowerThird.styling
      // The saved session file is gone — adopt a FRESH session to hold the
      // recovered triggers BEFORE loading them, so the debounced auto-save
      // persists them into their own file. Without this, currentSession would
      // still point at the session auto-loaded on boot (index.ts step 12b) and
      // the next edit would overwrite that unrelated session with recovered data.
      session.newSession(snap.currentSessionName ? `${snap.currentSessionName} (recovered)` : 'Recovered session')
      overlay.loadSessionState(
        snap.triggers, st,
        snap.overlayState.companyLogo.dataUrl, snap.overlayState.clientLogo.dataUrl,
      )
      restored = true
    }
    if (restored) {
      events.recordEvent('system', 'Previous session restored after unclean shutdown')
      pushState()
      broadcastState()
    }
    crashRecovery.discardSnapshot()
    return { restored }
  })

  ipcMain.handle(IPC.RECOVERY_DISMISS, () => {
    crashRecovery.discardSnapshot()
    return { ok: true }
  })

  // ── Startup checks ────────────────────────────────────────────

  ipcMain.handle(IPC.STARTUP_GET_REPORT, () => {
    return getLastStartupReport()
  })

  // ── Settings backup ───────────────────────────────────────────

  ipcMain.handle(IPC.BACKUP_NOW, () => {
    return backup.backupSettings()
  })

  ipcMain.handle(IPC.BACKUP_LIST, () => {
    return backup.listBackups()
  })

  ipcMain.handle(IPC.BACKUP_RESTORE, (_e, file: string) => {
    return backup.restoreBackup(file)
  })
}
