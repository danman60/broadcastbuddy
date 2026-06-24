# voice-helper drop folder

`electron-builder` bundles everything in this folder to `resources/voice-helper/` in the
packaged app (where `voiceDirector.ts` looks for `voice-helper.exe`).

Build the helper on the Windows build box (FIRMAMENT) and drop the published exe here
before `npm run dist:installer`:

```
cd voice-helper
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
copy bin\Release\net8.0-windows\win-x64\publish\voice-helper.exe ..\resources\voice-helper\
```

If `voice-helper.exe` is absent, the voice director simply stays disabled at runtime
(logged, no crash) — voice is purely additive.
