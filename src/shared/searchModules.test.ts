import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NO_ANSWER,
  acceptQuestions,
  acceptRelated,
  acceptRelatedSearches,
  answerQuestion,
  buildKnowledge,
  dedupeResults,
  normalizeResult,
  provenanceFor
} from './searchModules.ts'

const SOURCE = { url: 'https://en.wikipedia.org/wiki/Thing', title: 'Thing' }

// ---------------------------------------------------------------- provenance is not optional

test('nothing without a real address gets provenance', () => {
  assert.equal(provenanceFor({ url: 'not a url' }, 'web'), null)
  assert.equal(provenanceFor({ url: 'javascript:alert(1)' }, 'web'), null)
  assert.equal(provenanceFor({}, 'web'), null)
  assert.equal(provenanceFor({ url: 'https://example.com' }, 'web')?.site, 'example.com')
})

test('provenance records who supplied it and when it was read', () => {
  const p = provenanceFor(SOURCE, 'searxng', 1000)!
  assert.equal(p.provider, 'searxng')
  assert.equal(p.retrievedAt, 1000)
  assert.equal(p.site, 'en.wikipedia.org')
})

test('a result with no address, or no title, is dropped rather than normalised into a blank', () => {
  assert.equal(normalizeResult({ title: 'No link here' }, 'web', 'searxng'), null)
  assert.equal(normalizeResult({ url: 'https://example.com' }, 'web', 'searxng'), null)
})

test('a normalised result keeps where it came from', () => {
  const r = normalizeResult({ url: 'https://example.com/a', title: 'A', snippet: 'about a' }, 'web', 'searxng', 5)!
  assert.equal(r.domain, 'example.com')
  assert.equal(r.description, 'about a')
  assert.equal(r.provenance.provider, 'searxng')
  assert.equal(r.provenance.retrievedAt, 5)
})

// ---------------------------------------------------------------- duplicates, but not independent reporting

test('the same page with tracking on the end is the same page', () => {
  const results = [
    normalizeResult({ url: 'https://example.com/story', title: 'Story' }, 'news', 'p')!,
    normalizeResult({ url: 'https://example.com/story?utm_source=twitter', title: 'Story' }, 'news', 'p')!,
    normalizeResult({ url: 'https://www.example.com/story/', title: 'Story' }, 'news', 'p')!
  ]
  assert.equal(dedupeResults(results).length, 1)
})

test('two publications covering one story are two sources, and both are kept', () => {
  const results = [
    normalizeResult({ url: 'https://bbc.com/story', title: 'Something happened' }, 'news', 'p')!,
    normalizeResult({ url: 'https://reuters.com/story', title: 'Something happened' }, 'news', 'p')!
  ]
  assert.equal(dedupeResults(results).length, 2)
})

// ---------------------------------------------------------------- People also ask

test('a question must read as a question', () => {
  const kept = acceptQuestions(['When did Einstein publish relativity', 'Einstein was a physicist', 'buy einstein poster'], 'Einstein')
  assert.equal(kept.length, 1)
  assert.equal(kept[0].question, 'When did Einstein publish relativity?')
})

test('a question about something else entirely does not reach the page', () => {
  const kept = acceptQuestions(['Who is Isaac Newton?', 'What did Einstein discover?'], 'Albert Einstein')
  assert.deepEqual(kept.map((q) => q.question), ['What did Einstein discover?'])
})

test('a question arrives unanswered, and unanswered is not the same as answered with nothing', () => {
  const [q] = acceptQuestions(['What did Einstein discover?'], 'Einstein')
  assert.equal(q.answer, null)
  assert.equal(q.answered, false)
})

test('an answer the cited page does not support is refused', () => {
  const [q] = acceptQuestions(['What did Einstein discover?'], 'Einstein')
  const invented = answerQuestion(q, { text: 'He discovered penicillin in 1928.', source: SOURCE }, 'Einstein developed the theory of relativity.', 'web')
  assert.equal(invented.answer, null)
  assert.equal(invented.answered, true, 'it was looked for; there was nothing')
})

test('an answer with no source is refused however true it sounds', () => {
  const [q] = acceptQuestions(['What did Einstein discover?'], 'Einstein')
  const unsourced = answerQuestion(q, { text: 'He developed the theory of relativity.' }, 'He developed the theory of relativity.', 'web')
  assert.equal(unsourced.answer, null)
})

test('an answer the page does support is kept, with the page', () => {
  const [q] = acceptQuestions(['What did Einstein discover?'], 'Einstein')
  const good = answerQuestion(q, { text: 'He developed the theory of relativity.', source: SOURCE }, 'Albert Einstein developed the theory of relativity, which changed physics.', 'web')
  assert.equal(good.answer?.text, 'He developed the theory of relativity.')
  assert.equal(good.answer?.provenance.site, 'en.wikipedia.org')
})

test('there is one sentence for having found nothing', () => {
  assert.equal(NO_ANSWER, 'Information unavailable')
})

// ---------------------------------------------------------------- People also search for

test('a related entity without a stated relationship is not related, it is just famous', () => {
  const kept = acceptRelated([{ name: 'Lin Dan', url: 'https://example.com/lindan' }], 'Lee Chong Wei', 'web')
  assert.equal(kept.length, 0)
})

test('a related entity with a relationship and a source is kept', () => {
  const kept = acceptRelated(
    [{ name: 'Lin Dan', relationship: 'Also a badminton player and his main rival', url: 'https://example.com/lindan', kind: 'person' }],
    'Lee Chong Wei',
    'web'
  )
  assert.equal(kept.length, 1)
  assert.equal(kept[0].relationship, 'Also a badminton player and his main rival')
  assert.equal(kept[0].searchQuery, 'Lin Dan')
})

test('the thing searched for is not offered as related to itself', () => {
  const kept = acceptRelated([{ name: 'Einstein', relationship: 'same', url: 'https://example.com/e' }], 'einstein', 'web')
  assert.equal(kept.length, 0)
})

// ---------------------------------------------------------------- related searches

test('related searches are queries, need no source, and must be about the same thing', () => {
  const kept = acceptRelatedSearches(['Einstein age', 'Einstein awards', 'best pizza in Rome'], 'Einstein')
  assert.deepEqual(kept, ['Einstein age', 'Einstein awards'])
})

test('the search just made is not offered back as a related search', () => {
  assert.deepEqual(acceptRelatedSearches(['Einstein', 'Einstein age'], 'Einstein'), ['Einstein age'])
})

// ---------------------------------------------------------------- the knowledge panel

test('a name with nothing found behind it draws no panel', () => {
  assert.equal(buildKnowledge({ name: 'Somebody', url: 'https://example.com/s' }, 'web'), null)
})

test('a panel needs a real address, whatever else it has', () => {
  assert.equal(buildKnowledge({ name: 'Somebody', about: 'A person.', facts: [] }, 'web'), null)
})

test('a fact whose source cannot be made is dropped, and the rest of the panel survives', () => {
  const panel = buildKnowledge(
    {
      name: 'Albert Einstein',
      url: 'https://en.wikipedia.org/wiki/Albert_Einstein',
      about: 'A theoretical physicist.',
      facts: [
        { key: 'born', label: 'Born', value: '14 March 1879', source: { url: 'https://en.wikipedia.org/wiki/Albert_Einstein' } },
        { key: 'shoe_size', label: 'Shoe size', value: '44', source: { url: 'not-a-url' } }
      ]
    },
    'web'
  )!
  assert.equal(panel.facts.length, 1)
  assert.equal(panel.facts[0].value, '14 March 1879')
  assert.equal(panel.facts[0].provenance.site, 'en.wikipedia.org')
})

test('a panel built from real facts keeps every one of their sources', () => {
  const panel = buildKnowledge(
    {
      name: 'NASA',
      kind: 'organization',
      url: 'https://www.nasa.gov/about',
      description: 'United States space agency',
      facts: [{ key: 'founded', label: 'Founded', value: '1958', source: { url: 'https://www.nasa.gov/about' } }],
      official: [{ label: 'Website', url: 'https://www.nasa.gov' }]
    },
    'web'
  )!
  assert.equal(panel.kind, 'organization')
  assert.equal(panel.official[0].url, 'https://www.nasa.gov')
  assert.ok(panel.facts.every((f) => Boolean(f.provenance.url)))
})
