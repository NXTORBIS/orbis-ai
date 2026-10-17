import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cancelPromotion, choosePromotion, clickSquare, describeSquare, destinationsFor, emptyHolding, marksFor, release,
  takeAtCursor, walk, type Holding
} from './selection.ts'
import { START_FEN, applyMove, destinationsFrom, legalMoves } from '../../../../../shared/chess/rules.ts'
import { ALL_SQUARES } from './boardGeometry.ts'

const held = (over: Partial<Holding> = {}): Holding => ({ ...emptyHolding(), ...over })

test('nothing is held to begin with', () => {
  const start = emptyHolding()
  assert.equal(start.selected, null)
  assert.equal(start.promotion, null)
  assert.equal(start.cursor, 'e4')
  assert.equal(emptyHolding('a1').cursor, 'a1')
})

test('clicking your own piece picks it up and clicking it again puts it down', () => {
  const first = clickSquare(START_FEN, held(), 'e2')
  assert.equal(first.kind, 'held')
  assert.equal(first.holding.selected, 'e2')
  const second = clickSquare(START_FEN, first.holding, 'e2')
  assert.equal(second.kind, 'nothing')
  assert.equal(second.holding.selected, null)
})

test('clicking the other side\'s piece picks up nothing', () => {
  const result = clickSquare(START_FEN, held(), 'e7')
  assert.equal(result.kind, 'nothing')
  assert.equal(result.holding.selected, null)
  // And it never produces a move.
  assert.equal('move' in result, false)
})

test('a square the piece can go to plays the rules\' own move, unaltered', () => {
  const picked = clickSquare(START_FEN, held(), 'e2')
  const played = clickSquare(START_FEN, picked.holding, 'e4')
  assert.equal(played.kind, 'move')
  assert.ok(played.kind === 'move')
  /*
   * The move is the one `rules.ts` returns for this position, object for object. The 3D board does not build a
   * move, correct a move or decorate a move -- which is the whole reason the flat board and this one can never
   * disagree about what was played.
   */
  assert.deepEqual(played.move, applyMove(START_FEN, { from: 'e2', to: 'e4' }))
  assert.equal(played.move.san, 'e4')
  assert.equal(played.move.before, START_FEN)
  assert.equal(played.holding.selected, null)
})

test('a square the piece cannot go to lets go and plays nothing', () => {
  const picked = clickSquare(START_FEN, held(), 'e2')
  const nowhere = clickSquare(START_FEN, picked.holding, 'e5')
  assert.equal(nowhere.kind, 'nothing')
  assert.equal(nowhere.holding.selected, null)
})

test('every square the board offers is a square the rules offered, and no others', () => {
  // Checked over a position with captures, castling and an en passant square available.
  const fen = 'r3k2r/pp1ppppp/8/2pP4/8/8/PPP1PPPP/R3K2R w KQkq c6 0 10'
  for (const square of ALL_SQUARES) {
    const offered = destinationsFor(fen, square)
    const fromRules = new Set(destinationsFrom(fen, square).map((one) => one.to))
    const shown = new Set([...offered.empty, ...offered.captures])
    assert.deepEqual([...shown].sort(), [...fromRules].sort(), `${square} offered something different`)
    // And the two lists never overlap: a square is either empty or has something to take.
    for (const one of offered.empty) assert.equal(offered.captures.includes(one), false)
  }
})

test('a square is offered once, even when a pawn could become four different pieces there', () => {
  const fen = '7k/4P3/8/8/8/8/8/4K3 w - - 0 1'
  const offered = destinationsFor(fen, 'e7')
  const fromRules = destinationsFrom(fen, 'e7').filter((one) => one.to === 'e8')
  assert.ok(fromRules.length >= 4, 'the rules did not offer the four promotions')
  assert.equal(offered.empty.filter((one) => one === 'e8').length, 1, 'e8 was marked more than once')
})

test('a pawn reaching the last rank asks what it becomes before anything is played', () => {
  const fen = '7k/4P3/8/8/8/8/8/4K3 w - - 0 1'
  const picked = clickSquare(fen, held(), 'e7')
  const asked = clickSquare(fen, picked.holding, 'e8')
  assert.equal(asked.kind, 'ask-promotion')
  assert.deepEqual(asked.holding.promotion, { from: 'e7', to: 'e8' })
  assert.equal('move' in asked, false, 'something was played before the question was answered')
})

test('nothing else can happen while the promotion question is open', () => {
  const fen = '7k/4P3/8/8/8/8/8/4K3 w - - 0 1'
  const asked = clickSquare(fen, clickSquare(fen, held(), 'e7').holding, 'e8')
  for (const square of ['e1', 'a1', 'd2', 'e8']) {
    const again = clickSquare(fen, asked.holding, square)
    assert.equal(again.kind, 'ask-promotion', `clicking ${square} got past the question`)
    assert.equal('move' in again, false)
  }
})

test('answering the question plays the move with the piece that was chosen', () => {
  const fen = '7k/4P3/8/8/8/8/8/4K3 w - - 0 1'
  const asked = clickSquare(fen, clickSquare(fen, held(), 'e7').holding, 'e8')
  for (const piece of ['q', 'r', 'b', 'n'] as const) {
    const played = choosePromotion(fen, asked.holding, piece)
    assert.equal(played.kind, 'move')
    assert.ok(played.kind === 'move')
    assert.equal(played.move.promotion, piece)
    assert.deepEqual(played.move, applyMove(fen, { from: 'e7', to: 'e8', promotion: piece }))
    assert.equal(played.holding.promotion, null)
  }
})

test('a pawn cannot become a king or another pawn', () => {
  const fen = '7k/4P3/8/8/8/8/8/4K3 w - - 0 1'
  const asked = clickSquare(fen, clickSquare(fen, held(), 'e7').holding, 'e8')
  for (const piece of ['k', 'p'] as const) {
    const refused = choosePromotion(fen, asked.holding, piece)
    assert.equal(refused.kind, 'ask-promotion', `a pawn was allowed to become a ${piece}`)
    assert.equal('move' in refused, false)
  }
})

test('cancelling the question leaves the position alone', () => {
  const fen = '7k/4P3/8/8/8/8/8/4K3 w - - 0 1'
  const asked = clickSquare(fen, clickSquare(fen, held(), 'e7').holding, 'e8')
  const cancelled = cancelPromotion(asked.holding)
  assert.equal(cancelled.kind, 'nothing')
  assert.equal(cancelled.holding.promotion, null)
  // Answering a question nobody asked does nothing either.
  assert.equal(choosePromotion(fen, cancelled.holding, 'q').kind, 'nothing')
})

test('a board nobody may play on picks nothing up and plays nothing', () => {
  const picked = clickSquare(START_FEN, held(), 'e2', false)
  assert.equal(picked.kind, 'nothing')
  assert.equal(picked.holding.selected, null)
  // The cursor still moves, so a game being watched can still be read out square by square.
  assert.equal(picked.holding.cursor, 'e2')
  // Even holding something, nothing can be played.
  const pretend = held({ selected: 'e2' })
  assert.equal(clickSquare(START_FEN, pretend, 'e4', false).kind, 'nothing')
})

test('a square that is not a square changes nothing at all', () => {
  const start = held({ selected: 'e2' })
  for (const bad of ['', 'z9', 'e9', 'E2', 'e2 ']) {
    const result = clickSquare(START_FEN, start, bad)
    assert.equal(result.kind, 'nothing')
    assert.equal(result.holding, start, `${JSON.stringify(bad)} was acted on`)
  }
})

test('letting go lets go of everything', () => {
  const result = release(held({ selected: 'e2', promotion: { from: 'e7', to: 'e8' } }))
  assert.equal(result.kind, 'nothing')
  assert.equal(result.holding.selected, null)
  assert.equal(result.holding.promotion, null)
})

test('taking a piece works by clicking the piece being taken', () => {
  const fen = 'rnbqkbnr/pppp1ppp/8/4p3/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 2'
  const picked = clickSquare(fen, held(), 'd4')
  assert.equal(picked.holding.selected, 'd4')
  const taken = clickSquare(fen, picked.holding, 'e5')
  assert.equal(taken.kind, 'move')
  assert.ok(taken.kind === 'move')
  assert.equal(taken.move.captured, 'p')
  assert.equal(taken.move.san, 'dxe5')
})

test('the marks come from the rules and from nothing else', () => {
  const picked = clickSquare(START_FEN, held(), 'e2')
  const marks = marksFor(START_FEN, picked.holding, true, true)
  assert.equal(marks.selected, 'e2')
  assert.deepEqual([...marks.legal].sort(), ['e3', 'e4'])
  assert.deepEqual(marks.captures, [])
  assert.equal(marks.check, null)
  assert.equal(marks.cursor, 'e2')
  // Turning the offers off leaves the squares unmarked without changing what is legal.
  const quiet = marksFor(START_FEN, picked.holding, false, false)
  assert.deepEqual(quiet.legal, [])
  assert.equal(quiet.cursor, '')
  assert.equal(quiet.selected, 'e2')
})

test('the king in check is the king the rules say is in check', () => {
  // Black has just been checked by the queen on h5; the king on e8 is the one to mark.
  const fen = '4k3/8/8/7Q/8/8/8/4K3 b - - 0 1'
  const marks = marksFor(fen, held(), true, false)
  assert.equal(marks.check, 'e8')
  // No check, nothing marked.
  assert.equal(marksFor(START_FEN, held(), true, false).check, null)
})

test('mate marks the mated king too, because the game being over does not un-check it', () => {
  const fen = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'
  const marks = marksFor(fen, held(), true, false)
  assert.equal(marks.check, 'e1')
})

test('walking the squares goes the way the screen goes, not the way White goes', () => {
  // With White at the bottom, right along the files and up the ranks.
  assert.equal(walk('e4', 1, 0, 'w'), 'f4')
  assert.equal(walk('e4', 0, 1, 'w'), 'e5')
  // Turned round, the screen's right is the other way along the files.
  assert.equal(walk('e4', 1, 0, 'b'), 'd4')
  assert.equal(walk('e4', 0, 1, 'b'), 'e3')
})

test('walking stops at the edge rather than falling off it', () => {
  assert.equal(walk('a1', -1, -1, 'w'), 'a1')
  assert.equal(walk('h8', 1, 1, 'w'), 'h8')
  assert.equal(walk('a1', 1, 1, 'b'), 'a1')
  assert.equal(walk('h8', -1, -1, 'b'), 'h8')
  // Nonsense starts from the middle rather than from nowhere.
  assert.equal(walk('zz', 0, 0, 'w'), 'e4')
})

test('Enter does exactly what clicking where the cursor is does', () => {
  const start = held({ cursor: 'e2' })
  assert.deepEqual(takeAtCursor(START_FEN, start), clickSquare(START_FEN, start, 'e2'))
  const picked = takeAtCursor(START_FEN, start)
  const walked: Holding = { ...picked.holding, cursor: 'e4' }
  const played = takeAtCursor(START_FEN, walked)
  assert.equal(played.kind, 'move')
})

test('a square says what is on it and what is going on there', () => {
  const picked = clickSquare(START_FEN, held(), 'e2')
  const marks = marksFor(START_FEN, picked.holding, true, true)
  assert.equal(describeSquare(START_FEN, 'e2', marks, null, []), 'e2, white pawn, picked up')
  assert.equal(describeSquare(START_FEN, 'e4', marks, null, []), 'e4, empty, can move here')
  assert.equal(describeSquare(START_FEN, 'e7', marks, null, []), 'e7, black pawn')
  assert.equal(describeSquare(START_FEN, 'd1', marks, null, []), 'd1, white queen')
  assert.equal(
    describeSquare(START_FEN, 'a1', marks, { from: 'a1', to: 'a1' }, ['a1']),
    'a1, white rook, last move, marked'
  )
})

test('no legal move in any opening position is ever refused by the board', () => {
  /*
   * A board that offered a square and then would not play it would be worse than one that offered nothing. So every
   * legal move from a handful of real positions is played through the board's own path, and every one must come out
   * as the rules' move.
   */
  const positions = [
    START_FEN,
    'r3k2r/pp1ppppp/8/2pP4/8/8/PPP1PPPP/R3K2R w KQkq c6 0 10',
    'rnbqkbnr/pppp1ppp/8/4p3/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 2',
    '8/2P2k2/8/8/8/8/5K2/8 w - - 0 1'
  ]
  for (const fen of positions) {
    for (const move of legalMoves(fen)) {
      const picked = clickSquare(fen, held(), move.from)
      assert.equal(picked.holding.selected, move.from, `${fen}: ${move.from} could not be picked up`)
      const result = clickSquare(fen, picked.holding, move.to)
      if (move.promotion) {
        assert.equal(result.kind, 'ask-promotion', `${fen}: ${move.san} did not ask what the pawn becomes`)
        const answered = choosePromotion(fen, result.holding, move.promotion)
        assert.ok(answered.kind === 'move')
        assert.deepEqual(answered.move, move)
      } else {
        assert.ok(result.kind === 'move', `${fen}: ${move.san} was refused by the board`)
        assert.deepEqual(result.move, move)
      }
    }
  }
})

test('no illegal move can get through the board, from any square to any square', () => {
  const fen = 'rnbqkbnr/pppp1ppp/8/4p3/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 2'
  const legal = new Set(legalMoves(fen).map((one) => `${one.from}${one.to}`))
  let played = 0
  for (const from of ALL_SQUARES) {
    const picked = clickSquare(fen, held(), from)
    for (const to of ALL_SQUARES) {
      const result = clickSquare(fen, picked.holding, to)
      const isMove = result.kind === 'move' || result.kind === 'ask-promotion'
      if (isMove) played += 1
      if (isMove && !legal.has(`${from}${to}`)) {
        assert.fail(`the board played ${from}${to}, which the rules do not allow`)
      }
    }
  }
  assert.ok(played > 0, 'nothing at all was playable, so this proved nothing')
})
