import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { CdpBrowser, keyInfo, modifierMask } from './cdpPage.ts'
import { ChromiumImage, decodePng, encodePng, scaleRaster } from './png.ts'
import * as page from '../browserControl/page.ts'
import { asPageHandle, PAGE_HANDLE_METHODS } from '../pageHandle.ts'

// ---------------------------------------------------------------- what needs no browser

test('PNG images round-trip and shrink to what Orion compares', () => {
  const w = 8
  const h = 6
  const bgra = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) bgra.set([10 + i, 20, 30, 255], i * 4)
  const decoded = decodePng(encodePng({ width: w, height: h, bgra }))
  assert.deepEqual([decoded.width, decoded.height], [w, h])
  assert.ok(decoded.bgra.equals(bgra), 'no pixel changed')
  const small = scaleRaster(decoded, 4, 3)
  assert.equal(small.bgra.length, 4 * 3 * 4)
  const image = ChromiumImage.fromRaster(decoded)
  assert.deepEqual(image.resize({ width: 4 }).getSize(), { width: 4, height: 3 }, 'height follows the width')
  assert.equal(image.resize({ width: 2, height: 2 }).toBitmap().length, 16)
  assert.match(image.toDataURL(), /^data:image\/png;base64,/)
})

test('key names the control layer uses map to real key events', () => {
  assert.deepEqual(keyInfo('Enter'), { key: 'Enter', code: 'Enter', vk: 13 })
  assert.equal(keyInfo('Down').key, 'ArrowDown')
  assert.deepEqual(keyInfo('a'), { key: 'a', code: 'KeyA', vk: 65 })
  assert.equal(modifierMask(['shift', 'control']), 10)
})

// ---------------------------------------------------------------- against real Chromium

const CHROME = process.env.ORBIS_CHROMIUM ?? 'C:/chromium/src/out/Default/chrome.exe'
const runReal = existsSync(CHROME)

const SHOP = `<!doctype html><html><head><title>Shop</title></head><body>
<h1>Orbis test shop</h1>
<form action="/results" method="get"><label for="q">Search products</label><input id="q" name="q" type="text"><button type="submit">Find</button></form>
<a id="more" href="/more">More products</a>
<div id="late"></div>
<script>setTimeout(function(){ document.getElementById('late').innerHTML = '<button id="added">Added later</button>' }, 300)</script>
</body></html>`

test('the real Browser Control Layer drives a real Chromium tab', { skip: runReal ? false : 'no Chromium build at ' + CHROME, timeout: 120_000 }, async (t) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    res.writeHead(200, { 'Content-Type': 'text/html' })
    if (url.pathname === '/results') res.end(`<!doctype html><title>Results for ${url.searchParams.get('q')}</title><h1>Results</h1><p id="r">${url.searchParams.get('q')}</p>`)
    else if (url.pathname === '/more') res.end('<!doctype html><title>More</title><h1>More products</h1>')
    else res.end(SHOP)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const port = 9840 + Math.floor(Math.random() * 100)
  const profile = join(tmpdir(), `orbis-cdp-test-${process.pid}`)
  const chrome: ChildProcess = spawn(CHROME, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
  let browser: CdpBrowser | undefined
  t.after(() => {
    browser?.close()
    chrome.kill()
    server.close()
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 2000).unref()
  })

  for (let i = 0; i < 60 && !browser; i++) {
    try {
      browser = await CdpBrowser.connect(port)
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  assert.ok(browser, 'the browser accepted the connection')

  await t.test('it is a real tab that answers the whole PageHandle contract', async () => {
    const tab = await browser!.newTab('about:blank')
    const wc = asPageHandle(tab)
    for (const name of PAGE_HANDLE_METHODS) assert.equal(typeof (tab as unknown as Record<string, unknown>)[name], 'function', `${name} exists`)
    await wc.loadURL(`${base}/`)
    assert.equal(wc.getURL(), `${base}/`)
    assert.equal(wc.getTitle(), 'Shop')
    assert.equal(wc.isLoading(), false)
    assert.equal(wc.isDestroyed(), false)
  })

  await t.test('the layer reads the page the way it does today, including what appears after load', async () => {
    const wc = asPageHandle(browser!.list().find((p) => p.getURL().startsWith(base))!)
    await page.settle(wc)
    await new Promise((r) => setTimeout(r, 600))
    const snap = await page.snapshot(wc)
    assert.equal(snap.title, 'Shop')
    assert.match(snap.text, /Orbis test shop/)
    const names = JSON.stringify(snap.elements)
    assert.match(names, /Find/, 'the button is found: ' + names)
    assert.match(names, /Added later/, 'the button added by a script after load is found too: ' + names)
  })

  await t.test('real mouse and keyboard input really submit the form and navigate', async () => {
    const wc = asPageHandle(browser!.list().find((p) => p.getURL().startsWith(base))!)
    const found = await page.locate(wc, { label: 'Search products' })
    assert.ok(!('error' in found), JSON.stringify(found))
    page.mouseClick(wc, found.target.x, found.target.y)
    await new Promise((r) => setTimeout(r, 200))
    await wc.insertText('blue chair')
    assert.equal(await wc.executeJavaScript("document.getElementById('q').value"), 'blue chair', 'the text really went into the field')
    await page.pressNamedKey(wc, 'Enter')
    for (let i = 0; i < 40 && !wc.getURL().includes('/results'); i++) await new Promise((r) => setTimeout(r, 100))
    assert.match(wc.getURL(), /\/results\?q=blue\+chair/)
    assert.match(wc.getTitle(), /Results for blue chair/)
  })

  await t.test('history, screenshots and the accessibility tree work on the real page', async () => {
    const wc = asPageHandle(browser!.list().find((p) => p.getURL().includes('/results'))!)
    await page.settle(wc)
    assert.equal(wc.navigationHistory.canGoBack(), true)
    const image = await wc.capturePage()
    assert.equal(image.isEmpty(), false)
    assert.equal(image.resize({ width: 24, height: 24 }).toBitmap().length, 24 * 24 * 4)
    const tree = await page.accessibilityTree(wc)
    assert.ok(tree.some((n) => /Results/.test(n.name)), 'the accessibility tree names the heading')
    wc.navigationHistory.goBack()
    for (let i = 0; i < 40 && wc.getURL().includes('/results'); i++) await new Promise((r) => setTimeout(r, 100))
    assert.equal(wc.getTitle(), 'Shop')
    assert.equal(wc.navigationHistory.canGoForward(), true)
  })

  await t.test('closing a tab is seen, and nothing acts on a closed tab', async () => {
    const tab = browser!.list().find((p) => p.getURL().startsWith(base))!
    await browser!.closeTab(tab)
    for (let i = 0; i < 40 && !tab.isDestroyed(); i++) await new Promise((r) => setTimeout(r, 100))
    assert.equal(tab.isDestroyed(), true)
    await assert.rejects(() => tab.executeJavaScript('1'), /closed/)
  })
})
