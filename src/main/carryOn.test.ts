import { test } from 'node:test'
import assert from 'node:assert/strict'
import { joinLegs } from './nim.ts'

/**
 * Joining the legs of one long answer.
 *
 * When a reply runs out of room, Orbis asks another key to carry on from where it stopped. Models very often
 * restate the last sentence first, however plainly they are asked not to -- so the join has to find what was
 * repeated and drop it. Get this wrong and the person reads the same sentence twice in the middle of their answer,
 * which is worse than the reply having been cut short in the first place.
 */

test('what the next leg repeats is dropped', () => {
  const sofar = 'The three parts of a chess clock are the display, the button and'
  const next = ' the button and the case that holds them.'
  assert.equal(joinLegs(sofar, next), 'The three parts of a chess clock are the display, the button and the case that holds them.')
})

test('a whole repeated sentence is dropped, not just a few words', () => {
  const sofar = 'First you set the time control. Then you press the button to start the other side thinking.'
  const next = 'Then you press the button to start the other side thinking. After that the clock runs until somebody presses it again.'
  const joined = joinLegs(sofar, next)
  assert.equal(joined.split('Then you press the button').length - 1, 1, 'the repeated sentence appears once')
  assert.ok(joined.endsWith('until somebody presses it again.'))
})

test('a leg that repeats nothing is joined without losing a character', () => {
  const sofar = 'One.'
  const next = ' Two.'
  assert.equal(joinLegs(sofar, next), 'One. Two.')
})

test('two words are never run together at the join', () => {
  assert.equal(joinLegs('the quick brown', 'fox jumps'), 'the quick brown fox jumps')
  // Already spaced on one side: no second space is added.
  assert.equal(joinLegs('the quick brown ', 'fox jumps'), 'the quick brown fox jumps')
})

test('a join in the middle of a word is not given a space', () => {
  // A leg that stopped mid-word carries on mid-word; inserting a space would break the word in two.
  assert.equal(joinLegs('inter', '-national'), 'inter-national')
})

test('a short coincidence is not mistaken for a repeat', () => {
  // "the " appears at both ends, but four characters is far too little to call a repeat: dropping it would eat
  // real words. The floor is twelve characters.
  const joined = joinLegs('A line that ends with the ', 'the rest would be lost if this counted')
  assert.ok(joined.includes('ends with the the rest') || joined.includes('ends with the the'), joined)
})

test('an empty leg changes nothing, and an empty start keeps everything', () => {
  assert.equal(joinLegs('kept', ''), 'kept')
  assert.equal(joinLegs('', 'kept'), 'kept')
})

test('a repeat is only looked for near the end, so an answer cannot eat itself', () => {
  // The same sentence early on must not cause the whole middle of the answer to be dropped.
  const start = 'Opening line. '
  const middle = 'x'.repeat(3000)
  const joined = joinLegs(start + middle, 'Opening line. and then more')
  assert.ok(joined.length > 3000, 'the body survived')
  assert.ok(joined.endsWith('and then more'))
})
