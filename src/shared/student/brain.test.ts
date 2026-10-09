import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { confusions, decayed, describe as describeMastery, newMastery, overall, proof, record as recordEvidence, staleness, strengths, weaknesses, type EvidenceKind, type Mastery } from './mastery.ts'
import { allPrerequisites, blockedBy, chapterProgress, chaptersOf, conceptsIn, emptyGraph, merge, pathThrough, readSyllabus, readyFor, subjectProgress, subjectsOf, tree, unlockedBy, type Graph } from './graph.ts'
import { candidates, planAhead, planDay, radar, recovery, replan, shortPlan, type Availability, type PlanInput } from './planner.ts'
import { DAILY_BUDGET, decide, newLog, recommend, record as logIntervention, reception, shouldAppear, usualHours, type DecideInput } from './decide.ts'
import { MICRO, evidenceFrom, finishStep, microFor, missionFor, progressOf, smaller } from './mission.ts'
import { DEFAULT_BREAKS, snapshotPolicy } from './focus.ts'
import { newSession } from './session.ts'
import { dayKey, shiftDay } from './days.ts'
import type { FocusSession } from './types.ts'

/**
 * The learning brain: mastery, the knowledge graph, the planner, the decision engine and missions.
 *
 * Every test here guards something that fails quietly and plausibly. A progress bar that climbs because pages were
 * opened, a recommendation for a topic whose foundation is missing, a plan nobody could finish, and a companion
 * that interrupts somebody mid-sentence all look like working software.
 */

const DAY = 24 * 3600 * 1000
const NOW = new Date(2026, 9, 3, 14, 0, 0).getTime()
const TODAY = dayKey(NOW)

const feed = (kinds: readonly EvidenceKind[], at = NOW): Mastery => {
  let held = newMastery('c1', at)
  kinds.forEach((kind, i) => {
    held = recordEvidence(held, kind, at + i * 1000)
  })
  return held
}

// ---------------------------------------------------------------- mastery

describe('whether somebody knows something', () => {
  it('does not let reading raise recall', () => {
    // The commonest lie in study software: treating "opened" as "learned".
    const read = feed(['read', 'read', 'read', 'read', 'read'])
    assert.ok(read.scores.exposure > 0.7, 'exposure does rise')
    assert.equal(read.scores.recall, 0, 'and recall does not')
    assert.ok(overall(read) < 0.15, `overall stays low: ${overall(read)}`)
  })

  it('moves a score towards its target rather than adding to it', () => {
    const once = feed(['recalled'])
    const twice = feed(['recalled', 'recalled'])
    const thrice = feed(['recalled', 'recalled', 'recalled'])
    assert.ok(twice.scores.recall > once.scores.recall)
    // Each step closes less of the remaining distance, so nothing reaches 1 from a handful of answers.
    assert.ok(thrice.scores.recall - twice.scores.recall < twice.scores.recall - once.scores.recall)
    assert.ok(thrice.scores.recall < 1)
  })

  it('cannot be mastered on a handful of answers, however good they are', () => {
    const lucky = feed(['recalled', 'applied', 'taught-back'])
    assert.ok(lucky.confidence < 0.7, `confidence ${lucky.confidence}`)
    assert.notEqual(lucky.state, 'mastered', 'three right answers is not mastery')
  })

  it('reaches mastery with real evidence over real gaps', () => {
    let held = newMastery('c1', NOW)
    const kinds: EvidenceKind[] = ['read', 'explained', 'recalled', 'applied', 'quiz-right', 'taught-back', 'recalled', 'applied', 'quiz-right', 'recalled', 'applied', 'taught-back']
    // Spread over weeks, because retention only counts a gap of a week or more as real.
    kinds.forEach((kind, i) => {
      held = recordEvidence(held, kind, NOW + i * 8 * DAY)
    })
    assert.ok(held.confidence >= 0.7, `confidence ${held.confidence}`)
    assert.ok(held.scores.retention >= 0.6, `retention ${held.scores.retention}`)
    assert.equal(held.state, 'mastered', `state ${held.state}, overall ${overall(held)}`)
  })

  it('counts separate days for consistency, not separate answers', () => {
    const oneSitting = feed(['recalled', 'recalled', 'recalled', 'recalled', 'recalled', 'recalled'])
    assert.ok(oneSitting.scores.consistency < 0.3, 'six answers in one sitting is one day')
    let spread = newMastery('c1', NOW)
    for (let i = 0; i < 6; i += 1) spread = recordEvidence(spread, 'recalled', NOW + i * DAY)
    assert.equal(spread.scores.consistency, 1)
  })

  it('only counts a gap as retention when the answer was right', () => {
    let failed = newMastery('c1', NOW)
    failed = recordEvidence(failed, 'recalled', NOW)
    failed = recordEvidence(failed, 'recall-failed', NOW + 20 * DAY)
    assert.equal(failed.longestGapSurvived, 0, 'surviving a gap and then failing is not retention')
  })

  it('notices when something solid starts slipping', () => {
    let held = newMastery('c1', NOW)
    const good: EvidenceKind[] = ['read', 'explained', 'recalled', 'applied', 'quiz-right', 'taught-back', 'recalled', 'applied', 'recalled', 'quiz-right']
    good.forEach((kind, i) => {
      held = recordEvidence(held, kind, NOW + i * 2 * DAY)
    })
    assert.ok(['strong', 'stable', 'mastered'].includes(held.state), `was ${held.state}`)
    // Two wrong is a wobble; three in a row is a pattern.
    assert.notEqual(recordEvidence(recordEvidence(held, 'recall-failed', NOW + 30 * DAY), 'quiz-wrong', NOW + 31 * DAY).state, 'slipping')
    const turning: EvidenceKind[] = ['recall-failed', 'quiz-wrong', 'recall-failed']
    turning.forEach((kind, i) => {
      held = recordEvidence(held, kind, NOW + (30 + i) * DAY)
    })
    assert.equal(held.state, 'slipping', `state ${held.state}, recall ${held.scores.recall.toFixed(2)}, accuracy ${held.scores.accuracy.toFixed(2)}`)
  })

  it('lets something strong sit for longer than something barely learned', () => {
    const weak = feed(['read', 'recalled'])
    let strong = newMastery('c1', NOW)
    const kinds: EvidenceKind[] = ['read', 'explained', 'recalled', 'applied', 'taught-back', 'recalled', 'applied', 'quiz-right']
    kinds.forEach((kind, i) => {
      strong = recordEvidence(strong, kind, NOW + i * 3 * DAY)
    })
    const weakAllowed = decayed(weak, NOW + 5 * DAY).allowed
    const strongAllowed = decayed(strong, NOW + 30 * DAY).allowed
    assert.ok(strongAllowed > weakAllowed, `${strongAllowed} vs ${weakAllowed}`)
  })

  it('says how long since something was touched', () => {
    assert.equal(staleness(feed(['read']), NOW + 9 * DAY), 9)
  })

  it('refuses to call something weak when it has barely been tried', () => {
    const barely = feed(['read'])
    const found = weaknesses([barely], NOW)
    // Low confidence scales need down, so "barely tried" does not become a recommendation.
    assert.ok(found.length === 0 || found[0].need < 0.5, 'barely tried is not the same as weak')
  })

  it('names the dimension holding something back, so the fix is the right kind of work', () => {
    let held = newMastery('c1', NOW)
    const kinds: EvidenceKind[] = ['read', 'explained', 'explained', 'recalled', 'recall-failed', 'recall-failed', 'application-failed', 'application-failed', 'quiz-wrong']
    kinds.forEach((kind, i) => {
      held = recordEvidence(held, kind, NOW + i * DAY)
    })
    const found = weaknesses([held], NOW + 10 * DAY)
    assert.equal(found.length, 1)
    assert.ok(['recall', 'application', 'accuracy'].includes(found[0].weakest), found[0].weakest)
    assert.ok(found[0].why.length > 10)
  })

  it('shows strengths as well, with enough evidence behind them', () => {
    let held = newMastery('c1', NOW)
    const kinds: EvidenceKind[] = ['read', 'explained', 'recalled', 'applied', 'taught-back', 'recalled', 'applied', 'quiz-right', 'recalled', 'applied', 'taught-back']
    kinds.forEach((kind, i) => {
      held = recordEvidence(held, kind, NOW + i * 2 * DAY)
    })
    assert.equal(strengths([held]).length, 1, `overall ${overall(held).toFixed(2)}`)
    assert.equal(strengths([feed(['recalled'])]).length, 0, 'one answer is not a strength')
  })

  it('tells inconsistent apart from unknown', () => {
    let held = newMastery('c1', NOW)
    const kinds: EvidenceKind[] = ['read', 'explained', 'quiz-right', 'quiz-wrong', 'quiz-right', 'quiz-wrong', 'recalled', 'recall-failed']
    kinds.forEach((kind, i) => {
      held = recordEvidence(held, kind, NOW + i * DAY)
    })
    const found = confusions([held])
    assert.equal(found.length, 1, 'half right is the signature of confusion, not of ignorance')
  })

  it('will not pass a mastery proof on one kind of evidence', () => {
    let recallOnly = newMastery('c1', NOW)
    for (let i = 0; i < 8; i += 1) recallOnly = recordEvidence(recallOnly, 'recalled', NOW + i * DAY)
    const out = proof(recallOnly)
    assert.equal(out.passed, false)
    assert.match(out.missing, /problem you have not seen|teaching/i)
  })

  it('says mastery in words', () => {
    assert.match(describeMastery(newMastery('c1', NOW)), /Not started/)
    assert.match(describeMastery(feed(['read', 'recalled'])), /\d+%/)
  })
})

// ---------------------------------------------------------------- the graph

describe('what a subject is made of', () => {
  const graph: Graph = {
    chapters: [
      { id: 'ch1', name: 'Kinematics', subject: 'Physics', order: 0 },
      { id: 'ch2', name: 'Forces', subject: 'Physics', order: 1 }
    ],
    concepts: [
      { id: 'vel', name: 'Velocity', chapterId: 'ch1', requires: [], difficulty: 2, importance: 0.8, order: 0 },
      { id: 'acc', name: 'Acceleration', chapterId: 'ch1', requires: ['vel'], difficulty: 3, importance: 0.8, order: 1 },
      { id: 'proj', name: 'Projectile motion', chapterId: 'ch1', requires: ['acc', 'vec'], difficulty: 4, importance: 0.9, order: 2 },
      { id: 'vec', name: 'Vectors', chapterId: 'ch1', requires: [], difficulty: 3, importance: 0.7, order: 3 },
      { id: 'nlm', name: "Newton's laws", chapterId: 'ch2', requires: ['acc'], difficulty: 3, importance: 1, order: 0 }
    ]
  }

  it('reads the tree', () => {
    assert.deepEqual(subjectsOf(graph), ['Physics'])
    assert.equal(chaptersOf(graph, 'Physics').length, 2)
    assert.equal(conceptsIn(graph, 'ch1').length, 4)
  })

  it('walks prerequisites all the way down', () => {
    const under = allPrerequisites(graph, 'proj').map((one) => one.id).sort()
    assert.deepEqual(under, ['acc', 'vec', 'vel'])
  })

  it('does not hang on a syllabus with a loop in it', () => {
    const looped: Graph = {
      chapters: graph.chapters,
      concepts: [
        { id: 'a', name: 'A', chapterId: 'ch1', requires: ['b'], difficulty: 1, importance: 0.5, order: 0 },
        { id: 'b', name: 'B', chapterId: 'ch1', requires: ['a'], difficulty: 1, importance: 0.5, order: 1 }
      ]
    }
    assert.equal(allPrerequisites(looped, 'a').length, 1, 'b, and not a itself')
    assert.equal(pathThrough(looped, 'ch1').length, 2, 'and still produces an order')
  })

  it('says what finishing something unlocks', () => {
    assert.deepEqual(unlockedBy(graph, 'acc').map((one) => one.id).sort(), ['nlm', 'proj'])
  })

  it('finds the prerequisite holding something up, shallowest first', () => {
    const mastery = new Map<string, Mastery>([
      ['vel', feed(['read', 'recalled', 'recalled', 'applied'])],
      ['acc', feed(['read', 'recall-failed', 'recall-failed', 'quiz-wrong'])],
      ['vec', feed(['read', 'recalled', 'applied', 'recalled'])]
    ])
    const out = blockedBy(graph, 'proj', mastery)
    assert.equal(out.blockers[0]?.concept.id, 'acc', 'the thing directly underneath, not the root')
  })

  it('tells "never tried" apart from "weak"', () => {
    const mastery = new Map<string, Mastery>([['acc', feed(['read', 'explained', 'recalled', 'applied', 'recalled', 'taught-back'])]])
    const out = blockedBy(graph, 'proj', mastery)
    assert.equal(out.blockers.length, 0)
    // Vectors and velocity are both untouched: neither is weak, they simply have not been started.
    assert.deepEqual(out.untouched.map((one) => one.id).sort(), ['vec', 'vel'])
  })

  it('sends somebody to the foundation instead of the thing they asked for', () => {
    const mastery = new Map<string, Mastery>([['acc', feed(['read', 'recall-failed', 'quiz-wrong', 'quiz-wrong'])], ['vec', feed(['read', 'recalled', 'applied', 'recalled'])]])
    const out = readyFor(graph, 'proj', mastery)
    assert.equal(out.ready, false)
    assert.equal(out.instead?.id, 'acc')
    assert.match(out.why, /comes first|shoring up/)
  })

  it('says ready when the foundation is there', () => {
    const good = feed(['read', 'explained', 'recalled', 'applied', 'recalled', 'taught-back'])
    const mastery = new Map<string, Mastery>([['vel', good], ['acc', good], ['vec', good]])
    assert.equal(readyFor(graph, 'proj', mastery).ready, true)
  })

  it('orders a chapter with prerequisites before the things that need them', () => {
    const order = pathThrough(graph, 'ch1').map((one) => one.id)
    assert.ok(order.indexOf('vel') < order.indexOf('acc'))
    assert.ok(order.indexOf('acc') < order.indexOf('proj'))
    assert.ok(order.indexOf('vec') < order.indexOf('proj'))
  })

  it('counts an untouched concept as zero rather than leaving it out', () => {
    const mastery = new Map<string, Mastery>([['vel', feed(['read', 'recalled', 'applied', 'recalled', 'taught-back'])]])
    const out = chapterProgress(graph, 'ch1', mastery)
    assert.equal(out.concepts, 4)
    assert.equal(out.started, 1)
    assert.equal(out.untouched, 3)
    assert.ok(out.score < 0.3, 'a chapter is not 80% done because the one topic opened went well')
  })

  it('rolls progress up to the subject, and builds the whole tree', () => {
    const mastery = new Map<string, Mastery>([['vel', feed(['read', 'recalled'])]])
    assert.ok(subjectProgress(graph, 'Physics', mastery).concepts === 5)
    const shape = tree(graph, mastery)
    assert.equal(shape[0].subject, 'Physics')
    assert.equal(shape[0].chapters.length, 2)
    assert.equal(shape[0].chapters[0].concepts.length, 4)
  })
})

describe('reading a syllabus', () => {
  it('reads indentation as the tree', () => {
    const { graph } = readSyllabus('Physics\n  Kinematics\n    Velocity\n    Acceleration\n  Forces\n    Newton’s laws', NOW)
    assert.deepEqual(subjectsOf(graph), ['Physics'])
    assert.equal(graph.chapters.length, 2)
    assert.equal(graph.concepts.length, 3)
  })

  it('copes with bullets and numbering', () => {
    const { graph } = readSyllabus('Physics\n  - Kinematics\n    1. Velocity\n    2) Acceleration', NOW)
    assert.equal(graph.concepts.length, 2)
    assert.equal(graph.concepts[0].name, 'Velocity')
  })

  it('reports what it could not place rather than dropping it', () => {
    const { skipped } = readSyllabus('  Kinematics\n    Velocity', NOW)
    assert.ok(skipped.length > 0, 'a chapter with no subject above it is reported')
  })

  it('gives a stray concept a chapter instead of losing it', () => {
    const { graph } = readSyllabus('Physics\n    Velocity', NOW)
    assert.equal(graph.concepts.length, 1)
    assert.equal(graph.chapters.length, 1)
  })

  it('invents nothing', () => {
    const { graph } = readSyllabus('Physics\n  Kinematics\n    Velocity', NOW)
    assert.deepEqual(graph.concepts[0].requires, [], 'prerequisites are the student’s to say')
  })

  it('merges a second subject without losing the first', () => {
    const first = readSyllabus('Physics\n  Kinematics\n    Velocity', NOW).graph
    const second = readSyllabus('Chemistry\n  Bonding\n    Ionic', NOW).graph
    const both = merge(first, second)
    assert.deepEqual(subjectsOf(both), ['Chemistry', 'Physics'])
    assert.equal(both.concepts.length, 2)
  })

  it('does not duplicate when the same syllabus is read twice', () => {
    const one = readSyllabus('Physics\n  Kinematics\n    Velocity', NOW).graph
    const again = readSyllabus('Physics\n  Kinematics\n    Velocity', NOW).graph
    assert.equal(merge(one, again).concepts.length, 1)
  })

  it('reads nothing from nothing', () => {
    assert.deepEqual(readSyllabus('', NOW).graph, emptyGraph())
  })
})

// ---------------------------------------------------------------- the planner

describe('planning a day', () => {
  const graph: Graph = {
    chapters: [
      { id: 'ch1', name: 'Kinematics', subject: 'Physics', order: 0 },
      { id: 'ch2', name: 'Bonding', subject: 'Chemistry', order: 0 }
    ],
    concepts: [
      { id: 'vel', name: 'Velocity', chapterId: 'ch1', requires: [], difficulty: 2, importance: 0.8, order: 0 },
      { id: 'acc', name: 'Acceleration', chapterId: 'ch1', requires: [], difficulty: 3, importance: 0.8, order: 1 },
      { id: 'ionic', name: 'Ionic bonds', chapterId: 'ch2', requires: [], difficulty: 2, importance: 0.7, order: 0 }
    ]
  }

  const availability = (minutes: number): Availability => ({ minutes: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((i) => [shiftDay(TODAY, i), minutes])), longestSession: 50, breakMinutes: 10 })

  const input = (patch: Partial<PlanInput> = {}): PlanInput => ({
    graph,
    mastery: new Map([['vel', feed(['read', 'recall-failed', 'quiz-wrong', 'recalled'], NOW - 20 * DAY)]]),
    availability: availability(90),
    exams: [],
    deadlines: [],
    subjects: ['Physics', 'Chemistry'],
    lastStudied: { Physics: NOW - DAY },
    now: NOW,
    ...patch
  })

  it('never plans more minutes than there are', () => {
    const plan = planDay(input({ availability: availability(45) }), TODAY)
    assert.ok(plan.minutes <= 45, `planned ${plan.minutes} into 45`)
  })

  it('says what it left out rather than stacking it up', () => {
    const plan = planDay(input({ availability: availability(15) }), TODAY)
    assert.ok(plan.leftOut.length > 0)
    assert.ok(plan.leftOut.every((one) => one.why.length > 5))
  })

  it('plans nothing for a day with no time, and says so', () => {
    const plan = planDay(input({ availability: { minutes: {}, longestSession: 50, breakMinutes: 10 } }), TODAY)
    assert.equal(plan.items.length, 0)
    assert.match(plan.note, /No time set aside/)
  })

  it('never makes a session longer than the student asked to sit for', () => {
    const plan = planDay(input({ availability: { ...availability(180), longestSession: 25 } }), TODAY)
    assert.ok(plan.items.filter((one) => one.kind !== 'break').every((one) => one.minutes <= 25))
  })

  it('puts a break in once there has been a real stretch of work', () => {
    const plan = planDay(input({ availability: availability(180) }), TODAY)
    assert.ok(plan.items.some((one) => one.kind === 'break'))
  })

  it('does not let one subject take a whole day when there is something else', () => {
    const plan = planDay(input({ availability: availability(240) }), TODAY)
    const bySubject = new Map<string, number>()
    for (const one of plan.items) if (one.subject) bySubject.set(one.subject, (bySubject.get(one.subject) ?? 0) + one.minutes)
    const total = [...bySubject.values()].reduce((sum, one) => sum + one, 0)
    for (const [, minutes] of bySubject) assert.ok(minutes <= total * 0.8, 'one subject did not eat the day')
  })

  it('gives every item a reason the student could check', () => {
    const plan = planDay(input(), TODAY)
    for (const one of plan.items.filter((x) => x.kind !== 'break')) {
      assert.ok(one.because.length > 5, `no reason on ${one.title}`)
    }
  })

  it('does not plan the same thing twice across days', () => {
    const days = planAhead(input(), 3)
    const seen = new Set<string>()
    for (const day of days) {
      for (const one of day.items.filter((x) => x.kind !== 'break')) {
        const key = `${one.kind}|${one.title}|${one.conceptId ?? ''}`
        assert.ok(!seen.has(key), `${one.title} planned twice`)
        seen.add(key)
      }
    }
  })

  it('turns an exam near the date into revision rather than new material', () => {
    const soon = input({ exams: [{ id: 'e1', name: 'Physics test', day: shiftDay(TODAY, 1), subjects: ['Physics'], chapterIds: [], importance: 1 }] })
    const found = candidates(soon).filter((one) => one.forId === 'e1')
    assert.ok(found.length > 0)
    assert.ok(found.every((one) => one.kind === 'mock' || one.kind === 'revise'), found.map((one) => one.kind).join(','))
  })

  it('treats something stale as worth revisiting, with the days in the reason', () => {
    const found = candidates(input()).find((one) => one.kind === 'revise' && one.conceptId === 'vel')
    assert.ok(found, 'a concept untouched for twenty days is due')
    assert.match(found?.because ?? '', /\d+ days? ago/)
  })

  it('is modest about a subject merely being old', () => {
    const neglected = candidates(input({ lastStudied: { Physics: NOW - DAY, Chemistry: NOW - 20 * DAY } })).find((one) => one.subject === 'Chemistry' && /Not touched/.test(one.because))
    assert.ok(neglected)
    assert.ok((neglected?.value ?? 1) < 0.6, 'being old is not the same as being important')
  })
})

describe('when a day did not happen', () => {
  const graph: Graph = {
    chapters: [{ id: 'ch1', name: 'Kinematics', subject: 'Physics', order: 0 }],
    concepts: [{ id: 'vel', name: 'Velocity', chapterId: 'ch1', requires: [], difficulty: 2, importance: 0.8, order: 0 }]
  }
  const base: PlanInput = {
    graph,
    mastery: new Map([['vel', feed(['read', 'recall-failed'], NOW - 30 * DAY)]]),
    availability: { minutes: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((i) => [shiftDay(TODAY, i), 60])), longestSession: 50, breakMinutes: 10 },
    exams: [],
    deadlines: [],
    subjects: ['Physics'],
    lastStudied: { Physics: NOW - 5 * DAY },
    now: NOW
  }

  it('does not pile yesterday on top of today', () => {
    const missed = planDay(base, shiftDay(TODAY, -1)).items
    const out = replan(base, missed, 5)
    const today = out.days[0]
    assert.ok(today.minutes <= 60, `today is still ${today.minutes} minutes, not a backlog`)
  })

  it('names what it is letting go of', () => {
    const missed = [
      { id: 'x', kind: 'practice' as const, minutes: 45, subject: 'Physics', chapterId: null, conceptId: null, title: 'Something that will not fit', because: '', value: 0.1, forId: null, state: 'planned' as const }
    ]
    const out = replan({ ...base, availability: { minutes: { [TODAY]: 10 }, longestSession: 50, breakMinutes: 0 } }, missed, 1)
    assert.ok(out.dropped.length > 0)
    assert.ok(out.dropped.every((one) => one.why.length > 5))
  })

  it('says it without blame', () => {
    const out = replan(base, planDay(base, shiftDay(TODAY, -1)).items, 5)
    assert.ok(!/fail|behind|should have|lazy|missed again/i.test(out.note), out.note)
  })

  it('is honest when a recovery cannot fit', () => {
    const tight = { ...base, availability: { minutes: { [TODAY]: 20 }, longestSession: 20, breakMinutes: 0 } }
    const out = recovery(tight, shiftDay(TODAY, 1))
    assert.ok(out.total === 0 || out.covered <= out.total)
    if (out.total > out.covered) assert.match(out.honest, /not going to fit|left out/i)
  })

  it('offers something tiny rather than nothing', () => {
    const out = shortPlan(base, 5)
    assert.ok(out.items.length >= 1)
    assert.ok(out.items.reduce((sum, one) => sum + one.minutes, 0) <= 5)
    assert.match(out.note, /Not a replacement/i)
  })

  it('does not pretend a short session is a real one', () => {
    assert.match(shortPlan(base, 10).note, /Not a replacement for a real session/)
  })
})

describe('what is coming', () => {
  const graph: Graph = {
    chapters: [{ id: 'ch1', name: 'Kinematics', subject: 'Physics', order: 0 }],
    concepts: [{ id: 'vel', name: 'Velocity', chapterId: 'ch1', requires: [], difficulty: 2, importance: 0.8, order: 0 }]
  }
  const base: PlanInput = {
    graph,
    mastery: new Map(),
    availability: { minutes: {}, longestSession: 50, breakMinutes: 10 },
    exams: [
      { id: 'ready', name: 'Ready exam', day: shiftDay(TODAY, 4), subjects: ['Physics'], chapterIds: [], importance: 1 },
      { id: 'notready', name: 'Unprepared exam', day: shiftDay(TODAY, 9), subjects: ['Physics'], chapterIds: [], importance: 1 }
    ],
    deadlines: [],
    subjects: ['Physics'],
    lastStudied: {},
    now: NOW
  }

  it('orders by how much is left over how long there is, not by date alone', () => {
    const prepared = new Map<string, Mastery>([['vel', feed(['read', 'explained', 'recalled', 'applied', 'taught-back', 'recalled'])]])
    const out = radar({ ...base, mastery: prepared, exams: [base.exams[0]] })
    assert.equal(out.length, 1)
    assert.ok((out[0].ready ?? 0) > 0.4, 'readiness comes from the mastery underneath')
  })

  it('says how ready something looks, from the mastery underneath it', () => {
    const out = radar(base)
    assert.ok(out.every((one) => one.note.length > 5))
    // Nothing has been studied, so it reports nought per cent rather than claiming it cannot tell.
    assert.ok(out.every((one) => /\d+% of the material/.test(one.note)), out[0]?.note)
  })

  it('says there is nothing to measure when the exam covers no concepts', () => {
    const bare = radar({ ...base, graph: { chapters: [], concepts: [] } })
    assert.ok(bare.some((one) => /Nothing to measure/.test(one.note)))
  })

  it('leaves out an exam that has passed', () => {
    const out = radar({ ...base, exams: [{ id: 'gone', name: 'Last week', day: shiftDay(TODAY, -3), subjects: ['Physics'], chapterIds: [], importance: 1 }] })
    assert.equal(out.length, 0)
  })
})

// ---------------------------------------------------------------- the decision engine

describe('one best action', () => {
  const graph: Graph = {
    chapters: [{ id: 'ch1', name: 'Kinematics', subject: 'Physics', order: 0 }],
    concepts: [{ id: 'vel', name: 'Velocity', chapterId: 'ch1', requires: [], difficulty: 2, importance: 0.8, order: 0 }]
  }

  const session = (patch: Partial<FocusSession> = {}): FocusSession => ({
    ...newSession(
      {
        id: 's1',
        profileId: 'p1',
        title: 'Kinematics',
        subject: 'Physics',
        taskId: null,
        goalId: null,
        milestoneId: null,
    conceptId: null,
        intention: '',
        oneThing: '',
        level: 'focus',
        policy: snapshotPolicy({ level: 'focus' }),
        breaks: DEFAULT_BREAKS,
        plannedMinutes: 50,
        atmosphere: null,
        playlistId: null,
        capsuleId: null,
        spaceId: null
      },
      NOW,
      1000
    ),
    ...patch
  })

  const input = (patch: Partial<DecideInput> = {}): DecideInput => ({
    graph,
    mastery: new Map([['vel', feed(['read', 'recall-failed', 'quiz-wrong'], NOW - 20 * DAY)]]),
    availability: { minutes: { [TODAY]: 90 }, longestSession: 50, breakMinutes: 10 },
    exams: [],
    deadlines: [],
    subjects: ['Physics'],
    lastStudied: { Physics: NOW - DAY },
    now: NOW,
    session: null,
    busy: { typing: false, reading: false, quizzing: false, waitingOnOrion: false },
    tasks: [],
    daysAway: 0,
    today: { focusedSeconds: 0, sessions: 0, completed: 0, plannedMinutes: 0 },
    record: null,
    tabs: [],
    interrupted: null,
    log: newLog(TODAY),
    quietHours: null,
    paused: false,
    idleMinutes: 10,
    ...patch
  })

  it('says nothing while somebody is typing', () => {
    assert.equal(decide(input({ busy: { typing: true, reading: false, quizzing: false, waitingOnOrion: false } })).decision, 'no-action')
  })

  it('says nothing while waiting on Orion', () => {
    assert.equal(decide(input({ busy: { typing: false, reading: false, quizzing: false, waitingOnOrion: true } })).decision, 'no-action')
  })

  it('says nothing mid-session', () => {
    assert.equal(decide(input({ session: session({ focusedSeconds: 600 }) })).decision, 'no-action')
  })

  it('says nothing on a break, or paused, or recovering', () => {
    for (const state of ['break', 'paused', 'recovering'] as const) {
      assert.equal(decide(input({ session: session({ state, focusedSeconds: 600 }) })).decision, 'no-action', state)
    }
  })

  it('says nothing when Orbi has been paused', () => {
    assert.equal(decide(input({ paused: true })).decision, 'no-action')
  })

  it('says nothing inside quiet hours', () => {
    const lateNight = new Date(2026, 9, 3, 23, 30).getTime()
    assert.equal(decide(input({ now: lateNight, quietHours: { from: 22, to: 7 } })).decision, 'no-action', 'a window across midnight is still a window')
    const morning = new Date(2026, 9, 3, 6, 0).getTime()
    assert.equal(decide(input({ now: morning, quietHours: { from: 22, to: 7 } })).decision, 'no-action')
  })

  it('still offers a break mid-session when one is genuinely due', () => {
    const out = decide(input({ session: session({ focusedSeconds: 55 * 60 }) }))
    assert.equal(out.decision, 'take-break')
    assert.equal(out.actions[0].id, 'break')
  })

  it('picks up an unfinished session before anything else', () => {
    const out = decide(input({ interrupted: session({ focusedSeconds: 900 }), daysAway: 9, exams: [{ id: 'e', name: 'Exam', day: TODAY, subjects: ['Physics'], chapterIds: [], importance: 1 }] }))
    assert.equal(out.decision, 'restore-session')
    assert.equal(out.priority, 'critical')
  })

  it('returns exactly one intervention, never a list', () => {
    const out = decide(input({ exams: [{ id: 'e', name: 'Test', day: shiftDay(TODAY, 3), subjects: ['Physics'], chapterIds: [], importance: 1 }], tasks: [], tabs: new Array(20).fill({ url: 'https://x', title: 'x' }) }))
    assert.notEqual(out.decision, 'no-action')
    assert.ok(out.title.length > 0)
    assert.ok(out.actions.length >= 1)
  })

  it('gives a reason with every intervention', () => {
    const out = decide(input())
    if (out.decision !== 'no-action') assert.ok(out.because.length > 5, out.decision)
  })

  it('welcomes somebody back without mentioning what they lost', () => {
    const out = decide(input({ daysAway: 9 }))
    assert.equal(out.decision, 'comeback')
    assert.ok(!/streak|lost|failed|missed/i.test(`${out.title} ${out.because}`), `${out.title} / ${out.because}`)
    assert.ok(out.actions.some((one) => one.id === 'short'), 'and it leads somewhere small')
  })

  it('says that is enough for today when the plan is done', () => {
    const out = decide(input({ today: { focusedSeconds: 70 * 60, sessions: 2, completed: 2, plannedMinutes: 60 } }))
    assert.equal(out.decision, 'good-stop')
  })

  it('stops once the day’s budget is gone', () => {
    let log = newLog(TODAY)
    for (let i = 0; i < 8; i += 1) log = logIntervention(log, 'motivate', 'shown', NOW, 'normal')
    assert.ok(log.spent > DAILY_BUDGET)
    assert.equal(decide(input({ log })).decision, 'no-action')
  })

  it('lets a critical thing through even then', () => {
    let log = newLog(TODAY)
    for (let i = 0; i < 8; i += 1) log = logIntervention(log, 'motivate', 'shown', NOW, 'normal')
    assert.equal(decide(input({ log, interrupted: session({ focusedSeconds: 900 }) })).decision, 'restore-session')
  })

  it('does not repeat the same decision immediately', () => {
    const first = decide(input())
    if (first.decision === 'no-action') return
    const log = logIntervention(newLog(TODAY), first.decision, 'shown', NOW, first.priority)
    const second = decide(input({ log, now: NOW + 60_000 }))
    assert.notEqual(second.decision, first.decision)
  })

  it('learns from what gets dismissed, but not from two dismissals', () => {
    let log = newLog(TODAY)
    assert.equal(reception(log, 'motivate'), 1, 'no evidence means no adjustment')
    for (let i = 0; i < 2; i += 1) {
      log = logIntervention(log, 'motivate', 'shown', NOW, 'low')
      log = logIntervention(log, 'motivate', 'dismissed', NOW, 'low')
    }
    assert.equal(reception(log, 'motivate'), 1, 'two is still not enough')
    for (let i = 0; i < 6; i += 1) {
      log = logIntervention(log, 'motivate', 'shown', NOW, 'low')
      log = logIntervention(log, 'motivate', 'dismissed', NOW, 'low')
    }
    assert.ok(reception(log, 'motivate') < 1, 'repeatedly dismissed is scaled down')
    assert.ok(reception(log, 'motivate') >= 0.35, 'and never to nothing')
  })

  it('scales up what gets accepted, within bounds', () => {
    let log = newLog(TODAY)
    for (let i = 0; i < 8; i += 1) {
      log = logIntervention(log, 'start-revision', 'shown', NOW, 'normal')
      log = logIntervention(log, 'start-revision', 'accepted', NOW, 'normal')
    }
    assert.ok(reception(log, 'start-revision') > 1)
    assert.ok(reception(log, 'start-revision') <= 1.5)
  })

  it('answers freely when the student came looking', () => {
    // The dashboard is not an interruption, so neither the budget nor quiet hours apply.
    let log = newLog(TODAY)
    for (let i = 0; i < 10; i += 1) log = logIntervention(log, 'motivate', 'shown', NOW, 'normal')
    const out = recommend(input({ log, quietHours: { from: 0, to: 23 } }))
    assert.notEqual(out.decision, 'no-action')
  })
})

describe('whether Orbi appears by itself', () => {
  const graph: Graph = {
    chapters: [{ id: 'ch1', name: 'Kinematics', subject: 'Physics', order: 0 }],
    concepts: [{ id: 'vel', name: 'Velocity', chapterId: 'ch1', requires: [], difficulty: 2, importance: 0.8, order: 0 }]
  }
  const input = (patch: Partial<DecideInput> = {}): DecideInput => ({
    graph,
    mastery: new Map([['vel', feed(['read', 'recall-failed', 'quiz-wrong'], NOW - 20 * DAY)]]),
    availability: { minutes: { [TODAY]: 90 }, longestSession: 50, breakMinutes: 10 },
    exams: [],
    deadlines: [],
    subjects: ['Physics'],
    lastStudied: { Physics: NOW - DAY },
    now: NOW,
    session: null,
    busy: { typing: false, reading: false, quizzing: false, waitingOnOrion: false },
    tasks: [],
    daysAway: 4,
    today: { focusedSeconds: 0, sessions: 0, completed: 0, plannedMinutes: 0 },
    record: null,
    tabs: [],
    interrupted: null,
    log: newLog(TODAY),
    quietHours: null,
    paused: false,
    idleMinutes: 20,
    ...patch
  })

  it('does not appear during a session', () => {
    assert.equal(shouldAppear(input({ session: {} as FocusSession }), [14]).appear, false)
  })

  it('does not appear while somebody is reading or typing', () => {
    assert.equal(shouldAppear(input({ busy: { typing: false, reading: true, quizzing: false, waitingOnOrion: false } }), [14]).appear, false)
  })

  it('does not appear at an hour they never study', () => {
    const out = shouldAppear(input(), [8, 9, 20])
    assert.equal(out.appear, false)
    assert.match(out.why, /not a time they study/)
  })

  it('does appear at an hour they do, when there is something worth saying', () => {
    assert.equal(shouldAppear(input(), [13, 14, 15]).appear, true)
  })

  it('does not appear for something trivial', () => {
    const out = shouldAppear(input({ daysAway: 0, mastery: new Map(), lastStudied: { Physics: NOW } }), [13, 14, 15])
    assert.equal(out.appear, false)
    assert.match(out.why, /nothing worth saying|not worth appearing/)
  })

  it('will not guess the hours from a handful of sessions', () => {
    assert.deepEqual(usualHours([{ startedAt: NOW, focusedSeconds: 1800 }, { startedAt: NOW, focusedSeconds: 1800 }]), [], 'two sessions is not a habit')
  })

  it('reads the hours off real sessions once there are enough', () => {
    const sessions = Array.from({ length: 8 }, (_, i) => ({ startedAt: new Date(2026, 9, 1 + i, 19, 0).getTime(), focusedSeconds: 1800 }))
    assert.deepEqual(usualHours(sessions), [19])
  })

  it('ignores sessions too short to mean anything', () => {
    const sessions = Array.from({ length: 8 }, (_, i) => ({ startedAt: new Date(2026, 9, 1 + i, 19, 0).getTime(), focusedSeconds: 30 }))
    assert.deepEqual(usualHours(sessions), [])
  })
})

// ---------------------------------------------------------------- missions

describe('turning work into something startable', () => {
  const concept = { id: 'proj', name: 'Projectile motion', chapterId: 'ch1', requires: [], difficulty: 4, importance: 0.9, order: 0 }

  it('adds up to exactly the minutes on the button', () => {
    for (const minutes of [5, 12, 25, 50, 90]) {
      const mission = missionFor(concept, feed(['read', 'recalled']), minutes, NOW, 'Physics')
      assert.equal(mission.minutes, minutes, `asked for ${minutes}, planned ${mission.minutes}`)
      assert.ok(mission.steps.every((one) => one.minutes >= 1))
    }
  })

  it('shapes the steps around what is actually missing', () => {
    const neverMet = missionFor(concept, null, 30, NOW, 'Physics')
    assert.match(neverMet.because, /new/i)
    assert.equal(neverMet.steps[0].proves, 'exposure')

    let cannotRecall = newMastery('proj', NOW)
    for (const kind of ['read', 'explained', 'explained', 'recall-failed'] as EvidenceKind[]) cannotRecall = recordEvidence(cannotRecall, kind, NOW)
    const recallMission = missionFor(concept, cannotRecall, 30, NOW, 'Physics')
    assert.ok(recallMission.steps.some((one) => one.proves === 'recall'))
    assert.match(recallMission.because, /memory|settled/i)

    // Understanding and recall both established, so what is left is using it.
    let cannotApply = newMastery('proj', NOW)
    for (const kind of ['read', 'explained', 'explained', 'taught-back', 'recalled', 'recalled', 'recalled', 'application-failed', 'application-failed'] as EvidenceKind[]) {
      cannotApply = recordEvidence(cannotApply, kind, NOW)
    }
    const applyMission = missionFor(concept, cannotApply, 30, NOW, 'Physics')
    assert.ok(applyMission.steps.some((one) => one.proves === 'application'))
  })

  it('gives every step an instruction, not a category', () => {
    const mission = missionFor(concept, feed(['read']), 25, NOW, 'Physics')
    for (const step of mission.steps) {
      assert.ok(step.label.length > 8, step.label)
      assert.ok(!/^(recall|practice|read|revise)$/i.test(step.label), 'a category is not an instruction')
    }
  })

  it('tracks what is left', () => {
    let mission = missionFor(concept, feed(['read']), 30, NOW, 'Physics')
    const first = mission.steps[0]
    mission = finishStep(mission, first.id)
    const out = progressOf(mission)
    assert.equal(out.done, 1)
    assert.equal(out.next?.id, mission.steps[1].id)
    assert.ok(out.minutesLeft < mission.minutes)
  })

  it('is done when every step is', () => {
    let mission = missionFor(concept, feed(['read']), 15, NOW, 'Physics')
    for (const step of mission.steps) mission = finishStep(mission, step.id)
    assert.equal(mission.state, 'done')
  })

  it('can be halved for somebody who keeps abandoning it', () => {
    const mission = missionFor(concept, feed(['read']), 40, NOW, 'Physics')
    const small = smaller(mission)
    assert.ok(small)
    assert.ok((small?.minutes ?? 99) < mission.minutes)
    assert.ok(!/try harder|discipline/i.test(small?.because ?? ''))
  })

  it('will not halve something already tiny', () => {
    assert.equal(smaller(microFor(concept, null, NOW)), null)
  })

  it('offers something tiny chosen for what is weakest', () => {
    const micro = microFor(concept, null, NOW)
    assert.equal(micro.steps.length, 1)
    assert.ok(micro.minutes <= 5)
    assert.ok(MICRO.some((one) => micro.title.includes(one.label)))
  })

  it('turns a finished step into the right kind of evidence', () => {
    const mission = missionFor(concept, feed(['read']), 20, NOW, 'Physics')
    const recall = mission.steps.find((one) => one.proves === 'recall')
    if (recall) {
      assert.equal(evidenceFrom(recall, true), 'recalled')
      assert.equal(evidenceFrom(recall, false), 'recall-failed')
    }
    const reading = mission.steps.find((one) => one.proves === 'exposure')
    if (reading) assert.equal(evidenceFrom(reading, true), 'read')
  })
})

describe('what running it against the real app found', () => {
  it('says something is slipping even after the wrong answers have dragged the score down', () => {
    // Five right, then three wrong in a row. The score is low *because of* the run, which is the whole point.
    let held = newMastery('c', 0)
    for (const kind of ['recalled', 'applied', 'recalled', 'applied', 'taught-back'] as const) held = recordEvidence(held, kind, 0)
    for (let i = 0; i < 3; i += 1) held = recordEvidence(held, 'recall-failed', 0)
    assert.equal(held.state, 'slipping')
  })

  it('does not call something slipping that was never answered right', () => {
    let held = newMastery('c', 0)
    for (let i = 0; i < 4; i += 1) held = recordEvidence(held, 'recall-failed', 0)
    assert.notEqual(held.state, 'slipping')
  })

  it('gives the same syllabus the same ids twice, so re-importing adds nothing', () => {
    const text = ['Physics', '  Kinematics', '    Velocity'].join('\n')
    const first = readSyllabus(text, 1000)
    const second = readSyllabus(text, 9_999_999)
    assert.deepEqual(
      first.graph.concepts.map((one) => one.id),
      second.graph.concepts.map((one) => one.id)
    )
    const merged = merge(first.graph, second.graph)
    assert.equal(merged.concepts.length, 1)
  })
})

