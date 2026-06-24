# voice-helper

Offline Windows SAPI speech-recognition sidecar for BroadcastBuddy's voice-driven PTZ
director. A small **.NET Framework 4.8** console app that BB's main process launches and
talks to over **stdio** (newline-delimited JSON). BB owns the grammar and the confidence
floor; the helper just recognizes while a push-to-talk key is held and returns the best
structured match.

See the design spec: `docs/superpowers/specs/2026-06-23-voice-ptz-director-design.md`
(sections "Helper ↔ BB wire protocol" and "Grammar + command mapping").

## Wire protocol (summary)

NDJSON, one object per line. `stdin` = BB→helper, `stdout` = helper→BB (flushed every write).

**BB → helper**
- `{"t":"grammar","verbs":[{"id":"pushIn","phrases":["push in"]},...],"shots":{"1":["3","drummer"],"2":["1","wide"]}}`
- `{"t":"listen","on":true}`  — PTT key down, start recognizing
- `{"t":"listen","on":false}` — PTT key up, emit best match captured during the hold
- `{"t":"mic","deviceId":"..."}` — accepted + logged; **v1 always uses the Windows default input device** (System.Speech limitation), does not fail
- `{"t":"ping"}`

**helper → BB**
- `{"t":"ready"}` — emitted once after the SAPI engine is constructed (BEFORE any grammar)
- `{"t":"result","camera":2,"verb":"pushIn","target":"drummer","from":2,"to":3,"confidence":0.86}`
  - `camera` = `1|2` or omitted (no prefix spoken); `target`/`from`/`to` present only when relevant; `confidence` = SAPI 0.0–1.0
- `{"t":"reject","reason":"no-match","confidence":0.0}` — on `listen:false` when nothing matched
- `{"t":"error","reason":"no-recognizer"|"engine-fail"|...}`
- `{"t":"pong"}`

Semantics (camera/verb/target/from/to) come from SAPI `e.Result.Semantics`, built with
`SemanticResultKey`/`SemanticResultValue` — the helper never string-parses recognized text.
Number tokens are spoken as English words ("three") but carry the **int** semantic (`3`);
labels are spoken as their lowercased words and carry the **string** semantic.

## Build

This project targets **.NET Framework 4.8** and references only **GAC / framework
assemblies** (`System.Speech`, `System.Web.Extensions`, `System.Core`). **No NuGet /
PackageReference.** It therefore builds on any Windows box that has the .NET Framework 4.8
**targeting/reference assemblies** and either the in-box Roslyn `csc.exe` or VS 2022
BuildTools MSBuild — no .NET SDK required.

JSON uses `System.Web.Script.Serialization.JavaScriptSerializer`
(`System.Web.Extensions.dll`), not `System.Text.Json` (which is not in the framework).

### Option A — direct `csc.exe` (preferred, no MSBuild)

The in-box compiler is `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` (modern
Roslyn; the source is kept to C# 7.3). Run this **from the `voice-helper` directory**.

Most robust single command (explicit reference-assembly paths — works even when the GAC
isn't on the lib path):

```bat
"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" ^
  /target:exe ^
  /out:voice-helper.exe ^
  /langversion:7.3 ^
  /nologo ^
  /reference:"C:\Program Files (x86)\Reference Assemblies\Microsoft\Framework\.NETFramework\v4.8\System.dll" ^
  /reference:"C:\Program Files (x86)\Reference Assemblies\Microsoft\Framework\.NETFramework\v4.8\System.Core.dll" ^
  /reference:"C:\Program Files (x86)\Reference Assemblies\Microsoft\Framework\.NETFramework\v4.8\System.Speech.dll" ^
  /reference:"C:\Program Files (x86)\Reference Assemblies\Microsoft\Framework\.NETFramework\v4.8\System.Web.Extensions.dll" ^
  Program.cs Protocol.cs GrammarFactory.cs
```

Shorter form (works if the GAC reference assemblies are already on the compiler's lib
path, which they usually are when run from a Developer/BuildTools shell):

```bat
"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /target:exe /out:voice-helper.exe /langversion:7.3 ^
  /r:System.dll /r:System.Core.dll /r:System.Speech.dll /r:System.Web.Extensions.dll ^
  Program.cs Protocol.cs GrammarFactory.cs
```

> **Path to confirm on the build box.** The `v4.8` reference-assembly directory above
> (`C:\Program Files (x86)\Reference Assemblies\Microsoft\Framework\.NETFramework\v4.8\`)
> ships with the **.NET Framework 4.8 Targeting Pack** (installed by VS 2022 BuildTools).
> If only `v4.7.2` (or another version) is present, point the `/reference:` paths at that
> directory instead — `System.Speech.dll` and `System.Web.Extensions.dll` live in the same
> folder for every 4.x targeting pack. If neither exists, use Option B (MSBuild resolves
> the assemblies itself). The runtime `System.Speech.dll` also lives in the GAC at
> `%WINDIR%\Microsoft.NET\assembly\GAC_MSIL\System.Speech\<version>\System.Speech.dll`
> (the `<version>` subfolder name varies — there's exactly one), which the short `/r:` form
> resolves automatically.

### Option B — VS 2022 BuildTools MSBuild (fallback)

```bat
"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\amd64\MSBuild.exe" voice-helper.csproj /p:Configuration=Release
```

Output: `bin\Release\voice-helper.exe`.

### Drop into the BB installer

Copy the built exe to the electron-builder `extraResources` drop folder:

```
resources\voice-helper\voice-helper.exe
```

(Linux dev box path: `/home/danman60/projects/BroadcastBuddy/resources/voice-helper/voice-helper.exe`.)
electron-builder bundles `resources/voice-helper/` → `resources/voice-helper/` in the
installed app (see `package.json` → `build.extraResources`).

### Runtime requirement on DART

The DART box must have the **.NET Framework 4.8 runtime** — present by default on all
current Windows 10/11 builds, so **no self-contained bundle is needed**. (The old net8.0
self-contained single-file publish is retired with this retarget.)

## Files

- `voice-helper.csproj` — classic (non-SDK) **net48** project: `TargetFrameworkVersion v4.8`, `OutputType Exe`, references `System` / `System.Core` / `System.Speech` / `System.Web.Extensions`, no NuGet.
- `Program.cs` — engine lifecycle, stdin dispatch loop, PTT capture model, semantics→result mapping.
- `GrammarFactory.cs` — builds the bounded grammar (optional camera prefix, number-word → int semantics, label tokens, recall/sweep/verb patterns).
- `Protocol.cs` — `JavaScriptSerializer` (in)/out maps for the wire protocol; defensive inbound decode (`string`/`int`/`decimal`/`ArrayList`/`Dictionary`).

## Notes for the build-time human to verify

- **.NET Framework 4.8 targeting pack present.** Confirm the `v4.8` reference-assembly
  directory exists (see the path-to-confirm note above). VS 2022 BuildTools with the
  ".NET Framework 4.8 SDK/targeting pack" component installs it.
- **Recognizer install.** `SpeechRecognitionEngine()` uses the default *system* recognizer.
  Windows ships en-US recognizers on Desktop SKUs; if the DART box has none installed the
  helper emits `{"t":"error","reason":"no-recognizer"}` and stays alive (so BB's
  auto-relaunch doesn't thrash). Confirm an en-US recognizer is present on DART.
- **Single recognizer culture.** Default ctor picks the first installed recognizer; if the
  box has a non-en-US default, swap to the culture-specific
  `new SpeechRecognitionEngine(new CultureInfo("en-US"))` ctor.
