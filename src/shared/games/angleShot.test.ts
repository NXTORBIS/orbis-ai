import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BALL_R, GRAVITY, HOLES, MAX_SPEED, TARGET_R, WIDTH, advance, aimPower, findSolution, groundAt, holeWords, launch, makeHole, makeRound, roundScore, simulate } from './angleShot.ts'
import type { Hole } from './angleShot.ts'

/**
 * The claim this file exists to hold: every hole handed to a player can be holed in a single shot from the tee. The
 * generator checks that with its own quick search; this checks it again with the slow one, which is the point -- a
 * generator that proves its work with the same shortcut it used to make it has proved nothing.
 */

const flat: Hole = { index: 0, tee: { x: 70, y: BALL_R }, target: { x: 600, y: TARGET_R + 2 }, wind: 0, blocks: [], par: 2, seed: 1 }

test('the aiming arithmetic drops the ball in the hole when the air is still and the ground is clear', () => {
  for (const angle of [20, 30, 45, 55, 65]) {
    const power = aimPower(flat.tee, flat.target, angle)
    assert.ok(power !== null, `nothing reaches the hole at ${angle} degrees`)
    assert.ok(power > 0 && power <= 1)
    assert.equal(simulate(flat, flat.tee, angle, power, 6).in, true, `${angle} degrees at ${power.toFixed(2)} missed`)
  }
  assert.equal(aimPower(flat.tee, { x: 10, y: 0 }, 45), null, 'nothing behind you')
  assert.equal(aimPower(flat.tee, { x: 990, y: 400 }, 10), null, 'nothing at that angle reaches that high and that far')
  // At full strength and forty-five degrees a ball carries about the width of the field, and no further. Where it ends
  // up is not the question -- it bounces off the far wall and rolls back -- so this asks how far it got.
  const far = simulate({ ...flat, target: { x: WIDTH - 20, y: 4000 } }, flat.tee, 45, 1, 6)
  const carried = Math.max(...far.path.map((point) => point.x))
  assert.ok(carried > WIDTH * 0.85, `full strength only carried to ${Math.round(carried)}`)
  assert.ok((MAX_SPEED * MAX_SPEED) / GRAVITY < WIDTH * 1.15, 'full strength must not be able to overshoot the whole field')
})

test('the ball bounces, rolls and comes to rest, and a resting ball stays where it is', () => {
  const ball = launch(flat.tee, 40, 0.5)
  let steps = 0
  while (!ball.resting && steps < 4000) {
    advance(flat, ball)
    steps++
  }
  assert.ok(ball.resting, 'a ball that never stops')
  assert.ok(ball.y <= BALL_R + 0.5, 'it came to rest on the ground')
  assert.ok(ball.x > flat.tee.x, 'and somewhere in front of where it started')
  const where = { x: ball.x, y: ball.y }
  advance(flat, ball)
  assert.deepEqual({ x: ball.x, y: ball.y }, where, 'a resting ball is not moved by being stepped again')
})

test('a ball cannot leave the field, and it stands on what it lands on', () => {
  const walled: Hole = { ...flat, target: { x: 980, y: 4000 }, blocks: [{ x: 400, y: 0, w: 60, h: 120 }] }
  assert.equal(groundAt(walled, 430), 120, 'the top of the block is the ground above it')
  assert.equal(groundAt(walled, 300), 0)
  const flight = simulate(walled, walled.tee, 20, 1, 6)
  assert.ok(flight.rest.x >= BALL_R && flight.rest.x <= WIDTH - BALL_R, `the ball came to rest at ${flight.rest.x}`)
  // Dropped onto the block, it rests on top of it rather than inside it.
  const onTop = simulate(walled, { x: 430, y: 400 }, 90, 0.05, 6)
  assert.ok(onTop.rest.y >= 120, `it ended up at ${Math.round(onTop.rest.y)}, which is inside the block`)
})

test('the wind pushes the ball, and which way it pushes is which way it is blowing', () => {
  const still = simulate({ ...flat, target: { x: 10, y: 4000 } }, flat.tee, 45, 0.7, 6)
  const behind = simulate({ ...flat, target: { x: 10, y: 4000 }, wind: 140 }, flat.tee, 45, 0.7, 6)
  const against = simulate({ ...flat, target: { x: 10, y: 4000 }, wind: -140 }, flat.tee, 45, 0.7, 6)
  assert.ok(behind.rest.x > still.rest.x, 'a following wind carries it further')
  assert.ok(against.rest.x < still.rest.x, 'a head wind holds it back')
})

test('every hole of every round can be holed in one shot from the tee', () => {
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    for (let seed = 1; seed <= 4; seed++) {
      const round = makeRound(seed, difficulty)
      assert.equal(round.length, HOLES)
      round.forEach((hole, index) => {
        assert.equal(hole.index, index)
        assert.ok(hole.target.x > hole.tee.x + 300, 'a hole worth walking to')
        assert.ok(hole.target.x < WIDTH - 20 && hole.target.y > 0)
        for (const block of hole.blocks) {
          assert.ok(block.w > 0 && block.h > 0)
          assert.ok(block.x >= 0 && block.x + block.w <= WIDTH)
          assert.ok(block.x > hole.tee.x + 40, 'nothing standing on the tee')
        }
        const solution = findSolution(hole)
        assert.ok(solution, `${difficulty} seed ${seed} hole ${index + 1} cannot be holed`)
        // And the solution really is one: played again, it goes in.
        assert.equal(simulate(hole, hole.tee, solution.angle, solution.power, 6).in, true, 'the answer does not answer')
      })
    }
  }
})

test('the holes of a round get longer, windier and busier as the round goes on', () => {
  const round = makeRound(9, 'normal')
  const early = round.slice(0, 3)
  const late = round.slice(-3)
  const length = (holes: Hole[]): number => holes.reduce((sum, h) => sum + h.target.x, 0) / holes.length
  const clutter = (holes: Hole[]): number => holes.reduce((sum, h) => sum + h.blocks.length, 0) / holes.length
  assert.ok(length(late) > length(early), 'the last holes are further off')
  assert.ok(clutter(late) > clutter(early), 'and have more in the way')
  assert.equal(round[0].wind, 0, 'the first hole is in still air')
  assert.ok(round.some((h) => h.wind !== 0), 'and the later ones are not')
})

test('the same seed gives the same round', () => {
  assert.deepEqual(makeRound(3, 'normal'), makeRound(3, 'normal'))
  assert.notDeepEqual(makeRound(3, 'normal'), makeRound(4, 'normal'))
  assert.deepEqual(makeHole(2, 3, 'normal'), makeRound(3, 'normal')[2], 'one hole on its own is the same hole')
})

test('the score is the shots taken, so less of it is better', () => {
  assert.equal(roundScore([1, 2, 3]), 6)
  assert.equal(roundScore([]), 0)
  assert.ok(roundScore([2, 2, 2]) < roundScore([3, 3, 3]))
  assert.equal(holeWords(1, 3), 'In one shot')
  assert.equal(holeWords(3, 3), '3 shots — on par')
  assert.match(holeWords(2, 3), /under/)
  assert.equal(holeWords(5, 3), '5 shots')
})
