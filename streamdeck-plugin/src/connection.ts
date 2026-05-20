import WebSocket from 'ws'

export interface AppState {
  type: 'state'
  overlay: {
    lowerThird: {
      visible: boolean
      name: string
      title: string
      subtitle: string
    }
    companyLogo: { visible: boolean }
    clientLogo: { visible: boolean }
    ticker: { visible: boolean; text: string }
    gridVisible?: boolean // operator leveling grid
  }
  playlist?: {
    current: number
    total: number
    autoFire: boolean
    upNextTitle: string | null
  }
}

type StateCallback = (state: AppState) => void

// BroadcastBuddy's WebSocket hub listens on 19081 by default (see
// src/main/services/settings.ts → server.wsPort). Host/port are overridable
// from the Stream Deck property inspector via setHostPort().
const DEFAULT_HOST = 'localhost'
const DEFAULT_PORT = 19081
let host = DEFAULT_HOST
let port = DEFAULT_PORT

function wsUrl(): string {
  return `ws://${host}:${port}`
}

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectDelay = 1000
const stateCallbacks: StateCallback[] = []
let currentState: AppState | null = null
let connected = false

export function onState(cb: StateCallback): void {
  stateCallbacks.push(cb)
  if (currentState) cb(currentState)
}

/**
 * Update the BB host/port (from the property inspector global settings) and
 * reconnect if it actually changed. Empty / invalid values fall back to the
 * defaults so a blank field never bricks the connection.
 */
export function setHostPort(nextHost?: string, nextPort?: number): void {
  const h = (nextHost && nextHost.trim()) || DEFAULT_HOST
  const p = nextPort && Number.isFinite(nextPort) && nextPort > 0 ? nextPort : DEFAULT_PORT
  if (h === host && p === port) return
  host = h
  port = p
  // Bounce the socket onto the new endpoint.
  disconnect()
  connect()
}

export function isConnected(): boolean {
  return connected
}

export function getState(): AppState | null {
  return currentState
}

export function sendCommand(action: string, data?: Record<string, unknown>): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  const msg: Record<string, unknown> = { type: 'command', action }
  if (data) msg.data = data
  ws.send(JSON.stringify(msg))
}

export function connect(): void {
  if (ws) return
  try {
    ws = new WebSocket(wsUrl())
  } catch {
    scheduleReconnect()
    return
  }

  ws.on('open', () => {
    connected = true
    reconnectDelay = 1000
    ws!.send(JSON.stringify({ type: 'identify', client: 'streamdeck' }))
    console.log('[BroadcastBuddy] Connected to Electron app')
  })

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'state') {
        currentState = msg as AppState
        for (const cb of stateCallbacks) cb(currentState)
      }
    } catch { /* ignore parse errors */ }
  })

  ws.on('close', () => {
    connected = false
    ws = null
    console.log('[BroadcastBuddy] Disconnected')
    scheduleReconnect()
  })

  ws.on('error', () => {
    connected = false
    ws?.close()
    ws = null
  })
}

function scheduleReconnect(): void {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, reconnectDelay)
  reconnectDelay = Math.min(reconnectDelay * 2, 30000)
}

export function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (ws) {
    ws.close()
    ws = null
  }
  connected = false
}
