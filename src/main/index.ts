import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import * as settings from './services/settings'
import * as overlay from './services/overlay'
import * as wsHub from './services/wsHub'
import { registerIpcHandlers } from './ipc'
import { createLogger } from './logger'

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

  logger.info('All services started')
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  logger.info('Shutting down...')
  wsHub.stop()
  overlay.stopServer()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
