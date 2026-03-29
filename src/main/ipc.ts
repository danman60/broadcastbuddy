import { ipcMain, dialog, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import { IPC, Trigger, OverlayStyling, LoopMode, StreamConfig, StartingSoonState, BroadcastPackage } from '../shared/types'
import * as overlay from './services/overlay'
import * as session from './services/session'
import * as settings from './services/settings'
import * as documentImport from './services/documentImport'
import * as brandScraper from './services/brandScraper'
import * as obsConnection from './services/obsConnection'
import * as galleryService from './services/galleryService'
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

  // ── Command Center broadcast package ──────────────────────────

  ipcMain.handle(IPC.CC_FETCH_EVENTS, async (_e, baseUrl: string, apiKey: string, tenantId: string) => {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/api/v1/broadcast-package`
      const res = await fetch(url, {
        headers: { 'X-API-Key': apiKey, 'X-Tenant-Id': tenantId },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      return { success: true, events: await res.json() }
    } catch (err) {
      return { success: false, error: (err as Error).message, events: [] }
    }
  })

  ipcMain.handle(IPC.CC_FETCH_PACKAGE, async (_e, baseUrl: string, apiKey: string, tenantId: string, eventId: string) => {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/api/v1/broadcast-package/${eventId}`
      const res = await fetch(url, {
        headers: { 'X-API-Key': apiKey, 'X-Tenant-Id': tenantId },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      const body = await res.json()
      // CC wraps in { success, data }
      return { success: true, package: body.data || body }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.CC_APPLY_PACKAGE, async (_e, pkg: BroadcastPackage, eventId?: string) => {
    // Convert CC triggers to BB triggers, fetching logos in parallel
    const newTriggers: Trigger[] = await Promise.all(
      pkg.triggers.map(async (t, i) => {
        let logoDataUrl = ''
        if (t.logoUrl) {
          try {
            const res = await fetch(t.logoUrl)
            if (res.ok) {
              const buffer = Buffer.from(await res.arrayBuffer())
              const contentType = res.headers.get('content-type') || 'image/png'
              logoDataUrl = `data:${contentType};base64,${buffer.toString('base64')}`
            }
          } catch {
            // Skip failed logo fetches
          }
        }
        return {
          id: generateId() + i,
          name: t.name,
          title: t.name,
          subtitle: t.subtitle || '',
          category: t.shiftName || (t.type === 'title_card' ? 'Title' : ''),
          order: i,
          logoDataUrl,
        }
      })
    )

    // Apply triggers
    overlay.clearAllTriggers()
    for (const t of newTriggers) {
      overlay.addTrigger(t)
    }

    // Apply stream config if any streaming field is present
    if (pkg.streaming.streamKey || pkg.streaming.rtmpUrl || pkg.streaming.livestreamUrl || pkg.streaming.embedCode) {
      overlay.setStreamConfig({
        streamKey: pkg.streaming.streamKey || '',
        rtmpUrl: pkg.streaming.rtmpUrl || '',
        viewingLink: pkg.streaming.livestreamUrl || '',
        embedCode: pkg.streaming.embedCode || '',
        chatLink: '',
      })
    }

    // Apply company logo if available
    if (pkg.company?.logoUrl) {
      try {
        const res = await fetch(pkg.company.logoUrl)
        if (res.ok) {
          const buffer = Buffer.from(await res.arrayBuffer())
          const contentType = res.headers.get('content-type') || 'image/png'
          const dataUrl = `data:${contentType};base64,${buffer.toString('base64')}`
          overlay.setCompanyLogo(dataUrl)
        }
      } catch {
        // Skip failed logo fetch
      }
    }

    // Apply client logo if available
    if (pkg.client.logoUrl) {
      try {
        const res = await fetch(pkg.client.logoUrl)
        if (res.ok) {
          const buffer = Buffer.from(await res.arrayBuffer())
          const contentType = res.headers.get('content-type') || 'image/png'
          const dataUrl = `data:${contentType};base64,${buffer.toString('base64')}`
          overlay.setClientLogo(dataUrl)
        }
      } catch {
        // Skip failed logo fetch
      }
    }

    // Apply brand color as accent if available
    if (pkg.client.brandColor) {
      overlay.updateStyling({ accentColor: pkg.client.brandColor })
    }

    // Apply company primary color if no brand color
    if (!pkg.client.brandColor && pkg.company?.primaryColor) {
      overlay.updateStyling({ accentColor: pkg.company.primaryColor })
    }

    // Apply saved overlay config if present
    if (pkg.overlayConfig) {
      const oc = pkg.overlayConfig as Record<string, unknown>
      const stylingUpdates: Partial<import('../shared/types').OverlayStyling> = {}
      if (oc.fontFamily) stylingUpdates.fontFamily = oc.fontFamily as string
      if (oc.fontSize) stylingUpdates.fontSize = oc.fontSize as number
      if (oc.textColor) stylingUpdates.textColor = oc.textColor as string
      if (oc.backgroundColor) stylingUpdates.backgroundColor = oc.backgroundColor as string
      if (oc.backgroundStyle) stylingUpdates.backgroundStyle = oc.backgroundStyle as import('../shared/types').BackgroundStyle
      if (oc.accentColor) stylingUpdates.accentColor = oc.accentColor as string
      if (oc.borderRadius) stylingUpdates.borderRadius = oc.borderRadius as number
      if (oc.animation) stylingUpdates.animation = oc.animation as import('../shared/types').AnimationType
      if (oc.animationDuration) stylingUpdates.animationDuration = oc.animationDuration as number
      if (oc.autoHideSeconds) stylingUpdates.autoHideSeconds = oc.autoHideSeconds as number
      if (Object.keys(stylingUpdates).length > 0) {
        overlay.updateStyling(stylingUpdates)
      }
    }

    pushState()

    // Push recording upload context + checklist to renderer
    const win = getMainWindow()
    if (win) {
      const folderUrl = pkg.drive?.eventFolderUrl || pkg.drive?.clientFolderUrl || null
      win.webContents.send('cc:recording-context', pkg.eventId || eventId || '', pkg.event.eventName, folderUrl)
      win.webContents.send('cc:checklist-update', pkg.checklist || [])
      win.webContents.send('cc:package-applied', {
        eventId: pkg.eventId || eventId,
        eventName: pkg.event.eventName,
        company: pkg.company,
        version: pkg.version,
      })
    }

    return { success: true, triggerCount: newTriggers.length }
  })

  ipcMain.handle(IPC.CC_UPLOAD_RECORDING, async (_e, baseUrl: string, apiKey: string, tenantId: string, eventId: string, filePath: string, fileName?: string) => {
    try {
      const fileBuffer = fs.readFileSync(filePath)
      const ext = path.extname(filePath).toLowerCase()
      const mimeMap: Record<string, string> = {
        '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo', '.flv': 'video/x-flv', '.ts': 'video/mp2t', '.webm': 'video/webm',
      }
      const mime = mimeMap[ext] || 'video/mp4'
      const name = fileName || path.basename(filePath)

      const formData = new FormData()
      formData.append('file', new Blob([fileBuffer], { type: mime }), name)
      formData.append('eventId', eventId)
      if (fileName) formData.append('fileName', fileName)

      const url = `${baseUrl.replace(/\/$/, '')}/api/v1/broadcast-package/upload`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'X-API-Key': apiKey, 'X-Tenant-Id': tenantId },
        body: formData,
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      const body = await res.json()
      return { success: true, ...body }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // ── CC Checklist sync ────────────────────────────────────────────

  ipcMain.handle(IPC.CC_FETCH_CHECKLIST, async (_e, baseUrl: string, apiKey: string, tenantId: string, eventId: string) => {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/api/v1/broadcast-package/${eventId}/checklist`
      const res = await fetch(url, {
        headers: { 'X-API-Key': apiKey, 'X-Tenant-Id': tenantId },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      const body = await res.json()
      return { success: true, checklist: body.data || [] }
    } catch (err) {
      return { success: false, error: (err as Error).message, checklist: [] }
    }
  })

  ipcMain.handle(IPC.CC_SYNC_CHECKLIST, async (_e, baseUrl: string, apiKey: string, tenantId: string, eventId: string, items: Array<{ id: string; checked: boolean }>) => {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/api/v1/broadcast-package/${eventId}/checklist`
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          'X-API-Key': apiKey,
          'X-Tenant-Id': tenantId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ items }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      const body = await res.json()
      return { success: true, updated: body.updated }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.CC_SAVE_OVERLAY_CONFIG, async (_e, baseUrl: string, apiKey: string, tenantId: string, eventId: string, config: Record<string, unknown>) => {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/api/v1/broadcast-package/${eventId}/overlay-config`
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          'X-API-Key': apiKey,
          'X-Tenant-Id': tenantId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.OBS_GET_LAST_RECORDING, async () => {
    try {
      const result = await obsConnection.sendRequest('GetLastReplayBufferReplay') as { savedReplayPath?: string } | null
      if (result?.savedReplayPath) return { success: true, path: result.savedReplayPath }
      // Try GetRecordDirectory for the latest file
      const dirResult = await obsConnection.sendRequest('GetRecordDirectory') as { recordDirectory?: string } | null
      if (dirResult?.recordDirectory) {
        // Find most recent video file in directory
        const dir = dirResult.recordDirectory
        try {
          const files = fs.readdirSync(dir)
            .filter(f => /\.(mp4|mkv|mov|flv|ts|webm|avi)$/i.test(f))
            .map(f => ({ name: f, time: fs.statSync(path.join(dir, f)).mtime.getTime() }))
            .sort((a, b) => b.time - a.time)
          if (files.length > 0) {
            return { success: true, path: path.join(dir, files[0].name) }
          }
        } catch { /* ignore directory read errors */ }
      }
      return { success: false, error: 'No recording found' }
    } catch {
      return { success: false, error: 'OBS not connected or no recording available' }
    }
  })

  ipcMain.handle(IPC.RECORDING_BROWSE, async () => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Video Files', extensions: ['mp4', 'mkv', 'mov', 'flv', 'ts', 'webm', 'avi'] }],
    })
    return result.canceled ? null : result.filePaths[0]
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

  // ── Gallery / Photo Sorting ──────────────────────────────────

  // Wire progress events to renderer
  galleryService.setProgressCallback((progress) => {
    const win = getMainWindow()
    if (win) {
      win.webContents.send(IPC.GALLERY_PROGRESS, progress)
    }
  })

  ipcMain.handle(IPC.GALLERY_BROWSE_VIDEO, async () => {
    return galleryService.browseVideo()
  })

  ipcMain.handle(IPC.GALLERY_BROWSE_PHOTOS, async () => {
    return galleryService.browsePhotoFolder()
  })

  ipcMain.handle(IPC.GALLERY_ANALYZE_VIDEO, async (_e, videoPath: string, geminiApiKey: string) => {
    try {
      const triggers = overlay.getTriggers()
      const boundaries = await galleryService.analyzeVideo(videoPath, triggers, geminiApiKey)
      return { success: true, boundaries }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.GALLERY_READ_EXIF, async (_e, folderPath?: string) => {
    try {
      const photos = await galleryService.readExifTimestamps(folderPath)
      return { success: true, count: photos.length }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.GALLERY_MATCH_PHOTOS, async (_e, manualOffsetMs?: number) => {
    try {
      if (manualOffsetMs !== undefined) {
        galleryService.setManualOffset(manualOffsetMs)
      }
      const matches = await galleryService.rematchWithOffset()
      const matched = matches.filter((m) => m.confidence !== 'unmatched').length
      return { success: true, matched, unmatched: matches.length - matched, matches }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.GALLERY_SET_OFFSET, (_e, offsetMs: number) => {
    galleryService.setManualOffset(offsetMs)
  })

  ipcMain.handle(IPC.GALLERY_GET_CONFIG, () => {
    return galleryService.getConfig()
  })

  ipcMain.handle(IPC.GALLERY_UPLOAD_TO_CC, async (_e, title: string) => {
    try {
      const cc = settings.get('ccConfig') as { baseUrl: string; apiKey: string; tenantId: string } | undefined
      if (!cc?.baseUrl || !cc?.apiKey || !cc?.tenantId) {
        throw new Error('Command Center not configured. Set CC connection in Settings.')
      }
      const config = galleryService.getConfig()
      if (!config.eventId) {
        throw new Error('No event linked. Apply a CC broadcast package first.')
      }
      const result = await galleryService.uploadToCC(cc.baseUrl, cc.apiKey, cc.tenantId, config.eventId, title)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  logger.info('IPC handlers registered')
}
