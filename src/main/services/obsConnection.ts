import WebSocket from 'ws'
import { createHash } from 'crypto'
import { createLogger } from '../logger'

const logger = createLogger('obs')

let ws: WebSocket | null = null
let identified = false
let requestCounter = 0
const pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

// ── Event subscribers (main-process consumers) ──────────────────────────
type ConnectedCallback = () => void
type DisconnectedCallback = () => void
const connectedCallbacks: ConnectedCallback[] = []
const disconnectedCallbacks: DisconnectedCallback[] = []
const sceneChangedCallbacks: Array<(name: string | null) => void> = []

export function onConnected(cb: ConnectedCallback): void {
  connectedCallbacks.push(cb)
}

export function onDisconnected(cb: DisconnectedCallback): void {
  disconnectedCallbacks.push(cb)
}

export function setOnSceneChanged(cb: (name: string | null) => void): void {
  sceneChangedCallbacks.push(cb)
}

// ── Transition cache + auto-revert state machine ────────────────────────
// Populated by refreshTransitionList() on identify + after any
// CurrentSceneTransitionChanged event so we always know each transition's kind.
const transitionKindByName = new Map<string, string>()

// 2026-05-15 lesson (ported from CSE): the previous revert restricted itself
// to kind==='stinger_transition' but operators ran into stingers with
// non-matching kinds in the wild. BB takes the same broadened stance — after
// ANY non-Cut transition completes, snap the active transition back to the
// first Cut transition in the list after a 500ms settle.
let transitionRevertEnabled = false

export function isTransitionRevertEnabled(): boolean {
  return transitionRevertEnabled
}

export function setTransitionRevertEnabled(enabled: boolean): void {
  transitionRevertEnabled = enabled
  logger.info(`Transition auto-revert: ${enabled ? 'ON' : 'OFF'}`)
}

export function getCutTransitionName(): string | null {
  for (const [name, kind] of transitionKindByName) {
    if (kind === 'cut_transition') return name
  }
  return null
}

// ── Connection ──────────────────────────────────────────────────────────

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
            // Prime the transition cache so revert + slow zoom helpers have
            // a populated kind lookup before the first operator action.
            refreshTransitionList().catch((err) =>
              logger.warn(`Initial transition list refresh failed: ${err instanceof Error ? err.message : err}`),
            )
            for (const cb of connectedCallbacks) {
              try { cb() } catch (err) {
                logger.warn(`onConnected callback threw: ${err instanceof Error ? err.message : err}`)
              }
            }
            resolve()
            break
          case 5: // Event
            handleEvent(msg.d?.eventType, msg.d?.eventData)
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
      transitionKindByName.clear()
      for (const cb of disconnectedCallbacks) {
        try { cb() } catch (err) {
          logger.warn(`onDisconnected callback threw: ${err instanceof Error ? err.message : err}`)
        }
      }
      logger.info('OBS WebSocket disconnected')
    })
  })
}

function sendIdentify(hello: { authentication?: { challenge: string; salt: string } }, password?: string): void {
  // EventSubscriptions bitmask — subscribe to General + Scenes + Transitions
  // (1 << 0 | 1 << 2 | 1 << 3 = 13). Without this, op:5 events never arrive
  // even though the connection is otherwise healthy.
  const eventSubscriptions = (1 << 0) | (1 << 2) | (1 << 3)

  const identify: {
    op: number
    d: { rpcVersion: number; eventSubscriptions: number; authentication?: string }
  } = {
    op: 1,
    d: { rpcVersion: 1, eventSubscriptions },
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

// ── Event handling ──────────────────────────────────────────────────────

function handleEvent(eventType: string | undefined, eventData: Record<string, unknown> | undefined): void {
  if (!eventType) return

  switch (eventType) {
    case 'CurrentProgramSceneChanged': {
      const name = (eventData?.sceneName as string) ?? null
      for (const cb of sceneChangedCallbacks) {
        try { cb(name) } catch (err) {
          logger.warn(`onSceneChanged callback threw: ${err instanceof Error ? err.message : err}`)
        }
      }
      break
    }
    case 'CurrentSceneTransitionChanged': {
      // Refresh cache opportunistically — list can grow if operator adds a
      // transition in OBS while BB is running.
      refreshTransitionList().catch(() => { /* logged in helper */ })
      break
    }
    case 'SceneTransitionEnded': {
      if (!transitionRevertEnabled) return
      const endedName = (eventData?.transitionName as string) ?? null
      if (!endedName) return
      const kind = transitionKindByName.get(endedName) ?? '(unknown)'
      const cutName = getCutTransitionName()
      if (!cutName) {
        logger.warn(`Transition "${endedName}" ended but no cut_transition found — skipping revert`)
        return
      }
      if (endedName === cutName) return // already Cut, no-op
      logger.info(`SceneTransitionEnded: name="${endedName}" kind=${kind} — reverting to "${cutName}" in 500ms`)
      setTimeout(() => {
        setCurrentTransitionByName(cutName)
          .then(() => logger.info(`Auto-reverted transition: ${endedName} → ${cutName}`))
          .catch((err) => logger.warn(`Auto-revert to ${cutName} failed: ${err instanceof Error ? err.message : err}`))
      }, 500)
      break
    }
  }
}

// ── Requests ────────────────────────────────────────────────────────────

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

// ── Transition / scene helpers ──────────────────────────────────────────

export async function refreshTransitionList(): Promise<string[]> {
  try {
    const result = (await sendRequest('GetSceneTransitionList')) as
      | { transitions?: Array<{ transitionName: string; transitionKind?: string }> }
      | null
    const items = result?.transitions ?? []
    transitionKindByName.clear()
    for (const t of items) {
      if (t.transitionKind) transitionKindByName.set(t.transitionName, t.transitionKind)
    }
    return items.map((t) => t.transitionName)
  } catch (err) {
    logger.warn(`GetSceneTransitionList failed: ${err instanceof Error ? err.message : err}`)
    return []
  }
}

export async function setCurrentTransitionByName(name: string): Promise<void> {
  await sendRequest('SetCurrentSceneTransition', { transitionName: name })
}

export async function setCurrentTransitionDuration(durationMs: number): Promise<void> {
  await sendRequest('SetCurrentSceneTransitionDuration', { transitionDuration: durationMs })
}

export async function setCurrentScene(name: string): Promise<void> {
  await sendRequest('SetCurrentProgramScene', { sceneName: name })
}
