# BroadcastBuddy Save/Load Issue Analysis

**Date:** 2026-03-05
**Status:** Root causes identified, ready for implementation

---

## Symptoms Observed

1. **"New" button does nothing** — no dialog appears
2. **"Save" shows no toast** (or "Failed to save")
3. **"Load" has no saved sessions** — list is always empty
4. **App doesn't remember state on restart** — starts fresh every time

---

## Console Evidence

```
index-C_X039W4.js:7260 Uncaught (in promise) Error: prompt() is not supported.
    at handleNew (index-C_X039W4.js:7260:25)
```

---

## Root Cause Analysis

### Issue 1: `window.prompt()` Is Blocked in Electron

**Evidence:** Console error `Error: prompt() is not supported.`

**Location:** `src/renderer/components/Header.tsx`
- Line 16: `const name = window.prompt('Session name:', 'Untitled Session')`
- Line 28: Same issue in save handler

**Why:** Electron runs the renderer with `contextIsolation: true` and `sandbox: true` (see `src/main/index.ts:23-25`). Modern Electron blocks `alert()`, `confirm()`, and `prompt()` in sandboxed renderers for security reasons.

**Impact:** When user clicks "New":
1. `window.prompt()` throws an error
2. `name` becomes `undefined`
3. `if (!name) return` silently exits
4. Nothing appears to happen

---

### Issue 2: Save Requires Pre-existing Session

**Location:** `src/main/services/session.ts:52-69`

```typescript
export function saveSession(...): Session | null {
  if (!currentSession) return null  // <-- Problem here
  // ...save logic
}
```

**Impact:** Since "New" never creates a session (due to Issue 1), `currentSession` is always `null`. Save returns `null`, and Header.tsx shows "Failed to save" toast.

---

### Issue 3: `sessionsDir` Setting Is Ignored

**Location:** `src/main/services/session.ts:11-17`

```typescript
function getSessionsDir(): string {
  const dir = path.join(app.getPath('userData'), 'sessions')
  // Hardcoded! Ignores AppSettings.sessionsDir
}
```

**Impact:** Sessions save to Electron's `userData` path (varies by OS/install). The setting defined in types is never used. On portable/zip installs, this path may be unexpected or non-writable.

---

### Issue 4: No Auto-Restore on Startup

**Location:** `src/main/index.ts:47-73`

```typescript
app.whenReady().then(() => {
  // 1. Load settings ✅
  // 2. Init overlay ✅
  // 3. Register IPC ✅
  // 4. Create window ✅
  // ...but NO session restore!
})
```

**Impact:** Every app restart starts with `currentSession = null`. Users must manually create/load a session every time. Session state is memory-only.

---

### Issue 5: Silent Failures in Session Listing

**Location:** `src/main/services/session.ts:89-108`

```typescript
export function listSessions(): Array<...> {
  // ...
  } catch {
    // Skip corrupt files <-- Silent swallow
  }
}
```

**Impact:** If the sessions directory doesn't exist, isn't readable, or files can't be parsed, user sees "No saved sessions" with no indication of the actual problem.

---

## Files Requiring Changes

| File | Lines | Changes Needed |
|------|-------|----------------|
| `/src/main/ipc.ts` | Add new | New IPC handler for input dialog |
| `/src/renderer/components/Header.tsx` | 15-43 | Replace `window.prompt()` with inline input or IPC dialog |
| `/src/main/services/session.ts` | 12, 52-54, 89-108 | Use `sessionsDir` setting, auto-create session, add error logging |
| `/src/main/index.ts` | 47-73 | Auto-restore last session or create default on startup |
| `/src/preload/index.ts` | Add method | Expose dialog input method (if using IPC approach) |
| `/src/renderer/types.d.ts` | Add method | Type the new API method |

---

## Implementation Options

### Option A: Inline Input (Simpler, Recommended)

Replace `window.prompt()` with React state-driven input:

1. Add `showNewSessionInput: boolean` and `newSessionName: string` to store
2. Render inline input in Header when `showNewSessionInput` is true
3. On submit, call `window.api.sessionNew(name)`

**Pros:** No main process changes needed, native look/feel

### Option B: IPC Dialog (More Work)

Add main process dialog handler:

1. `ipcMain.handle(IPC.SHOW_INPUT, ...)` → calls `dialog.showMessageBox()` with input
2. Expose in preload: `showInputDialog: (title, default) => Promise<string | null>`
3. Use in renderer: `const name = await window.api.showInputDialog('Session name', 'Untitled')`

**Pros:** Similar UX to prompt()
**Cons:** More files to modify

---

## Recommended Fix Order

1. **Critical:** Fix `window.prompt()` in Header.tsx (use inline input)
2. **Critical:** Auto-create session on save if none exists (`session.ts:54`)
3. **Important:** Auto-restore last session on startup (`index.ts`)
4. **Nice to have:** Use `sessionsDir` setting or remove it
5. **Nice to have:** Add error logging in `listSessions()`

---

## Test Plan (Post-Fix)

1. Fresh install → Open app → Click "New" → expects input field to appear
2. Enter name → Session created and shown in header
3. Add a trigger → Click "Save" → expects "Session saved" toast
4. Close app → Re-open → expects previous session auto-restored
5. Create multiple sessions → Click "Load" → expects list with all sessions
