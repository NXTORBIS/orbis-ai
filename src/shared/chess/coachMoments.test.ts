import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coachMoments, momentCounts, moveNumberOf } from './coachMoments.ts'
import type { AnalysedGame } from './coach.ts'
import { START_FEN, applyMove } from './rules.ts'

/** A real position, played out by the rules rather than written by hand. */
function after(moves: readonly string[]): string {
  let fen = START_FEN
  for (const move of moves) {
    const made = applyMove(fen, move)
    assert.ok(made, `${move} is not legal in ${fen}`)
    fen = made.after
  }
  return fen
}

const OPENING = after(['e4', 'e5', 'Nf3'])
const LATER = after(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'b5'])

function game(over: Partial<AnalysedGame> = {}): AnalysedGame {
  return {
    gameId: 'g1',
    you: 'b',
    analysedAt: 1_000,
    depth: 18,
    moves: [
      { ply: 1, side: 'b', san: 'e5', before: OPENING, klass: 'good', loss: 10 },
      { ply: 7, side: 'b', san: 'b5', before: LATER, klass: 'blunder', loss: 320 },
      { ply: 5, side: 'b', san: 'a6', before: LATER, klass: 'mistake', loss: 140 }
    ],
    ...over
  }
}

test('nothing analysed means no board and words that say why, not an example', () => {
  const none = coachMoments({})
  assert.equal(none.moments.length, 0)
  assert.match(none.says, /has been through the engine yet/)
  assert.equal(none.gamesRead, 0)
})

test('a game searched too shallow is not evidence, and is counted apart', () => {
  const got = coachMoments({ games: [game({ depth: 8 })] })
  assert.equal(got.gamesRead, 0)
  assert.equal(got.gamesTooShallow, 1)
  assert.equal(got.moments.length, 0)
  assert.match(got.says, /too shallow/)
})

test('a game that does not say which side you played is not evidence about you', () => {
  const got = coachMoments({ games: [game({ you: null })] })
  assert.equal(got.gamesWithoutASide, 1)
  assert.equal(got.moments.length, 0)
  assert.match(got.says, /which side you played/)
})

test('only your own moves are counted, and only the ones the engine faulted become moments', () => {
  const got = coachMoments({
    games: [game({
      moves: [
        { ply: 6, side: 'w', san: 'Qh5', before: LATER, klass: 'blunder', loss: 900 },
        { ply: 7, side: 'b', san: 'b5', before: LATER, klass: 'mistake', loss: 140 }
      ]
    })]
  })
  assert.equal(got.movesJudged, 1, "the opponent's move is not one of yours")
  assert.equal(got.moments.length, 1)
  assert.equal(got.moments[0].san, 'b5')
})

test('every moment carries the position it was played in, so a board can show it', () => {
  const got = coachMoments({ games: [game()] })
  for (const one of got.moments) {
    assert.equal(one.fen, LATER)
    assert.ok(one.fen.split(/\s+/).length >= 4, 'the position is not a position')
  }
})

test('the worst comes first: a missed mate, then by the centipawns really measured', () => {
  const got = coachMoments({
    games: [game({
      moves: [
        { ply: 3, side: 'b', san: 'a6', before: LATER, klass: 'mistake', loss: 140 },
        { ply: 5, side: 'b', san: 'b5', before: LATER, klass: 'blunder', loss: 320 },
        { ply: 7, side: 'b', san: 'Nf6', before: LATER, klass: 'blunder', loss: 600 },
        { ply: 9, side: 'b', san: 'Rb8', before: LATER, klass: 'missed-mate', loss: null }
      ]
    })]
  })
  assert.deepEqual(got.moments.map((one) => one.san), ['Rb8', 'Nf6', 'b5', 'a6'])
})

test('a cost that could not be measured is said in words, never shown as nought', () => {
  const got = coachMoments({
    games: [game({ moves: [{ ply: 5, side: 'b', san: 'Rb8', before: LATER, klass: 'missed-mate', loss: null }] })]
  })
  assert.equal(got.moments[0].loss, null)
  assert.match(got.moments[0].says, /could not be put on one scale/)
  assert.doesNotMatch(got.moments[0].says, /0\.0 pawns/)
})

test('what a moment says names the move, the measurement and the depth it was judged at', () => {
  const got = coachMoments({ games: [game()] })
  const worst = got.moments[0]
  assert.match(worst.says, /Move 4, Black/)
  assert.match(worst.says, /3\.2 pawns given away/)
  assert.match(worst.says, /depth 18/)
  assert.match(worst.origin, /Your own game/)
})

test('the phase is worked out from the position, not stored as an opinion', () => {
  const got = coachMoments({ games: [game()] })
  for (const one of got.moments) assert.ok(one.phase === null || ['opening', 'middlegame', 'endgame'].includes(one.phase))
})

test('a clean game says the engine found nothing, which is not the same as nothing read', () => {
  const got = coachMoments({
    games: [game({ moves: [{ ply: 1, side: 'b', san: 'e5', before: OPENING, klass: 'best', loss: 0 }] })]
  })
  assert.equal(got.gamesRead, 1)
  assert.equal(got.moments.length, 0)
  assert.match(got.says, /found nothing it called a mistake or worse/)
})

test('only as many moments as asked for, and the words say it is the worst of them', () => {
  const got = coachMoments({ games: [game()] }, { limit: 1 })
  assert.equal(got.moments.length, 1)
  assert.equal(got.seriousMoves, 2, 'the count is of everything found, not of what is shown')
  assert.match(got.says, /The worst 1/)
})

test('the counts beside the board only name classes that really occurred', () => {
  const got = coachMoments({ games: [game()] })
  const counts = momentCounts(got.moments)
  assert.deepEqual(counts, [{ klass: 'blunder', count: 1 }, { klass: 'mistake', count: 1 }])
})

test('a ply becomes the move number a player would say', () => {
  assert.equal(moveNumberOf(0), 1)
  assert.equal(moveNumberOf(1), 1)
  assert.equal(moveNumberOf(2), 2)
  assert.equal(moveNumberOf(7), 4)
})

test('the origin sentence is always there, so no figure on screen is naked', () => {
  for (const got of [coachMoments({}), coachMoments({ games: [game()] })]) {
    assert.ok(got.origin.length > 30)
    assert.match(got.origin, /Nothing on this board was chosen as an example/)
  }
})
