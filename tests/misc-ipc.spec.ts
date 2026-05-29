// Miscellaneous untested IPC: window resize, multi-note handling, delete of a
// non-existent note. Small additive coverage.

import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'

let app: ElectronApplication
let win: Page

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(__dirname, '..'), '--disable-gpu', '--no-sandbox'],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
})

test.afterAll(async () => { await app?.close() })

test('windowResize changes the main window bounds', async () => {
  await win.evaluate(() => window.api.windowResize(980, 720))
  await win.waitForTimeout(300)
  const size = await app.evaluate(async ({ BrowserWindow }) => {
    const b = BrowserWindow.getAllWindows()[0].getBounds()
    return { w: b.width, h: b.height }
  })
  expect(size.w).toBe(980)
  expect(size.h).toBe(720)
})

test('notes: add several, list reflects them, delete one', async () => {
  // Clean any existing notes first.
  const existing = await win.evaluate(() => window.api.notesList())
  await win.evaluate(async (notes) => {
    for (const n of notes as Array<{ id: string }>) await window.api.notesDelete(n.id)
  }, existing)

  const n1 = await win.evaluate(() => window.api.notesAdd('first note'))
  const n2 = await win.evaluate(() => window.api.notesAdd('second note'))
  const n3 = await win.evaluate(() => window.api.notesAdd('third note'))
  expect(n1.text).toBe('first note')
  expect(n3.text).toBe('third note')

  const list = await win.evaluate(() => window.api.notesList())
  expect(list.length).toBe(3)
  const texts = list.map((n: { text: string }) => n.text)
  expect(texts).toContain('first note')
  expect(texts).toContain('third note')

  await win.evaluate((id) => window.api.notesDelete(id), n2.id)
  const after = await win.evaluate(() => window.api.notesList())
  expect(after.length).toBe(2)
  expect(after.map((n: { id: string }) => n.id)).not.toContain(n2.id)
})

test('notes: deleting a non-existent id is a safe no-op', async () => {
  const before = await win.evaluate(() => window.api.notesList())
  await win.evaluate(() => window.api.notesDelete('does-not-exist-xyz'))
  const after = await win.evaluate(() => window.api.notesList())
  expect(after.length).toBe(before.length)
})

test('cleanup notes', async () => {
  const list = await win.evaluate(() => window.api.notesList())
  await win.evaluate(async (notes) => {
    for (const n of notes as Array<{ id: string }>) await window.api.notesDelete(n.id)
  }, list)
})
