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
import { buildGoogleFontsUrl } from '../../shared/fonts'
import { createLogger } from '../logger'
import { recordEvent } from './events'

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

export function fireLowerThird(): void {
  overlayState.lowerThird.visible = true

  // Track played trigger
  if (selectedIndex >= 0 && selectedIndex < triggers.length) {
    playedSet.add(triggers[selectedIndex].id)
  }

  if (autoHideTimer) clearTimeout(autoHideTimer)
  const seconds = overlayState.lowerThird.styling.autoHideSeconds
  if (seconds > 0) {
    autoHideTimer = setTimeout(() => {
      hideLowerThird()
    }, seconds * 1000)
  }

  notifyChange()
  logger.info('Lower third fired')
  const fired = selectedIndex >= 0 && selectedIndex < triggers.length ? triggers[selectedIndex] : null
  recordEvent('overlay', `Lower third fired${fired ? `: ${fired.name}` : ''}`, fired ? { triggerId: fired.id } : undefined)
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
  fireLowerThird()
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
    res.type('html').send(buildOverlayHTML())
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

// ── Browser source HTML ──────────────────────────────────────────

function buildOverlayHTML(): string {
  const styling = overlayState.lowerThird.styling
  const layout = styling.layout || { lowerThird: { x: 3.1, y: 85 }, companyLogo: { x: 2.1, y: 2.8 }, clientLogo: { x: 87.9, y: 2.8 }, ticker: { x: 0, y: 96.3, width: 100 }, clock: { x: 2.1, y: 89 }, counter: { x: 86, y: 4, width: 13 } }
  const clockLayout = layout.clock || { x: 2.1, y: 89 }
  const counterLayout = layout.counter || { x: 86, y: 4, width: 13 }
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="${buildGoogleFontsUrl()}">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1920px;
    height: 1080px;
    background: transparent;
    overflow: hidden;
    font-family: ${styling.fontFamily};
  }

  /* ── Company logo ── */
  .company-logo {
    position: absolute;
    top: ${layout.companyLogo.y}%;
    left: ${layout.companyLogo.x}%;
    max-height: 80px;
    max-width: 200px;
    opacity: 0;
    transition: opacity 0.5s ease;
  }
  .company-logo.visible { opacity: 1; }

  /* ── Client logo ── */
  .client-logo {
    position: absolute;
    top: ${layout.clientLogo.y}%;
    left: ${layout.clientLogo.x}%;
    max-height: 80px;
    max-width: 200px;
    opacity: 0;
    transition: opacity 0.5s ease;
  }
  .client-logo.visible { opacity: 1; }

  /* ── Lower third ── */
  .lower-third {
    position: absolute;
    top: ${layout.lowerThird.y}%;
    left: ${layout.lowerThird.x}%;
    max-width: 800px;
    opacity: 0;
    transition: opacity var(--anim-dur, 0.5s) var(--anim-ease, ease), transform var(--anim-dur, 0.5s) var(--anim-ease, ease), filter var(--anim-dur, 0.5s) var(--anim-ease, ease);
  }
  .lower-third.visible { opacity: 1; }

  .lt-card {
    padding: 16px 28px;
    border-radius: var(--border-radius, 8px);
    color: var(--text-color, #ffffff);
    font-family: var(--font-family, 'Segoe UI', sans-serif);
  }

  /* Background styles */
  .lt-card.bg-solid {
    background: var(--bg-color, #1a1a2e);
  }
  .lt-card.bg-gradient {
    background: linear-gradient(135deg, var(--bg-color, #1a1a2e), var(--accent-color, #667eea));
  }
  .lt-card.bg-glass {
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  .lt-card.bg-accent-bar {
    background: var(--bg-color, #1a1a2e);
    border-left: 4px solid var(--accent-color, #667eea);
  }

  /* ── Lower-third label chip (UP NEXT / THAT WAS / pinned) ── */
  .lt-label {
    display: none;
    align-self: flex-start;
    font-size: calc(var(--font-size, 28px) * 0.42);
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    padding: 3px 10px;
    border-radius: calc(var(--border-radius, 8px) * 0.6);
    margin-bottom: 8px;
    color: var(--label-color, #1a1a2e);
    background: var(--label-bg, #667eea);
  }
  .lt-card.has-label .lt-label { display: inline-block; }

  .lt-title {
    font-size: var(--font-size, 28px);
    font-weight: var(--font-weight, 600);
    line-height: 1.3;
    text-transform: var(--title-transform, none);
    letter-spacing: var(--title-letter-spacing, 0px);
  }
  .lt-subtitle {
    font-size: var(--subtitle-size, calc(var(--font-size, 28px) * 0.7));
    font-weight: 400;
    opacity: 0.85;
    margin-top: 4px;
    color: var(--subtitle-color, var(--text-color, #ffffff));
  }
  /* Optional legibility treatments */
  .lt-card.text-shadow .lt-title,
  .lt-card.text-shadow .lt-subtitle {
    text-shadow: 0 2px 6px rgba(0,0,0,0.65);
  }
  .lt-card.text-glow .lt-title {
    text-shadow: 0 0 14px var(--accent-color, #667eea), 0 0 4px rgba(0,0,0,0.4);
  }

  /* ── Animation variants ── */

  /* Slide — smooth entrance from left */
  .lower-third.anim-slide { transform: translateX(-100px); }
  .lower-third.anim-slide.visible { transform: translateX(0); transition: opacity calc(var(--anim-dur, 0.5s) * 0.6) ease, transform var(--anim-dur, 0.5s) cubic-bezier(0.22, 1, 0.36, 1); }

  /* Fade */
  .lower-third.anim-fade { transform: none; }

  /* Zoom — scale up with pop */
  .lower-third.anim-zoom { transform: scale(0.3); }
  .lower-third.anim-zoom.visible { transform: scale(1); transition: opacity calc(var(--anim-dur, 0.5s) * 0.5) ease, transform var(--anim-dur, 0.5s) cubic-bezier(0.34, 1.56, 0.64, 1); }

  /* Rise — float up smoothly */
  .lower-third.anim-rise { transform: translateY(60px); }
  .lower-third.anim-rise.visible { transform: translateY(0); transition: opacity calc(var(--anim-dur, 0.5s) * 0.5) ease, transform var(--anim-dur, 0.5s) cubic-bezier(0.22, 1, 0.36, 1); }

  /* Typewriter — JS-driven character reveal, CSS handles opacity/card visibility */
  .lower-third.anim-typewriter { transform: none; }
  .lower-third.anim-typewriter .lt-cursor {
    display: inline-block;
    width: 2px;
    height: 1em;
    background: var(--text-color, #fff);
    margin-left: 2px;
    vertical-align: text-bottom;
    animation: cursor-blink 0.5s steps(1) infinite;
  }
  @keyframes cursor-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }

  /* Bounce — drop in with bounce */
  .lower-third.anim-bounce { transform: translateY(-80px); }
  .lower-third.anim-bounce.visible { transform: translateY(0); transition: opacity calc(var(--anim-dur, 0.5s) * 0.3) ease, transform var(--anim-dur, 0.5s) cubic-bezier(0.34, 1.56, 0.64, 1); }

  /* Split — expand from center */
  .lower-third.anim-split { transform: scaleX(0); transform-origin: center; }
  .lower-third.anim-split.visible { transform: scaleX(1); transition: opacity calc(var(--anim-dur, 0.5s) * 0.4) ease, transform var(--anim-dur, 0.5s) cubic-bezier(0.22, 1, 0.36, 1); }

  /* Blur — focus in */
  .lower-third.anim-blur { filter: blur(20px); transform: scale(1.1); }
  .lower-third.anim-blur.visible { filter: blur(0px); transform: scale(1); }

  /* Sparkle — golden glow + shimmer sweep + particles */
  .lower-third.anim-sparkle {
    transform: scale(0.9);
    filter: brightness(1.8) drop-shadow(0 0 0px rgba(255,215,0,0));
  }
  .lower-third.anim-sparkle.visible {
    transform: scale(1);
    filter: brightness(1) drop-shadow(0 0 12px rgba(255,215,0,0.35));
    transition: opacity calc(var(--anim-dur, 0.5s) * 0.5) ease,
                transform var(--anim-dur, 0.5s) cubic-bezier(0.34, 1.56, 0.64, 1),
                filter calc(var(--anim-dur, 0.5s) * 1.2) ease;
  }
  .lower-third.anim-sparkle.visible .lt-card {
    animation: sparkle-glow calc(var(--anim-dur, 0.5s) * 2.5) ease-out;
    position: relative;
    overflow: hidden;
  }
  .lower-third.anim-sparkle.visible .lt-card::after {
    content: '';
    position: absolute;
    top: -50%;
    left: -60%;
    width: 40%;
    height: 200%;
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.12) 45%, rgba(255,255,255,0.25) 50%, rgba(255,255,255,0.12) 55%, transparent 100%);
    transform: skewX(-20deg);
    animation: shimmer-sweep calc(var(--anim-dur, 0.5s) * 1.5) ease-out calc(var(--anim-dur, 0.5s) * 0.3) forwards;
    pointer-events: none;
  }
  @keyframes sparkle-glow {
    0% { box-shadow: 0 0 0 rgba(255,215,0,0); }
    20% { box-shadow: 0 0 30px rgba(255,215,0,0.4), 0 0 60px rgba(255,215,0,0.15); }
    50% { box-shadow: 0 0 15px rgba(255,215,0,0.2); }
    100% { box-shadow: 0 0 0 rgba(255,215,0,0); }
  }
  @keyframes shimmer-sweep {
    0% { left: -60%; opacity: 1; }
    100% { left: 130%; opacity: 0; }
  }
  .sparkle-particle {
    position: absolute;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    pointer-events: none;
    z-index: 10;
    background: radial-gradient(circle, #fff 0%, rgba(255,215,0,0.9) 30%, transparent 70%);
    animation: sparkle-pop ease-out forwards;
  }
  @keyframes sparkle-pop {
    0% { transform: scale(0) rotate(0deg); opacity: 0.9; }
    40% { transform: scale(1.8) rotate(120deg); opacity: 1; }
    100% { transform: scale(0) rotate(300deg); opacity: 0; }
  }

  /* ── Starting Soon Scene ── */
  .starting-soon {
    position: absolute;
    top: 0; left: 0; width: 100%; height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.8s ease;
    z-index: 50;
    text-align: center;
  }
  .starting-soon.visible { opacity: 1; }
  .ss-title {
    font-size: 72px;
    font-weight: 700;
    letter-spacing: 2px;
    margin-bottom: 16px;
  }
  .ss-subtitle {
    font-size: 28px;
    font-weight: 400;
    opacity: 0.8;
    margin-bottom: 40px;
  }
  .ss-countdown {
    font-size: 96px;
    font-weight: 300;
    font-variant-numeric: tabular-nums;
    letter-spacing: 4px;
    opacity: 0;
    transition: opacity 0.5s ease;
  }
  .ss-countdown.active { opacity: 1; }
  .ss-accent-line {
    width: 120px;
    height: 4px;
    border-radius: 2px;
    margin: 24px auto;
  }
  @keyframes ss-completion-pop {
    0% { transform: scale(0.8); opacity: 0; }
    60% { transform: scale(1.05); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }

  /* ── Starting Soon — pre-show media stack ──
     Layered ambient elements driven entirely by pushed state. Each fades in
     only when its sub-element is enabled and the scene is visible. */
  .ss-welcome {
    font-size: 34px;
    font-weight: 600;
    letter-spacing: 1px;
    margin-bottom: 28px;
    opacity: 0.95;
    text-align: center;
    line-height: 1.3;
  }
  .ss-welcome .ss-venue {
    display: block;
    font-size: 22px;
    font-weight: 400;
    opacity: 0.7;
    margin-top: 6px;
  }
  .ss-sponsors {
    position: absolute;
    left: 50%;
    bottom: 120px;
    transform: translateX(-50%);
    width: 36%;
    height: 110px;
    display: none;
    align-items: center;
    justify-content: center;
  }
  .ss-sponsors.visible { display: flex; }
  .ss-sponsors img {
    position: absolute;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    opacity: 0;
    transition: opacity 0.8s ease;
  }
  .ss-sponsors img.active { opacity: 1; }
  .ss-slideshow {
    position: absolute;
    top: 0; left: 0; width: 100%; height: 100%;
    display: none;
    z-index: -1; /* behind the countdown / welcome text */
    overflow: hidden;
  }
  .ss-slideshow.visible { display: block; }
  .ss-slideshow img {
    position: absolute;
    top: 0; left: 0; width: 100%; height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity 1s ease;
  }
  .ss-slideshow img.active { opacity: 0.45; }
  .ss-social {
    position: absolute;
    left: 0; right: 0; bottom: 40px;
    display: none;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    font-weight: 500;
    letter-spacing: 1px;
    opacity: 0.9;
    text-align: center;
    padding: 0 40px;
  }
  .ss-social.visible { display: flex; }

  /* ── Operator leveling grid (rule-of-thirds) ── */
  /* Operator-only — toggled OFF before going live. Lines use a white core with
     a 1px black drop-shadow so they stay visible over light or dark footage. */
  .bb-grid {
    position: absolute;
    top: 0; left: 0;
    width: 1920px;
    height: 1080px;
    display: none;
    z-index: 100;
    pointer-events: none;
  }
  .bb-grid.visible { display: block; }
  .bb-grid .gl {
    position: absolute;
    background: rgba(255,255,255,0.5);
    box-shadow: 0 0 0 1px rgba(0,0,0,0.6);
  }
  /* Verticals at 1/3 and 2/3 */
  .bb-grid .v1 { left: 33.333%; top: 0; width: 1px; height: 100%; }
  .bb-grid .v2 { left: 66.666%; top: 0; width: 1px; height: 100%; }
  /* Horizontals at 1/3 and 2/3 */
  .bb-grid .h1 { top: 33.333%; left: 0; height: 1px; width: 100%; }
  .bb-grid .h2 { top: 66.666%; left: 0; height: 1px; width: 100%; }
  /* Diagonals corner-to-corner */
  .bb-grid .diag {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    overflow: hidden;
  }
  .bb-grid .diag svg { width: 100%; height: 100%; display: block; }
  /* Center crosshair */
  .bb-grid .cross-v { left: 50%; top: calc(50% - 20px); width: 1px; height: 40px; }
  .bb-grid .cross-h { top: 50%; left: calc(50% - 20px); height: 1px; width: 40px; }

  /* ── On-air clock ── (ported from CompSync overlay clock) */
  .bb-clock {
    position: absolute;
    left: ${clockLayout.x}%;
    top: ${clockLayout.y}%;
    opacity: 0;
    transition: opacity 0.4s ease;
    z-index: 40;
  }
  .bb-clock.visible { opacity: 1; }
  .bb-clock-box {
    background: rgba(30, 30, 46, 0.85);
    border: 1px solid rgba(102, 126, 234, 0.3);
    border-radius: 8px;
    padding: 8px 16px;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    text-align: center;
    min-width: 120px;
  }
  .bb-clock-time {
    font-size: 24px;
    font-weight: 600;
    color: #ffffff;
    font-variant-numeric: tabular-nums;
    letter-spacing: 1px;
  }

  /* ── Counter badge ── (#42 style, pop-in on change) */
  .bb-counter {
    position: absolute;
    left: ${counterLayout.x}%;
    top: ${counterLayout.y}%;
    opacity: 0;
    transform: translateY(-10px);
    transition: opacity 0.4s ease, transform 0.4s ease;
    z-index: 40;
  }
  .bb-counter.visible { opacity: 1; transform: translateY(0); }
  .bb-counter-box {
    background: rgba(30, 30, 46, 0.88);
    border: 1px solid rgba(102, 126, 234, 0.5);
    border-radius: 10px;
    padding: 12px 20px;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    text-align: center;
    min-width: 120px;
  }
  .bb-counter-number {
    font-size: 48px;
    font-weight: 800;
    color: #ffffff;
    line-height: 1;
    white-space: nowrap;
  }
  .bb-counter-number::before { content: '#'; opacity: 0.4; font-size: 28px; }
  .bb-counter-label {
    font-size: 13px;
    color: #e8e8f5;
    margin-top: 4px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  /* Pop-in fired by JS on value change */
  .bb-counter.advance .bb-counter-number {
    animation: bbCounterPop 0.7s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  @keyframes bbCounterPop {
    0%   { transform: scale(1); filter: brightness(1) drop-shadow(0 0 0 rgba(102,126,234,0)); }
    35%  { transform: scale(1.32); filter: brightness(1.4) drop-shadow(0 0 22px rgba(102,126,234,0.9)); color: #a4b3ff; }
    100% { transform: scale(1); filter: brightness(1) drop-shadow(0 0 0 rgba(102,126,234,0)); }
  }

  /* ── Full-screen feature card ── (ported from CompSync featureCard) */
  .bb-feature-card {
    position: absolute; inset: 0;
    width: 1920px; height: 1080px;
    color: #ffffff;
    pointer-events: none;
    visibility: hidden;
    opacity: 0;
    z-index: 60;
    --fc-from: translateY(100%);
  }
  .bb-feature-card.visible { visibility: visible; opacity: 1; }
  .bb-feature-card.slide-up   { --fc-from: translateY( 100%); }
  .bb-feature-card.slide-left { --fc-from: translateX( 100%); }
  .bb-feature-card.zoom       { --fc-from: scale(0.4); }
  .bb-feature-card.fade       { --fc-from: translate(0,0); }
  .bb-feature-card.entering {
    animation: bbFcEnter 0.85s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  }
  .bb-feature-card.exiting {
    animation: bbFcExit 0.65s cubic-bezier(0.55, 0.05, 0.6, 0.05) forwards;
  }
  @keyframes bbFcEnter {
    0%   { transform: var(--fc-from); filter: blur(14px); opacity: 0; }
    35%  { filter: blur(8px); opacity: 1; }
    72%  { transform: translate(0,0) scale(1); filter: blur(2px); }
    100% { transform: translate(0,0) scale(1); filter: blur(0px); opacity: 1; }
  }
  @keyframes bbFcExit {
    0%   { transform: translate(0,0) scale(1); filter: blur(0px); opacity: 1; }
    100% { transform: var(--fc-from); filter: blur(14px); opacity: 0; }
  }
  .bb-fc-bg {
    position: absolute; inset: 0;
    background:
      radial-gradient(ellipse at 18% 22%, rgba(102,126,234,0.42) 0%, transparent 55%),
      radial-gradient(ellipse at 82% 78%, rgba(156,109,255,0.30) 0%, transparent 60%),
      linear-gradient(135deg, #0d0f1d 0%, #14172a 45%, #1c1f3a 100%);
  }
  .bb-fc-bg::after {
    content: '';
    position: absolute; left: 0; top: 0; right: 0; height: 6px;
    background: linear-gradient(90deg, transparent 0%, var(--fc-accent, #667eea) 50%, transparent 100%);
    opacity: 0.85;
    box-shadow: 0 0 24px var(--fc-accent, #667eea);
  }
  .bb-fc-sparkles {
    position: absolute; inset: 0;
    pointer-events: none; overflow: hidden; z-index: 0;
  }
  .bb-fc-sparkle {
    position: absolute;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><defs><radialGradient id='g' cx='50%25' cy='50%25' r='50%25'><stop offset='0%25' stop-color='%23fff' stop-opacity='1'/><stop offset='40%25' stop-color='%23fff' stop-opacity='0.85'/><stop offset='100%25' stop-color='%23fff' stop-opacity='0'/></radialGradient></defs><path d='M12 0 L13.5 10.5 L24 12 L13.5 13.5 L12 24 L10.5 13.5 L0 12 L10.5 10.5 Z' fill='url(%23g)'/></svg>");
    background-size: contain; background-repeat: no-repeat;
    opacity: 0;
    filter: drop-shadow(0 0 6px rgba(255,255,255,0.85));
  }
  .bb-feature-card.visible .bb-fc-sparkle { animation: bbFcSparkle 3s ease-in-out infinite; }
  .bb-fc-sparkle.sm { width: 10px; height: 10px; }
  .bb-fc-sparkle.md { width: 18px; height: 18px; }
  .bb-fc-sparkle.lg { width: 28px; height: 28px; }
  @keyframes bbFcSparkle {
    0%, 100% { opacity: 0;    transform: scale(0.4) rotate(0deg); }
    45%      { opacity: 0.95; transform: scale(1.05) rotate(45deg); }
    60%      { opacity: 0.95; transform: scale(1.05) rotate(45deg); }
  }
  .bb-fc-content {
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 24px; text-align: center;
    z-index: 3; padding: 0 120px;
  }
  .bb-fc-logo {
    max-width: 280px; max-height: 160px; object-fit: contain;
    margin-bottom: 8px;
    filter: drop-shadow(0 0 14px rgba(255,255,255,0.18));
  }
  .bb-fc-logo.empty { display: none; }
  .bb-fc-kicker {
    font-family: 'Bebas Neue', 'Anton', 'Arial Black', sans-serif;
    font-size: 56px; letter-spacing: 0.12em; line-height: 1;
    text-transform: uppercase;
    color: var(--fc-accent, #667eea);
    text-shadow: 0 0 28px rgba(0,0,0,0.5), 0 0 18px var(--fc-accent, #667eea);
  }
  .bb-feature-card.visible .bb-fc-kicker { animation: bbFcHeaderGlow 3.4s ease-in-out infinite; }
  @keyframes bbFcHeaderGlow {
    0%, 100% { text-shadow: 0 0 28px rgba(0,0,0,0.5), 0 0 14px var(--fc-accent, #667eea); }
    50%      { text-shadow: 0 0 28px rgba(0,0,0,0.5), 0 0 38px var(--fc-accent, #667eea); }
  }
  .bb-fc-title {
    font-family: 'Playfair Display', 'Georgia', serif;
    font-weight: 700; font-size: 96px; line-height: 1.04;
    max-width: 1500px;
    text-shadow: 0 4px 16px rgba(0,0,0,0.55);
  }
  .bb-feature-card.visible .bb-fc-title { animation: bbFcTitlePulse 2.4s ease-in-out infinite; }
  @keyframes bbFcTitlePulse {
    0%, 100% { text-shadow: 0 4px 16px rgba(0,0,0,0.55), 0 0 18px transparent; }
    50%      { text-shadow: 0 4px 16px rgba(0,0,0,0.55), 0 0 42px var(--fc-accent, #667eea), 0 0 12px rgba(255,255,255,0.18); }
  }
  .bb-fc-subtitle {
    font-family: 'Inter', 'Segoe UI', sans-serif;
    font-weight: 500; font-size: 36px; line-height: 1.35;
    color: rgba(255,255,255,0.93);
    max-width: 1400px;
  }
  .bb-fc-subtitle.empty { display: none; }

  /* ── Ticker / Crawl ── */
  .ticker-bar {
    position: absolute;
    top: ${layout.ticker.y}%;
    left: ${layout.ticker.x}%;
    width: ${layout.ticker.width || 100}%;
    height: 40px;
    overflow: hidden;
    opacity: 0;
    transition: opacity 0.4s ease;
    display: flex;
    align-items: center;
  }
  .ticker-bar.visible { opacity: 1; }

  .ticker-text {
    position: absolute;
    white-space: nowrap;
    font-size: 18px;
    font-weight: 500;
    animation: ticker-scroll linear infinite;
    animation-play-state: paused;
  }
  .ticker-bar.visible .ticker-text {
    animation-play-state: running;
  }

  @keyframes ticker-scroll {
    0% { transform: translateX(100vw); }
    100% { transform: translateX(-100%); }
  }
</style>
</head>
<body>
  <img id="company-logo" class="company-logo" src="" alt="">
  <img id="client-logo" class="client-logo" src="" alt="">

  <div id="ticker" class="ticker-bar">
    <span id="ticker-text" class="ticker-text"></span>
  </div>

  <div id="lt" class="lower-third">
    <div id="lt-card" class="lt-card bg-solid">
      <div class="lt-label" id="lt-label"></div>
      <div class="lt-title" id="lt-title"></div>
      <div class="lt-subtitle" id="lt-subtitle"></div>
    </div>
  </div>

  <div id="bb-grid" class="bb-grid">
    <div class="gl v1"></div>
    <div class="gl v2"></div>
    <div class="gl h1"></div>
    <div class="gl h2"></div>
    <div class="diag">
      <svg viewBox="0 0 1920 1080" preserveAspectRatio="none">
        <line x1="0" y1="0" x2="1920" y2="1080" stroke="rgba(255,255,255,0.35)" stroke-width="1" />
        <line x1="1920" y1="0" x2="0" y2="1080" stroke="rgba(255,255,255,0.35)" stroke-width="1" />
      </svg>
    </div>
    <div class="gl cross-v"></div>
    <div class="gl cross-h"></div>
  </div>

  <div id="starting-soon" class="starting-soon">
    <div class="ss-slideshow" id="ss-slideshow">
      <img class="ss-slide-front" />
      <img class="ss-slide-back" />
    </div>
    <div class="ss-welcome" id="ss-welcome" style="display:none"></div>
    <div class="ss-title" id="ss-title"></div>
    <div class="ss-accent-line" id="ss-accent"></div>
    <div class="ss-subtitle" id="ss-subtitle"></div>
    <div class="ss-countdown" id="ss-countdown"></div>
    <div class="ss-sponsors" id="ss-sponsors"></div>
    <div class="ss-social" id="ss-social"></div>
  </div>

  <div id="bb-clock" class="bb-clock">
    <div class="bb-clock-box">
      <div class="bb-clock-time" id="bb-clock-time"></div>
    </div>
  </div>

  <div id="bb-counter" class="bb-counter">
    <div class="bb-counter-box">
      <div class="bb-counter-number" id="bb-counter-number"></div>
      <div class="bb-counter-label" id="bb-counter-label" style="display:none"></div>
    </div>
  </div>

  <div id="bb-feature-card" class="bb-feature-card">
    <div class="bb-fc-bg"></div>
    <div class="bb-fc-sparkles" id="bb-fc-sparkles"></div>
    <div class="bb-fc-content">
      <img class="bb-fc-logo empty" id="bb-fc-logo" src="" alt="">
      <div class="bb-fc-kicker" id="bb-fc-kicker"></div>
      <div class="bb-fc-title" id="bb-fc-title"></div>
      <div class="bb-fc-subtitle empty" id="bb-fc-subtitle"></div>
    </div>
  </div>

  <script>
    const WS_URL = 'ws://' + location.hostname + ':' + ${configuredWsPort};
    let ws = null;
    let reconnectTimer = null;
    let typewriterTimer = null;
    let countdownInterval = null;
    let clockFormat = '12h';
    let clockShowSeconds = true;
    let lastCounterValue = null;
    let lastFcFiredAt = 0;
    let lastFcVisible = false;
    let fcExitTimer = null;

    function connect() {
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'identify', client: 'overlay' }));
        if (reconnectTimer) { clearInterval(reconnectTimer); reconnectTimer = null; }
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'state') applyState(msg);
      };

      ws.onclose = () => {
        if (!reconnectTimer) {
          reconnectTimer = setInterval(connect, 3000);
        }
      };

      ws.onerror = () => {};
    }

    function clearTypewriter() {
      if (typewriterTimer) { clearInterval(typewriterTimer); typewriterTimer = null; }
      var cursors = document.querySelectorAll('.lt-cursor');
      cursors.forEach(function(c) { c.remove(); });
    }

    function clearSparkles() {
      var particles = document.querySelectorAll('.sparkle-particle');
      particles.forEach(function(p) { p.remove(); });
    }

    function applyState(msg) {
      const lt = msg.overlay.lowerThird;
      const el = document.getElementById('lt');
      const card = document.getElementById('lt-card');
      const titleEl = document.getElementById('lt-title');
      const subtitleEl = document.getElementById('lt-subtitle');
      const labelEl = document.getElementById('lt-label');
      const s = lt.styling;

      // Clear any running effects
      clearTypewriter();
      clearSparkles();

      // Update CSS custom properties
      card.style.setProperty('--bg-color', s.backgroundColor);
      card.style.setProperty('--text-color', s.textColor);
      card.style.setProperty('--accent-color', s.accentColor);
      card.style.setProperty('--font-family', s.fontFamily);
      card.style.setProperty('--font-size', s.fontSize + 'px');
      card.style.setProperty('--font-weight', s.fontWeight);
      card.style.setProperty('--border-radius', s.borderRadius + 'px');

      // Richer title/subtitle styling
      card.style.setProperty('--title-transform', s.titleTextTransform || 'none');
      card.style.setProperty('--title-letter-spacing', (s.titleLetterSpacing || 0) + 'px');
      if (s.subtitleFontSize && s.subtitleFontSize > 0) {
        card.style.setProperty('--subtitle-size', s.subtitleFontSize + 'px');
      } else {
        card.style.setProperty('--subtitle-size', 'calc(' + s.fontSize + 'px * 0.7)');
      }
      card.style.setProperty('--subtitle-color', s.subtitleColor || s.textColor);
      card.style.setProperty('--label-color', s.labelColor || '#1a1a2e');
      card.style.setProperty('--label-bg', s.labelBackgroundColor || '#667eea');

      // Label chip (UP NEXT / THAT WAS / pinned)
      labelEl.textContent = lt.label || '';

      // Animation timing
      var durVal = s.animationDuration || 0.5;
      var dur = durVal + 's';
      var easingMap = { ease:'ease', 'ease-in':'ease-in', 'ease-out':'ease-out', 'ease-in-out':'ease-in-out', linear:'linear', bounce:'cubic-bezier(0.34,1.56,0.64,1)', elastic:'cubic-bezier(0.68,-0.55,0.27,1.55)' };
      var ease = easingMap[s.animationEasing] || 'ease';
      el.style.setProperty('--anim-dur', dur);
      el.style.setProperty('--anim-ease', ease);

      // Background style + optional treatments + label visibility
      var cardClasses = 'lt-card bg-' + s.backgroundStyle;
      if (s.textShadow) cardClasses += ' text-shadow';
      if (s.textGlow) cardClasses += ' text-glow';
      if (lt.label) cardClasses += ' has-label';
      card.className = cardClasses;

      // Determine animation
      const anim = s.animation === 'random'
        ? ['slide','fade','zoom','rise','typewriter','bounce','split','blur','sparkle'][Math.floor(Math.random()*9)]
        : s.animation;

      // Set text (typewriter overrides this when visible)
      if (anim !== 'typewriter' || !lt.visible) {
        titleEl.textContent = lt.title || '';
        subtitleEl.textContent = lt.subtitle || '';
      }

      // Animation class
      el.className = 'lower-third';
      el.classList.add('anim-' + anim);

      // Toggle visibility
      if (lt.visible) {
        requestAnimationFrame(function() {
          el.classList.add('visible');

          // Typewriter: character-by-character reveal
          if (anim === 'typewriter') {
            var fullTitle = lt.title || '';
            var fullSubtitle = lt.subtitle || '';
            var total = fullTitle.length + fullSubtitle.length;
            if (total === 0) { titleEl.textContent = ''; subtitleEl.textContent = ''; return; }

            titleEl.textContent = '';
            subtitleEl.textContent = '';
            var charDelay = Math.max(20, (durVal * 1000) / total);
            var idx = 0;

            // Add cursor to title
            var cursor = document.createElement('span');
            cursor.className = 'lt-cursor';
            titleEl.appendChild(cursor);

            typewriterTimer = setInterval(function() {
              if (idx < fullTitle.length) {
                titleEl.textContent = fullTitle.substring(0, idx + 1);
                titleEl.appendChild(cursor);
              } else {
                // Move cursor to subtitle
                titleEl.textContent = fullTitle;
                var si = idx - fullTitle.length;
                subtitleEl.textContent = fullSubtitle.substring(0, si + 1);
                subtitleEl.appendChild(cursor);
              }
              idx++;
              if (idx >= total) {
                clearInterval(typewriterTimer);
                typewriterTimer = null;
                titleEl.textContent = fullTitle;
                subtitleEl.textContent = fullSubtitle;
                // Remove cursor after a brief pause
                setTimeout(function() { cursor.remove(); }, 800);
              }
            }, charDelay);
          }

          // Sparkle: inject particles around the element
          if (anim === 'sparkle') {
            var rect = card.getBoundingClientRect();
            for (var i = 0; i < 14; i++) {
              var p = document.createElement('span');
              p.className = 'sparkle-particle';
              p.style.left = (Math.random() * 120 - 10) + '%';
              p.style.top = (Math.random() * 120 - 10) + '%';
              p.style.animationDelay = (Math.random() * durVal * 0.8) + 's';
              p.style.animationDuration = (0.3 + Math.random() * 0.5) + 's';
              var size = 4 + Math.random() * 6;
              p.style.width = size + 'px';
              p.style.height = size + 'px';
              el.appendChild(p);
              (function(particle) {
                setTimeout(function() { particle.remove(); }, (durVal * 2 + 1) * 1000);
              })(p);
            }
          }
        });
      }

      // Company logo
      const compLogo = document.getElementById('company-logo');
      if (msg.overlay.companyLogo.dataUrl) {
        compLogo.src = msg.overlay.companyLogo.dataUrl;
        compLogo.classList.toggle('visible', msg.overlay.companyLogo.visible);
      } else {
        compLogo.classList.remove('visible');
      }

      // Client logo
      const cliLogo = document.getElementById('client-logo');
      if (msg.overlay.clientLogo.dataUrl) {
        cliLogo.src = msg.overlay.clientLogo.dataUrl;
        cliLogo.classList.toggle('visible', msg.overlay.clientLogo.visible);
      } else {
        cliLogo.classList.remove('visible');
      }

      // Starting Soon
      if (msg.overlay.startingSoon) {
        applyStartingSoon(msg.overlay.startingSoon);
      }

      // Ticker
      const ticker = msg.overlay.ticker;
      const tickerEl = document.getElementById('ticker');
      const tickerText = document.getElementById('ticker-text');
      if (ticker) {
        tickerText.textContent = ticker.text || '';
        tickerEl.style.background = ticker.backgroundColor || '#1a1a2e';
        tickerText.style.color = ticker.textColor || '#ffffff';
        const speed = ticker.speed || 60;
        const duration = Math.max(10, 1920 / speed * 2);
        tickerText.style.animationDuration = duration + 's';
        tickerEl.classList.toggle('visible', ticker.visible);
      }

      // Operator leveling grid
      var gridEl = document.getElementById('bb-grid');
      if (gridEl) gridEl.classList.toggle('visible', !!msg.overlay.gridVisible);

      // Clock
      if (msg.overlay.clock) applyClock(msg.overlay.clock);

      // Counter
      if (msg.overlay.counter) applyCounter(msg.overlay.counter);

      // Feature card
      if (msg.overlay.featureCard) applyFeatureCard(msg.overlay.featureCard);
    }

    function applyClock(c) {
      var clockEl = document.getElementById('bb-clock');
      if (!clockEl) return;
      clockFormat = c.format || '12h';
      clockShowSeconds = c.showSeconds !== false;
      clockEl.classList.toggle('visible', !!c.visible);
      if (c.visible) updateClock();
    }

    function updateClock() {
      var timeEl = document.getElementById('bb-clock-time');
      if (!timeEl) return;
      var now = new Date();
      var h = now.getHours();
      var m = String(now.getMinutes()).padStart(2, '0');
      var s = String(now.getSeconds()).padStart(2, '0');
      var out;
      if (clockFormat === '24h') {
        out = String(h).padStart(2, '0') + ':' + m;
        if (clockShowSeconds) out += ':' + s;
      } else {
        var ampm = h >= 12 ? 'PM' : 'AM';
        var h12 = h % 12 || 12;
        out = h12 + ':' + m;
        if (clockShowSeconds) out += ':' + s;
        out += ' ' + ampm;
      }
      timeEl.textContent = out;
    }

    function applyCounter(c) {
      var counterEl = document.getElementById('bb-counter');
      var numEl = document.getElementById('bb-counter-number');
      var labelEl = document.getElementById('bb-counter-label');
      if (!counterEl || !numEl) return;
      if (c.visible) {
        counterEl.classList.add('visible');
        // Pop-in on value change
        if (lastCounterValue !== null && c.value !== lastCounterValue) {
          counterEl.classList.remove('advance');
          void counterEl.offsetWidth;
          counterEl.classList.add('advance');
        }
        lastCounterValue = c.value;
        numEl.textContent = String(c.value);
        if (labelEl) {
          if (c.label) {
            labelEl.textContent = c.label;
            labelEl.style.display = '';
          } else {
            labelEl.style.display = 'none';
          }
        }
      } else {
        counterEl.classList.remove('visible');
        lastCounterValue = null;
      }
    }

    function applyFeatureCard(fc) {
      var fcEl = document.getElementById('bb-feature-card');
      if (!fcEl) return;
      var anim = fc.animateIn || 'slide-up';
      var shouldShow = !!fc.visible;
      var retrigger = (fc.firedAt && fc.firedAt !== lastFcFiredAt);

      // Populate text (idempotent, cheap)
      var kickerEl = document.getElementById('bb-fc-kicker');
      if (kickerEl) kickerEl.textContent = fc.kicker || '';
      var titleEl = document.getElementById('bb-fc-title');
      if (titleEl) titleEl.textContent = fc.title || '';
      var subEl = document.getElementById('bb-fc-subtitle');
      if (subEl) {
        subEl.textContent = fc.subtitle || '';
        subEl.classList.toggle('empty', !fc.subtitle);
      }
      var logoEl = document.getElementById('bb-fc-logo');
      if (logoEl) {
        if (fc.logoDataUrl) {
          logoEl.src = fc.logoDataUrl;
          logoEl.classList.remove('empty');
        } else {
          logoEl.classList.add('empty');
        }
      }

      // Animation direction class — clear all, add chosen
      ['slide-up','slide-left','zoom','fade'].forEach(function(d){ fcEl.classList.remove(d); });
      fcEl.classList.add(anim);

      if (shouldShow && (retrigger || !lastFcVisible)) {
        if (fcExitTimer) { clearTimeout(fcExitTimer); fcExitTimer = null; }
        fcEl.classList.remove('exiting', 'entering', 'visible');
        // Re-seed sparkle field
        var sparkles = document.getElementById('bb-fc-sparkles');
        if (sparkles) {
          sparkles.innerHTML = '';
          var sizes = ['sm','md','lg'];
          for (var i = 0; i < 7; i++) {
            var sp = document.createElement('div');
            sp.className = 'bb-fc-sparkle ' + sizes[i % 3];
            sp.style.left = (Math.random() * 92 + 4) + '%';
            sp.style.top = (Math.random() * 92 + 4) + '%';
            sp.style.animationDelay = (Math.random() * 3).toFixed(2) + 's';
            sp.style.animationDuration = (2.4 + Math.random() * 1.6).toFixed(2) + 's';
            sparkles.appendChild(sp);
          }
        }
        void fcEl.offsetWidth;
        fcEl.classList.add('visible', 'entering');
        lastFcFiredAt = fc.firedAt;
        lastFcVisible = true;
      } else if (!shouldShow && lastFcVisible) {
        fcEl.classList.remove('entering');
        fcEl.classList.add('exiting');
        if (fcExitTimer) clearTimeout(fcExitTimer);
        fcExitTimer = setTimeout(function() {
          fcEl.classList.remove('visible', 'exiting');
          fcExitTimer = null;
        }, 700);
        lastFcVisible = false;
        lastFcFiredAt = fc.firedAt || 0;
      }
    }

    function applyStartingSoon(ss) {
      var ssEl = document.getElementById('starting-soon');
      var ssTitleEl = document.getElementById('ss-title');
      var ssSubEl = document.getElementById('ss-subtitle');
      var ssCountEl = document.getElementById('ss-countdown');
      var ssAccent = document.getElementById('ss-accent');

      if (!ss) { ssEl.classList.remove('visible'); return; }

      ssTitleEl.textContent = ss.title || '';
      ssSubEl.textContent = ss.subtitle || '';
      ssEl.style.background = ss.backgroundColor || '#1a1a2e';
      ssTitleEl.style.color = ss.textColor || '#ffffff';
      ssSubEl.style.color = ss.textColor || '#ffffff';
      ssCountEl.style.color = ss.accentColor || '#667eea';
      ssAccent.style.background = ss.accentColor || '#667eea';

      if (ss.visible) {
        ssEl.classList.add('visible');
      } else {
        ssEl.classList.remove('visible');
      }

      // Countdown
      if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
      if (ss.visible && ss.showCountdown && ss.countdownTarget) {
        ssCountEl.classList.add('active');
        var completionText = ss.completionText || '';
        function updateCountdown() {
          var target = new Date(ss.countdownTarget).getTime();
          var now = Date.now();
          var diff = Math.max(0, target - now);
          if (diff <= 0) {
            // Countdown complete — show completion text
            ssCountEl.textContent = '';
            if (completionText) {
              ssTitleEl.textContent = completionText;
              ssSubEl.textContent = '';
              ssTitleEl.style.animation = 'ss-completion-pop 0.6s ease-out';
            } else {
              ssCountEl.textContent = '00:00';
            }
            if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
            return;
          }
          var h = Math.floor(diff / 3600000);
          var m = Math.floor((diff % 3600000) / 60000);
          var s = Math.floor((diff % 60000) / 1000);
          if (h > 0) {
            ssCountEl.textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
          } else {
            ssCountEl.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
          }
        }
        updateCountdown();
        countdownInterval = setInterval(updateCountdown, 1000);
      } else {
        ssCountEl.classList.remove('active');
        ssCountEl.textContent = '';
      }

      // ── Pre-show media stack (sponsor carousel / slideshow / social / welcome) ──
      applyStartingSoonMedia(ss);
    }

    // Drives the optional ambient media layered on the starting-soon scene.
    // Stateless: reads the pushed arrays/flags, rebuilds rotation intervals only
    // when the relevant config changes (hash-guarded), and tears everything down
    // when the scene hides or a sub-element is turned off.
    function applyStartingSoonMedia(ss) {
      var media = (ss && ss.media) || null;
      var on = !!(ss && ss.visible);
      var welcomeEl = document.getElementById('ss-welcome');
      var sponsorsEl = document.getElementById('ss-sponsors');
      var slideEl = document.getElementById('ss-slideshow');
      var socialEl = document.getElementById('ss-social');

      // Welcome / venue line ------------------------------------------------
      if (welcomeEl) {
        if (on && media && media.showWelcome && (media.welcomeLine || media.venueName)) {
          var wHtml = '';
          if (media.welcomeLine) wHtml += escapeHtml(media.welcomeLine);
          if (media.venueName) wHtml += '<span class="ss-venue">' + escapeHtml(media.venueName) + '</span>';
          welcomeEl.innerHTML = wHtml;
          welcomeEl.style.color = ss.textColor || '#ffffff';
          welcomeEl.style.display = 'block';
        } else {
          welcomeEl.style.display = 'none';
          welcomeEl.innerHTML = '';
        }
      }

      // Social bar ----------------------------------------------------------
      if (socialEl) {
        if (on && media && media.showSocialBar && media.socialBar) {
          socialEl.textContent = media.socialBar;
          socialEl.style.color = ss.textColor || '#ffffff';
          socialEl.classList.add('visible');
        } else {
          socialEl.classList.remove('visible');
          socialEl.textContent = '';
        }
      }

      // Sponsor logo carousel ----------------------------------------------
      if (sponsorsEl) {
        var sponsorLogos = (media && media.sponsorLogos) || [];
        var sponsorActive = !!(on && media && media.showSponsors && sponsorLogos.length > 0);
        if (sponsorActive) {
          var sponsorHash = JSON.stringify(sponsorLogos) + '|' + (media.sponsorIntervalSec || 6);
          if (window._ssSponsorHash !== sponsorHash) {
            window._ssSponsorHash = sponsorHash;
            if (window._ssSponsorInterval) { clearInterval(window._ssSponsorInterval); window._ssSponsorInterval = null; }
            sponsorsEl.innerHTML = '';
            window._ssSponsorIdx = 0;
            sponsorLogos.forEach(function(src, i) {
              var img = document.createElement('img');
              img.src = src;
              if (i === 0) img.classList.add('active');
              sponsorsEl.appendChild(img);
            });
            if (sponsorLogos.length > 1) {
              var sIntervalMs = Math.max(1, (media.sponsorIntervalSec || 6)) * 1000;
              window._ssSponsorInterval = setInterval(function() {
                var imgs = sponsorsEl.querySelectorAll('img');
                if (imgs.length <= 1) return;
                imgs[window._ssSponsorIdx].classList.remove('active');
                window._ssSponsorIdx = (window._ssSponsorIdx + 1) % imgs.length;
                imgs[window._ssSponsorIdx].classList.add('active');
              }, sIntervalMs);
            }
          }
          sponsorsEl.classList.add('visible');
        } else {
          sponsorsEl.classList.remove('visible');
          if (window._ssSponsorInterval) { clearInterval(window._ssSponsorInterval); window._ssSponsorInterval = null; }
          window._ssSponsorHash = null;
        }
      }

      // Photo slideshow (cross-fade) ---------------------------------------
      if (slideEl) {
        var photos = (media && media.slideshowPhotos) || [];
        var slideActive = !!(on && media && media.showSlideshow && photos.length > 0);
        var frontImg = slideEl.querySelector('.ss-slide-front');
        var backImg = slideEl.querySelector('.ss-slide-back');
        if (slideActive) {
          var slideHash = JSON.stringify(photos) + '|' + (media.slideshowIntervalSec || 6);
          if (window._ssSlideHash !== slideHash) {
            window._ssSlideHash = slideHash;
            if (window._ssSlideInterval) { clearInterval(window._ssSlideInterval); window._ssSlideInterval = null; }
            window._ssSlideIdx = 0;
            window._ssSlideFront = true;
            if (frontImg) { frontImg.src = photos[0]; frontImg.classList.add('active'); }
            if (backImg) { backImg.classList.remove('active'); }
            if (photos.length > 1) {
              var pIntervalMs = Math.max(1, (media.slideshowIntervalSec || 6)) * 1000;
              window._ssSlideInterval = setInterval(function() {
                window._ssSlideIdx = (window._ssSlideIdx + 1) % photos.length;
                var nextSrc = photos[window._ssSlideIdx];
                if (window._ssSlideFront) {
                  if (backImg) { backImg.src = nextSrc; backImg.classList.add('active'); }
                  if (frontImg) { frontImg.classList.remove('active'); }
                } else {
                  if (frontImg) { frontImg.src = nextSrc; frontImg.classList.add('active'); }
                  if (backImg) { backImg.classList.remove('active'); }
                }
                window._ssSlideFront = !window._ssSlideFront;
              }, pIntervalMs);
            }
          }
          slideEl.classList.add('visible');
        } else {
          slideEl.classList.remove('visible');
          if (window._ssSlideInterval) { clearInterval(window._ssSlideInterval); window._ssSlideInterval = null; }
          window._ssSlideHash = null;
          if (frontImg) { frontImg.classList.remove('active'); frontImg.src = ''; }
          if (backImg) { backImg.classList.remove('active'); backImg.src = ''; }
        }
      }
    }

    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // Drive the clock once a second (only repaints when visible).
    setInterval(function() {
      var clockEl = document.getElementById('bb-clock');
      if (clockEl && clockEl.classList.contains('visible')) updateClock();
    }, 1000);

    connect();
  </script>
</body>
</html>`
}
