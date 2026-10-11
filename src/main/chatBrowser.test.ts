import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { adblockCommand } from './adblockChat.ts'
import { BrowserControl } from './browserControl/registry.ts'
import { mirrorChromiumInto } from './browserMirror.ts'
import { BrowserLibrary } from './browserLibrary.ts'
import { SearchWatcher, searchQueryOf } from './browserSearches.ts'
import { browserStateFrom, closedBrowserState } from './browserState.ts'

/** A stand-in for the extension's ad blocker: it keeps settings and site exceptions the way the real one does and answers `state()`. */
function fakeBlocker(): { bridge: { run<T>(expression: string): Promise<T> }; calls: string[] } {
  const settings = { enabled: true, level: 'standard', siteExceptions: [] as string[], resourceExceptions: [] as string[] }
  const calls: string[] = []
  const state = (): unknown => ({
    settings,
    active: { ads: settings.enabled, trackers: settings.enabled, annoyances: settings.enabled && settings.level === 'strict', popups: settings.enabled, redirects: settings.enabled },
    ready: true,
    lists: { version: '2026-09-15', rulesets: { ads: { rules: 1000 }, trackers: { rules: 500 } } },
    report: { pageUrl: 'https://news.example/story', siteAllowed: settings.siteExceptions.includes('news.example'), counts: { ads: 3, trackers: 1 }, hidingRules: 2, scriptlets: 0, recent: [{ action: 'blocked', category: 'ads', type: 'script', url: 'https://ads.example/a.js', rule: '||ads.example^' }] }
  })
  return {
    calls,
    bridge: {
      run: async <T>(expression: string): Promise<T> => {
        calls.push(expression)
        const site = /site\("([^"]+)", (true|false)\)/.exec(expression)
        if (site) settings.siteExceptions = site[2] === 'true' ? [...settings.siteExceptions, site[1]] : settings.siteExceptions.filter((h) => h !== site[1])
        const update = /settings\((\{.*\})\)/.exec(expression)
        if (update) Object.assign(settings, JSON.parse(update[1]))
        return state() as T
      }
    }
  }
}

test('chat ad blocking commands act on the extension and report only what it says', async () => {
  const { bridge, calls } = fakeBlocker()
  const allowed = await adblockCommand(bridge, 'allow_site', null, 'https://news.example/story')
  assert.match(allowed, /Added a site exception: nothing is blocked on news\.example now/)
  assert.match(allowed, /Site exceptions: news\.example\./)
  assert.ok(calls.some((c) => c.includes('site("news.example", true)')))

  const blocked = await adblockCommand(bridge, 'block_site', null, 'https://news.example/story')
  assert.match(blocked, /blocked on news\.example again/)
  assert.match(blocked, /Site exceptions: none\./)

  const strict = await adblockCommand(bridge, 'strict', null, undefined)
  assert.match(strict, /Ad blocking is now Strict/)
  assert.match(strict, /Ad blocking: on \(Strict\)/)
  assert.match(strict, /No page is open in the Orbis browser\./)

  const off = await adblockCommand(bridge, 'disable', null, undefined)
  assert.match(off, /Turned ad blocking off everywhere/)

  const report = await adblockCommand(bridge, 'report', null, 'https://news.example/story')
  assert.match(report, /Blocked since it loaded: 3 ads, 1 tracker/)
  assert.match(report, /blocked ad \(script\) https:\/\/ads\.example\/a\.js — rule: \|\|ads\.example\^/)
  assert.match(report, /Filter lists: 1,500 rules, version 2026-09-15/)

  const resource = await adblockCommand(bridge, 'allow_resource', 'ads.example', 'https://news.example/story')
  assert.match(resource, /can't be done from chat/, 'what the browser cannot do from chat is said, not pretended')
})

test("the app's copy of Chromium's history, bookmarks and downloads is read from the browser's capabilities", async () => {
  const control = new BrowserControl()
  const reads: string[] = []
  const register = (id: string, domain: 'history' | 'bookmarks' | 'downloads', rows: unknown[]): void =>
    control.register({ id, domain, name: id, description: id, params: { limit: { type: 'integer', description: 'How many.' } }, mutates: false, confirmation: 'none', run: () => (reads.push(id), rows) })
  register('history.search', 'history', [{ url: 'https://a.example/', title: 'A', visitedAt: 1234.5 }])
  register('bookmarks.list', 'bookmarks', [{ url: 'https://b.example/', title: 'B', addedAt: 5 }])
  register('downloads.list', 'downloads', [{ id: 9, url: 'https://c.example/f.zip', filename: 'f.zip', path: 'C:/f.zip', state: 'completed', receivedBytes: 1, totalBytes: 1, startedAt: 2 }])
  const dir = await mkdtemp(join(tmpdir(), 'orbis-mirror-'))
  const library = new BrowserLibrary(dir)
  await mirrorChromiumInto(library, { control, bridge: { run: async <T>() => undefined as T } })
  const snapshot = library.snapshot()
  await library.flush()
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  assert.deepEqual(snapshot.history, [{ url: 'https://a.example/', title: 'A', visitedAt: 1235 }])
  assert.deepEqual(snapshot.bookmarks.map((b) => b.url), ['https://b.example/'])
  assert.equal(snapshot.downloads[0].id, '9', 'download ids are text')
  assert.deepEqual(reads.sort(), ['bookmarks.list', 'downloads.list', 'history.search'])
})

test("Chromium's tabs become the control layer's browser state, and a closed browser has none", () => {
  const state = browserStateFrom({
    state: {
      tabs: [
        { id: '4', active: false, webContentsId: 11, url: 'https://a.example/', title: 'A' },
        { id: '5', active: true, webContentsId: 12, url: 'https://b.example/', title: 'B' }
      ]
    }
  })
  assert.equal(state.open, true)
  assert.equal(state.activeTabId, '5')
  assert.deepEqual(state.tabs.map((t) => [t.id, t.webContentsId, t.active]), [['4', 11, false], ['5', 12, true]])
  const closed = closedBrowserState()
  assert.equal(closed.open, false)
  assert.deepEqual(closed.tabs, [])
})

test('a search made in the browser is recorded once, never from a private tab, and reopening saved research is not a search', () => {
  const page = (query: string, extra = ''): string => `chrome-extension://gcaebckmlhiagfagcplpjmibhkhjljab/results.html#q=${encodeURIComponent(query)}${extra}`
  assert.equal(searchQueryOf(page('how do tides work')), 'how do tides work')
  assert.equal(searchQueryOf(page('  spaced   out  ')), 'spaced out')
  assert.equal(searchQueryOf(page('tides', '&at=abc123')), null)
  assert.equal(searchQueryOf('https://example.org/results.html#q=nope'), null)
  assert.equal(searchQueryOf('chrome://orbis-search/#q=later'), 'later', 'the built-in page will carry the same words')
  assert.equal(searchQueryOf(page('')), null)

  const watcher = new SearchWatcher()
  // A restored session already shows a search: that is not a new one.
  assert.deepEqual(watcher.next([{ id: '1', url: page('old search') }]), [])
  assert.deepEqual(watcher.next([{ id: '1', url: page('old search') }, { id: '2', url: 'https://example.org/' }]), [])
  assert.deepEqual(watcher.next([{ id: '1', url: page('old search') }, { id: '2', url: page('new search') }]), ['new search'])
  assert.deepEqual(watcher.next([{ id: '1', url: page('old search') }, { id: '2', url: page('new search') }]), [], 'the same tab reported again is not another search')
  assert.deepEqual(watcher.next([{ id: '2', url: page('another one') }]), ['another one'], 'a new search in the same tab is another')
  assert.deepEqual(watcher.next([{ id: '2', url: page('another one') }, { id: '3', url: page('secret'), private: true }]), [], 'a private tab is never recorded')
})
