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
user32.func('bool __stdcall SetProcessDPIAware()')() // real pixels everywhere (coordinates, screen copies)
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
const send = (method, params = {}) => Promise.race([sleep(30000).then(() => ({ timeout: true })), new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })) })])
const ev = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${detail}`) }
try {
  await sleep(4000)
  // Fresh profile: get past the welcome screen like a person would (type a name, Continue).
  await ev(`(() => { const i = document.querySelector('#welcome-name'); if (!i) return; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'Tester'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await sleep(500)
  await ev(`(() => { const b = document.querySelector('button.welcome-continue'); b && b.click() })()`)
  await sleep(9000)
  const dbgState = (tag) => { const ts = windowsOf(new Set([app.pid])).filter((w) => w.cls === 'Chrome_WidgetWin_1'); console.log('STATE', tag, JSON.stringify(ts.map((w) => [w.vis, user32.func('bool __stdcall IsIconic(void *h)')(w.h)]))) }
  { const SW = user32.func('bool __stdcall ShowWindow(void *h, int c)'), IC = user32.func('bool __stdcall IsIconic(void *h)'), SPOS = user32.func('bool __stdcall SetWindowPos(void *h, void *a, int x, int y, int cx, int cy, uint32 f)')
    for (let k = 0; k < 10; k++) { const w = windowsOf(new Set([app.pid])).find((x) => x.cls === 'Chrome_WidgetWin_1' && x.vis); if (w && IC(w.h)) { SW(w.h, 9); await sleep(800) } else if (w) { SPOS(w.h, null, 120, 80, 1300, 850, 0x0014); break } else await sleep(500) } }
  dbgState('before open')
  console.log('chromiumOpen ->', JSON.stringify(await ev(`window.api.chromiumOpen('how do tides work')`)))
  dbgState('after open')
  let orbis, chrome
  // Every process of the app we started: the descendants of its pid (found by parent pid, not by command line).
  const pids = () => {
    const rows = execFileSync('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | ForEach-Object { $_.ProcessId.ToString() + ' ' + $_.ParentProcessId }"], { encoding: 'utf8' }).split(String.fromCharCode(10)).filter(Boolean).map((l) => l.trim().split(' ').map(Number))
    const out = new Set([app.pid]); let grew = true
    while (grew) { grew = false; for (const [p, pp] of rows) if (!out.has(p) && out.has(pp)) { out.add(p); grew = true } }
    return out
  }
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
    { const SWP = user32.func('bool __stdcall SetWindowPos(void *h, void *a, int x, int y, int cx, int cy, uint32 f)'); user32.func('bool __stdcall ShowWindow(void *h, int c)')(orbis.h, 9); SWP(orbis.h, null, 120, 80, 1300, 850, 0x0014) } // a known size and place
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
    // ---- screenshots, window states, real input (guarded: only while the foreground window is the Orbis window we started) ----
    const { deflateSync } = await import('node:zlib')
    const png = (file, W, H, bgra) => {
      const raw = Buffer.alloc((W * 4 + 1) * H)
      for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) { const s = (y * W + x) * 4, d = y * (W * 4 + 1) + 1 + x * 4; raw[d] = bgra[s + 2]; raw[d + 1] = bgra[s + 1]; raw[d + 2] = bgra[s]; raw[d + 3] = 255 } }
      const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c })
      const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0 }
      const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
      const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 6
      writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
    }
    const GetDC = user32.func('void *__stdcall GetDC(void *h)'), ReleaseDC = user32.func('int __stdcall ReleaseDC(void *h, void *dc)')
    const CreateCompatibleDC = gdi32.func('void *__stdcall CreateCompatibleDC(void *dc)')
    const CreateCompatibleBitmap = gdi32.func('void *__stdcall CreateCompatibleBitmap(void *dc, int w, int h)')
    const SelectObject = gdi32.func('void *__stdcall SelectObject(void *dc, void *o)')
    const BitBlt = gdi32.func('bool __stdcall BitBlt(void *d, int x, int y, int w, int h, void *s, int sx, int sy, uint32 rop)')
    koffi.struct('BMI', { size: 'uint32', w: 'int32', h: 'int32', planes: 'uint16', bpp: 'uint16', comp: 'uint32', sz: 'uint32', xp: 'int32', yp: 'int32', cu: 'uint32', ci: 'uint32' })
    const GetDIBits = gdi32.func('int __stdcall GetDIBits(void *dc, void *bmp, uint32 s, uint32 n, _Out_ uint8_t *bits, _Inout_ BMI *bi, uint32 u)')
    const GetFg = user32.func('void *__stdcall GetForegroundWindow()'), GetAncestor = user32.func('void *__stdcall GetAncestor(void *h, uint32 f)')
    const SetFg = user32.func('bool __stdcall SetForegroundWindow(void *h)'), ShowWindow = user32.func('bool __stdcall ShowWindow(void *h, int c)')
    const PostMessageW = user32.func('bool __stdcall PostMessageW(void *h, uint32 m, uintptr_t w, intptr_t l)')
    const IsIconic = user32.func('bool __stdcall IsIconic(void *h)'), IsZoomed = user32.func('bool __stdcall IsZoomed(void *h)')
    const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(void *h, _Out_ uint16_t *b, int n)')
    const keybd = user32.func('void __stdcall keybd_event(uint8 vk, uint8 sc, uint32 f, uintptr_t e)')
    const SetCursorPos = user32.func('bool __stdcall SetCursorPos(int x, int y)'), mouse = user32.func('void __stdcall mouse_event(uint32 f, int dx, int dy, uint32 d, uintptr_t e)')
    const WindowFromPoint = user32.func('void *__stdcall WindowFromPoint(int64 pt)')
    const title = (h) => { const b = new Uint16Array(300); const n = GetWindowTextW(h, b, 300); return String.fromCharCode(...b.subarray(0, n)) }
    const isFgOurs = () => addr(GetAncestor(GetFg(), 2)) === addr(orbis.h) || addr(GetFg()) === addr(orbis.h)
    const front = async () => { ShowWindow(orbis.h, 9); keybd(0x12, 0, 0, 0); keybd(0x12, 0, 2, 0); SetFg(orbis.h); for (let i = 0; i < 10 && !isFgOurs(); i++) await sleep(150); return isFgOurs() }
    const shot = async (name) => {
      const r = rect(orbis.h)
      const fgOk = isFgOurs()
      const W = r.w, H = r.h
      const sdc = GetDC(null), dc = CreateCompatibleDC(sdc), bmp = CreateCompatibleBitmap(sdc, W, H)
      SelectObject(dc, bmp)
      if (fgOk) BitBlt(dc, 0, 0, W, H, sdc, r.x, r.y, 0x00CC0020)
      else { const PW = user32.func('bool __stdcall PrintWindow(void *h, void *dc, uint32 f)'); PW(orbis.h, dc, 2) }
      const bi = { size: 40, w: W, h: -H, planes: 1, bpp: 32, comp: 0, sz: 0, xp: 0, yp: 0, cu: 0, ci: 0 }
      const bits = new Uint8Array(W * H * 4); GetDIBits(dc, bmp, 0, H, bits, bi, 0); ReleaseDC(null, sdc)
      png(`${shotDir}/${name}-${scale}.png`, W, H, bits)
      const cdp = await send('Page.captureScreenshot', { format: 'png' })
      if (cdp.result?.data) writeFileSync(`${shotDir}/${name}-${scale}-renderer.png`, Buffer.from(cdp.result.data, 'base64'))
      console.log('screenshot', `${shotDir}/${name}-${scale}.png`, fgOk ? '(screen copy of the Orbis window rect)' : '(PrintWindow)')
    }
    const expectRegion = async (label) => { for (let t = 0; t < 8; t++) { if (await regionOk()) break; await sleep(800) }; await expectRegion0(label) }
    const regionOk = async () => { const g = await ev(`(() => { const r = document.querySelector('[data-testid=browser-view-region]').getBoundingClientRect(); return { w: r.width, h: r.height, vw: document.documentElement.clientWidth } })()`); const oc3 = {}; GetClient(orbis.h, oc3); const s = oc3.right / g.vw; const cc = rect(chrome.h); return Math.abs(cc.w - g.w * s) <= 2 && Math.abs(cc.h - g.h * s) <= 2 }
    const expectRegion0 = async (label) => {
      const g = await ev(`(() => { const r = document.querySelector('[data-testid=browser-view-region]').getBoundingClientRect(); return { w: r.width, h: r.height, vw: document.documentElement.clientWidth } })()`)
      const oc3 = {}; GetClient(orbis.h, oc3); const s = oc3.right / g.vw; const cc = rect(chrome.h)
      check(label, Math.abs(cc.w - g.w * s) <= 2 && Math.abs(cc.h - g.h * s) <= 2 && Vis(chrome.h), `${cc.w}x${cc.h} vs ${Math.round(g.w * s)}x${Math.round(g.h * s)}`)
    }
    ShowWindow(orbis.h, 3); await sleep(2000); check('maximised', IsZoomed(orbis.h)); await expectRegion('child fills the region when maximised')
    ShowWindow(orbis.h, 9); await sleep(2000); await expectRegion('child correct after restore from maximise')
    ShowWindow(orbis.h, 6); await sleep(1500); check('minimised', IsIconic(orbis.h))
    ShowWindow(orbis.h, 9); await sleep(2500); await expectRegion('child correct after minimise and restore')
    if (await front()) {
      await shot('orbis-embedded')
      const c3 = rect(chrome.h)
      const scaleF = Number(scale)
      const px = c3.x + Math.round(420 * scaleF), py = c3.y + Math.round(104 * scaleF)
      const under = WindowFromPoint(BigInt(px) | (BigInt(py) << 32n))
      const uo = [0]; Pid(under, uo)
      { const GL = user32.func('intptr_t __stdcall GetWindowLongPtrW(void *h, int i)'), GW = user32.func('void *__stdcall GetWindow(void *h, uint32 c)')
        console.log('DEBUG child style', (Number(BigInt.asUintN(32, BigInt(GL(chrome.h, -16))))).toString(16), 'ex', (Number(BigInt.asUintN(32, BigInt(GL(chrome.h, -20))))).toString(16), 'chrome', String(addr(chrome.h)))
        let w = GW(orbis.h, 5); const order = []; while (w && order.length < 20) { const b = new Uint16Array(64); const n = Cls(w, b, 64); order.push(String(addr(w)) + ':' + String.fromCharCode(...b.subarray(0, n)) + ':' + (Vis(w) ? 'v' : 'h')); w = GW(w, 2) }
        console.log('DEBUG z-order children top to bottom:', order.join(' | ')) }
      { const cb3 = new Uint16Array(64); const n3 = Cls(under, cb3, 64); console.log('DEBUG under pointer:', String(addr(under)), 'pid', uo[0], 'class', String.fromCharCode(...cb3.subarray(0, n3)), 'parent', String(addr(GetParent(under)))) }
      if (isFgOurs() && pids().has(uo[0])) {
        SetCursorPos(px, py); await sleep(150); mouse(2, 0, 0, 0, 0); mouse(4, 0, 0, 0, 0); await sleep(400)
        { koffi.struct('GTI', { cb: 'uint32', flags: 'uint32', active: 'void *', focus: 'void *', capture: 'void *', menu: 'void *', move: 'void *', caret: 'void *', rc: 'int32[4]' })
          const GGTI = user32.func('bool __stdcall GetGUIThreadInfo(uint32 t, _Inout_ GTI *i)')
          const tid = user32.func('uint32 __stdcall GetWindowThreadProcessId(void *h, _Out_ uint32 *p)')(GetFg(), [0])
          const info = { cb: 72, flags: 0, active: null, focus: null, capture: null, menu: null, move: null, caret: null, rc: [0, 0, 0, 0] }
          GGTI(tid, info); const fh = addr(info.focus); const fo = [0]; Pid(info.focus, fo)
          const cb2 = new Uint16Array(64); const n2 = Cls(info.focus, cb2, 64)
          console.log('DEBUG focus after click:', String(fh), 'pid', fo[0], 'class', String.fromCharCode(...cb2.subarray(0, n2)), 'chrome hwnd', String(addr(chrome.h)), 'orbis', String(addr(orbis.h)), 'app pid', app.pid, 'chrome pid', (() => { const o = [0]; Pid(chrome.h, o); return o[0] })(), 'fgroot-is-orbis', isFgOurs()) }
        const tap = (vk) => { keybd(vk, 0, 0, 0); keybd(vk, 0, 2, 0) }
        const type = async (s) => { for (const ch of s) { if (!isFgOurs()) return false; tap(ch.toUpperCase().charCodeAt(0)); await sleep(30) } return true }
        keybd(0x11, 0, 0, 0); tap(0x41); keybd(0x11, 0, 2, 0)
        const okType = await type('IANA')
        tap(0xBE); await type('ORG')
        await sleep(800); await shot('orbis-omnibox-suggestions')
        tap(0x0D); await sleep(4000)
        check('typing in the embedded omnibox navigates (window title changes)', okType && /internet assigned|iana/i.test(title(chrome.h)), title(chrome.h))
        await shot('orbis-after-typing')
        keybd(0x11, 0, 0, 0); keybd(0x10, 0, 0, 0); tap(0x59); keybd(0x10, 0, 2, 0); keybd(0x11, 0, 2, 0); await sleep(3000)
        await shot('orbis-panel')
        keybd(0x12, 0, 0, 0); tap(0x46); keybd(0x12, 0, 2, 0); await sleep(1500)
        await shot('orbis-app-menu'); tap(0x1B); await sleep(400)
        SetCursorPos(c3.x + Math.round(400 * scaleF), c3.y + Math.round(400 * scaleF)); await sleep(200); mouse(8, 0, 0, 0, 0); mouse(16, 0, 0, 0, 0); await sleep(1200)
        await shot('orbis-context-menu'); tap(0x1B)
      } else check('pointer over the embedded browser', false, 'skipped real input: not ours')
    } else check('Orbis window could be brought to the front for real input', false, 'skipped (foreground lock)')
    // Closing the Orbis window (WM_CLOSE, like the close button) must end Chromium too.
    const before = pids().size
    PostMessageW(orbis.h, 0x0010, 0, 0)
    let left = before; for (let i = 0; i < 20 && left > 0; i++) { await sleep(1000); left = pids().size }
    if (left) console.log('LEFT', [...pids()].join(','))
    check('closing the Orbis window closes Chromium (only the Orbis main process may stay)', left <= 1, `${before} -> ${left}`)
  }
} catch (err) {
  console.log('FAIL  harness error', err && err.stack ? err.stack.split(String.fromCharCode(10)).slice(0, 4).join(' | ') : err)
  results.push(false)
} finally {
  try { execFileSync('taskkill', ['/F', '/PID', String(app.pid), '/T'], { stdio: 'ignore' }) } catch {}
  await sleep(1500)
  const left = psPids(data)
  console.log('processes left after killing the app:', left.length)
  for (const p of left) try { execFileSync('taskkill', ['/F', '/PID', String(p), '/T'], { stdio: 'ignore' }) } catch {}
  console.log(results.every(Boolean) ? 'EMBED CHECK OK' : 'EMBED CHECK FAILED')
  process.exit(results.every(Boolean) ? 0 : 1)
}
