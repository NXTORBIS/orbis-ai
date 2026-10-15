import assert from 'node:assert/strict'
import { test } from 'node:test'
import { suggestionsFor, historyKey, remember, readHistory, writeHistory } from './askSuggest.js'

test('a video page offers video things, and a shop offers shop things', () => {
  assert.equal(suggestionsFor('https://www.youtube.com/watch?v=abc')[0].name, 'Summarize this video')
  assert.equal(suggestionsFor('https://www.amazon.in/dp/B0')[0].name, 'Compare prices')
  assert.equal(suggestionsFor('https://github.com/a/b')[0].name, 'Explain this code')
})

test('a page that is not a web page, or an unknown site, offers nothing extra', () => {
  assert.deepEqual(suggestionsFor('chrome://newtab/'), [])
  assert.deepEqual(suggestionsFor('not a url'), [])
  assert.deepEqual(suggestionsFor('https://example.org/'), [])
})

test('the YouTube home page does not claim to be a video', () => {
  assert.ok(!suggestionsFor('https://www.youtube.com/').some((s) => /video/i.test(s.name) && /Summarize/.test(s.name)))
})

test('history is per page, ignores fragments and tracking, and keeps five', () => {
  assert.equal(historyKey('https://a.com/x?utm_source=z#top'), historyKey('https://a.com/x'))
  assert.notEqual(historyKey('https://a.com/x'), historyKey('https://a.com/y'))
  let l = []
  for (const q of ['1', '2', '3', '4', '5', '6', '3']) l = remember(l, q)
  assert.deepEqual(l, ['3', '6', '5', '4', '2'])
})

test('unreadable or full storage never throws', () => {
  const bad = { getItem: () => '{oops', setItem: () => { throw new Error('full') } }
  assert.deepEqual(readHistory(bad, 'k'), [])
  assert.doesNotThrow(() => writeHistory(bad, 'k', ['a']))
})
