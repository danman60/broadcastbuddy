/**
 * MP4 faststart helper — moves the `moov` atom to the front of the file so
 * the video plays progressively in browsers (especially Firefox) without
 * needing to fetch the entire byte-range first.
 *
 * Ported pattern from CompSyncElectronApp 9ef584a:
 *   "Encoded mp4s were writing the moov atom at end-of-file (~99.8% offset).
 *    On any non-perfect connection the audio buffer underruns at start of
 *    playback = 'buzz/stutter at start, lessens once it catches up'."
 *
 * Strategy: stream-copy through ffmpeg with `-c copy -movflags +faststart`.
 * No re-encode, no quality loss; ~1-3s per GB of input.
 *
 * The helper is best-effort. If ffmpeg is unavailable or the pass fails, we
 * return the original path so the upload still proceeds.
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { findFfmpeg } from './audioTranscription'
import { createLogger } from '../logger'

const logger = createLogger('faststart')

const FASTSTART_EXTS = new Set(['.mp4', '.m4v', '.mov'])

export function isFaststartCandidate(filePath: string): boolean {
  return FASTSTART_EXTS.has(path.extname(filePath).toLowerCase())
}

/**
 * Probe the first 128KB for the `moov` atom marker. If absent, the moov is
 * likely at the end of the file and a faststart pass is worthwhile. Returns
 * `true` when we found moov early (no rewrite needed).
 */
export async function moovAtFront(filePath: string): Promise<boolean> {
  try {
    const HEADER = 128 * 1024
    const fh = await fs.promises.open(filePath, 'r')
    try {
      const buf = Buffer.alloc(HEADER)
      const { bytesRead } = await fh.read(buf, 0, HEADER, 0)
      return buf.subarray(0, bytesRead).includes(Buffer.from('moov'))
    } finally {
      await fh.close()
    }
  } catch (err) {
    logger.warn(`moovAtFront probe failed for ${path.basename(filePath)}: ${err instanceof Error ? err.message : String(err)}`)
    // Probe failure: assume we should try to fix it. The fix is lossless.
    return false
  }
}

/**
 * Run `ffmpeg -i in -c copy -movflags +faststart out.mp4`. Returns the path
 * to the rewritten file (in app temp dir) on success, or the original path
 * unchanged on any failure / when ffmpeg is unavailable.
 */
export async function ensureFaststart(inputPath: string): Promise<string> {
  if (!isFaststartCandidate(inputPath)) return inputPath

  // Skip if moov is already up-front.
  if (await moovAtFront(inputPath)) {
    logger.debug(`moov already at front: ${path.basename(inputPath)}`)
    return inputPath
  }

  let ffmpeg: string
  try {
    ffmpeg = findFfmpeg()
  } catch {
    logger.warn(`ffmpeg not found — skipping faststart for ${path.basename(inputPath)}`)
    return inputPath
  }

  const basename = path.basename(inputPath, path.extname(inputPath))
  const outputPath = path.join(
    app.getPath('temp'),
    `${basename}_faststart_${Date.now()}${path.extname(inputPath)}`,
  )

  return new Promise<string>((resolve) => {
    const proc = spawn(ffmpeg, [
      '-i', inputPath,
      '-c', 'copy',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ])

    let stderrBuf = ''
    proc.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString()
    })

    proc.on('error', (err) => {
      logger.warn(`ffmpeg faststart spawn failed: ${err.message} — using original`)
      resolve(inputPath)
    })

    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        logger.info(`faststart pass complete: ${path.basename(inputPath)} -> ${path.basename(outputPath)}`)
        resolve(outputPath)
      } else {
        logger.warn(`ffmpeg faststart exited ${code}: ${stderrBuf.slice(-300)} — using original`)
        try { fs.unlinkSync(outputPath) } catch { /* ignore */ }
        resolve(inputPath)
      }
    })
  })
}
