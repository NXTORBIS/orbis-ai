import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserLibrary, uniqueDownloadName } from './browserLibrary.ts'

async function library(): Promise<{ lib: BrowserLibrary; dir: string; clock: { t: number }; done(): Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-library-'))
  const clock = { t: Date.parse('2026-09-15T10:00:00Z') }
  const lib = new BrowserLibrary(dir, () => clock.t)
  await lib.load()
  return { lib, dir, clock, done: () => rm(dir, { recursive: true, force: true }) }
}

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
    lib.visit('https://www.google.com/search?q=react+docs', 'react docs - Google Search')
    lib.visit('https://react.dev/', 'React')
    lib.recordPick('q:react docs')
    lib.recordPick('q:react docs')
    lib.recordPick('u:react.dev')
    lib.recordPick('bogus')
    assert.deepEqual(lib.snapshot().picks['q:react docs'], { count: 2, lastAt: clock.t })
    assert.equal(lib.snapshot().picks.bogus, undefined)
    lib.removeSearch('REACT DOCS')
    assert.deepEqual(lib.snapshot().searches.map((s) => s.query), ['Best AI models'])
    assert.deepEqual(lib.snapshot().history.map((h) => h.url), ['https://react.dev/'], 'its results page leaves history too')
    assert.equal(lib.snapshot().picks['q:react docs'], undefined)
    lib.clearSearches()
    assert.equal(lib.snapshot().searches.length, 0)
    assert.ok(lib.snapshot().picks['u:react.dev'], 'clearing searches keeps learned pages')
    lib.clearHistory()
    assert.deepEqual(lib.snapshot().picks, {})
  } finally {
    await done()
  }
})

test('history records real pages, merges quick revisits and keeps the newest first', async () => {
  const { lib, clock, done } = await library()
  try {
    lib.visit('https://a.example/one', 'One')
    clock.t += 60_000
    lib.visit('https://b.example/', 'B')
    clock.t += 60_000
    lib.visit('https://a.example/one#section', '')
    lib.visit('about:blank')
    lib.visit('chrome-error://chromewebdata/')
    const history = lib.snapshot().history
    assert.deepEqual(history.map((h) => h.url), ['https://a.example/one', 'https://b.example/'])
    assert.equal(history[0].title, 'One', 'a revisit without a title keeps the known title')
    clock.t += 2 * 60 * 60_000
    lib.visit('https://a.example/one', 'One again')
    assert.equal(lib.snapshot().history.length, 3, 'a visit hours later is a new entry')
    lib.retitle('https://b.example/', 'B page')
    assert.equal(lib.snapshot().history.find((h) => h.url === 'https://b.example/')?.title, 'B page')
    lib.removeHistory('https://a.example/one')
    assert.deepEqual(lib.snapshot().history.map((h) => h.url), ['https://b.example/'])
    lib.clearHistory()
    assert.equal(lib.snapshot().history.length, 0)
  } finally {
    await done()
  }
})

test('bookmarks toggle, ignore duplicates and non-web pages, and bookmark all tabs', async () => {
  const { lib, done } = await library()
  try {
    assert.equal(lib.toggleBookmark('https://a.example/', 'A'), true)
    assert.equal(lib.isBookmarked('https://a.example/#x'), true)
    assert.equal(lib.addBookmarks([{ url: 'https://a.example/', title: 'A' }, { url: 'https://b.example/', title: '' }, { url: 'about:blank', title: 'Blank' }]), 1)
    assert.deepEqual(lib.snapshot().bookmarks.map((b) => [b.url, b.title]), [['https://b.example/', 'https://b.example/'], ['https://a.example/', 'A']])
    assert.equal(lib.toggleBookmark('https://a.example/', 'A'), false)
    assert.equal(lib.isBookmarked('https://a.example/'), false)
  } finally {
    await done()
  }
})

test('the library is saved atomically and survives a restart; interrupted downloads are marked so', async () => {
  const { lib, dir, done } = await library()
  try {
    lib.visit('https://a.example/', 'A')
    lib.toggleBookmark('https://a.example/', 'A')
    lib.rememberPermission('https://meet.example', 'media', 'allow')
    lib.upsertDownload({ id: 'd1', url: 'https://a.example/f.zip', filename: 'f.zip', path: 'C:/Downloads/f.zip', state: 'progressing', receivedBytes: 10, totalBytes: 100, startedAt: 1 })
    await lib.flush()
    const reopened = new BrowserLibrary(dir)
    await reopened.load()
    const snap = reopened.snapshot()
    assert.equal(snap.history[0].url, 'https://a.example/')
    assert.equal(snap.bookmarks.length, 1)
    assert.equal(reopened.permission('https://meet.example', 'media'), 'allow')
    assert.equal(snap.downloads[0].state, 'interrupted')
    reopened.forgetPermissions('https://meet.example')
    assert.equal(reopened.permission('https://meet.example', 'media'), undefined)
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
    assert.deepEqual(lib.snapshot(), { history: [], bookmarks: [], downloads: [], permissions: {}, searches: [], picks: {} })
    lib.visit('https://a.example/', 'A')
    await lib.flush()
    assert.match(await readFile(join(dir, 'browser-library.json'), 'utf8'), /a\.example/)
  } finally {
    await done()
  }
})

test('downloads never overwrite an existing file and get safe names', () => {
  const taken = new Set(['report.pdf', 'report (1).pdf'])
  assert.equal(uniqueDownloadName('report.pdf', (n) => taken.has(n)), 'report (2).pdf')
  assert.equal(uniqueDownloadName('new.pdf', (n) => taken.has(n)), 'new.pdf')
  assert.equal(uniqueDownloadName('../../evil:name?.exe', () => false), 'evil_name_.exe')
  assert.equal(uniqueDownloadName('', () => false), 'download')
})
