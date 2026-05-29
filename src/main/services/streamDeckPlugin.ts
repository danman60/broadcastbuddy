// Stream Deck plugin in-app installer (ported from CompSyncElectronApp).
//
// BB ships a `.sdPlugin` folder; this one-click copies it into the Elgato
// Stream Deck plugins directory so the operator doesn't install by hand.
// Windows-only (Elgato Stream Deck is Windows/macOS; CompSync only implemented
// the Windows path — we keep that and report `supported:false` elsewhere).

import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { StreamDeckStatus } from '../../shared/types'
import { createLogger } from '../logger'

const logger = createLogger('streamDeckPlugin')

const PLUGIN_UUID = 'com.broadcastbuddy.streamdeck.sdPlugin'

function getBundledPluginDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'streamdeck-plugin')
    : path.join(__dirname, '..', '..', '..', 'streamdeck-plugin', PLUGIN_UUID)
}

function getStreamDeckPluginsDir(): string | null {
  if (process.platform !== 'win32') return null
  const appData = process.env.APPDATA
  if (!appData) return null
  return path.join(appData, 'Elgato', 'StreamDeck', 'Plugins')
}

function copyDirRecursive(src: string, dest: string): number {
  let count = 0
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      count += copyDirRecursive(s, d)
    } else {
      fs.copyFileSync(s, d)
      count++
    }
  }
  return count
}

export function getStatus(): StreamDeckStatus {
  const supported = process.platform === 'win32'
  const pluginsDir = getStreamDeckPluginsDir()
  const bundled = getBundledPluginDir()
  const bundledAvailable = fs.existsSync(path.join(bundled, 'manifest.json'))
  const streamDeckInstalled = !!pluginsDir && fs.existsSync(pluginsDir)
  const target = pluginsDir ? path.join(pluginsDir, PLUGIN_UUID) : ''
  const pluginInstalled = !!target && fs.existsSync(path.join(target, 'manifest.json'))
  return {
    supported,
    streamDeckInstalled,
    pluginsDir,
    bundledAvailable,
    pluginInstalled,
  }
}

export async function installPlugin(): Promise<{ ok: boolean; filesCopied?: number; target?: string; error?: string }> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Stream Deck plugin install is Windows-only' }
  }
  const pluginsDir = getStreamDeckPluginsDir()
  if (!pluginsDir || !fs.existsSync(pluginsDir)) {
    return { ok: false, error: 'Stream Deck not installed (plugins folder not found)' }
  }
  const bundled = getBundledPluginDir()
  if (!fs.existsSync(path.join(bundled, 'manifest.json'))) {
    return { ok: false, error: 'Bundled plugin not found' }
  }
  const target = path.join(pluginsDir, PLUGIN_UUID)
  try {
    const filesCopied = copyDirRecursive(bundled, target)
    logger.info(`Stream Deck plugin installed: ${filesCopied} files → ${target}`)
    return { ok: true, filesCopied, target }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(`Stream Deck plugin install failed: ${message}`)
    return { ok: false, error: message }
  }
}
