import { WebSocketServer, WebSocket } from 'ws'
import { getOverlayState } from './overlay'
import { fireLowerThird, hideLowerThird, nextTrigger, prevTrigger } from './overlay'
import { WsStateMessage } from '../../shared/types'
import { createLogger } from '../logger'

const logger = createLogger('wsHub')

let wss: WebSocketServer | null = null
const clients = new Map<WebSocket, string>()
let heartbeatInterval: NodeJS.Timeout | null = null

function buildStateMessage(): WsStateMessage {
  return {
    type: 'state',
    overlay: getOverlayState(),
  }
}

export function broadcastState(): void {
  if (!wss) return
  const payload = JSON.stringify(buildStateMessage())
  for (const [ws] of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload)
    }
  }
}

function handleCommand(action: string): void {
  switch (action) {
    case 'fireLT':
      fireLowerThird()
      break
    case 'hideLT':
      hideLowerThird()
      break
    case 'nextTrigger':
      nextTrigger()
      break
    case 'prevTrigger':
      prevTrigger()
      break
    default:
      logger.warn(`Unknown command: ${action}`)
  }
}

export function start(port: number): void {
  wss = new WebSocketServer({ port, host: '127.0.0.1' })

  wss.on('connection', (ws) => {
    (ws as unknown as { isAlive: boolean }).isAlive = true

    ws.on('pong', () => {
      (ws as unknown as { isAlive: boolean }).isAlive = true
    })

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())

        if (msg.type === 'identify') {
          clients.set(ws, msg.client)
          logger.info(`Client connected: ${msg.client}`)
          // Send full state immediately
          ws.send(JSON.stringify(buildStateMessage()))
        }

        if (msg.type === 'command') {
          handleCommand(msg.action)
        }
      } catch (err) {
        logger.error('Bad WS message:', err)
      }
    })

    ws.on('close', () => {
      const clientType = clients.get(ws) || 'unknown'
      clients.delete(ws)
      logger.info(`Client disconnected: ${clientType}`)
    })
  })

  // Heartbeat — ping every 30s, kill dead connections
  heartbeatInterval = setInterval(() => {
    if (!wss) return
    wss.clients.forEach((ws) => {
      const extWs = ws as unknown as { isAlive: boolean }
      if (!extWs.isAlive) return ws.terminate()
      extWs.isAlive = false
      ws.ping()
    })
  }, 30000)

  logger.info(`WebSocket hub listening on ws://127.0.0.1:${port}`)
}

export function stop(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval)
    heartbeatInterval = null
  }
  if (wss) {
    wss.close()
    wss = null
    logger.info('WebSocket hub stopped')
  }
  clients.clear()
}
