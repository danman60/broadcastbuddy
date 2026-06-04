/**
 * Overlay Mode — frameless always-on-top floating panels that sit over OBS
 * during a show.
 *
 * Operator toggles Overlay Mode (Tools ▼ → Overlay Mode) → main window hides →
 * we spawn a set of tiny frameless always-on-top BrowserWindows, each rendering
 * one BB control surface via the secondary renderer entry (panel.html?panel=<id>).
 * Clicking "Exit Overlay" on the System panel restores the main window.
 *
 * Not related to the streaming "overlay" (lower-thirds, ports 19080/19081) in
 * overlay.ts — the shared "overlay" word is coincidental.
 *
 * Ported from CompSyncElectronApp/src/main/services/overlayPanels.ts.
 */

import { BrowserWindow, app } from 'electron'
import path from 'path'
import fs from 'fs'
import { createLogger } from '../logger'

const logger = createLogger('overlayPanels')

export type PanelId = 'overlays' | 'adhoc' | 'chat' | 'system'

interface PanelBounds { x?: number; y?: number; width: number; height: number }
interface PanelSpec { id: PanelId; default: PanelBounds; minWidth: number; minHeight: number }

const PANEL_SPECS: PanelSpec[] = [
  { id: 'overlays', default: { width: 360, height: 420 }, minWidth: 280, minHeight: 220 },
  { id: 'adhoc',    default: { width: 360, height: 200 }, minWidth: 280, minHeight: 140 },
  { id: 'chat',     default: { width: 340, height: 420 }, minWidth: 260, minHeight: 200 },
  { id: 'system',   default: { width: 280, height: 200 }, minWidth: 220, minHeight: 140 },
]

const panels = new Map<PanelId, BrowserWindow>()
let mainWindowRef: BrowserWindow | null = null

function stateFilePath(id: PanelId): string {
  return path.join(app.getPath('userData'), `panel-${id}.json`)
}

function loadBounds(id: PanelId, fallback: PanelBounds): PanelBounds {
  try {
    const raw = fs.readFileSync(stateFilePath(id), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<PanelBounds>
    if (
      typeof parsed.width === 'number' && typeof parsed.height === 'number' &&
      parsed.width >= 100 && parsed.height >= 60
    ) {
      return {
        x: typeof parsed.x === 'number' ? parsed.x : undefined,
        y: typeof parsed.y === 'number' ? parsed.y : undefined,
        width: parsed.width,
        height: parsed.height,
      }
    }
  } catch {
    // missing / corrupt — fall through to default
  }
  return fallback
}

function saveBounds(id: PanelId, win: BrowserWindow): void {
  if (win.isDestroyed()) return
  try {
    const b = win.getBounds()
    fs.writeFileSync(stateFilePath(id), JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height }))
  } catch (err) {
    logger.warn(`failed to save bounds for ${id}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function panelUrl(id: PanelId): string {
  if (process.env['ELECTRON_RENDERER_URL']) {
    // electron-vite dev server: panel.html is a sibling of index.html at the root.
    return `${process.env['ELECTRON_RENDERER_URL']}/panel.html?panel=${id}`
  }
  // Packaged: electron-vite emits to out/renderer/. panel.html is a sibling of
  // index.html. __dirname at runtime is out/main/; renderer sits at out/renderer/.
  const filePath = path.join(__dirname, '../renderer/panel.html')
  return `file://${filePath}?panel=${id}`
}

function createPanel(spec: PanelSpec): BrowserWindow {
  const bounds = loadBounds(spec.id, spec.default)

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: spec.minWidth,
    minHeight: spec.minHeight,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    backgroundColor: '#1e1e2e',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  const url = panelUrl(spec.id)
  if (url.startsWith('file://')) {
    const [filePath, query] = url.replace('file://', '').split('?')
    win.loadFile(filePath, { search: query ? `?${query}` : undefined })
  } else {
    win.loadURL(url)
  }

  win.webContents.on('render-process-gone', (_event, details) => {
    logger.error(`renderer gone for ${spec.id}: reason=${details.reason}, exitCode=${details.exitCode}`)
  })

  win.once('ready-to-show', () => win.show())

  const onChanged = (): void => saveBounds(spec.id, win)
  win.on('moved', onChanged)
  win.on('resized', onChanged)

  win.on('closed', () => {
    panels.delete(spec.id)
  })

  return win
}

export function isOpen(): boolean {
  return panels.size > 0
}

export function openAll(mainWindow: BrowserWindow): void {
  if (panels.size > 0) {
    logger.warn('openAll called while panels already open; ignoring')
    return
  }
  mainWindowRef = mainWindow
  logger.info(`opening ${PANEL_SPECS.length} panels`)

  for (const spec of PANEL_SPECS) {
    try {
      const win = createPanel(spec)
      panels.set(spec.id, win)
    } catch (err) {
      logger.error(`failed to create ${spec.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  try { mainWindow.hide() } catch { /* best-effort */ }
}

// Final-chance save if the app is quitting while panels are still open.
// 'moved'/'resized' handle in-session updates; this handles the quit path.
let beforeQuitHooked = false
function ensureBeforeQuitHook(): void {
  if (beforeQuitHooked) return
  beforeQuitHooked = true
  app.on('before-quit', () => {
    for (const [id, win] of panels.entries()) {
      try { saveBounds(id, win) } catch { /* best-effort */ }
    }
  })
}
ensureBeforeQuitHook()

export function closeAll(): void {
  if (panels.size === 0 && !mainWindowRef) return
  logger.info('closing all panels')

  for (const [id, win] of panels.entries()) {
    try {
      saveBounds(id, win)
      if (!win.isDestroyed()) win.close()
    } catch (err) {
      logger.warn(`close error for ${id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  panels.clear()

  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    try {
      mainWindowRef.show()
      mainWindowRef.focus()
    } catch { /* best-effort */ }
  }
  mainWindowRef = null
}

export function hidePanel(id: PanelId): void {
  const win = panels.get(id)
  if (!win) return
  try {
    saveBounds(id, win)
    if (!win.isDestroyed()) win.close()
  } catch (err) {
    logger.warn(`hide error for ${id}: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (panels.size <= 1 && mainWindowRef && !mainWindowRef.isDestroyed()) {
    try {
      mainWindowRef.show()
      mainWindowRef.focus()
    } catch { /* best-effort */ }
    mainWindowRef = null
  }
}

export function toggle(mainWindow: BrowserWindow): void {
  if (isOpen()) closeAll()
  else openAll(mainWindow)
}
