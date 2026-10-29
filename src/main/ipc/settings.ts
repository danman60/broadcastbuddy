import { ipcMain, dialog } from 'electron'
import { IPC } from '../../shared/types'
import * as settings from '../services/settings'
import * as voiceDirector from '../services/voiceDirector'
import * as hotkeys from '../services/hotkeys'
import type { UserStylePreset } from '../../shared/types'
import { getMainWindow } from './common'

export function registerSettingsHandlers(): void {

  // ── Settings ──────────────────────────────────────────────────

  ipcMain.handle(IPC.SETTINGS_GET, () => {
    return settings.getAll()
  })

  ipcMain.handle(IPC.SETTINGS_SET, (_e, key: string, value: unknown) => {
    settings.set(key as keyof import('../../shared/types').AppSettings, value as never)
    // Re-register global hotkeys immediately when the operator edits them.
    if (key === 'hotkeys') hotkeys.register()
    // Voice director reacts to its own settings: start/stop on toggle, re-push the
    // SAPI grammar when shot labels change.
    if (key === 'voiceEnabled' || key === 'cameraHost' || key === 'cameraHost2') voiceDirector.applyVoiceEnabled()
    if (key === 'voiceShots') voiceDirector.refreshGrammar()
    if (key === 'voiceMicDeviceId') voiceDirector.applyMic()
    // Wake-word mode: re-push grammar (with/without the required prefix) + start/stop
    // the helper's continuous recognition.
    if (key === 'voiceWakeEnabled' || key === 'voiceWakeWord') voiceDirector.applyWakeMode()
    return settings.getAll()
  })

  ipcMain.handle(IPC.SETTINGS_BROWSE_FILE, async (_e, filters?: Electron.FileFilter[]) => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: filters || [{ name: 'All Files', extensions: ['*'] }],
    })
    return result.canceled ? null : result.filePaths[0]
  })
}

export function registerPresetHandlers(): void {

  // ── User style presets (operator-saved, alongside built-in PRESETS) ──
  ipcMain.handle(IPC.USER_PRESETS_LIST, () => {
    return settings.get('userPresets') ?? []
  })

  ipcMain.handle(IPC.USER_PRESETS_ADD, (_e, preset: UserStylePreset) => {
    const list = (settings.get('userPresets') ?? []).filter((p) => p.id !== preset.id)
    list.push(preset)
    settings.set('userPresets', list)
    return list
  })

  ipcMain.handle(IPC.USER_PRESETS_DELETE, (_e, id: string) => {
    const list = (settings.get('userPresets') ?? []).filter((p) => p.id !== id)
    settings.set('userPresets', list)
    return list
  })
}
