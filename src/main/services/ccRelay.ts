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
import { CcRelayConfig, CcRelayState } from '../../shared/types'
import { createLogger } from '../logger'
import { recordEvent } from './events'

const logger = createLogger('ccRelay')

let config: CcRelayConfig | null = null
let supabase: SupabaseClient | null = null
let channel: RealtimeChannel | null = null
let connected = false
let reconnectTimer: NodeJS.Timeout | null = null
let reconnectDelayMs = 2000
let consecutiveFailures = 0
let started = false // user/auto-armed — auto-reconnect on failures

let onStateChange: (() => void) | null = null
// Fired when a 'package' broadcast arrives — wired by ipc.ts to apply it via the
// same path as a WS package push (cc:package-pushed → renderer auto-apply).
let onPackage: ((payload: unknown) => void) | null = null
// Reserved for Phase D ad-hoc lower-thirds. Wired now; no consumer yet.
let onAdhoc: ((payload: unknown) => void) | null = null
// Fired when an 'overlay-config' broadcast arrives — live editor sync from CC.
// Payload is an OverlayStyling-shaped object ({ ...styling, layout, elements }).
let onOverlayConfig: ((payload: unknown) => void) | null = null

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

function connectChannel(): void {
  if (!isReady() || !config) return
  try {
    supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      realtime: { params: { eventsPerSecond: 10 } },
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
  if (!isReady()) {
    logger.info('CC relay disabled or not configured — staying dormant')
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
