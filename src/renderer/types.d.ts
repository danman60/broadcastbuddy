import type { Trigger, OverlayStyling, OverlayState, AppSettings, Session, LoopMode, SlowZoomStatus, ChatState } from '../shared/types'

interface ElectronAPI {
  // Overlay
  overlayFireLT: () => Promise<void>
  overlayHideLT: () => Promise<void>
  overlayGetState: () => Promise<OverlayState>
  overlayUpdateStyling: (updates: Partial<OverlayStyling>) => Promise<void>
  overlaySetLogos: (company: string, client: string) => Promise<void>

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
  importDocument: (filePath?: string) => Promise<{
    triggers: Trigger[]
    fileName: string
  }>

  // Brand scraper
  brandScrape: (url: string) => Promise<{
    colors: string[]
    fonts: string[]
    logoUrl: string | null
    siteName: string
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

  // Operator chat
  chatGetState: () => Promise<ChatState>
  chatReconfigure: () => Promise<ChatState>
  chatSend: (text: string, author?: string) => Promise<{ ok: boolean }>
  chatPin: (id: string) => Promise<{ ok: boolean }>
  chatUnpin: (id: string) => Promise<{ ok: boolean }>
  chatFireMessage: (id: string) => Promise<{ fired: boolean }>

  // Events
  on: (channel: string, cb: (...args: unknown[]) => void) => void
  removeAllListeners: (channel: string) => void
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
