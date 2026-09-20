import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import type { CommandResult } from '../../shared/browserControl.ts'
import { startChromiumControl, type ChromiumControl } from './service.ts'

/**
 * The whole Chromium control service, started the way the app starts it, then used the way Orion uses it: the page capabilities and
 * the browser capabilities through the one control layer, the agent's target and tab following, all on real Chromium.
 */

const CHROME = process.env.ORBIS_CHROMIUM ?? 'C:/chromium/src/out/Default/chrome.exe'
const EXTENSION = resolve(import.meta.dirname, '../../../extension')
const EXTENSION_ID = 'gcaebckmlhiagfagcplpjmibhkhjljab'
const runReal = existsSync(CHROME) && existsSync(join(EXTENSION, 'adblock'))

test('the Chromium control service serves Orion: page and browser capabilities on one layer, following the real tabs', { skip: runReal ? false : 'no Chromium build with the Orbis extension built', timeout: 240_000 }, async (t) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    res.writeHead(200, { 'Content-Type': 'text/html' })
    if (url.pathname === '/results') res.end(`<!doctype html><title>Results</title><h1>Results for ${url.searchParams.get('q')}</h1>`)
    else res.end('<!doctype html><title>Shop</title><h1>Orbis shop</h1><form action="/results"><label>Search<input name="q" type="text"></label><button type="submit">Go</button></form>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const port = 9900 + Math.floor(Math.random() * 40)
  const profile = join(tmpdir(), `orbis-service-test-${process.pid}`)
  const chrome: ChildProcess = spawn(CHROME, [`--user-data-dir=${profile}`, `--load-extension=${EXTENSION}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
  let service: ChromiumControl | undefined
  t.after(() => {
    service?.stop()
    chrome.kill()
    server.close()
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 2500).unref()
  })

  service = await startChromiumControl({ port, extensionId: EXTENSION_ID, waitMs: 60_000 })
  const { control } = service
  const run = async <T = unknown>(capability: string, params: Record<string, unknown> = {}): Promise<CommandResult<T>> => control.execute({ capability, params, source: 'orion' }, { confirm: async () => true }) as Promise<CommandResult<T>>
  const ok = (r: CommandResult, what: string): void => assert.ok(r.ok && r.verification?.verified !== false, `${what}: ${JSON.stringify(r.error ?? r.verification)}`)
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  await t.test('one layer holds the browser, page and CAPTCHA capabilities', () => {
    for (const id of ['tabs.create', 'groups.create', 'downloads.pause', 'page.read', 'page.click', 'page.type', 'page.screenshot', 'window.list']) assert.ok(control.has(id), id)
    assert.ok(control.list({ domain: 'captcha' }).length > 0, 'the CAPTCHA capabilities are there too')
  })

  await t.test('the agent’s target is the real active tab, and it follows the person to a new one', async () => {
    const first = await service!.agent.getTarget()
    assert.ok(!first.isDestroyed())
    const opened = await run<{ tabId: string }>('tabs.create', { url: `${base}/` })
    ok(opened, 'tabs.create')
    await wait(1500)
    const now = await service!.agent.getTarget()
    assert.match(now.getURL(), new RegExp(base.replace(/[.:/]/g, '\\$&')), 'the agent moved to the tab that is now active')
    assert.equal(service!.agent.findPage(now.id)?.id, now.id)
    assert.ok(service!.agent.windowControl.state.tabs.some((tab) => tab.active && tab.webContentsId === now.id))
  })

  await t.test('Orion reads and drives the page through the layer: read, type, submit, and the browser really navigates', async () => {
    const read = await run<{ text?: string }>('page.read')
    ok(read, 'page.read')
    assert.match(JSON.stringify(read.data), /Orbis shop/)
    const found = await run<{ ref: number }>('page.find', { locator: { label: 'Search' } })
    assert.ok(found.ok, JSON.stringify(found.error))
    ok(await run('page.type', { locator: { label: 'Search' }, text: 'blue chair' }), 'page.type')
    ok(await run('page.press', { key: 'Enter' }), 'page.press')
    for (let i = 0; i < 40; i++) {
      const tab = (await run<{ url: string; active: boolean }[]>('tabs.list')).data?.find((x) => x.active)
      if (tab?.url.includes('/results')) break
      await wait(150)
    }
    const after = await run<{ text?: string }>('page.read')
    assert.match(JSON.stringify(after.data), /Results for blue chair/)
    const shot = await run<{ dataUrl?: string }>('page.screenshot', { maxWidth: 400 })
    ok(shot, 'page.screenshot')
    assert.match(String((shot.data as { dataUrl?: string })?.dataUrl), /^data:image\/png;base64,/)
  })

  await t.test('closing the tab under Orion is reported, not hidden', async () => {
    const tab = (await run<{ id: string; active: boolean }[]>('tabs.list')).data!.find((x) => x.active)!
    ok(await run('tabs.close', { tabId: tab.id }), 'close')
    await wait(500)
    const read = await run('page.read', { tabId: tab.id })
    assert.equal(read.ok, false, 'a closed tab cannot be read')
  })
})
