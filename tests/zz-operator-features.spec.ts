import { test, expect, _electron as electron, chromium, type ElectronApplication, type Page, type Browser } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import http from 'http'
import { WebSocket, WebSocketServer } from 'ws'
import { DEFAULT_OVERLAY_STATE, DEFAULT_STYLING } from '../src/shared/types'

const root = path.resolve(__dirname, '..')
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-operator-'))
const staged = path.join(fixtureRoot, 'app')
const controlPath = path.join(fixtureRoot, 'voice-control.json')
const voiceLog = path.join(fixtureRoot, 'voice.ndjson')
let app: ElectronApplication, win: Page, browser: Browser, dock: Page, hub: WebSocket
let state: any, userData: string
let obs: WebSocketServer
const cams: http.Server[] = []
const cameraPorts: number[] = []
const recalls: { camera: number; slot: number }[] = []
const pageErrors: string[] = []
const consoleIssues: string[] = []
let logs: string[] = []
const api = (name: string, ...args: any[]) => win.evaluate(([n, a]) => (window as any).api[n](...a), [name, args])
const command = (action: string, data = {}) => hub.send(JSON.stringify({ type: 'command', action, data }))
const control = (mode: string, peak = 42) => {
  fs.writeFileSync(controlPath + '.next', JSON.stringify({ mode, peak }))
  fs.renameSync(controlPath + '.next', controlPath)
}
const helperMessages = () => fs.readFileSync(voiceLog, 'utf8').trim().split('\n').filter(Boolean).map(x => JSON.parse(x))
const triggers = [0, 1, 2].map(i => ({ id: `fixture-${i}`, name: `Fixture performer ${i + 1}`, title: `Fixture performer ${i + 1}`, subtitle: '', category: '', order: i, logoDataUrl: '' }))

function plantRecovery(kind: 'saved' | 'fallback' | 'legacy') {
  const snap: any = { savedAt: '2026-10-29T10:00:00-04:00', currentSessionId: kind === 'saved' ? 'saved-fixture' : null,
    currentSessionName: 'Recovery fixture', triggers, overlayState: DEFAULT_OVERLAY_STATE }
  if (kind !== 'legacy') { snap.selectedIndex = 1; snap.playedIds = ['fixture-0']; snap.loopMode = 'none' }
  fs.writeFileSync(path.join(userData, 'session.dirty'), '2026-10-29T10:00:00-04:00')
  fs.writeFileSync(path.join(userData, 'recovery-snapshot.json'), JSON.stringify(snap))
  fs.mkdirSync(path.join(userData, 'sessions'))
  const saved = { id: kind === 'saved' ? 'saved-fixture' : 'other-fixture', name: 'Saved fixture', triggers: kind === 'saved' ? triggers : [triggers[0]],
    styling: DEFAULT_STYLING, companyLogoDataUrl: '', clientLogoDataUrl: '', selectedIndex: kind === 'saved' ? 2 : 0,
    playedIds: [], loopMode: 'none', createdAt: snap.savedAt, updatedAt: snap.savedAt }
  fs.writeFileSync(path.join(userData, 'sessions', `${saved.id}.json`), JSON.stringify(saved))
}
async function launch(kind?: 'saved' | 'fallback' | 'legacy', enabled = false) {
  userData = fs.mkdtempSync(path.join(fixtureRoot, 'profile-'))
  if (kind) plantRecovery(kind)
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({
    cameraHost: '127.0.0.1', cameraPort: cameraPorts[0], cameraHost2: '127.0.0.2', cameraPort2: cameraPorts[1],
    obsConnection: { host: '127.0.0.1', port: (obs.address() as any).port, password: '' },
    ...(enabled ? { cameraUndoEnabled: true, dockRecoveryPrompt: true, voiceMeterEnabled: true, voiceEnabled: true } : {}),
  }))
  control('levels'); fs.writeFileSync(voiceLog, '')
  logs = []; pageErrors.length = 0; consoleIssues.length = 0; state = null; recalls.length = 0
  app = await electron.launch({ args: [staged, `--user-data-dir=${userData}`, '--disable-gpu', '--no-sandbox'],
    env: { ...process.env, TZ: 'America/New_York', NODE_ENV: 'production', BB_TEST_VOICE_CONTROL: controlPath, BB_TEST_VOICE_LOG: voiceLog } })
  app.process().stdout?.on('data', b => logs.push(b.toString()))
  app.process().stderr?.on('data', b => logs.push(b.toString()))
  win = await app.firstWindow(); await win.waitForLoadState('domcontentloaded')
  win.on('pageerror', e => pageErrors.push(e.message))
  win.on('console', m => { if (['warning', 'error'].includes(m.type())) consoleIssues.push(m.text()) })
  browser = await chromium.launch()
  dock = await browser.newPage({ viewport: { width: 300, height: 900 } })
  dock.on('pageerror', e => pageErrors.push(e.message))
  dock.on('console', m => { if (['warning', 'error'].includes(m.type())) consoleIssues.push(m.text()) })
  hub = new WebSocket('ws://127.0.0.1:19081')
  hub.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.type === 'state') state = m })
  await new Promise<void>(r => hub.on('open', () => r()))
  hub.send(JSON.stringify({ type: 'identify', client: 'test' }))
  await dock.goto('http://127.0.0.1:19080/dock')
  await expect.poll(() => state?.type).toBe('state')
  // Fresh profiles open the daily checklist, which shares Settings' CSS class.
  // Dismiss it through its actual UI before reaching the operator controls.
  const checklist = win.getByRole('dialog').filter({ has: win.getByRole('heading', { name: 'Start of Day — Setup', exact: true }) })
  await expect(checklist).toBeVisible()
  await checklist.locator('.settings-header').getByRole('button', { name: 'Done', exact: true }).click()
  await expect(checklist).toBeHidden()
  const startup = win.locator('div').filter({ has: win.getByText('Startup checks', { exact: true }) }).filter({ has: win.getByRole('button', { name: '✕', exact: true }) }).last()
  if (await startup.isVisible()) await startup.getByRole('button', { name: '✕', exact: true }).click()
}
async function settings(tab = 'General') {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus())
  if (!await win.getByRole('dialog', { name: 'Settings', exact: true }).isVisible()) await win.getByRole('button', { name: '⚙ Settings', exact: true }).click()
  await win.locator('.settings-tab').filter({ hasText: new RegExp(`^${tab}$`) }).press('Enter')
}
async function captureDock(name: string) {
  for (const width of [300, 390, 500, 1440]) {
    await dock.setViewportSize({ width, height: 900 })
    expect(await dock.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await dock.screenshot({ path: `tests/screenshots/operator-${name}-${width}.png`, fullPage: true })
  }
}
async function captureVoice(name: string) {
  for (const width of [300, 390, 500, 1440]) {
    await win.setViewportSize({ width, height: 1800 })
    const panel = win.locator('.voice-panel').first()
    await panel.scrollIntoViewIfNeeded()
    expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await panel.screenshot({ path: `tests/screenshots/operator-voice-${name}-${width}.png` })
  }
}

test.beforeAll(async () => {
  fs.mkdirSync(staged)
  fs.cpSync(path.join(root, 'out'), path.join(staged, 'out'), { recursive: true })
  fs.writeFileSync(path.join(staged, 'package.json'), JSON.stringify({ name: 'broadcast-buddy', version: '1.0.0', main: './out/main/index.js' }))
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(staged, 'node_modules'))
  const helper = path.join(staged, 'resources/voice-helper/voice-helper.exe')
  fs.mkdirSync(path.dirname(helper), { recursive: true })
  fs.copyFileSync(path.join(__dirname, 'fixtures/operator-voice-helper.cjs'), helper); fs.chmodSync(helper, 0o755)
  for (const camera of [1, 2]) {
    const server = http.createServer((req, res) => {
      let body = ''; req.on('data', b => body += b)
      req.on('end', () => {
        if (req.method === 'PUT' && req.url?.endsWith('/ptz/preset')) {
          const data = JSON.parse(body); if (data.operation === 'call') recalls.push({ camera, slot: data.id })
        }
        res.setHeader('content-type', 'application/json'); res.end('{"mode":"normal","presetlist":[{"id":1},{"id":3},{"id":4}]}')
      })
    })
    await new Promise<void>(r => server.listen(0, `127.0.0.${camera}`, r))
    cams.push(server); cameraPorts.push((server.address() as any).port)
  }
  obs = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  obs.on('connection', s => {
    s.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.0.0', rpcVersion: 1 } }))
    s.on('message', raw => {
      const m = JSON.parse(raw.toString())
      if (m.op === 1) s.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }))
      if (m.op === 6) s.send(JSON.stringify({ op: 7, d: { requestType: m.d.requestType, requestId: m.d.requestId,
        requestStatus: { result: true, code: 100 }, responseData: { outputActive: false } } }))
    })
  })
  await new Promise<void>(r => obs.on('listening', r))
})
test.afterEach(async ({}, info) => {
  fs.writeFileSync(path.join(fixtureRoot, `${info.title.replace(/\W/g, '-')}.log`), logs.join(''))
  fs.writeFileSync(path.join(fixtureRoot, `${info.title.replace(/\W/g, '-')}-console.json`), JSON.stringify(consoleIssues, null, 2))
  await browser?.close(); hub?.close(); try { await app?.close() } catch { /* already closed in disconnect test */ }
  expect(pageErrors).toEqual([])
})
test.afterAll(async () => {
  for (const server of cams) { server.closeAllConnections(); server.close() }
  for (const c of obs?.clients || []) c.terminate()
  obs?.close()
  console.log(`Held test profiles and logs: ${fixtureRoot}`)
})

test('defaults are off; settings enable dock controls and meter without restarting', async () => {
  await launch()
  const initial = await api('settingsGet')
  for (const key of ['cameraUndoEnabled', 'dockRecoveryPrompt', 'voiceMeterEnabled']) expect(initial[key]).toBe(false)
  await expect(dock.locator('#undo')).toBeHidden(); await expect(dock.locator('#voiceMeter')).toBeHidden()
  await captureDock('default')
  command('cameraUndo'); command('recoveryRestore'); command('recoveryDismiss')
  await settings()
  await win.getByLabel('Show camera Undo in the dock').click()
  await win.getByLabel('Offer crash recovery in the dock').click()
  await expect(dock.locator('#undo')).toBeVisible(); await expect(dock.locator('#undo')).toBeDisabled()
  const group = win.locator('.settings-group').filter({ has: win.getByText('OBS Dock', { exact: true }) })
  for (const width of [300, 390, 500, 1440]) {
    await win.setViewportSize({ width, height: 900 })
    expect(await group.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await group.screenshot({ path: `tests/screenshots/operator-settings-${width}.png` })
  }
  await settings('Camera')
  await win.getByLabel('Show live mic level in panel and dock').click()
  await expect(dock.locator('#micLevelText')).toHaveText('Level unavailable')
  await captureVoice('unavailable')
  await win.getByLabel('Show live mic level in panel and dock').click()
  await expect(dock.locator('#voiceMeter')).toBeHidden()
  await settings()
  await win.getByLabel('Show camera Undo in the dock').click()
  await win.getByLabel('Offer crash recovery in the dock').click()
  await expect(dock.locator('#undo')).toBeHidden()
})

test('undo returns to the prior slot once, includes wide, isolates cameras and ignores bad input', async () => {
  await launch(undefined, true)
  const preset = (n: number) => dock.locator('#presets button').filter({ hasText: new RegExp(`^${n}$`) }).click()
  await preset(3); await expect.poll(() => recalls.at(-1)).toEqual({ camera: 1, slot: 3 })
  await expect(dock.locator('#undo')).toBeDisabled()
  await preset(5); await expect(dock.locator('#undo')).toContainText('preset 3')
  await preset(5); await expect(dock.locator('#undo')).toContainText('preset 3')
  await dock.locator('#cam2').click(); await expect(dock.locator('#undo')).toBeDisabled()
  await preset(2); await preset(6); await expect(dock.locator('#undo')).toContainText('preset 2')
  await dock.locator('#undo').click(); await expect.poll(() => recalls.at(-1)).toEqual({ camera: 2, slot: 2 })
  await expect(dock.locator('#undo')).toBeDisabled()
  await dock.locator('#cam1').click(); await expect(dock.locator('#undo')).toContainText('preset 3')
  command('cameraPreset', { id: -1 }); command('cameraPreset', { id: 'bad' })
  await dock.locator('#undo').click(); command('cameraUndo') // duplicate command must not become redo
  await expect.poll(() => recalls.at(-1)).toEqual({ camera: 1, slot: 3 })
  await expect(dock.locator('#undo')).toBeDisabled()
  await dock.getByRole('button', { name: 'WIDE', exact: true }).click()
  await expect.poll(() => recalls.at(-1)).toEqual({ camera: 1, slot: 1 })
  await expect(dock.locator('#undo')).toContainText('preset 3')
  await captureDock('undo')
  await dock.reload(); await expect(dock.locator('#undo')).toContainText('preset 3')
  await dock.locator('#undo').click(); await expect.poll(() => recalls.at(-1)).toEqual({ camera: 1, slot: 3 })
  await preset(7); await api('settingsSet', 'cameraUndoEnabled', false)
  const count = recalls.length; command('cameraUndo'); await dock.waitForTimeout(250); expect(recalls.length).toBe(count)
  await api('settingsSet', 'cameraUndoEnabled', true); await expect(dock.locator('#undo')).toBeDisabled()
})

test('voice levels reach panel and dock; invalid, stale and old helper data stay unavailable', async () => {
  test.setTimeout(60000)
  await launch(undefined, true)
  await expect(dock.locator('#micLevelText')).toHaveText('42%')
  expect(helperMessages().filter(m => m.t === 'meter')).toEqual([{ t: 'meter', on: true }])
  const grammars = helperMessages().filter(m => m.t === 'grammar')
  expect(grammars[0].verbs.some((v: any) => v.id === 'undo')).toBe(false)
  await settings('Camera')
  await expect(win.locator('.voice-meter output')).toHaveText('42%')
  await captureVoice('live'); await captureDock('meter')
  control('levels', 0); await expect(dock.locator('#micLevelText')).toHaveText('0%')
  control('levels', 100); await expect(win.locator('.voice-meter output')).toHaveText('100%')
  control('invalid'); await expect(dock.locator('#micLevelText')).toHaveText('Level unavailable')
  control('old'); await win.getByLabel('Show live mic level in panel and dock').click()
  await expect(dock.locator('#voiceMeter')).toBeHidden()
  await win.getByLabel('Show live mic level in panel and dock').click()
  await expect(dock.locator('#micLevelText')).toHaveText('Level unavailable')
  // Old helper continues recognizing commands even when it ignores the meter extension.
  await dock.locator('#presets button').filter({ hasText: /^3$/ }).click()
  await dock.locator('#ptt').hover(); await dock.mouse.down(); await dock.mouse.up()
  await expect(dock.locator('#heard')).toContainText('4')
  await expect.poll(() => recalls.at(-1)).toEqual({ camera: 1, slot: 4 })
  await expect(dock.locator('#undo')).toContainText('preset 3')
  expect(helperMessages().filter(m => m.t === 'grammar')).toEqual(grammars)
  control('levels', 21); await expect(dock.locator('#micLevelText')).toHaveText('21%')
  await win.locator('.voice-tally').getByRole('button', { name: 'Reset', exact: true }).click()
  await win.locator('.voice-slider').focus(); await win.locator('.voice-slider').press('ArrowLeft')
  const add = win.locator('.voice-add-row input')
  await add.click(); await add.pressSequentially('fixture shot')
  await win.getByRole('button', { name: 'Save current view as Shot 2', exact: true }).click()
  await win.getByRole('button', { name: 'Save current view as Shot 3', exact: true }).click()
  await win.getByRole('button', { name: 'Verify', exact: true }).click()
  await expect(win.locator('.voice-verify-msg')).toContainText('Camera has 3 presets')
  const shot = win.locator('.voice-shots .voice-shot-row').first()
  await shot.locator('input').click(); await shot.locator('input').press('Control+A')
  await shot.locator('input').pressSequentially('renamed fixture'); await shot.locator('input').press('Tab')
  await shot.getByRole('button', { name: 'Recall', exact: true }).click()
  await shot.getByRole('button', { name: '+Glide', exact: true }).click()
  await win.locator('.voice-shots .voice-shot-row').nth(1).getByRole('button', { name: '+Glide', exact: true }).click()
  await win.getByRole('button', { name: '▸ Play Glide', exact: true }).click()
  await dock.getByRole('button', { name: 'STOP', exact: true }).click()
  await win.locator('.voice-glide-chip-del').first().click()
  await win.getByRole('button', { name: 'Clear', exact: true }).click()
  await shot.getByRole('button', { name: '✕', exact: true }).click()
  await win.locator('.voice-shots .voice-shot-del').click()
  await win.locator('.voice-segment').getByRole('button', { name: 'Cam 2', exact: true }).click()
  await expect(win.locator('.voice-shots-empty').first()).toContainText('Camera 2')
  await win.locator('.voice-segment').getByRole('button', { name: 'Cam 1', exact: true }).click()
  await win.locator('.voice-advanced-title').click(); await expect(win.locator('.voice-advanced-body')).toBeVisible()
  await win.locator('.voice-advanced-title').click()
  await win.getByLabel('Voice Control (push-to-talk)', { exact: true }).click()
  await expect(dock.locator('#micLevelText')).toHaveText('Level unavailable')
})

for (const kind of ['saved', 'fallback', 'legacy'] as const) {
  test(`dock recovery ${kind} restores the displayed performer and clears the main banner`, async () => {
    await launch(kind, true)
    const performer = kind === 'saved' ? 3 : kind === 'fallback' ? 2 : 1
    await expect(dock.locator('#resume')).toHaveText(`Resume at performer ${performer}/3`)
    await expect(win.getByRole('button', { name: 'Restore', exact: true })).toBeVisible()
    if (kind === 'fallback') {
      await captureDock('recovery')
      await win.setViewportSize({ width: 1440, height: 900 })
      await win.screenshot({ path: 'tests/screenshots/operator-recovery-main-before.png' })
    }
    await dock.reload(); await expect(dock.locator('#recovery')).toBeVisible()
    await dock.locator('#resume').click(); command('recoveryRestore')
    await expect(dock.locator('#recovery')).toBeHidden()
    await expect(win.getByRole('button', { name: 'Restore', exact: true })).toBeHidden()
    await expect.poll(() => state?.playlist.current).toBe(performer)
    expect(state.overlay.lowerThird.visible).toBe(false)
    const current = await api('sessionGetCurrent')
    expect(current.name).toBe(kind === 'saved' ? 'Saved fixture' : 'Recovery fixture (recovered)')
    await expect(win.locator('.header')).toContainText(current.name)
    if (kind === 'fallback') await win.screenshot({ path: 'tests/screenshots/operator-recovery-main-after.png' })
    if (kind !== 'saved') {
      const other = JSON.parse(fs.readFileSync(path.join(userData, 'sessions/other-fixture.json'), 'utf8'))
      expect(other.triggers.map((t: any) => t.id)).toEqual(['fixture-0'])
    }
  })
}

test('dock recovery gate, dismiss and main-window restore all stay synchronized', async () => {
  await launch('fallback')
  await expect(dock.locator('#recovery')).toBeHidden()
  command('recoveryDismiss'); command('recoveryRestore')
  expect((await api('recoveryCheck')).available).toBe(true)
  await settings(); await win.getByLabel('Offer crash recovery in the dock').click()
  await expect(dock.locator('#recovery')).toBeVisible()
  await dock.locator('#dismissRecovery').click()
  await expect(win.getByRole('button', { name: 'Restore', exact: true })).toBeHidden()
  expect((await api('recoveryCheck')).available).toBe(false)
  await dock.reload(); await expect(dock.locator('#recovery')).toBeHidden()
})

test('main-window restore clears the dock prompt through the shared action', async () => {
  await launch('fallback', true)
  await win.getByRole('button', { name: 'Restore', exact: true }).click()
  await expect(dock.locator('#recovery')).toBeHidden()
  await expect.poll(() => state?.playlist.current).toBe(2)
})

test('dock controls remain usable and become disabled for new actions when BB disconnects', async () => {
  await launch('fallback', true)
  await dock.locator('#ack').click()
  await dock.locator('#dismissRecovery').click()
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) await dock.locator('#presets button').filter({ hasText: new RegExp(`^${n}$`) }).click()
  await expect.poll(() => recalls.at(-1)).toEqual({ camera: 1, slot: 8 })
  await dock.getByRole('button', { name: 'AUTO', exact: true }).click()
  await dock.getByRole('button', { name: 'STOP', exact: true }).click()
  await dock.getByRole('button', { name: 'WIDE', exact: true }).click()
  for (const action of ['fireLT', 'hideLT', 'nextTrigger', 'prevTrigger']) await dock.locator(`[data-cmd="${action}"]`).click()
  await app.close()
  await expect(dock.locator('#chips')).toContainText('BB offline')
  await expect(dock.locator('#undo')).toBeDisabled()
  await expect(dock.locator('#micLevelText')).toHaveText('Level unavailable')
  await dock.locator('#ack').click()
  await dock.screenshot({ path: 'tests/screenshots/operator-offline.png', fullPage: true })
})

test('pending snapshot survives the periodic writer while the operator decides', async () => {
  test.setTimeout(80000)
  await launch('fallback', true)
  const file = path.join(userData, 'recovery-snapshot.json')
  const original = fs.readFileSync(file, 'utf8')
  await dock.waitForTimeout(31000)
  expect(fs.readFileSync(file, 'utf8')).toBe(original)
  await dock.locator('#resume').click()
  await expect.poll(() => state?.playlist.current).toBe(2)
  await dock.waitForTimeout(30500)
  const fresh = JSON.parse(fs.readFileSync(file, 'utf8'))
  expect(fresh.selectedIndex).toBe(1)
  expect(fresh.playedIds).toEqual(['fixture-0'])
  expect(fresh.currentSessionId).toBe((await api('sessionGetCurrent')).id)
})
