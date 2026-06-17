# BroadcastBuddy — Connection Reliability + Field Logging

**Date:** 2026-06-16
**Trigger:** Weekend event (June 13) field failure — tablet ↔ DART would not connect over phone hotspot; experimental Wi-Fi Direct pairing failed. Operator fell back to legacy "ScreenDesk" which DID work over the same hotspot → the hotspot is usable, BB is the fault.
**Priority:** HIGH — multiple back-to-back events upcoming; connect reliability is the #1 ask (per CC handoff, INBOX.md 2026-06-14 23:00).

---

## Evidence (primary source — DART logs, this repo's code)

- DART `events.jsonl`: June 13 event ran (OBS streamed/recorded, "StageCoachGlobal" 46 triggers). **No discovery/direct-mode/connection events captured** — events.jsonl only logs high-level kinds.
- DART `main.old.log`: only spans June 14 20:10–20:56. Verbose tablet video-stats (every 5s) rotate `main.log` within ~1 day, so the June 13 failure-window detail is **overwritten and unrecoverable.**
- June 14 healthy stream: DART `192.168.192.15` ↔ tablet `192.168.192.14` — same subnet, a **router/AP** (not a phone hotspot: Android=192.168.43.x, iPhone=172.20.10.x, Win ICS=192.168.137.x). System works on a router.
- `getLocalIp()` (`src/main/services/wifiDisplay.ts:102-124`): 192.168.x and 10.x BOTH priority 0 → arbitrary tie. DART multi-homed at a venue (OBS-LAN + hotspot) can advertise the **unreachable OBS-LAN IP** in the discovery payload.
- Wi-Fi Direct / BLE paths (`wifiDirectP2P.ts`, `bleAdvertise.ts`) are self-labeled EXPERIMENTAL / UNVERIFIED and emit almost no logs.
- Tablet manual-IP entry exists (`CSController ConnectionScreen.kt:535`) but operators didn't/couldn't use it effectively.

## Root cause (grounded, two candidates — repro to split)

1. **Multi-homed IP pick** advertises an unreachable interface. (Most likely, given ScreenDesk worked.)
2. Phone AP/client isolation (less likely — ScreenDesk worked over same hotspot; but ScreenDesk may relay via cellular, so not ruled out without repro).

---

## Phase 1 — Field-grade logging (do FIRST; makes everything else debuggable)

Write to `events.jsonl` (durable, survives rotation), `kind:"net"`:
- On Direct Mode / discovery start: **all** local IPv4 candidates, the chosen one, the advertised `host`. (Would have shown the multi-homed bug instantly.)
- Discovery request received (src IP) + reply sent (dest IP, host advertised).
- Tablet connect/disconnect: IP, device id, close reason.
- Direct Mode / Wi-Fi Direct / BLE start/stop + result/error (currently silent).
- WS hub bind (addr:port) on start.

Stop the log flood:
- Route tablet video-stats out of `main.log` into a separate `tablet-video.log` (or downsample to 1/min), so failure evidence stops being overwritten.

Files: `wifiDisplay.ts`, `wsHub.ts`, `directMode.ts`, `tabletLogServer.ts`, `logger.ts`.

## Phase 2 — Connection fix

- `getLocalIp()`: when Direct Mode active, prefer the hotspot/Direct interface; otherwise return the full ranked candidate list, not a single arbitrary pick.
- DART UI: show **all reachable IPs** big on-screen (operator can read them to the tablet).
- Make tablet manual-IP a first-class, obvious path.
- CC handoff target: **one-button connect** + better auto-discovery + installer ships better discovery defaults + fallback unicast/QR-hotspot.

## Phase 3 — Bench repro (proves cause before it ships)

- DART on Ethernet + phone hotspot simultaneously; tablet on hotspot only.
- Confirm: does fixed `getLocalIp()` + manual IP connect? Is AP isolation present (test raw TCP tablet→DART)?
- Only ship Phase 2 once repro confirms the fix.

## Phase 4 — Disarm foot-guns

- Hide/disable Wi-Fi Direct + BLE in operator UI until bench-verified, so they can't be chosen live.

---

## Out of scope (related, track separately)
- Auto-push CF stream key → OBS on `CC_APPLY_PACKAGE` (`ipc.ts ~694-707`, add `SetStreamServiceSettings`) — INBOX item 2.
- Populate CC `broadcast_triggers` for upcoming events (only Ancaster has routine data: `RemotionVideo/src/data/adaRoutines.json`, 32 routines) — INBOX item 3 / events workstream.

## Method
Brainstorm → TDD → build in subagent → bench repro on real hotspot → deploy to DART. NOT deployed to a show machine until Phase 3 passes.
