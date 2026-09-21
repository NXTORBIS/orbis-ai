// Launches the built Orbis Chromium (fresh temp profile per page, so a crashing page cannot stop the run),
// opens internal pages over CDP, screenshots each and lists rendered-text hits for chrome/chromium/google
// (walks shadow roots and common label attributes; URLs are ignored).
import { spawn, execSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] || 'docs/branding-audit-shots'
mkdirSync(out, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pages = (process.env.PAGES || 'chrome://version,chrome://settings,chrome://settings/help').split(',')
const walk = `(() => { const hits = []; const re0 = /chrom(e|ium)|google/i; const re = { test: (t) => re0.test(t.replace(/(chrome|chrome-untrusted|chrome-extension|https?):[^ "']*/gi,'')) };
 function walk(n){ if(!n) return; if(n.nodeType===3){ const t=n.textContent.trim(); if(t&&re.test(t)) { const p=n.parentNode; hits.push(t.slice(0,160)+'  <'+((p&&(p.tagName||'shadow'))||'')+(p&&p.id?'#'+p.id:'')+'>') } return }
  if(n.nodeType===1){ for(const a of ['title','aria-label','placeholder','alt','label','text','description','sub-label','header']){ const val=n.getAttribute&&n.getAttribute(a); if(val&&re.test(val)) hits.push('['+a+'] '+val.slice(0,160)) } if(n.tagName==='SCRIPT'||n.tagName==='STYLE') return; if(n.shadowRoot) walk(n.shadowRoot) }
  for(const c of (n.childNodes||[])) walk(c) }
 walk(document); return JSON.stringify({title:document.title, hits:[...new Set(hits)]}) })()`
async function one(url) {
  const port = 9600 + Math.floor(Math.random() * 100)
  const prof = mkdtempSync(join(tmpdir(), 'orbis-brand-'))
  const child = spawn('C:/chromium/src/out/Default/chrome.exe', [`--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, '--window-position=40,40', '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' })
  const kill = () => { try { execSync(`taskkill /F /PID ${child.pid} /T`, { stdio: 'ignore' }) } catch {} }
  try {
    let v
    for (let i = 0; i < 60; i++) { try { v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break } catch { await sleep(500) } }
    const ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r))
    let id = 0; const pend = new Map()
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } }
    const send = (method, params = {}, sessionId) => Promise.race([new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })) }), sleep(15000).then(() => ({ error: 'timeout' }))])
    const t = await send('Target.createTarget', { url: 'about:blank' })
    const a = await send('Target.attachToTarget', { targetId: t.result.targetId, flatten: true })
    const sid = a.result.sessionId
    await send('Page.enable', {}, sid)
    await send('Page.navigate', { url }, sid)
    await sleep(url.includes('settings') || url.includes('extensions') ? 3500 : 2500)
    const r = await send('Runtime.evaluate', { expression: walk, returnByValue: true }, sid)
    let data = { title: '?', hits: [] }
    try { data = JSON.parse(r.result.result.value) } catch { data.hits = ['(no result: page crashed or timed out)'] }
    const shot = await send('Page.captureScreenshot', { format: 'png' }, sid)
    if (shot.result?.data) writeFileSync(join(out, url.replace(/[^a-z0-9]+/gi, '_') + '.png'), Buffer.from(shot.result.data, 'base64'))
    return data
  } catch (e) { return { title: '?', hits: ['(error ' + e.message + ')'] } } finally { kill() }
}
const results = []
for (const url of pages) { const data = await one(url); results.push({ url, ...data }); console.log(url, '|', data.title, '|', data.hits.length ? JSON.stringify(data.hits).slice(0, 1500) : 'clean') }
writeFileSync(join(out, 'scan.json'), JSON.stringify(results, null, 1))
process.exit(0)
