import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { TranscriptSegment, RoutineBoundary } from '../../shared/types'
import { createLogger } from '../logger'

const logger = createLogger('transcription')

// ── Helpers: locate binaries ────────────────────────────────────

export function findFfmpeg(): string {
  const cmd = process.platform === 'win32' ? 'where' : 'which'
  try {
    const result = require('child_process').execSync(`${cmd} ffmpeg`, {
      encoding: 'utf-8',
      timeout: 5000,
    })
    const bin = result.trim().split('\n')[0].trim()
    if (bin) return bin
  } catch {
    // not on PATH — fall through to bundled
  }

  const ext = process.platform === 'win32' ? '.exe' : ''
  const bundled = path.join(process.resourcesPath, `ffmpeg${ext}`)
  if (fs.existsSync(bundled)) return bundled

  throw new Error(
    'ffmpeg not found. Install ffmpeg and ensure it is on your PATH, or bundle it in extraResources.',
  )
}

export function findPython(): string {
  const candidates = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python']
  const cmd = process.platform === 'win32' ? 'where' : 'which'

  for (const name of candidates) {
    try {
      const result = require('child_process').execSync(`${cmd} ${name}`, {
        encoding: 'utf-8',
        timeout: 5000,
      })
      const bin = result.trim().split('\n')[0].trim()
      if (bin) return bin
    } catch {
      // try next
    }
  }

  throw new Error(
    'python3 not found. Install Python 3.8+ and ensure it is on your PATH.',
  )
}

// ── Extract audio ───────────────────────────────────────────────

function parseDuration(line: string): number | null {
  const m = line.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d{2})/)
  if (!m) return null
  return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]) + parseInt(m[4]) / 100
}

function parseTime(line: string): number | null {
  const m = line.match(/time=\s*(\d{2}):(\d{2}):(\d{2})\.(\d{2})/)
  if (!m) return null
  return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]) + parseInt(m[4]) / 100
}

export async function extractAudio(
  videoPath: string,
  onProgress?: (message: string) => void,
): Promise<string> {
  const ffmpeg = findFfmpeg()
  const basename = path.basename(videoPath, path.extname(videoPath))
  const outputPath = path.join(app.getPath('temp'), `${basename}_${Date.now()}.wav`)

  onProgress?.(`Extracting audio from ${path.basename(videoPath)}…`)
  logger.info('extractAudio', videoPath, '->', outputPath)

  return new Promise<string>((resolve, reject) => {
    const proc = spawn(ffmpeg, [
      '-i', videoPath,
      '-vn',
      '-acodec', 'pcm_s16le',
      '-ar', '16000',
      '-ac', '1',
      '-y',
      outputPath,
    ])

    let totalDuration: number | null = null
    let stderrBuf = ''

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderrBuf += text

      if (totalDuration === null) {
        totalDuration = parseDuration(text)
        if (totalDuration) {
          onProgress?.(`Audio duration: ${Math.round(totalDuration)}s`)
        }
      }

      const time = parseTime(text)
      if (time !== null && totalDuration) {
        const pct = Math.min(100, Math.round((time / totalDuration) * 100))
        onProgress?.(`Extracting audio: ${pct}%`)
      }
    })

    proc.on('close', (code) => {
      if (code !== 0) {
        // Clean up partial file
        try { fs.unlinkSync(outputPath) } catch { /* ignore */ }
        const msg = `ffmpeg exited with code ${code}: ${stderrBuf.slice(-500)}`
        logger.error(msg)
        reject(new Error(msg))
        return
      }

      if (!fs.existsSync(outputPath)) {
        reject(new Error('ffmpeg completed but output WAV file not found'))
        return
      }

      logger.info('Audio extracted:', outputPath)
      onProgress?.('Audio extraction complete')
      resolve(outputPath)
    })

    proc.on('error', (err) => {
      try { fs.unlinkSync(outputPath) } catch { /* ignore */ }
      reject(err)
    })
  })
}

// ── Transcribe with faster-whisper ──────────────────────────────

export async function transcribe(
  wavPath: string,
  onProgress?: (message: string) => void,
): Promise<TranscriptSegment[]> {
  const python = findPython()

  onProgress?.('Loading Whisper model…')
  logger.info('transcribe', wavPath)

  const script = `
import sys, json
try:
    from faster_whisper import WhisperModel
except ImportError:
    print("ERROR: faster-whisper is not installed. Run: pip install faster-whisper", file=sys.stderr)
    sys.exit(1)

wav_path = sys.argv[1]
print("Loading model…", file=sys.stderr)
model = WhisperModel("small", device="auto")
print("Transcribing…", file=sys.stderr)
segments, info = model.transcribe(wav_path, beam_size=5, language="en")

result = []
for seg in segments:
    result.append({"start": round(seg.start, 3), "end": round(seg.end, 3), "text": seg.text.strip()})
    print(f"[{seg.start:.1f}s - {seg.end:.1f}s] {seg.text.strip()}", file=sys.stderr)

print(json.dumps(result))
`

  return new Promise<TranscriptSegment[]>((resolve, reject) => {
    const proc = spawn(python, ['-c', script, wavPath])

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderr += text
      // Forward progress lines
      for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (trimmed && !trimmed.startsWith('ERROR:')) {
          onProgress?.(trimmed)
        }
      }
    })

    proc.on('close', (code) => {
      if (code !== 0) {
        const msg = `Transcription failed (exit ${code}): ${stderr.slice(-500)}`
        logger.error(msg)
        reject(new Error(msg))
        return
      }

      try {
        const segments: TranscriptSegment[] = JSON.parse(stdout.trim())
        logger.info(`Transcription complete: ${segments.length} segments`)
        onProgress?.(`Transcription complete — ${segments.length} segments`)
        resolve(segments)
      } catch (err) {
        const msg = `Failed to parse transcript JSON: ${(err as Error).message}\nstdout: ${stdout.slice(0, 300)}`
        logger.error(msg)
        reject(new Error(msg))
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn python: ${err.message}`))
    })
  })
}

// ── Fuzzy matching ──────────────────────────────────────────────

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((t) => t.length > 1),
  )
}

function fuzzyMatch(
  spoken: string,
  candidates: string[],
): { name: string; score: number } | null {
  const spokenTokens = tokenize(spoken)
  if (spokenTokens.size === 0) return null

  let best: { name: string; score: number } | null = null

  for (const candidate of candidates) {
    const candTokens = tokenize(candidate)
    if (candTokens.size === 0) continue

    // Jaccard similarity
    let intersection = 0
    for (const t of spokenTokens) {
      if (candTokens.has(t)) intersection++
    }
    const union = new Set([...spokenTokens, ...candTokens]).size
    const score = union > 0 ? intersection / union : 0

    if (score >= 0.3 && (!best || score > best.score)) {
      best = { name: candidate, score }
    }
  }

  return best
}

// ── Parse announcements from transcript ─────────────────────────

const ANNOUNCEMENT_PATTERNS = [
  /(?:welcome\s+to\s+the\s+stage)\s+(.+)/i,
  /(?:performing)\s+(.+)/i,
  /(?:please\s+welcome)\s+(.+)/i,
  /(?:next\s+up\s+is)\s+(.+)/i,
  /(?:next\s+up)\s+(.+)/i,
  /(?:now\s+performing)\s+(.+)/i,
  /(?:here\s+(?:is|are|comes?))\s+(.+)/i,
  /(?:put\s+your\s+hands\s+together\s+for)\s+(.+)/i,
]

export function parseAnnouncements(
  segments: TranscriptSegment[],
  triggerNames: string[],
  videoStartTime: Date,
): RoutineBoundary[] {
  if (triggerNames.length === 0) return []

  // Phase 1: Find explicit announcement matches
  const found: Array<{
    triggerIndex: number
    name: string
    segmentStart: number
    confidence: number
  }> = []
  const matchedTriggers = new Set<number>()

  for (const seg of segments) {
    const text = seg.text.trim()

    for (const pattern of ANNOUNCEMENT_PATTERNS) {
      const m = text.match(pattern)
      if (!m) continue

      const spokenName = m[1].replace(/[.!?,;:]+$/, '').trim()
      const match = fuzzyMatch(spokenName, triggerNames)
      if (!match) continue

      const triggerIdx = triggerNames.indexOf(match.name)
      if (matchedTriggers.has(triggerIdx)) continue // already matched

      matchedTriggers.add(triggerIdx)
      found.push({
        triggerIndex: triggerIdx,
        name: match.name,
        segmentStart: seg.start,
        confidence: match.score,
      })
      break // one match per segment
    }
  }

  // Sort found announcements by their position in the audio
  found.sort((a, b) => a.segmentStart - b.segmentStart)

  // Phase 2: Interpolate positions for unmatched triggers
  // Place unmatched triggers in order between found anchors
  const allBoundaries: Array<{
    triggerIndex: number
    name: string
    startSec: number
    confidence: number
  }> = []

  // Build a timeline: triggers in their original order, with known timestamps for found ones
  const triggerTimeline: Array<{
    triggerIndex: number
    name: string
    startSec: number | null
    confidence: number
  }> = triggerNames.map((name, i) => {
    const match = found.find((f) => f.triggerIndex === i)
    return {
      triggerIndex: i,
      name,
      startSec: match ? match.segmentStart : null,
      confidence: match ? match.confidence : 0,
    }
  })

  // Interpolate missing timestamps
  // Find anchor points (known timestamps) and linearly interpolate between them
  const anchors: Array<{ index: number; sec: number }> = []
  for (let i = 0; i < triggerTimeline.length; i++) {
    if (triggerTimeline[i].startSec !== null) {
      anchors.push({ index: i, sec: triggerTimeline[i].startSec! })
    }
  }

  if (anchors.length === 0) {
    // No announcements found at all — evenly distribute across audio duration
    const totalDuration =
      segments.length > 0 ? segments[segments.length - 1].end : 600
    const interval = totalDuration / triggerNames.length
    for (let i = 0; i < triggerTimeline.length; i++) {
      triggerTimeline[i].startSec = i * interval
      triggerTimeline[i].confidence = 0
    }
  } else {
    // Interpolate before first anchor
    if (anchors[0].index > 0) {
      const gapSec = anchors[0].sec
      const count = anchors[0].index
      const interval = count > 0 ? gapSec / (count + 1) : 0
      for (let i = 0; i < anchors[0].index; i++) {
        triggerTimeline[i].startSec = interval * (i + 1)
        triggerTimeline[i].confidence = 0
      }
    }

    // Interpolate between anchors
    for (let a = 0; a < anchors.length - 1; a++) {
      const fromIdx = anchors[a].index
      const toIdx = anchors[a + 1].index
      const fromSec = anchors[a].sec
      const toSec = anchors[a + 1].sec
      const gaps = toIdx - fromIdx
      if (gaps <= 1) continue
      const interval = (toSec - fromSec) / gaps
      for (let i = fromIdx + 1; i < toIdx; i++) {
        if (triggerTimeline[i].startSec === null) {
          triggerTimeline[i].startSec = fromSec + interval * (i - fromIdx)
          triggerTimeline[i].confidence = 0
        }
      }
    }

    // Interpolate after last anchor
    const lastAnchor = anchors[anchors.length - 1]
    if (lastAnchor.index < triggerTimeline.length - 1) {
      const remaining = triggerTimeline.length - 1 - lastAnchor.index
      // Assume ~3 min per routine for remaining
      const interval = 180
      for (let i = lastAnchor.index + 1; i < triggerTimeline.length; i++) {
        if (triggerTimeline[i].startSec === null) {
          triggerTimeline[i].startSec =
            lastAnchor.sec + interval * (i - lastAnchor.index)
          triggerTimeline[i].confidence = 0
        }
      }
    }
  }

  // Phase 3: Build RoutineBoundary array
  const boundaries: RoutineBoundary[] = []

  for (let i = 0; i < triggerTimeline.length; i++) {
    const entry = triggerTimeline[i]
    const startSec = entry.startSec!
    const endSec =
      i < triggerTimeline.length - 1
        ? triggerTimeline[i + 1].startSec!
        : startSec + 600 // +10 min for last routine

    const startMs = videoStartTime.getTime() + startSec * 1000
    const endMs = videoStartTime.getTime() + endSec * 1000

    boundaries.push({
      index: i,
      name: entry.name,
      timestampStart: new Date(startMs).toISOString(),
      timestampEnd: new Date(endMs).toISOString(),
      videoOffsetStartSec: Math.round(startSec * 100) / 100,
      videoOffsetEndSec: Math.round(endSec * 100) / 100,
      description: entry.confidence > 0 ? 'Matched from audio announcement' : 'Interpolated position',
      confidence: entry.confidence,
    })
  }

  return boundaries
}

// ── Process multiple videos ─────────────────────────────────────

export async function processMultipleVideos(
  videoPaths: string[],
  triggerNames: string[],
  onProgress?: (message: string) => void,
): Promise<{ boundaries: RoutineBoundary[]; segments: TranscriptSegment[] }> {
  const allSegments: TranscriptSegment[] = []
  const allBoundaries: RoutineBoundary[] = []
  let globalSegmentOffset = 0

  for (let v = 0; v < videoPaths.length; v++) {
    const videoPath = videoPaths[v]
    onProgress?.(`Processing video ${v + 1}/${videoPaths.length}: ${path.basename(videoPath)}`)

    // Determine video start time from file metadata
    const stat = fs.statSync(videoPath)
    const videoStartTime = stat.birthtime.getTime() > 0 ? stat.birthtime : stat.mtime

    // Extract audio
    const wavPath = await extractAudio(videoPath, onProgress)

    try {
      // Transcribe
      const segments = await transcribe(wavPath, onProgress)

      // Adjust segment offsets for multi-video accumulation
      const offsetSegments: TranscriptSegment[] = segments.map((s) => ({
        start: s.start + globalSegmentOffset,
        end: s.end + globalSegmentOffset,
        text: s.text,
        confidence: s.confidence,
      }))
      allSegments.push(...offsetSegments)

      // Parse announcements for this video
      const boundaries = parseAnnouncements(segments, triggerNames, videoStartTime)
      allBoundaries.push(...boundaries)

      // Track the total audio duration for offset
      if (segments.length > 0) {
        globalSegmentOffset += segments[segments.length - 1].end
      }
    } finally {
      // Clean up WAV
      try {
        fs.unlinkSync(wavPath)
        logger.info('Cleaned up WAV:', wavPath)
      } catch {
        logger.warn('Failed to clean up WAV:', wavPath)
      }
    }
  }

  // Re-number boundaries sequentially across all videos
  for (let i = 0; i < allBoundaries.length; i++) {
    allBoundaries[i].index = i
  }

  onProgress?.(`Processing complete — ${allBoundaries.length} boundaries, ${allSegments.length} segments`)
  return { boundaries: allBoundaries, segments: allSegments }
}
