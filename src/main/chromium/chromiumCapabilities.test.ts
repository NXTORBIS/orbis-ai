import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import type { CommandResult } from '../../shared/browserControl.ts'
import { BrowserControl } from '../browserControl/registry.ts'
import { CdpBrowser } from './cdpPage.ts'
import { registerChromiumCapabilities } from './chromiumCapabilities.ts'
import { ExtensionBridge } from './extensionBridge.ts'

/**
 * The Browser Control Layer's browser capabilities, run through the layer's own `execute` (validation, approval,
 * verification, logging) against a real Chromium with the Orbis extension loaded. Every check reads the effect back from
 * the browser, not from the capability's own answer.
 */

const CHROME = process.env.ORBIS_CHROMIUM ?? 'C:/chromium/src/out/Default/chrome.exe'
const EXTENSION = resolve(import.meta.dirname, '../../../extension')
const EXTENSION_ID = 'gcaebckmlhiagfagcplpjmibhkhjljab'
const runReal = existsSync(CHROME) && existsSync(join(EXTENSION, 'adblock'))

test('Browser Control capabilities act on real Chromium tabs, windows, downloads, history, bookmarks and cookies', { skip: runReal ? false : 'no Chromium build with the Orbis extension built', timeout: 240_000 }, async (t) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/file.txt') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="orbis-test.txt"' })
      return res.end('hello from the test')
    }
    res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'orbis_test=1; Path=/' })
    res.end(`<!doctype html><title>Page ${url.pathname}</title><h1>${url.pathname}</h1>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const port = 9950 + Math.floor(Math.random() * 40)
  const profile = join(tmpdir(), `orbis-caps-test-${process.pid}`)
  const downloads = join(tmpdir(), `orbis-caps-downloads-${process.pid}`)
  mkdirSync(join(profile, 'Default'), { recursive: true })
  mkdirSync(downloads, { recursive: true })
  // Downloads go to a folder of the test's own, never to the person's Downloads folder.
  writeFileSync(join(profile, 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false }, savefile: { default_directory: downloads } }))
  const chrome: ChildProcess = spawn(CHROME, [`--user-data-dir=${profile}`, `--orbis-extension-dir=${EXTENSION}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
  let browser: CdpBrowser | undefined
  t.after(() => {
    browser?.close()
    chrome.kill()
    server.close()
    setTimeout(() => {
      rmSync(profile, { recursive: true, force: true })
      rmSync(downloads, { recursive: true, force: true })
    }, 2500).unref()
  })
  for (let i = 0; i < 60 && !browser; i++) {
    try {
      browser = await CdpBrowser.connect(port)
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  assert.ok(browser, 'connected to the browser')

  const control = new BrowserControl()
  registerChromiumCapabilities({ control, browser, bridge: new ExtensionBridge(browser, EXTENSION_ID) })
  const asked: string[] = []
  const run = async <T = unknown>(capability: string, params: Record<string, unknown> = {}): Promise<CommandResult<T>> =>
    control.execute({ capability, params, source: 'orion' }, { confirm: async (request) => (asked.push(request.action), true) }) as Promise<CommandResult<T>>
  const ok = (r: CommandResult, what: string): void => assert.ok(r.ok && r.verification?.verified !== false, `${what}: ${JSON.stringify(r.error ?? r.verification)}`)
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  type Row = { id: string; url: string; title: string; active: boolean; pinned: boolean; muted: boolean; index: number }
  const tabs = async (): Promise<Row[]> => ((await run<Row[]>('tabs.list')).data ?? []) as Row[]

  let tabId = ''

  await t.test('the capabilities are registered under the ids Orion already uses', () => {
    for (const id of ['tabs.list', 'tabs.create', 'tabs.close', 'tabs.activate', 'tabs.pin', 'tabs.mute', 'tabs.move', 'tabs.reopen', 'navigation.go', 'navigation.back', 'window.list', 'downloads.list', 'history.search', 'bookmarks.add', 'browser.clearCookies']) assert.ok(control.has(id), id)
  })

  await t.test('tabs: open, list, pin, mute, move, duplicate, activate, close, reopen, all real', async () => {
    const created = await run<{ tabId: string }>('tabs.create', { url: `${base}/one` })
    ok(created, 'tabs.create')
    tabId = created.data!.tabId
    await wait(800)
    assert.ok((await tabs()).some((r) => r.id === tabId && r.url.endsWith('/one')), 'the browser has the tab at that address')
    ok(await run('tabs.pin', { tabId, pinned: true }), 'pin')
    assert.equal((await tabs()).find((r) => r.id === tabId)?.pinned, true)
    ok(await run('tabs.mute', { tabId, muted: true }), 'mute')
    assert.equal((await tabs()).find((r) => r.id === tabId)?.muted, true)
    ok(await run('tabs.pin', { tabId, pinned: false }), 'unpin')
    const dup = await run<{ tabId: string }>('tabs.duplicate', { tabId })
    ok(dup, 'duplicate')
    assert.notEqual(dup.data!.tabId, tabId)
    ok(await run('tabs.move', { tabId: dup.data!.tabId, index: 0 }), 'move')
    ok(await run('tabs.activate', { tabId }), 'activate')
    assert.equal((await tabs()).find((r) => r.active)?.id, tabId)
    ok(await run('tabs.close', { tabId: dup.data!.tabId }), 'close')
    assert.ok(!(await tabs()).some((r) => r.id === dup.data!.tabId))
    ok(await run('tabs.close', { tabId }), 'close the original')
    const reopened = await run('tabs.reopen')
    ok(reopened, 'reopen')
    await wait(500)
    assert.ok((await tabs()).some((r) => r.url.endsWith('/one')), 'the closed page is open again')
  })

  await t.test('navigation drives the real page history', async () => {
    const tab = ((await tabs()).find((r) => r.url.endsWith('/one')))!
    await run('tabs.activate', { tabId: tab.id })
    ok(await run('navigation.go', { url: `${base}/two`, tabId: tab.id }), 'go')
    await wait(400)
    ok(await run('navigation.back', { tabId: tab.id }), 'back')
    assert.ok((await tabs()).find((r) => r.id === tab.id)!.url.endsWith('/one'))
    ok(await run('navigation.forward', { tabId: tab.id }), 'forward')
    assert.ok((await tabs()).find((r) => r.id === tab.id)!.url.endsWith('/two'))
    ok(await run('navigation.reload', { tabId: tab.id }), 'reload')
  })

  await t.test('windows: create, list and close a real browser window', async () => {
    const before = ((await run<unknown[]>('window.list')).data ?? []).length
    const created = await run<{ id: number }>('window.create', { url: `${base}/window` })
    ok(created, 'window.create')
    assert.equal(((await run<unknown[]>('window.list')).data ?? []).length, before + 1)
    ok(await run('window.close', { id: created.data!.id }), 'window.close')
    assert.equal(((await run<unknown[]>('window.list')).data ?? []).length, before)
  })

  await t.test('history and bookmarks are Chromium’s own, searched and changed for real', async () => {
    await wait(1200)
    const found = await run<{ url: string }[]>('history.search', { query: '/two' })
    assert.ok((found.data ?? []).some((h) => h.url.endsWith('/two')), 'the page just visited is in the browser history')
    ok(await run('bookmarks.add', { url: `${base}/two`, title: 'Two' }), 'bookmarks.add')
    assert.ok(((await run<{ url: string }[]>('bookmarks.list', { query: 'Two' })).data ?? []).some((b) => b.url.endsWith('/two')))
    ok(await run('bookmarks.remove', { url: `${base}/two` }), 'bookmarks.remove')
    assert.equal(((await run<unknown[]>('bookmarks.list', { query: 'Two' })).data ?? []).length, 0)
    ok(await run('history.delete', { url: `${base}/two` }), 'history.delete')
    const gone = await run<{ url: string }[]>('history.search', { query: '/two' })
    assert.ok(!(gone.data ?? []).some((h) => h.url.endsWith('/two')))
  })

  await t.test('downloads use Chromium’s download system: start, list, wait, clear', async () => {
    const started = await run<{ id: string }>('downloads.start', { url: `${base}/file.txt` })
    ok(started, 'downloads.start')
    const done = await run<{ state: string; filename: string }>('downloads.waitFor', { id: started.data!.id, timeoutMs: 20_000 })
    assert.equal(done.data?.state, 'completed')
    assert.equal(done.data?.filename, 'orbis-test.txt')
    assert.ok(existsSync(join(downloads, 'orbis-test.txt')), 'the file is really on disk')
    ok(await run('downloads.clearFinished'), 'clearFinished')
    assert.equal(((await run<unknown[]>('downloads.list')).data ?? []).length, 0)
  })

  await t.test('cookies: counted and cleared through the browser, with approval asked first', async () => {
    const n = await run<{ count: number }>('browser.cookieCount', { url: base })
    assert.ok((n.data?.count ?? 0) >= 1, 'the site set a cookie')
    ok(await run('browser.clearCookies', { origin: base }), 'clearCookies')
    assert.ok(asked.some((s) => /cookies/i.test(s)), 'the person was asked before cookies were deleted')
    assert.equal((await run<{ count: number }>('browser.cookieCount', { url: base })).data?.count, 0)
  })
})
