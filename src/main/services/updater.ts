// In-app updater (owner 2026-10-30: "faster updater like GameDay tabulation app").
//
// Publish side: scripts/publish-update.mjs uploads the built app.asar + latest.json to R2.
// App side: Settings → App Updates checks latest.json; Install downloads the asar, verifies
// its SHA-256, then a detached PowerShell waits for BB to exit, swaps resources\app.asar and
// relaunches. Same swap we did by hand over SSH, now one click. Never installs on its own.
//
// shortcut: replaces app.asar only — a change to native modules (app.asar.unpacked), the
// bundled exes or Electron itself still needs the full installer.
import { app } from 'electron'
import crypto from 'crypto'
import path from 'path'
import { createLogger } from '../logger'
import type { UpdateStatus } from '../../shared/types'

// Electron's patched fs treats *.asar as an archive; original-fs writes it as a plain file.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ofs: typeof import('fs') = require('original-fs')

declare const __BB_COMMIT__: string
declare const __BB_BUILT_AT__: string

const logger = createLogger('updater')
const FEED = 'https://pub-626d1637ca4c4f34a7916019aaa3efce.r2.dev/bb-updates/latest.json'

export const BUILD_COMMIT = typeof __BB_COMMIT__ === 'string' ? __BB_COMMIT__ : ''
export const BUILD_AT = typeof __BB_BUILT_AT__ === 'string' ? __BB_BUILT_AT__ : ''

interface Manifest { commit: string; builtAt: string; sha256: string; bytes: number; url: string }

let manifest: Manifest | null = null

function status(message = ''): UpdateStatus {
  const available = !!manifest && isNewer(manifest)
  return {
    current: { commit: BUILD_COMMIT.slice(0, 7), builtAt: BUILD_AT },
    latest: manifest ? { commit: manifest.commit.slice(0, 7), builtAt: manifest.builtAt, bytes: manifest.bytes } : null,
    available,
    message,
  }
}

/** Different commit AND built later — a pointer moved back to an older build is never offered. */
function isNewer(m: Manifest): boolean {
  if (!BUILD_COMMIT || !m.commit || m.commit === BUILD_COMMIT) return false
  const mine = Date.parse(BUILD_AT)
  const theirs = Date.parse(m.builtAt)
  return !Number.isFinite(mine) || (Number.isFinite(theirs) && theirs > mine)
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  try {
    const res = await fetch(`${FEED}?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return status(`Update feed answered HTTP ${res.status}`)
    manifest = (await res.json()) as Manifest
    const s = status()
    logger.info(`update check: running ${s.current.commit || 'dev'} (${BUILD_AT || '?'}), latest ${s.latest?.commit} (${manifest.builtAt}) → ${s.available ? 'UPDATE AVAILABLE' : 'current'}`)
    return s
  } catch (err) {
    return status(`Could not reach the update feed: ${err instanceof Error ? err.message : err}`)
  }
}

export async function installUpdate(): Promise<UpdateStatus> {
  if (!app.isPackaged) return status('Updates only install in the packaged app')
  if (!manifest || !isNewer(manifest)) return status('No newer version to install')
  const m = manifest
  const res = await fetch(m.url, { cache: 'no-store' })
  if (!res.ok) return status(`Download failed: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const sha = crypto.createHash('sha256').update(buf).digest('hex')
  if (buf.length !== m.bytes || sha !== m.sha256) {
    logger.warn(`update rejected: got ${buf.length} B sha ${sha}, expected ${m.bytes} B sha ${m.sha256}`)
    return status('Download was corrupt (size/checksum mismatch) — nothing changed')
  }

  const asar = path.join(process.resourcesPath, 'app.asar')
  const next = asar + '.new'
  ofs.writeFileSync(next, buf)

  // The running app holds app.asar open, so the swap happens after every BB process exits.
  const q = (s: string): string => `'${s.replace(/'/g, "''")}'`
  const ps = [
    '$ErrorActionPreference = "SilentlyContinue"',
    '$n = 0; while ((Get-Process BroadcastBuddy) -and $n -lt 60) { Start-Sleep -Milliseconds 500; $n++ }',
    `Copy-Item ${q(asar)} ${q(asar + '.prev')} -Force`,
    `for ($i = 0; $i -lt 20; $i++) { try { Move-Item ${q(next)} ${q(asar)} -Force -ErrorAction Stop; break } catch { Start-Sleep -Milliseconds 500 } }`,
    `Start-Process ${q(process.execPath)}`,
  ].join('\r\n')
  const script = path.join(app.getPath('userData'), 'apply-update.ps1')
  ofs.writeFileSync(script, ps)
  // Electron's relauncher outlives this process and starts the script once we've exited. A
  // detached spawn() died with BB on DART (2026-10-30: PowerShell started, never ran).
  app.relaunch({ execPath: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script] })
  logger.info(`update ${m.commit.slice(0, 7)} downloaded + verified; quitting to swap app.asar`)
  setTimeout(() => app.quit(), 300)
  return status('Installing — BroadcastBuddy will restart in a few seconds')
}
