// brandScraper end-to-end against a LOCAL fixture HTTP server (no external
// network). Exercises the real colour/font/logo extraction AND validates the
// ReDoS-hardening (bounded regexes + 3MB cap) on a pathological page — if the
// regex backtracked catastrophically the main process would hang and the test
// would time out.

import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'
import http from 'http'
import type { AddressInfo } from 'net'

let app: ElectronApplication
let win: Page
let server: http.Server
let baseUrl = ''

const FIXTURE_HTML = `<!DOCTYPE html><html><head>
<meta property="og:image" content="https://cdn.example.com/logo.png">
<style>
  body { font-family: 'Poppins', sans-serif; color: #3366cc; }
  .accent { background: #ff6600; border-color: rgb(18, 52, 86); }
</style>
<title>Acme Studio — Home</title>
</head><body><h1>Acme</h1></body></html>`

// A page designed to stress the logo regexes: a very long <link ...> with no
// closing '>' and no rel="icon" (the old unbounded [^>]+ would backtrack here).
const EVIL_HTML = `<html><head><style>body{color:#9933ff}</style></head><body>` +
  '<link ' + 'x'.repeat(300000) + '</body></html>'

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html')
    res.end(req.url === '/evil' ? EVIL_HTML : FIXTURE_HTML)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  baseUrl = `http://127.0.0.1:${port}`

  app = await electron.launch({
    args: [path.join(__dirname, '..'), '--disable-gpu', '--no-sandbox'],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
})

test.afterAll(async () => {
  await app?.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

test('brandScrape extracts colours, fonts, and logo from a real page', async () => {
  const kit = await win.evaluate((url) => window.api.brandScrape(url), baseUrl)
  expect(Array.isArray(kit.colors)).toBe(true)
  expect(kit.colors).toContain('#3366cc')
  expect(kit.colors).toContain('#ff6600')
  expect(kit.fonts).toContain('Poppins')
  expect(kit.logoUrl).toBe('https://cdn.example.com/logo.png')
  expect(kit.siteName).toBeTruthy()
})

test('brandScrape on a pathological page returns quickly (ReDoS-safe)', async () => {
  // If the bounded regexes regressed to catastrophic backtracking, this would
  // hang and exceed the test timeout. It must return a (possibly logo-less) kit.
  const start = Date.now()
  const kit = await win.evaluate((url) => window.api.brandScrape(`${url}/evil`), baseUrl)
  const elapsed = Date.now() - start
  expect(kit).toBeTruthy()
  expect(kit.colors).toContain('#9933ff')
  expect(elapsed).toBeLessThan(10000) // generous — the fix makes it ~instant
})
