import { test } from 'node:test'
import assert from 'node:assert/strict'
import { START_FEN, applyMove } from './rules.ts'
import { fingerprintOf, type GameMeta, type GameMove, type GameSource, type StoredGame } from './model.ts'
import {
  WHO_ENGINE_GAMES, archiveNumbers, archiveRows, engineGameCount, monthWords, namesIn, openingOf, outcomeFor,
  scoreShare, sideFor, sortRows, suggestWho, tallyWords
} from './archive.ts'

/**
 * The archive's arithmetic.
 *
 * What is checked here is everything a chart cannot check for itself: that a game nobody can attribute is counted
 * as "not recorded" instead of as a loss, that a score out of no decided games is null rather than nought, that
 * undated games stay out of the months and out of the streaks, and that a mark on a move is only ever counted when
 * the game file really carried it and it really was your move.
 *
 * Every game below is built by playing legal moves through `rules.ts`, so nothing here is a string pretending to be
 * a game.
 */

let counter = 0

function game(o: {
  id?: string
  san?: string[]
  meta?: Partial<GameMeta>
  nags?: Record<number, string[]>
  source?: GameSource
  createdAt?: number
}): StoredGame {
  counter += 1
  const moves: GameMove[] = []
  let fen = START_FEN
  for (const [index, san] of (o.san ?? []).entries()) {
    const made = applyMove(fen, san)
    assert.ok(made, `${san} is not legal in ${fen}`)
    fen = made.after
    const nag = o.nags?.[index]
    moves.push({ san: made.san, uci: made.uci, fen, ...(nag ? { nag } : {}) })
  }
  return {
    id: o.id ?? `g${counter}`,
    profileId: 'p',
    source: o.source ?? { kind: 'import', importedAt: 1_700_000_000_000 },
    startFen: START_FEN,
    moves,
    meta: { white: {}, black: {}, result: '*', ...o.meta },
    variant: 'standard',
    createdAt: o.createdAt ?? 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    fingerprint: fingerprintOf(START_FEN, moves)
  }
}

const me: GameMeta['white'] = { name: 'Kavin S' }

// ---------------------------------------------------------------------------------------------------------------

test('the names offered are the names that really appear, counted by side', () => {
  const games = [
    game({ meta: { white: me, black: { name: 'Stockfish 17' } }, source: { kind: 'local-engine', engine: 'Stockfish 17' } }),
    game({ meta: { white: { name: 'Stockfish 17' }, black: me }, source: { kind: 'local-engine', engine: 'Stockfish 17' } }),
    game({ meta: { white: me, black: { name: 'A Friend' } } })
  ]
  const names = namesIn(games)
  const mine = names.find((one) => one.name === 'Kavin S')
  assert.ok(mine)
  assert.equal(mine.games, 3)
  assert.equal(mine.asWhite, 2)
  assert.equal(mine.asBlack, 1)
  assert.equal(mine.isEngine, false)
  const engine = names.find((one) => one.name === 'Stockfish 17')
  assert.ok(engine)
  assert.equal(engine.isEngine, true)
  // A name nobody wrote down is not a player called "".
  assert.equal(names.some((one) => one.name === ''), false)
})

test('the same person written two ways is one person', () => {
  const games = [game({ meta: { white: { name: 'Carlsen, Magnus' }, black: {} } }), game({ meta: { white: { name: 'magnus carlsen' }, black: {} } })]
  assert.equal(namesIn(games).length, 1)
  assert.equal(namesIn(games)[0].games, 2)
})

test('which side you were: by name, and by being the one who was not the engine', () => {
  const byName = game({ meta: { white: me, black: { name: 'A Friend' } } })
  assert.equal(sideFor(byName, { name: 'Kavin S' }), 'w')
  assert.equal(sideFor(byName, { name: 'A Friend' }), 'b')
  assert.equal(sideFor(byName, { name: 'Nobody' }), null)

  // Played here with no name given: Orbis still knows the engine was White, so you were Black.
  const unnamed = game({ meta: { white: { name: 'Stockfish 17' }, black: {} }, source: { kind: 'local-engine', engine: 'Stockfish 17' } })
  assert.equal(sideFor(unnamed, WHO_ENGINE_GAMES), 'b')
  assert.equal(engineGameCount([unnamed]), 1)

  // An imported game is nobody's engine game, so that question has no answer for it.
  assert.equal(sideFor(byName, WHO_ENGINE_GAMES), null)
  // And a played game where neither side carries the engine's name cannot be attributed either.
  const nameless = game({ source: { kind: 'local-engine', engine: 'Stockfish 17' } })
  assert.equal(sideFor(nameless, WHO_ENGINE_GAMES), null)
})

test('the suggested name is the commonest one that is not the engine', () => {
  const games = [
    game({ meta: { white: me, black: { name: 'Stockfish 17' } }, source: { kind: 'local-engine', engine: 'Stockfish 17' } }),
    game({ meta: { white: me, black: { name: 'Stockfish 17' } }, source: { kind: 'local-engine', engine: 'Stockfish 17' } }),
    game({ meta: { white: { name: 'A Friend' }, black: {} } })
  ]
  assert.deepEqual(suggestWho(games), { name: 'Kavin S' })
  // With nothing named at all, the engine games are still countable and that is what is offered.
  assert.deepEqual(suggestWho([game({ source: { kind: 'local-engine', engine: 'Stockfish 17' }, meta: { white: { name: 'Stockfish 17' }, black: {} } })]), WHO_ENGINE_GAMES)
  assert.equal(suggestWho([game({})]), null)
})

test('an outcome is read from the result and the side, both ways round', () => {
  assert.equal(outcomeFor('1-0', 'w'), 'win')
  assert.equal(outcomeFor('1-0', 'b'), 'loss')
  assert.equal(outcomeFor('0-1', 'b'), 'win')
  assert.equal(outcomeFor('1/2-1/2', 'w'), 'draw')
  assert.equal(outcomeFor('*', 'w'), 'unfinished')
})

test('the opening comes from the file first and from a lookup only when the file is silent', () => {
  const named = game({ meta: { white: {}, black: {}, result: '*', eco: 'C50', opening: 'Italian Game' } })
  assert.deepEqual(openingOf(named, () => ({ eco: 'B00', name: 'Wrong' })), { eco: 'C50', name: 'Italian Game', from: 'file' })
  const silent = game({ san: ['e4'] })
  assert.deepEqual(openingOf(silent, () => ({ eco: 'B00', name: "King's Pawn" })), { eco: 'B00', name: "King's Pawn", from: 'dataset' })
  // No tags and no lookup is a game with no opening, not a game called "Unknown".
  assert.equal(openingOf(silent), null)
})

test('a row carries the final position, the opponent and the moves, and invents nothing', () => {
  const played = game({
    san: ['e4', 'e5', 'Nf3'],
    meta: { white: me, black: { name: 'A Friend', rating: 1620 }, result: '1-0', termination: 'Black resigned', date: '2026.03.04' }
  })
  const [row] = archiveRows([played], { name: 'Kavin S' })
  assert.equal(row.side, 'w')
  assert.equal(row.outcome, 'win')
  assert.equal(row.opponent, 'A Friend')
  assert.equal(row.opponentRating, 1620)
  assert.equal(row.moves, 3)
  assert.equal(row.ended, 'Black resigned')
  assert.equal(row.finalFen, played.moves[2].fen)

  // Nothing recorded stays nothing: no "Unknown" opponent, no zero rating, no made-up ending.
  const bare = game({ san: ['e4'] })
  const [plain] = archiveRows([bare], { name: 'Kavin S' })
  assert.equal(plain.side, null)
  assert.equal(plain.opponent, null)
  assert.equal(plain.opponentRating, null)
  assert.equal(plain.ended, null)
  assert.equal(plain.dayFrom, null)

  // A game with no moves shows the position it started from, not an empty board.
  const empty = game({})
  assert.equal(archiveRows([empty], { name: 'Kavin S' })[0].finalFen, START_FEN)
})

test('sorting puts what the record does not say last, whichever way the column points', () => {
  const rows = archiveRows([
    game({ id: 'dated', meta: { white: me, black: {}, result: '1-0', date: '2026.01.02' } }),
    game({ id: 'older', meta: { white: me, black: {}, result: '0-1', date: '2024.01.02' } }),
    game({ id: 'undated', meta: { white: me, black: {}, result: '1-0' } })
  ], { name: 'Kavin S' })
  assert.deepEqual(sortRows(rows, 'date', 'up').map((r) => r.id), ['older', 'dated', 'undated'])
  assert.deepEqual(sortRows(rows, 'date', 'down').map((r) => r.id), ['dated', 'older', 'undated'])
})

test('a score out of no decided games is nothing at all, not nought', () => {
  const rows = archiveRows([game({ meta: { white: me, black: {}, result: '*' } })], { name: 'Kavin S' })
  const numbers = archiveNumbers(rows)
  assert.equal(numbers.all.played, 1)
  assert.equal(numbers.all.decided, 0)
  assert.equal(numbers.all.score, null)
  assert.equal(scoreShare(numbers.all), null)
  assert.match(tallyWords(numbers.all), /no result recorded/)
  assert.equal(tallyWords(numbers.asBlack), 'No games.')
})

test('a game nobody can attribute is counted as not recorded, never as a loss', () => {
  const rows = archiveRows([
    game({ meta: { white: me, black: {}, result: '1-0' } }),
    game({ meta: { white: { name: 'Two Strangers' }, black: {}, result: '1-0' } })
  ], { name: 'Kavin S' })
  const numbers = archiveNumbers(rows)
  assert.equal(numbers.counted, 1)
  assert.equal(numbers.sideNotRecorded, 1)
  assert.equal(numbers.all.losses, 0)
  assert.equal(numbers.all.wins, 1)
})

test('colour, opening and ending are counted separately, and what is missing is counted too', () => {
  const rows = archiveRows([
    game({ meta: { white: me, black: {}, result: '1-0', eco: 'C50', opening: 'Italian Game', termination: 'Black resigned' } }),
    game({ meta: { white: me, black: {}, result: '0-1', eco: 'C50', opening: 'Italian Game' } }),
    game({ meta: { white: {}, black: me, result: '0-1', eco: 'B01', opening: 'Scandinavian Defence', termination: 'Black resigned' } }),
    game({ meta: { white: {}, black: me, result: '1/2-1/2' } })
  ], { name: 'Kavin S' })
  const numbers = archiveNumbers(rows)
  assert.equal(numbers.asWhite.played, 2)
  assert.equal(numbers.asWhite.wins, 1)
  assert.equal(numbers.asBlack.played, 2)
  assert.equal(numbers.asBlack.wins, 1)
  assert.equal(numbers.asBlack.draws, 1)
  assert.equal(numbers.byOpening[0].label, 'Italian Game')
  assert.equal(numbers.byOpening[0].played, 2)
  assert.equal(numbers.byOpening[0].code, 'C50')
  assert.equal(numbers.openingNotNamed, 1)
  assert.equal(numbers.byEnding[0].label, 'Black resigned')
  assert.equal(numbers.byEnding[0].played, 2)
  assert.equal(numbers.endingNotRecorded, 2)
})

test('the months chart only has months that really have games, and undated games are counted aside', () => {
  const rows = archiveRows([
    game({ meta: { white: me, black: {}, result: '1-0', date: '2026.03.04' } }),
    game({ meta: { white: me, black: {}, result: '0-1', date: '2026.03.19' } }),
    game({ meta: { white: me, black: {}, result: '1-0', date: '2026.05.01' } }),
    // A PGN year with no month is a real answer and still not a month, so it is in no bar.
    game({ meta: { white: me, black: {}, result: '1-0', date: '2026.??.??' } }),
    game({ meta: { white: me, black: {}, result: '1-0' } })
  ], { name: 'Kavin S' })
  const numbers = archiveNumbers(rows)
  assert.deepEqual(numbers.overTime.map((one) => one.month), ['2026-03', '2026-05'])
  assert.equal(numbers.overTime[0].played, 2)
  assert.equal(numbers.overTime[0].wins, 1)
  assert.equal(numbers.undated, 2)
  assert.equal(monthWords('2026-03'), 'March 2026')
})

test('best wins are wins over a recorded rating, and there are none when nothing was recorded', () => {
  const rated = archiveRows([
    game({ meta: { white: me, black: { name: 'Strong', rating: 2100 }, result: '1-0' } }),
    game({ meta: { white: me, black: { name: 'Stronger', rating: 2300 }, result: '0-1' } }),
    game({ meta: { white: me, black: { name: 'Middling', rating: 1800 }, result: '1-0' } })
  ], { name: 'Kavin S' })
  const numbers = archiveNumbers(rated)
  assert.deepEqual(numbers.bestWins.map((one) => one.opponentRating), [2100, 1800])
  assert.equal(numbers.ratingsRecorded, 3)

  const unrated = archiveNumbers(archiveRows([game({ meta: { white: me, black: {}, result: '1-0' } })], { name: 'Kavin S' }))
  assert.deepEqual(unrated.bestWins, [])
  assert.equal(unrated.ratingsRecorded, 0)
})

test('only marks the file carried, on your own moves, are counted', () => {
  const rows = archiveRows([
    // Ply 0 is White's move. You are White here, so the ?? is yours and the ? on Black's move is not.
    game({ san: ['e4', 'e5', 'Nf3'], nags: { 0: ['??'], 1: ['?'], 2: ['?!'] }, meta: { white: me, black: {}, result: '0-1' } }),
    game({ san: ['e4', 'e5'], nags: { 1: ['??'] }, meta: { white: {}, black: me, result: '1-0' } }),
    game({ san: ['d4'], meta: { white: me, black: {}, result: '1-0' } })
  ], { name: 'Kavin S' })
  const numbers = archiveNumbers(rows)
  const found = Object.fromEntries(numbers.marks.map((one) => [one.symbol, one.count]))
  assert.deepEqual(found, { '??': 2, '?!': 1 })
  // Worst first, so the blunders are the first thing read.
  assert.equal(numbers.marks[0].symbol, '??')
  assert.equal(numbers.marks[0].meaning, 'a blunder')
  assert.equal(numbers.markedGames, 2)
  // A game with no marks adds nothing, so a list of mistakes never grows out of games nobody judged.
  assert.equal(numbers.marks.some((one) => one.symbol === '?'), false)
})

test('streaks are counted over dated games in the order they were played', () => {
  const rows = archiveRows([
    game({ meta: { white: me, black: {}, result: '1-0', date: '2026.01.01' } }),
    game({ meta: { white: me, black: {}, result: '1-0', date: '2026.01.02' } }),
    game({ meta: { white: me, black: {}, result: '0-1', date: '2026.01.03' } }),
    game({ meta: { white: me, black: {}, result: '1-0', date: '2026.01.04' } }),
    game({ meta: { white: me, black: {}, result: '1-0', date: '2026.01.05' } }),
    game({ meta: { white: me, black: {}, result: '1-0', date: '2026.01.06' } }),
    // Undated and unfinished games are not dropped into the order somewhere.
    game({ meta: { white: me, black: {}, result: '0-1' } })
  ], { name: 'Kavin S' })
  const numbers = archiveNumbers(rows)
  assert.equal(numbers.longestWinStreak, 3)
  assert.equal(numbers.currentWinStreak, 3)
  assert.equal(numbers.averageMoves, 0)
})

test('nothing at all gives nothing at all, and no zeroes dressed up as answers', () => {
  const numbers = archiveNumbers([])
  assert.equal(numbers.counted, 0)
  assert.equal(numbers.all.score, null)
  assert.deepEqual(numbers.overTime, [])
  assert.deepEqual(numbers.byOpening, [])
  assert.deepEqual(numbers.marks, [])
  assert.equal(numbers.averageMoves, null)
  assert.equal(numbers.longestWinStreak, 0)
})
