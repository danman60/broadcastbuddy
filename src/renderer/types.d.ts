import type { Trigger, OverlayStyling, OverlayState, AppSettings, Session, LoopMode, SlowZoomStatus, ChatState, CcRelayState, RecordState, EventLogRecord, EventLogKind, RecoveryStatus, StartupReport, BackupInfo, ClockState, FeatureCardState, StartingSoonState, DayChecklistKind, DayChecklistItemState, DayChecklistView, StreamConfig, Note, MonitorInfo, WifiDisplayState, BroadcastPackage, CCEvent, CCChecklistItem, ExtractionResult, GalleryConfig, PhotoMatch, RoutineBoundary, StreamState, SystemStats, StreamDeckStatus } from '../shared/types'

interface ElectronAPI {
  // Overlay
  overlayFireLT: () => Promise<void>
  overlayHideLT: () => Promise<void>
  overlayFireAdhoc: (title: string, subtitle?: string) => Promise<{ title: string; subtitle: string; at: number } | null>
  overlayGetLastAdhoc: () => Promise<{ title: string; subtitle: string; at: number } | null>
  overlayGetState: () => Promise<OverlayState>
  overlayUpdateStyling: (updates: Partial<OverlayStyling>) => Promise<void>
  overlaySetLogos: (company: string, client: string) => Promise<void>
  overlaySetFeatureCardLogo: (dataUrl: string) => Promise<void>
  overlayGetFeatureCardLogo: () => Promise<string>

  // Triggers
  triggerList: () => Promise<{ triggers: Trigger[]; selectedIndex: number }>
  triggerAdd: (trigger: Trigger) => Promise<Trigger[]>
  triggerUpdate: (id: string, updates: Partial<Trigger>) => Promise<Trigger[]>
  triggerDelete: (id: string) => Promise<Trigger[]>
  triggerReorder: (ids: string[]) => Promise<Trigger[]>
  triggerSelect: (index: number) => Promise<void>
  triggerNext: () => Promise<void>
  triggerPrev: () => Promise<void>
  triggerNextFull: () => Promise<void>
  triggerSetLogo: (id: string) => Promise<string | null>

  // Playlist
  playlistAutoFireToggle: () => Promise<boolean>
  playlistGetStatus: () => Promise<{
    current: number
    total: number
    autoFire: boolean
    upNext: Trigger | null
    playedIds: string[]
    loopMode: LoopMode
  }>
  playlistSetLoopMode: (mode: LoopMode) => Promise<void>
  playlistResetPosition: () => Promise<void>
  playlistClearPlayed: () => Promise<void>

  // Trigger bulk
  triggerClearAll: () => Promise<void>

  // Session
  sessionNew: (name: string, preserveTriggers?: boolean) => Promise<Session>
  sessionSave: () => Promise<Session | null>
  sessionLoad: (id: string) => Promise<Session | null>
  sessionList: () => Promise<Array<{ id: string; name: string; updatedAt: string }>>
  sessionGetCurrent: () => Promise<Session | null>

  // Settings
  settingsGet: () => Promise<AppSettings>
  settingsSet: (key: string, value: unknown) => Promise<AppSettings>
  settingsBrowseFile: (filters?: Array<{ name: string; extensions: string[] }>) => Promise<string | null>

  // Logo
  logoBrowse: () => Promise<string | null>

  // Starting Soon
  startingSoonShow: () => Promise<void>
  startingSoonHide: () => Promise<void>
  startingSoonUpdate: (updates: Partial<StartingSoonState>) => Promise<void>

  // Ticker
  tickerShow: (text: string, speed?: number, bgColor?: string, textColor?: string) => Promise<void>
  tickerHide: () => Promise<void>
  tickerUpdate: (updates: Record<string, unknown>) => Promise<void>

  // Document import
  importBrowse: () => Promise<string | null>
  importPreview: (filePath: string) => Promise<{
    fileName: string
    pageCount: number
    textPreview: string
    textLength: number
  }>
  // Runtime returns ExtractionResult (rawFields/sampleData/suggestedMappings).
  // triggers/fileName are read defensively by the renderer but are NOT produced
  // by the current main handler — hence optional.
  importDocument: (filePath?: string) => Promise<ExtractionResult & {
    triggers?: Trigger[]
    fileName?: string
  }>

  // Brand scraper
  brandScrape: (url: string) => Promise<{
    colors: string[]
    fonts: string[]
    logoUrl: string | null
    siteName: string
    aiSuggestion?: string
  }>
  brandScrapeAI: (url: string) => Promise<{
    colors: string[]
    fonts: string[]
    logoUrl: string | null
    siteName: string
    aiSuggestion?: string
  }>

  // Window
  windowResize: (width: number, height: number) => Promise<void>

  // OBS Recording control
  obsStartRecord: () => Promise<{ success: boolean; error?: string }>
  obsStopRecord: () => Promise<{ success: boolean; outputPath?: string; error?: string }>
  obsToggleRecord: () => Promise<{ success: boolean; active?: boolean; error?: string }>
  obsRecordStatus: () => Promise<RecordState>

  // OBS stream control + replay buffer
  obsStartStream: () => Promise<{ success: boolean; error?: string }>
  obsStopStream: () => Promise<{ success: boolean; error?: string }>
  obsSaveReplay: () => Promise<{ success: boolean; error?: string }>
  obsStreamStatus: () => Promise<StreamState>

  // System monitor
  systemGetStats: () => Promise<SystemStats>

  // Stream Deck plugin installer
  streamdeckGetStatus: () => Promise<StreamDeckStatus>
  streamdeckInstallPlugin: () => Promise<{ ok: boolean; filesCopied?: number; target?: string; error?: string }>

  // OBS Slow Zoom
  obsSlowZoomTriggerWide: () => Promise<SlowZoomStatus>
  obsSlowZoomTriggerTight: () => Promise<SlowZoomStatus>
  obsSlowZoomStatus: () => Promise<SlowZoomStatus>

  // OBS Transition auto-revert
  obsTransitionRevertGet: () => Promise<{ enabled: boolean }>
  obsTransitionRevertSet: (enabled: boolean) => Promise<{ enabled: boolean }>

  // Up Next / That Was
  overlayFireUpNext: (label?: string) => Promise<{ fired: boolean }>
  overlayFireThatWas: (label?: string) => Promise<{ fired: boolean }>

  // Overlay leveling grid
  overlayGridToggle: () => Promise<{ visible: boolean }>

  // On-air clock
  overlayClockToggle: () => Promise<{ visible: boolean }>
  overlayClockUpdate: (updates: Partial<ClockState>) => Promise<void>

  // Counter
  overlayCounterToggle: () => Promise<{ visible: boolean }>
  overlayCounterSet: (value: number, label?: string) => Promise<void>
  overlayCounterBump: (delta: number) => Promise<{ value: number }>

  // Full-screen feature card
  overlayFeatureShow: (data: Partial<FeatureCardState>) => Promise<void>
  overlayFeatureUpNext: (kicker?: string) => Promise<{ fired: boolean }>
  overlayFeatureThatWas: (kicker?: string) => Promise<{ fired: boolean }>
  overlayFeatureHide: () => Promise<void>

  // Operator chat
  chatGetState: () => Promise<ChatState>
  chatReconfigure: () => Promise<ChatState>
  chatSend: (text: string, author?: string) => Promise<{ ok: boolean }>
  chatPin: (id: string) => Promise<{ ok: boolean }>
  chatUnpin: (id: string) => Promise<{ ok: boolean }>
  chatFireMessage: (id: string) => Promise<{ fired: boolean }>

  // Operator chat moderation
  chatHide: (id: string) => Promise<{ ok: boolean }>
  chatBanAuthor: (author: string) => Promise<{ ok: boolean; bannedAuthors: string[] }>
  chatUnbanAuthor: (author: string) => Promise<{ ok: boolean; bannedAuthors: string[] }>
  chatLivestreamPin: (id: string) => Promise<{ ok: boolean }>
  chatLivestreamUnpin: (id: string) => Promise<{ ok: boolean }>

  // CC→BB live relay
  ccRelayGetState: () => Promise<CcRelayState>
  ccRelayApplyOverlayConfig: (cfg: Record<string, unknown>) => Promise<{ success: boolean }>

  // Operator day checklist (start-of-day / end-of-day)
  dayChecklistGet: (date: string, kind: DayChecklistKind) => Promise<DayChecklistView>
  dayChecklistSetItem: (date: string, kind: DayChecklistKind, itemId: string, value: DayChecklistItemState) => Promise<DayChecklistView>
  dayChecklistDismiss: (date: string, kind: DayChecklistKind) => Promise<DayChecklistView>
  dayChecklistReopen: (kind: DayChecklistKind) => Promise<DayChecklistView>
  dayChecklistShouldShow: () => Promise<{ should: boolean; date: string }>

  // Operator event log / telemetry
  eventsGetRecent: (limit?: number, kind?: EventLogKind) => Promise<EventLogRecord[]>

  // Crash recovery
  recoveryCheck: () => Promise<RecoveryStatus>
  recoveryRestore: () => Promise<{ restored: boolean }>
  recoveryDismiss: () => Promise<{ ok: boolean }>

  // Startup checks
  startupGetReport: () => Promise<StartupReport | null>

  // Settings backup
  backupNow: () => Promise<{ ok: boolean; file?: string; error?: string }>
  backupList: () => Promise<BackupInfo[]>
  backupRestore: (file: string) => Promise<{ ok: boolean; error?: string }>

  // Stream config
  streamConfigGet: () => Promise<StreamConfig | null>
  streamConfigSet: (config: StreamConfig) => Promise<void>

  // Notes
  notesList: () => Promise<Note[]>
  notesAdd: (text: string) => Promise<Note>
  notesDelete: (id: string) => Promise<void>

  // OBS connection
  obsConnect: (host: string, port: number, password?: string) => Promise<{ connected: boolean; error?: string }>
  obsDisconnect: () => Promise<void>
  obsStatus: () => Promise<{ connected: boolean }>
  obsGetTimecode: () => Promise<string>
  obsPushStreamKey: (rtmpUrl: string, streamKey: string) => Promise<{ success: boolean; error?: string }>
  obsGetLastRecording: () => Promise<{ success: boolean; path?: string; error?: string }>
  recordingBrowse: () => Promise<string | null>

  // Command Center broadcast package
  ccFetchEvents: (baseUrl: string, apiKey: string, tenantId: string) => Promise<{ success: boolean; events: CCEvent[]; error?: string }>
  ccFetchPackage: (baseUrl: string, apiKey: string, tenantId: string, eventId: string) => Promise<{ success: boolean; package?: BroadcastPackage; error?: string }>
  ccApplyPackage: (pkg: BroadcastPackage, eventId?: string) => Promise<{ success: boolean; triggerCount?: number; error?: string }>
  ccUploadRecording: (baseUrl: string, apiKey: string, tenantId: string, eventId: string, filePath: string, fileName?: string) => Promise<{ success: boolean; file?: { webViewLink?: string } & Record<string, unknown>; error?: string }>
  ccFetchChecklist: (baseUrl: string, apiKey: string, tenantId: string, eventId: string) => Promise<{ success: boolean; checklist: CCChecklistItem[]; error?: string }>
  ccSyncChecklist: (baseUrl: string, apiKey: string, tenantId: string, eventId: string, items: Array<{ id: string; checked: boolean }>) => Promise<{ success: boolean; updated?: number; error?: string }>
  ccSaveOverlayConfig: (baseUrl: string, apiKey: string, tenantId: string, eventId: string, config: object) => Promise<{ success: boolean; error?: string }>

  // Gallery / Photo sorting
  galleryBrowseVideo: () => Promise<string | null>
  galleryBrowseVideos: () => Promise<string[] | null>
  galleryBrowsePhotos: () => Promise<string | null>
  galleryAnalyzeVideo: (videoPath: string, geminiApiKey: string) => Promise<{ success: boolean; boundaries: RoutineBoundary[]; error?: string }>
  galleryTranscribe: (videoPaths: string[]) => Promise<{ success: boolean; boundaries: RoutineBoundary[]; error?: string }>
  galleryReadExif: (folderPath?: string) => Promise<{ success: boolean; count?: number; error?: string }>
  galleryMatchPhotos: (manualOffsetMs?: number) => Promise<{ success: boolean; matches: PhotoMatch[]; error?: string }>
  gallerySetOffset: (offsetMs: number) => Promise<void>
  galleryGetConfig: () => Promise<GalleryConfig>
  galleryUploadToCC: (title: string) => Promise<{ success: boolean; galleryUrl?: string; error?: string }>
  galleryUploadR2: (folderPath: string, gallerySlug: string) => Promise<{ success: boolean; error?: string }>

  // WiFi display (tablet stream)
  wifiDisplayGetMonitors: () => Promise<MonitorInfo[]>
  wifiDisplayStart: () => Promise<WifiDisplayState & { error?: string }>
  wifiDisplayStop: () => Promise<WifiDisplayState>
  wifiDisplayStatus: () => Promise<WifiDisplayState>
  wifiDisplaySetMonitor: (monitorIndex: number | null) => Promise<WifiDisplayState>
  wifiDisplayPingTablet: () => Promise<{ ok: boolean }>

  // Overlay Mode (frameless floating panels over OBS)
  overlayModeOpen: () => Promise<{ ok?: boolean; error?: string }>
  overlayModeClose: () => Promise<{ ok?: boolean; error?: string }>
  overlayModeToggle: () => Promise<{ ok?: boolean; open?: boolean; error?: string }>
  overlayModeHidePanel: (panelId: string) => Promise<{ ok?: boolean; error?: string }>

  // Events
  on: (channel: string, cb: (...args: unknown[]) => void) => void
  removeAllListeners: (channel: string) => void
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
