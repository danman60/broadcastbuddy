import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { IPC, Trigger, StreamConfig, StartingSoonState, BroadcastPackage } from '../../shared/types'
import * as overlay from '../services/overlay'
import * as session from '../services/session'
import * as settings from '../services/settings'
import * as obsConnection from '../services/obsConnection'
import * as chatBridge from '../services/chatBridge'
import * as ccRelay from '../services/ccRelay'
import { applyOverlayConfigToStyling } from '../services/overlayConfigApply'
import * as events from '../services/events'
import { broadcastState } from '../services/wsHub'
import type { ChatConfig, CcRelayConfig } from '../../shared/types'
import { getMainWindow, sendToAllWindows, pushState, pushLastAdhoc, generateId } from './common'
import { pushStreamSettingsToObs } from './obs-record'

/**
 * Apply a relayed (or test-injected) overlay-config payload to the live overlay
 * styling and push state. Guards non-object payloads. Shared by the ccRelay
 * 'overlay-config' callback and the CC_RELAY_APPLY_OVERLAY_CONFIG test IPC.
 */
function applyRelayedOverlayConfig(payload: unknown): void {
  if (!payload || typeof payload !== 'object') return
  const updates = applyOverlayConfigToStyling(payload as Record<string, unknown>)
  if (Object.keys(updates).length > 0) {
    overlay.updateStyling(updates)
  }
  applyOverlayContent((payload as Record<string, unknown>).content)
  pushState()
}


/**
 * Apply the CC overlay-editor `content` block (direct text + logos) to the live
 * overlay state. Additive + fully guarded — an absent/invalid `content` is a
 * no-op. Maps to the real overlay.ts setters:
 *   logos       → setCompanyLogo / setClientLogo (visibility derived from dataUrl)
 *   startingSoon → updateStartingSoon (title/subtitle/sectionLabel/countdown/
 *                  completion + media flags)
 *   featureCard  → setFeatureCardContent (stores content; next fire animates it)
 *   sample (lower-third preview text) is editor-only — not pushed live.
 */
function applyOverlayContent(content: unknown): void {
  if (!content || typeof content !== 'object') return
  const c = content as Record<string, unknown>
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)
  const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)

  // ── Logos ──
  if (c.logos && typeof c.logos === 'object') {
    const l = c.logos as Record<string, unknown>
    if (typeof l.companyDataUrl === 'string') {
      overlay.setCompanyLogo(l.showCompany === false ? '' : l.companyDataUrl)
    }
    if (typeof l.clientDataUrl === 'string') {
      overlay.setClientLogo(l.showClient === false ? '' : l.clientDataUrl)
    }
  }

  // ── Starting Soon content ──
  if (c.startingSoon && typeof c.startingSoon === 'object') {
    const s = c.startingSoon as Record<string, unknown>
    const ssUpdates: Partial<StartingSoonState> = {}
    if (str(s.title) !== undefined) ssUpdates.title = str(s.title)
    if (str(s.subtitle) !== undefined) ssUpdates.subtitle = str(s.subtitle)
    if (str(s.sectionLabel) !== undefined) ssUpdates.sectionLabel = str(s.sectionLabel)
    if (str(s.completionText) !== undefined) ssUpdates.completionText = str(s.completionText)
    if (num(s.countdownSeconds) !== undefined) ssUpdates.countdownSeconds = num(s.countdownSeconds)
    if (bool(s.showCountdown) !== undefined) ssUpdates.showCountdown = bool(s.showCountdown)
    if (str(s.backdropVideoUrl) !== undefined) ssUpdates.backdropVideoUrl = str(s.backdropVideoUrl)
    if (s.backdropMode === 'cover' || s.backdropMode === 'none') ssUpdates.backdropMode = s.backdropMode
    const media: Record<string, unknown> = {}
    if (bool(s.showVisualizer) !== undefined) media.showVisualizer = bool(s.showVisualizer)
    if (bool(s.showVideo) !== undefined) media.showVideo = bool(s.showVideo)
    if (str(s.videoUrl) !== undefined) media.videoUrl = str(s.videoUrl)
    // updateStartingSoon merges media onto the existing media, so a partial is safe.
    if (Object.keys(media).length > 0) ssUpdates.media = media as unknown as StartingSoonState['media']
    if (Object.keys(ssUpdates).length > 0) overlay.updateStartingSoon(ssUpdates)
  }

  // ── Feature card content (stored; next fire animates it) ──
  if (c.featureCard && typeof c.featureCard === 'object') {
    const f = c.featureCard as Record<string, unknown>
    const fcUpdates: Record<string, string> = {}
    if (str(f.kicker) !== undefined) fcUpdates.kicker = str(f.kicker) as string
    if (str(f.title) !== undefined) fcUpdates.title = str(f.title) as string
    if (str(f.subtitle) !== undefined) fcUpdates.subtitle = str(f.subtitle) as string
    if (str(f.nextLabel) !== undefined) fcUpdates.nextLabel = str(f.nextLabel) as string
    if (str(f.nextTitle) !== undefined) fcUpdates.nextTitle = str(f.nextTitle) as string
    if (Object.keys(fcUpdates).length > 0) overlay.setFeatureCardContent(fcUpdates)
  }
}


/**
 * Apply a relayed (or operator-triggered) pinned chat-message to the on-stream
 * overlay. Payload from CC's 'chat-message' broadcast:
 *   { messageId, author, text, pinned }  — pinned:true shows, false hides.
 * Fully guarded so a malformed relay payload can't throw inside the callback.
 */
function applyRelayedChatMessage(payload: unknown): void {
  const p = (payload ?? {}) as { author?: unknown; text?: unknown; pinned?: unknown }
  const pinned = p.pinned !== false // default to show unless explicitly unpinned
  if (pinned) {
    const author = typeof p.author === 'string' ? p.author : ''
    const text = typeof p.text === 'string' ? p.text : ''
    if (!text) return
    overlay.showChatMessage(author, text)
  } else {
    overlay.hideChatMessage()
  }
  pushState()
  broadcastState()
}

export function registerPackageHandlers(): void {

  // ── Command Center broadcast package ──────────────────────────

  ipcMain.handle(IPC.CC_FETCH_EVENTS, async (_e, baseUrl: string, apiKey: string, tenantId: string) => {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/api/v1/broadcast-package`
      const res = await fetch(url, {
        headers: { 'X-API-Key': apiKey, 'X-Tenant-Id': tenantId },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      return { success: true, events: await res.json() }
    } catch (err) {
      return { success: false, error: (err as Error).message, events: [] }
    }
  })

  ipcMain.handle(IPC.CC_FETCH_PACKAGE, async (_e, baseUrl: string, apiKey: string, tenantId: string, eventId: string) => {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/api/v1/broadcast-package/${eventId}`
      const res = await fetch(url, {
        headers: { 'X-API-Key': apiKey, 'X-Tenant-Id': tenantId },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      const body = await res.json() as any
      // CC wraps in { success, data }
      return { success: true, package: body.data || body }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // Fetch a remote image and return it as a base64 data URL, or '' on any
  // failure. Shared by the CC-apply logo paths (per-trigger / company / client).
  async function fetchAsDataUrl(url?: string | null): Promise<string> {
    if (!url) return ''
    try {
      const res = await fetch(url)
      if (!res.ok) return ''
      const buffer = Buffer.from(await res.arrayBuffer())
      const contentType = res.headers.get('content-type') || 'image/png'
      return `data:${contentType};base64,${buffer.toString('base64')}`
    } catch {
      return ''
    }
  }

  ipcMain.handle(IPC.CC_APPLY_PACKAGE, async (_e, pkg: BroadcastPackage, eventId?: string) => {
    // Convert CC triggers to BB triggers, fetching logos in parallel
    const newTriggers: Trigger[] = await Promise.all(
      pkg.triggers.map(async (t, i) => {
        const logoDataUrl = await fetchAsDataUrl(t.logoUrl)
        return {
          id: generateId() + i,
          name: t.name || t.title || '',
          title: t.title || t.name,
          subtitle: t.subtitle || '',
          category: t.category || t.shiftName || (t.type === 'title_card' ? 'Title' : ''),
          order: i,
          logoDataUrl,
          type: t.type || 'lower_third',
        }
      })
    )

    // Apply triggers
    overlay.clearAllTriggers()
    for (const t of newTriggers) {
      overlay.addTrigger(t)
    }
    // Auto-select the first trigger so the lower-third/preview has content
    // immediately and Up Next / That Was are enabled (clearAllTriggers reset
    // selectedIndex to -1, which otherwise fires an empty card until a manual click).
    if (overlay.getTriggers().length > 0) {
      overlay.selectTrigger(0)
    }

    // Apply stream config if any streaming field is present
    if (pkg.streaming.streamKey || pkg.streaming.rtmpUrl || pkg.streaming.livestreamUrl || pkg.streaming.embedCode) {
      const streamConfig: StreamConfig = {
        streamKey: pkg.streaming.streamKey || '',
        rtmpUrl: pkg.streaming.rtmpUrl || '',
        viewingLink: pkg.streaming.livestreamUrl || '',
        embedCode: pkg.streaming.embedCode || '',
        chatLink: '',
      }
      overlay.setStreamConfig(streamConfig)
      // Persist too — setStreamConfig alone only sets the in-memory variable, so
      // without this the applied stream key/url is lost on restart (matches the
      // manual STREAM_CONFIG_SET handler which also writes to settings).
      settings.set('streamConfig', streamConfig)

      // Auto-push to OBS if it's connected and we have both server + key. OBS
      // needs both, so a CC reflection carrying only a viewing link/embed is
      // skipped by pushStreamSettingsToObs. Failure must not throw out of the
      // handler — catch + log.
      if (obsConnection.isConnected() && streamConfig.rtmpUrl && streamConfig.streamKey) {
        try {
          // BroadcastPackage has no client.name/event.title — the real name
          // fields are event.eventName / client.organization. Fall back to the
          // live session name if the package omits both.
          const eventName =
            pkg.event?.eventName ||
            pkg.client?.organization ||
            session.getCurrentSession()?.name ||
            ''
          const r = await pushStreamSettingsToObs(
            streamConfig.rtmpUrl,
            streamConfig.streamKey,
            { event: eventName },
          )
          if (r.success) {
            events.recordEvent(
              'cc',
              r.verified
                ? 'Auto-pushed + verified stream key in OBS on package apply'
                : `Auto-pushed stream key on apply but verify failed: ${r.error}`,
            )
          } else {
            events.recordEvent('error', `Auto-push stream key on apply failed: ${r.error}`)
          }
        } catch (err) {
          events.recordEvent('error', `Auto-push stream key on apply threw: ${(err as Error).message}`)
        }
      }
    }

    // Apply company logo if available
    const companyLogo = await fetchAsDataUrl(pkg.company?.logoUrl)
    if (companyLogo) overlay.setCompanyLogo(companyLogo)

    // Apply client logo if available
    const clientLogo = await fetchAsDataUrl(pkg.client.logoUrl)
    if (clientLogo) overlay.setClientLogo(clientLogo)

    // Apply brand color as accent if available
    if (pkg.client.brandColor) {
      overlay.updateStyling({ accentColor: pkg.client.brandColor })
    }

    // Apply company primary color if no brand color
    if (!pkg.client.brandColor && pkg.company?.primaryColor) {
      overlay.updateStyling({ accentColor: pkg.company.primaryColor })
    }

    // Apply saved overlay config if present (lossless — see applyOverlayConfigToStyling).
    if (pkg.overlayConfig) {
      const oc = pkg.overlayConfig as Record<string, unknown>
      // CC ships brand styling under `overlayConfig.styling` (a ready
      // OverlayStyling partial derived from the tenant primary/secondary colors).
      // Apply it FIRST so a full editor payload at the top level (saved via
      // saveOverlayConfig) still wins. Apply-once + non-locking: updateStyling
      // merges, so absent fields are a no-op and later operator edits override.
      if (oc.styling && typeof oc.styling === 'object') {
        const brandUpdates = applyOverlayConfigToStyling(oc.styling as Record<string, unknown>)
        if (Object.keys(brandUpdates).length > 0) {
          overlay.updateStyling(brandUpdates)
        }
      }
      const stylingUpdates = applyOverlayConfigToStyling(oc)
      if (Object.keys(stylingUpdates).length > 0) {
        overlay.updateStyling(stylingUpdates)
      }
      applyOverlayContent(oc.content)
    }

    // Ensure a session backs the applied package so operator edits auto-persist
    // (overlay auto-save is guarded on a loaded session). Only adopt+save when
    // NO session is loaded — if one already is, the debounced auto-save persists
    // the applied content into it; force-saving here would silently overwrite a
    // manually-loaded session's saved file the moment a package is applied.
    if (!session.getCurrentSession()) {
      session.newSession(pkg.client?.organization ? `${pkg.client.organization} (live)` : 'CC Package')
      session.saveSession(
        overlay.getTriggers(),
        overlay.getStyling(),
        overlay.getOverlayState().companyLogo.dataUrl,
        overlay.getOverlayState().clientLogo.dataUrl,
        overlay.getSelectedIndex(),
        overlay.getPlayedSet(),
        overlay.getLoopMode(),
        overlay.getNotes(),
        overlay.getStreamConfig(),
      )
    }

    pushState()

    // Push recording upload context + checklist to renderer
    const win = getMainWindow()
    if (win) {
      const folderUrl = pkg.drive?.eventFolderUrl || pkg.drive?.clientFolderUrl || null
      win.webContents.send('cc:recording-context', pkg.eventId || eventId || '', pkg.event.eventName, folderUrl)
      win.webContents.send('cc:checklist-update', pkg.checklist || [])
      win.webContents.send('cc:package-applied', {
        eventId: pkg.eventId || eventId,
        eventName: pkg.event.eventName,
        company: pkg.company,
        version: pkg.version,
      })
    }

    // Auto-arm the CC→BB live relay if the package carries a `realtime` block.
    // tenantId comes from the saved CC connection settings used for the fetch.
    // No realtime block → leave the relay dormant (back-compat with old packages).
    const rt = pkg.realtime
    const resolvedEventId = pkg.eventId || eventId || ''
    const cc = settings.get('ccConfig') as { tenantId?: string } | undefined
    const tenantId = cc?.tenantId || ''
    // Call ccRelay.init whenever the package carries Supabase realtime creds —
    // NOT gated on tenantId. The PRIMARY relay channel (bb:<tenant>:<event>)
    // still only connects when tenantId+eventId are present (ccRelay.isReady),
    // but the VIEWER-CHAT feed (livestream:<streamEventId>) arms independently
    // inside init() and needs no tenantId. Gating the whole init on tenantId is
    // what left the operator chat panel empty all night (2026-06-19 Ancaster):
    // the package was applied via API fetch with no saved tenantId, so init
    // never ran and the chat feed never subscribed.
    if (rt && rt.supabaseUrl && rt.supabaseAnonKey) {
      const relayCfg: CcRelayConfig = {
        enabled: true,
        supabaseUrl: rt.supabaseUrl,
        supabaseAnonKey: rt.supabaseAnonKey,
        tenantId,
        eventId: resolvedEventId,
        // CC viewer-chat feed ('livestream:<streamEventId>'). Absent (no linked
        // StreamEvent at package build) → feed stays dormant.
        chatChannel: rt.chatChannel,
      }
      // Persist so a mid-show BB restart re-arms the relay + chat feed at
      // startup without re-applying the package (see registration block).
      settings.set('ccRelayConfig', relayCfg)
      ccRelay.init(relayCfg)
    }

    // Arm the operator chat bridge from the SAME realtime block. It was fully
    // built but never initialized from the package, so chat stayed dormant.
    // chatBridge.init() disconnects any prior channel first, so a double-apply
    // does not leak a second subscription. Preserve any persisted banned authors
    // and re-persist the resolved config so it survives a restart.
    if (rt && rt.supabaseUrl && rt.supabaseAnonKey && resolvedEventId) {
      const prevChatCfg = settings.get('chatConfig') as ChatConfig | undefined
      const chatCfg: ChatConfig = {
        supabaseUrl: rt.supabaseUrl,
        supabaseAnonKey: rt.supabaseAnonKey,
        eventId: resolvedEventId,
        enabled: true,
        bannedAuthors: prevChatCfg?.bannedAuthors ?? [],
      }
      settings.set('chatConfig', chatCfg)
      chatBridge.init(chatCfg)
    }

    return { success: true, triggerCount: newTriggers.length }
  })

  ipcMain.handle(IPC.CC_UPLOAD_RECORDING, async (_e, baseUrl: string, apiKey: string, tenantId: string, eventId: string, filePath: string, fileName?: string) => {
    try {
      const fileBuffer = fs.readFileSync(filePath)
      const ext = path.extname(filePath).toLowerCase()
      const mimeMap: Record<string, string> = {
        '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo', '.flv': 'video/x-flv', '.ts': 'video/mp2t', '.webm': 'video/webm',
      }
      const mime = mimeMap[ext] || 'video/mp4'
      const name = fileName || path.basename(filePath)

      const formData = new FormData()
      formData.append('file', new Blob([fileBuffer], { type: mime }), name)
      formData.append('eventId', eventId)
      if (fileName) formData.append('fileName', fileName)

      const url = `${baseUrl.replace(/\/$/, '')}/api/v1/broadcast-package/upload`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'X-API-Key': apiKey, 'X-Tenant-Id': tenantId },
        body: formData,
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      const body = await res.json() as any
      return { success: true, ...body }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // ── CC Checklist sync ────────────────────────────────────────────

  ipcMain.handle(IPC.CC_FETCH_CHECKLIST, async (_e, baseUrl: string, apiKey: string, tenantId: string, eventId: string) => {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/api/v1/broadcast-package/${eventId}/checklist`
      const res = await fetch(url, {
        headers: { 'X-API-Key': apiKey, 'X-Tenant-Id': tenantId },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      const body = await res.json() as any
      return { success: true, checklist: body.data || [] }
    } catch (err) {
      return { success: false, error: (err as Error).message, checklist: [] }
    }
  })

  ipcMain.handle(IPC.CC_SYNC_CHECKLIST, async (_e, baseUrl: string, apiKey: string, tenantId: string, eventId: string, items: Array<{ id: string; checked: boolean }>) => {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/api/v1/broadcast-package/${eventId}/checklist`
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          'X-API-Key': apiKey,
          'X-Tenant-Id': tenantId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ items }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      const body = await res.json() as any
      return { success: true, updated: body.updated }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.CC_SAVE_OVERLAY_CONFIG, async (_e, baseUrl: string, apiKey: string, tenantId: string, eventId: string, config: Record<string, unknown>) => {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/api/v1/broadcast-package/${eventId}/overlay-config`
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          'X-API-Key': apiKey,
          'X-Tenant-Id': tenantId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
}

export function registerChatRelayHandlers(): void {

  // ── Operator chat (Supabase Realtime, off by default) ─────────

  // Push chat-state changes to the renderer.
  chatBridge.setOnStateChange(() => {
    sendToAllWindows(IPC.CHAT_STATE_UPDATE, chatBridge.getState())
  })

  // Pinning a message fires it as a lower-third broadcast.
  chatBridge.setOnMessagePinned((msg) => {
    overlay.fireText(msg.text, msg.author ? `— ${msg.author}` : '', 'PINNED')
    pushState()
    broadcastState()
  })

  // Initialize from saved config at registration time. If chat is unconfigured
  // or disabled this no-ops and never touches the network.
  chatBridge.init(settings.get('chatConfig') as ChatConfig | undefined)

  ipcMain.handle(IPC.CHAT_GET_STATE, () => {
    return chatBridge.getState()
  })

  ipcMain.handle(IPC.CHAT_RECONFIGURE, () => {
    chatBridge.init(settings.get('chatConfig') as ChatConfig | undefined)
    return chatBridge.getState()
  })

  ipcMain.handle(IPC.CHAT_SEND, async (_e, text: string, author?: string) => {
    const ok = await chatBridge.sendMessage(text, author)
    return { ok }
  })

  ipcMain.handle(IPC.CHAT_PIN, async (_e, id: string) => {
    const ok = await chatBridge.pinMessage(id)
    return { ok }
  })

  ipcMain.handle(IPC.CHAT_UNPIN, async (_e, id: string) => {
    const ok = await chatBridge.unpinMessage(id)
    return { ok }
  })

  ipcMain.handle(IPC.CHAT_FIRE_MESSAGE, (_e, id: string) => {
    const msg = chatBridge.getMessageById(id)
    if (!msg) return { fired: false }
    overlay.fireText(msg.text, msg.author ? `— ${msg.author}` : '', 'PINNED')
    pushState()
    broadcastState()
    return { fired: true }
  })

  // ── Operator chat moderation ──────────────────────────────────
  // Persist banned-author changes back into chatConfig so they survive a
  // reconnect / app restart. chatBridge fires this on every ban/unban.
  chatBridge.setOnBannedAuthorsChange((authors) => {
    const cfg = (settings.get('chatConfig') as ChatConfig | undefined) ?? { supabaseUrl: '', supabaseAnonKey: '', eventId: '', enabled: false }
    settings.set('chatConfig', { ...cfg, bannedAuthors: authors })
  })

  ipcMain.handle(IPC.CHAT_HIDE, async (_e, id: string) => {
    const ok = await chatBridge.hideMessage(id)
    return { ok }
  })

  ipcMain.handle(IPC.CHAT_BAN_AUTHOR, (_e, author: string) => {
    const ok = chatBridge.banAuthor(author)
    return { ok, bannedAuthors: chatBridge.getBannedAuthors() }
  })

  ipcMain.handle(IPC.CHAT_UNBAN_AUTHOR, (_e, author: string) => {
    const ok = chatBridge.unbanAuthor(author)
    return { ok, bannedAuthors: chatBridge.getBannedAuthors() }
  })

  ipcMain.handle(IPC.CHAT_LIVESTREAM_PIN, async (_e, id: string) => {
    const ok = await chatBridge.livestreamPin(id)
    return { ok }
  })

  ipcMain.handle(IPC.CHAT_LIVESTREAM_UNPIN, async (_e, id: string) => {
    const ok = await chatBridge.livestreamUnpin(id)
    return { ok }
  })

  // ── CC→BB live relay (Supabase Realtime broadcast, dormant until armed) ───────

  // A relayed 'package' broadcast applies identically to a WS package push:
  // forward it to the renderer as cc:package-pushed, which auto-applies via the
  // same BroadcastPackagePanel path as a manual pull.
  ccRelay.setOnPackage((payload) => {
    if (payload) sendToAllWindows('cc:package-pushed', payload)
  })

  // A relayed 'adhoc' broadcast fires a one-off lower-third identically to the
  // local Ad-hoc box. Validate defensively (strings, fallback empty) so a
  // malformed payload can't throw inside the relay callback.
  ccRelay.setOnAdhoc((payload) => {
    const p = (payload ?? {}) as { title?: unknown; subtitle?: unknown }
    const title = typeof p.title === 'string' ? p.title : ''
    const subtitle = typeof p.subtitle === 'string' ? p.subtitle : ''
    overlay.fireAdhoc(title, subtitle)
    pushState()
    pushLastAdhoc()
    broadcastState()
  })

  // A relayed 'overlay-config' broadcast is a live editor sync from CC. Apply the
  // OverlayStyling-shaped payload losslessly to the live overlay styling (incl
  // layout + per-element styling) and push the new state to the browser source.
  ccRelay.setOnOverlayConfig((payload) => {
    applyRelayedOverlayConfig(payload)
  })

  // A relayed 'chat-message' broadcast (CC operator pinned/unpinned a viewer-chat
  // message) drives the on-stream chat-message overlay. pinned:true shows it,
  // pinned:false hides it.
  ccRelay.setOnChatMessage((payload) => {
    applyRelayedChatMessage(payload)
  })

  // Push relay connection-state changes to the renderer so the UI can show it.
  ccRelay.setOnStateChange(() => {
    sendToAllWindows(IPC.CC_RELAY_STATE_UPDATE, ccRelay.getState())
  })

  // Re-arm the CC relay + viewer-chat feed from persisted config at startup, so
  // a mid-show BB restart restores live chat without re-applying the package.
  // No-ops (and stays dormant) when nothing was ever applied.
  ccRelay.init(settings.get('ccRelayConfig') as CcRelayConfig | undefined)

  ipcMain.handle(IPC.CC_RELAY_GET_STATE, () => {
    return ccRelay.getState()
  })

  // Test/diagnostic: simulate an inbound 'overlay-config' relay broadcast. Drives
  // the exact same apply path as ccRelay.setOnOverlayConfig with no network.
  ipcMain.handle(IPC.CC_RELAY_APPLY_OVERLAY_CONFIG, (_e, cfg: Record<string, unknown>) => {
    applyRelayedOverlayConfig(cfg)
    return { success: true }
  })
}
