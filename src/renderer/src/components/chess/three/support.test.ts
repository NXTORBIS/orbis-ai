import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LIFT_HEIGHT, decide, drawScale, liftDuration, resetDuration, shouldDraw, type Trouble
} from './support.ts'

const TROUBLES: Trouble[] = ['none', 'no-webgl', 'no-library', 'context-lost', 'build-failed']

test('asking for the flat board is not a failure and says nothing about one', () => {
  for (const trouble of TROUBLES) {
    const decision = decide('flat', trouble)
    assert.equal(decision.route, 'flat')
    assert.equal(decision.message, '', `asking for the flat board explained itself as ${trouble}`)
    assert.equal(decision.retryable, false)
  }
})

test('a 3D board that works says nothing either', () => {
  const decision = decide('3d', 'none')
  assert.equal(decision.route, '3d')
  assert.equal(decision.message, '')
})

test('every way the 3D board can fail falls back to the flat one and says so plainly', () => {
  for (const trouble of TROUBLES) {
    if (trouble === 'none') continue
    const decision = decide('3d', trouble)
    assert.equal(decision.route, 'flat', `${trouble} did not fall back`)
    assert.ok(decision.message.length > 20, `${trouble} said almost nothing: ${decision.message}`)
    // One sentence a person could read, with no code and no jargon in it.
    assert.ok(/flat board/.test(decision.message), `${trouble} does not say what is being shown instead`)
    assert.equal(/WebGL|webgl|context|GL|undefined|null|Error/.test(decision.message), false,
      `${trouble} has machinery in it: ${decision.message}`)
    assert.ok(
      /position is the same|position unchanged/.test(decision.message),
      `${trouble} does not promise the position is untouched: ${decision.message}`
    )
  }
})

test('trying again is offered only where it could work', () => {
  /*
   * A machine with no graphics at all will not grow any by being asked twice, so no button is offered for it. A
   * driver that restarted, a download that failed and a scene that threw are all worth one more go.
   */
  assert.equal(decide('3d', 'no-webgl').retryable, false)
  assert.equal(decide('3d', 'no-library').retryable, true)
  assert.equal(decide('3d', 'context-lost').retryable, true)
  assert.equal(decide('3d', 'build-failed').retryable, true)
})

test('nothing is drawn unless there is somebody to see it and something to see', () => {
  const base = { onScreen: true, windowVisible: true, changed: true, lost: false }
  assert.equal(shouldDraw(base), true)
  // Scrolled away or behind another tab.
  assert.equal(shouldDraw({ ...base, onScreen: false }), false)
  // The window is not the one being looked at.
  assert.equal(shouldDraw({ ...base, windowVisible: false }), false)
  // Nothing has changed, so the last frame is still correct.
  assert.equal(shouldDraw({ ...base, changed: false }), false)
  // A dead context is never drawn to, whatever else is true.
  assert.equal(shouldDraw({ ...base, lost: true }), false)
  assert.equal(shouldDraw({ onScreen: true, windowVisible: true, changed: true, lost: true }), false)
})

test('a machine that has asked for less movement gets none', () => {
  /*
   * There is nothing else moving in this scene -- nothing spins, nothing drifts, nothing animates while it is
   * idle -- so these two easings are the whole of what the preference applies to, and honouring it means both
   * happen instantly rather than more slowly.
   */
  assert.equal(resetDuration(true), 0)
  assert.equal(liftDuration(true), 0)
  assert.ok(resetDuration(false) > 0)
  assert.ok(liftDuration(false) > 0)
  // Short enough not to be in the way of playing a move.
  assert.ok(resetDuration(false) <= 400)
  assert.ok(liftDuration(false) <= 200)
})

test('a piece lifts far enough to be obvious and not far enough to leave its square', () => {
  assert.ok(LIFT_HEIGHT > 0.1, 'the lift is too small to notice')
  assert.ok(LIFT_HEIGHT < 0.3, 'the lift is high enough to look like it has left the board')
})

test('the number of pixels drawn is capped rather than believed', () => {
  assert.equal(drawScale(1), 1)
  assert.equal(drawScale(1.5), 1.5)
  assert.equal(drawScale(2), 2)
  // Beyond two nobody can see the difference on a board this size, and a frame costs the square of it.
  assert.equal(drawScale(3), 2)
  assert.equal(drawScale(4), 2)
  // A machine reporting something impossible is clamped, not trusted.
  assert.equal(drawScale(0), 1)
  assert.equal(drawScale(-2), 1)
  assert.equal(drawScale(Number.NaN), 1)
  assert.equal(drawScale(Number.POSITIVE_INFINITY), 1)
  assert.equal(drawScale(0.5), 1)
})
