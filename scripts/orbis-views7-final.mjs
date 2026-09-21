// Views 7 final pages: offline, extension details/shortcuts, crashed tab, PDF viewer controls, print preview (PrintWindow).
//   node scripts/orbis-views7-final.mjs <dark|light> <outDir>
// Own temp profile only; every input goes through CDP to own pages; window captures use scripts/orbis-capture.ps1 (PrintWindow).
import { spawn, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, appendFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
const [scheme, out] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const prof = join(process.env.TEMP, `orbis-v7-${scheme}`)
const port = scheme === 'light' ? 9361 : 9362
const EXE = 'C:/chromium/src/out/Default/chrome.exe'
const EXT = join(process.env.TEMP, 'ext7')
// minimal 3-page PDF with text and an outline-less structure
function pdf() {
  const objs = []; const add = (s) => (objs.push(s), objs.length)
  add('<< /Type /Catalog /Pages 2 0 R >>'); add('<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>')
  const page = (n, c) => { add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${objs.length + 2} 0 R /Resources << /Font << /F1 ${9} 0 R >> >> >>`); const s = `BT /F1 28 Tf 72 700 Td (Orbis test page ${n} - ${c}) Tj ET`; add(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`) }
  page(1, 'search word alpha'); page(2, 'beta'); page(3, 'alpha gamma'); add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  let b = '%PDF-1.4\n'; const off = []
  objs.forEach((o, i) => { off.push(b.length); b += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const x = b.length; b += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`
  return Buffer.from(b, 'latin1')
}
const srv = createServer((q, r) => { if (q.url.endsWith('.pdf')) { r.setHeader('content-type', 'application/pdf'); r.end(pdf()) } else { r.setHeader('content-type', 'text/html'); r.end('<h1>Orbis test</h1><p>print me</p>') } }).listen(0)
const sport = srv.address().port
rmSync(prof, { recursive: true, force: true }); mkdirSync(join(prof, 'Default'), { recursive: true })
writeFileSync(join(prof, 'Default', 'Preferences'), JSON.stringify({ browser: { theme: { color_scheme2: scheme === 'light' ? 1 : 2 } } }))
writeFileSync(join(prof, 'Local State'), JSON.stringify({ internal_only_uis_enabled: true }))
const child = spawn(EXE, [`--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, `--load-extension=${EXT}`, '--window-position=40,40', '--window-size=1200,800', 'about:blank'], { stdio: 'ignore' })
let v; for (let i = 0; i < 30; i++) { await sleep(1000); try { v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break } catch {} }
const ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r))
let id = 0; const pend = new Map(); ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) pend.get(d.id)(d) }
const send = (method, params = {}, sessionId, to = 15000) => new Promise((res, rej) => { const i = ++id; const t = setTimeout(() => rej(new Error('timeout ' + method)), to); pend.set(i, (d) => { clearTimeout(t); res(d) }); ws.send(JSON.stringify({ id: i, method, params, sessionId })) })
const log = (s) => appendFileSync(join(out, 'log.txt'), s + '\n')
async function page(url, w = 1100, h = 800) {
  const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' })
  const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }, sessionId)
  await send('Page.navigate', { url }, sessionId); await sleep(3500)
  return { targetId, sessionId }
}
const shot = async (s, name) => { const r = await send('Page.captureScreenshot', { format: 'png' }, s.sessionId); writeFileSync(join(out, `${name}_${scheme}.png`), Buffer.from(r.result.data, 'base64')) }
const ev = async (s, expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true }, s.sessionId)).result?.result?.value
const run = async (name, fn) => { try { await fn() } catch (e) { log(`${name} FAIL ${e.message}`) } }
await run('ext', async () => {
  const m = await page('chrome://extensions/')
  const eid = await ev(m, `new Promise(r=>chrome.management.getAll(a=>r(a.find(x=>x.name==='Orbis Test Extension')?.id)))`)
  log('extension id ' + eid)
  await shot(m, 'extensions_list')
  const d = await page(`chrome://extensions/?id=${eid}`); await shot(d, 'extension_details')
  const k = await page('chrome://extensions/shortcuts'); await shot(k, 'extension_shortcuts')
})
await run('kill', async () => {
  const k = await page('about:blank')
  await send('Page.navigate', { url: 'chrome://kill' }, k.sessionId, 5000).catch(() => {}); await sleep(4000)
  const r = await send('Page.captureScreenshot', { format: 'png' }, k.sessionId, 8000).catch(() => null)
  log('kill capture via cdp ' + (r ? 'ok' : 'none (tab crashed)'))
  if (r) writeFileSync(join(out, `crashed_tab_${scheme}.png`), Buffer.from(r.result.data, 'base64'))
})
await run('pdf', async () => {
  const p = await page(`http://127.0.0.1:${sport}/a.pdf`, 1100, 800); await sleep(2000)
  await shot(p, 'pdf_default')
  // the viewer lives in an OOPIF/extension frame; screenshot of the tab includes it
  const cl = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true }, p.sessionId); log('pdf title ' + cl.result?.result?.value)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '+', code: 'Equal', modifiers: 2, windowsVirtualKeyCode: 187 }, p.sessionId); await sleep(500); await shot(p, 'pdf_zoom_in')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'r', code: 'KeyR', modifiers: 10, windowsVirtualKeyCode: 82 }, p.sessionId); await sleep(500); await shot(p, 'pdf_rotate_attempt')
})
// window-level captures (own pid only)
await run('print', async () => {
  const p = await page(`http://127.0.0.1:${sport}/p.html`)
  await send('Runtime.evaluate', { expression: 'setTimeout(()=>window.print(),100)', userGesture: true }, p.sessionId); await sleep(5000)
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\orbis-capture.ps1 -ProcId ${child.pid} -Out "${join(out, `window_print_${scheme}.png`)}" -Each`, { stdio: 'ignore' })
})
try { ws.close() } catch {} try { execSync(`taskkill /F /PID ${child.pid} /T`, { stdio: 'ignore' }) } catch {} srv.close()
