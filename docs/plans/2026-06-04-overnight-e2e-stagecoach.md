# BroadcastBuddy — Overnight Live E2E (StageCoach) — 2026-06-04

Live target: DART over tailscale `100.90.103.121` (overlay HTTP 19080, WS hub 19081).
Deployed build: HEAD `1db3bff` (debounced overlay auto-save). Test client: **STAGECOACH GLOBAL** (`afd8f472`). The CC event has 0 broadcast_triggers in the DB; rather than mutate prod, the driver builds a **synthetic 16-routine StageCoach package** (mixed trigger types) in-memory and pushes it over the documented CC→BB WS path (`{type:'broadcast_package'}`) — the same payload shape CC's relay/push sends. **No CC DB writes, no cleanup needed.** The CC-API *pull* path (GET `/broadcast-package/:id`) is renderer-initiated (BroadcastPackagePanel button) and cannot be triggered remotely; it is covered functionally by the headless `cc-integration` spec.
Driver: `_overnight-driver.mjs` (gitignored) drives WS + screenshots live overlay via Playwright chromium.

## Results summary

| Phase | Scope | Result |
|---|---|---|
| 1 — CC→BB apply (live) | WS `broadcast_package` push → renderer auto-applies | **3/3 PASS** · 16/16 triggers loaded, styling+accent applied |
| 2a — Lower-third animations (live) | all 9 (slide/fade/zoom/rise/typewriter/bounce/split/blur/sparkle) | **9/9 PASS** · each fires, animation+text+accent render |
| 2b — Overlay elements (live) | next/next-full, up-next/that-was chips, clock, counter, ticker, grid, feature up-next/that-was | **14/14 PASS** |
| 3 — Auto-save (live) | set marker styling via package, check DART session file | **marker set live; NOT persisted — see Finding 1** |
| 4 — Control-UI headless suite | full Playwright Electron suite | **273/273 PASS** (3.2m) |
| 5 — Auto-save persistence test | `tests/autosave-persistence.spec.ts` | **2/2 PASS** — persists with session; guard holds without |
| 6 — UI layout screenshots | 11 panels + montage | **captured** (`/tmp/bb-overnight/ui/`), montage DM'd |

Auto-save spec confirms Finding 1 exactly: WITH a session loaded, `overlay:update-styling` → animation/accent persist to `userData/sessions/<id>.json` after the 800ms debounce. WITHOUT a session, no file is written (guard holds). Feature is correct; it just never engages in the live no-session workflow.

## UI layout verdict — PASS (coherent)
Navy (#0a0e1a / #141a2b) + violet accent system applied consistently across all 11 panels (main control, content/styling, broadcast/delivery, monitoring, settings, brand kit, import, day checklist, visual editor, compact). Button tiers consistent (Fire=green filled, Hide=red, ON=filled/OFF=ghost), labeled control rows, grouped playlist (Session A/B). Renderer is one continuous scrolling right column (not tabbed); modal views via Header gear/Tools.
Polish nits (minor): (a) live OverlayPreview area renders empty when nothing fired/selected; (b) Startup-checks toast (R2 + Command Center "not configured") persists bottom-right across views — slightly intrusive; (c) Up Next/That Was buttons render disabled until a trigger is selected (ties to Finding 2).

Live overlay verified by screenshot (montages DM'd): lower-thirds render StageCoach content in the magenta-gradient card with accent; feature card renders full-screen ("UP NEXT / Clair de Lune / Junior Ballet").

## Findings

### 1. (HIGH / design gap) Auto-save inert in the live boot+CC-apply workflow
- Shipped fix: `overlay.ts notifyChange()` → debounced `saveSession`, guarded `if (!getCurrentSession()) return`.
- Live BB startup (`index.ts whenReady`) does NOT auto-load a session — only offers crash-recovery. `CC_APPLY_PACKAGE` does not create a session either.
- So on a normal boot where the operator applies a CC package (the real StageCoach workflow), `currentSession === null` → the guard skips → **edits never persist.** DART session file remains the March one (`anim=zoom`, mtime 2026-03-07).
- The guard matches the original task spec, but the underlying complaint ("edits don't persist across restart") is only fixed when a session is manually loaded first.
- **Fix candidates:** (a) auto-load most-recent session on startup (`getMostRecentSession` → `loadSessionState` + `setCurrentSession`); or (b) auto-create/adopt a session on `CC_APPLY_PACKAGE` (name from `pkg.client.name`/event) so there is always a session to persist into. (a)+(b) together is safest.

### 2. (MINOR UX) Empty lower-third after CC apply until a trigger is selected
- `CC_APPLY_PACKAGE` → `clearAllTriggers()` sets `selectedIndex = -1`; apply loop only `addTrigger`. Firing the lower-third before selecting shows an empty card (correct styling/animation, no text).
- Operator normally clicks a trigger first, so low impact. Consider auto-selecting index 0 on apply so the preview/overlay has content immediately.

## Cleanup (end of run)
- No CC DB writes were made (synthetic in-memory package). Nothing to delete in CC.
- Live BB holds the 16 synthetic test triggers in memory (not persisted — no session loaded). Clear them / restore on next operator session load.
- Re-verify cast decoder errors = 0.
