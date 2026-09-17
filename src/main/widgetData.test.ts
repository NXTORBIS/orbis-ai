import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ago,
  greeting,
  isTimeZone,
  mergeFeeds,
  parseFeed,
  parseFeedList,
  parseWorldClocks,
  partOfDay,
  plainText,
  readMetForecast,
  readPlace,
  recentSites,
  safeLink,
  skyWords,
  temperatureIn,
  timeIn,
  zoneOffsetMinutes
} from '../shared/widgetData.ts'

// ---------------------------------------------------------------- recent sites

test('recent sites are places, newest first, one per site', () => {
  const sites = recentSites([
    { url: 'https://github.com/a', title: 'A', visitedAt: 1 },
    { url: 'https://www.github.com/b', title: 'B', visitedAt: 5 },
    { url: 'https://en.wikipedia.org/wiki/X', title: 'X', visitedAt: 3 },
    { url: 'orbis://search?q=x', title: 'Search', visitedAt: 9 },
    { url: 'not a url', title: '?', visitedAt: 10 }
  ])
  assert.deepEqual(sites.map((s) => s.host), ['github.com', 'en.wikipedia.org'])
  assert.equal(sites[0].title, 'B', 'the newest page stands for the site')
})

test('a page with no title is named by its site rather than left blank', () => {
  assert.equal(recentSites([{ url: 'https://example.com/', title: '  ', visitedAt: 1 }])[0].title, 'example.com')
})

test('no history means no recent sites, not invented ones', () => {
  assert.deepEqual(recentSites([]), [])
})

// ---------------------------------------------------------------- greeting

test('the greeting follows the hour on the person’s own clock', () => {
  const at = (h: number): Date => new Date(2026, 8, 17, h, 30)
  assert.equal(partOfDay(at(6)), 'morning')
  assert.equal(partOfDay(at(13)), 'afternoon')
  assert.equal(partOfDay(at(19)), 'evening')
  assert.equal(partOfDay(at(23)), 'night')
  assert.equal(partOfDay(at(3)), 'night')
  assert.equal(greeting(at(9), '  Nishanth '), 'Good morning, Nishanth')
  assert.equal(greeting(at(9)), 'Good morning', 'no name is no name, not a placeholder')
})

// ---------------------------------------------------------------- world clock

test('world clocks read from one typed line, and an unknown zone is reported rather than dropped', () => {
  const { clocks, unknown } = parseWorldClocks('Chennai=Asia/Kolkata, Europe/London\nTokyo = Asia/Tokyo; Atlantis=Ocean/Atlantis')
  assert.deepEqual(clocks, [
    { label: 'Chennai', zone: 'Asia/Kolkata' },
    { label: 'London', zone: 'Europe/London' },
    { label: 'Tokyo', zone: 'Asia/Tokyo' }
  ])
  assert.deepEqual(unknown, ['Ocean/Atlantis'])
  assert.equal(isTimeZone('America/New_York'), true)
  assert.equal(isTimeZone('Mars/Olympus'), false)
})

test('a zone’s offset is what it really is on that day, daylight saving included', () => {
  assert.equal(zoneOffsetMinutes('Asia/Kolkata', new Date('2026-01-15T12:00:00Z')), 330)
  assert.equal(zoneOffsetMinutes('Europe/London', new Date('2026-01-15T12:00:00Z')), 0)
  assert.equal(zoneOffsetMinutes('Europe/London', new Date('2026-07-15T12:00:00Z')), 60, 'British Summer Time')
  assert.equal(zoneOffsetMinutes('America/New_York', new Date('2026-07-15T12:00:00Z')), -240)
})

test('the time in a zone is formatted for that zone, not for here', () => {
  const at = new Date('2026-09-17T12:00:00Z')
  const tokyo = timeIn('Asia/Tokyo', at, false)
  assert.match(tokyo.time, /21:00/)
})

// ---------------------------------------------------------------- weather

const met = (entries: { time: string; t: number; symbol?: string; rh?: number; wind?: number }[]) => ({
  properties: {
    meta: { updated_at: '2026-09-17T10:00:00Z' },
    timeseries: entries.map((e) => ({
      time: e.time,
      data: {
        instant: { details: { air_temperature: e.t, relative_humidity: e.rh, wind_speed: e.wind } },
        ...(e.symbol ? { next_1_hours: { summary: { symbol_code: e.symbol } } } : {})
      }
    }))
  }
})

test('a MET Norway forecast is read into now, the day’s range and the next hours', () => {
  const now = Date.parse('2026-09-17T10:30:00Z')
  const weather = readMetForecast(
    met([
      { time: '2026-09-17T10:00:00Z', t: 31.46, symbol: 'partlycloudy_day', rh: 70.2, wind: 3.14 },
      { time: '2026-09-17T11:00:00Z', t: 33, symbol: 'rainshowers_day' },
      { time: '2026-09-17T12:00:00Z', t: 34.2, symbol: 'heavyrainandthunder' },
      { time: '2026-09-18T02:00:00Z', t: 26, symbol: 'clearsky_night' },
      { time: '2026-09-18T11:00:00Z', t: 40, symbol: 'clearsky_day' }
    ]),
    'Chennai',
    now
  )
  assert.ok(weather)
  assert.equal(weather.now.temperature, 31.5)
  assert.equal(weather.now.condition, 'Partly cloudy')
  assert.equal(weather.now.humidity, 70)
  assert.equal(weather.now.windSpeed, 3.1)
  assert.equal(weather.high, 34.2, 'within the next 24 hours, not the day after')
  assert.equal(weather.low, 26)
  assert.deepEqual(weather.hours.map((h) => h.condition), ['Showers', 'Heavy rain and thunder', 'Clear', 'Clear'])
  assert.match(weather.attribution, /MET Norway/)
})

test('a forecast that cannot be read is no forecast, never a partial made-up one', () => {
  assert.equal(readMetForecast(null, 'X'), null)
  assert.equal(readMetForecast({}, 'X'), null)
  assert.equal(readMetForecast({ properties: { timeseries: [] } }, 'X'), null)
  assert.equal(readMetForecast({ properties: { timeseries: [{ time: '2026-01-01T00:00:00Z', data: { instant: { details: {} } } }] } }, 'X'), null)
})

test('an unfamiliar sky is called unknown rather than guessed', () => {
  assert.equal(skyWords('clearsky_polartwilight'), 'Clear')
  assert.equal(skyWords('volcanicash'), 'Unknown')
})

test('temperatures are shown in the unit the person chose', () => {
  assert.equal(temperatureIn(31.5, 'c'), '32°C')
  assert.equal(temperatureIn(0, 'f'), '32°F')
})

test('a place is read from the geocoder, or refused when it is not a place', () => {
  assert.deepEqual(readPlace([{ lat: '13.08268', lon: '80.270718', name: 'Chennai', display_name: 'Chennai, Tamil Nadu, India' }]), { name: 'Chennai', lat: 13.0827, lon: 80.2707 })
  assert.equal(readPlace([]), null)
  assert.equal(readPlace([{ lat: '999', lon: '0' }]), null)
  assert.equal(readPlace({ error: 'no' }), null)
})

// ---------------------------------------------------------------- feeds

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Example &amp; News</title>
<item><title><![CDATA[Rover <b>lands</b> safely]]></title><link>https://news.example/rover</link><pubDate>Wed, 17 Sep 2026 09:00:00 GMT</pubDate></item>
<item><title>Evil &lt;script&gt;alert(1)&lt;/script&gt; headline</title><link>javascript:alert(1)</link></item>
<item><title>Undated story</title><link>https://news.example/undated</link></item>
<item><title><script>steal()</script>Market opens</title><link>https://news.example/market</link><pubDate>Wed, 17 Sep 2026 11:00:00 GMT</pubDate></item>
</channel></rss>`

test('an RSS feed becomes plain headlines with a source and a date', () => {
  const feed = parseFeed(RSS, 'fallback')
  assert.ok(feed)
  assert.equal(feed.title, 'Example & News')
  assert.deepEqual(feed.items.map((i) => i.title), ['Rover lands safely', 'Undated story', 'Market opens'])
  assert.equal(feed.items[0].source, 'Example & News', 'every headline says where it came from')
  assert.equal(feed.items[0].publishedAt, Date.parse('Wed, 17 Sep 2026 09:00:00 GMT'))
})

test('nothing in a feed can become a script or a dangerous link', () => {
  const feed = parseFeed(RSS, 'x')!
  const all = JSON.stringify(feed)
  assert.ok(!all.includes('javascript:'), 'a javascript: link is not a headline at all')
  assert.ok(!/steal|<script|<b>/i.test(all), 'scripts are dropped whole, tags removed')
  assert.equal(plainText('&lt;img src=x onerror=alert(1)&gt;'), 'img src=x onerror=alert(1)', 'decoded brackets do not come back as markup')
  for (const bad of ['javascript:alert(1)', 'data:text/html,<b>', 'file:///C:/secrets', 'vbscript:x']) assert.equal(safeLink(bad), null, bad)
})

test('an Atom feed is read too, preferring the alternate link', () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Blog</title>
  <entry><title>Post one</title><link rel="self" href="https://blog.example/self"/><link rel="alternate" href="https://blog.example/one"/><updated>2026-09-17T08:00:00Z</updated></entry>
  </feed>`
  const feed = parseFeed(atom, 'x')!
  assert.equal(feed.items[0].url, 'https://blog.example/one')
  assert.equal(feed.items[0].publishedAt, Date.parse('2026-09-17T08:00:00Z'))
})

test('something that is not a feed is not read as one', () => {
  assert.equal(parseFeed('<!doctype html><html><body>not a feed</body></html>', 'x'), null)
  assert.equal(parseFeed('', 'x'), null)
})

test('feeds merge newest first, without repeats, with undated stories after dated ones', () => {
  const feed = parseFeed(RSS, 'x')!
  const merged = mergeFeeds([feed, feed], 10)
  assert.deepEqual(merged.map((i) => i.title), ['Market opens', 'Rover lands safely', 'Undated story'])
})

test('the feed list setting keeps only real web addresses', () => {
  assert.deepEqual(parseFeedList('https://a.example/rss, javascript:x\nhttp://b.example/feed https://a.example/rss ftp://c'), ['https://a.example/rss', 'http://b.example/feed'])
})

test('cached data says how old it is', () => {
  const now = 1_000_000_000
  assert.equal(ago(now - 20_000, now), 'just now')
  assert.equal(ago(now - 12 * 60_000, now), '12 minutes ago')
  assert.equal(ago(now - 3 * 3_600_000, now), '3 hours ago')
})
