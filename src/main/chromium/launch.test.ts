import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import type { CommandResult } from '../../shared/browserControl.ts'
import { launchOrbisChromium } from './service.ts'

/** Orbis starts its own browser as a child process and controls it over a pipe: no debugging port is opened. */

const CHROME = process.env.ORBIS_CHROMIUM ?? 'C:/chromium/src/out/Default/chrome.exe'
const EXTENSION = resolve(import.meta.dirname, '../../../extension')
const runReal = existsSync(CHROME) && existsSync(join(EXTENSION, 'adblock'))

test('Orbis starts Chromium itself and controls it over a pipe, with no debugging port', { skip: runReal ? false : 'no Chromium build with the Orbis extension built', timeout: 180_000 }, async (t) => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<!doctype html><title>Pipe test</title><h1>Reached over the pipe</h1>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const profile = join(tmpdir(), `orbis-pipe-test-${process.pid}`)
  let closed = false
  const service = await launchOrbisChromium({ chrome: CHROME, profileDir: profile, extensionId: 'gcaebckmlhiagfagcplpjmibhkhjljab', urls: ['about:blank'], waitMs: 60_000, onClosed: () => (closed = true) })
  t.after(() => {
    service.stop()
    server.close()
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 2500).unref()
  })
  const run = async <T = unknown>(capability: string, params: Record<string, unknown> = {}): Promise<CommandResult<T>> => service.control.execute({ capability, params, source: 'orion' }, { confirm: async () => true }) as Promise<CommandResult<T>>

  await t.test('the browser was started with a pipe, and no debugging port', () => {
    const line = execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${service.process.pid}").CommandLine`], { encoding: 'utf8' })
    assert.match(line, /--remote-debugging-pipe/)
    assert.doesNotMatch(line, /--remote-debugging-port/)
  })

  await t.test('the control layer works over the pipe: open a tab, read the page, list the tabs', async () => {
    const created = await run<{ tabId: string }>('tabs.create', { url: `${base}/` })
    assert.ok(created.ok && created.verification?.verified !== false, JSON.stringify(created.error ?? created.verification))
    for (let i = 0; i < 40; i++) {
      const tab = (await run<{ active: boolean; title: string }[]>('tabs.list')).data?.find((x) => x.active)
      if (tab?.title === 'Pipe test') break
      await new Promise((r) => setTimeout(r, 150))
    }
    const read = await run('page.read')
    assert.ok(read.ok, JSON.stringify(read.error))
    assert.match(JSON.stringify(read.data), /Reached over the pipe/)
  })

  await t.test('closing the browser is noticed', async () => {
    service.stop()
    await Promise.race([service.exited, new Promise((r) => setTimeout(r, 20_000))])
    assert.equal(closed, true, 'onClosed was called when the browser exited')
  })
})
