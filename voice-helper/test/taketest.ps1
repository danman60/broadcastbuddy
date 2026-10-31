# Real-SAPI test: synthesize spoken commands to WAV, feed each to voice-helper.exe
# via the {t:file} hook against the grammar BB pushes when no Voice shots are set.
Add-Type -AssemblyName System.Speech
$dir = 'D:\Shared\voice-helper-build\wavtake'
New-Item -ItemType Directory -Force $dir | Out-Null
$phrases = @('camera one go','camera two go','camera three go','camera three push in','camera three stop','push in','stop','autodirect','camera three cycle moves','starting soon go','camera two shot four','pizza delivery tonight','so we should go get some coffee','the camera is over there')
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$i = 0
foreach ($ph in $phrases) {
  $syn = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $syn.SetOutputToWaveFile("$dir\$i.wav", $fmt); $syn.Speak($ph); $syn.Dispose(); $i++
}
$psi = New-Object System.Diagnostics.ProcessStartInfo('D:\Shared\voice-helper-build\voice-helper.exe')
$psi.UseShellExecute = $false; $psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true
$p = [System.Diagnostics.Process]::Start($psi)
$verbs = '[{"id":"select","phrases":["camera one","camera two"]},{"id":"recall","phrases":["shot","go to shot","preset","go to preset"],"needsTarget":true},{"id":"pushIn","phrases":["push in"]},{"id":"slowPushIn","phrases":["slow push in","slow push"]},{"id":"pullOut","phrases":["pull out","zoom out"]},{"id":"zoomIn","phrases":["zoom in"]},{"id":"wide","phrases":["wide","go wide","home"]},{"id":"track","phrases":["track","follow"]},{"id":"stop","phrases":["stop"]},{"id":"autoDirect","phrases":["autodirect","auto direct","auto director"]},{"id":"cycle","phrases":["cycle moves","cycle shots","cycle"]},{"id":"take:Cam1","phrases":["camera one go","cam one go","take camera one"]},{"id":"take:Cam2","phrases":["camera two go","cam two go","take camera two"]},{"id":"take:Cam3","phrases":["camera three go","cam three go","take camera three"]},{"id":"take:StartingSoon","phrases":["starting soon go","take starting soon"]}]'
$slots = '["1","2","3","4","5","6","7","8"]'
$p.StandardInput.WriteLine('{"t":"grammar","verbs":' + $verbs + ',"shots":{"1":' + $slots + ',"2":' + $slots + '},"wakeWord":""}')
$p.StandardInput.Flush()
Write-Output ("first: " + $p.StandardOutput.ReadLine())
for ($k = 0; $k -lt $phrases.Count; $k++) {
  if ($false) { $p.StandardInput.WriteLine('{"t":"grammar","verbs":' + $verbs + ',"shots":{"1":' + $slots + ',"2":' + $slots + '},"wakeWord":"broadcast"}'); $p.StandardInput.Flush() }
  if ($k -eq 2) { $p.StandardInput.WriteLine('{"t":"grammar","verbs":' + $verbs + ',"shots":{"1":' + $slots + ',"2":' + $slots + '},"wakeWord":""}'); $p.StandardInput.Flush() }
  $path = ("$dir\$k.wav") -replace '\\','\\'
  $p.StandardInput.WriteLine('{"t":"file","path":"' + $path + '"}'); $p.StandardInput.Flush()
  do { $line = $p.StandardOutput.ReadLine() } while ($line -notmatch '"t":"(result|reject|error)"' -and $line -ne $null)
  Write-Output ("SAID '" + $phrases[$k] + "' -> " + $line)
}
$p.StandardInput.Close(); $p.WaitForExit(3000) | Out-Null
