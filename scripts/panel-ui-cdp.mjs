// A headless system Chrome with a temp profile, driven over CDP: the small shared part of scripts/panel-ui-shots.mjs and panel-ui-flow.mjs.
// Never the Orbis Chromium build (which may be in use). Only the pid started here is killed.
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

export async function withChrome(fn, chromeAt = CHROME) {
  const profile = join(process.env.TEMP, `orbis-cdp-${Date.now()}`)
  mkdirSync(profile, { recursive: true })
  const port = 9600 + Math.floor(Math.random() * 300)
  const child = spawn(chromeAt, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--headless=new', '--no-first-run', '--no-default-browser-check', '--window-size=1000,900', 'about:blank'], { stdio: 'ignore' })
  let ws
  try {
    let version
    for (let i = 0; i < 60 && !version; i++) {
      version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => null)
      if (!version) await sleep(250)
    }
    const target = (await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json())).find((t) => t.type === 'page')
    ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((r) => (ws.onopen = r))
    let id = 0
    const waiting = new Map()
    const errors = []
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data)
      if (msg.id && waiting.has(msg.id)) (waiting.get(msg.id)(msg), waiting.delete(msg.id))
      else if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text)
      else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
    }
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const n = ++id
      waiting.set(n, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)))
      ws.send(JSON.stringify({ id: n, method, params }))
    })
    const run = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
      return r.result.value
    }
    await send('Page.enable')
    await send('Runtime.enable')
    return await fn({ send, run, errors })
  } finally {
    try { ws?.close() } catch {}
    spawn('taskkill', ['/F', '/PID', String(child.pid), '/T'], { stdio: 'ignore' })
    await sleep(500)
    try { rmSync(profile, { recursive: true, force: true }) } catch {}
  }
}
