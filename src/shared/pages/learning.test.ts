import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  addAttempt,
  analyse,
  checkTopic,
  compareAttempts,
  hintFor,
  isLearningError,
  learningOrder,
  LEARNING_ASSUMPTIONS,
  masteryOf,
  reviewQueue,
  socraticQuestion,
  wordsOf,
  type Analysis,
  type Attempt,
  type Concept,
  type Session,
  type Topic
} from './learning.ts'

const concept = (id: string, over: Partial<Concept> = {}): Concept => ({
  id,
  name: id,
  aliases: [],
  requires: [],
  essential: false,
  confusedWith: [],
  ...over
})

const photosynthesis = (): Topic => ({
  id: 'photo',
  name: 'Photosynthesis',
  concepts: [
    concept('light', { name: 'light energy', aliases: ['sunlight'], essential: true }),
    concept('chlorophyll', { name: 'chlorophyll', requires: ['light'], essential: true }),
    concept('carbon', {
      name: 'carbon dioxide',
      aliases: ['CO2'],
      essential: true,
      confusedWith: [
        {
          belief: 'plants take in oxygen and give out carbon dioxide',
          signal: ['plants breathe in oxygen'],
          because: 'That is respiration, which plants also do; photosynthesis runs the other way.'
        }
      ]
    }),
    concept('glucose', { name: 'glucose', aliases: ['sugar'], requires: ['carbon'], essential: true }),
    concept('stomata', { name: 'stomata', requires: ['carbon'], essential: false })
  ]
})

const analysisOf = (topic: Topic, text: string): Analysis => {
  const result = analyse(topic, text)
  assert.ok(!isLearningError(result))
  return result
}

const attemptOf = (topic: Topic, text: string, over: Partial<Attempt> = {}): Attempt => ({
  id: 'a',
  version: 1,
  text,
  analysis: analysisOf(topic, text),
  statedConfidence: null,
  hintsUsed: 0,
  ...over
})

// ------------------------------------------------------------ the topic

test('a well-formed topic has nothing to report', () => {
  assert.deepEqual(checkTopic(photosynthesis()), [])
})

test('a prerequisite outside the topic is reported without blocking', () => {
  const topic = photosynthesis()
  topic.concepts.push(concept('atp', { requires: ['krebs'] }))
  const problem = checkTopic(topic).find((one) => one.kind === 'missing-requirement')
  assert.equal(problem?.blocking, false)
  assert.match(problem?.describe ?? '', /already know/)
})

test('concepts requiring each other have no order and it is blocking', () => {
  const topic: Topic = { id: 't', name: 'T', concepts: [concept('a', { requires: ['b'] }), concept('b', { requires: ['a'] })] }
  const problem = checkTopic(topic).find((one) => one.kind === 'cycle')
  assert.equal(problem?.blocking, true)
  assert.ok(isLearningError(learningOrder(topic)))
})

test('a misconception with no signal words can never be detected, so it is refused', () => {
  const topic: Topic = {
    id: 't',
    name: 'T',
    concepts: [concept('a', { essential: true, confusedWith: [{ belief: 'wrong thing', signal: [], because: 'x' }] })]
  }
  const problem = checkTopic(topic).find((one) => one.kind === 'empty-signal')
  assert.equal(problem?.blocking, true)
})

test('a topic with no essential concept means no explanation can be wrong', () => {
  const topic: Topic = { id: 't', name: 'T', concepts: [concept('a')] }
  assert.ok(checkTopic(topic).some((one) => one.kind === 'no-essentials'))
})

test('duplicate concept ids are blocking', () => {
  const topic: Topic = { id: 't', name: 'T', concepts: [concept('a', { essential: true }), concept('a')] }
  assert.ok(checkTopic(topic).some((one) => one.kind === 'duplicate' && one.blocking))
})

test('the learning order puts prerequisites first', () => {
  const order = learningOrder(photosynthesis())
  assert.ok(!isLearningError(order))
  assert.ok(order.indexOf('light') < order.indexOf('chlorophyll'))
  assert.ok(order.indexOf('carbon') < order.indexOf('glucose'))
})

test('the learning order is deterministic', () => {
  assert.deepEqual(learningOrder(photosynthesis()), learningOrder(photosynthesis()))
})

// ------------------------------------------------------------ words

test('words are split on punctuation but hyphens and apostrophes hold', () => {
  assert.deepEqual(wordsOf("Plant's light-energy, absorbed."), ["plant's", 'light-energy', 'absorbed'])
})

// ------------------------------------------------------------ analysis

test('an alias counts as mentioning the concept, and says which alias matched', () => {
  const analysis = analysisOf(photosynthesis(), 'Sunlight hits the chlorophyll. CO2 enters and sugar comes out.')
  const light = analysis.covered.find((one) => one.conceptId === 'light')
  assert.equal(light?.mentioned, true)
  assert.equal(light?.matchedOn, 'sunlight')
})

test('a missing essential concept makes the explanation not hold, not merely short', () => {
  const analysis = analysisOf(photosynthesis(), 'Sunlight hits the chlorophyll and sugar comes out.')
  assert.deepEqual(analysis.missingEssential, ['carbon'])
  assert.match(analysis.describe, /does not hold/)
})

test('a missing supporting concept is separated from a missing essential one', () => {
  const analysis = analysisOf(photosynthesis(), 'Sunlight, chlorophyll, carbon dioxide and glucose.')
  assert.deepEqual(analysis.missingEssential, [])
  assert.deepEqual(analysis.missingOther, ['stomata'])
})

test('every analysis carries what it does and does not establish', () => {
  const analysis = analysisOf(photosynthesis(), 'Sunlight.')
  assert.match(analysis.claim, /not understanding it/)
})

test('full coverage explicitly refuses to claim the explanation is correct', () => {
  const analysis = analysisOf(photosynthesis(), 'Sunlight, chlorophyll, carbon dioxide, glucose, stomata.')
  assert.match(analysis.describe, /separate question this cannot answer/)
})

test('a misconception is found by its stated signal and carries what distinguishes it', () => {
  const analysis = analysisOf(photosynthesis(), 'Plants breathe in oxygen and give out carbon dioxide, using sunlight and chlorophyll to make glucose.')
  assert.equal(analysis.possibleMisconceptions.length, 1)
  assert.match(analysis.possibleMisconceptions[0]?.because ?? '', /respiration/)
})

test('a concept used before its prerequisite is reported', () => {
  const analysis = analysisOf(photosynthesis(), 'Glucose is the product. Carbon dioxide feeds it. Sunlight and chlorophyll drive it.')
  const late = analysis.outOfOrder.find((one) => one.conceptId === 'glucose')
  assert.deepEqual(late?.before, ['carbon'])
})

test('order is not reported for a prerequisite that was never mentioned', () => {
  const analysis = analysisOf(photosynthesis(), 'Glucose is the product.')
  assert.deepEqual(analysis.outOfOrder, [])
})

test('an explanation past the readable length is refused rather than truncated', () => {
  const result = analyse(photosynthesis(), 'x'.repeat(100_001))
  assert.ok(isLearningError(result))
  assert.equal(result.error, 'too-long')
})

test('matching is on whole phrases, not substrings', () => {
  const topic: Topic = { id: 't', name: 'T', concepts: [concept('a', { name: 'rate of change', essential: true })] }
  assert.equal(analysisOf(topic, 'the rate of the change').covered[0]?.mentioned, false)
  assert.equal(analysisOf(topic, 'its rate of change rises').covered[0]?.mentioned, true)
})

// ------------------------------------------------------------ hints

test('the first hint says only that something is missing', () => {
  const analysis = analysisOf(photosynthesis(), 'Sunlight and chlorophyll.')
  const hint = hintFor(photosynthesis(), analysis, 1)
  assert.ok(!isLearningError(hint))
  assert.match(hint.text, /Something is missing/)
})

test('even the last hint is a question, not the answer', () => {
  const analysis = analysisOf(photosynthesis(), 'Sunlight and chlorophyll.')
  const hint = hintFor(photosynthesis(), analysis, 6)
  assert.ok(!isLearningError(hint))
  assert.equal(hint.last, true)
  assert.match(hint.text, /\?$/)
})

test('a misconception is pointed at before a gap is', () => {
  const analysis = analysisOf(photosynthesis(), 'Plants breathe in oxygen. Sunlight and chlorophyll.')
  const hint = hintFor(photosynthesis(), analysis, 2)
  assert.ok(!isLearningError(hint))
  assert.match(hint.text, /wrong prediction/)
})

test('a direct misconception hint asks what the wrong belief would predict', () => {
  const analysis = analysisOf(photosynthesis(), 'Plants breathe in oxygen. Sunlight and chlorophyll.')
  const hint = hintFor(photosynthesis(), analysis, 5)
  assert.ok(!isLearningError(hint))
  assert.match(hint.text, /What would you expect to see/)
})

test('hinting at a complete explanation is refused, with the limit stated', () => {
  const analysis = analysisOf(photosynthesis(), 'Sunlight, chlorophyll, carbon dioxide, glucose, stomata.')
  const hint = hintFor(photosynthesis(), analysis, 1)
  assert.ok(isLearningError(hint))
  assert.match(hint.message, /different question/)
})

test('a level outside the ladder is refused', () => {
  const analysis = analysisOf(photosynthesis(), 'Sunlight.')
  assert.ok(isLearningError(hintFor(photosynthesis(), analysis, 0)))
  assert.ok(isLearningError(hintFor(photosynthesis(), analysis, 7)))
  assert.ok(isLearningError(hintFor(photosynthesis(), analysis, 1.5)))
})

test('the socratic question asks what has to be true for what was written', () => {
  const analysis = analysisOf(photosynthesis(), 'Glucose comes out, and stomata open.')
  assert.match(socraticQuestion(photosynthesis(), analysis), /What has to be true/)
})

test('with full coverage the question asks where the explanation breaks down', () => {
  const analysis = analysisOf(photosynthesis(), 'Sunlight, chlorophyll, carbon dioxide, glucose, stomata.')
  assert.match(socraticQuestion(photosynthesis(), analysis), /break down|stop being true/)
})

// ------------------------------------------------------------ attempts

test('attempts are numbered and earlier ones are kept', () => {
  const topic = photosynthesis()
  let session: Session = { id: 's', topicId: topic.id, attempts: [] }
  const first = addAttempt(session, attemptOf(topic, 'Sunlight.'))
  assert.ok(!isLearningError(first))
  session = first
  const second = addAttempt(session, attemptOf(topic, 'Sunlight and chlorophyll.'))
  assert.ok(!isLearningError(second))
  assert.equal(second.attempts.length, 2)
  assert.equal(second.attempts[0]?.version, 1)
  assert.equal(second.attempts[1]?.version, 2)
  assert.equal(second.attempts[0]?.text, 'Sunlight.')
})

test('a confidence outside 0 to 1 is refused', () => {
  const topic = photosynthesis()
  const result = addAttempt({ id: 's', topicId: 'photo', attempts: [] }, attemptOf(topic, 'x', { statedConfidence: 1.5 }))
  assert.ok(isLearningError(result))
})

test('a concept that disappeared between attempts is reported', () => {
  const topic = photosynthesis()
  const before = attemptOf(topic, 'Sunlight, chlorophyll, carbon dioxide, glucose.')
  const after = attemptOf(topic, 'Chlorophyll, carbon dioxide, glucose.')
  const progress = compareAttempts(topic, before, after)
  assert.deepEqual(progress.lost, ['light'])
  assert.match(progress.describe, /usually drops something/)
})

test('a concept that newly appeared is reported', () => {
  const topic = photosynthesis()
  const progress = compareAttempts(topic, attemptOf(topic, 'Sunlight.'), attemptOf(topic, 'Sunlight and chlorophyll.'))
  assert.deepEqual(progress.gained, ['chlorophyll'])
})

test('a resolved misconception is reported separately from coverage', () => {
  const topic = photosynthesis()
  const before = attemptOf(topic, 'Plants breathe in oxygen. Sunlight.')
  const after = attemptOf(topic, 'Sunlight.')
  const progress = compareAttempts(topic, before, after)
  assert.equal(progress.misconceptionsResolved.length, 1)
})

test('two identical attempts report nothing measurable changed', () => {
  const topic = photosynthesis()
  const progress = compareAttempts(topic, attemptOf(topic, 'Sunlight.'), attemptOf(topic, 'Sunlight.'))
  assert.match(progress.describe, /Nothing measurable changed/)
})

// ------------------------------------------------------------ mastery

test('an empty session has not started', () => {
  const report = masteryOf(photosynthesis(), { id: 's', topicId: 'photo', attempts: [] })
  assert.equal(report.state, 'not-started')
  assert.equal(report.coverage, 0)
})

test('full coverage is called coverage and says it is not mastery', () => {
  const topic = photosynthesis()
  const session: Session = {
    id: 's',
    topicId: 'photo',
    attempts: [attemptOf(topic, 'Sunlight, chlorophyll, carbon dioxide, glucose, stomata.')]
  }
  const report = masteryOf(topic, session)
  assert.equal(report.state, 'complete-coverage')
  assert.equal(report.coverage, 1)
  assert.match(report.describe, /not mastery/)
})

test('a misconception outranks coverage', () => {
  const topic = photosynthesis()
  const session: Session = {
    id: 's',
    topicId: 'photo',
    attempts: [attemptOf(topic, 'Plants breathe in oxygen. Sunlight, chlorophyll, carbon dioxide, glucose, stomata.')]
  }
  const report = masteryOf(topic, session)
  assert.equal(report.state, 'needs-review')
})

test('essential coverage is tracked apart from overall coverage', () => {
  const topic = photosynthesis()
  const session: Session = {
    id: 's',
    topicId: 'photo',
    attempts: [attemptOf(topic, 'Sunlight, chlorophyll, carbon dioxide, glucose.')]
  }
  const report = masteryOf(topic, session)
  assert.equal(report.essentialCoverage, 1)
  assert.equal(report.coverage, 0.8)
})

test('confidence well above coverage is named without being averaged in', () => {
  const topic = photosynthesis()
  const session: Session = { id: 's', topicId: 'photo', attempts: [attemptOf(topic, 'Sunlight.', { statedConfidence: 1 })] }
  const report = masteryOf(topic, session)
  assert.equal(report.calibration?.stated, 1)
  assert.equal(report.calibration?.measured, 0.2)
  assert.match(report.calibration?.describe ?? '', /above measured coverage/)
})

test('confidence below coverage is reported the other way round', () => {
  const topic = photosynthesis()
  const session: Session = {
    id: 's',
    topicId: 'photo',
    attempts: [attemptOf(topic, 'Sunlight, chlorophyll, carbon dioxide, glucose, stomata.', { statedConfidence: 0.2 })]
  }
  const report = masteryOf(topic, session)
  assert.match(report.calibration?.describe ?? '', /more than it feels like/)
})

test('hints used are totalled across attempts', () => {
  const topic = photosynthesis()
  const session: Session = {
    id: 's',
    topicId: 'photo',
    attempts: [attemptOf(topic, 'Sunlight.', { hintsUsed: 2 }), attemptOf(topic, 'Sunlight and chlorophyll.', { hintsUsed: 1 })]
  }
  assert.equal(masteryOf(topic, session).hintsUsed, 3)
})

// ------------------------------------------------------------ review

test('a misconception comes first in the review queue', () => {
  const topic = photosynthesis()
  const session: Session = { id: 's', topicId: 'photo', attempts: [attemptOf(topic, 'Plants breathe in oxygen. Sunlight.')] }
  assert.equal(reviewQueue(topic, session)[0]?.reason, 'misconception')
})

test('the queue is ordered by how much depends on each concept, not recency', () => {
  const topic = photosynthesis()
  const session: Session = { id: 's', topicId: 'photo', attempts: [attemptOf(topic, 'Sunlight.')] }
  const queue = reviewQueue(topic, session)
  const missing = queue.filter((one) => one.reason === 'never-mentioned')
  assert.equal(missing[0]?.conceptId, 'carbon')
  assert.equal(missing[0]?.dependents, 2)
})

test('a concept that appeared before and then vanished is marked dropped', () => {
  const topic = photosynthesis()
  const session: Session = {
    id: 's',
    topicId: 'photo',
    attempts: [attemptOf(topic, 'Sunlight, chlorophyll, carbon dioxide, glucose, stomata.'), attemptOf(topic, 'Chlorophyll, carbon dioxide, glucose, stomata.')]
  }
  const item = reviewQueue(topic, session).find((one) => one.conceptId === 'light')
  assert.equal(item?.reason, 'dropped')
})

test('concepts that only appeared after many hints go into the queue', () => {
  const topic = photosynthesis()
  const session: Session = {
    id: 's',
    topicId: 'photo',
    attempts: [attemptOf(topic, 'Sunlight, chlorophyll, carbon dioxide, glucose, stomata.', { hintsUsed: 4 })]
  }
  assert.ok(reviewQueue(topic, session).every((one) => one.reason === 'needed-hints'))
})

test('a session with nothing in it has an empty queue', () => {
  assert.deepEqual(reviewQueue(photosynthesis(), { id: 's', topicId: 'photo', attempts: [] }), [])
})

test('the stated assumptions are frozen and refuse to claim understanding', () => {
  assert.equal(Object.isFrozen(LEARNING_ASSUMPTIONS), true)
  assert.ok(LEARNING_ASSUMPTIONS.some((one) => /not understanding/.test(one)))
})
