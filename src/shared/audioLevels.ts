// Audio level conversions for the OBS audio meters. OBS reports post-fader peak
// as a 0..1 magnitude multiplier; the meter renders that as dBFS, a 0..100 bar
// width, and a colour class. Pure functions — extracted from AudioMeters.tsx so
// the conversion thresholds are unit-testable.

// 0 (silence) → -Infinity (treated as the floor by the renderer).
export function mulToDb(mul: number): number {
  if (mul <= 0) return -Infinity
  return 20 * Math.log10(mul)
}

// dBFS → bar width %, with a -60 dBFS floor and 0 dBFS ceiling.
export function dBToPercent(dB: number): number {
  if (dB <= -60) return 0
  if (dB >= 0) return 100
  return ((dB + 60) / 60) * 100
}

// Green = healthy, yellow = approaching clip, red = hot (likely clipping).
export function dBToClass(dB: number): string {
  if (dB <= -60) return 'silent'
  if (dB > -6) return 'hot'
  if (dB > -12) return 'medium'
  return 'good'
}

export function formatDB(dB: number): string {
  if (dB <= -60) return '-inf'
  return `${Math.round(dB)} dB`
}
