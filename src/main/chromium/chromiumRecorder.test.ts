import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { ChromiumRecorder } from '../workflows/chromiumRecorder.ts'
import { CdpBrowser, type CdpPage } from './cdpPage.ts'
import { ChromiumPages } from './chromiumPages.ts'
import { ExtensionBridge } from './extensionBridge.ts'

const CHROME = process.env.ORBIS_CHROMIUM ?? 'C:/chromium/src/out/Default/chrome.exe'
const EXTENSION = resolve(import.meta.dirname, '../../../extension')
const EXTENSION_ID = 'gcaebckmlhiagfagcplpjmibhkhjljab'
const runReal = existsSync(CHROME) && existsSync(join(EXTENSION, 'adblock'))

test('recording on real Chromium: click, typing, a password (never recorded), Enter, and a new tab', { skip: runReal ? false : 'no Chromium build with the Orbis extension built', timeout: 180_000 }, async (t) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(
      url.pathname === '/'
        ? '<!doctype html><title>Start</title><a id="go" href="/next" onclick="event.preventDefault()">Go on</a><br><input id="who" placeholder="Your name"><br><input id="pw" type="password" placeholder="Password">'
        : `<!doctype html><title>Other ${url.pathname}</title><p>other</p>`
    )
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const port = 9980 + Math.floor(Math.random() * 9)
  const profile = join(tmpdir(), `orbis-recorder-test-${process.pid}`)
  mkdirSync(join(profile, 'Default'), { recursive: true })
  const chrome: ChildProcess = spawn(CHROME, [`--user-data-dir=${profile}`, `--load-extension=${EXTENSION}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
  let browser: CdpBrowser | undefined
  let pages: ChromiumPages | undefined
  t.after(() => {
    pages?.stop()
    browser?.close()
    chrome.kill()
    server.close()
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 2500).unref()
  })
  for (let i = 0; i < 60 && !browser; i++) {
    try {
      browser = await CdpBrowser.connect(port)
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  assert.ok(browser, 'connected')
  const bridge = new ExtensionBridge(browser, EXTENSION_ID)
  pages = new ChromiumPages(browser, bridge)
  await pages.start()
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  const page: CdpPage = await browser.newTab(`${base}/`)
  await wait(1200)

  const recorder = new ChromiumRecorder({ getChromium: async () => ({ browser: browser!, pages: pages!, bridge }), emit: () => undefined })
  recorder.start()
  await wait(2000)

  const click = async (selector: string): Promise<void> => {
    const c = (await page.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)) as { x: number; y: number }
    for (const type of ['mousePressed', 'mouseReleased']) await page.debugger.sendCommand('Input.dispatchMouseEvent', { type, x: c.x, y: c.y, button: 'left', clickCount: 1 })
  }
  await click('#go')
  await wait(300)
  await click('#who')
  await page.insertText('Ada')
  await page.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await page.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await wait(300)
  await click('#pw')
  await page.insertText('hunter2-secret')
  await page.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await page.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await wait(500)
  await browser.newTab(`${base}/second`)
  await wait(2500)

  const result = recorder.stop()
  const steps = result.steps
  const caps = steps.map((s) => s.capability)
  assert.ok(caps.includes('page.click'), JSON.stringify(caps))
  const typed = steps.filter((s) => s.capability === 'page.type')
  assert.ok(typed.some((s) => s.params.text === 'Ada'), 'the name was typed')
  assert.ok(caps.filter((c) => c === 'page.press').length >= 2, 'Enter was pressed')
  assert.ok(typed.some((s) => /^\{\{.+\}\}$/.test(String(s.params.text))), 'the password became a secret reference')
  assert.equal(result.inputs.length, 1)
  assert.equal(result.inputs[0].type, 'secret')
  assert.ok(!JSON.stringify(result).includes('hunter2'), 'the password value is never recorded')
  assert.ok(steps.some((s) => s.capability === 'tabs.create' && String(s.params.url ?? '').endsWith('/second')), JSON.stringify(caps))
})

test('recording on real Chromium: tab group, download, pause/resume and stop cleanup', { skip: runReal ? false : 'no Chromium build with the Orbis extension built', timeout: 180_000 }, async (t) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/file.txt') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="orbis-report.txt"' })
      return void res.end('hello')
    }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<!doctype html><title>Page</title><button id="b">Press</button>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const port = 9970 + Math.floor(Math.random() * 9)
  const profile = join(tmpdir(), `orbis-recorder-test2-${process.pid}`)
  mkdirSync(join(profile, 'Default'), { recursive: true })
  const chrome: ChildProcess = spawn(CHROME, [`--user-data-dir=${profile}`, `--load-extension=${EXTENSION}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
  let browser: CdpBrowser | undefined
  let pages: ChromiumPages | undefined
  t.after(() => {
    pages?.stop()
    browser?.close()
    chrome.kill()
    server.close()
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 2500).unref()
  })
  for (let i = 0; i < 60 && !browser; i++) {
    try {
      browser = await CdpBrowser.connect(port)
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  assert.ok(browser, 'connected')
  const bridge = new ExtensionBridge(browser, EXTENSION_ID)
  pages = new ChromiumPages(browser, bridge)
  await pages.start()
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const page: CdpPage = await browser.newTab(`${base}/`)
  await wait(1200)
  const recorder = new ChromiumRecorder({ getChromium: async () => ({ browser: browser!, pages: pages!, bridge }), emit: () => undefined })
  recorder.start()
  await wait(2000)
  const click = async (): Promise<void> => {
    const c = (await page.executeJavaScript(`(() => { const r = document.querySelector('#b').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)) as { x: number; y: number }
    for (const type of ['mousePressed', 'mouseReleased']) await page.debugger.sendCommand('Input.dispatchMouseEvent', { type, x: c.x, y: c.y, button: 'left', clickCount: 1 })
  }

  // Paused: a click is not recorded; resumed: it is.
  recorder.pause(true)
  await wait(300)
  await click()
  await wait(500)
  const pausedClicks = (recorder as unknown as { state: { steps: { capability: string }[] } }).state.steps.filter((s) => s.capability === 'page.click').length
  assert.equal(pausedClicks, 0, 'nothing recorded while paused')
  recorder.pause(false)
  await wait(300)
  await click()
  await wait(500)

  // A tab group made by the person, and a download.
  const tabId = (await bridge.run<number>('chrome.tabs.query({ active: true }).then((t) => t[0].id)')) as number
  await bridge.run(`chrome.tabs.group({ tabIds: [${tabId}] }).then((g) => chrome.tabGroups.update(g, { title: 'Research', color: 'blue' }))`)
  await page.executeJavaScript(`(() => { const a = document.createElement('a'); a.href = '/file.txt'; document.body.append(a); a.click() })()`)
  await wait(3000)

  const result = recorder.stop()
  const caps = result.steps.map((s) => s.capability)
  assert.ok(caps.includes('page.click'), JSON.stringify(caps))
  assert.ok(result.steps.some((s) => s.capability === 'groups.create' && s.params.color === 'blue'), JSON.stringify(result.steps))
  assert.ok(result.steps.some((s) => s.capability === 'downloads.waitFor' && String(s.params.match) === 'orbis-report.txt'), JSON.stringify(result.steps))

  // Stop cleanup: the capture is off, and a reload does not switch it back on.
  await wait(500)
  assert.notEqual(await page.executeJavaScript('window.__orbisRecorder && window.__orbisRecorder.on'), true, 'capture switched off')
  await page.executeJavaScript('location.reload()')
  await wait(1500)
  assert.equal(await page.executeJavaScript('typeof window.__orbisRecorder'), 'undefined', 'the on-new-document script was removed')
})
