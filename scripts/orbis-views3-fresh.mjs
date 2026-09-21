// Fresh profile, no Orbis extension dir: shows the toolbar and app menu. node --experimental-strip-types scripts/orbis-views3-fresh.mjs <outprefix> [dark|light]
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserUi } from '../src/main/chromium/browserUi.ts'
const [out, scheme = 'dark'] = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const prof = join(process.env.TEMP, 'orbis-v3-fresh'); rmSync(prof, { recursive: true, force: true }); mkdirSync(join(prof, 'Default'), { recursive: true })
writeFileSync(join(prof, 'Default', 'Preferences'), JSON.stringify({ browser: { theme: { color_scheme2: scheme === 'light' ? 1 : 2 } } }))
const child = spawn('C:/chromium/src/out/Default/chrome.exe', [`--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', '--window-position=40,40', '--window-size=1200,760', 'about:blank'], { stdio: 'ignore' })
await sleep(12000)
const cap = (n) => execFileSync('powershell.exe', ['-NoProfile', '-File', 'scripts/orbis-capture.ps1', '-ProcId', String(child.pid), '-Out', `${out}_${n}.png`], { stdio: 'inherit' })
const ui = new BrowserUi(child.pid)
try {
  const win = await ui.pickWindow(); await ui.focus(win)
  cap('toolbar')
  await ui.press(win, 'alt+f'); await sleep(900); cap('appmenu')
  await ui.clickElement(win, /Extension error/, false, 'MenuItem'); await sleep(2500); cap('errdialog')
  console.log((await ui.elements()).map((e) => `${e.t}:${e.n}`).join(' | ').slice(0, 900))
} finally { ui.close(); child.kill() }
