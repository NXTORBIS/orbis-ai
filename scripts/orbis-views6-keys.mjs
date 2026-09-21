// Views 6 task 0: keyboard behaviour observed with real OS input on our own pid.
import { launch, sleep, capture, ROOT } from './orbis-views6-lib.mjs'
const shots = ROOT + 'docs/views6-shots/'
const log = (...a) => console.log(...a)
const b = await launch({ name: 'keys', url: 'data:text/html,<title>PAGE-A</title><script>window.n=0;document.title="A0";</script>' })
try {
  const w = await b.win()
  const key = async (c) => { await b.ui.press(await b.win(), c); await sleep(900) }
  const st = async () => (await b.pages()).map((t) => `${t.id.slice(0, 4)}|${t.url.slice(0, 40)}|${t.title.slice(0, 20)}`)
  log('start', await st())
  // page counter: local http page would be better; use a data url that increments a counter in sessionStorage-like title
  const page = (await b.pages())[0]
  // Ctrl+T
  const before = (await b.pages()).length
  await key('ctrl+t')
  const after = await b.pages()
  log('ctrl+t count', before, '->', after.length, after.map((t) => t.url))
  const nt = after.find((t) => !t.url.startsWith('data:'))
  const s = await b.attach(nt.id)
  await sleep(1500)
  log('NTP eval', await b.eval(s, 'JSON.stringify({title:document.title,href:location.href,vis:document.visibilityState,body:document.body.innerText.slice(0,120),hist:history.length})'))
  capture(b.pid, shots + 'keys-ctrlT-ntp.png')
  const nav = await b.send('Page.getNavigationHistory', {}, s); log('nav history', JSON.stringify(nav.result?.entries?.map((e) => [e.url, e.userTypedURL])))
  // close NTP, then reopen page tab test
  await key('ctrl+w'); log('after ctrl+w', await st())
  // Ctrl+Shift+T on real page: navigate a real tab to a page, close, reopen
  const r = await b.send('Target.createTarget', { url: 'data:text/html,<title>REAL-B</title>b' }); await sleep(800)
  log('created', (await b.pages()).length)
  await b.send('Target.activateTarget', { targetId: r.result.targetId }); await sleep(500)
  await key('ctrl+w'); log('closed B', (await b.pages()).map((t) => t.title))
  await key('ctrl+shift+t'); log('after ctrl+shift+t', (await b.pages()).map((t) => t.title + '|' + t.url.slice(0, 30)))
} finally { b.kill() }
