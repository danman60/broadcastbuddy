import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { createLogger } from '../logger'

const logger = createLogger('r2-upload')

// ── Types ──────────────────────────────────────────────────────

export interface R2Config {
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

export interface UploadItem {
  localPath: string
  r2Key: string
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

export async function uploadFile(
  client: S3Client,
  bucket: string,
  key: string,
  filePath: string,
): Promise<void> {
  const stream = fs.createReadStream(filePath)
  const stat = fs.statSync(filePath)

  const ext = path.extname(filePath).toLowerCase()
  const contentType =
    ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : ext === '.png'
        ? 'image/png'
        : ext === '.heic'
          ? 'image/heic'
          : 'application/octet-stream'

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: stream,
      ContentType: contentType,
      ContentLength: stat.size,
    }),
  )
}

// ── Batch upload with concurrency ──────────────────────────────

function thumbnailKey(r2Key: string): string {
  const dir = path.posix.dirname(r2Key)
  const base = path.posix.basename(r2Key)
  return `${dir}/thumbs/${base}`
}

export async function uploadBatch(
  client: S3Client,
  bucket: string,
  items: UploadItem[],
  concurrency: number = 8,
  onProgress?: (progress: UploadProgress) => void,
  generateThumbnails: boolean = true,
): Promise<UploadResult> {
  logger.info(`Starting batch upload: ${items.length} files, concurrency ${concurrency}, thumbnails: ${generateThumbnails}`)

  const result: UploadResult = {
    completed: 0,
    failed: [],
    items: [],
  }

  let idx = 0

  async function next(): Promise<void> {
    while (idx < items.length) {
      const i = idx++
      const item = items[i]
      let thumbR2Key: string | null = null

      try {
        // Upload original
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
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error(`Failed to upload ${item.localPath}: ${msg}`)
        result.failed.push(item.localPath)
      }

      if (onProgress) {
        onProgress({
          completed: result.completed,
          failed: result.failed.length,
          total: items.length,
          currentFile: path.basename(item.localPath),
        })
      }
    }
  }

  const workers: Promise<void>[] = []
  for (let w = 0; w < Math.min(concurrency, items.length); w++) {
    workers.push(next())
  }
  await Promise.all(workers)

  logger.info(
    `Batch upload complete: ${result.completed} succeeded, ${result.failed.length} failed`,
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
