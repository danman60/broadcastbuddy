import WebSocket from 'ws'
import { createHash } from 'crypto'
import { createLogger } from '../logger'

const logger = createLogger('obs')

let ws: WebSocket | null = null
let identified = false
let requestCounter = 0
const pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

export function connect(host: string, port: number, password?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      resolve()
      return
    }

    try {
      ws = new WebSocket(`ws://${host}:${port}`)
    } catch (err) {
      reject(new Error(`Failed to create WebSocket: ${err}`))
      return
    }

    const timeout = setTimeout(() => {
      reject(new Error('OBS connection timeout'))
      ws?.close()
    }, 10000)

    ws.on('open', () => {
      logger.info('Connected to OBS WebSocket')
    })

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())

        switch (msg.op) {
          case 0: // Hello
            sendIdentify(msg.d, password)
            break
          case 2: // Identified
            identified = true
            clearTimeout(timeout)
            logger.info('OBS WebSocket identified')
            resolve()
            break
          case 7: { // RequestResponse
            const pending = pendingRequests.get(msg.d.requestId)
            if (pending) {
              pendingRequests.delete(msg.d.requestId)
              if (msg.d.requestStatus.result) {
                pending.resolve(msg.d.responseData)
              } else {
                pending.reject(new Error(msg.d.requestStatus.comment || 'OBS request failed'))
              }
            }
            break
          }
        }
      } catch (err) {
        logger.error('Bad OBS message:', err)
      }
    })

    ws.on('error', (err) => {
      logger.error('OBS WebSocket error:', err)
      clearTimeout(timeout)
      reject(err)
    })

    ws.on('close', () => {
      identified = false
      ws = null
      // Reject all pending requests
      for (const [id, pending] of pendingRequests) {
        pending.reject(new Error('OBS connection closed'))
        pendingRequests.delete(id)
      }
      logger.info('OBS WebSocket disconnected')
    })
  })
}

function sendIdentify(hello: { authentication?: { challenge: string; salt: string } }, password?: string): void {
  const identify: { op: number; d: { rpcVersion: number; authentication?: string } } = {
    op: 1,
    d: { rpcVersion: 1 },
  }

  if (hello.authentication && password) {
    const { challenge, salt } = hello.authentication
    const secret = createHash('sha256')
      .update(password + salt)
      .digest('base64')
    const auth = createHash('sha256')
      .update(secret + challenge)
      .digest('base64')
    identify.d.authentication = auth
  }

  ws?.send(JSON.stringify(identify))
}

export function sendRequest(requestType: string, requestData?: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!ws || !identified) {
      reject(new Error('Not connected to OBS'))
      return
    }

    const id = `req-${++requestCounter}`
    pendingRequests.set(id, { resolve, reject })

    ws.send(
      JSON.stringify({
        op: 6,
        d: { requestType, requestId: id, requestData },
      }),
    )

    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id)
        reject(new Error('OBS request timeout'))
      }
    }, 5000)
  })
}

export async function getRecordTimecode(): Promise<string> {
  try {
    const status = (await sendRequest('GetRecordStatus')) as { outputTimecode?: string } | null
    return status?.outputTimecode || ''
  } catch {
    return ''
  }
}

export function isConnected(): boolean {
  return identified && ws?.readyState === WebSocket.OPEN
}

export function disconnect(): void {
  if (ws) {
    ws.close()
    ws = null
    identified = false
  }
}
