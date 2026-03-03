import { ipcMain, dialog, BrowserWindow } from 'electron'
import fs from 'fs'
import { IPC, Trigger, OverlayStyling } from '../shared/types'
import * as overlay from './services/overlay'
import * as session from './services/session'
import * as settings from './services/settings'
import { broadcastState } from './services/wsHub'
import { createLogger } from './logger'

const logger = createLogger('ipc')

function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows()
  return windows.length > 0 ? windows[0] : null
}

function pushState(): void {
  const win = getMainWindow()
  if (win) {
    win.webContents.send(IPC.OVERLAY_STATE_UPDATE, overlay.getOverlayState())
    win.webContents.send(IPC.TRIGGERS_UPDATED, overlay.getTriggers(), overlay.getSelectedIndex())
  }
}

export function registerIpcHandlers(): void {
  // ── Overlay control ──────────────────────────────────────────

  ipcMain.handle(IPC.OVERLAY_FIRE_LT, () => {
    overlay.fireLowerThird()
    pushState()
  })

  ipcMain.handle(IPC.OVERLAY_HIDE_LT, () => {
    overlay.hideLowerThird()
    pushState()
  })

  ipcMain.handle(IPC.OVERLAY_GET_STATE, () => {
    return overlay.getOverlayState()
  })

  ipcMain.handle(IPC.OVERLAY_UPDATE_STYLING, (_e, updates: Partial<OverlayStyling>) => {
    overlay.updateStyling(updates)
    pushState()
  })

  ipcMain.handle(IPC.OVERLAY_SET_LOGOS, (_e, company: string, client: string) => {
    overlay.setCompanyLogo(company)
    overlay.setClientLogo(client)
    pushState()
  })

  // ── Trigger management ────────────────────────────────────────

  ipcMain.handle(IPC.TRIGGER_LIST, () => {
    return { triggers: overlay.getTriggers(), selectedIndex: overlay.getSelectedIndex() }
  })

  ipcMain.handle(IPC.TRIGGER_ADD, (_e, trigger: Trigger) => {
    overlay.addTrigger(trigger)
    pushState()
    return overlay.getTriggers()
  })

  ipcMain.handle(IPC.TRIGGER_UPDATE, (_e, id: string, updates: Partial<Trigger>) => {
    overlay.updateTrigger(id, updates)
    pushState()
    return overlay.getTriggers()
  })

  ipcMain.handle(IPC.TRIGGER_DELETE, (_e, id: string) => {
    overlay.deleteTrigger(id)
    pushState()
    return overlay.getTriggers()
  })

  ipcMain.handle(IPC.TRIGGER_REORDER, (_e, ids: string[]) => {
    overlay.reorderTriggers(ids)
    pushState()
    return overlay.getTriggers()
  })

  ipcMain.handle(IPC.TRIGGER_SELECT, (_e, index: number) => {
    overlay.selectTrigger(index)
    pushState()
  })

  ipcMain.handle(IPC.TRIGGER_NEXT, () => {
    overlay.nextTrigger()
    pushState()
  })

  ipcMain.handle(IPC.TRIGGER_PREV, () => {
    overlay.prevTrigger()
    pushState()
  })

  // ── Session management ────────────────────────────────────────

  ipcMain.handle(IPC.SESSION_NEW, (_e, name: string) => {
    const s = session.newSession(name)
    overlay.resetState()
    pushState()
    return s
  })

  ipcMain.handle(IPC.SESSION_SAVE, () => {
    const s = session.saveSession(
      overlay.getTriggers(),
      overlay.getStyling(),
      overlay.getOverlayState().companyLogo.dataUrl,
      overlay.getOverlayState().clientLogo.dataUrl,
    )
    return s
  })

  ipcMain.handle(IPC.SESSION_LOAD, (_e, id: string) => {
    const s = session.loadSession(id)
    if (s) {
      overlay.loadSessionState(s.triggers, s.styling, s.companyLogoDataUrl, s.clientLogoDataUrl)
      pushState()
    }
    return s
  })

  ipcMain.handle(IPC.SESSION_LIST, () => {
    return session.listSessions()
  })

  ipcMain.handle(IPC.SESSION_GET_CURRENT, () => {
    return session.getCurrentSession()
  })

  // ── Settings ──────────────────────────────────────────────────

  ipcMain.handle(IPC.SETTINGS_GET, () => {
    return settings.getAll()
  })

  ipcMain.handle(IPC.SETTINGS_SET, (_e, key: string, value: unknown) => {
    settings.set(key as keyof import('../shared/types').AppSettings, value as never)
    return settings.getAll()
  })

  ipcMain.handle(IPC.SETTINGS_BROWSE_FILE, async (_e, filters?: Electron.FileFilter[]) => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: filters || [{ name: 'All Files', extensions: ['*'] }],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // ── Logo browse + convert to data URL ─────────────────────────

  ipcMain.handle(IPC.LOGO_BROWSE, async () => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return null

    const filePath = result.filePaths[0]
    try {
      const buffer = fs.readFileSync(filePath)
      const ext = filePath.split('.').pop()?.toLowerCase() || 'png'
      const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`
      return `data:${mime};base64,${buffer.toString('base64')}`
    } catch (err) {
      logger.error('Failed to read logo file:', err)
      return null
    }
  })

  logger.info('IPC handlers registered')
}
