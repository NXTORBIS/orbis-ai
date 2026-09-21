// Screenshots of the Orbis Views UI in its own spawned window (dark/light, any scale). Dev tool for docs/orbis-ui-audit-results.md.
//   node --experimental-strip-types scripts/orbis-views-shots.mjs <name> [--scale 1.5] [--light] [--out dir] [--popup <query>] [--hover <n>]
// Only ever touches the window of the browser process this script started: input is sent after the foreground window is verified
// to belong to that pid (BrowserUi.focus does that), and screen capture is refused if it does not.
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserUi } from '../src/main/chromium/browserUi.ts'

const args = process.argv.slice(2)
const name = args[0]
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const scale = opt('--scale', '1')
const light = args.includes('--light')
const outDir = opt('--out', join(process.env.TEMP, 'orbis-shots'))
const popup = opt('--popup', '')
const hoverIdx = opt('--hover', '')
const noTabs = args.includes('--plain')
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const repo = fileURLToPath(new URL('..', import.meta.url))

// A page that never finishes loading (for the real loading indicator).
const slow = createServer(() => {}).listen(9444, '127.0.0.1')
const audioPage = 'data:text/html,<title>Audio tab</title><script>const c=new AudioContext();const o=c.createOscillator();o.connect(c.destination);o.start();c.resume()</script>'

const prof = join(process.env.TEMP, `orbis-views-prof-${name}`)
for (let attempt = 0; attempt < 4; attempt++) {
  rmSync(prof, { recursive: true, force: true })
  mkdirSync(join(prof, 'Default'), { recursive: true })
  writeFileSync(join(prof, 'Default', 'Preferences'), JSON.stringify({ browser: { theme: { color_scheme2: light ? 1 : 2 } } }))
  var child = spawn('C:\\chromium\\src\\out\\Default\\chrome.exe', [
    `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', `--force-device-scale-factor=${scale}`,
    '--window-position=40,40', "--window-size=${opt('--size', '1300,720')}", '--remote-debugging-port=9333', '--autoplay-policy=no-user-gesture-required',
    `--orbis-extension-dir=${repo}extension`, ...(opt('--extra', '') ? opt('--extra', '').split(' ') : []), 'about:blank'], { stdio: 'ignore' })
  await sleep(6000)
  if (child.exitCode === null) break
}
if (child.exitCode !== null) throw new Error('browser crashed at start')
const pid = child.pid

async function cdp() {
  const v = await (await fetch('http://127.0.0.1:9333/json/version')).json()
  const ws = new WebSocket(v.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0; const pending = new Map()
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) pending.get(d.id)(d) }
  const send = (method, params = {}, sessionId) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })) })
  return { send, close: () => ws.close() }
}

let ui
try {
  const c = await cdp()
  let worker
  for (let i = 0; i < 40 && !worker; i++) {
    const { result } = await c.send('Target.getTargets')
    worker = result.targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://gcaebckmlhiagfagcplpjmibhkhjljab/'))
    if (!worker) await sleep(500)
  }
  if (!worker) throw new Error('extension worker not found: ' + JSON.stringify((await c.send('Target.getTargets')).result.targetInfos.map((t) => t.type + ' ' + t.url)))
  const { result: { sessionId } } = await c.send('Target.attachToTarget', { targetId: worker.targetId, flatten: true })
  await c.send('Runtime.enable', {}, sessionId)
  const ev = async (expression) => {
    const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300))
    return r.result?.result?.value
  }
  for (let i = 0; i < 40; i++) { if (await ev('typeof chrome !== "undefined" && !!chrome.tabGroups && !!chrome.tabs')) break; await sleep(500) }
  if (!noTabs) {
    await ev(`(async () => {
      const mk = (url, active = false) => chrome.tabs.create({ url, active })
      const pinned = await mk('https://example.com/')
      await chrome.tabs.update(pinned.id, { pinned: true })
      const a = await mk('https://example.org/')
      const b = await mk('https://www.iana.org/')
      const g = await chrome.tabs.group({ tabIds: [a.id, b.id] })
      await chrome.tabGroups.update(g, { title: 'Research', color: 'blue' })
      await mk('${audioPage}')
      const m = await mk('https://example.net/')
      await chrome.tabs.update(m.id, { muted: true })
      await mk('http://127.0.0.1:9444/slow')
      const cur = await mk('https://example.com/', true)
      return true })()`)
    await sleep(5000)
  }
  ui = new BrowserUi(pid)
  const win = await ui.pickWindow()
  await ui.focus(win)
  const shot = (file, moveX, moveY) => execFileSync('powershell.exe', ['-NoProfile', '-File', join(repo, 'scripts', 'orbis-capture.ps1'),
    '-ProcId', String(pid), '-Out', join(outDir, file), ...(moveX !== undefined ? ['-MoveX', String(moveX), '-MoveY', String(moveY)] : [])], { stdio: 'inherit' })
  const keys = opt('--keys', '')
  if (keys) {
    for (const k of keys.split(',')) { if (k.startsWith('wait')) await sleep(Number(k.slice(4))); else await ui.press(win, k) }
    await sleep(700)
    shot(`${name}.png`)
  } else if (popup) {
    await ui.press(win, 'ctrl+l')
    await ui.type(win, popup)
    await sleep(1800)
    console.log('suggestions:', JSON.stringify(await ui.suggestions(win)))
    await ui.focus(win)
    shot(`${name}.png`)
    await ui.press(win, 'down'); await ui.press(win, 'down')
    await sleep(400)
    shot(`${name}-selected.png`)
  } else {
    shot(`${name}.png`)
    if (hoverIdx !== '') { await ui.focus(win); shot(`${name}-hover.png`, Number(hoverIdx.split(',')[0]), Number(hoverIdx.split(',')[1])) }
  }
  c.close()
} finally {
  ui?.close()
  slow.close()
  try { process.kill(pid) } catch { /* gone */ }
}
console.log('done', name)
process.exit(0)
