import { ipcMain, dialog } from 'electron'
import fs from 'fs'
import path from 'path'
import { IPC } from '../../shared/types'
import * as session from '../services/session'
import * as settings from '../services/settings'
import * as obsConnection from '../services/obsConnection'
import * as slowZoom from '../services/slowZoom'
import * as systemMonitor from '../services/systemMonitor'
import { getMainWindow, sendToAllWindows } from './common'

// Push the RTMP server + stream key into OBS's custom stream service settings.
// Idempotent — pushing the same values twice is a no-op for OBS. Does NOT start
// streaming. Guards against clobbering OBS with blanks: OBS needs BOTH a server
// and a key, so if either is empty we skip silently (the CC reflection rule may
// carry a viewing link/embed without a stream key — that path must not reach here).
export async function pushStreamSettingsToObs(
  rtmpUrl: string,
  streamKey: string,
  context?: { event?: string },
): Promise<{ success: boolean; verified: boolean; error?: string }> {
  if (!rtmpUrl || !streamKey) {
    return { success: false, verified: false, error: 'rtmpUrl and streamKey both required' }
  }
  try {
    await obsConnection.sendRequest('SetStreamServiceSettings', {
      streamServiceType: 'rtmp_custom',
      streamServiceSettings: {
        server: rtmpUrl,
        key: streamKey,
      },
    })
    // success = "the Set call didn't throw". Now VERIFY it actually landed by
    // reading the settings back out of OBS (websocket v5). Do NOT throw on a
    // verify mismatch — return verified:false with a reason so callers/log can
    // see the Set succeeded but the read-back disagreed.
    let verified = false
    let verifyError: string | undefined
    try {
      const read = (await obsConnection.sendRequest('GetStreamServiceSettings')) as {
        streamServiceType?: string
        streamServiceSettings?: { server?: string; key?: string }
      }
      const s = read?.streamServiceSettings ?? {}
      const serverMatch = s.server === rtmpUrl
      // OBS usually returns the key; when it does and it's non-empty, require an
      // exact key match. But OBS can mask/omit the key in the read-back — in that
      // case (empty/absent key) we can't compare it, so a server match alone is
      // treated as verified (key-masking fallback).
      const returnedKey = typeof s.key === 'string' ? s.key : ''
      const keyMatch = returnedKey ? returnedKey === streamKey : true
      verified = serverMatch && keyMatch
      if (!verified) {
        verifyError = !serverMatch
          ? `server mismatch (got "${s.server ?? ''}")`
          : 'stream key read-back mismatch'
      }
    } catch (verr) {
      verifyError = `read-back failed: ${(verr as Error).message}`
    }

    if (verified) {
      sendToAllWindows('obs:stream-key-synced', {
        event: context?.event || '',
        server: rtmpUrl,
      })
    }
    return { success: true, verified, error: verified ? undefined : verifyError }
  } catch (err) {
    return { success: false, verified: false, error: (err as Error).message }
  }
}

export function registerObsConnectionHandlers(): void {

  // ── OBS Connection ─────────────────────────────────────────────

  ipcMain.handle(IPC.OBS_CONNECT, async (_e, host: string, port: number, password?: string) => {
    try {
      await obsConnection.connect(host, port, password)
      return { connected: true }
    } catch (err) {
      return { connected: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.OBS_DISCONNECT, () => {
    obsConnection.disconnect()
    return { connected: false }
  })

  ipcMain.handle(IPC.OBS_STATUS, () => {
    return { connected: obsConnection.isConnected() }
  })

  ipcMain.handle(IPC.OBS_GET_TIMECODE, async () => {
    return obsConnection.getRecordTimecode()
  })

  // ── OBS stream control + replay buffer (fail soft when disconnected) ──────
  ipcMain.handle(IPC.OBS_START_STREAM, async () => {
    if (!obsConnection.isConnected()) return { success: false, error: 'OBS not connected' }
    try { await obsConnection.startStreaming(); return { success: true } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle(IPC.OBS_STOP_STREAM, async () => {
    if (!obsConnection.isConnected()) return { success: false, error: 'OBS not connected' }
    try { await obsConnection.stopStreaming(); return { success: true } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle(IPC.OBS_SAVE_REPLAY, async () => {
    if (!obsConnection.isConnected()) return { success: false, error: 'OBS not connected' }
    try { await obsConnection.saveReplayBuffer(); return { success: true } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle(IPC.OBS_STREAM_STATUS, async () => {
    return obsConnection.getStreamStatus()
  })
}

export function registerObsRecordingHandlers(): void {

  ipcMain.handle(IPC.OBS_PUSH_STREAM_KEY, async (_e, rtmpUrl: string, streamKey: string) => {
    return pushStreamSettingsToObs(rtmpUrl, streamKey, {
      event: session.getCurrentSession()?.name || '',
    })
  })

  // ── OBS Recording control ─────────────────────────────────────

  // Push live record-state + audio levels to the renderer. RecordStateChanged
  // arrives on the Outputs subscription; InputVolumeMeters on the high-volume
  // subscription (both OR-ed into the Identify bitmask in obsConnection.ts).
  obsConnection.setOnRecordStateChanged((state) => {
    sendToAllWindows(IPC.OBS_RECORD_STATE_UPDATE, state)
  })

  obsConnection.setOnAudioLevels((levels) => {
    sendToAllWindows(IPC.OBS_AUDIO_LEVELS, levels)
  })

  // Push live stream state + replay-saved notices to the renderer.
  obsConnection.setOnStreamStateChanged((state) => {
    sendToAllWindows(IPC.OBS_STREAM_STATE_UPDATE, state)
  })

  obsConnection.setOnReplaySaved((replayPath) => {
    sendToAllWindows(IPC.OBS_REPLAY_SAVED, { path: replayPath })
  })

  // System monitor → renderer (stats ~5s + disk alerts).
  systemMonitor.setOnStats((stats) => {
    sendToAllWindows(IPC.SYSTEM_STATS, stats)
  })

  systemMonitor.setOnDiskAlert((alert) => {
    sendToAllWindows(IPC.SYSTEM_DISK_ALERT, alert)
  })

  ipcMain.handle(IPC.OBS_START_RECORD, async () => {
    try {
      await obsConnection.startRecording()
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.OBS_STOP_RECORD, async () => {
    try {
      const outputPath = await obsConnection.stopRecording()
      return { success: true, outputPath }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.OBS_TOGGLE_RECORD, async () => {
    try {
      const active = await obsConnection.toggleRecording()
      return { success: true, active }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.OBS_RECORD_STATUS, async () => {
    return obsConnection.getRecordStatus()
  })
}

export function registerRecordingFileHandlers(): void {

  ipcMain.handle(IPC.OBS_GET_LAST_RECORDING, async () => {
    try {
      const result = await obsConnection.sendRequest('GetLastReplayBufferReplay') as { savedReplayPath?: string } | null
      if (result?.savedReplayPath) return { success: true, path: result.savedReplayPath }
      // Try GetRecordDirectory for the latest file
      const dirResult = await obsConnection.sendRequest('GetRecordDirectory') as { recordDirectory?: string } | null
      if (dirResult?.recordDirectory) {
        // Find most recent video file in directory
        const dir = dirResult.recordDirectory
        try {
          const files = fs.readdirSync(dir)
            .filter(f => /\.(mp4|mkv|mov|flv|ts|webm|avi)$/i.test(f))
            .map(f => ({ name: f, time: fs.statSync(path.join(dir, f)).mtime.getTime() }))
            .sort((a, b) => b.time - a.time)
          if (files.length > 0) {
            return { success: true, path: path.join(dir, files[0].name) }
          }
        } catch { /* ignore directory read errors */ }
      }
      return { success: false, error: 'No recording found' }
    } catch {
      return { success: false, error: 'OBS not connected or no recording available' }
    }
  })

  ipcMain.handle(IPC.RECORDING_BROWSE, async () => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Video Files', extensions: ['mp4', 'mkv', 'mov', 'flv', 'ts', 'webm', 'avi'] }],
    })
    return result.canceled ? null : result.filePaths[0]
  })
}

export function registerSlowZoomHandlers(): void {

  // ── OBS Slow Zoom ─────────────────────────────────────────────

  ipcMain.handle(IPC.OBS_SLOW_ZOOM_TRIGGER_WIDE, async () => {
    return slowZoom.triggerWide()
  })

  ipcMain.handle(IPC.OBS_SLOW_ZOOM_TRIGGER_TIGHT, async () => {
    return slowZoom.triggerTight()
  })

  ipcMain.handle(IPC.OBS_SLOW_ZOOM_STATUS, () => {
    return slowZoom.getStatus()
  })
}

export function registerTransitionHandlers(): void {

  // ── OBS Transition auto-revert ────────────────────────────────

  ipcMain.handle(IPC.OBS_TRANSITION_REVERT_GET, () => {
    return { enabled: obsConnection.isTransitionRevertEnabled() }
  })

  ipcMain.handle(IPC.OBS_TRANSITION_REVERT_SET, (_e, enabled: boolean) => {
    obsConnection.setTransitionRevertEnabled(enabled)
    settings.set('obsTransitionRevert', enabled)
    return { enabled }
  })
}
