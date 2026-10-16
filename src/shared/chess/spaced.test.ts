import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SCHEDULER, GRADE_RULES, afterAttempt, due, gradeFor, newCard, schedulerFacts, sessionPlan, themeStandings,
  unseen, weakestThemes, type ReviewCard
} from './spaced.ts'
import type { Performance } from './attempt.ts'

const DAY = 86_400_000

const did = (over: Partial<Performance> = {}): Performance => ({
  exerciseId: 'p1',
  solved: true,
  gaveUp: false,
  hintsUsed: 0,
  worth: 1,
  wrongMoves: 0,
  illegalTries: 0,
  seconds: 10,
  at: 0,
  ...over
})

test('the grade comes from the record, and every rule is reachable', () => {
  assert.equal(gradeFor(did({ gaveUp: true, solved: false })).grade, 0)
  assert.equal(gradeFor(did({ solved: false })).grade, 1)
  assert.equal(gradeFor(did({ worth: 0 })).grade, 2, 'solved with the move shown is a lapse, not a pass')
  assert.equal(gradeFor(did({ wrongMoves: 1 })).grade, 3)
  assert.equal(gradeFor(did({ hintsUsed: 2, worth: 0.3 })).grade, 3)
  assert.equal(gradeFor(did({ hintsUsed: 1, worth: 0.85 })).grade, 4)
  assert.equal(gradeFor(did({ seconds: 300 })).grade, 4, 'clean but slow')
  assert.equal(gradeFor(did()).grade, 5)
  // Every rule in the published table is used by something.
  const used = new Set([0, 1, 2, 3, 4, 5])
  for (const rule of GRADE_RULES) assert.ok(used.has(rule.grade), `${rule.grade}`)
  assert.equal(GRADE_RULES.length, 6)
  assert.ok(gradeFor(did()).rule.length > 5, 'the grade says which rule decided it')
})

test('"quickly" is the caller’s number, not a guess made here', () => {
  assert.equal(gradeFor(did({ seconds: 20 }), 10).grade, 4)
  assert.equal(gradeFor(did({ seconds: 20 }), 30).grade, 5)
})

test('a clean solve pushes the card out, and a failure brings it back tomorrow', () => {
  const card = newCard({ exerciseId: 'p1', themes: ['fork'], now: 0 })
  assert.equal(card.fresh, true)
  assert.equal(card.dueAt, 0)

  const first = afterAttempt(card, did(), 0)
  assert.equal(first.grade.grade, 5)
  assert.equal(first.intervalDays, 1)
  assert.equal(first.card.dueAt, DAY)
  assert.equal(first.card.fresh, false)
  assert.equal(first.card.attempts, 1)
  assert.equal(first.card.solved, 1)
  assert.equal(first.card.wrongRun, 0)
  assert.match(first.says, /SM-2/)

  const second = afterAttempt(first.card, did({ at: DAY }), DAY)
  assert.equal(second.intervalDays, 6, 'SM-2’s second interval, exactly as published')
  const third = afterAttempt(second.card, did({ at: 7 * DAY }), 7 * DAY)
  assert.ok(third.intervalDays > 6, `${third.intervalDays}`)

  const lapsed = afterAttempt(third.card, did({ solved: false }), 40 * DAY)
  assert.equal(lapsed.grade.grade, 1)
  assert.equal(lapsed.intervalDays, 1)
  assert.equal(lapsed.card.lapses, 1)
  assert.equal(lapsed.card.wrongRun, 1)
})

test('solving it with the answer on screen does not count as solving it', () => {
  const card = newCard({ exerciseId: 'p1', now: 0 })
  const shown = afterAttempt(card, did({ worth: 0, hintsUsed: 3 }), 0)
  assert.equal(shown.grade.grade, 2)
  assert.equal(shown.intervalDays, 1)
  assert.equal(shown.card.solved, 0, 'the solve was not a solve')
  assert.equal(shown.card.wrongRun, 1)
})

test('the same card and the same attempt always give the same date', () => {
  const card = newCard({ exerciseId: 'p1', now: 1_000 })
  const a = afterAttempt(card, did({ at: 1_000 }), 1_000)
  const b = afterAttempt(card, did({ at: 1_000 }), 1_000)
  assert.deepEqual(a.card, b.card)
  assert.equal(a.intervalDays, b.intervalDays)
})

test('three wrong in a row stops asking and offers the lesson instead', () => {
  let card = newCard({ exerciseId: 'p1', themes: ['pin'], now: 0 })
  let needsLesson = false
  for (let i = 0; i < 3; i += 1) {
    const step = afterAttempt(card, did({ solved: false }), i * DAY)
    card = step.card
    needsLesson = step.needsLesson
  }
  assert.equal(card.wrongRun, 3)
  assert.equal(needsLesson, true)
  const plan = sessionPlan([card], 10 * DAY)
  assert.deepEqual(plan.review, [])
  assert.equal(plan.teach.length, 1)
  assert.match(plan.says, /look at properly/)
})

test('what is due is due, and new material comes after it', () => {
  const now = 10 * DAY
  const cards: ReviewCard[] = [
    { ...newCard({ exerciseId: 'old', now: 0 }), fresh: false, dueAt: 2 * DAY },
    { ...newCard({ exerciseId: 'later', now: 0 }), fresh: false, dueAt: 5 * DAY },
    { ...newCard({ exerciseId: 'future', now: 0 }), fresh: false, dueAt: 50 * DAY },
    newCard({ exerciseId: 'new-a', now: 0 }),
    newCard({ exerciseId: 'new-b', now: 0 })
  ]
  assert.deepEqual(due(cards, now).map((c) => c.exerciseId), ['old', 'later'])
  assert.deepEqual(unseen(cards).map((c) => c.exerciseId), ['new-a', 'new-b'])
  const plan = sessionPlan(cards, now, { review: 1, fresh: 1 })
  assert.deepEqual(plan.review.map((c) => c.exerciseId), ['old'])
  assert.deepEqual(plan.fresh.map((c) => c.exerciseId), ['new-a'])
  assert.equal(sessionPlan([], now).says, 'Nothing is due.')
})

test('a theme says how much evidence is behind the number', () => {
  const cards: ReviewCard[] = [
    { ...newCard({ exerciseId: 'a', themes: ['fork'], now: 0 }), fresh: false, attempts: 3, solved: 1, dueAt: 0 },
    { ...newCard({ exerciseId: 'b', themes: ['fork'], now: 0 }), fresh: false, attempts: 4, solved: 1, dueAt: 0 },
    { ...newCard({ exerciseId: 'c', themes: ['pin'], now: 0 }), fresh: false, attempts: 10, solved: 10, dueAt: 0 },
    newCard({ exerciseId: 'd', themes: ['skewer'], now: 0 })
  ]
  const standings = themeStandings(cards, DAY)
  assert.deepEqual(standings.map((s) => s.theme), ['fork', 'pin', 'skewer'])
  const fork = standings.find((s) => s.theme === 'fork')
  assert.equal(fork?.attempts, 7)
  assert.equal(fork?.solved, 2)
  assert.ok((fork?.share ?? 0) < 0.3)
  assert.equal(fork?.dueNow, 2)
  const skewer = standings.find((s) => s.theme === 'skewer')
  assert.equal(skewer?.share, null, 'nothing tried means no share, not zero')
  assert.equal(skewer?.says, 'Not tried yet.')
  assert.deepEqual(weakestThemes(cards, DAY).map((s) => s.theme), ['fork'])
})

test('the scheduler says what it is and what it cannot do', () => {
  const facts = schedulerFacts(DEFAULT_SCHEDULER)
  assert.equal(facts.label, 'SM-2')
  assert.ok(facts.origin.includes('1987'))
  assert.ok(facts.limitation.length > 40, 'a schedule without its limitation is a schedule nobody can judge')
  assert.equal(schedulerFacts('fsrs-like').label.length > 0, true)
})

test('a card can use a different scheduler without this file doing the arithmetic', () => {
  const card = { ...newCard({ exerciseId: 'p1', now: 0 }), scheduler: 'leitner' as const }
  const stepped = afterAttempt(card, did(), 0)
  assert.equal(stepped.intervalDays, 2, 'Leitner box two')
  assert.equal(stepped.card.state.box, 2)
})
