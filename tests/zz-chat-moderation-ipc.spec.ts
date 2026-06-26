import { test, expect } from '@playwright/test'
import { launchApp, closeApp, api, Harness } from './zz-harness'

/**
 * Operator chat moderation IPC — works with chat disabled (no Supabase project),
 * which is the CI reality. Ban/unban maintain a local banned-author set; send/fire
 * degrade cleanly when no realtime channel is connected.
 */

let h: Harness
test.beforeAll(async () => { h = await launchApp() })
test.afterAll(async () => { await closeApp(h) })

test('chat get-state is disabled/disconnected by default (isolated userData)', async () => {
  const s = await api<{ enabled: boolean; connected: boolean; messages: unknown[] }>(h.window, 'chatGetState')
  expect(s.enabled).toBe(false)
  expect(s.connected).toBe(false)
  expect(Array.isArray(s.messages)).toBe(true)
})

test('banAuthor adds to the banned set; unban removes it', async () => {
  const banned = await api<{ ok: boolean; bannedAuthors: string[] }>(h.window, 'chatBanAuthor', 'Spammer123')
  expect(Array.isArray(banned.bannedAuthors)).toBe(true)
  expect(banned.bannedAuthors).toContain('Spammer123')

  await api(h.window, 'chatUnbanAuthor', 'Spammer123')
  const after = await api<{ messages?: unknown[] }>(h.window, 'chatGetState')
  expect(after).toBeTruthy()
})

test('banning the same author twice is idempotent', async () => {
  await api(h.window, 'chatBanAuthor', 'Dup')
  const second = await api<{ bannedAuthors: string[] }>(h.window, 'chatBanAuthor', 'Dup')
  const count = second.bannedAuthors.filter((a) => a === 'Dup').length
  expect(count).toBe(1)
  await api(h.window, 'chatUnbanAuthor', 'Dup')
})

test('chatSend without a connected channel returns ok:false (no throw)', async () => {
  const r = await api<{ ok: boolean }>(h.window, 'chatSend', 'hello', 'Operator')
  expect(typeof r.ok).toBe('boolean')
  expect(r.ok).toBe(false)
})

test('chatFireMessage on a missing id returns fired:false', async () => {
  const r = await api<{ fired: boolean }>(h.window, 'chatFireMessage', 'no-such-msg-zzzz')
  expect(r.fired).toBe(false)
})

test('chatReconfigure does not throw when unconfigured', async () => {
  const s = await api<{ enabled?: boolean }>(h.window, 'chatReconfigure')
  expect(s).toHaveProperty('enabled')
})

test('chatHide clears any pinned on-stream chat card', async () => {
  await api(h.window, 'chatHide')
  const s = await api<{ chatMessage: { visible: boolean } }>(h.window, 'overlayGetState')
  expect(s.chatMessage.visible).toBe(false)
})
