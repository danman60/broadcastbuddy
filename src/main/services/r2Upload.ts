import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3'
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { createLogger } from '../logger'
import { ensureFaststart, isFaststartCandidate } from './ffmpegFaststart'
import {
  loadManifest,
  saveManifest,
  indexByPath,
  markUploadedInPlace,
} from './importManifest'

const logger = createLogger('r2-upload')

// ── Types ──────────────────────────────────────────────────────

export interface R2Config {
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  useChildProcessUpload?: boolean
}

export interface UploadItem {
  localPath: string
  r2Key: string
  /**
   * Priority tier for the round-robin scheduler. 'priority' items are
   * pulled before 'normal' items so the operator sees the first batch
   * of photos / thumbnails land in R2 quickly, while videos finish in
   * the background. Default = 'normal'.
   *
   * Ported (lightweight) from CompSync's photoTier system. Their version
   * does global per-routine round-robin; ours just splits the queue.
   */
  priority?: 'priority' | 'normal'
}

export interface UploadProgress {
  completed: number
  failed: number
  total: number
  currentFile: string
}

export interface UploadResultItem {
  localPath: string
  r2Key: string
  thumbnailR2Key: string | null
}

export interface UploadResult {
  completed: number
  failed: string[]
  items: UploadResultItem[]
}

// ── Supported extensions ───────────────────────────────────────

const PHOTO_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.heic'])

// ── Client ─────────────────────────────────────────────────────

export function createR2Client(config: R2Config): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

// ── Single file upload ─────────────────────────────────────────

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.heic':
      return 'image/heic'
    case '.mp4':
    case '.m4v':
      return 'video/mp4'
    case '.mov':
      return 'video/quicktime'
    case '.webm':
      return 'video/webm'
    default:
      return 'application/octet-stream'
  }
}

// S3/R2 single-PUT caps at 5GB; recital videos run 10-15GB (CC inbox request).
// Engage multipart above 100MB — also more resilient for medium videos.
const MULTIPART_THRESHOLD = 100 * 1024 * 1024
const MULTIPART_PART_SIZE = 100 * 1024 * 1024 // 100MB parts → 15GB = 150 parts (well under the 10000 limit)

// NOTE: builds + type-checks, but NOT runtime-verified against live R2 (no >5GB
// upload exercised). Validate with a real large-file upload before relying on it.
async function uploadFileMultipart(
  client: S3Client,
  bucket: string,
  key: string,
  filePath: string,
  contentType: string,
): Promise<void> {
  const created = await client.send(
    new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
  )
  const uploadId = created.UploadId
  if (!uploadId) throw new Error('R2 CreateMultipartUpload returned no UploadId')

  const parts: { ETag: string; PartNumber: number }[] = []
  const fd = fs.openSync(filePath, 'r')
  try {
    const total = fs.statSync(filePath).size
    if (total === 0) throw new Error('Cannot multipart-upload a 0-byte file')
    let offset = 0
    let partNumber = 1
    while (offset < total) {
      const len = Math.min(MULTIPART_PART_SIZE, total - offset)
      // Fresh buffer per part — never reuse across iterations, so there's no
      // chance the SDK reads a half-overwritten body.
      const chunk = Buffer.allocUnsafe(len)
      const bytesRead = fs.readSync(fd, chunk, 0, len, offset)
      if (bytesRead <= 0) break
      const body = bytesRead === len ? chunk : chunk.subarray(0, bytesRead)
      const res = await client.send(
        new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: body,
          ContentLength: bytesRead,
        }),
      )
      if (!res.ETag) throw new Error(`R2 UploadPart ${partNumber} returned no ETag`)
      parts.push({ ETag: res.ETag, PartNumber: partNumber })
      offset += bytesRead
      partNumber++
    }
  } catch (err) {
    // Abort so R2 doesn't retain orphaned parts (billable).
    try {
      await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }))
    } catch { /* best-effort */ }
    fs.closeSync(fd)
    throw err
  }
  fs.closeSync(fd)

  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    }),
  )
  logger.info(`Multipart upload complete: ${key} (${parts.length} parts)`)
}

export async function uploadFile(
  client: S3Client,
  bucket: string,
  key: string,
  filePath: string,
): Promise<void> {
  // Faststart pass for video uploads — moves the moov atom to the front so
  // browsers can begin playback before the file fully downloads (ported
  // hardening from CompSync 9ef584a). Best-effort: returns the original
  // path on any failure or when ffmpeg is unavailable.
  let uploadPath = filePath
  let isTempFaststart = false
  if (isFaststartCandidate(filePath)) {
    const fixed = await ensureFaststart(filePath)
    if (fixed !== filePath) {
      uploadPath = fixed
      isTempFaststart = true
    }
  }

  try {
    const stat = fs.statSync(uploadPath)
    if (stat.size > MULTIPART_THRESHOLD) {
      // Large files (esp. >5GB recital videos) must use multipart — a single
      // PutObject would be rejected by R2.
      await uploadFileMultipart(client, bucket, key, uploadPath, contentTypeFor(filePath))
    } else {
      const stream = fs.createReadStream(uploadPath)
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: stream,
          ContentType: contentTypeFor(filePath),
          ContentLength: stat.size,
        }),
      )
    }
  } finally {
    if (isTempFaststart) {
      try { fs.unlinkSync(uploadPath) } catch { /* best-effort */ }
    }
  }
}

// ── Batch upload with concurrency ──────────────────────────────

function thumbnailKey(r2Key: string): string {
  const dir = path.posix.dirname(r2Key)
  const base = path.posix.basename(r2Key)
  return `${dir}/thumbs/${base}`
}

export interface UploadBatchOptions {
  /** Skip files marked uploaded in the per-folder import manifest. */
  useImportManifest?: boolean
  /** Manifest folder root — required when useImportManifest=true. */
  manifestFolder?: string
}

export async function uploadBatch(
  client: S3Client,
  bucket: string,
  items: UploadItem[],
  concurrency: number = 8,
  onProgress?: (progress: UploadProgress) => void,
  generateThumbnails: boolean = true,
  options: UploadBatchOptions = {},
): Promise<UploadResult> {
  // Manifest dedup gate (ported pattern). When enabled, drop items whose
  // sourcePath was successfully uploaded in a prior run. Falls back silently
  // when the manifest is absent or unreadable.
  let workItems = items
  let manifest: Awaited<ReturnType<typeof loadManifest>> | null = null
  let manifestMutated = false
  let dedupSkipped = 0
  if (options.useImportManifest && options.manifestFolder) {
    try {
      manifest = await loadManifest(options.manifestFolder)
      const byPath = indexByPath(manifest)
      workItems = items.filter((item) => {
        const entry = byPath.get(path.resolve(item.localPath))
        if (entry?.uploaded) {
          dedupSkipped++
          return false
        }
        return true
      })
      if (dedupSkipped > 0) {
        logger.info(`Manifest dedup: skipping ${dedupSkipped} already-uploaded files`)
      }
    } catch (err) {
      logger.warn(`Manifest load failed; uploading everything: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Priority partition (lightweight CompSync photo-tier port). Priority
  // items are scheduled FIRST in their own pass, then normal items run.
  // Within each tier, we keep the round-robin concurrency model so per-tier
  // throughput is fair across however the caller built the queue.
  const priorityItems = workItems.filter((i) => i.priority === 'priority')
  const normalItems = workItems.filter((i) => i.priority !== 'priority')

  logger.info(
    `Starting batch upload: ${workItems.length} files (priority=${priorityItems.length}, normal=${normalItems.length}), ` +
      `concurrency ${concurrency}, thumbnails: ${generateThumbnails}`,
  )

  const result: UploadResult = {
    completed: 0,
    failed: [],
    items: [],
  }

  async function runTier(tier: UploadItem[]): Promise<void> {
    if (tier.length === 0) return
    let idx = 0
    async function next(): Promise<void> {
      while (idx < tier.length) {
        const i = idx++
        const item = tier[i]
        let thumbR2Key: string | null = null

        try {
          // Upload original (faststart applied internally for video exts).
          await uploadFile(client, bucket, item.r2Key, item.localPath)

          // Generate and upload thumbnail
          if (generateThumbnails) {
            try {
              const thumbBuf = await generateThumbnail(item.localPath)
              thumbR2Key = thumbnailKey(item.r2Key)
              await client.send(
                new PutObjectCommand({
                  Bucket: bucket,
                  Key: thumbR2Key,
                  Body: thumbBuf,
                  ContentType: 'image/jpeg',
                  ContentLength: thumbBuf.length,
                }),
              )
            } catch (thumbErr) {
              // Thumbnail failure is non-fatal — original still uploaded
              logger.warn(`Thumbnail failed for ${path.basename(item.localPath)}: ${thumbErr instanceof Error ? thumbErr.message : String(thumbErr)}`)
              thumbR2Key = null
            }
          }

          result.completed++
          result.items.push({ localPath: item.localPath, r2Key: item.r2Key, thumbnailR2Key: thumbR2Key })

          // Mark uploaded in manifest (in-place; batched save after the run).
          if (manifest) {
            const byPath = indexByPath(manifest)
            const entry = byPath.get(path.resolve(item.localPath))
            if (entry && markUploadedInPlace(manifest, entry.sourceHash, item.r2Key)) {
              manifestMutated = true
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          logger.error(`Failed to upload ${item.localPath}: ${msg}`)
          result.failed.push(item.localPath)
        }

        if (onProgress) {
          onProgress({
            completed: result.completed,
            failed: result.failed.length,
            total: workItems.length,
            currentFile: path.basename(item.localPath),
          })
        }
      }
    }

    const workers: Promise<void>[] = []
    for (let w = 0; w < Math.min(concurrency, tier.length); w++) {
      workers.push(next())
    }
    await Promise.all(workers)
  }

  // Priority tier first — operator sees first photos hit R2 before videos
  // even start uploading. Then the remainder.
  await runTier(priorityItems)
  await runTier(normalItems)

  if (manifest && manifestMutated) {
    await saveManifest(manifest)
  }

  logger.info(
    `Batch upload complete: ${result.completed} succeeded, ${result.failed.length} failed` +
      (dedupSkipped > 0 ? `, ${dedupSkipped} dedup-skipped` : ''),
  )
  return result
}

// ── List objects ───────────────────────────────────────────────

export async function listObjects(
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const keys: string[] = []
  let continuationToken: string | undefined

  do {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    )

    if (resp.Contents) {
      for (const obj of resp.Contents) {
        if (obj.Key) keys.push(obj.Key)
      }
    }

    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined
  } while (continuationToken)

  return keys
}

// ── Head object (existence check) ──────────────────────────────

export async function headObject(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<boolean> {
  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    )
    return true
  } catch {
    return false
  }
}

// ── Thumbnail generation ───────────────────────────────────────

export async function generateThumbnail(inputPath: string): Promise<Buffer> {
  const buffer = await sharp(inputPath).resize({ width: 400 }).jpeg({ quality: 80 }).toBuffer()
  return buffer
}

// ── Build upload items from folder ─────────────────────────────

export function buildUploadItems(folderPath: string, gallerySlug: string): UploadItem[] {
  const items: UploadItem[] = []

  function scan(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        scan(fullPath)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (!PHOTO_EXTENSIONS.has(ext)) continue

        // Preserve subfolder structure relative to the root folder
        const relativePath = path.relative(folderPath, fullPath)
        // Normalize path separators to forward slashes for R2 keys
        const normalizedRelative = relativePath.split(path.sep).join('/')
        const r2Key = `galleries/${gallerySlug}/unsorted/${normalizedRelative}`

        items.push({ localPath: fullPath, r2Key })
      }
    }
  }

  scan(folderPath)
  logger.info(`Built ${items.length} upload items from ${folderPath}`)
  return items
}
