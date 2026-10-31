// Beat tempo from OBS's ~20/s audio meters (owner 2026-10-31: "When beat detecting countdown should
// be beats synced and not seconds"). Input: level rises (positive frame-to-frame jumps) with their
// times. Autocorrelating the rises gives the beat period; folding the rise times on that period gives
// the phase, so the beat grid is phase + k * period.

export interface Rise { t: number; v: number }
export interface Tempo { periodMs: number; beatAt: number; confidence: number } // beatAt: one beat time on the grid

const BIN_MS = 10
const MIN_PERIOD_MS = 400 // 150 BPM: faster songs lock at half time, which still counts on the beat
const MAX_PERIOD_MS = 1000 // 60 BPM
export const TEMPO_MIN_CONFIDENCE = 1.4
export const TEMPO_WINDOW_MS = 12000
const PLL_GAIN = 0.15 // swept 0–0.6 on two real songs + a click track; 0.15 best
const HIT_PERCENTILE = 0.8 // phase from the loudest 20% of rises (swept 0–0.95)

/** Best beat period + phase over the rises given (≈ the last 8 s), or null if there's too little. */
export function estimateTempo(rises: Rise[]): Tempo | null {
  if (rises.length < 40) return null
  const t0 = rises[0].t
  const n = Math.ceil((rises[rises.length - 1].t - t0) / BIN_MS) + 1
  if (n * BIN_MS < MAX_PERIOD_MS * 4) return null
  const x = new Float64Array(n)
  for (const r of rises) x[Math.round((r.t - t0) / BIN_MS)] += r.v
  // The meters arrive every ~50 ms, so smear each rise over ±20 ms to let near-equal lags overlap.
  const s = new Float64Array(n)
  for (let i = 0; i < n; i++) if (x[i]) for (let d = -2; d <= 2; d++) if (i + d >= 0 && i + d < n) s[i + d] += x[i] * (1 - Math.abs(d) / 3)
  const maxLag = Math.min(n - 1, Math.ceil((MAX_PERIOD_MS * 4) / BIN_MS))
  const ac = new Float64Array(maxLag + 1)
  for (let lag = 0; lag <= maxLag; lag++) {
    let sum = 0
    for (let i = 0; i + lag < n; i++) sum += s[i] * s[i + lag]
    ac[lag] = sum / (n - lag) // per overlapping bin, so long lags aren't penalised for overlapping less
  }
  const at = (ms: number): number => {
    const f = ms / BIN_MS, i = Math.floor(f)
    return i + 1 > maxLag ? 0 : ac[i] + (ac[i + 1] - ac[i]) * (f - i)
  }
  // Comb over 4 beats: half-tempo candidates miss the odd beats and score lower.
  const scores: Array<{ p: number; score: number }> = []
  for (let p = MIN_PERIOD_MS; p <= MAX_PERIOD_MS; p += 2) {
    let score = 0
    for (let k = 1; k <= 4; k++) score += at(k * p)
    scores.push({ p, score })
  }
  const best = scores.reduce((a, b) => (b.score > a.score ? b : a))
  const sorted = scores.map((c) => c.score).sort((a, b) => a - b)
  const median = sorted[sorted.length >> 1]
  if (median <= 0) return null
  // Prefer the faster of two octave-related peaks when it's nearly as strong (counting on 8ths is worse
  // than counting on the beat, but counting half time is worse still).
  let pick = best
  const half = scores.find((c) => Math.abs(c.p - best.p / 2) <= 2)
  if (half && half.score >= best.score * 0.85) pick = half
  // Fine-tune within ±1% (the 2 ms comb step alone drifts the grid ~25 ms every 5 s): the period whose
  // fold lines the rises up tightest. Fold relative to the newest rise so the grid is anchored "now".
  const tRef = rises[rises.length - 1].t
  // Phase from the hits only: small rises are everywhere and pull the fold towards noise.
  const vs = rises.map((r) => r.v).sort((a, b) => a - b)
  const hitFloor = vs[Math.floor(vs.length * HIT_PERCENTILE)]
  const hits = rises.filter((r) => r.v >= hitFloor)
  const fold = (q: number): { c: number; sn: number } => {
    let c = 0, sn = 0
    for (const r of hits) {
      const a = (2 * Math.PI * (r.t - tRef)) / q
      c += r.v * Math.cos(a)
      sn += r.v * Math.sin(a)
    }
    return { c, sn }
  }
  let p = pick.p, f = fold(p), strength = Math.hypot(f.c, f.sn)
  for (let q = pick.p * 0.999; q <= pick.p * 1.001; q += 0.25) {
    const g = fold(q), m = Math.hypot(g.c, g.sn)
    if (m > strength) { p = q; f = g; strength = m }
  }
  const beatAt = tRef + (Math.atan2(f.sn, f.c) / (2 * Math.PI)) * p
  return { periodMs: p, beatAt, confidence: pick.score / median }
}

/** Grid beat nearest to t. */
export function nearestBeat(t: number, tempo: { periodMs: number; beatAt: number }): number {
  return tempo.beatAt + Math.round((t - tempo.beatAt) / tempo.periodMs) * tempo.periodMs
}

/** Smoothed beat grid: each estimate nudges period and phase instead of replacing them, so the count
 *  doesn't jump between windows. Locks after LOCK_AFTER agreeing estimates, unlocks after a run of misses. */
export class BeatTracker {
  tempo: { periodMs: number; beatAt: number } | null = null
  private agree = 0
  private misses = 0
  get locked(): boolean { return this.tempo !== null && this.agree >= 2 }

  update(est: Tempo | null): void {
    if (!est || est.confidence < TEMPO_MIN_CONFIDENCE) {
      if (++this.misses >= 4) { this.tempo = null; this.agree = 0 }
      return
    }
    this.misses = 0
    const cur = this.tempo
    if (!cur || Math.abs(est.periodMs / cur.periodMs - 1) > 0.04) {
      this.tempo = { periodMs: est.periodMs, beatAt: est.beatAt }
      this.agree = 0
      return
    }
    // Phase error of the new estimate against our grid, wrapped to ±half a beat. Move a third of it,
    // and let a steady error correct the period too (a phase-locked loop): the raw estimates carry ~1%
    // period bias, which alone drifts the grid ~100 ms every 15 s.
    let d = est.beatAt - nearestBeat(est.beatAt, cur)
    if (d > cur.periodMs / 2) d -= cur.periodMs
    if (d < -cur.periodMs / 2) d += cur.periodMs
    const periodMs = cur.periodMs * 0.9 + est.periodMs * 0.1 + (PLL_GAIN * d * cur.periodMs) / 1000
    this.tempo = { periodMs, beatAt: nearestBeat(est.beatAt, cur) + d / 3 }
    this.agree++
  }
}

// Self-check (runs once at import, throws on failure): 120 BPM hits with 50 ms meter jitter → 500 ms ±1%.
;(() => {
  const rises: Rise[] = []
  for (let t = 0; t < TEMPO_WINDOW_MS; t += 50) rises.push({ t: t + (t * 7919) % 15, v: t % 500 === 0 ? 0.5 : ((t * 31) % 7) / 100 })
  const e = estimateTempo(rises)
  if (!e || Math.abs(e.periodMs - 500) > 5 || Math.abs(e.beatAt - nearestBeat(e.beatAt, { periodMs: 500, beatAt: 0 })) > 25)
    throw new Error(`tempo self-check failed: ${JSON.stringify(e)}`)
})()
