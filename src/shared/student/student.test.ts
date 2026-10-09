import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { ageOn, bandFor, canonical, categorise, checkSafety, hostOf, listed, under, youtubeRef } from './safety.ts'
import { DEFAULT_BREAKS, FOCUS_LEVELS, decide, previewPolicy, snapshotPolicy } from './focus.ts'
import { GAP, MAX_TICK, beginBreak, canMove, carryOn, clock, complete, counts, endEarly, interrupt, newSession, pause, policyStateOf, restoreSession, resume, spell, tick, timerView } from './session.ts'
import { dayKey, daysBetween, lastDays, monthKey, partOfDay, shiftDay, weekKey } from './days.ts'
import { ACHIEVEMENTS, DAILY_SWEEP_XP, advanceQuests, award, awayDays, countDay, dailySweep, emptyRecords, emptyStreak, levelFor, markRestDay, newUnlocks, questsNow, sessionXp, streakMark, streakNow, totalXp, updateRecords, xpForLevel } from './progress.ts'
import { dueCounts, estimateAccuracy, goalProgress, milestoneDone, planTime, studyQueue } from './goals.ts'
import { dayMix, dueCount, dueNow, itemForDay, learningDayCounts, mistakePattern, newReview, nextDifficulty, review, struggling } from './learn.ts'
import { ALL_CONTENT, BUNDLED, CONCEPTS, QUIZZES, WORDS } from './content.ts'
import { COSMETICS, coach, newCoachState, newOrbi, orbiState, unlockedFor } from './orbi.ts'
import { heatmap, insights, momentum, recapFor, recommend, sessionSummary, weekReview } from './insight.ts'
import { PRESETS, SOUNDS, playableMix, playableSounds } from './atmosphere.ts'
import { DEFAULT_WIDGETS, applyOnboarding, defaultPreferences, patchPreferences, readPreferences } from './prefs.ts'
import type { FocusSession, Goal, LearningReview, QuizAttempt, StudentTask, XPEvent } from './types.ts'

/**
 * The Student core, tested where it can be wrong in a way nobody would notice.
 *
 * The clock, the ledger and the safety policy get the most attention, because all three fail quietly: a timer that
 * credits a night of sleep, a completion that pays twice, and an unknown site treated as safe all look like working
 * software right up until they matter.
 */

const DAY = 24 * 3600 * 1000
// A fixed Saturday afternoon, so nothing here depends on when it runs.
const NOW = new Date(2026, 9, 3, 14, 0, 0).getTime()

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
      intention: 'Finish before tomorrow',
      oneThing: 'Projectiles',
      level: 'deep',
      policy: snapshotPolicy({ level: 'deep' }),
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

// ---------------------------------------------------------------- age and safety

describe('how old somebody is', () => {
  it('counts a birthday that has not happened yet this year', () => {
    assert.equal(ageOn('2010-12-25', new Date(2026, 9, 3)), 15)
    assert.equal(ageOn('2010-01-05', new Date(2026, 9, 3)), 16)
  })

  it('refuses a date that does not exist rather than rolling it into the next month', () => {
    assert.equal(ageOn('2010-02-31', new Date(2026, 9, 3)), null)
    assert.equal(ageOn('not a date', new Date(2026, 9, 3)), null)
    assert.equal(ageOn(null, new Date(2026, 9, 3)), null)
  })

  it('puts an unreadable date of birth in its own band rather than treating it as an adult', () => {
    assert.equal(bandFor(null, new Date(NOW)), 'unknown')
    assert.equal(bandFor('2020-01-01', new Date(NOW)), 'child')
    assert.equal(bandFor('2015-01-01', new Date(NOW)), 'preteen')
    assert.equal(bandFor('2012-01-01', new Date(NOW)), 'teen')
    assert.equal(bandFor('2009-01-01', new Date(NOW)), 'older-teen')
    assert.equal(bandFor('1990-01-01', new Date(NOW)), 'adult')
  })
})

describe('what a page is', () => {
  it('reads a host off an address, and nothing off a search term', () => {
    assert.equal(hostOf('https://www.YouTube.com/watch?v=abc'), 'youtube.com')
    assert.equal(hostOf('how do magnets work'), '')
  })

  it('treats a subdomain as the same site and a lookalike as a different one', () => {
    assert.ok(under('m.youtube.com', 'youtube.com'))
    assert.ok(!under('notyoutube.com', 'youtube.com'))
  })

  it('categorises known sites, suffixes and words, and admits when it does not know', () => {
    assert.equal(categorise('https://khanacademy.org/physics'), 'education')
    assert.equal(categorise('https://en.wikipedia.org/wiki/Force'), 'reference')
    assert.equal(categorise('https://instagram.com'), 'social')
    assert.equal(categorise('https://mit.edu/admissions'), 'education')
    assert.equal(categorise('https://some-random-blog-7731.test'), 'unknown')
  })

  it('lets a correction beat what it worked out itself', () => {
    assert.equal(categorise('https://youtube.com', { 'youtube.com': 'education' }), 'education')
  })

  it('strips what describes the arrival rather than the page', () => {
    assert.equal(canonical('https://www.example.com/a?utm_source=x&id=7#top'), 'https://example.com/a?id=7')
    assert.equal(canonical('https://example.com/'), 'https://example.com')
  })

  it('finds the video or the channel, which is what a YouTube decision is about', () => {
    assert.deepEqual(youtubeRef('https://youtube.com/watch?v=abc123'), { video: 'abc123', channel: null })
    assert.deepEqual(youtubeRef('https://youtu.be/xyz'), { video: 'xyz', channel: null })
    assert.deepEqual(youtubeRef('https://youtube.com/@orbis'), { video: null, channel: '@orbis' })
    assert.equal(youtubeRef('https://example.com'), null)
  })
})

describe('whether a page is appropriate', () => {
  const config = { band: 'preteen' as const, override: 'age' as const, approved: [], blocked: [] }

  it('holds back what has an age on it', () => {
    const verdict = checkSafety('https://bet365.com', config)
    assert.equal(verdict.allowed, false)
    assert.equal(verdict.source, 'age-policy')
  })

  it('does not assume an unseen site is safe for the youngest bands', () => {
    const held = checkSafety('https://unknown-site-4417.test', config)
    assert.equal(held.allowed, false)
    assert.equal(held.source, 'unknown-content')
    assert.ok(held.askable, 'it has to be possible to ask for it')

    const teen = checkSafety('https://unknown-site-4417.test', { ...config, band: 'teen' })
    assert.equal(teen.allowed, true)
  })

  it('lets a hand-written list beat the category, in both directions', () => {
    assert.equal(checkSafety('https://instagram.com', { ...config, approved: ['instagram.com'] }).allowed, true)
    assert.equal(checkSafety('https://khanacademy.org', { ...config, blocked: ['khanacademy.org'] }).allowed, false)
  })

  it('never blocks Orbis itself', () => {
    assert.equal(checkSafety('chrome://orbis', { ...config, band: 'child' }).allowed, true)
  })

  it('makes strict mode one band younger, and off mean off', () => {
    assert.equal(checkSafety('https://reddit.com', { ...config, band: 'teen', override: 'strict' }).allowed, false)
    assert.equal(checkSafety('https://bet365.com', { ...config, band: 'child', override: 'off' }).allowed, true)
  })
})

// ---------------------------------------------------------------- focus policy

describe('the focus policy', () => {
  const safety = { band: 'adult' as const, override: 'age' as const, approved: [], blocked: [] }

  it('is fixed when the session starts, defaults and all', () => {
    const policy = snapshotPolicy({ level: 'deep' })
    assert.equal(policy.locked, true)
    assert.equal(policy.enforce, 'block')
    assert.deepEqual([...policy.blocked].sort(), [...FOCUS_LEVELS.deep.blocked].filter((one) => !policy.approvedCategories.includes(one)).sort())
  })

  it('does not let a category be both blocked and approved', () => {
    const policy = snapshotPolicy({ level: 'deep', approvedCategories: ['education', 'reference', 'communication'] })
    assert.ok(!policy.blocked.includes('communication'))
  })

  it('asks safety before focus, so focus can never let something through', () => {
    const verdict = decide('https://bet365.com', { safety: { ...safety, band: 'teen' }, policy: snapshotPolicy({ level: 'light' }) })
    assert.equal(verdict.allowed, false)
    assert.equal(verdict.because, 'safety')
    assert.equal(verdict.saveable, false, 'something held back for safety is not something to save for later')
  })

  it('holds a distraction back and offers to save it', () => {
    const verdict = decide('https://instagram.com', { safety, policy: snapshotPolicy({ level: 'focus' }) })
    assert.equal(verdict.allowed, false)
    assert.equal(verdict.because, 'focus')
    assert.ok(verdict.saveable)
    assert.ok(verdict.counts)
  })

  it('warns rather than blocks on the lightest level', () => {
    const verdict = decide('https://instagram.com', { safety, policy: snapshotPolicy({ level: 'light', blocked: ['social'] }) })
    assert.equal(verdict.allowed, true)
    assert.ok(verdict.warn)
    assert.ok(verdict.counts, 'it still counts as reaching for a distraction')
  })

  it('opens everything on a break, and everything with no session', () => {
    assert.equal(decide('https://instagram.com', { safety, policy: snapshotPolicy({ level: 'deep' }), onBreak: true }).allowed, true)
    assert.equal(decide('https://instagram.com', { safety, policy: null }).allowed, true)
  })

  it('tells one YouTube video from the YouTube feed', () => {
    const policy = snapshotPolicy({ level: 'focus', youtube: 'educational' })
    assert.equal(decide('https://youtube.com/watch?v=abc', { safety, policy }).allowed, true)
    assert.equal(decide('https://youtube.com/', { safety, policy }).allowed, false)
  })

  it('opens only approved videos when that is what was asked for', () => {
    const policy = snapshotPolicy({ level: 'deep', youtube: 'approved-only', approvedVideos: ['good1'] })
    assert.equal(decide('https://youtube.com/watch?v=good1', { safety, policy }).allowed, true)
    assert.equal(decide('https://youtube.com/watch?v=other', { safety, policy }).allowed, false)
  })

  it('keeps Orbis and the tools reachable in the strictest session', () => {
    const policy = snapshotPolicy({ level: 'deep' })
    assert.equal(decide('chrome://orbis', { safety, policy }).allowed, true)
    assert.equal(decide('orbis://pages/formula-vault', { safety, policy }).allowed, true)
  })

  it('shows what will happen before a strict session starts', () => {
    const preview = previewPolicy(snapshotPolicy({ level: 'deep' }))
    assert.ok(preview.blocked.length > 0)
    assert.ok(preview.allowed.some((one) => one.includes('Orbis')))
    assert.equal(preview.locked, true)
  })

  it('matches a URL prefix as well as a host', () => {
    assert.ok(listed('https://example.com/study/page', ['example.com/study']))
    assert.ok(!listed('https://example.com/other', ['example.com/study']))
  })
})

// ---------------------------------------------------------------- the clock

describe('the focus clock', () => {
  it('refuses an impossible move', () => {
    assert.ok(canMove('active', 'break'))
    assert.ok(!canMove('completed', 'active'))
    assert.ok(!canMove('created', 'completed'))
  })

  it('credits a tick, and never more than one tick is worth', () => {
    const held = session()
    const first = tick(held, { at: NOW, mono: 1000 }, NOW + 5000, 6000)
    assert.equal(Math.round(first.credited), 5)
    const huge = tick(held, { at: NOW, mono: 1000 }, NOW + 60_000, 61_000)
    assert.equal(huge.credited, MAX_TICK, 'a long tick is capped, so a stall cannot pay out')
  })

  it('credits nothing across a gap, and says so instead', () => {
    const held = session()
    const slept = tick(held, { at: NOW, mono: 1000 }, NOW + (GAP + 600) * 1000, 1000 + (GAP + 600) * 1000)
    assert.equal(slept.credited, 0)
    assert.ok(slept.gap !== null)
    assert.equal(slept.session.state, 'recovering')
    assert.equal(slept.session.focusedSeconds, 0, 'sleeping is not studying')
  })

  it('takes the smaller of the two clocks, so moving the system clock forward pays nothing extra', () => {
    const held = session()
    // Wall clock jumped an hour; monotonic says five seconds really passed.
    const moved = tick(held, { at: NOW, mono: 1000 }, NOW + 3_600_000, 6000)
    assert.equal(Math.round(moved.credited), 5)
  })

  it('passes a milestone exactly once', () => {
    let held = session({ focusedSeconds: 50 * 60 * 0.5 - 2 })
    const crossed = tick(held, { at: NOW, mono: 1000 }, NOW + 5000, 6000)
    assert.deepEqual(crossed.milestones, [0.5])
    held = crossed.session
    const again = tick(held, { at: NOW + 5000, mono: 6000 }, NOW + 10_000, 11_000)
    assert.deepEqual(again.milestones, [], 'the same milestone does not come round twice')
  })

  it('says when the planned time is up without ending the session itself', () => {
    const held = session({ focusedSeconds: 50 * 60 - 2 })
    const done = tick(held, { at: NOW, mono: 1000 }, NOW + 5000, 6000)
    assert.ok(done.finished)
    assert.equal(done.session.state, 'active', 'finishing is a decision, not a side effect of a tick')
  })

  it('moves into a break at the end of a block, and out when the break is over', () => {
    const held = session({ breaks: { focusMinutes: 25, breakMinutes: 5, blocks: 2, autoResume: true }, focusedSeconds: 25 * 60 - 2 })
    const due = tick(held, { at: NOW, mono: 1000 }, NOW + 5000, 6000)
    assert.ok(due.breakDue)
    assert.equal(due.session.state, 'break')
    assert.equal(due.session.breakNow, 0)

    let onBreak = due.session
    for (let i = 0; i < 70; i += 1) {
      const step = tick(onBreak, { at: NOW + i * 5000, mono: 6000 + i * 5000 }, NOW + (i + 1) * 5000, 6000 + (i + 1) * 5000)
      onBreak = step.session
      if (step.breakOver) break
    }
    assert.ok(onBreak.breakNow >= 5 * 60 - MAX_TICK)
  })

  it('does not credit focus while paused', () => {
    const held = pause(session(), NOW)
    const step = tick(held, { at: NOW, mono: 1000 }, NOW + 5000, 6000)
    assert.equal(step.credited, 0)
    assert.equal(resume(step.session, NOW + 6000).state, 'active')
  })

  it('completes a restored session that had already finished, rather than restarting it', () => {
    const held = interrupt(session({ focusedSeconds: 50 * 60 }), NOW)
    const back = restoreSession(held, { at: NOW, mono: null }, NOW + 10 * 60 * 1000)
    assert.equal(back.kind, 'complete')
    assert.equal(back.session.state, 'completed')
  })

  it('asks after a long absence and carries straight on after a short one', () => {
    const long = restoreSession(interrupt(session({ focusedSeconds: 600 }), NOW), { at: NOW, mono: null }, NOW + 20 * 60 * 1000)
    assert.equal(long.kind, 'ask')
    assert.equal(long.session.state, 'recovering')
    assert.equal(carryOn(long.session, NOW).state, 'active')

    const short = restoreSession(interrupt(session({ focusedSeconds: 600 }), NOW), { at: NOW, mono: null }, NOW + 20_000)
    assert.equal(short.kind, 'continue')
    assert.equal(short.session.state, 'active')
  })

  it('expires a session nobody came back to', () => {
    const gone = restoreSession(interrupt(session({ focusedSeconds: 600 }), NOW), { at: NOW, mono: null }, NOW + 9 * 3600 * 1000)
    assert.equal(gone.kind, 'expired')
    assert.ok(!counts({ ...gone.session, focusedSeconds: 600 }) || gone.session.state === 'expired')
  })

  it('shows a timer that never runs past its own plan', () => {
    const view = timerView(session({ focusedSeconds: 60 * 60 }))
    assert.equal(view.remaining, 0)
    assert.equal(view.through, 1)
    assert.equal(view.elapsed, 3600)
  })

  it('reports the policy state the browser should be in', () => {
    assert.equal(policyStateOf(null), 'normal')
    assert.equal(policyStateOf(session()), 'locked')
    assert.equal(policyStateOf(beginBreak(session(), NOW)), 'break')
    assert.equal(policyStateOf(complete(session(), NOW)), 'normal')
    assert.equal(policyStateOf(session({ level: 'focus', policy: snapshotPolicy({ level: 'focus' }) })), 'focus')
  })

  it('pays nothing for a session that was started and dropped', () => {
    assert.equal(counts(endEarly(session({ focusedSeconds: 90 }), NOW)), false)
    assert.equal(counts(complete(session({ focusedSeconds: 50 * 60 }), NOW)), true)
    assert.equal(counts(endEarly(session({ focusedSeconds: 40 * 60 }), NOW)), true, 'most of a session is still a session')
  })

  it('writes a clock and a length the way a person reads them', () => {
    assert.equal(clock(2538), '42:18')
    assert.equal(clock(3661), '1:01:01')
    assert.equal(spell(4500), '1h 15m')
    assert.equal(spell(45), '45s')
  })
})

// ---------------------------------------------------------------- local days

describe('local days', () => {
  it('uses the student’s own day, not a day in UTC', () => {
    const lateEvening = new Date(2026, 9, 3, 23, 30).getTime()
    assert.equal(dayKey(lateEvening), '2026-10-03')
    assert.equal(monthKey(lateEvening), '2026-10')
  })

  it('names a week by its Monday', () => {
    assert.equal(weekKey(new Date(2026, 9, 3).getTime()), '2026-09-28')
    assert.equal(weekKey(new Date(2026, 9, 5).getTime()), '2026-10-05')
  })

  it('steps days across a month and a clock change without drifting', () => {
    assert.equal(shiftDay('2026-03-01', -1), '2026-02-28')
    assert.equal(shiftDay('2026-10-24', 1), '2026-10-25')
    assert.equal(daysBetween('2026-09-28', '2026-10-03'), 5)
  })

  it('lists the last days ending today', () => {
    const days = lastDays(NOW, 3)
    assert.deepEqual(days, ['2026-10-01', '2026-10-02', '2026-10-03'])
  })

  it('knows what part of the day it is', () => {
    assert.equal(partOfDay(new Date(2026, 9, 3, 8).getTime()), 'morning')
    assert.equal(partOfDay(new Date(2026, 9, 3, 23).getTime()), 'night')
  })
})

// ---------------------------------------------------------------- XP

describe('the XP ledger', () => {
  const add = (key: string, amount = 50): Parameters<typeof award>[3] => ({ source: 'focus-session', amount, sourceId: 's1', key, at: NOW, id: key })

  it('pays an event once, however many times it arrives', () => {
    const first = award([], new Set(), 'p1', add('session:s1:complete'))
    assert.equal(first.awarded, 50)
    const keys = new Set(first.events.map((one) => one.key))
    const again = award(first.events, keys, 'p1', add('session:s1:complete'))
    assert.equal(again.awarded, 0)
    assert.ok(again.duplicate)
    assert.equal(totalXp(again.events), 50)
  })

  it('is a sum of events, so there is no balance to drift', () => {
    let events: readonly XPEvent[] = []
    let keys = new Set<string>()
    for (let i = 0; i < 5; i += 1) {
      const out = award(events, keys, 'p1', add(`session:s${i}:complete`, 20))
      events = out.events
      keys = new Set(events.map((one) => one.key))
    }
    assert.equal(totalXp(events), 100)
  })

  it('says when a level was crossed', () => {
    const out = award([], new Set(), 'p1', add('big', 400))
    assert.ok(out.levelled)
    assert.equal(out.level.level, 2)
  })

  it('makes levels longer as they go', () => {
    assert.equal(xpForLevel(1), 0)
    assert.equal(xpForLevel(2), 300)
    assert.ok(xpForLevel(11) - xpForLevel(10) > xpForLevel(3) - xpForLevel(2))
    const at = levelFor(500)
    assert.equal(at.level, 2)
    assert.ok(at.through > 0 && at.through < 1)
  })

  it('pays more for a longer session, and never in proportion to the hours', () => {
    assert.equal(sessionXp(25, 'focus'), 25)
    assert.equal(sessionXp(50, 'focus'), 50)
    assert.ok(sessionXp(90, 'focus') > sessionXp(50, 'focus'))
    assert.ok(sessionXp(180, 'focus') < sessionXp(50, 'focus') * 3, 'hours are not the thing being rewarded')
    assert.ok(sessionXp(50, 'deep') > sessionXp(50, 'light'))
  })
})

describe('quests', () => {
  it('moves every quest one event counts toward', () => {
    const after = advanceQuests([], 'focus-minutes', 25, NOW)
    const daily = after.find((one) => one.questId === 'daily-focus')
    const weekly = after.find((one) => one.questId === 'weekly-hours')
    assert.equal(daily?.completedAt !== null, true)
    assert.equal(weekly?.value, 25)
    assert.equal(weekly?.completedAt, null)
  })

  it('keeps counting in the right day and starts again the next one', () => {
    const today = advanceQuests([], 'quizzes', 1, NOW)
    const tomorrow = advanceQuests(today, 'quizzes', 1, NOW + DAY)
    const keys = tomorrow.filter((one) => one.questId === 'daily-quiz').map((one) => one.periodKey)
    assert.deepEqual([...new Set(keys)].sort(), ['2026-10-03', '2026-10-04'])
  })

  it('stops counting a quest that is already done', () => {
    const once = advanceQuests([], 'words', 1, NOW)
    const twice = advanceQuests(once, 'words', 5, NOW)
    assert.equal(twice.find((one) => one.questId === 'daily-word')?.value, 1)
  })

  it('knows when the whole day is done', () => {
    let held = advanceQuests([], 'focus-minutes', 30, NOW)
    held = advanceQuests(held, 'words', 1, NOW)
    assert.equal(dailySweep(held, NOW), false)
    held = advanceQuests(held, 'quizzes', 1, NOW)
    held = advanceQuests(held, 'tasks-completed', 1, NOW)
    assert.equal(dailySweep(held, NOW), true)
    assert.ok(DAILY_SWEEP_XP > 0)
  })

  it('shows every quest for now, whether it has been started or not', () => {
    const shown = questsNow([], NOW)
    assert.ok(shown.length >= 8)
    assert.ok(shown.every((one) => one.title.length > 0 && one.target > 0))
  })
})

describe('achievements and streaks', () => {
  it('unlocks on the threshold and never twice', () => {
    const first = newUnlocks({ sessions: 1 }, [], NOW)
    assert.ok(first.some((one) => one.achievementId === 'first-focus'))
    const again = newUnlocks({ sessions: 1 }, first, NOW)
    assert.equal(again.length, 0)
  })

  it('never rewards reaching for a distraction', () => {
    assert.ok(!ACHIEVEMENTS.some((one) => /distract/i.test(one.metric) || /distract/i.test(one.id)))
  })

  it('counts a run of days, and steps over a rest day without breaking it', () => {
    let streak = emptyStreak('focus')
    streak = countDay(streak, '2026-10-01')
    streak = countDay(streak, '2026-10-02')
    assert.equal(streak.current, 2)
    streak = markRestDay(streak, '2026-10-03')
    streak = countDay(streak, '2026-10-04')
    assert.equal(streak.current, 3, 'resting did not cost anything')
  })

  it('keeps the longest run even after a missed day', () => {
    let streak = emptyStreak('focus')
    for (const day of ['2026-09-01', '2026-09-02', '2026-09-03']) streak = countDay(streak, day)
    assert.equal(streak.longest, 3)
    streak = countDay(streak, '2026-10-03')
    assert.equal(streak.current, 1)
    assert.equal(streak.longest, 3, 'a missed day does not erase what happened')
  })

  it('still looks going the morning after', () => {
    let streak = emptyStreak('focus')
    streak = countDay(streak, '2026-10-01')
    streak = countDay(streak, '2026-10-02')
    const shown = streakNow(streak, NOW)
    assert.ok(shown.current >= 2)
  })

  it('counts how long somebody has been away', () => {
    const streak = countDay(emptyStreak('focus'), '2026-09-28')
    assert.equal(awayDays(streak, NOW), 5)
  })

  it('marks only the runs worth mentioning', () => {
    assert.equal(streakMark(7), 7)
    assert.equal(streakMark(8), null)
  })

  it('keeps records against the same person and nobody else', () => {
    const records = updateRecords(emptyRecords(), {
      sessionSeconds: 3000,
      at: NOW,
      daySeconds: 3000,
      weekSeconds: 9000,
      dayXp: 120,
      dayTasks: 3,
      focusStreak: 4,
      learningStreak: 2
    })
    assert.equal(records.longestSessionSeconds, 3000)
    assert.equal(records.bestDay, '2026-10-03')
    assert.equal(records.bestWeek, '2026-09-28')
  })
})

// ---------------------------------------------------------------- goals and tasks

describe('goals and tasks', () => {
  const task = (patch: Partial<StudentTask> = {}): StudentTask => ({
    id: 't1',
    profileId: 'p1',
    title: 'Projectiles',
    subject: 'Physics',
    goalId: 'g1',
    milestoneId: 'm1',
    priority: 'normal',
    estimate: 30,
    actual: 0,
    due: null,
    hasTime: false,
    state: 'planned',
    notes: '',
    order: 0,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...patch
  })

  const goal: Goal = {
    id: 'g1',
    profileId: 'p1',
    title: 'Physics',
    why: '',
    horizon: 'long-term',
    subject: 'Physics',
    deadline: null,
    milestones: [
      { id: 'm1', title: 'Kinematics', stage: 'Concepts', targetDate: null, taskIds: ['t1', 't2'], completedAt: null, order: 0 },
      { id: 'm2', title: 'Forces', stage: 'Concepts', targetDate: null, taskIds: [], completedAt: null, order: 1 }
    ],
    state: 'active',
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW
  }

  it('counts progress from finished work and not from time', () => {
    const progress = goalProgress(goal, [task(), task({ id: 't2', state: 'completed', completedAt: NOW })], NOW)
    assert.equal(progress.through, 0, 'no milestone is finished yet')
    assert.equal(progress.tasksDone, 1)
    assert.equal(progress.nextMilestone?.id, 'm1')
  })

  it('counts a task that names its milestone, as well as one the milestone lists', () => {
    // Both directions, because a task created with a milestone on it is never added to the milestone own list.
    const named = [task({ id: 'byName', milestoneId: 'm1', state: 'completed', completedAt: NOW })]
    assert.equal(milestoneDone({ ...goal.milestones[0], taskIds: [] }, named), true)
    const listed = [task({ id: 'byList', milestoneId: null, state: 'completed', completedAt: NOW })]
    assert.equal(milestoneDone({ ...goal.milestones[0], taskIds: ['byList'] }, listed), true)
  })

  it('finishes a milestone only when every task on it is done', () => {
    const half = [task({ state: 'completed', completedAt: NOW }), task({ id: 't2' })]
    assert.equal(milestoneDone(goal.milestones[0], half), false)
    const all = [task({ state: 'completed', completedAt: NOW }), task({ id: 't2', state: 'completed', completedAt: NOW })]
    assert.equal(milestoneDone(goal.milestones[0], all), true)
  })

  it('says nothing about whether somebody will finish in time', () => {
    const progress = goalProgress({ ...goal, deadline: NOW + 3 * DAY }, [task()], NOW)
    assert.match(progress.note, /remaining/)
    assert.ok(!/likely|won't|unlikely|on track/i.test(progress.note))
  })

  it('puts dated work first', () => {
    const queue = studyQueue([task({ id: 'later', due: NOW + 20 * DAY }), task({ id: 'today', due: NOW }), task({ id: 'none', due: null })], NOW)
    assert.equal(queue[0].id, 'today')
  })

  it('counts what is overdue and what is due today', () => {
    const counted = dueCounts([task({ due: NOW - DAY }), task({ id: 't2', due: NOW }), task({ id: 't3', due: NOW + 3 * DAY })], NOW)
    assert.deepEqual(counted, { overdue: 1, today: 1, week: 1 })
  })

  it('reads estimates only once there are enough to mean something', () => {
    const few = [task({ state: 'completed', estimate: 30, actual: 45 })]
    assert.equal(estimateAccuracy(few), null)
    const many = Array.from({ length: 6 }, (_, i) => task({ id: `t${i}`, state: 'completed', estimate: 30, actual: 45 }))
    assert.equal(estimateAccuracy(many)?.ratio, 1.5)
  })

  it('fills the time somebody says they have, with breaks', () => {
    const plan = planTime(120, [task(), task({ id: 't2', title: 'Sets', subject: 'Maths' })])
    assert.ok(plan.length >= 3)
    assert.equal(plan[0].kind, 'focus')
    assert.ok(plan.some((one) => one.kind === 'break'))
    const total = plan.reduce((sum, one) => sum + one.minutes, 0)
    assert.ok(total <= 120, `a plan must fit in the time: ${total}`)
  })
})

// ---------------------------------------------------------------- learning

describe('learning', () => {
  it('pushes something right further away and brings something forgotten back soon', () => {
    const held = newReview('word-lucid', 'p1', 'intermediate', NOW)
    const right = review(held, 'known', NOW)
    assert.ok(right.dueAt > NOW + 0.5 * DAY)
    const forgotten = review(right, 'forgot', NOW)
    assert.ok(forgotten.dueAt < right.dueAt)
    assert.equal(forgotten.streak, 0)
    assert.ok(forgotten.confidence < right.confidence)
  })

  it('treats "unsure" as its own answer rather than a softer wrong', () => {
    const held = review(review(newReview('x', 'p1', 'intermediate', NOW), 'known', NOW), 'known', NOW)
    const unsure = review(held, 'unsure', NOW)
    assert.equal(unsure.streak, held.streak, 'the run is kept')
    assert.ok(unsure.dueAt <= held.dueAt, 'but the gap does not grow')
  })

  it('brings back the most overdue thing first', () => {
    const reviews: LearningReview[] = [
      { ...newReview('a', 'p1', 'intermediate', NOW), dueAt: NOW - 10 * DAY, reviews: 1, state: 'reviewing' },
      { ...newReview('b', 'p1', 'intermediate', NOW), dueAt: NOW - DAY, reviews: 1, state: 'reviewing' },
      { ...newReview('c', 'p1', 'intermediate', NOW), dueAt: NOW + DAY, reviews: 1, state: 'reviewing' }
    ]
    assert.deepEqual(dueNow(reviews, NOW).map((one) => one.itemId), ['a', 'b'])
    assert.equal(dueCount(reviews, NOW), 2)
  })

  it('notices what is being forgotten faster than it is learned', () => {
    let held = newReview('hard', 'p1', 'advanced', NOW)
    for (let i = 0; i < 4; i += 1) held = review(held, 'forgot', NOW + i * DAY)
    assert.equal(held.state, 'struggling')
    assert.equal(struggling([held]).length, 1)
  })

  it('gives the same word all day and a different one tomorrow', () => {
    const today = itemForDay(BUNDLED, 'word', '2026-10-03', new Set(), 'teen', 'intermediate')
    const again = itemForDay(BUNDLED, 'word', '2026-10-03', new Set(), 'teen', 'intermediate')
    const tomorrow = itemForDay(BUNDLED, 'word', '2026-10-04', new Set(), 'teen', 'intermediate')
    assert.ok(today)
    assert.equal(today?.id, again?.id, 'a refresh must not hand out a second word')
    assert.notEqual(today?.id, tomorrow?.id)
  })

  it('does not come back to a word already seen while unseen ones remain', () => {
    const seen = new Set(WORDS.slice(0, 5).map((one) => one.id))
    const picked = itemForDay(BUNDLED, 'word', '2026-10-03', seen, 'teen', 'intermediate')
    assert.ok(picked && !seen.has(picked.id))
  })

  it('never shows a student something outside their age band', () => {
    const picked = itemForDay(BUNDLED, 'word', '2026-10-03', new Set(), 'child', 'beginner')
    assert.ok(picked?.bands.includes('child'))
  })

  it('offers a mix of kinds for a day', () => {
    const mix = dayMix(ALL_CONTENT, '2026-10-03', new Set(), 'teen', 'intermediate')
    assert.ok(mix.length >= 3)
    assert.equal(new Set(mix.map((one) => one.id)).size, mix.length)
  })

  it('moves the difficulty one step at a time, and only with enough answers', () => {
    const attempt = (correct: boolean, i: number): QuizAttempt => ({ id: `a${i}`, profileId: 'p1', itemId: 'q', subject: null, correct, answer: '', at: NOW - i * 1000, sessionId: null })
    const few = [attempt(true, 0), attempt(true, 1)]
    assert.equal(nextDifficulty(few, 'beginner'), 'beginner')
    const strong = Array.from({ length: 8 }, (_, i) => attempt(true, i))
    assert.equal(nextDifficulty(strong, 'beginner'), 'intermediate')
    const weak = Array.from({ length: 8 }, (_, i) => attempt(false, i))
    assert.equal(nextDifficulty(weak, 'advanced'), 'intermediate')
  })

  it('says what kind of mistake keeps happening, without saying anything about the person', () => {
    const mistakes = Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`,
      profileId: 'p1',
      subject: 'Maths',
      concept: 'Signs',
      kind: i < 6 ? ('calculation' as const) : ('recall' as const),
      detail: '',
      at: NOW - i * 1000,
      reviewedAt: null,
      sessionId: null
    }))
    const pattern = mistakePattern(mistakes)
    assert.equal(pattern?.kind, 'calculation')
    assert.equal(pattern?.count, 6)
  })

  it('counts a learning day only when something was answered', () => {
    const opened = [{ ...newReview('a', 'p1', 'intermediate', NOW), reviews: 0 }]
    assert.equal(learningDayCounts(opened, [], dayKey(NOW)), false)
    const answered = [{ ...newReview('a', 'p1', 'intermediate', NOW), reviews: 1, lastSeenAt: NOW }]
    assert.equal(learningDayCounts(answered, [], dayKey(NOW)), true)
  })
})

describe('the bundled content', () => {
  it('has unique ids', () => {
    const ids = ALL_CONTENT.map((one) => one.id)
    assert.equal(new Set(ids).size, ids.length)
  })

  it('says where everything came from and who it is for', () => {
    for (const item of ALL_CONTENT) {
      assert.ok(item.bands.length > 0, `${item.id} has no age bands`)
      assert.ok(item.origin === 'orbis', `${item.id} is bundled, so it must say so`)
      assert.ok(item.title.trim().length > 0)
    }
  })

  it('gives every word a definition and an example, and every concept a question', () => {
    for (const one of WORDS) {
      assert.ok(one.body.definition && one.body.example, `${one.id} is incomplete`)
    }
    for (const one of CONCEPTS) {
      assert.ok(one.body.definition && one.body.commonMistake && one.body.question && one.body.answer, `${one.id} is incomplete`)
    }
  })

  it('builds the quizzes from the concepts, so an answer lives in one place', () => {
    assert.equal(QUIZZES.length, CONCEPTS.length)
    assert.ok(QUIZZES.every((one) => one.body.question && one.body.answer))
  })
})

// ---------------------------------------------------------------- Orbi

describe('Orbi', () => {
  const base = { session: null, sessionState: null, moment: null, offline: false, broken: false, hour: 14, idleMinutes: 0 } as const

  it('has one state at a time, and a fault outranks a mood', () => {
    assert.equal(orbiState({ ...base }), 'ready')
    assert.equal(orbiState({ ...base, sessionState: 'active', session: session() }), 'focus-locked')
    assert.equal(orbiState({ ...base, sessionState: 'break' }), 'break')
    assert.equal(orbiState({ ...base, moment: 'celebrating' }), 'celebrating')
    assert.equal(orbiState({ ...base, moment: 'celebrating', broken: true }), 'error')
    assert.equal(orbiState({ ...base, idleMinutes: 30, hour: 2 }), 'sleeping')
  })

  it('stays quiet while somebody is typing, whatever has happened', () => {
    const now = { typing: true, reading: false, quizzing: false, waitingOnOrion: false, behaviour: newOrbi('p1', NOW).behaviour, sessionId: 's1' }
    const out = coach('session-complete', now, newCoachState(), NOW)
    assert.equal(out.message, null)
    assert.equal(out.why, 'typing')
  })

  it('does not say the same thing twice in a row', () => {
    const now = { typing: false, reading: false, quizzing: false, waitingOnOrion: false, behaviour: newOrbi('p1', NOW).behaviour, sessionId: 's1' }
    const first = coach('half-way', now, newCoachState(), NOW)
    assert.ok(first.message)
    const second = coach('half-way', now, first.state, NOW + 1000)
    assert.equal(second.message, null)
  })

  it('caps how much it says in a session, and still says the important things', () => {
    const now = { typing: false, reading: false, quizzing: false, waitingOnOrion: false, behaviour: { ...newOrbi('p1', NOW).behaviour, messages: 'rare' as const }, sessionId: 's1' }
    let state = newCoachState()
    const events = ['first-milestone', 'half-way', 'final-stretch'] as const
    let spoken = 0
    events.forEach((event, i) => {
      const out = coach(event, now, state, NOW + i * 20 * 60_000)
      state = out.state
      if (out.message) spoken += 1
    })
    assert.ok(spoken <= 3)
    const important = coach('distraction-attempt', now, { ...state, count: 99 }, NOW + 10 * 3600_000)
    assert.ok(important.message, 'a distraction is still worth one sentence')
  })

  it('says nothing at all when it is turned off', () => {
    const off = { typing: false, reading: false, quizzing: false, waitingOnOrion: false, behaviour: { ...newOrbi('p1', NOW).behaviour, messages: 'off' as const }, sessionId: 's1' }
    assert.equal(coach('session-complete', off, newCoachState(), NOW).message, null)
  })

  it('never mentions a lost streak and never guilts anybody', () => {
    const personalities = ['calm', 'energetic', 'academic', 'playful', 'minimal'] as const
    const events = ['comeback', 'distraction-attempt', 'losing-focus', 'rest-day'] as const
    for (const personality of personalities) {
      for (const event of events) {
        const now = { typing: false, reading: false, quizzing: false, waitingOnOrion: false, behaviour: { ...newOrbi('p1', NOW).behaviour, personality }, sessionId: null }
        const out = coach(event, now, newCoachState(), NOW)
        const text = out.message?.text ?? ''
        assert.ok(!/lost|failed|disappoint|should have|wasted/i.test(text), `${personality}/${event}: "${text}"`)
      }
    }
  })

  it('unlocks only cosmetics, by level or by achievement', () => {
    const unlocked = unlockedFor(5, ['orbi-glasses'])
    assert.ok(unlocked.includes('orbi-headphones'))
    assert.ok(unlocked.includes('orbi-glasses'))
    assert.equal(new Set(unlocked).size, unlocked.length)
    assert.ok(COSMETICS.every((one) => ['orbi', 'accessory', 'room', 'atmosphere', 'theme', 'animation'].includes(one.kind)))
  })
})

// ---------------------------------------------------------------- what happened, and what next

describe('insights', () => {
  const finished = (minutes: number, state: FocusSession['state'], at: number, id: string): FocusSession => ({
    ...session({ id, plannedMinutes: minutes, focusedSeconds: state === 'completed' ? minutes * 60 : minutes * 60 * 0.4 }),
    state,
    startedAt: at
  })

  it('suggests a default until there is history, and says that is what it is', () => {
    const out = recommend([], { queue: [], fallbackMinutes: 45, fallbackLevel: 'focus', now: NOW })
    assert.equal(out?.minutes, 45)
    assert.match(out?.because ?? '', /default/i)
    assert.ok((out?.confidence ?? 1) < 0.5)
  })

  it('suggests the length that actually gets finished, and says why', () => {
    const sessions = [
      finished(40, 'completed', NOW - DAY, 'a'),
      finished(40, 'completed', NOW - 2 * DAY, 'b'),
      finished(45, 'completed', NOW - 3 * DAY, 'c'),
      finished(90, 'ended-early', NOW - 4 * DAY, 'd'),
      finished(90, 'ended-early', NOW - 5 * DAY, 'e'),
      finished(40, 'completed', NOW - 6 * DAY, 'f')
    ]
    const out = recommend(sessions, { queue: [], fallbackMinutes: 90, fallbackLevel: 'focus', now: NOW })
    assert.ok(out && out.minutes >= 35 && out.minutes <= 50, `suggested ${out?.minutes}`)
    assert.match(out?.because ?? '', /ended early|average/i)
    assert.ok(!/attention span|you are|you're better/i.test(out?.because ?? ''), 'no claims about the person')
  })

  it('sums a day from the sessions rather than from a counter', () => {
    const recap = recapFor(dayKey(NOW), [finished(50, 'completed', NOW, 'a'), finished(25, 'completed', NOW, 'b')], [], [], 2, 1)
    assert.equal(recap.sessions, 2)
    assert.equal(recap.completed, 2)
    assert.equal(recap.focusedSeconds, 75 * 60)
    assert.equal(recap.subjects[0].subject, 'Physics')
  })

  it('reviews a week with the numbers and an average only of what finished', () => {
    const out = weekReview(weekKey(NOW), [finished(50, 'completed', NOW, 'a'), finished(50, 'ended-early', NOW, 'b')], [], [])
    assert.equal(out.sessions, 2)
    assert.equal(out.completed, 1)
    assert.equal(out.averageSeconds, 50 * 60)
  })

  it('fills every day of a heatmap, including the empty ones', () => {
    const map = heatmap([finished(50, 'completed', NOW, 'a')], NOW, 7)
    assert.equal(map.length, 7)
    assert.equal(map[6].seconds, 3000)
    assert.equal(map[0].seconds, 0)
  })

  it('builds momentum only from things that can be counted', () => {
    const out = momentum(session({ focusedSeconds: 25 * 60 }), 4, 8)
    assert.ok(out.value > 0 && out.value < 1)
    assert.ok(out.parts.every((one) => ['Time', 'Tasks', 'Milestones'].includes(one.label)))
  })

  it('says only things a student could check against their own history', () => {
    const sessions = [finished(50, 'completed', NOW, 'a'), finished(50, 'ended-early', NOW, 'b'), finished(50, 'completed', NOW - DAY, 'c')]
    const out = insights(sessions, [], NOW)
    assert.ok(out.length > 0)
    for (const one of out) {
      assert.ok(/\d/.test(one.text), `an insight without a number: "${one.text}"`)
      assert.ok(!/intelligent|smarter|night owl|personality|lazy/i.test(one.text))
    }
  })

  it('summarises a session as plain measurements', () => {
    const summary = sessionSummary({ ...session({ focusedSeconds: 48 * 60, savedForLater: 2, distractionAttempts: 3 }), xpAwarded: 50 })
    const labels = summary.map((one) => one.label)
    assert.ok(labels.includes('Planned') && labels.includes('Completed') && labels.includes('XP'))
    assert.ok(!labels.some((one) => /score|rating/i.test(one)))
  })
})

// ---------------------------------------------------------------- atmosphere

describe('atmosphere', () => {
  it('only offers what it can actually play', () => {
    const playable = playableSounds([])
    assert.ok(playable.length >= 7)
    assert.ok(playable.every((one) => one.layers !== null))
    assert.ok(SOUNDS.filter((one) => one.needsFile).every((one) => one.unavailable && one.unavailable.length > 0))
  })

  it('says what is missing rather than playing something else instead', () => {
    const fire = SOUNDS.find((one) => one.id === 'fireplace')
    assert.equal(fire?.layers, null)
    assert.match(fire?.unavailable ?? '', /recording/i)
  })

  it('drops the layers it cannot play rather than failing the whole preset', () => {
    const mix = playableMix({ layers: { brown: 0.5, fireplace: 0.5 } }, [])
    assert.deepEqual(Object.keys(mix.layers), ['brown'])
    const withFile = playableMix({ layers: { brown: 0.5, fireplace: 0.5 } }, ['fireplace'])
    assert.equal(Object.keys(withFile.layers).length, 2)
  })

  it('has a preset that is genuinely silent', () => {
    const minimal = PRESETS.find((one) => one.id === 'minimal')
    assert.deepEqual(minimal?.mix.layers, {})
  })
})

// ---------------------------------------------------------------- settings

describe('settings', () => {
  it('starts with sensible defaults and nothing onboarded', () => {
    const prefs = defaultPreferences(NOW)
    assert.equal(prefs.onboarded, false)
    assert.equal(prefs.dob, null)
    assert.equal(prefs.safetyOverride, 'age')
    assert.deepEqual(prefs.widgets, [...DEFAULT_WIDGETS])
  })

  it('reads a damaged file without throwing, and never widens safety doing it', () => {
    const prefs = readPreferences({ safetyOverride: 'nonsense', defaultMinutes: 99999, dob: 'yesterday', widgets: ['nope'] }, NOW)
    assert.equal(prefs.safetyOverride, 'age')
    assert.equal(prefs.defaultMinutes, 300)
    assert.equal(prefs.dob, null)
    assert.deepEqual(prefs.widgets, [...DEFAULT_WIDGETS])
    assert.deepEqual(readPreferences(null, NOW).widgets, [...DEFAULT_WIDGETS])
  })

  it('drops a category it does not recognise instead of keeping it', () => {
    const prefs = readPreferences({ blockedCategories: ['social', 'not-a-category'] }, NOW)
    assert.deepEqual(prefs.blockedCategories, ['social'])
  })

  it('applies a patch through the same rules', () => {
    const held = defaultPreferences(NOW)
    const patched = patchPreferences(held, { defaultMinutes: -5, name: '  Ana  ' }, NOW + 1)
    assert.equal(patched.defaultMinutes, 5)
    assert.equal(patched.name, 'Ana')
    assert.equal(patched.updatedAt, NOW + 1)
  })

  it('turns what onboarding asked into settings that actually do something', () => {
    const prefs = applyOnboarding(defaultPreferences(NOW), { name: 'Ana', dob: '2010-05-05', learning: ['School'], workingToward: ['Boards'], focusStyle: 'pomodoro', atmosphere: 'rain-study' }, NOW)
    assert.equal(prefs.onboarded, true)
    assert.equal(prefs.defaultMinutes, 25)
    assert.equal(prefs.defaultBreaks.breakMinutes, 5)
    assert.equal(prefs.defaultAtmosphere, 'rain-study')
    assert.equal(prefs.name, 'Ana')
  })

  it('lets somebody skip everything optional', () => {
    const prefs = applyOnboarding(defaultPreferences(NOW), { name: '', dob: null, learning: [], workingToward: [], focusStyle: 'unsure', atmosphere: 'minimal' }, NOW)
    assert.equal(prefs.onboarded, true)
    assert.equal(prefs.dob, null)
    assert.equal(prefs.defaultAtmosphere, null)
  })
})


describe('the Student navigation strip', () => {
  it('never shortens a name to an initial', () => {
    /*
     * The fault this guards against shipped and looked broken: fifteen tabs squeezed with `text-overflow:
     * ellipsis` rendered as "H. F. P L. C. M... What...". A name is shown whole or the icons stand alone — there
     * is no middle state where a label is one letter and a full stop.
     */
    const css = readFileSync(join(process.cwd(), 'src', 'renderer', 'src', 'components', 'student', 'student.css'), 'utf8')
    const block = css.slice(css.indexOf('.st-nav-label {'), css.indexOf('.st-nav-label {') + 400)
    assert.ok(!block.includes('text-overflow'), 'the nav label must not be allowed to ellipsis')
    assert.ok(block.includes('flex: 0 0 auto'), 'the nav label must not be allowed to shrink')
  })
})
