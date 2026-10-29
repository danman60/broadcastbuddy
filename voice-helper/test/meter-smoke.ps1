param([string]$Exe = 'D:\Shared\voice-helper-build-wf\voice-helper.exe', [string]$Mic = '')
$ErrorActionPreference = 'Stop'
$p = New-Object System.Diagnostics.Process
$p.StartInfo.FileName = $Exe
$p.StartInfo.UseShellExecute = $false
$p.StartInfo.RedirectStandardInput = $true
$p.StartInfo.RedirectStandardOutput = $true
$p.StartInfo.RedirectStandardError = $true
$p.StartInfo.CreateNoWindow = $true
[void]$p.Start()
$script:pending = $p.StandardOutput.ReadLineAsync()
function Read-For([int]$Ms) {
  $lines = @()
  $until = [DateTime]::UtcNow.AddMilliseconds($Ms)
  while ([DateTime]::UtcNow -lt $until) {
    if ($script:pending.Wait(50)) {
      $line = $script:pending.Result
      if ($null -eq $line) { break }
      $lines += $line
      $script:pending = $p.StandardOutput.ReadLineAsync()
    }
  }
  return $lines
}
try {
  $boot = @(Read-For 1000)
  if ($Mic) {
    $p.StandardInput.WriteLine((@{t='mic';deviceId=$Mic} | ConvertTo-Json -Compress))
    $selected = @(Read-For 500)
    $selected | ForEach-Object { Write-Output $_ }
    if (-not ($selected -match '"t":"mic"')) { throw 'named mic was not selected' }
    if ($selected -match '"t":"error"') { throw 'named mic selection failed' }
  }
  $p.StandardInput.WriteLine('{"t":"ping"}')
  $ping = @(Read-For 500)
  if (-not ($ping -match '"t":"pong"')) { throw 'ping did not return pong' }
  if (@($boot + $ping | Where-Object { $_ -match '"t":"level"' }).Count) { throw 'unsolicited meter messages' }
  Write-Output 'PASS: ping -> pong; meter silent by default'
  $p.StandardInput.WriteLine('{"t":"meter","on":true}')
  $on = @(Read-For 1600)
  $levels = @($on | Where-Object { $_ -match '"t":"level"' })
  $on | ForEach-Object { Write-Output $_ }
  if ($levels.Count) {
    if ($levels.Count -lt 5 -or $levels.Count -gt 10) { throw "unexpected rate: $($levels.Count) in 1.6s" }
    foreach ($line in $levels) { $v = ($line | ConvertFrom-Json).peak; if ($v -lt 0 -or $v -gt 100) { throw 'invalid peak' } }
    Write-Output "PASS: $($levels.Count) bounded level messages in 1.6s"
  } else {
    Write-Output 'UNVERIFIED: no mic level messages; capture unavailable on this host'
    if (-not ($on -match 'meter-unavailable')) { throw 'no meter levels or capture error' }
  }
  $p.StandardInput.WriteLine('{"t":"meter","on":false}')
  [void](Read-For 250) # drain an already-written line at the boundary
  $off = @(Read-For 800)
  if ($off -match '"t":"level"') { throw 'meter continued after off' }
  $p.StandardInput.WriteLine('not-json')
  $p.StandardInput.WriteLine('{"t":"ping"}')
  $final = @(Read-For 500)
  if (-not ($final -match '"t":"pong"')) { throw 'helper no longer responds' }
  Write-Output 'PASS: meter stops; malformed input tolerated; ping still responds'
} finally {
  $p.StandardInput.Close()
  if (-not $p.WaitForExit(3000)) { $p.Kill() }
  $p.Dispose()
}
