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
