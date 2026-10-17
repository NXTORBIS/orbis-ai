import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALL_SQUARES, DEFAULT_VISION_SETUP, RATE_FLOOR, VISION_DIRECTIONS, VISION_PASS,
  answer, askNow, directionNote, isSquareName, msLeft, newRound, piecesOnBoard, readSquareName, readVisionItem,
  roundOver, scoreLine, squareColour, stop, tidySetup, visionAsks, visionBest, visionItem, visionRows, visionScore,
  visionVerdict, visionView,
  type VisionDirection, type VisionRound, type VisionSetup
} from './vision.ts'
import { safeWhileHidden } from './trainingView.ts'
import { START_FEN } from './rules.ts'

/**
 * The coordinate trainer.
 *
 * Three things here are worth more than the rest.
 *
 * `visionRows` is the whole feature: a board drawn the wrong way round from Black would teach somebody the opposite
 * of what the drill is for, and it would look perfectly fine on screen to anybody who plays White.
 *
 * The board rule is checked the way `trainingView.test.ts` checks it: every combination of settings is walked, and
 * wherever `visionView` hands back no position, nothing else it hands back may name a square or a piece. A screen
 * that has no other way to get a position cannot then leak one.
 *
 * And every refusal is checked as a refusal: no rate from two answers, no score from a round with the labels on, no
 * pass without the stated number of squares.
 */

const SETUP = (over: Partial<VisionSetup> = {}): VisionSetup => ({ ...DEFAULT_VISION_SETUP, ...over })

// ---------------------------------------------------------------- the board, from either side

describe('the board, laid out', () => {
  test('from White, a8 is the top left and h1 the bottom right', () => {
    const rows = visionRows('w')
    assert.equal(rows.length, 8)
    assert.equal(rows[0][0], 'a8')
    assert.equal(rows[0][7], 'h8')
    assert.equal(rows[7][0], 'a1')
    assert.equal(rows[7][7], 'h1')
  })

  test('from Black it is the other way round, which is the half people get wrong', () => {
    const rows = visionRows('b')
    assert.equal(rows[0][0], 'h1')
    assert.equal(rows[0][7], 'a1')
    assert.equal(rows[7][0], 'h8')
    assert.equal(rows[7][7], 'a8')
  })

  test('either way it is the same sixty-four squares, each once', () => {
    for (const from of ['w', 'b'] as const) {
      const flat = visionRows(from).flat()
      assert.equal(flat.length, 64)
      assert.equal(new Set(flat).size, 64)
      for (const square of flat) assert.ok(isSquareName(square), `${square} is not a square`)
    }
    assert.equal(ALL_SQUARES.length, 64)
    assert.equal(new Set(ALL_SQUARES).size, 64)
  })

  test('from Black, a row is one rank -- it is not the White board with the rows reversed only', () => {
    // The bug this catches: reversing the ranks and forgetting the files gives a board where a1 is bottom left
    // from both sides, which is wrong and looks almost right.
    const top = visionRows('b')[0]
    assert.deepEqual(top, ['h1', 'g1', 'f1', 'e1', 'd1', 'c1', 'b1', 'a1'])
  })

  test('a1 is dark and h1 is light, which is what a board really looks like', () => {
    assert.equal(squareColour('a1'), 'dark')
    assert.equal(squareColour('h1'), 'light')
    assert.equal(squareColour('a8'), 'light')
    assert.equal(squareColour('h8'), 'dark')
    assert.equal(squareColour('e4'), 'light')
    // Thirty-two of each, or the colouring is wrong somewhere.
    assert.equal(ALL_SQUARES.filter((one) => squareColour(one) === 'dark').length, 32)
  })
})

describe('reading what somebody typed', () => {
  test('a capital, a space, surrounding spaces -- all the same answer', () => {
    assert.equal(readSquareName('e4'), 'e4')
    assert.equal(readSquareName('E4'), 'e4')
    assert.equal(readSquareName(' e 4 '), 'e4')
    assert.equal(readSquareName('\tH8\n'), 'h8')
  })

  test('and nothing else', () => {
    for (const text of ['e9', 'i4', '44', 'e', 'king', '', 'e4e5', 'e-4']) {
      assert.equal(readSquareName(text), null, `"${text}" should not read as a square`)
    }
  })
})

// ---------------------------------------------------------------- the questions

describe('the questions', () => {
  test('the same seed gives the same round, so a round can be played again exactly', () => {
    assert.deepEqual(visionAsks(7, 40), visionAsks(7, 40))
    assert.notDeepEqual(visionAsks(7, 40), visionAsks(8, 40))
  })

  test('no square follows itself', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const asks = visionAsks(seed, 300)
      for (let at = 1; at < asks.length; at += 1) {
        assert.notEqual(asks[at].square, asks[at - 1].square, `seed ${seed} asked ${asks[at].square} twice running`)
      }
    }
  })

  test('every question is a real square, and they are numbered from zero', () => {
    const asks = visionAsks(4, 100)
    for (const [at, ask] of asks.entries()) {
      assert.equal(ask.at, at)
      assert.ok(isSquareName(ask.square))
    }
  })

  test('a round has more questions than anybody can answer in the time', () => {
    const round = newRound(SETUP({ seconds: 30 }), { seed: 1, now: 0 })
    assert.ok(round.asks.length >= 60, `a 30 second round only had ${round.asks.length} questions ready`)
  })
})

// ---------------------------------------------------------------- answering

const playRound = (
  setup: VisionSetup,
  answers: readonly { right: boolean; after: number }[],
  o: { seed?: number } = {}
): VisionRound => {
  let round = newRound(setup, { seed: o.seed ?? 1, now: 0 })
  let now = 0
  for (const one of answers) {
    now += one.after
    const ask = askNow(round)
    if (!ask) break
    const given = one.right ? ask.square : wrongSquare(ask.square)
    round = answer(round, given, now).round
  }
  return round
}

const wrongSquare = (square: string): string => ALL_SQUARES.find((one) => one !== square) ?? 'a1'

describe('answering', () => {
  test('a right answer and a wrong one are both recorded, with what was given', () => {
    let round = newRound(SETUP(), { seed: 1, now: 1000 })
    const first = askNow(round)
    assert.ok(first)
    const good = answer(round, first.square.toUpperCase(), 1500)
    assert.ok(good.mark)
    assert.equal(good.mark.right, true)
    round = good.round
    const second = askNow(round)
    assert.ok(second)
    const bad = answer(round, wrongSquare(second.square), 2000)
    assert.ok(bad.mark)
    assert.equal(bad.mark.right, false)
    assert.match(bad.mark.says, new RegExp(second.square))
    assert.equal(bad.round.answers.length, 2)
    assert.equal(bad.round.answers[1].given, wrongSquare(second.square))
  })

  test('a word that is not a square is wrong, and says what was really being asked', () => {
    const round = newRound(SETUP(), { seed: 2, now: 0 })
    const ask = askNow(round)
    assert.ok(ask)
    const got = answer(round, 'the middle one', 500)
    assert.ok(got.mark)
    assert.equal(got.mark.right, false)
    assert.match(got.mark.says, /is not a square on a chessboard/)
  })

  test('nothing is recorded after the time is up', () => {
    const round = newRound(SETUP({ seconds: 10 }), { seed: 3, now: 0 })
    const late = answer(round, askNow(round)?.square ?? 'a1', 10_001)
    assert.equal(late.mark, null)
    assert.equal(late.round.answers.length, 0)
    assert.match(late.says, /time was up/)
    assert.ok(roundOver(late.round, 10_001))
  })

  test('nothing is recorded after the round was stopped', () => {
    const round = stop(newRound(SETUP(), { seed: 3, now: 0 }), 5000)
    assert.equal(askNow(round), null)
    const after = answer(round, 'e4', 5001)
    assert.equal(after.mark, null)
    assert.equal(after.round.answers.length, 0)
  })

  test('the time left runs down and never below zero', () => {
    const round = newRound(SETUP({ seconds: 30 }), { seed: 1, now: 1000 })
    assert.equal(msLeft(round, 1000), 30_000)
    assert.equal(msLeft(round, 11_000), 20_000)
    assert.equal(msLeft(round, 99_000), 0)
  })

  test('each answer carries how long it took, measured from when it was asked', () => {
    const round = playRound(SETUP(), [{ right: true, after: 800 }, { right: true, after: 1200 }])
    assert.equal(round.answers[0].ms, 800)
    assert.equal(round.answers[1].ms, 1200)
  })
})

// ---------------------------------------------------------------- what the round came to

describe('what the round came to', () => {
  test('right, wrong and asked are counted', () => {
    const round = playRound(SETUP({ seconds: 60 }), [
      { right: true, after: 900 }, { right: false, after: 900 }, { right: true, after: 900 }
    ])
    const score = visionScore(round, 3000)
    assert.equal(score.right, 2)
    assert.equal(score.wrong, 1)
    assert.equal(score.asked, 3)
    assert.equal(score.bestRun, 1)
  })

  test('the best run is the longest run of right answers, not the total', () => {
    const round = playRound(SETUP({ seconds: 60 }), [
      { right: true, after: 500 }, { right: true, after: 500 }, { right: false, after: 500 },
      { right: true, after: 500 }
    ])
    assert.equal(visionScore(round, 2000).bestRun, 2)
  })

  test('there is no rate below the floor, and the sentence says what the floor is', () => {
    const round = playRound(SETUP({ seconds: 60 }), [{ right: true, after: 900 }, { right: true, after: 900 }])
    const score = visionScore(round, 1800)
    assert.equal(score.perMinute, null, 'two answers in under two seconds is not a speed')
    assert.ok(score.says.some((one) => /squares a minute/.test(one)))
  })

  test('and there is one above it', () => {
    const answers = Array.from({ length: 6 }, () => ({ right: true, after: 1000 }))
    const round = playRound(SETUP({ seconds: 60 }), answers)
    const score = visionScore(round, RATE_FLOOR.ms + 1000)
    assert.equal(score.right, 6)
    assert.ok(score.perMinute !== null && score.perMinute > 0, `expected a rate, got ${String(score.perMinute)}`)
    assert.equal(score.msPerRight, 1000)
  })

  test('msPerRight is null when nothing was right, rather than zero', () => {
    const round = playRound(SETUP({ seconds: 60 }), [{ right: false, after: 900 }])
    assert.equal(visionScore(round, 900).msPerRight, null)
  })

  test('with the labels on the board the round is not counted, and it says why', () => {
    const answers = Array.from({ length: 12 }, () => ({ right: true, after: 400 }))
    const round = playRound(SETUP({ coordinates: true, seconds: 60 }), answers)
    const score = visionScore(round, 6000)
    assert.equal(score.right, 12)
    assert.equal(score.scored, false)
    assert.equal(score.passed, false, 'a round with the answers on screen cannot be passed')
    assert.ok(score.says.some((one) => /labels/.test(one)))
    assert.match(scoreLine(score), /not counted/)
  })

  test('the stated pass mark is the one that is applied', () => {
    const allRight = Array.from({ length: VISION_PASS.least }, () => ({ right: true, after: 400 }))
    assert.equal(visionScore(playRound(SETUP({ seconds: 60 }), allRight), 6000).passed, true)

    const oneShort = Array.from({ length: VISION_PASS.least - 1 }, () => ({ right: true, after: 400 }))
    assert.equal(visionScore(playRound(SETUP({ seconds: 60 }), oneShort), 6000).passed, false)

    const oneMissed = [...allRight, { right: false, after: 400 }]
    assert.equal(visionScore(playRound(SETUP({ seconds: 60 }), oneMissed), 6000).passed, false)
  })

  test('an empty round says so rather than reporting nothing out of nothing', () => {
    const score = visionScore(newRound(SETUP(), { seed: 1, now: 0 }), 0)
    assert.equal(score.asked, 0)
    assert.equal(score.perMinute, null)
    assert.ok(score.says.some((one) => /nothing to report/.test(one)))
    assert.equal(scoreLine(score), 'Nothing answered.')
  })

  test('a round stopped early says the figures are for the part that was played', () => {
    let round = playRound(SETUP({ seconds: 60 }), [{ right: true, after: 1000 }])
    round = stop(round, 5000)
    const score = visionScore(round, 60_000)
    assert.equal(score.ms, 5000)
    assert.ok(score.says.some((one) => /stopped before its time/.test(one)))
  })

  test('nothing in the report is called a rating', () => {
    const round = playRound(SETUP({ seconds: 60 }), [{ right: true, after: 1000 }])
    const score = visionScore(round, 2000)
    assert.ok(score.says.some((one) => /Nothing here is a rating/.test(one)))
  })

  test('a board the Black way round is reported as the harder half', () => {
    const round = playRound(SETUP({ from: 'b', seconds: 60 }), [{ right: true, after: 900 }])
    assert.ok(visionScore(round, 1000).says.some((one) => /Black/.test(one)))
  })
})

// ---------------------------------------------------------------- what may be on screen

/** Words that would give a position away if they appeared while no board may be drawn. */
const PIECE_WORDS = /\b(pawn|knight|bishop|rook|queen|king)s?\b/i

describe('whether a piece may be on screen', () => {
  test('with the pieces turned off, nothing drawable comes back and nothing names a square or a piece', () => {
    const directions: readonly VisionDirection[] = ['find-the-square', 'name-the-square']
    let checked = 0
    for (const direction of directions) {
      for (const from of ['w', 'b'] as const) {
        for (const coordinates of [false, true]) {
          const rules = visionView({ setup: SETUP({ direction, from, coordinates, pieces: false }), fen: START_FEN })
          checked += 1
          assert.equal(rules.boardFen, null, 'the pieces are off, so no position may come back')
          assert.ok(safeWhileHidden(rules.label), `the label names a square: ${rules.label}`)
          assert.ok(safeWhileHidden(rules.because ?? ''), `the reason names a square: ${rules.because}`)
          assert.doesNotMatch(rules.label, PIECE_WORDS)
          assert.doesNotMatch(rules.because ?? '', PIECE_WORDS)
        }
      }
    }
    assert.equal(checked, 8, 'every combination should have been walked')
  })

  test('with the pieces turned on and a position that can be played from, that position comes back', () => {
    const rules = visionView({ setup: SETUP({ pieces: true }), fen: START_FEN })
    assert.equal(rules.boardFen, START_FEN)
    assert.equal(rules.because, null)
  })

  test('the pieces were asked for and there is no position: still nothing drawn, and it says so', () => {
    const round = newRound(SETUP({ pieces: true }), { seed: 1, now: 0 })
    assert.equal(round.fen, null)
    assert.ok(round.piecesNote !== null)
    assert.equal(visionView({ setup: round.setup, fen: round.fen }).boardFen, null)
  })

  test('a position that cannot be played from is left out and reported, never drawn', () => {
    // Black is to move and White is the side in check, which no game reaches. The gym's guard refuses it.
    const impossible = '4k3/8/8/8/8/8/8/4K2r b - - 0 1'
    const round = newRound(SETUP({ pieces: true }), { seed: 1, now: 0, fen: impossible })
    assert.equal(round.fen, null, 'a position nothing checked must not reach the board')
    assert.ok(round.piecesNote !== null && /not used/.test(round.piecesNote))
  })

  test('the labels on the board are the screen\'s only reason not to count a round', () => {
    assert.equal(visionView({ setup: SETUP({ coordinates: false }), fen: null }).scored, true)
    assert.equal(visionView({ setup: SETUP({ coordinates: true }), fen: null }).scored, false)
    assert.equal(visionView({ setup: SETUP({ coordinates: true }), fen: null }).coordinates, true)
  })

  test('a round with pieces on the board says that is a different job', () => {
    const setup = SETUP({ pieces: true, seconds: 60 })
    let round = newRound(setup, { seed: 1, now: 0, fen: START_FEN })
    assert.equal(round.fen, START_FEN)
    round = answer(round, askNow(round)?.square ?? 'a1', 900).round
    assert.ok(visionScore(round, 1000).says.some((one) => /pieces in the way/.test(one)))
    assert.match(piecesOnBoard(START_FEN), /32 pieces, White to move/)
    assert.equal(piecesOnBoard(null), '')
  })
})

// ---------------------------------------------------------------- the settings and the record

describe('the settings', () => {
  test('a round length out of range is brought back into it rather than refused silently', () => {
    assert.equal(tidySetup(SETUP({ seconds: 1 })).seconds, 10)
    assert.equal(tidySetup(SETUP({ seconds: 9999 })).seconds, 300)
    assert.equal(tidySetup(SETUP({ seconds: Number.NaN })).seconds, DEFAULT_VISION_SETUP.seconds)
    assert.equal(tidySetup(SETUP({ seconds: 45 })).seconds, 45)
  })

  test('both directions are offered and each says what it asks of somebody', () => {
    assert.equal(VISION_DIRECTIONS.length, 2)
    for (const one of VISION_DIRECTIONS) {
      assert.ok(one.asks.length > 20, `"${one.title}" does not say what it asks`)
      assert.equal(directionNote(one.id).id, one.id)
    }
  })
})

describe('the record', () => {
  test('one record per direction, per point of view, and it reads back', () => {
    for (const direction of ['find-the-square', 'name-the-square'] as const) {
      for (const from of ['w', 'b'] as const) {
        const item = visionItem(SETUP({ direction, from }))
        assert.deepEqual(readVisionItem(item), { direction, from })
      }
    }
    assert.equal(readVisionItem('nonsense'), null)
    assert.equal(readVisionItem('find-the-square:x'), null)
  })

  test('the verdict kept with an attempt says the direction, the side and the score', () => {
    const round = playRound(SETUP({ from: 'b', seconds: 60 }), [{ right: true, after: 900 }])
    const text = visionVerdict(round, visionScore(round, 1000))
    assert.match(text, /Find the square/)
    assert.match(text, /from Black/)
    assert.match(text, /1 right/)
  })

  test('a round that was not counted can never become the best', () => {
    const got = visionBest([
      { at: 1, strict: false, right: 40, outOf: 40, ms: 30_000 },
      { at: 2, strict: true, right: 9, outOf: 10, ms: 30_000 }
    ])
    assert.equal(got.best?.right, 9, 'the 40 came from a round with the labels on')
    assert.equal(got.notCounted, 1)
  })

  test('nothing recorded and nothing counted are different sentences', () => {
    assert.match(visionBest([]).says, /No rounds recorded/)
    assert.match(visionBest([{ at: 1, strict: false, right: 12, outOf: 12, ms: 30_000 }]).says, /none of them counted/)
  })

  test('a best with too little behind it carries no rate', () => {
    const got = visionBest([{ at: 1, strict: true, right: 2, outOf: 2, ms: 1200 }])
    assert.equal(got.best?.perMinute, null)
  })
})
