// Views 6 (D6): toolbar + tabs + omnibox and an open app menu at several device scale factors; narrow and short windows.
import { launch, sleep, capture, ROOT } from './orbis-views6-lib.mjs'
const shots = ROOT + 'docs/views6-shots/'
const log = (...a) => console.log(...a)
const cases = [['1.0', '1200,800'], ['1.25', '1200,800'], ['1.5', '1200,800'], ['1.75', '1200,800'], ['2.0', '1200,800'], ['1.0', '500,800'], ['1.0', '1200,400'], ['1.0', '500,400']]
for (const [scale, size] of cases) {
  const tag = `dpi${scale}-${size.replace(',', 'x')}`
  const b = await launch({ name: 'dpi', args: [`--force-device-scale-factor=${scale}`], size, url: 'chrome://orbis-newtab/' })
  try {
    await sleep(2500)
    const key = async (c, ms = 800) => { await b.ui.press(await b.win(), c); await sleep(ms) }
    const w = await b.win(); log(tag, 'window', w.right - w.left, 'x', w.bottom - w.top)
    await b.send('Target.createTarget', { url: 'https://example.invalid/' }); await sleep(1200)
    capture(b.pid, shots + tag + '-main.png')
    await key('alt+f', 1200); const n = (await b.ui.elements()).filter((e) => e.t === 'MenuItem').length; log(tag, 'menu items', n)
    capture(b.pid, shots + tag + '-menu.png'); await b.ui.pressInMenu('escape'); await sleep(400)
    await key('ctrl+shift+y', 1800); capture(b.pid, shots + tag + '-panel.png')
  } catch (e) { log(tag, 'ERR', e.message) } finally { b.kill(); await sleep(800) }
}
