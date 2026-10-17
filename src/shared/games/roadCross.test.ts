import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COLS, DIVE_CYCLE, DIVE_FROM, HOME_COLS, HOME_ROW, MEDIAN_ROW, MOVE_TICKS, ROWS, START_COL, crossingScore, diving, gentleLevel, laneStepped, makeLevel, occupied, reachableHomes, solvable, standing, tickCrossing } from './roadCross.ts'
import type { Lane, Level } from './roadCross.ts'

/**
 * The one bug this arcade must not ship is a crossing nobody can make, because it looks exactly like the player being
 * bad at it. So the last test here builds six hundred crossings and proves every home bay in all of them is reachable.
 */

const lane = (over: Partial<Lane>): Lane => ({ kind: 'road', dir: 1, ticksPerStep: 4, mask: Array.from({ length: COLS }, () => false), ...over })

const levelOf = (lanes: Partial<Lane>[]): Level => ({ lanes: lanes.map(lane), timerTicks: 600, seed: 1, difficulty: 'normal' })

test('what is in a square is worked out from the tick alone, and the row wraps round', () => {
  const mask = Array.from({ length: COLS }, (_, col) => col === 0)
  const rightward = lane({ dir: 1, ticksPerStep: 4, mask })
  assert.equal(occupied(rightward, 0, 0), true)
  assert.equal(occupied(rightward, 1, 0), false)
  // Four ticks is one square, so the car is one square to the right.
  assert.equal(occupied(rightward, 1, 4), true)
  assert.equal(occupied(rightward, 0, 4), false)
  assert.equal(occupied(rightward, 2, 11), true, 'eleven ticks is two squares and a bit')
  // Off the right-hand end it comes back on the left.
  assert.equal(occupied(rightward, 0, COLS * 4), true)
  const leftward = lane({ dir: -1, ticksPerStep: 4, mask })
  assert.equal(occupied(leftward, COLS - 1, 4), true)
  assert.equal(laneStepped(rightward, 4), true)
  assert.equal(laneStepped(rightward, 5), false)
  assert.equal(laneStepped(rightward, 0), false, 'nothing has moved before the first tick')
})

test('a turtle row goes under for three steps in thirteen, and a log row never does', () => {
  const turtles = lane({ kind: 'river', float: 'turtle', ticksPerStep: 5, mask: Array.from({ length: COLS }, () => true) })
  const logs = lane({ kind: 'river', float: 'log', ticksPerStep: 5, mask: Array.from({ length: COLS }, () => true) })
  const under: number[] = []
  for (let step = 0; step < DIVE_CYCLE; step++) {
    if (diving(turtles, step * 5)) under.push(step)
    assert.equal(diving(logs, step * 5), false)
  }
  assert.deepEqual(under, [10, 11, 12])
  assert.equal(DIVE_CYCLE - DIVE_FROM, 3)
  const level = levelOf([{ kind: 'kerb' }, turtles])
  assert.equal(standing(level, 1, 3, 0), null, 'up, so you can stand on it')
  assert.equal(standing(level, 1, 3, 10 * 5), 'water', 'under, so you drown where you stood')
})

test('the water is as deadly as the traffic, and the kerb is safe', () => {
  const level = levelOf([
    { kind: 'kerb', dir: 0, ticksPerStep: 0, mask: [] },
    { kind: 'road', mask: Array.from({ length: COLS }, (_, col) => col === 5) },
    { kind: 'river', float: 'log', mask: Array.from({ length: COLS }, (_, col) => col === 5) }
  ])
  assert.equal(standing(level, 0, 5, 0), null)
  assert.equal(standing(level, 1, 5, 0), 'traffic')
  assert.equal(standing(level, 1, 6, 0), null)
  assert.equal(standing(level, 2, 5, 0), null, 'on the log')
  assert.equal(standing(level, 2, 6, 0), 'water', 'beside the log')
})

test('a river row carries you, and over the edge if that is where it is going', () => {
  const level = levelOf([{ kind: 'kerb', dir: 0, ticksPerStep: 0, mask: [] }, { kind: 'river', dir: 1, ticksPerStep: 4, mask: Array.from({ length: COLS }, () => true) }])
  // Tick 3 to 4 is the row's step, so the rider goes with it.
  const carried = tickCrossing(level, { row: 1, col: 5 }, 3, 'wait')
  assert.equal(carried.col, 6)
  assert.equal(carried.death, null)
  const still = tickCrossing(level, { row: 1, col: 5 }, 4, 'wait')
  assert.equal(still.col, 5, 'no step, no carry')
  const swept = tickCrossing(level, { row: 1, col: COLS - 1 }, 3, 'wait')
  assert.equal(swept.death, 'swept')
})

test('a move is only taken on a move tick, and the edge and the hedge are refused', () => {
  const level = makeLevel(7, 'easy')
  const offTick = tickCrossing(level, { row: 0, col: 5 }, 1, 'up')
  assert.deepEqual([offTick.row, offTick.col], [0, 5], 'the move waits for the next move tick')
  assert.equal(MOVE_TICKS, 3)
  const moved = tickCrossing(level, { row: 0, col: 5 }, 3, 'up')
  assert.equal(moved.row, 1)
  const edge = tickCrossing(level, { row: 0, col: 0 }, 0, 'left')
  assert.equal(edge.blocked, true)
  assert.deepEqual([edge.row, edge.col], [0, 0])
  const below = HOME_ROW - 1
  const hedge = tickCrossing(level, { row: below, col: 1 }, 0, 'up')
  assert.equal(hedge.blocked, true)
  assert.equal(hedge.row, below, 'the hedge between two bays is not a square you can be in')
  const bay = tickCrossing(level, { row: below, col: HOME_COLS[1] }, 0, 'up')
  assert.equal(bay.home, 1)
  assert.equal(bay.death, null)
})

test('a crossing that cannot be made is reported as such', () => {
  // A river the width of the row with nothing floating on it: one step up and you drown, whatever you do.
  const lanes: Partial<Lane>[] = []
  for (let row = 0; row < ROWS; row++) {
    if (row === 0 || row === MEDIAN_ROW) lanes.push({ kind: 'kerb', dir: 0, ticksPerStep: 0, mask: [] })
    else if (row === HOME_ROW) lanes.push({ kind: 'home', dir: 0, ticksPerStep: 0, mask: [] })
    else lanes.push({ kind: 'river', float: 'log', dir: 1, ticksPerStep: 6, mask: Array.from({ length: COLS }, () => false) })
  }
  const drowned: Level = { ...levelOf(lanes), timerTicks: 300 }
  assert.deepEqual(reachableHomes(drowned), [false, false, false, false, false])
  assert.equal(solvable(drowned), false)
})

test('the hand-written fall-back crossing can be made', () => {
  assert.equal(solvable(gentleLevel()), true)
})

test('every generated crossing can be made: every home bay, every difficulty, two hundred seeds each', () => {
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    for (let seed = 1; seed <= 200; seed++) {
      const level = makeLevel(seed, difficulty)
      assert.equal(level.lanes.length, ROWS)
      assert.equal(level.lanes[0].kind, 'kerb')
      assert.equal(level.lanes[MEDIAN_ROW].kind, 'kerb')
      assert.equal(level.lanes[HOME_ROW].kind, 'home')
      for (const row of level.lanes) {
        if (row.kind === 'kerb' || row.kind === 'home') continue
        assert.equal(row.mask.length, COLS)
        assert.ok(row.ticksPerStep >= 3, 'nothing moves more than one square at a time')
        assert.ok(row.mask.some(Boolean), `a ${row.kind} row with nothing in it`)
        assert.ok(row.mask.some((on) => !on), `a ${row.kind} row with no way through`)
        if (row.kind === 'river') assert.ok(row.float === 'log' || row.float === 'turtle')
      }
      // Every single bay, not just one of them.
      assert.deepEqual(reachableHomes(level, START_COL), [true, true, true, true, true], `${difficulty} seed ${seed} has a bay nobody can reach`)
    }
  }
})

test('the score pays for progress, for the bay, for the clock, and for finishing', () => {
  assert.equal(crossingScore({ rowsForward: 0, homesFilled: 0, ticksLeft: 0 }), 0)
  const halfway = crossingScore({ rowsForward: 6, homesFilled: 0, ticksLeft: 0 })
  assert.equal(halfway, 60)
  assert.ok(crossingScore({ rowsForward: 12, homesFilled: 1, ticksLeft: 0 }) > halfway)
  const quick = crossingScore({ rowsForward: 12, homesFilled: 1, ticksLeft: 30 * 10 })
  assert.ok(quick > crossingScore({ rowsForward: 12, homesFilled: 1, ticksLeft: 0 }), 'time left is worth something')
  const all = crossingScore({ rowsForward: 12, homesFilled: HOME_COLS.length, ticksLeft: 0 })
  assert.ok(all - crossingScore({ rowsForward: 12, homesFilled: HOME_COLS.length - 1, ticksLeft: 0 }) > 150, 'filling the last bay pays a lump')
  assert.equal(crossingScore({ rowsForward: -3, homesFilled: 0, ticksLeft: -10 }), 0, 'nothing goes negative')
})
