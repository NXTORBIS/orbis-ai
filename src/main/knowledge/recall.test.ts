import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RecallStore } from './recall.ts'
import { dataDirFor } from '../../shared/profiles.ts'

/**
 * The reading index on disk.
 *
 * These are about the promises the feature makes rather than about SQLite: that switching it off empties it, that a
 * profile's reading is that profile's alone, that it forgets on a schedule, and that a search for a page somebody half
 * remembers actually finds it.
 */

let clock = 1_700_000_000_000
let counter = 0

const bench = async (): Promise<{ store: RecallStore; dir: string; done: () => Promise<void> }> => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-recall-'))
  counter = 0
  const store = new RecallStore(dir, 'one', { now: () => clock, newId: () => `id-${++counter}` })
  store.setSettings({ enabled: true })
  return {
    store,
    dir,
    done: async () => {
      store.close()
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  }
}

const article = (over: Partial<{ url: string; title: string; text: string }> = {}) => ({
  url: 'https://news.example.com/heat-pumps',
  title: 'The heat pump grant explained',
  text: 'Grants for heat pumps closed in March. '.repeat(30),
  ...over
})

// ---------------------------------------------------------------- keeping and finding

test('a page that was read can be found by words from inside it', async () => {
  const { store, done } = await bench()
  assert.deepEqual(store.remember(article()), { kept: true })

  const hits = store.search('heat pump grant')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].url, 'https://news.example.com/heat-pumps')
  assert.match(hits[0].snippet, /heat pumps/i)
  await done()
})

test('a page can be found by its title when the body says nothing useful', async () => {
  const { store, done } = await bench()
  store.remember(article({ title: 'Quarterly nurse staffing review', text: 'lorem ipsum '.repeat(60) }))
  assert.equal(store.search('nurse staffing').length, 1)
  await done()
})

test('a page about a thing outranks a page that merely mentions it', async () => {
  /**
   * The title is weighted well above the body, because somebody looking for a page they half remember is usually
   * remembering its title.
   *
   * Deliberately a fair comparison rather than an extreme one: each page mentions the word once, and the one with it in
   * the title wins. Weighting does not mean a title match beats *any* amount of body text -- a page repeating a word
   * fifty times really is more about it than a passing mention -- and claiming otherwise would be testing a promise the
   * ranking does not make.
   */
  const { store, done } = await bench()
  store.remember({
    url: 'https://a.example.com/1',
    title: 'A sourdough starter, step by step',
    text: `Keeping the culture alive. ${'Ordinary baking notes. '.repeat(40)}`
  })
  store.remember({
    url: 'https://b.example.com/2',
    title: 'Kitchen notes for the week',
    text: `We tried sourdough once. ${'Ordinary baking notes. '.repeat(40)}`
  })
  const hits = store.search('sourdough')
  assert.equal(hits.length, 2)
  assert.match(hits[0].title, /sourdough/i)
  await done()
})

test('a search matching nothing is empty rather than everything', async () => {
  const { store, done } = await bench()
  store.remember(article())
  assert.deepEqual(store.search('quantum chromodynamics'), [])
  assert.deepEqual(store.search('the a of'), [], 'a search with no searchable words asks for nothing')
  await done()
})

test('reading a page again replaces it rather than duplicating it', async () => {
  const { store, done } = await bench()
  store.remember(article({ text: 'firstly the first version of the article '.repeat(20) }))
  clock += 60_000
  store.remember(article({ text: 'the second version of the article '.repeat(20) }))

  assert.equal(store.stats().pages, 1, 'one page, not two')
  const hits = store.search('second version')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].visitedAt, clock, 'and it is the version actually read that is kept')
  /**
   * The replaced text is out of the index too.
   *
   * Searched for a word that appears only in the version that was replaced -- searching "first version" would match on
   * "version", which the new text also contains, and would have passed whether or not the old text was still indexed.
   */
  assert.deepEqual(store.search('firstly'), [])
  await done()
})

test('a fragment is not a different page', async () => {
  const { store, done } = await bench()
  store.remember(article({ url: 'https://news.example.com/heat-pumps#intro' }))
  store.remember(article({ url: 'https://news.example.com/heat-pumps#costs' }))
  assert.equal(store.stats().pages, 1)
  await done()
})

// ---------------------------------------------------------------- what it refuses

test('nothing is kept while it is switched off', async () => {
  const { store, done } = await bench()
  store.setSettings({ enabled: false })
  const answer = store.remember(article())
  assert.equal(answer.kept, false)
  assert.match(String(answer.reason), /off/i)
  assert.equal(store.stats().pages, 0)
  await done()
})

test('switching it off empties it', async () => {
  /**
   * "Stop recording" and "keep everything you already recorded" are different requests, and somebody reaching for the
   * switch almost always means both. Leaving the file behind would make the switch a lie of omission.
   */
  const { store, done } = await bench()
  store.remember(article())
  assert.equal(store.stats().pages, 1)
  store.setSettings({ enabled: false })
  assert.equal(store.stats().pages, 0)
  await done()
})

test('a private tab is never read', async () => {
  const { store, done } = await bench()
  assert.equal(store.remember(article(), { private: true }).kept, false)
  assert.equal(store.stats().pages, 0)
  await done()
})

test('a blocked site is refused, and forgetting a site can block it in one step', async () => {
  const { store, done } = await bench()
  store.remember(article({ url: 'https://news.example.com/a' }))
  store.remember(article({ url: 'https://news.example.com/b' }))
  store.remember(article({ url: 'https://other.example.com/c' }))
  assert.equal(store.stats().pages, 3)

  assert.equal(store.forgetHost('news.example.com', true), 2)
  assert.equal(store.stats().pages, 1)
  // Deleting a site while leaving it free to come straight back would be a button that appears not to work.
  assert.equal(store.remember(article({ url: 'https://news.example.com/d' })).kept, false)
  await done()
})

// ---------------------------------------------------------------- forgetting

test('pages older than the setting allows are dropped on the next write', async () => {
  const { store, done } = await bench()
  store.setSettings({ keepDays: 7 })
  store.remember(article({ url: 'https://a.example.com/old' }))

  clock += 8 * 86_400_000
  store.remember(article({ url: 'https://a.example.com/new' }))

  const urls = store.recent(10).map((p) => p.url)
  assert.deepEqual(urls, ['https://a.example.com/new'])
  await done()
})

test('keeping for ever is allowed, and means it', async () => {
  const { store, done } = await bench()
  store.setSettings({ keepDays: 0 })
  store.remember(article({ url: 'https://a.example.com/old' }))
  clock += 3650 * 86_400_000
  store.remember(article({ url: 'https://a.example.com/new' }))
  assert.equal(store.stats().pages, 2)
  await done()
})

test('the oldest go first when there are too many', async () => {
  const { store, done } = await bench()
  store.setSettings({ maxPages: 100, minChars: 0 })
  for (let i = 0; i < 105; i++) {
    clock += 1000
    store.remember({ url: `https://a.example.com/${i}`, title: `Page ${i}`, text: `body of page ${i} ` })
  }
  const stats = store.stats()
  assert.equal(stats.pages, 100)
  assert.deepEqual(store.search('page 0').filter((p) => p.url === 'https://a.example.com/0'), [], 'the first one is gone')
  assert.equal(store.recent(1)[0].url, 'https://a.example.com/104', 'and the newest is still there')
  await done()
})

test('tightening a limit applies to what is already stored', async () => {
  // Otherwise the new limit takes effect at some later moment nobody can predict.
  const { store, done } = await bench()
  store.setSettings({ maxPages: 200, minChars: 0 })
  for (let i = 0; i < 20; i++) {
    clock += 1000
    store.remember({ url: `https://a.example.com/${i}`, title: `Page ${i}`, text: 'body ' })
  }
  assert.equal(store.stats().pages, 20)
  store.setSettings({ maxPages: 100 })
  assert.equal(store.stats().pages, 20, 'a limit above what is stored changes nothing')
  store.setSettings({ maxPages: 105 })
  assert.equal(store.stats().pages, 20)
  await done()
})

test('a window of time can be forgotten, for "delete the last hour"', async () => {
  const { store, done } = await bench()
  const start = clock
  store.remember(article({ url: 'https://a.example.com/1' }))
  clock += 30 * 60_000
  store.remember(article({ url: 'https://a.example.com/2' }))
  clock += 5 * 3_600_000
  store.remember(article({ url: 'https://a.example.com/3' }))

  assert.equal(store.forgetBetween(start, start + 3_600_000), 2)
  assert.deepEqual(store.recent(10).map((p) => p.url), ['https://a.example.com/3'])
  await done()
})

test('clearing leaves nothing searchable behind', async () => {
  /**
   * The index holds its own copy of the text, so deleting the rows without rebuilding it would leave everything
   * findable -- which is the exact opposite of what "clear" means.
   */
  const { store, done } = await bench()
  store.remember(article())
  assert.equal(store.search('heat pump').length, 1)
  store.clear()
  assert.deepEqual(store.search('heat pump'), [])
  assert.equal(store.stats().pages, 0)
  await done()
})

test('one page can be forgotten without touching the rest', async () => {
  const { store, done } = await bench()
  store.remember(article({ url: 'https://a.example.com/1' }))
  store.remember(article({ url: 'https://a.example.com/2' }))
  const first = store.recent(10).find((p) => p.url === 'https://a.example.com/1')
  assert.ok(first)
  assert.equal(store.forget(first.id), true)
  assert.equal(store.forget(first.id), false, 'forgetting it twice is not an error, it just does nothing')
  assert.deepEqual(store.recent(10).map((p) => p.url), ['https://a.example.com/2'])
  await done()
})

// ---------------------------------------------------------------- one person's reading is their own

test('another profile sees none of it, and it is kept in that profile’s own folder', async () => {
  const { store, dir, done } = await bench()
  store.remember(article())
  assert.equal(store.search('heat pump').length, 1)

  store.useProfile('two')
  store.setSettings({ enabled: true })
  assert.deepEqual(store.search('heat pump'), [], 'the other profile’s reading is not visible here')
  store.remember(article({ url: 'https://b.example.com/x', title: 'Something else', text: 'another topic '.repeat(40) }))

  store.useProfile('one')
  assert.equal(store.search('heat pump').length, 1, 'and the first profile still has its own')
  assert.deepEqual(store.search('another topic'), [])

  store.close()
  assert.ok(existsSync(join(dir, dataDirFor('one'), 'knowledge', 'recall.db')))
  assert.ok(existsSync(join(dir, dataDirFor('two'), 'knowledge', 'recall.db')))
  await done()
})

// ---------------------------------------------------------------- telling somebody what it holds

test('it says plainly what it is holding of yours', async () => {
  const { store, done } = await bench()
  store.remember(article({ url: 'https://news.example.com/a' }))
  clock += 1000
  store.remember(article({ url: 'https://news.example.com/b' }))
  clock += 1000
  store.remember(article({ url: 'https://other.example.com/c' }))

  const stats = store.stats()
  assert.equal(stats.pages, 3)
  assert.ok(stats.chars > 0)
  assert.equal(stats.newestAt, clock)
  assert.deepEqual(stats.topHosts[0], { host: 'news.example.com', pages: 2 })
  await done()
})

test('an empty index reports nothing rather than failing', async () => {
  const { store, done } = await bench()
  const stats = store.stats()
  assert.deepEqual(stats, { pages: 0, chars: 0, oldestAt: null, newestAt: null, topHosts: [] })
  await done()
})

test('a capture pass can tell what it has already read', async () => {
  const { store, done } = await bench()
  assert.equal(store.has('https://news.example.com/heat-pumps'), false)
  store.remember(article())
  assert.equal(store.has('https://news.example.com/heat-pumps'), true)
  assert.equal(store.has('https://news.example.com/heat-pumps#anchor'), true, 'a fragment is the same page')
  assert.equal(store.visitedAt('https://news.example.com/heat-pumps'), clock)
  assert.equal(store.visitedAt('https://never.example.com/'), null)
  await done()
})

test('the whole text comes back only when one page is asked for by name', async () => {
  const { store, done } = await bench()
  store.remember(article())
  const hit = store.search('heat pump')[0]
  const full = store.page(hit.id)
  assert.ok(full)
  assert.match(full.text, /Grants for heat pumps closed in March/)
  assert.equal(store.page('no-such-id'), null)
  await done()
})

test('a search for anything at all cannot reach SQLite as syntax', async () => {
  const { store, done } = await bench()
  store.remember(article())
  // Whatever is typed, it is words. The table is still there afterwards.
  assert.doesNotThrow(() => store.search('heat"; DROP TABLE pages; --'))
  assert.doesNotThrow(() => store.search('NEAR(a b) AND OR * ^ :'))
  assert.equal(store.stats().pages, 1)
  await done()
})
