import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'
import type { Trigger, OverlayStyling, LoopMode, StreamConfig, StartingSoonState, BroadcastPackage, CCChecklistItem } from '../shared/types'

contextBridge.exposeInMainWorld('api', {
  // ── Overlay control ──────────────────────────────────────────
  overlayFireLT: () => ipcRenderer.invoke(IPC.OVERLAY_FIRE_LT),
  overlayHideLT: () => ipcRenderer.invoke(IPC.OVERLAY_HIDE_LT),
  overlayGetState: () => ipcRenderer.invoke(IPC.OVERLAY_GET_STATE),
  overlayUpdateStyling: (updates: Partial<OverlayStyling>) =>
    ipcRenderer.invoke(IPC.OVERLAY_UPDATE_STYLING, updates),
  overlaySetLogos: (company: string, client: string) =>
    ipcRenderer.invoke(IPC.OVERLAY_SET_LOGOS, company, client),

  // ── Trigger management ────────────────────────────────────────
  triggerList: () => ipcRenderer.invoke(IPC.TRIGGER_LIST),
  triggerAdd: (trigger: Trigger) => ipcRenderer.invoke(IPC.TRIGGER_ADD, trigger),
  triggerUpdate: (id: string, updates: Partial<Trigger>) =>
    ipcRenderer.invoke(IPC.TRIGGER_UPDATE, id, updates),
  triggerDelete: (id: string) => ipcRenderer.invoke(IPC.TRIGGER_DELETE, id),
  triggerReorder: (ids: string[]) => ipcRenderer.invoke(IPC.TRIGGER_REORDER, ids),
  triggerSelect: (index: number) => ipcRenderer.invoke(IPC.TRIGGER_SELECT, index),
  triggerNext: () => ipcRenderer.invoke(IPC.TRIGGER_NEXT),
  triggerPrev: () => ipcRenderer.invoke(IPC.TRIGGER_PREV),
  triggerNextFull: () => ipcRenderer.invoke(IPC.TRIGGER_NEXT_FULL),
  triggerSetLogo: (id: string) => ipcRenderer.invoke(IPC.TRIGGER_SET_LOGO, id),

  // Playlist
  playlistAutoFireToggle: () => ipcRenderer.invoke(IPC.PLAYLIST_AUTO_FIRE),
  playlistGetStatus: () => ipcRenderer.invoke(IPC.PLAYLIST_GET_STATUS),
  playlistSetLoopMode: (mode: LoopMode) => ipcRenderer.invoke(IPC.PLAYLIST_SET_LOOP_MODE, mode),
  playlistResetPosition: () => ipcRenderer.invoke(IPC.PLAYLIST_RESET_POSITION),
  playlistClearPlayed: () => ipcRenderer.invoke(IPC.PLAYLIST_CLEAR_PLAYED),

  // Trigger bulk
  triggerClearAll: () => ipcRenderer.invoke(IPC.TRIGGER_CLEAR_ALL),

  // ── Session management ────────────────────────────────────────
  sessionNew: (name: string, preserveTriggers?: boolean) => ipcRenderer.invoke(IPC.SESSION_NEW, name, preserveTriggers),
  sessionSave: () => ipcRenderer.invoke(IPC.SESSION_SAVE),
  sessionLoad: (id: string) => ipcRenderer.invoke(IPC.SESSION_LOAD, id),
  sessionList: () => ipcRenderer.invoke(IPC.SESSION_LIST),
  sessionGetCurrent: () => ipcRenderer.invoke(IPC.SESSION_GET_CURRENT),

  // ── Settings ──────────────────────────────────────────────────
  settingsGet: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  settingsSet: (key: string, value: unknown) =>
    ipcRenderer.invoke(IPC.SETTINGS_SET, key, value),
  settingsBrowseFile: (filters?: Electron.FileFilter[]) =>
    ipcRenderer.invoke(IPC.SETTINGS_BROWSE_FILE, filters),

  // ── Logo ──────────────────────────────────────────────────────
  logoBrowse: () => ipcRenderer.invoke(IPC.LOGO_BROWSE),

  // ── Ticker ──────────────────────────────────────────────────────
  tickerShow: (text: string, speed?: number, bgColor?: string, textColor?: string) =>
    ipcRenderer.invoke(IPC.TICKER_SHOW, text, speed, bgColor, textColor),
  tickerHide: () => ipcRenderer.invoke(IPC.TICKER_HIDE),
  tickerUpdate: (updates: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC.TICKER_UPDATE, updates),

  // ── Stream Config ─────────────────────────────────────────────
  streamConfigGet: () => ipcRenderer.invoke(IPC.STREAM_CONFIG_GET),
  streamConfigSet: (config: StreamConfig) => ipcRenderer.invoke(IPC.STREAM_CONFIG_SET, config),

  // ── Notes ─────────────────────────────────────────────────────
  notesList: () => ipcRenderer.invoke(IPC.NOTES_LIST),
  notesAdd: (text: string) => ipcRenderer.invoke(IPC.NOTES_ADD, text),
  notesDelete: (id: string) => ipcRenderer.invoke(IPC.NOTES_DELETE, id),

  // ── OBS Connection ────────────────────────────────────────────
  obsConnect: (host: string, port: number, password?: string) =>
    ipcRenderer.invoke(IPC.OBS_CONNECT, host, port, password),
  obsDisconnect: () => ipcRenderer.invoke(IPC.OBS_DISCONNECT),
  obsStatus: () => ipcRenderer.invoke(IPC.OBS_STATUS),
  obsGetTimecode: () => ipcRenderer.invoke(IPC.OBS_GET_TIMECODE),
  obsPushStreamKey: (rtmpUrl: string, streamKey: string) =>
    ipcRenderer.invoke(IPC.OBS_PUSH_STREAM_KEY, rtmpUrl, streamKey),

  // ── Starting Soon ─────────────────────────────────────────────
  startingSoonShow: () => ipcRenderer.invoke(IPC.STARTING_SOON_SHOW),
  startingSoonHide: () => ipcRenderer.invoke(IPC.STARTING_SOON_HIDE),
  startingSoonUpdate: (updates: Partial<StartingSoonState>) =>
    ipcRenderer.invoke(IPC.STARTING_SOON_UPDATE, updates),

  // ── Command Center ────────────────────────────────────────────
  ccFetchEvents: (baseUrl: string, apiKey: string, tenantId: string) =>
    ipcRenderer.invoke(IPC.CC_FETCH_EVENTS, baseUrl, apiKey, tenantId),
  ccFetchPackage: (baseUrl: string, apiKey: string, tenantId: string, eventId: string) =>
    ipcRenderer.invoke(IPC.CC_FETCH_PACKAGE, baseUrl, apiKey, tenantId, eventId),
  ccApplyPackage: (pkg: BroadcastPackage, eventId?: string) =>
    ipcRenderer.invoke(IPC.CC_APPLY_PACKAGE, pkg, eventId),
  ccUploadRecording: (baseUrl: string, apiKey: string, tenantId: string, eventId: string, filePath: string, fileName?: string) =>
    ipcRenderer.invoke(IPC.CC_UPLOAD_RECORDING, baseUrl, apiKey, tenantId, eventId, filePath, fileName),
  ccFetchChecklist: (baseUrl: string, apiKey: string, tenantId: string, eventId: string) =>
    ipcRenderer.invoke(IPC.CC_FETCH_CHECKLIST, baseUrl, apiKey, tenantId, eventId),
  ccSyncChecklist: (baseUrl: string, apiKey: string, tenantId: string, eventId: string, items: Array<{ id: string; checked: boolean }>) =>
    ipcRenderer.invoke(IPC.CC_SYNC_CHECKLIST, baseUrl, apiKey, tenantId, eventId, items),
  ccSaveOverlayConfig: (baseUrl: string, apiKey: string, tenantId: string, eventId: string, config: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC.CC_SAVE_OVERLAY_CONFIG, baseUrl, apiKey, tenantId, eventId, config),
  obsGetLastRecording: () => ipcRenderer.invoke(IPC.OBS_GET_LAST_RECORDING),
  recordingBrowse: () => ipcRenderer.invoke(IPC.RECORDING_BROWSE),

  // ── Document import ────────────────────────────────────────────
  importBrowse: () => ipcRenderer.invoke(IPC.IMPORT_BROWSE),
  importPreview: (filePath: string) => ipcRenderer.invoke(IPC.IMPORT_PREVIEW, filePath),
  importDocument: (filePath?: string) => ipcRenderer.invoke(IPC.IMPORT_DOCUMENT, filePath),

  // ── Brand scraper ──────────────────────────────────────────────
  brandScrape: (url: string) => ipcRenderer.invoke(IPC.BRAND_SCRAPE, url),
  brandScrapeAI: (url: string) => ipcRenderer.invoke(IPC.BRAND_SCRAPE_AI, url),

  // ── Window ──────────────────────────────────────────────────────
  windowResize: (width: number, height: number) =>
    ipcRenderer.invoke(IPC.WINDOW_RESIZE, width, height),

  // ── Event listeners (main → renderer) ─────────────────────────
  on: (channel: string, cb: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => cb(...args))
  },
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel)
  },
})
