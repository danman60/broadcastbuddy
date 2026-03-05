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
  sessionsDir: string
  mappingPresets?: MappingPreset[]
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

export type WsMessage = WsIdentifyMessage | WsStateMessage | WsCommandMessage

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
}
