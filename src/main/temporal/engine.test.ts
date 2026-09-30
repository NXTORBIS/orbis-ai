import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { DeviceState } from '../../shared/temporal/capability.ts'
import type { TemporalAction, TemporalJob } from '../../shared/temporal/job.ts'
import type { Schedule } from '../../shared/temporal/recurrence.ts'
import { TemporalEngine, lateText } from './engine.ts'
import { TemporalStore } from './store.ts'

/**
 * The clock, the store and the runners together.
 *
 * Written against a real store on a real temporary folder, because the faults worth catching here are about what
 * survives being written down: a run recorded twice, a job left saying "running" after a restart, an edit that erases
 * the rest of a schedule. A fake store would agree with whatever the engine did.
 *
 * Time is given rather than read, so a week happens in a millisecond.
 */

const READY: DeviceState = Object.freeze({
  orbisRunning: true,
  browserRunning: true,
  networkAvailable: true,
  onUnmeteredNetwork: true,
  onPower: true,
  batteryPercent: 90,
  idle: false,
  hasModelKey: true,
  hasTelegramToken: true
})

const PROFILE = 'default'
const DAILY_8AM: Schedule = { recurrence: { kind: 'daily', time: { hour: 8, minute: 0 } }, timeZone: 'UTC' }

async function bench(): Promise<{
  store: TemporalStore
  dir: string
  cleanup: () => Promise<void>
  ran: { action: TemporalAction; job: TemporalJob }[]
  notices: string[]
  clock: { at: number }
  device: { state: DeviceState }
  answer: { ok: boolean; detail?: string }
  engine: TemporalEngine
}> {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-temporal-'))
  const store = new TemporalStore(dir)
  const ran: { action: TemporalAction; job: TemporalJob }[] = []
  const notices: string[] = []
  const clock = { at: Date.UTC(2026, 5, 15, 12, 0, 0) }
  const device = { state: READY }
  const held = { ok: true as boolean, detail: undefined as string | undefined }

  const run = async (action: TemporalAction, job: TemporalJob) => {
    ran.push({ action, job })
    return { ok: held.ok, detail: held.detail }
  }

  const engine = new TemporalEngine({
    store,
    activeProfile: () => PROFILE,
    device: () => device.state,
    runners: { openUrl: run, notify: run, orion: run, workflow: run },
    onNotice: (_job, text) => notices.push(text),
    now: () => clock.at
  })

  return {
    store,
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
    ran,
    notices,
    clock,
    device,
    answer: held,
    engine
  }
}

const url = (): TemporalAction => ({ kind: 'openUrl', url: 'https://news.example', newTab: true })

// ---------------------------------------------------------------- running

test('a job that is due runs once, and once only however often the clock is looked at', async () => {
  const b = await bench()
  try {
    const made = await b.store.add(PROFILE, { name: 'Morning news', action: url(), schedule: DAILY_8AM }, b.clock.at - 86_400_000)
    assert.equal(made.ok, true)

    await b.engine.tick()
    assert.equal(b.ran.length, 1, 'ran the occurrence that was due')

    // Three more looks in the same minute. The occurrence is keyed by when it was due, so none of them runs it again.
    for (const step of [1000, 30_000, 60_000]) {
      b.clock.at += step
      await b.engine.tick()
    }
    assert.equal(b.ran.length, 1, 'still once')
  } finally {
    await b.cleanup()
  }
})

test('what happened is written down, against the moment it was due', async () => {
  const b = await bench()
  try {
    const made = await b.store.add(PROFILE, { name: 'Morning news', action: url(), schedule: DAILY_8AM }, b.clock.at - 86_400_000)
    assert.equal(made.ok, true)
    if (!made.ok) return

    await b.engine.tick()
    const after = await b.store.get(PROFILE, made.job.jobId)
    assert.ok(after)
    assert.equal(after.history.length, 1)
    assert.equal(after.history[0].state, 'completed')
    assert.equal(after.history[0].dueAt, Date.UTC(2026, 5, 15, 8, 0), 'when it was due, not when it ran')
    assert.equal(after.runsSoFar, 1)
    assert.equal(after.state, 'scheduled', 'back to waiting, since it repeats')
    assert.equal(after.nextRunAt, Date.UTC(2026, 5, 16, 8, 0))
  } finally {
    await b.cleanup()
  }
})

test('a run that was late is said to be late, rather than passing as on time', async () => {
  const b = await bench()
  try {
    await b.store.add(PROFILE, { name: 'Morning news', action: url(), schedule: DAILY_8AM }, b.clock.at - 86_400_000)
    await b.engine.tick()
    assert.equal(b.notices.length, 1)
    assert.match(b.notices[0], /4 hours late/)
    assert.match(b.notices[0], /not running when it was due/)
  } finally {
    await b.cleanup()
  }
})

test('a failure is written as a failure, and tried again', async () => {
  const b = await bench()
  try {
    const made = await b.store.add(PROFILE, { name: 'Morning news', action: url(), schedule: DAILY_8AM }, b.clock.at - 86_400_000)
    if (!made.ok) return
    b.answer.ok = false
    b.answer.detail = 'The site did not answer.'

    await b.engine.tick()
    let after = await b.store.get(PROFILE, made.job.jobId)
    assert.equal(after?.state, 'retrying')
    assert.equal(after?.history[0].state, 'failed')
    assert.equal(after?.history[0].detail, 'The site did not answer.')
    assert.equal(after?.runsSoFar, 0, 'a failure is not a run')

    // Too soon for the second attempt.
    b.clock.at += 5_000
    await b.engine.tick()
    assert.equal(b.ran.length, 1)

    // Past the wait, and it works this time.
    b.answer.ok = true
    b.clock.at += 60_000
    await b.engine.tick()
    assert.equal(b.ran.length, 2)
    after = await b.store.get(PROFILE, made.job.jobId)
    assert.equal(after?.state, 'scheduled')
    assert.equal(after?.history[1].attempt, 2)
    assert.equal(after?.history[1].dueAt, after?.history[0].dueAt, 'the same occurrence, tried again')
  } finally {
    await b.cleanup()
  }
})

test('a runner that throws is a failure, not a crash, and its message is capped', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-temporal-'))
  try {
    const store = new TemporalStore(dir)
    const clock = { at: Date.UTC(2026, 5, 15, 12, 0) }
    const engine = new TemporalEngine({
      store,
      activeProfile: () => PROFILE,
      device: () => READY,
      runners: {
        openUrl: async () => {
          throw new Error('x'.repeat(500))
        }
      },
      now: () => clock.at
    })
    const made = await store.add(PROFILE, { name: 'News', action: url(), schedule: DAILY_8AM }, clock.at - 86_400_000)
    if (!made.ok) return
    await engine.tick()
    const after = await store.get(PROFILE, made.job.jobId)
    assert.equal(after?.history[0].state, 'failed')
    assert.equal(after?.history[0].detail.length, 200, 'capped, so a store is not a place to put an essay')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an action with no runner blocks the job rather than silently never happening', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-temporal-'))
  try {
    const store = new TemporalStore(dir)
    const clock = { at: Date.UTC(2026, 5, 15, 12, 0) }
    const engine = new TemporalEngine({ store, activeProfile: () => PROFILE, device: () => READY, runners: {}, now: () => clock.at })
    const made = await store.add(PROFILE, { name: 'News', action: url(), schedule: DAILY_8AM }, clock.at - 86_400_000)
    if (!made.ok) return
    await engine.tick()
    const after = await store.get(PROFILE, made.job.jobId)
    assert.equal(after?.state, 'blocked')
    assert.equal(after?.history.length, 0, 'and nothing is recorded as having run')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------- when the machine cannot

test('a closed browser holds the job, and it runs when the browser opens', async () => {
  const b = await bench()
  try {
    const made = await b.store.add(PROFILE, { name: 'News', action: url(), schedule: DAILY_8AM }, b.clock.at - 86_400_000)
    if (!made.ok) return
    b.device.state = { ...READY, browserRunning: false }

    await b.engine.tick()
    assert.equal(b.ran.length, 0)
    assert.equal((await b.store.get(PROFILE, made.job.jobId))?.state, 'waitingForDevice')

    b.device.state = READY
    b.clock.at += 30_000
    await b.engine.tick()
    assert.equal(b.ran.length, 1, 'the occurrence was not lost while it waited')
  } finally {
    await b.cleanup()
  }
})

test('a reminder does not wait for the browser', async () => {
  const b = await bench()
  try {
    await b.store.add(
      PROFILE,
      { name: 'Stretch', action: { kind: 'notify', message: 'Stretch' }, schedule: DAILY_8AM },
      b.clock.at - 86_400_000
    )
    b.device.state = { ...READY, browserRunning: false }
    await b.engine.tick()
    assert.equal(b.ran.length, 1)
  } finally {
    await b.cleanup()
  }
})

// ---------------------------------------------------------------- what survives being written down

test('a job that was running when Orbis stopped goes back to waiting, not stuck', async () => {
  const b = await bench()
  try {
    const made = await b.store.add(PROFILE, { name: 'News', action: url(), schedule: DAILY_8AM }, b.clock.at - 86_400_000)
    if (!made.ok) return
    await b.store.setState(PROFILE, made.job.jobId, 'running')
    await b.store.flush()

    // A second store is a fresh start, which is what the next launch of Orbis is.
    const reopened = new TemporalStore(b.dir)
    const after = await reopened.get(PROFILE, made.job.jobId)
    assert.equal(after?.state, 'scheduled', 'nothing knows whether it finished, so it is decided again')
  } finally {
    await b.cleanup()
  }
})

test('changing one thing about a schedule keeps the rest', async () => {
  /**
   * The fault this merge exists to prevent, and one that has cost real data in this codebase before: a store that
   * rebuilds a record from a patch erases whatever the patch did not mention.
   */
  const b = await bench()
  try {
    const made = await b.store.add(
      PROFILE,
      { name: 'News', action: url(), schedule: DAILY_8AM, conditions: [{ kind: 'onWifi' }], policies: { catchUp: 'all' } },
      b.clock.at
    )
    if (!made.ok) return

    const changed = await b.store.update(PROFILE, made.job.jobId, { name: 'Morning news' }, b.clock.at)
    assert.equal(changed.ok, true)
    if (!changed.ok) return
    assert.equal(changed.job.name, 'Morning news')
    assert.deepEqual([...changed.job.conditions], [{ kind: 'onWifi' }], 'the condition survived')
    assert.equal(changed.job.policies.catchUp, 'all', 'so did the policy')
    assert.deepEqual(changed.job.schedule, DAILY_8AM)
    assert.equal(changed.job.version, 2)
  } finally {
    await b.cleanup()
  }
})

test('a schedule Orbis cannot keep is refused with a reason, not repaired', async () => {
  const b = await bench()
  try {
    const bad = await b.store.add(
      PROFILE,
      { name: 'Too often', action: url(), schedule: { recurrence: { kind: 'interval', everyMinutes: 0, from: 0 }, timeZone: 'UTC' } },
      b.clock.at
    )
    assert.equal(bad.ok, false)
    if (bad.ok) return
    assert.match(bad.problems[0], /shortest interval/)

    const nowhere = await b.store.add(
      PROFILE,
      { name: 'Nowhere', action: url(), schedule: { ...DAILY_8AM, timeZone: 'Mars/Olympus_Mons' } },
      b.clock.at
    )
    assert.equal(nowhere.ok, false)
    assert.equal((await b.store.all(PROFILE)).length, 0, 'and neither was kept')
  } finally {
    await b.cleanup()
  }
})

test('pausing stops it, and resuming works out when it is next due', async () => {
  const b = await bench()
  try {
    const made = await b.store.add(PROFILE, { name: 'News', action: url(), schedule: DAILY_8AM }, b.clock.at - 86_400_000)
    if (!made.ok) return
    await b.store.pause(PROFILE, made.job.jobId, null)
    await b.engine.tick()
    assert.equal(b.ran.length, 0)

    await b.store.resume(PROFILE, made.job.jobId, b.clock.at)
    const after = await b.store.get(PROFILE, made.job.jobId)
    assert.equal(after?.state, 'scheduled')
    assert.equal(after?.nextRunAt, Date.UTC(2026, 5, 16, 8, 0), 'tomorrow, since today at eight has gone')
  } finally {
    await b.cleanup()
  }
})

test('one skipped occurrence does not stop the ones after it', async () => {
  const b = await bench()
  try {
    const made = await b.store.add(PROFILE, { name: 'News', action: url(), schedule: DAILY_8AM }, b.clock.at - 86_400_000)
    if (!made.ok) return
    await b.store.skipOccurrence(PROFILE, made.job.jobId, Date.UTC(2026, 5, 15, 8, 0))
    await b.engine.tick()
    assert.equal(b.ran.length, 0)

    // Tomorrow morning, and it runs.
    b.clock.at = Date.UTC(2026, 5, 16, 8, 0)
    await b.engine.tick()
    assert.equal(b.ran.length, 1)
  } finally {
    await b.cleanup()
  }
})

test('a one-off runs once and is then finished', async () => {
  const b = await bench()
  try {
    const made = await b.store.add(
      PROFILE,
      {
        name: 'Call the dentist',
        action: { kind: 'notify', message: 'Call the dentist' },
        schedule: { recurrence: { kind: 'once', date: { year: 2026, month: 6, day: 15 }, time: { hour: 11, minute: 0 } }, timeZone: 'UTC' }
      },
      Date.UTC(2026, 5, 15, 10, 0)
    )
    if (!made.ok) return
    await b.engine.tick()
    assert.equal(b.ran.length, 1)

    b.clock.at += 3_600_000
    await b.engine.tick()
    assert.equal(b.ran.length, 1)
    const after = await b.store.get(PROFILE, made.job.jobId)
    assert.equal(after?.state, 'completed')
    assert.equal(after?.nextRunAt, null)
  } finally {
    await b.cleanup()
  }
})

test('one broken job does not stop the others being looked at', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-temporal-'))
  try {
    const store = new TemporalStore(dir)
    const clock = { at: Date.UTC(2026, 5, 15, 12, 0) }
    const done: string[] = []
    const engine = new TemporalEngine({
      store,
      activeProfile: () => PROFILE,
      device: () => READY,
      runners: {
        openUrl: async () => {
          throw new Error('no')
        },
        notify: async (action) => {
          done.push((action as { message: string }).message)
          return { ok: true }
        }
      },
      now: () => clock.at
    })
    await store.add(PROFILE, { name: 'Broken', action: url(), schedule: DAILY_8AM }, clock.at - 86_400_000)
    await store.add(PROFILE, { name: 'Fine', action: { kind: 'notify', message: 'Fine' }, schedule: DAILY_8AM }, clock.at - 86_400_000)
    await engine.tick()
    assert.deepEqual(done, ['Fine'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('how late something was, said in words', () => {
  assert.equal(lateText(60_000), '1 minute')
  assert.equal(lateText(25 * 60_000), '25 minutes')
  assert.equal(lateText(4 * 3_600_000), '4 hours')
  assert.equal(lateText(3 * 86_400_000), '3 days')
})
