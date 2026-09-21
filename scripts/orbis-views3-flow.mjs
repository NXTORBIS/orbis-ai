// Real profile flow via the profile menu in my own browser: Add Orbis profile -> new window, then delete it from chrome://settings? Reports windows at each step.
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserUi } from '../src/main/chromium/browserUi.ts'
const out = process.argv[2]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const prof = join(process.env.TEMP, 'orbis-v3-flow'); rmSync(prof, { recursive: true, force: true }); mkdirSync(join(prof, 'Default'), { recursive: true })
writeFileSync(join(prof, 'Default', 'Preferences'), JSON.stringify({ browser: { theme: { color_scheme2: 2 } } }))
const child = spawn('C:/chromium/src/out/Default/chrome.exe', [`--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', '--window-position=40,40', '--window-size=1200,760', '--remote-debugging-port=9343', '--enable-logging', '--log-file=C:/Users/ksran/AppData/Local/Temp/orbis-flow.log', '--v=1', 'about:blank'], { stdio: 'ignore' })
await sleep(10000)
const cap = (n) => { const o = execFileSync('powershell.exe', ['-NoProfile', '-File', 'scripts/orbis-capture.ps1', '-ProcId', String(child.pid), '-Out', `${out}_${n}.png`, '-Each'], { encoding: 'utf8' }); console.log(o.trim().split(/\r?\n/).join(' ; ')); return [...o.matchAll(/rect w(\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+)/g)].map((m) => ({ L: +m[2], T: +m[3], R: +m[4], B: +m[5] })) }
const ui = new BrowserUi(child.pid)
const profiles = () => { try { const l = JSON.parse(readFileSync(join(prof, 'Local State'), 'utf8')); return Object.entries(l.profile?.info_cache || {}).map(([k, v]) => `${k}:${v.name}`) } catch { return ['(no Local State yet)'] } }
try {
  let win = await ui.pickWindow(); await ui.focus(win)
  await ui.clickElement(win, /^You$|^Profile|Sign in|Guest/i, false, 'Button'); await sleep(900)
  const rects = cap('menu'); console.log((await ui.elements()).slice(-12).map((e) => e.n).join(' | ')); const tl = (await (await fetch('http://127.0.0.1:9343/json/list')).json()); console.log('targets at menu', JSON.stringify(tl.map((x) => x.type + ':' + x.url.slice(0, 70))))
  const menu = rects.find((r) => r.R - r.L > 380 && r.R - r.L < 470 && r.B - r.T > 400); console.log('menu', JSON.stringify(menu)); for (let k = 0; k < 4; k++) { await ui.pressInMenu('down'); await sleep(250) } cap('kbd'); await ui.pressInMenu('enter')
  for (let i = 0; i < 12; i++) { await sleep(700); try { const t = (await (await fetch('http://127.0.0.1:9343/json/list')).json()).map((x) => x.type + ':' + x.url.slice(0, 60)); console.log('t' + i, JSON.stringify(t)) } catch (e) { console.log('t' + i, 'ERR') } }
  console.log('windows', (await ui.windows()).map((w) => w.title))
  cap('after_add'); await sleep(4000)
  console.log('windows2', (await ui.windows()).map((w) => w.title), 'profiles', profiles())
  cap('after_add2')
} catch (e) { console.log('ERR', e.message) } finally { ui.close(); child.kill() }
