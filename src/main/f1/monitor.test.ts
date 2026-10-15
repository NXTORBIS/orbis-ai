import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { emptyPrefs, type F1Prefs } from '../../shared/f1/extras.ts'
import type { F1Answer, F1Race, F1RaceResult } from '../../shared/f1/types.ts'
import { F1Monitor, PrefsStore } from './monitor.ts'

const src = { provider: 'jolpica' as const, url: 'x', retrievedAt: '2026-10-15T00:00:00.000Z' }
const ok = <T,>(data: T): F1Answer<T> => ({ ok: true, data, source: src, freshness: 'fresh' })
const race = (round: number, startsAt: string, sessions: { name: string; startsAt: string | null }[] = []): F1Race => ({ season: 2026, round, name: `GP ${round}`, circuitId: 'c', circuitName: 'Circuit', locality: null, country: null, startsAt, sessions })
const result = (round: number, winner: string, watched?: string): F1RaceResult => ({
  race: race(round, '2026-10-11T12:00:00Z'),
  rows: [
    { position: 1, positionText: '1', driver: { id: 'w', code: null, number: null, name: winner, nationality: null }, constructor: { id: null, name: 'T', colour: null }, grid: 1, laps: 50, status: 'Finished', points: 25, timeText: null, fastestLap: null },
    { position: 2, positionText: '2', driver: { id: watched ?? 'z', code: null, number: null, name: 'Second', nationality: null }, constructor: { id: null, name: 'T', colour: null }, grid: 2, laps: 50, status: 'Finished', points: 18, timeText: null, fastestLap: null }
  ]
})

function rig(prefs: F1Prefs, now: number) {
  const st = { cal: [] as F1Race[], last: null as F1RaceResult | null, prefs, now, sent: [] as { type: string; fields: Record<string, string> }[] }
  const m = new F1Monitor({
    service: { schedule: async () => ok(st.cal), results: async () => ok(st.last) },
    prefs: async () => st.prefs,
    publish: (e) => void st.sent.push(e),
    now: () => st.now
  })
  return { m, st }
}

test('a session is announced once, inside its lead time, and not before or long after', async () => {
  const { m, st } = rig(emptyPrefs(), Date.parse('2026-10-18T11:00:00Z'))
  st.cal = [race(20, '2026-10-18T12:00:00Z', [{ name: 'Qualifying', startsAt: '2026-10-17T12:00:00Z' }])]
  await m.tick()
  assert.equal(st.sent.length, 0)
  st.now = Date.parse('2026-10-18T11:50:00Z')
  await m.tick()
  await m.tick()
  assert.equal(st.sent.filter((e) => e.type === 'f1.session').length, 1)
  assert.equal(st.sent[0].fields.session, 'Race')
  st.now = Date.parse('2026-10-18T13:00:00Z')
  await m.tick()
  assert.equal(st.sent.length, 1)
})

test('a date with no time and a switched-off alert say nothing', async () => {
  const a = rig(emptyPrefs(), Date.parse('2026-10-18T11:50:00Z'))
  a.st.cal = [race(20, '2026-10-18')]
  await a.m.tick()
  assert.equal(a.st.sent.length, 0)
  const b = rig({ ...emptyPrefs(), alerts: { sessions: false, results: true } }, Date.parse('2026-10-18T11:50:00Z'))
  b.st.cal = [race(20, '2026-10-18T12:00:00Z')]
  await b.m.tick()
  assert.equal(b.st.sent.length, 0)
})

test('a result already out at startup is silent; the next one is announced once, with the watched driver', async () => {
  const { m, st } = rig({ ...emptyPrefs(), watchlist: ['lando'] }, Date.parse('2026-10-18T20:00:00Z'))
  st.last = result(19, 'Old Winner')
  await m.tick()
  assert.equal(st.sent.length, 0)
  st.last = result(20, 'New Winner', 'lando')
  await m.tick()
  await m.tick()
  assert.equal(st.sent.length, 1)
  assert.equal(st.sent[0].type, 'f1.results')
  assert.match(st.sent[0].fields.summary, /New Winner/)
  assert.match(st.sent[0].fields.summary, /Watching: Second 2/)
})

test('prefs: written beside-and-renamed, two quick changes both land, unreadable kept aside', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'f1prefs-'))
  const path = join(dir, 'f1-prefs.json')
  const s = new PrefsStore(async () => path)
  await Promise.all([s.update((p) => ({ ...p, watchlist: ['a_b'] })), s.update((p) => ({ ...p, leadMinutes: 30 }))])
  const back = await s.read()
  assert.deepEqual(back.watchlist, ['a_b'])
  assert.equal(back.leadMinutes, 30)
  assert.deepEqual(readdirSync(dir), ['f1-prefs.json'])
  writeFileSync(path, 'nope{')
  assert.deepEqual(await s.read(), emptyPrefs())
  assert.ok(readdirSync(dir).some((n) => n.includes('unreadable')))
})
