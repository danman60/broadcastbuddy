import { BrowserWindow } from 'electron'
import { IPC } from '../../shared/types'
import * as overlay from '../services/overlay'
import { createLogger } from '../logger'

export const logger = createLogger('ipc')


export function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows()
  return windows.length > 0 ? windows[0] : null
}


/**
 * Broadcast a renderer-facing push to EVERY live BrowserWindow, not just the
 * main one. Overlay Mode floating panels (panel.tsx) are additional renderers
 * that share the same Zustand store + IPC listeners; single-window sends froze
 * them after their initial snapshot. Used for all shared overlay/playlist/obs/
 * record/stream/system/chat/event-log/recovery/startup state pushes.
 */
export function sendToAllWindows(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, ...args)
  }
}


export function pushState(): void {
  sendToAllWindows(IPC.OVERLAY_STATE_UPDATE, overlay.getOverlayState())
  sendToAllWindows(
    IPC.TRIGGERS_UPDATED,
    overlay.getTriggers(),
    overlay.getSelectedIndex(),
    overlay.getPlayedSet(),
    overlay.getLoopMode(),
  )
}


export function pushLastAdhoc(): void {
  sendToAllWindows(IPC.OVERLAY_LAST_ADHOC_UPDATE, overlay.getLastAdhoc())
}


export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
