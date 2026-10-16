import assert from 'node:assert/strict'
import { test } from 'node:test'

import { START_FEN } from './rules.ts'
import { buildMoves } from './model.ts'
import { clockDisplay, type LiveGameRecord } from './live.ts'
import {
  agoWords,
  clockFace,
  clockPair,
  compareLines,
  connectionWords,
  correctionWords,
  dateRangeWords,
  delayWords,
  faultWords,
  firstWorthWatching,
  formatClock,
  freshnessBadge,
  freshnessWord,
  groupByTournament,
  keepability,
  mergeGames,
  moveNumberWords,
  pairingWords,
  playerLabel,
  providerWords,
  readDiagnostic,
  readEventGames,
  readEvents,
  readFollow,
  readLiveState,
  readPlayer,
  readRecord,
  resultWords,
  statusWords,
  unreadableEvents,
  viewerPosition,
  worthShowing,
  type LiveEventView,
  type LiveGameListing
} from './liveView.ts'

/**
 * The window's half of live chess, tested with no window and no tournament.
 *
 * Everything here is about what the screen is allowed to *say*. The two faults these tests exist for are the ones
 * that cannot be seen by looking at the screen: a value that was worked out presented as one that was received,
 * and a value nobody sent presented as a value.
 */

// ---- helpers ---------------------------------------------------------------------------------------------------

const line = (sans: string[], startFen = START_FEN) => {
  const built = buildMoves(startFen, sans.map((san) => ({ san })))
  assert.equal(built.ok, true, `the test's own line must be playable: ${sans.join(' ')}`)
  return built.moves
}

const record = (over: Partial<LiveGameRecord> = {}): LiveGameRecord => ({
  id: 'lichess:abcd1234',
  provider: 'lichess',
  providerGameId: 'abcd1234',
  eventId: 'rnd00001',
  white: { name: 'Carlsen, Magnus', rating: 2839, title: 'GM' },
  black: { name: 'Caruana, Fabiano', rating: 2805, title: 'GM' },
  startFen: START_FEN,
  moves: [],
  status: 'live',
  result: '*',
  receivedAt: 1_000_000,
  ...over
})

const event = (over: Partial<LiveEventView> = {}): LiveEventView => ({
  provider: 'lichess',
  eventId: 'rnd00001',
  name: 'Tata Steel — Round 3',
  status: 'live',
  ...over
})

const listing = (over: Partial<LiveGameListing> = {}): LiveGameListing => ({
  provider: 'lichess',
  providerGameId: 'abcd1234',
  eventId: 'rnd00001',
  id: 'lichess:abcd1234',
  name: 'Carlsen, Magnus - Caruana, Fabiano',
  white: { name: 'Carlsen, Magnus' },
  black: { name: 'Caruana, Fabiano' },
  status: 'live',
  result: '*',
  ...over
})

// ---- reading the wire ------------------------------------------------------------------------------------------

test('a list of broadcasts is read, and an empty one is a real answer rather than a fault', () => {
  const answer = readEvents({ ok: true, value: [{ provider: 'lichess', eventId: 'rnd00001', name: 'Tata Steel — Round 3', status: 'live', startsAt: 42, tier: 5 }] })
  assert.equal(answer.ok, true)
  assert.equal(answer.ok && answer.value.length, 1)
  assert.equal(answer.ok && answer.value[0].startsAt, 42)

  const empty = readEvents({ ok: true, value: [] })
  assert.equal(empty.ok, true)
  assert.deepEqual(empty.ok && empty.value, [])
})

test("a provider's refusal keeps the provider's own words and its kind", () => {
  const answer = readEvents({
    ok: false,
    diagnostic: { provider: 'lichess', operation: 'official broadcasts', kind: 'rate-limit', message: 'Lichess asked for fewer requests.', status: 429, at: 5 }
  })
  assert.equal(answer.ok, false)
  if (answer.ok) return
  assert.equal(answer.reason, 'Lichess asked for fewer requests.')
  assert.equal(answer.kind, 'rate-limit')
  assert.equal(answer.status, 429)
  assert.equal(answer.provider, 'lichess')
})

test('a build with no broadcast provider says so in its own words, not in a made-up one', () => {
  const answer = readEvents({ ok: false, reason: 'Live broadcasts are not available in this build.' })
  assert.equal(answer.ok, false)
  assert.equal(answer.ok === false && answer.reason, 'Live broadcasts are not available in this build.')
  assert.equal(answer.ok === false && answer.kind, undefined)
})

test('an answer that is not the shape this code was written against is reported as a schema fault', () => {
  const answer = readEvents({ ok: true, value: 'not a list' })
  assert.equal(answer.ok, false)
  assert.equal(answer.ok === false && answer.kind, 'schema')
  assert.equal(readEvents(null).ok, false)
  assert.equal(readEvents(undefined).ok, false)
  assert.equal(readEvents(42).ok, false)
})

test('an event with no id, name or provider is not an event, and the ones that were dropped are counted', () => {
  const raw = {
    ok: true,
    value: [
      { provider: 'lichess', eventId: 'rnd00001', name: 'Good', status: 'live' },
      { provider: 'lichess', name: 'No id', status: 'live' },
      { eventId: 'rnd00003', name: 'No provider' },
      null
    ]
  }
  const answer = readEvents(raw)
  assert.equal(answer.ok && answer.value.length, 1)
  assert.equal(unreadableEvents(raw), 3)
})

test('a rating of zero is not a rating, and "?" is not a name', () => {
  assert.deepEqual(readPlayer({ name: '?', rating: 0, title: '-' }), {})
  assert.deepEqual(readPlayer({ name: '  Ding, Liren  ', rating: 2762.4, title: 'GM' }), { name: 'Ding, Liren', rating: 2762, title: 'GM' })
  assert.deepEqual(readPlayer(null), {})
  assert.deepEqual(readPlayer({ rating: -5 }), {})
})

test("a round's games are read, and an unreadable one is counted rather than silently dropped", () => {
  const answer = readEventGames({
    ok: true,
    value: {
      event: { provider: 'lichess', eventId: 'rnd00001', name: 'Round 3', status: 'live' },
      games: [
        { provider: 'lichess', providerGameId: 'aaaa1111', eventId: 'rnd00001', name: 'A - B', white: { name: 'A' }, black: { name: 'B' }, status: 'live', result: '*' },
        { providerGameId: 'no-provider' }
      ]
    }
  })
  assert.equal(answer.ok, true)
  if (!answer.ok) return
  assert.equal(answer.value.games.length, 1)
  assert.equal(answer.value.games[0].id, 'lichess:aaaa1111')
  assert.equal(answer.value.unreadable, 1)
})

test('a round that arrives without its own details is refused rather than shown as an empty round', () => {
  const answer = readEventGames({ ok: true, value: { games: [] } })
  assert.equal(answer.ok, false)
  assert.equal(answer.ok === false && answer.kind, 'schema')
})

test('following answers carry the generation, and a refusal carries the reason', () => {
  assert.deepEqual(readFollow({ ok: true, value: { generation: 7 } }), { ok: true, value: { generation: 7 } })
  const no = readFollow({ ok: false, diagnostic: { provider: 'lichess', operation: 'event x', kind: 'refused', message: 'There is no "nope" provider to follow.', at: 1 } })
  assert.equal(no.ok === false && no.kind, 'refused')
})

test('a game whose moves cannot be read is refused, not shown as a game with no moves', () => {
  const broken = readRecord({
    id: 'lichess:abcd1234',
    provider: 'lichess',
    providerGameId: 'abcd1234',
    startFen: START_FEN,
    receivedAt: 5,
    moves: [{ san: 'e4', uci: 'e2e4', fen: 'after' }, { san: 'e5', uci: 'e7e5' }]
  })
  assert.equal(broken, null)
})

test('a clock reading with no moment attached is left out rather than pinned to now', () => {
  const read = readRecord({
    id: 'lichess:abcd1234',
    provider: 'lichess',
    providerGameId: 'abcd1234',
    startFen: START_FEN,
    receivedAt: 5,
    moves: [],
    clocks: { white: 300, black: 290 }
  })
  assert.notEqual(read, null)
  assert.equal(read?.clocks, undefined)

  const withMoment = readRecord({
    id: 'lichess:abcd1234',
    provider: 'lichess',
    providerGameId: 'abcd1234',
    startFen: START_FEN,
    receivedAt: 5,
    moves: [],
    clocks: { white: 300, at: 4 }
  })
  assert.deepEqual(withMoment?.clocks, { white: 300, at: 4 })
})

test('the live state reads both shapes the channel can send: a view and a bare record', () => {
  const state = readLiveState({
    following: { provider: 'lichess', eventId: 'rnd00001', generation: 3, state: 'open' },
    games: [
      { record: { id: 'lichess:a', provider: 'lichess', providerGameId: 'a', startFen: START_FEN, moves: [], receivedAt: 10, status: 'live', result: '*' }, freshness: 'live' },
      { id: 'lichess:b', provider: 'lichess', providerGameId: 'b', startFen: START_FEN, moves: [], receivedAt: 11, status: 'live', result: '*' },
      { record: { id: 'broken' } }
    ],
    health: { games: 2, generation: 3, lateDropped: 1, batches: 4, payloads: 9, pending: 0 }
  })
  assert.equal(state.following?.state, 'open')
  assert.deepEqual(state.games.map((g) => g.id), ['lichess:a', 'lichess:b'])
  assert.equal(state.reported['lichess:a'], 'live')
  assert.equal(state.reported['lichess:b'], undefined)
  assert.equal(state.unreadable, 1)
  assert.equal(state.health?.lateDropped, 1)
})

test('nothing being followed is read as nothing being followed, not as a connection', () => {
  const state = readLiveState({ following: null, games: [], health: null })
  assert.equal(state.following, null)
  assert.deepEqual(state.games, [])
  assert.equal(state.health, null)
  assert.equal(readLiveState(null).following, null)
  assert.deepEqual(readLiveState('nonsense').games, [])
})

test('a connection state that is not one of the five is read as connecting rather than trusted', () => {
  const state = readLiveState({ following: { provider: 'lichess', eventId: 'r', generation: 1, state: 'elsewhere' }, games: [] })
  assert.equal(state.following?.state, 'connecting')
})

test('a diagnostic needs all four of its parts to be shown at all', () => {
  assert.equal(readDiagnostic({ provider: 'lichess', operation: 'round r', kind: 'http', message: 'Lichess answered 503.', status: 503, at: 9 })?.status, 503)
  assert.equal(readDiagnostic({ provider: 'lichess', operation: 'round r', message: 'no kind' }), null)
  assert.equal(readDiagnostic({ kind: 'http', message: 'no provider' }), null)
  assert.equal(readDiagnostic(null), null)
})

// ---- the dashboard ---------------------------------------------------------------------------------------------

test('rounds are gathered into the tournaments they belong to, and nothing else is added', () => {
  const groups = groupByTournament([
    event({ eventId: 'r1', name: 'Tata Steel — Round 1', tournamentName: 'Tata Steel', status: 'finished', finishedAt: 100 }),
    event({ eventId: 'r2', name: 'Tata Steel — Round 2', tournamentName: 'Tata Steel', status: 'live', startsAt: 200 }),
    event({ eventId: 'c1', name: 'Candidates — Round 5', tournamentName: 'Candidates', status: 'scheduled', startsAt: 500 })
  ])
  assert.equal(groups.length, 2)
  const steel = groups.find((g) => g.name === 'Tata Steel')
  assert.equal(steel?.rounds.length, 2)
  // The round on now comes first inside the tournament.
  assert.equal(steel?.rounds[0].eventId, 'r2')
  assert.equal(steel?.status, 'live')
  assert.equal(steel?.from, 200)
  assert.equal(steel?.to, 100)
})

test('a round with no tournament name is still listed, under its own name', () => {
  const groups = groupByTournament([event({ eventId: 'x', name: 'A club match', status: 'unknown' })])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].name, 'A club match')
})

test('what is on comes before what is to come, which comes before what is over', () => {
  const groups = groupByTournament([
    event({ eventId: 'a', name: 'Over', tournamentName: 'Over', status: 'finished', finishedAt: 10 }),
    event({ eventId: 'b', name: 'Soon', tournamentName: 'Soon', status: 'scheduled', startsAt: 50 }),
    event({ eventId: 'c', name: 'Now', tournamentName: 'Now', status: 'live' }),
    event({ eventId: 'd', name: 'Nobody said', tournamentName: 'Nobody said', status: 'unknown' })
  ])
  assert.deepEqual(groups.map((g) => g.name), ['Now', 'Soon', 'Nobody said', 'Over'])
})

test("the provider's own featuring rank orders tournaments of the same status, and no rank loses to one", () => {
  const groups = groupByTournament([
    event({ eventId: 'a', name: 'Unranked', tournamentName: 'Unranked', status: 'live' }),
    event({ eventId: 'b', name: 'Ranked 5', tournamentName: 'Ranked 5', status: 'live', tier: 5 }),
    event({ eventId: 'c', name: 'Ranked 3', tournamentName: 'Ranked 3', status: 'live', tier: 3 })
  ])
  // The provider's own featuring order, used as the provider means it. Unranked is most tournaments, so leading
  // with those would bury the ones it is actually featuring.
  assert.deepEqual(groups.map((g) => g.name), ['Ranked 3', 'Ranked 5', 'Unranked'])
})

test('the longest declared embargo on any round is the tournament\'s, and none declared stays none', () => {
  const groups = groupByTournament([
    event({ eventId: 'a', tournamentName: 'T', status: 'live', delaySeconds: 300 }),
    event({ eventId: 'b', tournamentName: 'T', status: 'scheduled', delaySeconds: 900 })
  ])
  assert.equal(groups[0].delaySeconds, 900)
  assert.equal(groupByTournament([event({ tournamentName: 'U' })])[0].delaySeconds, undefined)
})

// ---- words -----------------------------------------------------------------------------------------------------

test('every status and result has words, and "not known" is one of them', () => {
  assert.equal(statusWords('live'), 'Being played now')
  assert.equal(statusWords('unknown'), 'Not known')
  assert.equal(resultWords('*'), 'No result yet')
  assert.equal(resultWords('1/2-1/2'), 'Drawn')
  assert.equal(connectionWords(null), 'Not following anything')
  assert.equal(connectionWords('reconnecting'), 'Reconnecting')
  assert.equal(freshnessWord('stale'), 'Out of date')
  assert.equal(freshnessWord('unknown'), 'Age not known')
})

test("a provider's name comes from its id, not from a table with one row in it", () => {
  assert.equal(providerWords('lichess'), 'Lichess')
  assert.equal(providerWords('chess24'), 'Chess24')
  assert.equal(providerWords(''), 'the provider')
  assert.equal(providerWords('   '), 'the provider')
})

test('dates are shown only where they are known', () => {
  const format = (at: number): string => `day${at}`
  assert.equal(dateRangeWords({}, format), null)
  assert.equal(dateRangeWords({ from: 0, to: 0 }, format), null)
  assert.equal(dateRangeWords({ from: 1 }, format), 'day1')
  assert.equal(dateRangeWords({ to: 2 }, format), 'until day2')
  assert.equal(dateRangeWords({ from: 1, to: 2 }, format), 'day1 – day2')
  // One day is one date, not a range from itself to itself.
  assert.equal(dateRangeWords({ from: 1, to: 1 }, format), 'day1')
})

test('an embargo nobody declared is not nought minutes', () => {
  assert.equal(delayWords(undefined), null)
  assert.equal(delayWords(0), null)
  assert.equal(delayWords(-5), null)
  assert.equal(delayWords(30), 'Published about 30 seconds behind the board, on purpose.')
  assert.equal(delayWords(900), 'Published about 15 minutes behind the board, on purpose.')
  assert.equal(delayWords(60), 'Published about 1 minute behind the board, on purpose.')
})

test('how long ago something happened is coarse above a minute, and "never" when it never did', () => {
  const now = 1_900_000_000_000
  assert.equal(agoWords(undefined, now), 'never')
  assert.equal(agoWords(0, now), 'never')
  assert.equal(agoWords(now - 2_000, now), 'just now')
  assert.equal(agoWords(now - 30_000, now), '30 seconds ago')
  assert.equal(agoWords(now - 90_000, now), '1 minute ago')
  assert.equal(agoWords(now - 3 * 60_000, now), '3 minutes ago')
  assert.equal(agoWords(now - 2 * 3_600_000, now), '2 hours ago')
  assert.equal(agoWords(now - 3 * 86_400_000, now), '3 days ago')
  // Two clocks disagreeing is not data from the future.
  assert.equal(agoWords(now + 60_000, now), 'just now')
})

// ---- players ---------------------------------------------------------------------------------------------------

test('a player with no name gets a role word, never a name and never a question mark', () => {
  const unknown = playerLabel(undefined, 'White')
  assert.equal(unknown.name, null)
  assert.equal(unknown.rating, null)
  assert.equal(unknown.title, null)
  assert.equal(unknown.role, 'White')
  assert.equal(unknown.partial, true)

  const known = playerLabel({ name: 'Gukesh D', rating: 2794, title: 'GM' }, 'Black')
  assert.equal(known.name, 'Gukesh D')
  assert.equal(known.rating, 2794)
  assert.equal(known.partial, false)

  assert.equal(playerLabel({ name: '?' }, 'White').name, null)
  assert.equal(playerLabel({ title: '-' }, 'White').title, null)
  assert.equal(playerLabel({ name: 'A', rating: 0 }, 'White').rating, null)
  // A name without a rating is a real, partial player: the rating is missing, not nought.
  assert.equal(playerLabel({ name: 'A' }, 'White').partial, true)
})

test('a pairing written from the players uses the role word where a name is missing', () => {
  assert.equal(pairingWords({ name: 'A' }, { name: 'B' }), 'A – B')
  assert.equal(pairingWords({ name: 'A' }, undefined), 'A – Black')
  assert.equal(pairingWords(undefined, undefined), 'White – Black')
})

// ---- clocks ----------------------------------------------------------------------------------------------------

test('a clock is rounded down, never up, and shows hours only when there are hours', () => {
  assert.equal(formatClock(0), '0:00')
  assert.equal(formatClock(0.9), '0:00')
  assert.equal(formatClock(9.99), '0:09')
  assert.equal(formatClock(59), '0:59')
  assert.equal(formatClock(60), '1:00')
  assert.equal(formatClock(3_599), '59:59')
  assert.equal(formatClock(3_600), '1:00:00')
  assert.equal(formatClock(3_687), '1:01:27')
  assert.equal(formatClock(-1), '0:00')
  assert.equal(formatClock(Number.NaN), '0:00')
})

test('a clock says whether it was received or worked out here', () => {
  assert.equal(clockFace(null), null)
  const got = clockFace({ seconds: 300, origin: 'received' })
  assert.equal(got?.counted, false)
  assert.equal(got?.note, 'As the source sent it.')
  const worked = clockFace({ seconds: 288.5, origin: 'extrapolated' })
  assert.equal(worked?.text, '4:48')
  assert.equal(worked?.counted, true)
  assert.match(worked?.note ?? '', /Not a value the source sent/)
})

test('a game the source never sent clocks for shows no clocks at all', () => {
  const pair = clockPair(clockDisplay({ record: record({ moves: line(['e4']) }), now: 1_000_100 }))
  assert.equal(pair.none, true)
  assert.equal(pair.white, null)
  assert.equal(pair.black, null)
  assert.equal(pair.at, null)
  assert.equal(pair.anyCounted, false)
})

test('only the side to move is counted down, and the count is marked as a count', () => {
  // White has played, so it is Black's move and Black's clock is the one running.
  const held = record({ moves: line(['e4']), clocks: { white: 600, black: 590, at: 1_000_000 } })
  const pair = clockPair(clockDisplay({ record: held, now: 1_000_000 + 10_000 }))
  assert.equal(pair.white?.counted, false)
  assert.equal(pair.white?.text, '10:00')
  assert.equal(pair.black?.counted, true)
  assert.equal(pair.black?.text, '9:40')
  assert.equal(pair.anyCounted, true)
  assert.equal(pair.at, 1_000_000)
})

test('a finished game counts nothing down: the clocks stopped when it did', () => {
  const held = record({ moves: line(['e4']), status: 'finished', result: '1-0', clocks: { white: 600, black: 590, at: 1_000_000 } })
  const pair = clockPair(clockDisplay({ record: held, now: 1_000_000 + 60_000 }))
  assert.equal(pair.anyCounted, false)
  assert.equal(pair.black?.text, '9:50')
})

// ---- where the board is ----------------------------------------------------------------------------------------

test('the tip is held as "wherever the game has got to", so an arriving move moves the board', () => {
  const four = record({ moves: line(['e4', 'e5', 'Nf3', 'Nc6']) })
  const atTip = viewerPosition(four, null)
  assert.equal(atTip.ply, 4)
  assert.equal(atTip.historical, false)
  assert.equal(atTip.behind, 0)
  assert.equal(atTip.lastMove?.from, 'b8')
  assert.equal(atTip.lastMove?.to, 'c6')

  const six = record({ moves: line(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']) })
  // The same null follows the game forward without anything being watched or reset.
  assert.equal(viewerPosition(six, null).ply, 6)
})

test('a board walked back is historical, and says how far behind it is', () => {
  const four = record({ moves: line(['e4', 'e5', 'Nf3', 'Nc6']) })
  const back = viewerPosition(four, 2)
  assert.equal(back.ply, 2)
  assert.equal(back.historical, true)
  assert.equal(back.behind, 2)
  assert.equal(back.fen, four.moves[1].fen)
  assert.equal(back.lastMove?.to, 'e5')
})

test('the starting position is a real place to be, and it is historical once a move has arrived', () => {
  const one = record({ moves: line(['e4']) })
  const start = viewerPosition(one, 0)
  assert.equal(start.fen, START_FEN)
  assert.equal(start.lastMove, null)
  assert.equal(start.historical, true)
  // A game with no moves yet is at its start and is not behind anything.
  const none = viewerPosition(record(), null)
  assert.equal(none.historical, false)
  assert.equal(none.total, 0)
})

test('a ply past the end is clamped, because a correction can shorten a game under a reader', () => {
  const two = record({ moves: line(['e4', 'e5']) })
  assert.equal(viewerPosition(two, 99).ply, 2)
  assert.equal(viewerPosition(two, 99).historical, false)
  assert.equal(viewerPosition(two, -4).ply, 0)
  assert.equal(viewerPosition(two, 1.7).ply, 1)
})

// ---- a provider changing its mind ------------------------------------------------------------------------------

test('moves arriving on the end are additions, not a correction', () => {
  const before = line(['e4', 'e5'])
  const after = line(['e4', 'e5', 'Nf3'])
  assert.deepEqual(compareLines(before, after), { added: 1, divergedAt: null, removed: 0 })
  assert.equal(correctionWords(compareLines(before, after), START_FEN), null)
})

test('a published move that has been changed is a correction, and it says which move', () => {
  const before = line(['e4', 'e5', 'Nf3', 'Nc6'])
  const after = line(['e4', 'e5', 'Nf3', 'd6'])
  const change = compareLines(before, after)
  assert.equal(change.divergedAt, 3)
  assert.equal(change.added, 1)
  assert.equal(change.removed, 1)
  assert.equal(correctionWords(change, START_FEN), 'The provider has changed move 2… and everything after it. What is shown now follows their corrected game.')
})

test('a line that got shorter without disagreeing is a shorter line, not a correction', () => {
  const before = line(['e4', 'e5', 'Nf3'])
  const after = line(['e4', 'e5'])
  assert.deepEqual(compareLines(before, after), { added: 0, divergedAt: null, removed: 1 })
})

test('move numbers are said the way a person says them, from whatever position the game starts in', () => {
  assert.equal(moveNumberWords(0, START_FEN), '1')
  assert.equal(moveNumberWords(1, START_FEN), '1…')
  assert.equal(moveNumberWords(2, START_FEN), '2')
  assert.equal(moveNumberWords(5, START_FEN), '3…')
  // A round shown from a position can perfectly well have Black to move first.
  const blackFirst = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 24'
  assert.equal(moveNumberWords(0, blackFirst), '24…')
  assert.equal(moveNumberWords(1, blackFirst), '25')
})

// ---- keeping a game --------------------------------------------------------------------------------------------

test('a game with no moves cannot be kept, and says why', () => {
  const can = keepability(record({ moves: [] }))
  assert.equal(can.can, false)
  assert.match(can.note, /nothing to keep/)
})

test('keeping a finished game saves the whole game, and says which result it holds', () => {
  const can = keepability(record({ moves: line(['e4', 'e5']), status: 'finished', result: '1-0' }))
  assert.equal(can.can, true)
  assert.equal(can.label, 'Keep this game')
  assert.match(can.note, /white won/)
})

test('keeping a game still being played says it saves a copy that will not keep up', () => {
  const can = keepability(record({ moves: line(['e4', 'e5', 'Nf3']), status: 'live', result: '*' }))
  assert.equal(can.can, true)
  assert.equal(can.label, 'Keep it as it stands')
  assert.match(can.note, /3 moves/)
  assert.match(can.note, /will not keep up/)
})

// ---- the listing and the feed together -------------------------------------------------------------------------

test('board order is the provider\'s order, and a game only the feed carries is kept on the end', () => {
  const listings = [listing({ providerGameId: 'b', id: 'lichess:b' }), listing({ providerGameId: 'a', id: 'lichess:a' })]
  const records = [record({ id: 'lichess:a', providerGameId: 'a' }), record({ id: 'lichess:z', providerGameId: 'z' })]
  const merged = mergeGames(listings, records)
  assert.deepEqual(merged.map((m) => m.id), ['lichess:b', 'lichess:a', 'lichess:z'])
  assert.equal(merged[0].record, null)
  assert.equal(merged[0].waiting, true)
  assert.notEqual(merged[1].record, null)
  assert.equal(merged[2].listing, null)
})

test('what the feed has announced beats what the listing said when the listing was fetched', () => {
  const merged = mergeGames(
    [listing({ status: 'live', result: '*' })],
    [record({ moves: line(['e4']), status: 'finished', result: '0-1' })]
  )
  assert.equal(merged[0].status, 'finished')
  assert.equal(merged[0].result, '0-1')
})

test("a name the feed left out is taken from the listing rather than blanked", () => {
  const merged = mergeGames(
    [listing({ white: { name: 'Carlsen, Magnus', rating: 2839 }, black: { name: 'Caruana, Fabiano' } })],
    [record({ white: {}, black: { name: 'Caruana, Fabiano', rating: 2805 } })]
  )
  assert.equal(merged[0].white.name, 'Carlsen, Magnus')
  assert.equal(merged[0].black.rating, 2805)
})

test('a provider that sent no label for a pairing gets one written from the players', () => {
  const merged = mergeGames([listing({ name: '' })], [])
  assert.equal(merged[0].name, 'Carlsen, Magnus – Caruana, Fabiano')
})

test('opening a round shows a game that is actually being played, if there is one', () => {
  const games = mergeGames(
    [listing({ providerGameId: 'a', id: 'lichess:a' }), listing({ providerGameId: 'b', id: 'lichess:b' }), listing({ providerGameId: 'c', id: 'lichess:c' })],
    [record({ id: 'lichess:b', providerGameId: 'b', moves: line(['e4']), status: 'live' })]
  )
  assert.equal(firstWorthWatching(games), 'lichess:b')
  // With nothing arrived at all, the first listed game is the one to open: it is a real game, just a quiet one.
  assert.equal(firstWorthWatching(mergeGames([listing({ providerGameId: 'a', id: 'lichess:a' })], [])), 'lichess:a')
  assert.equal(firstWorthWatching([]), null)
})

// ---- freshness -------------------------------------------------------------------------------------------------

test('freshness is the ingestion layer\'s own judgement, asked against now', () => {
  const now = 1_900_000_000_000
  const fresh = freshnessBadge({ record: record({ receivedAt: now - 1_000 }), now })
  assert.equal(fresh.state, 'live')
  assert.equal(fresh.behind, false)

  // Lichess broadcasts carry classical games, where a quarter of an hour between moves is ordinary.
  const quiet = freshnessBadge({ record: record({ receivedAt: now - 30 * 60_000 }), now })
  assert.equal(quiet.state, 'delayed')
  assert.equal(quiet.behind, true)

  const old = freshnessBadge({ record: record({ receivedAt: now - 3 * 3_600_000 }), now })
  assert.equal(old.state, 'stale')
  assert.match(old.note, /last thing known/)
})

test('a broadcast the provider holds back can never be called live, however promptly it arrives', () => {
  const now = 1_900_000_000_000
  const badge = freshnessBadge({ record: record({ receivedAt: now - 1_000 }), now, delaySeconds: 900 })
  assert.equal(badge.state, 'delayed')
  assert.equal(badge.behind, true)
  assert.match(badge.note, /15 minutes behind the board/)
})

test('a game nothing is known about the age of says so rather than being called live', () => {
  const badge = freshnessBadge({ record: { provider: 'lichess', receivedAt: 0 }, now: 1_900_000_000_000 })
  assert.equal(badge.state, 'unknown')
  assert.equal(badge.word, 'Age not known')
  assert.equal(badge.behind, true)
})

// ---- faults ----------------------------------------------------------------------------------------------------

test('a rate limit, an open circuit and a changed shape are three different things to tell somebody', () => {
  const limited = faultWords({ reason: 'Lichess asked for fewer requests.', kind: 'rate-limit' })
  assert.equal(limited.wait, true)
  const open = faultWords({ reason: 'Not connecting for another 40 seconds.', kind: 'circuit-open' })
  assert.equal(open.wait, true)
  const schema = faultWords({ reason: "Lichess's answer no longer has the shape this adapter was written against.", kind: 'schema' })
  assert.equal(schema.wait, false)
  assert.match(schema.next, /fault in Orbis/)
  assert.match(faultWords({ reason: 'Lichess answered 404.', kind: 'http', status: 404 }).next, /nothing at that address/)
  // With no kind at all, the words still promise nothing was guessed at.
  assert.match(faultWords({ reason: 'Something happened.' }).next, /nothing was guessed at/)
})

test("a cancelled request is not worth putting in front of anybody: it is what switching rounds does", () => {
  assert.equal(worthShowing({ kind: 'cancelled' }), false)
  assert.equal(worthShowing({ kind: 'rate-limit' }), true)
  assert.equal(worthShowing({}), true)
})
