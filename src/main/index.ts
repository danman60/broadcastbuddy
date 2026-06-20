import { app, BrowserWindow, shell, Menu } from 'electron'
import { join } from 'path'
import * as settings from './services/settings'
import * as overlay from './services/overlay'
import * as wsHub from './services/wsHub'
import * as wifiDisplay from './services/wifiDisplay'
import * as obsConnection from './services/obsConnection'
import * as slowZoom from './services/slowZoom'
import * as chatBridge from './services/chatBridge'
import * as ccRelay from './services/ccRelay'
import * as session from './services/session'
import * as events from './services/events'
import * as crashRecovery from './services/crashRecovery'
import * as backup from './services/backup'
import * as hotkeys from './services/hotkeys'
import * as systemMonitor from './services/systemMonitor'
import { runStartupChecks } from './services/startup'
import { startTabletLogServer, stopTabletLogServer } from './services/tabletLogServer'
import { registerIpcHandlers, pushState } from './ipc'
import { createLogger } from './logger'
import { IPC } from '../shared/types'

const logger = createLogger('main')

let mainWindow: BrowserWindow | null = null

/**
 * Broadcast a renderer-facing push to EVERY live BrowserWindow. Mirrors
 * ipc.ts sendToAllWindows — Overlay Mode floating panels share the same store
 * + IPC listeners, so shared state pushes must reach them too, not only the
 * main window (BrowserWindow.getAllWindows()[0]).
 */
function sendToAllWindows(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, ...args)
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    title: 'BroadcastBuddy',
    backgroundColor: '#1e1e2e',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // Remove the native File/Edit/View menu bar entirely.
  Menu.setApplicationMenu(null)
  mainWindow.setMenuBarVisibility(false)

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

// Single-instance lock (packaged builds only): a second launch would fail to
// bind the overlay HTTP (19080) + WS (19081) ports, leaving a broken window.
// Refuse the second instance and focus the existing one. Gated to packaged so
// the test harness (which launches many short-lived instances) is unaffected.
if (app.isPackaged && !app.requestSingleInstanceLock()) {
  logger.warn('Another BroadcastBuddy instance is already running — quitting this one')
  app.quit()
} else if (app.isPackaged) {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

app.whenReady().then(() => {
  // If we didn't get the single-instance lock, the app is quitting — don't
  // start servers that would collide with the primary instance.
  if (app.isPackaged && !app.hasSingleInstanceLock()) return
  logger.info('BroadcastBuddy starting...')

  // Reap orphaned wifi-display process from a previous crash before anything
  // else binds the discovery port.
  wifiDisplay.killOrphanedProcess()

  // 1. Load settings
  const serverConfig = settings.get('server')
  const overlayStyling = settings.get('overlay')

  // 2. Initialize overlay with saved styling
  overlay.updateStyling(overlayStyling)

  // 2b. Restore persistent graphics/feature-card logo (data URL or '').
  const savedFcLogo = settings.get('featureCardLogoPath')
  if (savedFcLogo) overlay.setFeatureCardLogo(savedFcLogo)

  // 3. Register IPC handlers
  registerIpcHandlers()

  // 4. Create window
  createWindow()

  // 5. Start HTTP server (overlay page)
  overlay.startServer(serverConfig.httpPort, serverConfig.wsPort)

  // 6. Start WebSocket hub
  wsHub.start(serverConfig.wsPort)

  // 7. Wire state change → broadcast to WS clients AND refresh the BB window.
  // pushState() is what updates the renderer (playlist highlight + overlay state);
  // without it, advances arriving via WS (Stream Deck) or hotkeys (F6) updated the
  // deck/tablet + wire but left the app UI frozen. Every mutation now refreshes both.
  overlay.setOnStateChange(() => {
    wsHub.broadcastState()
    pushState()
  })

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
    sendToAllWindows(IPC.OBS_SLOW_ZOOM_STATUS_UPDATE, status)
  })

  // 11. Restore transition auto-revert preference. The flag is read by the
  //     OBS event handler each time a transition ends — flipping it here is
  //     idempotent and survives OBS reconnects without re-init.
  const revertPref = settings.get('obsTransitionRevert')
  if (revertPref) obsConnection.setTransitionRevertEnabled(true)

  // 11b. Auto-connect to OBS from saved settings (fire-and-forget, fail-soft).
  //      Removes the manual Connect click every show; a failure (OBS not running)
  //      is logged and ignored, exactly like the existing OBS-down fail-soft path.
  const obsCfg = settings.get('obsConnection')
  if (obsCfg?.host) {
    obsConnection.connect(obsCfg.host, obsCfg.port, obsCfg.password)
      .then(() => logger.info(`OBS auto-connected: ${obsCfg.host}:${obsCfg.port}`))
      .catch((err) => logger.warn(`OBS auto-connect failed (will connect on demand): ${err instanceof Error ? err.message : err}`))
  }

  // 12. Operator event log → renderer live fanout.
  events.setOnEvent((record) => {
    sendToAllWindows(IPC.EVENTS_NEW, record)
  })
  events.recordEvent('system', 'BroadcastBuddy started')

  // 12b. Auto-load the most-recent saved session so operator edits persist across
  //      restarts. The debounced auto-save in overlay.notifyChange() only engages
  //      when a session is loaded; without this, a normal boot leaves
  //      currentSession=null and every styling/playlist edit is lost on restart.
  //      getMostRecentSession() also sets the module currentSession. Skipped if a
  //      session is somehow already set; no-op on a fresh profile (no sessions).
  if (!session.getCurrentSession()) {
    try {
      const recent = session.getMostRecentSession()
      if (recent) {
        overlay.loadSessionState(
          recent.triggers,
          recent.styling,
          recent.companyLogoDataUrl,
          recent.clientLogoDataUrl,
          recent.selectedIndex,
          recent.playedIds,
          recent.loopMode,
          recent.notes,
          recent.streamConfig,
        )
        logger.info(`Auto-loaded most-recent session: ${recent.name}`)
      }
    } catch (err) {
      logger.warn(`Auto-load session failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  // 13. Crash recovery — snapshot provider + dirty-marker check + periodic snapshots.
  crashRecovery.setSnapshotProvider(() => {
    const cur = session.getCurrentSession()
    return {
      savedAt: new Date().toISOString(),
      currentSessionId: cur?.id ?? null,
      currentSessionName: cur?.name ?? null,
      triggers: overlay.getTriggers(),
      overlayState: overlay.getOverlayState(),
    }
  })
  const recovery = crashRecovery.checkAndRecover() // (re)arms the dirty marker for this run
  crashRecovery.startSnapshots()
  if (recovery.available) {
    sendToAllWindows(IPC.RECOVERY_CHECK, recovery)
  }

  // 14. Settings backup — once now + hourly.
  backup.startBackupSchedule()

  // 15. Startup sanity checks (non-blocking) → renderer.
  runStartupChecks().then((report) => {
    sendToAllWindows(IPC.STARTUP_REPORT, report)
  }).catch((err) => logger.warn(`Startup checks failed: ${err instanceof Error ? err.message : err}`))

  // 16. Global hotkeys (fire/hide/next/prev/record/replay — work unfocused).
  hotkeys.register()

  // 17. System monitor — CPU/RAM/disk stats + low-disk alerts to the renderer.
  systemMonitor.startMonitoring()

  logger.info('All services started')
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  logger.info('Shutting down...')
  events.recordEvent('system', 'BroadcastBuddy shutting down')
  crashRecovery.stopSnapshots()
  backup.stopBackupSchedule()
  hotkeys.unregister()
  systemMonitor.stopMonitoring()
  // Final settings backup, then mark a clean shutdown so next launch doesn't
  // offer recovery.
  backup.backupSettings()
  crashRecovery.clearDirty()
  crashRecovery.discardSnapshot()
  wifiDisplay.cleanup()
  stopTabletLogServer()
  chatBridge.disconnect()
  ccRelay.disconnect()
  wsHub.stop()
  overlay.stopServer()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
