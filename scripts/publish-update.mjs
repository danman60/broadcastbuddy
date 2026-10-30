// Publish a built app.asar for the in-app updater (src/main/services/updater.ts).
//   node scripts/publish-update.mjs <path/to/app.asar> <git commit the asar was built from>
// Needs CLOUDFLARE_R2_{ENDPOINT,ACCESS_KEY,SECRET_KEY,BUCKET,PUBLIC_URL} in the environment.
// builtAt is stamped now (after the build), so every running BB built earlier sees it as newer.
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { readFileSync } from 'fs'
import { createHash } from 'crypto'

const [asarPath, commit] = process.argv.slice(2)
if (!asarPath || !/^[0-9a-f]{40}$/.test(commit || '')) {
  console.error('usage: publish-update.mjs <app.asar> <full 40-char commit>')
  process.exit(1)
}
const env = (k) => process.env[k] || (console.error(`missing ${k}`), process.exit(1))
const bucket = env('CLOUDFLARE_R2_BUCKET')
const pub = env('CLOUDFLARE_R2_PUBLIC_URL')
const s3 = new S3Client({
  region: 'auto',
  endpoint: env('CLOUDFLARE_R2_ENDPOINT'),
  credentials: { accessKeyId: env('CLOUDFLARE_R2_ACCESS_KEY'), secretAccessKey: env('CLOUDFLARE_R2_SECRET_KEY') },
})

const buf = readFileSync(asarPath)
const key = `bb-updates/app-${commit.slice(0, 7)}-${Date.now()}.asar`
const manifest = {
  commit,
  builtAt: new Date().toISOString(),
  sha256: createHash('sha256').update(buf).digest('hex'),
  bytes: buf.length,
  url: `${pub}/${key}`,
}
console.log(`publishing ${manifest.bytes} B → ${manifest.url}`)
await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buf, ContentType: 'application/octet-stream' }))
await s3.send(new PutObjectCommand({
  Bucket: bucket, Key: 'bb-updates/latest.json', Body: JSON.stringify(manifest, null, 2),
  ContentType: 'application/json', CacheControl: 'no-store',
}))
console.log(JSON.stringify(manifest, null, 2))
