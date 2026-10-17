import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  GAME_MODES, NO_LOOKS, announce, enterGameMove, gameMode, gameView, looksSay, noteLook, sayGamePosition, unassisted,
  type BlindGameMode, type GamePhase
} from './blindGame.ts'
import { START_FEN, applyMove, boardSquares } from './rules.ts'

/**
 * A whole game with the board hidden (Section 225).
 *
 * The test that matters most is the sweep at the bottom: across every mode and every phase, while the board is meant
 * to be hidden, **nothing coming out of this file names a square, a piece or a position.** That is the same standard
 * `trainingView.test.ts` holds `viewRules` to, and for the same reason -- a hidden position that leaks through a
 * label or a reason has not been hidden, it has been hidden somewhere nobody looked.
 */

const SQUARE = /\b[a-h][1-8]\b/
const NOTATION = /\b[KQRBN]?[a-h]?x?[a-h][1-8]\b/

/** A position reached by real moves, so the sweep is not run against the start alone. */
const afterSomeMoves = (): string => {
  let fen = START_FEN
  for (const move of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']) {
    const made = applyMove(fen, move)
    assert.ok(made, `${move} should be playable`)
    fen = made.after
  }
  return fen
}

describe('the modes', () => {
  test('three of them, and each says what it allows', () => {
    assert.equal(GAME_MODES.length, 3)
    for (const mode of GAME_MODES) {
      assert.ok(mode.title.length > 0)
      assert.ok(mode.asks.length > 0)
    }
  })

  test('only the last one offers a look', () => {
    assert.equal(gameMode('strict').mayLook, false)
    assert.equal(gameMode('with-list').mayLook, false)
    assert.equal(gameMode('with-looks').mayLook, true)
  })

  test('an id nothing knows falls back to the strictest mode rather than the loosest', () => {
    assert.equal(gameMode('nonsense' as BlindGameMode).id, 'strict')
  })
})

describe('the looks', () => {
  test('a look is counted and kept with the move it was taken at', () => {
    const once = noteLook(NO_LOOKS, 12)
    assert.equal(once.count, 1)
    assert.deepEqual(once.atPlies, [12])
    const twice = noteLook(once, 20)
    assert.equal(twice.count, 2)
    assert.deepEqual(twice.atPlies, [12, 20])
  })

  test('looks cannot be taken back', () => {
    // Append-only on purpose: a look that happened is the one fact about the game somebody would most like gone.
    const looks = noteLook(NO_LOOKS, 4)
    assert.equal(noteLook(looks, 5).count, 2)
    assert.equal(looks.count, 1, 'the earlier value is not changed')
  })

  test('unassisted means the strictest mode and no looks', () => {
    assert.equal(unassisted('strict', NO_LOOKS), true)
    assert.equal(unassisted('strict', noteLook(NO_LOOKS, 1)), false)
    // The list of moves is a memory aid, so a game played with it is not unassisted even with no looks at all.
    assert.equal(unassisted('with-list', NO_LOOKS), false)
    assert.equal(unassisted('with-looks', NO_LOOKS), false)
  })

  test('what it says names the help rather than folding it into a number', () => {
    assert.ok(looksSay('strict', NO_LOOKS).includes('held in your head'))
    assert.ok(looksSay('with-list', NO_LOOKS).includes('listed'))
    assert.ok(looksSay('with-looks', noteLook(NO_LOOKS, 3)).includes('once'))
    assert.ok(looksSay('with-looks', noteLook(noteLook(NO_LOOKS, 3), 7)).includes('2 times'))
  })
})

describe('whether the board may be drawn', () => {
  test('nothing before a game starts', () => {
    const view = gameView({ mode: 'with-looks', phase: 'setup', looking: false, fen: START_FEN, looks: NO_LOOKS })
    assert.equal(view.boardFen, null)
    assert.equal(view.moveList, false)
  })

  test('nothing while playing, in any mode', () => {
    for (const mode of GAME_MODES) {
      const view = gameView({ mode: mode.id, phase: 'playing', looking: false, fen: START_FEN, looks: NO_LOOKS })
      assert.equal(view.boardFen, null, `${mode.id} must not draw a board while the game is on`)
    }
  })

  test('a look shows the board only where the mode allows it', () => {
    const allowed = gameView({ mode: 'with-looks', phase: 'playing', looking: true, fen: START_FEN, looks: NO_LOOKS })
    assert.equal(allowed.boardFen, START_FEN)
    for (const mode of ['strict', 'with-list'] as const) {
      const refused = gameView({ mode, phase: 'playing', looking: true, fen: START_FEN, looks: NO_LOOKS })
      assert.equal(refused.boardFen, null, `${mode} has no look, so asking for one must change nothing`)
    }
  })

  test('the board comes back when the game is over', () => {
    const view = gameView({ mode: 'strict', phase: 'over', looking: false, fen: START_FEN, looks: NO_LOOKS })
    assert.equal(view.boardFen, START_FEN)
    assert.equal(view.moveList, true)
  })

  test('the look button is offered only where a look is allowed', () => {
    assert.equal(gameView({ mode: 'strict', phase: 'playing', looking: false, fen: START_FEN, looks: NO_LOOKS }).lookButton, false)
    assert.equal(gameView({ mode: 'with-looks', phase: 'playing', looking: false, fen: START_FEN, looks: NO_LOOKS }).lookButton, true)
  })

  test('nothing names a square while the board is hidden', () => {
    const phases: GamePhase[] = ['setup', 'playing']
    const fens = [START_FEN, afterSomeMoves()]
    for (const mode of GAME_MODES) {
      for (const phase of phases) {
        for (const fen of fens) {
          const view = gameView({ mode: mode.id, phase, looking: false, fen, looks: NO_LOOKS })
          assert.equal(view.boardFen, null)
          for (const text of [view.because ?? '', view.label]) {
            assert.ok(!SQUARE.test(text), `${mode.id}/${phase} said a square: ${text}`)
            assert.ok(!NOTATION.test(text), `${mode.id}/${phase} said notation: ${text}`)
          }
        }
      }
    }
  })
})

describe('entering a move', () => {
  test('a move that can be played comes back written properly', () => {
    const entry = enterGameMove(START_FEN, 'g1f3')
    assert.equal(entry.uci, 'g1f3')
    assert.equal(entry.san, 'Nf3')
    assert.equal(entry.fault, null)
    assert.equal(entry.asking, false)
  })

  test('an ambiguous move is a question, not a refusal, and nothing is played', () => {
    // Knights on b1 and f1 both reach d2, and with no board in front of somebody that is an easy thing to write.
    const fen = '4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1'
    const entry = enterGameMove(fen, 'Nd2')
    assert.equal(entry.uci, null, 'nothing may be played from an ambiguous move')
    assert.equal(entry.asking, true)
    assert.equal(entry.fault, 'notation')
    assert.ok(entry.suggest.length > 1, 'the ways of writing it are offered')
  })

  test('a notation mistake and a chess mistake stay different kinds all the way to the message', () => {
    assert.equal(enterGameMove(START_FEN, 'xyz').fault, 'notation')
    assert.equal(enterGameMove(START_FEN, 'Nf6').fault, 'chess')
  })

  test('nothing written is a notation fault, not a crash', () => {
    const entry = enterGameMove(START_FEN, '')
    assert.equal(entry.fault, 'notation')
    assert.equal(entry.uci, null)
  })
})

describe('announcing a move', () => {
  test('notation and words together', () => {
    const said = announce(START_FEN, 'Nf3')
    assert.ok(said)
    assert.ok(said.includes('Nf3'))
    assert.ok(said.includes('knight'))
    assert.ok(said.includes('g1'))
    assert.ok(said.includes('f3'))
  })

  test('castling is said as castling, from the rules\' own answer', () => {
    let fen = START_FEN
    for (const move of ['e4', 'e5', 'Nf3', 'Nf6', 'Bc4', 'Bc5']) {
      const made = applyMove(fen, move)
      assert.ok(made)
      fen = made.after
    }
    const said = announce(fen, 'O-O')
    assert.ok(said)
    assert.ok(said.includes('castles short'))
  })

  test('en passant says which pawn went, because it is not the square the capture lands on', () => {
    let fen = START_FEN
    for (const move of ['e4', 'd5', 'e5', 'f5']) {
      const made = applyMove(fen, move)
      assert.ok(made)
      fen = made.after
    }
    const said = announce(fen, 'exf6')
    assert.ok(said)
    assert.ok(said.includes('f5'), 'the pawn that went was on f5, and that is what must be said')
    assert.ok(said.includes('as it passes'))
  })

  test('a promotion says what the pawn became', () => {
    const said = announce('4k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'a8=Q')
    assert.ok(said)
    assert.ok(said.includes('queen'))
  })

  test('check and checkmate are said', () => {
    const check = announce('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'Ra8')
    assert.ok(check)
    assert.ok(check.includes('Check'))
    const mate = announce('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1', 'Qg7')
    assert.ok(mate)
    assert.ok(mate.includes('Checkmate'))
  })

  test('a move that cannot be played is announced as nothing', () => {
    assert.equal(announce(START_FEN, 'Nf6'), null)
    assert.equal(announce(START_FEN, 'nonsense'), null)
  })
})

describe('the position written out', () => {
  test('every piece on the board is in it', () => {
    const said = sayGamePosition(START_FEN)
    for (const word of ['White', 'Black', 'king', 'pawns', 'to move']) assert.ok(said.includes(word), `missing: ${word}`)
    // Thirty-two pieces: every square they stand on is named, which is why this counts as a look.
    for (const piece of boardSquares(START_FEN)) assert.ok(said.includes(piece.square), `missing ${piece.square}`)
  })

  test('an empty board is said rather than guessed at', () => {
    assert.equal(sayGamePosition('8/8/8/8/8/8/8/8 w - - 0 1'), 'There is no position here.')
  })
})
