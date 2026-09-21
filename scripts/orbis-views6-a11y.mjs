// Views 6 (D1): UI Automation dump of the browser UI in several states; reports controls without a Name / with a wrong ControlType.
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { launch, sleep, capture, ROOT } from './orbis-views6-lib.mjs'
const b = await launch({ name: 'a11y', url: 'https://example.invalid/' })
const log = (...a) => console.log(...a)
const dump = (tag) => { const f = process.env.TEMP + `/uia-${tag}.json`; execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ROOT}scripts/orbis-uia-dump.ps1" -ProcId ${b.pid} -Out "${f}"`, { timeout: 120000 }); let j = JSON.parse(readFileSync(f, 'utf8')); if (!Array.isArray(j)) j = [j]; return j }
const INTERACTIVE = new Set(['Button', 'TabItem', 'MenuItem', 'SplitButton', 'CheckBox', 'ListItem', 'Edit', 'ComboBox', 'Hyperlink', 'RadioButton', 'MenuBar', 'Tab', 'ToolBar', 'Menu'])
const all = {}
try {
  const key = async (c, ms = 900) => { await b.ui.press(await b.win(), c); await sleep(ms) }
  await sleep(2500)
  await b.send('Target.createTarget', { url: 'chrome://orbis-newtab/' }); await sleep(1200)
  await key('ctrl+shift+y', 2000)
  all.main = dump('main')
  await key('ctrl+shift+y', 1200)
  // app menu via alt+f
  await key('alt+f', 1200); all.appmenu = dump('appmenu'); capture(b.pid, ROOT + 'docs/views6-shots/a11y-appmenu.png'); await b.ui.pressInMenu('escape'); await sleep(500)
  // omnibox popup
  await key('ctrl+l', 600); await b.ui.type(await b.win(), 'orb'); await sleep(1500); all.omnibox = dump('omnibox'); capture(b.pid, ROOT + 'docs/views6-shots/a11y-omnibox.png'); await key('escape'); await key('escape')
  // tab context menu (right click on a tab)
  const w = await b.win(); try { await b.ui.clickElement(w, /New Tab|New tab/, true, 'TabItem'); await sleep(900); all.ctx = dump('ctx'); capture(b.pid, ROOT + 'docs/views6-shots/a11y-tabctx.png'); await b.ui.pressInMenu('escape') } catch (e) { log('ctx', e.message) }
  await sleep(400)
  // profile chip menu
  await key('ctrl+shift+m', 1200); all.profile = dump('profile'); await b.ui.pressInMenu('escape')
} catch (e) { log('ERR', e.message) } finally { b.kill() }
const bad = []
for (const [state, els] of Object.entries(all)) {
  log(`== ${state}: ${els.length} elements`)
  for (const e of els) {
    if (e.off || e.w <= 0) continue
    if (INTERACTIVE.has(e.t) && !e.n) bad.push(`${state}: EMPTY NAME ${e.t} class=${e.c} id=${e.id} at ${e.x},${e.y} ${e.w}x${e.h} focusable=${e.kf}`)
    else if (e.kf && !e.n && e.t !== 'Document' && e.t !== 'Pane' && e.t !== 'Window') bad.push(`${state}: focusable no name ${e.t} class=${e.c} at ${e.x},${e.y}`)
  }
}
writeFileSync(process.env.TEMP + '/uia-all.json', JSON.stringify(all))
log('VIOLATIONS', bad.length); for (const x of bad) log(x)
for (const s of ['main', 'appmenu', 'omnibox', 'ctx', 'profile']) { log(`-- ${s}`); for (const e of all[s] ?? []) if (!e.off && e.w > 0 && INTERACTIVE.has(e.t)) log(`  ${e.t.padEnd(10)} | ${e.n.slice(0, 50).padEnd(50)} | ${e.c} | help=${(e.help || '').slice(0, 30)}`) }
