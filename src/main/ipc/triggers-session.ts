import { ipcMain, dialog } from 'electron'
import fs from 'fs'
import { IPC, Trigger, LoopMode, StreamConfig } from '../../shared/types'
import * as overlay from '../services/overlay'
import * as session from '../services/session'
import * as settings from '../services/settings'
import * as obsConnection from '../services/obsConnection'
import { getMainWindow, pushState, generateId, logger } from './common'
import { pushStreamSettingsToObs } from './obs-record'

export function registerTriggerSessionHandlers(): void {

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
      // The session carries its own stream key/rtmp (from the CC package it was
      // built from). loadSessionState only sets the in-memory value, so without
      // this the persisted streamConfig + OBS keep the PREVIOUS event's key.
      // Persist it (so an OBS reconnect re-pushes the right key) AND push now.
      const sc = s.streamConfig
      if (sc && sc.rtmpUrl && sc.streamKey) {
        settings.set('streamConfig', sc)
        if (obsConnection.isConnected()) {
          void pushStreamSettingsToObs(sc.rtmpUrl, sc.streamKey, {
            event: s.name,
          }).catch((err) => logger.error('Push stream key on session load failed:', err))
        }
      }
    }
    return s
  })

  ipcMain.handle(IPC.SESSION_LIST, () => {
    return session.listSessions()
  })

  ipcMain.handle(IPC.SESSION_GET_CURRENT, () => {
    return session.getCurrentSession()
  })
}

export function registerStreamConfigNoteHandlers(): void {

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
}
