import express from 'express'
import type { Server } from 'http'
import {
  OverlayState,
  OverlayStyling,
  Trigger,
  DEFAULT_OVERLAY_STATE,
  DEFAULT_STYLING,
  AnimationType,
} from '../../shared/types'
import { createLogger } from '../logger'

const logger = createLogger('overlay')

// ── State ────────────────────────────────────────────────────────

let overlayState: OverlayState = JSON.parse(JSON.stringify(DEFAULT_OVERLAY_STATE))
let triggers: Trigger[] = []
let selectedIndex = -1
let autoHideTimer: NodeJS.Timeout | null = null
let onChangeCallback: (() => void) | null = null
let httpServer: Server | null = null

const ANIMATIONS: AnimationType[] = ['slide', 'fade', 'zoom', 'rise']

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

export function nextTrigger(): void {
  if (triggers.length === 0) return
  selectedIndex = Math.min(selectedIndex + 1, triggers.length - 1)
  applyTriggerToOverlay(triggers[selectedIndex])
  notifyChange()
}

export function prevTrigger(): void {
  if (triggers.length === 0) return
  selectedIndex = Math.max(selectedIndex - 1, 0)
  applyTriggerToOverlay(triggers[selectedIndex])
  notifyChange()
}

function applyTriggerToOverlay(t: Trigger): void {
  overlayState.lowerThird.name = t.name
  overlayState.lowerThird.title = t.title
  overlayState.lowerThird.subtitle = t.subtitle
}

// ── Overlay control ──────────────────────────────────────────────

export function fireLowerThird(): void {
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

// ── Reset for new session ────────────────────────────────────────

export function resetState(): void {
  overlayState = JSON.parse(JSON.stringify(DEFAULT_OVERLAY_STATE))
  triggers = []
  selectedIndex = -1
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
): void {
  triggers = sessionTriggers
  selectedIndex = triggers.length > 0 ? 0 : -1
  overlayState.lowerThird.styling = { ...styling }
  overlayState.lowerThird.visible = false
  if (triggers.length > 0) {
    applyTriggerToOverlay(triggers[0])
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

  httpServer = app.listen(port, '127.0.0.1', () => {
    logger.info(`Overlay server listening on http://127.0.0.1:${port}`)
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
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1920px;
    height: 1080px;
    background: transparent;
    overflow: hidden;
    font-family: ${styling.fontFamily};
  }

  /* ── Company logo (top-left) ── */
  .company-logo {
    position: absolute;
    top: 30px;
    left: 40px;
    max-height: 80px;
    max-width: 200px;
    opacity: 0;
    transition: opacity 0.5s ease;
  }
  .company-logo.visible { opacity: 1; }

  /* ── Client logo (top-right) ── */
  .client-logo {
    position: absolute;
    top: 30px;
    right: 40px;
    max-height: 80px;
    max-width: 200px;
    opacity: 0;
    transition: opacity 0.5s ease;
  }
  .client-logo.visible { opacity: 1; }

  /* ── Lower third ── */
  .lower-third {
    position: absolute;
    bottom: 80px;
    left: 60px;
    max-width: 800px;
    opacity: 0;
    transition: opacity 0.5s ease, transform 0.5s ease;
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
  .lower-third.anim-slide { transform: translateX(-100px); }
  .lower-third.anim-slide.visible { transform: translateX(0); }

  .lower-third.anim-fade { transform: none; }

  .lower-third.anim-zoom { transform: scale(0.5); }
  .lower-third.anim-zoom.visible { transform: scale(1); }

  .lower-third.anim-rise { transform: translateY(40px); }
  .lower-third.anim-rise.visible { transform: translateY(0); }
</style>
</head>
<body>
  <img id="company-logo" class="company-logo" src="" alt="">
  <img id="client-logo" class="client-logo" src="" alt="">

  <div id="lt" class="lower-third">
    <div id="lt-card" class="lt-card bg-solid">
      <div class="lt-title" id="lt-title"></div>
      <div class="lt-subtitle" id="lt-subtitle"></div>
    </div>
  </div>

  <script>
    const WS_URL = 'ws://127.0.0.1:${overlayState.lowerThird.styling ? 9877 : 9877}';
    let ws = null;
    let reconnectTimer = null;

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

    function applyState(msg) {
      const lt = msg.overlay.lowerThird;
      const el = document.getElementById('lt');
      const card = document.getElementById('lt-card');
      const s = lt.styling;

      // Update text
      document.getElementById('lt-title').textContent = lt.title || '';
      document.getElementById('lt-subtitle').textContent = lt.subtitle || '';

      // Update CSS custom properties
      card.style.setProperty('--bg-color', s.backgroundColor);
      card.style.setProperty('--text-color', s.textColor);
      card.style.setProperty('--accent-color', s.accentColor);
      card.style.setProperty('--font-family', s.fontFamily);
      card.style.setProperty('--font-size', s.fontSize + 'px');
      card.style.setProperty('--font-weight', s.fontWeight);
      card.style.setProperty('--border-radius', s.borderRadius + 'px');

      // Background style
      card.className = 'lt-card bg-' + s.backgroundStyle;

      // Animation class
      el.className = 'lower-third';
      const anim = s.animation === 'random'
        ? ['slide','fade','zoom','rise'][Math.floor(Math.random()*4)]
        : s.animation;
      el.classList.add('anim-' + anim);

      // Toggle visibility
      if (lt.visible) {
        requestAnimationFrame(() => el.classList.add('visible'));
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
    }

    connect();
  </script>
</body>
</html>`
}
