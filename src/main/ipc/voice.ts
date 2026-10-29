import { ipcMain } from 'electron'
import { IPC } from '../../shared/types'
import * as voiceDirector from '../services/voiceDirector'

export function registerVoiceHandlers(): void {

  // ── Voice-driven PTZ director (guarded; no-op unless voiceEnabled) ──────────
  ipcMain.handle(IPC.VOICE_PTT, (_e, args: { down: boolean }) => {
    if (args?.down) voiceDirector.pttDown()
    else voiceDirector.pttUp()
    return { ok: true }
  })

  ipcMain.handle(IPC.VOICE_REFRESH_GRAMMAR, () => {
    voiceDirector.refreshGrammar()
    return { ok: true }
  })

  ipcMain.handle(IPC.VOICE_GET_STATUS, () => {
    return voiceDirector.getStatus()
  })
}
