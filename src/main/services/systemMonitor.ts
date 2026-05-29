// System monitor (ported + simplified from CompSyncElectronApp).
//
// Pure os/fs polling — NO npm dependency. Pushes CPU/RAM/disk stats to the
// renderer ~every 5s and emits a disk-space alert when the watched output drive
// runs low or goes missing. Stripped of CompSync's upload/ffmpeg pause hooks
// (those are competition-pipeline only).

import os from 'os'
import fs from 'fs'
import { app } from 'electron'
import { SystemStats, DiskAlert, DiskAlertLevel } from '../../shared/types'
import { createLogger } from '../logger'

const logger = createLogger('systemMonitor')

const POLL_MS = 5000

let timer: NodeJS.Timeout | null = null
let lastCpu: { idle: number; total: number } | null = null
let statsCb: ((s: SystemStats) => void) | null = null
let alertCb: ((a: DiskAlert) => void) | null = null
let lastAlertLevel: DiskAlertLevel = 'ok'

export function setOnStats(cb: (s: SystemStats) => void): void {
  statsCb = cb
}

export function setOnDiskAlert(cb: (a: DiskAlert) => void): void {
  alertCb = cb
}

function cpuTimes(): { idle: number; total: number } {
  let idle = 0
  let total = 0
  for (const c of os.cpus()) {
    for (const v of Object.values(c.times)) total += v
    idle += c.times.idle
  }
  return { idle, total }
}

// The drive we watch — OBS records to the user's Videos dir by default.
function watchedDir(): string {
  try {
    return app.getPath('videos')
  } catch {
    return os.homedir()
  }
}

function diskFor(dir: string): { freeGB: number; totalGB: number } {
  try {
    // On Windows, statfs wants the drive root ("C:\"), not a deep path.
    const root = /^[a-zA-Z]:\\/.test(dir) ? dir.slice(0, 3) : dir
    const s = fs.statfsSync(root)
    return {
      freeGB: (s.bavail * s.bsize) / 1e9,
      totalGB: (s.blocks * s.bsize) / 1e9,
    }
  } catch {
    return { freeGB: -1, totalGB: -1 }
  }
}

function classify(freeGB: number): DiskAlertLevel {
  if (freeGB < 0) return 'drive-lost'
  if (freeGB < 5) return 'critical'
  if (freeGB < 20) return 'high'
  if (freeGB < 50) return 'warning'
  return 'ok'
}

function alertMessage(level: DiskAlertLevel, freeGB: number): string {
  switch (level) {
    case 'drive-lost': return 'Output drive missing or unreadable'
    case 'critical': return `Critical: only ${freeGB.toFixed(1)} GB free`
    case 'high': return `Low disk: ${freeGB.toFixed(1)} GB free`
    case 'warning': return `Disk getting low: ${freeGB.toFixed(0)} GB free`
    default: return 'Disk OK'
  }
}

// Snapshot without a CPU delta (cpuPercent 0 on the very first call).
export function getStats(): SystemStats {
  const cur = cpuTimes()
  let cpuPercent = 0
  if (lastCpu) {
    const dIdle = cur.idle - lastCpu.idle
    const dTotal = cur.total - lastCpu.total
    cpuPercent = dTotal > 0 ? Math.max(0, Math.min(100, (1 - dIdle / dTotal) * 100)) : 0
  }
  const total = os.totalmem()
  const free = os.freemem()
  const dir = watchedDir()
  const driveLost = !fs.existsSync(dir)
  const { freeGB, totalGB } = diskFor(dir)
  return {
    cpuPercent: Math.round(cpuPercent),
    memPercent: Math.round(((total - free) / total) * 100),
    diskFreeGB: freeGB < 0 ? -1 : Math.round(freeGB * 10) / 10,
    diskTotalGB: totalGB < 0 ? -1 : Math.round(totalGB),
    driveLost: driveLost || freeGB < 0,
    timestamp: Date.now(),
  }
}

function poll(): void {
  const stats = getStats()
  lastCpu = cpuTimes()
  statsCb?.(stats)

  // Disk alert with hysteresis: don't clear back to 'ok' until well clear (60GB)
  // so it doesn't flap around the 50GB warning boundary.
  let level: DiskAlertLevel = stats.driveLost ? 'drive-lost' : classify(stats.diskFreeGB)
  if (level === 'ok' && stats.diskFreeGB < 60 && lastAlertLevel !== 'ok') {
    level = lastAlertLevel
  }
  if (level !== lastAlertLevel) {
    lastAlertLevel = level
    alertCb?.({ level, diskFreeGB: stats.diskFreeGB, message: alertMessage(level, stats.diskFreeGB) })
  }
}

export function startMonitoring(): void {
  if (timer) return
  lastCpu = cpuTimes() // prime baseline so the first push has a real CPU %
  timer = setInterval(poll, POLL_MS)
  logger.info(`System monitor started (watching ${watchedDir()})`)
}

export function stopMonitoring(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
