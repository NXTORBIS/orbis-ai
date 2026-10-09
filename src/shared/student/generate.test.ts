import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  CARDS_SYSTEM,
  EXPLAIN_SYSTEM,
  MARK_SYSTEM,
  QUIZ_SYSTEM,
  STRUCTURE_SYSTEM,
  cardsPrompt,
  describeMix,
  evidenceForGenerated,
  explainPrompt,
  markPrompt,
  quizPrompt,
  readCards,
  readMarks,
  readQuiz,
  readStructure,
  structurePrompt,
  withoutRejected
} from './generate.ts'

/**
 * What Orion may write, and what Orbis does with it.
 *
 * Every test here is about not trusting the reply: a model's JSON is a stranger's JSON. The important ones are the
 * refusals — half a question is dropped, a mark that changed the student's own list is ignored, and a reply that
 * cannot be read is nothing rather than an empty quiz that looks finished.
 */

describe('reading a quiz back', () => {
  const id = (index: number): string => `q${index}`

  it('reads nothing out of nothing', () => {
    assert.deepEqual(readQuiz(null, 'c', id), [])
    assert.deepEqual(readQuiz({}, 'c', id), [])
    assert.deepEqual(readQuiz({ questions: 'yes please' }, 'c', id), [])
  })

  it('drops a question with no answer', () => {
    const out = readQuiz({ questions: [{ ask: 'What is velocity?', answer: '' }, { ask: 'What is acceleration?', answer: 'The rate of change of velocity' }] }, 'c', id)
    assert.equal(out.length, 1)
    assert.equal(out[0].ask, 'What is acceleration?')
  })

  it('drops an answer with no question', () => {
    assert.deepEqual(readQuiz({ questions: [{ ask: '', answer: 'Something' }] }, 'c', id), [])
  })

  it('falls back to recall for a form it does not know', () => {
    const out = readQuiz({ questions: [{ form: 'interpretive-dance', ask: 'Explain it', answer: 'Like this' }] }, 'c', id)
    assert.equal(out[0].form, 'recall')
  })

  it('keeps the four forms it does know', () => {
    const forms = ['recall', 'apply', 'spot-the-mistake', 'explain']
    const out = readQuiz({ questions: forms.map((form) => ({ form, ask: `A ${form} question`, answer: 'Yes' })) }, 'c', id)
    assert.deepEqual(
      out.map((one) => one.form),
      forms
    )
  })

  it('bounds what a model can send', () => {
    const out = readQuiz({ questions: [{ ask: 'x'.repeat(5000), answer: 'y'.repeat(5000), because: 'z'.repeat(5000) }] }, 'c', id)
    assert.ok(out[0].ask.length <= 400)
    assert.ok(out[0].answer.length <= 1200)
    assert.ok((out[0].because ?? '').length <= 400)
  })

  it('never returns more than it was told to', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ ask: `Question ${i}`, answer: 'Yes' }))
    assert.ok(readQuiz({ questions: many }, 'c', id).length <= 12)
  })

  it('carries the topic it was written for', () => {
    assert.equal(readQuiz({ questions: [{ ask: 'What?', answer: 'That' }] }, 'concept:velocity', id)[0].conceptId, 'concept:velocity')
  })

  it('leaves out questions the student rejected', () => {
    const questions = readQuiz({ questions: [{ ask: 'A bad question', answer: 'x' }, { ask: 'A fine question', answer: 'y' }] }, 'c', id)
    const left = withoutRejected(questions, ['a bad question'])
    assert.equal(left.length, 1)
    assert.equal(left[0].ask, 'A fine question')
  })
})

describe('what a generated answer is worth', () => {
  it('is the lighter evidence, right or wrong', () => {
    // Never `recalled`: nobody checked the question was fair.
    assert.equal(evidenceForGenerated(true), 'quiz-right')
    assert.equal(evidenceForGenerated(false), 'quiz-wrong')
  })
})

describe('reading card drafts back', () => {
  it('needs both halves', () => {
    const out = readCards({ cards: [{ front: 'Velocity?', back: '' }, { front: '', back: 'Something' }, { front: 'Acceleration?', back: 'Rate of change of velocity' }] }, null)
    assert.equal(out.cards.length, 1)
  })

  it('never drafts the same card twice', () => {
    const out = readCards({ cards: [{ front: 'Same', back: 'One' }, { front: 'same', back: 'Two' }] }, null)
    assert.equal(out.cards.length, 1)
  })

  it('keeps where each card came from, so it can be checked', () => {
    const out = readCards({ cards: [{ front: 'Velocity?', back: 'Rate of change of position', from: 'page 4, second paragraph' }] }, null)
    assert.equal(out.cards[0].from, 'page 4, second paragraph')
  })

  it('passes on the reason there are none', () => {
    const out = readCards({ cards: [], note: 'This looked like a timetable, not notes.' }, null)
    assert.equal(out.cards.length, 0)
    assert.match(out.note ?? '', /timetable/)
  })
})

describe('a marking suggestion', () => {
  const points = ['The parts are independent', 'Gravity acts downwards', 'Time comes from the vertical part']

  it('falls back to nothing covered when the reply cannot be read', () => {
    const out = readMarks(null, points)
    assert.equal(out.length, 3)
    assert.ok(out.every((one) => !one.covered))
  })

  it('keeps the student own points, in their order, whatever the model sends', () => {
    const out = readMarks({ points: [{ point: 'Something else entirely', covered: true }] }, points)
    assert.deepEqual(
      out.map((one) => one.point),
      points
    )
    // The model's first mark lands on the student's first point; its invented wording is thrown away.
    assert.equal(out[0].covered, true)
  })

  it('cannot add a point that was not in the notes', () => {
    const out = readMarks({ points: [{ point: 'A', covered: true }, { point: 'B', covered: true }, { point: 'C', covered: true }, { point: 'D', covered: true }] }, points)
    assert.equal(out.length, 3)
  })

  it('treats anything but a clear yes as not covered', () => {
    const out = readMarks({ points: [{ point: 'x', covered: 'probably' }, { point: 'y' }, { point: 'z', covered: true }] }, points)
    assert.deepEqual(
      out.map((one) => one.covered),
      [false, false, true]
    )
  })
})

describe('a structure proposed from a document', () => {
  it('is nothing when there is nothing to read', () => {
    assert.equal(readStructure(null), null)
    assert.equal(readStructure({}), null)
  })

  it('drops a chapter with no name', () => {
    const out = readStructure({ subject: 'Physics', chapters: [{ name: '', topics: ['x'] }, { name: 'Kinematics', topics: ['Velocity'] }] })
    assert.equal(out?.chapters.length, 1)
  })

  it('keeps a chapter with no topics rather than inventing some', () => {
    const out = readStructure({ subject: 'Physics', chapters: [{ name: 'Forces' }] })
    assert.deepEqual(out?.chapters[0], { name: 'Forces', topics: [] })
  })

  it('names the subject General when the model did not say', () => {
    assert.equal(readStructure({ chapters: [{ name: 'Kinematics', topics: ['Velocity'] }] })?.subject, 'General')
  })
})

describe('the prompts', () => {
  it('tell the model to refuse rather than invent', () => {
    assert.match(QUIZ_SYSTEM, /return an empty list/i)
    assert.match(CARDS_SYSTEM, /never add facts that are not there/i)
    assert.match(STRUCTURE_SYSTEM, /rather than inventing one/i)
    assert.match(MARK_SYSTEM, /never add points that are not in their notes/i)
    assert.match(EXPLAIN_SYSTEM, /say so plainly instead of explaining/i)
  })

  it('never ask a model to judge the student', () => {
    for (const prompt of [QUIZ_SYSTEM, CARDS_SYSTEM, MARK_SYSTEM, EXPLAIN_SYSTEM, STRUCTURE_SYSTEM]) {
      assert.ok(!/how well they|rate the student|score them|grade/i.test(prompt), prompt.slice(0, 40))
    }
  })

  it('carry the topic, what is missing and what not to repeat', () => {
    const prompt = quizPrompt({
      concept: 'Velocity',
      subject: 'Physics',
      chapter: 'Kinematics',
      howMany: 6,
      missing: 'cannot produce it from memory',
      avoid: ['What is velocity?']
    })
    assert.match(prompt, /Velocity/)
    assert.match(prompt, /Kinematics/)
    assert.match(prompt, /produce it from memory/)
    assert.match(prompt, /Do not repeat/)
  })

  it('bound how much material a model is sent', () => {
    const huge = 'x'.repeat(50_000)
    assert.ok(cardsPrompt(huge).length < 13_000)
    assert.ok(structurePrompt(huge).length < 13_000)
    assert.ok(markPrompt({ about: 'x', points: ['a'], said: huge }).length < 5000)
  })

  it('give an explanation the student age and their own mistakes', () => {
    const prompt = explainPrompt({
      concept: 'Projectiles',
      subject: 'Physics',
      band: 'older-teen',
      missing: 'cannot use it on a new problem',
      mistakes: ['Used velocity instead of the change in it'],
      confusions: ['Speed and velocity']
    })
    assert.match(prompt, /older-teen/)
    assert.match(prompt, /Used velocity instead/)
    assert.match(prompt, /Speed and velocity/)
  })
})

describe('saying whose questions these are', () => {
  it('names both sides of a mixed paper', () => {
    assert.match(describeMix(6, 4), /6 of your own, 4 written by Orion/i)
  })

  it('says so plainly when none of it is the student own', () => {
    assert.match(describeMix(0, 8), /8 written by Orion/i)
    assert.match(describeMix(0, 8), /none of your own/i)
  })

  it('does not mention Orion when Orion wrote none of it', () => {
    assert.ok(!/orion/i.test(describeMix(10, 0)))
  })
})
