import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { browserStateFrom, closedBrowserState, TAB_DETAILS } from './browserState.ts'
import type { TabDetails } from './browserState.ts'
import { openWorkspaceScript } from './browserWorkspace.ts'
import { CdpBrowser } from './chromium/cdpPage.ts'
import { ChromiumPages } from './chromium/chromiumPages.ts'
import { ExtensionBridge } from './chromium/extensionBridge.ts'

test('a saved workspace opens with its pinned pages and groups, and the tab state reads them back', { skip: !existsSync(process.env.ORBIS_CHROMIUM ?? 'C:/chromium/src/out/Default/chrome.exe') || !existsSync(resolve(import.meta.dirname, '../../extension/adblock')) ? 'no Chromium build with the Orbis extension built' : false, timeout: 120_000 }, async (t) => {
  const CHROME = process.env.ORBIS_CHROMIUM ?? 'C:/chromium/src/out/Default/chrome.exe'
  const EXTENSION = resolve(import.meta.dirname, '../../extension')
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(`<!doctype html><title>Page ${req.url}</title><p>${req.url}</p>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const port = 9950 + Math.floor(Math.random() * 30)
  const profile = join(tmpdir(), `orbis-workspace-test-${process.pid}`)
  mkdirSync(profile, { recursive: true })
  const chrome: ChildProcess = spawn(CHROME, [`--user-data-dir=${profile}`, `--orbis-extension-dir=${EXTENSION}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', `${base}/start`], { stdio: 'ignore' })
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
  const pages = new ChromiumPages(browser, bridge)
  await pages.start()

  const tabs = [
    { url: `${base}/one`, pinned: true },
    { url: `${base}/two`, group: 'Research', active: true },
    { url: `${base}/three`, group: 'Research' }
  ]
  const opened = await bridge.run<{ tabIds: string[]; groups: string[] }>(openWorkspaceScript(tabs, [{ name: 'Research', color: '#3fd8ff', collapsed: false }], true))
  assert.equal(opened.tabIds.length, 3)
  assert.deepEqual(opened.groups, ['Research'])

  await new Promise((r) => setTimeout(r, 800))
  await pages.refresh()
  const details = await bridge.run<TabDetails>(TAB_DETAILS)
  const state = browserStateFrom(pages, details)
  assert.equal(state.open, true)
  assert.deepEqual(state.tabs.map((x) => x.url.replace(base, '')).sort(), ['/one', '/three', '/two'], 'the page that was open and not part of the workspace was closed')
  const one = state.tabs.find((x) => x.url.endsWith('/one'))!
  const two = state.tabs.find((x) => x.url.endsWith('/two'))!
  const three = state.tabs.find((x) => x.url.endsWith('/three'))!
  assert.equal(one.pinned, true)
  assert.equal(one.groupId, null)
  assert.ok(two.groupId && two.groupId === three.groupId, 'the two pages share a group')
  assert.equal(two.active, true, "the workspace's active page is in front")
  assert.equal(state.groups.length, 1)
  assert.equal(state.groups[0].name, 'Research')
  assert.equal(state.groups[0].color, '#3fd8ff', 'the group keeps its color')
  assert.deepEqual([...state.groups[0].tabIds].sort(), [two.id, three.id].sort())

  // Opening it again reuses what is open instead of opening everything twice.
  const again = await bridge.run<{ tabIds: string[] }>(openWorkspaceScript(tabs, [{ name: 'Research', color: '#3fd8ff' }], true))
  assert.deepEqual([...again.tabIds].sort(), [...opened.tabIds].sort())
  pages.stop()
  assert.equal(closedBrowserState().open, false)
})
