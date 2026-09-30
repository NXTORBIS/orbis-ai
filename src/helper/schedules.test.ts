import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_POLICIES, TEMPORAL_FORMAT, type TemporalJob } from '../shared/temporal/job.ts'
import { createScheduleHandlers, type SchedulesHelperDeps } from './schedules.ts'

/**
 * Schedules as the browser sees them.
 *
 * The two things worth pinning down: that a closed Orbis window is reported as a closed window rather than as an
 * empty list, and that a page in the browser cannot ask for anything the phrase reader would not produce. The second
 * is what keeps the whole surface safe -- there is no channel here that takes an action, only one that takes words.
 */

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
    updatedAt: NOW,
    version: 1,
    nextRunAt: NOW + 3_600_000,
    lastRunAt: null,
    runsSoFar: 3,
    history: [
      {
        executionId: 'e1',
        dueAt: NOW - 86_400_000,
        startedAt: NOW - 86_400_000,
        finishedAt: NOW - 86_400_000 + 500,
        state: 'completed',
        attempt: 1,
        detail: 'Done.'
      }
    ],
    skipped: [],
    ...over
  }
}

function bench(jobs: TemporalJob[] = [job()]) {
  const calls: string[] = []
  const deps: SchedulesHelperDeps = {
    all: async () => jobs,
    add: async (asked) => {
      calls.push(`add:${asked.action.kind}`)
      return { ok: true, job: { ...job(), name: asked.name, action: asked.action, schedule: asked.schedule } }
    },
    pause: async (jobId, until) => {
      calls.push(`pause:${jobId}:${until ?? 'open'}`)
      return { ...job(), state: 'paused' }
    },
    resume: async (jobId) => {
      calls.push(`resume:${jobId}`)
      return job()
    },
    remove: async (jobId) => {
      calls.push(`remove:${jobId}`)
      return true
    },
    skip: async (jobId, dueAt) => {
      calls.push(`skip:${jobId}:${dueAt}`)
      return job()
    },
    look: () => calls.push('look')
  }
  return { deps, calls, handlers: createScheduleHandlers(() => deps), closed: createScheduleHandlers(() => null) }
}

// ---------------------------------------------------------------- when Orbis is not running

test('a closed Orbis window is said to be closed, never shown as an empty list', async () => {
  /**
   * The fault this guards. An empty list reads as "you have no schedules", and somebody only finds out it was wrong
   * when a reminder never arrives -- by which time the moment has gone.
   */
  const { closed } = bench()
  for (const channel of ['schedules:list', 'schedules:upcoming', 'schedules:add', 'schedules:pause', 'schedules:remove']) {
    await assert.rejects(async () => closed[channel]([{ phrase: 'remind me to stretch every hour', jobId: 'j1' }]), /not running/, channel)
  }
})

test('reading a phrase works with the window shut, because it needs no store', async () => {
  // Which is what lets somebody see what Orbis makes of a sentence before opening anything.
  const { closed } = bench()
  const answer = (await closed['schedules:read']([{ phrase: 'remind me to stretch every day at 8am' }])) as { ok: boolean; said: string }
  assert.equal(answer.ok, true)
  assert.match(answer.said, /every day at 8am/)
})

// ---------------------------------------------------------------- listing

test('what crosses is what the panel draws, and not the history', async () => {
  /**
   * The history is the part that grows, and a page in the browser has no use for every past run. Sending only what
   * is drawn keeps the message small and means the browser is not holding a copy of everything that has happened.
   */
  const { handlers } = bench()
  const answer = (await handlers['schedules:list']([{}])) as { jobs: Record<string, unknown>[] }
  assert.equal(answer.jobs.length, 1)
  const one = answer.jobs[0]
  assert.equal(one.name, 'Morning news')
  assert.equal(one.actionKind, 'openUrl')
  assert.equal(one.lastOutcome, 'completed', 'the last outcome, rather than every run')
  assert.ok(!('history' in one))
  assert.ok(!('action' in one), 'not the action itself, which could hold an address or a message')
  assert.ok(!('policies' in one))
})

test('what is coming is answered across every schedule at once', async () => {
  const { handlers } = bench([job(), job({ jobId: 'j2', name: 'Weekly review' })])
  const answer = (await handlers['schedules:upcoming']([{ days: 3 }])) as { upcoming: { name: string }[] }
  assert.ok(answer.upcoming.length > 0)
  assert.ok(answer.upcoming.some((u) => u.name === 'Weekly review'))
})

test('the number of days asked for is held between one and ninety', async () => {
  const { handlers } = bench()
  for (const days of [0, -5, 9999, 'lots']) {
    const answer = (await handlers['schedules:upcoming']([{ days }])) as { upcoming: unknown[] }
    assert.ok(Array.isArray(answer.upcoming), String(days))
  }
})

// ---------------------------------------------------------------- keeping one

test('a schedule is made from words, never from an action the browser handed over', async () => {
  /**
   * The channel takes a phrase and nothing else. That is what stops a page asking for a kind of action the reader
   * would never produce, and it means every schedule that exists came from words somebody can be shown back.
   */
  const { handlers, calls } = bench()
  const kept = (await handlers['schedules:add']([
    { phrase: 'remind me to stretch every day at 8am', action: { kind: 'shell', command: 'rm -rf /' } }
  ])) as { ok: boolean; said: string }
  assert.equal(kept.ok, true)
  assert.ok(calls.includes('add:notify'), calls.join(','))
  assert.ok(!calls.some((c) => c.includes('shell')))
})

test('a sentence Orbis cannot keep is refused with its reason, and nothing is stored', async () => {
  const { handlers, calls } = bench()
  const refused = (await handlers['schedules:add']([{ phrase: 'remind me every other tuesday' }])) as { ok: boolean; why: string }
  assert.equal(refused.ok, false)
  assert.ok(refused.why.length > 0)
  assert.equal(calls.length, 0)
})

test('something Orbis genuinely cannot do says what it cannot do', async () => {
  const { handlers } = bench()
  const refused = (await handlers['schedules:add']([{ phrase: 'send a whatsapp to mum every sunday at 6pm' }])) as {
    ok: boolean
    why: string
  }
  assert.equal(refused.ok, false)
  assert.match(refused.why, /business account/)
})

test('keeping one asks the scheduler to look straight away', async () => {
  // So something due in a minute does not wait for the next half-minute pass.
  const { handlers, calls } = bench()
  await handlers['schedules:add']([{ phrase: 'remind me to stretch every day at 8am' }])
  assert.ok(calls.includes('look'))
})

// ---------------------------------------------------------------- changing one

test('pausing, resuming, skipping and deleting reach the store with what was asked', async () => {
  const { handlers, calls } = bench()
  await handlers['schedules:pause']([{ jobId: 'j1', until: NOW + 3_600_000 }])
  await handlers['schedules:resume']([{ jobId: 'j1' }])
  await handlers['schedules:skip']([{ jobId: 'j1', dueAt: NOW + 7_200_000 }])
  await handlers['schedules:remove']([{ jobId: 'j1' }])
  assert.ok(calls.includes(`pause:j1:${NOW + 3_600_000}`))
  assert.ok(calls.includes('resume:j1'))
  assert.ok(calls.includes(`skip:j1:${NOW + 7_200_000}`))
  assert.ok(calls.includes('remove:j1'))
})

test('a schedule that no longer exists is answered, not crashed over', async () => {
  const handlers = createScheduleHandlers(() => ({
    all: async () => [],
    add: async () => ({ ok: false, problems: ['no'] }),
    pause: async () => null,
    resume: async () => null,
    remove: async () => false,
    skip: async () => null,
    look: () => undefined
  }))
  const answer = (await handlers['schedules:pause']([{ jobId: 'gone' }])) as { ok: boolean; problems: string[] }
  assert.equal(answer.ok, false)
  assert.match(answer.problems[0], /no longer exists/)
})

test('a missing or odd argument does not throw', async () => {
  const { handlers } = bench()
  for (const args of [[], [null], ['a string'], [{ jobId: 42 }]]) {
    const answer = await handlers['schedules:remove'](args as unknown[])
    assert.ok(answer !== undefined, JSON.stringify(args))
  }
})

test('there is no channel that switches on staying alive or waking the computer', () => {
  /**
   * Those are decisions somebody makes in Settings with the wording in front of them. A page in a browser changing
   * how a computer behaves is not something to offer over a websocket, and the way to be sure of that is for the
   * channel not to exist.
   */
  const { handlers } = bench()
  const names = Object.keys(handlers)
  assert.ok(!names.some((n) => /wake|hibernate|power|alive|setting/i.test(n)), names.join(','))
  assert.deepEqual(names.sort(), [
    'schedules:add',
    'schedules:list',
    'schedules:pause',
    'schedules:read',
    'schedules:remove',
    'schedules:resume',
    'schedules:skip',
    'schedules:upcoming'
  ])
})
