// Shared harness for the Views 6 verification: one own browser (temp profile), CDP by port, OS-level input by pid through BrowserUi
// (every key/click is guarded by the foreground check of that pid), PrintWindow captures of our own windows only.
import { spawn, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserUi } from '../src/main/chromium/browserUi.ts'
export const EXE = 'C:/chromium/src/out/Default/chrome.exe'
import { fileURLToPath } from 'node:url'
export const ROOT = fileURLToPath(new URL('..', import.meta.url)).split(String.fromCharCode(92)).join('/')
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let nextPort = 9400 + Math.floor(Math.random() * 400)
export async function launch({ name = 'v6', args = [], prefs, url = 'about:blank', pos = '40,40', size = '1200,800' } = {}) {
  const prof = join(process.env.TEMP, `orbis-${name}-${Date.now()}`)
  mkdirSync(join(prof, 'Default'), { recursive: true })
  writeFileSync(join(prof, 'Default', 'Preferences'), JSON.stringify(prefs ?? {}))
  writeFileSync(join(prof, 'Local State'), JSON.stringify({ internal_only_uis_enabled: true }))
  const port = nextPort++
  const t0 = Date.now()
  const child = spawn(EXE, [`--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, `--window-position=${pos}`, `--window-size=${size}`, ...args, url], { stdio: 'ignore' })
  let v
  for (let i = 0; i < 120; i++) { await sleep(250); try { v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break } catch {} }
  if (!v) { kill(child); throw new Error('no cdp') }
  const b = { child, pid: child.pid, port, prof, t0, ui: new BrowserUi(child.pid), id: 0, pend: new Map(), events: [] }
  b.ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => (b.ws.onopen = r))
  b.ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && b.pend.has(d.id)) b.pend.get(d.id)(d); else if (d.method) { d.t = Date.now(); b.events.push(d) } }
  b.send = (method, params = {}, sessionId, to = 15000) => new Promise((res, rej) => { const i = ++b.id; const t = setTimeout(() => rej(new Error('timeout ' + method)), to); b.pend.set(i, (d) => { clearTimeout(t); res(d) }); b.ws.send(JSON.stringify({ id: i, method, params, sessionId })) })
  b.list = async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
  b.pages = async () => (await b.list()).filter((t) => t.type === 'page')
  b.attach = async (targetId) => (await b.send('Target.attachToTarget', { targetId, flatten: true })).result.sessionId
  b.eval = async (sessionId, expression) => { const r = await b.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId); return r.result?.result?.value ?? r.result?.exceptionDetails?.text }
  b.win = async (title) => { for (let i = 0; i < 40; i++) { try { return await b.ui.pickWindow(title) } catch { await sleep(250) } } throw new Error('no window') }
  b.kill = () => { try { b.ws.close() } catch {}; kill(child); b.ui.close(); try { rmSync(prof, { recursive: true, force: true }) } catch {} }
  return b
}
export function kill(child) { try { execSync(`taskkill /F /PID ${child.pid} /T`, { stdio: 'ignore' }) } catch {} }
export function capture(pid, out) { return execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ROOT}scripts/orbis-capture.ps1" -ProcId ${pid} -Out "${out}"`, { encoding: 'utf8' }) }
