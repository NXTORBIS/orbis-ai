import assert from 'node:assert/strict'
import test from 'node:test'
import type { DeviceState } from './capability.ts'
import { answerAboutOffline, conditionsMet, readiness, requirementsOf, UNSUPPORTED, findUnsupported } from './capability.ts'
import { canMove, checkJob, DEFAULT_POLICIES, occurrenceKey, TEMPORAL_FORMAT, withExecution, type ExecutionRecord, type TemporalJob } from './job.ts'
import { decide, nextWake, stateAfter, TICK_MS } from './plan.ts'

/**
 * What the scheduler decides, and what it refuses to claim.
 *
 * Every test here is about a decision rather than an outcome, because the decision is the part that must not be
 * wrong: an occurrence run twice, a run recorded that did not happen, or a job that quietly never runs again are all
 * failures nobody notices until the moment has passed.
 */

const READY: DeviceState = Object.freeze({
  orbisRunning: true,
  browserRunning: true,
  networkAvailable: true,
  onUnmeteredNetwork: true,
  onPower: true,
  batteryPercent: 80,
  idle: false,
  hasModelKey: true
})

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0)

function job(over: Partial<TemporalJob> = {}): TemporalJob {
  return {
    format: TEMPORAL_FORMAT,
    jobId: 'j1',
    profileId: 'p1',
    name: 'Morning news',
    said: 'open news.example every day at 8am',
    action: { kind: 'openUrl', url: 'https://news.example', newTab: true },
    schedule: { recurrence: { kind: 'daily', time: { hour: 8, minute: 0 } }, timeZone: 'UTC' },
    policies: { ...DEFAULT_POLICIES },
    conditions: [],
    state: 'scheduled',
    createdAt: NOW - 86_400_000,
    updatedAt: NOW - 86_400_000,
    version: 1,
    nextRunAt: null,
    lastRunAt: null,
    runsSoFar: 0,
    history: [],
    skipped: [],
    ...over
  }
}

const ran = (dueAt: number, state: ExecutionRecord['state'] = 'completed', attempt = 1): ExecutionRecord => ({
  executionId: `e-${dueAt}-${attempt}`,
  dueAt,
  startedAt: dueAt,
  finishedAt: dueAt + 500,
  state,
  attempt,
  detail: ''
})

// ---------------------------------------------------------------- running, once and only once

test('a job whose time has not come does nothing, and says when to look again', () => {
  const at7 = Date.UTC(2026, 5, 15, 7, 0)
  const d = decide(job({ lastRunAt: Date.UTC(2026, 5, 14, 8, 0) }), at7, READY)
  assert.equal(d.do, 'nothing')
  if (d.do !== 'nothing') return
  assert.equal(d.state, 'scheduled')
  // Eight o'clock the same day, so the scheduler can sleep an hour rather than spin.
  assert.equal(d.nextRunAt, Date.UTC(2026, 5, 15, 8, 0))
  assert.equal(d.until, d.nextRunAt)
})

test('a job that is due runs, and carries the moment it was due rather than now', () => {
  const d = decide(job({ lastRunAt: Date.UTC(2026, 5, 14, 8, 0) }), NOW, READY)
  assert.equal(d.do, 'run')
  if (d.do !== 'run') return
  assert.equal(d.dueAt, Date.UTC(2026, 5, 15, 8, 0))
  // Four hours late, because the scheduler only looked at midday.
  assert.equal(d.lateBy, 4 * 3_600_000)
  assert.equal(d.attempt, 1)
})

test('the same occurrence is never run twice, however often the scheduler looks', () => {
  /**
   * The fault this keying exists to prevent. The run is recorded against the moment it was *due*, so a second pass
   * in the same minute, a restart, or two schedulers all agree it has already happened.
   */
  const due = Date.UTC(2026, 5, 15, 8, 0)
  const after = job({ lastRunAt: due, runsSoFar: 1, history: [ran(due)] })
  for (const at of [NOW, NOW + 1000, NOW + 60_000]) {
    const d = decide(after, at, READY)
    assert.equal(d.do, 'nothing', `looked again at ${at}`)
  }
})

test('the occurrence key is the due moment, not the moment it ran', () => {
  // Which is what makes a retry and a catch-up agree with each other.
  assert.equal(occurrenceKey('j1', 1000), occurrenceKey('j1', 1000))
  assert.notEqual(occurrenceKey('j1', 1000), occurrenceKey('j1', 1001))
})

// ---------------------------------------------------------------- what was missed while the computer was off

test('three days off produce one run, not three', () => {
  // The default, because three days of "open my morning news" is one morning news.
  const d = decide(job({ lastRunAt: Date.UTC(2026, 5, 12, 8, 0) }), NOW, READY)
  assert.equal(d.do, 'run')
  if (d.do !== 'run') return
  assert.equal(d.dueAt, Date.UTC(2026, 5, 15, 8, 0), 'the most recent one')
})

test('asked for all of them, they play back oldest first', () => {
  // Made a week ago, because nothing is ever caught up from before the job existed.
  const all = job({
    createdAt: Date.UTC(2026, 5, 8, 12, 0),
    lastRunAt: Date.UTC(2026, 5, 12, 8, 0),
    policies: { ...DEFAULT_POLICIES, catchUp: 'all' }
  })
  const first = decide(all, NOW, READY)
  assert.equal(first.do, 'run')
  if (first.do !== 'run') return
  assert.equal(first.dueAt, Date.UTC(2026, 5, 13, 8, 0))
  // And once that one is recorded, the next oldest comes up.
  const second = decide({ ...all, history: [ran(first.dueAt)], lastRunAt: first.dueAt }, NOW, READY)
  assert.equal(second.do, 'run')
  if (second.do !== 'run') return
  assert.equal(second.dueAt, Date.UTC(2026, 5, 14, 8, 0))
})

test('asked for none of them, nothing missed is run', () => {
  const none = job({ lastRunAt: Date.UTC(2026, 5, 12, 8, 0), policies: { ...DEFAULT_POLICIES, catchUp: 'nextOnly' } })
  const d = decide(none, NOW, READY)
  assert.equal(d.do, 'nothing')
  if (d.do !== 'nothing') return
  assert.equal(d.nextRunAt, Date.UTC(2026, 5, 16, 8, 0), 'tomorrow, not this morning')
})

test('a computer off for a year does not produce a year of catch-up', () => {
  // Fourteen days back at most, so nothing arrives that nobody wants to be reminded about now.
  const ancient = job({ lastRunAt: Date.UTC(2025, 5, 15, 8, 0), policies: { ...DEFAULT_POLICIES, catchUp: 'all' } })
  const d = decide(ancient, NOW, READY)
  assert.equal(d.do, 'run')
  if (d.do !== 'run') return
  assert.ok(d.dueAt > NOW - 15 * 86_400_000, 'within the catch-up window')
})

test('skip means skip: a moment that passed is recorded as missed, not run late', () => {
  const skip = job({ lastRunAt: Date.UTC(2026, 5, 14, 8, 0), policies: { ...DEFAULT_POLICIES, missed: 'skip' } })
  const d = decide(skip, NOW, READY)
  assert.equal(d.do, 'giveUp')
  if (d.do !== 'giveUp') return
  assert.equal(d.dueAt, Date.UTC(2026, 5, 15, 8, 0))
})

test('a grace window runs it late up to the window and no further', () => {
  const windowed = job({
    lastRunAt: Date.UTC(2026, 5, 14, 8, 0),
    policies: { ...DEFAULT_POLICIES, missed: 'withinWindow', graceMinutes: 30 }
  })
  const justInside = decide(windowed, Date.UTC(2026, 5, 15, 8, 25), READY)
  assert.equal(justInside.do, 'run')
  const wellOutside = decide(windowed, Date.UTC(2026, 5, 15, 9, 30), READY)
  assert.equal(wellOutside.do, 'giveUp')
})

test('being late by less than one look is not late at all', () => {
  // The scheduler only looks every half minute, so it cannot do better and should not report a failure for it.
  const strict = job({ lastRunAt: Date.UTC(2026, 5, 14, 8, 0), policies: { ...DEFAULT_POLICIES, missed: 'skip' } })
  const d = decide(strict, Date.UTC(2026, 5, 15, 8, 0) + TICK_MS - 1, READY)
  assert.equal(d.do, 'run')
})

// ---------------------------------------------------------------- when the machine cannot

test('a closed browser is waited for, not failed', () => {
  const d = decide(job({ lastRunAt: Date.UTC(2026, 5, 14, 8, 0) }), NOW, { ...READY, browserRunning: false })
  assert.equal(d.do, 'wait')
  if (d.do !== 'wait') return
  assert.equal(d.state, 'waitingForDevice')
  assert.match(d.reasons[0], /browser is not open/)
  // And still due, so the next look runs it.
  assert.equal(d.dueAt, Date.UTC(2026, 5, 15, 8, 0))
})

test('a missing model key blocks rather than waits, because waiting will not fix it', () => {
  const asking = job({
    action: { kind: 'orion', prompt: 'What happened overnight?' },
    lastRunAt: Date.UTC(2026, 5, 14, 8, 0)
  })
  const d = decide(asking, NOW, { ...READY, hasModelKey: false })
  assert.equal(d.do, 'block')
  if (d.do !== 'block') return
  assert.match(d.reasons[0], /no model key/)
})

test('a condition that is not true waits, and says which', () => {
  const onPower = job({ conditions: [{ kind: 'onPower' }], lastRunAt: Date.UTC(2026, 5, 14, 8, 0) })
  const d = decide(onPower, NOW, { ...READY, onPower: false })
  assert.equal(d.do, 'wait')
  if (d.do !== 'wait') return
  assert.equal(d.state, 'waitingForCondition')
  assert.match(d.reasons[0], /not plugged in/)
})

test('a computer with no battery satisfies a battery condition', () => {
  // No battery is not a flat battery, and a desktop should not be held back by a laptop rule.
  const met = conditionsMet([{ kind: 'batteryAbove', percent: 50 }], { ...READY, batteryPercent: null })
  assert.equal(met.ready, true)
  const low = conditionsMet([{ kind: 'batteryAbove', percent: 50 }], { ...READY, batteryPercent: 20 })
  assert.equal(low.ready, false)
})

test('a metered connection fails a wifi-only job', () => {
  const met = conditionsMet([{ kind: 'onWifi' }], { ...READY, onUnmeteredNetwork: false })
  assert.equal(met.ready, false)
  assert.match(met.reasons[0], /metered/)
})

// ---------------------------------------------------------------- retries

test('a failure waits before trying again, and the wait doubles', () => {
  const due = Date.UTC(2026, 5, 15, 8, 0)
  const failed = job({
    state: 'retrying',
    lastRunAt: due,
    history: [ran(due, 'failed', 1)],
    policies: { ...DEFAULT_POLICIES, retry: { kind: 'backoff', attempts: 3, firstDelayMs: 60_000 } }
  })
  // Too soon.
  assert.equal(decide(failed, due + 30_000, READY).do, 'nothing')
  // A minute later, the second attempt.
  const second = decide(failed, due + 120_000, READY)
  assert.equal(second.do, 'run')
  if (second.do !== 'run') return
  assert.equal(second.attempt, 2)
  assert.equal(second.dueAt, due, 'still the same occurrence')

  // After a second failure the wait is two minutes rather than one, counted from when that attempt gave up.
  const secondFailed = { ...ran(due, 'failed', 2), startedAt: due + 120_000, finishedAt: due + 120_500 }
  const twice = { ...failed, history: [ran(due, 'failed', 1), secondFailed] }
  assert.equal(decide(twice, due + 180_000, READY).do, 'nothing', 'one minute after the second failure is too soon')
  assert.equal(decide(twice, due + 300_000, READY).do, 'run')
})

test('retries stop at the count asked for', () => {
  const due = Date.UTC(2026, 5, 15, 8, 0)
  const spent = job({
    state: 'retrying',
    lastRunAt: due,
    history: [ran(due, 'failed', 1), ran(due, 'failed', 2)],
    policies: { ...DEFAULT_POLICIES, retry: { kind: 'backoff', attempts: 2, firstDelayMs: 1000 } }
  })
  const d = decide(spent, due + 3_600_000, READY)
  assert.equal(d.do, 'retire')
  if (d.do !== 'retire') return
  assert.equal(d.state, 'failed')
})

test('a retry is not run while the browser is closed either', () => {
  const due = Date.UTC(2026, 5, 15, 8, 0)
  const failed = job({ state: 'retrying', lastRunAt: due, history: [ran(due, 'failed', 1)] })
  const d = decide(failed, due + 3_600_000, { ...READY, browserRunning: false })
  assert.equal(d.do, 'wait')
})

// ---------------------------------------------------------------- endings and pauses

test('a one-off that ran is finished, and does not come round again', () => {
  const once = job({
    schedule: { recurrence: { kind: 'once', date: { year: 2026, month: 6, day: 15 }, time: { hour: 8, minute: 0 } }, timeZone: 'UTC' },
    lastRunAt: Date.UTC(2026, 5, 15, 8, 0),
    runsSoFar: 1,
    history: [ran(Date.UTC(2026, 5, 15, 8, 0))]
  })
  const d = decide(once, NOW, READY)
  assert.equal(d.do, 'retire')
  if (d.do !== 'retire') return
  assert.equal(d.state, 'completed')
})

test('a run count that is spent ends the job', () => {
  const spent = job({
    schedule: { recurrence: { kind: 'daily', time: { hour: 8, minute: 0 } }, timeZone: 'UTC', maxRuns: 2 },
    runsSoFar: 2,
    lastRunAt: Date.UTC(2026, 5, 15, 8, 0),
    history: [ran(Date.UTC(2026, 5, 14, 8, 0)), ran(Date.UTC(2026, 5, 15, 8, 0))]
  })
  assert.equal(decide(spent, NOW, READY).do, 'retire')
})

test('a paused job does nothing, and one paused until a moment resumes itself', () => {
  const held = job({ state: 'paused' })
  assert.equal(decide(held, NOW, READY).do, 'nothing')
  assert.equal((decide(held, NOW, READY) as { state: string }).state, 'paused')

  const untilTomorrow = job({ state: 'paused', pausedUntil: NOW + 3_600_000 })
  assert.equal((decide(untilTomorrow, NOW, READY) as { state: string }).state, 'paused')
  const later = decide(untilTomorrow, NOW + 7_200_000, READY)
  assert.equal((later as { state: string }).state, 'scheduled')
})

test('a cancelled job is never reconsidered', () => {
  const d = decide(job({ state: 'cancelled', lastRunAt: null }), NOW, READY)
  assert.equal(d.do, 'nothing')
  if (d.do !== 'nothing') return
  assert.equal(d.state, 'cancelled')
  assert.equal(d.nextRunAt, null)
})

test('an occurrence somebody chose to skip is not run', () => {
  const due = Date.UTC(2026, 5, 15, 8, 0)
  const d = decide(job({ lastRunAt: Date.UTC(2026, 5, 14, 8, 0), skipped: [due] }), NOW, READY)
  assert.equal(d.do, 'nothing')
})

test('a schedule that has not started yet is not run early', () => {
  const later = job({
    schedule: { recurrence: { kind: 'daily', time: { hour: 8, minute: 0 } }, timeZone: 'UTC', startsAt: Date.UTC(2026, 6, 1) }
  })
  const d = decide(later, NOW, READY)
  assert.equal(d.do, 'nothing')
  if (d.do !== 'nothing') return
  assert.equal(d.nextRunAt, Date.UTC(2026, 6, 1, 8, 0))
})

// ---------------------------------------------------------------- the state machine

test('completed has to be earned, not merely arrived at', () => {
  /**
   * The one thing this layer must never do is claim to have run without running. A one-off legitimately ends from
   * `scheduled` -- that is where it sits after its run is recorded -- so the guard is about evidence rather than
   * about which state came before.
   */
  assert.equal(canMove('running', 'completed'), true)
  assert.equal(canMove('waitingForDevice', 'completed'), false)
  assert.equal(canMove('blocked', 'completed'), false)

  const neverRan = job({ state: 'scheduled', history: [] })
  assert.equal(stateAfter(neverRan, { do: 'retire', state: 'completed' }), 'missed', 'nothing ran, so nothing completed')

  const didRun = job({ state: 'scheduled', history: [ran(Date.UTC(2026, 5, 15, 8, 0))] })
  assert.equal(stateAfter(didRun, { do: 'retire', state: 'completed' }), 'completed')

  const onlyFailed = job({ state: 'scheduled', history: [ran(Date.UTC(2026, 5, 15, 8, 0), 'failed')] })
  assert.equal(stateAfter(onlyFailed, { do: 'retire', state: 'completed' }), 'missed')
})

test('a brand new schedule does not immediately owe this morning', () => {
  // "Every day at 8am", said at noon, plainly means from tomorrow -- not a reminder seconds after it was set.
  const justMade = job({ createdAt: NOW - 1000, lastRunAt: null })
  const d = decide(justMade, NOW, READY)
  assert.equal(d.do, 'nothing')
  if (d.do !== 'nothing') return
  assert.equal(d.nextRunAt, Date.UTC(2026, 5, 16, 8, 0))
})

test('cancelled is the end of the line', () => {
  for (const to of ['scheduled', 'ready', 'running', 'completed', 'paused'] as const) {
    assert.equal(canMove('cancelled', to), false, `cancelled -> ${to}`)
  }
})

test('the state a decision implies is checked against the machine, not assigned', () => {
  const running = job({ state: 'running' })
  // A running job cannot become "ready" again, so the illegal move is refused rather than taken.
  assert.equal(stateAfter(running, { do: 'run', dueAt: NOW, attempt: 1, lateBy: 0, key: 'k' }), 'running')
  assert.equal(stateAfter(job(), { do: 'block', reasons: [] }), 'blocked')
  assert.equal(stateAfter(job(), { do: 'giveUp', dueAt: NOW, why: '' }), 'missed')
})

// ---------------------------------------------------------------- when to wake up

test('the scheduler sleeps until the soonest thing, and only one tick when waiting on the machine', () => {
  const soon = NOW + 3_600_000
  const later = NOW + 86_400_000
  assert.equal(
    nextWake(
      [
        { do: 'nothing', state: 'scheduled', nextRunAt: later, until: later },
        { do: 'nothing', state: 'scheduled', nextRunAt: soon, until: soon }
      ],
      NOW
    ),
    soon
  )
  // Waiting on the browser can be resolved at any moment without anything telling the scheduler, so it looks again.
  assert.equal(nextWake([{ do: 'wait', state: 'waitingForDevice', dueAt: NOW, reasons: [] }], NOW), NOW + TICK_MS)
  assert.equal(nextWake([{ do: 'nothing', state: 'paused', nextRunAt: null, until: null }], NOW), null)
})

// ---------------------------------------------------------------- what it refuses to promise

test('nothing can run while the computer is off, and it says so', () => {
  for (const kind of ['openUrl', 'orion', 'notify', 'workflow'] as const) {
    const answer = answerAboutOffline({ kind, url: 'https://a.example', newTab: true, prompt: 'x', message: 'x', workflowId: 'x' } as never)
    assert.match(answer, /^No\./, kind)
  }
})

test('every action needs this computer, and the requirements say which need more', () => {
  assert.equal(requirementsOf({ kind: 'notify', message: 'x' }).needsBrowser, false)
  assert.equal(requirementsOf({ kind: 'openUrl', url: 'https://a.example', newTab: true }).needsBrowser, true)
  assert.equal(requirementsOf({ kind: 'orion', prompt: 'x' }).needsModel, true)
  assert.equal(requirementsOf({ kind: 'notify', message: 'x' }).needsThisComputer, true)
})

test('a reminder does not need the browser, so a closed browser does not hold it up', () => {
  const remind = job({ action: { kind: 'notify', message: 'Stretch' }, lastRunAt: Date.UTC(2026, 5, 14, 8, 0) })
  assert.equal(decide(remind, NOW, { ...READY, browserRunning: false }).do, 'run')
})

test('asking for something Orbis cannot do gets the reason and the nearest real thing', () => {
  const messaging = findUnsupported('send a whatsapp to mum every sunday')
  assert.ok(messaging)
  assert.match(messaging.because, /no connection to any messaging service/)
  assert.ok(messaging.instead)

  const offline = findUnsupported('run this while my computer is off')
  assert.ok(offline)
  assert.match(offline.because, /no Orbis server/)

  assert.equal(findUnsupported('open news.example every morning'), null)
})

test('every stated limitation has a reason, and most have an alternative', () => {
  for (const item of UNSUPPORTED) {
    assert.ok(item.ask.length > 0)
    assert.ok(item.because.length > 10, item.ask)
  }
  assert.ok(UNSUPPORTED.every((u) => u.instead !== null), 'each one offers the nearest real thing')
})

test('readiness reports every reason at once, not the first', () => {
  const nothing = readiness({ kind: 'orion', prompt: 'x' }, {
    ...READY,
    orbisRunning: false,
    networkAvailable: false,
    hasModelKey: false
  })
  assert.equal(nothing.ready, false)
  assert.equal(nothing.reasons.length, 3)
  assert.equal(nothing.willResolveItself, false)
})

// ---------------------------------------------------------------- what a job must have to be kept

test('a job naming something Orbis cannot do is refused', () => {
  const bad = checkJob(job({ action: { kind: 'shell', command: 'rm -rf /' } as never }))
  assert.ok(bad.some((p) => /not something Orbis can do/.test(p)))
})

test('only web addresses are accepted, so a schedule is not a way to reach a file', () => {
  assert.ok(checkJob(job({ action: { kind: 'openUrl', url: 'file:///C:/secrets.txt', newTab: true } })).length > 0)
  assert.ok(checkJob(job({ action: { kind: 'openUrl', url: 'javascript:alert(1)', newTab: true } })).length > 0)
  assert.equal(checkJob(job()).length, 0)
})

test('every problem is reported at once, so a form can show them together', () => {
  const problems = checkJob(job({ name: '  ', policies: { ...DEFAULT_POLICIES, graceMinutes: -5, retry: { kind: 'backoff', attempts: 0, firstDelayMs: 1 } } }))
  assert.ok(problems.length >= 3, problems.join(' / '))
})

test('history is bounded, so it is not a disk leak with a nice name', () => {
  let held = job()
  for (let i = 0; i < 80; i++) held = withExecution(held, ran(NOW + i))
  assert.equal(held.history.length, 50)
  // The newest are kept, which is what anybody looking at it wants.
  assert.equal(held.history[held.history.length - 1].dueAt, NOW + 79)
})

test('each thing Orbis cannot do is matched to its own answer, not to the one next to it', () => {
  /**
   * The list is matched by position, so inserting an entry shifts every answer after it. This is the test that makes
   * that mistake fail here rather than showing up as somebody being told Orbis has no mail account when they asked
   * about a calendar.
   */
  const cases: readonly [string, RegExp][] = [
    ['run it while my computer is switched off', /switched off/i],
    ['run it while my laptop is asleep', /asleep/i],
    ['send a whatsapp to mum every sunday', /whatsapp|messaging/i],
    ['email the team every monday', /email/i],
    ['put it on my calendar every monday', /calendar/i],
    ['buy 10 bitcoin every friday', /buy, sell or transfer/i]
  ]
  for (const [said, expected] of cases) {
    const found = findUnsupported(said)
    assert.ok(found, said)
    assert.match(found.ask, expected, `“${said}” was answered with “${found.ask}”`)
  }
})

test('being asleep and being switched off are answered differently', () => {
  // One of them has an answer and the other does not, so giving both the same reply is wrong either way round.
  const asleep = findUnsupported('run it while my laptop is asleep')
  const off = findUnsupported('run it while my computer is switched off')
  assert.ok(asleep && off)
  assert.notEqual(asleep.because, off.because)
  assert.match(asleep.because, /can be woken/)
  assert.match(off.because, /no Orbis server/)
})
