# FIVE AND FIVE — BroadcastBuddy (2026-06-04)

Anchors verified against `main`. Ports 19080/19081.

## KILLER FEATURES
1. **[industry-standard] Auto-load most-recent session on startup + adopt a session on CC apply** — closes verified Finding 1; makes the shipped auto-save actually engage in the real boot→CC-apply workflow (~1hr) · `index.ts:78` + `ipc.ts:633` + `session.ts:133`
2. **[boring-overlooked] Auto-select trigger index 0 on CC apply** — no more empty card / disabled Up-Next until a manual click (~10min) · `ipc.ts:664`
3. **[industry-standard] OBS auto-connect on startup** — removes the per-show manual Connect click, fail-soft (~1hr, live socket hardware-verify) · `obsConnection.ts:111` not called in `index.ts:78`
4. **[creative] "Save live triggers as session" one-click recovery** — turn unsaved live/CC-applied state into a durable auto-saving session via existing `preserveTriggers` path (~half-day) · `index.ts:150` + `ipc.ts:288`
5. **[boring-overlooked] Half-open photo-match windows + clock-offset clamp** — fixes boundary ambiguity + wild Gemini offsets (~1hr, needs gallery data) · `galleryService.ts:220`

## STREAMLINES
6. **Remove duplicate `settingsSet('wifiDisplay')`** — runs twice per Settings save (~10min) · `Settings.tsx:134` + `:183`
7. **Collapse 3 identical logo-fetch blocks into `fetchAsDataUrl()`** — ~30 dup lines in CC apply (~10min) · `ipc.ts:638/682/696`
8. **Extract `buildOverlayHTML` out of 2,668-line `overlay.ts`** — halve the file, zero behavior change (~half-day) · `overlay.ts:803`
9. **Audit the one hardcoded `httpPort` default drift** — prevents regression of the WS-port fix (~10min) · `settings.ts:10` vs `Settings.tsx:11`
10. **Retire unused `pdf-lib` dep** — text extraction moved to `pdfjs-dist` (~10min) · `package.json:24`

## Autonomous implementation tonight (per "implement them" directive)
Implementing now (headless-verifiable, no hardware): **1, 2, 6, 7, 9, 10**, plus **3** wired fail-soft (live socket is hardware-verify only).
Deferring with reason: **4** (half-day net-new UI), **5** (needs real gallery data to validate), **8** (half-day refactor — do last only if build stays green).
