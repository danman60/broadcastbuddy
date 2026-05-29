// Global hotkeys (ported from CompSyncElectronApp).
//
// OS-level shortcuts via Electron globalShortcut — fire even when BB is
// unfocused (operator runs it behind OBS during a live show). Bindings come
// from settings.hotkeys; empty string = unbound. Re-register after the operator
// edits hotkeys in Settings (the ipc.ts settings handler calls register()).

import { globalShortcut } from 'electron'
import * as overlay from './overlay'
import * as obs from './obsConnection'
import { getSettings } from './settings'
import { DEFAULT_HOTKEYS, HotkeyConfig } from '../../shared/types'
import { createLogger } from '../logger'

const logger = createLogger('hotkeys')

let registeredKeys: string[] = []

export function register(): void {
  unregister() // clear existing first
  const hk: HotkeyConfig = { ...DEFAULT_HOTKEYS, ...(getSettings().hotkeys || {}) }

  registerKey(hk.fireLowerThird, 'Fire Lower Third', () => overlay.fireLowerThird())
  registerKey(hk.hideLowerThird, 'Hide Lower Third', () => overlay.hideLowerThird())
  registerKey(hk.nextTrigger, 'Next Trigger', () => overlay.nextTrigger())
  registerKey(hk.prevTrigger, 'Prev Trigger', () => overlay.prevTrigger())

  registerKey(hk.toggleRecording, 'Toggle Recording', async () => {
    if (!obs.isConnected()) {
      logger.debug('Toggle Recording ignored — OBS not connected')
      return
    }
    await obs.toggleRecording()
  })

  registerKey(hk.saveReplay, 'Save Replay', async () => {
    if (!obs.isConnected()) {
      logger.debug('Save Replay ignored — OBS not connected')
      return
    }
    await obs.saveReplayBuffer()
  })

  logger.info(`Global hotkeys registered: ${registeredKeys.join(', ') || '(none)'}`)
}

function registerKey(accelerator: string, label: string, callback: () => void | Promise<void>): void {
  if (!accelerator) return
  try {
    const ok = globalShortcut.register(accelerator, () => {
      logger.debug(`Hotkey pressed: ${accelerator} (${label})`)
      const result = callback()
      if (result instanceof Promise) {
        result.catch((err) => logger.error(`Hotkey ${label} error: ${err instanceof Error ? err.message : err}`))
      }
    })
    if (ok) registeredKeys.push(accelerator)
    else logger.warn(`Failed to register hotkey: ${accelerator} (${label}) — already taken?`)
  } catch (err) {
    logger.error(`Error registering hotkey ${accelerator}: ${err instanceof Error ? err.message : err}`)
  }
}

export function unregister(): void {
  try {
    globalShortcut.unregisterAll()
  } catch {
    /* app may not be ready */
  }
  registeredKeys = []
}
