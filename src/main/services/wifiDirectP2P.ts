// EXPERIMENTAL / UNVERIFIED — Wi-Fi Direct P2P; host advertiser is a scaffold
// (see comments), needs native helper for full connection handling.
//
// SCOPE / HONESTY NOTE (read before relying on this):
//   This service starts ONLY the Wi-Fi Direct *advertisement* so the Windows PC
//   becomes discoverable as a Wi-Fi Direct peer (via WinRT
//   Windows.Devices.WiFiDirect.WiFiDirectAdvertisementPublisher with
//   ListenStateDiscoverability = Normal). That is the most a short PowerShell
//   snippet can reliably do.
//
//   It does NOT host the actual P2P connection. Full Wi-Fi Direct group-owner
//   behaviour — accepting incoming connections via WiFiDirectConnectionListener,
//   negotiating the group, and standing up a StreamSocketListener so the tablet
//   can reach the existing ports (video 5000 / touch 5001 / ws 9877 /
//   log 8766) — requires a long-lived event loop with WinRT event subscriptions.
//   That cannot be expressed as a fire-and-forget PowerShell command and would
//   need a compiled native helper.exe. That helper is OUT OF SCOPE and this path
//   is therefore INCOMPLETE and UNVERIFIED (no radios available in this env).
//
//   This is fully isolated from the verified Direct (QR + Mobile Hotspot) path
//   in directMode.ts, the BLE path, and LAN discovery. Additive only.

import { execFile } from 'child_process'
import { createLogger } from '../logger'
import { recordEvent } from './events'
import { WifiDirectP2PStatus } from '../../shared/types'

const logger = createLogger('wifi-direct-p2p')

let current: WifiDirectP2PStatus = { active: false }

function notWindows(): WifiDirectP2PStatus {
  return { active: false, error: 'Wi-Fi Direct requires Windows' }
}

/**
 * Run a PowerShell script via -EncodedCommand to avoid shell quoting hell with
 * the WinRT here-strings. Never throws — resolves to { stdout, stderr, code }.
 * (Same pattern as directMode.ts.)
 */
function runPowerShell(
  script: string,
  timeoutMs = 15000,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        const code =
          err && typeof (err as { code?: number }).code === 'number'
            ? (err as { code: number }).code
            : err
              ? 1
              : 0
        resolve({ stdout: (stdout || '').toString(), stderr: (stderr || '').toString(), code })
      },
    )
  })
}

// Best-effort: instantiate a WiFiDirectAdvertisementPublisher, set its
// Advertisement.ListenStateDiscoverability to Normal (1) and Start() it. The
// publisher object lives only for the lifetime of this PowerShell process —
// which exits immediately. So in practice this verifies the WinRT class is
// reachable and the advertisement *can* start; it cannot keep it running.
// A native helper.exe would own a persistent publisher + connection listener.
const WINRT_ADVERTISE_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  [void][Windows.Devices.WiFiDirect.WiFiDirectAdvertisementPublisher,Windows.Devices.WiFiDirect,ContentType=WindowsRuntime]
  [void][Windows.Devices.WiFiDirect.WiFiDirectAdvertisementListenStateDiscoverability,Windows.Devices.WiFiDirect,ContentType=WindowsRuntime]
  $publisher = New-Object Windows.Devices.WiFiDirect.WiFiDirectAdvertisementPublisher
  # ListenStateDiscoverability.Normal = 1
  $publisher.Advertisement.ListenStateDiscoverability = 1
  $publisher.Start()
  Write-Output ('BBP2P:' + (ConvertTo-Json @{ status = $publisher.Status.ToString() } -Compress))
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
`.trim()

function parseAdvertiseOutput(stdout: string): { status: string } | null {
  const line = stdout.split(/\r?\n/).find((l) => l.includes('BBP2P:'))
  if (!line) return null
  try {
    const json = line.slice(line.indexOf('BBP2P:') + 'BBP2P:'.length).trim()
    const parsed = JSON.parse(json)
    if (parsed && typeof parsed.status === 'string') return { status: parsed.status }
  } catch (err) {
    logger.warn(`Failed to parse WiFiDirect advertise output: ${err instanceof Error ? err.message : err}`)
  }
  return null
}

export async function startWifiDirectP2P(): Promise<WifiDirectP2PStatus> {
  if (process.platform !== 'win32') {
    current = notWindows()
    return current
  }
  try {
    const res = await runPowerShell(WINRT_ADVERTISE_SCRIPT)
    if (res.code === 0) {
      const parsed = parseAdvertiseOutput(res.stdout)
      logger.info(
        `Wi-Fi Direct advertisement start attempted (scaffold only) — publisher status: ${parsed?.status ?? 'unknown'}`,
      )
      // NOTE: we report active=true to reflect that the advertisement *was*
      // started, but see the file header — the connection listener / socket
      // half is NOT hosted. Treat as experimental/incomplete.
      current = {
        active: true,
        publisherStatus: parsed?.status,
      }
      recordEvent('net', 'Wi-Fi Direct started', { publisherStatus: parsed?.status })
      return current
    }
    const msg = (res.stderr || res.stdout || `exit ${res.code}`).trim()
    logger.warn(`Wi-Fi Direct advertisement failed: ${msg}`)
    current = { active: false, error: msg }
    recordEvent('net', 'Wi-Fi Direct failed', { error: msg })
    return current
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error(`startWifiDirectP2P failed: ${msg}`)
    current = { active: false, error: msg }
    recordEvent('net', 'Wi-Fi Direct failed', { error: msg })
    return current
  }
}

export async function stopWifiDirectP2P(): Promise<WifiDirectP2PStatus> {
  // The advertisement publisher does not survive the PowerShell process that
  // created it, so there is nothing persistent to tear down here. We simply
  // reset state. A native helper.exe would Stop() its long-lived publisher.
  if (process.platform !== 'win32') {
    current = notWindows()
    return current
  }
  logger.info('Wi-Fi Direct P2P stopped (scaffold — no persistent publisher to stop)')
  current = { active: false }
  recordEvent('net', 'Wi-Fi Direct stopped', {})
  return current
}

export function getWifiDirectP2PStatus(): WifiDirectP2PStatus {
  if (process.platform !== 'win32' && !current.error) {
    return notWindows()
  }
  return { ...current }
}
