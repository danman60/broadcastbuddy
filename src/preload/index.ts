import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'
import type { Trigger, OverlayStyling, LoopMode, StreamConfig, StartingSoonState, BroadcastPackage, CCChecklistItem, MonitorInfo, WifiDisplayState, SlowZoomStatus, ClockState, FeatureCardState } from '../shared/types'

contextBridge.exposeInMainWorld('api', {
  // ── Overlay control ──────────────────────────────────────────
  overlayFireLT: () => ipcRenderer.invoke(IPC.OVERLAY_FIRE_LT),
  overlayHideLT: () => ipcRenderer.invoke(IPC.OVERLAY_HIDE_LT),
  overlayFireAdhoc: (title: string, subtitle?: string) =>
    ipcRenderer.invoke(IPC.OVERLAY_FIRE_ADHOC, title, subtitle),
  overlayGetLastAdhoc: () => ipcRenderer.invoke(IPC.OVERLAY_GET_LAST_ADHOC),
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

  // ── OBS Recording control ─────────────────────────────────────
  obsStartRecord: () => ipcRenderer.invoke(IPC.OBS_START_RECORD),
  obsStopRecord: () => ipcRenderer.invoke(IPC.OBS_STOP_RECORD),
  obsToggleRecord: () => ipcRenderer.invoke(IPC.OBS_TOGGLE_RECORD),
  obsRecordStatus: () => ipcRenderer.invoke(IPC.OBS_RECORD_STATUS),

  // ── OBS stream control + replay buffer ────────────────────────
  obsStartStream: () => ipcRenderer.invoke(IPC.OBS_START_STREAM),
  obsStopStream: () => ipcRenderer.invoke(IPC.OBS_STOP_STREAM),
  obsSaveReplay: () => ipcRenderer.invoke(IPC.OBS_SAVE_REPLAY),
  obsStreamStatus: () => ipcRenderer.invoke(IPC.OBS_STREAM_STATUS),

  // ── System monitor ────────────────────────────────────────────
  systemGetStats: () => ipcRenderer.invoke(IPC.SYSTEM_GET_STATS),

  // ── Stream Deck plugin installer ──────────────────────────────
  streamdeckGetStatus: () => ipcRenderer.invoke(IPC.STREAMDECK_GET_STATUS),
  streamdeckInstallPlugin: () => ipcRenderer.invoke(IPC.STREAMDECK_INSTALL_PLUGIN),

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

  // ── Gallery / Photo Sorting ────────────────────────────────────
  galleryBrowseVideo: () => ipcRenderer.invoke(IPC.GALLERY_BROWSE_VIDEO),
  galleryBrowsePhotos: () => ipcRenderer.invoke(IPC.GALLERY_BROWSE_PHOTOS),
  galleryAnalyzeVideo: (videoPath: string, geminiApiKey: string) =>
    ipcRenderer.invoke(IPC.GALLERY_ANALYZE_VIDEO, videoPath, geminiApiKey),
  galleryReadExif: (folderPath?: string) =>
    ipcRenderer.invoke(IPC.GALLERY_READ_EXIF, folderPath),
  galleryMatchPhotos: (manualOffsetMs?: number) =>
    ipcRenderer.invoke(IPC.GALLERY_MATCH_PHOTOS, manualOffsetMs),
  gallerySetOffset: (offsetMs: number) =>
    ipcRenderer.invoke(IPC.GALLERY_SET_OFFSET, offsetMs),
  galleryGetConfig: () => ipcRenderer.invoke(IPC.GALLERY_GET_CONFIG),
  galleryUploadToCC: (title: string) =>
    ipcRenderer.invoke(IPC.GALLERY_UPLOAD_TO_CC, title),

  // Gallery V2: Transcription + Direct R2 Upload
  galleryBrowseVideos: () => ipcRenderer.invoke(IPC.GALLERY_BROWSE_VIDEOS),
  galleryTranscribe: (videoPaths: string[]) =>
    ipcRenderer.invoke(IPC.GALLERY_TRANSCRIBE, videoPaths),
  galleryUploadR2: (folderPath: string, gallerySlug: string) =>
    ipcRenderer.invoke(IPC.GALLERY_UPLOAD_R2, folderPath, gallerySlug),

  // ── WiFi Display (tablet stream) ──────────────────────────────
  wifiDisplayGetMonitors: (): Promise<MonitorInfo[]> =>
    ipcRenderer.invoke(IPC.WIFI_DISPLAY_GET_MONITORS),
  wifiDisplayStart: (): Promise<WifiDisplayState & { error?: string }> =>
    ipcRenderer.invoke(IPC.WIFI_DISPLAY_START),
  wifiDisplayStop: (): Promise<WifiDisplayState> =>
    ipcRenderer.invoke(IPC.WIFI_DISPLAY_STOP),
  wifiDisplayStatus: (): Promise<WifiDisplayState> =>
    ipcRenderer.invoke(IPC.WIFI_DISPLAY_STATUS),
  wifiDisplaySetMonitor: (monitorIndex: number | null) =>
    ipcRenderer.invoke(IPC.WIFI_DISPLAY_SET_MONITOR, monitorIndex),
  wifiDisplayPingTablet: () =>
    ipcRenderer.invoke(IPC.WIFI_DISPLAY_PING_TABLET),

  // ── OBS Slow Zoom ─────────────────────────────────────────────
  obsSlowZoomTriggerWide: (): Promise<SlowZoomStatus> =>
    ipcRenderer.invoke(IPC.OBS_SLOW_ZOOM_TRIGGER_WIDE),
  obsSlowZoomTriggerTight: (): Promise<SlowZoomStatus> =>
    ipcRenderer.invoke(IPC.OBS_SLOW_ZOOM_TRIGGER_TIGHT),
  obsSlowZoomStatus: (): Promise<SlowZoomStatus> =>
    ipcRenderer.invoke(IPC.OBS_SLOW_ZOOM_STATUS),

  // ── OBS Transition auto-revert ────────────────────────────────
  obsTransitionRevertGet: (): Promise<{ enabled: boolean }> =>
    ipcRenderer.invoke(IPC.OBS_TRANSITION_REVERT_GET),
  obsTransitionRevertSet: (enabled: boolean): Promise<{ enabled: boolean }> =>
    ipcRenderer.invoke(IPC.OBS_TRANSITION_REVERT_SET, enabled),

  // ── Up Next / That Was ────────────────────────────────────────
  overlayFireUpNext: (label?: string): Promise<{ fired: boolean }> =>
    ipcRenderer.invoke(IPC.OVERLAY_FIRE_UP_NEXT, label),
  overlayFireThatWas: (label?: string): Promise<{ fired: boolean }> =>
    ipcRenderer.invoke(IPC.OVERLAY_FIRE_THAT_WAS, label),

  // ── Overlay leveling grid ─────────────────────────────────────
  overlayGridToggle: (): Promise<{ visible: boolean }> =>
    ipcRenderer.invoke(IPC.OVERLAY_GRID_TOGGLE),

  // ── On-air clock ──────────────────────────────────────────────
  overlayClockToggle: (): Promise<{ visible: boolean }> =>
    ipcRenderer.invoke(IPC.OVERLAY_CLOCK_TOGGLE),
  overlayClockUpdate: (updates: Partial<ClockState>): Promise<void> =>
    ipcRenderer.invoke(IPC.OVERLAY_CLOCK_UPDATE, updates),

  // ── Counter ───────────────────────────────────────────────────
  overlayCounterToggle: (): Promise<{ visible: boolean }> =>
    ipcRenderer.invoke(IPC.OVERLAY_COUNTER_TOGGLE),
  overlayCounterSet: (value: number, label?: string): Promise<void> =>
    ipcRenderer.invoke(IPC.OVERLAY_COUNTER_SET, value, label),
  overlayCounterBump: (delta: number): Promise<{ value: number }> =>
    ipcRenderer.invoke(IPC.OVERLAY_COUNTER_BUMP, delta),

  // ── Full-screen feature card ──────────────────────────────────
  overlayFeatureShow: (data: Partial<FeatureCardState>): Promise<void> =>
    ipcRenderer.invoke(IPC.OVERLAY_FEATURE_SHOW, data),
  overlayFeatureUpNext: (kicker?: string): Promise<{ fired: boolean }> =>
    ipcRenderer.invoke(IPC.OVERLAY_FEATURE_UP_NEXT, kicker),
  overlayFeatureThatWas: (kicker?: string): Promise<{ fired: boolean }> =>
    ipcRenderer.invoke(IPC.OVERLAY_FEATURE_THAT_WAS, kicker),
  overlayFeatureHide: (): Promise<void> =>
    ipcRenderer.invoke(IPC.OVERLAY_FEATURE_HIDE),

  // ── Operator chat ─────────────────────────────────────────────
  chatGetState: () => ipcRenderer.invoke(IPC.CHAT_GET_STATE),
  chatReconfigure: () => ipcRenderer.invoke(IPC.CHAT_RECONFIGURE),
  chatSend: (text: string, author?: string) => ipcRenderer.invoke(IPC.CHAT_SEND, text, author),
  chatPin: (id: string) => ipcRenderer.invoke(IPC.CHAT_PIN, id),
  chatUnpin: (id: string) => ipcRenderer.invoke(IPC.CHAT_UNPIN, id),
  chatFireMessage: (id: string) => ipcRenderer.invoke(IPC.CHAT_FIRE_MESSAGE, id),

  // ── Operator chat moderation ──────────────────────────────────
  chatHide: (id: string) => ipcRenderer.invoke(IPC.CHAT_HIDE, id),
  chatBanAuthor: (author: string) => ipcRenderer.invoke(IPC.CHAT_BAN_AUTHOR, author),
  chatUnbanAuthor: (author: string) => ipcRenderer.invoke(IPC.CHAT_UNBAN_AUTHOR, author),
  chatLivestreamPin: (id: string) => ipcRenderer.invoke(IPC.CHAT_LIVESTREAM_PIN, id),
  chatLivestreamUnpin: (id: string) => ipcRenderer.invoke(IPC.CHAT_LIVESTREAM_UNPIN, id),

  // ── CC→BB live relay ──────────────────────────────────────────
  ccRelayGetState: () => ipcRenderer.invoke(IPC.CC_RELAY_GET_STATE),
  ccRelayApplyOverlayConfig: (cfg: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC.CC_RELAY_APPLY_OVERLAY_CONFIG, cfg),

  // ── Operator day checklist (start-of-day / end-of-day) ────────
  dayChecklistGet: (date: string, kind: 'start' | 'end') => ipcRenderer.invoke(IPC.DAY_CHECKLIST_GET, date, kind),
  dayChecklistSetItem: (date: string, kind: 'start' | 'end', itemId: string, value: string) =>
    ipcRenderer.invoke(IPC.DAY_CHECKLIST_SET_ITEM, date, kind, itemId, value),
  dayChecklistDismiss: (date: string, kind: 'start' | 'end') => ipcRenderer.invoke(IPC.DAY_CHECKLIST_DISMISS, date, kind),
  dayChecklistReopen: (kind: 'start' | 'end') => ipcRenderer.invoke(IPC.DAY_CHECKLIST_REOPEN, kind),
  dayChecklistShouldShow: () => ipcRenderer.invoke(IPC.DAY_CHECKLIST_SHOULD_SHOW),

  // ── Operator event log / telemetry ────────────────────────────
  eventsGetRecent: (limit?: number, kind?: string) =>
    ipcRenderer.invoke(IPC.EVENTS_GET_RECENT, limit, kind),

  // ── Crash recovery ────────────────────────────────────────────
  recoveryCheck: () => ipcRenderer.invoke(IPC.RECOVERY_CHECK),
  recoveryRestore: () => ipcRenderer.invoke(IPC.RECOVERY_RESTORE),
  recoveryDismiss: () => ipcRenderer.invoke(IPC.RECOVERY_DISMISS),

  // ── Startup checks ────────────────────────────────────────────
  startupGetReport: () => ipcRenderer.invoke(IPC.STARTUP_GET_REPORT),

  // ── Settings backup ───────────────────────────────────────────
  backupNow: () => ipcRenderer.invoke(IPC.BACKUP_NOW),
  backupList: () => ipcRenderer.invoke(IPC.BACKUP_LIST),
  backupRestore: (file: string) => ipcRenderer.invoke(IPC.BACKUP_RESTORE, file),

  // ── Overlay Mode (frameless floating panels over OBS) ─────────
  overlayModeOpen: () => ipcRenderer.invoke(IPC.OVERLAY_MODE_OPEN),
  overlayModeClose: () => ipcRenderer.invoke(IPC.OVERLAY_MODE_CLOSE),
  overlayModeToggle: () => ipcRenderer.invoke(IPC.OVERLAY_MODE_TOGGLE),
  overlayModeHidePanel: (panelId: string) => ipcRenderer.invoke(IPC.OVERLAY_MODE_HIDE_PANEL, panelId),

  // ── Event listeners (main → renderer) ─────────────────────────
  on: (channel: string, cb: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => cb(...args))
  },
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel)
  },
})
