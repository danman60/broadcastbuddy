// Publish a CSController APK for the tablet's "Update app" button (CSController update/Updater.kt).
//   node scripts/publish-apk.mjs <path/to/app-debug.apk> [prefix, default csc-updates; tests use csc-updates-test]
// Needs CLOUDFLARE_R2_{ENDPOINT,ACCESS_KEY,SECRET_KEY,BUCKET,PUBLIC_URL} in the environment.
// versionCode/versionName come from the APK itself (aapt2), so the manifest cannot disagree with the file.
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { readFileSync, readdirSync } from 'fs'
import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import { homedir } from 'os'

const [apkPath, prefix = 'csc-updates'] = process.argv.slice(2)
if (!apkPath) { console.error('usage: publish-apk.mjs <app.apk>'); process.exit(1) }
const env = (k) => process.env[k] || (console.error(`missing ${k}`), process.exit(1))
const bucket = env('CLOUDFLARE_R2_BUCKET')
const pub = env('CLOUDFLARE_R2_PUBLIC_URL')

const tools = `${homedir()}/Android/Sdk/build-tools`
const aapt2 = `${tools}/${readdirSync(tools).sort().pop()}/aapt2`
const badging = execFileSync(aapt2, ['dump', 'badging', apkPath], { encoding: 'utf8' })
const m = badging.match(/package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'/)
if (!m || m[1] !== 'com.compsync.controller') { console.error('not a CSController APK'); process.exit(1) }

const buf = readFileSync(apkPath)
const key = `${prefix}/CSController-${m[2]}-${Date.now()}.apk`
const manifest = {
  versionCode: Number(m[2]),
  versionName: m[3],
  sha256: createHash('sha256').update(buf).digest('hex'),
  bytes: buf.length,
  url: `${pub}/${key}`,
  publishedAt: new Date().toISOString(),
}
const s3 = new S3Client({
  region: 'auto',
  endpoint: env('CLOUDFLARE_R2_ENDPOINT'),
  credentials: { accessKeyId: env('CLOUDFLARE_R2_ACCESS_KEY'), secretAccessKey: env('CLOUDFLARE_R2_SECRET_KEY') },
})
console.log(`publishing ${manifest.versionName} (${manifest.versionCode}), ${manifest.bytes} B → ${manifest.url}`)
await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buf, ContentType: 'application/vnd.android.package-archive' }))
await s3.send(new PutObjectCommand({
  Bucket: bucket, Key: `${prefix}/latest.json`, Body: JSON.stringify(manifest, null, 2),
  ContentType: 'application/json', CacheControl: 'no-store',
}))
console.log(JSON.stringify(manifest, null, 2))
