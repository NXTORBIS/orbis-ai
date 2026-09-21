// Views 6 task 0 (part 2): reload, tab switching, F11, Alt+Enter, key hold, panel toggle per window. Own pid only.
import http from 'node:http'
import { launch, sleep, capture, ROOT } from './orbis-views6-lib.mjs'
const hits = {}
const srv = http.createServer((q, r) => { hits[q.url] = (hits[q.url] || 0) + 1; r.setHeader('content-type', 'text/html'); r.end(`<title>${q.url}</title><body>hit ${hits[q.url]} ${q.url}`) }).listen(0)
const base = `http://127.0.0.1:${srv.address().port}`
const b = await launch({ name: 'keys2', url: base + '/p1' })
const log = (...a) => console.log(...a)
try {
  const key = async (c, ms = 900) => { await b.ui.press(await b.win(), c); await sleep(ms) }
  await sleep(1500)
  // reload
  for (const k of ['f5', 'ctrl+r']) { const h0 = hits['/p1']; await key(k, 1500); log(k, 'hits', h0, '->', hits['/p1']) }
  // tabs
  for (const p of ['/p2', '/p3']) { await b.send('Target.createTarget', { url: base + p }); await sleep(600) }
  const vis = async () => { const out = []; for (const t of await b.pages()) { const s = await b.attach(t.id); out.push(t.url.replace(base, '') + '=' + (await b.eval(s, 'document.visibilityState')) ) } return out.join(' ') }
  log('initial', await vis())
  await key('ctrl+1'); log('ctrl+1', await vis())
  await key('ctrl+tab'); log('ctrl+tab', await vis())
  await key('ctrl+tab'); log('ctrl+tab', await vis())
  await key('ctrl+9'); log('ctrl+9', await vis())
  await key('ctrl+2'); log('ctrl+2', await vis())
  await key('ctrl+shift+tab'); log('ctrl+shift+tab', await vis())
  // F11
  const p1 = (await b.pages())[0]
  const wstate = async () => (await b.send('Browser.getWindowForTarget', { targetId: p1.id })).result.bounds
  log('before F11', JSON.stringify(await wstate()))
  await key('f11', 1500); log('after F11', JSON.stringify(await wstate())); capture(b.pid, ROOT + 'docs/views6-shots/keys-f11.png')
  await key('f11', 1500); log('after 2nd F11', JSON.stringify(await wstate()))
  // Alt+Enter in omnibox
  await key('ctrl+l', 600)
  await b.ui.type(await b.win(), base + '/alt'); await sleep(400)
  const n0 = (await b.pages()).length
  await key('alt+enter', 1500); log('alt+enter tabs', n0, '->', (await b.pages()).length, 'hits /alt', hits['/alt'])
  await key('escape')
  // hold ctrl+t 1s
  const n1 = (await b.pages()).length
  const sent = await b.ui.hold(await b.win(), 'ctrl+t', 1000); await sleep(1500)
  log('hold ctrl+t 1s: keydowns', sent, 'tabs', n1, '->', (await b.pages()).length)
  await b.ui.hold(await b.win(), 'ctrl+w', 600); await sleep(800); log('after hold ctrl+w 0.6s tabs', (await b.pages()).length)
  // panel
  const panels = async () => (await b.list()).filter((t) => t.url.startsWith('chrome://orbis/') || t.url.includes('orbis-panel') || /chrome:\/\/orbis\//.test(t.url))
  log('panels 0', (await panels()).length)
  await key('ctrl+shift+y', 1500); log('panels after 1', (await panels()).map((t) => t.type + t.url))
  await key('ctrl+shift+y', 1500); log('panels after 2 (toggle off)', (await panels()).length)
  await key('ctrl+shift+y', 1500); log('panels after 3', (await panels()).length)
  const sent2 = await b.ui.hold(await b.win(), 'ctrl+shift+y', 1000); await sleep(1500)
  log('hold ctrl+shift+y 1s keydowns', sent2, 'panels', (await panels()).length)
  // per window
  await key('ctrl+n', 2000)
  const wins = await b.ui.windows(); log('windows', wins.map((w) => w.title + (w.foreground ? '*' : '')))
  const panelWin = async () => { const o = []; for (const t of await panels()) { try { o.push(t.type + ':' + (await b.send('Browser.getWindowForTarget', { targetId: t.id })).result?.windowId) } catch { o.push(t.type + ':?') } } return o }
  log('panel targets (windowId)', await panelWin())
  await key('ctrl+shift+y', 1800); log('after toggle in new window', await panelWin())
  const w1 = wins.find((w) => !w.foreground)
  await b.ui.press(w1, 'ctrl+shift+y'); await sleep(1800); log('toggle in other window', await panelWin())
  capture(b.pid, ROOT + 'docs/views6-shots/keys-panel-2win.png')
} catch (e) { log('ERR', e.message) } finally { b.kill(); srv.close() }
