// Views 6 (D7): two profiles (same user-data-dir, second opened with --profile-directory) and two windows of one profile:
// the profile chip, the Orbis panel and per-profile new tab data must belong to each window's own profile.
import { spawn, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, sleep, capture, ROOT, EXE } from './orbis-views6-lib.mjs'
const shots = ROOT + 'docs/views6-shots/'
const log = (...a) => console.log(...a)
const b = await launch({ name: 'prof', prefs: { profile: { name: 'Home' } }, url: 'chrome://version/' })
try {
  await sleep(2500)
  mkdirSync(join(b.prof, 'Profile 2'), { recursive: true }); writeFileSync(join(b.prof, 'Profile 2', 'Preferences'), JSON.stringify({ profile: { name: 'Work' } }))
  spawn(EXE, [`--user-data-dir=${b.prof}`, '--profile-directory=Profile 2', 'chrome://version/'], { stdio: 'ignore' }).unref()
  let wins = []
  for (let i = 0; i < 40 && wins.length < 2; i++) { await sleep(500); wins = await b.ui.windows() }
  log('windows', wins.map((w) => `${w.hwnd}:${w.title}`))
  const targets = (await b.pages()).filter((t) => t.url.includes('version'))
  for (const t of targets) { const s = await b.attach(t.id); log('profile path in target', await b.eval(s, `document.querySelector('#profile_path')?.innerText || [...document.querySelectorAll('td')].map(x=>x.innerText).find(x=>/Profile|Default/.test(x))`)) }
  await sleep(1500)
  const dumpWin = (w) => { const f = process.env.TEMP + `/uia-prof-${w.hwnd}.json`; execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ROOT}scripts/orbis-uia-dump.ps1" -ProcId ${b.pid} -Hwnd ${w.hwnd} -Out "${f}"`, { timeout: 120000 }); const j = JSON.parse(readFileSync(f, 'utf8')); return Array.isArray(j) ? j : [j] }
  const ctxs = (await b.send('Target.getTargets')).result.targetInfos.filter((t) => t.type === 'page')
  log('page targets', ctxs.map((t) => `${t.url.slice(0, 28)} ctx=${t.browserContextId?.slice(0, 6)} `))
  for (const w of wins) {
    const d = dumpWin(w)
    log('window', w.hwnd, w.title, '| chip:', d.filter((e) => e.c === 'AvatarToolbarButton').map((e) => e.n), '| orb:', d.filter((e) => /^Orbis/.test(e.n) && e.t === 'Button').map((e) => e.n), '| rect', w.left, w.top)
  }
  // panel in one window only
  const w2 = wins.find((w) => w.foreground) ?? wins[0], w1 = wins.find((w) => w.hwnd !== w2.hwnd)
  await b.ui.press(w2, 'ctrl+shift+y'); await sleep(2000)
  const has = (w) => dumpWin(w).filter((e) => /Close side panel/.test(e.n) && !e.off).length
  log('panel controls (Close side panel button): window that got Ctrl+Shift+Y', has(w2), '| other window', has(w1))
  capture(b.pid, shots + 'profiles-2win.png')
  // new tab page per profile: add a shortcut in one profile's NTP localStorage, read from the other
  const ntp = async (dirTitle) => 0
} catch (e) { log('ERR', e.message) } finally { b.kill() }
