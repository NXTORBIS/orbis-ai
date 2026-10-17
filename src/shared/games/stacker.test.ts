import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addRubbish,
  clearRows,
  drop,
  dropDistance,
  dropMs,
  fits,
  isStackerState,
  levelOf,
  LINE_SCORES,
  lineScore,
  lock,
  move,
  newGame,
  PERFECT_BONUS,
  pieceCells,
  previewsFor,
  refill,
  RUBBISH,
  SHAPE_IDS,
  shapeCells,
  startingPiece,
  turn,
  type ShapeId,
  type StackerState
} from './stacker.ts'

const seeded = (seed: number): (() => number) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

const emptyWell = (cols = 10, rows = 20): StackerState => ({ cols, rows, well: new Array<number>(cols * rows).fill(0), piece: null, queue: ['I'], bag: [], lines: 0, score: 0, pieces: 0, over: false })

test('every shape is four squares in every turn, and turning four times puts it back', () => {
  for (const id of SHAPE_IDS) {
    for (let rotation = 0; rotation < 4; rotation++) {
      const cells = shapeCells(id, rotation)
      assert.equal(cells.length, 4, `${id} turned ${rotation} times`)
      assert.equal(new Set(cells.map(([x, y]) => `${x},${y}`)).size, 4, `${id} has no two squares in one place`)
    }
    const start = shapeCells(id, 0).map(String).sort().join(' ')
    assert.equal(shapeCells(id, 4).map(String).sort().join(' '), start)
    assert.equal(shapeCells(id, -1).map(String).sort().join(' '), shapeCells(id, 3).map(String).sort().join(' '))
  }
  // The square is the one shape turning does nothing to, which is why its box is two across.
  assert.equal(shapeCells('O', 1).map(String).sort().join(' '), shapeCells('O', 0).map(String).sort().join(' '))
  // The long shape stands up.
  assert.equal(new Set(shapeCells('I', 1).map(([x]) => x)).size, 1)
})

test('a new shape comes in at the top, centred, and inside the walls', () => {
  const state = emptyWell()
  for (const id of SHAPE_IDS) {
    const piece = startingPiece(id, state.cols)
    const cells = pieceCells(piece)
    assert.equal(Math.min(...cells.map(([, y]) => y)), 0, `${id} starts on the first row`)
    assert.ok(cells.every(([x]) => x >= 0 && x < state.cols), `${id} starts inside the walls`)
    assert.equal(fits(state, piece), true)
  }
})

test('a shape stops at the walls, the floor and anything already landed', () => {
  const state = emptyWell()
  const piece = startingPiece('O', state.cols)
  assert.equal(fits(state, { ...piece, x: -1 }), false)
  assert.equal(fits(state, { ...piece, x: state.cols - 1 }), false)
  assert.equal(fits(state, { ...piece, y: state.rows - 1 }), false)
  const blocked = { ...state, well: [...state.well] }
  blocked.well[2 * state.cols + 4] = 3
  assert.equal(fits(blocked, { ...piece, x: 4, y: 1 }), false)
  assert.equal(fits(blocked, { ...piece, x: 4, y: 3 }), true)
  assert.equal(move({ ...state, piece }, 0, state.rows), null)
})

test('a shape against a wall still turns, because it is nudged off it', () => {
  // Standing up in the very first column: turning it flat would stick out through the wall without a nudge.
  const state: StackerState = { ...emptyWell(), piece: { id: 'I', rotation: 1, x: -2, y: 0 } }
  assert.deepEqual(pieceCells(state.piece!).map(([x]) => x), [0, 0, 0, 0])
  assert.equal(fits(state, state.piece!), true)
  const turned = turn(state, 1)
  assert.ok(turned, 'turning against the wall is allowed')
  assert.ok(pieceCells(turned!.piece!).every(([x]) => x >= 0 && x < state.cols))
  // Walled in, a turn is refused rather than teleporting the piece somewhere it fits.
  const full = emptyWell(4, 4)
  full.well = full.well.map(() => 1)
  full.well[1] = 0
  full.well[2] = 0
  const walledIn: StackerState = { ...full, piece: { id: 'S', rotation: 0, x: 0, y: 0 } }
  assert.equal(turn(walledIn, 1), null)
})

test('full rows come out and everything above drops down', () => {
  const cols = 4
  const rows = 3
  const well = [0, 0, 0, 5, 1, 1, 1, 1, 2, 2, 0, 2]
  const cleared = clearRows(well, cols, rows)
  assert.deepEqual(cleared.cleared, [1])
  assert.deepEqual(cleared.well, [0, 0, 0, 0, 0, 0, 0, 5, 2, 2, 0, 2])
  assert.equal(clearRows([0, 1, 2, 3], 4, 1).cleared.length, 0)
})

test('four rows at once pay far more than four rows one at a time', () => {
  assert.ok(lineScore(4, 1) > lineScore(1, 1) * 4)
  assert.deepEqual(LINE_SCORES, [0, 100, 300, 500, 800])
  // The level multiplies it, so the same clear later in a game is worth more.
  assert.equal(lineScore(2, 3), 900)
  assert.equal(levelOf(0), 1)
  assert.equal(levelOf(25), 3)
})

test('landing a shape writes four squares, clears what filled up, and pays the bonus for an empty well', () => {
  const state = emptyWell(4, 4)
  // Two rows half filled on the right: a square dropped on the left completes both and leaves nothing behind.
  for (const row of [2, 3]) for (const x of [2, 3]) state.well[row * 4 + x] = 2
  const dropped: StackerState = { ...state, piece: { id: 'O', rotation: 0, x: 0, y: 0 }, queue: ['I'], bag: ['T'] }
  assert.equal(dropDistance(dropped), 2)
  const landed = move(dropped, 0, 2)!
  const result = lock(landed, seeded(7))
  assert.equal(result.cleared, 2)
  assert.equal(result.perfect, true)
  assert.equal(result.gained, lineScore(2, 1) + PERFECT_BONUS)
  assert.equal(result.state.lines, 2)
  assert.equal(result.state.well.filter((v) => v).length, 0)
  assert.equal(result.state.piece?.id, 'I')
  assert.equal(result.state.over, false)
})

test('the shapes come in rounds of seven, so no shape is ever missing for long', () => {
  const random = seeded(99)
  for (let round = 0; round < 20; round++) {
    const bag = refill(random)
    assert.deepEqual([...bag].sort(), [...SHAPE_IDS].sort())
  }
  const game = newGame(10, 20, 3, seeded(5))
  const seen: ShapeId[] = [game.piece!.id, ...game.queue]
  assert.equal(game.queue.length, 3)
  assert.ok(seen.every((id) => SHAPE_IDS.includes(id)))
})

test('the drop gets faster with every level, and never faster than the floor; hard starts faster than easy', () => {
  assert.ok(dropMs(1, 'hard') < dropMs(1, 'normal'))
  assert.ok(dropMs(1, 'normal') < dropMs(1, 'easy'))
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    for (let level = 1; level < 30; level++) assert.ok(dropMs(level + 1, difficulty) <= dropMs(level, difficulty))
    assert.ok(dropMs(40, difficulty) >= 70)
  }
  // Knowing less about what is coming is part of what makes hard hard.
  assert.ok(previewsFor('hard') < previewsFor('normal'))
  assert.ok(previewsFor('normal') < previewsFor('easy'))
})

test('a row of rubbish always has a gap in it, and finishes the game only when the stack was at the top', () => {
  const random = seeded(31)
  for (let n = 0; n < 200; n++) {
    const state = emptyWell(10, 6)
    const risen = addRubbish(state, random)
    const bottom = risen.well.slice(5 * 10)
    assert.ok(bottom.includes(0), 'a row you could never clear would be a trap, not a difficulty')
    assert.ok(bottom.some((v) => v === RUBBISH))
    assert.equal(risen.over, false)
    assert.equal(risen.well.length, state.well.length)
  }
  const tall = emptyWell(10, 6)
  tall.well[3] = 1
  assert.equal(addRubbish(tall, random).over, true)
})

test('a long game keeps the well honest: every landing writes four squares and no full row survives', () => {
  const random = seeded(2024)
  let landed = 0
  let endings = 0
  for (let game = 0; game < 8; game++) {
    let state = newGame(10, 20, 3, random)
    while (!state.over && landed < 2000) {
      // Turn sometimes, shuffle off in one direction, then drop. Played badly on purpose: a well that tops out is
      // exactly the state the rules have to survive.
      if (random() < 0.5) state = turn(state, random() < 0.5 ? 1 : -1) ?? state
      const direction = random() < 0.5 ? -1 : 1
      for (let s = Math.floor(random() * 10); s > 0; s--) state = move(state, direction, 0) ?? state
      const landing = drop(state)
      assert.equal(dropDistance(landing.state), 0, 'a dropped piece is resting on something')
      const before = landing.state.well.filter((v) => v).length
      const result = lock(landing.state, random)
      const after = result.state.well.filter((v) => v).length
      assert.equal(after, before + 4 - result.cleared * 10, 'four squares land and a cleared row takes ten away')
      for (let row = 0; row < result.state.rows; row++) assert.ok(!result.state.well.slice(row * 10, row * 10 + 10).every((v) => v), 'a full row was left behind')
      assert.equal(result.state.well.length, 200)
      assert.ok(result.state.score >= 0)
      state = result.state
      landed++
    }
    if (state.over) endings++
  }
  assert.ok(landed > 60, `only ${landed} pieces landed across eight games`)
  assert.equal(endings, 8, 'a well stacked up carelessly fills up, and that is the end of the game')
})

test('a saved game is only loaded when it is really a saved game', () => {
  const game = newGame(10, 20, 3, seeded(3))
  assert.equal(isStackerState(game), true)
  assert.equal(isStackerState(JSON.parse(JSON.stringify(game))), true)
  assert.equal(isStackerState(null), false)
  assert.equal(isStackerState({ ...game, well: game.well.slice(1) }), false)
  assert.equal(isStackerState({ ...game, well: game.well.map(() => 99) }), false)
  assert.equal(isStackerState({ ...game, queue: ['X'] }), false)
  assert.equal(isStackerState({ ...game, cols: 2 }), false)
})
