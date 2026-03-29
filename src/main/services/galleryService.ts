import fs from 'fs'
import path from 'path'
import { dialog, BrowserWindow } from 'electron'
import ExifReader from 'exifreader'
import {
  Trigger,
  RoutineBoundary,
  PhotoMatch,
  GalleryConfig,
  GalleryProgress,
  IPC,
} from '../../shared/types'
import { createLogger } from '../logger'

const logger = createLogger('gallery')

// ── State ───────────────────────────────────────────────────────

let galleryConfig: GalleryConfig = createEmptyConfig()

function createEmptyConfig(): GalleryConfig {
  return {
    eventId: '',
    videoPath: '',
    photoFolderPath: '',
    clockOffsetMs: 0,
    manualOffsetMs: 0,
    routineBoundaries: [],
    photoMatches: [],
    status: 'idle',
  }
}

let progressCallback: ((progress: GalleryProgress) => void) | null = null

export function setProgressCallback(cb: (progress: GalleryProgress) => void): void {
  progressCallback = cb
}

function emitProgress(stage: GalleryConfig['status'], message: string, current: number, total: number): void {
  galleryConfig.status = stage
  if (progressCallback) {
    progressCallback({ stage, message, current, total })
  }
}

export function getConfig(): GalleryConfig {
  return { ...galleryConfig }
}

export function reset(): void {
  galleryConfig = createEmptyConfig()
}

// ── File Browsing ───────────────────────────────────────────────

export async function browseVideo(): Promise<string | null> {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return null
  const result = await dialog.showOpenDialog(win, {
    title: 'Select OBS Recording',
    properties: ['openFile'],
    filters: [{ name: 'Video Files', extensions: ['mp4', 'mkv', 'mov', 'ts', 'webm'] }],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  galleryConfig.videoPath = result.filePaths[0]
  return result.filePaths[0]
}

export async function browsePhotoFolder(): Promise<string | null> {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return null
  const result = await dialog.showOpenDialog(win, {
    title: 'Select Photo Folder (SD Card / DCIM)',
    properties: ['openDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  galleryConfig.photoFolderPath = result.filePaths[0]
  return result.filePaths[0]
}

// ── EXIF Extraction ─────────────────────────────────────────────

async function getPhotoCaptureTime(filePath: string): Promise<Date | null> {
  try {
    const EXIF_HEADER_SIZE = 128 * 1024
    const fh = await fs.promises.open(filePath, 'r')
    const buf = Buffer.alloc(EXIF_HEADER_SIZE)
    const { bytesRead } = await fh.read(buf, 0, EXIF_HEADER_SIZE, 0)
    await fh.close()
    const buffer = buf.subarray(0, bytesRead)
    const tags = ExifReader.load(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
    )
    const dateTime = tags['DateTimeOriginal']?.description
    if (!dateTime) return null

    // EXIF "YYYY:MM:DD HH:MM:SS" → local time (cameras don't store timezone)
    const [datePart, timePart] = dateTime.split(' ')
    if (!datePart || !timePart) return null
    const isoString = datePart.replace(/:/g, '-') + 'T' + timePart
    const d = new Date(isoString)
    return isNaN(d.getTime()) ? null : d
  } catch (err) {
    logger.warn(`EXIF read failed: ${path.basename(filePath)}`, err)
    return null
  }
}

function scanPhotos(dir: string): string[] {
  const results: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      results.push(...scanPhotos(path.join(dir, entry.name)))
    } else if (/\.(jpg|jpeg|png|heic|heif)$/i.test(entry.name)) {
      results.push(path.join(dir, entry.name))
    }
  }
  return results
}

export async function readExifTimestamps(folderPath?: string): Promise<{ path: string; captureTime: Date }[]> {
  const folder = folderPath || galleryConfig.photoFolderPath
  if (!folder) throw new Error('No photo folder selected')

  galleryConfig.photoFolderPath = folder
  const filePaths = scanPhotos(folder)
  logger.info(`Found ${filePaths.length} photo files in ${folder}`)

  emitProgress('reading-exif', `Scanning ${filePaths.length} photos...`, 0, filePaths.length)

  const photos: { path: string; captureTime: Date }[] = []
  for (let i = 0; i < filePaths.length; i++) {
    const captureTime = await getPhotoCaptureTime(filePaths[i])
    if (captureTime) {
      photos.push({ path: filePaths[i], captureTime })
    }
    if (i % 20 === 0) {
      emitProgress('reading-exif', `Reading EXIF: ${i}/${filePaths.length}`, i, filePaths.length)
    }
  }

  logger.info(`${photos.length}/${filePaths.length} photos have EXIF timestamps`)
  emitProgress('reading-exif', `Done: ${photos.length} photos with timestamps`, filePaths.length, filePaths.length)
  return photos
}

// ── Clock Offset Detection ──────────────────────────────────────

function detectClockOffset(
  photos: { path: string; captureTime: Date }[],
  boundaries: RoutineBoundary[],
): number {
  if (photos.length === 0 || boundaries.length === 0) return 0

  // Convert boundaries to time windows
  const windows = boundaries.map((b) => ({
    start: new Date(b.timestampStart).getTime(),
    end: new Date(b.timestampEnd).getTime(),
  })).sort((a, b) => a.start - b.start)

  // Sample up to 10 evenly-spaced photos
  const sampleCount = Math.min(10, photos.length)
  const step = Math.max(1, Math.floor(photos.length / sampleCount))
  const samplePhotos: typeof photos = []
  for (let i = 0; i < photos.length && samplePhotos.length < sampleCount; i += step) {
    samplePhotos.push(photos[i])
  }

  // Generate candidate offsets from sample photos vs window midpoints
  const candidates: number[] = [0]
  for (const photo of samplePhotos) {
    const distances = windows.map((w) => ({
      w,
      dist: Math.abs(photo.captureTime.getTime() - (w.start + w.end) / 2),
    }))
    distances.sort((a, b) => a.dist - b.dist)
    for (const { w } of distances.slice(0, 3)) {
      const mid = (w.start + w.end) / 2
      candidates.push(mid - photo.captureTime.getTime())
    }
  }

  // Score each candidate
  const BUFFER = 30_000
  let bestOffset = 0
  let bestScore = 0
  const tested = new Set<number>()

  for (const candidate of candidates) {
    const rounded = Math.round(candidate / 1000) * 1000
    if (tested.has(rounded)) continue
    tested.add(rounded)

    let score = 0
    for (const photo of photos) {
      const adjusted = photo.captureTime.getTime() + rounded
      for (const w of windows) {
        if (adjusted >= w.start - BUFFER && adjusted <= w.end + BUFFER) {
          score++
          break
        }
      }
    }

    if (score > bestScore) {
      bestScore = score
      bestOffset = rounded
    }
  }

  logger.info(
    `Clock offset detected: ${Math.round(bestOffset / 1000)}s (camera ${bestOffset > 0 ? 'behind' : 'ahead'}) — ${bestScore}/${photos.length} photos matched`,
  )
  return bestOffset
}

// ── Photo-to-Routine Matching ───────────────────────────────────

export function matchPhotos(
  photos: { path: string; captureTime: Date }[],
  boundaries: RoutineBoundary[],
  clockOffsetMs: number,
  manualOffsetMs: number,
): PhotoMatch[] {
  const totalOffset = clockOffsetMs + manualOffsetMs
  const sorted = [...boundaries].sort(
    (a, b) => new Date(a.timestampStart).getTime() - new Date(b.timestampStart).getTime(),
  )
  const BUFFER_MS = 30_000

  const windows = sorted.map((b) => ({
    index: b.index,
    start: new Date(b.timestampStart).getTime(),
    end: new Date(b.timestampEnd).getTime(),
  }))

  return photos.map((photo) => {
    const adjustedTime = photo.captureTime.getTime() + totalOffset

    // Exact match — within routine window
    const exact = windows.find((w) => adjustedTime >= w.start && adjustedTime <= w.end)
    if (exact) {
      return {
        filePath: photo.path,
        captureTime: photo.captureTime.toISOString(),
        confidence: 'exact' as const,
        matchedRoutineIndex: exact.index,
        uploaded: false,
      }
    }

    // Gap match — within 30s buffer
    const gap = windows.find(
      (w) => adjustedTime >= w.start - BUFFER_MS && adjustedTime <= w.end + BUFFER_MS,
    )
    if (gap) {
      return {
        filePath: photo.path,
        captureTime: photo.captureTime.toISOString(),
        confidence: 'gap' as const,
        matchedRoutineIndex: gap.index,
        uploaded: false,
      }
    }

    return {
      filePath: photo.path,
      captureTime: photo.captureTime.toISOString(),
      confidence: 'unmatched' as const,
      uploaded: false,
    }
  })
}

// ── Gemini Video Analysis ───────────────────────────────────────

export async function analyzeVideo(
  videoPath: string,
  triggers: Trigger[],
  geminiApiKey: string,
): Promise<RoutineBoundary[]> {
  galleryConfig.videoPath = videoPath
  emitProgress('analyzing-video', 'Uploading video to Gemini...', 0, 3)

  // Step 1: Upload video file to Gemini Files API
  const videoBuffer = fs.readFileSync(videoPath)
  const ext = path.extname(videoPath).toLowerCase()
  const mimeMap: Record<string, string> = {
    '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime',
    '.ts': 'video/mp2t', '.webm': 'video/webm',
  }
  const mimeType = mimeMap[ext] || 'video/mp4'
  const fileName = path.basename(videoPath)
  const numBytes = videoBuffer.length

  // Initiate resumable upload
  const initRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${geminiApiKey}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(numBytes),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: fileName } }),
    },
  )

  const uploadUrl = initRes.headers.get('x-goog-upload-url')
  if (!uploadUrl) throw new Error('Failed to initiate Gemini file upload')

  emitProgress('analyzing-video', 'Uploading video...', 1, 3)

  // Upload the bytes
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(numBytes),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: videoBuffer,
  })

  const uploadData = (await uploadRes.json()) as { file: { uri: string; name: string; state: string } }
  const fileUri = uploadData.file.uri
  const fileName2 = uploadData.file.name

  logger.info(`Video uploaded to Gemini: ${fileName2}`)

  // Step 2: Wait for processing
  let fileState = uploadData.file.state
  while (fileState === 'PROCESSING') {
    await new Promise((r) => setTimeout(r, 5000))
    const statusRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName2}?key=${geminiApiKey}`,
    )
    const statusData = (await statusRes.json()) as { state: string }
    fileState = statusData.state
    logger.info(`Gemini file state: ${fileState}`)
  }

  if (fileState !== 'ACTIVE') {
    throw new Error(`Gemini file processing failed: ${fileState}`)
  }

  emitProgress('analyzing-video', 'Analyzing video for routine boundaries...', 2, 3)

  // Step 3: Prompt Gemini to detect routine boundaries
  const triggerListText = triggers.length > 0
    ? `\n\nHere are the known routine names in program order:\n${triggers.map((t, i) => `${i + 1}. "${t.name}" — ${t.subtitle || t.title}`).join('\n')}\n\nMatch these names to what you see in the video. Use the exact names provided.`
    : '\n\nNo routine list provided — name each routine based on what you observe (costume, style, group size).'

  const prompt = `You are analyzing a dance recital video recording. The video is a continuous recording of multiple dance routines performed sequentially on stage.

Your task: Identify every routine transition and output precise timestamps for each routine boundary.

Detection cues:
- Costume changes between groups
- Stage clearing / new group entering
- Applause / blackouts between routines
- Solo vs group changes
- Music style changes
- Lighting changes

For each routine, provide:
- index: sequential number starting at 0
- name: routine name (from the list if provided, otherwise descriptive)
- timestampStart: HH:MM:SS from video start when this routine begins (performers start dancing)
- timestampEnd: HH:MM:SS from video start when this routine ends (final pose / exit)
- description: brief description of what you see (costume color, solo/duo/group, style)
- confidence: 0.0-1.0 how confident you are in this boundary detection

Baseline expectation: routines are roughly 2-4 minutes each.${triggerListText}

Return ONLY a valid JSON array. No markdown fences. No explanation.

Example format:
[
  {"index": 0, "name": "Opening Number", "timestampStart": "00:00:45", "timestampEnd": "00:03:30", "description": "Large group in blue costumes, contemporary style", "confidence": 0.9},
  {"index": 1, "name": "Solo Jazz", "timestampStart": "00:04:00", "timestampEnd": "00:06:45", "description": "Single dancer in red, jazz style", "confidence": 0.85}
]`

  const genRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { file_data: { mime_type: mimeType, file_uri: fileUri } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
        },
      }),
    },
  )

  const genData = (await genRes.json()) as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>
  }

  const responseText = genData.candidates?.[0]?.content?.parts?.[0]?.text
  if (!responseText) throw new Error('Empty response from Gemini video analysis')

  logger.info(`Gemini response: ${responseText.length} chars`)

  // Parse JSON
  let jsonStr = responseText.trim()
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }

  const parsed = JSON.parse(jsonStr) as Array<{
    index: number
    name: string
    timestampStart: string
    timestampEnd: string
    description: string
    confidence: number
  }>

  // Get video file creation time as the base for absolute timestamps
  const videoStat = fs.statSync(videoPath)
  // Use mtime as a proxy — OBS creates the file when recording starts
  // For OBS recordings, the file creation time ≈ recording start time
  const videoStartTime = videoStat.birthtime || videoStat.mtime

  // Convert HH:MM:SS offsets to absolute timestamps
  const boundaries: RoutineBoundary[] = parsed.map((r) => {
    const startSec = parseHMS(r.timestampStart)
    const endSec = parseHMS(r.timestampEnd)
    const absStart = new Date(videoStartTime.getTime() + startSec * 1000)
    const absEnd = new Date(videoStartTime.getTime() + endSec * 1000)

    return {
      index: r.index,
      name: r.name,
      timestampStart: absStart.toISOString(),
      timestampEnd: absEnd.toISOString(),
      videoOffsetStartSec: startSec,
      videoOffsetEndSec: endSec,
      description: r.description,
      confidence: r.confidence,
    }
  })

  galleryConfig.routineBoundaries = boundaries
  emitProgress('analyzing-video', `Found ${boundaries.length} routines`, 3, 3)
  logger.info(`Video analysis complete: ${boundaries.length} routine boundaries detected`)

  // Clean up uploaded file
  try {
    await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName2}?key=${geminiApiKey}`,
      { method: 'DELETE' },
    )
  } catch {
    // Non-critical
  }

  return boundaries
}

function parseHMS(hms: string): number {
  const parts = hms.split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0] || 0
}

// ── Full Pipeline ───────────────────────────────────────────────

export async function runFullPipeline(
  videoPath: string,
  photoFolderPath: string,
  triggers: Trigger[],
  geminiApiKey: string,
  manualOffsetMs?: number,
): Promise<GalleryConfig> {
  galleryConfig = createEmptyConfig()
  galleryConfig.videoPath = videoPath
  galleryConfig.photoFolderPath = photoFolderPath
  if (manualOffsetMs !== undefined) galleryConfig.manualOffsetMs = manualOffsetMs

  try {
    // 1. Analyze video with Gemini
    const boundaries = await analyzeVideo(videoPath, triggers, geminiApiKey)
    galleryConfig.routineBoundaries = boundaries

    // 2. Read EXIF from photos
    const photos = await readExifTimestamps(photoFolderPath)

    // 3. Detect clock offset
    emitProgress('matching', 'Detecting clock offset...', 0, 1)
    const autoOffset = detectClockOffset(photos, boundaries)
    galleryConfig.clockOffsetMs = autoOffset

    // 4. Match photos to routines
    emitProgress('matching', 'Matching photos to routines...', 0, photos.length)
    const matches = matchPhotos(photos, boundaries, autoOffset, galleryConfig.manualOffsetMs)
    galleryConfig.photoMatches = matches

    const matched = matches.filter((m) => m.confidence !== 'unmatched').length
    const unmatched = matches.filter((m) => m.confidence === 'unmatched').length

    galleryConfig.status = 'complete'
    emitProgress('complete', `Done: ${matched} matched, ${unmatched} unmatched`, matched, photos.length)

    logger.info(`Pipeline complete: ${matched} matched, ${unmatched} unmatched, offset: ${Math.round((autoOffset + galleryConfig.manualOffsetMs) / 1000)}s`)
    return galleryConfig
  } catch (err) {
    galleryConfig.status = 'error'
    galleryConfig.error = (err as Error).message
    emitProgress('error', (err as Error).message, 0, 0)
    throw err
  }
}

// ── R2 Key Generation ───────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

function generateR2Key(gallerySlug: string, routineIndex: number, routineName: string, fileName: string): string {
  const routineSlug = `${String(routineIndex + 1).padStart(2, '0')}-${slugify(routineName)}`
  return `galleries/${gallerySlug}/${routineSlug}/${fileName}`
}

function generateR2ThumbKey(gallerySlug: string, routineIndex: number, routineName: string, fileName: string): string {
  const routineSlug = `${String(routineIndex + 1).padStart(2, '0')}-${slugify(routineName)}`
  const thumbName = fileName.replace(/(\.[^.]+)$/, '_thumb$1')
  return `galleries/${gallerySlug}/${routineSlug}/thumbs/${thumbName}`
}

// ── CC Gallery Upload ───────────────────────────────────────────

export async function uploadToCC(
  baseUrl: string,
  apiKey: string,
  tenantId: string,
  eventId: string,
  title: string,
): Promise<{ galleryId: string; galleryUrl: string }> {
  const headers = {
    'X-API-Key': apiKey,
    'X-Tenant-Id': tenantId,
    'Content-Type': 'application/json',
  }

  const gallerySlug = slugify(title) + '-' + Date.now().toString(36)

  // 1. Create gallery — BB provides the slug and R2 base path
  emitProgress('uploading', 'Creating gallery...', 0, galleryConfig.photoMatches.length)
  const createRes = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/gallery`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ eventId, title, slug: gallerySlug, r2Prefix: `galleries/${gallerySlug}` }),
  })
  if (!createRes.ok) throw new Error(`Create gallery failed: ${await createRes.text()}`)
  const { galleryId } = (await createRes.json()) as { galleryId: string; slug: string }

  galleryConfig.galleryId = galleryId
  galleryConfig.eventId = eventId

  // 2. Create routines — BB specifies the R2 folder path for each
  const routines = galleryConfig.routineBoundaries.map((b) => {
    const routineSlug = `${String(b.index + 1).padStart(2, '0')}-${slugify(b.name)}`
    return {
      name: b.name,
      title: b.name,
      subtitle: b.description,
      category: '',
      choreographer: '',
      dancers: '',
      sortOrder: b.index,
      timestampStart: b.timestampStart,
      timestampEnd: b.timestampEnd,
      r2Folder: `galleries/${gallerySlug}/${routineSlug}`,
    }
  })

  const routineRes = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/gallery/${galleryId}/routines`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ routines }),
  })
  if (!routineRes.ok) throw new Error(`Create routines failed: ${await routineRes.text()}`)
  const { routines: createdRoutines } = (await routineRes.json()) as {
    routines: Array<{ id: string; name: string; sortOrder: number }>
  }

  // Build index→routineId map
  const routineIdMap = new Map<number, string>()
  for (const r of createdRoutines) {
    routineIdMap.set(r.sortOrder, r.id)
  }

  // 3. Upload photos — BB specifies exact R2 key for each photo
  const matchedPhotos = galleryConfig.photoMatches.filter(
    (m) => m.confidence !== 'unmatched' && m.matchedRoutineIndex !== undefined,
  )

  // Group photos by routine for sequential naming
  const photosByRoutine = new Map<number, PhotoMatch[]>()
  for (const m of matchedPhotos) {
    const list = photosByRoutine.get(m.matchedRoutineIndex!) || []
    list.push(m)
    photosByRoutine.set(m.matchedRoutineIndex!, list)
  }

  let uploaded = 0
  for (const [routineIndex, routinePhotos] of photosByRoutine) {
    const routineId = routineIdMap.get(routineIndex)
    if (!routineId) continue

    const boundary = galleryConfig.routineBoundaries.find((b) => b.index === routineIndex)
    const routineName = boundary?.name || `routine-${routineIndex}`

    for (let i = 0; i < routinePhotos.length; i++) {
      const match = routinePhotos[i]
      const seqName = `photo-${String(i + 1).padStart(4, '0')}.jpg`
      const r2Key = generateR2Key(gallerySlug, routineIndex, routineName, seqName)
      const r2ThumbKey = generateR2ThumbKey(gallerySlug, routineIndex, routineName, seqName)

      try {
        const fileBuffer = fs.readFileSync(match.filePath)
        const originalFilename = path.basename(match.filePath)
        const formData = new FormData()
        formData.append('file', new Blob([fileBuffer], { type: 'image/jpeg' }), originalFilename)
        formData.append('r2Key', r2Key)
        formData.append('r2ThumbKey', r2ThumbKey)
        formData.append('captureTime', match.captureTime)
        formData.append('originalFilename', originalFilename)
        formData.append('sortOrder', String(i))

        const uploadRes = await fetch(
          `${baseUrl.replace(/\/$/, '')}/api/v1/gallery/${galleryId}/routines/${routineId}/photos/upload`,
          {
            method: 'POST',
            headers: { 'X-API-Key': apiKey, 'X-Tenant-Id': tenantId },
            body: formData,
          },
        )
        if (uploadRes.ok) {
          match.uploaded = true
          uploaded++
        }
      } catch (err) {
        logger.warn(`Upload failed for ${match.filePath}:`, err)
      }

      if (uploaded % 5 === 0) {
        emitProgress('uploading', `Uploading: ${uploaded}/${matchedPhotos.length}`, uploaded, matchedPhotos.length)
      }
    }
  }

  // 4. Publish
  const publishRes = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/gallery/${galleryId}/publish`, {
    method: 'POST',
    headers,
  })
  const publishData = publishRes.ok
    ? ((await publishRes.json()) as { url: string })
    : { url: `https://gallery.streamstage.live/${gallerySlug}` }

  galleryConfig.galleryUrl = publishData.url
  emitProgress('complete', `Gallery published: ${publishData.url}`, uploaded, matchedPhotos.length)

  return { galleryId, galleryUrl: publishData.url }
}

// ── Manual Offset ───────────────────────────────────────────────

export function setManualOffset(offsetMs: number): void {
  galleryConfig.manualOffsetMs = offsetMs
}

// ── Re-match with current offset ────────────────────────────────

export async function rematchWithOffset(): Promise<PhotoMatch[]> {
  if (galleryConfig.routineBoundaries.length === 0) {
    throw new Error('No routine boundaries — run video analysis first')
  }

  const photos = await readExifTimestamps()
  const matches = matchPhotos(
    photos,
    galleryConfig.routineBoundaries,
    galleryConfig.clockOffsetMs,
    galleryConfig.manualOffsetMs,
  )
  galleryConfig.photoMatches = matches
  return matches
}
