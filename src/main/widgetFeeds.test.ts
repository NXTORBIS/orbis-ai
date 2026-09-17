import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WidgetFeeds, isPrivateHost } from './widgetFeeds.ts'

type Call = { url: string; headers: Record<string, string> }

const json = (body: unknown, headers: Record<string, string> = {}, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

const FORECAST = {
  properties: {
    meta: { updated_at: '2026-09-17T10:00:00Z' },
    timeseries: [{ time: '2026-09-17T10:00:00Z', data: { instant: { details: { air_temperature: 30 } }, next_1_hours: { summary: { symbol_code: 'clearsky_day' } } } }]
  }
}
const RSS = `<rss version="2.0"><channel><title>Wire</title><item><title>One</title><link>https://wire.example/1</link></item></channel></rss>`

function source(respond: (url: string, n: number) => Response | Promise<Response>, start = Date.parse('2026-09-17T10:30:00Z')) {
  const calls: Call[] = []
  let clock = start
  const feeds = new WidgetFeeds({
    fetch: async (url, init) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
      return respond(url, calls.length)
    },
    appVersion: '0.3.0',
    now: () => clock
  })
  return { feeds, calls, advance: (ms: number) => (clock += ms) }
}

const route = (url: string): Response =>
  url.includes('nominatim') ? json([{ lat: '13.0827', lon: '80.2707', name: 'Chennai' }]) : url.includes('met.no') ? json(FORECAST) : new Response(RSS)

test('the weather for a typed city is real, attributed, and asked for once', async () => {
  const { feeds, calls } = source(route)
  const first = await feeds.weather('Chennai')
  assert.equal(first.ok, true)
  if (!first.ok) return
  assert.equal(first.data.now.temperature, 30)
  assert.equal(first.data.place, 'Chennai')
  assert.match(first.data.attribution, /MET Norway/)

  // A second widget, or the same one redrawing, does not ask again.
  await feeds.weather('chennai')
  assert.equal(calls.filter((c) => c.url.includes('met.no')).length, 1)
  assert.equal(calls.filter((c) => c.url.includes('nominatim')).length, 1, 'a city is looked up once')
})

test('both services are told who is asking, and nobody’s personal address is in it', async () => {
  const { feeds, calls } = source(route)
  await feeds.weather('Chennai')
  for (const call of calls) {
    assert.match(call.headers['User-Agent'], /^Orbis\/0\.3\.0/)
    assert.ok(!/@/.test(call.headers['User-Agent']), 'no email address unless a build configured one')
  }
})

test('a place that does not exist says so, rather than showing somewhere else’s weather', async () => {
  const { feeds } = source((url) => (url.includes('nominatim') ? json([]) : json(FORECAST)))
  const result = await feeds.weather('Atlantis')
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.reason, /No place called “Atlantis”/)
})

test('an empty city asks for one', async () => {
  const { feeds, calls } = source(route)
  const result = await feeds.weather('   ')
  assert.equal(result.ok, false)
  assert.equal(calls.length, 0)
})

test('when the source fails, the last good forecast stays on show, marked stale', async () => {
  let broken = false
  const { feeds, advance } = source((url) => (broken && url.includes('met.no') ? json({}, {}, 503) : route(url)))
  const good = await feeds.weather('Chennai')
  assert.equal(good.ok && good.stale, false)

  broken = true
  advance(40 * 60_000)
  const later = await feeds.weather('Chennai')
  assert.equal(later.ok, true, 'still something to show')
  if (later.ok) {
    assert.equal(later.stale, true, 'and it says it is old')
    assert.equal(later.data.now.temperature, 30)
  }
})

test('with nothing cached, a failure is a reason, never a number', async () => {
  const { feeds } = source((url) => (url.includes('met.no') ? json({}, {}, 500) : route(url)))
  const result = await feeds.weather('Chennai')
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.reason, /answered 500/)
})

test('being offline is said as offline', async () => {
  const { feeds } = source((url) => {
    if (url.includes('met.no')) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    return route(url)
  })
  const result = await feeds.weather('Chennai')
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.reason, /Offline/)
})

test('a failing source is left alone for a while rather than asked on every redraw', async () => {
  const { feeds, calls, advance } = source((url) => (url.includes('met.no') ? json({}, {}, 500) : route(url)))
  await feeds.weather('Chennai')
  await feeds.weather('Chennai')
  await feeds.weather('Chennai')
  assert.equal(calls.filter((c) => c.url.includes('met.no')).length, 1, 'backed off')

  advance(61_000)
  await feeds.weather('Chennai')
  assert.equal(calls.filter((c) => c.url.includes('met.no')).length, 2, 'and asks again once the wait has passed')
})

test('two widgets asking at the same moment share one request', async () => {
  const { feeds, calls } = source(route)
  await Promise.all([feeds.weather('Chennai'), feeds.weather('Chennai'), feeds.weather('Chennai')])
  assert.equal(calls.filter((c) => c.url.includes('met.no')).length, 1)
})

test('a stale forecast is refreshed with If-Modified-Since, and an unchanged one is not re-read', async () => {
  const { feeds, calls, advance } = source((url, n) => {
    if (url.includes('met.no') && n > 2) return new Response(null, { status: 304 })
    return url.includes('met.no') ? json(FORECAST, { 'last-modified': 'Wed, 17 Sep 2026 10:00:00 GMT' }) : route(url)
  })
  await feeds.weather('Chennai')
  advance(40 * 60_000)
  const again = await feeds.weather('Chennai')
  assert.equal(again.ok, true)
  const refresh = calls.filter((c) => c.url.includes('met.no'))[1]
  assert.equal(refresh.headers['If-Modified-Since'], 'Wed, 17 Sep 2026 10:00:00 GMT')
})

// ---------------------------------------------------------------- feeds

test('a feed is fetched, read, and cached', async () => {
  const { feeds, calls } = source(route)
  const result = await feeds.feed('https://wire.example/rss')
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.data.items[0].title, 'One')
  await feeds.feed('https://wire.example/rss')
  assert.equal(calls.length, 1)
})

test('an address that is not a feed is said to be not a feed', async () => {
  const { feeds } = source(() => new Response('<!doctype html><html><body>hi</body></html>'))
  const result = await feeds.feed('https://example.com/')
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.reason, /not an RSS or Atom feed/)
})

test('a feed may not point at this computer or a private network', async () => {
  const { feeds, calls } = source(route)
  for (const url of ['http://localhost/rss', 'http://127.0.0.1:8080/feed', 'http://192.168.1.1/rss', 'http://10.0.0.5/x', 'http://[::1]/feed', 'file:///C:/feed.xml']) {
    const result = await feeds.feed(url)
    assert.equal(result.ok, false, url)
  }
  assert.equal(calls.length, 0, 'none of them was fetched')
})

test('a feed that is far too large is refused rather than read', async () => {
  const huge = `<rss><channel><title>x</title>${'<item><title>a</title><link>https://a.example/</link></item>'.repeat(60_000)}</channel></rss>`
  const { feeds } = source(() => new Response(huge))
  const result = await feeds.feed('https://big.example/rss')
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.reason, /too large/)
})

test('private addresses are recognised', () => {
  for (const host of ['localhost', 'printer.local', '127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.0.10', '169.254.1.1', '::1', 'fd00::1']) assert.equal(isPrivateHost(host), true, host)
  for (const host of ['example.com', '8.8.8.8', '172.32.0.1', 'feeds.bbci.co.uk']) assert.equal(isPrivateHost(host), false, host)
})

test('a public feed that redirects to a private address is refused at the redirect', async () => {
  const { feeds, calls } = source((url) =>
    url.startsWith('https://sneaky.example') ? new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:9000/admin' } }) : new Response(RSS)
  )
  const result = await feeds.feed('https://sneaky.example/rss')
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.reason, /redirects somewhere Orbis will not fetch from/)
  assert.ok(!calls.some((c) => c.url.includes('127.0.0.1')), 'the private address was never requested')
})

test('an ordinary redirect to another public address is followed', async () => {
  const { feeds } = source((url) => (url.startsWith('https://old.example') ? new Response(null, { status: 301, headers: { location: 'https://new.example/rss' } }) : new Response(RSS)))
  const result = await feeds.feed('https://old.example/rss')
  assert.equal(result.ok, true)
})
