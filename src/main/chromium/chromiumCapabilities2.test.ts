import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import type { CommandResult } from '../../shared/browserControl.ts'
import { BrowserControl } from '../browserControl/registry.ts'
import { CdpBrowser } from './cdpPage.ts'
import { registerChromiumCapabilities } from './chromiumCapabilities.ts'
import { nearestGroupColor, registerMoreChromiumCapabilities, ZOOM_STEPS } from './chromiumCapabilities2.ts'
import { ExtensionBridge } from './extensionBridge.ts'

test('tab group colours map to the nearest Chromium colour, and zoom steps are the ones Chromium uses', () => {
  assert.equal(nearestGroupColor('#34d399'), 'green')
  assert.equal(nearestGroupColor('red'), 'red')
  assert.equal(nearestGroupColor('#ff0000'), 'red')
  assert.equal(nearestGroupColor('nonsense'), 'grey')
  assert.ok(ZOOM_STEPS.includes(1) && ZOOM_STEPS.includes(1.25))
})

const CHROME = process.env.ORBIS_CHROMIUM ?? 'C:/chromium/src/out/Default/chrome.exe'
const EXTENSION = resolve(import.meta.dirname, '../../../extension')
const EXTENSION_ID = 'gcaebckmlhiagfagcplpjmibhkhjljab'
const runReal = existsSync(CHROME) && existsSync(join(EXTENSION, 'adblock'))

test('tab groups, zoom, save and print, extensions, reading list and download controls on real Chromium', { skip: runReal ? false : 'no Chromium build with the Orbis extension built', timeout: 240_000 }, async (t) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/slow.bin') {
      // A download that takes a while, so it can be paused and cancelled while it is really running.
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="slow.bin"', 'Content-Length': String(64 * 1024 * 8) })
      let sent = 0
      const timer = setInterval(() => {
        if (sent >= 8 || res.destroyed) {
          clearInterval(timer)
          return res.end()
        }
        res.write(Buffer.alloc(64 * 1024, 1))
        sent++
      }, 400)
      res.on('close', () => clearInterval(timer))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(`<!doctype html><title>Doc ${url.pathname}</title><h1>Hello ${url.pathname}</h1><p>Some text for the printed page.</p>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const port = 9990 + Math.floor(Math.random() * 9)
  const profile = join(tmpdir(), `orbis-caps2-test-${process.pid}`)
  const out = join(tmpdir(), `orbis-caps2-out-${process.pid}`)
  mkdirSync(join(profile, 'Default'), { recursive: true })
  mkdirSync(out, { recursive: true })
  writeFileSync(join(profile, 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: out, prompt_for_download: false } }))
  const chrome: ChildProcess = spawn(CHROME, [`--user-data-dir=${profile}`, `--load-extension=${EXTENSION}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
  let browser: CdpBrowser | undefined
  t.after(() => {
    browser?.close()
    chrome.kill()
    server.close()
    setTimeout(() => {
      rmSync(profile, { recursive: true, force: true })
      rmSync(out, { recursive: true, force: true })
    }, 2500).unref()
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
  const control = new BrowserControl()
  registerChromiumCapabilities({ control, browser, bridge })
  registerMoreChromiumCapabilities({ control, browser, bridge, saveDir: out, selfExtensionId: EXTENSION_ID })
  const run = async <T = unknown>(capability: string, params: Record<string, unknown> = {}): Promise<CommandResult<T>> => control.execute({ capability, params, source: 'orion' }, { confirm: async () => true }) as Promise<CommandResult<T>>
  const ok = (r: CommandResult, what: string): void => assert.ok(r.ok && r.verification?.verified !== false, `${what}: ${JSON.stringify(r.error ?? r.verification)}`)
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  type Tab = { id: string; url: string; groupId: number }
  const tabs = async (): Promise<Tab[]> => ((await run<Tab[]>('tabs.list')).data ?? []) as Tab[]

  const a = (await run<{ tabId: string }>('tabs.create', { url: `${base}/a` })).data!.tabId
  const b = (await run<{ tabId: string }>('tabs.create', { url: `${base}/b` })).data!.tabId
  await wait(1200)

  await t.test('tab groups: create, rename, collapse, add, remove and ungroup, all in the real tab model', async () => {
    const g = await run<{ groupId: string }>('groups.create', { tabIds: [a], name: 'Research', color: '#34d399' })
    ok(g, 'create')
    const gid = g.data!.groupId
    const listed = (await run<{ id: string; name: string; color: string; tabIds: string[] }[]>('groups.list')).data!
    assert.deepEqual(listed.find((x) => x.id === gid), { id: gid, name: 'Research', color: 'green', collapsed: false, tabIds: [a] })
    ok(await run('groups.addTab', { groupId: gid, tabId: b }), 'addTab')
    ok(await run('groups.rename', { groupId: gid, name: 'Papers' }), 'rename')
    ok(await run('groups.collapse', { groupId: gid, collapsed: true }), 'collapse')
    ok(await run('groups.collapse', { groupId: gid, collapsed: false }), 'expand')
    ok(await run('groups.removeTab', { tabId: b }), 'removeTab')
    assert.equal((await tabs()).find((x) => x.id === b)!.groupId, -1)
    ok(await run('groups.delete', { groupId: gid }), 'ungroup')
    assert.ok(((await run<{ id: string }[]>('groups.list')).data ?? []).every((x) => x.id !== gid), 'the group is gone')
    assert.ok((await tabs()).some((x) => x.id === a), 'its tab is still open')
  })

  await t.test('zoom changes the real browser zoom of the page', async () => {
    ok(await run('tabs.activate', { tabId: a }), 'activate')
    ok(await run('zoom.set', { factor: 1.25 }), 'set')
    ok(await run('zoom.set', { action: 'in' }), 'in')
    ok(await run('zoom.set', { action: 'reset' }), 'reset')
  })

  await t.test('the page is printed to PDF and saved as MHTML by the browser, and its source opened', async () => {
    ok(await run('tabs.activate', { tabId: a }), 'activate')
    const pdf = await run<{ path: string }>('devtools.printToPdf', { fileName: 'printed' })
    ok(pdf, 'printToPdf')
    assert.ok(existsSync(pdf.data!.path))
    const mhtml = await run<{ path: string }>('devtools.savePage')
    ok(mhtml, 'savePage')
    assert.ok(existsSync(mhtml.data!.path))
    ok(await run('devtools.viewSource'), 'viewSource')
  })

  await t.test('extensions come from the browser and Orbis protects itself; recently closed comes from the session history', async () => {
    const exts = (await run<{ id: string; name: string; enabled: boolean }[]>('extensions.list')).data ?? []
    assert.ok(exts.some((e) => e.id === EXTENSION_ID), 'the Orbis extension is listed')
    const refused = await run('extensions.setEnabled', { id: EXTENSION_ID, enabled: false })
    assert.equal(refused.ok, false, 'it cannot turn itself off')
    await run('tabs.close', { tabId: b })
    await wait(600)
    const closed = (await run<{ kind: string; url?: string }[]>('tabs.recentlyClosed')).data ?? []
    assert.ok(closed.some((c) => c.kind === 'tab' && c.url?.endsWith('/b')), 'the closed tab is in the session history')
  })

  await t.test('the reading list is the browser’s own', async () => {
    ok(await run('bookmarks.readingListAdd', { url: `${base}/read-me`, title: 'Read me' }), 'add')
    assert.ok(((await run<{ url: string }[]>('bookmarks.readingList')).data ?? []).some((e) => e.url.endsWith('/read-me')))
    ok(await run('bookmarks.readingListRemove', { url: `${base}/read-me` }), 'remove')
  })

  await t.test('a running download can be paused, resumed and cancelled', async () => {
    const started = await run<{ id: string }>('downloads.start', { url: `${base}/slow.bin` })
    assert.ok(started.data?.id, JSON.stringify(started))
    const id = started.data!.id
    await wait(600)
    ok(await run('downloads.pause', { id }), 'pause')
    ok(await run('downloads.resume', { id }), 'resume')
    ok(await run('downloads.cancel', { id }), 'cancel')
    assert.equal(readdirSync(out).filter((f) => f === 'slow.bin').length, 0, 'a cancelled download leaves no finished file')
  })
})
