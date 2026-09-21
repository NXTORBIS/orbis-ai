// Views 6 (D2): keyboard-only traversal of the toolbar with a visible-focus check, app menu, context menu and omnibox popup with Escape/Enter/arrows.
import { execSync } from 'node:child_process'
import { launch, sleep, capture, ROOT } from './orbis-views6-lib.mjs'
const b = await launch({ name: 'kbd', url: 'https://example.invalid/' })
const log = (...a) => console.log(...a)
const focus = () => JSON.parse(execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ROOT}scripts/orbis-uia-focus.ps1" -ProcId ${b.pid}`, { encoding: 'utf8' }).trim())
const shots = ROOT + 'docs/views6-shots/'
try {
  const key = async (c, ms = 500) => { await b.ui.press(await b.win(), c); await sleep(ms) }
  const menuKey = async (c, ms = 500) => { await b.ui.pressInMenu(c); await sleep(ms) }
  await sleep(3000)
  await key('alt+shift+t', 800); log('toolbar focus ->', JSON.stringify(focus()))
  for (let i = 0; i < 14; i++) { await key('tab', 450); const f = focus(); log(`tab ${i + 1}:`, `${f.t}|${f.n}|${f.c}|${f.w}x${f.h}`); if (i === 2 || i === 6 || i === 9) capture(b.pid, shots + `kbd-focus-tab${i + 1}.png`) }
  // menu via keyboard: alt+f then arrows/escape
  await key('escape', 300); await key('ctrl+l', 500); await key('escape', 300)
  await key('alt+f', 1000)
  let els = await b.ui.elements(); log('after alt+f menu items:', els.filter((e) => e.t === 'MenuItem').length)
  if (!els.some((e) => e.t === 'MenuItem')) { await key('alt+e', 1000); els = await b.ui.elements(); log('after alt+e menu items:', els.filter((e) => e.t === 'MenuItem').length) }
  if (els.some((e) => e.t === 'MenuItem')) {
    capture(b.pid, shots + 'kbd-appmenu.png')
    await menuKey('down'); log('menu down ->', JSON.stringify(focus())); await menuKey('down'); log('menu down ->', JSON.stringify(focus()))
    await menuKey('up'); log('menu up ->', JSON.stringify(focus()))
    await menuKey('escape'); await sleep(600); log('menu after Esc items:', (await b.ui.elements()).filter((e) => e.t === 'MenuItem').length)
  }
  // context menu: menu key (apps) on a tab via shift+f10 on focused tab
  await key('ctrl+l', 500); await key('escape', 300)
  await key('f6', 400); log('f6 ->', JSON.stringify(focus()))
  await key('shift+f10', 900); els = await b.ui.elements(); log('shift+f10 menu items:', els.filter((e) => e.t === 'MenuItem').length, els.filter((e) => e.t === 'MenuItem').slice(0, 3).map((e) => e.n))
  if (els.some((e) => e.t === 'MenuItem')) { capture(b.pid, shots + 'kbd-ctx.png'); await menuKey('down'); log('ctx down ->', JSON.stringify(focus())); await menuKey('escape'); await sleep(500); log('ctx after Esc items:', (await b.ui.elements()).filter((e) => e.t === 'MenuItem').length) }
  // omnibox popup
  await key('ctrl+l', 500); await b.ui.type(await b.win(), 'orbis'); await sleep(1500)
  log('omnibox rows:', (await b.ui.suggestions(await b.win())).slice(0, 5))
  await key('down', 400); log('omnibox down ->', JSON.stringify(focus())); capture(b.pid, shots + 'kbd-omnibox.png'); await key('down', 400); await key('up', 400)
  await key('escape', 500); log('omnibox rows after Esc:', (await b.ui.suggestions(await b.win())).length, 'text:', await b.ui.omnibox(await b.win()))
  await key('escape', 500); log('omnibox text after 2nd Esc:', await b.ui.omnibox(await b.win()))
  await key('ctrl+l', 400); await b.ui.type(await b.win(), 'kbd test'); await sleep(800); await key('enter', 1800); log('enter navigated:', (await b.pages()).map((t) => t.url))
} catch (e) { log('ERR', e.message) } finally { b.kill() }
