/// <reference types="electron-vite/node" />
import { readFileSync } from 'node:fs'
import dockHtmlPath from '../assets/dock.html?asset'

export { default as dockScriptPath } from '../assets/dock.js?asset'

// OBS dock markup is a packaged asset; the configured hub port stays dynamic.
const dockHTML = readFileSync(dockHtmlPath, 'utf8')

export function buildDockHTML(wsPort: number): string {
  return dockHTML.replace('__BB_WS_PORT__', String(wsPort))
}
