import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isFlatRefusal, REFUSAL_MAX_CHARS } from './modelRoute.ts'

/**
 * Telling a flat refusal from an answer.
 *
 * Asked for a reference on the rules of chess, one model replied in full: "I'm sorry, but I can't provide that."
 * Two other models wrote thousands of words on the same request. Orbis now treats that as the model failing and
 * asks another one -- so this test decides when that happens.
 *
 * Being wrong is only expensive in one direction. Mistaking an answer for a refusal throws good work away and asks
 * again for nothing; mistaking a refusal for an answer leaves somebody staring at a dead end. So the test is
 * narrow on purpose, and most of what is below is about what must NOT count.
 */

test('the refusal that started this is recognised', () => {
  assert.equal(isFlatRefusal('I’m sorry, but I can’t provide that.', true), true)
  assert.equal(isFlatRefusal("I'm sorry, but I can't provide that.", true), true, 'a straight apostrophe reads the same')
})

test('the other ways a model says no', () => {
  for (const said of [
    'I cannot provide that information.',
    "I can't help with that request.",
    "I'm unable to assist with this.",
    "I'm not able to write that.",
    'Sorry, I cannot comply with that.',
    'Unfortunately, I cannot generate that content.',
    'As an AI, I cannot provide that.',
    'I must decline.'
  ]) {
    assert.equal(isFlatRefusal(said, true), true, said)
  }
})

test('an answer that merely mentions not being able to do something is not a refusal', () => {
  const answer = 'Chess clocks have two faces. A player who cannot move loses on time, and a player who cannot '
    + 'make a legal move is stalemated. Note that a king cannot move into check. '.repeat(8)
  assert.ok(answer.length > REFUSAL_MAX_CHARS)
  assert.equal(isFlatRefusal(answer, true), false, 'nobody refuses at length')
})

test('a short real answer is not a refusal', () => {
  for (const said of ['Yes.', 'The answer is 42.', 'Sorry about the confusion earlier — here is the list:', 'No, that is stalemate.']) {
    assert.equal(isFlatRefusal(said, true), false, said)
  }
})

test('a refusal that is only the beginning of a longer answer is not counted', () => {
  // A reply that ran out of room has not finished. Carrying it on is the right answer, not changing model.
  assert.equal(isFlatRefusal("I'm sorry, but I can't provide that", false), false)
})

test('nothing at all is not a refusal', () => {
  assert.equal(isFlatRefusal('', true), false)
  assert.equal(isFlatRefusal('   ', true), false)
})

test('a refusal buried in the middle of an answer is left alone', () => {
  const said = 'Here is the full list of rules.\n\nOne caveat: I cannot provide legal advice about tournament disputes.'
  assert.equal(isFlatRefusal(said, true), false, 'it does not open with the refusal, so it is an answer')
})
