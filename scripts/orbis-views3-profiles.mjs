// Real profile-picker flow in my own spawned browser: click Add, watch targets/screens. node scripts/orbis-views3-profiles.mjs <out>
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
const out = process.argv[2]; mkdirSync(out, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const prof = join(process.env.TEMP, 'orbis-v3-prof'); rmSync(prof, { recursive: true, force: true }); mkdirSync(join(prof, 'Default'), { recursive: true })
writeFileSync(join(prof, 'Default', 'Preferences'), JSON.stringify({ browser: { theme: { color_scheme2: 2 } } }))
const child = spawn('C:/chromium/src/out/Default/chrome.exe', [`--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9342', '--window-position=40,40', '--window-size=1200,800', 'chrome://profile-picker'], { stdio: 'ignore' })
await sleep(7000)
const v = await (await fetch('http://127.0.0.1:9342/json/version')).json()
const ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r))
let id = 0; const pend = new Map()
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.method==='Runtime.exceptionThrown') console.log('EXC', JSON.stringify(d.params.exceptionDetails).slice(0,600)); if (d.method==='Runtime.consoleAPICalled'&&d.params.type==='error') console.log('CERR', JSON.stringify(d.params.args).slice(0,500)); if (d.method==='Log.entryAdded') console.log('LOG', JSON.stringify(d.params.entry).slice(0,400)); if (d.id && pend.has(d.id)) pend.get(d.id)(d) }
const send = (method, params = {}, sessionId) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })) })
const list = async () => (await send('Target.getTargets')).result.targetInfos.filter((t) => t.type === 'page').map((t) => t.url)
const shot = async (t, name) => { const r = await send('Page.captureScreenshot', { format: 'png' }, t); writeFileSync(join(out, name), Buffer.from(r.result.data, 'base64')) }
const attach = async (match) => { const t = (await send('Target.getTargets')).result.targetInfos.find((x) => x.type === 'page' && x.url.includes(match)); if (!t) return null; return (await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).result.sessionId }
const ev = async (s, e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, s)).result?.result?.value
try {
  console.log('pages0', await list())
  const ct=(await send('Target.createTarget',{url:'about:blank'})).result.targetId; const cs=(await send('Target.attachToTarget',{targetId:ct,flatten:true})).result.sessionId; await send('Page.navigate',{url:'chrome://profile-picker'},cs); await sleep(3000); console.log('after create', await list()); const s = cs
  const deep = `(function(){const q=(r,sel)=>{const f=r.querySelector(sel);if(f)return f;for(const e of r.querySelectorAll('*')){if(e.shadowRoot){const x=q(e.shadowRoot,sel);if(x)return x}}return null};window.__q=q;return true})()`
  await ev(s, deep)
  console.log('click add', await ev(s, `(()=>{const b=window.__q(document,'#addProfile');if(!b)return 'nobtn';b.click();return 'clicked'})()`))
  await sleep(5000); await shot(s, 'pp_after_add.png'); console.log('pages1', await list())
  console.log('flags', await ev(s, `JSON.stringify(['isProfileCreationAllowed','isBrowserSigninAllowed','signInProfileCreationFlowSupported','isForceSigninEnabled'].map(k=>[k,loadTimeData.getValue(k)]))`)); console.log('theme', await ev(s, `new Promise(r=>{const id='t'+Date.now();const h=(e)=>{};const orig=window.cr&&window.cr.webUIResponse;window.addEventListener('message',()=>{});let done=false;const old=window.webUIResponse;window.cr=window.cr||{};const prev=window.cr.webUIResponse;window.cr.webUIResponse=function(cid,ok,v){if(cid===id){done=true;r('resp '+ok+' '+JSON.stringify(v).slice(0,100))}else if(prev)prev.apply(this,arguments)};chrome.send('getNewProfileSuggestedThemeInfo',[id]);setTimeout(()=>{if(!done)r('TIMEOUT')},4000)})`));
console.log('dom', await ev(s, `(()=>{const app=document.querySelector('profile-picker-app');const vm=app.shadowRoot.querySelector('cr-view-manager');return JSON.stringify([...vm.children].map(c=>[c.id||c.tagName,c.className,getComputedStyle(c).display,getComputedStyle(c).opacity]))+' route='+app.currentRoute_+' mode='+app.appMode_})()`)); console.log('defs', await ev(s, `JSON.stringify(['profile-type-choice','profile-switch','local-profile-customization','profile-card','profile-picker-main-view'].map(n=>[n,!!customElements.get(n)]))+' scripts='+[...document.querySelectorAll('script')].map(x=>x.src).join(',')`)); console.log('ltd', await ev(s, `import('chrome://resources/js/load_time_data.js').then(m=>JSON.stringify(['isProfileCreationAllowed','isBrowserSigninAllowed','signInProfileCreationFlowSupported','isForceSigninEnabled','isGuestModeEnabled'].map(k=>[k,m.loadTimeData.getValue(k)])),e=>'ERR '+e)`)); console.log('vis', await ev(s,'document.visibilityState')); console.log('route', await ev(s,'location.href'))
} finally { ws.close(); child.kill() }
