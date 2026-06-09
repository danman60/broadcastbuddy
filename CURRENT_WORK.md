# Current Work - BroadcastBuddy

## Last Session Summary (2026-06-05 → 06-06, marathon operator-feedback session)
Resolved a 12-item operator punch list, then iterated live on DART through ~20 more fixes from rapid user feedback (UI, brand kit, Stream Deck plugin, CC integration, tablet, overlay editor). API key for CC integration fully resolved end-to-end. Session ended with DART unreachable (tailscale down) → 3 commits queued for deploy. New task surfaced at the very end (compsync.net dashboard loading-flash) — NOT started.

## Build Status
PASSING — every commit tsc-clean + electron-vite build clean (verified per-commit in subagents).

## What Changed (commits b8172ee → 3c06a67, all on main, pushed)
- `b8172ee` 12-item punch list (SD ws-bundle, tablet wsHub vocab, CC apply persist+chat-arm, feature-card logo, SS editor port, stream key persist, sidebar resize, meters→top-bar, Load-menu CC events, elevation manifest)
- `0081666` hide native File/Edit menu
- `636e74f` remove Counter + OBS-Camera UI groups; cards→client logo; SS-preview-black fix
- `38b8944` ticker z-index 70 (over cards/SS); ad-hoc already brand-consistent
- `3217ad4` **SD plugin icons** (was invisible in SD catalog — missing imgs/ was the real "no BroadcastBuddy in Stream Deck" cause, separate from the ws crash)
- `6d768d2` **Brand Kit #17** (scored color extraction via og:image/sharp, Apply Brand Kit, Create Preset, Import Logo)
- `b948854` **CC→BB styling sync #18** (BB side: applies overlayConfig.styling on apply)
- `7dc042d` SD plugin: no host/port PI prompt, empty key titles, bigger icon text
- `fe4b2bd` tighten Playlist Controls (7 blocks → 6 rows)
- `6d62003` **Supabase realtime ws transport fix** (cc:apply-package was throwing — Electron Node 20 has no global WebSocket) + reorderTriggers persist
- `002485e` brand kit themes SS gradient + feature-card bg/font/accent + tenant+client logos on SS/cards
- `85d2bd3` Live Control 2-col layout (Playlist left | Edit Entry + Quick Lower-Third right); ad-hoc relabel "Quick Lower-Third"
- `bcf62d1` overlay editor drag: local-during-drag + commit-once-on-mouseup (was per-frame IPC → flash + lost pos); VisualEditor focus-once
- `fe86b82` SD Cycle Transition action (CSE parity)
- `3c06a67` wifi-display VDD hard-pin (WIFI_DISPLAY_VDD_MATCH env)

## DEPLOY STATE (CRITICAL)
- **DART last good build = `85d2bd3`** (swapped + relaunched 2026-06-06 ~08:00, config intact key=`bb_fb6dd…`).
- **DART UNREACHABLE since ~08:36 2026-06-06** — `ssh dart` (tailscale 100.90.103.121) times out. Tablet uses LAN (.133) so DART itself likely up; only tailscale SSH path down.
- **3 commits NOT YET on DART** (blocked on DART reachability): `bcf62d1` editor-drag, `fe86b82` SD cycle-transition, `3c06a67` VDD pin.
- **When DART back:** `cd C:\Users\User\projects\BroadcastBuddy; git pull; npm run dist:installer` → taskkill BB → robocopy `release\win-unpacked` → `C:\Program Files\BroadcastBuddy` → `schtasks /run /tn LaunchBroadcastBuddy`. For SD plugin (cycle-transition icon/manifest): also robocopy the .sdPlugin imgs+manifest to `%APPDATA%\Elgato\StreamDeck\Plugins\com.broadcastbuddy.streamdeck.sdPlugin\` + restart Stream Deck.

## CC API KEY — RESOLVED
- Vercel `BROADCAST_BUDDY_API_KEY` set = `bb_fb6dd8a9147479873d29bc01ae85ec4a9ea2ffa052dd5624` (was UNSET in prod). Set via `vercel env add` using VERCEL_TOKEN from ~/.env.keys.
- Redeployed prod + **aliased `tickets.streamstage.live` → new deployment** (it was serving stale build). `tickets` now returns 200 + 13 events incl KMSD HANOVER.
- BB DART config ccConfig.apiKey = same key. So load-events works on DART (build `85d2bd3` has Load-menu CC events).

## Known Bugs & Open Items
- **CompSync web (demo.compsync.net/dashboard) triple loading-flash** — blank/unstyled theme → skeleton → branded app; user wants ONE loading state (FOUC/hydration/theme-flash). NOT STARTED. Need to find the CompPortal/CompSync-web repo first (NOT this repo, NOT CommandCentered, NOT CompSyncElectronApp — it's the web app on compsync.net, likely "CompPortal"). User interrupted repo-search to wrap up.
- **Trigger-list performer-name overflow** — long performer names run off right edge in TriggerList; user flagged, asked wrap/collapse/hide — UNANSWERED, not done.
- **CC #18 styling-push code** committed LOCAL on CommandCentered branch `feat/grd-gallery-light-variant` (commit `60cd7f9`), NOT pushed (pushing → CC prod deploy, user's gate). Needs merge to main + deploy for brand styling to flow from CC.
- **Tablet tap-to-switch (VDD multiview)** — likely fixed by `3c06a67` (VDD pin) + elevation, but UNVERIFIED on site (DART down). When up: read server log line `Touch target LOCKED … reason: env WIFI_DISPLAY_VDD_MATCH / VDD heuristic match` to confirm it locks to the VDD not a real monitor.

## Gotchas for Next Session
- **NEVER write DART config.json with UTF-8 BOM** (PowerShell `Set-Content -Encoding UTF8` adds one → BB resets all settings to defaults). Use `[IO.File]::WriteAllText($p,$json,(New-Object Text.UTF8Encoding($false)))`. BB keeps hourly backups in `%APPDATA%\broadcast-buddy\backups\`.
- **Use graphify, not grep** for code exploration (repo is graphed).
- DART deploy = build on DART (`C:\Users\User\projects\BroadcastBuddy`, NOT D:), in-place robocopy over `C:\Program Files\BroadcastBuddy`, relaunch via `LaunchBroadcastBuddy` scheduled task (interactive, needs user logged in).
- BB now ships `requestedExecutionLevel: requireAdministrator` → always elevated → child wifi-display-server elevated (UIPI: required for tap injection into elevated OBS).

## Next Steps (priority order)
1. **When DART/tailscale back:** deploy the 3 queued commits (bcf62d1, fe86b82, 3c06a67) + SD plugin copy + restart SD; verify tablet tap (VDD log line), overlay-editor drag, cycle-transition button.
2. **compsync.net dashboard loading-flash** — find CompPortal/CompSync-web repo, fix the FOUC→skeleton→app triple state into one (likely: SSR/inline theme before paint + single skeleton).
3. Answer trigger-list performer-name overflow → implement.
4. CC: merge `60cd7f9` to main + deploy so brand styling pushes from CC (#18 end-to-end).

## Files Touched This Session (BB)
src/main: ipc.ts, services/{overlay,overlaySource,chatBridge,ccRelay,wifiDisplay,settings}.ts, index.ts
src/renderer: components/{App,Header,OverlayControls,OverlayPreview,AdhocPanel,LogoManager,BrandScraperPanel,TemplateGallery,StartingSoonEditor,VisualEditor,AudioMeters,SystemStats,StartingSoonPanel}.tsx, store/useStore.ts, styles/{app,header,controls,adhoc,preview,brandscraper,templates,startingSoon,startingSoonEditor}.css
src/shared: types.ts, brandKit.ts (new), presets.ts
src/preload: index.ts; src/renderer/types.d.ts
streamdeck-plugin: rollup.config.mjs, package.json, src/plugin.ts, src/connection.ts, src/actions/cycle-transition.ts (new), manifest.json + imgs/ (new icons), bin/plugin.js
package.json (win requireAdministrator)
CommandCentered (separate repo): app/src/server/routers/broadcastPackage.ts (commit 60cd7f9, on feature branch, NOT pushed)
