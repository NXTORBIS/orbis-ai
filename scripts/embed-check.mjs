// Real-run check of the embedded browser: spawns the built Orbis app (temp profile), opens the browser through the renderer and
// asserts with Win32 that Chromium's window is a child of the Orbis window exactly over the browser view. Usage:
//   node scripts/embed-check.mjs [--scale=1.5] [--exe=<Orbis.exe>] [--shot=<png dir>]
import { spawn, execFileSync } from 'node:child_process'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const koffi = require('koffi')
const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split('=').slice(1).join('=')
const scale = arg('scale', '1'), exe = arg('exe', ''), shotDir = arg('shot', 'C:/chromium/orbis-embed-shots')
const PORT = 9500 + Math.floor(Math.random() * 100)
const data = `C:/chromium/orbis-embed-test-${PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
rmSync(data, { recursive: true, force: true })
mkdirSync(shotDir, { recursive: true })
const electron = exe || (await import('electron')).default
const args = (exe ? [] : ['.']).concat([`--user-data-dir=${data}`, `--remote-debugging-port=${PORT}`, `--force-device-scale-factor=${scale}`])
const app = spawn(electron, args, { stdio: 'ignore', cwd: process.cwd() })

const user32 = koffi.load('user32.dll'), gdi32 = koffi.load('gdi32.dll')
koffi.proto('bool __stdcall EP(void *h, intptr_t l)')
koffi.struct('R', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' })
const EnumWindows = user32.func('bool __stdcall EnumWindows(EP *cb, intptr_t l)')
const Pid = user32.func('uint32 __stdcall GetWindowThreadProcessId(void *h, _Out_ uint32 *p)')
const Cls = user32.func('int __stdcall GetClassNameW(void *h, _Out_ uint16_t *b, int n)')
const Vis = user32.func('bool __stdcall IsWindowVisible(void *h)')
const GetParent = user32.func('void *__stdcall GetParent(void *h)')
const IsChild = user32.func('bool __stdcall IsChild(void *p, void *c)')
const GetRect = user32.func('bool __stdcall GetWindowRect(void *h, _Out_ R *r)')
const GetClient = user32.func('bool __stdcall GetClientRect(void *h, _Out_ R *r)')
const EnumChild = user32.func('bool __stdcall EnumChildWindows(void *p, EP *cb, intptr_t l)')
const childrenOf = (parent, pids) => { const out = []; const cb = koffi.register((h) => { const o = [0]; Pid(h, o); if (pids.has(o[0])) { const b = new Uint16Array(256); const n = Cls(h, b, 256); out.push({ h, cls: String.fromCharCode(...b.subarray(0, n)), vis: Vis(h) }) } return true }, 'EP *'); EnumChild(parent, cb, 0); koffi.unregister(cb); return out }
const addr = (p) => (p == null ? 0n : koffi.address(p))
const windowsOf = (pids) => {
  const out = []
  const cb = koffi.register((h) => { const o = [0]; Pid(h, o); if (pids.has(o[0])) { const b = new Uint16Array(256); const n = Cls(h, b, 256); out.push({ h, cls: String.fromCharCode(...b.subarray(0, n)), vis: Vis(h) }) } return true }, 'EP *')
  EnumWindows(cb, 0); koffi.unregister(cb); return out
}
const rect = (h) => { const r = {}; GetRect(h, r); return { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top } }
const psPids = (match) => execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${match}*' } | ForEach-Object { $_.ProcessId }`], { encoding: 'utf8' }).split(/\s+/).filter(Boolean).map(Number)
const list = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json())
let page
for (let i = 0; i < 60 && !page; i++) { await sleep(1000); try { page = (await list()).find((t) => t.type === 'page' && !t.url.startsWith('devtools')) } catch {} }
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r))
let id = 0; const pend = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); pend.get(m.id)?.(m); pend.delete(m.id) }
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })) })
const ev = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${detail}`) }
try {
  await sleep(4000)
  console.log('chromiumOpen ->', JSON.stringify(await ev(`window.api.chromiumOpen('how do tides work')`)))
  let orbis, chrome
  const pids = () => new Set(psPids(data.replace(/\//g, '\\')).concat(psPids(data)))
  for (let i = 0; i < 60 && !chrome; i++) {
    await sleep(1000)
    const all = pids()
    const tops = windowsOf(all).filter((w) => w.cls === 'Chrome_WidgetWin_1' && w.vis && addr(GetParent(w.h)) === 0n)
    orbis = tops.sort((a, b) => rect(b.h).w * rect(b.h).h - rect(a.h).w * rect(a.h).h)[0]
    chrome = orbis && childrenOf(orbis.h, all).find((c) => c.cls === 'Chrome_WidgetWin_1' && addr(GetParent(c.h)) === addr(orbis.h))
  }
  if (!chrome) console.log('DEBUG pids', [...pids()].join(','), JSON.stringify(windowsOf(pids()).map((w) => [String(addr(w.h)), w.cls, w.vis, String(addr(GetParent(w.h)))])))
  check('Chromium window found as a child of the Orbis window', Boolean(chrome))
  if (chrome) {
    await sleep(3000)
    const region = await ev(`(() => { const r = document.querySelector('[data-testid=browser-view-region]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, dpr: devicePixelRatio, vw: document.documentElement.clientWidth } })()`)
    const ct = { x: 0, y: 0 }
    const oc = {}; GetClient(orbis.h, oc)
    const o = rect(orbis.h), c = rect(chrome.h)
    region.dpr = oc.right / region.vw // true CSS-to-pixel scale (client width over viewport width)
    console.log('region', JSON.stringify(region), 'orbis', JSON.stringify(o), 'chrome', JSON.stringify(c))
    const dx = c.x - o.x, dy = c.y - o.y
    const tol = 2
    check(`child rect equals the browser view region (dpr ${region.dpr})`, Math.abs(c.w - region.w * region.dpr) <= tol && Math.abs(c.h - region.h * region.dpr) <= tol, `size ${c.w}x${c.h} vs ${Math.round(region.w * region.dpr)}x${Math.round(region.h * region.dpr)}`)
    check('child is at the region origin (client offset)', Math.abs(dx - region.x * region.dpr) <= 12 + tol && Math.abs(dy - region.y * region.dpr) <= 12 + tol, `offset ${dx},${dy} vs ${Math.round(region.x * region.dpr)},${Math.round(region.y * region.dpr)} (client origin)`)
    check('visible', Vis(chrome.h))
    // Return to chat
    await ev(`document.querySelector('.browser-back-chat').click()`)
    await sleep(1500)
    check('Return to chat hides the child window', !Vis(chrome.h))
    check('Chromium process still alive', pids().size > 1)
    await ev(`window.api.chromiumOpen('example.org')`)
    await sleep(4000)
    check('reopen shows the child window again', Vis(chrome.h))
    // Resize the Orbis window through CDP-less path: SetWindowPos
    const SetWindowPos = user32.func('bool __stdcall SetWindowPos(void *h, void *a, int x, int y, int cx, int cy, uint32 f)')
    SetWindowPos(orbis.h, null, o.x + 40, o.y + 40, 1000, 700, 0x0014)
    await sleep(2500)
    const region2 = await ev(`(() => { const r = document.querySelector('[data-testid=browser-view-region]').getBoundingClientRect(); return { w: r.width, h: r.height, dpr: 0, vw: document.documentElement.clientWidth } })()`)
    { const oc2 = {}; GetClient(orbis.h, oc2); region2.dpr = oc2.right / region2.vw }
    const c2 = rect(chrome.h)
    check('child follows a resize of the Orbis window', Math.abs(c2.w - region2.w * region2.dpr) <= tol && Math.abs(c2.h - region2.h * region2.dpr) <= tol, `${c2.w}x${c2.h} vs ${Math.round(region2.w * region2.dpr)}x${Math.round(region2.h * region2.dpr)}`)
    // Screenshot of the Orbis window with PrintWindow (own pid only)
    const PrintWindow = user32.func('bool __stdcall PrintWindow(void *h, void *dc, uint32 f)')
    const GetDC = user32.func('void *__stdcall GetDC(void *h)'), ReleaseDC = user32.func('int __stdcall ReleaseDC(void *h, void *dc)')
    const CreateCompatibleDC = gdi32.func('void *__stdcall CreateCompatibleDC(void *dc)')
    const CreateCompatibleBitmap = gdi32.func('void *__stdcall CreateCompatibleBitmap(void *dc, int w, int h)')
    const SelectObject = gdi32.func('void *__stdcall SelectObject(void *dc, void *o)')
    koffi.struct('BMI', { size: 'uint32', w: 'int32', h: 'int32', planes: 'uint16', bpp: 'uint16', comp: 'uint32', sz: 'uint32', xp: 'int32', yp: 'int32', cu: 'uint32', ci: 'uint32' })
    const GetDIBits = gdi32.func('int __stdcall GetDIBits(void *dc, void *bmp, uint32 s, uint32 n, _Out_ uint8_t *bits, _Inout_ BMI *bi, uint32 u)')
    const r2 = rect(orbis.h), W = r2.w, H = r2.h
    const sdc = GetDC(null), dc = CreateCompatibleDC(sdc), bmp = CreateCompatibleBitmap(sdc, W, H)
    SelectObject(dc, bmp); PrintWindow(orbis.h, dc, 2)
    const bi = { size: 40, w: W, h: -H, planes: 1, bpp: 32, comp: 0, sz: 0, xp: 0, yp: 0, cu: 0, ci: 0 }
    const bits = new Uint8Array(W * H * 4); GetDIBits(dc, bmp, 0, H, bits, bi, 0)
    ReleaseDC(null, sdc)
    const hdr = Buffer.alloc(54); hdr.write('BM'); hdr.writeUInt32LE(54 + bits.length, 2); hdr.writeUInt32LE(54, 10); hdr.writeUInt32LE(40, 14); hdr.writeInt32LE(W, 18); hdr.writeInt32LE(-H, 22); hdr.writeUInt16LE(1, 26); hdr.writeUInt16LE(32, 28)
    writeFileSync(`${shotDir}/orbis-embed-${scale}.bmp`, Buffer.concat([hdr, Buffer.from(bits)]))
    console.log('screenshot:', `${shotDir}/orbis-embed-${scale}.bmp`)
  }
} finally {
  try { execFileSync('taskkill', ['/F', '/PID', String(app.pid), '/T'], { stdio: 'ignore' }) } catch {}
  await sleep(1500)
  const left = psPids(data)
  console.log('processes left after killing the app:', left.length)
  for (const p of left) try { execFileSync('taskkill', ['/F', '/PID', String(p), '/T'], { stdio: 'ignore' }) } catch {}
  console.log(results.every(Boolean) ? 'EMBED CHECK OK' : 'EMBED CHECK FAILED')
  process.exit(results.every(Boolean) ? 0 : 1)
}
