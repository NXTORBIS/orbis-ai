import assert from 'node:assert/strict'
import { test } from 'node:test'
import { arrangeLineup, byLocalDay, narrative, replaySteps, rollingPoints, seasonInsights } from './insights.ts'
import type { FbMatch } from './types.ts'

function m(id: number, h: string, a: string, hs: number | null, as: number | null, over: Partial<FbMatch> = {}): FbMatch {
  return {
    key: `openligadb:${id}`,
    provider: 'openligadb',
    competition: { id: 'openligadb:bl1', name: 'L', season: '2025' },
    round: null,
    kickoff: new Date(Date.UTC(2025, 8, id)).toISOString(),
    home: { id: `openligadb:${h}`, name: h, short: null, badge: null },
    away: { id: `openligadb:${a}`, name: a, short: null, badge: null },
    status: 'finished',
    statusRaw: null,
    liveBasis: null,
    minute: null,
    score: { home: hs, away: as },
    halfTime: null,
    events: [],
    eventsAvailable: true,
    venue: null,
    sourceUpdatedAt: null,
    ...over
  }
}
const goal = (id: string, minute: number | null, side: 'home' | 'away' | null, player = 'P', kind: 'goal' | 'penalty-goal' | 'own-goal' = 'goal') => ({ id, kind, minute, side, player, scoreAfter: null, overtime: false, revoked: false })

test('narrative names only what is recorded', () => {
  const x = m(1, 'Eins', 'Zwei', 2, 1, { events: [goal('a', 10, 'home', 'Anna'), goal('b', 50, 'away', 'Bo'), goal('c', 88, 'home', 'Cy', 'penalty-goal')], halfTime: { home: 1, away: 0 } })
  const t = narrative(x)
  assert.match(t, /Eins 2–1 Zwei \(full-time\)/)
  assert.match(t, /Eins scored first in minute 10, through Anna/)
  assert.doesNotMatch(t, /changed hands/)
  const swap = narrative(m(2, 'Eins', 'Zwei', 1, 2, { events: [goal('a', 10, 'home'), goal('b', 50, 'away'), goal('c', 70, 'away')] }))
  assert.match(swap, /lead changed hands 1 time/)
  assert.match(t, /1 goal came from minute 85 on/)
  assert.match(t, /Half-time: 1–0/)
  assert.doesNotMatch(t, /dramatic|stunning|deserved/)
})

test('narrative: no goal list, no score, not started, postponed', () => {
  assert.match(narrative(m(1, 'A', 'B', 1, 0, { eventsAvailable: false })), /without a goal list/)
  assert.match(narrative(m(1, 'A', 'B', null, null)), /no score/)
  assert.match(narrative(m(1, 'A', 'B', null, null, { status: 'scheduled' })), /not started/)
  assert.match(narrative(m(1, 'A', 'B', null, null, { status: 'postponed' })), /postponed/)
  assert.match(narrative(m(1, 'A', 'B', 3, 1, { events: [goal('a', 5, 'home')] })), /Only 1 of 4 goals are listed/)
})

test('replay: kick-off then a step per goal, the score walking; refused when a goal cannot be placed', () => {
  const x = m(1, 'A', 'B', 2, 1, { events: [goal('a', 10, 'home'), goal('b', 50, 'away'), goal('c', 88, 'home')] })
  const s = replaySteps(x)
  assert.deepEqual(s.map((q) => `${q.score.home}-${q.score.away}`), ['0-0', '1-0', '1-1', '2-1'])
  assert.deepEqual(replaySteps(m(1, 'A', 'B', 1, 0, { eventsAvailable: false })), [])
  assert.deepEqual(replaySteps(m(1, 'A', 'B', 1, 0, { events: [goal('a', 10, null)] })), [])
})

test('insights need five matches, and name their basis', () => {
  assert.deepEqual(seasonInsights([m(1, 'A', 'B', 1, 0)]), [])
  const ms = [m(1, 'A', 'B', 5, 0), m(2, 'B', 'C', 1, 1), m(3, 'C', 'A', 0, 2), m(4, 'A', 'D', 3, 1), m(5, 'D', 'B', 0, 0), m(6, 'A', 'C', 2, 0)]
  const i = seasonInsights(ms)
  assert.ok(i.some((x) => /Highest-scoring match: A 5–0 B/.test(x.text)))
  assert.ok(i.some((x) => /A have won their last 4 matches/.test(x.text)))
  assert.ok(i.every((x) => x.basis.length > 0))
})

test('rolling points: a window must be full', () => {
  const r = rollingPoints([{ result: 'W' }, { result: 'W' }, { result: 'L' }, { result: 'D' }], 3)
  assert.deepEqual(r, [{ n: 3, ppm: 2 }, { n: 4, ppm: 4 / 3 }])
  assert.deepEqual(rollingPoints([{ result: 'W' }], 5), [])
})

test('lineup arrangement: goalkeeper at own end, same-role players fanned out, unreadable roles not drawn, the away side mirrored', () => {
  const p = (name: string, position: string | null, side: 'home' | 'away' = 'home', substitute = false) => ({ name, position, side, substitute, number: 1, team: null })
  const r = arrangeLineup([p('K', 'Goalkeeper'), p('C1', 'Centre-Back'), p('C2', 'Centre-Back'), p('X', 'Mystery'), p('S', 'Centre-Back', 'home', true), p('Far', 'Goalkeeper', 'away')], 'home')
  assert.equal(r.placed.length, 3)
  assert.equal(r.unplaced.length, 1)
  const [c1, c2] = r.placed.filter((x) => x.player.name.startsWith('C'))
  assert.notEqual(c1.y, c2.y)
  assert.equal(r.placed.find((x) => x.player.name === 'K')?.x, 6)
  assert.equal(arrangeLineup([p('Far', 'Goalkeeper', 'away')], 'away').placed[0].x, 94)
})

test('calendar groups by the viewer’s day, not the provider’s UTC day', () => {
  const late = m(1, 'A', 'B', null, null, { kickoff: '2026-10-16T23:30:00.000Z', status: 'scheduled' })
  assert.deepEqual([...byLocalDay([late], 'UTC').keys()], ['2026-10-16'])
  assert.deepEqual([...byLocalDay([late], 'Asia/Kolkata').keys()], ['2026-10-17'])
})
