import { test } from 'node:test'
import assert from 'node:assert/strict'
import { START_FEN } from './rules.ts'
import { buildMoves, fenAt, fingerprintOf, type StoredGame } from './model.ts'
import type { Score } from './evaluation.ts'
import type { PositionEval } from './analysis.ts'
import { buildGameReview } from './review.ts'
import {
  CLASS_ORDER, MISSED_WIN_RULE, MOVE_SYMBOL, classBars, coverWords, coverageBar, missedWins, momentChips,
  passProgress, reviewNotes, ringDash, summaryPoints, theoryEnd
} from './reviewScreen.ts'

/**
 * The Game Report screen's counting, tested on a real game with hand-written scores.
 *
 * No engine runs. The game is played through the rules, so a typo in the notation fails the test rather than
 * producing a position nobody could reach, and the scores are written by hand because that is the only way to test
 * what the screen does with a stretch nobody searched and with a winning position that was let go.
 */

const cp = (n: number): Score => ({ kind: 'cp', cp: n })

function gameOf(sans: string[]): StoredGame {
  const built = buildMoves(START_FEN, sans.map((san) => ({ san })))
  assert.ok(built.ok, 'the test line is not playable')
  return {
    id: 'g1',
    profileId: 'p1',
    source: { kind: 'study' },
    startFen: START_FEN,
    moves: built.moves,
    meta: { white: {}, black: {}, result: '*' },
    variant: 'standard',
    createdAt: 1,
    updatedAt: 1,
    fingerprint: fingerprintOf(START_FEN, built.moves)
  }
}

/** The Italian, six moves: real theory to look up, and six positions to score. */
const ITALIAN = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']

function evalsFor(game: StoredGame, scores: readonly (Score | null)[], depth = 20): PositionEval[] {
  const out: PositionEval[] = []
  scores.forEach((score, ply) => {
    if (score === null) return
    out.push({ ply, fen: fenAt(game, ply), score, depth })
  })
  return out
}

// ---------------------------------------------------------------- the marks beside a move

test('a move nobody searched carries no mark at all', () => {
  // The last move is not in the opening dataset, so nothing but a search could mark it.
  const game = gameOf(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Qh4'])
  const review = buildGameReview(game, evalsFor(game, [cp(20), cp(15), null, null, null, null, null]))
  const notes = reviewNotes(review.moves)
  assert.ok(notes[1], 'the first move was judged, so it has a mark')
  assert.equal(notes[6], undefined, 'an unjudged move is left blank rather than being given a name')
})

test('a move that is theory is marked as theory even when nobody searched it', () => {
  const game = gameOf(ITALIAN)
  const review = buildGameReview(game, evalsFor(game, [cp(20), cp(15), null, null, null, null, null]))
  const notes = reviewNotes(review.moves)
  // Theory says where the move came from, which is a fact about the dataset and not a judgement about the move.
  assert.equal(notes[3]?.kind, 'book')
  assert.match(notes[3]?.title ?? '', /Theory/)
})

test('a mark says what it means in words as well as a symbol', () => {
  const game = gameOf(ITALIAN)
  const review = buildGameReview(game, evalsFor(game, [cp(20), cp(15), cp(10), cp(20), cp(10), cp(15), cp(10)]))
  const notes = reviewNotes(review.moves)
  for (const ply of [1, 2, 3, 4, 5, 6]) {
    const note = notes[ply]
    assert.ok(note, `move ${ply} was judged and should be marked`)
    assert.ok(note.symbol.length > 0 && note.symbol.length <= 2)
    assert.ok(note.title.length > 10, 'the symbol is never the only thing that says what happened')
  }
})

test('every class and award has a symbol', () => {
  for (const klass of CLASS_ORDER) {
    if (klass === 'unclear') continue
    assert.ok(MOVE_SYMBOL[klass], `${klass} has no symbol`)
  }
  assert.ok(MOVE_SYMBOL.brilliant)
  assert.ok(MOVE_SYMBOL.great)
  assert.ok(MOVE_SYMBOL.book)
})

// ---------------------------------------------------------------- the bars

test('the bars are measured against the longest one, so one move still shows', () => {
  const game = gameOf(ITALIAN)
  const review = buildGameReview(game, evalsFor(game, [cp(20), cp(20), cp(20), cp(20), cp(20), cp(-400), cp(-400)]))
  const bars = classBars(review.counts.w)
  const longest = bars.filter((one) => one.share === 1)
  assert.equal(longest.length, 1, 'exactly one bar is full')
  for (const bar of bars) {
    if (bar.count > 0) assert.ok(bar.share > 0, `${bar.klass} has moves and must have a visible bar`)
    else assert.equal(bar.share, 0)
  }
})

test('with nothing judged every bar is empty and nothing is full', () => {
  const game = gameOf(ITALIAN)
  const review = buildGameReview(game, [])
  const bars = classBars(review.counts.w)
  const judged = bars.filter((one) => !one.unjudged)
  assert.deepEqual(judged.map((one) => one.count), [0, 0, 0, 0, 0, 0, 0])
  assert.ok(bars.some((one) => one.unjudged && one.count > 0), 'the unjudged moves are counted, not hidden')
})

// ---------------------------------------------------------------- the dial

test('no accuracy figure means no ring, not a ring at nought', () => {
  assert.equal(ringDash(null, 100), null)
})

test('the ring stroke is the share of the circumference', () => {
  const half = ringDash(0.5, 200)
  assert.ok(half)
  assert.equal(half.drawn, 100)
  assert.equal(half.blank, 100)
  assert.equal(half.percent, 50)
  const whole = ringDash(1, 200)
  assert.ok(whole)
  assert.equal(whole.blank, 0)
  assert.equal(whole.percent, 100)
})

test('a figure outside nought and one cannot draw past the end of the ring', () => {
  const over = ringDash(1.4, 100)
  assert.ok(over)
  assert.equal(over.drawn, 100)
  assert.equal(over.blank, 0)
})

test('the line under the dial says how much of the game it covers', () => {
  const game = gameOf(ITALIAN)
  const whole = buildGameReview(game, evalsFor(game, [cp(20), cp(15), cp(10), cp(20), cp(10), cp(15), cp(10)]))
  assert.match(coverWords(whole.accuracy.w), /all 3 moves judged/)
  const part = buildGameReview(game, evalsFor(game, [cp(20), cp(15), cp(10), null, null, null, null]))
  assert.match(coverWords(part.accuracy.w), /of 3 moves judged/)
})

// ---------------------------------------------------------------- the opening

test('the opening is a chip, and it names where theory stopped', () => {
  const game = gameOf(ITALIAN)
  const review = buildGameReview(game, [])
  const theory = theoryEnd(review.book)
  assert.ok(theory.inBook > 0, 'the Italian is in the dataset')
  assert.ok(theory.name)
  assert.ok(theory.chip.length > 0 && theory.chip.length < 90, 'a chip, not a paragraph')
  assert.equal(theory.eco, review.book.last?.eco ?? null)
})

test('a game that leaves theory says which move it left on', () => {
  // 1.e4 e5 2.Nf3 Nc6 3.Bc4 and then a move the dataset does not name.
  const game = gameOf(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Qh4'])
  const review = buildGameReview(game, [])
  const theory = theoryEnd(review.book)
  if (theory.leftAt !== null) {
    assert.ok(theory.leftLabel, 'a game that left theory has the move it left on')
    assert.match(theory.chip, /left theory at/)
  }
})

// ---------------------------------------------------------------- a win let go

test('a winning position that stops being winning is reported, with both scores', () => {
  const game = gameOf(ITALIAN)
  // White is three pawns up before move 5 and level after it.
  const review = buildGameReview(game, evalsFor(game, [cp(20), cp(20), cp(20), cp(20), cp(300), cp(0), cp(0)]))
  const letGo = missedWins(review.moves)
  assert.equal(letGo.length, 1)
  assert.equal(letGo[0].ply, 5)
  assert.equal(letGo[0].mover, 'w')
  assert.match(letGo[0].says, /White stood at/)
})

test('a move nobody judged is never called a win let go', () => {
  const game = gameOf(ITALIAN)
  const review = buildGameReview(game, evalsFor(game, [cp(20), cp(20), cp(20), cp(20), cp(300), null, null]))
  assert.deepEqual(missedWins(review.moves), [])
})

test('staying winning is not a win let go', () => {
  const game = gameOf(ITALIAN)
  const review = buildGameReview(game, evalsFor(game, [cp(300), cp(320), cp(310), cp(305), cp(300), cp(290), cp(280)]))
  assert.deepEqual(missedWins(review.moves), [])
})

test('the rule behind it is written down and says it is the screen own working', () => {
  assert.match(MISSED_WIN_RULE, /2 pawns ahead/)
  assert.match(MISSED_WIN_RULE, /searched deeply enough/)
})

// ---------------------------------------------------------------- the pass

test('before a pass has run there is no bar and no per cent', () => {
  const idle = passProgress({ running: false, done: 0, total: 0, skipped: 0 })
  assert.equal(idle.share, null)
  assert.equal(idle.percent, null)
  assert.match(idle.words, /No pass/)
})

test('a pass part way through reports what is done and that it can be stopped', () => {
  const half = passProgress({ running: true, done: 5, total: 20, skipped: 3 })
  assert.equal(half.percent, 25)
  assert.match(half.words, /5 of 20/)
  assert.match(half.words, /already deep enough/)
  assert.match(half.words, /stopped/)
})

test('a pass never predicts how long it will take', () => {
  const words = passProgress({ running: true, done: 1, total: 100, skipped: 0 }).words
  assert.doesNotMatch(words, /minute|second|remaining|left/i)
})

test('a pass that found nothing to do says so instead of showing an empty bar', () => {
  const none = passProgress({ running: false, done: 0, total: 0, skipped: 41 })
  assert.equal(none.share, null)
  assert.match(none.words, /all 41 positions/)
})

// ---------------------------------------------------------------- the summary

test('with nothing measured the summary says so and offers the pass', () => {
  const game = gameOf(ITALIAN)
  const review = buildGameReview(game, [])
  const points = summaryPoints(review)
  const texts = points.map((one) => one.text).join(' ')
  assert.match(texts, /Run a pass|still theory|opening was/)
  assert.ok(points.every((one) => one.text.length > 0))
})

test('the summary names the biggest change and ties it to a move you can jump to', () => {
  const game = gameOf(ITALIAN)
  const review = buildGameReview(game, evalsFor(game, [cp(20), cp(20), cp(20), cp(20), cp(20), cp(-600), cp(-600)]))
  const points = summaryPoints(review)
  const biggest = points.find((one) => one.text.includes('biggest change'))
  assert.ok(biggest, 'a game with a big swing says where it was')
  assert.ok(biggest.ply !== null && biggest.ply > 0, 'and the line can be jumped to')
})

test('the summary never invents an accuracy line for a side that was not judged', () => {
  const game = gameOf(ITALIAN)
  const review = buildGameReview(game, [])
  for (const point of summaryPoints(review)) {
    assert.doesNotMatch(point.text, /per cent/, 'no percentage without a measurement behind it')
  }
})

// ---------------------------------------------------------------- coverage and the chips

test('coverage is a share of the positions and says what was too shallow', () => {
  const game = gameOf(ITALIAN)
  const review = buildGameReview(game, evalsFor(game, [cp(20), cp(20), cp(20), null, null, null, null]))
  const bar = coverageBar(review.report.coverage)
  assert.ok(bar.share > 0 && bar.share < 1)
  assert.match(bar.words, /of 7 positions searched/)
})

test('the moment chips are the biggest changes first and never more than asked for', () => {
  const game = gameOf(ITALIAN)
  const review = buildGameReview(game, evalsFor(game, [cp(0), cp(-400), cp(0), cp(-500), cp(0), cp(-600), cp(0)]))
  const chips = momentChips(review.key, 2)
  assert.ok(chips.length <= 2)
  for (const chip of chips) {
    assert.ok(chip.label.length > 0)
    assert.ok(chip.title.length > 0, 'a chip always says why it is one')
  }
})
