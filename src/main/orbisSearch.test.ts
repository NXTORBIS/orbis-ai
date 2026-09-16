import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BANGS, isOrbisPage, readBang, readSearchPageUrl, searchDestination, searchPageUrl, siteOf, tidyResults, wantsAnswer } from '../shared/orbisSearch.ts'

test('a search has an address of its own, so it can be a tab, a bookmark and a place in history', () => {
  assert.equal(searchPageUrl('how tall is everest'), 'orbis://search?q=how%20tall%20is%20everest')
  assert.equal(searchPageUrl('cats', 'images'), 'orbis://search?q=cats&in=images')

  const read = readSearchPageUrl('orbis://search?q=how%20tall%20is%20everest')
  assert.deepEqual(read, { query: 'how tall is everest', vertical: 'all' })
  assert.deepEqual(readSearchPageUrl('orbis://search?q=cats&in=videos'), { query: 'cats', vertical: 'videos' })
})

test('a query survives the journey, however it is written', () => {
  for (const query of ['c++ templates', 'why is the sky blue?', '100% cotton & wool', 'a/b testing', 'naïve café']) {
    assert.equal(readSearchPageUrl(searchPageUrl(query))?.query, query, `${query} comes back as it went in`)
  }
})

test('an address that is not a search page is not mistaken for one', () => {
  assert.equal(readSearchPageUrl('https://example.com/search?q=cats'), null)
  assert.equal(readSearchPageUrl('orbis://settings'), null)
  assert.equal(readSearchPageUrl('not a url'), null)
  assert.equal(isOrbisPage('orbis://search?q=x'), true)
  assert.equal(isOrbisPage('https://orbis.example/search'), false, 'a website merely named after us is not one of our pages')
})

test('asking for a particular site goes to that site, not to Orbis Search', () => {
  const google = searchDestination('!g quantum tunnelling')
  assert.equal(google.where, 'Google')
  assert.equal(google.url, 'https://www.google.com/search?q=quantum%20tunnelling')

  // The bang reads naturally at either end.
  assert.equal(searchDestination('lofi beats !yt').where, 'YouTube')
  assert.equal(searchDestination('!yt lofi beats').url, 'https://www.youtube.com/results?search_query=lofi%20beats')

  // Everything else is ours.
  const ours = searchDestination('how tall is everest')
  assert.equal(ours.where, 'Orbis Search')
  assert.equal(ours.url, 'orbis://search?q=how%20tall%20is%20everest')
})

test('Google stays one keystroke away, so nobody has to change a setting to get the ten blue links', () => {
  assert.ok(BANGS.g, 'a short bang for Google')
  assert.ok(BANGS.ddg && BANGS.b, 'and the other engines')
  assert.equal(readBang('!g test')?.site.name, 'Google')
})

test('something that only looks like a bang is left alone', () => {
  assert.equal(readBang('hello!'), null)
  assert.equal(readBang('!notabang something'), null, 'an unknown bang is part of the question, not an instruction')
  assert.equal(readBang('!g'), null, 'a bang with nothing to search is not a search')
  assert.equal(searchDestination('!notabang something').where, 'Orbis Search')
})

test('results are shown as a person would read them, without duplicates or self-reference', () => {
  const results = tidyResults([
    { title: 'Everest', url: 'https://en.wikipedia.org/wiki/Mount_Everest', snippet: '8,849 m' },
    { title: 'Everest again', url: 'https://en.wikipedia.org/wiki/Mount_Everest/', snippet: 'same page' },
    { title: 'Everest with tracking', url: 'https://en.wikipedia.org/wiki/Mount_Everest?utm_source=x', snippet: 'same page' },
    { title: 'Search results', url: 'https://www.google.com/search?q=everest', snippet: 'a search engine' },
    { title: '', url: 'https://britannica.com/place/Mount-Everest', snippet: 'reference' }
  ])
  assert.deepEqual(results.map((r) => r.site), ['en.wikipedia.org', 'britannica.com'], 'one entry per page, and no search engines')
  assert.equal(results[1].title, 'britannica.com', 'a result with no title is called by its site rather than left blank')
  assert.equal(siteOf('https://www.bbc.co.uk/news/article'), 'bbc.co.uk')
})

test('Orion answers what is worth answering, and stays quiet when the links speak for themselves', () => {
  assert.equal(wantsAnswer('how does a heat pump work'), true)
  assert.equal(wantsAnswer('difference between tcp and udp'), true)
  assert.equal(wantsAnswer('best laptop for video editing 2026'), true)

  // Somebody looking for a site wants the site.
  assert.equal(wantsAnswer('youtube'), false)
  assert.equal(wantsAnswer('github.com'), false)
  assert.equal(wantsAnswer('bbc'), false)
})

test('a search page holds nothing about who asked, only what was asked', () => {
  // The address is the whole of the state: no identifier, no session, nothing to follow somebody around with.
  const url = searchPageUrl('something private')
  assert.doesNotMatch(url, /id=|uid=|session|token|user/i)
  assert.equal(url.split('?')[1], 'q=something%20private')
})
