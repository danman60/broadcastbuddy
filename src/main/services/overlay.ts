import express from 'express'
import type { Server } from 'http'
import {
  OverlayState,
  OverlayStyling,
  Trigger,
  Note,
  StreamConfig,
  StartingSoonState,
  DEFAULT_OVERLAY_STATE,
  DEFAULT_STYLING,
  DEFAULT_STREAM_CONFIG,
  AnimationType,
  LoopMode,
} from '../../shared/types'
import { buildGoogleFontsUrl } from '../../shared/fonts'
import { createLogger } from '../logger'

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
  // Apply per-trigger logo to client logo slot if present
  if (t.logoDataUrl) {
    overlayState.clientLogo.dataUrl = t.logoDataUrl
    overlayState.clientLogo.visible = true
  }
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
}

export function hideLowerThird(): void {
  overlayState.lowerThird.visible = false
  if (autoHideTimer) {
    clearTimeout(autoHideTimer)
    autoHideTimer = null
  }
  notifyChange()
  logger.info('Lower third hidden')
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
}

export function hideStartingSoon(): void {
  overlayState.startingSoon.visible = false
  notifyChange()
  logger.info('Starting soon hidden')
}

export function updateStartingSoon(updates: Partial<StartingSoonState>): void {
  overlayState.startingSoon = { ...overlayState.startingSoon, ...updates }
  notifyChange()
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

export function startServer(port: number): void {
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
  const layout = styling.layout || { lowerThird: { x: 3.1, y: 85 }, companyLogo: { x: 2.1, y: 2.8 }, clientLogo: { x: 87.9, y: 2.8 }, ticker: { x: 0, y: 96.3, width: 100 } }
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

  .lt-title {
    font-size: var(--font-size, 28px);
    font-weight: var(--font-weight, 600);
    line-height: 1.3;
  }
  .lt-subtitle {
    font-size: calc(var(--font-size, 28px) * 0.7);
    font-weight: 400;
    opacity: 0.85;
    margin-top: 4px;
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
      <div class="lt-title" id="lt-title"></div>
      <div class="lt-subtitle" id="lt-subtitle"></div>
    </div>
  </div>

  <div id="starting-soon" class="starting-soon">
    <div class="ss-title" id="ss-title"></div>
    <div class="ss-accent-line" id="ss-accent"></div>
    <div class="ss-subtitle" id="ss-subtitle"></div>
    <div class="ss-countdown" id="ss-countdown"></div>
  </div>

  <script>
    const WS_URL = 'ws://127.0.0.1:9877';
    let ws = null;
    let reconnectTimer = null;
    let typewriterTimer = null;
    let countdownInterval = null;

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

      // Animation timing
      var durVal = s.animationDuration || 0.5;
      var dur = durVal + 's';
      var easingMap = { ease:'ease', 'ease-in':'ease-in', 'ease-out':'ease-out', 'ease-in-out':'ease-in-out', linear:'linear', bounce:'cubic-bezier(0.34,1.56,0.64,1)', elastic:'cubic-bezier(0.68,-0.55,0.27,1.55)' };
      var ease = easingMap[s.animationEasing] || 'ease';
      el.style.setProperty('--anim-dur', dur);
      el.style.setProperty('--anim-ease', ease);

      // Background style
      card.className = 'lt-card bg-' + s.backgroundStyle;

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
    }

    connect();
  </script>
</body>
</html>`
}
