import type { Trigger, OverlayStyling, OverlayState, AppSettings, Session } from '../shared/types'

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

  // Session
  sessionNew: (name: string) => Promise<Session>
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

  // Events
  on: (channel: string, cb: (...args: unknown[]) => void) => void
  removeAllListeners: (channel: string) => void
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
