import { ipcMain, dialog, BrowserWindow } from 'electron'
import { IPC } from '../../shared/types'
import * as overlay from '../services/overlay'
import * as settings from '../services/settings'
import * as documentImport from '../services/documentImport'
import * as brandScraper from '../services/brandScraper'
import * as galleryService from '../services/galleryService'
import * as wifiDisplay from '../services/wifiDisplay'
import * as directMode from '../services/directMode'
import * as wifiDirectP2P from '../services/wifiDirectP2P'
import * as bleAdvertise from '../services/bleAdvertise'
import * as events from '../services/events'
import * as dayChecklist from '../services/dayChecklist'
import { getItemsForKind } from '../services/dayChecklistItems'
import * as systemMonitor from '../services/systemMonitor'
import * as streamDeckPlugin from '../services/streamDeckPlugin'
import * as overlayPanels from '../services/overlayPanels'
import type { EventLogKind, DayChecklistKind, DayChecklistItemState, DayChecklistView } from '../../shared/types'
import { getMainWindow, logger } from './common'

export function registerSystemPluginHandlers(): void {

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
}

export function registerImportBrandHandlers(): void {

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

  // Fetch a remote logo URL → base64 data URL (for "Import as Client Logo").
  ipcMain.handle(IPC.BRAND_FETCH_LOGO, async (_e, imageUrl: string) => {
    return brandScraper.fetchImageAsDataUrl(imageUrl)
  })
}

export function registerWindowMediaHandlers(): void {

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
      const { processMultipleVideos } = await import('../services/audioTranscription')
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
      const { createR2Client, uploadBatch, buildUploadItems } = await import('../services/r2Upload')
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
    settings.set('wifiDisplay', { ...(current ?? {}) as import('../../shared/types').WifiDisplaySettings, monitorIndex })
    return { ok: true }
  })

  ipcMain.handle(IPC.WIFI_DISPLAY_PING_TABLET, () => {
    wifiDisplay.pingTabletForDiscovery()
    return { ok: true }
  })

  // ── Wi-Fi Direct (no-router) hotspot mode ─────────────────────

  ipcMain.handle(IPC.DIRECT_MODE_START, async () => {
    const status = await directMode.startDirectMode()
    return { ...status, qrPayload: status.active ? directMode.buildDirectQrPayload() : undefined }
  })

  ipcMain.handle(IPC.DIRECT_MODE_STOP, async () => {
    const status = await directMode.stopDirectMode()
    return { ...status, qrPayload: undefined }
  })

  ipcMain.handle(IPC.DIRECT_MODE_STATUS, () => {
    const status = directMode.getDirectModeStatus()
    return { ...status, qrPayload: status.active ? directMode.buildDirectQrPayload() : undefined }
  })

  // ── EXPERIMENTAL / UNVERIFIED: true Wi-Fi Direct P2P (advertiser scaffold) ──
  // Isolated from the Direct (QR + Mobile Hotspot) handlers above. Host only
  // starts a Wi-Fi Direct advertisement; full connection handling needs a
  // native helper (see wifiDirectP2P.ts header).
  ipcMain.handle(IPC.WIFI_DIRECT_P2P_START, async () => {
    return wifiDirectP2P.startWifiDirectP2P()
  })

  ipcMain.handle(IPC.WIFI_DIRECT_P2P_STOP, async () => {
    return wifiDirectP2P.stopWifiDirectP2P()
  })

  ipcMain.handle(IPC.WIFI_DIRECT_P2P_STATUS, () => {
    return wifiDirectP2P.getWifiDirectP2PStatus()
  })

  // ── EXPERIMENTAL / UNVERIFIED: Option 2 "BLE auto-list" pairing ───────────
  // Isolated from the Direct (QR + Mobile Hotspot) handlers above. Advertises
  // the SAME hotspot creds the QR path encodes (buildDirectQrPayload) over BLE
  // so a tablet can list the host with no QR scan. Best-effort, Windows-only,
  // no native deps (see bleAdvertise.ts header).
  ipcMain.handle(IPC.BLE_ADVERTISE_START, async () => {
    return bleAdvertise.startBleAdvertise()
  })

  ipcMain.handle(IPC.BLE_ADVERTISE_STOP, async () => {
    return bleAdvertise.stopBleAdvertise()
  })

  ipcMain.handle(IPC.BLE_ADVERTISE_STATUS, () => {
    return bleAdvertise.getBleAdvertiseStatus()
  })
}

export function registerChecklistEventHandlers(): void {

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
}

export function registerPanelHandlers(): void {

  // ── Overlay Mode (frameless always-on-top panels over OBS) ────
  // Toggled from the Tools ▼ menu. Open hides the main window and spawns the
  // panel windows; close/exit destroys the panels and restores the main window.
  // Uses ipcMain.handle directly because OPEN needs event.sender to find the
  // caller (the main window) to hide + restore.

  ipcMain.handle(IPC.OVERLAY_MODE_OPEN, (event) => {
    const caller = BrowserWindow.fromWebContents(event.sender)
    if (!caller) return { error: 'No caller window' }
    try {
      overlayPanels.openAll(caller)
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`overlay-mode:open failed: ${msg}`)
      return { error: msg }
    }
  })

  ipcMain.handle(IPC.OVERLAY_MODE_CLOSE, () => {
    try {
      overlayPanels.closeAll()
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`overlay-mode:close failed: ${msg}`)
      return { error: msg }
    }
  })

  ipcMain.handle(IPC.OVERLAY_MODE_TOGGLE, (event) => {
    try {
      if (overlayPanels.isOpen()) {
        overlayPanels.closeAll()
      } else {
        const caller = BrowserWindow.fromWebContents(event.sender)
        if (!caller) return { error: 'No caller window' }
        overlayPanels.openAll(caller)
      }
      return { ok: true, open: overlayPanels.isOpen() }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`overlay-mode:toggle failed: ${msg}`)
      return { error: msg }
    }
  })

  ipcMain.handle(IPC.OVERLAY_MODE_HIDE_PANEL, (_e, panelId: unknown) => {
    try {
      if (typeof panelId !== 'string') return { error: 'Invalid panel id' }
      overlayPanels.hidePanel(panelId as Parameters<typeof overlayPanels.hidePanel>[0])
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`overlay-mode:hide-panel failed: ${msg}`)
      return { error: msg }
    }
  })
}
