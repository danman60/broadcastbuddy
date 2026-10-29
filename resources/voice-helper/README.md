# voice-helper drop folder

`electron-builder` bundles everything in this folder to `resources/voice-helper/` in the
packaged app (where `voiceDirector.ts` looks for `voice-helper.exe`).

Build the .NET Framework 4.8 helper on FIRMAMENT, then copy the compiled exe into
this worktree before packaging. For `wf/operator-features`, the isolated build is
`D:\Shared\voice-helper-build-wf`; its `build.ps1` compiles `Program.cs`, `Protocol.cs`,
`GrammarFactory.cs`, and `MicStream.cs`. Do not write into the shared build or main's resources.

```
powershell -NoProfile -ExecutionPolicy Bypass -File D:\Shared\voice-helper-build-wf\build.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File D:\Shared\voice-helper-build-wf\meter-smoke.ps1
```

If `voice-helper.exe` is absent, the voice director simply stays disabled at runtime
(logged, no crash) — voice is purely additive.

Optional meter protocol: `{ "t": "meter", "on": true }` starts approximately five
`{ "t": "level", "peak": 0 }` messages per second, with `peak` ranging from 0 to 100.
`on:false` stops them. Metering starts off, never changes the speech grammar, and
uses an independent peak window so the PTT silent-mic check retains its hold peak.
BB accepts older helpers that never send levels and displays `Level unavailable`.
