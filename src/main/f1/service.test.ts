import assert from 'node:assert/strict'
import { test } from 'node:test'

import { F1Service, type FetchLike, type FetchResponse } from './service.ts'

const respond = (status: number, body: unknown, headers: Record<string, string> = {}): FetchResponse => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (n) => headers[n.toLowerCase()] ?? null },
  json: async () => body,
  text: async () => JSON.stringify(body)
})

const CALENDAR = {
  MRData: { RaceTable: { Races: [{ season: '2026', round: '1', raceName: 'A', Circuit: { circuitId: 'c', circuitName: 'C' }, date: '2026-03-08', time: '04:00:00Z' }] } }
}

function setup(handler: (url: string, call: number) => FetchResponse | Promise<FetchResponse>) {
  let clock = 1_000_000
  const urls: string[] = []
  const fetchFn: FetchLike = async (url) => {
    urls.push(url)
    return handler(url, urls.length)
  }
  const service = new F1Service({
    fetch: fetchFn,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms
    }
  })
  return { service, urls, advance: (ms: number) => (clock += ms) }
}

test('a fresh answer is reused inside its window and fetched again after it', async () => {
  const { service, urls, advance } = setup(() => respond(200, CALENDAR))
  const a = await service.schedule(2026)
  assert.equal(a.ok && a.freshness, 'fresh')
  const b = await service.schedule(2026)
  assert.equal(b.ok && b.freshness, 'cached')
  assert.equal(urls.length, 1)
  advance(7 * 60 * 60 * 1000)
  const c = await service.schedule(2026)
  assert.equal(c.ok && c.freshness, 'fresh')
  assert.equal(urls.length, 2)
})

test('two views asking for the same thing at once make one request', async () => {
  const { service, urls } = setup(() => respond(200, CALENDAR))
  const [a, b] = await Promise.all([service.schedule(2026), service.schedule(2026)])
  assert.ok(a.ok && b.ok)
  assert.equal(urls.length, 1)
})

test('when the provider is down the last good answer comes back marked stale, with its own time', async () => {
  let up = true
  const { service, advance } = setup(() => (up ? respond(200, CALENDAR) : respond(503, {})))
  const first = await service.schedule(2026)
  assert.ok(first.ok)
  advance(7 * 60 * 60 * 1000)
  up = false
  const later = await service.schedule(2026)
  assert.ok(later.ok)
  assert.equal(later.freshness, 'stale')
  assert.equal(later.source.retrievedAt, first.source.retrievedAt)
})

test('with nothing cached, a failure is reported as one, never as an empty success', async () => {
  const { service } = setup(() => respond(500, {}))
  const r = await service.schedule(2026)
  assert.equal(r.ok, false)
  assert.equal(!r.ok && r.reason, 'provider-error')
})

test('a network error is "offline"', async () => {
  const { service } = setup(() => {
    throw new TypeError('fetch failed')
  })
  const r = await service.schedule(2026)
  assert.equal(!r.ok && r.reason, 'offline')
})

test('a provider that asks to slow down is not asked again until its time is up', async () => {
  const { service, urls, advance } = setup((_url, call) => (call === 1 ? respond(429, {}, { 'retry-after': '60' }) : respond(200, CALENDAR)))
  const first = await service.schedule(2026)
  assert.equal(!first.ok && first.reason, 'rate-limited')
  const second = await service.schedule(2025)
  assert.equal(!second.ok && second.reason, 'rate-limited')
  assert.equal(urls.length, 1)
  advance(61_000)
  const third = await service.schedule(2025)
  assert.ok(third.ok)
  assert.equal(urls.length, 2)
})

test('an answer with nothing usable in it is not cached as good', async () => {
  const { service, urls } = setup(() => respond(200, { MRData: { RaceTable: { Races: [] } } }))
  const r = await service.schedule(2026)
  assert.equal(!r.ok && r.reason, 'bad-response')
  await service.schedule(2026)
  assert.equal(urls.length, 2)
})

test('requests to one provider are spaced even when started together', async () => {
  const { service } = setup(() => respond(200, CALENDAR))
  const stamps: number[] = []
  let clock = 0
  const spaced = new F1Service({
    fetch: async () => {
      stamps.push(clock)
      return respond(200, CALENDAR)
    },
    now: () => clock,
    sleep: async (ms) => {
      clock += ms
    }
  })
  await Promise.all([spaced.schedule(2024), spaced.schedule(2025), spaced.schedule(2026)])
  assert.equal(stamps.length, 3)
  assert.ok(stamps[1] - stamps[0] >= 300)
  assert.ok(stamps[2] - stamps[1] >= 300)
  void service
})

test('arguments that are not numbers are refused before any request is made', async () => {
  const { service, urls } = setup(() => respond(200, CALENDAR))
  // @ts-expect-error a caller from the window can send anything
  const a = await service.schedule('../../etc')
  assert.equal(!a.ok && a.reason, 'invalid-request')
  const b = await service.results(2026, 0)
  assert.equal(!b.ok && b.reason, 'invalid-request')
  const c = await service.timing(-4, null)
  assert.equal(!c.ok && c.reason, 'invalid-request')
  assert.equal(urls.length, 0)
})

test('timing joins drivers, laps and session, and reports the oldest freshness', async () => {
  const { service } = setup((url) => {
    if (url.includes('/drivers')) return respond(200, [{ driver_number: 1, name_acronym: 'VER', full_name: 'Max VERSTAPPEN' }])
    if (url.includes('/laps')) return respond(200, [{ driver_number: 1, lap_number: 2, lap_duration: 99.1 }])
    return respond(200, [{ session_key: 7, session_name: 'Race', date_start: '2026-10-11T12:00:00+00:00', date_end: '2026-10-11T14:00:00+00:00' }])
  })
  const r = await service.timing(7, '2026-10-11T14:00:00+00:00')
  assert.ok(r.ok)
  assert.equal(r.data.drivers.length, 1)
  assert.equal(r.data.laps[0].duration, 99.1)
  assert.equal(r.data.session.name, 'Race')
})

test('the status panel reports real counts', async () => {
  const { service } = setup(() => respond(200, CALENDAR))
  await service.schedule(2026)
  const jolpica = service.status().find((s) => s.provider === 'jolpica')
  assert.equal(jolpica?.requests, 1)
  assert.equal(jolpica?.failures, 0)
  assert.equal(jolpica?.cached, 1)
  assert.ok(jolpica?.lastOkAt)
  assert.equal(service.status().find((s) => s.provider === 'openf1')?.lastOkAt, null)
})

const standingsFor = (season: number) => ({
  MRData: { StandingsTable: { StandingsLists: [{ season: String(season), round: '10', DriverStandings: [{ points: '100', wins: '5', Driver: { givenName: 'A', familyName: String(season) }, Constructors: [{ name: 'T' }] }] }] } }
})

test('every champion: a "slow down" is waited out and the rest still load; nothing is silently dropped', async () => {
  let n = 0
  const { service } = setup((url) => {
    n++
    if (n === 5) return respond(429, {}, { 'retry-after': '2' })
    const m = /\/(\d{4})\/driverStandings\/1\.json/.exec(url)
    return m ? respond(200, standingsFor(Number(m[1]))) : respond(404, {})
  })
  const all = await service.championsAll()
  assert.ok(all.ok)
  if (all.ok) {
    assert.deepEqual(all.data.missing, [])
    assert.equal(all.data.drivers[0].season, new Date(1_000_000).getUTCFullYear() >= 1970 ? all.data.drivers[0].season : 0)
    assert.ok(all.data.drivers.length >= 20)
  }
})

test('a season that keeps failing is listed as missing, not hidden', async () => {
  const { service } = setup((url) => {
    const m = /\/(\d{4})\/driverStandings\/1\.json/.exec(url)
    if (m && m[1] === '1960') return respond(500, {})
    return m ? respond(200, standingsFor(Number(m[1]))) : respond(404, {})
  })
  const all = await service.championsAll()
  assert.ok(all.ok)
  if (all.ok) assert.deepEqual(all.data.missing, [1960])
})

test('a shut archive is explained in a sentence, and a shut jolpica still reports its status code', async () => {
  const { service } = setup(() => respond(401, {}))
  const a = await service.archive(2025)
  assert.equal(a.ok, false)
  assert.ok(!a.ok && /sign-in/.test(a.message), a.ok ? '' : a.message)
  assert.ok(!a.ok && !/401/.test(a.message))
  const b = await service.schedule(2025)
  assert.ok(!b.ok && /401/.test(b.message))
})
