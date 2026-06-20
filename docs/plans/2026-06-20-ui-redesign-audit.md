# BroadcastBuddy UI/UX Audit + Reorganization Proposal

Date: 2026-06-20
Reference app: CompSyncElectronApp (CSE) — the "clean/dense/beautiful" target
Scope: research + proposal only. No code changed. Behavior changes are flagged in §6.

---

## 0. TL;DR

BB's main window is **one long scrolling right-panel of ~17 stacked `.panel-section` cards**, most of them flat button walls, with several controls duplicated across panels. CSE reads as clean because it is the opposite shape: **one dense data surface (a table) + a fixed-height right rail of titled "cards," each with a consistent header (title · Edit · inline ON/OFF badge)**, collapsible modules, and reserved min-heights so nothing collapses to mush.

The fix is **not** a new framework. BB already has the two pieces it needs: the `.panel-section` + `.panel-section-title` collapsible convention, and the tabbed Settings pattern already ported from CSE (`SETTINGS_TABS` in `Settings.tsx:13`). The proposal applies those same patterns to the main window, removes 4 concrete duplicate control pairs, and groups the camera/overlay button walls into labeled subsections.

---

## 1. BB Inventory (panel → controls → issues)

Layout root: `src/renderer/components/App.tsx`. Structure:
- `Header` (full-width top bar)
- `app-body` = `left-panel` (`TriggerList` + `OverlayPreview`, drag-resizable) + `panel-resizer` + `right-panel`
- `right-panel` is a CSS grid (`app.css:41` `repeat(auto-fill, minmax(480px,1fr))`) holding **4 group labels** (Live Control / Content & Styling / Broadcast & Delivery / Monitoring) and ~17 panels.
- Modals/overlays: `Settings`, `VisualEditor`, `StartingSoonEditor`, `BrandScraperPanel` (Brand Kit), `ImportPanel` (Import), `DayChecklist`, plus `RecoveryBanner` / `StartupToast`.

| Panel (file) | Group | Visible controls | Issues |
|---|---|---|---|
| **Header** (`Header.tsx`, 16+ btns) | top bar | New / Save / Load▼ (saved sessions + CC events) / REC / Tablet / Tools▼ (Brand Kit, Import, Starting-Soon Editor, Start-of-Day, End-of-Day, Compact, Overlay Mode, Settings) + `HeaderAudioMeter` + `HeaderSystemStats` + session badge | Tools▼ is a 8-item grab-bag of unrelated actions. Inline dropdown menus are **hand-styled inline** (lines 357-472, 521-617) instead of a reusable menu component. |
| **TriggerList** (`TriggerList.tsx`) | left | per-trigger select; add/clear | OK (left panel is the closest thing to a CSE "table"). |
| **OverlayPreview** (`OverlayPreview.tsx`) | left | none (display) | Hidden in compact. Fine. |
| **OverlayControls** "Playlist Controls" (`OverlayControls.tsx`, 23+ btns, many `.map`) | Live Control | Fire / Hide + status; Prev / Next / **Next+Fire**; Auto toggle; Loop toggle; Reset / Clear Played / Clear All; LT Up-Next/That-Was; Card Up-Next/That-Was/Hide/Hide-Chat; Grid toggle; Clock on/off + 12/24h + Secs; **Set Home (Wide) / Go Wide**; feature-card composer (kicker/title/subtitle + Show) | **Button overload** — 6 logical groups crammed in one card. **Camera Set-Home/Go-Wide here duplicates CameraPanel** (see §2). Feature-card composer + clock controls are content authoring, not "playlist." |
| **TriggerEditor** (`TriggerEditor.tsx`) | Live Control | edit fields, save | OK. |
| **AdhocPanel** (`AdhocPanel.tsx`) | Live Control | quick lower-third fire (2 btns) | Overlaps the feature-card composer in OverlayControls conceptually (both "type text → put on screen"). |
| **CameraPanel** (`CameraPanel.tsx`, 18 btns + many `.map`) | Camera | Probe / Find; Auto/Manual segment; joystick + Pan/Tilt slider + zoom rocker + zoom-speed slider; **7 preset buttons**; **Home / Recenter**; Tracking (5 speed btns) · Subject (2) · Framing (4) · Only-Me (2) · zoom slider · SD-Record; Image: WB select + temp, Exposure auto/manual + EV/ISO/shutter, Focus afc/afs/mf + manual; gamepad indicator; live-preview device picker | **The single biggest button wall** (~35 interactive controls in one flat scroll). No internal grouping headers beyond plain `camera-section-title` text. **Home duplicates OverlayControls Go-Wide**. |
| **AnimationPanel** (`AnimationPanel.tsx`) | Content | animation-style buttons + Test | Already collapsible `.panel-section`. OK. |
| **StartingSoonPanel** (`StartingSoonPanel.tsx`, 8 btns) | Content | Open Scene Editor; title/subtitle/completion; countdown checkbox + min/sec + Set + presets (5/10/15/30); BG/Text/Accent colors; Cover-mode + backdrop URL; Pre-Show Media (welcome/social/sponsors/slideshow, nested collapsible); Show/Hide | Large but already nested-collapsible. **"Open Scene Editor" also reachable from Header→Tools→Starting-Soon Editor and from CSE-style elsewhere** — 2 entry points. |
| **TemplateGallery** (`TemplateGallery.tsx`) | Content | apply template (1 btn) | OK. |
| **StylingPanel** (`StylingPanel.tsx`) | Content | styling (1 btn) | Thin — candidate to fold into a "Look" card with Animation + Template + Logo. |
| **LogoManager** (`LogoManager.tsx`, 6 btns) | Content | add/remove/select logo | OK, but fragmented from Styling/Template. |
| **TickerControls** (`TickerControls.tsx`) | Content | ticker text + show/hide | OK; in CSE this lives as an `oc-module` inside the rail. |
| **StreamInfoPanel** (`StreamInfoPanel.tsx`, 8 btns) | Broadcast | RTMP / Stream Key (+show); **"Sync Key → OBS"**; Start/Stop Stream + Save Replay; **"Push to OBS" (second identical sync button)**; Viewing Link / Embed / Chat copy rows | **DUPLICATE: two buttons call the same `pushToObs()`** (lines 119-135 *and* 155-171). Default-collapsed so density isn't the problem here — the redundancy is. |
| **NotesPanel** (`NotesPanel.tsx`) | Broadcast | notes textarea | Misfiled under Broadcast; it's operator scratch. |
| **BroadcastPackagePanel** (`BroadcastPackagePanel.tsx`, 4 btns) | Broadcast | fetch/apply CC package | **CC apply duplicates Header→Load→Command Center Events** (`Header.tsx:258 handleLoadCCEvent` is a copy of `applyPackage`). |
| **RecordingUploadPanel** (`RecordingUploadPanel.tsx`, 3 btns) | Broadcast | upload recording | REC start/stop is in Header; upload is here — recording lifecycle split across two places. |
| **GalleryPanel** (`GalleryPanel.tsx`, 8 btns) | Monitoring | gallery sort/upload | OK as a monitoring card. |
| **ChatPanel** (`ChatPanel.tsx`, 7 btns) | Monitoring | viewer/operator chat, pin-to-stream | In CSE chat is a **reserved-height rail card** (`InlineChatStrip` in a `chat-card` with hard min-height, `ShowControlRail.tsx:34`). |
| **EventLogPanel** (`EventLogPanel.tsx`) | Monitoring | log feed | Good — this is where CSE consolidated all its toasts/banners (`App.tsx` comment ~1172). BB still has scattered toasts. |
| **Settings** (`Settings.tsx`) | modal | **Already tabbed** (General/OBS/Camera/Import&Media/Network/Tools) | **This is the model to copy.** `SETTINGS_TABS` at line 13; tabbar at 414; show/hide by `data-active-tab`. |

---

## 2. Prioritized findings: duplicates / overload / wasted space

### P0 — Duplicate controls (same action, multiple places) — remove
1. **Push/Sync stream key to OBS appears TWICE in one panel.** `StreamInfoPanel.tsx` renders "Sync Key → OBS" (119-135) and a second "Push to OBS" block (155-171), both calling `pushToObs()`. → Delete the second block. (Pure dedup, no behavior change.)
2. **Camera "go wide / home" lives in both OverlayControls and CameraPanel.** `OverlayControls` "Set Home (Wide)" / "Go Wide" (`cameraSetHome` / `cameraGoHome`, lines 321-337) duplicate CameraPanel's "Home (safe wide)" / "Recenter" (`CameraPanel.tsx:464-467`). → Keep the panic "Go Wide" in the always-visible live strip (operator needs it instantly), move "Set Home" into CameraPanel only. Decide one home of truth for each.
3. **CC event apply exists in Header AND BroadcastPackagePanel.** `Header.tsx:258 handleLoadCCEvent` is a near-copy of `BroadcastPackagePanel.applyPackage`. → Single source: Header→Load is the discovery surface; BroadcastPackagePanel becomes the *status/detail* of the loaded package, not a second fetch-and-apply.
4. **Starting-Soon Editor has 2 launch points** (StartingSoonPanel "Open Scene Editor" + Header→Tools). Acceptable, but pick the panel button as primary and drop it from the Tools grab-bag once Tools is slimmed.

### P1 — Button overload (group / collapse / move behind a header)
5. **CameraPanel = ~35 flat controls, no real subsections.** Worst offender. → Collapsible subsections (see §4 before→after).
6. **OverlayControls = 6 logical groups in one card.** Playlist nav, LT reveal, Card reveal, Grid/Clock toggles, Camera safety, Feature composer all stacked. → Split: keep Fire/Hide/nav as the live hero; move Clock/Grid + Feature composer into a "Graphics" card (CSE's `OverlayModules` model).
7. **Header Tools▼ = 8 unrelated items.** Brand Kit, Import, SS Editor, 2 checklists, Compact, Overlay Mode, Settings. → Split into a small "View" group (Compact / Overlay Mode) inline + a "Tools" menu (editors/checklists) + Settings as its own gear icon.

### P2 — Wasted space / density
8. **Right-panel `auto-fill minmax(480px,1fr)` scatters half-width cards and leaves blank cells.** The code even comments on fighting this for the Live Control row (`app.css:60-71`). A fixed left table + fixed right rail (CSE shape) removes the reflow lottery.
9. **Default-collapsed Broadcast cards (StreamInfo, etc.) leave their grid cells as empty headers** — visually "a million collapsed bars." Grouping them into one tabbed/stacked "Broadcast" card reclaims that.
10. **Scattered toasts** (`App.tsx` `obsToast`, Header `toast`, StreamInfo inline messages, StartupToast) vs CSE's decision to funnel everything into EventLogPanel. Consolidation = less floating chrome.

### P3 — Inconsistent grouping (related controls split across panels)
11. **"Look" is fragmented**: Animation / Template / Styling / Logo are 4 separate cards = one concept.
12. **Recording lifecycle split**: REC start/stop in Header, upload in RecordingUploadPanel.
13. **Camera split**: live PTZ in CameraPanel, panic-wide in OverlayControls, config in Settings→Camera.

---

## 3. CSE patterns to adopt (concrete, file-referenced)

1. **One dense primary surface + a fixed rail, not a long scroll.** `CompSyncElectronApp/src/renderer/App.tsx:1162` → `<div className="workspace"><RightPanel/><ShowControlRail/></div>`. `RightPanel` is just the `RoutineTable`; `ShowControlRail` (`ShowControlRail.tsx`) is a fixed `aside` of cards. BB's equivalent: left `TriggerList` table + a right **Show Rail** instead of the scattered grid.

2. **The `oc-module` card header pattern: `title · Edit · inline ON/OFF live badge`.** `OverlayControls.tsx:795-820` (Ticker module) — one row gives you the label, an Edit toggle that expands the editor inline, and a colored ON/OFF badge that is itself the toggle. This is the single highest-leverage pattern for BB's toggle walls (Grid/Clock/Ticker/StartingSoon all become one-line modules).

3. **Reserved-height rail cards so nothing collapses to mush.** `show-rail.css:32` `.meter-card { flex: 0 0 128px }` and the chat card's hard min-height (`ShowControlRail.tsx:30` comment: chat gets its own section so graphics can't crush it). BB's ChatPanel should be a reserved-height rail card, same fix.

4. **Collapsible status panel that auto-hides when empty.** `RightPanel.tsx:7 JobQueuePanel` returns null when there's nothing active, expands on click, shows count badges (`jq-badge running/pending/failed`). BB EventLog/Recording-upload status should follow this — present only when there's something to see.

5. **A compact tile strip for at-a-glance counts.** `RightPanel.tsx:79 HealthStrip` — 3 tiny tiles (Done / Pix / Rec n/m) with tooltips, deliberately trimmed over time. BB has the raw material in `HeaderSystemStats` — make it a tile strip, not prose.

6. **Tabbed sections to fold many groups into one frame.** Already in BB Settings (`Settings.tsx:13 SETTINGS_TABS`, tabbar `:414`). Reuse the exact `.settings-tabbar` / `.settings-tab` CSS for a main-window "Content" or "Broadcast" card so 5 sub-panels become 1 framed tab strip.

7. **Sub-component decomposition with props to reuse one component in two layouts.** CSE's `OverlayControls` exports `GraphicsSection`, `OverlayModules`, `OverlayLayerToggles`, `InlineChatStrip` and recomposes them differently in the main window vs the rail (`ShowControlRail.tsx:3`), with flags like `noChat`, `hideFeatureCards`. BB can split its mega-`OverlayControls` the same way so Overlay Mode panels and the main window share code.

8. **Shared panel chrome.** `PanelChrome.tsx` gives every floating panel an identical titlebar + hide/exit + import pill. BB has its own `PanelChrome.tsx` already — extend the same titlebar convention to main-window rail cards for visual consistency.

---

## 4. Proposed Information Architecture + before→after

### 4.1 Top-level layout (target)

```
┌─ Header ───────────────────────────────────────────────────────────────┐
│ BB · [session]   [audio meter][sys tiles]   New Save Load▼  REC  Tablet │
│                                              Tools▼  ⚙Settings  ⊟Compact │
├──────────────┬─────────────────────────────────────┬───────────────────┤
│ LEFT (table) │ CENTER — Live Control (primary)      │ RIGHT — Show Rail │
│ TriggerList  │ ┌ Playlist hero: Fire/Hide + status │ ┌ Graphics card   │
│ + Preview    │ │ Prev/Next/Next+Fire · Auto · Loop │ │  LT · Card ·     │
│ (resizable)  │ ├ Reveal: LT / Card up-next/that-was│ │  Grid · Clock ·  │
│              │ ├ Quick LT (AdhocPanel)             │ │  Ticker (oc-mods)│
│              │ └ Trigger editor (inline)          │ ├ Camera card      │
│              │                                     │ │  (collapsed by   │
│              │ [Tab strip: Content | Broadcast]    │ │   default)       │
│              │   Content tab: Look (Anim/Template/ │ ├ Chat card        │
│              │     Style/Logo) · Starting Soon     │ │  (reserved ht)   │
│              │   Broadcast tab: Stream · Package · │ └ Status (auto-    │
│              │     Recording · Notes               │    hide JobQueue)  │
│              │                                     │                    │
│              │ EventLog (consolidated toasts)      │                    │
└──────────────┴─────────────────────────────────────┴───────────────────┘
```

Principle: **always-visible = live-critical** (Fire/Hide, Prev/Next, panic Go-Wide, Graphics toggles). **Behind a tab/collapse = setup** (Content/Broadcast). **Behind a menu = rare** (Brand Kit, Import, checklists, editors). **Settings stays a modal** (already tabbed).

### 4.2 Worst-offender before→after

**A. CameraPanel — ~35 flat controls → 4 collapsible subsections**

Before: status row, mode segment, joystick block, 7 presets, Home/Recenter, then `CameraTrackingControls` (5+2+4+2+slider+SD) and `CameraImageControls` (WB+exp+focus) as flat text-titled blocks, then gamepad + preview — one continuous scroll.

After (reuse `.panel-section` collapsible + `camera-section-title` as headers):
- **PTZ (primary, open)** — status dot/host, Auto/Manual segment, joystick, Pan/Tilt + Zoom sliders, presets P2–P8, Home / Recenter.
- **Tracking (collapsed)** — Follow speed · Subject · Framing · Only-Me · zoom level · SD-record.
- **Image (collapsed)** — White Balance · Exposure · Focus.
- **Preview + Gamepad (collapsed)** — device picker + `<video>` + controller status.

No logic change — just wrap the three existing sub-blocks (`CameraTrackingControls`, `CameraImageControls`, `CameraPreview`) in collapsible headers and make PTZ the only open one.

**B. OverlayControls "Playlist Controls" — 6 groups in one card → live hero + Graphics card**

Before: Fire/Hide+status, nav, LT reveal, Card reveal, Grid/Clock toggles, Camera safety, Feature composer — all in one `.panel-section`.

After:
- **Live hero (center, always open):** Fire / Hide + status; Prev / Next / Next+Fire; Auto; Loop; Reset/Clear; **panic Go-Wide** (the one camera control that stays here).
- **Graphics card (right rail):** LT up-next/that-was; Card up-next/that-was/hide; **Grid / Clock / Ticker as one-line `oc-module` toggles**; feature-card composer behind an "Edit" expand. Extract these into a `GraphicsSection` sub-component (mirror CSE) so Overlay Mode reuses it.
- Remove "Set Home (Wide)" here (lives in CameraPanel §4.2A).

**C. Header Tools▼ — 8-item grab-bag → 3 buckets**

Before: one `Tools ▼` with Brand Kit, Import, SS Editor, Start/End checklists, Compact, Overlay Mode, Settings.

After:
- Inline icon buttons: `⊟ Compact`, `⧉ Overlay Mode`, `⚙ Settings` (these are view/mode switches, not "tools").
- `Tools ▼` keeps only true tools/editors: Brand Kit, Import, Starting-Soon Editor, Start-of-Day, End-of-Day.
- Replace the hand-rolled inline-styled menus (`Header.tsx:357`, `:521`) with one small reusable `<Menu>` so Load and Tools share styling.

**D. StreamInfoPanel — kill the duplicate push button**

Before: "Sync Key → OBS" + a second "Push to OBS" block doing the same `pushToObs()`.
After: one "Sync Key → OBS" button. Delete lines 155-171.

**E. Right-panel grid → tabbed Content/Broadcast cards**

Before: 4 group labels + ~13 cards in an auto-fill grid that reflows and leaves blanks.
After: Content group (Animation/Template/Styling/Logo/StartingSoon) and Broadcast group (Stream/Package/Recording/Notes) each become a **single framed card with a `.settings-tabbar`-style tab strip** (reuse Settings CSS). Reclaims the empty collapsed-bar space and gives a stable, scannable frame.

---

## 5. Phased build plan

**Phase 0 — Quick wins (low risk, ~1 session, no layout restructure)**
- P0.1 Delete duplicate "Push to OBS" block in `StreamInfoPanel.tsx` (155-171).
- P0.2 Remove "Set Home (Wide)" from `OverlayControls.tsx` (keep panic "Go Wide"); rely on CameraPanel for set-home.
- P0.3 Wrap CameraPanel's Tracking / Image / Preview blocks in collapsible `.panel-section` headers; PTZ stays open. (§4.2A — pure wrapping, existing CSS.)
- P0.4 Slim Header Tools▼: pull Compact / Overlay Mode / Settings out as inline buttons (§4.2C, menu-content only).

**Phase 1 — Card consolidation (medium, reuses Settings tab CSS)**
- P1.1 Build a reusable `<Menu>` and a `<TabbedCard>` from the existing `.settings-tabbar` styles.
- P1.2 Convert Content group → one tabbed "Content" card (Look | Starting Soon). Fold Animation/Template/Styling/Logo into a "Look" tab.
- P1.3 Convert Broadcast group → one tabbed "Broadcast" card (Stream | Package | Recording | Notes). Make BroadcastPackagePanel show *loaded-package status*, not a second CC fetch (P0 dup #3).
- P1.4 Consolidate scattered toasts into EventLogPanel (CSE precedent): `obsToast`, Header `toast`, StartupToast.

**Phase 2 — Show Rail restructure (larger, the CSE shape)**
- P2.1 Split `OverlayControls` into `GraphicsSection` / `OverlayModules` / `LayerToggles` sub-components with props (mirror CSE) so they compose in both the main window and Overlay Mode.
- P2.2 Introduce a right **Show Rail** (`aside`, fixed width, card stack with reserved heights): Graphics card · Camera card (collapsed) · Chat card (reserved min-height) · auto-hiding Status/JobQueue card.
- P2.3 Replace the `auto-fill minmax` right-panel grid with `left table | center live | right rail` (drop the reflow-fighting `live-control-grid` hack in `app.css:60`).
- P2.4 Turn `HeaderSystemStats` into a HealthStrip-style tile row.

**Risk ordering:** Phase 0 is delete/wrap only — ship immediately. Phase 1 reuses an already-proven in-repo pattern. Phase 2 is the real restructure and should be mocked (Playwright screenshot) before building.

---

## 6. Behavior changes to review separately (NOT pure layout)

- **Removing the duplicate StreamInfo push button** changes nothing functionally (same handler) — safe.
- **Dropping "Set Home (Wide)" from the live strip** removes one set-home entry point. Confirm operators don't rely on setting home without opening CameraPanel.
- **BroadcastPackagePanel no longer fetching/applying CC packages** (deferring to Header→Load) is a workflow change — confirm the panel-side apply isn't used as a manual re-apply path.
- **Funneling toasts into EventLogPanel** changes *where* operators see confirmations (in-log vs floating). CSE made this call deliberately; confirm BB operators want the same.
- **Collapsing camera Tracking/Image by default** changes first-paint visibility. Confirm Tracking (follow-speed/framing) isn't adjusted often enough mid-show to warrant staying open.

---

## Appendix — key file:line references

- Layout root: `src/renderer/components/App.tsx:105-156`
- Right-panel grid + reflow hack: `src/renderer/styles/app.css:41-83`
- Collapsible section convention: `app.css:114-144` (`.panel-section-title`, `.chevron`, `.collapsed`)
- Tabbed Settings (model): `src/renderer/components/Settings.tsx:13` (`SETTINGS_TABS`), `:414` (tabbar)
- StreamInfo duplicate push: `src/renderer/components/StreamInfoPanel.tsx:119-135` and `:155-171`
- Camera/overlay home dup: `OverlayControls.tsx:321-337` vs `CameraPanel.tsx:464-467`
- CC apply dup: `Header.tsx:258` vs `BroadcastPackagePanel.tsx applyPackage`
- CSE workspace shape: `CompSyncElectronApp/src/renderer/App.tsx:1162`
- CSE rail: `.../components/ShowControlRail.tsx`, styles `.../styles/show-rail.css:25-142`
- CSE oc-module pattern: `.../components/OverlayControls.tsx:795-820`
- CSE auto-hide status + tiles: `.../components/RightPanel.tsx:7` (JobQueuePanel), `:79` (HealthStrip)
