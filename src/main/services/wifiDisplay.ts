import { spawn, execFileSync, ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'
import dgram from 'dgram'
import os from 'os'
import { app, screen } from 'electron'
import { WifiDisplayState, MonitorInfo } from '../../shared/types'
import { createLogger } from '../logger'
import { getSettings, setSettings } from './settings'
import { recordEvent } from './events'

const logger = createLogger('wifi-display')

let childProc: ChildProcess | null = null
let running = false
let activeMonitorIndex: number | null = null
let resolvedBinaryPath: string | null = null

let discoverySocket: dgram.Socket | null = null
let discoveryInterval: NodeJS.Timeout | null = null
const DISCOVERY_PORT = 5002

// One-shot flag: the drift handler adopts the tablet's observed IP at most
// once per start()/stop() cycle. Prevents pong-match when multiple discover
// sources keep bouncing clientIp back and forth.
let driftAdoptedThisSession = false

let topologyListenersAttached = false
let unexpectedExitAttempts = 0
const MAX_UNEXPECTED_EXIT_RESTARTS = 3
let topologyRestartTimer: NodeJS.Timeout | null = null
// Zeroes the unexpected-exit counter after the child proves stable for a window,
// so well-spaced crashes across a long show each get a fresh restart budget
// instead of permanently exhausting the cap.
let stabilityTimer: NodeJS.Timeout | null = null
const STABILITY_RESET_MS = 30_000
// Set true while stop() intentionally tears the child down, so the exit/error
// handlers don't auto-restart a deliberate stop. Cleared at the top of start().
let intentionalStop = false
// Guards against exit + error both scheduling a restart for the same dead child.
let restartPending = false

// Capture-error frequency watchdog: 5 capture-errors within 7s → auto-restart.
// Cap: 3 per session — past that, leave to operator.
// Match any capture error (e.g. "invalid data", "connection reset" = DXGI
// access-lost after a display-topology change) so the auto-restart actually
// fires instead of looping a dead duplication session forever.
const CAPTURE_ERR_NEEDLE = 'capture: Capture error:'
const CAPTURE_ERR_THRESHOLD = 5
const CAPTURE_ERR_WINDOW_MS = 7000
const MAX_CAPTURE_RESTART_ATTEMPTS = 3
let captureErrorTimes: number[] = []
let captureRestartAttempts = 0
let captureRestartInFlight = false

// Source identifier in the discovery payload — lets the CSController tablet
// show which host it's connecting to (CompSync vs BroadcastBuddy) and
// future-proofs for source-specific behavior.
const APP_IDENTIFIER = 'BroadcastBuddy'

function validateMonitorIndex(saved: number | null): number | null {
  const displays = screen.getAllDisplays()
  if (displays.length === 0) return null
  if (saved !== null && saved >= 0 && saved < displays.length) return saved

  const primaryId = screen.getPrimaryDisplay().id
  const primaryIdx = displays.findIndex((d) => d.id === primaryId)
  const fallback = primaryIdx >= 0 ? primaryIdx : 0
  logger.warn(
    `wifi display monitorIndex ${saved} invalid for ${displays.length} connected displays — falling back to primary (index ${fallback})`,
  )
  return fallback
}

function scheduleTopologyRestart(reason: string): void {
  if (!running) return
  if (topologyRestartTimer) clearTimeout(topologyRestartTimer)
  topologyRestartTimer = setTimeout(() => {
    topologyRestartTimer = null
    if (!running) return
    logger.info(`Restarting wifi display after ${reason}`)
    stop()
      .then(() => new Promise<void>((r) => setTimeout(r, 500)))
      .then(() => start())
      .catch((err) => logger.error(`wifi display restart failed after ${reason}: ${err}`))
  }, 750)
}

function attachTopologyListeners(): void {
  if (topologyListenersAttached) return
  topologyListenersAttached = true
  screen.on('display-added', (_event, display) => {
    logger.info(`Display added: id=${display.id} ${display.size.width}x${display.size.height}`)
    scheduleTopologyRestart('display-added')
  })
  screen.on('display-removed', (_event, display) => {
    logger.info(`Display removed: id=${display.id}`)
    scheduleTopologyRestart('display-removed')
  })
}

function getLocalIp(): string {
  const interfaces = os.networkInterfaces()
  const candidates: { address: string; priority: number }[] = []

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue
      const addr = iface.address
      if (addr.startsWith('192.168.') || addr.startsWith('10.')) {
        candidates.push({ address: addr, priority: 0 })
      } else if (addr.startsWith('172.')) {
        candidates.push({ address: addr, priority: 2 })
      } else if (addr.startsWith('100.')) {
        candidates.push({ address: addr, priority: 3 })
      } else {
        candidates.push({ address: addr, priority: 1 })
      }
    }
  }

  candidates.sort((a, b) => a.priority - b.priority)
  return candidates[0]?.address || '0.0.0.0'
}

function getLocalIpv4s(): Set<string> {
  const out = new Set<string>()
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) out.add(iface.address)
    }
  }
  out.add('127.0.0.1')
  return out
}

function getDiscoveryPayload(): Buffer {
  const settings = getSettings()
  const wd = settings.wifiDisplay!
  const serverConfig = settings.server
  // Wire-compatible with CompSync's `compsync-discover` payload so existing
  // CSController APKs work unchanged. `app` field lets the tablet display
  // which host it found.
  return Buffer.from(JSON.stringify({
    type: 'compsync-discover',
    app: APP_IDENTIFIER,
    host: getLocalIp(),
    videoPort: wd.videoPort,
    touchPort: wd.touchPort,
    wsPort: serverConfig.wsPort,
    tabletLogPort: 8766,
    name: os.hostname(),
  }))
}

function startDiscoveryListener(): void {
  stopDiscoveryListener()

  discoverySocket = dgram.createSocket({ type: 'udp4', reuseAddr: true })

  discoverySocket.on('message', (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString())
      if (data.type !== 'compsync-discover-request' || !running) return

      // Ignore requests sourced from our own interfaces (Windows loopback).
      const localIps = getLocalIpv4s()
      if (localIps.has(rinfo.address)) {
        logger.debug(`Discovery request ignored (self-IP ${rinfo.address})`)
        return
      }

      const reply = getDiscoveryPayload()
      discoverySocket?.send(reply, 0, reply.length, rinfo.port, rinfo.address)
      logger.debug(`Discovery reply sent to ${rinfo.address}:${rinfo.port}`)

      // One-shot tablet IP drift adoption per start/stop cycle.
      if (driftAdoptedThisSession) return
      try {
        const current = getSettings()
        const savedIp = current.wifiDisplay?.clientIp
        if (savedIp && rinfo.address && rinfo.address !== savedIp) {
          driftAdoptedThisSession = true
          logger.warn(
            `Tablet IP drift detected (one-shot): saved=${savedIp} observed=${rinfo.address} — saving + restarting wifi-display`,
          )
          setSettings({
            wifiDisplay: { ...current.wifiDisplay!, clientIp: rinfo.address },
          })
          if (running) {
            void (async () => {
              try {
                await stop()
                await start()
                logger.info(`Wifi display respawned pointed at ${rinfo.address}`)
              } catch (err) {
                logger.warn(
                  `Wifi display auto-respawn failed: ${err instanceof Error ? err.message : err}`,
                )
              }
            })()
          }
        }
      } catch (err) {
        logger.warn(
          `Tablet IP drift handler failed: ${err instanceof Error ? err.message : err}`,
        )
      }
    } catch {}
  })

  discoverySocket.bind(DISCOVERY_PORT, () => {
    logger.info(`Discovery listener on port ${DISCOVERY_PORT}`)
    discoverySocket!.setBroadcast(true)
    const payload = getDiscoveryPayload()
    discoverySocket!.send(payload, 0, payload.length, DISCOVERY_PORT, '255.255.255.255')
  })
}

/**
 * Broadcast a discover-request prompting any listening tablets to re-announce.
 * Used by the "Tablet" button so operators can force the tablet's UdpReceiver
 * back into a known-good state without restarting the app.
 */
export function pingTabletForDiscovery(): void {
  try {
    if (!discoverySocket) return
    const payload = Buffer.from(JSON.stringify({ type: 'compsync-discover-request' }))
    discoverySocket.send(payload, 0, payload.length, DISCOVERY_PORT, '255.255.255.255')
    logger.info('Broadcast discover-request to prompt tablet re-announce')
  } catch (err) {
    logger.warn(
      `pingTabletForDiscovery failed: ${err instanceof Error ? err.message : err}`,
    )
  }
}

function stopDiscoveryListener(): void {
  if (discoveryInterval) { clearInterval(discoveryInterval); discoveryInterval = null }
  if (discoverySocket) { try { discoverySocket.close() } catch {} discoverySocket = null }
}

const PID_FILE = 'wifi-display.pid'
const BINARY_NAME = 'wifi-display-server.exe'
const RUNTIME_DLLS = ['libstdc++-6.dll', 'libgcc_s_seh-1.dll', 'libwinpthread-1.dll']

function getPidFilePath(): string {
  return path.join(app.getPath('userData'), PID_FILE)
}

function copyRuntimeDllsIfNeeded(srcDir: string, destDir: string): void {
  for (const dllName of RUNTIME_DLLS) {
    const src = path.join(srcDir, dllName)
    const dst = path.join(destDir, dllName)
    if (!fs.existsSync(src)) continue
    try {
      const srcStat = fs.statSync(src)
      const dstExists = fs.existsSync(dst)
      if (!dstExists || fs.statSync(dst).size !== srcStat.size) {
        fs.copyFileSync(src, dst)
        logger.info(`Copied ${dllName} to userData`)
      }
    } catch (err) {
      logger.warn(`Failed to copy ${dllName} to userData: ${err}`)
    }
  }
}

function getBinaryPath(): string {
  if (resolvedBinaryPath) return resolvedBinaryPath

  const resourcePath = path.join(process.resourcesPath || '.', BINARY_NAME)
  if (fs.existsSync(resourcePath)) {
    const userDataCopy = path.join(app.getPath('userData'), BINARY_NAME)
    try {
      const srcStat = fs.statSync(resourcePath)
      const dstExists = fs.existsSync(userDataCopy)
      if (!dstExists || fs.statSync(userDataCopy).size !== srcStat.size) {
        fs.copyFileSync(resourcePath, userDataCopy)
        logger.info(`Copied ${BINARY_NAME} to userData`)
      }
      copyRuntimeDllsIfNeeded(path.dirname(resourcePath), path.dirname(userDataCopy))
      resolvedBinaryPath = userDataCopy
      return resolvedBinaryPath
    } catch (err) {
      logger.warn(`Failed to copy ${BINARY_NAME} to userData, using resources path: ${err}`)
      resolvedBinaryPath = resourcePath
      return resolvedBinaryPath
    }
  }

  const userDataPath = path.join(app.getPath('userData'), BINARY_NAME)
  if (fs.existsSync(userDataPath)) {
    resolvedBinaryPath = userDataPath
    return resolvedBinaryPath
  }

  throw new Error(
    `${BINARY_NAME} not found. Place it in ${path.dirname(resourcePath)} or ${path.dirname(userDataPath)}`,
  )
}

function writePid(pid: number): void {
  try {
    fs.writeFileSync(getPidFilePath(), String(pid))
  } catch {}
}

function clearPid(): void {
  try {
    const pidPath = getPidFilePath()
    if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath)
  } catch {}
}

/**
 * Pre-spawn self-heal: a stale wifi-display-server.exe from a previous crash
 * can keep squatting UDP ports 5000/5001, causing the fresh child to fail
 * binding in an infinite restart loop. Reclaim the ports before EVERY spawn.
 * Image-name kill is intentional and matches the proven manual fix.
 * taskkill /T also reaps any orphaned ffmpeg child the stale server spawned;
 * scope-limited to the wifi-display tree so unrelated ffmpeg.exe is safe.
 */
function freeWifiDisplayPorts(): void {
  if (process.platform !== 'win32') return
  try {
    const out = execFileSync(
      'taskkill',
      ['/F', '/T', '/IM', BINARY_NAME],
      // 1.5s: this blocks the main process on EVERY (re)spawn. taskkill of a
      // single image is near-instant; the old 5s budget needlessly stretched
      // each auto-restart cycle. If it genuinely stalls past 1.5s we proceed to
      // spawn anyway (the catch below treats a timeout as non-fatal).
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 1500 },
    )
      .toString()
      .trim()
    const m = out.match(/PID\s+(\d+)/i)
    const pid = m ? m[1] : 'unknown'
    logger.warn(
      `[wifi-display] pre-spawn cleanup: killed stale ${BINARY_NAME} pid=${pid} to free ports 5000/5001`,
    )
  } catch (err: unknown) {
    const e = err as { status?: number; stderr?: Buffer | string }
    const stderr = e?.stderr ? e.stderr.toString() : ''
    if (e?.status === 128 || /not found|No tasks/i.test(stderr)) {
      logger.info(
        `[wifi-display] pre-spawn cleanup: no stale instance of ${BINARY_NAME} (ports 5000/5001 clear)`,
      )
    } else {
      logger.warn(
        `[wifi-display] pre-spawn cleanup: taskkill non-fatal error (${stderr || (err instanceof Error ? err.message : String(err))}) — continuing to spawn`,
      )
    }
  }
}

export function getMonitors(): MonitorInfo[] {
  return screen.getAllDisplays().map((d) => ({
    id: d.id,
    label: d.label || `Display ${d.id}`,
    width: d.size.width,
    height: d.size.height,
    x: d.bounds.x,
    y: d.bounds.y,
  }))
}

/**
 * Schedule a capped, 2s-delayed auto-restart of the wifi-display child. Shared by
 * the exit handler, the 'error' handler, and the no-PID spawn path so a crash at
 * ANY of those points recovers — previously only a clean unexpected `exit` after
 * a successful spawn restarted, leaving a spawn-level failure (no PID / 'error')
 * with the cast dead until the operator toggled Settings. Deduped via
 * restartPending so exit+error can't double-spawn; gated by intentionalStop.
 */
function scheduleAutoRestart(reason: string): void {
  if (intentionalStop || restartPending) return
  if (unexpectedExitAttempts >= MAX_UNEXPECTED_EXIT_RESTARTS) {
    logger.error(
      `Wifi display exceeded ${MAX_UNEXPECTED_EXIT_RESTARTS} restart attempts — giving up until user re-enables in Settings`,
    )
    return
  }
  unexpectedExitAttempts++
  restartPending = true
  logger.warn(
    `Wifi display ${reason} — restart attempt ${unexpectedExitAttempts}/${MAX_UNEXPECTED_EXIT_RESTARTS} in 2s`,
  )
  setTimeout(() => {
    restartPending = false
    start().catch((err) => logger.error(`Auto-restart failed: ${err}`))
  }, 2000)
}

export async function start(): Promise<void> {
  if (running && childProc) {
    logger.warn('Wifi display already running')
    return
  }
  // Fresh start (or auto-restart) — clear any intentional-stop latch so the
  // exit/error handlers registered below will recover this child if it dies.
  intentionalStop = false

  const settings = getSettings()
  const wd = settings.wifiDisplay!
  const binaryPath = getBinaryPath()

  attachTopologyListeners()

  const effectiveIndex = validateMonitorIndex(wd.monitorIndex)
  if (effectiveIndex === null) {
    throw new Error('No displays connected — cannot start wifi display')
  }
  if (effectiveIndex !== wd.monitorIndex) {
    logger.info(`wifi display using healed monitor index ${effectiveIndex} (saved was ${wd.monitorIndex})`)
  }

  const args = [
    '--monitor-index', String(effectiveIndex),
    '--bitrate', String(wd.bitrate),
    '--fps', String(wd.fps),
    '--video-port', String(wd.videoPort),
    '--touch-port', String(wd.touchPort),
  ]

  if (wd.clientIp) {
    args.push('--client', wd.clientIp)
  }

  // HEVC NVENC opt-in. Requires bundled ffmpeg.exe; BroadcastBuddy doesn't
  // ship one yet, so this just looks for it in resources/ and falls back to
  // the default OpenH264 software path on miss.
  if (wd.encoder === 'hevc-nvenc') {
    const ffmpegPath = path.join(process.resourcesPath || '.', 'ffmpeg.exe')
    if (fs.existsSync(ffmpegPath)) {
      args.push('--encoder', 'hevc-nvenc', '--ffmpeg-path', ffmpegPath)
      logger.info(`Wifi display: opt-in HEVC NVENC enabled (ffmpeg=${ffmpegPath})`)
    } else {
      logger.warn(
        `Wifi display: HEVC NVENC requested but ffmpeg.exe not bundled — falling back to OpenH264`,
      )
    }
  }

  freeWifiDisplayPorts()

  logger.info(`Starting wifi display: ${binaryPath} ${args.join(' ')}`)

  childProc = spawn(binaryPath, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })

  if (childProc.pid) {
    writePid(childProc.pid)
    running = true
    activeMonitorIndex = effectiveIndex
    restartPending = false
    captureErrorTimes = []
    captureRestartAttempts = 0
    captureRestartInFlight = false
    driftAdoptedThisSession = false
    // Reset the unexpected-exit counter only after the child proves STABLE for
    // STABILITY_RESET_MS — not immediately at spawn. An immediate reset let a
    // fast crash-loop (spawn→die→spawn) keep zeroing the counter so the cap
    // never engaged; conversely, well-spaced crashes never got a fresh budget.
    if (stabilityTimer) clearTimeout(stabilityTimer)
    stabilityTimer = setTimeout(() => {
      if (running) {
        unexpectedExitAttempts = 0
        logger.info('Wifi display stable — restart counter reset')
      }
    }, STABILITY_RESET_MS)
    logger.info(`Wifi display started (PID ${childProc.pid}, monitor index ${effectiveIndex})`)
    recordEvent('wifi', 'Wifi display started', { monitorIndex: effectiveIndex })
    // Operator hierarchy: OBS HIGH > Wifi-display ABOVENORMAL > app NORMAL >
    // ffmpeg BELOWNORMAL. Tablet lag is preferable to OBS data loss.
    if (process.platform === 'win32') {
      try {
        const wmic = spawn('wmic', [
          'process', 'where', `ProcessId=${childProc.pid}`,
          'CALL', 'setpriority', 'abovenormal',
        ], { stdio: 'ignore', windowsHide: true })
        wmic.on('error', () => {})
        logger.info(`Set wifi-display PID ${childProc.pid} priority to abovenormal`)
      } catch (err) {
        logger.warn(`Failed to set wifi-display priority: ${err instanceof Error ? err.message : err}`)
      }
    }
    startDiscoveryListener()
  } else {
    // Spawn produced no PID (binary lock, AV block, transient OS failure).
    // Schedule recovery, then FALL THROUGH so the exit/error handlers below
    // still attach to the pid-less child object — an unhandled 'error' event
    // would otherwise crash the main process. restartPending dedups the case
    // where the 'error' handler also fires, so we recover exactly once.
    logger.error('Wifi display spawn produced no PID — scheduling restart')
    scheduleAutoRestart('spawn produced no PID')
  }

  childProc.stderr?.on('data', (data: Buffer) => {
    const line = data.toString().trim()
    if (line) {
      logger.warn(`[wifi-display] ${line}`)

      if (line.includes(CAPTURE_ERR_NEEDLE)) {
        const now = Date.now()
        captureErrorTimes.push(now)
        captureErrorTimes = captureErrorTimes.filter((t) => now - t <= CAPTURE_ERR_WINDOW_MS)
        if (
          captureErrorTimes.length >= CAPTURE_ERR_THRESHOLD &&
          !captureRestartInFlight &&
          captureRestartAttempts < MAX_CAPTURE_RESTART_ATTEMPTS
        ) {
          captureRestartInFlight = true
          captureRestartAttempts++
          captureErrorTimes = []
          logger.warn(
            `[wifi-display] capture-error burst: ${CAPTURE_ERR_THRESHOLD}+ in ${CAPTURE_ERR_WINDOW_MS}ms — auto-restart attempt ${captureRestartAttempts}/${MAX_CAPTURE_RESTART_ATTEMPTS}`,
          )
          recordEvent('wifi', `Wifi display auto-restart (capture-error burst) attempt ${captureRestartAttempts}/${MAX_CAPTURE_RESTART_ATTEMPTS}`)
          ;(async () => {
            try {
              await stop()
              await new Promise((resolve) => setTimeout(resolve, 500))
              await start()
              logger.info(`[wifi-display] auto-restart ${captureRestartAttempts} complete`)
            } catch (err) {
              logger.error(
                `[wifi-display] auto-restart ${captureRestartAttempts} failed: ${err instanceof Error ? err.message : err}`,
              )
            } finally {
              captureRestartInFlight = false
            }
          })()
        } else if (
          captureErrorTimes.length >= CAPTURE_ERR_THRESHOLD &&
          captureRestartAttempts >= MAX_CAPTURE_RESTART_ATTEMPTS
        ) {
          logger.error(
            `[wifi-display] capture-error burst persists after ${MAX_CAPTURE_RESTART_ATTEMPTS} auto-restarts — manual recovery required (toggle in Settings)`,
          )
          captureErrorTimes = []
        }
      }
    }
  })

  childProc.stdout?.on('data', (data: Buffer) => {
    const line = data.toString().trim()
    if (line) {
      logger.info(`[wifi-display] ${line}`)
    }
  })

  childProc.on('exit', (code, signal) => {
    logger.info(`Wifi display exited (code=${code}, signal=${signal})`)
    const wasRunning = running
    running = false
    activeMonitorIndex = null
    childProc = null
    clearPid()
    if (stabilityTimer) { clearTimeout(stabilityTimer); stabilityTimer = null }

    // SIGTERM/SIGKILL are how stop() tears down; intentionalStop is the primary
    // gate (scheduleAutoRestart no-ops when it's set). Recover any other exit —
    // including one where running was never set (no-PID/early-death respawn).
    const wasIntentional = signal === 'SIGTERM' || signal === 'SIGKILL'
    if ((wasRunning || restartPending) && !wasIntentional) {
      scheduleAutoRestart(`unexpected exit (code=${code})`)
    }
  })

  childProc.on('error', (err) => {
    logger.error(`Wifi display process error: ${err.message}`)
    running = false
    activeMonitorIndex = null
    childProc = null
    clearPid()
    if (stabilityTimer) { clearTimeout(stabilityTimer); stabilityTimer = null }
    // A process-level error (failed spawn, ENOENT, abrupt death) must still
    // recover — previously this path scheduled nothing, leaving the cast dead.
    scheduleAutoRestart(`process error (${err.message})`)
  })
}

export async function stop(): Promise<void> {
  // Latch intentional teardown so the child's exit/error handlers don't
  // auto-restart a deliberate stop (primary gate in scheduleAutoRestart).
  intentionalStop = true
  if (stabilityTimer) { clearTimeout(stabilityTimer); stabilityTimer = null }
  if (!childProc || !running) {
    logger.warn('Wifi display not running')
    return
  }

  const proc = childProc
  childProc = null

  if (topologyRestartTimer) {
    clearTimeout(topologyRestartTimer)
    topologyRestartTimer = null
  }
  stopDiscoveryListener()
  driftAdoptedThisSession = false
  logger.info('Stopping wifi display...')

  return new Promise<void>((resolve) => {
    let resolved = false

    proc.on('exit', () => {
      if (!resolved) {
        resolved = true
        running = false
        activeMonitorIndex = null
        clearPid()
        resolve()
      }
    })

    try {
      proc.kill('SIGTERM')
    } catch {}

    setTimeout(() => {
      if (!resolved) {
        try {
          proc.kill('SIGKILL')
        } catch {}
        resolved = true
        running = false
        activeMonitorIndex = null
        clearPid()
        resolve()
      }
    }, 5000)
  })
}

export function getStatus(): WifiDisplayState {
  return {
    running,
    monitorIndex: activeMonitorIndex,
  }
}

export function killOrphanedProcess(): void {
  try {
    const pidPath = getPidFilePath()
    if (!fs.existsSync(pidPath)) return
    const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10)
    if (isNaN(pid)) { clearPid(); return }
    try {
      process.kill(pid, 'SIGTERM')
      logger.warn(`Killed orphaned wifi-display process (PID ${pid})`)
    } catch {
      // Process already dead
    }
    clearPid()
  } catch {}
}

export function cleanup(): void {
  if (topologyRestartTimer) {
    clearTimeout(topologyRestartTimer)
    topologyRestartTimer = null
  }
  stopDiscoveryListener()
  if (childProc) {
    try {
      childProc.kill('SIGTERM')
    } catch {}
    childProc = null
  }
  running = false
  activeMonitorIndex = null
  clearPid()
}
