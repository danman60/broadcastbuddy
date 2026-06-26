import { _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs'

/**
 * Shared Electron launch helper for the comprehensive (zz-) suite.
 *
 * Every spec file launches one app instance in beforeAll and closes it in
 * afterAll. Launching from the project root makes electron read package.json
 * `main` (./out/main/index.js) — so `npm run build` MUST run first. On Linux
 * this whole suite runs under `xvfb-run`.
 *
 * No hardware is assumed: OBS, the OBSBOT camera, the WPD/voice helper and the
 * Stream Deck are all absent in CI. Tests here exercise UI rendering and the
 * IPC handlers that degrade gracefully (return an error/empty, never throw) when
 * their backing device is missing.
 */

export interface Harness {
  app: ElectronApplication
  window: Page
}

/** Create a fresh isolated userData dir (reuse the path to test persistence). */
export function mkUserDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bb-zz-'))
}

export async function launchApp(userDataDir?: string): Promise<Harness> {
  // Isolated userData per run so the zz suite is deterministic and never
  // pollutes the operator's real sessions/settings (and can't collide with a
  // concurrent suite sharing the default electron-store). Pass an existing dir
  // to relaunch against persisted state (durability tests).
  const dir = userDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'bb-zz-'))
  const app = await electron.launch({
    args: [
      path.join(__dirname, '..'),
      '--disable-gpu',
      '--no-sandbox',
      `--user-data-dir=${dir}`,
    ],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  // Let the renderer hydrate + run loadInitialState() before assertions.
  await window.waitForTimeout(2000)
  return { app, window }
}

export async function closeApp(h: Harness | undefined): Promise<void> {
  if (h?.app) await h.app.close()
}

/**
 * Native DOM click via evaluate. Playwright's force-click reliably fires on
 * <button> but NOT on the redesign's `<div onClick>` section headers under this
 * renderer (React event-delegation quirk), and its auto-wait click stalls 30s
 * under fleet CPU load. A native element.click() dispatches a trusted click that
 * React's onClick always handles, with zero actionability wait. Returns whether
 * an element matched.
 */
export async function nativeClick(window: Page, selector: string, text?: string): Promise<boolean> {
  return window.evaluate(
    ({ selector, text }) => {
      const els = Array.from(document.querySelectorAll(selector)) as HTMLElement[]
      const el = text ? els.find((e) => (e.textContent || '').includes(text)) : els[0]
      if (!el) return false
      el.click()
      return true
    },
    { selector, text },
  )
}

/** Invoke a window.api method inside the renderer and return its result. */
export async function api<T = unknown>(window: Page, method: string, ...args: unknown[]): Promise<T> {
  return window.evaluate(
    ({ method, args }) => {
      const fn = (window as unknown as { api: Record<string, (...a: unknown[]) => unknown> }).api[method]
      if (typeof fn !== 'function') throw new Error(`window.api.${method} is not a function`)
      return Promise.resolve(fn(...args))
    },
    { method, args },
  ) as Promise<T>
}
