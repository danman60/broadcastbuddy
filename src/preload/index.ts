import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'
import type { Trigger, OverlayStyling } from '../shared/types'

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

  // ── Session management ────────────────────────────────────────
  sessionNew: (name: string) => ipcRenderer.invoke(IPC.SESSION_NEW, name),
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

  // ── Document import ────────────────────────────────────────────
  importBrowse: () => ipcRenderer.invoke(IPC.IMPORT_BROWSE),
  importPreview: (filePath: string) => ipcRenderer.invoke(IPC.IMPORT_PREVIEW, filePath),
  importDocument: (filePath?: string) => ipcRenderer.invoke(IPC.IMPORT_DOCUMENT, filePath),

  // ── Brand scraper ──────────────────────────────────────────────
  brandScrape: (url: string) => ipcRenderer.invoke(IPC.BRAND_SCRAPE, url),
  brandScrapeAI: (url: string) => ipcRenderer.invoke(IPC.BRAND_SCRAPE_AI, url),

  // ── Event listeners (main → renderer) ─────────────────────────
  on: (channel: string, cb: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => cb(...args))
  },
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel)
  },
})
