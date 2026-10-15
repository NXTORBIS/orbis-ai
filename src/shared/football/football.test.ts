import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LEAGUES, currentSeason, providerSeason } from './leagues.ts'
import {
  acceptStatus,
  clockLabel,
  computeTable,
  diffMatch,
  evaluateModel,
  freshnessLabel,
  goalTiming,
  headToHead,
  normalizeEvents,
  poissonOutcome,
  reconcileScore,
  resultDistribution,
  split,
  teamResults,
  topScorers
} from './logic.ts'
import { mapSportsDbStatus, normalizeOpenLigaMatch, normalizeOpenLigaTable, normalizeSportsDbMatch, normalizeSportsDbTable, utcIso } from './normalize.ts'
import type { FbMatch } from './types.ts'

const NOW = Date.parse('2026-10-15T20:00:00Z')

// Shapes below are copied from real responses (see docs/football.md), cut down.
const olFinished = {
  matchID: 77325,
  matchDateTimeUTC: '2025-10-25T13:30:00Z',
  leagueShortcut: 'bl1',
  leagueName: '1. Fußball-Bundesliga 2025/2026',
  leagueSeason: 2025,
  group: { groupName: '8. Spieltag' },
  team1: { teamId: 95, teamName: 'FC Augsburg', shortName: 'Augsburg' },
  team2: { teamId: 1635, teamName: 'RB Leipzig', shortName: 'Leipzig' },
  lastUpdateDateTime: '2025-10-25T21:45:48.153',
  matchIsFinished: true,
  matchResults: [
    { resultName: 'Halbzeit', pointsTeam1: 0, pointsTeam2: 4, resultOrderID: 1, resultTypeKind: 'HalfTime' },
    { resultName: 'Endergebnis', pointsTeam1: 0, pointsTeam2: 6, resultOrderID: 2, resultTypeKind: 'After90Minutes' }
  ],
  goals: [
    { goalID: 133444, scoreTeam1: 0, scoreTeam2: 1, matchMinute: 10, goalGetterName: 'Y. Diomande', scoringTeamId: 1635, isPenalty: false, isOwnGoal: false },
    { goalID: 133446, scoreTeam1: 0, scoreTeam2: 2, matchMinute: 18, goalGetterName: 'Romulo', scoringTeamId: 1635, isPenalty: true, isOwnGoal: false },
    { goalID: 133449, scoreTeam1: 0, scoreTeam2: 3, matchMinute: 22, goalGetterName: 'A. Nusa', scoringTeamId: 1635 }
  ]
}

function ol(over: Record<string, unknown> = {}): FbMatch {
  return normalizeOpenLigaMatch({ ...olFinished, ...over }, NOW) as FbMatch
}

test('OpenLigaDB: a finished match keeps its result, goal list, scorers and half-time', () => {
  const m = ol()
  assert.equal(m.status, 'finished')
  assert.deepEqual(m.score, { home: 0, away: 6 })
  assert.deepEqual(m.halfTime, { home: 0, away: 4 })
  assert.equal(m.events.length, 3)
  assert.equal(m.events[1].kind, 'penalty-goal')
  assert.equal(m.events[0].side, 'away')
  assert.equal(m.competition.id, 'openligadb:bl1')
  assert.equal(m.liveBasis, null)
})

test('OpenLigaDB has no live flag: an unfinished recent kickoff is inferred, marked so, and has no invented minute', () => {
  const kick = new Date(NOW - 50 * 60_000).toISOString()
  const m = ol({ matchIsFinished: false, matchDateTimeUTC: kick, matchResults: [], goals: [] })
  assert.equal(m.status, 'in-play')
  assert.equal(m.liveBasis, 'inferred')
  assert.equal(m.minute, null)
  assert.deepEqual(m.score, { home: 0, away: 0 })
  assert.match(clockLabel(m, NOW), /Probably under way/)
})

test('a match that has not started has no score (null), not 0-0', () => {
  const m = ol({ matchIsFinished: false, matchDateTimeUTC: new Date(NOW + 3600_000).toISOString(), matchResults: [], goals: [] })
  assert.equal(m.status, 'scheduled')
  assert.deepEqual(m.score, { home: null, away: null })
})

test('an old match the provider never marked finished is "unknown", not live and not a result', () => {
  const m = ol({ matchIsFinished: false, matchDateTimeUTC: new Date(NOW - 20 * 3600_000).toISOString(), matchResults: [], goals: [] })
  assert.equal(m.status, 'unknown')
  assert.equal(clockLabel(m, NOW), 'Result not recorded yet')
})

test('a record missing a team or id is refused, not half-built', () => {
  assert.equal(normalizeOpenLigaMatch({ ...olFinished, team2: null }, NOW), null)
  assert.equal(normalizeOpenLigaMatch({ ...olFinished, matchID: undefined }, NOW), null)
  assert.equal(normalizeOpenLigaMatch('nope', NOW), null)
})

test('OpenLigaDB table: position is the feed order, missing numbers drop the row', () => {
  const t = normalizeOpenLigaTable([
    { teamInfoId: 40, teamName: 'Bayern', points: 89, goals: 122, opponentGoals: 36, matches: 34, won: 28, lost: 1, draw: 5, goalDiff: 86 },
    { teamInfoId: 7, teamName: 'Dortmund', points: 70, goals: 80, opponentGoals: 50, matches: 34, won: 20, lost: 4, draw: 10 },
    { teamInfoId: 9, teamName: 'Broken', points: 'x' }
  ])
  assert.equal(t.length, 2)
  assert.equal(t[0].position, 1)
  assert.equal(t[1].goalDifference, 30)
})

const sdLive = {
  idEvent: '2407129',
  idLeague: '4346',
  strLeague: 'American Major League Soccer',
  idHomeTeam: '134152',
  idAwayTeam: '140078',
  strHomeTeam: 'Columbus Crew',
  strAwayTeam: 'Charlotte FC',
  intHomeScore: '0',
  intAwayScore: '1',
  strStatus: '1H',
  strProgress: '22',
  strTimestamp: '2026-10-14T23:30:00',
  updated: '2026-10-15 01:03:32'
}

test('TheSportsDB live row: reported status and minute, UTC kickoff, no goal list claimed', () => {
  const m = normalizeSportsDbMatch(sdLive) as FbMatch
  assert.equal(m.status, 'first-half')
  assert.equal(m.liveBasis, 'reported')
  assert.equal(m.minute, 22)
  assert.equal(m.kickoff, '2026-10-14T23:30:00.000Z')
  assert.equal(m.eventsAvailable, false)
  assert.deepEqual(m.score, { home: 0, away: 1 })
  assert.equal(reconcileScore(m).state, 'not-applicable')
  assert.equal(clockLabel(m, NOW), '22′')
})

test('TheSportsDB statuses: known words map, unknown stay unknown, postponed flag wins', () => {
  assert.equal(mapSportsDbStatus('HT'), 'half-time')
  assert.equal(mapSportsDbStatus('FT'), 'finished')
  assert.equal(mapSportsDbStatus('NS'), 'scheduled')
  assert.equal(mapSportsDbStatus('WEIRD'), 'unknown')
  assert.equal(mapSportsDbStatus(null), 'unknown')
  assert.equal(mapSportsDbStatus('NS', 'yes'), 'postponed')
  assert.equal(normalizeSportsDbMatch({ ...sdLive, strStatus: 'WEIRD' })?.liveBasis, null)
})

test('TheSportsDB table rows', () => {
  const t = normalizeSportsDbTable({ table: [{ idTeam: '1', strTeam: 'Arsenal', intRank: '1', intPlayed: '38', intWin: '26', intDraw: '7', intLoss: '5', intGoalsFor: '71', intGoalsAgainst: '27', intPoints: '85', strForm: 'WWWWW' }] })
  assert.equal(t[0].points, 85)
  assert.equal(t[0].goalDifference, 44)
  assert.equal(t[0].form, 'WWWWW')
})

test('timestamps: a zone-less provider time is read as UTC; garbage is null', () => {
  assert.equal(utcIso('2026-10-14T23:30:00'), '2026-10-14T23:30:00.000Z')
  assert.equal(utcIso('2026-10-15 01:03:32'), '2026-10-15T01:03:32.000Z')
  assert.equal(utcIso('soon'), null)
})

// ---- status, events, change detection -------------------------------------------------------------------------------------

test('a stale answer cannot reopen a finished match or move it back a period; a newer provider update can', () => {
  const fin = ol()
  const live = { ...fin, status: 'second-half' as const, sourceUpdatedAt: '2025-10-25T20:00:00.000Z' }
  assert.equal(acceptStatus(fin, live).accept, false)
  assert.equal(acceptStatus(fin, { ...live, sourceUpdatedAt: '2025-10-26T20:00:00.000Z' }).accept, true)
  const second = { ...fin, status: 'second-half' as const }
  assert.equal(acceptStatus(second, { ...fin, status: 'first-half' as const, sourceUpdatedAt: null }).accept, false)
  assert.equal(acceptStatus(second, { ...fin, status: 'unknown' as const }).accept, false)
})

test('events: the same goal twice is one; order is by minute', () => {
  const m = ol()
  const e = normalizeEvents([m.events[2], m.events[0], m.events[0], m.events[1]])
  assert.deepEqual(e.map((x) => x.minute), [10, 18, 22])
})

test('a goal entry that does not move the running score is marked, not counted', () => {
  const m = ol({ goals: [{ goalID: 1, scoreTeam1: 0, scoreTeam2: 0, matchMinute: 3, goalGetterName: 'P', scoringTeamId: 95 }, olFinished.goals[0]] })
  assert.equal(m.events[0].revoked, true)
  assert.equal(m.events[0].side, null)
  assert.equal(m.events[1].revoked, false)
})

test('score check: agrees, incomplete, conflict', () => {
  assert.equal(reconcileScore(ol({ goals: olFinished.goals.concat([{ goalID: 133450, scoreTeam1: 0, scoreTeam2: 4, matchMinute: 30, goalGetterName: 'x', scoringTeamId: 1635 }, { goalID: 133451, scoreTeam1: 0, scoreTeam2: 5, matchMinute: 40, goalGetterName: 'y', scoringTeamId: 1635 }, { goalID: 133452, scoreTeam1: 0, scoreTeam2: 6, matchMinute: 60, goalGetterName: 'z', scoringTeamId: 1635 }]) })).state, 'agrees')
  assert.equal(reconcileScore(ol()).state, 'incomplete')
  const over = ol()
  over.score = { home: 0, away: 1 }
  assert.equal(reconcileScore(over).state, 'conflict')
})

test('changes: first sight is not a goal; a new goal is one; a repeat is none; a falling score is a correction', () => {
  const a = ol({ matchIsFinished: false, matchDateTimeUTC: new Date(NOW - 30 * 60_000).toISOString(), matchResults: [], goals: [olFinished.goals[0]] })
  assert.deepEqual(diffMatch(null, a), [])
  const b = ol({ matchIsFinished: false, matchDateTimeUTC: new Date(NOW - 30 * 60_000).toISOString(), matchResults: [], goals: olFinished.goals.slice(0, 2) })
  const c1 = diffMatch(a, b)
  assert.equal(c1.length, 1)
  assert.equal(c1[0].kind, 'goal')
  assert.deepEqual(diffMatch(b, b), [])
  const down = { ...b, score: { home: 0, away: 1 }, events: [b.events[0]] }
  assert.equal(diffMatch(b, down)[0].kind, 'score-correction')
  const full = ol()
  assert.ok(diffMatch({ ...b, status: 'second-half' }, full).some((c) => c.kind === 'full-time'))
})

test('freshness words follow age and match state', () => {
  const m = ol({ matchIsFinished: false, matchDateTimeUTC: new Date(NOW - 30 * 60_000).toISOString(), matchResults: [], goals: [] })
  const at = (s: number) => new Date(NOW - s * 1000).toISOString()
  assert.equal(freshnessLabel({ freshness: 'fresh', retrievedAt: at(20), now: NOW, match: m }), 'live')
  assert.equal(freshnessLabel({ freshness: 'fresh', retrievedAt: at(200), now: NOW, match: m }), 'delayed')
  assert.equal(freshnessLabel({ freshness: 'fresh', retrievedAt: at(900), now: NOW, match: m }), 'stale')
  assert.equal(freshnessLabel({ freshness: 'stale', retrievedAt: at(5), now: NOW, match: m }), 'stale')
  assert.equal(freshnessLabel({ freshness: 'cached', retrievedAt: at(5), now: NOW, match: ol() }), 'final')
})

// ---- tables and analysis ---------------------------------------------------------------------------------------------------

function game(id: number, h: [number, string], a: [number, string], hs: number, as: number, minute = 10, day = id): FbMatch {
  return {
    key: `openligadb:${id}`,
    provider: 'openligadb',
    competition: { id: 'openligadb:bl1', name: 'L', season: '2025' },
    round: null,
    kickoff: new Date(Date.UTC(2025, 8, day)).toISOString(),
    home: { id: `openligadb:${h[0]}`, name: h[1], short: null, badge: null },
    away: { id: `openligadb:${a[0]}`, name: a[1], short: null, badge: null },
    status: 'finished',
    statusRaw: null,
    liveBasis: null,
    minute: null,
    score: { home: hs, away: as },
    halfTime: null,
    events: Array.from({ length: hs + as }, (_, i) => ({ id: `e${id}-${i}`, kind: 'goal' as const, minute: minute + i, side: i < hs ? ('home' as const) : ('away' as const), player: `P${id}-${i}`, scoreAfter: null, overtime: false, revoked: false })),
    eventsAvailable: true,
    venue: null,
    sourceUpdatedAt: null
  }
}
const A: [number, string] = [1, 'A']
const B: [number, string] = [2, 'B']
const C: [number, string] = [3, 'C']

test('table: points, then goal difference, then goals for; duplicates and unfinished matches are not counted', () => {
  const ms = [game(1, A, B, 2, 0), game(2, B, C, 1, 1), game(3, C, A, 0, 3), game(1, A, B, 2, 0), { ...game(4, A, C, 9, 9), status: 'in-play' as const }]
  const t = computeTable(ms)
  assert.equal(t[0].team.name, 'A')
  assert.equal(t[0].points, 6)
  assert.equal(t[0].played, 2)
  assert.equal(t[0].goalDifference, 5)
  assert.equal(t.reduce((s, r) => s + r.played, 0), 6)
})

test('form and splits: only finished matches, newest first, zero played gives null rates', () => {
  const ms = [game(1, A, B, 2, 0), game(2, C, A, 1, 1), game(3, B, A, 3, 1)]
  const r = teamResults(A[0] === 1 ? 'openligadb:1' : '', ms)
  assert.deepEqual(r.map((x) => x.result), ['L', 'D', 'W'])
  const s = split(r)
  assert.equal(s.points, 4)
  assert.equal(s.cleanSheets, 1)
  assert.equal(split([]).pointsPerMatch, null)
})

test('head-to-head uses the provider ids as given and counts each meeting once', () => {
  const ms = [game(1, A, B, 2, 0), game(2, B, A, 1, 1), game(2, B, A, 1, 1), game(3, A, C, 5, 0)]
  const h = headToHead('openligadb:1', 'openligadb:2', ms)
  assert.equal(h.meetings.length, 2)
  assert.equal(h.aWins, 1)
  assert.equal(h.draws, 1)
})

test('goal timing leaves out goals with no minute, and says how much it covered', () => {
  const g = game(1, A, B, 2, 1, 10)
  g.events[0].minute = null
  const t = goalTiming([g, { ...game(2, A, B, 0, 0) }])
  assert.equal(t.unplaced, 1)
  assert.equal(t.buckets.reduce((s, b) => s + b.goals, 0), 2)
  assert.equal(t.matches, 2)
  assert.equal(t.matchesWithEvents, 1)
})

test('distribution and scorers', () => {
  const d = resultDistribution([game(1, A, B, 2, 0), game(2, B, A, 1, 1), game(3, C, A, 0, 3)])
  assert.equal(d.matches, 3)
  assert.equal(d.homeWins, 1)
  assert.equal(d.draws, 1)
  assert.equal(d.awayWins, 1)
  assert.equal(d.goalsPerMatch, 7 / 3)
  const g = game(9, A, B, 2, 0)
  g.events[0].player = 'Same'
  g.events[1].player = 'Same'
  const s = topScorers([g])
  assert.equal(s.scorers[0].goals, 2)
})

test('the outcome model refuses to guess with too little history, and its probabilities sum to 1', () => {
  assert.equal(poissonOutcome([game(1, A, B, 1, 0)], 'openligadb:1', 'openligadb:2'), null)
  const hist: FbMatch[] = []
  const t = [A, B, C, [4, 'D'] as [number, string]]
  let id = 0
  for (let r = 0; r < 6; r++) for (let i = 0; i < t.length; i++) for (let j = 0; j < t.length; j++) if (i !== j) hist.push(game(++id, t[i], t[j], (i + r) % 4, (j + r) % 3, 10, (id % 28) + 1))
  const p = poissonOutcome(hist, 'openligadb:1', 'openligadb:2')
  assert.ok(p)
  assert.ok(Math.abs(p.home + p.draw + p.away - 1) < 1e-9)
  assert.ok(p.home >= 0 && p.draw >= 0 && p.away >= 0)
  const ev = evaluateModel(hist)
  assert.ok(ev === null || (ev.evaluated >= 20 && ev.modelBrier >= 0))
})

test('the league list is whole: namespaced ids, a season form per provider', () => {
  const ids = new Set(LEAGUES.map((l) => l.id))
  assert.equal(ids.size, LEAGUES.length)
  for (const l of LEAGUES) assert.ok(l.id.startsWith(`${l.provider}:`))
  const epl = LEAGUES.find((l) => l.providerId === '4328')!
  assert.equal(providerSeason(epl, '2025'), '2025-2026')
  assert.equal(currentSeason(epl, new Date('2026-10-15')), '2026')
  assert.equal(currentSeason(epl, new Date('2026-03-01')), '2025')
  const mls = LEAGUES.find((l) => l.providerId === '4346')!
  assert.equal(currentSeason(mls, new Date('2026-03-01')), '2026')
  assert.equal(providerSeason(mls, '2026'), '2026')
})
