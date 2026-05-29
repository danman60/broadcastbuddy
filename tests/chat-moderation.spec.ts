// Chat moderation (ban / unban / hide) operates on local in-memory state and
// works even when chat is disconnected (chat is OFF by default — no Supabase).
// Operators use these live; waves.spec only checks the disabled get-state.

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

test('banAuthor adds to the banned set (works while disconnected)', async () => {
  const res = await win.evaluate(() => window.api.chatBanAuthor('spammer-1'))
  expect(res.ok).toBe(true)
  expect(res.bannedAuthors).toContain('spammer-1')
  const state = await win.evaluate(() => window.api.chatGetState())
  expect(state.bannedAuthors).toContain('spammer-1')
})

test('banAuthor is idempotent', async () => {
  const res = await win.evaluate(() => window.api.chatBanAuthor('spammer-1'))
  expect(res.ok).toBe(true)
  const count = res.bannedAuthors.filter((a: string) => a === 'spammer-1').length
  expect(count).toBe(1) // not duplicated
})

test('unbanAuthor removes from the banned set', async () => {
  await win.evaluate(() => window.api.chatBanAuthor('spammer-2'))
  const res = await win.evaluate(() => window.api.chatUnbanAuthor('spammer-2'))
  expect(res.ok).toBe(true)
  expect(res.bannedAuthors).not.toContain('spammer-2')
  const state = await win.evaluate(() => window.api.chatGetState())
  expect(state.bannedAuthors).not.toContain('spammer-2')
})

test('hide of an unknown message id is a safe no-op', async () => {
  const res = await win.evaluate(() => window.api.chatHide('no-such-message-id'))
  expect(res).toHaveProperty('ok')
})

test('cleanup: unban test authors', async () => {
  await win.evaluate(async () => {
    await window.api.chatUnbanAuthor('spammer-1')
    await window.api.chatUnbanAuthor('spammer-2')
  })
})
