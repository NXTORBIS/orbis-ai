import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boardPlan, boardScore, connected, E, filledCount, floodDepths, generatePipes, isPipeSave, N, rotateMask, S, SIDES, turnsTo, turnsToSolution, W } from './pipes.ts'

const seeded = (seed: number): (() => number) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

test('turning a piece moves its openings round, and four turns put it back', () => {
  assert.equal(rotateMask(N, 1), E)
  assert.equal(rotateMask(E, 1), S)
  assert.equal(rotateMask(S, 1), W)
  assert.equal(rotateMask(W, 1), N)
  for (let mask = 0; mask < 16; mask++) {
    assert.equal(rotateMask(mask, 4), mask)
    assert.equal(rotateMask(rotateMask(mask, 1), -1), mask)
  }
  // A straight pipe looks the same after two turns, and a cross after one, so some pieces are free.
  assert.equal(rotateMask(N | S, 2), N | S)
  assert.equal(rotateMask(15, 1), 15)
  assert.equal(turnsTo(N | S, N | S), 0)
  assert.equal(turnsTo(N | E, E | S), 1)
  assert.equal(turnsTo(N | E, N | S), -1, 'an elbow is not a straight, however you turn it')
})

test('every board this game makes works when its pieces are put back, and fills every pipe', () => {
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    for (const plan of boardPlan(difficulty)) {
      for (let seed = 1; seed <= 20; seed++) {
        const { board, solution } = generatePipes(plan.cols, plan.rows, seeded(seed * 104729 + plan.cols))
        const laid = { ...board, tiles: solution }
        assert.equal(connected(laid), true, `${plan.cols}x${plan.rows} seed ${seed}: the plumbing it was built from does not work`)
        assert.equal(filledCount(laid), plan.cols * plan.rows, 'the water should reach every piece when they are all right')
        // Every piece on the board is the same piece, turned -- so there is always a way back.
        assert.ok(board.tiles.every((mask, i) => turnsTo(mask, solution[i]) >= 0))
        assert.ok(turnsToSolution(board.tiles, solution) <= board.tiles.length * 3)
        assert.ok(board.tiles.every((mask) => mask > 0 && mask <= 15))
      }
    }
  }
})

test('the board the player is given is not already done', () => {
  let scrambled = 0
  for (let seed = 1; seed <= 40; seed++) {
    const { board } = generatePipes(5, 4, seeded(seed * 7907))
    if (!connected(board)) scrambled++
  }
  assert.equal(scrambled, 40, 'a board handed over already working is not a puzzle')
})

test('water only crosses where both pieces are open, and it has to get in at the tap', () => {
  const board = { cols: 3, rows: 1, tiles: [W | E, W | E, W | E], source: 0, sink: 2 }
  const depths = floodDepths(board)
  assert.deepEqual([...depths.entries()], [[0, 0], [1, 1], [2, 2]])
  assert.equal(connected(board), true)
  // Turn the middle piece and the water stops at it.
  const broken = { ...board, tiles: [W | E, N | S, W | E] }
  assert.deepEqual([...floodDepths(broken).keys()], [0])
  assert.equal(connected(broken), false)
  // The tap's own piece has to face the tap.
  const shut = { ...board, tiles: [N | S, W | E, W | E] }
  assert.equal(floodDepths(shut).size, 0)
  assert.equal(connected(shut), false)
  // And the tank's piece has to face the tank, even when the water reaches it.
  const noOutlet = { ...board, tiles: [W | E, W | E, W | N] }
  assert.ok(floodDepths(noOutlet).has(2))
  assert.equal(connected(noOutlet), false)
  assert.deepEqual(SIDES, [N, E, S, W])
})

test('a finished board pays for the plumbing and charges for the fiddling', () => {
  assert.ok(boardScore(20, 10, false) > boardScore(20, 30, false))
  assert.ok(boardScore(30, 10, false) > boardScore(10, 10, false))
  assert.ok(boardScore(20, 10, true) > boardScore(20, 10, false), 'leaving nothing dry is worth something')
  assert.equal(boardScore(1, 9999, false), 30)
})

test('the boards in a run grow, and hard starts bigger than normal finishes', () => {
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    const plan = boardPlan(difficulty)
    assert.ok(plan.length >= 3)
    for (let i = 1; i < plan.length; i++) assert.ok(plan[i].cols * plan[i].rows >= plan[i - 1].cols * plan[i - 1].rows)
  }
  const normal = boardPlan('normal')
  assert.ok(boardPlan('hard')[0].cols * boardPlan('hard')[0].rows >= normal[normal.length - 1].cols * normal[normal.length - 1].rows - 6)
})

test('a saved board is only loaded when every piece still matches the plumbing it came from', () => {
  const { board, solution } = generatePipes(5, 4, seeded(11))
  const save = { round: 1, cols: board.cols, rows: board.rows, tiles: board.tiles, solution, turns: 4, score: 100 }
  assert.equal(isPipeSave(save), true)
  assert.equal(isPipeSave(JSON.parse(JSON.stringify(save))), true)
  // A piece that is not a turned copy of its own plumbing means the two halves do not belong together. A cross is a
  // turned copy of nothing but a cross, and a dead end of nothing but a dead end, so one of those is always wrong.
  const odd = solution[3] === 15 ? N : 15
  assert.equal(turnsTo(odd, solution[3]), -1)
  assert.equal(isPipeSave({ ...save, tiles: save.tiles.map((mask, i) => (i === 3 ? odd : mask)) }), false)
  assert.equal(isPipeSave({ ...save, tiles: save.tiles.slice(1) }), false)
  assert.equal(isPipeSave(null), false)
})
