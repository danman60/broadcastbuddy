/**
 * Chat Bridge — operator chat over Supabase Realtime, with the ability to "pin"
 * a message as an on-screen lower-third broadcast.
 *
 * Structure ported from CompSyncElectronApp's chatBridge.ts, but with NO
 * hardcoded Supabase project. Config (url + anon key + eventId) is injected via
 * init(); when config is missing or `enabled` is false the whole service
 * no-ops and never touches the network. The feature is DORMANT until the user
 * supplies a BB-specific Supabase project in Settings.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * REQUIRED SUPABASE SCHEMA (run this SQL in the BB Supabase project before
 * enabling chat). The anon key is used directly from the renderer-injected
 * config, so RLS must permit anon insert/select scoped by event_id:
 *
 *   create table public.chat_messages (
 *     id          uuid primary key default gen_random_uuid(),
 *     event_id    text not null,
 *     author      text not null default 'operator',
 *     text        text not null,
 *     pinned      boolean not null default false,
 *     created_at  timestamptz not null default now()
 *   );
 *   create index chat_messages_event_idx on public.chat_messages (event_id, created_at);
 *
 *   alter table public.chat_messages enable row level security;
 *
 *   -- Anon may read + insert for any event_id (operator-only app, not public).
 *   create policy "anon read"   on public.chat_messages for select using (true);
 *   create policy "anon insert" on public.chat_messages for insert with check (true);
 *   create policy "anon update" on public.chat_messages for update using (true) with check (true);
 *
 *   -- Realtime: enable the table in the supabase Realtime publication
 *   alter publication supabase_realtime add table public.chat_messages;
 * ────────────────────────────────────────────────────────────────────────────
 */
import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'
import { ChatConfig, ChatMessage, ChatState } from '../../shared/types'
import { createLogger } from '../logger'

const logger = createLogger('chatBridge')

const MAX_MESSAGES = 50
const MAX_PINNED = 10

let config: ChatConfig | null = null
let supabase: SupabaseClient | null = null
let channel: RealtimeChannel | null = null
let messages: ChatMessage[] = []
let pinned: ChatMessage[] = []
let connected = false
let reconnectTimer: NodeJS.Timeout | null = null
let reconnectDelayMs = 2000
let consecutiveFailures = 0
let started = false // user enabled chat — auto-reconnect on failures

let onStateChange: (() => void) | null = null
// Fired when a message is pinned — wired by ipc.ts to broadcast as a lower-third.
let onMessagePinned: ((msg: ChatMessage) => void) | null = null

export function setOnStateChange(cb: () => void): void {
  onStateChange = cb
}

export function setOnMessagePinned(cb: (msg: ChatMessage) => void): void {
  onMessagePinned = cb
}

function notify(): void {
  try { onStateChange?.() } catch { /* ignore */ }
}

function isReady(): boolean {
  return !!(config && config.enabled && config.supabaseUrl && config.supabaseAnonKey && config.eventId)
}

function rowToMessage(row: Record<string, unknown>): ChatMessage {
  return {
    id: String(row.id),
    author: String(row.author ?? 'operator'),
    text: String(row.text ?? ''),
    pinned: !!row.pinned,
    createdAt: row.created_at ? new Date(String(row.created_at)).getTime() : Date.now(),
  }
}

function mergeMessage(msg: ChatMessage): boolean {
  if (!msg || !msg.id) return false
  const existing = messages.findIndex((m) => m.id === msg.id)
  if (existing !== -1) {
    // Update in place (e.g. pin state changed)
    messages[existing] = msg
  } else {
    messages.push(msg)
    if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES)
  }
  rebuildPinned()
  return true
}

function rebuildPinned(): void {
  pinned = messages.filter((m) => m.pinned).slice(-MAX_PINNED)
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

async function backfill(): Promise<void> {
  if (!supabase || !config) return
  try {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('event_id', config.eventId)
      .order('created_at', { ascending: true })
      .limit(MAX_MESSAGES)
    if (error) {
      logger.warn(`Backfill failed: ${error.message}`)
      return
    }
    for (const row of data || []) mergeMessage(rowToMessage(row as Record<string, unknown>))
    notify()
  } catch (err) {
    logger.warn('Backfill error:', err instanceof Error ? err.message : err)
  }
}

function connectChannel(): void {
  if (!isReady() || !config) return
  supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    realtime: { params: { eventsPerSecond: 10 } },
  })

  const channelName = `bb-chat:${config.eventId}`
  logger.info(`Subscribing to ${channelName}`)

  channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'chat_messages', filter: `event_id=eq.${config.eventId}` },
      (payload) => {
        const row = (payload.new || payload.old) as Record<string, unknown>
        if (row && row.id) {
          mergeMessage(rowToMessage(row))
          notify()
        }
      },
    )
    .subscribe((status) => {
      logger.info(`Channel status = ${status}`)
      if (status === 'SUBSCRIBED') {
        connected = true
        consecutiveFailures = 0
        reconnectDelayMs = 2000
        void backfill()
        notify()
      } else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
        connected = false
        notify()
        scheduleReconnect()
      }
    })
}

/**
 * (Re)initialize from injected config. Safe to call repeatedly — disconnects
 * any prior channel first. No-ops (and disconnects) when config is missing or
 * disabled, so startup never crashes when chat is unconfigured.
 */
export function init(cfg: ChatConfig | undefined): void {
  disconnect()
  config = cfg ?? null
  if (!isReady()) {
    logger.info('Chat disabled or not configured — staying dormant')
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
  messages = []
  pinned = []
  connected = false
  notify()
}

export function getState(): ChatState {
  return {
    connected,
    enabled: !!(config && config.enabled),
    messages: messages.slice(),
    pinned: pinned.slice(),
  }
}

export async function sendMessage(text: string, author = 'operator'): Promise<boolean> {
  if (!isReady() || !supabase || !config) return false
  const trimmed = text.trim()
  if (!trimmed) return false
  const { error } = await supabase
    .from('chat_messages')
    .insert({ event_id: config.eventId, author, text: trimmed, pinned: false })
  if (error) {
    logger.warn(`Send failed: ${error.message}`)
    return false
  }
  return true
}

async function setPinned(id: string, value: boolean): Promise<boolean> {
  if (!isReady() || !supabase || !config) return false
  const { error } = await supabase
    .from('chat_messages')
    .update({ pinned: value })
    .eq('id', id)
    .eq('event_id', config.eventId)
  if (error) {
    logger.warn(`Pin update failed: ${error.message}`)
    return false
  }
  // Optimistic local update — realtime UPDATE will reconcile.
  const local = messages.find((m) => m.id === id)
  if (local) {
    local.pinned = value
    rebuildPinned()
    if (value) {
      try { onMessagePinned?.(local) } catch { /* ignore */ }
    }
    notify()
  }
  return true
}

export function pinMessage(id: string): Promise<boolean> {
  return setPinned(id, true)
}

export function unpinMessage(id: string): Promise<boolean> {
  return setPinned(id, false)
}

export function getMessageById(id: string): ChatMessage | undefined {
  return messages.find((m) => m.id === id)
}
