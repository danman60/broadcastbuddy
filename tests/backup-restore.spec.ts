// Settings backup RESTORE round-trip — the recovery path an operator uses after
// a bad config. Isolated spec because restore overwrites settings. waves.spec
// covers backupNow + list; this covers the restore code path end-to-end.

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

test('backup → list → restore round-trip', async () => {
  const now = await win.evaluate(() => window.api.backupNow())
  expect(now.ok).toBe(true)
  expect(typeof now.file).toBe('string')

  const list = await win.evaluate(() => window.api.backupList())
  expect(list.length).toBeGreaterThan(0)
  const file = now.file as string
  expect(list.map((b: { file: string }) => b.file)).toContain(file)

  // Restore the backup we just took (settings unchanged → safe round-trip).
  const restored = await win.evaluate((f) => window.api.backupRestore(f), file)
  expect(restored.ok).toBe(true)

  // Settings still readable + intact after restore (server ports survive).
  const settings = await win.evaluate(() => window.api.settingsGet())
  expect(settings.server.httpPort).toBe(19080)
  expect(settings.server.wsPort).toBe(19081)
})

test('restore of a non-existent backup fails soft', async () => {
  const res = await win.evaluate(() => window.api.backupRestore('config-does-not-exist.json'))
  expect(res.ok).toBe(false)
  expect(typeof res.error).toBe('string')
})
