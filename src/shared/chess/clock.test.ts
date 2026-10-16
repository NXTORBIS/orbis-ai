import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ESTIMATED_MOVES,
  TIME_CONTROLS,
  UNTIMED,
  clockSecondsFor,
  controlLabel,
  describeTimeControl,
  elapsedSince,
  flaggedAt,
  formatClock,
  kindFor,
  lowTimeAt,
  moveMade,
  newClock,
  pauseClock,
  pgnTimeControl,
  readPgnTimeControl,
  remainingAt,
  resumeClock,
  settleClock,
  spentAt,
  startClock,
  stopClock,
  timeControl,
  timeControlById
} from './clock.ts'

/**
 * The clock, driven by a number the test moves by hand.
 *
 * Nothing here waits for real time to pass. That is the point of the design being tested: the clock is a function
 * of the stamps it was given, so a test can jump four minutes forward in one line and check the answer is what a
 * real four minutes would have produced.
 */

/** A stand-in for `performance.now()`. The test decides what time it is. */
function fakeClock(start = 1000): { now: () => number; pass: (ms: number) => void; set: (ms: number) => void } {
  let at = start
  return {
    now: () => at,
    pass: (ms: number) => {
      at += ms
    },
    set: (ms: number) => {
      at = ms
    }
  }
}

// ---------------------------------------------------------------- time controls

test('a time control is named from how long the game really lasts', () => {
  assert.equal(kindFor(0, 0), 'untimed')
  assert.equal(kindFor(60, 0), 'bullet')
  assert.equal(kindFor(120, 1), 'bullet')
  assert.equal(kindFor(180, 0), 'blitz')
  assert.equal(kindFor(300, 3), 'blitz')
  assert.equal(kindFor(600, 0), 'rapid')
  assert.equal(kindFor(900, 10), 'rapid')
  assert.equal(kindFor(1800, 0), 'classical')
  assert.equal(kindFor(5400, 30), 'classical')
  // The increment counts towards the estimate, which is why 2+2 is blitz while 2+1 is still bullet.
  assert.equal(120 + 1 * ESTIMATED_MOVES, 160)
  assert.equal(kindFor(120, 2), 'blitz')
})

test('a control is labelled the way the chess world writes it', () => {
  assert.equal(controlLabel(0, 0), 'Untimed')
  assert.equal(controlLabel(180, 2), '3 + 2')
  assert.equal(controlLabel(600, 0), '10 + 0')
  assert.equal(controlLabel(90, 0), '90s + 0')
})

test('every offered control is sound, and the untimed one has no time', () => {
  assert.ok(TIME_CONTROLS.length >= 10)
  const ids = new Set(TIME_CONTROLS.map((one) => one.id))
  assert.equal(ids.size, TIME_CONTROLS.length, 'two controls share an id')
  for (const one of TIME_CONTROLS) {
    assert.equal(one.kind, kindFor(one.initialSeconds, one.incrementSeconds))
    assert.equal(one.label, controlLabel(one.initialSeconds, one.incrementSeconds))
    assert.ok(one.incrementSeconds >= 0)
  }
  assert.equal(UNTIMED.initialSeconds, 0)
  assert.equal(UNTIMED.kind, 'untimed')
  assert.equal(timeControlById('600+0')?.initialSeconds, 600)
  assert.equal(timeControlById('nonsense'), null)
})

test('a control written to a PGN tag reads back as the same control', () => {
  assert.equal(pgnTimeControl(UNTIMED), '-')
  assert.equal(pgnTimeControl(timeControl(180, 2)), '180+2')
  assert.deepEqual(readPgnTimeControl('180+2'), timeControl(180, 2))
  assert.deepEqual(readPgnTimeControl('600'), timeControl(600, 0))
  // Shapes this does not understand come back as nothing rather than as a guess.
  for (const bad of ['', '-', '?', '40/7200:1800', 'G/90', 'rubbish']) assert.equal(readPgnTimeControl(bad), null, bad)
})

test('a control describes itself without claiming a precise length', () => {
  assert.match(describeTimeControl(UNTIMED), /no clock/)
  const blitz = describeTimeControl(timeControl(180, 2))
  assert.match(blitz, /Blitz/)
  assert.match(blitz, /about/)
  assert.match(blitz, /2s added a move/)
})

// ---------------------------------------------------------------- measuring, not counting

test('a new clock has the full time each and nothing running', () => {
  const clock = fakeClock()
  const state = newClock(timeControl(300, 0), clock.now())
  assert.equal(state.ticking, null)
  assert.deepEqual(remainingAt(state, clock.now()), { w: 300_000, b: 300_000 })
  // Nothing runs, so time passing takes nothing off anybody.
  clock.pass(60_000)
  assert.deepEqual(remainingAt(state, clock.now()), { w: 300_000, b: 300_000 })
})

test('the time left is worked out from the stamp, so a window that stopped redrawing is still right', () => {
  const clock = fakeClock()
  let state = startClock(newClock(timeControl(300, 0), clock.now()), 'w', clock.now())
  // Four seconds where nothing asked the clock anything at all.
  clock.pass(4000)
  assert.deepEqual(remainingAt(state, clock.now()), { w: 296_000, b: 300_000 })
  // And asking a hundred times in the same instant does not take a hundred ticks off.
  for (let i = 0; i < 100; i++) assert.equal(remainingAt(state, clock.now())?.w, 296_000)
  state = moveMade(state, 'w', clock.now())
  assert.deepEqual(state.banked, { w: 296_000, b: 300_000 })
})

test('the increment is paid to the side that moved, after its own time is charged', () => {
  const clock = fakeClock()
  let state = startClock(newClock(timeControl(180, 2), clock.now()), 'w', clock.now())
  clock.pass(5000)
  state = moveMade(state, 'w', clock.now())
  // 180 - 5 + 2
  assert.equal(state.banked.w, 177_000)
  assert.equal(state.ticking, 'b')
  clock.pass(1000)
  state = moveMade(state, 'b', clock.now())
  assert.equal(state.banked.b, 181_000)
  assert.equal(state.ticking, 'w')
  assert.deepEqual(state.moves, { w: 1, b: 1 })
})

test('a flag is noticed from the stamps whether or not anybody was watching', () => {
  const clock = fakeClock()
  const state = startClock(newClock(timeControl(10, 0), clock.now()), 'w', clock.now())
  assert.equal(flaggedAt(state, clock.now()), null)
  clock.pass(9_999)
  assert.equal(flaggedAt(state, clock.now()), null)
  clock.pass(2)
  assert.equal(flaggedAt(state, clock.now()), 'w')
  // Settled into the state, so a saved game says the time ran out rather than depending on when it was looked at.
  const settled = settleClock(state, clock.now())
  assert.equal(settled.flagged, 'w')
  assert.equal(settled.ticking, null)
  assert.equal(remainingAt(settled, clock.now())?.w, 0)
})

test('a move that overran the clock earns no increment and flags the mover', () => {
  const clock = fakeClock()
  let state = startClock(newClock(timeControl(10, 5), clock.now()), 'w', clock.now())
  clock.pass(11_000)
  state = moveMade(state, 'w', clock.now())
  assert.equal(state.flagged, 'w')
  assert.equal(state.banked.w, 0, 'the increment must not rescue a clock that already ran out')
  assert.equal(state.ticking, null)
  // And the game cannot carry on taking time off anybody.
  const after = moveMade(state, 'b', clock.now() + 5000)
  assert.equal(after.banked.b, state.banked.b)
})

test('a pause charges the paused time to nobody, and resuming starts the same clock again', () => {
  const clock = fakeClock()
  let state = startClock(newClock(timeControl(300, 0), clock.now()), 'b', clock.now())
  clock.pass(2000)
  state = pauseClock(state, clock.now())
  assert.equal(state.paused, true)
  assert.equal(state.ticking, null)
  assert.equal(state.pausedFrom, 'b')
  assert.equal(remainingAt(state, clock.now())?.b, 298_000)
  // A minute of pause.
  clock.pass(60_000)
  assert.equal(remainingAt(state, clock.now())?.b, 298_000, 'the pause was charged to somebody')
  state = resumeClock(state, clock.now())
  assert.equal(state.ticking, 'b')
  clock.pass(1000)
  assert.equal(remainingAt(state, clock.now())?.b, 297_000)
})

test('time spent is measured even when there is no clock to run out', () => {
  const clock = fakeClock()
  let state = startClock(newClock(UNTIMED, clock.now()), 'w', clock.now())
  assert.equal(remainingAt(state, clock.now()), null, 'an untimed game has no time left to report')
  assert.equal(flaggedAt(state, clock.now()), null)
  clock.pass(30_000)
  assert.equal(spentAt(state, clock.now()).w, 30_000)
  state = moveMade(state, 'w', clock.now())
  assert.equal(state.spent.w, 30_000)
  clock.pass(90_000)
  state = moveMade(state, 'b', clock.now())
  assert.equal(state.spent.b, 90_000)
  // No clock means nothing can run out, however long the game takes.
  assert.equal(flaggedAt(state, clock.now()), null)
  assert.equal(clockSecondsFor(state, 'w', clock.now()), null)
})

test('a clock that goes backwards never hands anybody time', () => {
  const clock = fakeClock(10_000)
  const state = startClock(newClock(timeControl(60, 0), clock.now()), 'w', clock.now())
  // A wall clock set back an hour. The worst this may do is charge nothing.
  assert.equal(elapsedSince(state, 10_000 - 3_600_000), 0)
  assert.equal(remainingAt(state, 10_000 - 3_600_000)?.w, 60_000)
})

test('stopping the clock charges the last stretch and leaves nothing running', () => {
  const clock = fakeClock()
  let state = startClock(newClock(timeControl(60, 0), clock.now()), 'w', clock.now())
  clock.pass(3000)
  state = stopClock(state, clock.now())
  assert.equal(state.ticking, null)
  assert.equal(state.banked.w, 57_000)
  assert.equal(state.spent.w, 3000)
  clock.pass(100_000)
  assert.equal(remainingAt(state, clock.now())?.w, 57_000)
  assert.equal(flaggedAt(state, clock.now()), null)
})

test('low time is a cue and not a state', () => {
  const clock = fakeClock()
  const state = startClock(newClock(timeControl(30, 0), clock.now()), 'w', clock.now())
  assert.equal(lowTimeAt(state, 'w', clock.now()), false)
  clock.pass(15_000)
  assert.equal(lowTimeAt(state, 'w', clock.now()), true)
  assert.equal(lowTimeAt(state, 'b', clock.now()), false)
  clock.pass(20_000)
  assert.equal(lowTimeAt(state, 'w', clock.now()), false, 'no time left is not low time, it is no time')
})

test('a clock reads the way people read one', () => {
  assert.equal(formatClock(600_000), '10:00')
  assert.equal(formatClock(61_000), '1:01')
  assert.equal(formatClock(10_000), '0:10')
  assert.equal(formatClock(9_900), '9.9')
  assert.equal(formatClock(1_900), '1.9', 'a clock with 1.9 left says 1.9, never 2')
  assert.equal(formatClock(0), '0.0')
  assert.equal(formatClock(-50), '0.0')
  assert.equal(formatClock(3_600_000), '1:00:00')
  assert.equal(formatClock(3_925_000), '1:05:25')
})

test('the seconds a saved move carries come from the real clock, and are absent when there is none', () => {
  const clock = fakeClock()
  let state = startClock(newClock(timeControl(300, 0), clock.now()), 'w', clock.now())
  clock.pass(4400)
  state = moveMade(state, 'w', clock.now())
  assert.equal(clockSecondsFor(state, 'w', clock.now()), 296)
  assert.equal(clockSecondsFor(newClock(UNTIMED, 0), 'w', 0), null)
})

test('a hundred moves of a real clock never drifts, because nothing counted', () => {
  const clock = fakeClock()
  let state = startClock(newClock(timeControl(300, 3), clock.now()), 'w', clock.now())
  let side: 'w' | 'b' = 'w'
  for (let i = 0; i < 100; i++) {
    clock.pass(1234)
    state = moveMade(state, side, clock.now())
    side = side === 'w' ? 'b' : 'w'
  }
  // Fifty moves each, 1.234s spent and 3s paid on every one of them.
  assert.equal(state.banked.w, 300_000 + 50 * (3000 - 1234))
  assert.equal(state.banked.b, 300_000 + 50 * (3000 - 1234))
  assert.equal(state.spent.w, 50 * 1234)
  assert.deepEqual(state.moves, { w: 50, b: 50 })
})
