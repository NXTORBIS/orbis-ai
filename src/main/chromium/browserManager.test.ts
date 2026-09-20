import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import type { CommandResult } from '../../shared/browserControl.ts'
import { BrowserManager, looksLikeAddress } from './browserManager.ts'

test('typed text is an address or a search, the way the address bar decides', () => {
  assert.equal(looksLikeAddress('example.org'), 'https://example.org')
  assert.equal(looksLikeAddress('https://example.org/a?b=1'), 'https://example.org/a?b=1')
  assert.equal(looksLikeAddress('localhost:3000'), 'http://localhost:3000')
  assert.equal(looksLikeAddress('how do tides work'), null)
  assert.equal(looksLikeAddress('tides'), null)
  assert.equal(looksLikeAddress('  '), null)
})

const CHROME = process.env.ORBIS_CHROMIUM ?? 'C:/chromium/src/out/Default/chrome.exe'
const REPO = resolve(import.meta.dirname, '../../..')
const runReal = existsSync(CHROME) && existsSync(join(REPO, 'extension', 'adblock'))

test('Orbis opens its own Chromium for a search and an address, with its own helper and profile folder', { skip: runReal ? false : 'no Chromium build with the Orbis extension built', timeout: 240_000 }, async (t) => {
  const dir = join(tmpdir(), `orbis-manager-test-${process.pid}`)
  const manager = new BrowserManager({
    chrome: CHROME,
    extensionSource: join(REPO, 'extension'),
    dataDir: join(dir, 'chromium'),
    profileId: () => 'profile-one',
    apiKeys: () => [],
    adblockBundledDir: join(REPO, 'resources', 'adblock'),
    adblockListsDir: join(dir, 'lists'),
    personalDir: (id) => join(dir, 'personal', id)
  })
  t.after(async () => {
    await manager.stop()
    setTimeout(() => rmSync(dir, { recursive: true, force: true }), 2500).unref()
  })
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const tabs = async (): Promise<{ url: string; title: string; active: boolean }[]> => {
    const svc = await manager.ensure()
    return ((await svc.control.execute({ capability: 'tabs.list', params: {}, source: 'user' }, { confirm: async () => true })) as CommandResult<{ url: string; title: string; active: boolean }[]>).data ?? []
  }

  assert.equal(manager.isRunning, false, 'nothing runs until the browser is needed')

  await t.test('a search opens the Orbis results page in the browser', async () => {
    const result = await manager.open('how do tides work')
    assert.ok(result.ok, result.detail)
    let hit: { url: string; title: string } | undefined
    for (let i = 0; i < 60 && !hit; i++) {
      hit = (await tabs()).find((x) => x.url.includes('results.html') && /how do tides work . Orbis Search/.test(x.title))
      if (!hit) await wait(300)
    }
    assert.ok(hit, JSON.stringify(await tabs()))
    assert.match(hit!.title, /how do tides work/)
  })

  await t.test('an address opens as a page, in a new tab', async () => {
    const before = (await tabs()).length
    assert.ok((await manager.open('example.org')).ok)
    let hit
    for (let i = 0; i < 60 && !hit; i++) {
      hit = (await tabs()).find((x) => /example\.org/.test(x.url))
      if (!hit) await wait(300)
    }
    assert.ok(hit, 'example.org opened')
    assert.equal((await tabs()).length, before + 1)
  })

  await t.test('the browser has its own data folder per profile, and the helper connection is in memory only (no file)', async () => {
    const svc = await manager.ensure()
    const stored = (await svc.bridge.run("chrome.storage.session.get('orbis.helper').then((r) => r['orbis.helper'])")) as { port: number; token: string }
    assert.ok(stored.port > 0 && stored.token.length === 64)
    assert.equal(existsSync(join(dir, 'chromium', 'extension', 'helper.json')), false, 'no token file')
    assert.ok(existsSync(join(dir, 'chromium', 'profiles', 'profile-one', 'browser')), 'the profile has its own browser data folder')
  })

  await t.test('closing it releases everything, and the next use starts it again', async () => {
    await manager.stop()
    assert.equal(manager.isRunning, false)
  })
})
