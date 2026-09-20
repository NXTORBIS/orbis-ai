import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import type { CommandResult } from '../shared/browserControl.ts'
import { BrowserControl } from './browserControl/registry.ts'
import type { WindowControl } from './browserControl/window.ts'
import { registerBrowserExtras } from './browserCapabilities.ts'
import { CdpBrowser } from './chromium/cdpPage.ts'
import { ExtensionBridge } from './chromium/extensionBridge.ts'

const CHROME = process.env.ORBIS_CHROMIUM ?? 'C:/chromium/src/out/Default/chrome.exe'
const EXTENSION = resolve(import.meta.dirname, '../../extension')

test('window and tab conveniences work on real Chromium and check that they happened', { skip: !existsSync(CHROME) || !existsSync(join(EXTENSION, 'adblock')) ? 'no Chromium build with the Orbis extension built' : false, timeout: 120_000 }, async (t) => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(`<!doctype html><title>Doc ${req.url}</title><p>${req.url}</p>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const port = 9920 + Math.floor(Math.random() * 30)
  const profile = join(tmpdir(), `orbis-extras-test-${process.pid}`)
  mkdirSync(profile, { recursive: true })
  const chrome: ChildProcess = spawn(CHROME, [`--user-data-dir=${profile}`, `--load-extension=${EXTENSION}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', `${base}/first`], { stdio: 'ignore' })
  let browser: CdpBrowser | undefined
  t.after(() => {
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
  const bridge = new ExtensionBridge(browser, 'gcaebckmlhiagfagcplpjmibhkhjljab')
  const control = new BrowserControl()
  const windowControl = { state: null as { activeTabId: string | null; previousTabId: string | null } | null }
  registerBrowserExtras({ control, bridge, windowControl: windowControl as unknown as WindowControl })
  const run = (capability: string, params: Record<string, unknown> = {}): Promise<CommandResult> => control.execute({ capability, params, source: 'orion' }, { confirm: async () => true })
  const ok = (r: CommandResult, what: string): void => assert.ok(r.ok && r.verification?.verified !== false, `${what}: ${JSON.stringify(r.error ?? r.verification)}`)
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const open = async (path: string, extra: Record<string, unknown> = {}): Promise<number> => bridge.run<number>(`chrome.tabs.create(${JSON.stringify({ url: `${base}${path}`, active: false, ...extra })}).then((t) => t.id)`)
  const urls = async (): Promise<string[]> => (await bridge.run<string[]>('chrome.tabs.query({}).then((all) => all.map((t) => t.url))')).map((u) => u.replace(base, '')).sort()

  await t.test('windows: maximize, restore, resize, move, fullscreen, minimize and focus', async () => {
    ok(await run('window.restore'), 'restore')
    ok(await run('window.resize', { width: 900, height: 700 }), 'resize')
    ok(await run('window.move', { x: 40, y: 30 }), 'move')
    ok(await run('window.maximize'), 'maximize')
    ok(await run('window.restore'), 'restore again')
    ok(await run('window.fullscreen'), 'fullscreen')
    ok(await run('window.fullscreen', { on: false }), 'leave fullscreen')
    ok(await run('window.minimize'), 'minimize')
    ok(await run('window.focus'), 'focus')
    assert.equal((await run('window.resize', { width: 900 })).ok, false, 'a missing size is refused')
    assert.equal((await run('window.focus', { id: 999999 })).error?.code, 'not-found')
  })

  await t.test('tabs: switch and close by what the page says, close the right-hand and the other tabs', async () => {
    await open('/alpha')
    await open('/beta')
    await open('/gamma', { pinned: true })
    await wait(900)
    assert.equal((await run('tabs.activateMatching', { urlContains: 'a' })).error?.code, 'invalid-params', 'several matches ask which')
    ok(await run('tabs.activateMatching', { urlContains: 'beta' }), 'activate by url')
    const activeId = String(await bridge.run<number>('chrome.tabs.query({ active: true, currentWindow: true }).then((all) => all[0].id)'))
    windowControl.state = { activeTabId: activeId, previousTabId: null }
    ok(await run('tabs.closeMatching', { titleContains: 'alpha' }), 'close by title')
    assert.ok(!(await urls()).includes('/alpha'))
    assert.equal((await run('tabs.closeMatching', { urlContains: 'nothing-like-this' })).error?.code, 'not-found')
    await open('/delta')
    await open('/epsilon')
    await wait(900)
    ok(await run('tabs.closeRight', { tabId: activeId }), 'close right')
    assert.ok(!(await urls()).some((u) => u === '/delta' || u === '/epsilon'), 'the tabs to the right are gone')
    assert.ok((await urls()).includes('/gamma'), 'a pinned tab is never closed')
    ok(await run('tabs.closeOthers', { tabId: activeId }), 'close others')
    assert.deepEqual(await urls(), ['/beta', '/gamma'], 'only this tab and the pinned tab remain')
  })

  await t.test('going back to the previous tab uses the tab that was active before', async () => {
    const first = await bridge.run<number>('chrome.tabs.query({ pinned: true }).then((all) => all[0].id)')
    windowControl.state = { activeTabId: 'x', previousTabId: String(first) }
    ok(await run('tabs.activatePrevious'), 'previous')
    assert.equal(await bridge.run<boolean>(`chrome.tabs.get(${first}).then((t) => t.active)`), true)
    windowControl.state = { activeTabId: 'x', previousTabId: '999999' }
    assert.equal((await run('tabs.activatePrevious')).error?.code, 'not-found')
  })
})
