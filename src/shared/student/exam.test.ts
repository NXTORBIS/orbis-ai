import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { CRUNCH_DAYS, EXAM_OFF, afterExam, daysTo, examAhead, finalDays, readinessFor, whatChanges, worthDoing } from './exam.ts'
import { emptyProgression, nextStage, record as recordAttempt, stagesFor, through } from './progression.ts'
import { newMastery, record as recordEvidence, type Mastery } from './mastery.ts'
import { dayKey, shiftDay } from './days.ts'
import type { Graph } from './graph.ts'
import type { Goal } from './types.ts'

/**
 * The weeks before an exam, and working up through a subject.
 *
 * The tests that matter are the refusals and the restraint: nothing is locked, nothing is scored, readiness is
 * null rather than zero when there is nothing to go on, and the wording never frightens anybody.
 */

const NOW = Date.UTC(2026, 4, 20, 9, 0, 0)
const today = dayKey(NOW)

const graph: Graph = {
  chapters: [
    { id: 'ch:kin', name: 'Kinematics', subject: 'Physics', order: 0 },
    { id: 'ch:forces', name: 'Forces', subject: 'Physics', order: 1 },
    { id: 'ch:bonds', name: 'Bonding', subject: 'Chemistry', order: 0 }
  ],
  concepts: [
    { id: 'c:vel', name: 'Velocity', chapterId: 'ch:kin', requires: [], difficulty: 3, importance: 0.5, order: 0 },
    { id: 'c:acc', name: 'Acceleration', chapterId: 'ch:kin', requires: [], difficulty: 3, importance: 0.5, order: 1 },
    { id: 'c:fric', name: 'Friction', chapterId: 'ch:forces', requires: [], difficulty: 3, importance: 0.5, order: 0 },
    { id: 'c:ionic', name: 'Ionic bonds', chapterId: 'ch:bonds', requires: [], difficulty: 3, importance: 0.5, order: 0 }
  ]
}

const goal = (daysAway: number, extra: Partial<Goal> = {}): Goal =>
  ({
    id: 'g1',
    profileId: 'p',
    title: 'Physics paper',
    why: '',
    horizon: 'long-term',
    subject: 'Physics',
    deadline: NOW + daysAway * 86_400_000,
    milestones: [],
    state: 'active',
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra
  }) as Goal

const strong = (id: string): Mastery => {
  let held = newMastery(id, NOW)
  for (const kind of ['recalled', 'applied', 'taught-back', 'recalled', 'applied'] as const) held = recordEvidence(held, kind, NOW)
  return held
}

const halfway = (id: string): Mastery => {
  let held = newMastery(id, NOW)
  for (const kind of ['recalled', 'applied', 'recalled'] as const) held = recordEvidence(held, kind, NOW)
  return held
}

describe('the exam ahead', () => {
  it('says there is none rather than inventing one', () => {
    assert.equal(examAhead([], graph, new Map(), NOW), null)
  })

  it('finds the nearest paper still to come', () => {
    const out = examAhead([goal(10), goal(3, { id: 'g2', title: 'Chemistry paper' })], graph, new Map(), NOW)
    assert.equal(out?.goalId, 'g2')
    assert.equal(out?.daysLeft, 3)
  })

  it('names the phase from the days left', () => {
    assert.equal(examAhead([goal(30)], graph, new Map(), NOW)?.phase, 'ahead')
    assert.equal(examAhead([goal(10)], graph, new Map(), NOW)?.phase, 'preparing')
    assert.equal(examAhead([goal(CRUNCH_DAYS)], graph, new Map(), NOW)?.phase, 'crunch')
    assert.equal(examAhead([goal(1)], graph, new Map(), NOW)?.phase, 'tomorrow')
    assert.equal(examAhead([goal(0)], graph, new Map(), NOW)?.phase, 'today')
  })

  it('reports nothing measured as nothing, never as zero ready', () => {
    assert.equal(examAhead([goal(5)], graph, new Map(), NOW)?.ready, null)
    assert.equal(readinessFor(graph, new Map(), ['Physics']), null)
  })

  it('counts untouched topics as zero once anything is measured', () => {
    // One of three Physics concepts known well: not "100% of what you have looked at".
    const ready = readinessFor(graph, new Map([['c:vel', strong('c:vel')]]), ['Physics'])
    // One of three known reasonably well: a fraction, not a pass mark.
    assert.ok(ready !== null && ready > 0.1 && ready < 0.35, String(ready))
  })

  it('never says anything frightening, at any phase', () => {
    for (const days of [30, 10, 3, 1, 0]) {
      const said = examAhead([goal(days)], graph, new Map([['c:vel', halfway('c:vel')]]), NOW)?.says ?? ''
      assert.ok(!/panic|hurry|behind|fail|only \d+ days left!|running out/i.test(said), said)
    }
  })

  it('tells somebody sitting it today to go and sit it', () => {
    assert.match(examAhead([goal(0)], graph, new Map(), NOW)?.says ?? '', /go and sit it/i)
  })

  it('puts nearly-there topics first in the last days, and untouched ones first before that', () => {
    const mastery = new Map([
      ['c:vel', halfway('c:vel')]
      // Acceleration and Friction are untouched.
    ])
    const close = worthDoing(graph, mastery, ['Physics'], 2)
    assert.equal(close[0].conceptId, 'c:vel')
    assert.match(close[0].why, /nearly holding/i)

    const far = worthDoing(graph, mastery, ['Physics'], 20)
    assert.notEqual(far[0].conceptId, 'c:vel')
    assert.match(far[0].why, /not started/i)
  })

  it('leaves out what is genuinely holding', () => {
    // Built directly: reaching 0.7 from evidence takes weeks of spacing, and this is a test about the filter.
    const holding: Mastery = {
      ...strong('c:vel'),
      scores: { exposure: 0.9, understanding: 0.9, recall: 0.9, application: 0.9, accuracy: 0.9, retention: 0.9, consistency: 0.9 }
    }
    const out = worthDoing(graph, new Map([['c:vel', holding]]), ['Physics'], 5)
    assert.ok(!out.some((one) => one.conceptId === 'c:vel'))
  })

  it('in the last days, the nearest thing to finished comes first', () => {
    // Both started, one further along: with two days left the further one is the better use of the evening.
    const mastery = new Map([['c:vel', strong('c:vel')], ['c:acc', halfway('c:acc')]])
    const out = worthDoing(graph, mastery, ['Physics'], 2)
    assert.equal(out[0].conceptId, 'c:vel')
  })

  it('stays inside the subject the paper is about', () => {
    const out = worthDoing(graph, new Map(), ['Physics'], 5)
    assert.ok(!out.some((one) => one.conceptId === 'c:ionic'))
  })

  it('says exactly what the mode changes, and that nothing is locked', () => {
    const changes = whatChanges({ ...EXAM_OFF, goalId: 'g1', quieter: true, longerSessions: true })
    assert.ok(changes.some((one) => /quiet/i.test(one)))
    assert.ok(changes.some((one) => /50 minutes/i.test(one)))
    assert.ok(changes.some((one) => /nothing is locked/i.test(one)))
  })

  it('counts the days to a paper, and lays out the last few', () => {
    assert.equal(daysTo(shiftDay(today, 4), NOW), 4)
    assert.equal(finalDays(shiftDay(today, 3), NOW).length, 4)
  })
})

describe('the day after', () => {
  const sessions = [
    { subject: 'Physics', startedAt: NOW - 86_400_000, focusedSeconds: 3600 },
    { subject: 'Physics', startedAt: NOW - 2 * 86_400_000, focusedSeconds: 1800 },
    { subject: 'Chemistry', startedAt: NOW - 86_400_000, focusedSeconds: 3600 }
  ]

  it('says what went in, and nothing about how it went', () => {
    const out = afterExam(goal(-1), graph, new Map([['c:vel', strong('c:vel')]]), sessions, NOW)
    assert.match(out.says, /1\.5 hours across 2 sessions/i)
    assert.ok(!/well|badly|should|hope|score/i.test(out.says), out.says)
  })

  it('separates what was covered from what was not', () => {
    const out = afterExam(goal(-1), graph, new Map([['c:vel', strong('c:vel')]]), sessions, NOW)
    assert.deepEqual(out.covered, ['Velocity'])
    assert.deepEqual([...out.notCovered].sort(), ['Acceleration', 'Friction'])
  })

  it('counts only the work for that subject, before the paper', () => {
    const out = afterExam(goal(-1), graph, new Map(), sessions, NOW)
    assert.equal(out.sessions, 2)
  })

  it('says plainly when nothing was recorded', () => {
    const out = afterExam(goal(-1), graph, new Map(), [], NOW)
    assert.match(out.says, /no sessions recorded/i)
  })
})

describe('working up through a subject', () => {
  it('has a stage per chapter, then a mixed one, then the whole thing', () => {
    const stages = stagesFor(graph, 'Physics', new Map(), emptyProgression())
    assert.deepEqual(
      stages.map((one) => one.kind),
      ['chapter', 'chapter', 'mixed', 'final']
    )
  })

  it('locks nothing: a stage that is not suggested still says it can be taken now', () => {
    const stages = stagesFor(graph, 'Physics', new Map(), emptyProgression())
    const second = stages[1]
    assert.equal(second.unlocked, false)
    assert.match(second.locked ?? '', /you can take it now/i)
  })

  it('suggests a chapter that has actually been studied, whatever the order says', () => {
    const stages = stagesFor(graph, 'Physics', new Map([['c:fric', halfway('c:fric')]]), emptyProgression())
    assert.equal(stages.find((one) => one.name === 'Forces')?.unlocked, true)
  })

  it('suggests the mixed paper once about half the chapters are passed', () => {
    const before = stagesFor(graph, 'Physics', new Map(), emptyProgression())
    assert.equal(before.find((one) => one.kind === 'mixed')?.unlocked, false)

    const held = recordAttempt(emptyProgression(), { stageId: before[0].id, score: 10, outOf: 10, passed: true, at: NOW })
    const after = stagesFor(graph, 'Physics', new Map(), held)
    assert.equal(after.find((one) => one.kind === 'mixed')?.unlocked, true)
  })

  it('keeps every attempt, and the best of them', () => {
    let held = recordAttempt(emptyProgression(), { stageId: 'stage:ch:kin', score: 4, outOf: 10, passed: false, at: NOW })
    held = recordAttempt(held, { stageId: 'stage:ch:kin', score: 9, outOf: 10, passed: true, at: NOW + 1000 })
    const stages = stagesFor(graph, 'Physics', new Map(), held)
    const first = stages[0]
    assert.equal(first.attempts, 2)
    assert.equal(first.passed, true)
    assert.equal(first.bestScore, 0.9)
  })

  it('does not take a pass away when a later attempt goes badly', () => {
    let held = recordAttempt(emptyProgression(), { stageId: 'stage:ch:kin', score: 9, outOf: 10, passed: true, at: NOW })
    held = recordAttempt(held, { stageId: 'stage:ch:kin', score: 2, outOf: 10, passed: false, at: NOW + 1000 })
    assert.equal(stagesFor(graph, 'Physics', new Map(), held)[0].passed, true)
  })

  it('counts how far through a subject somebody is, with no grade attached', () => {
    const held = recordAttempt(emptyProgression(), { stageId: 'stage:ch:kin', score: 10, outOf: 10, passed: true, at: NOW })
    const out = through(stagesFor(graph, 'Physics', new Map(), held))
    assert.equal(out.passed, 1)
    assert.equal(out.total, 4)
    assert.match(out.says, /1 of 4 passed/)
  })

  it('suggests the first unpassed stage that is sensible', () => {
    const stages = stagesFor(graph, 'Physics', new Map(), emptyProgression())
    assert.equal(nextStage(stages)?.name, 'Kinematics')
  })

  it('keeps subjects apart', () => {
    const stages = stagesFor(graph, 'Chemistry', new Map(), emptyProgression())
    assert.equal(stages.filter((one) => one.kind === 'chapter').length, 1)
  })

  it('has nothing to offer for a subject it does not know', () => {
    assert.deepEqual(stagesFor(graph, 'Latin', new Map(), emptyProgression()), [])
  })
})
