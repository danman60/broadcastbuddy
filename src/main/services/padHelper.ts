// Xbox controller input that works while OBS has focus. Chromium's Gamepad API only feeds the
// FOCUSED window, so with OBS (and the BB dock) in front the controller went dead (DART
// 2026-10-30). pad-helper.exe polls XInput and prints one JSON line per change; we relay it to
// every BB window, where gamepad.ts prefers it over navigator.getGamepads().
import { app, BrowserWindow } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { createLogger } from '../logger'
import { IPC } from '../../shared/types'

const logger = createLogger('pad')
let helper: ChildProcessWithoutNullStreams | null = null
let restartTimer: ReturnType<typeof setTimeout> | null = null
let stopping = false
let connected: boolean | null = null

function helperPath(): string | null {
  const candidates = [
    join(process.resourcesPath || '', 'pad-helper', 'pad-helper.exe'),
    join(app.getAppPath(), 'resources', 'pad-helper', 'pad-helper.exe'),
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

/** Windows that should drive the camera from the pad — exactly one camera panel, or every
 *  preset/AI toggle fires twice (main window + floating camera panel). */
let targets: () => BrowserWindow[] = () => BrowserWindow.getAllWindows()

export function startPadHelper(getTargets?: () => BrowserWindow[]): void {
  if (getTargets) targets = getTargets
  if (process.platform !== 'win32' || helper) return
  const exe = helperPath()
  if (!exe) { logger.warn('pad-helper.exe not found — controller only works while BB is focused'); return }
  stopping = false
  helper = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  logger.info(`pad-helper started (${exe})`)
  let buf = ''
  helper.stdout.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf8')
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      try {
        const state = JSON.parse(line) as { c: boolean }
        if (state.c !== connected) {
          connected = state.c
          logger.info(`Xbox controller ${state.c ? 'CONNECTED' : 'not connected'} (XInput)`)
        }
        for (const w of targets()) if (!w.isDestroyed()) w.webContents.send(IPC.GAMEPAD_XINPUT, state)
      } catch { /* partial/garbled line — next one replaces it */ }
    }
  })
  helper.stderr.on('data', (c: Buffer) => logger.warn(`pad-helper stderr: ${c.toString('utf8').trim()}`))
  helper.on('exit', (code) => {
    helper = null
    if (stopping) return
    logger.warn(`pad-helper exited (code ${code}) — restarting in 3 s`)
    restartTimer = setTimeout(() => { restartTimer = null; startPadHelper() }, 3000)
  })
}

export function stopPadHelper(): void {
  stopping = true
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null }
  try { helper?.stdin.end(); helper?.kill() } catch { /* already gone */ }
  helper = null
}
