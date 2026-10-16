import assert from 'node:assert/strict'
import { test } from 'node:test'

import { START_FEN } from './rules.ts'
import {
  applyLiveUpdate,
  clockDisplay,
  currentFen,
  describeFreshness,
  freshness,
  ingestLivePayload,
  liveIdOf,
  normaliseLiveGame,
  normalisePlayer,
  reconcileSnapshot,
  statusFrom,
  type LiveGameState,
  type LivePayload,
  type WrittenMove
} from './live.ts'

/**
 * The rules of live ingestion, tested against recorded fixtures.
 *
 * ---------------------------------------------------------------------------------------------------------------
 * FIXTURE PROVENANCE -- everything below is recorded, not invented.
 *
 * The game, the players, the ratings and the clock readings are taken from a real delivery of the Lichess broadcast
 * PGN stream, recorded on 16 October 2026 from
 *   GET https://lichess.org/api/stream/broadcast/round/Cd33Pm6w.pgn
 * which was round 7 of the 36th NATO Chess Championship 2026. The game is
 *   https://lichess.org/broadcast/36th-nato-chess-championship-2026/round-7/Cd33Pm6w/4am6EXRb
 *   Wagenaar, Harm Theo (1860) - Cirkvencic, Franci (1966), drawn after 4...d5.
 *
 * Two things about it are worth knowing, because both are load-bearing in the tests:
 *   - neither player has a title, and the PGN carries no `WhiteTitle`/`BlackTitle` tag. "Missing stays missing" is
 *     therefore testable against something real rather than against a contrived blank.
 *   - the recorded clocks are 1:30:43 for White after 4. e3 and 1:29:45 for Black after 4... d5.
 *
 * The raw PGN itself is exercised in `src/main/chess/live/lichess.test.ts`; these tests work on the normalised
 * payloads that reading it produces, which is the boundary this file is about.
 * ---------------------------------------------------------------------------------------------------------------
 */

/** The recorded game's moves, as written. */
const RECORDED_SAN = ['d4', 'Nf6', 'Nf3', 'e6', 'Bf4', 'c5', 'e3', 'd5']

/** The recorded clock readings, in seconds: 1:30:43 and 1:29:45. */
const RECORDED_CLOCKS = { white: 1 * 3600 + 30 * 60 + 43, black: 1 * 3600 + 29 * 60 + 45 }

const written = (sans: string[], clocks: Record<number, number> = {}): WrittenMove[] =>
  sans.map((san, i) => ({ san, ...(clocks[i] !== undefined ? { clock: clocks[i] } : {}) }))

/** A payload shaped exactly as the Lichess adapter produces one from the recorded game. */
function payload(o: Partial<LivePayload> = {}): LivePayload {
  return {
    provider: 'lichess',
    providerGameId: '4am6EXRb',
    eventId: 'Cd33Pm6w',
    eventName: '36th NATO Chess Championship 2026',
    round: '7.39',
    white: { name: 'Wagenaar, Harm Theo', rating: 1860 },
    black: { name: 'Cirkvencic, Franci', rating: 1966 },
    moves: written(RECORDED_SAN),
    kind: 'snapshot',
    result: '1/2-1/2',
    status: 'finished',
    receivedAt: 1_792_000_000_000,
    ...o
  }
}

/** The state after a first delivery of the first `plies` moves of the recorded game, still in progress. */
function held(plies: number, o: Partial<LivePayload> = {}): LiveGameState {
  const made = normaliseLiveGame(payload({ moves: written(RECORDED_SAN.slice(0, plies)), result: '*', status: 'live', ...o }))
  assert.ok(made.ok, 'the fixture itself must normalise')
  return made.state
}

// ---- normalising ------------------------------------------------------------------------------------------------

test('a recorded broadcast payload becomes a game, with only what the provider actually sent', () => {
  const made = normaliseLiveGame(payload({ clocks: RECORDED_CLOCKS }))
  assert.ok(made.ok)
  const r = made.state.record
  assert.equal(r.id, 'lichess:4am6EXRb')
  assert.equal(r.id, liveIdOf('lichess', '4am6EXRb'))
  assert.equal(r.eventId, 'Cd33Pm6w')
  assert.equal(r.round, '7.39')
  assert.equal(r.moves.length, 8)
  assert.equal(r.moves[0].san, 'd4')
  assert.equal(r.moves[0].uci, 'd2d4')
  assert.equal(r.result, '1/2-1/2')
  assert.equal(r.status, 'finished')
  assert.equal(r.white.name, 'Wagenaar, Harm Theo')
  assert.equal(r.white.rating, 1860)
  // Neither player in the recording has a title, and neither gets one here.
  assert.equal('title' in r.white, false)
  assert.equal('title' in r.black, false)
  assert.deepEqual(r.clocks, { white: RECORDED_CLOCKS.white, black: RECORDED_CLOCKS.black, at: 1_792_000_000_000 })
  // Lichess's PGN stream carries no per-move wall-clock time, so there is no sourceTimestamp to invent.
  assert.equal('sourceTimestamp' in r, false)
  assert.equal(r.receivedAt, 1_792_000_000_000)
})

test('what the provider did not send is absent, never filled in', () => {
  const made = normaliseLiveGame(payload({ white: { name: '?' }, black: { name: 'B', rating: 0, title: '-' }, clocks: {} }))
  assert.ok(made.ok)
  const r = made.state.record
  // "?" is how PGN says it does not know. It is not a name.
  assert.deepEqual(r.white, {})
  assert.deepEqual(r.black, { name: 'B' })
  // A rating of 0 is not a rating and a title of "-" is not a title.
  assert.equal('rating' in r.black, false)
  assert.equal('title' in r.black, false)
  // No clocks sent means no clocks key at all: a blank clock is honest, a zero is a claim.
  assert.equal('clocks' in r, false)
})

test('normalisePlayer keeps ratings only when they are real ones', () => {
  assert.deepEqual(normalisePlayer({ name: '  Carlsen, Magnus ', rating: 2839.6, title: 'GM' }), { name: 'Carlsen, Magnus', rating: 2840, title: 'GM' })
  assert.deepEqual(normalisePlayer({ rating: -1 }), {})
  assert.deepEqual(normalisePlayer({ rating: Number.NaN }), {})
  assert.deepEqual(normalisePlayer(undefined), {})
  assert.deepEqual(normalisePlayer({ name: '?', title: '?' }), {})
})

test('a move that cannot be played is refused, and nothing is half-applied', () => {
  const made = normaliseLiveGame(payload({ moves: written(['d4', 'Nf6', 'Qh8']) }))
  assert.equal(made.ok, false)
  assert.ok(!made.ok)
  assert.equal(made.problem, 'illegal-move')
  // The refusal says which move and reads like a sentence, not like a parser.
  assert.match(made.reason, /Qh8/)
  assert.match(made.reason, /cannot be played/)
})

test('an impossible starting position is refused as a position, not as a bad move', () => {
  const made = normaliseLiveGame(payload({ startFen: 'not a position', moves: [] }))
  assert.ok(!made.ok)
  assert.equal(made.problem, 'bad-start-position')
})

test('a payload that does not say which game it is about is refused', () => {
  const made = normaliseLiveGame(payload({ providerGameId: '   ' }))
  assert.ok(!made.ok)
  assert.equal(made.problem, 'empty')
})

test('statusFrom reports what is known and says unknown when nothing is', () => {
  assert.equal(statusFrom({ result: '1-0', moves: 40 }), 'finished')
  // A decided result settles it even when a stale status field disagrees.
  assert.equal(statusFrom({ status: 'live', result: '0-1', moves: 40 }), 'finished')
  assert.equal(statusFrom({ result: '*', moves: 3 }), 'live')
  assert.equal(statusFrom({ status: 'scheduled', result: '*', moves: 0 }), 'scheduled')
  // Nothing known is not "scheduled": that would be a guess about a game that may well be over.
  assert.equal(statusFrom({ result: '*', moves: 0 }), 'unknown')
})

// ---- the central rule: a snapshot is not new moves ---------------------------------------------------------------

test('the same snapshot arriving twice does not double the game', () => {
  const state = held(8, { result: '1/2-1/2', status: 'finished' })
  assert.equal(state.record.moves.length, 8)
  const again = reconcileSnapshot(state, payload())
  assert.equal(again.outcome, 'unchanged')
  assert.equal(again.added, 0)
  assert.equal(again.state.record.moves.length, 8, 'a re-sent snapshot must never be appended to itself')
})

test('a snapshot that extends what we hold adds only the moves we did not have', () => {
  const state = held(4)
  const next = reconcileSnapshot(state, payload({ moves: written(RECORDED_SAN.slice(0, 6)), result: '*', status: 'live' }))
  assert.equal(next.outcome, 'advanced')
  assert.equal(next.added, 2)
  assert.equal(next.state.record.moves.length, 6)
  // The moves we already had are the same moves, not replayed copies.
  assert.deepEqual(next.state.record.moves.slice(0, 4).map((m) => m.uci), state.record.moves.map((m) => m.uci))
  assert.equal(next.state.record.moves[4].san, 'Bf4')
  assert.equal(next.state.record.moves[5].san, 'c5')
})

test('reconnecting after a dropped connection recovers the moves that were missed, and only those', () => {
  // Four moves known, the connection drops, three more moves are played, the stream re-sends the whole game.
  const state = held(4)
  const afterReconnect = reconcileSnapshot(state, payload({ moves: written(RECORDED_SAN), result: '1/2-1/2', status: 'finished' }))
  assert.equal(afterReconnect.outcome, 'advanced')
  assert.equal(afterReconnect.added, 4)
  assert.equal(afterReconnect.state.record.moves.length, 8)
  assert.equal(afterReconnect.state.record.result, '1/2-1/2')
  assert.equal(afterReconnect.state.record.status, 'finished')
})

test('a snapshot that is behind what we hold is thrown away rather than rewinding the board', () => {
  const state = held(8, { result: '1/2-1/2', status: 'finished' })
  const stale = reconcileSnapshot(state, payload({ moves: written(RECORDED_SAN.slice(0, 4)), result: '*' }))
  assert.equal(stale.outcome, 'out-of-order')
  assert.equal(stale.added, 0)
  assert.equal(stale.state.record.moves.length, 8)
  assert.equal(stale.state.record.result, '1/2-1/2', 'an older copy must not un-finish a finished game')
  assert.match(stale.note, /older copy/)
})

test('a provider correcting a move it already published is taken, and reported as a correction', () => {
  const state = held(8, { result: '1/2-1/2', status: 'finished' })
  // The operator had entered 4. e3; the game was really 4. c4.
  const corrected = RECORDED_SAN.slice(0, 6).concat(['c4', 'd5'])
  const result = reconcileSnapshot(state, payload({ moves: written(corrected) }))
  assert.equal(result.outcome, 'corrected')
  assert.equal(result.divergedAt, 6, 'the seventh ply is where the two lines stop agreeing')
  assert.equal(result.state.record.moves.length, 8)
  assert.equal(result.state.record.moves[6].san, 'c4')
  assert.match(result.note, /changed move 4/)
})

test('a result being corrected is a correction; a game merely finishing is not', () => {
  const finishing = reconcileSnapshot(held(8), payload({ result: '1-0' }))
  assert.equal(finishing.outcome, 'advanced', '* becoming a result is the game ending, not a correction')
  assert.equal(finishing.state.record.result, '1-0')
  assert.equal(finishing.state.record.status, 'finished')

  const overruled = reconcileSnapshot(finishing.state, payload({ result: '1/2-1/2' }))
  assert.equal(overruled.outcome, 'corrected')
  assert.equal(overruled.added, 0)
  assert.equal(overruled.state.record.result, '1/2-1/2')
  assert.match(overruled.note, /corrected from 1-0 to 1\/2-1\/2/)
})

test('a snapshot whose moves cannot be played leaves the game exactly as it was', () => {
  const state = held(4)
  const bad = reconcileSnapshot(state, payload({ moves: written(RECORDED_SAN.slice(0, 4).concat(['Qxh8'])) }))
  assert.equal(bad.outcome, 'refused')
  assert.equal(bad.problem, 'illegal-move')
  assert.equal(bad.state.record.moves.length, 4)
  assert.deepEqual(bad.state, state, 'a refusal must change nothing at all')
})

// ---- duplicates and ordering -------------------------------------------------------------------------------------

test('a delivery the provider has already sent us is recognised and ignored', () => {
  const first = normaliseLiveGame(payload({ moves: written(RECORDED_SAN.slice(0, 4)), result: '*', deliveryId: 'e-17' }))
  assert.ok(first.ok)
  assert.deepEqual(first.state.seen, ['e-17'])
  assert.equal(first.state.record.lastEventId, 'e-17')

  const repeat = reconcileSnapshot(first.state, payload({ moves: written(RECORDED_SAN), deliveryId: 'e-17' }))
  assert.equal(repeat.outcome, 'duplicate')
  assert.equal(repeat.added, 0)
  assert.equal(repeat.state.record.moves.length, 4, 'a repeated delivery id must not be applied even if it carries more moves')
})

test('a delivery older than one already accepted is rejected on its sequence alone', () => {
  const first = normaliseLiveGame(payload({ moves: written(RECORDED_SAN.slice(0, 6)), result: '*', sequence: 12 }))
  assert.ok(first.ok)
  const old = reconcileSnapshot(first.state, payload({ moves: written(RECORDED_SAN), sequence: 11 }))
  assert.equal(old.outcome, 'out-of-order')
  assert.equal(old.state.record.moves.length, 6)
  assert.match(old.note, /older than what is already shown/)

  // The next one in order is accepted, and the sequence moves with it.
  const next = reconcileSnapshot(first.state, payload({ moves: written(RECORDED_SAN), sequence: 13 }))
  assert.equal(next.outcome, 'advanced')
  assert.equal(next.state.sequence, 13)
})

test('the remembered delivery ids are bounded, so a seven-hour round cannot grow without limit', () => {
  let state = held(4, { deliveryId: 'd-0' })
  for (let i = 1; i <= 300; i++) {
    const r = reconcileSnapshot(state, payload({ moves: written(RECORDED_SAN.slice(0, 4)), result: '*', deliveryId: `d-${i}` }))
    state = r.state
  }
  assert.ok(state.seen.length <= 128, `remembered ${state.seen.length} delivery ids`)
  assert.equal(state.seen[state.seen.length - 1], 'd-300')
})

test('an update about a different game, or from a different starting position, is refused', () => {
  const state = held(4)
  const other = reconcileSnapshot(state, payload({ providerGameId: 'ZZZZZZZZ' }))
  assert.equal(other.outcome, 'refused')
  assert.equal(other.problem, 'wrong-game')

  const moved = reconcileSnapshot(state, payload({ startFen: '8/8/8/4k3/8/8/4K3/8 w - - 0 1', moves: [] }))
  assert.equal(moved.outcome, 'refused')
  assert.equal(moved.problem, 'start-position-changed')
})

// ---- incremental updates ------------------------------------------------------------------------------------------

test('a genuine delta is appended to what we hold', () => {
  const state = held(6)
  const delta = applyLiveUpdate(state, payload({ kind: 'update', moves: written(['e3']), result: '*' }))
  assert.equal(delta.outcome, 'advanced')
  assert.equal(delta.added, 1)
  assert.equal(delta.state.record.moves.length, 7)
  assert.equal(delta.state.record.moves[6].san, 'e3')
})

test('an "update" that is really the whole game again is spotted and does not double the moves', () => {
  // This is the mistake an adapter will make, so the model refuses to be fooled by it rather than trusting the label.
  const state = held(4)
  const mislabelled = applyLiveUpdate(state, payload({ kind: 'update', moves: written(RECORDED_SAN), result: '1/2-1/2' }))
  assert.equal(mislabelled.outcome, 'advanced')
  assert.equal(mislabelled.added, 4, 'only the four genuinely new moves')
  assert.equal(mislabelled.state.record.moves.length, 8, 'not 12')
  assert.deepEqual(mislabelled.state.record.moves.map((m) => m.san), RECORDED_SAN)
})

test('a delta that cannot be played from the current position is refused, and says a full update will settle it', () => {
  const state = held(4)
  const bad = applyLiveUpdate(state, payload({ kind: 'update', moves: written(['Qxh8']) }))
  assert.equal(bad.outcome, 'refused')
  assert.equal(bad.problem, 'illegal-move')
  assert.deepEqual(bad.state, state)
  assert.match(bad.note, /full update will settle it/)
})

test('an update with no moves can still announce or correct a result', () => {
  const finished = applyLiveUpdate(held(8), payload({ kind: 'update', moves: [], result: '0-1' }))
  assert.equal(finished.outcome, 'advanced')
  assert.equal(finished.state.record.result, '0-1')
  const overruled = applyLiveUpdate(finished.state, payload({ kind: 'update', moves: [], result: '1/2-1/2' }))
  assert.equal(overruled.outcome, 'corrected')
})

test('ingestLivePayload creates on the first delivery and dispatches on kind afterwards', () => {
  const created = ingestLivePayload(null, payload({ moves: written(RECORDED_SAN.slice(0, 4)), result: '*' }))
  assert.equal(created.outcome, 'created')
  assert.equal(created.added, 4)
  const advanced = ingestLivePayload(created.state, payload())
  assert.equal(advanced.outcome, 'advanced')
  assert.equal(advanced.added, 4)
})

test('a first delivery that cannot be believed comes back refused, carrying a record that claims nothing', () => {
  const bad = ingestLivePayload(null, payload({ moves: written(['Ke4']) }))
  assert.equal(bad.outcome, 'refused')
  assert.equal(bad.problem, 'illegal-move')
  assert.deepEqual(bad.state.record.moves, [])
  assert.equal(bad.state.record.status, 'unknown')
  assert.equal(bad.state.record.result, '*')
})

test('a later delivery that omits a rating does not erase the one already known', () => {
  const state = held(4)
  assert.equal(state.record.white.rating, 1860)
  const next = reconcileSnapshot(state, payload({ moves: written(RECORDED_SAN.slice(0, 6)), white: { name: 'Wagenaar, Harm Theo' }, result: '*' }))
  assert.equal(next.state.record.white.rating, 1860, 'a feed that stops repeating a rating has not withdrawn it')
})

test('currentFen is the position after the last move, and the start before any', () => {
  assert.equal(currentFen({ startFen: START_FEN, moves: [] }), START_FEN)
  const state = held(1)
  assert.equal(currentFen(state.record), state.record.moves[0].fen)
})

// ---- freshness -----------------------------------------------------------------------------------------------------

test('freshness answers how old what is shown is, with per-provider windows', () => {
  const now = 2_000_000_000_000
  const at = (ms: number): number => now - ms
  // Lichess carries classical games, where a quarter of an hour between moves is ordinary.
  assert.equal(freshness({ receivedAt: at(60_000), now, provider: 'lichess' }), 'live')
  assert.equal(freshness({ receivedAt: at(14 * 60_000), now, provider: 'lichess' }), 'live')
  assert.equal(freshness({ receivedAt: at(20 * 60_000), now, provider: 'lichess' }), 'delayed')
  assert.equal(freshness({ receivedAt: at(90 * 60_000), now, provider: 'lichess' }), 'stale')
  // A provider nobody has set windows for gets the tighter default, not Lichess's.
  assert.equal(freshness({ receivedAt: at(10 * 60_000), now, provider: 'somebody-else' }), 'delayed')
  assert.equal(freshness({ receivedAt: at(10 * 60_000), now, provider: 'lichess' }), 'live')
})

test('with nothing to measure against, freshness says unknown rather than guessing', () => {
  assert.equal(freshness({ now: 2_000_000_000_000, provider: 'lichess' }), 'unknown')
  assert.equal(freshness({ receivedAt: 0, now: 2_000_000_000_000, provider: 'lichess' }), 'unknown')
  assert.equal(freshness({ receivedAt: 1, now: Number.NaN, provider: 'lichess' }), 'unknown')
})

test("a provider's own timestamp is preferred over when we happened to receive it", () => {
  const now = 2_000_000_000_000
  // Received a moment ago, but the provider says the data itself is two hours old.
  assert.equal(freshness({ sourceTimestamp: now - 2 * 3600_000, receivedAt: now - 1_000, now, provider: 'lichess' }), 'stale')
})

test('a broadcast on a declared embargo is never called live, however promptly it arrives', () => {
  const now = 2_000_000_000_000
  // The round declares a ten-minute delay. Data one second old is still ten minutes behind the board.
  assert.equal(freshness({ receivedAt: now - 1_000, now, provider: 'lichess', delaySeconds: 600 }), 'delayed')
  // And the embargo widens the window before it is called stale, rather than being counted as lateness.
  assert.equal(freshness({ receivedAt: now - 65 * 60_000, now, provider: 'lichess', delaySeconds: 600 }), 'delayed')
  assert.equal(freshness({ receivedAt: now - 80 * 60_000, now, provider: 'lichess', delaySeconds: 600 }), 'stale')
})

test('a timestamp from the future is a disagreeing clock, not data from the future', () => {
  const now = 2_000_000_000_000
  assert.equal(freshness({ receivedAt: now + 5 * 60_000, now, provider: 'lichess' }), 'live')
})

test('freshness can explain itself, and says so when it is a deliberate delay', () => {
  assert.match(describeFreshness('live'), /Live/)
  assert.match(describeFreshness('delayed', { delaySeconds: 600 }), /on purpose.*10 minutes behind/)
  assert.match(describeFreshness('delayed'), /Behind the board/)
  assert.match(describeFreshness('stale'), /Out of date/)
  assert.match(describeFreshness('unknown'), /Not known/)
})

// ---- clocks ---------------------------------------------------------------------------------------------------------

test('no clock was ever sent, so none is shown', () => {
  const state = held(4)
  assert.equal('clocks' in state.record, false)
  assert.deepEqual(clockDisplay({ record: state.record, now: 1_792_000_100_000 }), { white: null, black: null, at: null, anyExtrapolated: false })
})

test('only the side to move is counted down, and the count is marked as worked out rather than received', () => {
  // Eight plies played, so it is White to move; White's clock is the one running.
  const state = held(8, { clocks: RECORDED_CLOCKS })
  const at = state.record.clocks?.at as number
  const shown = clockDisplay({ record: state.record, now: at + 30_000 })
  assert.equal(shown.anyExtrapolated, true)
  assert.equal(shown.white?.origin, 'extrapolated')
  assert.equal(shown.white?.seconds, RECORDED_CLOCKS.white - 30)
  // Black's clock is not running, so it is shown exactly as it was received.
  assert.equal(shown.black?.origin, 'received')
  assert.equal(shown.black?.seconds, RECORDED_CLOCKS.black)
  assert.equal(shown.at, at)
})

test('a finished game has stopped clocks: nothing is counted down', () => {
  const state = held(8, { clocks: RECORDED_CLOCKS, result: '1/2-1/2', status: 'finished' })
  const at = state.record.clocks?.at as number
  const shown = clockDisplay({ record: state.record, now: at + 3_600_000 })
  assert.equal(shown.anyExtrapolated, false)
  assert.equal(shown.white?.origin, 'received')
  assert.equal(shown.white?.seconds, RECORDED_CLOCKS.white)
  assert.equal(shown.black?.seconds, RECORDED_CLOCKS.black)
})

test('counting down stops at zero, because a fallen flag is an arbiter’s call and not arithmetic', () => {
  const state = held(8, { clocks: { white: 12, black: 400 } })
  const at = state.record.clocks?.at as number
  const shown = clockDisplay({ record: state.record, now: at + 600_000 })
  assert.equal(shown.white?.seconds, 0)
  assert.equal(shown.white?.origin, 'extrapolated')
})

test('asked not to extrapolate, every shown clock is the one that was received', () => {
  const state = held(8, { clocks: RECORDED_CLOCKS })
  const at = state.record.clocks?.at as number
  const shown = clockDisplay({ record: state.record, now: at + 120_000, extrapolate: false })
  assert.equal(shown.anyExtrapolated, false)
  assert.equal(shown.white?.seconds, RECORDED_CLOCKS.white)
  assert.equal(shown.white?.origin, 'received')
})

test('clocks disagreeing means nothing is counted down rather than counted up', () => {
  const state = held(8, { clocks: RECORDED_CLOCKS })
  const at = state.record.clocks?.at as number
  const shown = clockDisplay({ record: state.record, now: at - 60_000 })
  assert.equal(shown.anyExtrapolated, false)
  assert.equal(shown.white?.seconds, RECORDED_CLOCKS.white)
})

test('one side having a clock and the other not leaves the other blank', () => {
  // Nine plies, so Black is to move and Black is the side with no reading.
  const state = held(8, { clocks: { white: 900 } })
  const nine = reconcileSnapshot(state, payload({ moves: written(RECORDED_SAN.concat(['c4'])), result: '*', clocks: { white: 880 } }))
  assert.equal(nine.outcome, 'advanced')
  const clocks = nine.state.record.clocks as { at: number }
  const shown = clockDisplay({ record: nine.state.record, now: clocks.at + 10_000 })
  assert.equal(shown.black, null, 'a side with no reading is blank, not zero')
  assert.equal(shown.white?.origin, 'received', 'the side not to move is shown as received')
  assert.equal(shown.anyExtrapolated, false, 'nothing can be counted down for a side with no reading')
})

test('a clock reading replaces the previous one wholesale, so two sides are never read from different moments', () => {
  const state = held(6, { clocks: { white: 1000, black: 1100 } })
  const next = reconcileSnapshot(state, payload({ moves: written(RECORDED_SAN.slice(0, 7)), result: '*', clocks: { white: 980 }, receivedAt: 1_792_000_050_000 }))
  assert.deepEqual(next.state.record.clocks, { white: 980, at: 1_792_000_050_000 })
  assert.equal('black' in (next.state.record.clocks ?? {}), false, "black's old reading must not be paired with white's new one")
})

test('a delivery with no clocks at all leaves the last readings alone rather than erasing them', () => {
  const state = held(6, { clocks: { white: 1000, black: 1100 } })
  const next = reconcileSnapshot(state, payload({ moves: written(RECORDED_SAN.slice(0, 7)), result: '*' }))
  assert.deepEqual(next.state.record.clocks, { white: 1000, black: 1100, at: 1_792_000_000_000 })
})
