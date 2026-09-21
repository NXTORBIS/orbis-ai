// Views 6: with the panel focused, browser shortcuts work; Ctrl+Shift+Y held 1 s toggles once; per-window panel state.
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { launch, sleep, ROOT } from './orbis-views6-lib.mjs'
const b = await launch({ name: 'panel2', url: 'data:text/html,<title>W1</title>one' })
const log = (...a) => console.log(...a)
try {
  const key = async (c, ms = 1500) => { await b.ui.press(await b.win(), c); await sleep(ms) }
  const s = await b.attach((await b.pages())[0].id)
  const width = () => b.eval(s, 'innerWidth')
  const real = async () => (await b.pages()).filter((t) => !t.url.startsWith('chrome://orbis/')).length
  await key('ctrl+shift+y'); log('open ->', await width())
  await key('ctrl+t', 1200); log('Ctrl+T while panel focused: tabs', await real(), '(2 expected)')
  await key('ctrl+w', 1000)
  const n = await b.ui.hold(await b.win(), 'ctrl+shift+y', 1000); await sleep(1500); log('hold Ctrl+Shift+Y 1s: keydowns', n, 'width', await width(), '(was open: one toggle -> closed = 1186, or repeated toggles would end either way; see count below)')
  await key('ctrl+shift+y'); log('single press after hold ->', await width())
  await key('ctrl+shift+y'); log('single press ->', await width())
  // two windows
  const w1 = await b.win(); const wasOpen = (await width()) < 1000
  await b.ui.press(w1, 'ctrl+n'); await sleep(2500)
  const wins = await b.ui.windows(); log('windows', wins.length)
  const dump = (w) => { const f = process.env.TEMP + `/uia-p2-${w.hwnd}.json`; execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ROOT}scripts/orbis-uia-dump.ps1" -ProcId ${b.pid} -Hwnd ${w.hwnd} -Out "${f}"`, { timeout: 120000 }); const j = JSON.parse(readFileSync(f, 'utf8')); return (Array.isArray(j) ? j : [j]).filter((e) => /Close side panel/.test(e.n) && !e.off).length }
  const front = wins.find((w) => w.foreground), other = wins.find((w) => !w.foreground)
  log('panel open in original window before new window:', wasOpen, '| new(front) window has panel:', dump(front), '| original window has panel:', dump(other))
  await b.ui.press(front, 'ctrl+shift+y'); await sleep(1800); log('after Ctrl+Shift+Y in new window: new', dump(front), 'original', dump(other))
  await b.ui.press(front, 'ctrl+shift+y'); await sleep(1800); log('after 2nd (toggle off): new', dump(front), 'original', dump(other))
} catch (e) { log('ERR', e.message) } finally { b.kill() }
