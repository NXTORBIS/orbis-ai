import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { emptyFollows, sanitizeFollows, type FbFollows } from '../../shared/football/follows.ts'
import type { FbAnswer, FbMatch } from '../../shared/football/types.ts'
import { FollowsStore } from './follows.ts'
import { FootballMonitor } from './monitor.ts'

function match(over: Partial<FbMatch> = {}): FbMatch {
  return {
    key: 'openligadb:1',
    provider: 'openligadb',
    competition: { id: 'openligadb:bl1', name: 'L', season: '2026' },
    round: null,
    kickoff: '2026-10-15T18:00:00.000Z',
    home: { id: 'openligadb:10', name: 'Eins', short: null, badge: null },
    away: { id: 'openligadb:20', name: 'Zwei', short: null, badge: null },
    status: 'second-half',
    statusRaw: null,
    liveBasis: 'reported',
    minute: 50,
    score: { home: 0, away: 0 },
    halfTime: null,
    events: [],
    eventsAvailable: false,
    venue: null,
    sourceUpdatedAt: null,
    ...over
  }
}
const ok = <T,>(data: T): FbAnswer<T> => ({ ok: true, data, sources: [], freshness: 'fresh', notes: [] })

function rig(follows: FbFollows, now = Date.parse('2026-10-15T18:30:00Z')) {
  const state = { live: [match()], one: new Map<string, FbMatch>(), sent: [] as { type: string; fields: Record<string, string> }[], done: [] as string[], follows, now }
  const m = new FootballMonitor({
    service: { live: async () => ok(state.live), match: async (k) => ok(state.one.get(k) ?? null) },
    follows: async () => state.follows,
    publish: (e) => void state.sent.push(e),
    reminderDone: async (k, mins) => void state.done.push(`${k}:${mins}`),
    now: () => state.now
  })
  return { m, state }
}
const f = (over: Partial<FbFollows>): FbFollows => ({ ...emptyFollows(), ...over })
const notStarted = { status: 'scheduled' as const, liveBasis: null, minute: null, score: { home: null, away: null } }

test('the first sight of a followed match says nothing; a goal after it says one thing, once', async () => {
  const { m, state } = rig(f({ teams: [{ id: 'openligadb:10', name: 'Eins' }] }))
  await m.tick()
  assert.equal(state.sent.length, 0)
  state.live = [match({ score: { home: 1, away: 0 } })]
  await m.tick()
  await m.tick()
  assert.equal(state.sent.length, 1)
  assert.equal(state.sent[0].type, 'football.goal')
  assert.match(state.sent[0].fields.summary, /1–0/)
})

test('matches nobody follows are never announced, and a switched-off alert is silent', async () => {
  const a = rig(f({ teams: [{ id: 'openligadb:99', name: 'Other' }] }))
  await a.m.tick()
  a.state.live = [match({ score: { home: 1, away: 0 } })]
  await a.m.tick()
  assert.equal(a.state.sent.length, 0)
  const b = rig(f({ teams: [{ id: 'openligadb:10', name: 'Eins' }], alerts: { goals: false, kickoff: true, fulltime: true } }))
  await b.m.tick()
  b.state.live = [match({ score: { home: 1, away: 0 } })]
  await b.m.tick()
  assert.equal(b.state.sent.length, 0)
})

test('kick-off and full-time are said once each', async () => {
  const { m, state } = rig(f({ pins: [{ key: 'openligadb:1', title: 'Eins – Zwei' }] }))
  state.live = [match(notStarted)]
  await m.tick()
  state.live = [match()]
  await m.tick()
  state.live = [match({ status: 'finished', liveBasis: null, minute: null, score: { home: 2, away: 1 } })]
  await m.tick()
  await m.tick()
  const kinds = state.sent.map((e) => e.type)
  assert.equal(kinds.filter((k) => k === 'football.kickoff').length, 1)
  assert.equal(kinds.filter((k) => k === 'football.fulltime').length, 1)
})

test('a reminder fires when its time comes, once, and is then removed; a postponed match cancels it', async () => {
  const rem = { key: 'openligadb:5', title: 'Eins – Zwei', kickoff: '2026-10-15T19:00:00.000Z', minutes: 15 }
  const a = rig(f({ reminders: [rem] }), Date.parse('2026-10-15T18:30:00Z'))
  a.state.live = []
  a.state.one.set('openligadb:5', match({ key: 'openligadb:5', kickoff: rem.kickoff, ...notStarted }))
  await a.m.tick()
  assert.equal(a.state.sent.length, 0)
  a.state.now = Date.parse('2026-10-15T18:46:00Z')
  await a.m.tick()
  await a.m.tick()
  assert.equal(a.state.sent.filter((e) => e.type === 'football.reminder').length, 1)
  assert.deepEqual(a.state.done, ['openligadb:5:15'])
  const b = rig(f({ reminders: [rem] }), Date.parse('2026-10-15T18:46:00Z'))
  b.state.live = []
  b.state.one.set('openligadb:5', match({ key: 'openligadb:5', status: 'postponed', kickoff: rem.kickoff, liveBasis: null, minute: null }))
  await b.m.tick()
  assert.equal(b.state.sent.length, 0)
  assert.deepEqual(b.state.done, ['openligadb:5:15'])
})

test('nothing followed means nothing is even asked of the providers', async () => {
  let asked = 0
  const m = new FootballMonitor({ service: { live: async () => (asked++, ok([])), match: async () => ok(null) }, follows: async () => emptyFollows(), publish: () => undefined, reminderDone: async () => undefined })
  await m.tick()
  assert.equal(asked, 0)
})

test('follows are cleaned: bad ids, duplicates, odd reminder minutes and unknown tabs are dropped', () => {
  const c = sanitizeFollows({
    teams: [{ id: 'openligadb:1', name: 'A' }, { id: 'openligadb:1', name: 'dup' }, { id: '../x', name: 'bad' }, null],
    pins: [{ key: 'thesportsdb:9', title: 'T' }, { key: 'nope', title: 'x' }],
    reminders: [
      { key: 'openligadb:2', title: 'R', kickoff: '2026-10-15T19:00:00Z', minutes: 15 },
      { key: 'openligadb:2', title: 'R', kickoff: '2026-10-15T19:00:00Z', minutes: 7 }
    ],
    alerts: { goals: false },
    views: [
      { id: 'a', name: 'v', tab: 'table', league: 'openligadb:bl1', season: '2025' },
      { id: 'b', name: 'v', tab: 'evil', league: 'openligadb:bl1', season: '2025' }
    ]
  })
  assert.equal(c.teams.length, 1)
  assert.equal(c.pins.length, 1)
  assert.equal(c.reminders.length, 1)
  assert.deepEqual(c.alerts, { goals: false, kickoff: true, fulltime: true })
  assert.equal(c.views.length, 1)
  assert.deepEqual(sanitizeFollows('garbage'), emptyFollows())
})

test('the follows file is written beside-and-renamed, two quick changes both land, and an unreadable file is kept aside', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fbfollows-'))
  const path = join(dir, 'football-follows.json')
  const store = new FollowsStore(async () => path)
  await Promise.all([store.update((x) => ({ ...x, teams: [{ id: 'openligadb:1', name: 'A' }] })), store.update((x) => ({ ...x, pins: [{ key: 'openligadb:2', title: 'P' }] }))])
  const back = await store.read()
  assert.equal(back.teams.length, 1)
  assert.equal(back.pins.length, 1)
  assert.deepEqual(readdirSync(dir), ['football-follows.json'])
  writeFileSync(path, '{ not json')
  assert.deepEqual(await store.read(), emptyFollows())
  assert.ok(readdirSync(dir).some((n) => n.includes('unreadable')))
})
