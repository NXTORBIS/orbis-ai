import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserLibrary } from './browserLibrary.ts'

async function library(): Promise<{ lib: BrowserLibrary; dir: string; clock: { t: number }; done(): Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-library-'))
  const clock = { t: Date.parse('2026-09-15T10:00:00Z') }
  const lib = new BrowserLibrary(dir, () => clock.t)
  await lib.load()
  return {
    lib,
    dir,
    clock,
    done: async () => {
      await lib.flush()
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  }
}

test('new-tab shortcuts are validated, editable, removable, keep their fetched icon and survive a restart', async () => {
  const { lib, dir, done } = await library()
  try {
    assert.equal(lib.addShortcut('Bad', 'javascript:alert(1)'), null)
    assert.equal(lib.addShortcut('', 'not a site'), null)
    const gh = lib.addShortcut('  GitHub  ', 'github.com')!
    const yt = lib.addShortcut('', 'https://www.youtube.com/feed')!
    assert.deepEqual([gh.name, gh.url, yt.name, yt.url], ['GitHub', 'https://github.com/', 'youtube.com', 'https://www.youtube.com/feed'])
    assert.equal(gh.icon, undefined, 'no icon until it is fetched')

    const png = 'data:image/png;base64,iVBORw0KGgo='
    lib.setShortcutIcon(gh.id, gh.url, png)
    lib.setShortcutIcon(yt.id, yt.url, null)
    lib.setShortcutIcon(yt.id, 'https://stale.example/', png)
    lib.setShortcutIcon(gh.id, gh.url, 'data:text/html;base64,PGgxPg==')
    assert.equal(lib.shortcut(gh.id)?.icon, png, 'an icon that is not an image is ignored')
    assert.equal(lib.shortcut(yt.id)?.icon, null, 'an icon fetched for an old address is ignored')

    const renamed = lib.updateShortcut(gh.id, 'Code', 'github.com')!
    assert.equal(renamed.icon, png, 'renaming keeps the icon')
    const moved = lib.updateShortcut(gh.id, 'Code', 'gitlab.com')!
    assert.equal(moved.icon, undefined, 'a new address drops the old icon')
    assert.equal(lib.updateShortcut(gh.id, 'x', 'ftp://nope'), null)

    lib.removeShortcut(yt.id)
    await lib.flush()
    const again = new BrowserLibrary(dir)
    await again.load()
    assert.deepEqual(again.snapshot().shortcuts.map((s) => [s.name, s.url]), [['Code', 'https://gitlab.com/']])

    for (let i = 0; i < 40; i++) again.addShortcut(`S${i}`, `site${i}.example`)
    assert.equal(again.snapshot().shortcuts.length, 24, 'the page holds at most 24 shortcuts')
  } finally {
    await done()
  }
})

test('address-bar searches are remembered, counted, removable, and cleared with what was learned', async () => {
  const { lib, clock, done } = await library()
  try {
    lib.recordSearch('best AI models')
    clock.t += 1000
    lib.recordSearch('react docs')
    clock.t += 1000
    lib.recordSearch('  Best   AI models ')
    lib.recordSearch('   ')
    assert.deepEqual(lib.snapshot().searches.map((s) => [s.query, s.count]), [['Best AI models', 2], ['react docs', 1]])
    lib.recordPick('q:react docs')
    lib.recordPick('q:react docs')
    lib.recordPick('u:react.dev')
    lib.recordPick('bogus')
    assert.deepEqual(lib.snapshot().picks['q:react docs'], { count: 2, lastAt: clock.t })
    assert.equal(lib.snapshot().picks.bogus, undefined)
    lib.removeSearch('REACT DOCS')
    assert.deepEqual(lib.snapshot().searches.map((s) => s.query), ['Best AI models'])
    assert.equal(lib.snapshot().picks['q:react docs'], undefined)
    lib.clearSearches()
    assert.equal(lib.snapshot().searches.length, 0)
    assert.ok(lib.snapshot().picks['u:react.dev'], 'clearing searches keeps learned pages')
  } finally {
    await done()
  }
})

test("Chromium's history, bookmarks and downloads are mirrored in; what the address bar learned is left alone", async () => {
  const { lib, done } = await library()
  try {
    lib.recordSearch('ai news')
    lib.addShortcut('GitHub', 'github.com')
    let changes = 0
    lib.addListener(() => changes++)
    const lists = {
      history: [
        { url: 'https://a.example/', title: 'A', visitedAt: 2 },
        { url: 'chrome://settings/', title: 'Settings', visitedAt: 1 }
      ],
      bookmarks: [{ url: 'https://b.example/', title: 'B', addedAt: 3 }],
      downloads: [{ id: '7', url: 'https://c.example/f.zip', filename: 'f.zip', path: 'C:/Downloads/f.zip', state: 'completed' as const, receivedBytes: 10, totalBytes: 10, startedAt: 1 }]
    }
    lib.mirrorBrowser(lists)
    const snap = lib.snapshot()
    assert.deepEqual(snap.history.map((h) => h.url), ['https://a.example/'], 'only web pages are kept')
    assert.deepEqual(snap.bookmarks.map((b) => b.url), ['https://b.example/'])
    assert.equal(snap.downloads[0].state, 'completed')
    assert.equal(snap.searches.length, 1)
    assert.equal(snap.shortcuts.length, 1)
    assert.equal(changes, 1)
    lib.mirrorBrowser(lists)
    assert.equal(changes, 1, 'the same lists are not a change')
    assert.equal(lib.isBookmarked('https://b.example/#x'), true)
    lib.mirrorBrowser({ ...lists, bookmarks: [] })
    assert.equal(lib.isBookmarked('https://b.example/'), false, 'a bookmark removed in the browser goes away here')
  } finally {
    await done()
  }
})

test('the library is saved atomically and survives a restart; downloads that were running are marked interrupted', async () => {
  const { lib, dir, done } = await library()
  try {
    lib.mirrorBrowser({
      history: [{ url: 'https://a.example/', title: 'A', visitedAt: 1 }],
      bookmarks: [{ url: 'https://a.example/', title: 'A', addedAt: 1 }],
      downloads: [{ id: 'd1', url: 'https://a.example/f.zip', filename: 'f.zip', path: 'C:/Downloads/f.zip', state: 'progressing', receivedBytes: 10, totalBytes: 100, startedAt: 1 }]
    })
    await lib.flush()
    const reopened = new BrowserLibrary(dir)
    await reopened.load()
    const snap = reopened.snapshot()
    assert.equal(snap.history[0].url, 'https://a.example/')
    assert.equal(snap.bookmarks.length, 1)
    assert.equal(snap.downloads[0].state, 'interrupted')
  } finally {
    await done()
  }
})

test('a damaged library file starts empty instead of breaking the browser', async () => {
  const { dir, done } = await library()
  try {
    await writeFile(join(dir, 'browser-library.json'), '{not json')
    const lib = new BrowserLibrary(dir)
    await lib.load()
    assert.deepEqual(lib.snapshot(), { history: [], bookmarks: [], downloads: [], searches: [], picks: {}, shortcuts: [] })
    lib.recordSearch('a search')
    await lib.flush()
    assert.match(await readFile(join(dir, 'browser-library.json'), 'utf8'), /a search/)
  } finally {
    await done()
  }
})

test('lists an earlier Orbis kept (reading list, saved pages, pictures of pages) are written back as they were', async () => {
  const { dir, done } = await library()
  try {
    const legacy = { readingList: [{ url: 'https://a.example/article', title: 'An article', addedAt: 1 }], savedPages: [{ url: 'https://a.example/', title: 'A', path: 'C:/pages/a.html', at: 1 }], screenshots: [{ id: 'one', path: 'C:/shots/one.png' }] }
    await writeFile(join(dir, 'browser-library.json'), JSON.stringify({ history: [], bookmarks: [], downloads: [], shortcuts: [], ...legacy }))
    const lib = new BrowserLibrary(dir)
    await lib.load()
    lib.recordSearch('something')
    await lib.flush()
    const written = JSON.parse(await readFile(join(dir, 'browser-library.json'), 'utf8')) as Record<string, unknown>
    assert.deepEqual(written.readingList, legacy.readingList)
    assert.deepEqual(written.savedPages, legacy.savedPages)
    assert.deepEqual(written.screenshots, legacy.screenshots)
  } finally {
    await done()
  }
})

test('a flood of new picks does not evict the ones that were actually chosen', async () => {
  // Eviction used to be by last use alone, and the shape test on a pick key bounds what a key may LOOK like rather
  // than which keys exist. So five hundred and one keys nobody was ever offered pushed past the cap and threw away
  // a suggestion somebody had picked dozens of times -- which is a worse outcome than the invented keys themselves,
  // because the real ranking is what the address bar is for.
  const { lib, clock, done } = await library()
  clock.t = 1_000

  // One genuine favourite, chosen often and a long time ago.
  for (let i = 0; i < 40; i++) lib.recordPick('u:example.com')
  clock.t = 90_000

  // Then far more keys than the cap, each chosen once, each more recent.
  for (let i = 0; i < 520; i++) {
    clock.t += 1
    lib.recordPick(`u:invented-${i}.example`)
  }

  const picks = lib.snapshot().picks ?? {}
  assert.ok(picks['u:example.com'], 'the one that was really chosen forty times is still there')
  assert.equal(picks['u:example.com'].count, 40)
  assert.ok(Object.keys(picks).length <= 500, 'and the cap still holds')
  await done()
})
