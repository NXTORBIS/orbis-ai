import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSpecialized, PROVIDER_CATEGORY, readOutcome, readResult, saidDuration, SPECIALIZED_CATEGORIES } from '../shared/searchProviders.ts'
import { endpointFromEnvironment, SearxngProvider } from './search/specialized.ts'

/**
 * The payloads here are real: each is the shape the running service actually returned for "mount everest" in that
 * category, trimmed to the fields that matter. Writing the reader against invented shapes would prove nothing.
 */

test('every Orbis category maps to a real category of the aggregation layer', () => {
  assert.deepEqual(SPECIALIZED_CATEGORIES, ['images', 'videos', 'news', 'maps', 'music', 'science', 'files', 'social'])
  assert.equal(PROVIDER_CATEGORY.maps, 'map', 'it calls maps "map"')
  assert.equal(PROVIDER_CATEGORY.social, 'social media')
  assert.equal(PROVIDER_CATEGORY.science, 'science')
  assert.equal(isSpecialized('images'), true)
  assert.equal(isSpecialized('all'), false, 'ordinary web search is not one of these')
})

test('an image result carries the picture, where it came from and who made it', () => {
  const result = readResult(
    {
      title: 'Mount Everest',
      url: 'https://www.flickr.com/photos/freekstreet/120786914',
      img_src: 'https://live.staticflickr.com/43/120786914_351dbe8114_b.jpg',
      img_width: 1024,
      img_height: 768,
      author: 'freekstreet',
      publishedDate: '2020-05-05T16:43:24.579130+00:00',
      engines: ['openverse'],
      content: ''
    },
    'images'
  )
  assert.equal(result?.image, 'https://live.staticflickr.com/43/120786914_351dbe8114_b.jpg')
  assert.equal(result?.url, 'https://www.flickr.com/photos/freekstreet/120786914', 'the page it sits on, for opening the source')
  assert.equal(result?.site, 'flickr.com')
  assert.equal(result?.width, 1024)
  assert.equal(result?.author, 'freekstreet')
  assert.equal(result?.published, '2020-05-05')
  assert.equal(result?.via, 'openverse', 'which engine found it, because some of them ask to be credited')
  assert.equal(result?.snippet, undefined, 'an empty snippet is no snippet')
})

test('an image with no picture is not an image result', () => {
  assert.equal(readResult({ title: 'Everest', url: 'https://example.com/page' }, 'images'), null)
  // But one that is only a picture still is: its own address stands in for the page.
  const bare = readResult({ title: 'Everest', img_src: 'https://example.com/everest.jpg' }, 'images')
  assert.equal(bare?.url, 'https://example.com/everest.jpg')
})

test('a video result carries its length, its channel and a player when the source offers one', () => {
  const result = readResult(
    {
      url: 'https://tube.blueben.net/videos/watch/f42e10fe',
      title: 'I Survived Reaching Mount Everest',
      content: 'Mount Everest (8,849m) is the highest mountain on Earth',
      author: 'Travel',
      length: 1543.0,
      iframe_src: 'https://tube.blueben.net/videos/embed/w9QBk3A39Bn3W2HYtd1sQZ',
      thumbnail: 'https://tube.blueben.net/lazy-static/previews/abc.jpg',
      publishedDate: '2026-04-05T15:20:08.076000+00:00',
      engines: ['peertube']
    },
    'videos'
  )
  assert.equal(result?.durationSec, 1543)
  assert.equal(saidDuration(result?.durationSec), '25:43')
  assert.equal(result?.author, 'Travel')
  assert.equal(result?.embed, 'https://tube.blueben.net/videos/embed/w9QBk3A39Bn3W2HYtd1sQZ', 'a player the source itself offers')
  assert.equal(result?.site, 'tube.blueben.net')
})

test('a place carries where it is, the right way round', () => {
  const result = readResult(
    {
      title: 'Mount Everest',
      url: 'https://openstreetmap.org/node/164979149',
      // GeoJSON is longitude first, which is the easy mistake to make.
      geojson: { type: 'Point', coordinates: [86.92521, 27.9880614] },
      address: { name: 'Mount Everest', road: null, locality: 'Khumjung', country: 'Nepal' },
      thumbnail: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Everest.jpg',
      engines: ['openstreetmap']
    },
    'maps'
  )
  assert.equal(result?.latitude, 27.9880614)
  assert.equal(result?.longitude, 86.92521)
  assert.equal(result?.address, 'Khumjung, Nepal')

  // Nonsense coordinates are left out rather than put on a map.
  const wrong = readResult({ title: 'x', url: 'https://example.com', geojson: { coordinates: [999, 999] } }, 'maps')
  assert.equal(wrong?.latitude, undefined)
})

test('a paper, a track and a file each keep what their own kind has', () => {
  const paper = readResult({ title: 'An update to the EVEREST K2 pipeline', url: 'https://arxiv.org/abs/1702.05488', content: 'We present an update', publishedDate: '2017-02-17T19:00:04', engines: ['arxiv'] }, 'science')
  assert.equal(paper?.published, '2017-02-17')
  assert.equal(paper?.site, 'arxiv.org')

  const track = readResult({ title: 'Bookbits - Into the Silence', url: 'https://commons.wikimedia.org/wiki/File:Bookbits.ogg', audio_src: 'https://upload.wikimedia.org/wikipedia/commons/9/97/Bookbits.ogg', length: 395.0, engines: ['wikicommons.audio'] }, 'music')
  assert.equal(track?.audio, 'https://upload.wikimedia.org/wikipedia/commons/9/97/Bookbits.ogg')
  assert.equal(saidDuration(track?.durationSec), '6:35')

  const file = readResult({ title: 'Everest-50 (2003)', url: 'https://commons.wikimedia.org/wiki/File:Everest-50.jpg', thumbnail: 'https://thumb.wikimedia.org/x.jpg', engines: ['wikicommons.files'] }, 'files')
  assert.equal(file?.thumbnail, 'https://thumb.wikimedia.org/x.jpg')
})

test('nothing is invented to fill a gap', () => {
  const result = readResult({ title: 'Ross Edgley swims around Great Britain', url: 'https://en.wikinews.org/wiki/Ross', publishedDate: 'None', length: 'None', author: '', thumbnail: '', img_src: '', engine: 'wikinews' }, 'news')
  assert.equal(result?.published, undefined, 'the string "None" is not a date')
  assert.equal(result?.durationSec, undefined)
  assert.equal(result?.author, undefined)
  assert.equal(result?.thumbnail, undefined)
  assert.equal(result?.image, undefined)

  // A date that cannot be read, or is absurd, is left out rather than guessed.
  for (const bad of ['sometime last year', '0001-01-01', '9999-01-01', 12345]) {
    assert.equal(readResult({ title: 't', url: 'https://e.com', publishedDate: bad }, 'news')?.published, undefined, String(bad))
  }
})

test('a result Orbis could not open, or could not name, is dropped', () => {
  assert.equal(readResult({ title: 'x', url: 'javascript:alert(1)' }, 'news'), null, 'only http and https')
  assert.equal(readResult({ title: 'x', url: 'file:///C:/secret.txt' }, 'files'), null)
  assert.equal(readResult({ url: 'https://example.com' }, 'news'), null, 'nothing to show it under')
  assert.equal(readResult(null, 'news'), null)
  assert.equal(readResult('a string', 'news'), null)
})

test('the same thing found by several engines is shown once, and failures are named', () => {
  const outcome = readOutcome(
    {
      results: [
        { title: 'Everest', url: 'https://example.com/a', engines: ['openverse'], img_src: 'https://example.com/a.jpg' },
        { title: 'Everest again', url: 'https://example.com/a?utm_source=x', engines: ['wikicommons.images'], img_src: 'https://example.com/a.jpg' },
        { title: 'Another', url: 'https://example.com/b', engines: ['openverse'], img_src: 'https://example.com/b.jpg' }
      ],
      unresponsive_engines: [['peertube', 'timeout'], ['photon', 'HTTP error']]
    },
    'images',
    'everest',
    120
  )
  assert.equal(outcome.results.length, 2, 'one entry per picture')
  assert.deepEqual(outcome.unavailable, ['peertube', 'photon'], 'a thin page says why it is thin')
  assert.equal(outcome.problem, null)
  assert.equal(outcome.tookMs, 120)
})

test('an empty answer explains itself', () => {
  assert.match(readOutcome({ results: [], unresponsive_engines: [['arxiv', 'timeout']] }, 'science', 'q', 10).problem ?? '', /could not be reached/)
  assert.match(readOutcome({ results: [] }, 'science', 'q', 10).problem ?? '', /Nothing came back/)
  assert.match(readOutcome(null, 'science', 'q', 10).problem ?? '', /Nothing came back/)
})

// ---------------------------------------------------------------- the provider

const okResponse = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

test('a search asks for the right category, as JSON, and carries nothing about who asked', async () => {
  const asked: string[] = []
  const provider = new SearxngProvider({
    endpoint: 'http://127.0.0.1:8888/',
    fetchFn: async (url) => {
      asked.push(url)
      return okResponse({ results: [{ title: 'Everest', url: 'https://example.com/a', engines: ['photon'] }] })
    }
  })
  const outcome = await provider.search('maps', '  mount   everest  ')

  assert.equal(asked.length, 1)
  const url = new URL(asked[0])
  assert.equal(url.searchParams.get('categories'), 'map')
  assert.equal(url.searchParams.get('format'), 'json')
  assert.equal(url.searchParams.get('q'), 'mount everest', 'the words, tidied')
  assert.doesNotMatch(asked[0], /id=|uid=|session|token|user|profile/i, 'and nothing else about anybody')
  assert.equal(outcome.results.length, 1)
})

test('one category failing says so plainly, and never invents results', async () => {
  const provider = new SearxngProvider({ endpoint: 'http://127.0.0.1:8888', fetchFn: async () => new Response('nope', { status: 502 }) })
  const outcome = await provider.search('news', 'everest')
  assert.deepEqual(outcome.results, [])
  assert.match(outcome.problem ?? '', /502/)
})

test('being asked to slow down is said as that, not as a breakage', async () => {
  const provider = new SearxngProvider({ endpoint: 'http://127.0.0.1:8888', fetchFn: async () => new Response('', { status: 429 }) })
  assert.match((await provider.search('images', 'everest')).problem ?? '', /Too many searches/)
})

test('a service that is down is rested rather than hammered, and web search is never implicated', async () => {
  let calls = 0
  let clock = 1_000_000
  const provider = new SearxngProvider({
    endpoint: 'http://127.0.0.1:8888',
    fetchFn: async () => {
      calls++
      throw new Error('connection refused')
    },
    now: () => clock
  })

  for (let i = 0; i < 5; i++) await provider.search('images', 'everest')
  assert.equal(calls, 3, 'it stops trying after three refusals')
  assert.equal(provider.healthy(), false)
  assert.match((await provider.search('images', 'everest')).problem ?? '', /Web search still works/)

  // And tries again once the rest is over.
  clock += 61_000
  assert.equal(provider.healthy(), true)
  await provider.search('images', 'everest')
  assert.equal(calls, 4)
})

test('an empty search asks nothing of the service', async () => {
  let calls = 0
  const provider = new SearxngProvider({ endpoint: 'http://127.0.0.1:8888', fetchFn: async () => { calls++; return okResponse({ results: [] }) } })
  assert.match((await provider.search('images', '   ')).problem ?? '', /Nothing was searched for/)
  assert.equal(calls, 0)
})

test('where the service lives is configuration, never something a user has to obtain a key for', () => {
  assert.equal(endpointFromEnvironment({}), 'http://127.0.0.1:8888')
  assert.equal(endpointFromEnvironment({ ORBIS_SEARCH_ENDPOINT: 'https://search.example.com/' }), 'https://search.example.com')
  assert.equal(endpointFromEnvironment({ ORBIS_SEARCH_ENDPOINT: 'not a url' }), 'http://127.0.0.1:8888', 'nonsense falls back rather than breaking search')
})
