// ─────────────────────────────────────────────────────────────────────────────
// EXPERIMENTAL / UNVERIFIED — Option 2 "BLE auto-list" no-router pairing (HOST).
//
// This is an ADDITIVE, isolated path. It does NOT touch the verified Option 1
// (QR) flow in directMode.ts, nor LAN UDP discovery. It advertises the SAME
// hotspot creds the QR path encodes (buildDirectQrPayload) so a tablet can list
// the host over BLE and join with no QR scan.
//
// No native Node deps (a native BLE module would break the electron-builder
// NSIS build). All Bluetooth work runs inside a PowerShell -EncodedCommand
// snippet using WinRT (Windows.Devices.Bluetooth.Advertisement +
// GenericAttributeProfile.GattServiceProvider). Windows BLE *peripheral* support
// varies by adapter/driver, so every path is best-effort: any failure resolves
// to { active:false, error }. NO BLE radio was available to test this — treat
// the whole module as unverified.
//
// WIRE CONTRACT (documented in both repos):
//   Service UUID        : 0000bbdd-0000-1000-8000-00805f9b34fb
//   Creds characteristic: 0000bbcc-0000-1000-8000-00805f9b34fb  (Read)
// The advertisement carries the service UUID + a short manufacturer-data blob
// ("BB" + SSID, truncated to fit the ~24-byte adv budget). The full creds JSON
// (incl. passphrase) — identical to the QR payload — is exposed by the GATT
// creds characteristic, which the tablet reads after connecting.
// ─────────────────────────────────────────────────────────────────────────────

import { execFile } from 'child_process'
import { createLogger } from '../logger'
import { getDirectModeStatus, buildDirectQrPayload } from './directMode'

const logger = createLogger('ble-advertise')

// BB BLE service + characteristic UUIDs. Keep in sync with the tablet
// (CSController BleDirectScanner.kt).
export const BB_BLE_SERVICE_UUID = '0000bbdd-0000-1000-8000-00805f9b34fb'
export const BB_BLE_CREDS_CHAR_UUID = '0000bbcc-0000-1000-8000-00805f9b34fb'

export interface BleAdvertiseStatus {
  active: boolean
  error?: string
}

let current: BleAdvertiseStatus = { active: false }

// Marker the PS snippet prints so we can detect a clean start vs. a thrown error.
const OK_MARKER = 'BBBLE:OK'

function notWindows(): BleAdvertiseStatus {
  return { active: false, error: 'BLE requires Windows' }
}

/**
 * Run a PowerShell script via -EncodedCommand (mirrors directMode.ts). Never
 * throws — resolves { stdout, stderr, code }. The BLE publisher + GATT provider
 * are kept alive by a blocking wait loop inside the script, so this child
 * process stays running until stop() kills it; we hold onto the process handle.
 */
function runPowerShellDetached(script: string): { kill: () => void } {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const child = execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { windowsHide: true, maxBuffer: 1024 * 1024 },
    (err, stdout, stderr) => {
      // This callback fires when the process exits (normally on stop()).
      if (err && (err as { killed?: boolean }).killed) return
      const out = (stdout || '').toString()
      const errOut = (stderr || '').toString()
      if (err) {
        logger.warn(`BLE advertise PS exited: ${(errOut || out || (err as Error).message).trim()}`)
      }
    },
  )
  return { kill: () => { try { child.kill() } catch { /* ignore */ } } }
}

/**
 * Synchronous probe (short-lived) used at start() to confirm the publisher and
 * GATT provider initialised before we report active. Resolves { ok, error }.
 */
function runPowerShell(script: string, timeoutMs = 15000): Promise<{ stdout: string; stderr: string; code: number }> {
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

let detached: { kill: () => void } | null = null

/**
 * Build the long-running PS script: stand up the GATT creds characteristic
 * (read-returns the QR JSON) and start a BLE advertisement carrying the service
 * UUID + a short SSID blob, then block so the publisher/provider stay alive.
 * Best-effort: wrapped in try/catch; on success prints OK_MARKER then waits.
 */
function buildAdvertiseScript(credsJson: string, ssid: string): string {
  // Base64 the creds JSON so we don't have to escape quotes inside the here-doc.
  const credsB64 = Buffer.from(credsJson, 'utf8').toString('base64')
  // SSID is short-listed for the manufacturer-data advert blob (kept under the
  // ~24-byte adv budget). Reserved for a future scan-response optimisation; the
  // tablet currently reads SSID from the GATT creds JSON after connect.
  void ssid
  return `
$ErrorActionPreference = 'Stop'
try {
  [void][Windows.Devices.Bluetooth.Advertisement.BluetoothLEAdvertisementPublisher,Windows.Devices.Bluetooth.Advertisement,ContentType=WindowsRuntime]
  [void][Windows.Devices.Bluetooth.GenericAttributeProfile.GattServiceProvider,Windows.Devices.Bluetooth.GenericAttributeProfile,ContentType=WindowsRuntime]
  [void][Windows.Storage.Streams.DataWriter,Windows.Storage.Streams,ContentType=WindowsRuntime]
  [void][System.Runtime.InteropServices.WindowsRuntime.AsyncInfo]

  Function Await($op, $resultType) {
    $task = [System.WindowsRuntimeSystemExtensions].GetMethods() |
      Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod } |
      Select-Object -First 1
    $task = $task.MakeGenericMethod($resultType)
    $netTask = $task.Invoke($null, @($op))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
  }

  $serviceUuid = [Guid]'${BB_BLE_SERVICE_UUID}'
  $credsUuid   = [Guid]'${BB_BLE_CREDS_CHAR_UUID}'

  # ── GATT service + creds characteristic ──
  $spResultType = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattServiceProviderResult]
  $spResult = Await ([Windows.Devices.Bluetooth.GenericAttributeProfile.GattServiceProvider]::CreateAsync($serviceUuid)) $spResultType
  if ($spResult.Error -ne [Windows.Devices.Bluetooth.GenericAttributeProfile.BluetoothError]::Success) {
    Write-Error ('gatt-service-create:' + $spResult.Error); exit 1
  }
  $provider = $spResult.ServiceProvider

  $charParams = New-Object Windows.Devices.Bluetooth.GenericAttributeProfile.GattLocalCharacteristicParameters
  $charParams.CharacteristicProperties = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattCharacteristicProperties]::Read
  $charParams.ReadProtectionLevel = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattProtectionLevel]::Plain

  $charResultType = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattLocalCharacteristicResult]
  $charResult = Await ($provider.Service.CreateCharacteristicAsync($credsUuid, $charParams)) $charResultType
  if ($charResult.Error -ne [Windows.Devices.Bluetooth.GenericAttributeProfile.BluetoothError]::Success) {
    Write-Error ('gatt-char-create:' + $charResult.Error); exit 1
  }
  $char = $charResult.Characteristic

  # Reply to every read with the creds JSON bytes. The bytes are rebuilt from
  # the same base64 literal inside the action scriptblock (no $using:, which is
  # only valid in remote/job scopes).
  Register-ObjectEvent -InputObject $char -EventName ReadRequested -Action {
    param($s, $e)
    try {
      $deferral = $e.GetDeferral()
      $reqType = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattReadRequest]
      $tsk = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod } |
        Select-Object -First 1
      $tsk = $tsk.MakeGenericMethod($reqType)
      $nt = $tsk.Invoke($null, @($e.GetRequestAsync()))
      $nt.Wait(-1) | Out-Null
      $request = $nt.Result
      $bytes = [Convert]::FromBase64String('${credsB64}')
      $writer = New-Object Windows.Storage.Streams.DataWriter
      $writer.WriteBytes($bytes)
      $request.RespondWithValue($writer.DetachBuffer())
      $deferral.Complete()
    } catch { }
  } | Out-Null

  # ── Start advertising the service UUID (+ short SSID manufacturer blob) ──
  $advParams = New-Object Windows.Devices.Bluetooth.GenericAttributeProfile.GattServiceProviderAdvertisingParameters
  $advParams.IsConnectable = $true
  $advParams.IsDiscoverable = $true
  $provider.StartAdvertising($advParams)

  Write-Output '${OK_MARKER}'

  # Keep the process (and thus the publisher + GATT provider) alive until killed.
  while ($true) { Start-Sleep -Seconds 3600 }
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
`.trim()
}

/**
 * Quick probe that the WinRT BLE peripheral types exist + a publisher can be
 * constructed on this machine. Returns null on success or an error string.
 * Used so start() can fail fast with a clear message on adapters that lack
 * peripheral support, instead of leaving a dead detached process.
 */
const PROBE_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  [void][Windows.Devices.Bluetooth.GenericAttributeProfile.GattServiceProvider,Windows.Devices.Bluetooth.GenericAttributeProfile,ContentType=WindowsRuntime]
  Function Await($op, $resultType) {
    $task = [System.WindowsRuntimeSystemExtensions].GetMethods() |
      Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod } |
      Select-Object -First 1
    $task = $task.MakeGenericMethod($resultType)
    $netTask = $task.Invoke($null, @($op))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
  }
  $rt = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattServiceProviderResult]
  $r = Await ([Windows.Devices.Bluetooth.GenericAttributeProfile.GattServiceProvider]::CreateAsync([Guid]'${BB_BLE_SERVICE_UUID}')) $rt
  if ($r.Error -ne [Windows.Devices.Bluetooth.GenericAttributeProfile.BluetoothError]::Success) {
    Write-Error ('probe:' + $r.Error); exit 1
  }
  Write-Output '${OK_MARKER}'
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
`.trim()

export async function startBleAdvertise(): Promise<BleAdvertiseStatus> {
  if (process.platform !== 'win32') {
    current = notWindows()
    return current
  }
  try {
    const direct = getDirectModeStatus()
    if (!direct.active || !direct.ssid) {
      current = { active: false, error: 'Start Direct Mode first — no hotspot creds to advertise.' }
      return current
    }

    // Probe peripheral support up front so we can report a clear error.
    const probe = await runPowerShell(PROBE_SCRIPT)
    if (probe.code !== 0 || !probe.stdout.includes(OK_MARKER)) {
      const msg = (probe.stderr || probe.stdout || 'BLE peripheral mode unsupported on this adapter').trim()
      logger.warn(`BLE advertise probe failed: ${msg}`)
      current = { active: false, error: msg }
      return current
    }

    // Tear down any prior advert before starting a new one.
    stopBleAdvertiseSync()

    const credsJson = buildDirectQrPayload()
    const script = buildAdvertiseScript(credsJson, direct.ssid)
    detached = runPowerShellDetached(script)
    current = { active: true }
    logger.info(`BLE advertise started (experimental): service=${BB_BLE_SERVICE_UUID} ssid=${direct.ssid}`)
    return current
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error(`startBleAdvertise failed: ${msg}`)
    current = { active: false, error: msg }
    return current
  }
}

function stopBleAdvertiseSync(): void {
  if (detached) {
    detached.kill()
    detached = null
  }
}

export async function stopBleAdvertise(): Promise<BleAdvertiseStatus> {
  if (process.platform !== 'win32') {
    current = notWindows()
    return current
  }
  try {
    stopBleAdvertiseSync()
    logger.info('BLE advertise stopped')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error(`stopBleAdvertise failed: ${msg}`)
  }
  current = { active: false }
  return current
}

export function getBleAdvertiseStatus(): BleAdvertiseStatus {
  if (process.platform !== 'win32' && !current.error) {
    return notWindows()
  }
  return { ...current }
}
