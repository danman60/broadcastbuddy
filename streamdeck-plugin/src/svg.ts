function wrap(inner: string, bg = '#1e1e2e'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144">
    <rect width="144" height="144" rx="12" fill="${bg}"/>
    ${inner}
  </svg>`
}

export function offline(): string {
  return wrap(
    `<text x="72" y="82" text-anchor="middle" fill="#555" font-size="16" font-family="sans-serif">OFFLINE</text>`,
    '#111',
  )
}

export function fire(isLive: boolean): string {
  if (isLive) {
    return wrap(`
      <text x="72" y="60" text-anchor="middle" fill="#22c55e" font-size="12" font-family="sans-serif">OVERLAY</text>
      <text x="72" y="92" text-anchor="middle" fill="#22c55e" font-size="28" font-weight="bold" font-family="sans-serif">LIVE</text>
    `, '#1a2a1a')
  }
  return wrap(`
    <text x="72" y="82" text-anchor="middle" fill="#22c55e" font-size="24" font-weight="bold" font-family="sans-serif">FIRE</text>
  `)
}

export function hide(): string {
  return wrap(`
    <text x="72" y="82" text-anchor="middle" fill="#ef4444" font-size="24" font-weight="bold" font-family="sans-serif">HIDE</text>
  `)
}

export function toggleLT(isLive: boolean): string {
  const color = isLive ? '#22c55e' : '#666'
  const bg = isLive ? '#1a2a1a' : '#1e1e2e'
  return wrap(`
    <circle cx="72" cy="54" r="8" fill="${color}"/>
    <text x="72" y="100" text-anchor="middle" fill="${color}" font-size="16" font-weight="${isLive ? 'bold' : 'normal'}" font-family="sans-serif">LT</text>
  `, bg)
}

export function next(current: number, total: number): string {
  if (total === 0) {
    return wrap(`
      <text x="72" y="82" text-anchor="middle" fill="#666" font-size="18" font-family="sans-serif">Next</text>
    `)
  }
  return wrap(`
    <text x="72" y="50" text-anchor="middle" fill="#9090b0" font-size="12" font-family="sans-serif">NEXT</text>
    <text x="72" y="88" text-anchor="middle" fill="#e0e0f0" font-size="32" font-weight="bold" font-family="sans-serif">${current}/${total}</text>
  `)
}

export function prev(current: number, total: number): string {
  if (total === 0) {
    return wrap(`
      <text x="72" y="82" text-anchor="middle" fill="#666" font-size="18" font-family="sans-serif">Prev</text>
    `)
  }
  return wrap(`
    <text x="72" y="50" text-anchor="middle" fill="#9090b0" font-size="12" font-family="sans-serif">PREV</text>
    <text x="72" y="88" text-anchor="middle" fill="#c0c0d0" font-size="28" font-family="sans-serif">${current}/${total}</text>
  `)
}

export function nextFull(current: number, total: number, connected: boolean): string {
  if (!connected) return offline()
  if (total === 0) {
    return wrap(`
      <text x="72" y="82" text-anchor="middle" fill="#667eea" font-size="16" font-family="sans-serif">Next+Fire</text>
    `)
  }
  return wrap(`
    <text x="72" y="50" text-anchor="middle" fill="#667eea" font-size="14" font-family="sans-serif">NEXT+FIRE</text>
    <text x="72" y="88" text-anchor="middle" fill="#e0e0f0" font-size="32" font-weight="bold" font-family="sans-serif">${current}/${total}</text>
    <text x="72" y="116" text-anchor="middle" fill="#667eea" font-size="12" font-family="sans-serif">\u25B6 GO</text>
  `, '#1a1a2e')
}

export function ticker(active: boolean): string {
  const color = active ? '#f59e0b' : '#666'
  const bg = active ? '#2a2a1a' : '#1e1e2e'
  return wrap(`
    <text x="72" y="54" text-anchor="middle" fill="${color}" font-size="28" font-family="sans-serif">\u23E9</text>
    <text x="72" y="100" text-anchor="middle" fill="${color}" font-size="14" font-weight="${active ? 'bold' : 'normal'}" font-family="sans-serif">TICKER</text>
  `, bg)
}

export function upNext(connected: boolean): string {
  if (!connected) return offline()
  return wrap(`
    <text x="72" y="58" text-anchor="middle" fill="#667eea" font-size="13" font-family="sans-serif">UP</text>
    <text x="72" y="96" text-anchor="middle" fill="#e0e0f0" font-size="26" font-weight="bold" font-family="sans-serif">NEXT</text>
  `, '#1a1a2e')
}

export function thatWas(connected: boolean): string {
  if (!connected) return offline()
  return wrap(`
    <text x="72" y="58" text-anchor="middle" fill="#9090b0" font-size="13" font-family="sans-serif">THAT</text>
    <text x="72" y="96" text-anchor="middle" fill="#c0c0d0" font-size="26" font-weight="bold" font-family="sans-serif">WAS</text>
  `)
}

export function grid(active: boolean): string {
  const color = active ? '#22c55e' : '#666'
  const bg = active ? '#1a2a1a' : '#1e1e2e'
  // Simple rule-of-thirds glyph.
  return wrap(`
    <g stroke="${color}" stroke-width="3" opacity="0.9">
      <line x1="36" y1="40" x2="36" y2="88"/>
      <line x1="72" y1="40" x2="72" y2="88"/>
      <line x1="108" y1="40" x2="108" y2="88"/>
      <line x1="20" y1="56" x2="124" y2="56"/>
      <line x1="20" y1="72" x2="124" y2="72"/>
    </g>
    <text x="72" y="116" text-anchor="middle" fill="${color}" font-size="13" font-weight="${active ? 'bold' : 'normal'}" font-family="sans-serif">GRID</text>
  `, bg)
}

export function slowZoom(label: string, connected: boolean): string {
  if (!connected) return offline()
  return wrap(`
    <text x="72" y="52" text-anchor="middle" fill="#667eea" font-size="26" font-family="sans-serif">\uD83D\uDD0D</text>
    <text x="72" y="84" text-anchor="middle" fill="#e0e0f0" font-size="14" font-weight="bold" font-family="sans-serif">ZOOM</text>
    <text x="72" y="108" text-anchor="middle" fill="#9090b0" font-size="12" font-family="sans-serif">${label}</text>
  `, '#1a1a2e')
}

// \u2500\u2500 OBS control + overlay toggles (CompSync-parity) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

export function record(active: boolean): string {
  if (active) {
    return wrap(`
      <circle cx="72" cy="56" r="26" fill="#ef4444">
        <animate attributeName="opacity" values="1;0.45;1" dur="1.4s" repeatCount="indefinite"/>
      </circle>
      <text x="72" y="118" text-anchor="middle" fill="#ffffff" font-size="22" font-weight="900" font-family="sans-serif" letter-spacing="3">REC</text>
    `, '#2a1010')
  }
  return wrap(`
    <circle cx="72" cy="58" r="32" fill="none" stroke="#888" stroke-width="4"/>
    <circle cx="72" cy="58" r="20" fill="#888"/>
    <text x="72" y="124" text-anchor="middle" fill="#ffffff" font-size="22" font-weight="900" font-family="sans-serif" letter-spacing="3">REC</text>
  `)
}

export function stream(active: boolean): string {
  if (active) {
    return wrap(`
      <text x="72" y="84" text-anchor="middle" fill="#ef4444" font-size="48" font-weight="900" font-family="sans-serif" letter-spacing="2">LIVE</text>
      <circle cx="72" cy="118" r="8" fill="#ef4444">
        <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite"/>
      </circle>
    `, '#2a1010')
  }
  return wrap(`
    <text x="72" y="92" text-anchor="middle" fill="#666" font-size="42" font-weight="900" font-family="sans-serif" letter-spacing="2">OFF</text>
  `)
}

export function replay(flash: boolean): string {
  const color = flash ? '#22c55e' : '#888'
  const bg = flash ? '#0d1f0d' : '#1e1e2e'
  return wrap(`
    <text x="72" y="86" text-anchor="middle" fill="${color}" font-size="68" font-family="sans-serif">\u27F2</text>
    <text x="72" y="124" text-anchor="middle" fill="${color}" font-size="20" font-weight="800" font-family="sans-serif" letter-spacing="3">REPLAY</text>
  `, bg)
}

export function overlayToggle(label: string, active: boolean): string {
  const color = active ? '#22c55e' : '#666'
  const bg = active ? '#0d1f0d' : '#1e1e2e'
  return wrap(`
    <circle cx="72" cy="50" r="22" fill="${color}"/>
    <text x="72" y="116" text-anchor="middle" fill="${active ? '#ffffff' : color}" font-size="30" font-weight="900" font-family="sans-serif" letter-spacing="2">${label}</text>
  `, bg)
}

export function featureCard(mode: 'upNext' | 'thatWas', active: boolean): string {
  const accent = active ? '#fbbf24' : '#a5b4fc'
  const bg = active ? '#1f1a0a' : '#0f1024'
  const top = mode === 'upNext' ? 'UP NEXT' : 'THAT WAS'
  return wrap(`
    <rect x="22" y="34" width="100" height="78" rx="6" fill="none" stroke="${accent}" stroke-width="4"/>
    <rect x="22" y="34" width="100" height="6" fill="${accent}"/>
    <text x="72" y="22" text-anchor="middle" fill="${accent}" font-size="14" font-weight="800" font-family="sans-serif" letter-spacing="3">${top}</text>
    <line x1="36" y1="60" x2="108" y2="60" stroke="${accent}" stroke-width="2" opacity="0.6"/>
    <line x1="36" y1="74" x2="108" y2="74" stroke="${accent}" stroke-width="2" opacity="0.4"/>
    <line x1="36" y1="88" x2="86" y2="88" stroke="${accent}" stroke-width="2" opacity="0.3"/>
    <text x="72" y="138" text-anchor="middle" fill="#888" font-size="13" font-weight="600" font-family="sans-serif" letter-spacing="2">${active ? 'LIVE' : 'FIRE'}</text>
  `, bg)
}
