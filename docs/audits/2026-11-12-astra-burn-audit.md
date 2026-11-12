# BroadcastBuddy static deep audit

Started 2026-11-12 13:53 ET. Scope: local working tree on `main`, HEAD `1c09c8bf3b9bc2980ee639c9de0d5ee038cb2eac`. Existing unrelated working-tree changes were present and left untouched. This report is the only file created or edited by this audit. No builds, installs, servers, tests, TypeScript checks, emulators, production queries, commits, or pushes.

Method: trace concrete inputs through code and quote the relevant implementation. CONFIRMED means the defect follows from the checked-in control/data flow, not that it was executed. Runtime reproduction and deployed configuration remain untested. UNVERIFIED explicitly marks conclusions requiring evidence outside this repository. Findings are appended immediately; severity labels provide ranking (Critical, High, Medium, Low). A ranked index will be appended as review progresses. No real secrets or customer data are included.

## Ranked finding index

Severity is impact-based. CONFIRMED refers to static source evidence; no runtime reproduction was performed. UNVERIFIED deployment findings are kept visibly separate in the confidence column.

| ID | Severity | Evidence status | Finding |
| --- | --- | --- | --- |
| BB-001 | High | CONFIRMED | Unauthenticated LAN clients can stop streaming, stop recording, and operate cameras |
| BB-004 | High | CONFIRMED | Invalid package deletes the live playlist before validation and autosaves the loss |
| BB-005 | High | CONFIRMED | Restoring the oldest retained backup deletes it before reading it |
| BB-006 | High | CONFIRMED | A four-byte JSON request throws uncaught in the main process |
| BB-009 | High | CONFIRMED | Live package pushes are silently dropped unless the Package tab is open |
| BB-010 | High | CONFIRMED | Gallery upload reports published success even when uploads or publication fail |
| BB-011 | High | CONFIRMED | Switching to a package without realtime leaves the previous event's remote control armed |
| BB-012 | High | CONFIRMED | Unescaped styling values inject executable HTML into the OBS browser source |
| BB-014 | High | CONFIRMED | Upload dedup skips changed files and different destination galleries |
| BB-015 | High | CONFIRMED | Stopping Auto Director does not cancel an in-flight automatic scene cut |
| BB-016 | High | CONFIRMED | Package logo fetches turn the main process into an internal HTTP reader |
| BB-017 | High | CONFIRMED | Unauthenticated discovery packet redirects the display stream to its sender |
| BB-018 | High | CONFIRMED | Document import permanently discards every extracted row after the first ten |
| BB-019 | High | CONFIRMED | Most trigger edits bypass autosave and leave OBS with stale text |
| BB-022 | High | CONFIRMED | Pinning chat can unexpectedly run the selected routine's camera move |
| BB-023 | High | CONFIRMED design risk | Recording upload allocates the entire video in the main process |
| BB-002 | High | UNVERIFIED deployment | Documented chat RLS policies permit every event to be read and modified |
| BB-030 | High | UNVERIFIED deployment | Privileged relay messages use a public channel and no sender authentication |
| BB-003 | Medium | CONFIRMED | Chat reconnect loads the oldest 50 messages and drops the recent history |
| BB-007 | Medium | CONFIRMED | Notes do not trigger the advertised session autosave |
| BB-008 | Medium | CONFIRMED | Clean shutdown discards edits inside the autosave debounce window |
| BB-013 | Medium | CONFIRMED | Recording Upload loses its event context because it cannot be mounted with Package |
| BB-020 | Medium | CONFIRMED | Reorder and deletion change the selected routine without updating its displayed overlay |
| BB-021 | Medium | CONFIRMED | Field Mapper's editable cells discard every edit |
| BB-024 | Medium | CONFIRMED | Clean saves omit the Starting Soon scene and its media/layout configuration |
| BB-025 | Medium | CONFIRMED | Multi-video transcription duplicates the entire program for every video |
| BB-026 | Medium | CONFIRMED | Hide and Auto-Fire Off do not cancel a queued lower-third fire |
| BB-027 | Medium | CONFIRMED | Starting Soon countdown restarts independently in each browser source |
| BB-028 | Medium | CONFIRMED | The settings backup does not include the sessions it claims to protect |
| BB-029 | Medium | CONFIRMED | Credentials are stored as plaintext and replicated into routine backups |
| BB-031 | Medium | CONFIRMED | Disabling the CC relay still starts the viewer-chat network connection |

31 findings saved: 18 High, 13 Medium.

## BB-001 | High | CONFIRMED | Unauthenticated LAN clients can stop streaming, stop recording, and operate cameras

**Locations:** `src/main/services/wsHub.ts:398-440`, `:348-360`; `src/main/services/settings.ts:9-12`; `src/main/services/overlay.ts:960-976`.

**Input:** Any network peer that can reach the configured WS port (default 19081) opens a connection and sends `{"type":"command","action":"toggleStream"}` while streaming, or `{"type":"command","action":"toggleRecord"}` while recording. It need not send an identify message first. The reachable HTTP `/dock` also exposes the control interface.

**Evidence:**

```ts
// wsHub.ts:402
wss = new WebSocketServer({ port, host: '0.0.0.0' })
// wsHub.ts:425-440
ws.on('message', (raw) => {
  try {
    const msg = JSON.parse(raw.toString())
    if (msg.type === 'identify') {
      clients.set(ws, msg.client)
      ws.send(JSON.stringify(buildStateMessage()))
    }
    if (msg.type === 'command') {
      handleCommand(msg.action, { ...msg.data, element: msg.element })
    }
// wsHub.ts:351,358-360
void obs.toggleRecording().catch((err) => logger.warn(`toggleRecord failed: ${err instanceof Error ? err.message : err}`))
void obs.getStreamStatus()
  .then((status) => (status.streaming ? obs.stopStreaming() : obs.startStreaming()))
  .catch((err) => logger.warn(`toggleStream failed: ${err instanceof Error ? err.message : err}`))
```

**Wrong result / impact:** Remote unauthenticated control of the live broadcast and PTZ hardware. The connection and dispatch path has no credential, capability, or Origin check; identification is only a user-supplied label and is not required for commands. HTTP `/current` and `/triggers` similarly expose overlay and program information on all interfaces. LAN exposure is intentional in the comments, but read-only viewers and privileged controllers receive no separate authorization. Internet reachability and browser-specific private-network restrictions are UNVERIFIED and are not needed for the LAN attack.

**Fix direction:** Authenticate control connections, authorize commands separately from passive overlay state, and restrict accepted origins/bind addresses as appropriate. Preserve passive OBS viewing without granting mutation privileges.

## BB-002 | High | UNVERIFIED deployment | Documented chat RLS policies permit every event to be read and modified

**Locations:** `src/main/services/chatBridge.ts:12-37`, `:158-163`, `:179-192`.

**Input:** Enable operator chat using the schema instructions embedded in this service, then make a request with the same public anon key for another event's rows or update their `hidden` / `livestream_pinned` fields.

**Evidence:**

```sql
-- chatBridge.ts:32-37, executable SQL in the setup comment
alter table public.chat_messages enable row level security;
create policy "anon read"   on public.chat_messages for select using (true);
create policy "anon insert" on public.chat_messages for insert with check (true);
create policy "anon update" on public.chat_messages for update using (true) with check (true);
```

```ts
// chatBridge.ts:158-163, filtering is in the client query
const { data, error } = await supabase
  .from('chat_messages')
  .select('*')
  .eq('event_id', config.eventId)
  .order('created_at', { ascending: true })
  .limit(MAX_MESSAGES)
// chatBridge.ts:179
supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
```

**Wrong result / impact:** The supplied policy predicates do not enforce event membership, tenant membership, or operator-only moderation. The client-selected event filter can be omitted by another client. Confirmed defect in the repository's deployment instructions; whether these policies are installed, and actual table grants, are **UNVERIFIED**. Read-only deployed policy/grant inspection would settle the live exposure; no customer rows need to be read.

**Fix direction:** Replace the setup SQL with authenticated event membership policies, including separate permissions for moderation. Client filtering is not an authorization boundary.

## BB-003 | Medium | CONFIRMED | Chat reconnect loads the oldest 50 messages and drops the recent history

**Locations:** `src/main/services/chatBridge.ts:51`, `:108-117`, `:155-169`, `:206-211`.

**Input:** An event already has 100 chat messages; start or reconnect the app after message 100.

**Evidence:**

```ts
const MAX_MESSAGES = 50 // :51
// :158-168
const { data, error } = await supabase
  .from('chat_messages')
  .select('*')
  .eq('event_id', config.eventId)
  .order('created_at', { ascending: true })
  .limit(MAX_MESSAGES)
// ... error handling ...
for (const row of data || []) mergeMessage(rowToMessage(row as Record<string, unknown>))
// :115-116
messages.push(msg)
if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES)
```

**Wrong result / impact:** Backfill selects messages 1 through 50, not messages 51 through 100. Recent messages during a disconnect never reach the operator on reconnect. Backfill can also append old rows after newly arrived realtime messages and evict those new messages from the bounded array. Database rows are not deleted, but the operational chat history is wrong.

**Fix direction:** Fetch descending with a limit, reverse into chronological order before merging, and sort/deduplicate the combined result by timestamp before trimming.

## BB-004 | High | CONFIRMED | Invalid package deletes the live playlist before validation and autosaves the loss

**Locations:** `src/main/ipc.ts:829-860`, `:948-965`; `src/main/services/overlay.ts:90-122`; `src/renderer/components/BroadcastPackagePanel.tsx:44-55`.

**Input:** With a saved session and nonempty playlist loaded, apply the JSON package `{"triggers":[]}`. This can arrive through the unauthenticated WS package path in BB-001 when the package panel is mounted, or through any package source that returns malformed data.

**Evidence:**

```ts
// ipc.ts:829-832
ipcMain.handle(IPC.CC_APPLY_PACKAGE, async (_e, pkg: BroadcastPackage, eventId?: string) => {
  const newTriggers: Trigger[] = await Promise.all(
    pkg.triggers.map(async (t, i) => {
// ipc.ts:847-860
// Apply triggers
overlay.clearAllTriggers()
for (const t of newTriggers) {
  overlay.addTrigger(t)
}
// ... optional first-trigger selection ...
if (pkg.streaming.streamKey || pkg.streaming.rtmpUrl || pkg.streaming.livestreamUrl || pkg.streaming.embedCode) {
// overlay.ts:90-92,103,111
onChangeCallback?.()
scheduleAutoSave()
const AUTO_SAVE_DEBOUNCE_MS = 800
session.saveSession(
```

**Wrong result / impact:** `triggers: []` passes the map; the current playlist is cleared. Accessing `pkg.streaming.streamKey` then throws because `streaming` is absent. There is no rollback. The clear mutation schedules an autosave of the damaged state into the loaded session. Reporting the rejected IPC request does not restore either the playlist or its saved file. Even a valid different-event package reuses the current session identity, so its autosave replaces that session's content (`ipc.ts:948-953` explicitly relies on this).

**Fix direction:** Validate the complete package before mutation, stage downloads and conversions, then commit state atomically. Preserve a pre-apply session revision and separate different-event session identities.

## BB-005 | High | CONFIRMED | Restoring the oldest retained backup deletes it before reading it

**Locations:** `src/main/services/backup.ts:23`, `:50-63`, `:67-78`, `:109-124`.

**Input:** Ten configuration backups exist. Select the oldest for restore at a time that produces a new backup filename.

**Evidence:**

```ts
const MAX_BACKUPS = 10 // :23
// :58-63
if (files.length <= MAX_BACKUPS) return
files.sort()
const stale = files.slice(0, files.length - MAX_BACKUPS)
for (const f of stale) {
  try { fs.rmSync(path.join(dir, f), { force: true }) } catch { /* best-effort */ }
}
// :73-75, inside backupSettings
const dest = path.join(backupsDir(), `config-${stamp()}.json`)
fs.copyFileSync(src, dest)
prune()
// :112-117, inside restoreBackup
const src = path.join(backupsDir(), file)
if (!fs.existsSync(src)) return { ok: false, error: 'Backup not found' }
try {
  backupSettings()
  fs.copyFileSync(src, configPath())
```

**Wrong result / impact:** The safety snapshot creates an eleventh backup; pruning removes the oldest, which is the selected restore source. The following copy fails and the chosen historical backup has been permanently deleted. The initial existence check cannot protect against the function's own deletion.

**Fix direction:** Read or protect the selected source before creating/pruning the safety backup; exclude the active restore source from pruning until restore completes.

## BB-006 | High | CONFIRMED | A four-byte JSON request throws uncaught in the main process

**Locations:** `src/main/services/tabletLogServer.ts:59-62`, `:114-125`, `:158-172`, `:188`; `src/main/index.ts:160-165`.

**Input:** A network peer sends body `null` to `POST /tablet-log` on port 8766. The endpoint starts automatically.

**Evidence:**

```ts
const HOST = '0.0.0.0' // :60
// :114-125
req.on('end', () => {
  if (aborted) return
  let parsed: { host?: string; logs?: TabletLogEntry[] }
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
  } catch {
    sendJson(res, 400, { error: 'invalid json' })
    return
  }
  const host = typeof parsed.host === 'string' && parsed.host.length > 0 ? parsed.host : 'tablet'
  const logs = Array.isArray(parsed.logs) ? parsed.logs.slice(0, MAX_LOGS_PER_REQUEST) : []
// :171-172
if (url === '/tablet-log' && req.method === 'POST') {
  handleTabletLog(req, res)
```

**Wrong result / impact:** JSON parsing succeeds with `null`, then `parsed.host` raises a TypeError outside the catch in an asynchronous HTTP callback. The request error listener does not catch exceptions thrown by that callback. This is a remotely triggerable uncaught exception in Electron's main process, risking application disruption and leaving the request unanswered. Whether this Electron build exits or presents an error dialog is **UNVERIFIED**; the uncaught exception path itself is established. Per-request byte limits do not help with this four-byte input.

**Fix direction:** Require a non-null object before property access and contain errors across the whole request handler.

## BB-007 | Medium | CONFIRMED | Notes do not trigger the advertised session autosave

**Locations:** `src/main/services/overlay.ts:90-122`, `:870-875`; `src/main/ipc.ts` note handlers, confirmed below in review continuation.

**Input:** Open a saved session, add a note after all overlay changes have settled, then close without pressing Save. Deleting a saved note has the analogous failure.

**Evidence:**

```ts
// overlay.ts:90-92
function notifyChange(): void {
  onChangeCallback?.()
  scheduleAutoSave()
}
// overlay.ts:870-875
export function addNote(note: Note): void {
  notes.unshift(note)
}
export function deleteNote(id: string): void {
  notes = notes.filter((n) => n.id !== id)
}
```

**Wrong result / impact:** These mutations bypass `notifyChange()`, the path that schedules persistence. Notes survive only if another overlay change later schedules a save or the user explicitly saves. A clean quit deletes recovery snapshots (see BB-008). The saved session therefore loses a newly added note or resurrects a deleted note.

**Fix direction:** Route note changes through the same persistence notification as other session edits, and flush pending session changes on exit.

## BB-008 | Medium | CONFIRMED | Clean shutdown discards edits inside the autosave debounce window

**Locations:** `src/main/services/overlay.ts:102-122`; `src/main/index.ts:301-322`; `src/main/services/backup.ts:34-35`, `:67-78`.

**Input:** Change a loaded session's trigger or styling, then quit before its 800 ms autosave timer runs.

**Evidence:**

```ts
// overlay.ts:103-108,122
const AUTO_SAVE_DEBOUNCE_MS = 800
function scheduleAutoSave(): void {
  if (!session.getCurrentSession()) return
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(() => {
// ... session.saveSession(...) inside timer ...
  }, AUTO_SAVE_DEBOUNCE_MS)
}
// index.ts:301-315
app.on('before-quit', () => {
  logger.info('Shutting down...')
  events.recordEvent('system', 'BroadcastBuddy shutting down')
  crashRecovery.stopSnapshots()
  backup.stopBackupSchedule()
  hotkeys.unregister()
  systemMonitor.stopMonitoring()
  showMonitor.stopShowMonitor()
  voiceDirector.stopVoiceDirector()
  padHelper.stopPadHelper()
  backup.backupSettings()
  crashRecovery.clearDirty()
  crashRecovery.discardSnapshot()
```

**Wrong result / impact:** The quit handler neither saves the session nor waits for the pending save. It marks the shutdown clean and removes the recovery snapshot. The final backup only copies `config.json`, not session files, so it cannot preserve these pending edits. The next launch restores the old saved content with no recovery offer.

**Fix direction:** Expose and call a synchronous session flush before clearing recovery state. Keep recovery state if flushing fails.

## BB-009 | High | CONFIRMED | Live package pushes are silently dropped unless the Package tab is open

**Locations:** `src/renderer/components/TabbedCard.tsx:20-22`, `:37`; `src/renderer/components/App.tsx:176-183`; `src/renderer/components/BroadcastPackagePanel.tsx:33-63`; `src/main/services/wsHub.ts:443-451`; `src/main/ipc.ts:1879-1882`.

**Input:** Start the app and leave Broadcast on its default Stream tab. CC sends a live package through WS or the realtime relay. Alternatively, open Package once, switch to Notes, then push.

**Evidence:**

```tsx
// TabbedCard.tsx:21-22,37
const [active, setActive] = useState(tabs[0]?.id ?? '')
const current = tabs.find((t) => t.id === active) ?? tabs[0]
<div className="tabbed-card-body">{current?.content}</div>
// App.tsx:179-182
{ id: 'stream', label: 'Stream', content: <StreamInfoPanel /> },
{ id: 'package', label: 'Package', content: <BroadcastPackagePanel /> },
{ id: 'recording', label: 'Recording', content: <RecordingUploadPanel /> },
{ id: 'notes', label: 'Notes', content: <NotesPanel /> },
// BroadcastPackagePanel.tsx:44-47,58-61
window.api.on('cc:package-pushed', async (pkg: unknown) => {
  const data = pkg as BroadcastPackage
  try {
    const result = await window.api.ccApplyPackage(data, data.eventId)
// ...
return () => {
  window.api.removeAllListeners('cc:checklist-update')
  window.api.removeAllListeners('cc:package-applied')
  window.api.removeAllListeners('cc:package-pushed')
```

**Wrong result / impact:** Only the active tab mounts. The package application listener lives exclusively inside a component that is absent by default and removed on tab switch. Main forwards the message to the renderer but does not apply or queue it. The live event update disappears without acknowledgement or retry; opening Package later does not recover it. This is a dead feature under the default UI state, not just a missing visual refresh.

**Fix direction:** Own package receipt/application in the main process or an always-mounted application service. Tabs should subscribe to current state, not own essential message delivery.

## BB-010 | High | CONFIRMED | Gallery upload reports published success even when uploads or publication fail

**Locations:** `src/main/services/galleryService.ts:809-860`; `src/main/ipc.ts:1276-1284`.

**Input:** The create-gallery and create-routines requests succeed, but a photo upload returns HTTP 500, or the final publish request returns HTTP 403/500.

**Evidence:**

```ts
// galleryService.ts:834-840
if (uploadRes.ok) {
  match.uploaded = true
  uploaded++
}
} catch (err) {
  logger.warn(`Upload failed for ${match.filePath}:`, err)
}
// galleryService.ts:848-860
const publishRes = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/gallery/${galleryId}/publish`, {
  method: 'POST',
  headers,
})
const publishData = publishRes.ok
  ? ((await publishRes.json()) as { url: string })
  : { url: `https://gallery.streamstage.live/${gallerySlug}` }
galleryConfig.galleryUrl = publishData.url
emitProgress('complete', `Gallery published: ${publishData.url}`, uploaded, matchedPhotos.length)
return { galleryId, galleryUrl: publishData.url }
```

**Wrong result / impact:** Failed uploads are skipped, yet the gallery is still published. A rejected publication is converted to an invented URL and a `complete` / `Gallery published` event. The caller receives an ordinary success return for an incomplete or unpublished deliverable. There is no failed-file list in this return path for the operator to retry selectively.

**Fix direction:** Track per-file failures, require an explicit partial-publication decision, and propagate publish failures instead of constructing a success URL.

## BB-011 | High | CONFIRMED | Switching to a package without realtime leaves the previous event's remote control armed

**Locations:** `src/main/ipc.ts:984-1032`; `src/main/services/ccRelay.ts:99-112`, `:293-313`, `:345-363`.

**Input:** Apply event A's package with a valid `realtime` block, then apply event B's package without that block (explicitly supported as an older-package case). A subsequent package or overlay-config broadcast arrives for A.

**Evidence:**

```ts
// ipc.ts:984-987
// Auto-arm the CC→BB live relay if the package carries a `realtime` block.
// tenantId comes from the saved CC connection settings used for the fetch.
// No realtime block → leave the relay dormant (back-compat with old packages).
const rt = pkg.realtime
// ipc.ts:999,1012-1014
if (rt && rt.supabaseUrl && rt.supabaseAnonKey) {
  // ... build relayCfg ...
  settings.set('ccRelayConfig', relayCfg)
  ccRelay.init(relayCfg)
}
// ipc.ts:1021,1030-1032
if (rt && rt.supabaseUrl && rt.supabaseAnonKey && resolvedEventId) {
  // ... build chatCfg ...
  settings.set('chatConfig', chatCfg)
  chatBridge.init(chatCfg)
}
// ccRelay.ts:305-306
.on('broadcast', { event: 'overlay-config' }, ({ payload }) => {
  try { onOverlayConfig?.(payload) } catch (err) {
```

**Wrong result / impact:** Neither conditional has a disconnect/clear branch. A's already running subscriptions and persisted configs remain active while B's playlist is loaded. A can still change B's live overlay or replace its package, and A's viewer chat can remain in B's operator view. A restart also reuses the stale saved relay configuration. This cross-event mix-up is proven locally; it does not assume a flaw in external tenant authorization.

**Fix direction:** Explicitly transition relay/chat ownership on every event change. A package with no realtime configuration must disable and clear the preceding event's subscriptions/configuration, rather than leave them running.

## BB-012 | High | CONFIRMED | Unescaped styling values inject executable HTML into the OBS browser source

**Locations:** `src/main/services/overlaySource.ts:6-23`; `src/main/services/overlayConfigApply.ts:17-34`; `src/main/ipc.ts:927-944`; `src/main/services/overlay.ts:960-962`.

**Input:** Apply an otherwise valid package whose `overlayConfig.fontFamily` is `sans-serif;</style><script>window.__bbAuditMarker=true</script><style>`. Refresh the OBS browser source after application. The sentinel illustrates the sink; no exploit was run.

**Evidence:**

```ts
// overlayConfigApply.ts:18,31-34
'fontFamily', 'fontSize', 'fontWeight', 'textColor', 'backgroundColor',
const copy = <K extends keyof OverlayStyling>(k: K) => {
  if (oc[k as string] !== undefined) updates[k] = oc[k as string] as OverlayStyling[K]
}
OVERLAY_STYLING_KEYS.forEach((k) => copy(k))
// overlaySource.ts:11,16,23
return `<!DOCTYPE html>
// ...
<style>
// ...
    font-family: ${styling.fontFamily};
// overlay.ts:960-962
app.get('/overlay', (_req, res) => {
  res.type('html').send(buildOverlayHTML(overlayState, configuredWsPort))
})
```

**Wrong result / impact:** A CSS value reaches an HTML raw-text element without validation or escaping. `</style>` terminates that element regardless of CSS grammar; the injected script becomes part of the served page. The field is also saved with the session, making the injection persistent. Code runs in the OBS/browser-source origin and can change visible broadcast output or call reachable control endpoints. Native code execution is not established. Escaping ordinary text elsewhere in the overlay does not cover this server-generated CSS.

**Fix direction:** Validate styling against concrete types and safe font choices; keep untrusted values out of HTML string interpolation. Apply dynamic styles through DOM APIs after safe data serialization and enforce an appropriate CSP.

## BB-013 | Medium | CONFIRMED | Recording Upload loses its event context because it cannot be mounted with Package

**Locations:** `src/renderer/components/RecordingUploadPanel.tsx:12`, `:19-29`, `:84`; `src/renderer/components/App.tsx:179-182`; `src/renderer/components/TabbedCard.tsx:37`; `src/main/ipc.ts:970-975`.

**Input:** Use the Package tab to apply an event, then select the Recording tab to upload its recording.

**Evidence:**

```tsx
// RecordingUploadPanel.tsx:12,20-28,84
const [uploadState, setUploadState] = useState<UploadState | null>(null)
useEffect(() => {
  window.api.on('cc:recording-context', (...args: unknown[]) => {
    setUploadState({
      eventId: args[0] as string,
      eventName: args[1] as string,
      driveFolderUrl: (args[2] as string) || null,
    })
  })
  return () => window.api.removeAllListeners('cc:recording-context')
}, [])
if (!uploadState) return null
// ipc.ts:974
win.webContents.send('cc:recording-context', pkg.eventId || eventId || '', pkg.event.eventName, folderUrl)
// TabbedCard.tsx:37
<div className="tabbed-card-body">{current?.content}</div>
```

**Wrong result / impact:** During package application the Recording tab component does not exist, so its one-shot context event is dropped. Opening Recording creates fresh null state and renders nothing; there is no query to retrieve the last applied context. Even if context is obtained by applying through the header while Recording is active, switching away destroys it. This is the same architectural lifetime mistake as BB-009 but breaks a separate user-visible feature with a distinct repair requirement: recording context must be stored and queryable.

**Fix direction:** Keep applied-event/upload context in main or the shared store and hydrate it whenever the panel mounts.

## BB-014 | High | CONFIRMED | Upload dedup skips changed files and different destination galleries

**Locations:** `src/main/services/r2Upload.ts:257-267`, `:332-338`; `src/main/services/galleryService.ts:200-235`; `src/main/services/importManifest.ts:160-174`; `src/main/ipc.ts:1321-1349`.

**Input A:** Scan and upload a photo folder to gallery A, then upload the same folder to a different gallery slug B or a different configured bucket.

**Input B:** After uploading a photo, replace its bytes at the same pathname, rescan, then upload again.

**Evidence:**

```ts
// r2Upload.ts:261-267
workItems = items.filter((item) => {
  const entry = byPath.get(path.resolve(item.localPath))
  if (entry?.uploaded) {
    dedupSkipped++
    return false
  }
  return true
})
// galleryService.ts:224-233, replacement entry after a failed cache match
const entry: ManifestEntry = {
  sourcePath: p,
  size: stat.size,
  mtime: stat.mtime.toISOString(),
  sourceHash: sourceHash || `path:${path.resolve(p)}`,
  exifIso: captureTime.toISOString(),
  uploaded: priorEntry?.uploaded ?? false,
  r2Key: priorEntry?.r2Key,
  importedAt: new Date().toISOString(),
  uploadedAt: priorEntry?.uploadedAt,
}
```

**Wrong result / impact:** The skip predicate checks only pathname plus a global uploaded flag, ignoring the requested object key, bucket, and current content hash. A new gallery can finish with zero objects uploaded because another gallery previously received those photos. A changed photo inherits `uploaded: true` even when its new hash proves it is different, leaving the old bytes at the destination indefinitely. The UI receives an ordinary success response, with no skipped-file details (`ipc.ts:1352`).

**Fix direction:** Track successful uploads by content identity plus destination identity (endpoint, bucket, key). Invalidate completion on source changes, and include skipped outcomes in the returned result.

## BB-015 | High | CONFIRMED | Stopping Auto Director does not cancel an in-flight automatic scene cut

**Locations:** `src/main/services/autoDirector.ts:185-222`, `:260-272`.

**Input:** Configure a transition; when a scheduled cut is awaiting `GetCurrentSceneTransition` or a transition-setting request, toggle Auto Director off or manually select another program scene. Let the outstanding request resolve afterward.

**Evidence:**

```ts
// autoDirector.ts:187-206
const target = next
pendingCut = target
// ...
void (async () => {
  let prev: { name?: string; ms?: number } | null = null
  if (trans) {
    try {
      const r = (await obs.sendRequest('GetCurrentSceneTransition')) as { transitionName?: string; transitionDuration?: number }
      prev = { name: r?.transitionName, ms: r?.transitionDuration ?? undefined }
      if (prev.name !== trans) await obs.setCurrentTransitionByName(trans)
      if (c.transitionMs) await obs.setCurrentTransitionDuration(c.transitionMs)
    } catch (err) {
      logger.warn(`auto director: transition ${trans} not applied: ${err instanceof Error ? err.message : err}`)
    }
  }
  try {
    await obs.setCurrentScene(target)
// :260-266
export function stop(reason: string): AutoDirectorState {
  if (tick) { clearInterval(tick); tick = null }
  if (on) logger.info(`auto director: OFF (${reason})`)
  on = false
  next = null
  queue = []
  pendingCut = null
```

**Wrong result / impact:** `stop()` clears scheduling state but the async closure still holds `target` and unconditionally sends `SetCurrentProgramScene` after its awaits. The broadcast can cut away from the operator's manually selected shot while the UI says Auto Director is off. The delayed transition restore also changes the transition later without checking whether the operator changed it (`:211-220`); its catch comment claims to preserve operator changes, but no comparison implements that claim.

**Fix direction:** Use a run generation/cancellation token checked after every await and before each mutation; cancel or guard delayed restores and restore only if the active transition is still the one this operation set.

## BB-016 | High | CONFIRMED | Package logo fetches turn the main process into an internal HTTP reader

**Locations:** `src/main/ipc.ts:816-834`, `:909-915`; `src/main/services/overlay.ts:968-976`; `src/main/services/wsHub.ts:443-451`; `src/renderer/components/BroadcastPackagePanel.tsx:44-47`.

**Input:** An otherwise valid package supplies a trigger `logoUrl` pointing to an unauthenticated HTTP endpoint reachable only from the operator computer, for example a loopback administrative status endpoint. A LAN peer can submit this package while Package is mounted, then request `/triggers` to read the resulting data URL.

**Evidence:**

```ts
// ipc.ts:816-823
async function fetchAsDataUrl(url?: string | null): Promise<string> {
  if (!url) return ''
  try {
    const res = await fetch(url)
    if (!res.ok) return ''
    const buffer = Buffer.from(await res.arrayBuffer())
    const contentType = res.headers.get('content-type') || 'image/png'
    return `data:${contentType};base64,${buffer.toString('base64')}`
// :832-841
pkg.triggers.map(async (t, i) => {
  const logoDataUrl = await fetchAsDataUrl(t.logoUrl)
  return {
    // other trigger fields
    logoDataUrl,
// overlay.ts:972-973
app.get('/triggers', (_req, res) => {
  res.json({ triggers, selectedIndex })
```

**Wrong result / impact:** Main fetches arbitrary supplied URLs, follows fetch redirects, does not restrict private/loopback hosts, and does not verify that the response is an image. Successful response bytes are retained verbatim as base64 and returned by the unauthenticated trigger endpoint. CORS on the target does not constrain this server-side fetch. A responding internal target is a deployment-dependent prerequisite; no specific internal service or data exposure was tested. The URL-to-fetch-to-public-state path is confirmed. Unbounded `arrayBuffer()` and parallel per-trigger fetching also permit memory exhaustion with large responses.

**Fix direction:** Apply a trusted image-origin policy with redirect and resolved-address checks, enforce streaming byte/time limits, and decode/re-encode accepted images instead of reflecting arbitrary response bodies.

## BB-017 | High | CONFIRMED | Unauthenticated discovery packet redirects the display stream to its sender

**Locations:** `src/main/services/wifiDisplay.ts:192-207`, `:220-244`, `:255`, `:484-485`, `:528`, `:671`.

**Input:** With Wi-Fi Display running and a saved tablet IP, another LAN device sends `{"type":"compsync-discover-request"}` to UDP port 5002 from a different IP.

**Evidence:**

```ts
// wifiDisplay.ts:196-197
const data = JSON.parse(msg.toString())
if (data.type !== 'compsync-discover-request' || !running) return
// :225-237
if (savedIp && rinfo.address && rinfo.address !== savedIp) {
  driftAdoptedThisSession = true
  // logging omitted
  setSettings({
    wifiDisplay: { ...current.wifiDisplay!, clientIp: rinfo.address },
  })
  if (running) {
    void (async () => {
      try {
        await stop()
        await start()
// :484-485
if (wd.clientIp) {
  args.push('--client', wd.clientIp)
}
// :528 and :671, both startup and shutdown reset the supposed one-shot guard
 driftAdoptedThisSession = false
```

**Wrong result / impact:** Discovery, which should identify a service, writes the untrusted sender's address into persistent client configuration and restarts screen streaming toward it. No tablet identity or pairing proof is checked. The legitimate tablet loses its feed and the attacker becomes the configured stream destination. The one-shot guard resets during that very restart, so two devices can repeatedly redirect/restart the service. Actual decoding of the helper's stream was not exercised; the destination hijack and restart follow directly from these arguments and state mutations.

**Fix direction:** Separate discovery from pairing. Require an authenticated existing device identity or explicit operator approval before changing the destination; preserve a meaningful pairing/generation guard across internal restarts.

## BB-018 | High | CONFIRMED | Document import permanently discards every extracted row after the first ten

**Locations:** `src/main/services/llmService.ts:134-163`; `src/renderer/components/FieldMapper.tsx:36-38`, `:343-345`; `src/renderer/components/ImportPanel.tsx:53-59`, `:101-109`, `:219-224`.

**Input:** A document is successfully extracted into 25 JSON rows. Accept the mapping and import.

**Evidence:**

```ts
// llmService.ts:134-135
// Create sample data (first 10 rows)
const sampleData: Record<string, string>[] = parsed.slice(0, 10).map((item: Record<string, unknown>) => {
// :144
const triggers: Trigger[] = parsed.map((item: Record<string, unknown>, i: number) => ({
// :159-163, full triggers are not returned
return {
  rawFields,
  sampleData,
  suggestedMappings,
}
// FieldMapper.tsx:37-38
const previewTriggers = useMemo((): Trigger[] => {
  return sampleData.slice(0, 20).map((row, i) => {
// :343
onClick={() => onApply(mappings, previewTriggers)}
// ImportPanel.tsx:108
setParsedTriggers(finalTriggers)
```

**Wrong result / impact:** Only ten rows cross the service boundary. The mapper then treats those preview rows as the full import payload. Rows 11 through 25 are lost even though the service constructs and logs all 25 triggers. Replace mode can replace a complete existing playlist with this truncated subset. The full `triggers` construction is dead work: its result is never returned.

**Fix direction:** Return full extracted rows separately from the bounded preview, apply mappings over the full dataset, and use preview slicing exclusively for rendering.

## BB-019 | High | CONFIRMED | Most trigger edits bypass autosave and leave OBS with stale text

**Locations:** `src/main/services/overlay.ts:197-230`, `:90-122`; `src/main/ipc.ts:360-375`, `:91-99`.

**Input:** In a loaded session with no pending save, edit the title of the selected but hidden trigger, then Fire without reselecting. Or add/delete a trigger or edit an unselected trigger, wait several seconds without other changes, then restart without manual Save.

**Evidence:**

```ts
// overlay.ts:207
triggers.push(t)
// :210-218
export function updateTrigger(id: string, updates: Partial<Trigger>): void {
  const idx = triggers.findIndex((t) => t.id === id)
  if (idx !== -1) {
    triggers[idx] = { ...triggers[idx], ...updates }
    if (idx === selectedIndex && overlayState.lowerThird.visible) {
      applyTriggerToOverlay(triggers[idx])
      notifyChange()
    }
  }
}
// :225-229
triggers.splice(idx, 1)
if (selectedIndex >= triggers.length) {
  selectedIndex = triggers.length - 1
}
// ipc.ts:366-369
ipcMain.handle(IPC.TRIGGER_UPDATE, (_e, id: string, updates: Partial<Trigger>) => {
  overlay.updateTrigger(id, updates)
  pushState()
  return overlay.getTriggers()
})
```

**Wrong result / impact:** Add/delete never call `notifyChange`; update calls it only for the selected visible row. IPC `pushState()` only sends renderer snapshots, not session persistence or WS broadcasts. These changes therefore look accepted but are not autosaved. Editing a hidden selected trigger also leaves its cached overlay text unchanged; normal `fireLowerThird()` changes visibility without copying the new text (`overlay.ts:496-544`), so the next fire shows the old title. BB-007 is the same missing-notification problem for notes. Its caller check is now complete: `ipc.ts:618-633` only invokes `addNote`/`deleteNote` and returns, with no compensating save.

**Fix direction:** Make every trigger mutation update the selected cached overlay when applicable, broadcast, and schedule persistence. Keep visibility separate from data synchronization.

## BB-020 | Medium | CONFIRMED | Reorder and deletion change the selected routine without updating its displayed overlay

**Locations:** `src/main/services/overlay.ts:222-239`, `:242-245`, `:496-507`.

**Input:** Playlist `[A,B,C]`, selected B at index 1. Delete A, or reorder to `[B,A,C]`, then Fire.

**Evidence:**

```ts
// overlay.ts:225-229
triggers.splice(idx, 1)
if (selectedIndex >= triggers.length) {
  selectedIndex = triggers.length - 1
}
// :232-239
export function reorderTriggers(ids: string[]): void {
  const ordered: Trigger[] = []
  for (const id of ids) {
    const t = triggers.find((tr) => tr.id === id)
    if (t) ordered.push({ ...t, order: ordered.length })
  }
  triggers = ordered
  notifyChange()
}
// :497,501,504
const selected = selectedIndex >= 0 && selectedIndex < triggers.length ? triggers[selectedIndex] : null
playedSet.add(selected.id)
applyRoutineForTrigger(selected.dancerCount)
```

**Wrong result / impact:** Deleting A leaves index 1 pointing to C; reorder leaves it pointing to A. Neither operation preserves B's selected ID or reapplies the newly indexed trigger to overlay text. The UI selection and fire-time played marker/camera framing now refer to one routine while the cached lower third still describes B. Reorder autosaves the wrong selected index, making the selection change persist.

**Fix direction:** Preserve selected trigger identity across structural edits and define a fallback when that trigger itself is removed. Recompute overlay content whenever selection changes.

## BB-021 | Medium | CONFIRMED | Field Mapper's editable cells discard every edit

**Locations:** `src/renderer/components/FieldMapper.tsx:129-141`, `:295-304`, `:343`.

**Input:** Click a mapped title cell, type a correction, then press Enter or click away. Apply the import.

**Evidence:**

```ts
// FieldMapper.tsx:129-137
function startEditingCell(row: number, field: string, currentValue: string) {
  setEditingCell({ row, field })
  setEditValue(currentValue)
}
function commitEdit() {
  setEditingCell(null)
  setEditValue('')
}
// :298-303
value={editValue}
onChange={(e) => setEditValue(e.target.value)}
onBlur={commitEdit}
onKeyDown={(e) => {
  if (e.key === 'Enter') commitEdit()
  if (e.key === 'Escape') cancelEdit()
}}
// :343
onClick={() => onApply(mappings, previewTriggers)}
```

**Wrong result / impact:** The editor captures the new text but commit only clears local editing state. It never updates the source rows, mappings, or generated trigger. Enter and Escape have the same data effect, despite the UI explicitly offering confirmation. The imported title remains the original value. This is a nonfunctional feature, not a display-only discrepancy.

**Fix direction:** Store row overrides and merge them into both preview and final mapped output on commit.

## BB-022 | High | CONFIRMED | Pinning chat can unexpectedly run the selected routine's camera move

**Locations:** `src/main/ipc.ts:1800-1803`, `:1837`; `src/main/services/overlay.ts:496-507`, `:560-565`, `:578-600`; `src/main/services/cameraDirector.ts:335-354`.

**Input:** Select a routine with an attached camera sweep/replay, then pin a chat message. Or turn camera auto mode on and pin chat while a routine is selected.

**Evidence:**

```ts
// ipc.ts:1800-1801
chatBridge.setOnMessagePinned((msg) => {
  overlay.fireText(msg.text, msg.author ? `— ${msg.author}` : '', 'PINNED')
// overlay.ts:560-565
export function fireText(title: string, subtitle = '', label = ''): void {
  overlayState.lowerThird.name = title
  overlayState.lowerThird.title = title
  overlayState.lowerThird.subtitle = subtitle
  overlayState.lowerThird.label = label
  fireLowerThird(true)
}
// overlay.ts:499-507, executed before forceLowerThird is tested
if (selected) {
  playedSet.add(selected.id)
  applyRoutineForTrigger(selected.dancerCount)
  if (selected.cameraMove) runTriggerCameraMove(selected.cameraMove)
}
```

**Wrong result / impact:** A transient chat pin marks the selected routine played, restarts its automatic camera cadence, and executes its attached camera move. The `true` flag only bypasses title-card rendering; it does not bypass playlist/camera side effects. The separate `fireAdhoc` path already duplicates the show/timer logic specifically to avoid those side effects, so two arbitrary-text features behave differently. Up Next/That Was also call `fireLowerThird()` and inherit the selected routine's side effects (`overlay.ts:436-448`).

**Fix direction:** Separate the primitive that displays transient text from the operation that fires a playlist cue. Route chat and neighboring-routine previews through the side-effect-free primitive.

## BB-023 | High | CONFIRMED design risk | Recording upload allocates the entire video in the main process

**Locations:** `src/main/ipc.ts:1037-1057`; `src/main/services/r2Upload.ts:110-113`, `:131-159`.

**Input:** Select a recording larger than the process can allocate as one buffer, or a multi-gigabyte recording on a low-memory operator machine.

**Evidence:**

```ts
// ipc.ts:1039,1048-1049
const fileBuffer = fs.readFileSync(filePath)
const formData = new FormData()
formData.append('file', new Blob([fileBuffer], { type: mime }), name)
// r2Upload.ts:110-113, the other upload implementation explicitly anticipates large recordings
// S3/R2 single-PUT caps at 5GB; recital videos run 10-15GB (CC inbox request).
// Engage multipart above 100MB — also more resilient for medium videos.
const MULTIPART_THRESHOLD = 100 * 1024 * 1024
const MULTIPART_PART_SIZE = 100 * 1024 * 1024
```

**Wrong result / impact:** The CC/Drive route synchronously reads the whole recording before starting the request, then constructs a Blob from those bytes. The event loop that controls OBS, overlays, and cameras is blocked during the read. A file above the runtime buffer limit fails before upload; memory pressure below that limit can stall or terminate the process. The exact memory threshold and peak duplication on the shipped runtime are **UNVERIFIED**. The bounded multipart path exists in another service but is not used here.

**Fix direction:** Use streamed/resumable upload with bounded memory and move expensive file work off the main control loop. Return actual upload progress and size constraints before allocating.

## BB-024 | Medium | CONFIRMED | Clean saves omit the Starting Soon scene and its media/layout configuration

**Locations:** `src/main/services/overlay.ts:679-684`, `:111-121`; `src/main/services/session.ts:47-72`; `src/main/ipc.ts:474-485`; `src/main/index.ts:239-248`, `:313-315`.

**Input:** Customize Starting Soon title, countdown, slideshow/sponsors, design, or placement, press Save, then cleanly restart.

**Evidence:**

```ts
// overlay.ts:679-684
export function updateStartingSoon(updates: Partial<StartingSoonState>): void {
  const nextMedia = updates.media
    ? { ...(overlayState.startingSoon.media ?? DEFAULT_STARTING_SOON_MEDIA), ...updates.media }
    : overlayState.startingSoon.media
  overlayState.startingSoon = { ...overlayState.startingSoon, ...updates, media: nextMedia }
  notifyChange()
}
// session.ts:60-68, complete set of saved mutable content fields
currentSession.triggers = triggers
currentSession.styling = styling
currentSession.companyLogoDataUrl = companyLogoDataUrl
currentSession.clientLogoDataUrl = clientLogoDataUrl
if (selectedIndex !== undefined) currentSession.selectedIndex = selectedIndex
if (playedIds !== undefined) currentSession.playedIds = playedIds
if (savedLoopMode !== undefined) currentSession.loopMode = savedLoopMode
if (savedNotes !== undefined) currentSession.notes = savedNotes
if (savedStreamConfig !== undefined) currentSession.streamConfig = savedStreamConfig
// index.ts:315
crashRecovery.discardSnapshot()
```

**Wrong result / impact:** Starting Soon edits schedule an autosave, but neither the autosave call nor the manual-save call serializes `startingSoon`. The full overlay exists only in the crash snapshot, which a clean exit deletes. A successful Save therefore cannot restore the configured scene. Ticker and other overlay-only settings have the same persistence omission; transient visibility itself need not be restored, but authored content/design does.

**Fix direction:** Persist authored scene configuration in the session schema and restore it independently from ephemeral on-air visibility/timers.

## BB-025 | Medium | CONFIRMED | Multi-video transcription duplicates the entire program for every video

**Locations:** `src/main/services/audioTranscription.ts:334-341`, `:353-360`, `:410-430`, `:447-493`.

**Input:** Select two recordings (Act 1 and Act 2) with one shared playlist of 20 routines. Act 1 contains routines 1-10; Act 2 contains 11-20.

**Evidence:**

```ts
// audioTranscription.ts:334
}> = triggerNames.map((name, i) => {
// :353-360, absent routines are fabricated as interpolated boundaries
if (anchors.length === 0) {
  const totalDuration =
    segments.length > 0 ? segments[segments.length - 1].end : 600
  const interval = totalDuration / triggerNames.length
  for (let i = 0; i < triggerTimeline.length; i++) {
    triggerTimeline[i].startSec = i * interval
    triggerTimeline[i].confidence = 0
  }
}
// :472-473, runs inside the per-video loop
const boundaries = parseAnnouncements(segments, triggerNames, videoStartTime)
allBoundaries.push(...boundaries)
// :490-492
for (let i = 0; i < allBoundaries.length; i++) {
  allBoundaries[i].index = i
}
```

**Wrong result / impact:** Each video's parser emits one boundary for every trigger, including routines absent from that recording. Combining two videos produces 40 boundaries, each routine appearing twice, with interpolated nonexistent appearances. Renumbering conceals the original playlist identity. Downstream routine/photo matching receives duplicate and misleading intervals.

**Fix direction:** Resolve playlist coverage per video or align the combined transcript to the playlist once, preserving source-video identity and leaving absent routines explicitly unmatched.

## BB-026 | Medium | CONFIRMED | Hide and Auto-Fire Off do not cancel a queued lower-third fire

**Locations:** `src/main/services/overlay.ts:311-320`, `:366-379`, `:547-552`, `:893-910`.

**Input:** With Auto-Fire on, press Next, then Hide or turn Auto-Fire off within 300 ms. Alternatively use Next Full, then create/load another session before the delay expires.

**Evidence:**

```ts
// overlay.ts:318-320
if (autoFireEnabled) {
  setTimeout(() => fireLowerThird(), 300)
}
// :369-373
hideLowerThird()
advanceIndex(true)
applyTriggerToOverlay(triggers[selectedIndex])
notifyChange()
setTimeout(() => fireLowerThird(), 300)
// :376-379
export function toggleAutoFire(): boolean {
  autoFireEnabled = !autoFireEnabled
  logger.info(`Auto-fire ${autoFireEnabled ? 'enabled' : 'disabled'}`)
  return autoFireEnabled
}
// :547-551
export function hideLowerThird(): void {
  overlayState.lowerThird.visible = false
  if (autoHideTimer) {
    clearTimeout(autoHideTimer)
    autoHideTimer = null
  }
```

**Wrong result / impact:** Fire timeout handles are discarded, so Hide, mode changes, and reset cannot cancel them. The callback also does not recheck the flag or capture session/trigger identity. A hidden graphic reappears, and a timer from the old session can fire the newly selected session's content and camera cue.

**Fix direction:** Keep a cancelable pending-fire timer and invalidate it on hide, navigation replacement, auto-fire disable, and session changes.

## BB-027 | Medium | CONFIRMED | Starting Soon countdown restarts independently in each browser source

**Locations:** `src/main/services/overlaySource.ts:1764-1778`; `src/main/services/overlay.ts:662-664`; `src/main/ipc.ts:157`.

**Input:** Show Starting Soon with `countdownSeconds: 300` and no absolute `countdownTarget`. Two minutes later refresh OBS's browser source or connect a second source.

**Evidence:**

```js
// overlaySource.ts:1771-1777
} else if (ss.countdownSeconds && ss.countdownSeconds > 0) {
  var ssShowKey = String(ss.countdownSeconds) + '|' + (ss.visible ? '1' : '0');
  if (window._ssCdKey !== ssShowKey) {
    window._ssCdKey = ssShowKey;
    window._ssCdTargetMs = Date.now() + ss.countdownSeconds * 1000;
  }
  ssTargetMs = window._ssCdTargetMs || (Date.now() + ss.countdownSeconds * 1000);
}
// overlay.ts:662-664
export function showStartingSoon(): void {
  overlayState.startingSoon.visible = true
  notifyChange()
```

**Wrong result / impact:** The original source counts down toward the original five-minute endpoint, but the refreshed/new source starts a new five-minute interval. The main process stores only duration/visibility in this path, so a full-state reconnect cannot recover elapsed time. It violates the app's single-state-source design and can show the wrong start time on air.

**Fix direction:** Resolve an absolute countdown deadline in main when the scene is shown; broadcast that deadline to every source and retain it across reconnects.

## BB-028 | Medium | CONFIRMED | The settings backup does not include the sessions it claims to protect

**Locations:** `src/main/services/backup.ts:1-8`, `:34-35`, `:67-78`; `src/main/services/session.ts:13-18`, `:71-72`.

**Input:** Create saved sessions, run Backup Now, then need to recover a lost/corrupt session JSON or a session overwritten by package application.

**Evidence:**

```ts
// backup.ts:2-4
// Settings backup — periodic + on-demand snapshots of the electron-store
// settings file (and the sessions dir) so a corrupt profile doesn't lose
// trigger lists / overlay presets / CC config.
// :34-35
function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json')
// :68,73-75
const src = configPath()
const dest = path.join(backupsDir(), `config-${stamp()}.json`)
fs.copyFileSync(src, dest)
prune()
// session.ts:14,71-72
const dir = path.join(app.getPath('userData'), 'sessions')
const filePath = path.join(getSessionsDir(), `${currentSession.id}.json`)
writeFileAtomic(filePath, JSON.stringify(currentSession, null, 2))
```

**Wrong result / impact:** Backup success covers only `config.json`. The separately stored session files containing playlists and notes are never copied by this backup implementation. Restoring a settings backup cannot recover them. Atomic overwrites protect against partial writes but provide no historical revision after a valid destructive save.

**Fix direction:** Include versioned session snapshots in backup/restore, and describe actual backup coverage accurately in operator-facing status.

## BB-029 | Medium | CONFIRMED | Credentials are stored as plaintext and replicated into routine backups

**Locations:** `src/main/services/settings.ts:7-38`, `:68-78`; `src/main/services/backup.ts:34-35`, `:73-75`; `src/main/services/session.ts:68-72`; `src/main/ipc.ts:531-547`. Dependency implementation checked read-only at `node_modules/conf/dist/source/index.js:61`, `:121`, `:350-375`.

**Input:** Save an OBS password, model API key, R2 secret access key, or stream key through Settings, then let startup/hourly/shutdown backups run. An actor or support workflow with access to the profile/backups can read these values directly.

**Evidence:**

```ts
// settings.ts:7-8,17-18,29-38,76-78
const store = new Store<AppSettings>({
  defaults: {
    // other defaults omitted
    deepseekApiKey: '',
    geminiApiKey: '',
    obsConnection: { host: '127.0.0.1', port: 4455, password: '' },
    r2Config: { endpoint: '', accessKeyId: '', secretAccessKey: '', bucket: 'streamstage-galleries' },
  },
})
export function set<K extends keyof AppSettings>(key: K, val: AppSettings[K]): void {
  logger.info(`Setting ${key}`)
  store.set(key, val)
}
// conf implementation :61,121
this._serialize = value => JSON.stringify(value, null, '\t');
__classPrivateFieldSet(this, _encryptionKey, options.encryptionKey);
// backup.ts:74
fs.copyFileSync(src, dest)
```

**Wrong result / impact:** The Store constructor supplies defaults but no encryption or OS credential-store integration; the installed serializer writes plain JSON when no encryption key is supplied. Backup copies the entire config unchanged. Stream keys also enter session JSON. Editing/removing a current secret does not remove its historical backup copies. All settings, including secrets, are returned to renderers by the generic get/set handlers. This is at-rest exposure and unnecessary secret replication, not proof that an unauthorized actor currently has filesystem access. No actual stored credential was read during this audit.

**Fix direction:** Store credentials through OS-backed secret storage, keep references in ordinary settings/session files, and exclude credentials from routine backups and generic renderer state.

## BB-030 | High | UNVERIFIED deployment | Privileged relay messages use a public channel and no sender authentication

**Locations:** `src/main/services/ccRelay.ts:7-10`, `:99-102`, `:285-313`; `src/main/ipc.ts:111-118`, `:1879-1892`.

**Input:** A client possessing the publishable project anon key subscribes/publishes on `bb:<tenantId>:<eventId>` and sends `overlay-config`, `adhoc`, or `package` payloads.

**Evidence:**

```ts
// ccRelay.ts:99-102
function channelName(): string {
  if (!config) return ''
  return `bb:${config.tenantId}:${config.eventId}`
}
// :285-295
supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  realtime: { transport: ws as unknown as typeof WebSocket, params: { eventsPerSecond: 10 } },
})
const name = channelName()
logger.info(`Subscribing to ${name}`)
channel = supabase
  .channel(name)
  .on('broadcast', { event: 'package' }, ({ payload }) => {
    try { onPackage?.(payload) } catch (err) {
// :305-306
.on('broadcast', { event: 'overlay-config' }, ({ payload }) => {
  try { onOverlayConfig?.(payload) } catch (err) {
```

**Wrong result / impact:** BB treats channel membership as authority to operate the live overlay. The client neither requests a private channel nor verifies a message signature, operator token, or package tenant/event identity before invoking privileged callbacks. A public anon key is explicitly described as publishable. If the project's public realtime channels permit publishing, another client can impersonate CC. **UNVERIFIED:** actual Supabase public-channel settings, publication restrictions, and CC sender implementation are outside this local repository review. This is separate from table RLS in BB-002; table policies do not establish broadcast-channel authorization.

**Fix direction:** Use private authenticated channels with enforced membership/publish permissions or verify signed, event-scoped messages. Recheck current event identity before applying a relay payload.

## BB-031 | Medium | CONFIRMED | Disabling the CC relay still starts the viewer-chat network connection

**Locations:** `src/main/services/ccRelay.ts:266-277`, `:345-358`, `:366-375`.

**Input:** Initialize the saved relay configuration with `enabled: false` while retaining valid `supabaseUrl`, `supabaseAnonKey`, and `chatChannel`.

**Evidence:**

```ts
// ccRelay.ts:345-355
export function init(cfg: CcRelayConfig | undefined): void {
  disconnect()
  config = cfg ?? null
  // explanatory comments omitted
  armChatFeed()
  if (!isReady()) {
// :266-277
function armChatFeed(): void {
  teardownChatFeed()
  chatStarted = false
  if (!config || !config.supabaseUrl || !config.supabaseAnonKey || !config.chatChannel) {
    logger.info('CC viewer-chat feed: no chatChannel — staying dormant')
    return
  }
  chatChannelName = config.chatChannel
  chatStarted = true
  chatConsecutiveFailures = 0
  chatReconnectDelayMs = 2000
  connectChatFeed()
}
```

**Wrong result / impact:** The chat feed starts before the primary relay checks the enabled flag, and its own readiness check omits that flag. State reports `enabled: false` while the app still connects and ingests viewer messages. `disconnect()` also leaves `chatStarted` true, so a later CLOSED callback from that channel can schedule its reconnection (`:243-251`, `:185-194`).

**Fix direction:** Give the chat feed an explicit enabled state, enforce it before arming, and clear its started flag/generation before unsubscribing.

## Scope and evidence checkpoint

Checkpoint: 2026-11-12 14:03 ET. The report was appended after each finding and now contains 31 findings, indexed by severity: 18 High and 13 Medium. Two High findings (BB-002 and BB-030) require deployed authorization evidence and are explicitly UNVERIFIED. Other entries describe source-confirmed defects or design risks; where runtime consequences depend on platform behavior, that uncertainty is identified in the entry.

Reviewed paths include application startup/shutdown, IPC handlers, WS/HTTP/UDP interfaces, CC package application and realtime relay, chat, settings storage, session persistence, backup/recovery, gallery/import manifests and uploads, document extraction/mapping, overlay generation/state, Auto Director, shot recording/camera command paths, renderer tab lifetimes, and Stream Deck connection code. This is a broad static audit, not a claim of exhaustive review of every file or every hardware path.

No live database policies/grants, remote CC authorization, actual credentials, production systems, firewall exposure, deployed release artifacts, dependency advisory feeds, or device behavior were inspected. Therefore no deployed RLS/tenant-isolation pass is claimed. Runtime reproduction, resource thresholds, and external-service behavior remain untested. No fix was made. Existing unrelated repository modifications were left intact.

The most urgent containment candidates are unauthenticated control/discovery (BB-001, BB-017), the main-process malformed-request exception (BB-006), and package injection/internal fetch paths (BB-012, BB-016). Highest-priority correctness repairs are transactional package apply (BB-004), import completeness (BB-018), trigger persistence (BB-019), backup restore ordering (BB-005), and event delivery independent of tab lifetime (BB-009, BB-013). These are recommendations only, not changes authorized or performed by this audit.
