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
import * as directMode from './services/directMode'
// EXPERIMENTAL / UNVERIFIED — true Wi-Fi Direct P2P (host advertiser scaffold).
import * as wifiDirectP2P from './services/wifiDirectP2P'
import * as bleAdvertise from './services/bleAdvertise'
import * as slowZoom from './services/slowZoom'
import {
  saveHomeViaCamera,
  goHomeViaCamera,
  probeCameraConnection,
  nudgeCamera,
  zoomCamera,
  recenterCamera,
  recallCameraPreset,
  saveCameraPreset,
  deleteCameraPreset,
  setCameraTrackingSpeed,
  setCameraAutoMode,
  nudgeCameraXY,
  zoomCameraVelocity,
  setCameraAiEnable,
  getCameraState,
  discoverCamera,
  resetCameraConnection,
} from './services/cameraDirector'
import * as chatBridge from './services/chatBridge'
import * as ccRelay from './services/ccRelay'
import { applyOverlayConfigToStyling } from './services/overlayConfigApply'
import * as events from './services/events'
import * as crashRecovery from './services/crashRecovery'
import * as backup from './services/backup'
import * as dayChecklist from './services/dayChecklist'
import { getItemsForKind } from './services/dayChecklistItems'
import { getLastStartupReport } from './services/startup'
import * as hotkeys from './services/hotkeys'
import * as systemMonitor from './services/systemMonitor'
import * as streamDeckPlugin from './services/streamDeckPlugin'
import * as overlayPanels from './services/overlayPanels'
import { broadcastState } from './services/wsHub'
import { createLogger } from './logger'
import type { ChatConfig, EventLogKind, DayChecklistKind, DayChecklistItemState, DayChecklistView, UserStylePreset } from '../shared/types'

const logger = createLogger('ipc')

function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows()
  return windows.length > 0 ? windows[0] : null
}

/**
 * Broadcast a renderer-facing push to EVERY live BrowserWindow, not just the
 * main one. Overlay Mode floating panels (panel.tsx) are additional renderers
 * that share the same Zustand store + IPC listeners; single-window sends froze
 * them after their initial snapshot. Used for all shared overlay/playlist/obs/
 * record/stream/system/chat/event-log/recovery/startup state pushes.
 */
function sendToAllWindows(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, ...args)
  }
}

function pushState(): void {
  sendToAllWindows(IPC.OVERLAY_STATE_UPDATE, overlay.getOverlayState())
  sendToAllWindows(
    IPC.TRIGGERS_UPDATED,
    overlay.getTriggers(),
    overlay.getSelectedIndex(),
    overlay.getPlayedSet(),
    overlay.getLoopMode(),
  )
}

function pushLastAdhoc(): void {
  sendToAllWindows(IPC.OVERLAY_LAST_ADHOC_UPDATE, overlay.getLastAdhoc())
}

/**
 * Apply a relayed (or test-injected) overlay-config payload to the live overlay
 * styling and push state. Guards non-object payloads. Shared by the ccRelay
 * 'overlay-config' callback and the CC_RELAY_APPLY_OVERLAY_CONFIG test IPC.
 */
function applyRelayedOverlayConfig(payload: unknown): void {
  if (!payload || typeof payload !== 'object') return
  const updates = applyOverlayConfigToStyling(payload as Record<string, unknown>)
  if (Object.keys(updates).length > 0) {
    overlay.updateStyling(updates)
  }
  applyOverlayContent((payload as Record<string, unknown>).content)
  pushState()
}

/**
 * Apply the CC overlay-editor `content` block (direct text + logos) to the live
 * overlay state. Additive + fully guarded — an absent/invalid `content` is a
 * no-op. Maps to the real overlay.ts setters:
 *   logos       → setCompanyLogo / setClientLogo (visibility derived from dataUrl)
 *   startingSoon → updateStartingSoon (title/subtitle/sectionLabel/countdown/
 *                  completion + media flags)
 *   featureCard  → setFeatureCardContent (stores content; next fire animates it)
 *   sample (lower-third preview text) is editor-only — not pushed live.
 */
function applyOverlayContent(content: unknown): void {
  if (!content || typeof content !== 'object') return
  const c = content as Record<string, unknown>
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)
  const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)

  // ── Logos ──
  if (c.logos && typeof c.logos === 'object') {
    const l = c.logos as Record<string, unknown>
    if (typeof l.companyDataUrl === 'string') {
      overlay.setCompanyLogo(l.showCompany === false ? '' : l.companyDataUrl)
    }
    if (typeof l.clientDataUrl === 'string') {
      overlay.setClientLogo(l.showClient === false ? '' : l.clientDataUrl)
    }
  }

  // ── Starting Soon content ──
  if (c.startingSoon && typeof c.startingSoon === 'object') {
    const s = c.startingSoon as Record<string, unknown>
    const ssUpdates: Partial<StartingSoonState> = {}
    if (str(s.title) !== undefined) ssUpdates.title = str(s.title)
    if (str(s.subtitle) !== undefined) ssUpdates.subtitle = str(s.subtitle)
    if (str(s.sectionLabel) !== undefined) ssUpdates.sectionLabel = str(s.sectionLabel)
    if (str(s.completionText) !== undefined) ssUpdates.completionText = str(s.completionText)
    if (num(s.countdownSeconds) !== undefined) ssUpdates.countdownSeconds = num(s.countdownSeconds)
    if (bool(s.showCountdown) !== undefined) ssUpdates.showCountdown = bool(s.showCountdown)
    if (str(s.backdropVideoUrl) !== undefined) ssUpdates.backdropVideoUrl = str(s.backdropVideoUrl)
    if (s.backdropMode === 'cover' || s.backdropMode === 'none') ssUpdates.backdropMode = s.backdropMode
    const media: Record<string, unknown> = {}
    if (bool(s.showVisualizer) !== undefined) media.showVisualizer = bool(s.showVisualizer)
    if (bool(s.showVideo) !== undefined) media.showVideo = bool(s.showVideo)
    if (str(s.videoUrl) !== undefined) media.videoUrl = str(s.videoUrl)
    // updateStartingSoon merges media onto the existing media, so a partial is safe.
    if (Object.keys(media).length > 0) ssUpdates.media = media as unknown as StartingSoonState['media']
    if (Object.keys(ssUpdates).length > 0) overlay.updateStartingSoon(ssUpdates)
  }

  // ── Feature card content (stored; next fire animates it) ──
  if (c.featureCard && typeof c.featureCard === 'object') {
    const f = c.featureCard as Record<string, unknown>
    const fcUpdates: Record<string, string> = {}
    if (str(f.kicker) !== undefined) fcUpdates.kicker = str(f.kicker) as string
    if (str(f.title) !== undefined) fcUpdates.title = str(f.title) as string
    if (str(f.subtitle) !== undefined) fcUpdates.subtitle = str(f.subtitle) as string
    if (str(f.nextLabel) !== undefined) fcUpdates.nextLabel = str(f.nextLabel) as string
    if (str(f.nextTitle) !== undefined) fcUpdates.nextTitle = str(f.nextTitle) as string
    if (Object.keys(fcUpdates).length > 0) overlay.setFeatureCardContent(fcUpdates)
  }
}

/**
 * Apply a relayed (or operator-triggered) pinned chat-message to the on-stream
 * overlay. Payload from CC's 'chat-message' broadcast:
 *   { messageId, author, text, pinned }  — pinned:true shows, false hides.
 * Fully guarded so a malformed relay payload can't throw inside the callback.
 */
function applyRelayedChatMessage(payload: unknown): void {
  const p = (payload ?? {}) as { author?: unknown; text?: unknown; pinned?: unknown }
  const pinned = p.pinned !== false // default to show unless explicitly unpinned
  if (pinned) {
    const author = typeof p.author === 'string' ? p.author : ''
    const text = typeof p.text === 'string' ? p.text : ''
    if (!text) return
    overlay.showChatMessage(author, text)
  } else {
    overlay.hideChatMessage()
  }
  pushState()
  broadcastState()
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// Push the RTMP server + stream key into OBS's custom stream service settings.
// Idempotent — pushing the same values twice is a no-op for OBS. Does NOT start
// streaming. Guards against clobbering OBS with blanks: OBS needs BOTH a server
// and a key, so if either is empty we skip silently (the CC reflection rule may
// carry a viewing link/embed without a stream key — that path must not reach here).
export async function pushStreamSettingsToObs(
  rtmpUrl: string,
  streamKey: string,
  context?: { event?: string },
): Promise<{ success: boolean; verified: boolean; error?: string }> {
  if (!rtmpUrl || !streamKey) {
    return { success: false, verified: false, error: 'rtmpUrl and streamKey both required' }
  }
  try {
    await obsConnection.sendRequest('SetStreamServiceSettings', {
      streamServiceType: 'rtmp_custom',
      streamServiceSettings: {
        server: rtmpUrl,
        key: streamKey,
      },
    })
    // success = "the Set call didn't throw". Now VERIFY it actually landed by
    // reading the settings back out of OBS (websocket v5). Do NOT throw on a
    // verify mismatch — return verified:false with a reason so callers/log can
    // see the Set succeeded but the read-back disagreed.
    let verified = false
    let verifyError: string | undefined
    try {
      const read = (await obsConnection.sendRequest('GetStreamServiceSettings')) as {
        streamServiceType?: string
        streamServiceSettings?: { server?: string; key?: string }
      }
      const s = read?.streamServiceSettings ?? {}
      const serverMatch = s.server === rtmpUrl
      // OBS usually returns the key; when it does and it's non-empty, require an
      // exact key match. But OBS can mask/omit the key in the read-back — in that
      // case (empty/absent key) we can't compare it, so a server match alone is
      // treated as verified (key-masking fallback).
      const returnedKey = typeof s.key === 'string' ? s.key : ''
      const keyMatch = returnedKey ? returnedKey === streamKey : true
      verified = serverMatch && keyMatch
      if (!verified) {
        verifyError = !serverMatch
          ? `server mismatch (got "${s.server ?? ''}")`
          : 'stream key read-back mismatch'
      }
    } catch (verr) {
      verifyError = `read-back failed: ${(verr as Error).message}`
    }

    if (verified) {
      sendToAllWindows('obs:stream-key-synced', {
        event: context?.event || '',
        server: rtmpUrl,
      })
    }
    return { success: true, verified, error: verified ? undefined : verifyError }
  } catch (err) {
    return { success: false, verified: false, error: (err as Error).message }
  }
}

// Push the saved streamConfig to OBS whenever OBS (re)connects, covering the case
// where an event/package was applied before OBS was up. Registered once at startup.
obsConnection.onConnected(() => {
  try {
    const cfg = settings.get('streamConfig')
    if (cfg?.rtmpUrl && cfg?.streamKey) {
      pushStreamSettingsToObs(cfg.rtmpUrl, cfg.streamKey, {
        event: session.getCurrentSession()?.name || '',
      })
        .then((r) => {
          if (r.success) {
            events.recordEvent(
              'obs',
              r.verified
                ? 'Auto-pushed + verified stream key in OBS on connect'
                : `Auto-pushed stream key on connect but verify failed: ${r.error}`,
            )
          } else {
            events.recordEvent('error', `Auto-push stream key on connect failed: ${r.error}`)
          }
        })
        .catch((err) =>
          events.recordEvent('error', `Auto-push stream key on connect threw: ${(err as Error).message}`),
        )
    }
  } catch (err) {
    events.recordEvent('error', `Auto-push stream key on connect threw: ${(err as Error).message}`)
  }
})

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

  ipcMain.handle(IPC.OVERLAY_SET_FC_LOGO, (_e, dataUrl: string) => {
    overlay.setFeatureCardLogo(dataUrl)
    settings.set('featureCardLogoPath', dataUrl || '')
    pushState()
  })

  ipcMain.handle(IPC.OVERLAY_GET_FC_LOGO, () => overlay.getFeatureCardLogo())

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
    return pushStreamSettingsToObs(rtmpUrl, streamKey, {
      event: session.getCurrentSession()?.name || '',
    })
  })

  // ── OBS Recording control ─────────────────────────────────────

  // Push live record-state + audio levels to the renderer. RecordStateChanged
  // arrives on the Outputs subscription; InputVolumeMeters on the high-volume
  // subscription (both OR-ed into the Identify bitmask in obsConnection.ts).
  obsConnection.setOnRecordStateChanged((state) => {
    sendToAllWindows(IPC.OBS_RECORD_STATE_UPDATE, state)
  })

  obsConnection.setOnAudioLevels((levels) => {
    sendToAllWindows(IPC.OBS_AUDIO_LEVELS, levels)
  })

  // Push live stream state + replay-saved notices to the renderer.
  obsConnection.setOnStreamStateChanged((state) => {
    sendToAllWindows(IPC.OBS_STREAM_STATE_UPDATE, state)
  })

  obsConnection.setOnReplaySaved((replayPath) => {
    sendToAllWindows(IPC.OBS_REPLAY_SAVED, { path: replayPath })
  })

  // System monitor → renderer (stats ~5s + disk alerts).
  systemMonitor.setOnStats((stats) => {
    sendToAllWindows(IPC.SYSTEM_STATS, stats)
  })

  systemMonitor.setOnDiskAlert((alert) => {
    sendToAllWindows(IPC.SYSTEM_DISK_ALERT, alert)
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

  // Fetch a remote image and return it as a base64 data URL, or '' on any
  // failure. Shared by the CC-apply logo paths (per-trigger / company / client).
  async function fetchAsDataUrl(url?: string | null): Promise<string> {
    if (!url) return ''
    try {
      const res = await fetch(url)
      if (!res.ok) return ''
      const buffer = Buffer.from(await res.arrayBuffer())
      const contentType = res.headers.get('content-type') || 'image/png'
      return `data:${contentType};base64,${buffer.toString('base64')}`
    } catch {
      return ''
    }
  }

  ipcMain.handle(IPC.CC_APPLY_PACKAGE, async (_e, pkg: BroadcastPackage, eventId?: string) => {
    // Convert CC triggers to BB triggers, fetching logos in parallel
    const newTriggers: Trigger[] = await Promise.all(
      pkg.triggers.map(async (t, i) => {
        const logoDataUrl = await fetchAsDataUrl(t.logoUrl)
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
    // Auto-select the first trigger so the lower-third/preview has content
    // immediately and Up Next / That Was are enabled (clearAllTriggers reset
    // selectedIndex to -1, which otherwise fires an empty card until a manual click).
    if (overlay.getTriggers().length > 0) {
      overlay.selectTrigger(0)
    }

    // Apply stream config if any streaming field is present
    if (pkg.streaming.streamKey || pkg.streaming.rtmpUrl || pkg.streaming.livestreamUrl || pkg.streaming.embedCode) {
      const streamConfig: StreamConfig = {
        streamKey: pkg.streaming.streamKey || '',
        rtmpUrl: pkg.streaming.rtmpUrl || '',
        viewingLink: pkg.streaming.livestreamUrl || '',
        embedCode: pkg.streaming.embedCode || '',
        chatLink: '',
      }
      overlay.setStreamConfig(streamConfig)
      // Persist too — setStreamConfig alone only sets the in-memory variable, so
      // without this the applied stream key/url is lost on restart (matches the
      // manual STREAM_CONFIG_SET handler which also writes to settings).
      settings.set('streamConfig', streamConfig)

      // Auto-push to OBS if it's connected and we have both server + key. OBS
      // needs both, so a CC reflection carrying only a viewing link/embed is
      // skipped by pushStreamSettingsToObs. Failure must not throw out of the
      // handler — catch + log.
      if (obsConnection.isConnected() && streamConfig.rtmpUrl && streamConfig.streamKey) {
        try {
          // BroadcastPackage has no client.name/event.title — the real name
          // fields are event.eventName / client.organization. Fall back to the
          // live session name if the package omits both.
          const eventName =
            pkg.event?.eventName ||
            pkg.client?.organization ||
            session.getCurrentSession()?.name ||
            ''
          const r = await pushStreamSettingsToObs(
            streamConfig.rtmpUrl,
            streamConfig.streamKey,
            { event: eventName },
          )
          if (r.success) {
            events.recordEvent(
              'cc',
              r.verified
                ? 'Auto-pushed + verified stream key in OBS on package apply'
                : `Auto-pushed stream key on apply but verify failed: ${r.error}`,
            )
          } else {
            events.recordEvent('error', `Auto-push stream key on apply failed: ${r.error}`)
          }
        } catch (err) {
          events.recordEvent('error', `Auto-push stream key on apply threw: ${(err as Error).message}`)
        }
      }
    }

    // Apply company logo if available
    const companyLogo = await fetchAsDataUrl(pkg.company?.logoUrl)
    if (companyLogo) overlay.setCompanyLogo(companyLogo)

    // Apply client logo if available
    const clientLogo = await fetchAsDataUrl(pkg.client.logoUrl)
    if (clientLogo) overlay.setClientLogo(clientLogo)

    // Apply brand color as accent if available
    if (pkg.client.brandColor) {
      overlay.updateStyling({ accentColor: pkg.client.brandColor })
    }

    // Apply company primary color if no brand color
    if (!pkg.client.brandColor && pkg.company?.primaryColor) {
      overlay.updateStyling({ accentColor: pkg.company.primaryColor })
    }

    // Apply saved overlay config if present (lossless — see applyOverlayConfigToStyling).
    if (pkg.overlayConfig) {
      const oc = pkg.overlayConfig as Record<string, unknown>
      // CC ships brand styling under `overlayConfig.styling` (a ready
      // OverlayStyling partial derived from the tenant primary/secondary colors).
      // Apply it FIRST so a full editor payload at the top level (saved via
      // saveOverlayConfig) still wins. Apply-once + non-locking: updateStyling
      // merges, so absent fields are a no-op and later operator edits override.
      if (oc.styling && typeof oc.styling === 'object') {
        const brandUpdates = applyOverlayConfigToStyling(oc.styling as Record<string, unknown>)
        if (Object.keys(brandUpdates).length > 0) {
          overlay.updateStyling(brandUpdates)
        }
      }
      const stylingUpdates = applyOverlayConfigToStyling(oc)
      if (Object.keys(stylingUpdates).length > 0) {
        overlay.updateStyling(stylingUpdates)
      }
      applyOverlayContent(oc.content)
    }

    // Ensure a session backs the applied package so operator edits auto-persist
    // (overlay auto-save is guarded on a loaded session). Only adopt+save when
    // NO session is loaded — if one already is, the debounced auto-save persists
    // the applied content into it; force-saving here would silently overwrite a
    // manually-loaded session's saved file the moment a package is applied.
    if (!session.getCurrentSession()) {
      session.newSession(pkg.client?.organization ? `${pkg.client.organization} (live)` : 'CC Package')
      session.saveSession(
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
        // Config-driven CC viewer-chat feed ('livestream:<streamEventId>').
        // Absent → 2nd subscription stays dormant.
        chatChannel: rt.chatChannel,
      })
    }

    // Arm the operator chat bridge from the SAME realtime block. It was fully
    // built but never initialized from the package, so chat stayed dormant.
    // chatBridge.init() disconnects any prior channel first, so a double-apply
    // does not leak a second subscription. Preserve any persisted banned authors
    // and re-persist the resolved config so it survives a restart.
    if (rt && rt.supabaseUrl && rt.supabaseAnonKey && resolvedEventId) {
      const prevChatCfg = settings.get('chatConfig') as ChatConfig | undefined
      const chatCfg: ChatConfig = {
        supabaseUrl: rt.supabaseUrl,
        supabaseAnonKey: rt.supabaseAnonKey,
        eventId: resolvedEventId,
        enabled: true,
        bannedAuthors: prevChatCfg?.bannedAuthors ?? [],
      }
      settings.set('chatConfig', chatCfg)
      chatBridge.init(chatCfg)
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

  // Fetch a remote logo URL → base64 data URL (for "Import as Client Logo").
  ipcMain.handle(IPC.BRAND_FETCH_LOGO, async (_e, imageUrl: string) => {
    return brandScraper.fetchImageAsDataUrl(imageUrl)
  })

  // ── User style presets (operator-saved, alongside built-in PRESETS) ──
  ipcMain.handle(IPC.USER_PRESETS_LIST, () => {
    return settings.get('userPresets') ?? []
  })

  ipcMain.handle(IPC.USER_PRESETS_ADD, (_e, preset: UserStylePreset) => {
    const list = (settings.get('userPresets') ?? []).filter((p) => p.id !== preset.id)
    list.push(preset)
    settings.set('userPresets', list)
    return list
  })

  ipcMain.handle(IPC.USER_PRESETS_DELETE, (_e, id: string) => {
    const list = (settings.get('userPresets') ?? []).filter((p) => p.id !== id)
    settings.set('userPresets', list)
    return list
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

  // ── OBSBOT camera safety (guarded — no-op unless cameraHost is set) ────────
  // Fire-and-forget: the helpers run detached + try/catch and never throw, so
  // these handlers just invoke and acknowledge.
  ipcMain.handle(IPC.CAMERA_SET_HOME, () => {
    saveHomeViaCamera()
    return { ok: true }
  })

  ipcMain.handle(IPC.CAMERA_GO_HOME, () => {
    goHomeViaCamera()
    return { ok: true }
  })

  // ── OBSBOT camera — connection probe + manual control (guarded; no-op unless
  // the camera feature is active). Helpers run detached + try/catch and never
  // throw, so these handlers invoke and acknowledge. NO UI yet (later wave).
  ipcMain.handle(IPC.CAMERA_PROBE, async () => {
    return probeCameraConnection()
  })

  // Auto-discovery: scan local subnets for the OBSBOT. On a hit, persist it as the
  // camera host and drop any stale Director so the next action reconnects to the
  // new IP. Returns the discovery result for the renderer to reflect.
  ipcMain.handle(IPC.CAMERA_DISCOVER, async () => {
    const result = await discoverCamera()
    if (result.found && result.host) {
      settings.set('cameraHost', result.host)
      resetCameraConnection()
    }
    return result
  })

  // Re-apply the current routine's full framing/tracking config (operator flipped
  // AUTO on). Guarded inside applyRoutineForTrigger (no-op unless auto + host).
  ipcMain.handle(IPC.CAMERA_APPLY_CURRENT, () => {
    overlay.applyCurrentRoutineFraming()
    return { ok: true }
  })

  ipcMain.handle(
    IPC.CAMERA_NUDGE,
    (_e, args: { dir: 'up' | 'down' | 'left' | 'right'; speed: number; stop?: boolean }) => {
      nudgeCamera(args.dir, args.speed, args.stop)
      return { ok: true }
    },
  )

  ipcMain.handle(IPC.CAMERA_ZOOM, (_e, args: { target: number; speed: number }) => {
    zoomCamera(args.target, args.speed)
    return { ok: true }
  })

  ipcMain.handle(IPC.CAMERA_RECENTER, () => {
    recenterCamera()
    return { ok: true }
  })

  ipcMain.handle(IPC.CAMERA_RECALL_PRESET, (_e, args: { n: number }) => {
    recallCameraPreset(args.n)
    return { ok: true }
  })

  ipcMain.handle(IPC.CAMERA_SAVE_PRESET, (_e, args: { id: number; name?: string }) => {
    saveCameraPreset(args.id, args.name)
    return { ok: true }
  })

  ipcMain.handle(IPC.CAMERA_DELETE_PRESET, (_e, args: { id: number }) => {
    deleteCameraPreset(args.id)
    return { ok: true }
  })

  ipcMain.handle(IPC.CAMERA_SET_AUTO_MODE, async (_e, args: { on: boolean }) => {
    return setCameraAutoMode(args.on)
  })

  ipcMain.handle(IPC.CAMERA_SET_TRACKING_SPEED, (_e, args: { mode: number }) => {
    setCameraTrackingSpeed(args.mode)
    return { ok: true }
  })

  // ── OBSBOT camera — PTZ control panel (Wave 2/3) ──────────────────────────
  // High-rate joystick/gamepad path. nudgeCameraXY fires detached (the helper
  // does NOT await camera I/O), so this handler stays cheap under the ~10Hz
  // invoke loop. All guarded — no-op when the camera feature is inactive.
  ipcMain.handle(
    IPC.CAMERA_NUDGE_XY,
    (_e, args: { yaw: number; pitch: number; stop?: boolean }) => {
      nudgeCameraXY(args.yaw, args.pitch, args.stop)
      return { ok: true }
    },
  )

  ipcMain.handle(
    IPC.CAMERA_ZOOM_VELOCITY,
    (_e, args: { dir: 'in' | 'out'; speed: number; stop?: boolean }) => {
      zoomCameraVelocity(args.dir, args.speed, args.stop)
      return { ok: true }
    },
  )

  ipcMain.handle(IPC.CAMERA_SET_AI_ENABLE, (_e, args: { on: boolean }) => {
    setCameraAiEnable(args.on)
    return { ok: true }
  })

  // Live gimbal/zoom readout for the panel status. Never throws.
  ipcMain.handle(IPC.CAMERA_GET_STATE, async () => {
    return getCameraState()
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

  // ── On-stream pinned chat-message overlay (CC viewer chat) ────────
  // Operator-side show/hide (mirrors the CC 'chat-message' relay path). Used by
  // the ChatPanel "show on screen" action and the OverlayControls toggle.
  ipcMain.handle(IPC.OVERLAY_SHOW_CHAT_MESSAGE, (_e, author?: string, text?: string) => {
    overlay.showChatMessage(typeof author === 'string' ? author : '', typeof text === 'string' ? text : '')
    pushState()
    broadcastState()
  })

  ipcMain.handle(IPC.OVERLAY_HIDE_CHAT_MESSAGE, () => {
    overlay.hideChatMessage()
    pushState()
    broadcastState()
  })

  // ── Operator chat (Supabase Realtime, off by default) ─────────

  // Push chat-state changes to the renderer.
  chatBridge.setOnStateChange(() => {
    sendToAllWindows(IPC.CHAT_STATE_UPDATE, chatBridge.getState())
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
    if (payload) sendToAllWindows('cc:package-pushed', payload)
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

  // A relayed 'overlay-config' broadcast is a live editor sync from CC. Apply the
  // OverlayStyling-shaped payload losslessly to the live overlay styling (incl
  // layout + per-element styling) and push the new state to the browser source.
  ccRelay.setOnOverlayConfig((payload) => {
    applyRelayedOverlayConfig(payload)
  })

  // A relayed 'chat-message' broadcast (CC operator pinned/unpinned a viewer-chat
  // message) drives the on-stream chat-message overlay. pinned:true shows it,
  // pinned:false hides it.
  ccRelay.setOnChatMessage((payload) => {
    applyRelayedChatMessage(payload)
  })

  // Push relay connection-state changes to the renderer so the UI can show it.
  ccRelay.setOnStateChange(() => {
    sendToAllWindows(IPC.CC_RELAY_STATE_UPDATE, ccRelay.getState())
  })

  ipcMain.handle(IPC.CC_RELAY_GET_STATE, () => {
    return ccRelay.getState()
  })

  // Test/diagnostic: simulate an inbound 'overlay-config' relay broadcast. Drives
  // the exact same apply path as ccRelay.setOnOverlayConfig with no network.
  ipcMain.handle(IPC.CC_RELAY_APPLY_OVERLAY_CONFIG, (_e, cfg: Record<string, unknown>) => {
    applyRelayedOverlayConfig(cfg)
    return { success: true }
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

  logger.info('IPC handlers registered')
}
