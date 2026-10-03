import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { allowed, blocks, DEFAULT_SOURCE_PREFERENCES, kindOf, leftOutNote, preferenceRank, readSourcePreferences } from './researchSources.ts'
import { ENOUGH_SUPPORT, provenanceNote, support, traceClaims, unsupported } from './researchProvenance.ts'

/**
 * Two things research could not do: be told which sources you want, and say *where* in a source a claim came from.
 */

// ---------------------------------------------------------------- which sources you want

test('a source is placed from its address, and an address Orbis cannot place is placed nowhere', () => {
  assert.equal(kindOf('https://docs.python.org/3/library/os.html'), 'official')
  assert.equal(kindOf('https://www.w3.org/TR/css-grid-1/'), 'official')
  assert.equal(kindOf('https://arxiv.org/abs/2301.00001'), 'academic')
  assert.equal(kindOf('https://mit.edu/research'), 'academic')
  assert.equal(kindOf('https://en.wikipedia.org/wiki/Physics'), 'reference')
  assert.equal(kindOf('https://www.reddit.com/r/rust/'), 'forum')
  assert.equal(kindOf('https://www.bbc.com/news/world'), 'news')
  assert.equal(kindOf('https://someones-blog.example/post'), null, 'guessing is worse than not knowing')
  assert.equal(kindOf('chrome://settings'), null)
})

test('preferring a kind moves it up; it cannot invent one that was not found', () => {
  const prefs = readSourcePreferences({ prefer: ['official'] })
  assert.ok(preferenceRank('https://docs.python.org/3/', prefs) < preferenceRank('https://blog.example/x', prefs))
  // The ranking is all it does: nothing here produces a source.
  assert.equal(preferenceRank('https://blog.example/x', prefs), 0)
})

test('avoiding a kind puts it last, and still lets it answer when nothing else does', () => {
  const prefs = readSourcePreferences({ avoid: ['forum'] })
  assert.equal(preferenceRank('https://www.reddit.com/r/x', prefs), 1)
  assert.equal(allowed('https://www.reddit.com/r/x', prefs), true, 'avoiding is not blocking')
})

test('blocking a site is absolute, and covers its subdomains', () => {
  const prefs = readSourcePreferences({ blocked: ['example.com'] })
  assert.equal(allowed('https://example.com/a', prefs), false)
  assert.equal(allowed('https://news.example.com/a', prefs), false)
  assert.equal(allowed('https://notexample.com/a', prefs), true)
})

test('a star pattern covers the subdomains and not the site itself', () => {
  assert.equal(blocks('*.example.com', 'news.example.com'), true)
  assert.equal(blocks('*.example.com', 'example.com'), false)
})

test('a blocked site is said rather than silently dropped', () => {
  assert.equal(leftOutNote(0), null)
  assert.ok(leftOutNote(1)?.includes('One result'))
  assert.ok(leftOutNote(3)?.includes('3 results'))
})

test('no preferences means no opinion, which is the default', () => {
  assert.deepEqual(readSourcePreferences(undefined), DEFAULT_SOURCE_PREFERENCES)
  assert.equal(preferenceRank('https://arxiv.org/abs/1', DEFAULT_SOURCE_PREFERENCES), 0)
})

test('a kind cannot be both preferred and avoided', () => {
  const prefs = readSourcePreferences({ prefer: ['news'], avoid: ['news', 'forum'] })
  assert.deepEqual(prefs.prefer, ['news'])
  assert.deepEqual(prefs.avoid, ['forum'])
})

test('damaged preferences are dropped, not repaired into something odd', () => {
  const prefs = readSourcePreferences({ prefer: ['official', 'nonsense', 7], blocked: ['  EXAMPLE.com  ', '', 42] })
  assert.deepEqual(prefs.prefer, ['official'])
  assert.deepEqual(prefs.blocked, ['example.com'])
})

// ---------------------------------------------------------------- where in a source a claim came from

const SOURCES = [
  { n: 1, excerpt: 'The committee published its findings on Tuesday. Inspectors visited twelve sites across the region during the review. The report recommends replacing the ventilation equipment.' },
  { n: 2, excerpt: 'Rainfall in the region was the heaviest recorded since 1998. Farmers reported losses across three districts.' }
]

test('a cited claim is matched to the passage in that source which carries it', () => {
  const traced = traceClaims('Inspectors visited twelve sites across the region during the review [1].', SOURCES)
  assert.equal(traced.length, 1)
  assert.equal(traced[0].n, 1)
  assert.ok(traced[0].passage?.includes('twelve sites'), JSON.stringify(traced[0]))
  assert.ok(traced[0].strength >= ENOUGH_SUPPORT)
})

test('a claim the source does not say is reported as unsupported, not given a passage that looks close enough', () => {
  const traced = traceClaims('The committee recommended closing the facility entirely by the autumn of next year [1].', SOURCES)
  assert.equal(traced[0].passage, null)
  assert.equal(traced[0].strength, 0)
  assert.equal(unsupported(traced).length, 1)
})

test('a sentence citing two sources is checked against both, separately', () => {
  const traced = traceClaims('Inspectors visited twelve sites across the region during the review [1][2].', SOURCES)
  assert.equal(traced.length, 2)
  assert.equal(traced.find((one) => one.n === 1)?.passage !== null, true)
  assert.equal(traced.find((one) => one.n === 2)?.passage, null, 'the second source says nothing of the kind')
})

test('the citation marks are not part of what was claimed', () => {
  const traced = traceClaims('Rainfall in the region was the heaviest recorded since 1998 [2].', SOURCES)
  assert.ok(!traced[0].claim.includes('['), traced[0].claim)
})

test('an answer that cites nothing produces nothing to check', () => {
  assert.deepEqual(traceClaims('Here is a general answer with no sources at all.', SOURCES), [])
})

test('a citation pointing at a source that does not exist is skipped rather than invented', () => {
  assert.deepEqual(traceClaims('Something was definitely stated by somebody somewhere about this [9].', SOURCES), [])
})

test('what is said about citations that do not hold up does not claim more than was checked', () => {
  const note = provenanceNote(traceClaims('The committee recommended closing the facility entirely next autumn [1].', SOURCES))!
  assert.ok(note.includes('the part of that page it read'), note)
  assert.ok(!/wrong|false|made up|fabricat/i.test(note), note)
})

test('citations that all hold up produce nothing to say', () => {
  assert.equal(provenanceNote(traceClaims('Inspectors visited twelve sites across the region during the review [1].', SOURCES)), null)
})

test('support is how much of the claim the passage carries, not how similar they look', () => {
  assert.equal(support('', 'anything'), 0)
  assert.ok(support('twelve sites region', 'Inspectors visited twelve sites across the region.') > 0.9)
  assert.ok(support('entirely unrelated vocabulary here', 'Inspectors visited twelve sites.') < 0.3)
})
