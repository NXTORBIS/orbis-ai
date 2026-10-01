import assert from 'node:assert/strict'
import test from 'node:test'
import { validateParams } from './browserControl.ts'

/**
 * What a capability will accept.
 *
 * The checks here are the last place a bad value can be caught cheaply. Past them it reaches the browser, which
 * refuses it far less helpfully and far later -- and a late refusal reads as "it did not work this time", which is
 * the one thing that makes a planner try the same wrong thing again.
 */


test('a number outside its range is refused here, not by the browser later', () => {
  /**
   * The failure this prevents. A plan passed `index: -1` to "open a tab" -- a perfectly valid integer, so it passed
   * every check there was, was sent, and Chromium refused it with "Value must be at least 0" wrapped in a TypeError.
   * That arrives as a generic failure, which reads as "it did not work this time", so it was tried three times.
   *
   * Refused here it is an invalid-parameter error, which the Orb re-plans from rather than repeating, and the message
   * says what would be acceptable.
   */
  const spec = { index: { type: 'integer' as const, description: 'Position (0 = first).', min: 0 } }
  assert.match(validateParams(spec, { index: -1 }) ?? '', /at least 0/)
  assert.equal(validateParams(spec, { index: 0 }), null)
  assert.equal(validateParams(spec, { index: 7 }), null)

  const bounded = { factor: { type: 'number' as const, description: 'Zoom', min: 0.25, max: 5 } }
  assert.match(validateParams(bounded, { factor: 9 }) ?? '', /at most 5/)
  assert.match(validateParams(bounded, { factor: 0.1 }) ?? '', /at least 0.25/)
  assert.equal(validateParams(bounded, { factor: 1 }), null)
})

test('a range is only applied to numbers, and an absent value is still absent', () => {
  const spec = { index: { type: 'integer' as const, description: 'Position', min: 0 } }
  // Not given is not out of range: an optional parameter stays optional.
  assert.equal(validateParams(spec, {}), null)
  // And the type check still comes first, so the message is about the type rather than the range.
  assert.match(validateParams(spec, { index: 'first' }) ?? '', /whole number/)
})
