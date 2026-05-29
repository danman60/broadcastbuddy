# Current Work - BroadcastBuddy

## ⭐ MORNING REVIEW — 2026-05-29 (read this first)

**State: GREEN.** tsc 0/0 (node+web) · electron-vite build EXIT 0 · **239 Playwright tests pass** (30 specs, `xvfb-run -a npx playwright test --workers=1`). All work committed + pushed to `main` (remote moved to `broadcastbuddy.git`).

**What shipped overnight (all verified headless unless noted):**
- Fixed the **real overlay bug**: browser source hardcoded the dead `ws://…:9877`; now injects the configured `wsPort` (default 19081) + uses `location.hostname`. (OBS could never connect before.)
- tsc 87→0; PDF import fixed (pdfjs, runtime-verified); 4 CompSync parity features ported (hotkeys, OBS stream-control+replay, system monitor, Stream Deck installer).
- **Stream Deck plugin built** (`bin/plugin.js`) + 7 new actions, statically verified (commands↔wsHub, UUIDs↔manifest 1:1). NOT hardware-validated.
- **9 verified bug-fixes** (7 audit rounds incl. adversarial self-verify): atomic session/recovery writes, brandScraper ReDoS, store-listener idempotency, robust LLM-response parsing, single-instance lock (packaged), + the overlay port fix.
- **r2 multipart upload** (>100MB) — closes the CC >5GB recital-video gap. **NOT runtime-verified (no live R2).**
- CC↔BB integration verified airtight with CommandCentered-2 (CC fixed its WS port `3c2d0cd`); headless CC apply-package E2E added.
- Test suite grew to 177 (overlay state-machine, triggers/session/import/styling/playlist/resilience UI, CC apply, WS hub + auto-hide timer, wave 5-8 IPC, plugin commands). Suite-quality audited (0 critical).

**🔴 NEEDS YOU (hardware / can't headless):**
1. Live OBS walkthrough on FIRMAMENT — install `/mnt/firmament/BroadcastBuddy-Setup-2026-05-28.exe` (⚠️ NOT the stale `…-05-20.exe`). Exercise record/meters/slow-zoom/stream/replay/hotkeys + tablet WiFi + Stream Deck device.
2. Validate r2 multipart with a real >5GB upload.
3. Decisions: delete stale 05-20 installer? · feature-card vs chip · starting-soon media default · chat Supabase project · installer Drive sharing scope.

**Honest caveats:** "tested" = headless surface only. Plugin builds (not hardware-run). Multipart builds (not R2-run). Remote-OBS overlay needs the WS hub bound to 0.0.0.0 (currently 127.0.0.1 — fine for same-machine).

**Gallery findings (audited tonight, NOT fixed — gallery is untestable headless; matching-logic changes need real gallery data to validate):**
- `galleryService.matchPhotos` boundary check is inclusive on both ends (`>= start && <= end`) for exact + gap zones — a photo exactly on a routine boundary could be ambiguous between two routines. Consider half-open windows (`>= start && < end`). DATA-QUALITY (wrong assignment), not a crash.
- `parseHMS` accepts out-of-range times from Gemini (e.g. "99:99:99" → 99h) with no bounds check → could produce wild clock offsets. Add range validation/clamp.
- gallerySlug uses `Date.now().toString(36)` — same-ms + same-title collision possible (rare); consider a random suffix.
- (Verified NON-bugs the audit flagged: the upload loop's file read IS inside try/catch — one bad photo is skipped, not fatal; and `matchedRoutineIndex!` is guarded by the filter. Upload path is safe.)

---

## Session 2026-05-28 (overnight harden + test) — tsc clean, real overlay bug fixed, test suite added

Mission: harden + test the 8-wave parity port (prior session shipped it but NOTHING was runtime-tested). Progress:

### Done
- **graphify index built** (`graphify update .`) — graph tools now answer for this repo (`graphify-out/`, untracked).
- **tsc 87 → 0 errors** (commit `fb999b4`). Root fixes: `target: ES2022` in both tsconfigs (killed ~13 downlevelIteration); completed `src/renderer/types.d.ts` ElectronAPI (~40 missing methods — cc/gallery/wifi/obs/notes/stream); added `animationDuration`/`animationEasing` to all 10 presets; typed `res.json()` bodies in ipc.ts; coalesced optional error/url in GalleryPanel. **electron-vite build stays EXIT 0.** NOTE: tsc is composite — clear `out/**/*.tsbuildinfo` if stale errors reappear.
- **REAL RUNTIME BUG found + fixed** (commit `9fc2a07`): the OBS browser source HTML hardcoded `ws://127.0.0.1:9877`, but the WS hub runs on `server.wsPort` (**default 19081**). The overlay could NEVER connect in the default config — non-functional despite building cleanly. This is exactly the "builds ≠ works" gap. Fix injects the real wsPort + uses `location.hostname` (also unblocks a remote OBS machine, not just 127.0.0.1). Caught by the new headless test.
- **Headless test suite added** (57 passing, `xvfb-run npx playwright test --workers=1`):
  - `tests/overlay-statemachine.spec.ts` — renders `/overlay` in real Chromium, drives state via IPC + raw WS commands, asserts the browser-source DOM reflects pushed state (lower third / ticker / grid / clock / counter / feature card / starting-soon + Stream Deck WS command path). This is a genuine end-to-end test of the passive browser source without OBS.
  - `tests/waves.spec.ts` — wave 5-8 IPC surface; OBS-dependent calls (record, slow zoom) verified to FAIL SOFT (structured error, no throw) when OBS is down.
  - `tests/app.spec.ts` — pre-existing, still passing.
  - Run: `cd ~/projects/BroadcastBuddy && xvfb-run -a npx playwright test --workers=1`. **Must use `--workers=1`** — fixed ports 19080/19081 collide if spec files run in parallel.

### Real bugs found (latent, NOT yet fixed — need decisions)
- **PDF import is broken at runtime.** `documentParser.ts` calls `page.getTextContent()` — that's a pdfjs API; pdf-lib has NO text extraction and will throw on any PDF. Flagged in-code with a comment; behavior unchanged (still throws). DOCX/TXT import paths are fine. To fix: add `pdfjs-dist` and rewrite `parsePDF`. (tsc satisfied via `(page as any)` cast — not a real fix.)
- **`importDocument` returns no `triggers`/`fileName`** — the IPC handler returns `ExtractionResult` only; the renderer reads `result.triggers` defensively (always `[]` on the legacy path). Field-mapping path is the real one. Typed as optional; verify behaviour if the legacy import path is ever used.

### Parity gap re-scan vs CompSyncElectronApp (~v2.8.0) — 5 GENERIC GAPS found (product calls, NOT built)
Prior session claimed "ALL generic gaps ported" — re-scan found these still missing (competition-only items correctly remain excluded). These are net-new features that can't be runtime-verified headless tonight (OBS / global desktop / redesign), so left for user greenlight:
1. **Global hotkeys** (`hotkeys.ts`, S) — OS-level fire/hide/next/record shortcuts that work when app unfocused. Highest operator value.
2. **OBS stream-control + replay-buffer save** (`obs.ts` startStream/stopStream/saveReplay, S) — BB only has Start/Stop *Record*.
3. **System monitor + disk-space alerts** (`systemMonitor.ts`, M) — CPU/RAM/disk-free + low-disk/drive-lost warnings mid-record.
4. **Stream Deck in-app installer** (`streamDeckPlugin.ts`, S) — one-click copy of the bundled `.sdPlugin` (BB ships the folder, manual install only).
5. **Overlay Mode floating panels** (`overlayPanels.ts`, M-L) — always-on-top mini-panels over OBS; generic in concept but CompSync's panel set is routine-coupled — needs redesign, not a straight port.

### Still USER-PENDING (hardware — cannot do headless here)
- Live OBS walkthrough on FIRMAMENT: record control, audio meters, slow zoom + transition revert, overlay elements, starting-soon media.
- Windows installer install + run; tablet WiFi display.
- Chat needs a BB Supabase project + `chat_messages` table before enabling.
- Drive sharing scope for the installer (file id `1zXq94exV3aP8RmDLbICMigBlb1KL-Av1`, still private).

### Session 2026-05-28 (cont.) — PDF fix + 4 parity gaps ported + installer rebuilt
User said "do all". Built everything that can be done without hardware:
- **PDF import fixed (real bug closed)** — `documentParser.parsePDF` now uses `pdfjs-dist` legacy build (real text extraction; pdf-lib had none). VERIFIED at runtime by a test that generates a PDF and asserts extracted text — genuinely works, not just builds. Commit `9efba33`.
- **4 generic parity gaps ported from CompSync** (commit `9efba33`, competition deps stripped):
  - Global hotkeys (`hotkeys.ts`) — fire/hide/next/prev/toggle-record/save-replay via globalShortcut; editable in Settings → "Global Hotkeys"; re-registers on save. Defaults F5/F6/F7/F8/F9/F10.
  - OBS stream control + replay buffer — `obsConnection` startStreaming/stopStreaming/saveReplayBuffer + StreamStateChanged/ReplayBufferSaved events; Start/Stop Stream + Save Replay buttons in StreamInfoPanel.
  - System monitor (`systemMonitor.ts`) — CPU/RAM/disk poll (pure os/fs, no deps, watches Videos dir) + low-disk/drive-lost alerts; "System" panel in right column.
  - Stream Deck in-app installer (`streamDeckPlugin.ts`, Windows-only) — one-click copy of bundled `.sdPlugin`; "Stream Deck Plugin" section in Settings; plugin added to electron-builder extraResources.
  - **Overlay Mode (5th gap) deliberately NOT ported** — CompSync's panel set is routine-coupled; needs redesign, a straight port would be wrong.
- **62 Playwright tests pass** (added stream-control/system/streamdeck/PDF tests). tsc 0/0. build EXIT 0.
- **NOT runtime-verified against live OBS** — stream control, replay save, and hotkeys' record actions need a real OBS + desktop; user-pending on FIRMAMENT.
- **Stream Deck plugin caveat:** the bundled `.sdPlugin` is manifest+PI only (no built `bin/plugin.js`). The installer works (copies the folder) but the plugin itself may need a full SDK build to be fully functional — follow-up.
- **Installer rebuilt + staged** with ALL of tonight's fixes (overlay WS-port fix + PDF + 4 features): `/mnt/firmament/BroadcastBuddy-Setup-2026-05-28.exe` (112MB, NSIS via wine on native Ubuntu). **INSTALL THIS ONE.** ⚠️ The old `/mnt/firmament/BroadcastBuddy-Setup-2026-05-20.exe` (96MB) is STALE — it has the broken overlay WS port (won't connect to OBS). Delete or ignore it. Local copy: `release/BroadcastBuddy Setup 1.0.0.exe`.

### CC↔BB integration verified airtight (2026-05-28, collab with CommandCentered-2)
Cross-checked BB's 7 CC calls against CC's LIVE code (not docs). Result: aligned, BB needs ZERO code changes.
- All endpoints under `/api/v1/broadcast-package` (headers `X-API-Key` + `X-Tenant-Id`):
  1. `GET /broadcast-package` → events ARRAY (top-level, NOT wrapped). NO `/events` route — package root IS the list. CC filters to status CONFIRMED/SCHEDULED/IN_PROGRESS/BOOKED AND loadInTime≥now.
  2. `GET /broadcast-package/:eventId` → `{success,data:<pkg>}` (BB unwraps `data||body`). All BB fields emitted. `streaming.livestreamUrl/embedCode` can be NULL (BB coalesces). CC upgrade `1e09783`: streaming.streamKey/rtmpUrl now prefer linked StreamEvent CF keys — transparent to BB.
  3. `POST /broadcast-package/upload` (multipart file+eventId+fileName?) → `{success,file:{webViewLink}}`. Needs a Drive folder + SA on CC; missing → 400/500 (BB surfaces error).
  4. `GET /:eventId/checklist` → `{success,data:CCChecklistItem[]}`.
  5. `PUT /:eventId/checklist` body `{items:[{id,checked}]}` → `{success,updated:<count-sent>}`.
  6. `PUT /:eventId/overlay-config` body = RAW overlay object (NO `{config}` wrapper). BB already does this (ipc.ts:726 PUT + raw `state.lowerThird.styling`). Round-trips raw both ways.
  7. WS push CC→BB: `{type:'broadcast_package', data:<pkg>}` on `ws://<host>:19081`. CC fixed its dead-9877 default → 19081 in commit **`3c2d0cd`** (pushed). Same-LAN/co-located only; pull (#1/#2) is the cross-host path.
- Auth: single shared `BROADCAST_BUDDY_API_KEY`, client-supplied tenant (no key↔tenant binding). Fine for now.

### Session 2026-05-28 (cont.) — Stream Deck plugin built + full E2E suite (112 tests)
- **Stream Deck plugin BUILT** (commit `77d3cae`) — was source-only, never compiled. Ran rollup → `bin/plugin.js` (168KB, committed so the installer bundles a known-good artifact). Added 7 CompSync-parity actions (record, stream, save-replay, clock, counter, feature-up-next, feature-that-was), each wired to a NEW `wsHub` command (toggleRecord/saveReplay/toggleStream → OBS fail-soft; toggleClock/toggleCounter/featureUpNext/featureThatWas → overlay). Existing actions (fire/hide/toggle-lt/next/prev/next-full/toggle-ticker/up-next/that-was/grid/slow-zoom) already mapped to existing commands. Plugin is now bundled by electron-builder extraResources. NOT hardware-validated — builds only.
- **Full E2E suite — 112 tests, all green** (xvfb, `--workers=1`), 9 specs: app, overlay-statemachine, waves, + 6 new (triggers-ui, session-roundtrip, import-flow, styling-presets, playlist, resilience-ui). Covers trigger CRUD/reorder (UI+IPC), session round-trip, doc import (TXT+PDF), presets/styling, playlist + loop modes, operator-resilience UI, stream control, system monitor, streamdeck status. Authored against live source → green on first run, no fix-loop iterations needed.
- **Plugin WS command path verified headlessly** (+4 tests in overlay-statemachine.spec): `toggleClock`/`toggleCounter`/`featureUpNext` drive the overlay via the WS command path (the plugin's transport); OBS-backed commands (`toggleRecord`/`saveReplay`/`toggleStream`) asserted fail-soft (hub stays alive, OBS down). **Total now 116 tests, all green.**
- **"100%" caveat:** 100% of the HEADLESS-testable surface. Live OBS / tablet WiFi / Stream Deck hardware still cannot be tested here — user-pending on FIRMAMENT.
- Disk: the plugin npm install briefly hit ENOSPC during the build but it was transient (cache clean fixed it). `/` has ~18G free — healthy. Cleared local `release/win-unpacked` (415M) post-build.

### Session 2026-05-29 (overnight cont.) — bug-hunt fixes + coverage to 172
- **Headless CC apply-package E2E** (+6, cc-integration.spec) — synthetic BroadcastPackage through ccApplyPackage proves trigger conversion, streaming, accent fallback, overlayConfig, null-safety. No live CC needed.
- **Plugin WS command path verified** (+4 in overlay-statemachine) — toggleClock/toggleCounter/featureUpNext drive overlay; OBS commands fail soft. Plugin statically verified: 19 sent commands all ∈ wsHub handled set; 19 manifest UUIDs ↔ 19 action classes (decorators match).
- **Full-codebase bug-hunt (4 parallel auditors) → 4 verified fixes** (rest triaged as non-bugs):
  - `fsAtomic.writeFileAtomic` (temp+fsync+rename) for `saveSession` + `writeSnapshot` — crash-mid-write no longer truncates session/recovery JSON.
  - brandScraper ReDoS — bounded all logo-regex quantifiers + 3MB HTML cap (200k pathological input: multi-sec → 0ms; main process no longer freezes on a hostile page).
  - `initStoreListeners` idempotent — RecoveryBanner.restore re-called it → store listeners double-registered in prod (every push fired twice). Now clears first.
  - Non-bugs ruled out: overlay missing-notifyChange (renderer uses IPC return), WS state injection (hub ignores client state), handleCommand throw (wrapped in try/catch), BroadcastPackagePanel/RecordingUploadPanel cleanups (already correct), session/recovery reads (already guarded).
- **5 new UI specs (+50 → 172 total):** overlay-controls, starting-soon-media, logo-ticker, animation-panel, daychecklist-ui. Fixed 2 first-run test bugs (daychecklist dismissed-state persistence bleed; ambiguous "Show" selector).
- **172 Playwright tests pass** (14 specs, xvfb, workers=1).
- **More bug-hunt rounds (import pipeline + core index/ipc) → 3 more fixes:**
  - llmService: robust LLM-response parsing (`parseLlmArray` strips fences anywhere + slices to outermost `[...]` + clear error on bad JSON; verified on raw/fenced/prose/invalid) + empty-doc guard + 40k input cap. FieldMapper transforms audited — already graceful, no fix.
  - `index.ts`: single-instance lock (packaged only) — 2nd launch would fail to bind 19080/19081; now focuses existing window. Gated so the test harness's many instances are unaffected.
  - Core index/ipc audit otherwise CLEAN (slowZoom order, selectTrigger bounds, CC-apply broadcast all verified fine).
- **r2Upload multipart** (>100MB) — closes the CC-flagged >5GB recital-video gap (single PUT caps at 5GB). CreateMultipartUpload → 100MB part loop → Complete, Abort on error. **NOT runtime-verified (no live R2 >5GB upload)** — validate on FIRMAMENT.

### Build / test status
electron-vite build EXIT 0 · tsc --noEmit EXIT 0 (node + web) · Playwright **172 passed / 0 failed** (xvfb, workers=1, 14 specs).

---

## Last Session Summary (2026-05-20 → 05-22)
**Full CompSyncElectronApp → BroadcastBuddy parity port — DONE.** Brought BB to parity with the field-hardened features in CompSyncElectronApp (user calls it "CS Controller" colloquially; source-of-truth Electron repo is `~/projects/CompSyncElectronApp`; `~/projects/CSController` is the Android tablet receiver). Strategy: ported features directly into BB (extract shared packages later). Shipped 8 waves + starting-soon media, all committed and pushed to `main` (`d07d711` → `3ccc21c`, then `bb83367`). Built a Windows NSIS installer on Linux+wine (96MB, bundles wifi-display-server.exe + DLLs), staged to `/mnt/firmament/BroadcastBuddy-Setup-2026-05-20.exe` AND uploaded to Google Drive (file id `1zXq94exV3aP8RmDLbICMigBlb1KL-Av1`, currently PRIVATE — sharing scope not yet chosen). CSController dual-source committed + pushed (`2f7798e`, master).

**HARD CAVEAT: nothing is runtime-tested.** Every wave passes `electron-vite build` and the installer packages cleanly, but no feature has run against live OBS / a tablet / a Supabase project / an SD card. Build correctness ≠ feature correctness.

### Next Steps (priority order)
1. **Windows runtime test** — install the FIRMAMENT/Drive exe on Windows, connect OBS, walk through: record start/stop, audio meters, slow zoom + transition revert, lower-third/clock/counter/feature-card/grid, starting-soon media, WiFi display to a tablet. This is the gap between "compiles" and "works." Use `/test-electron` or QA agent.
2. **Choose Drive sharing scope** for the installer (currently private, file id `1zXq94exV3aP8RmDLbICMigBlb1KL-Av1`): link-shareable / specific emails / move to a folder.
3. **Chat enablement** (only if wanted) — create a BB Supabase project + `chat_messages` table (schema in `src/main/services/chatBridge.ts` header), then fill chatConfig in Settings.
4. **Separate BB-branded APK** — future task (user said "eventually"). Fork CSController → new package id/name/icon. Not now.
5. **Two open product calls:** keep feature-card AND chip (currently coexist) or pick one; whether corporate wants the heavier starting-soon media (sponsor carousel etc., already built but off by default).

### Gotchas for Next Session
- **Nothing runtime-tested** — don't report any ported feature as "working", only "builds".
- BB has no GitNexus index (`.gitnexus/` absent) — graph tools won't answer for this repo until `npx gitnexus analyze` is run.
- `tsc --noEmit` shows ~30+ PRE-EXISTING errors (incomplete `types.d.ts`, `downlevelIteration` Map/Set loops, `presets.ts`) — the project gates on `electron-vite`/esbuild, NOT tsc. Don't chase those as new breakage.
- Installer was built with `npx electron-builder --win nsis` on **native Ubuntu via wine** — it works, no Windows box needed for packaging.
- CSController commit `2f7798e` bundled prior-session work (VideoCodec, RemoteLogger, tabletLogPort) with my dual-source change — they were entangled in the same files; APK builds clean combined.
- `INBOX.md` in BB has a pre-existing uncommitted modification NOT from this session — left untouched.

**Original wave-1 detail (kept for reference):**

Ported wifiDisplay.ts (~500 LOC) + tabletLogServer.ts (~160 LOC) from CompSync. Wired into BB main/preload/ipc/renderer. Added Tablet button to Header (one-tap stop→start→ping recovery). Added full WiFi display section to Settings (monitor select, bitrate, fps, encoder, ports, client IP, autostart, Ping Tablet button). Copied wifi-display-server.exe + 3 mingw DLLs into BB resources/ and added extraResources to electron-builder. TypeScript build clean (656K out, no errors).

CSController APK made dual-source aware: discovery payload's optional new `app` field tells the tablet which host found it. Defaults to "CompSync" when absent so existing CompSync hosts work unchanged. BB sends `app: "BroadcastBuddy"`. UI strings on ConnectionScreen genericized ("CompSync Remote Control" → "Tablet Remote Control"; "Searching for CompSync..." → "Searching for host (CompSync / BroadcastBuddy)..."; "Server Found" → "${srv.app} Found").

## Wave Plan (port order from CompSyncElectronApp) — ALL WAVES DONE 2026-05-20
1. **DONE** WiFi display + tablet pack (committed `d07d711`)
2. **DONE** Slow zoom + transition revert — slowZoom.ts (wide/tight scene toggle via OBS Move Transition), obsConnection.ts auto-revert-to-Cut state machine (500ms settle after any non-Cut transition end). OverlayControls buttons + Revert pill. Settings live in electron-store (no Settings UI section yet — operator edits scene/transition names via JSON; deferred follow-up).
3. **DONE** Photo pipeline hardening — faststart mp4 (ffmpegFaststart.ts), import dedup manifest (importManifest.ts), clock-offset sanity (year-range reject + 24h cap), lightweight 2-tier priority upload. SKIPPED: child-process upload (reserved flag `r2Config.useChildProcessUpload`, not wired — needs v4 signer or worker AWS bundle); full per-routine round-robin photo tier (too coupled to CompSync jobQueue).
4. **DONE** Chat + pinning — chatBridge.ts (Supabase Realtime, config-injected, OFF by default; no-ops without config), ChatPanel.tsx, Settings "Operator Chat" group. Pinning fires message as lower-third. Needs a BB Supabase project + `chat_messages` table (schema in chatBridge.ts header comment) before it can be enabled.

Bonus (same session): Up Next / That Was buttons (fire neighbour trigger with label chip, no playlist advance); 8 richer OverlayStyling fields (text-transform, letter-spacing, separate subtitle styling, shadow/glow, label colors, 100–900 weights); overlay leveling grid (rule-of-thirds + diagonals + crosshair, toggle button, default off).

Still deferred (domain-divergent, need Programme/Trigger abstraction): routine-aware cut/next, routine-window photo sync (the deep CompSync versions). Up-next/that-was shipped in the lightweight trigger-neighbour form.

## Parity ports waves 5-8 (DONE 2026-05-20, committed aa1d549/6ff87e0/e329c79/524b885)
After a full feature-parity scan vs CompSyncElectronApp, ported ALL generic-value gaps (skipped competition-only items like ffmpeg track-splitting, media reconciler, take state machine, tethered/WPD ingest, comp-state drift — those are dead code in BB's recital/corporate domain).

- **Wave 5** OBS record control (start/stop/toggle/status + RecordStateChanged push; REC button in Header with live timecode) + audio meters (InputVolumeMeters subscription, bitmask 65613, AudioMeters component, dBFS bars + peak hold).
- **Wave 6** Operator resilience: events.ts (durable JSONL event stream + EventLogPanel), crashRecovery.ts (dirty-marker + 30s snapshot + RecoveryBanner), startup.ts (runStartupChecks + StartupToast), backup.ts (hourly settings backups + Settings restore UI).
- **Wave 7** Overlay elements: on-air clock, counter badge (pop-in, optional sync to trigger order), full-screen feature card (kicker/title/subtitle/logo, slide/fade/zoom + sparkle; up-next/that-was populate from neighbour trigger). Existing wave-4 chip left intact.
- **Wave 8** Day checklist (per-day operator start/end-of-day, auto-shows start-of-day on new calendar day), chat moderation (hide/ban-author/livestream-pin), Stream Deck plugin (port fixed to 19081, up-next/that-was/grid/slow-zoom actions + property inspector + README; wsHub gained slowZoomWide/Tight commands).

## Still NOT done / deferred
- **Don't-port (competition-only):** ffmpeg multi-judge track-split, media reconciler, take/re-rec state machine, tethered camera + WPD/MTP, live drive-monitor folder watch, comp-state drift, control-room bridge, EXIF/matcher worker pools. Correctly absent from BB.
- **Open judgment calls (user to decide):** starting-soon media stack (sponsor carousel/social bar/visualizer — corporate MIGHT want); whether the feature card replaces or coexists with the chip (currently coexist).
- **Stream Deck plugin** static action PNGs are placeholders (buttons render via SVG setImage at runtime; cosmetic only). Plugin not added to electron-builder extraResources (optional, noted in its README).
- **child-process upload** still a reserved flag, not wired (needs v4 signer).

## Build / test status
electron-vite build clean (EXIT 0) after every wave. NSIS installer built on Linux+wine (96MB, bundles wifi-display-server.exe + 3 mingw DLLs in resources). Copied to `/mnt/firmament/BroadcastBuddy-Setup-2026-05-20.exe` (stale Mar-29 build also still at FIRMAMENT root, untouched).

STILL NOTHING runtime-tested. To verify: install the FIRMAMENT exe on Windows, connect OBS, exercise record control / audio meters / slow zoom / transition revert / overlay elements / starting-soon media. Chat needs a BB Supabase project + `chat_messages` table. Photo hardening needs an SD import. No QA-agent run yet. Build correctness ≠ feature correctness.

## Also done this session
- Starting-soon pre-show media (sponsor carousel, slideshow, social bar, welcome) — commit `bb83367`. Audio visualizer deferred.
- CSController committed + pushed (`2f7798e`, master): dual-source + codec selection + remote logging (bundled prior-session work).
- Windows NSIS installer built + staged to FIRMAMENT.

## Last Session Before This (Gallery v2)
Gallery Builder pipeline upgrade + first event processing for 7Attitudes recital. Replaced broken Gemini/CC-API pipeline with transcription + direct R2 upload. Processed 7,214 photos into 53 routines, fixed OCR and matching bugs, generated thumbnails, coordinated with CC and Remotion sessions.

## What Changed (this session, WiFi display port)
- `src/main/services/wifiDisplay.ts` — NEW, ~500 LOC ported from CompSync. UDP discovery (port 5002, type `compsync-discover` payload with new `app: "BroadcastBuddy"` field), child-process supervision of wifi-display-server.exe, capture-error watchdog (5/7s → auto-restart, cap 3), unexpected-exit auto-restart (cap 3), topology-change debounce restart, tablet IP drift one-shot adoption, pre-spawn taskkill of stale binary to free UDP 5000/5001, Windows ABOVENORMAL priority bump, opt-in HEVC NVENC (off by default, no bundled ffmpeg yet).
- `src/main/services/tabletLogServer.ts` — NEW, ~160 LOC. POST `/tablet-log` on `0.0.0.0:8766` ingests batched Android log lines into electron-log with `[tablet:<host>]` prefix.
- `src/shared/types.ts` — added `MonitorInfo`, `WifiDisplayState`, `WifiDisplaySettings`, `DEFAULT_WIFI_DISPLAY`; extended `AppSettings.wifiDisplay`; added 6 IPC channels (`WIFI_DISPLAY_*` + `PING_TABLET`).
- `src/main/services/settings.ts` — `wifiDisplay` default block; added `getSettings()`/`setSettings()` convenience wrappers so future CompSync-port code lands with no rewrite.
- `src/main/index.ts` — imports + wiring: `wifiDisplay.killOrphanedProcess()` early, `startTabletLogServer()` + auto-start during `whenReady`, `cleanup` + `stopTabletLogServer` on `before-quit`.
- `src/main/ipc.ts` — 6 handlers (GET_MONITORS, START, STOP, STATUS, SET_MONITOR, PING_TABLET).
- `src/preload/index.ts` — matching `wifiDisplay*` bridge methods.
- `src/renderer/components/Header.tsx` — Tablet button (green dot=running, amber=stopped). Click = stop → start → ping. Falls back to opening Settings if no monitor configured.
- `src/renderer/components/Settings.tsx` — Tablet Display section with monitor select / bitrate / fps / encoder / IP / ports / autostart / Start-Stop-Ping controls.
- `resources/wifi-display-server.exe` + `libstdc++-6.dll` + `libgcc_s_seh-1.dll` + `libwinpthread-1.dll` — copied from CompSync (5.8MB exe + 27MB DLLs).
- `package.json` — `build.extraResources` added so electron-builder bundles the binary + DLLs into the installer.

CSController repo (`~/projects/CSController`):
- `app/src/main/java/com/compsync/controller/ui/ConnectionScreen.kt` — `DiscoveredServer` gained `app: String = "CompSync"`. JSON parsed via `obj.optString("app", "CompSync")` so old payloads still work. Three display strings genericized for dual-source.

**CSController NOT committed.** When I went to commit, the working tree had ~8 files with substantial prior uncommitted work from a prior session (VideoCodec enum + selector UI, RemoteLogger.kt extraction, tabletLogPort wiring across MainActivity/DisplayScreen/TouchSender/UdpReceiver/build.gradle.kts/AndroidManifest, plus VideoDecoder.kt enum addition). The dual-source `app` field landed inside ConnectionScreen.kt which already had pending VideoCodec changes. The combined working tree builds clean (APK = 9.6MB, `BUILD SUCCESSFUL in 1m44s`) but committing only my line would break HEAD because it would reference VideoCodec which isn't in HEAD yet. Punted on splitting — user should review `git status` in `~/projects/CSController` and commit the coordinated set themselves (probably as separate commits per logical change, with mine being one line plus three display strings).

## Previous Session
- `ac48b61` Gallery pipeline v2 — r2Upload.ts, audioTranscription.ts, density-jump offset, gap matching, R2 settings UI, GalleryPanel transcription flow (10 files)
- `721a876` Retrospective + runbook updates (4 files)
- [DB only] 18 gallery_sections updated with corrected performer/choreographer data
- [DB only] 7,143 gallery_media rows re-inserted with gap-based section assignments
- [DB only] 7,214 thumbnail_r2_key values set
- [R2 only] 7,214 thumbnails uploaded to `{dir}/thumbs/{filename}`

## Build Status
PASSING — tsc clean, electron-vite build clean (main 168ms, preload 15ms, renderer 406ms)

## Known Bugs & Issues
- `src/main/services/galleryService.ts:220` matchPhotos() still uses timestamp-based matching. The gap-detection method was done in Python externally. Need to port gap detection into the app's matchPhotos() function.
- `src/main/services/audioTranscription.ts` — requires system Python 3.10+ with faster-whisper. No detection/error message if missing on Windows.
- `recital-clock-offset.json` on FIRMAMENT still has wrong value (0s). Not used by app but could confuse future sessions.
- CC bulk-register endpoint doesn't exist yet — app's uploadToCC() still has the old sequential CC API path

## Incomplete Work
- `src/main/services/r2Upload.ts` — needs multipart upload for files > 5GB (CC-2 inbox request). Current PutObject caps at 5GB. Recital MKVs are 10-11GB each.
- `src/renderer/components/GalleryPanel.tsx` — UI has transcription step wired but the full v2 pipeline orchestrator (GALLERY_RUN_PIPELINE_V2 IPC) is not implemented yet
- Gallery not published yet — CC-2 finished page refactor, waiting on Dan's preview approval

## Tests
- No automated tests (project uses QA agent for E2E testing)
- App not tested on Windows yet — installer built but pipeline untested end-to-end

## Next Steps (priority order)
1. **Add multipart upload to r2Upload.ts** — CreateMultipartUpload + UploadPart + CompleteMultipartUpload for video files > 5GB. Progress callback per chunk.
2. **Port gap detection into app** — replace timestamp matching in matchPhotos() with the proven gap-based algorithm
3. **Implement GALLERY_RUN_PIPELINE_V2** — full orchestrator: transcribe → EXIF → gap-match → R2 upload → CC register
4. **Preview and publish gallery** — review gallery.streamstage.live/spring-recital-2026
5. **Windows end-to-end test** — build installer on FIRMAMENT, install, run pipeline with test data
6. **CC bulk-register endpoint** — collab with CC for POST /api/v1/gallery/{id}/media/bulk-register

## Gotchas for Next Session
- SD card on FIRMAMENT N: drive may or may not be mounted — check before accessing
- R2 credentials are in `~/.env.keys` on SpyBalloon, also configured via rclone on FIRMAMENT
- Gallery ID: `bb4123c5-0c81-44f4-96ac-cea125926682`, tenant: `00000000-0000-0000-0000-000000000001`
- CC gallery tables are in `commandcentered` schema (not `public`) — always query explicitly
- `recital-clock-offset.json` is WRONG (says 0s, actual is +486s) — don't trust it
- RemotionVideo-1 session was rendering 53 ProRes overlays + DaVinci Resolve Lua markers — check if complete
- Collab relay daemon may need restart if sessions were closed

## Files Touched This Session
- `src/main/services/r2Upload.ts` — NEW (S3 upload, thumbnails, batch)
- `src/main/services/audioTranscription.ts` — NEW (ffmpeg, faster-whisper, announcements)
- `src/main/services/galleryService.ts` — density-jump offset, pre-show/intermission matching
- `src/main/services/settings.ts` — r2Config defaults
- `src/main/ipc.ts` — 3 new handlers (browse-videos, transcribe, upload-r2)
- `src/preload/index.ts` — 3 new bridge methods
- `src/shared/types.ts` — R2Config, TranscriptSegment, expanded GalleryConfig/PhotoMatch/IPC
- `src/renderer/components/GalleryPanel.tsx` — transcription-first UI
- `src/renderer/components/Settings.tsx` — R2 credentials panel
- `package.json` — @aws-sdk/client-s3, sharp
- `docs/plans/2026-03-30-gallery-retrospective.md` — NEW (full post-mortem)
- `docs/plans/2026-03-30-gallery-runbook.md` — updated with all corrections
- `docs/plans/2026-03-30-gallery-automation-spec.md` — NEW (pipeline spec)
