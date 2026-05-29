import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'

// ── Document import flow ─────────────────────────────────────────────
//
// Covers the TXT (and DOCX-if-generatable) document import path:
//   - importPreview  → ImportPreview { fileName, pageCount, textPreview, textLength }
//     (pure parse, no API key needed — text extraction is asserted here).
//   - importDocument → extractTriggers(): in the test env the DeepSeek API key
//     defaults to '' (see settings.ts), so the main handler REJECTS with
//     "DeepSeek API key not configured". If a key happens to be persisted in
//     electron-store from a prior run it instead resolves to an ExtractionResult
//     { rawFields, sampleData, suggestedMappings? }. We assert BOTH branches so
//     this converges to green regardless of key presence.
//
// PDF parsing is covered elsewhere. DOCX is a real OOXML zip we cannot author
// without a generator dep, so we skip DOCX generation and cover TXT only.

let app: ElectronApplication
let window: Page

// Files we create in a temp dir; cleaned up in afterAll.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-import-'))
const txtPath = path.join(tmpDir, 'lineup.txt')
const TXT_BODY = [
  'EVENT RUN OF SHOW',
  '',
  '1. Jane Doe — Keynote Speaker — Acme Corp',
  '2. John Smith — Panelist — Beta Industries',
  '3. Ada Lovelace — Closing Remarks — Analytical Engines',
].join('\n')

// IPC invoker that never lets a rejected promise crash the evaluate context.
// Returns a discriminated result so the test can branch on success/failure.
async function callImportDocument(filePath?: string) {
  return window.evaluate(async (fp) => {
    try {
      const result = await window.api.importDocument(fp)
      return { ok: true as const, result }
    } catch (err) {
      return { ok: false as const, error: (err as Error).message || String(err) }
    }
  }, filePath)
}

test.beforeAll(async () => {
  fs.writeFileSync(txtPath, TXT_BODY, 'utf-8')

  app = await electron.launch({
    args: [
      path.join(__dirname, '..'),
      '--disable-gpu',
      '--no-sandbox',
    ],
    env: {
      ...process.env,
      NODE_ENV: 'production',
    },
  })
  window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForTimeout(1500)

  // Clean slate.
  await window.evaluate(async () => window.api.triggerClearAll())
})

test.afterAll(async () => {
  // Remove any triggers created during the run, then close.
  if (window) {
    await window.evaluate(async () => window.api.triggerClearAll()).catch(() => {})
  }
  if (app) await app.close()
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

// ── Sanity: the import IPC surface exists ────────────────────────────

test('import IPC methods are exposed on window.api', async () => {
  const present = await window.evaluate(() => ({
    importBrowse: typeof window.api.importBrowse,
    importPreview: typeof window.api.importPreview,
    importDocument: typeof window.api.importDocument,
  }))
  expect(present.importBrowse).toBe('function')
  expect(present.importPreview).toBe('function')
  expect(present.importDocument).toBe('function')
})

// ── importPreview: TXT text extraction ───────────────────────────────

test('importPreview parses a TXT file and returns ImportPreview shape', async () => {
  const preview = await window.evaluate(async (fp) => {
    return window.api.importPreview(fp)
  }, txtPath)

  expect(preview).toBeTruthy()
  expect(preview).toHaveProperty('fileName')
  expect(preview).toHaveProperty('pageCount')
  expect(preview).toHaveProperty('textPreview')
  expect(preview).toHaveProperty('textLength')

  expect(preview.fileName).toBe('lineup.txt')
  // TXT parser sets pageCount = 1.
  expect(preview.pageCount).toBe(1)
  expect(typeof preview.textPreview).toBe('string')
  expect(typeof preview.textLength).toBe('number')
})

test('importPreview text matches the TXT contents', async () => {
  const preview = await window.evaluate(async (fp) => {
    return window.api.importPreview(fp)
  }, txtPath)

  // textLength is the full extracted length; textPreview is the first 500 chars.
  expect(preview.textLength).toBe(TXT_BODY.length)
  expect(preview.textPreview).toContain('EVENT RUN OF SHOW')
  expect(preview.textPreview).toContain('Jane Doe')
  expect(preview.textPreview).toContain('Ada Lovelace')
})

test('importPreview rejects an unsupported file extension', async () => {
  const badPath = path.join(tmpDir, 'image.bin')
  fs.writeFileSync(badPath, 'not a document')

  const outcome = await window.evaluate(async (fp) => {
    try {
      await window.api.importPreview(fp)
      return { ok: true as const }
    } catch (err) {
      return { ok: false as const, error: (err as Error).message || String(err) }
    }
  }, badPath)

  expect(outcome.ok).toBe(false)
  if (!outcome.ok) {
    expect(outcome.error).toContain('Unsupported file type')
  }
})

// ── importDocument: field-mapping extraction (key-dependent) ─────────

test('importDocument(filePath) returns ExtractionResult shape or the no-key error', async () => {
  const outcome = await callImportDocument(txtPath)

  if (outcome.ok) {
    // A DeepSeek key was configured/persisted → real ExtractionResult.
    const r = outcome.result
    expect(r).toBeTruthy()
    expect(r).toHaveProperty('rawFields')
    expect(Array.isArray(r.rawFields)).toBe(true)
    expect(r).toHaveProperty('sampleData')
    expect(Array.isArray(r.sampleData)).toBe(true)
    // suggestedMappings is optional but produced by the live path.
    if (r.suggestedMappings !== undefined) {
      expect(Array.isArray(r.suggestedMappings)).toBe(true)
    }
  } else {
    // No key in the test env (default) → deterministic error from extractTriggers.
    expect(outcome.error).toMatch(/DeepSeek API key not configured/i)
  }
})

test('importDocument() after a preview reuses the last parsed document', async () => {
  // Prime lastParsedDocument via preview, then call importDocument with no path.
  await window.evaluate(async (fp) => {
    return window.api.importPreview(fp)
  }, txtPath)

  const outcome = await callImportDocument(undefined)

  // Either it produced an ExtractionResult (key set) or threw the no-key error.
  // It must NOT throw "No document to import" — preview primed the cache.
  if (outcome.ok) {
    expect(outcome.result).toHaveProperty('rawFields')
    expect(outcome.result).toHaveProperty('sampleData')
  } else {
    expect(outcome.error).not.toMatch(/No document to import/i)
    expect(outcome.error).toMatch(/DeepSeek API key not configured/i)
  }
})

test('import flow does not auto-add triggers (parse-only handler)', async () => {
  // The IMPORT_DOCUMENT handler parses for review — it must NOT add triggers
  // to the live list. Verify the trigger list is unchanged by the import call.
  await window.evaluate(async () => window.api.triggerClearAll())

  const before = await window.evaluate(async () => window.api.triggerList())
  expect(Array.isArray(before.triggers)).toBe(true)

  await callImportDocument(txtPath)

  const after = await window.evaluate(async () => window.api.triggerList())
  expect(after.triggers.length).toBe(before.triggers.length)
})
