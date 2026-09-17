import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkCitations, comparison, mergeResults, planQueries, rankSources } from '../shared/researchPlan.ts'

test('a comparison is researched as each side and the comparison, side by side', () => {
  assert.deepEqual(planQueries('Compare Chromium and Firefox architecture'), ['Chromium architecture', 'Firefox architecture', 'Chromium vs Firefox architecture'])
  assert.deepEqual(planQueries("What's the difference between SQLite and Postgres?"), ['SQLite', 'Postgres', 'SQLite vs Postgres'])
  assert.deepEqual(planQueries('Tesla Model 3 vs Hyundai Ioniq 6 range'), ['Tesla Model 3 range', 'Hyundai Ioniq 6 range', 'Tesla Model 3 vs Hyundai Ioniq 6 range'])
  assert.deepEqual(planQueries('Is Rust better than Go for CLI tools?'), ['Rust CLI tools', 'Go CLI tools', 'Rust vs Go CLI tools'])
})

test('a question that is one thing stays one search, and a follow-up carries the session topic', () => {
  assert.deepEqual(planQueries('How does Chromium sandbox renderers?'), ['How does Chromium sandbox renderers'])
  assert.deepEqual(planQueries('which one has the longest range?', 'electric cars', true), ['electric cars which one has the longest range'])
  assert.deepEqual(planQueries('electric cars range', 'electric cars', true), ['electric cars range'], 'no topic added twice')
  assert.equal(comparison('black and white photography'), null, '"and" alone is not a comparison')
  assert.equal(comparison('compare the same and the same'), null)
})

test('official and primary sources come first, otherwise the search order is kept', () => {
  const results = [
    { url: 'https://someblog.example/chromium-thoughts', site: 'someblog.example', title: 'Thoughts' },
    { url: 'https://en.wikipedia.org/wiki/Chromium', site: 'wikipedia.org', title: 'Chromium' },
    { url: 'https://www.chromium.org/developers/design-documents/', site: 'chromium.org', title: 'Design documents' },
    { url: 'https://developer.mozilla.org/en-US/docs/Mozilla', site: 'developer.mozilla.org', title: 'MDN' },
    { url: 'https://another.example/post', site: 'another.example', title: 'Post' }
  ]
  const ranked = rankSources(results, ['Chromium']).map((r) => r.site)
  assert.equal(ranked[0], 'chromium.org', 'the project’s own site')
  assert.deepEqual(ranked.slice(-2), ['someblog.example', 'another.example'], 'blogs last, in their original order')
})

test('several searches become one list, each branch represented and nothing twice', () => {
  const a = [{ url: 'https://a.example/1' }, { url: 'https://shared.example/x#top' }, { url: 'https://a.example/2' }]
  const b = [{ url: 'https://b.example/1' }, { url: 'https://shared.example/x/' }]
  assert.deepEqual(mergeResults([a, b]).map((r) => r.url), ['https://a.example/1', 'https://b.example/1', 'https://shared.example/x#top', 'https://a.example/2'])
  assert.equal(mergeResults([a, b], 2).length, 2)
})

test('citations are checked against the sources really found', () => {
  assert.deepEqual(checkCitations('Chromium isolates sites [1]. Firefox uses Fission [3, 2]. Both sandbox content [9].', 4), { cited: [1, 3, 2], invalid: [9], uncited: false })
  assert.equal(checkCitations('Electric cars are getting cheaper every year and have longer ranges than before.', 5).uncited, true, 'claims with no source at all are noticed')
  assert.equal(checkCitations("The sources don't answer that; a manufacturer's spec sheet would.", 5).uncited, false, 'saying the sources do not cover it is not an uncited claim')
})
