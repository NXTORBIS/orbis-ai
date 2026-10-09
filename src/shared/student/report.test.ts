import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { reportFor } from './report.ts'
import { insideQuietHours } from './decide.ts'
import { newMastery, record as recordEvidence, type Mastery } from './mastery.ts'
import { dayKey, shiftDay } from './days.ts'
import type { FocusSession, StudentTask, XPEvent } from './types.ts'

/**
 * The report engine.
 *
 * The tests that matter here are the ones about *refusing* to say things: a span with two sessions in it must not
 * produce a sentence about how somebody studies, and a count of days studied must never be dressed up as a score.
 */

const NOW = Date.UTC(2026, 4, 20, 18, 0, 0)

const at = (daysAgo: number, hour = 10): number => {
  const d = new Date(NOW)
  d.setDate(d.getDate() - daysAgo)
  d.setHours(hour, 0, 0, 0)
  return d.getTime()
}

const session = (daysAgo: number, minutes: number, extra: Partial<FocusSession> = {}): FocusSession =>
  ({
    id: `s${daysAgo}-${minutes}-${extra.subject ?? ''}`,
    profileId: 'p',
    state: 'completed',
    title: 'Focus',
    subject: 'Physics',
    taskId: null,
    goalId: null,
    milestoneId: null,
    conceptId: null,
    intention: '',
    oneThing: '',
    level: 'focus',
    policy: { level: 'focus', blocked: [], approved: [], approvedCategories: [], blockedSites: [], locked: false, youtube: 'off', approvedVideos: [], approvedChannels: [] },
    breaks: { every: 25, breakMinutes: 5, auto: false },
    plannedMinutes: minutes,
    startedAt: at(daysAgo),
    startedMono: null,
    endedAt: at(daysAgo) + minutes * 60_000,
    focusedSeconds: minutes * 60,
    breakSeconds: 0,
    breakNow: 0,
    log: [],
    milestonesHit: [],
    interruptions: 0,
    distractionAttempts: 0,
    savedForLater: 0,
    orionTurns: 0,
    xpAwarded: 0,
    journal: '',
    settled: true,
    createdAt: at(daysAgo),
    updatedAt: at(daysAgo),
    ...extra
  }) as FocusSession

const empty = { sessions: [] as FocusSession[], xp: [] as XPEvent[], tasks: [] as StudentTask[], mastery: new Map<string, Mastery>() }

describe('the week and the month', () => {
  it('says there is nothing to report rather than reporting nothing', () => {
    const out = reportFor('week', NOW, empty)
    assert.equal(out.thin, true)
    assert.equal(out.sessions, 0)
    assert.match(out.notes[0], /nothing to report/i)
  })

  it('refuses to talk about trends off two sessions', () => {
    const out = reportFor('week', NOW, { ...empty, sessions: [session(1, 30), session(2, 30)] })
    assert.equal(out.thin, true)
    assert.equal(out.notes.length, 1)
    assert.match(out.notes[0], /too little/i)
  })

  it('counts only the sessions inside the span', () => {
    const out = reportFor('week', NOW, { ...empty, sessions: [session(1, 30), session(3, 30), session(20, 60), session(40, 60)] })
    assert.equal(out.sessions, 2)
    assert.equal(out.focusedSeconds, 3600)
  })

  it('counts days studied, and never presents it as a score', () => {
    // Four sessions, two of them on the same day: three days, not four.
    const out = reportFor('week', NOW, {
      ...empty,
      sessions: [session(1, 30), { ...session(1, 20), id: 'extra' }, session(2, 30), session(4, 30)]
    })
    assert.equal(out.daysStudied, 3)
    assert.equal(out.days, 7)
    assert.ok(!out.notes.join(' ').includes('/7'))
    assert.ok(!/out of/i.test(out.notes.join(' ')))
  })

  it('does not report an hour of day off too few sessions, and does off enough', () => {
    const few = reportFor('week', NOW, { ...empty, sessions: [session(1, 30), session(2, 30), session(3, 30)] })
    assert.deepEqual(few.bestHours, [])
    const many = reportFor('month', NOW, {
      ...empty,
      sessions: [1, 2, 3, 4, 5, 6].map((daysAgo) => ({ ...session(daysAgo, 30), startedAt: at(daysAgo, 16), id: `h${daysAgo}` }))
    })
    assert.ok(many.bestHours.includes(16))
  })

  it('splits the time by subject, as shares of what was actually done', () => {
    const out = reportFor('week', NOW, {
      ...empty,
      sessions: [session(1, 60), session(2, 30, { subject: 'Maths', id: 'm1' }), session(3, 30, { subject: 'Maths', id: 'm2' })]
    })
    assert.equal(out.subjects[0].subject, 'Physics')
    assert.equal(out.subjects[0].share, 0.5)
    assert.equal(out.subjects[1].seconds, 3600)
  })

  it('compares with the span before only when there is one to compare with', () => {
    const alone = reportFor('week', NOW, { ...empty, sessions: [session(1, 40), session(2, 40), session(3, 40)] })
    assert.equal(alone.before, null)
    const both = reportFor('week', NOW, {
      ...empty,
      sessions: [session(1, 40), session(2, 40), session(3, 40), session(9, 20), session(10, 20), session(11, 20)]
    })
    assert.ok(both.before && both.before.sessions === 3)
    assert.match(both.notes.join(' '), /more than the week before/i)
  })

  it('says a quieter span as a fact, with no blame in it', () => {
    const out = reportFor('week', NOW, {
      ...empty,
      sessions: [session(1, 20), session(2, 20), session(3, 20), session(9, 90), session(10, 90), session(11, 90)]
    })
    const words = out.notes.join(' ')
    assert.match(words, /less than the week before/i)
    assert.ok(!/should|failed|only managed|slacking|behind/i.test(words))
  })

  it('counts a session that was ended early, and does not scold about it', () => {
    const out = reportFor('week', NOW, {
      ...empty,
      sessions: [session(1, 30, { state: 'ended-early' }), session(2, 30), session(3, 30)]
    })
    assert.equal(out.endedEarly, 1)
    assert.equal(out.sessions, 3)
    assert.ok(!/gave up|quit|abandoned/i.test(out.notes.join(' ')))
  })

  it('ignores a session too short to have been anything', () => {
    const out = reportFor('week', NOW, { ...empty, sessions: [{ ...session(1, 30), focusedSeconds: 100 }, session(2, 30), session(3, 30)] })
    assert.equal(out.sessions, 2)
  })

  it('lists what was worked on inside the span, and what is slipping whenever it is', () => {
    let fresh = newMastery('c1', at(2))
    for (const kind of ['recalled', 'applied', 'taught-back'] as const) fresh = recordEvidence(fresh, kind, at(2))
    let old = newMastery('c2', at(40))
    old = recordEvidence(old, 'read', at(40))
    const mastery = new Map([
      ['c1', fresh],
      ['c2', old]
    ])
    const out = reportFor('week', NOW, { ...empty, sessions: [session(1, 30), session(2, 30), session(3, 30)], mastery })
    assert.deepEqual(
      out.workedOn.map((one) => one.conceptId),
      ['c1']
    )
  })

  it('names concepts rather than printing their ids', () => {
    let held = newMastery('concept:velocity', at(1))
    for (let i = 0; i < 4; i += 1) held = recordEvidence(held, 'recall-failed', at(1))
    held = { ...held, state: 'slipping', correct: 4 }
    const out = reportFor('week', NOW, {
      ...empty,
      sessions: [session(1, 30), session(2, 30), session(3, 30)],
      mastery: new Map([['concept:velocity', held]]),
      nameOf: (id) => (id === 'concept:velocity' ? 'Velocity' : id)
    })
    assert.deepEqual(out.slipping, ['Velocity'])
  })

  it('counts the XP and the tasks that fall inside the span, and no others', () => {
    const xp: XPEvent[] = [
      { id: '1', profileId: 'p', source: 'focus-session', amount: 50, sourceId: 's', key: 'k1', subject: null, at: at(2) },
      { id: '2', profileId: 'p', source: 'focus-session', amount: 70, sourceId: 's', key: 'k2', subject: null, at: at(30) }
    ]
    const tasks = [
      { completedAt: at(1) } as StudentTask,
      { completedAt: at(30) } as StudentTask,
      { completedAt: null } as StudentTask
    ]
    const out = reportFor('week', NOW, { ...empty, sessions: [session(1, 30), session(2, 30), session(3, 30)], xp, tasks })
    assert.equal(out.xp, 50)
    assert.equal(out.tasksCompleted, 1)
  })

  it('covers the right days, inclusive of today', () => {
    const out = reportFor('week', NOW, empty)
    assert.equal(out.to, dayKey(NOW))
    assert.equal(out.from, shiftDay(dayKey(NOW), -6))
  })

  it('never writes more than four sentences', () => {
    const out = reportFor('month', NOW, {
      ...empty,
      sessions: Array.from({ length: 12 }, (_, i) => ({ ...session(i + 1, 50), id: `many${i}` })).concat(
        Array.from({ length: 6 }, (_, i) => ({ ...session(i + 40, 10), id: `old${i}` }))
      )
    })
    assert.ok(out.notes.length <= 4)
  })
})

describe('quiet hours', () => {
  const hour = (h: number): number => new Date(2026, 4, 20, h, 30).getTime()

  it('is not quiet when no hours were set', () => {
    assert.equal(insideQuietHours(null, hour(3)), false)
  })

  it('covers a plain daytime range', () => {
    assert.equal(insideQuietHours({ from: 9, to: 17 }, hour(12)), true)
    assert.equal(insideQuietHours({ from: 9, to: 17 }, hour(18)), false)
  })

  it('covers a range that runs across midnight, which is the usual answer', () => {
    assert.equal(insideQuietHours({ from: 22, to: 7 }, hour(23)), true)
    assert.equal(insideQuietHours({ from: 22, to: 7 }, hour(2)), true)
    assert.equal(insideQuietHours({ from: 22, to: 7 }, hour(9)), false)
  })

  it('ends on the hour it says, not an hour later', () => {
    assert.equal(insideQuietHours({ from: 22, to: 7 }, hour(7)), false)
  })
})
