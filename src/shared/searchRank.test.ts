import test from 'node:test'
import assert from 'node:assert/strict'
import { looksOfficial, rankResults, rankedResults, subjectWords } from './searchRank.ts'
import { normalizeResult } from './searchModules.ts'
import { understand } from './searchIntent.ts'
import { PLACES_NOTE, coordsFrom, readPlace } from './searchLocal.ts'
import type { NormalizedResult } from './searchModules.ts'

const at = (url: string, title: string, publishedAt?: number): NormalizedResult =>
  normalizeResult({ url, title, publishedAt }, 'web', 'test', 0)!

const order = (results: NormalizedResult[], query: string, now?: number): string[] =>
  rankedResults(results, understand(query), now).map((r) => r.domain)

// ---------------------------------------------------------------- how-to ranking (§47)

test('the words that identify the subject are kept, and the asking is dropped', () => {
  assert.deepEqual(subjectWords('how to install python'), ['python'])
  assert.deepEqual(subjectWords('how do i fix a leaking tap'), ['leaking', 'tap'])
})

test('a domain belonging to the thing asked about is recognised without a list of projects', () => {
  assert.equal(looksOfficial('python.org', ['python']), true)
  assert.equal(looksOfficial('www.rust-lang.org', ['rust']), true)
  assert.equal(looksOfficial('sometutorialsite.com', ['python']), false)
})

test('a how-to leads with the project’s own instructions', () => {
  const results = [
    at('https://tutorialsite.com/python', 'Install Python the easy way'),
    at('https://python.org/downloads', 'Download Python'),
    at('https://anotherblog.com/py', 'Python install guide')
  ]
  assert.equal(order(results, 'how to install python')[0], 'python.org')
})

test('documentation is preferred for a technical question', () => {
  const results = [
    at('https://randomblog.com/post', 'asyncio explained'),
    at('https://docs.python.org/3/library/asyncio.html', 'asyncio - Asynchronous I/O')
  ]
  assert.equal(order(results, 'python asyncio run_until_complete')[0], 'docs.python.org')
})

test('for a review, the maker’s own page is not the independent source and does not lead', () => {
  // The maker is recognised the same way anything is: its domain carries the name that was searched for. Orbis holds
  // no table of which company makes which product, so a query naming only the product ("iphone 15 review") cannot
  // identify Apple -- and inventing that table is how a ranking stops being explainable.
  const results = [
    at('https://notion.so/product', 'Notion'),
    at('https://someblog.com/notion', 'Notion review: a year on')
  ]
  assert.equal(order(results, 'notion review')[0], 'someblog.com')
})

test('a site whose name contains a word like “review” is not mistaken for an official one', () => {
  const results = [
    at('https://sometutorials.com/notion', 'Notion tips'),
    at('https://independentreviews.com/notion', 'Notion review')
  ]
  // Neither is official; what matters is that independentreviews.com is not penalised as though it were.
  assert.ok(order(results, 'notion review').includes('independentreviews.com'))
})

test('a reference source is preferred when a name was searched for', () => {
  const results = [
    at('https://randomfan.site/einstein', 'Einstein facts'),
    at('https://en.wikipedia.org/wiki/Albert_Einstein', 'Albert Einstein')
  ]
  assert.equal(order(results, 'Albert Einstein biography')[0], 'en.wikipedia.org')
})

test('freshness counts for a question about now, and not otherwise', () => {
  const now = 1_700_000_000_000
  const day = 86_400_000
  const results = [at('https://old.com/a', 'Something today', now - 400 * day), at('https://new.com/b', 'Something today', now - day)]
  assert.equal(order(results, 'iphone launch today', now)[0], 'new.com')
  // The same two pages, for a question that has no date in it: the old one is not penalised for being old.
  const timeless = [at('https://old.com/a', 'Pythagorean theorem', now - 400 * day), at('https://new.com/b', 'Pythagorean theorem', now - day)]
  assert.equal(order(timeless, 'pythagorean theorem', now)[0], 'old.com')
})

test('every move can be explained', () => {
  const results = [at('https://python.org/downloads', 'Download Python'), at('https://blog.com/p', 'Install python')]
  const [first] = rankResults(results, understand('how to install python'))
  assert.ok(first.because.length > 0)
  assert.ok(first.because.some((r) => /official/i.test(r)))
})

test('with nothing to distinguish them, the provider’s order is kept', () => {
  const results = [at('https://a.com/1', 'Something'), at('https://b.com/2', 'Something')]
  assert.deepEqual(order(results, 'something'), ['a.com', 'b.com'])
})

// ---------------------------------------------------------------- places (§37)

test('a gazetteer result becomes a place with the name split off the address', () => {
  const place = readPlace({
    title: 'Amethyst Cafe, 12, Whites Road, Royapettah, Chennai, Tamil Nadu, 600014, India',
    content: 'cafe · amenity',
    url: 'https://www.openstreetmap.org/?mlat=13.05&mlon=80.26#map=16/13.05/80.26'
  })!
  assert.equal(place.name, 'Amethyst Cafe')
  assert.match(place.address, /Royapettah, Chennai/)
  assert.equal(place.kind, 'Cafe')
  assert.ok(place.directions?.includes('13.05,80.26'))
})

test('a result with no real address is not a place', () => {
  assert.equal(readPlace({ title: 'Somewhere', url: 'not-a-url' }), null)
  assert.equal(readPlace({ url: 'https://www.openstreetmap.org/' }), null)
})

test('the coordinates are read from the map link', () => {
  assert.deepEqual(coordsFrom('https://www.openstreetmap.org/?mlat=13.05&mlon=80.26#map=16/13.05/80.26'), { lat: '13.05', lon: '80.26' })
  assert.equal(coordsFrom('https://example.com'), null)
})

test('what the source cannot know is said, rather than left as an empty field', () => {
  assert.match(PLACES_NOTE, /ratings, opening hours and phone numbers are not available/i)
})
