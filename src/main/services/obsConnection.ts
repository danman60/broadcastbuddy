import WebSocket from 'ws'
import { createHash } from 'crypto'
import { createLogger } from '../logger'
import { recordEvent } from './events'

const logger = createLogger('obs')

let ws: WebSocket | null = null
let identified = false
let requestCounter = 0
const pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

// Auto-reconnect: remember the params of a SUCCESSFUL connection so a mid-show
// OBS drop (crash / restart / ws blip) reconnects on its own instead of leaving
// the operator without record/stream/slow-zoom control until a manual Connect.
// Armed only after Identified (lastConnect set there), so an OBS that was never
// up at boot doesn't spawn an endless retry-spam loop.
let lastConnect: { host: string; port: number; password?: string } | null = null
let intentionalDisconnect = false
let reconnectTimer: NodeJS.Timeout | null = null
const RECONNECT_DELAY_MS = 3000

function scheduleReconnect(): void {
  if (reconnectTimer || intentionalDisconnect || !lastConnect) return
  const { host, port, password } = lastConnect
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (intentionalDisconnect || !lastConnect) return
    logger.info(`OBS reconnect attempt → ${host}:${port}`)
    connect(host, port, password).catch(() => scheduleReconnect())
  }, RECONNECT_DELAY_MS)
}

// ── Event subscribers (main-process consumers) ──────────────────────────
type ConnectedCallback = () => void
type DisconnectedCallback = () => void
const connectedCallbacks: ConnectedCallback[] = []
const disconnectedCallbacks: DisconnectedCallback[] = []
const sceneChangedCallbacks: Array<(name: string | null) => void> = []

// Record + audio-meter consumers (main → renderer push, wired in ipc.ts).
export interface RecordState {
  active: boolean
  paused: boolean
  timecode: string
}

// One audio input's post-fader peak per channel, already converted to a 0..1
// multiplier (OBS magnitude). Renderer converts to dBFS for display.
export interface AudioInputLevel {
  inputName: string
  levels: number[] // post-fader peak per channel (0..1 mul)
}

// Live stream + replay-buffer state (pushed on StreamStateChanged).
export interface StreamState {
  streaming: boolean
  replayBufferActive: boolean
}

const recordStateCallbacks: Array<(state: RecordState) => void> = []
const audioLevelsCallbacks: Array<(levels: AudioInputLevel[]) => void> = []
const streamStateCallbacks: Array<(state: StreamState) => void> = []
const replaySavedCallbacks: Array<(path: string) => void> = []

let streaming = false
let replayBufferActive = false

export function onConnected(cb: ConnectedCallback): void {
  connectedCallbacks.push(cb)
}

export function onDisconnected(cb: DisconnectedCallback): void {
  disconnectedCallbacks.push(cb)
}

export function setOnSceneChanged(cb: (name: string | null) => void): void {
  sceneChangedCallbacks.push(cb)
}

export function setOnRecordStateChanged(cb: (state: RecordState) => void): void {
  recordStateCallbacks.push(cb)
}

export function setOnAudioLevels(cb: (levels: AudioInputLevel[]) => void): void {
  audioLevelsCallbacks.push(cb)
}

export function setOnStreamStateChanged(cb: (state: StreamState) => void): void {
  streamStateCallbacks.push(cb)
}

export function setOnReplaySaved(cb: (path: string) => void): void {
  replaySavedCallbacks.push(cb)
}

// InputVolumeMeters fires ~50/sec. Coalesce to ~20/sec (50ms) before forwarding
// to the renderer so we don't flood the IPC channel.
const METER_THROTTLE_MS = 50
let lastMeterSendMs = 0

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
  // A fresh connect attempt clears the intentional-disconnect latch so the
  // close handler will auto-reconnect if this connection later drops.
  intentionalDisconnect = false
  return new Promise((resolve, reject) => {
    // Short-circuit if a socket is already OPEN *or* still CONNECTING. Without
    // the CONNECTING guard, a manual Connect racing the startup auto-connect
    // would reassign the module `ws` to a second socket; the first call's
    // timeout would then close the wrong (good) socket and leak the other.
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
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
            // Arm auto-reconnect with these (now-proven) params + cancel any
            // pending reconnect from a prior drop.
            lastConnect = { host, port, password }
            if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
            logger.info('OBS WebSocket identified')
            // Prime the transition cache so revert + slow zoom helpers have
            // a populated kind lookup before the first operator action.
            refreshTransitionList().catch((err) =>
              logger.warn(`Initial transition list refresh failed: ${err instanceof Error ? err.message : err}`),
            )
            recordEvent('obs', 'OBS connected')
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
      streaming = false
      replayBufferActive = false
      recordEvent('obs', 'OBS disconnected')
      for (const cb of disconnectedCallbacks) {
        try { cb() } catch (err) {
          logger.warn(`onDisconnected callback threw: ${err instanceof Error ? err.message : err}`)
        }
      }
      logger.info('OBS WebSocket disconnected')
      // Reconnect a dropped (non-deliberate) connection so OBS control survives
      // an OBS restart / ws blip mid-show. No-op until a connection was Identified.
      if (!intentionalDisconnect && lastConnect) {
        logger.warn(`OBS connection lost — reconnecting in ${RECONNECT_DELAY_MS / 1000}s`)
        scheduleReconnect()
      }
    })
  })
}

function sendIdentify(hello: { authentication?: { challenge: string; salt: string } }, password?: string): void {
  // EventSubscriptions bitmask. Without this, op:5 events never arrive even
  // though the connection is otherwise healthy.
  //   General (1<<0=1) + Scenes (1<<2=4) + Transitions (1<<3=8)  = 13  (waves 1-2)
  //   Outputs (1<<6=64)             → RecordStateChanged / StreamStateChanged
  //   InputVolumeMeters (1<<16=65536) → separate HIGH-VOLUME subscription that
  //   must be explicitly OR-ed into the Identify bitmask (not in EventSubscription.All).
  // Final mask = 13 | 64 | 65536 = 65613.
  const eventSubscriptions = (1 << 0) | (1 << 2) | (1 << 3) | (1 << 6) | (1 << 16)

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
    case 'RecordStateChanged': {
      const outputState = (eventData?.outputState as string) ?? ''
      const active = outputState === 'OBS_WEBSOCKET_OUTPUT_STARTED'
      const stopped = outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPED'
      // Only push on settled started/stopped states; ignore STARTING/STOPPING.
      if (!active && !stopped) return
      const state: RecordState = {
        active,
        paused: false,
        timecode: '',
      }
      logger.info(`RecordStateChanged: ${outputState} active=${active}`)
      recordEvent('obs', active ? 'Recording started' : 'Recording stopped')
      for (const cb of recordStateCallbacks) {
        try { cb(state) } catch (err) {
          logger.warn(`onRecordStateChanged callback threw: ${err instanceof Error ? err.message : err}`)
        }
      }
      break
    }
    case 'StreamStateChanged': {
      const outputState = (eventData?.outputState as string) ?? ''
      if (outputState === 'OBS_WEBSOCKET_OUTPUT_STARTED') streaming = true
      else if (outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPED' || outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPING') streaming = false
      else return // ignore STARTING
      logger.info(`StreamStateChanged: ${outputState} streaming=${streaming}`)
      recordEvent('obs', streaming ? 'Stream started' : 'Stream stopped')
      const state: StreamState = { streaming, replayBufferActive }
      for (const cb of streamStateCallbacks) {
        try { cb(state) } catch (err) {
          logger.warn(`onStreamStateChanged callback threw: ${err instanceof Error ? err.message : err}`)
        }
      }
      break
    }
    case 'ReplayBufferStateChanged': {
      const outputState = (eventData?.outputState as string) ?? ''
      if (outputState === 'OBS_WEBSOCKET_OUTPUT_STARTED') replayBufferActive = true
      else if (outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPED') replayBufferActive = false
      else return
      const state: StreamState = { streaming, replayBufferActive }
      for (const cb of streamStateCallbacks) {
        try { cb(state) } catch (err) {
          logger.warn(`onStreamStateChanged callback threw: ${err instanceof Error ? err.message : err}`)
        }
      }
      break
    }
    case 'ReplayBufferSaved': {
      const savedPath = (eventData?.savedReplayPath as string) ?? ''
      logger.info(`ReplayBufferSaved: ${savedPath}`)
      recordEvent('obs', 'Replay saved')
      for (const cb of replaySavedCallbacks) {
        try { cb(savedPath) } catch (err) {
          logger.warn(`onReplaySaved callback threw: ${err instanceof Error ? err.message : err}`)
        }
      }
      break
    }
    case 'InputVolumeMeters': {
      if (audioLevelsCallbacks.length === 0) return
      const now = Date.now()
      if (now - lastMeterSendMs < METER_THROTTLE_MS) return
      lastMeterSendMs = now
      const inputs = (eventData?.inputs as Array<{ inputName?: string; inputLevelsMul?: number[][] }>) ?? []
      const levels: AudioInputLevel[] = inputs.map((input) => ({
        inputName: (input.inputName as string) ?? '',
        // inputLevelsMul[channel] = [pre-fader, post-fader, post-fader-peak].
        // Use post-fader peak (index 2) so operator gain changes in OBS move the
        // meters; fall back down the chain when fewer values are present.
        levels: (input.inputLevelsMul ?? []).map((ch) => ch[2] ?? ch[1] ?? ch[0] ?? 0),
      }))
      for (const cb of audioLevelsCallbacks) {
        try { cb(levels) } catch (err) {
          logger.warn(`onAudioLevels callback threw: ${err instanceof Error ? err.message : err}`)
        }
      }
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

// ── Recording control ─────────────────────────────────────────────────────

export async function startRecording(): Promise<void> {
  await sendRequest('StartRecord')
  logger.info('StartRecord')
}

export async function stopRecording(): Promise<string> {
  const result = (await sendRequest('StopRecord')) as { outputPath?: string } | null
  logger.info(`StopRecord — path: ${result?.outputPath ?? '(none)'}`)
  return result?.outputPath || ''
}

export async function toggleRecording(): Promise<boolean> {
  const result = (await sendRequest('ToggleRecord')) as { outputActive?: boolean } | null
  return !!result?.outputActive
}

export async function getRecordStatus(): Promise<RecordState> {
  try {
    const status = (await sendRequest('GetRecordStatus')) as
      | { outputActive?: boolean; outputPaused?: boolean; outputTimecode?: string }
      | null
    return {
      active: !!status?.outputActive,
      paused: !!status?.outputPaused,
      timecode: status?.outputTimecode || '',
    }
  } catch {
    return { active: false, paused: false, timecode: '' }
  }
}

// ── Stream control + replay buffer ──────────────────────────────────────────

export async function startStreaming(): Promise<void> {
  await sendRequest('StartStream')
  logger.info('StartStream')
}

export async function stopStreaming(): Promise<void> {
  await sendRequest('StopStream')
  logger.info('StopStream')
}

export async function saveReplayBuffer(): Promise<void> {
  await sendRequest('SaveReplayBuffer')
  logger.info('SaveReplayBuffer')
}

export async function getStreamStatus(): Promise<StreamState> {
  try {
    const status = (await sendRequest('GetStreamStatus')) as { outputActive?: boolean } | null
    streaming = !!status?.outputActive
  } catch {
    // leave cached value
  }
  return { streaming, replayBufferActive }
}

export function isConnected(): boolean {
  return identified && ws?.readyState === WebSocket.OPEN
}

export function disconnect(): void {
  // Deliberate disconnect: latch it + drop the remembered params so the close
  // handler does NOT auto-reconnect, and cancel any pending reconnect.
  intentionalDisconnect = true
  lastConnect = null
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
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
