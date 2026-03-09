import { ipcMain, dialog, BrowserWindow } from 'electron'
import fs from 'fs'
import { IPC, Trigger, OverlayStyling, LoopMode, StreamConfig, StartingSoonState } from '../shared/types'
import * as overlay from './services/overlay'
import * as session from './services/session'
import * as settings from './services/settings'
import * as documentImport from './services/documentImport'
import * as brandScraper from './services/brandScraper'
import * as obsConnection from './services/obsConnection'
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
    win.webContents.send(
      IPC.TRIGGERS_UPDATED,
      overlay.getTriggers(),
      overlay.getSelectedIndex(),
      overlay.getPlayedSet(),
      overlay.getLoopMode(),
    )
  }
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
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

  ipcMain.handle(IPC.TRIGGER_NEXT_FULL, () => {
    overlay.nextTriggerFull()
    pushState()
  })

  ipcMain.handle(IPC.TRIGGER_SET_LOGO, async (_e, id: string) => {
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
      const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`
      overlay.updateTrigger(id, { logoDataUrl: dataUrl })
      pushState()
      return dataUrl
    } catch (err) {
      logger.error('Failed to read trigger logo:', err)
      return null
    }
  })

  // ── Playlist ──────────────────────────────────────────────────

  ipcMain.handle(IPC.PLAYLIST_AUTO_FIRE, () => {
    const enabled = overlay.toggleAutoFire()
    return enabled
  })

  ipcMain.handle(IPC.PLAYLIST_GET_STATUS, () => {
    return overlay.getPlaylistStatus()
  })

  ipcMain.handle(IPC.PLAYLIST_SET_LOOP_MODE, (_e, mode: LoopMode) => {
    overlay.setLoopMode(mode)
    pushState()
  })

  ipcMain.handle(IPC.PLAYLIST_RESET_POSITION, () => {
    overlay.resetPosition()
    pushState()
  })

  ipcMain.handle(IPC.PLAYLIST_CLEAR_PLAYED, () => {
    overlay.clearPlayed()
    pushState()
  })

  ipcMain.handle(IPC.TRIGGER_CLEAR_ALL, () => {
    overlay.clearAllTriggers()
    pushState()
  })

  // ── Session management ────────────────────────────────────────

  ipcMain.handle(IPC.SESSION_NEW, (_e, name: string, preserveTriggers?: boolean) => {
    const s = session.newSession(name)
    if (preserveTriggers) {
      // Keep existing triggers, just update session reference
      session.setCurrentSession(s)
    } else {
      // Fresh session - clear everything
      overlay.resetState()
    }
    pushState()
    return s
  })

  ipcMain.handle(IPC.SESSION_SAVE, () => {
    const s = session.saveSession(
      overlay.getTriggers(),
      overlay.getStyling(),
      overlay.getOverlayState().companyLogo.dataUrl,
      overlay.getOverlayState().clientLogo.dataUrl,
      overlay.getSelectedIndex(),
      overlay.getPlayedSet(),
      overlay.getLoopMode(),
      overlay.getNotes(),
      overlay.getStreamConfig(),
    )
    return s
  })

  ipcMain.handle(IPC.SESSION_LOAD, (_e, id: string) => {
    const s = session.loadSession(id)
    if (s) {
      overlay.loadSessionState(
        s.triggers,
        s.styling,
        s.companyLogoDataUrl,
        s.clientLogoDataUrl,
        s.selectedIndex,
        s.playedIds,
        s.loopMode,
        s.notes,
        s.streamConfig,
      )
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

  // ── Ticker ─────────────────────────────────────────────────────

  ipcMain.handle(IPC.TICKER_SHOW, (_e, text: string, speed?: number, bgColor?: string, textColor?: string) => {
    overlay.showTicker(text, speed, bgColor, textColor)
    pushState()
  })

  ipcMain.handle(IPC.TICKER_HIDE, () => {
    overlay.hideTicker()
    pushState()
  })

  ipcMain.handle(IPC.TICKER_UPDATE, (_e, updates: Partial<import('../shared/types').OverlayState['ticker']>) => {
    overlay.updateTicker(updates)
    pushState()
  })

  // ── Stream Config ──────────────────────────────────────────────

  ipcMain.handle(IPC.STREAM_CONFIG_GET, () => {
    return overlay.getStreamConfig()
  })

  ipcMain.handle(IPC.STREAM_CONFIG_SET, (_e, config: StreamConfig) => {
    overlay.setStreamConfig(config)
    // Also persist to settings
    settings.set('streamConfig', config)
  })

  // ── Notes ──────────────────────────────────────────────────────

  ipcMain.handle(IPC.NOTES_LIST, () => {
    return overlay.getNotes()
  })

  ipcMain.handle(IPC.NOTES_ADD, async (_e, text: string) => {
    const timecode = await obsConnection.getRecordTimecode()
    const note = {
      id: generateId(),
      text,
      timestamp: new Date().toISOString(),
      obsTimecode: timecode,
      createdAt: new Date().toISOString(),
    }
    overlay.addNote(note)
    return note
  })

  ipcMain.handle(IPC.NOTES_DELETE, (_e, id: string) => {
    overlay.deleteNote(id)
  })

  // ── OBS Connection ─────────────────────────────────────────────

  ipcMain.handle(IPC.OBS_CONNECT, async (_e, host: string, port: number, password?: string) => {
    try {
      await obsConnection.connect(host, port, password)
      return { connected: true }
    } catch (err) {
      return { connected: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.OBS_DISCONNECT, () => {
    obsConnection.disconnect()
    return { connected: false }
  })

  ipcMain.handle(IPC.OBS_STATUS, () => {
    return { connected: obsConnection.isConnected() }
  })

  ipcMain.handle(IPC.OBS_GET_TIMECODE, async () => {
    return obsConnection.getRecordTimecode()
  })

  ipcMain.handle(IPC.OBS_PUSH_STREAM_KEY, async (_e, rtmpUrl: string, streamKey: string) => {
    try {
      await obsConnection.sendRequest('SetStreamServiceSettings', {
        streamServiceType: 'rtmp_custom',
        streamServiceSettings: {
          server: rtmpUrl,
          key: streamKey,
        },
      })
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // ── Starting Soon ──────────────────────────────────────────────

  ipcMain.handle(IPC.STARTING_SOON_SHOW, () => {
    overlay.showStartingSoon()
    pushState()
    broadcastState()
  })

  ipcMain.handle(IPC.STARTING_SOON_HIDE, () => {
    overlay.hideStartingSoon()
    pushState()
    broadcastState()
  })

  ipcMain.handle(IPC.STARTING_SOON_UPDATE, (_e, updates: Partial<StartingSoonState>) => {
    overlay.updateStartingSoon(updates)
    pushState()
    broadcastState()
  })

  // ── Document import ────────────────────────────────────────────

  ipcMain.handle(IPC.IMPORT_BROWSE, async () => {
    return documentImport.browseDocument()
  })

  ipcMain.handle(IPC.IMPORT_PREVIEW, async (_e, filePath: string) => {
    return documentImport.parseAndPreview(filePath)
  })

  ipcMain.handle(IPC.IMPORT_DOCUMENT, async (_e, filePath?: string) => {
    // Parse only — return triggers for review without adding them
    const result = await documentImport.importDocument(filePath)
    return result
  })

  // ── Brand scraper ──────────────────────────────────────────────

  ipcMain.handle(IPC.BRAND_SCRAPE, async (_e, url: string) => {
    return brandScraper.scrapeWebsite(url)
  })

  ipcMain.handle(IPC.BRAND_SCRAPE_AI, async (_e, url: string) => {
    return brandScraper.scrapeWithAI(url)
  })

  // ── Window ────────────────────────────────────────────────────

  ipcMain.handle(IPC.WINDOW_RESIZE, (_e, width: number, height: number) => {
    const win = getMainWindow()
    if (win) {
      win.setSize(width, height)
    }
  })

  logger.info('IPC handlers registered')
}
