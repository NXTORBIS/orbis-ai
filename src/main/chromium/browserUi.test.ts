import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import type { CommandResult } from '../../shared/browserControl.ts'
import { BrowserUi, parseChord } from './browserUi.ts'
import { startChromiumControl } from './service.ts'

/**
 * Real-browser test of the address bar and developer-tools capabilities: real OS key input to the window of the Chromium THIS test
 * started (found by its process id). Serial: it needs the foreground, so it retries when another program takes focus.
 */

const CHROME = process.env.ORBIS_CHROMIUM ?? 'C:/chromium/src/out/Default/chrome.exe'
const EXTENSION = resolve(import.meta.dirname, '../../../extension')
const runReal = process.platform === 'win32' && existsSync(CHROME) && existsSync(join(EXTENSION, 'adblock'))

test('parseChord maps names to virtual keys', () => {
  assert.deepEqual(parseChord('ctrl+shift+i'), [0x11, 0x10, 0x49])
  assert.deepEqual(parseChord('f12'), [0x7b])
  assert.throws(() => parseChord('ctrl+nonsense'))
})

test('the address bar and developer tools, driven by real key input', { skip: runReal ? false : 'needs Windows and a Chromium build with the Orbis extension', timeout: 240_000 }, async (t) => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(`<!doctype html><title>UI test ${req.url}</title><h1 id="big">Hello ${req.url}</h1>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const port = 9900 + Math.floor(Math.random() * 100)
  const profile = join(tmpdir(), `orbis-ui-test-${process.pid}`)
  const child = spawn(CHROME, [`--user-data-dir=${profile}`, `--orbis-extension-dir=${EXTENSION}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', `${base}/start`], { stdio: 'ignore' })
  child.on('exit', (code, sig) => { if (process.env.ORBIS_UI_DEBUG) console.error('[chrome exit]', code, sig) })
  const service = await startChromiumControl({ port, extensionId: 'gcaebckmlhiagfagcplpjmibhkhjljab', pid: child.pid, waitMs: 60_000 })
  t.after(() => {
    service.stop()
    child.kill()
    server.closeAllConnections()
    server.close()
    setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }) } catch { /* still in use */ } }, 2500).unref()
  })
  const run = async <T = unknown>(capability: string, params: Record<string, unknown> = {}): Promise<CommandResult<T>> => {
    // Another program can take the foreground: retry a few times, but only for that reason.
    let r: CommandResult<T>
    for (let i = 0; i < 4; i++) {
      r = (await service.control.execute({ capability, params, source: 'orion' }, { confirm: async () => true })) as CommandResult<T>
      if (r.ok || !/focus-refused/.test(JSON.stringify(r.error))) break
      await new Promise((res) => setTimeout(res, 1500))
    }
    return r!
  }
  const waitUrl = async (pred: (u: string) => boolean): Promise<string> => {
    for (let i = 0; i < 60; i++) {
      const tab = (await run<{ active: boolean; url: string }[]>('tabs.list')).data?.find((x) => x.active)
      if (tab && pred(tab.url)) return tab.url
      await new Promise((r) => setTimeout(r, 200))
    }
    return (await run<{ active: boolean; url: string }[]>('tabs.list')).data?.find((x) => x.active)?.url ?? ''
  }
  await waitUrl((u) => u.includes('/start'))
  for (let i = 0; i < 60; i++) {
    const tab = (await run<{ active: boolean; title: string }[]>('tabs.list')).data?.find((x) => x.active)
    if (tab?.title === 'UI test /start') break
    await new Promise((r) => setTimeout(r, 250))
  }

  await t.test('only this process\'s windows are found', async () => {
    const ui = new BrowserUi(child.pid!)
    const wins = await ui.windows()
    ui.close()
    assert.ok(wins.length >= 1)
    assert.ok(wins.some((w) => w.title.includes('UI test /start')), JSON.stringify(wins))
    const other = new BrowserUi(999999)
    assert.equal((await other.windows()).length, 0)
    other.close()
  })

  await t.test('devtools opens and closes', async () => {
    const opened = await run('devtools.open')
    assert.ok(opened.ok && opened.verification?.verified, JSON.stringify(opened))
    const closed = await run('devtools.close')
    assert.ok(closed.ok && closed.verification?.verified, JSON.stringify(closed))
  })

  await t.test('devtools.inspect selects the element in the Elements panel', async () => {
    const r = await run('devtools.inspect', { selector: '#big' })
    assert.ok(r.ok, JSON.stringify(r))
    assert.equal(r.verification?.verified, true, JSON.stringify(r.verification))
    await run('devtools.close')
  })

  await t.test('addressBar.type and read', async () => {
    const urlBefore = (await run<{ active: boolean; url: string }[]>('tabs.list')).data!.find((x) => x.active)!.url
    const typed = await run('addressBar.type', { text: 'typed but not sent' })
    assert.ok(typed.ok && typed.verification?.verified, JSON.stringify(typed))
    const read = await run<{ text: string }>('addressBar.read')
    assert.equal(read.data?.text, 'typed but not sent')
    const tab = (await run<{ active: boolean; url: string }[]>('tabs.list')).data?.find((x) => x.active)
    assert.equal(tab!.url, urlBefore, 'nothing was submitted')
  })

  await t.test('addressBar.suggestions lists rows for what was typed', async () => {
    await run('addressBar.type', { text: 'tides' })
    await new Promise((r) => setTimeout(r, 1200))
    const s = await run<{ suggestions: string[] }>('addressBar.suggestions')
    assert.ok(s.ok, JSON.stringify(s))
    assert.ok(s.data!.suggestions.length > 0, JSON.stringify(s.data))
  })

  await t.test('addressBar.clear empties it', async () => {
    const r = await run('addressBar.clear')
    assert.ok(r.ok && r.verification?.verified, JSON.stringify(r))
  })

  await t.test('addressBar.submit with a URL goes to the page', async () => {
    const r = await run('addressBar.submit', { text: `${base}/typed-url` })
    assert.ok(r.ok && r.verification?.verified, JSON.stringify(r))
    const url = await waitUrl((u) => u.includes('/typed-url'))
    assert.match(url, /\/typed-url/)
    const title = (await run<{ active: boolean; title: string }[]>('tabs.list')).data?.find((x) => x.active)?.title
    assert.match(String(title), /UI test \/typed-url/)
  })

  await t.test('addressBar.submit with words is a search, decided by the browser', async () => {
    const r = await run('addressBar.submit', { text: 'how do tides work' })
    assert.ok(r.ok && r.verification?.verified, JSON.stringify(r))
    const url = await waitUrl((u) => !u.includes('/typed-url'))
    assert.doesNotMatch(url, /^http:\/\/127\.0\.0\.1/)
    assert.match(decodeURIComponent(url).replace(/\+/g, ' '), /how do tides work/)
  })

  await t.test('browser.shortcut opens a new tab', async () => {
    const before = (await run<unknown[]>('tabs.list')).data!.length
    const r = await run('browser.shortcut', { name: 'new-tab' })
    assert.ok(r.ok, JSON.stringify(r))
    for (let i = 0; i < 25 && (await run<unknown[]>('tabs.list')).data!.length === before; i++) await new Promise((res) => setTimeout(res, 200))
    assert.equal((await run<unknown[]>('tabs.list')).data!.length, before + 1)
  })
})
