/**
 * Per-folder import manifest — tracks which photo files were already EXIF-read
 * and (optionally) which were uploaded to R2 / CC. Lets the operator re-mount
 * an SD card after appending new photos and skip the work for the files we
 * already saw.
 *
 * Adapted from CompSyncElectronApp's importManifest pattern (commit 1592670)
 * but simplified for BB's standalone gallery flow:
 *
 *   - CompSync keyed by Windows volume serial + camera body cursor (SD-card
 *     re-mount detection). BB has no DB-side state and no per-card tracking,
 *     so we instead key by (canonical absolute path) + content hash of the
 *     first 128KB. Same file copied to a new path generates a new entry but
 *     the same sourceHash → upload-side dedup still works.
 *
 *   - Manifest lives inside the photo folder itself as `.bb-import-manifest.json`
 *     so it travels with the SD card / project folder. Atomic write via tmp+rename.
 *
 *   - "uploaded=true" flag set by the R2 batch uploader after a successful PUT,
 *     so the second invocation of uploadBatch on the same folder is a no-op for
 *     already-uploaded keys.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { createLogger } from '../logger'

const logger = createLogger('import-manifest')

const MANIFEST_NAME = '.bb-import-manifest.json'

export interface ManifestEntry {
  /** Absolute path at the time of last import (informational only). */
  sourcePath: string
  /** File size in bytes — quick equality check before the hash compare. */
  size: number
  /** File mtime ISO — second quick check. */
  mtime: string
  /** SHA1 of the first 128KB. Stable across copies/moves of the same content. */
  sourceHash: string
  /** EXIF DateTimeOriginal as ISO string, or null if absent. */
  exifIso: string | null
  /** Whether this file was successfully uploaded to R2 in a prior run. */
  uploaded: boolean
  /** R2 key the file was uploaded under (when uploaded=true). */
  r2Key?: string
  /** Timestamp of the manifest write that recorded this entry. */
  importedAt: string
  /** Timestamp of the upload completion. */
  uploadedAt?: string
}

interface Manifest {
  version: 1
  folderPath: string
  entries: ManifestEntry[]
}

function manifestPath(folderPath: string): string {
  return path.join(folderPath, MANIFEST_NAME)
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  const fh = await fs.promises.open(tmp, 'w')
  try {
    await fh.writeFile(content, 'utf-8')
    await fh.sync()
  } finally {
    await fh.close()
  }
  await fs.promises.rename(tmp, filePath)
}

export async function loadManifest(folderPath: string): Promise<Manifest> {
  const p = manifestPath(folderPath)
  try {
    const raw = await fs.promises.readFile(p, 'utf-8')
    const parsed = JSON.parse(raw) as Manifest
    if (!parsed.entries) parsed.entries = []
    if (parsed.version !== 1) {
      logger.warn(`Manifest version mismatch (${parsed.version}) at ${p} — treating as empty`)
      return { version: 1, folderPath, entries: [] }
    }
    return parsed
  } catch {
    return { version: 1, folderPath, entries: [] }
  }
}

export async function saveManifest(manifest: Manifest): Promise<void> {
  try {
    await writeAtomic(manifestPath(manifest.folderPath), JSON.stringify(manifest, null, 2))
  } catch (err) {
    // Manifest write is best-effort. Failing the import on a manifest write
    // failure would be worse than losing dedup for one run.
    logger.warn(`Manifest save failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * SHA1 of the first 128KB of a file. Same hash as the EXIF header read so
 * we can reuse the buffer in the EXIF path if we want.
 */
export async function computeSourceHash(filePath: string): Promise<string> {
  const HEADER = 128 * 1024
  const fh = await fs.promises.open(filePath, 'r')
  try {
    const buf = Buffer.alloc(HEADER)
    const { bytesRead } = await fh.read(buf, 0, HEADER, 0)
    const hash = crypto.createHash('sha1')
    hash.update(buf.subarray(0, bytesRead))
    return hash.digest('hex')
  } finally {
    await fh.close()
  }
}

/**
 * Build a `(sourcePath → entry)` map for quick lookup by canonical absolute path.
 * Path keys are normalized via `path.resolve` so callers don't have to.
 */
export function indexByPath(manifest: Manifest): Map<string, ManifestEntry> {
  const map = new Map<string, ManifestEntry>()
  for (const e of manifest.entries) {
    map.set(path.resolve(e.sourcePath), e)
  }
  return map
}

/**
 * Build a `(sourceHash → entry)` map for upload-side dedup.
 */
export function indexByHash(manifest: Manifest): Map<string, ManifestEntry> {
  const map = new Map<string, ManifestEntry>()
  for (const e of manifest.entries) {
    map.set(e.sourceHash, e)
  }
  return map
}

/**
 * Decide whether the on-disk file matches a prior manifest entry. We compare
 * size + mtime FIRST (zero I/O beyond stat), and only fall back to the
 * 128KB hash if the quick checks pass. The hash is computed lazily by the
 * caller — they're already reading the EXIF header anyway.
 */
export function quickMatch(
  entry: ManifestEntry,
  stat: { size: number; mtime: Date },
): boolean {
  return entry.size === stat.size && entry.mtime === stat.mtime.toISOString()
}

/**
 * Mark a single entry as uploaded. Caller is responsible for calling
 * `saveManifest` once after a batch of marks (cheaper than writing per file).
 */
export function markUploadedInPlace(
  manifest: Manifest,
  sourceHash: string,
  r2Key: string,
): boolean {
  let mutated = false
  const uploadedAt = new Date().toISOString()
  for (const entry of manifest.entries) {
    if (entry.sourceHash === sourceHash && !entry.uploaded) {
      entry.uploaded = true
      entry.r2Key = r2Key
      entry.uploadedAt = uploadedAt
      mutated = true
    }
  }
  return mutated
}

/**
 * Upsert an entry by (sourceHash + sourcePath). Used during the EXIF scan to
 * record new files as they're discovered. Does NOT save — caller batches.
 */
export function upsertEntry(manifest: Manifest, entry: ManifestEntry): void {
  const idx = manifest.entries.findIndex(
    (e) => e.sourceHash === entry.sourceHash && path.resolve(e.sourcePath) === path.resolve(entry.sourcePath),
  )
  if (idx >= 0) {
    manifest.entries[idx] = { ...manifest.entries[idx], ...entry }
  } else {
    manifest.entries.push(entry)
  }
}

export function manifestSummary(manifest: Manifest): {
  total: number
  uploaded: number
  pending: number
} {
  const total = manifest.entries.length
  const uploaded = manifest.entries.filter((e) => e.uploaded).length
  return { total, uploaded, pending: total - uploaded }
}
