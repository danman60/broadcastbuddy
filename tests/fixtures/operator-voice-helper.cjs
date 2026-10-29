#!/usr/bin/env node
// Local stdio device fake used ONLY by the staged Electron test app.
const fs = require('fs')
const readline = require('readline')
const controlPath = process.env.BB_TEST_VOICE_CONTROL
const logPath = process.env.BB_TEST_VOICE_LOG
const send = (v) => process.stdout.write(JSON.stringify(v) + '\n')
const control = () => JSON.parse(fs.readFileSync(controlPath, 'utf8'))
let timer
send({ t: 'ready' })
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line)
  fs.appendFileSync(logPath, line + '\n')
  if (m.t === 'meter') {
    clearInterval(timer)
    if (m.on) timer = setInterval(() => {
      const c = control()
      if (c.mode === 'levels') send({ t: 'level', peak: c.peak })
      if (c.mode === 'invalid') { send(null); send({ t: 'level', peak: 200 }); send({ t: 'level', peak: '75' }) }
    }, 200)
  }
  if (m.t === 'listen' && !m.on) send({ t: 'result', verb: 'recall', target: '4', confidence: 0.99 })
  if (m.t === 'ping') send({ t: 'pong' })
}).on('close', () => process.exit(0))
