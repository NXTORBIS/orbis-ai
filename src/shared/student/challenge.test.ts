import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { COMBO_XP_A_DAY, LEAST_QUESTIONS, answered, challengeFor, challengeResult, newCombo, surpriseFor } from './challenge.ts'
import { newMastery, record as recordEvidence, type Mastery } from './mastery.ts'
import { dayKey } from './days.ts'
import type { Chapter, Concept, Graph } from './graph.ts'
import type { Flashcard, Mistake } from './types.ts'

/**
 * Challenges.
 *
 * The tests that matter are the refusals: a challenge with too little of the student's own material must not be
 * made, and nothing here may invent a question.
 */

const NOW = Date.UTC(2026, 4, 20, 15, 0, 0)
const DAY = dayKey(NOW)

const chapter: Chapter = { id: 'ch:kinematics', name: 'Kinematics', subject: 'Physics', order: 0 }
const concepts: Concept[] = [
  { id: 'c:velocity', name: 'Velocity', chapterId: chapter.id, requires: [], difficulty: 3, importance: 0.5, order: 0 },
  { id: 'c:acceleration', name: 'Acceleration', chapterId: chapter.id, requires: [], difficulty: 3, importance: 0.5, order: 1 }
]

const card = (id: string, front: string, back: string, subject: string | null = 'Physics'): Flashcard => ({
  id,
  profileId: 'p',
  front,
  back,
  subject,
  origin: 'student',
  deck: 'default',
  conceptId: null,
  practised: 0,
  recalled: 0,
  lastPractisedAt: null,
  createdAt: NOW
})

const mistake = (id: string, concept: string, detail: string): Mistake => ({
  id,
  profileId: 'p',
  subject: 'Physics',
  concept,
  kind: 'concept',
  detail,
  at: NOW,
  reviewedAt: null,
  sessionId: null
})

describe('a run of right answers', () => {
  it('starts at nothing and pays nothing for the first two', () => {
    let combo = newCombo('sit', DAY)
    const first = answered(combo, true, 'sit', NOW)
    assert.equal(first.xp, 0)
    combo = first.combo
    const second = answered(combo, true, 'sit', NOW)
    assert.equal(second.xp, 0)
    assert.equal(second.combo.run, 2)
  })

  it('pays a little at three, and says so', () => {
    let combo = newCombo('sit', DAY)
    let said: string | null = null
    let paid = 0
    for (let i = 0; i < 3; i += 1) {
      const out = answered(combo, true, 'sit', NOW)
      combo = out.combo
      paid += out.xp
      said = out.says ?? said
    }
    assert.equal(paid, 3)
    assert.match(said ?? '', /three in a row/i)
  })

  it('takes nothing away for a wrong answer, and simply starts again', () => {
    let combo = newCombo('sit', DAY)
    for (let i = 0; i < 4; i += 1) combo = answered(combo, true, 'sit', NOW).combo
    const wrong = answered(combo, false, 'sit', NOW)
    assert.equal(wrong.combo.run, 0)
    assert.equal(wrong.xp, 0)
    // Nothing is lost: what was already earned and the best run both stand.
    assert.equal(wrong.combo.best, 4)
    assert.equal(wrong.combo.paidToday, combo.paidToday)
  })

  it('keeps the best run but starts the current one again in a new sitting', () => {
    let combo = newCombo('sit', DAY)
    for (let i = 0; i < 5; i += 1) combo = answered(combo, true, 'sit', NOW).combo
    const next = answered(combo, true, 'another-sitting', NOW)
    assert.equal(next.combo.run, 1)
    assert.equal(next.combo.best, 5)
  })

  it('cannot be farmed: a day has a cap', () => {
    let combo = newCombo('sit', DAY)
    // Twenty sittings, each run to ten.
    for (let sitting = 0; sitting < 20; sitting += 1) {
      for (let i = 0; i < 10; i += 1) combo = answered(combo, true, `sit${sitting}`, NOW).combo
    }
    assert.equal(combo.paidToday, COMBO_XP_A_DAY)
  })

  it('starts the allowance again tomorrow', () => {
    let combo = newCombo('sit', DAY)
    for (let i = 0; i < 3; i += 1) combo = answered(combo, true, 'sit', NOW).combo
    assert.ok(combo.paidToday > 0)
    const tomorrow = answered(combo, true, 'sit', NOW + 86_400_000)
    assert.equal(tomorrow.combo.paidToday, 0)
    assert.equal(tomorrow.combo.run, 1)
  })
})

describe('a chapter challenge', () => {
  it('refuses when there is nothing of the student own material to ask about', () => {
    const out = challengeFor(chapter, concepts, { cards: [], mistakes: [] }, new Map(), NOW)
    assert.equal('ready' in out && out.ready, false)
    assert.match('why' in out ? out.why : '', /nothing of your own/i)
  })

  it('refuses when there is some material but not enough for a fair test', () => {
    const cards = [card('1', 'Velocity', 'Rate of change of position'), card('2', 'Acceleration', 'Rate of change of velocity')]
    const out = challengeFor(chapter, concepts, { cards, mistakes: [] }, new Map(), NOW)
    assert.equal('ready' in out && out.ready, false)
    assert.equal('have' in out ? out.have : -1, 2)
    assert.equal('need' in out ? out.need : -1, LEAST_QUESTIONS)
  })

  it('builds a test out of the cards the student made, and nothing else', () => {
    const cards = Array.from({ length: 6 }, (_, i) => card(`c${i}`, `Velocity question ${i}`, `Answer ${i}`))
    const out = challengeFor(chapter, concepts, { cards, mistakes: [] }, new Map(), NOW)
    assert.ok('questions' in out)
    if (!('questions' in out)) return
    assert.equal(out.questions.length, 6)
    assert.ok(out.questions.every((one) => one.source === 'flashcard'))
    // Every question traces back to a card the student made.
    assert.ok(out.questions.every((one) => cards.some((c) => c.id === one.sourceId)))
  })

  it('puts mistakes first, because they are the useful questions', () => {
    const cards = Array.from({ length: 6 }, (_, i) => card(`c${i}`, `Velocity ${i}`, `Answer ${i}`))
    const mistakes = [mistake('m1', 'Acceleration', 'I used velocity instead')]
    const out = challengeFor(chapter, concepts, { cards, mistakes }, new Map(), NOW)
    assert.ok('questions' in out)
    if (!('questions' in out)) return
    assert.equal(out.questions[0].source, 'mistake')
  })

  it('does not include material from another subject', () => {
    const cards = Array.from({ length: 6 }, (_, i) => card(`c${i}`, `Something ${i}`, `Answer ${i}`, 'Chemistry'))
    const out = challengeFor(chapter, concepts, { cards, mistakes: [] }, new Map(), NOW)
    assert.equal('ready' in out && out.ready, false)
  })

  it('states the pass mark before it starts, and never demands every answer', () => {
    const cards = Array.from({ length: 10 }, (_, i) => card(`c${i}`, `Velocity ${i}`, `Answer ${i}`))
    const out = challengeFor(chapter, concepts, { cards, mistakes: [] }, new Map(), NOW)
    assert.ok('toPass' in out)
    if (!('toPass' in out)) return
    assert.ok(out.toPass < out.questions.length)
    assert.ok(out.toPass >= 3)
  })

  it('asks the weakest things first', () => {
    let strong = newMastery('c:velocity', NOW)
    for (const kind of ['recalled', 'applied', 'taught-back', 'recalled', 'applied'] as const) strong = recordEvidence(strong, kind, NOW)
    const mastery = new Map<string, Mastery>([['c:velocity', strong]])
    const cards = [
      ...Array.from({ length: 3 }, (_, i) => card(`v${i}`, `Velocity ${i}`, `Answer ${i}`)),
      ...Array.from({ length: 3 }, (_, i) => card(`a${i}`, `Acceleration ${i}`, `Answer ${i}`))
    ]
    const out = challengeFor(chapter, concepts, { cards, mistakes: [] }, mastery, NOW)
    assert.ok('questions' in out)
    if (!('questions' in out)) return
    assert.equal(out.questions[0].conceptId, 'c:acceleration')
  })

  it('scores only the questions it actually asked, and counts nothing twice', () => {
    const cards = Array.from({ length: 6 }, (_, i) => card(`c${i}`, `Velocity ${i}`, `Answer ${i}`))
    const out = challengeFor(chapter, concepts, { cards, mistakes: [] }, new Map(), NOW)
    assert.ok('questions' in out)
    if (!('questions' in out)) return
    const first = out.questions[0].id
    const result = challengeResult(out, [first, first, 'q:not-in-this-test'])
    assert.equal(result.score, 1)
    assert.equal(result.outOf, 6)
    assert.equal(result.passed, false)
  })

  it('says a failed attempt without blame, and points at what to do', () => {
    const cards = Array.from({ length: 6 }, (_, i) => card(`c${i}`, `Velocity ${i}`, `Answer ${i}`))
    const out = challengeFor(chapter, concepts, { cards, mistakes: [] }, new Map(), NOW)
    assert.ok('questions' in out)
    if (!('questions' in out)) return
    const result = challengeResult(out, [])
    assert.ok(!/fail|bad|poor|should have/i.test(result.says))
    assert.match(result.says, /another look/i)
  })
})

describe('a surprise', () => {
  const graph: Graph = { chapters: [chapter], concepts }

  const nearly = (): Map<string, Mastery> => {
    let held = newMastery('c:velocity', NOW)
    for (const kind of ['recalled', 'applied', 'recalled', 'taught-back'] as const) held = recordEvidence(held, kind, NOW)
    return new Map([['c:velocity', held]])
  }

  it('is not offered to somebody who has not studied today', () => {
    const out = surpriseFor({ lastSurpriseDay: null, sessionsToday: 0, focusedSecondsToday: 0, now: NOW }, graph, nearly())
    assert.equal(out, null)
  })

  it('is not offered twice in a day', () => {
    const state = { lastSurpriseDay: DAY, sessionsToday: 2, focusedSecondsToday: 3600, now: NOW }
    assert.equal(surpriseFor(state, graph, nearly()), null)
  })

  it('is offered after a decent day, and is about something nearly there', () => {
    const out = surpriseFor({ lastSurpriseDay: null, sessionsToday: 2, focusedSecondsToday: 3600, now: NOW }, graph, nearly())
    assert.ok(out)
    assert.equal(out?.conceptId, 'c:velocity')
    assert.equal(out?.minutes, 5)
    assert.match(out?.because ?? '', /nearly/i)
  })

  it('is not offered when nothing is close enough for five minutes to matter', () => {
    const out = surpriseFor({ lastSurpriseDay: null, sessionsToday: 2, focusedSecondsToday: 3600, now: NOW }, graph, new Map())
    assert.equal(out, null)
  })

  it('is never about something that has just been going wrong', () => {
    let held = newMastery('c:velocity', NOW)
    for (const kind of ['recalled', 'applied', 'recalled', 'taught-back'] as const) held = recordEvidence(held, kind, NOW)
    for (let i = 0; i < 2; i += 1) held = recordEvidence(held, 'recall-failed', NOW)
    const out = surpriseFor({ lastSurpriseDay: null, sessionsToday: 2, focusedSecondsToday: 3600, now: NOW }, graph, new Map([['c:velocity', held]]))
    assert.equal(out, null)
  })
})
