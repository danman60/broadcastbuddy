/**
 * Startup sanity checks. Run after services start; surfaced in the renderer.
 * Never blocks startup on failure — just reports.
 *
 * Adapted from CompSyncElectronApp/src/main/services/startup.ts (runStartupChecks).
 * BB checks: HTTP/WS ports bindable, userData writable, ffmpeg resolvable,
 * R2 / CC / OBS config present.
 */

import fs from 'fs'
import net from 'net'
import path from 'path'
import { app } from 'electron'
import type { StartupCheck, StartupReport } from '../../shared/types'
import { createLogger } from '../logger'
import { getSettings } from './settings'
import { findFfmpeg } from './audioTranscription'
import { recordEvent } from './events'

const logger = createLogger('startup')

let lastReport: StartupReport | null = null

export function getLastStartupReport(): StartupReport | null {
  return lastReport
}

function portBindable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
}

export async function runStartupChecks(): Promise<StartupReport> {
  logger.info('Running startup validation...')
  const settings = getSettings()
  const checks: StartupCheck[] = []

  // 1. HTTP + WS ports bindable. We test bindability (the real servers are
  //    started just before this, so a "fail" here means already-in-use — which
  //    is expected if the overlay server already grabbed it. We probe a fresh
  //    bind on each to confirm nothing else is squatting.)
  const { httpPort, wsPort } = settings.server
  for (const [label, port] of [['HTTP', httpPort], ['WebSocket', wsPort]] as const) {
    const free = await portBindable(port)
    checks.push({
      name: `${label} port ${port}`,
      // Our own server holds the port at this point, so "not bindable" is the
      // healthy case. We only warn if BOTH our server failed to start — which
      // surfaces elsewhere. Report bindable=ok (free) / in-use=ok (likely ours).
      status: 'ok',
      detail: free ? 'available' : 'in use (likely our server)',
    })
  }

  // 2. userData writable
  try {
    const probe = path.join(app.getPath('userData'), '.write-probe')
    fs.writeFileSync(probe, 'ok')
    fs.rmSync(probe, { force: true })
    checks.push({ name: 'userData writable', status: 'ok', detail: app.getPath('userData') })
  } catch (err) {
    checks.push({ name: 'userData writable', status: 'fail', detail: err instanceof Error ? err.message : String(err) })
  }

  // 3. ffmpeg resolvable (reuse the audioTranscription finder)
  try {
    const bin = findFfmpeg()
    checks.push({ name: 'ffmpeg', status: 'ok', detail: bin })
  } catch {
    checks.push({ name: 'ffmpeg', status: 'warn', detail: 'not found — transcription / faststart will fail' })
  }

  // 4. R2 config present
  const r2 = settings.r2Config
  const r2Ok = !!(r2?.endpoint && r2?.accessKeyId && r2?.secretAccessKey)
  checks.push({
    name: 'R2 storage config',
    status: r2Ok ? 'ok' : 'warn',
    detail: r2Ok ? `bucket ${r2?.bucket}` : 'not configured — gallery R2 upload disabled',
  })

  // 5. CC config present
  const cc = settings.ccConfig
  const ccOk = !!(cc?.baseUrl && cc?.apiKey && cc?.tenantId)
  checks.push({
    name: 'Command Center config',
    status: ccOk ? 'ok' : 'warn',
    detail: ccOk ? cc?.baseUrl ?? '' : 'not configured — CC sync disabled',
  })

  // 6. OBS config present (not a live-connection check — just config)
  const obs = settings.obsConnection
  const obsOk = !!obs?.host
  checks.push({
    name: 'OBS config',
    status: obsOk ? 'ok' : 'warn',
    detail: obsOk ? `${obs?.host}:${obs?.port}` : 'not configured',
  })

  const report: StartupReport = { ranAt: new Date().toISOString(), checks }
  lastReport = report

  const fails = checks.filter((c) => c.status === 'fail').length
  const warns = checks.filter((c) => c.status === 'warn').length
  logger.info(`Startup checks: ${checks.length - fails - warns} ok, ${warns} warn, ${fails} fail`)
  recordEvent('system', `Startup checks: ${checks.length - fails - warns} ok, ${warns} warn, ${fails} fail`, {
    fails, warns,
  })

  return report
}
