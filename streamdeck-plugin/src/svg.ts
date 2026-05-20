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
