import { ipcMain, dialog } from 'electron'
import fs from 'fs'
import { IPC, OverlayStyling, StartingSoonState } from '../../shared/types'
import * as overlay from '../services/overlay'
import * as settings from '../services/settings'
import { broadcastState } from '../services/wsHub'
import { getMainWindow, pushState, pushLastAdhoc, logger } from './common'

export function registerOverlayHandlers(): void {
  // ── Overlay control ──────────────────────────────────────────

  ipcMain.handle(IPC.OVERLAY_FIRE_LT, () => {
    overlay.fireLowerThird()
    pushState()
  })

  ipcMain.handle(IPC.OVERLAY_HIDE_LT, () => {
    overlay.hideLowerThird()
    pushState()
  })

  // ── Ad-hoc freeform lower-third (Phase D) ─────────────────────
  // Fire a one-off lower-third from arbitrary text. Does not touch the saved
  // triggers. Pushes the last-adhoc readout to the renderer + WS overlay.
  ipcMain.handle(IPC.OVERLAY_FIRE_ADHOC, (_e, title: string, subtitle?: string) => {
    overlay.fireAdhoc(typeof title === 'string' ? title : '', typeof subtitle === 'string' ? subtitle : '')
    pushState()
    pushLastAdhoc()
    broadcastState()
    return overlay.getLastAdhoc()
  })

  ipcMain.handle(IPC.OVERLAY_GET_LAST_ADHOC, () => {
    return overlay.getLastAdhoc()
  })

  ipcMain.handle(IPC.OVERLAY_GET_STATE, () => {
    return overlay.getOverlayState()
  })

  ipcMain.handle(IPC.OVERLAY_UPDATE_STYLING, (_e, updates: Partial<OverlayStyling>) => {
    overlay.updateStyling(updates)
    pushState()
  })

  ipcMain.handle(IPC.OVERLAY_SET_LOGOS, (_e, company: string, client: string) => {
    overlay.setCompanyLogo(company)
    overlay.setClientLogo(client)
    pushState()
  })

  ipcMain.handle(IPC.OVERLAY_SET_FC_LOGO, (_e, dataUrl: string) => {
    overlay.setFeatureCardLogo(dataUrl)
    settings.set('featureCardLogoPath', dataUrl || '')
    pushState()
  })

  ipcMain.handle(IPC.OVERLAY_GET_FC_LOGO, () => overlay.getFeatureCardLogo())
}

export function registerLogoTickerHandlers(): void {

  // ── Logo browse + convert to data URL ─────────────────────────

  ipcMain.handle(IPC.LOGO_BROWSE, async () => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return null

    const filePath = result.filePaths[0]
    try {
      const buffer = fs.readFileSync(filePath)
      const ext = filePath.split('.').pop()?.toLowerCase() || 'png'
      const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`
      return `data:${mime};base64,${buffer.toString('base64')}`
    } catch (err) {
      logger.error('Failed to read logo file:', err)
      return null
    }
  })

  // ── Ticker ─────────────────────────────────────────────────────

  ipcMain.handle(IPC.TICKER_SHOW, (_e, text: string, speed?: number, bgColor?: string, textColor?: string) => {
    overlay.showTicker(text, speed, bgColor, textColor)
    pushState()
  })

  ipcMain.handle(IPC.TICKER_HIDE, () => {
    overlay.hideTicker()
    pushState()
  })

  ipcMain.handle(IPC.TICKER_UPDATE, (_e, updates: Partial<import('../../shared/types').OverlayState['ticker']>) => {
    overlay.updateTicker(updates)
    pushState()
  })
}

export function registerStartingSoonHandlers(): void {

  // ── Starting Soon ──────────────────────────────────────────────

  ipcMain.handle(IPC.STARTING_SOON_SHOW, () => {
    overlay.showStartingSoon()
    pushState()
    broadcastState()
  })

  ipcMain.handle(IPC.STARTING_SOON_HIDE, () => {
    overlay.hideStartingSoon()
    pushState()
    broadcastState()
  })

  ipcMain.handle(IPC.STARTING_SOON_UPDATE, (_e, updates: Partial<StartingSoonState>) => {
    overlay.updateStartingSoon(updates)
    pushState()
    broadcastState()
  })
}

export function registerOverlayExtrasHandlers(): void {

  // ── Up Next / That Was ────────────────────────────────────────

  ipcMain.handle(IPC.OVERLAY_FIRE_UP_NEXT, (_e, label?: string) => {
    const fired = overlay.fireUpNext(label || 'UP NEXT')
    pushState()
    broadcastState()
    return { fired }
  })

  ipcMain.handle(IPC.OVERLAY_FIRE_THAT_WAS, (_e, label?: string) => {
    const fired = overlay.fireThatWas(label || 'THAT WAS')
    pushState()
    broadcastState()
    return { fired }
  })

  // ── Overlay leveling grid ─────────────────────────────────────

  ipcMain.handle(IPC.OVERLAY_GRID_TOGGLE, () => {
    const visible = overlay.toggleGrid()
    pushState()
    broadcastState()
    return { visible }
  })

  // ── On-air clock ──────────────────────────────────────────────

  ipcMain.handle(IPC.OVERLAY_CLOCK_TOGGLE, () => {
    const visible = overlay.toggleClock()
    pushState()
    broadcastState()
    return { visible }
  })

  ipcMain.handle(IPC.OVERLAY_CLOCK_UPDATE, (_e, updates: Partial<import('../../shared/types').ClockState>) => {
    overlay.updateClock(updates)
    pushState()
    broadcastState()
  })

  // ── Counter ───────────────────────────────────────────────────

  ipcMain.handle(IPC.OVERLAY_COUNTER_TOGGLE, () => {
    const visible = overlay.toggleCounter()
    pushState()
    broadcastState()
    return { visible }
  })

  ipcMain.handle(IPC.OVERLAY_COUNTER_SET, (_e, value: number, label?: string) => {
    overlay.setCounter(value, label)
    pushState()
    broadcastState()
  })

  ipcMain.handle(IPC.OVERLAY_COUNTER_BUMP, (_e, delta: number) => {
    const value = overlay.bumpCounter(delta)
    pushState()
    broadcastState()
    return { value }
  })

  // ── Full-screen feature card ──────────────────────────────────

  ipcMain.handle(IPC.OVERLAY_FEATURE_SHOW, (_e, data: Partial<import('../../shared/types').FeatureCardState>) => {
    overlay.showFeatureCard(data)
    pushState()
    broadcastState()
  })

  ipcMain.handle(IPC.OVERLAY_FEATURE_UP_NEXT, (_e, kicker?: string) => {
    const fired = overlay.fireFeatureUpNext(kicker || 'UP NEXT')
    pushState()
    broadcastState()
    return { fired }
  })

  ipcMain.handle(IPC.OVERLAY_FEATURE_THAT_WAS, (_e, kicker?: string) => {
    const fired = overlay.fireFeatureThatWas(kicker || 'THAT WAS')
    pushState()
    broadcastState()
    return { fired }
  })

  ipcMain.handle(IPC.OVERLAY_FEATURE_HIDE, () => {
    overlay.hideFeatureCard()
    pushState()
    broadcastState()
  })

  // ── On-stream pinned chat-message overlay (CC viewer chat) ────────
  // Operator-side show/hide (mirrors the CC 'chat-message' relay path). Used by
  // the ChatPanel "show on screen" action and the OverlayControls toggle.
  ipcMain.handle(IPC.OVERLAY_SHOW_CHAT_MESSAGE, (_e, author?: string, text?: string) => {
    overlay.showChatMessage(typeof author === 'string' ? author : '', typeof text === 'string' ? text : '')
    pushState()
    broadcastState()
  })

  ipcMain.handle(IPC.OVERLAY_HIDE_CHAT_MESSAGE, () => {
    overlay.hideChatMessage()
    pushState()
    broadcastState()
  })
}
