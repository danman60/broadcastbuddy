import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'

// ── Playlist mechanics (IPC-level) ───────────────────────────────────────────
// Drives the playlist purely through window.api.* IPC bridge. The overlay
// service holds playlist state at module scope in the main process, so we reset
// it explicitly in each test (triggerClearAll + re-add + select) for isolation.
//
// Verified against src/main/services/overlay.ts:
//   - selectedIndex defaults to -1; getPlaylistStatus().current === selectedIndex + 1
//   - loopMode default 'none' clamps at ends; 'loop' wraps; 'ping-pong' reverses
//   - getPlaylistStatus() shape: { current, total, autoFire, upNext, playedIds, loopMode }
//     where upNext is the raw triggers[selectedIndex + 1] (a Trigger) or null
//   - fireUpNext/fireThatWas return { fired } and do NOT move selectedIndex

let app: ElectronApplication
let window: Page

interface Trigger {
  id: string
  name: string
  title: string
  subtitle: string
  category: string
  order: number
  logoDataUrl: string
}

function mkTrigger(id: string, order: number): Trigger {
  return {
    id,
    name: `Name ${id}`,
    title: `Title ${id}`,
    subtitle: `Sub ${id}`,
    category: '',
    order,
    logoDataUrl: '',
  }
}

// Reset to a clean 3-trigger playlist, loopMode 'none', position at index 0.
async function seedThree(): Promise<void> {
  await window.evaluate(async (triggers) => {
    await window.api.triggerClearAll()
    for (const t of triggers) {
      await window.api.triggerAdd(t as never)
    }
    await window.api.playlistSetLoopMode('none')
    await window.api.triggerSelect(0)
  }, [mkTrigger('p1', 0), mkTrigger('p2', 1), mkTrigger('p3', 2)])
}

function getStatus() {
  return window.evaluate(async () => window.api.playlistGetStatus())
}

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
  await window.waitForTimeout(1500)
  // Clean slate for the whole suite.
  await window.evaluate(async () => window.api.triggerClearAll())
})

test.afterAll(async () => {
  if (app) {
    // Leave the app in a clean state for any subsequent suite.
    await window.evaluate(async () => {
      await window.api.triggerClearAll()
      await window.api.playlistSetLoopMode('none')
    }).catch(() => {})
    await app.close()
  }
})

// ── 1. status shape + clean-slate values ─────────────────────────────────────

test('playlistGetStatus returns the expected shape', async () => {
  await window.evaluate(async () => window.api.triggerClearAll())
  const status = await getStatus()

  expect(status).toHaveProperty('current')
  expect(status).toHaveProperty('total')
  expect(status).toHaveProperty('autoFire')
  expect(status).toHaveProperty('upNext')
  expect(status).toHaveProperty('playedIds')
  expect(status).toHaveProperty('loopMode')

  expect(typeof status.current).toBe('number')
  expect(typeof status.total).toBe('number')
  expect(typeof status.autoFire).toBe('boolean')
  expect(Array.isArray(status.playedIds)).toBe(true)

  // Empty playlist: selectedIndex == -1 → current == 0, total == 0.
  expect(status.total).toBe(0)
  expect(status.current).toBe(0)
  expect(status.upNext).toBeNull()
})

// ── 2. add 3 triggers → total + current track selection ──────────────────────

test('adding 3 triggers and selecting index 0 reports current=1 total=3', async () => {
  await seedThree()
  const status = await getStatus()
  expect(status.total).toBe(3)
  expect(status.current).toBe(1) // selectedIndex 0 → current 1 (1-based)
  // upNext is the raw next trigger object.
  expect(status.upNext).not.toBeNull()
  expect(status.upNext?.id).toBe('p2')
})

// ── 3. triggerNext / triggerPrev advance the position (loopMode none) ─────────

test('triggerNext and triggerPrev move selectedIndex and clamp at the ends', async () => {
  await seedThree() // index 0, mode none

  await window.evaluate(async () => window.api.triggerNext())
  expect((await getStatus()).current).toBe(2) // → index 1

  await window.evaluate(async () => window.api.triggerNext())
  expect((await getStatus()).current).toBe(3) // → index 2 (last)

  // 'none' mode clamps at the last index.
  await window.evaluate(async () => window.api.triggerNext())
  expect((await getStatus()).current).toBe(3)

  // Walk back.
  await window.evaluate(async () => window.api.triggerPrev())
  expect((await getStatus()).current).toBe(2) // → index 1

  await window.evaluate(async () => window.api.triggerPrev())
  expect((await getStatus()).current).toBe(1) // → index 0

  // 'none' mode clamps at index 0.
  await window.evaluate(async () => window.api.triggerPrev())
  expect((await getStatus()).current).toBe(1)
})

// ── 4. loop mode wraps at both ends ───────────────────────────────────────────

test('loop mode wraps forward (last→first) and backward (first→last)', async () => {
  await seedThree()
  await window.evaluate(async () => window.api.playlistSetLoopMode('loop'))
  expect((await getStatus()).loopMode).toBe('loop')

  // Move to the last index (2 / current 3).
  await window.evaluate(async () => {
    await window.api.triggerNext()
    await window.api.triggerNext()
  })
  expect((await getStatus()).current).toBe(3)

  // Forward from last wraps to first.
  await window.evaluate(async () => window.api.triggerNext())
  expect((await getStatus()).current).toBe(1)

  // Backward from first wraps to last.
  await window.evaluate(async () => window.api.triggerPrev())
  expect((await getStatus()).current).toBe(3)

  await window.evaluate(async () => window.api.playlistSetLoopMode('none'))
})

// ── 5. ping-pong reverses direction at the ends ───────────────────────────────

test('ping-pong mode reverses direction at the last index', async () => {
  await seedThree()
  await window.evaluate(async () => window.api.playlistSetLoopMode('ping-pong'))
  expect((await getStatus()).loopMode).toBe('ping-pong')

  // index 0 → 1 → 2 (last)
  await window.evaluate(async () => window.api.triggerNext())
  expect((await getStatus()).current).toBe(2)
  await window.evaluate(async () => window.api.triggerNext())
  expect((await getStatus()).current).toBe(3)

  // At the last index, the next forward step reverses and steps back down.
  await window.evaluate(async () => window.api.triggerNext())
  expect((await getStatus()).current).toBe(2)

  await window.evaluate(async () => window.api.triggerNext())
  expect((await getStatus()).current).toBe(1)

  await window.evaluate(async () => window.api.playlistSetLoopMode('none'))
})

// ── 6. autoFire toggle flips the boolean ──────────────────────────────────────

test('playlistAutoFireToggle flips autoFire and is reflected in status', async () => {
  const before = (await getStatus()).autoFire

  const returned = await window.evaluate(async () => window.api.playlistAutoFireToggle())
  expect(typeof returned).toBe('boolean')
  expect(returned).toBe(!before)
  expect((await getStatus()).autoFire).toBe(!before)

  // Toggle back to the original value so other tests aren't affected.
  const back = await window.evaluate(async () => window.api.playlistAutoFireToggle())
  expect(back).toBe(before)
  expect((await getStatus()).autoFire).toBe(before)
})

// ── 7. up-next / that-was fire neighbours without moving position ─────────────

test('fireUpNext and fireThatWas fire neighbours without changing selectedIndex', async () => {
  await seedThree() // index 0, mode none

  // From index 0 in 'none' mode there IS a forward neighbour (index 1).
  const up = await window.evaluate(async () => window.api.overlayFireUpNext())
  expect(up).toHaveProperty('fired')
  expect(up.fired).toBe(true)

  // Firing a neighbour must NOT advance the playlist position.
  expect((await getStatus()).current).toBe(1)

  // The lower third shows the neighbour's data with the UP NEXT label chip.
  const state = await window.evaluate(async () => window.api.overlayGetState())
  expect(state.lowerThird.visible).toBe(true)
  expect(state.lowerThird.label).toBe('UP NEXT')
  expect(state.lowerThird.title).toBe('Title p2')

  // From index 0 in 'none' mode there is NO backward neighbour → fired:false.
  const was = await window.evaluate(async () => window.api.overlayFireThatWas())
  expect(was.fired).toBe(false)
  expect((await getStatus()).current).toBe(1)

  // Cleanup the visible overlay.
  await window.evaluate(async () => window.api.overlayHideLT())
})

// ── 8. resetPosition + clearPlayed ───────────────────────────────────────────

test('playlistResetPosition returns to index 0 and clearPlayed empties playedIds', async () => {
  await seedThree()

  // Advance + fire so something lands in the played set.
  await window.evaluate(async () => {
    await window.api.triggerNext() // index 1
    await window.api.overlayFireLT() // marks current trigger as played
  })
  let status = await getStatus()
  expect(status.current).toBe(2)
  expect(status.playedIds.length).toBeGreaterThan(0)

  // Reset position → back to index 0 (current 1).
  await window.evaluate(async () => window.api.playlistResetPosition())
  status = await getStatus()
  expect(status.current).toBe(1)

  // Clear played → empty playedIds.
  await window.evaluate(async () => window.api.playlistClearPlayed())
  status = await getStatus()
  expect(status.playedIds.length).toBe(0)

  await window.evaluate(async () => window.api.overlayHideLT())
})

// ── 9. cleanup ────────────────────────────────────────────────────────────────

test('triggerClearAll empties the playlist', async () => {
  await window.evaluate(async () => window.api.triggerClearAll())
  const status = await getStatus()
  expect(status.total).toBe(0)
  expect(status.current).toBe(0)
  expect(status.upNext).toBeNull()
})
