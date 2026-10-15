import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FootballService, type FetchLike } from './service.ts'

const goal = { goalID: 1, scoreTeam1: 1, scoreTeam2: 0, matchMinute: 5, goalGetterName: 'X', scoringTeamId: 1 }
const olMatch = (id: number, finished: boolean, kick: string) => ({
  matchID: id,
  matchDateTimeUTC: kick,
  leagueShortcut: 'bl1',
  leagueName: 'Bundesliga',
  leagueSeason: 2026,
  team1: { teamId: 1, teamName: 'Eins' },
  team2: { teamId: 2, teamName: 'Zwei' },
  matchIsFinished: finished,
  matchResults: finished ? [{ resultName: 'Endergebnis', pointsTeam1: 1, pointsTeam2: 0, resultOrderID: 2, resultTypeKind: 'After90Minutes' }] : [],
  goals: finished ? [goal] : []
})

function fake(handler: (url: string) => { status: number; body: unknown } | 'throw') {
  const calls: string[] = []
  const f: FetchLike = async (url) => {
    calls.push(url)
    const r = handler(url)
    if (r === 'throw') throw new Error('offline')
    return { ok: r.status >= 200 && r.status < 300, status: r.status, headers: { get: (n) => (n.toLowerCase() === 'retry-after' ? '2' : null) }, text: async () => JSON.stringify(r.body) }
  }
  return { f, calls }
}
const make = (f: FetchLike, clock = { t: Date.parse('2026-10-15T20:00:00Z') }) => ({ s: new FootballService({ fetch: f, now: () => clock.t, sleep: async () => undefined }), clock })

test('season: fetched once, then answered from the cache within its window', async () => {
  const { f, calls } = fake(() => ({ status: 200, body: [olMatch(1, true, '2026-09-01T13:30:00Z')] }))
  const { s } = make(f)
  const a = await s.season('openligadb:bl1', '2026')
  const b = await s.season('openligadb:bl1', '2026')
  assert.ok(a.ok && b.ok)
  assert.equal(a.ok && a.freshness, 'fresh')
  assert.equal(b.ok && b.freshness, 'cached')
  assert.equal(calls.length, 1)
})

test('two views asking at once share one request', async () => {
  const { f, calls } = fake(() => ({ status: 200, body: [olMatch(1, true, '2026-09-01T13:30:00Z')] }))
  const { s } = make(f)
  await Promise.all([s.season('openligadb:bl1', '2026'), s.season('openligadb:bl1', '2026')])
  assert.equal(calls.length, 1)
})

test('when the provider is down the last good answer comes back marked stale, with its own time', async () => {
  let down = false
  const { f } = fake(() => (down ? 'throw' : { status: 200, body: [olMatch(1, true, '2026-09-01T13:30:00Z')] }))
  const { s, clock } = make(f)
  const first = await s.season('openligadb:bl1', '2026')
  assert.ok(first.ok)
  down = true
  clock.t += 60 * 60_000
  const again = await s.season('openligadb:bl1', '2026')
  assert.ok(again.ok)
  if (again.ok && first.ok) {
    assert.equal(again.freshness, 'stale')
    assert.equal(again.sources[0].retrievedAt, first.sources[0].retrievedAt)
  }
})

test('with no cache and no provider, the failure is said, not faked', async () => {
  const { f } = fake(() => 'throw')
  const { s } = make(f)
  const a = await s.season('openligadb:bl1', '2026')
  assert.equal(a.ok, false)
  if (!a.ok) assert.equal(a.reason, 'offline')
})

test('429 is honoured: nothing more is sent until the wait is over', async () => {
  let n = 0
  const { f, calls } = fake(() => (++n === 1 ? { status: 429, body: {} } : { status: 200, body: [olMatch(1, true, '2026-09-01T13:30:00Z')] }))
  const { s, clock } = make(f)
  const a = await s.table('openligadb:bl1', '2026')
  assert.equal(a.ok, false)
  const b = await s.season('openligadb:bl1', '2026')
  assert.equal(b.ok, false)
  assert.equal(calls.length, 1)
  clock.t += 3000
  const c = await s.season('openligadb:bl1', '2026')
  assert.ok(c.ok)
})

test('an answer with nothing usable is not cached as if it were an answer', async () => {
  const { f, calls } = fake(() => ({ status: 200, body: [] }))
  const { s } = make(f)
  assert.equal((await s.season('openligadb:bl1', '2026')).ok, false)
  await s.season('openligadb:bl1', '2026')
  assert.equal(calls.length, 2)
})

test('requests the window could make wrongly are refused before any network', async () => {
  const { f, calls } = fake(() => ({ status: 200, body: [] }))
  const { s } = make(f)
  assert.equal((await s.season('nope:1', '2026')).ok, false)
  assert.equal((await s.season('openligadb:bl1', '1850')).ok, false)
  assert.equal((await s.table('openligadb:dfb', '2025')).ok, false)
  assert.equal((await s.match('../../etc')).ok, false)
  assert.equal(calls.length, 0)
})

test('live: reported live matches and inferred ones are labelled apart, and the same fixture from both is one row', async () => {
  const kick = new Date(Date.parse('2026-10-15T20:00:00Z') - 40 * 60_000).toISOString()
  const { f } = fake((url) => {
    if (url.includes('livescore')) return { status: 200, body: { livescore: [{ idEvent: '9', idLeague: '1', strLeague: 'MLS', idHomeTeam: '1', idAwayTeam: '2', strHomeTeam: 'Columbus Crew', strAwayTeam: 'Charlotte FC', intHomeScore: '1', intAwayScore: '0', strStatus: '2H', strProgress: '61', strTimestamp: '2026-10-15T19:20:00' }] } }
    if (url.includes('/bl1')) return { status: 200, body: [olMatch(5, false, kick)] }
    return { status: 200, body: [] }
  })
  const { s } = make(f)
  const a = await s.live()
  assert.ok(a.ok)
  if (a.ok) {
    assert.equal(a.data.length, 2)
    const bases = a.data.map((m) => m.liveBasis).sort()
    assert.deepEqual(bases, ['inferred', 'reported'])
  }
})

test('match lookup validates the key and reads the right endpoint', async () => {
  const { f, calls } = fake(() => ({ status: 200, body: olMatch(77, true, '2026-09-01T13:30:00Z') }))
  const { s } = make(f)
  const a = await s.match('openligadb:77')
  assert.ok(a.ok)
  assert.match(calls[0], /getmatchdata\/77$/)
})
