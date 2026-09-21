// Views 6: UIA names/types of the open app menu and profile menu; Ctrl+Enter held 1 s in the omnibox (must navigate once).
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { launch, sleep, ROOT } from './orbis-views6-lib.mjs'
const b = await launch({ name: 'menus', url: 'chrome://orbis-newtab/' })
const log = (...a) => console.log(...a)
const dump = () => { const f = process.env.TEMP + '/uia-menus.json'; execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ROOT}scripts/orbis-uia-dump.ps1" -ProcId ${b.pid} -Out "${f}"`, { timeout: 120000 }); const j = JSON.parse(readFileSync(f, 'utf8')); return Array.isArray(j) ? j : [j] }
try {
  const key = async (c, ms = 700) => { await b.ui.press(await b.win(), c); await sleep(ms) }
  await sleep(2500)
  for (const [tag, open] of [['app menu (Alt+F)', () => key('alt+f', 1200)], ['profile menu (Ctrl+Shift+M)', () => key('ctrl+shift+m', 1500)]]) {
    await key('ctrl+l', 500); await key('escape', 300); await open()
    const d = dump().filter((e) => !e.off && e.w > 0 && ['MenuItem', 'Menu', 'MenuBar', 'Button', 'Edit', 'Group', 'Text'].includes(e.t) && e.d >= 0)
    const items = d.filter((e) => e.t === 'MenuItem'); const bad = items.filter((e) => !e.n.trim())
    log(`## ${tag}: ${items.length} MenuItem, ${bad.length} without name`); log('  ', items.slice(0, 40).map((e) => e.n).join(' | '))
    try { await b.ui.pressInMenu('escape') } catch { await key('escape') }; await sleep(600)
  }
  // Ctrl+Enter held 1 s: navigations
  await key('ctrl+l', 500); await b.ui.type(await b.win(), 'hold test'); await sleep(600)
  const n = await b.ui.hold(await b.win(), 'ctrl+enter', 1000); await sleep(2000)
  log('hold Ctrl+Enter 1s: keydowns', n, 'pages', (await b.pages()).map((t) => t.url))
  // Enter, then Alt+Enter check done elsewhere. 
} catch (e) { log('ERR', e.message) } finally { b.kill() }
