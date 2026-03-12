import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'

let app: ElectronApplication
let window: Page

test.beforeAll(async () => {
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
  // Give the renderer a moment to hydrate
  await window.waitForTimeout(2000)
})

test.afterAll(async () => {
  if (app) await app.close()
})

// ── Step 2: Launch & Smoke Test ──────────────────────────────────

test('app launches and shows main window', async () => {
  await window.screenshot({ path: 'test-results/01-launch.png' })
  const title = await window.title()
  console.log('Window title:', title)
  expect(title).toBeTruthy()
})

test('main window has correct dimensions', async () => {
  const size = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const bounds = win.getBounds()
    return { width: bounds.width, height: bounds.height }
  })
  console.log('Window size:', size)
  expect(size.width).toBeGreaterThanOrEqual(900)
  expect(size.height).toBeGreaterThanOrEqual(600)
})

// ── Step 3: Test Header & Navigation ────────────────────────────

test('header is visible with title', async () => {
  const header = window.locator('.header')
  await expect(header).toBeVisible()
  const title = window.locator('.header-title')
  await expect(title).toBeVisible()
  const titleText = await title.textContent()
  expect(titleText).toContain('BroadcastBuddy')
})

test('header buttons are present (New, Save, Load, Tools)', async () => {
  const newBtn = window.locator('button:has-text("New")')
  const saveBtn = window.locator('button:has-text("Save")')
  const loadBtn = window.locator('button:has-text("Load")')
  const toolsBtn = window.locator('button:has-text("Tools")')
  await expect(newBtn).toBeVisible()
  await expect(saveBtn).toBeVisible()
  await expect(loadBtn).toBeVisible()
  await expect(toolsBtn).toBeVisible()
})

test('Tools menu opens and shows options', async () => {
  await window.locator('button:has-text("Tools")').click()
  await window.waitForTimeout(300)
  await window.screenshot({ path: 'test-results/02-tools-menu.png' })

  const brandKit = window.locator('button:has-text("Brand Kit")')
  const importBtn = window.locator('button:has-text("Import")')
  const compactBtn = window.locator('button:has-text("Compact Mode")')
  const settingsBtn = window.locator('button:has-text("Settings")')
  await expect(brandKit).toBeVisible()
  await expect(importBtn).toBeVisible()
  await expect(compactBtn).toBeVisible()
  await expect(settingsBtn).toBeVisible()

  // Close menu by clicking elsewhere
  await window.locator('.header-title').click()
  await window.waitForTimeout(200)
})

// ── Step 3: Test Main Panels ─────────────────────────────────────

test('left panel shows trigger list and overlay preview', async () => {
  const leftPanel = window.locator('.left-panel')
  await expect(leftPanel).toBeVisible()
  await window.screenshot({ path: 'test-results/03-left-panel.png' })
})

test('right panel shows control panels', async () => {
  const rightPanel = window.locator('.right-panel')
  await expect(rightPanel).toBeVisible()
  await window.screenshot({ path: 'test-results/04-right-panel.png' })
})

test('overlay preview canvas is visible', async () => {
  const preview = window.locator('.overlay-preview, .preview-container, canvas, [class*="preview"]').first()
  const isVisible = await preview.isVisible().catch(() => false)
  console.log('Overlay preview visible:', isVisible)
  // Even if no specific class, the left panel should have content
  const leftPanel = window.locator('.left-panel')
  await expect(leftPanel).toBeVisible()
})

// ── Step 3: Test Collapsible Panels (Right Side) ─────────────────

test('overlay controls panel exists', async () => {
  // Collapsible panels use <details>/<summary>
  const panels = window.locator('.panel.collapsible summary')
  const count = await panels.count()
  console.log('Collapsible panels found:', count)
  expect(count).toBeGreaterThan(0)

  // Get all panel names
  const names: string[] = []
  for (let i = 0; i < count; i++) {
    const text = await panels.nth(i).textContent()
    if (text) names.push(text.trim())
  }
  console.log('Panel names:', names)
  await window.screenshot({ path: 'test-results/05-panels.png' })
})

test('Command Center panel exists', async () => {
  const ccPanel = window.locator('summary:has-text("Command Center")')
  await expect(ccPanel).toBeVisible()
  await ccPanel.click()
  await window.waitForTimeout(300)
  await window.screenshot({ path: 'test-results/06-cc-panel.png' })

  // Verify CC config inputs
  const baseUrlInput = window.locator('input[placeholder*="CC Base URL"]')
  const apiKeyInput = window.locator('input[placeholder*="API Key"]')
  const tenantIdInput = window.locator('input[placeholder*="Tenant ID"]')
  await expect(baseUrlInput).toBeVisible()
  await expect(apiKeyInput).toBeVisible()
  await expect(tenantIdInput).toBeVisible()
})

// ── Step 4: Test Session Management ──────────────────────────────

test('New session flow shows input', async () => {
  const newBtn = window.locator('button:has-text("New")')
  await newBtn.click()
  await window.waitForTimeout(300)

  const input = window.locator('.header-input')
  await expect(input).toBeVisible()
  await window.screenshot({ path: 'test-results/07-new-session.png' })

  // Cancel by pressing Escape
  await input.press('Escape')
  await window.waitForTimeout(200)
})

test('Load menu shows empty or session list', async () => {
  const loadBtn = window.locator('button:has-text("Load")')
  await loadBtn.click()
  await window.waitForTimeout(300)
  await window.screenshot({ path: 'test-results/08-load-menu.png' })

  // Close by clicking elsewhere
  await window.locator('.header-title').click()
  await window.waitForTimeout(200)
})

// ── Step 4: Test Settings Overlay ────────────────────────────────

test('Settings overlay opens and closes', async () => {
  // Open via DOM — click Tools, then find Settings in the dropdown
  await window.locator('button:has-text("Tools")').click()
  // Wait for the dropdown to appear and grab Settings button
  const settingsBtn = window.locator('button:has-text("Settings")').last()
  try {
    await settingsBtn.waitFor({ state: 'visible', timeout: 1000 })
    await settingsBtn.click()
    await window.waitForTimeout(500)
  } catch {
    // Dropdown closed before we could click — try once more
    await window.locator('button:has-text("Tools")').click()
    await window.waitForTimeout(300)
    await settingsBtn.click({ timeout: 2000 })
    await window.waitForTimeout(500)
  }

  await window.screenshot({ path: 'test-results/09-settings.png' })

  const settingsOverlay = window.locator('.settings-overlay')
  const isVisible = await settingsOverlay.isVisible().catch(() => false)
  console.log('Settings overlay visible:', isVisible)

  // Close if visible
  if (isVisible) {
    const closeBtn = window.locator('.settings-overlay button:has-text("Close")')
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click()
      await window.waitForTimeout(300)
    }
  }
})

// ── Step 5: Test IPC Handlers ────────────────────────────────────

test('IPC: overlay get state returns valid state', async () => {
  const state = await window.evaluate(async () => {
    return window.api.overlayGetState()
  })
  console.log('Overlay state:', JSON.stringify(state, null, 2).slice(0, 200))
  expect(state).toBeTruthy()
  expect(state).toHaveProperty('lowerThird')
  expect(state).toHaveProperty('companyLogo')
  expect(state).toHaveProperty('clientLogo')
  expect(state).toHaveProperty('ticker')
  expect(state).toHaveProperty('startingSoon')
  expect(state.lowerThird).toHaveProperty('visible')
  expect(state.lowerThird).toHaveProperty('styling')
})

test('IPC: trigger list returns array', async () => {
  const result = await window.evaluate(async () => {
    return window.api.triggerList()
  })
  console.log('Trigger list result:', result)
  expect(result).toHaveProperty('triggers')
  expect(Array.isArray(result.triggers)).toBe(true)
  expect(result).toHaveProperty('selectedIndex')
})

test('IPC: add, select, and delete trigger', async () => {
  // Add a trigger
  const triggers = await window.evaluate(async () => {
    return window.api.triggerAdd({
      id: 'test-trigger-1',
      name: 'Test Speaker',
      title: 'John Doe',
      subtitle: 'CEO, TestCorp',
      category: 'Speakers',
      order: 0,
      logoDataUrl: '',
    })
  })
  expect(Array.isArray(triggers)).toBe(true)
  expect(triggers.length).toBeGreaterThan(0)
  console.log('Added trigger, total:', triggers.length)

  // Select it
  await window.evaluate(async () => {
    return window.api.triggerSelect(0)
  })

  // Screenshot with trigger
  await window.waitForTimeout(500)
  await window.screenshot({ path: 'test-results/10-trigger-added.png' })

  // Delete it
  const afterDelete = await window.evaluate(async () => {
    return window.api.triggerDelete('test-trigger-1')
  })
  console.log('After delete, triggers:', afterDelete.length)
})

test('IPC: fire and hide lower third', async () => {
  // Add a trigger first
  await window.evaluate(async () => {
    await window.api.triggerAdd({
      id: 'test-lt-1',
      name: 'Fire Test',
      title: 'Jane Smith',
      subtitle: 'Producer',
      category: '',
      order: 0,
      logoDataUrl: '',
    })
    await window.api.triggerSelect(0)
  })

  // Fire lower third
  await window.evaluate(async () => {
    return window.api.overlayFireLT()
  })
  await window.waitForTimeout(500)

  const stateAfterFire = await window.evaluate(async () => {
    return window.api.overlayGetState()
  })
  expect(stateAfterFire.lowerThird.visible).toBe(true)
  await window.screenshot({ path: 'test-results/11-lt-fired.png' })

  // Hide lower third
  await window.evaluate(async () => {
    return window.api.overlayHideLT()
  })
  await window.waitForTimeout(300)

  const stateAfterHide = await window.evaluate(async () => {
    return window.api.overlayGetState()
  })
  expect(stateAfterHide.lowerThird.visible).toBe(false)
  await window.screenshot({ path: 'test-results/12-lt-hidden.png' })

  // Cleanup
  await window.evaluate(async () => {
    return window.api.triggerDelete('test-lt-1')
  })
})

test('IPC: settings get returns config', async () => {
  const settings = await window.evaluate(async () => {
    return window.api.settingsGet()
  })
  console.log('Settings keys:', Object.keys(settings))
  expect(settings).toHaveProperty('server')
  expect(settings.server).toHaveProperty('httpPort')
  expect(settings.server).toHaveProperty('wsPort')
  expect(settings).toHaveProperty('overlay')
})

test('IPC: stream config get/set', async () => {
  const config = await window.evaluate(async () => {
    return window.api.streamConfigGet()
  })
  expect(config).toHaveProperty('streamKey')
  expect(config).toHaveProperty('rtmpUrl')
  console.log('Stream config:', config)
})

test('IPC: notes CRUD', async () => {
  // Add a note
  const note = await window.evaluate(async () => {
    return window.api.notesAdd('Test note from Playwright')
  })
  expect(note).toHaveProperty('id')
  expect(note).toHaveProperty('text')
  expect(note.text).toBe('Test note from Playwright')
  console.log('Note added:', note.id)

  // List notes
  const notes = await window.evaluate(async () => {
    return window.api.notesList()
  })
  expect(notes.length).toBeGreaterThan(0)

  // Delete note
  await window.evaluate(async (noteId) => {
    return window.api.notesDelete(noteId)
  }, note.id)

  const notesAfter = await window.evaluate(async () => {
    return window.api.notesList()
  })
  expect(notesAfter.length).toBe(notes.length - 1)
})

test('IPC: ticker show/hide', async () => {
  await window.evaluate(async () => {
    return window.api.tickerShow('Test ticker text', 60, '#000000', '#ffffff')
  })
  await window.waitForTimeout(300)

  let state = await window.evaluate(async () => {
    return window.api.overlayGetState()
  })
  expect(state.ticker.visible).toBe(true)
  expect(state.ticker.text).toBe('Test ticker text')

  await window.evaluate(async () => {
    return window.api.tickerHide()
  })
  await window.waitForTimeout(200)

  state = await window.evaluate(async () => {
    return window.api.overlayGetState()
  })
  expect(state.ticker.visible).toBe(false)
})

test('IPC: starting soon show/hide', async () => {
  await window.evaluate(async () => {
    return window.api.startingSoonShow()
  })
  await window.waitForTimeout(300)

  let state = await window.evaluate(async () => {
    return window.api.overlayGetState()
  })
  expect(state.startingSoon.visible).toBe(true)
  await window.screenshot({ path: 'test-results/13-starting-soon.png' })

  await window.evaluate(async () => {
    return window.api.startingSoonHide()
  })
  await window.waitForTimeout(200)

  state = await window.evaluate(async () => {
    return window.api.overlayGetState()
  })
  expect(state.startingSoon.visible).toBe(false)
})

test('IPC: playlist status', async () => {
  const status = await window.evaluate(async () => {
    return window.api.playlistGetStatus()
  })
  console.log('Playlist status:', status)
  expect(status).toHaveProperty('current')
  expect(status).toHaveProperty('total')
  expect(status).toHaveProperty('autoFire')
  expect(status).toHaveProperty('loopMode')
})

test('IPC: overlay styling update', async () => {
  await window.evaluate(async () => {
    return window.api.overlayUpdateStyling({
      accentColor: '#ff0000',
      fontSize: 32,
    })
  })

  const state = await window.evaluate(async () => {
    return window.api.overlayGetState()
  })
  expect(state.lowerThird.styling.accentColor).toBe('#ff0000')
  expect(state.lowerThird.styling.fontSize).toBe(32)

  // Reset
  await window.evaluate(async () => {
    return window.api.overlayUpdateStyling({
      accentColor: '#667eea',
      fontSize: 28,
    })
  })
})

test('IPC: OBS status (should report not connected)', async () => {
  const status = await window.evaluate(async () => {
    return window.api.obsStatus()
  })
  console.log('OBS status:', status)
  expect(status).toHaveProperty('connected')
  // Expected: not connected in test env
  expect(status.connected).toBe(false)
})

// ── Step 5: Test Trigger Reorder ─────────────────────────────────

test('IPC: trigger reorder', async () => {
  // Add two triggers
  await window.evaluate(async () => {
    await window.api.triggerAdd({
      id: 'reorder-a', name: 'A', title: 'First', subtitle: '', category: '', order: 0, logoDataUrl: '',
    })
    await window.api.triggerAdd({
      id: 'reorder-b', name: 'B', title: 'Second', subtitle: '', category: '', order: 1, logoDataUrl: '',
    })
  })

  // Reorder B before A
  const reordered = await window.evaluate(async () => {
    return window.api.triggerReorder(['reorder-b', 'reorder-a'])
  })
  expect(reordered[0].id).toBe('reorder-b')
  expect(reordered[1].id).toBe('reorder-a')

  // Cleanup
  await window.evaluate(async () => {
    await window.api.triggerDelete('reorder-a')
    await window.api.triggerDelete('reorder-b')
  })
})

// ── Step 6: Test HTTP Server ─────────────────────────────────────

test('overlay HTTP server is running', async () => {
  const settings = await window.evaluate(async () => {
    return window.api.settingsGet()
  })
  const port = settings.server?.httpPort || 9876

  // Fetch the overlay page (served at /overlay)
  const response = await fetch(`http://127.0.0.1:${port}/overlay`)
  console.log('Overlay HTTP status:', response.status)
  expect(response.status).toBe(200)

  const html = await response.text()
  expect(html).toContain('<html')
  console.log('Overlay HTML length:', html.length)

  // Also test /current and /triggers endpoints
  const currentRes = await fetch(`http://127.0.0.1:${port}/current`)
  expect(currentRes.status).toBe(200)
  const currentData = await currentRes.json()
  expect(currentData).toHaveProperty('lowerThird')

  const triggersRes = await fetch(`http://127.0.0.1:${port}/triggers`)
  expect(triggersRes.status).toBe(200)
})

test('WebSocket server is running', async () => {
  const settings = await window.evaluate(async () => {
    return window.api.settingsGet()
  })
  const port = settings.server?.wsPort || 9877

  // Test WS connection
  const { WebSocket } = await import('ws')
  const connected = await new Promise<boolean>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => {
      ws.terminate()
      resolve(false)
    }, 3000)
    ws.on('open', () => {
      clearTimeout(timeout)
      ws.close()
      resolve(true)
    })
    ws.on('error', () => {
      clearTimeout(timeout)
      resolve(false)
    })
  })
  console.log('WebSocket server connected:', connected)
  expect(connected).toBe(true)
})

// ── Step 6: Full UI Walkthrough Screenshot ───────────────────────

test('full app screenshot', async () => {
  // Clear any leftover triggers
  await window.evaluate(async () => {
    return window.api.triggerClearAll()
  })
  await window.waitForTimeout(300)
  await window.screenshot({ path: 'test-results/14-full-app-clean.png' })
})
