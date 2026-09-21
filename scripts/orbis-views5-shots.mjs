// WebUI page captures for the Views 5 review.
//   node scripts/orbis-views5-shots.mjs <dark|light> <outDir> <urlsFile> [width] [scale]
// One own browser (temp profile, browser.theme.color_scheme2 1=light 2=dark, so the page follows the browser pref, not the OS);
// a page that does not answer within 15s is logged as CRASH/HANG and the browser is restarted, the sweep goes on.
import { spawn, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
const [scheme, out, urlsFile, width = '1100', scale = '1'] = process.argv.slice(2)
const urls = readFileSync(urlsFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'))
mkdirSync(out, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const prof = join(process.env.TEMP, `orbis-v5-${scheme}`)
const port = scheme === 'light' ? 9351 : 9352
const EXE = 'C:/chromium/src/out/Default/chrome.exe'
let child, ws, id = 0
const pend = new Map()
async function start() {
  rmSync(prof, { recursive: true, force: true }); mkdirSync(join(prof, 'Default'), { recursive: true })
  writeFileSync(join(prof, 'Default', 'Preferences'), JSON.stringify({ browser: { theme: { color_scheme2: scheme === 'light' ? 1 : 2 } } }))
  writeFileSync(join(prof, 'Local State'), JSON.stringify({ internal_only_uis_enabled: true }))
  child = spawn(EXE, [`--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, '--window-position=40,40', '--window-size=1200,800', 'about:blank'], { stdio: 'ignore' })
  let v
  for (let i = 0; i < 30; i++) { await sleep(1000); try { v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break } catch {} }
  ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r))
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) pend.get(d.id)(d) }
}
const send = (method, params = {}, sessionId, to = 15000) => new Promise((res, rej) => { const i = ++id; const t = setTimeout(() => rej(new Error('timeout ' + method)), to); pend.set(i, (d) => { clearTimeout(t); res(d) }); ws.send(JSON.stringify({ id: i, method, params, sessionId })) })
function stop() { try { ws.close() } catch {} try { execSync(`taskkill /F /PID ${child.pid} /T`, { stdio: 'ignore' }) } catch {} }
await start()
const EXPR = process.env.EXPR || `JSON.stringify({dark:document.documentElement.getAttribute('dark'),bg:getComputedStyle(document.body).backgroundColor,font:getComputedStyle(document.body).fontFamily.slice(0,40),title:document.title})`
for (const u of urls) {
  const name = u.replace(/[^a-z0-9]+/gi, '_').slice(0, 60) + `_${scheme}.png`
  try {
    const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' })
    const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true })
    await send('Emulation.setDeviceMetricsOverride', { width: +width, height: 800, deviceScaleFactor: +scale, mobile: false }, sessionId)
    let nav = u
    if (u.startsWith('offline:')) { nav = u.slice(8); await send('Network.enable', {}, sessionId); await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sessionId) }
    await send('Page.navigate', { url: nav }, sessionId)
    await sleep(+(process.env.WAIT || 3500))
    const dk = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true, awaitPromise: true }, sessionId)
    const r = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
    writeFileSync(join(out, name), Buffer.from(r.result.data, 'base64'))
    appendFileSync(join(out, 'log.txt'), `${name} ${JSON.stringify(dk.result?.result?.value)}\n`)
    await send('Target.closeTarget', { targetId }, undefined, 5000).catch(() => {})
  } catch (e) {
    appendFileSync(join(out, 'log.txt'), `${name} CRASH/HANG ${e.message}\n`)
    stop(); await sleep(1500); await start()
  }
}
stop()
