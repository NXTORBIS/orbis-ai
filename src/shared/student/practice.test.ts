import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { RUNGS, evidenceAfterHints, evidenceAfterTeachBack, hintFor, pointsIn, retryAfter, sayTeachBack, teachBackFor } from './practice.ts'

/**
 * Hints, retries and teach-back.
 *
 * The tests that matter: a hint never invents content, help lowers what an attempt proves, looking something up is
 * not a failure, and a teach-back done with the note open is worth nothing.
 */

describe('the hint ladder', () => {
  const question = { ask: 'What is acceleration?', answer: 'The rate of change of velocity', source: 'flashcard' as const }

  it('gets cheaper to climb and worth less each rung', () => {
    const worths = RUNGS.map((one) => one.worth)
    assert.deepEqual(worths, [...worths].sort((a, b) => b - a))
    assert.equal(RUNGS[RUNGS.length - 1].worth, 0)
  })

  it('says what each rung costs before it is taken', () => {
    assert.ok(RUNGS.every((one) => one.costs.length > 4))
  })

  it('the first rung says only where it came from', () => {
    const hint = hintFor('where', question)
    assert.match(hint.text, /your own cards/i)
    // Nothing of the answer itself.
    assert.ok(!hint.text.includes('velocity'))
  })

  it('names the mistake book when that is where it came from', () => {
    const hint = hintFor('where', { ...question, source: 'mistake' })
    assert.match(hint.text, /mistake book/i)
  })

  it('describes the shape of the answer without giving it', () => {
    const hint = hintFor('shape', question)
    assert.match(hint.text, /sentence|words/i)
    assert.ok(!hint.text.includes('rate of change'))
  })

  it('calls a number a number', () => {
    assert.match(hintFor('shape', { ...question, answer: '9.81 m/s^2' }).text, /number/i)
  })

  it('calls a list a list, and says how many', () => {
    const hint = hintFor('shape', { ...question, answer: 'one\ntwo\nthree' })
    assert.match(hint.text, /list — 3 things/i)
  })

  it('shows half of the answer, cut at a word', () => {
    const hint = hintFor('half', question)
    assert.ok(hint.text.endsWith('…'))
    assert.ok(hint.text.length < question.answer.length + 2)
    // Never chopped mid-word.
    assert.ok(!/\w…$/.test(hint.text) || question.answer.split(' ').some((word) => hint.text.includes(word)))
  })

  it('the last rung is the answer the student wrote, unchanged', () => {
    assert.equal(hintFor('all', question).text, question.answer)
  })

  it('a right answer with no help is recall', () => {
    assert.equal(evidenceAfterHints(true, []), 'recalled')
  })

  it('a right answer after the lightest hint is still recall', () => {
    assert.equal(evidenceAfterHints(true, ['where']), 'recalled')
  })

  it('a right answer after half the answer is not recall', () => {
    assert.equal(evidenceAfterHints(true, ['where', 'shape', 'half']), 'explained')
  })

  it('looking the answer up is exposure, and never a failure', () => {
    // The distinction the whole ladder exists for.
    assert.equal(evidenceAfterHints(true, ['all']), 'read')
  })

  it('a wrong answer is a failed recall however much help was taken', () => {
    assert.equal(evidenceAfterHints(false, []), 'recall-failed')
    assert.equal(evidenceAfterHints(false, ['where', 'shape', 'half', 'all']), 'recall-failed')
  })
})

describe('retrying', () => {
  it('brings something back in the same sitting the first time', () => {
    const out = retryAfter(1)
    assert.equal(out.inMinutes, 0)
    assert.equal(out.toMistakeBook, false)
  })

  it('leaves a gap the second time', () => {
    assert.equal(retryAfter(2).inMinutes, 10)
  })

  it('stops asking after three in a row, and says why', () => {
    const out = retryAfter(3)
    assert.ok(out.inMinutes >= 60)
    assert.equal(out.toMistakeBook, true)
    assert.match(out.says, /enough for now/i)
    assert.ok(!/fail|bad|wrong again/i.test(out.says))
  })

  it('says what will happen, every time', () => {
    for (const run of [0, 1, 2, 3, 9]) assert.ok(retryAfter(run).says.length > 10)
  })
})

describe('teach-back', () => {
  it('takes the points to tick from the student own note', () => {
    const out = teachBackFor({ ask: 'Explain projectiles', answer: 'The parts are independent.\nGravity only acts downwards.\nTime of flight depends on the vertical part.' })
    assert.equal(out.points.length, 3)
    assert.match(out.points[0], /independent/i)
  })

  it('leaves one sentence as one point rather than inventing sub-points', () => {
    const out = teachBackFor({ ask: 'Explain it', answer: 'Velocity is the rate of change of position' })
    assert.equal(out.points.length, 1)
  })

  it('never lists the same point twice', () => {
    assert.equal(pointsIn('Same thing.\nSame thing.\nSomething else.').length, 2)
  })

  it('proves nothing when the note was open the whole time', () => {
    assert.equal(evidenceAfterTeachBack(3, 3, true), null)
    assert.match(sayTeachBack(3, 3, true), /with the note open/i)
  })

  it('is the strongest evidence when most of it came back from memory', () => {
    assert.equal(evidenceAfterTeachBack(4, 5, false), 'taught-back')
  })

  it('is understanding rather than recall when some of it came back', () => {
    assert.equal(evidenceAfterTeachBack(2, 5, false), 'explained')
  })

  it('is a failed recall when none of it came back', () => {
    assert.equal(evidenceAfterTeachBack(0, 5, false), 'recall-failed')
  })

  it('records nothing when there was nothing to compare against', () => {
    assert.equal(evidenceAfterTeachBack(0, 0, false), null)
  })

  it('says the result with nothing in it about the person', () => {
    for (const [covered, outOf] of [
      [0, 5],
      [2, 5],
      [5, 5]
    ] as const) {
      const said = sayTeachBack(covered, outOf, false)
      assert.ok(!/you should|lazy|poor|bad|disappoint/i.test(said), said)
    }
  })
})
