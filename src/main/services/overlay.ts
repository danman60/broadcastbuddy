import express from 'express'
import type { Server } from 'http'
import {
  OverlayState,
  OverlayStyling,
  Trigger,
  Note,
  StreamConfig,
  StartingSoonState,
  ClockState,
  CounterState,
  FeatureCardState,
  FeatureCardAnim,
  DEFAULT_OVERLAY_STATE,
  DEFAULT_STYLING,
  DEFAULT_STREAM_CONFIG,
  DEFAULT_STARTING_SOON_MEDIA,
  AnimationType,
  LoopMode,
} from '../../shared/types'
import { buildOverlayHTML } from './overlaySource'
import { createLogger } from '../logger'
import { recordEvent } from './events'
import * as session from './session'

const logger = createLogger('overlay')

// ── State ────────────────────────────────────────────────────────

let overlayState: OverlayState = JSON.parse(JSON.stringify(DEFAULT_OVERLAY_STATE))
let triggers: Trigger[] = []
let selectedIndex = -1
let autoHideTimer: NodeJS.Timeout | null = null
let autoFireEnabled = false
let playedSet: Set<string> = new Set()
let loopMode: LoopMode = 'none'
let pingPongDirection: 1 | -1 = 1
let notes: Note[] = []
let streamConfig: StreamConfig = { ...DEFAULT_STREAM_CONFIG }
let onChangeCallback: (() => void) | null = null
let httpServer: Server | null = null

const ANIMATIONS: AnimationType[] = ['slide', 'fade', 'zoom', 'rise', 'typewriter', 'bounce', 'split', 'blur', 'sparkle']

function pickAnimation(setting: AnimationType): string {
  if (setting === 'random') {
    return ANIMATIONS[Math.floor(Math.random() * ANIMATIONS.length)]
  }
  return setting
}

// ── Change notification ──────────────────────────────────────────

export function setOnStateChange(cb: () => void): void {
  onChangeCallback = cb
}

function notifyChange(): void {
  onChangeCallback?.()
  scheduleAutoSave()
}

// ── Debounced session auto-save ──────────────────────────────────
// Styling/color/playlist edits mutate live state via notifyChange() but were
// never persisted — saveSession ran only from the Header "Save" button, so
// edits reset to the last SAVED session on BB restart. Debounce a session save
// off every state change. Guarded: only persists when a session is loaded, and
// mirrors the exact getters used by IPC.SESSION_SAVE (ipc.ts:300-309), reading
// overlay's own module-local state directly.
let autoSaveTimer: NodeJS.Timeout | null = null
const AUTO_SAVE_DEBOUNCE_MS = 800

function scheduleAutoSave(): void {
  if (!session.getCurrentSession()) return
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null
    if (!session.getCurrentSession()) return
    session.saveSession(
      triggers,
      overlayState.lowerThird.styling,
      overlayState.companyLogo.dataUrl,
      overlayState.clientLogo.dataUrl,
      selectedIndex,
      Array.from(playedSet),
      loopMode,
      notes,
      streamConfig,
    )
  }, AUTO_SAVE_DEBOUNCE_MS)
}

// ── Getters ──────────────────────────────────────────────────────

export function getOverlayState(): OverlayState {
  return overlayState
}

export function getTriggers(): Trigger[] {
  return triggers
}

export function getSelectedIndex(): number {
  return selectedIndex
}

// ── Playlist state ───────────────────────────────────────────────

export function getPlayedSet(): string[] {
  return Array.from(playedSet)
}

export function getLoopMode(): LoopMode {
  return loopMode
}

export function setLoopMode(mode: LoopMode): void {
  loopMode = mode
  if (mode !== 'ping-pong') pingPongDirection = 1
  logger.info(`Loop mode set to: ${mode}`)
  notifyChange()
}

export function clearPlayed(): void {
  playedSet.clear()
  logger.info('Played set cleared')
  notifyChange()
}

export function resetPosition(): void {
  if (triggers.length > 0) {
    selectedIndex = 0
    pingPongDirection = 1
    applyTriggerToOverlay(triggers[0])
  } else {
    selectedIndex = -1
  }
  logger.info('Position reset to start')
  notifyChange()
}

export function clearAllTriggers(): void {
  triggers = []
  selectedIndex = -1
  playedSet.clear()
  pingPongDirection = 1
  logger.info('All triggers cleared')
  notifyChange()
}

// ── Trigger management ───────────────────────────────────────────

export function setTriggers(t: Trigger[]): void {
  triggers = t
}

export function addTrigger(t: Trigger): void {
  triggers.push(t)
}

export function updateTrigger(id: string, updates: Partial<Trigger>): void {
  const idx = triggers.findIndex((t) => t.id === id)
  if (idx !== -1) {
    triggers[idx] = { ...triggers[idx], ...updates }
    // If this trigger is currently selected and visible, update overlay text
    if (idx === selectedIndex && overlayState.lowerThird.visible) {
      applyTriggerToOverlay(triggers[idx])
      notifyChange()
    }
  }
}

export function deleteTrigger(id: string): void {
  const idx = triggers.findIndex((t) => t.id === id)
  if (idx === -1) return
  triggers.splice(idx, 1)
  // Adjust selected index
  if (selectedIndex >= triggers.length) {
    selectedIndex = triggers.length - 1
  }
}

export function reorderTriggers(ids: string[]): void {
  const ordered: Trigger[] = []
  for (const id of ids) {
    const t = triggers.find((tr) => tr.id === id)
    if (t) ordered.push({ ...t, order: ordered.length })
  }
  triggers = ordered
}

export function selectTrigger(index: number): void {
  if (index >= 0 && index < triggers.length) {
    selectedIndex = index
    applyTriggerToOverlay(triggers[index])
    notifyChange()
  }
}

function advanceIndex(forward: boolean): void {
  if (triggers.length === 0) return
  const last = triggers.length - 1

  if (loopMode === 'ping-pong') {
    if (forward) {
      if (pingPongDirection === 1) {
        if (selectedIndex >= last) {
          pingPongDirection = -1
          selectedIndex = Math.max(selectedIndex - 1, 0)
        } else {
          selectedIndex++
        }
      } else {
        if (selectedIndex <= 0) {
          pingPongDirection = 1
          selectedIndex = Math.min(selectedIndex + 1, last)
        } else {
          selectedIndex--
        }
      }
    } else {
      // Manual prev reverses the ping-pong direction logic
      if (pingPongDirection === 1) {
        if (selectedIndex <= 0) {
          pingPongDirection = -1
          selectedIndex = Math.min(selectedIndex + 1, last)
        } else {
          selectedIndex--
        }
      } else {
        if (selectedIndex >= last) {
          pingPongDirection = 1
          selectedIndex = Math.max(selectedIndex - 1, 0)
        } else {
          selectedIndex++
        }
      }
    }
  } else if (loopMode === 'loop') {
    if (forward) {
      selectedIndex = selectedIndex >= last ? 0 : selectedIndex + 1
    } else {
      selectedIndex = selectedIndex <= 0 ? last : selectedIndex - 1
    }
  } else {
    // none
    if (forward) {
      selectedIndex = Math.min(selectedIndex + 1, last)
    } else {
      selectedIndex = Math.max(selectedIndex - 1, 0)
    }
  }
}

export function nextTrigger(): void {
  if (triggers.length === 0) return
  advanceIndex(true)
  applyTriggerToOverlay(triggers[selectedIndex])
  notifyChange()
  if (autoFireEnabled) {
    setTimeout(() => fireLowerThird(), 300)
  }
}

export function prevTrigger(): void {
  if (triggers.length === 0) return
  advanceIndex(false)
  applyTriggerToOverlay(triggers[selectedIndex])
  notifyChange()
  if (autoFireEnabled) {
    setTimeout(() => fireLowerThird(), 300)
  }
}

export function nextTriggerFull(): void {
  if (triggers.length === 0) return
  // Hide current, advance, then fire after brief delay
  hideLowerThird()
  advanceIndex(true)
  applyTriggerToOverlay(triggers[selectedIndex])
  notifyChange()
  setTimeout(() => fireLowerThird(), 300)
}

export function toggleAutoFire(): boolean {
  autoFireEnabled = !autoFireEnabled
  logger.info(`Auto-fire ${autoFireEnabled ? 'enabled' : 'disabled'}`)
  return autoFireEnabled
}

export function getAutoFire(): boolean {
  return autoFireEnabled
}

export function getPlaylistStatus(): {
  current: number
  total: number
  autoFire: boolean
  upNext: Trigger | null
  playedIds: string[]
  loopMode: LoopMode
} {
  const upNext = selectedIndex + 1 < triggers.length ? triggers[selectedIndex + 1] : null
  return {
    current: selectedIndex + 1,
    total: triggers.length,
    autoFire: autoFireEnabled,
    upNext,
    playedIds: Array.from(playedSet),
    loopMode,
  }
}

function applyTriggerToOverlay(t: Trigger): void {
  overlayState.lowerThird.name = t.name
  overlayState.lowerThird.title = t.title
  overlayState.lowerThird.subtitle = t.subtitle
  overlayState.lowerThird.label = '' // normal selection clears any UP NEXT / THAT WAS chip
  // Apply per-trigger logo to client logo slot if present
  if (t.logoDataUrl) {
    overlayState.clientLogo.dataUrl = t.logoDataUrl
    overlayState.clientLogo.visible = true
  }
}

// ── Up Next / That Was ───────────────────────────────────────────
// Fire the lower-third using the neighbouring trigger's data, prefixed with a
// label chip. Honours loop/ping-pong wrap; in 'none' mode returns false when
// there's no neighbour (so the UI can disable the button). Does NOT advance the
// playlist position — these are informational graphics around the current item.

function neighbourIndex(forward: boolean): number {
  if (triggers.length === 0) return -1
  const last = triggers.length - 1
  const base = selectedIndex < 0 ? 0 : selectedIndex
  if (loopMode === 'none') {
    const next = forward ? base + 1 : base - 1
    return next >= 0 && next <= last ? next : -1
  }
  // loop + ping-pong both wrap for the purpose of "what's adjacent"
  if (forward) return base >= last ? 0 : base + 1
  return base <= 0 ? last : base - 1
}

function fireNeighbour(forward: boolean, label: string): boolean {
  const idx = neighbourIndex(forward)
  if (idx < 0) return false
  const t = triggers[idx]
  overlayState.lowerThird.name = t.name
  overlayState.lowerThird.title = t.title
  overlayState.lowerThird.subtitle = t.subtitle
  overlayState.lowerThird.label = label
  if (t.logoDataUrl) {
    overlayState.clientLogo.dataUrl = t.logoDataUrl
    overlayState.clientLogo.visible = true
  }
  fireLowerThird()
  return true
}

export function fireUpNext(label = 'UP NEXT'): boolean {
  return fireNeighbour(true, label)
}

export function fireThatWas(label = 'THAT WAS'): boolean {
  return fireNeighbour(false, label)
}

// ── Overlay leveling grid ────────────────────────────────────────

export function toggleGrid(): boolean {
  overlayState.gridVisible = !overlayState.gridVisible
  notifyChange()
  logger.info(`Overlay grid ${overlayState.gridVisible ? 'shown' : 'hidden'}`)
  return overlayState.gridVisible
}

export function getGridVisible(): boolean {
  return overlayState.gridVisible
}

// ── Overlay control ──────────────────────────────────────────────

// forceLowerThird: transient text fires (chat pins) always render as a lower
// third even when the currently-selected playlist trigger is a title_card/feature.
export function fireLowerThird(forceLowerThird = false): void {
  const selected = selectedIndex >= 0 && selectedIndex < triggers.length ? triggers[selectedIndex] : null

  // Track played trigger (position logic is identical regardless of visual form)
  if (selected) {
    playedSet.add(selected.id)
  }

  // title_card / feature triggers render as the FULL-SCREEN feature card instead
  // of a lower third. Playlist position (selectedIndex) is untouched.
  if (!forceLowerThird && selected && (selected.type === 'title_card' || selected.type === 'feature')) {
    // Cancel any pending lower-third auto-hide and clear the chip so the two
    // forms never show simultaneously.
    if (autoHideTimer) {
      clearTimeout(autoHideTimer)
      autoHideTimer = null
    }
    overlayState.lowerThird.visible = false
    showFeatureCard({
      kicker: selected.category || '',
      title: selected.title || selected.name,
      subtitle: selected.subtitle,
      logoDataUrl: selected.logoDataUrl || '',
      animateIn: 'slide-up',
    })
    logger.info(`Feature card fired (trigger type ${selected.type}): ${selected.name}`)
    recordEvent('overlay', `Feature card fired: ${selected.name}`, { triggerId: selected.id })
    return
  }

  overlayState.lowerThird.visible = true

  if (autoHideTimer) clearTimeout(autoHideTimer)
  const seconds = overlayState.lowerThird.styling.autoHideSeconds
  if (seconds > 0) {
    autoHideTimer = setTimeout(() => {
      hideLowerThird()
    }, seconds * 1000)
  }

  notifyChange()
  logger.info('Lower third fired')
  recordEvent('overlay', `Lower third fired${selected ? `: ${selected.name}` : ''}`, selected ? { triggerId: selected.id } : undefined)
}

export function hideLowerThird(): void {
  overlayState.lowerThird.visible = false
  if (autoHideTimer) {
    clearTimeout(autoHideTimer)
    autoHideTimer = null
  }
  notifyChange()
  logger.info('Lower third hidden')
  recordEvent('overlay', 'Lower third hidden')
}

// Fire arbitrary text as a lower-third (used by the chat "pin to screen" path).
// Does not touch the playlist position.
export function fireText(title: string, subtitle = '', label = ''): void {
  overlayState.lowerThird.name = title
  overlayState.lowerThird.title = title
  overlayState.lowerThird.subtitle = subtitle
  overlayState.lowerThird.label = label
  fireLowerThird(true) // transient chat pins always render as a lower third
}

// ── Ad-hoc freeform lower-third (Phase D) ────────────────────────
// Fire arbitrary title/subtitle text as a ONE-OFF lower-third. Does NOT mutate
// the saved triggers array or selectedIndex — it's transient. Reuses the same
// visible/auto-hide/notifyChange machinery as fireLowerThird so the browser
// source renders it identically. Sources: the local Ad-hoc box AND the CC live
// relay's 'adhoc' broadcast.

let adhocCounter = 0
let lastAdhoc: { title: string; subtitle: string; at: number } | null = null

export function fireAdhoc(title: string, subtitle = ''): void {
  const t = typeof title === 'string' ? title : ''
  const s = typeof subtitle === 'string' ? subtitle : ''
  // Construct the transient lower-third in-place. No trigger object is added,
  // and selectedIndex is left untouched.
  adhocCounter++
  overlayState.lowerThird.name = t
  overlayState.lowerThird.title = t
  overlayState.lowerThird.subtitle = s
  overlayState.lowerThird.label = ''
  lastAdhoc = { title: t, subtitle: s, at: Date.now() }

  // Reuse fireLowerThird's visible + auto-hide + notify path without going
  // through it (so we don't depend on/disturb playlist selection state).
  overlayState.lowerThird.visible = true
  if (autoHideTimer) clearTimeout(autoHideTimer)
  const seconds = overlayState.lowerThird.styling.autoHideSeconds
  if (seconds > 0) {
    autoHideTimer = setTimeout(() => {
      hideLowerThird()
    }, seconds * 1000)
  }
  notifyChange()
  logger.info(`Ad-hoc lower third fired (adhoc-${adhocCounter}): ${t}`)
  recordEvent('overlay', `Ad-hoc lower third fired: ${t}`)
}

export function getLastAdhoc(): { title: string; subtitle: string; at: number } | null {
  return lastAdhoc
}

// ── Styling ──────────────────────────────────────────────────────

export function updateStyling(updates: Partial<OverlayStyling>): void {
  overlayState.lowerThird.styling = {
    ...overlayState.lowerThird.styling,
    ...updates,
  }
  notifyChange()
}

export function getStyling(): OverlayStyling {
  return overlayState.lowerThird.styling
}

// ── Logos ─────────────────────────────────────────────────────────

export function setCompanyLogo(dataUrl: string): void {
  overlayState.companyLogo.dataUrl = dataUrl
  overlayState.companyLogo.visible = dataUrl.length > 0
  notifyChange()
}

export function setClientLogo(dataUrl: string): void {
  overlayState.clientLogo.dataUrl = dataUrl
  overlayState.clientLogo.visible = dataUrl.length > 0
  notifyChange()
}

// ── Ticker ───────────────────────────────────────────────────────

export function showTicker(text: string, speed?: number, bgColor?: string, textColor?: string): void {
  overlayState.ticker.visible = true
  overlayState.ticker.text = text
  if (speed !== undefined) overlayState.ticker.speed = speed
  if (bgColor !== undefined) overlayState.ticker.backgroundColor = bgColor
  if (textColor !== undefined) overlayState.ticker.textColor = textColor
  notifyChange()
  logger.info('Ticker shown')
}

export function hideTicker(): void {
  overlayState.ticker.visible = false
  notifyChange()
  logger.info('Ticker hidden')
}

export function updateTicker(updates: Partial<OverlayState['ticker']>): void {
  overlayState.ticker = { ...overlayState.ticker, ...updates }
  notifyChange()
}

// ── Starting Soon ────────────────────────────────────────────────

export function showStartingSoon(): void {
  overlayState.startingSoon.visible = true
  notifyChange()
  logger.info('Starting soon shown')
  const m = overlayState.startingSoon.media
  const active = m
    ? [m.showWelcome && 'welcome', m.showSponsors && 'sponsors', m.showSlideshow && 'slideshow', m.showSocialBar && 'social'].filter(Boolean)
    : []
  recordEvent('overlay', 'Starting soon shown', active.length ? { media: active } : undefined)
}

export function hideStartingSoon(): void {
  overlayState.startingSoon.visible = false
  notifyChange()
  logger.info('Starting soon hidden')
}

export function updateStartingSoon(updates: Partial<StartingSoonState>): void {
  const nextMedia = updates.media
    ? { ...(overlayState.startingSoon.media ?? DEFAULT_STARTING_SOON_MEDIA), ...updates.media }
    : overlayState.startingSoon.media
  overlayState.startingSoon = { ...overlayState.startingSoon, ...updates, media: nextMedia }
  notifyChange()
}

// ── On-air Clock ─────────────────────────────────────────────────

export function toggleClock(): boolean {
  overlayState.clock.visible = !overlayState.clock.visible
  notifyChange()
  logger.info(`Clock ${overlayState.clock.visible ? 'shown' : 'hidden'}`)
  return overlayState.clock.visible
}

export function updateClock(updates: Partial<ClockState>): void {
  overlayState.clock = { ...overlayState.clock, ...updates }
  notifyChange()
}

// ── Counter ──────────────────────────────────────────────────────

export function toggleCounter(): boolean {
  overlayState.counter.visible = !overlayState.counter.visible
  notifyChange()
  logger.info(`Counter ${overlayState.counter.visible ? 'shown' : 'hidden'}`)
  return overlayState.counter.visible
}

export function setCounter(value: number, label?: string): void {
  overlayState.counter.value = value
  if (label !== undefined) overlayState.counter.label = label
  notifyChange()
}

export function bumpCounter(delta: number): number {
  overlayState.counter.value = Math.max(0, overlayState.counter.value + delta)
  notifyChange()
  return overlayState.counter.value
}

// ── Feature Card ─────────────────────────────────────────────────
// Full-screen graphic. firedAt bumps on every show so the browser source
// restarts the entrance animation even when re-firing while visible.

let featureCardTimer: NodeJS.Timeout | null = null

export function showFeatureCard(data: Partial<Omit<FeatureCardState, 'visible' | 'firedAt'>>): void {
  overlayState.featureCard = {
    ...overlayState.featureCard,
    ...data,
    visible: true,
    firedAt: Date.now(),
  }
  // Auto-hide reuses the lower-third autoHideSeconds setting (0 = manual only).
  if (featureCardTimer) clearTimeout(featureCardTimer)
  const seconds = overlayState.lowerThird.styling.autoHideSeconds
  if (seconds > 0) {
    featureCardTimer = setTimeout(() => hideFeatureCard(), seconds * 1000)
  }
  notifyChange()
  logger.info(`Feature card fired: ${data.kicker || overlayState.featureCard.kicker}`)
  recordEvent('overlay', `Feature card fired: ${overlayState.featureCard.title || overlayState.featureCard.kicker}`)
}

// Set feature-card content WITHOUT firing/showing it. Used by the CC overlay
// editor content sync so the next fire uses the editor-authored kicker/title/
// subtitle/next-strip. Does not touch visible/firedAt (no entrance animation).
export function setFeatureCardContent(
  data: Partial<Omit<FeatureCardState, 'visible' | 'firedAt'>>,
): void {
  overlayState.featureCard = {
    ...overlayState.featureCard,
    ...data,
  }
  notifyChange()
}

export function hideFeatureCard(): void {
  if (featureCardTimer) {
    clearTimeout(featureCardTimer)
    featureCardTimer = null
  }
  overlayState.featureCard.visible = false
  overlayState.featureCard.firedAt = Date.now()
  notifyChange()
  logger.info('Feature card hidden')
  recordEvent('overlay', 'Feature card hidden')
}

// Populate the feature card from the neighbouring trigger (next/prev), then
// show it — same neighbour logic as the lower-third chip but rendered as the
// full card. Does NOT advance playlist position. Returns false if no neighbour.
function showFeatureNeighbour(forward: boolean, kicker: string, anim: FeatureCardAnim): boolean {
  const idx = neighbourIndex(forward)
  if (idx < 0) return false
  const t = triggers[idx]
  showFeatureCard({
    kicker,
    title: t.title || t.name,
    subtitle: t.subtitle,
    logoDataUrl: t.logoDataUrl || '',
    animateIn: anim,
  })
  return true
}

export function fireFeatureUpNext(kicker = 'UP NEXT'): boolean {
  return showFeatureNeighbour(true, kicker, 'slide-up')
}

export function fireFeatureThatWas(kicker = 'THAT WAS'): boolean {
  return showFeatureNeighbour(false, kicker, 'slide-left')
}

// ── Notes ────────────────────────────────────────────────────────

export function getNotes(): Note[] {
  return notes
}

export function addNote(note: Note): void {
  notes.unshift(note)
}

export function deleteNote(id: string): void {
  notes = notes.filter((n) => n.id !== id)
}

// ── Stream Config ────────────────────────────────────────────────

export function getStreamConfig(): StreamConfig {
  return streamConfig
}

export function setStreamConfig(config: StreamConfig): void {
  streamConfig = config
}

// ── Reset for new session ────────────────────────────────────────

export function resetState(): void {
  overlayState = JSON.parse(JSON.stringify(DEFAULT_OVERLAY_STATE))
  triggers = []
  selectedIndex = -1
  playedSet.clear()
  loopMode = 'none'
  pingPongDirection = 1
  notes = []
  streamConfig = { ...DEFAULT_STREAM_CONFIG }
  if (autoHideTimer) {
    clearTimeout(autoHideTimer)
    autoHideTimer = null
  }
  if (featureCardTimer) {
    clearTimeout(featureCardTimer)
    featureCardTimer = null
  }
  notifyChange()
}

// ── Load session state ───────────────────────────────────────────

export function loadSessionState(
  sessionTriggers: Trigger[],
  styling: OverlayStyling,
  companyLogoDataUrl: string,
  clientLogoDataUrl: string,
  savedSelectedIndex?: number,
  savedPlayedIds?: string[],
  savedLoopMode?: LoopMode,
  savedNotes?: Note[],
  savedStreamConfig?: StreamConfig,
): void {
  triggers = sessionTriggers
  // Restore saved index or default to 0
  selectedIndex = savedSelectedIndex !== undefined && savedSelectedIndex >= 0 && savedSelectedIndex < triggers.length
    ? savedSelectedIndex
    : triggers.length > 0 ? 0 : -1
  // Restore played set
  playedSet = new Set(savedPlayedIds || [])
  // Restore loop mode
  loopMode = savedLoopMode || 'none'
  pingPongDirection = 1
  // Restore notes and stream config
  notes = savedNotes || []
  streamConfig = savedStreamConfig || { ...DEFAULT_STREAM_CONFIG }

  overlayState.lowerThird.styling = { ...styling }
  overlayState.lowerThird.visible = false
  if (selectedIndex >= 0 && selectedIndex < triggers.length) {
    applyTriggerToOverlay(triggers[selectedIndex])
  }
  setCompanyLogo(companyLogoDataUrl)
  setClientLogo(clientLogoDataUrl)
}

// ── Express server ───────────────────────────────────────────────

// WS hub port, injected into the served browser-source HTML so the overlay
// connects to the ACTUAL configured hub port (not a hardcoded default).
let configuredWsPort = 19081

export function startServer(port: number, wsPort = 19081): void {
  configuredWsPort = wsPort
  const app = express()

  app.get('/overlay', (_req, res) => {
    res.type('html').send(buildOverlayHTML(overlayState, configuredWsPort))
  })

  app.get('/current', (_req, res) => {
    res.json(overlayState)
  })

  app.get('/triggers', (_req, res) => {
    res.json({ triggers, selectedIndex })
  })

  httpServer = app.listen(port, '0.0.0.0', () => {
    logger.info(`Overlay server listening on http://0.0.0.0:${port}`)
  })

  httpServer.on('error', (err: Error) => {
    logger.error(`Overlay server error: ${err.message}`, err)
  })
}

export function stopServer(): void {
  if (httpServer) {
    httpServer.close()
    httpServer = null
    logger.info('Overlay server stopped')
  }
}

