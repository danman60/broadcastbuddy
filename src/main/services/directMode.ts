import { execFile } from 'child_process'
import os from 'os'
import { createLogger } from '../logger'
import { getSettings } from './settings'
import { DirectModeStatus } from '../../shared/types'

const logger = createLogger('direct-mode')

// Windows Mobile Hotspot always hands out 192.168.137.1 as the gateway.
const HOST_IP = '192.168.137.1'
const APP_IDENTIFIER = 'BroadcastBuddy'

let current: DirectModeStatus = { active: false, ssid: '', passphrase: '', hostIp: HOST_IP }

function notWindows(): DirectModeStatus {
  return {
    active: false,
    ssid: '',
    passphrase: '',
    hostIp: HOST_IP,
    error: 'Direct mode requires Windows',
  }
}

/**
 * Run a PowerShell script via -EncodedCommand to avoid shell quoting hell with
 * the WinRT here-strings. Never throws — resolves to { stdout, stderr, code }.
 */
function runPowerShell(script: string, timeoutMs = 20000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: number }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0
        resolve({ stdout: (stdout || '').toString(), stderr: (stderr || '').toString(), code })
      },
    )
  })
}

function genSsid(): string {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `${APP_IDENTIFIER}-${suffix}`
}

function genPassphrase(): string {
  // 8-char alphanumeric — WPA2 minimum is 8.
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

/**
 * Preferred path: WinRT NetworkOperatorTetheringManager on the default internet
 * connection profile. Starts tethering and reads back the live SSID/passphrase
 * Windows assigned (these are user-configured in Mobile Hotspot settings, not
 * something we pick). Emits a single JSON line on success.
 */
const WINRT_START_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  [void][Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]
  [void][Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]

  $profile = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
  if ($null -eq $profile) { Write-Error 'no-internet-profile'; exit 2 }

  $mgr = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($profile)

  # Await the StartTetheringAsync IAsyncOperation synchronously.
  Function Await($op, $resultType) {
    $task = [System.WindowsRuntimeSystemExtensions].GetMethods() |
      Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod } |
      Select-Object -First 1
    $task = $task.MakeGenericMethod($resultType)
    $netTask = $task.Invoke($null, @($op))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
  }

  if ($mgr.TetheringOperationalState -ne 1) {
    $resultType = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult]
    [void](Await ($mgr.StartTetheringAsync()) $resultType)
  }

  $cfg = $mgr.GetCurrentAccessPointConfiguration()
  $out = @{ ssid = $cfg.Ssid; pass = $cfg.Passphrase }
  Write-Output ('BBDIRECT:' + (ConvertTo-Json $out -Compress))
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
`.trim()

const WINRT_STOP_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  [void][Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]
  [void][Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]
  $profile = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
  if ($null -eq $profile) { exit 0 }
  $mgr = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($profile)
  Function Await($op, $resultType) {
    $task = [System.WindowsRuntimeSystemExtensions].GetMethods() |
      Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod } |
      Select-Object -First 1
    $task = $task.MakeGenericMethod($resultType)
    $netTask = $task.Invoke($null, @($op))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
  }
  if ($mgr.TetheringOperationalState -eq 1) {
    $resultType = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult]
    [void](Await ($mgr.StopTetheringAsync()) $resultType)
  }
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
`.trim()

function parseWinrtOutput(stdout: string): { ssid: string; pass: string } | null {
  const line = stdout.split(/\r?\n/).find((l) => l.includes('BBDIRECT:'))
  if (!line) return null
  try {
    const json = line.slice(line.indexOf('BBDIRECT:') + 'BBDIRECT:'.length).trim()
    const parsed = JSON.parse(json)
    if (parsed && typeof parsed.ssid === 'string') {
      return { ssid: parsed.ssid, pass: typeof parsed.pass === 'string' ? parsed.pass : '' }
    }
  } catch (err) {
    logger.warn(`Failed to parse WinRT tethering output: ${err instanceof Error ? err.message : err}`)
  }
  return null
}

/**
 * Legacy fallback: the old netsh hostednetwork API. We pick the SSID/passphrase
 * ourselves here (WinRT mode reads whatever Windows already has configured).
 */
async function startLegacyNetsh(): Promise<DirectModeStatus> {
  const ssid = genSsid()
  const passphrase = genPassphrase()
  const setRes = await runPowerShell(
    `netsh wlan set hostednetwork mode=allow ssid="${ssid}" key="${passphrase}"`,
  )
  if (setRes.code !== 0) {
    const msg = (setRes.stderr || setRes.stdout || 'netsh set hostednetwork failed').trim()
    logger.error(`Legacy netsh set hostednetwork failed: ${msg}`)
    return { active: false, ssid: '', passphrase: '', hostIp: HOST_IP, error: msg }
  }
  const startRes = await runPowerShell('netsh wlan start hostednetwork')
  if (startRes.code !== 0) {
    const msg = (startRes.stderr || startRes.stdout || 'netsh start hostednetwork failed').trim()
    logger.error(`Legacy netsh start hostednetwork failed: ${msg}`)
    return { active: false, ssid: '', passphrase: '', hostIp: HOST_IP, error: msg }
  }
  logger.info(`Direct mode active (legacy netsh): ssid=${ssid}`)
  return { active: true, ssid, passphrase, hostIp: HOST_IP }
}

export async function startDirectMode(): Promise<DirectModeStatus> {
  if (process.platform !== 'win32') {
    current = notWindows()
    return current
  }
  try {
    const winrt = await runPowerShell(WINRT_START_SCRIPT)
    if (winrt.code === 0) {
      const parsed = parseWinrtOutput(winrt.stdout)
      if (parsed && parsed.ssid) {
        current = { active: true, ssid: parsed.ssid, passphrase: parsed.pass, hostIp: HOST_IP }
        logger.info(`Direct mode active (WinRT tethering): ssid=${parsed.ssid}`)
        return current
      }
      logger.warn('WinRT tethering returned no AccessPointConfiguration — falling back to netsh')
    } else {
      const msg = (winrt.stderr || winrt.stdout || `exit ${winrt.code}`).trim()
      logger.warn(`WinRT tethering path failed (${msg}) — falling back to netsh`)
    }

    current = await startLegacyNetsh()
    return current
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error(`startDirectMode failed: ${msg}`)
    current = { active: false, ssid: '', passphrase: '', hostIp: HOST_IP, error: msg }
    return current
  }
}

export async function stopDirectMode(): Promise<DirectModeStatus> {
  if (process.platform !== 'win32') {
    current = notWindows()
    return current
  }
  try {
    const winrt = await runPowerShell(WINRT_STOP_SCRIPT)
    if (winrt.code !== 0) {
      const msg = (winrt.stderr || winrt.stdout || `exit ${winrt.code}`).trim()
      logger.warn(`WinRT stop tethering failed (${msg}) — trying netsh stop hostednetwork`)
      await runPowerShell('netsh wlan stop hostednetwork')
    }
    logger.info('Direct mode stopped')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error(`stopDirectMode failed: ${msg}`)
    current = { active: false, ssid: '', passphrase: '', hostIp: HOST_IP, error: msg }
    return current
  }
  current = { active: false, ssid: '', passphrase: '', hostIp: HOST_IP }
  return current
}

export function getDirectModeStatus(): DirectModeStatus {
  if (process.platform !== 'win32' && !current.error) {
    return notWindows()
  }
  return { ...current }
}

/**
 * JSON the tablet QR encodes. Same port fields getDiscoveryPayload() pulls from
 * settings, plus the just-created hotspot creds so the tablet can join the
 * 192.168.137.x subnet and let the existing UDP-5002 discovery take over.
 */
export function buildDirectQrPayload(): string {
  const settings = getSettings()
  const wd = settings.wifiDisplay!
  const serverConfig = settings.server
  return JSON.stringify({
    v: 1,
    type: 'bb-direct',
    ssid: current.ssid,
    pass: current.passphrase,
    host: HOST_IP,
    videoPort: wd.videoPort,
    touchPort: wd.touchPort,
    wsPort: serverConfig.wsPort,
    tabletLogPort: 8766,
    name: os.hostname(),
    app: APP_IDENTIFIER,
  })
}
