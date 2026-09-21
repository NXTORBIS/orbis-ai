// Views 2 screenshot harness: one browser per theme/scale, many surfaces, each captured with PrintWindow of THIS process's own windows.
//   node --experimental-strip-types scripts/orbis-views2-shots.mjs --scale 1 [--light] [--only a,b] [--out docs/views2-shots] [--tag v2]
// All input goes through BrowserUi, which refuses to send anything unless the foreground window (and the window under the cursor) is this pid's.
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserUi } from '../src/main/chromium/browserUi.ts'

const args = process.argv.slice(2)
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const scale = opt('--scale', '1')
const light = args.includes('--light')
const only = opt('--only', '') ? opt('--only', '').split(',') : null
const repo = fileURLToPath(new URL('..', import.meta.url))
const outDir = opt('--out', join(repo, 'docs', 'views2-shots'))
const tag = opt('--tag', 'v2')
const theme = light ? 'light' : 'dark'
const suffix = `${theme}${Math.round(Number(scale) * 100)}`
const port = 9445
const dbg = 9334
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- local test server -------------------------------------------------------------------------------------------------------------
const wav = (() => {
  const n = 8000 * 40, b = Buffer.alloc(44 + n)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40)
  for (let i = 0; i < n; i++) b[44 + i] = 128 + Math.round(60 * Math.sin(i * 2 * Math.PI * 440 / 8000))
  return b
})()
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#3fd8ff"/><circle cx="120" cy="60" r="40" fill="#0e1013"/></svg>'
const page = (title, body, head = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body style="font:16px system-ui;margin:24px">${body}</body></html>`
const sockets = new Set()
const server = createServer((req, res) => {
  const u = req.url.split('?')[0]
  if (u === '/' || u === '/index.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(page('Orbis test page', `<h1>Orbis test page</h1><p id="sel">Select this sample sentence for the selection menu.</p>
      <p><a id="link" href="/other">Example link to another page</a></p><p><img id="img" src="/img.svg" width="240" height="120"></p>
      <input id="in" placeholder="Text field" size="30"><p><a id="dl" href="/dlsmall" download>download</a></p>`))
  }
  if (u === '/other') { res.setHeader('content-type', 'text/html'); return res.end(page('Other page', '<h1>Other</h1>')) }
  if (u === '/img.svg') { res.setHeader('content-type', 'image/svg+xml'); return res.end(svg) }
  if (u === '/audio.wav') { res.setHeader('content-type', 'audio/wav'); return res.end(wav) }
  if (u === '/media') {
    res.setHeader('content-type', 'text/html')
    return res.end(page('Media test', '<audio id="a" src="/audio.wav" loop autoplay></audio><video id="v" width="320" height="180" muted autoplay></video><script>navigator.mediaSession.metadata=new MediaMetadata({title:"Orbis test tone",artist:"Local"});const c=document.createElement("canvas");c.width=320;c.height=180;const x=c.getContext("2d");setInterval(()=>{x.fillStyle="#"+Math.floor(Math.random()*0xffffff).toString(16).padStart(6,"0");x.fillRect(0,0,320,180)},200);v.srcObject=c.captureStream(10);a.play().catch(()=>{});</script>'))
  }
  if (u === '/login') {
    res.setHeader('content-type', 'text/html')
    return res.end(page('Sign in test', '<form id="f" method="post" action="/done"><input id="u" name="username" autocomplete="username"><input id="p" name="password" type="password" autocomplete="current-password"><button id="s">Sign in</button></form>'))
  }
  if (u === '/done') { res.setHeader('content-type', 'text/html'); return res.end(page('Done', '<h1>Signed in</h1>')) }
  if (u === '/addr') {
    res.setHeader('content-type', 'text/html')
    return res.end(page('Address form', '<form method="post" action="/done"><input id="n" name="name" autocomplete="name"><input name="street" autocomplete="street-address"><input name="city" autocomplete="address-level2"><input name="zip" autocomplete="postal-code"><input name="email" autocomplete="email"><button id="s">Save</button></form>'))
  }
  if (u === '/es') { res.setHeader('content-type', 'text/html'); return res.end(page('Pagina en espanol', '<p>Hola, esto es una pagina de prueba escrita en espanol para el traductor.</p><p>Buenos dias a todos los usuarios del navegador.</p>').replace('lang="en"', 'lang="es"')) }
  if (u === '/bf') { res.setHeader('content-type', 'text/html'); return res.end(page('Unload test', '<input id="t"><script>onbeforeunload=e=>{e.preventDefault();e.returnValue=""}</script>')) }
  if (u === '/dlsmall') { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="orbis-report.bin"', 'content-length': 60000 }); return res.end(Buffer.alloc(60000, 7)) }
  if (u === '/dlslow' || u === '/dlfail') {
    const total = 30 * 1024 * 1024
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${u === '/dlfail' ? 'orbis-broken' : 'orbis-large-archive'}.zip"`, 'content-length': total })
    let sent = 0
    const t = setInterval(() => {
      if (res.destroyed) return clearInterval(t)
      res.write(Buffer.alloc(300 * 1024, 1)); sent += 300 * 1024
      if (u === '/dlfail' && sent >= 1500 * 1024) { clearInterval(t); req.socket.destroy() }
      if (sent >= total) { clearInterval(t); res.end() }
    }, 250)
    req.on('close', () => clearInterval(t))
    return
  }
  res.statusCode = 404; res.end('nope')
})
server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)) })
await new Promise((r) => server.listen(port, '127.0.0.1', r))
const base = `http://127.0.0.1:${port}`

// ---- profile + browser -------------------------------------------------------------------------------------------------------------
const prof = join(process.env.TEMP, `orbis-views2-prof-${suffix}`)
const bm = (id, name, url) => ({ id: String(id), name, type: 'url', url, date_added: '13300000000000000' })
for (let attempt = 0; attempt < 4; attempt++) {
  rmSync(prof, { recursive: true, force: true })
  mkdirSync(join(prof, 'Default'), { recursive: true })
  writeFileSync(join(prof, 'Default', 'Preferences'), JSON.stringify({ browser: { theme: { color_scheme2: light ? 1 : 2 }, show_home_button: false }, bookmark_bar: { show_on_all_tabs: true }, profile: { password_manager_enabled: true, content_settings: { exceptions: { geolocation: { 'http://localhost:9445,*': { setting: 1, last_modified: '13300000000000000' } }, notifications: { 'http://localhost:9445,*': { setting: 2, last_modified: '13300000000000000' } }, media_stream_camera: { 'http://localhost:9445,*': { setting: 1, last_modified: '13300000000000000' } } } } } }))
  writeFileSync(join(prof, 'Default', 'Bookmarks'), JSON.stringify({ checksum: '', version: 1, roots: {
    bookmark_bar: { id: '1', name: 'Bookmarks bar', type: 'folder', date_added: '13300000000000000', children: [
      bm(5, 'Orbis test', `${base}/`), bm(6, 'Example', 'https://example.com/'),
      { id: '7', name: 'Research', type: 'folder', date_added: '13300000000000000', children: [bm(8, 'IANA', 'https://www.iana.org/'), bm(9, 'Example Org', 'https://example.org/'), { id: '10', name: 'Nested', type: 'folder', children: [bm(11, 'Deep link', 'https://example.net/')] }] }] },
    other: { id: '2', name: 'Other bookmarks', type: 'folder', children: [] }, synced: { id: '3', name: 'Mobile bookmarks', type: 'folder', children: [] } } }))
  var child = spawn('C:\\chromium\\src\\out\\Default\\chrome.exe', [
    `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', `--force-device-scale-factor=${scale}`, '--window-position=40,40',
    `--window-size=${opt('--size', '1300,760')}`, `--remote-debugging-port=${dbg}`, '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream',
    `--orbis-extension-dir=${repo}extension`, ...(opt('--extra', '') ? opt('--extra', '').split(' ') : []), `${base}/`], { stdio: 'ignore' })
  await sleep(6000)
  if (child.exitCode === null) break
}
if (child.exitCode !== null) throw new Error('browser crashed at start')
const pid = child.pid

async function cdp() {
  const v = await (await fetch(`http://127.0.0.1:${dbg}/json/version`)).json()
  const ws = new WebSocket(v.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0; const pending = new Map(); const listeners = []
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) pending.get(d.id)(d); else listeners.forEach((l) => l(d)) }
  const send = (method, params = {}, sessionId) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })) })
  return { send, on: (f) => listeners.push(f), close: () => ws.close() }
}

let ui
const results = []
try {
  const c = await cdp()
  const attach = async (targetId) => (await c.send('Target.attachToTarget', { targetId, flatten: true })).result.sessionId
  const evalIn = async (sid, expression, gesture = false) => {
    const r = await c.send('Runtime.evaluate', { expression, awaitPromise: false, returnByValue: true, userGesture: gesture }, sid)
    return r.result?.result?.value
  }
  const pages = async () => (await c.send('Target.getTargets')).result.targetInfos.filter((t) => t.type === 'page')
  const openPage = async (url) => {
    const { result } = await c.send('Target.createTarget', { url })
    await c.send('Target.activateTarget', { targetId: result.targetId })
    const sid = await attach(result.targetId)
    await c.send('Runtime.enable', {}, sid); await c.send('Page.enable', {}, sid)
    await sleep(1200)
    return { targetId: result.targetId, sid, ev: (e, g) => evalIn(sid, e, g), close: () => c.send('Target.closeTarget', { targetId: result.targetId }) }
  }
  let worker
  for (let i = 0; i < 40 && !worker; i++) {
    const { result } = await c.send('Target.getTargets')
    worker = result.targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://gcaebckmlhiagfagcplpjmibhkhjljab/'))
    if (!worker) await sleep(500)
  }
  ui = new BrowserUi(pid)
  let win = await ui.pickWindow()
  await ui.focus(win)
  const shot = (name, extra = []) => {
    const file = `${tag}_${name}_${suffix}.png`
    execFileSync('powershell.exe', ['-NoProfile', '-File', join(repo, 'scripts', 'orbis-capture.ps1'), '-ProcId', String(pid), '-Out', join(outDir, file), ...extra], { stdio: 'pipe' })
    console.log('  shot', file)
    return file
  }
  const esc = async () => { try { await ui.pressInMenu('esc') } catch { /* no popup */ } try { await ui.press(win, 'esc') } catch { /* */ } await sleep(250) }
  const refresh = async () => { win = await ui.pickWindow(); return win }
  const rectOf = async (p, sel) => JSON.parse(await p.ev(`JSON.stringify((()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:innerWidth}})())`))
  const rightClickPage = async (p, sel) => { const r = await rectOf(p, sel); await ui.clickPage(win, r.x, r.y, r.w, true); await sleep(700) }
  const clickPage = async (p, sel) => { const r = await rectOf(p, sel); await ui.clickPage(win, r.x, r.y, r.w, false); await sleep(500) }
  const baseTab = (await pages()).find((t) => t.url.startsWith(base))
  const home = { targetId: baseTab.targetId, sid: await attach(baseTab.targetId) }
  await c.send('Runtime.enable', {}, home.sid); await c.send('Page.enable', {}, home.sid)
  home.ev = (e, g) => evalIn(home.sid, e, g)
  const winId = (await c.send('Browser.getWindowForTarget', { targetId: baseTab.targetId })).result.windowId
  const setBounds = (b) => c.send('Browser.setWindowBounds', { windowId: winId, bounds: b })
  const el = (re, right = false, type) => ui.clickElement(win, re, right, type)
  const names = async () => (await ui.elements()).map((e) => `${e.t}:${e.n}`).join(' | ')

  const S = {
    // --- context menus
    async tabctx() { await el(/Orbis test page/, true, 'TabItem'); await sleep(600); shot('tabctx') },
    async pagectx() { await rightClickPage(home, 'h1'); shot('pagectx') },
    async linkctx() { await rightClickPage(home, '#link'); shot('linkctx') },
    async imgctx() { await rightClickPage(home, '#img'); shot('imgctx') },
    async selctx() { await home.ev(`(()=>{const r=document.createRange();r.selectNodeContents(document.getElementById('sel'));const s=getSelection();s.removeAllRanges();s.addRange(r)})()`); await rightClickPage(home, '#sel'); shot('selctx') },
    async omniboxctx() { await ui.press(win, 'ctrl+l'); await el(/Address and search bar/, true, 'Edit'); await sleep(500); shot('omniboxctx') },
    // --- toolbar bubbles
    async profile() { console.log('  ', (await names()).slice(0, 900)); await el(/^You$|^Profile|Sign in|Guest/i, false, 'Button'); await sleep(900); shot('profile') },
    async bookmarkbubble() { const p = await openPage(base + '/other'); await ui.press(win, 'ctrl+d'); await sleep(900); shot('bookmarkbubble'); await esc(); await p.close() },
    async bookmarkfolder() { await el(/^Research/, false); await sleep(700); shot('bookmarkfolder') },
    async bookmarkctx() { await el(/^Example$/, true); await sleep(600); shot('bookmarkctx') },
    async extensions() { await ui.press(win, 'alt+f'); await sleep(600); await el(/^Extensions/, false, 'MenuItem'); await sleep(900); shot('extensions') },
    async siteinfo() { await el(/site information|Not secure|connection/i, false, 'Button'); await sleep(900); shot('siteinfo') },
    async siteinfoperm() { const p = await openPage('http://localhost:9445/'); await sleep(800); await el(/site information|Not secure|connection/i, false, 'Button'); await sleep(900); shot('siteinfoperm'); await esc(); await p.close() },
    async focusring() { await ui.press(win, 'alt+shift+t'); await sleep(300); await ui.press(win, 'tab'); await ui.press(win, 'tab'); await sleep(400); shot('focusring_toolbar'); await ui.press(win, 'esc') },
    async findbar() { await ui.press(win, 'ctrl+f'); await ui.type(win, 'sample'); await sleep(300); await ui.press(win, 'enter'); await sleep(500); shot('findbar') },
    async zoom() { await ui.press(win, 'ctrl+plus'); await sleep(700); shot('zoom'); await ui.press(win, 'ctrl+0') },
    async tabsearch() { await ui.press(win, 'ctrl+shift+a'); await sleep(900); shot('tabsearch') },
    async appmenu() { await ui.press(win, 'alt+f'); await sleep(700); shot('appmenu') },
    // --- downloads
    async dlprogress() { await home.ev(`location.href='${base}/dlslow'`); await sleep(3000); console.log('  ', (await names()).slice(0,600)); try { await el(/Download/i, false, 'Button'); await sleep(900) } catch (e) { console.log('  no dl button', e.message.slice(0,300)) } shot('dlprogress') },
    async dldone() { await home.ev(`document.getElementById('dl')?.click()`, true); await sleep(2500); try { await el(/Download/i, false, 'Button'); await sleep(900) } catch (e) { console.log('  no dl button') } shot('dldone') },
    async dlfail() { await home.ev(`location.href='${base}/dlfail'`, true); await sleep(9000); try { await el(/Download/i, false, 'Button'); await sleep(900) } catch (e) { console.log('  no dl button') } shot('dlfail') },
    // --- permissions
    async permgeo() { await home.ev(`navigator.geolocation.getCurrentPosition(()=>{},()=>{})`, true); await sleep(1200); shot('permgeo') },
    async permcam() { await home.ev(`navigator.mediaDevices.getUserMedia({video:true,audio:true}).catch(()=>{})`, true); await sleep(1500); shot('permcam') },
    async permnotif() { await home.ev(`Notification.requestPermission()`, true); await sleep(1200); shot('permnotif') },
    // --- dialogs
    async alertdlg() { await home.ev(`setTimeout(()=>alert('This is an alert message from the page.'),50)`); await sleep(900); shot('alert'); await c.send('Page.handleJavaScriptDialog', { accept: true }, home.sid) },
    async confirmdlg() { await home.ev(`setTimeout(()=>confirm('Do you want to continue with this action?'),50)`); await sleep(900); shot('confirm'); await c.send('Page.handleJavaScriptDialog', { accept: false }, home.sid) },
    async promptdlg() { await home.ev(`setTimeout(()=>prompt('What is your name?','Orbis'),50)`); await sleep(900); shot('prompt'); await c.send('Page.handleJavaScriptDialog', { accept: false }, home.sid) },
    async beforeunload() { const p = await openPage(`${base}/bf`); await p.ev(`document.getElementById('t').focus()`, true); await ui.clickPage(win, 100, 100, 1300); await p.ev(`setTimeout(()=>{location.href='${base}/other'},50)`, true); await sleep(1200); shot('beforeunload'); await c.send('Page.handleJavaScriptDialog', { accept: true }, p.sid).catch(() => {}); await p.close() },
    // --- fullscreen, hover, tooltips
    async fullscreen() { await home.ev(`document.documentElement.requestFullscreen()`, true); await sleep(1500); shot('fullscreen'); await home.ev(`document.exitFullscreen()`, true); await sleep(600) },
    async tabhover() { const t = (await ui.elements()).find((e) => e.t === 'TabItem'); await ui.hoverAt(win, t.x, t.y); await sleep(1800); shot('tabhover') },
    async tooltip() { const t = (await ui.elements()).find((e) => /^Reload/.test(e.n) || /Reload/.test(e.n)); await ui.hoverAt(win, t.x, t.y); await sleep(2500); shot('tooltip') },
    // --- media
    async media() { const p = await openPage(`${base}/media`); await sleep(2500); const e = await ui.elements(); console.log('  ', e.filter((x) => /media|music|control/i.test(x.n)).map((x) => x.n)); try { await el(/Control your music|media/i, false, 'Button'); await sleep(1000) } catch (er) { console.log('  media button:', String(er.message).slice(0, 200)) } shot('media'); await esc(); await p.close() },
    async pip() { const p = await openPage(`${base}/media`); await sleep(2000); await p.ev(`document.getElementById('v').requestPictureInPicture()`, true); await sleep(2000); shot('pip'); shot('pipwin', ['-Each']); await p.ev(`document.exitPictureInPicture()`, true); await p.close() },
    // --- password / autofill / translate
    async savepw() { const p = await openPage(`${base}/login`); await p.ev(`document.getElementById('u').focus()`, true); await ui.clickPage(win, 60, 40, 1300); await ui.type(win, 'orbis-user'); await ui.press(win, 'tab'); await ui.type(win, 'hunter2-test'); await ui.press(win, 'enter'); await sleep(2500); shot('savepw'); await esc(); await p.close() },
    async translate() { const p = await openPage(`${base}/es`); await sleep(2500); shot('translate'); await p.close() },
    async profilenew() { await el(/^You$|^Profile|Sign in|Guest/i, false, 'Button'); await sleep(900); shot('profilebubble'); console.log('  win', win.left, win.top); await ui.clickScreen(win, win.left + Number(process.env.PX ?? 988), win.top + Number(process.env.PY ?? 350)); for (let k = 0; k < 15 && (await ui.windows()).length < 2; k++) await sleep(1500); console.log('  windows', JSON.stringify((await ui.windows()).map((w) => [w.title, w.left, w.top, w.right, w.bottom]))); shot('profilenew', ['-Each']) },
    async profilepicker() { const p = await openPage('chrome://profile-picker/'); await sleep(2500); shot('profilepicker'); await p.close() },
    async profilecreate() { const p = await openPage('chrome://profile-picker/new-profile'); await sleep(2500); shot('profilecreate'); await p.close() },
    // --- window frame states
    async frame_max() { await setBounds({ windowState: 'maximized' }); await sleep(1200); shot('frame_max'); await setBounds({ windowState: 'normal' }); await sleep(600) },
    async frame_narrow() { await setBounds({ windowState: 'normal', width: 520, height: 700 }); await sleep(1000); shot('frame_narrow'); await setBounds({ width: 1300, height: 760 }); await sleep(600) },
    async frame_short() { await setBounds({ windowState: 'normal', width: 1000, height: 330 }); await sleep(1000); shot('frame_short'); await setBounds({ width: 1300, height: 760 }); await sleep(600) },
    // --- tab strip: overflow + groups
    async tabgroups() {
      await el(/Orbis test page/, true, 'TabItem'); await sleep(500)
      await el(/Add tab to new group/, false, 'MenuItem'); await sleep(1000)
      shot('groupeditor')
      await ui.type(win, 'Research'); await ui.press(win, 'enter'); await sleep(700)
      console.log('  ', (await names()).slice(0, 500))
      await ui.clickScreen(win, win.left + 62, win.top + 20, true); await sleep(800); shot('groupctx'); await esc()
      for (let i = 0; i < 14; i++) await c.send('Target.createTarget', { url: `${base}/other?${i}` })
      await sleep(3500); shot('taboverflow')
    }
  }
  const order = Object.keys(S)
  for (const name of order) {
    if (only && !only.includes(name)) continue
    console.log('==', name)
    try {
      await refresh(); await ui.focus(win)
      await S[name]()
      results.push([name, 'ok'])
    } catch (e) { console.log('  FAILED', String(e.message).slice(0, 400)); results.push([name, 'FAILED ' + String(e.message).slice(0, 120)]) }
    try { await esc(); await c.send('Page.handleJavaScriptDialog', { accept: false }, home.sid) } catch { /* */ }
    try { await esc() } catch { /* */ }
  }
  c.close()
} finally {
  ui?.close()
  server.close(); sockets.forEach((s) => s.destroy())
  try { process.kill(pid) } catch { /* gone */ }
}
console.log(JSON.stringify(results))
process.exit(0)
