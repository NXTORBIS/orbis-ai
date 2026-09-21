// WebUI page captures: node scripts/orbis-views3-shots.mjs <dark|light> <outDir> [scale] [width] [urls...]
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
const [scheme, out, scale = '1', width = '1100', ...urls] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const prof = join(process.env.TEMP, `orbis-v3-${scheme}`)
rmSync(prof, { recursive: true, force: true }); mkdirSync(join(prof, 'Default'), { recursive: true })
writeFileSync(join(prof, 'Default', 'Preferences'), JSON.stringify({ browser: { theme: { color_scheme2: scheme === 'light' ? 1 : 2 } } }))
const port = 9341
const child = spawn('C:/chromium/src/out/Default/chrome.exe', [`--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, '--window-position=40,40', '--window-size=1200,800', ...(process.env.EXTRA?process.env.EXTRA.split(' '):[]), 'about:blank'], { stdio: 'ignore' })
await sleep(6000)
const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
const ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r))
let id = 0; const pend = new Map()
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) pend.get(d.id)(d) }
const send = (method, params = {}, sessionId) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })) })
try {
  for (const u of urls) {
    const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' })
    const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true })
    await send('Emulation.setDeviceMetricsOverride', { width: +width, height: 800, deviceScaleFactor: +scale, mobile: false }, sessionId)
    await send('Page.navigate', { url: u }, sessionId)
    await sleep(3500)
    const dk = await send('Runtime.evaluate', { expression: process.env.EXPR || `document.documentElement.getAttribute('dark')`, returnByValue: true, awaitPromise: true }, sessionId)
    const r = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
    const name = u.replace(/[^a-z0-9]+/gi, '_').slice(0, 50) + `_${scheme}_${scale}x_${width}.png`
    writeFileSync(join(out, name), Buffer.from(r.result.data, 'base64'))
    appendFileSync(join(out, 'log.txt'), `${name} ${JSON.stringify(dk.result?.result?.value)}\n`)
    await send('Target.closeTarget', { targetId })
  }
} finally { ws.close(); child.kill() }
