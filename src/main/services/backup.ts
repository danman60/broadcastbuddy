/**
 * Settings backup — periodic + on-demand snapshots of the electron-store
 * settings file (and the sessions dir) so a corrupt profile doesn't lose
 * trigger lists / overlay presets / CC config.
 *
 * electron-store's default config file is `config.json` under userData (verified
 * at userData/config.json). Backups are timestamped copies under
 * userData/backups/; we keep the last MAX_BACKUPS and prune older.
 *
 * Adapted from CompSyncElectronApp/src/main/services/backup.ts (scoped down — BB
 * backs up the small settings file, not large recording trees, so no
 * streaming/verification machinery is needed).
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { createLogger } from '../logger'
import { recordEvent } from './events'

const logger = createLogger('backup')

const MAX_BACKUPS = 10
const HOURLY_MS = 60 * 60 * 1000

let backupTimer: NodeJS.Timeout | null = null

export interface BackupInfo {
  file: string // basename
  createdAt: string // ISO, parsed from name
  size: number
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

function backupsDir(): string {
  const dir = path.join(app.getPath('userData'), 'backups')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function prune(): void {
  const dir = backupsDir()
  let files: string[]
  try {
    files = fs.readdirSync(dir).filter((f) => f.startsWith('config-') && f.endsWith('.json'))
  } catch {
    return
  }
  if (files.length <= MAX_BACKUPS) return
  // Lexicographic sort works because the stamp is zero-padded YYYYMMDD-HHMMSS.
  files.sort()
  const stale = files.slice(0, files.length - MAX_BACKUPS)
  for (const f of stale) {
    try { fs.rmSync(path.join(dir, f), { force: true }) } catch { /* best-effort */ }
  }
}

export function backupSettings(): { ok: boolean; file?: string; error?: string } {
  const src = configPath()
  if (!fs.existsSync(src)) {
    return { ok: false, error: 'No settings file to back up yet' }
  }
  try {
    const dest = path.join(backupsDir(), `config-${stamp()}.json`)
    fs.copyFileSync(src, dest)
    prune()
    logger.info(`Settings backed up → ${path.basename(dest)}`)
    recordEvent('system', 'Settings backed up', { file: path.basename(dest) })
    return { ok: true, file: path.basename(dest) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`Backup failed: ${msg}`)
    return { ok: false, error: msg }
  }
}

export function listBackups(): BackupInfo[] {
  const dir = backupsDir()
  let files: string[]
  try {
    files = fs.readdirSync(dir).filter((f) => f.startsWith('config-') && f.endsWith('.json'))
  } catch {
    return []
  }
  const out: BackupInfo[] = []
  for (const f of files) {
    try {
      const st = fs.statSync(path.join(dir, f))
      // config-YYYYMMDD-HHMMSS.json → ISO
      const m = f.match(/^config-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.json$/)
      const createdAt = m
        ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).toISOString()
        : st.mtime.toISOString()
      out.push({ file: f, createdAt, size: st.size })
    } catch { /* skip */ }
  }
  return out.sort((a, b) => b.file.localeCompare(a.file)) // newest first
}

export function restoreBackup(file: string): { ok: boolean; error?: string } {
  // Guard against path traversal — only accept a bare basename in our dir.
  if (path.basename(file) !== file) return { ok: false, error: 'Invalid backup name' }
  const src = path.join(backupsDir(), file)
  if (!fs.existsSync(src)) return { ok: false, error: 'Backup not found' }
  try {
    // Safety: snapshot the current config before overwriting it.
    backupSettings()
    fs.copyFileSync(src, configPath())
    logger.info(`Settings restored from ${file} (restart required to take effect)`)
    recordEvent('system', `Settings restored from ${file}`, { file })
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`Restore failed: ${msg}`)
    return { ok: false, error: msg }
  }
}

/** Run once on startup + every hour thereafter. */
export function startBackupSchedule(): void {
  backupSettings()
  if (backupTimer) return
  backupTimer = setInterval(backupSettings, HOURLY_MS)
  if (backupTimer.unref) backupTimer.unref()
}

export function stopBackupSchedule(): void {
  if (backupTimer) {
    clearInterval(backupTimer)
    backupTimer = null
  }
}
