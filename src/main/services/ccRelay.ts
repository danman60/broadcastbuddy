/**
 * CC→BB Realtime relay — live broadcast-package (and future ad-hoc) push from
 * CommandCentered to the operator's LOCAL BroadcastBuddy.
 *
 * Why: CC runs on Vercel and cannot WebSocket-push to an operator's local BB
 * (no inbound route to the booth machine). Instead CC PUBLISHES on a Supabase
 * Realtime *broadcast* channel `bb:<tenantId>:<eventId>` via the Realtime REST
 * endpoint, and BB SUBSCRIBES to that same channel using the Supabase anon key.
 * The anon key is publishable, so it ships inside the broadcast package's
 * `realtime` block and arms this relay automatically on apply.
 *
 * Structure mirrors chatBridge.ts: config injected via init(); DORMANT (no
 * network) when missing/disabled/empty; exponential-backoff reconnect on
 * channel error. Uses Supabase *broadcast* events (NOT postgres_changes) — CC
 * pushes ephemeral messages, nothing is persisted to a table here.
 *
 * Events on the channel:
 *   - 'package' → a full BroadcastPackage (applied identically to a WS push)
 *   - 'adhoc'   → reserved for Phase D (ad-hoc lower-third); callback wired,
 *                 no consumer yet.
 */
import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'
import ws from 'ws'
import { CcRelayConfig, CcRelayState, ChatMessage } from '../../shared/types'
import { createLogger } from '../logger'
import { recordEvent } from './events'
import * as chatBridge from './chatBridge'

const logger = createLogger('ccRelay')

let config: CcRelayConfig | null = null
let supabase: SupabaseClient | null = null
let channel: RealtimeChannel | null = null
let connected = false
let reconnectTimer: NodeJS.Timeout | null = null
let reconnectDelayMs = 2000
let consecutiveFailures = 0
let started = false // user/auto-armed — auto-reconnect on failures

// ── CC viewer-chat feed (SELF-CONTAINED, ported from CSE chatBridge.ts) ───────
// The viewer-chat feed is the ONLY inbound path for CC viewer chat → operator
// ChatPanel (CC publishes viewer chat on a Supabase *broadcast* channel
// `livestream:<streamEventId>` event 'chat'; it never writes to a postgres
// `chat_messages` table, so BB's chatBridge postgres subscription gets nothing).
//
// It deliberately does NOT depend on the primary relay's tenantId/eventId. The
// prior implementation nested this inside connectChannel(), which bailed when
// `tenantId` was empty (ipc.ts only had tenantId when a CC connection was saved
// with one) — so an operator who applied a package without a saved tenantId got
// an empty chat panel all night (2026-06-19 Ancaster). Now it arms from
// url+anonKey+chatChannel alone, with its own client, subscribe-status logging,
// and exponential-backoff reconnect — exactly like CSE's chatBridge.
let chatSupabase: SupabaseClient | null = null
let chatChannelSub: RealtimeChannel | null = null
let chatChannelName = ''
let chatStarted = false
let chatReconnectTimer: NodeJS.Timeout | null = null
let chatReconnectDelayMs = 2000
let chatConsecutiveFailures = 0

let onStateChange: (() => void) | null = null
// Fired when a 'package' broadcast arrives — wired by ipc.ts to apply it via the
// same path as a WS package push (cc:package-pushed → renderer auto-apply).
let onPackage: ((payload: unknown) => void) | null = null
// Reserved for Phase D ad-hoc lower-thirds. Wired now; no consumer yet.
let onAdhoc: ((payload: unknown) => void) | null = null
// Fired when an 'overlay-config' broadcast arrives — live editor sync from CC.
// Payload is an OverlayStyling-shaped object ({ ...styling, layout, elements }).
let onOverlayConfig: ((payload: unknown) => void) | null = null
// Fired when a 'chat-message' broadcast arrives — CC operator pinned/unpinned a
// viewer-chat message. Payload: { messageId, author, text, pinned }. Wired by
// ipc.ts to drive the on-stream chat-message overlay.
let onChatMessage: ((payload: unknown) => void) | null = null

export function setOnStateChange(cb: () => void): void {
  onStateChange = cb
}

export function setOnPackage(cb: (payload: unknown) => void): void {
  onPackage = cb
}

export function setOnAdhoc(cb: (payload: unknown) => void): void {
  onAdhoc = cb
}

export function setOnOverlayConfig(cb: (payload: unknown) => void): void {
  onOverlayConfig = cb
}

export function setOnChatMessage(cb: (payload: unknown) => void): void {
  onChatMessage = cb
}

function notify(): void {
  try { onStateChange?.() } catch { /* ignore */ }
}

function channelName(): string {
  if (!config) return ''
  return `bb:${config.tenantId}:${config.eventId}`
}

function isReady(): boolean {
  return !!(
    config &&
    config.enabled &&
    config.supabaseUrl &&
    config.supabaseAnonKey &&
    config.tenantId &&
    config.eventId
  )
}

function scheduleReconnect(): void {
  if (!started) return
  if (reconnectTimer) clearTimeout(reconnectTimer)
  consecutiveFailures++
  reconnectDelayMs = Math.min(2000 * 2 ** Math.min(consecutiveFailures - 1, 4), 30000)
  logger.info(`Reconnecting in ${reconnectDelayMs}ms (attempt ${consecutiveFailures})`)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    teardownChannel()
    connectChannel()
  }, reconnectDelayMs)
}

function teardownChannel(): void {
  connected = false
  if (channel) {
    try { void channel.unsubscribe() } catch { /* ignore */ }
    channel = null
  }
}

/**
 * Map a CC viewer-chat payload `{ id, name, text, timestamp, isAdmin, isPinned }`
 * to the BB ChatMessage shape. Defensive — returns null on a malformed payload.
 *
 * `timestamp` is an ISO-8601 STRING on the wire (CC's ChatMessageWire), not a
 * number — the old code only accepted `number` and silently fell back to
 * Date.now() for every message. Now we parse the ISO string too.
 */
function ccChatToMessage(payload: unknown): ChatMessage | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  const id = typeof p.id === 'string' ? p.id : ''
  const text = typeof p.text === 'string' ? p.text : ''
  if (!id || !text) return null
  let createdAt = Date.now()
  if (typeof p.timestamp === 'number') {
    createdAt = p.timestamp
  } else if (typeof p.timestamp === 'string') {
    const parsed = Date.parse(p.timestamp)
    if (!Number.isNaN(parsed)) createdAt = parsed
  }
  return {
    id,
    author: typeof p.name === 'string' ? p.name : 'viewer',
    text,
    pinned: false, // operator pin is local-only; CC pin drives the chat-message overlay
    hidden: false,
    livestreamPinned: !!p.isPinned,
    createdAt,
  }
}

// ── CC viewer-chat feed: self-contained subscription (CSE chatBridge pattern) ──

function teardownChatFeed(): void {
  if (chatReconnectTimer) {
    clearTimeout(chatReconnectTimer)
    chatReconnectTimer = null
  }
  if (chatChannelSub) {
    try { void chatChannelSub.unsubscribe() } catch { /* ignore */ }
    chatChannelSub = null
  }
  if (chatSupabase) {
    try { chatSupabase.realtime.disconnect() } catch { /* ignore */ }
    chatSupabase = null
  }
}

function scheduleChatReconnect(): void {
  if (!chatStarted) return
  if (chatReconnectTimer) clearTimeout(chatReconnectTimer)
  chatConsecutiveFailures++
  chatReconnectDelayMs = Math.min(2000 * 2 ** Math.min(chatConsecutiveFailures - 1, 4), 30000)
  logger.info(`CC viewer-chat feed: reconnecting in ${chatReconnectDelayMs}ms (attempt ${chatConsecutiveFailures})`)
  chatReconnectTimer = setTimeout(() => {
    chatReconnectTimer = null
    connectChatFeed()
  }, chatReconnectDelayMs)
}

/**
 * Subscribe CC's viewer-chat feed on `livestream:<streamEventId>` (event 'chat')
 * with its OWN Supabase client, independent of the primary relay channel. Armed
 * by armChatFeed() whenever supabaseUrl + supabaseAnonKey + chatChannel are
 * present — no tenantId required. Each message is fed into chatBridge so the
 * operator ChatPanel renders CC viewer chat. Ported from CSE chatBridge.ts:
 * dedicated client + setAuth + subscribe-status handling + backoff reconnect.
 */
function connectChatFeed(): void {
  if (!config || !config.supabaseUrl || !config.supabaseAnonKey || !chatChannelName) return
  // Fresh client per (re)connect so a dead socket can't wedge the channel join.
  if (chatChannelSub) {
    try { void chatChannelSub.unsubscribe() } catch { /* ignore */ }
    chatChannelSub = null
  }
  if (chatSupabase) {
    try { chatSupabase.realtime.disconnect() } catch { /* ignore */ }
    chatSupabase = null
  }
  try {
    chatSupabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      // Electron Node 20 lacks global WebSocket — supply `ws` as transport.
      realtime: {
        transport: ws as unknown as typeof WebSocket,
        params: { apikey: config.supabaseAnonKey, eventsPerSecond: 10 },
      },
    })
    // Belt-and-suspenders: some Supabase projects require the channel join to
    // carry an access token even for public broadcast channels (CSE pattern).
    try { chatSupabase.realtime.setAuth(config.supabaseAnonKey) } catch (err) {
      logger.warn('CC viewer-chat feed: setAuth failed:', err instanceof Error ? err.message : err)
    }

    logger.info(`Subscribing to CC viewer-chat feed ${chatChannelName}`)
    chatChannelSub = chatSupabase
      .channel(chatChannelName, { config: { broadcast: { self: false, ack: false } } })
      .on('broadcast', { event: 'chat' }, ({ payload }) => {
        try {
          const msg = ccChatToMessage(payload)
          if (msg) chatBridge.ingestExternalMessage(msg)
        } catch (err) {
          logger.warn('CC chat-feed handler threw:', err instanceof Error ? err.message : err)
        }
      })
      .subscribe((status, err) => {
        logger.info(`CC viewer-chat feed status = ${status}${err ? ` err=${err.message}` : ''}`)
        if (status === 'SUBSCRIBED') {
          chatConsecutiveFailures = 0
          chatReconnectDelayMs = 2000
          recordEvent('cc', `CC viewer-chat feed connected (${chatChannelName})`)
        } else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
          scheduleChatReconnect()
        }
      })
  } catch (err) {
    logger.warn('connectChatFeed error:', err instanceof Error ? err.message : err)
    scheduleChatReconnect()
  }
}

/**
 * Arm (or re-arm) the CC viewer-chat feed from config. Idempotent: tears down
 * any prior feed first. Dormant when chatChannel is absent (no StreamEvent
 * linked at package build → CC ships chatChannel: null). Independent of the
 * primary relay's readiness, so it survives an empty tenantId.
 */
function armChatFeed(): void {
  teardownChatFeed()
  chatStarted = false
  if (!config || !config.supabaseUrl || !config.supabaseAnonKey || !config.chatChannel) {
    logger.info('CC viewer-chat feed: no chatChannel — staying dormant')
    return
  }
  chatChannelName = config.chatChannel
  chatStarted = true
  chatConsecutiveFailures = 0
  chatReconnectDelayMs = 2000
  connectChatFeed()
}

function connectChannel(): void {
  if (!isReady() || !config) return
  try {
    supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      // Electron Node 20 lacks global WebSocket — supply `ws` as transport.
      realtime: { transport: ws as unknown as typeof WebSocket, params: { eventsPerSecond: 10 } },
    })

    const name = channelName()
    logger.info(`Subscribing to ${name}`)

    channel = supabase
      .channel(name)
      .on('broadcast', { event: 'package' }, ({ payload }) => {
        try { onPackage?.(payload) } catch (err) {
          logger.warn('onPackage handler threw:', err instanceof Error ? err.message : err)
        }
      })
      .on('broadcast', { event: 'adhoc' }, ({ payload }) => {
        try { onAdhoc?.(payload) } catch (err) {
          logger.warn('onAdhoc handler threw:', err instanceof Error ? err.message : err)
        }
      })
      .on('broadcast', { event: 'overlay-config' }, ({ payload }) => {
        try { onOverlayConfig?.(payload) } catch (err) {
          logger.warn('onOverlayConfig handler threw:', err instanceof Error ? err.message : err)
        }
      })
      .on('broadcast', { event: 'chat-message' }, ({ payload }) => {
        try { onChatMessage?.(payload) } catch (err) {
          logger.warn('onChatMessage handler threw:', err instanceof Error ? err.message : err)
        }
      })
      .subscribe((status) => {
        logger.info(`Channel status = ${status}`)
        if (status === 'SUBSCRIBED') {
          connected = true
          consecutiveFailures = 0
          reconnectDelayMs = 2000
          recordEvent('cc', `Live relay connected (${name})`)
          notify()
        } else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
          connected = false
          notify()
          scheduleReconnect()
        }
      })
  } catch (err) {
    logger.warn('connectChannel error:', err instanceof Error ? err.message : err)
    connected = false
    notify()
    scheduleReconnect()
  }
}

/**
 * (Re)initialize from injected config. Safe to call repeatedly — disconnects
 * any prior channel first. No-ops (and disconnects) when config is missing or
 * disabled, so startup never crashes when the relay is unconfigured.
 */
export function init(cfg: CcRelayConfig | undefined): void {
  disconnect()
  config = cfg ?? null

  // The viewer-chat feed arms INDEPENDENTLY of the primary relay's readiness.
  // It needs only supabaseUrl + supabaseAnonKey + chatChannel (no tenantId), so
  // an operator who applies a package without a saved tenantId still gets live
  // chat in the operator panel. armChatFeed() no-ops when chatChannel is absent.
  armChatFeed()

  if (!isReady()) {
    logger.info('CC relay (package channel) disabled or not configured — staying dormant')
    notify()
    return
  }
  started = true
  consecutiveFailures = 0
  reconnectDelayMs = 2000
  connectChannel()
}

export function disconnect(): void {
  started = false
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  teardownChannel()
  teardownChatFeed()
  supabase = null
  connected = false
  notify()
}

export function getState(): CcRelayState {
  return {
    connected,
    enabled: !!(config && config.enabled),
    channel: config ? channelName() : '',
  }
}
