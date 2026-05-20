import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import * as settings from './services/settings'
import * as overlay from './services/overlay'
import * as wsHub from './services/wsHub'
import * as wifiDisplay from './services/wifiDisplay'
import * as obsConnection from './services/obsConnection'
import * as slowZoom from './services/slowZoom'
import * as chatBridge from './services/chatBridge'
import { startTabletLogServer, stopTabletLogServer } from './services/tabletLogServer'
import { registerIpcHandlers } from './ipc'
import { createLogger } from './logger'
import { IPC } from '../shared/types'

const logger = createLogger('main')

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    title: 'BroadcastBuddy',
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Load renderer
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  logger.info('BroadcastBuddy starting...')

  // Reap orphaned wifi-display process from a previous crash before anything
  // else binds the discovery port.
  wifiDisplay.killOrphanedProcess()

  // 1. Load settings
  const serverConfig = settings.get('server')
  const overlayStyling = settings.get('overlay')

  // 2. Initialize overlay with saved styling
  overlay.updateStyling(overlayStyling)

  // 3. Register IPC handlers
  registerIpcHandlers()

  // 4. Create window
  createWindow()

  // 5. Start HTTP server (overlay page)
  overlay.startServer(serverConfig.httpPort)

  // 6. Start WebSocket hub
  wsHub.start(serverConfig.wsPort)

  // 7. Wire state change → broadcast
  overlay.setOnStateChange(() => wsHub.broadcastState())

  // 8. Tablet log sink (POST endpoint for CSController logs)
  try {
    startTabletLogServer()
  } catch (err) {
    logger.warn(`tabletLogServer start failed: ${err instanceof Error ? err.message : err}`)
  }

  // 9. Auto-start wifi display if configured
  const wdSettings = settings.get('wifiDisplay')
  if (wdSettings?.autoStart && wdSettings.monitorIndex !== null) {
    wifiDisplay.start().then(() => {
      logger.info('Auto-started wifi display streaming')
    }).catch((err: Error) => {
      logger.warn(`Auto-start wifi display failed: ${err.message}`)
    })
  }

  // 10. Wire slow-zoom scene-change watcher + push status updates to renderer.
  //     Safe to register even with OBS disconnected — the scene-change hook
  //     only fires while a live OBS connection exists.
  slowZoom.register()
  slowZoom.setOnStatusChanged((status) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.webContents.send(IPC.OBS_SLOW_ZOOM_STATUS_UPDATE, status)
  })

  // 11. Restore transition auto-revert preference. The flag is read by the
  //     OBS event handler each time a transition ends — flipping it here is
  //     idempotent and survives OBS reconnects without re-init.
  const revertPref = settings.get('obsTransitionRevert')
  if (revertPref) obsConnection.setTransitionRevertEnabled(true)

  logger.info('All services started')
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  logger.info('Shutting down...')
  wifiDisplay.cleanup()
  stopTabletLogServer()
  chatBridge.disconnect()
  wsHub.stop()
  overlay.stopServer()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
