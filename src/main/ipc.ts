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
import * as wifiDisplay from './services/wifiDisplay'
import * as slowZoom from './services/slowZoom'
import * as chatBridge from './services/chatBridge'
import * as ccRelay from './services/ccRelay'
import * as events from './services/events'
import * as crashRecovery from './services/crashRecovery'
import * as backup from './services/backup'
import * as dayChecklist from './services/dayChecklist'
import { getItemsForKind } from './services/dayChecklistItems'
import { getLastStartupReport } from './services/startup'
import * as hotkeys from './services/hotkeys'
import * as systemMonitor from './services/systemMonitor'
import * as streamDeckPlugin from './services/streamDeckPlugin'
import { broadcastState } from './services/wsHub'
import { createLogger } from './logger'
import type { ChatConfig, EventLogKind, DayChecklistKind, DayChecklistItemState, DayChecklistView } from '../shared/types'

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

function pushLastAdhoc(): void {
  const win = getMainWindow()
  if (win) win.webContents.send(IPC.OVERLAY_LAST_ADHOC_UPDATE, overlay.getLastAdhoc())
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

  // ── Ad-hoc freeform lower-third (Phase D) ─────────────────────
  // Fire a one-off lower-third from arbitrary text. Does not touch the saved
  // triggers. Pushes the last-adhoc readout to the renderer + WS overlay.
  ipcMain.handle(IPC.OVERLAY_FIRE_ADHOC, (_e, title: string, subtitle?: string) => {
    overlay.fireAdhoc(typeof title === 'string' ? title : '', typeof subtitle === 'string' ? subtitle : '')
    pushState()
    pushLastAdhoc()
    broadcastState()
    return overlay.getLastAdhoc()
  })

  ipcMain.handle(IPC.OVERLAY_GET_LAST_ADHOC, () => {
    return overlay.getLastAdhoc()
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
    // Re-register global hotkeys immediately when the operator edits them.
    if (key === 'hotkeys') hotkeys.register()
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

  // ── OBS stream control + replay buffer (fail soft when disconnected) ──────
  ipcMain.handle(IPC.OBS_START_STREAM, async () => {
    if (!obsConnection.isConnected()) return { success: false, error: 'OBS not connected' }
    try { await obsConnection.startStreaming(); return { success: true } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle(IPC.OBS_STOP_STREAM, async () => {
    if (!obsConnection.isConnected()) return { success: false, error: 'OBS not connected' }
    try { await obsConnection.stopStreaming(); return { success: true } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle(IPC.OBS_SAVE_REPLAY, async () => {
    if (!obsConnection.isConnected()) return { success: false, error: 'OBS not connected' }
    try { await obsConnection.saveReplayBuffer(); return { success: true } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle(IPC.OBS_STREAM_STATUS, async () => {
    return obsConnection.getStreamStatus()
  })

  // ── System monitor ───────────────────────────────────────────────────────
  ipcMain.handle(IPC.SYSTEM_GET_STATS, () => {
    return systemMonitor.getStats()
  })

  // ── Stream Deck plugin installer ──────────────────────────────────────────
  ipcMain.handle(IPC.STREAMDECK_GET_STATUS, () => {
    return streamDeckPlugin.getStatus()
  })

  ipcMain.handle(IPC.STREAMDECK_INSTALL_PLUGIN, async () => {
    return streamDeckPlugin.installPlugin()
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

  // ── OBS Recording control ─────────────────────────────────────

  // Push live record-state + audio levels to the renderer. RecordStateChanged
  // arrives on the Outputs subscription; InputVolumeMeters on the high-volume
  // subscription (both OR-ed into the Identify bitmask in obsConnection.ts).
  obsConnection.setOnRecordStateChanged((state) => {
    const win = getMainWindow()
    if (win) win.webContents.send(IPC.OBS_RECORD_STATE_UPDATE, state)
  })

  obsConnection.setOnAudioLevels((levels) => {
    const win = getMainWindow()
    if (win) win.webContents.send(IPC.OBS_AUDIO_LEVELS, levels)
  })

  // Push live stream state + replay-saved notices to the renderer.
  obsConnection.setOnStreamStateChanged((state) => {
    const win = getMainWindow()
    if (win) win.webContents.send(IPC.OBS_STREAM_STATE_UPDATE, state)
  })

  obsConnection.setOnReplaySaved((replayPath) => {
    const win = getMainWindow()
    if (win) win.webContents.send(IPC.OBS_REPLAY_SAVED, { path: replayPath })
  })

  // System monitor → renderer (stats ~5s + disk alerts).
  systemMonitor.setOnStats((stats) => {
    const win = getMainWindow()
    if (win) win.webContents.send(IPC.SYSTEM_STATS, stats)
  })

  systemMonitor.setOnDiskAlert((alert) => {
    const win = getMainWindow()
    if (win) win.webContents.send(IPC.SYSTEM_DISK_ALERT, alert)
  })

  ipcMain.handle(IPC.OBS_START_RECORD, async () => {
    try {
      await obsConnection.startRecording()
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.OBS_STOP_RECORD, async () => {
    try {
      const outputPath = await obsConnection.stopRecording()
      return { success: true, outputPath }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.OBS_TOGGLE_RECORD, async () => {
    try {
      const active = await obsConnection.toggleRecording()
      return { success: true, active }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.OBS_RECORD_STATUS, async () => {
    return obsConnection.getRecordStatus()
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
      const body = await res.json() as any
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
          name: t.name || t.title || '',
          title: t.title || t.name,
          subtitle: t.subtitle || '',
          category: t.category || t.shiftName || (t.type === 'title_card' ? 'Title' : ''),
          order: i,
          logoDataUrl,
          type: t.type || 'lower_third',
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
      type OS = import('../shared/types').OverlayStyling
      const stylingUpdates: Partial<OS> = {}
      // Lossless apply of a web/BB-authored OverlayStyling. Use !== undefined so
      // 0 / false / '' values (letterSpacing 0, subtitleFontSize 0, textShadow
      // false) apply, not just truthy ones. Includes layout so editor-positioned
      // elements actually move in OBS.
      const copy = <K extends keyof OS>(k: K) => {
        if (oc[k as string] !== undefined) stylingUpdates[k] = oc[k as string] as OS[K]
      }
      ;([
        'fontFamily', 'fontSize', 'fontWeight', 'textColor', 'backgroundColor',
        'backgroundStyle', 'accentColor', 'borderRadius', 'animation',
        'animationDuration', 'animationEasing', 'autoHideSeconds', 'layout',
        'titleTextTransform', 'titleLetterSpacing', 'subtitleFontSize',
        'subtitleColor', 'textShadow', 'textGlow', 'labelColor', 'labelBackgroundColor',
      ] as (keyof OS)[]).forEach(copy)
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

    // Auto-arm the CC→BB live relay if the package carries a `realtime` block.
    // tenantId comes from the saved CC connection settings used for the fetch.
    // No realtime block → leave the relay dormant (back-compat with old packages).
    const rt = pkg.realtime
    const resolvedEventId = pkg.eventId || eventId || ''
    const cc = settings.get('ccConfig') as { tenantId?: string } | undefined
    const tenantId = cc?.tenantId || ''
    if (rt && rt.supabaseUrl && rt.supabaseAnonKey && tenantId && resolvedEventId) {
      ccRelay.init({
        enabled: true,
        supabaseUrl: rt.supabaseUrl,
        supabaseAnonKey: rt.supabaseAnonKey,
        tenantId,
        eventId: resolvedEventId,
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
      const body = await res.json() as any
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
      const body = await res.json() as any
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
      const body = await res.json() as any
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

  // ── Gallery V2: Transcription + Direct R2 Upload ──────────────

  ipcMain.handle(IPC.GALLERY_BROWSE_VIDEOS, async () => {
    const { dialog, BrowserWindow } = await import('electron')
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return []
    const result = await dialog.showOpenDialog(win, {
      title: 'Select Video Files (can select multiple for Act 1, Act 2, etc.)',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Video Files', extensions: ['mp4', 'mkv', 'mov', 'ts', 'webm'] }],
    })
    if (result.canceled) return []
    return result.filePaths
  })

  ipcMain.handle(IPC.GALLERY_TRANSCRIBE, async (_e, videoPaths: string[]) => {
    try {
      const { processMultipleVideos } = await import('./services/audioTranscription')
      const triggers = overlay.getTriggers()
      const triggerNames = triggers.map((t) => t.name)
      const win = getMainWindow()
      const result = await processMultipleVideos(videoPaths, triggerNames, (msg) => {
        if (win) win.webContents.send(IPC.GALLERY_PROGRESS, { stage: 'transcribing', message: msg, current: 0, total: 0 })
      })
      return { success: true, boundaries: result.boundaries, segmentCount: result.segments.length }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.GALLERY_UPLOAD_R2, async (_e, folderPath: string, gallerySlug: string) => {
    try {
      const r2Conf = settings.get('r2Config') as { endpoint: string; accessKeyId: string; secretAccessKey: string; bucket: string } | undefined
      if (!r2Conf?.endpoint || !r2Conf?.accessKeyId || !r2Conf?.secretAccessKey) {
        throw new Error('R2 not configured. Set R2 credentials in Settings.')
      }
      const { createR2Client, uploadBatch, buildUploadItems } = await import('./services/r2Upload')
      const client = createR2Client(r2Conf)
      const items = buildUploadItems(folderPath, gallerySlug)
      events.recordEvent('gallery', `R2 upload started: ${items.length} files`, { gallerySlug })
      const win = getMainWindow()
      const result = await uploadBatch(
        client,
        r2Conf.bucket,
        items,
        8,
        (progress) => {
          if (win) win.webContents.send(IPC.GALLERY_PROGRESS, {
            stage: 'uploading-r2',
            message: `Uploading: ${progress.completed}/${progress.total} — ${progress.currentFile}`,
            current: progress.completed,
            total: progress.total,
          })
        },
        true,
        // Enable per-folder manifest dedup so a second invocation of this
        // handler against the same SD card / project folder skips files
        // already uploaded on a prior run (ported CompSync importManifest).
        { useImportManifest: true, manifestFolder: folderPath },
      )
      events.recordEvent('gallery', `R2 upload complete: ${result.completed} uploaded, ${result.failed.length} failed`, { gallerySlug })
      return { success: true, completed: result.completed, failed: result.failed.length }
    } catch (err) {
      events.recordEvent('error', `Gallery R2 upload failed: ${(err as Error).message}`)
      return { success: false, error: (err as Error).message }
    }
  })

  // ── WiFi Display (tablet stream) ──────────────────────────────

  ipcMain.handle(IPC.WIFI_DISPLAY_GET_MONITORS, () => {
    return wifiDisplay.getMonitors()
  })

  ipcMain.handle(IPC.WIFI_DISPLAY_START, async () => {
    try {
      await wifiDisplay.start()
      return wifiDisplay.getStatus()
    } catch (err) {
      return { running: false, monitorIndex: null, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.WIFI_DISPLAY_STOP, async () => {
    await wifiDisplay.stop()
    events.recordEvent('wifi', 'Wifi display stopped (operator)')
    return wifiDisplay.getStatus()
  })

  ipcMain.handle(IPC.WIFI_DISPLAY_STATUS, () => {
    return wifiDisplay.getStatus()
  })

  ipcMain.handle(IPC.WIFI_DISPLAY_SET_MONITOR, (_e, monitorIndex: number | null) => {
    const current = settings.get('wifiDisplay')
    settings.set('wifiDisplay', { ...(current ?? {}) as import('../shared/types').WifiDisplaySettings, monitorIndex })
    return { ok: true }
  })

  ipcMain.handle(IPC.WIFI_DISPLAY_PING_TABLET, () => {
    wifiDisplay.pingTabletForDiscovery()
    return { ok: true }
  })

  // ── OBS Slow Zoom ─────────────────────────────────────────────

  ipcMain.handle(IPC.OBS_SLOW_ZOOM_TRIGGER_WIDE, async () => {
    return slowZoom.triggerWide()
  })

  ipcMain.handle(IPC.OBS_SLOW_ZOOM_TRIGGER_TIGHT, async () => {
    return slowZoom.triggerTight()
  })

  ipcMain.handle(IPC.OBS_SLOW_ZOOM_STATUS, () => {
    return slowZoom.getStatus()
  })

  // ── OBS Transition auto-revert ────────────────────────────────

  ipcMain.handle(IPC.OBS_TRANSITION_REVERT_GET, () => {
    return { enabled: obsConnection.isTransitionRevertEnabled() }
  })

  ipcMain.handle(IPC.OBS_TRANSITION_REVERT_SET, (_e, enabled: boolean) => {
    obsConnection.setTransitionRevertEnabled(enabled)
    settings.set('obsTransitionRevert', enabled)
    return { enabled }
  })

  // ── Up Next / That Was ────────────────────────────────────────

  ipcMain.handle(IPC.OVERLAY_FIRE_UP_NEXT, (_e, label?: string) => {
    const fired = overlay.fireUpNext(label || 'UP NEXT')
    pushState()
    broadcastState()
    return { fired }
  })

  ipcMain.handle(IPC.OVERLAY_FIRE_THAT_WAS, (_e, label?: string) => {
    const fired = overlay.fireThatWas(label || 'THAT WAS')
    pushState()
    broadcastState()
    return { fired }
  })

  // ── Overlay leveling grid ─────────────────────────────────────

  ipcMain.handle(IPC.OVERLAY_GRID_TOGGLE, () => {
    const visible = overlay.toggleGrid()
    pushState()
    broadcastState()
    return { visible }
  })

  // ── On-air clock ──────────────────────────────────────────────

  ipcMain.handle(IPC.OVERLAY_CLOCK_TOGGLE, () => {
    const visible = overlay.toggleClock()
    pushState()
    broadcastState()
    return { visible }
  })

  ipcMain.handle(IPC.OVERLAY_CLOCK_UPDATE, (_e, updates: Partial<import('../shared/types').ClockState>) => {
    overlay.updateClock(updates)
    pushState()
    broadcastState()
  })

  // ── Counter ───────────────────────────────────────────────────

  ipcMain.handle(IPC.OVERLAY_COUNTER_TOGGLE, () => {
    const visible = overlay.toggleCounter()
    pushState()
    broadcastState()
    return { visible }
  })

  ipcMain.handle(IPC.OVERLAY_COUNTER_SET, (_e, value: number, label?: string) => {
    overlay.setCounter(value, label)
    pushState()
    broadcastState()
  })

  ipcMain.handle(IPC.OVERLAY_COUNTER_BUMP, (_e, delta: number) => {
    const value = overlay.bumpCounter(delta)
    pushState()
    broadcastState()
    return { value }
  })

  // ── Full-screen feature card ──────────────────────────────────

  ipcMain.handle(IPC.OVERLAY_FEATURE_SHOW, (_e, data: Partial<import('../shared/types').FeatureCardState>) => {
    overlay.showFeatureCard(data)
    pushState()
    broadcastState()
  })

  ipcMain.handle(IPC.OVERLAY_FEATURE_UP_NEXT, (_e, kicker?: string) => {
    const fired = overlay.fireFeatureUpNext(kicker || 'UP NEXT')
    pushState()
    broadcastState()
    return { fired }
  })

  ipcMain.handle(IPC.OVERLAY_FEATURE_THAT_WAS, (_e, kicker?: string) => {
    const fired = overlay.fireFeatureThatWas(kicker || 'THAT WAS')
    pushState()
    broadcastState()
    return { fired }
  })

  ipcMain.handle(IPC.OVERLAY_FEATURE_HIDE, () => {
    overlay.hideFeatureCard()
    pushState()
    broadcastState()
  })

  // ── Operator chat (Supabase Realtime, off by default) ─────────

  // Push chat-state changes to the renderer.
  chatBridge.setOnStateChange(() => {
    const win = getMainWindow()
    if (win) win.webContents.send(IPC.CHAT_STATE_UPDATE, chatBridge.getState())
  })

  // Pinning a message fires it as a lower-third broadcast.
  chatBridge.setOnMessagePinned((msg) => {
    overlay.fireText(msg.text, msg.author ? `— ${msg.author}` : '', 'PINNED')
    pushState()
    broadcastState()
  })

  // Initialize from saved config at registration time. If chat is unconfigured
  // or disabled this no-ops and never touches the network.
  chatBridge.init(settings.get('chatConfig') as ChatConfig | undefined)

  ipcMain.handle(IPC.CHAT_GET_STATE, () => {
    return chatBridge.getState()
  })

  ipcMain.handle(IPC.CHAT_RECONFIGURE, () => {
    chatBridge.init(settings.get('chatConfig') as ChatConfig | undefined)
    return chatBridge.getState()
  })

  ipcMain.handle(IPC.CHAT_SEND, async (_e, text: string, author?: string) => {
    const ok = await chatBridge.sendMessage(text, author)
    return { ok }
  })

  ipcMain.handle(IPC.CHAT_PIN, async (_e, id: string) => {
    const ok = await chatBridge.pinMessage(id)
    return { ok }
  })

  ipcMain.handle(IPC.CHAT_UNPIN, async (_e, id: string) => {
    const ok = await chatBridge.unpinMessage(id)
    return { ok }
  })

  ipcMain.handle(IPC.CHAT_FIRE_MESSAGE, (_e, id: string) => {
    const msg = chatBridge.getMessageById(id)
    if (!msg) return { fired: false }
    overlay.fireText(msg.text, msg.author ? `— ${msg.author}` : '', 'PINNED')
    pushState()
    broadcastState()
    return { fired: true }
  })

  // ── Operator chat moderation ──────────────────────────────────
  // Persist banned-author changes back into chatConfig so they survive a
  // reconnect / app restart. chatBridge fires this on every ban/unban.
  chatBridge.setOnBannedAuthorsChange((authors) => {
    const cfg = (settings.get('chatConfig') as ChatConfig | undefined) ?? { supabaseUrl: '', supabaseAnonKey: '', eventId: '', enabled: false }
    settings.set('chatConfig', { ...cfg, bannedAuthors: authors })
  })

  ipcMain.handle(IPC.CHAT_HIDE, async (_e, id: string) => {
    const ok = await chatBridge.hideMessage(id)
    return { ok }
  })

  ipcMain.handle(IPC.CHAT_BAN_AUTHOR, (_e, author: string) => {
    const ok = chatBridge.banAuthor(author)
    return { ok, bannedAuthors: chatBridge.getBannedAuthors() }
  })

  ipcMain.handle(IPC.CHAT_UNBAN_AUTHOR, (_e, author: string) => {
    const ok = chatBridge.unbanAuthor(author)
    return { ok, bannedAuthors: chatBridge.getBannedAuthors() }
  })

  ipcMain.handle(IPC.CHAT_LIVESTREAM_PIN, async (_e, id: string) => {
    const ok = await chatBridge.livestreamPin(id)
    return { ok }
  })

  ipcMain.handle(IPC.CHAT_LIVESTREAM_UNPIN, async (_e, id: string) => {
    const ok = await chatBridge.livestreamUnpin(id)
    return { ok }
  })

  // ── CC→BB live relay (Supabase Realtime broadcast, dormant until armed) ───────

  // A relayed 'package' broadcast applies identically to a WS package push:
  // forward it to the renderer as cc:package-pushed, which auto-applies via the
  // same BroadcastPackagePanel path as a manual pull.
  ccRelay.setOnPackage((payload) => {
    const win = getMainWindow()
    if (win && payload) win.webContents.send('cc:package-pushed', payload)
  })

  // A relayed 'adhoc' broadcast fires a one-off lower-third identically to the
  // local Ad-hoc box. Validate defensively (strings, fallback empty) so a
  // malformed payload can't throw inside the relay callback.
  ccRelay.setOnAdhoc((payload) => {
    const p = (payload ?? {}) as { title?: unknown; subtitle?: unknown }
    const title = typeof p.title === 'string' ? p.title : ''
    const subtitle = typeof p.subtitle === 'string' ? p.subtitle : ''
    overlay.fireAdhoc(title, subtitle)
    pushState()
    pushLastAdhoc()
    broadcastState()
  })

  // Push relay connection-state changes to the renderer so the UI can show it.
  ccRelay.setOnStateChange(() => {
    const win = getMainWindow()
    if (win) win.webContents.send(IPC.CC_RELAY_STATE_UPDATE, ccRelay.getState())
  })

  ipcMain.handle(IPC.CC_RELAY_GET_STATE, () => {
    return ccRelay.getState()
  })

  // ── Operator day checklist (start-of-day / end-of-day) ────────

  function buildDayView(date: string, kind: DayChecklistKind): DayChecklistView {
    return {
      kind,
      date,
      items: getItemsForKind(kind),
      state: dayChecklist.getDayState(date, kind),
    }
  }

  ipcMain.handle(IPC.DAY_CHECKLIST_GET, (_e, date: string, kind: DayChecklistKind) => {
    const d = date || dayChecklist.todayKey()
    return buildDayView(d, kind)
  })

  ipcMain.handle(IPC.DAY_CHECKLIST_SET_ITEM, (_e, date: string, kind: DayChecklistKind, itemId: string, value: DayChecklistItemState) => {
    const d = date || dayChecklist.todayKey()
    dayChecklist.setItemState(d, kind, itemId, value)
    return buildDayView(d, kind)
  })

  ipcMain.handle(IPC.DAY_CHECKLIST_DISMISS, (_e, date: string, kind: DayChecklistKind) => {
    const d = date || dayChecklist.todayKey()
    dayChecklist.markDismissed(d, kind)
    events.recordEvent('system', `Operator dismissed ${kind}-of-day checklist`, { date: d })
    return buildDayView(d, kind)
  })

  ipcMain.handle(IPC.DAY_CHECKLIST_REOPEN, (_e, kind: DayChecklistKind) => {
    const d = dayChecklist.todayKey()
    return buildDayView(d, kind)
  })

  // First launch of a new calendar day → renderer auto-shows start-of-day.
  // We stamp dayChecklistLastShown here so it only auto-shows once per day.
  ipcMain.handle(IPC.DAY_CHECKLIST_SHOULD_SHOW, () => {
    const today = dayChecklist.todayKey()
    const last = settings.get('dayChecklistLastShown') as string | undefined
    const already = dayChecklist.getDayState(today, 'start').dismissed
    const should = last !== today && !already
    if (should) settings.set('dayChecklistLastShown', today)
    return { should, date: today }
  })

  // ── Operator event log / telemetry ────────────────────────────

  ipcMain.handle(IPC.EVENTS_GET_RECENT, (_e, limit?: number, kind?: EventLogKind) => {
    return events.getRecent(limit ?? 500, kind)
  })

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

  logger.info('IPC handlers registered')
}
