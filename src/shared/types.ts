// ── Playlist Types ──────────────────────────────────────────────

export type LoopMode = 'none' | 'loop' | 'ping-pong'
export type ImportMode = 'replace' | 'append'

// ── Trigger (a single overlay entry) ──────────────────────────────

export interface Trigger {
  id: string
  name: string // display label in the trigger list
  title: string // primary line on the lower third (e.g. song name, speaker name)
  subtitle: string // secondary line on the lower third (e.g. dancers, company/role)
  category: string // grouping label (optional)
  order: number // sort position
  logoDataUrl: string // per-entry logo (base64 data URL, optional)
}

// ── Overlay Styling ──────────────────────────────────────────────

export type BackgroundStyle = 'solid' | 'gradient' | 'glass' | 'accent-bar'
export type AnimationType = 'slide' | 'fade' | 'zoom' | 'rise' | 'typewriter' | 'bounce' | 'split' | 'blur' | 'sparkle' | 'random'
export type EasingType = 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'linear' | 'bounce' | 'elastic'

export interface ElementPosition {
  x: number // % from left (0-100)
  y: number // % from top (0-100)
  width?: number // % width
  height?: number // % height
}

export interface OverlayLayout {
  lowerThird: ElementPosition
  companyLogo: ElementPosition
  clientLogo: ElementPosition
  ticker: ElementPosition
}

export const DEFAULT_LAYOUT: OverlayLayout = {
  lowerThird: { x: 3.1, y: 85 },
  companyLogo: { x: 2.1, y: 2.8 },
  clientLogo: { x: 87.9, y: 2.8 },
  ticker: { x: 0, y: 96.3, width: 100 },
}

export interface OverlayStyling {
  fontFamily: string
  fontSize: number // px
  fontWeight: number // 400 | 600 | 700 | 800
  textColor: string // hex
  backgroundColor: string // hex
  backgroundStyle: BackgroundStyle
  accentColor: string // hex
  borderRadius: number // px
  animation: AnimationType
  animationDuration: number // seconds
  animationEasing: EasingType
  autoHideSeconds: number // 0 = manual hide only
  layout?: OverlayLayout
}

// ── Stream Config ────────────────────────────────────────────────

export interface StreamConfig {
  streamKey: string
  rtmpUrl: string
  viewingLink: string
  embedCode: string
  chatLink: string
}

// ── Notes ────────────────────────────────────────────────────────

export interface Note {
  id: string
  text: string
  timestamp: string // wall clock ISO
  obsTimecode: string // HH:MM:SS from OBS recording, or empty
  createdAt: string
}

// ── Starting Soon ────────────────────────────────────────────────

export interface StartingSoonState {
  visible: boolean
  title: string
  subtitle: string
  countdownTarget: string // ISO date or empty
  countdownSeconds: number // exact seconds for countdown (alternative to target)
  showCountdown: boolean
  completionText: string // shown when countdown reaches 0
  backgroundColor: string
  textColor: string
  accentColor: string
}

// ── Overlay State (pushed to browser source) ─────────────────────

export interface OverlayState {
  lowerThird: {
    visible: boolean
    name: string
    title: string
    subtitle: string
    styling: OverlayStyling
  }
  companyLogo: {
    visible: boolean
    dataUrl: string // base64 data URL or empty
  }
  clientLogo: {
    visible: boolean
    dataUrl: string
  }
  ticker: {
    visible: boolean
    text: string
    speed: number // pixels per second
    backgroundColor: string
    textColor: string
  }
  startingSoon: StartingSoonState
}

// ── Session (saved/loaded as JSON) ───────────────────────────────

export interface Session {
  id: string
  name: string
  triggers: Trigger[]
  styling: OverlayStyling
  companyLogoDataUrl: string
  clientLogoDataUrl: string
  selectedIndex?: number
  playedIds?: string[]
  loopMode?: LoopMode
  streamConfig?: StreamConfig
  notes?: Note[]
  createdAt: string // ISO date
  updatedAt: string // ISO date
}

// ── Field Mapping Types ─────────────────────────────────────────

export interface LLMExtractedField {
  name: string
  value: string
  confidence?: number
}

export type TransformType = 'concat' | 'extract' | 'split' | 'format' | 'none'

export interface TransformConfig {
  type: TransformType
  params: Record<string, unknown>
}

export interface FieldMapping {
  sourceIds: string[]
  targetId: 'name' | 'title' | 'subtitle' | 'category' | 'logoDataUrl'
  transform: TransformConfig
}

export interface MappingPreset {
  id: string
  name: string
  mappings: FieldMapping[]
  autoMapPatterns?: Record<string, string[]>
}

export interface ExtractionResult {
  rawFields: LLMExtractedField[]
  sampleData: Record<string, string>[]
  suggestedMappings?: FieldMapping[]
}

// ── App Settings (persisted via electron-store) ──────────────────

export interface AppSettings {
  server: {
    httpPort: number
    wsPort: number
  }
  overlay: OverlayStyling
  companyLogoPath: string
  deepseekApiKey: string
  geminiApiKey: string
  sessionsDir: string
  mappingPresets?: MappingPreset[]
  compactMode?: boolean
  streamConfig?: StreamConfig
  obsConnection?: {
    host: string
    port: number
    password: string
  }
  ccConfig?: {
    baseUrl: string
    apiKey: string
    tenantId: string
  }
}

// ── Checklist Item (from Command Center) ─────────────────────────

export interface CCChecklistItem {
  id: string
  label: string
  checked: boolean
  category: string
  sortOrder: number
}

// ── Broadcast Package (from Command Center) ──────────────────────

export interface BroadcastPackage {
  eventId: string
  version: string
  generatedAt: string
  event: {
    eventName: string
    eventType: string
    venueName: string
    eventDate: string
  }
  client: {
    organization: string
    brandColor: string | null
    logoUrl?: string | null
  }
  company: {
    name: string | null
    logoUrl: string | null
    primaryColor: string | null
    secondaryColor: string | null
  }
  triggers: Array<{
    type: 'title_card' | 'lower_third'
    name: string
    subtitle?: string
    logoUrl?: string | null
    shiftName?: string
  }>
  checklist: CCChecklistItem[]
  overlayConfig: Record<string, unknown> | null
  streaming: {
    streamKey: string | null
    rtmpUrl: string | null
    livestreamUrl: string | null
    embedCode: string | null
  }
  drive?: {
    eventFolderId: string | null
    eventFolderUrl: string | null
    clientFolderId: string | null
    clientFolderUrl: string | null
  }
}

export interface CCEvent {
  id: string
  eventName: string
  eventType: string
  venueName: string
  loadInTime: string
  status: string
  client: { organization: string }
}

// ── IPC Channels ─────────────────────────────────────────────────

export const IPC = {
  // Overlay control
  OVERLAY_FIRE_LT: 'overlay:fire-lt',
  OVERLAY_HIDE_LT: 'overlay:hide-lt',
  OVERLAY_GET_STATE: 'overlay:get-state',
  OVERLAY_UPDATE_STYLING:'overlay:update-styling',
  OVERLAY_SET_LOGOS: 'overlay:set-logos',

  // Trigger management
  TRIGGER_LIST: 'trigger:list',
  TRIGGER_ADD: 'trigger:add',
  TRIGGER_UPDATE: 'trigger:update',
  TRIGGER_DELETE: 'trigger:delete',
  TRIGGER_REORDER: 'trigger:reorder',
  TRIGGER_SELECT: 'trigger:select',
  TRIGGER_NEXT: 'trigger:next',
  TRIGGER_PREV: 'trigger:prev',
  TRIGGER_NEXT_FULL: 'trigger:next-full',
  TRIGGER_SET_LOGO: 'trigger:set-logo',

  // Playlist
  PLAYLIST_AUTO_FIRE: 'playlist:auto-fire-toggle',
  PLAYLIST_GET_STATUS: 'playlist:get-status',
  PLAYLIST_SET_LOOP_MODE:'playlist:set-loop-mode',
  PLAYLIST_RESET_POSITION:'playlist:reset-position',
  PLAYLIST_CLEAR_PLAYED: 'playlist:clear-played',

  // Trigger bulk
  TRIGGER_CLEAR_ALL: 'trigger:clear-all',

  // Session management
  SESSION_NEW: 'session:new',
  SESSION_SAVE: 'session:save',
  SESSION_LOAD: 'session:load',
  SESSION_LIST: 'session:list',
  SESSION_GET_CURRENT: 'session:get-current',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_BROWSE_FILE: 'settings:browse-file',

  // Logo
  LOGO_BROWSE: 'logo:browse',

  // Document import
  IMPORT_BROWSE: 'import:browse',
  IMPORT_PREVIEW: 'import:preview',
  IMPORT_DOCUMENT: 'import:document',
  IMPORT_APPLY_MAPPING: 'import:apply-mapping',
  IMPORT_SAVE_PRESET: 'import:save-preset',
  IMPORT_LOAD_PRESET: 'import:load-preset',

  // Ticker
  TICKER_SHOW: 'ticker:show',
  TICKER_HIDE: 'ticker:hide',
  TICKER_UPDATE: 'ticker:update',

  // Brand scraper
  BRAND_SCRAPE: 'brand:scrape',
  BRAND_SCRAPE_AI: 'brand:scrape-ai',

  // Window
  WINDOW_RESIZE: 'window:resize',

  // Stream config
  STREAM_CONFIG_GET: 'stream:config-get',
  STREAM_CONFIG_SET: 'stream:config-set',

  // Notes
  NOTES_LIST: 'notes:list',
  NOTES_ADD: 'notes:add',
  NOTES_DELETE: 'notes:delete',

  // OBS connection
  OBS_CONNECT: 'obs:connect',
  OBS_DISCONNECT: 'obs:disconnect',
  OBS_STATUS: 'obs:status',
  OBS_GET_TIMECODE: 'obs:get-timecode',
  OBS_PUSH_STREAM_KEY: 'obs:push-stream-key',

  // Starting soon
  STARTING_SOON_SHOW: 'starting-soon:show',
  STARTING_SOON_HIDE: 'starting-soon:hide',
  STARTING_SOON_UPDATE: 'starting-soon:update',

  // Command Center broadcast package
  CC_FETCH_EVENTS: 'cc:fetch-events',
  CC_FETCH_PACKAGE: 'cc:fetch-package',
  CC_APPLY_PACKAGE: 'cc:apply-package',
  CC_UPLOAD_RECORDING: 'cc:upload-recording',
  CC_SYNC_CHECKLIST: 'cc:sync-checklist',
  CC_SAVE_OVERLAY_CONFIG: 'cc:save-overlay-config',
  CC_FETCH_CHECKLIST: 'cc:fetch-checklist',

  // OBS recording
  OBS_GET_LAST_RECORDING: 'obs:get-last-recording',
  RECORDING_BROWSE: 'recording:browse',

  // Gallery / Photo Sorting
  GALLERY_BROWSE_VIDEO: 'gallery:browse-video',
  GALLERY_BROWSE_PHOTOS: 'gallery:browse-photos',
  GALLERY_ANALYZE_VIDEO: 'gallery:analyze-video',
  GALLERY_READ_EXIF: 'gallery:read-exif',
  GALLERY_MATCH_PHOTOS: 'gallery:match-photos',
  GALLERY_SET_OFFSET: 'gallery:set-offset',
  GALLERY_GET_CONFIG: 'gallery:get-config',
  GALLERY_UPLOAD_TO_CC: 'gallery:upload-to-cc',
  GALLERY_PROGRESS: 'gallery:progress',

  // State sync (main - renderer push events)
  STATE_UPDATE: 'state:update',
  OVERLAY_STATE_UPDATE: 'overlay:state-update',
  TRIGGERS_UPDATED: 'triggers:updated',
  SESSION_UPDATED: 'session:updated',
} as const

// ── WebSocket Protocol ───────────────────────────────────────────

export interface WsIdentifyMessage {
  type: 'identify'
  client: 'overlay' | 'streamdeck' | 'external'
}

export interface WsStateMessage {
  type: 'state'
  overlay: OverlayState
  playlist?: {
    current: number
    total: number
    autoFire: boolean
    upNextTitle: string | null
    playedIds: string[]
    loopMode: LoopMode
  }
}

export interface WsCommandMessage {
  type: 'command'
  action: string
  data?: Record<string, unknown>
}

export interface WsBroadcastPackageMessage {
  type: 'broadcast_package'
  data: BroadcastPackage
}

export type WsMessage = WsIdentifyMessage | WsStateMessage | WsCommandMessage | WsBroadcastPackageMessage

// ── Gallery / Photo Sorting Types ────────────────────────────────

export interface RoutineBoundary {
  index: number // matches trigger order
  name: string // routine name from Gemini or trigger
  timestampStart: string // ISO date — start of routine in video
  timestampEnd: string // ISO date — end of routine in video
  videoOffsetStartSec: number // seconds from video start
  videoOffsetEndSec: number // seconds from video start
  description: string // Gemini's description (costume, group/solo, etc.)
  confidence: number // 0-1 Gemini confidence
}

export interface PhotoMatch {
  filePath: string
  thumbnailPath?: string
  captureTime: string // ISO — from EXIF
  confidence: 'exact' | 'gap' | 'unmatched'
  matchedRoutineIndex?: number // index into RoutineBoundary array
  uploaded: boolean
}

export interface GalleryConfig {
  eventId: string // CC event ID (if linked)
  galleryId?: string // CC gallery ID (after creation)
  galleryUrl?: string // public URL
  videoPath: string // OBS recording path
  photoFolderPath: string // SD card / photo folder
  clockOffsetMs: number // camera clock offset from system clock
  manualOffsetMs: number // user-provided offset override (e.g. -420000 for 7 min)
  routineBoundaries: RoutineBoundary[]
  photoMatches: PhotoMatch[]
  status: 'idle' | 'analyzing-video' | 'reading-exif' | 'matching' | 'uploading' | 'complete' | 'error'
  error?: string
}

export interface GalleryProgress {
  stage: GalleryConfig['status']
  message: string
  current: number
  total: number
}

// ── Defaults ─────────────────────────────────────────────────────

export const DEFAULT_STYLING: OverlayStyling = {
  fontFamily: "'Segoe UI', sans-serif",
  fontSize: 28,
  fontWeight: 600,
  textColor: '#ffffff',
  backgroundColor: '#1a1a2e',
  backgroundStyle: 'solid',
  accentColor: '#667eea',
  borderRadius: 8,
  animation: 'slide',
  animationDuration: 0.5,
  animationEasing: 'ease',
  autoHideSeconds: 8,
}

export const DEFAULT_STARTING_SOON: StartingSoonState = {
  visible: false,
  title: 'Starting Soon',
  subtitle: '',
  countdownTarget: '',
  countdownSeconds: 0,
  showCountdown: true,
  completionText: "We're Live!",
  backgroundColor: '#1a1a2e',
  textColor: '#ffffff',
  accentColor: '#667eea',
}

export const DEFAULT_OVERLAY_STATE: OverlayState = {
  lowerThird: {
    visible: false,
    name: '',
    title: '',
    subtitle: '',
    styling: { ...DEFAULT_STYLING },
  },
  companyLogo: { visible: false, dataUrl: '' },
  clientLogo: { visible: false, dataUrl: '' },
  ticker: { visible: false, text: '', speed: 60, backgroundColor: '#1a1a2e', textColor: '#ffffff' },
  startingSoon: { ...DEFAULT_STARTING_SOON },
}

export const DEFAULT_STREAM_CONFIG: StreamConfig = {
  streamKey: '',
  rtmpUrl: '',
  viewingLink: '',
  embedCode: '',
  chatLink: '',
}
