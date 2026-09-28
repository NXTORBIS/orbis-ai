import { test } from 'node:test'
import assert from 'node:assert/strict'
import { idleCheckInterval, ProfileLockWatcher } from './profileLockWatcher.ts'
import { DEFAULT_PROFILE_LOCK, type ProfileLockPolicy, type ProfileLockTrigger } from '../shared/profileLock.ts'

/**
 * What actually locks the profile.
 *
 * The decisions are tested in `shared/profileLock.test.ts`. These are about the watching: that the right clock is read,
 * that one timer covers both waiting triggers, that a sleep or a session unlock does not leave a stale clock behind, and
 * that locking twice does not produce two lock screens.
 */

const world = (): {
  at(ms: number): void
  now(): number
  pending(): number | null
  fire(): void
  set(job: { at: number; run: () => void } | null): void
} => {
  let clock = 1_000_000
  let due: { at: number; run: () => void } | null = null
  return {
    at: (ms) => {
      clock = ms
    },
    now: () => clock,
    pending: () => due?.at ?? null,
    fire: () => {
      const job = due
      due = null
      if (!job) throw new Error('nothing was scheduled')
      clock = Math.max(clock, job.at)
      job.run()
    },
    set: (job) => {
      due = job
    }
  }
}

interface Harness {
  watcher: ProfileLockWatcher
  locks: ProfileLockTrigger[]
  setPolicy(policy: Partial<ProfileLockPolicy>): void
  setIdle(ms: number | null): void
  unlock(): void
}

const harness = (clock: ReturnType<typeof world>, initial: Partial<ProfileLockPolicy> = {}): Harness => {
  let policy: ProfileLockPolicy = { ...DEFAULT_PROFILE_LOCK, enabled: true, ...initial }
  let idle: number | null = 0
  let locked = false
  const locks: ProfileLockTrigger[] = []

  const watcher = new ProfileLockWatcher({
    policy: () => policy,
    isLocked: () => locked,
    lock: (trigger) => {
      locks.push(trigger)
      locked = true
    },
    idleMs: () => idle,
    now: clock.now,
    schedule: (atMs, run) => {
      clock.set({ at: atMs, run })
      return () => clock.set(null)
    }
  })

  return {
    watcher,
    locks,
    setPolicy: (over) => {
      policy = { ...policy, ...over }
      watcher.policyChanged()
    },
    setIdle: (ms) => {
      idle = ms
    },
    unlock: () => {
      locked = false
      watcher.unlocked()
    }
  }
}

// ---------------------------------------------------------------- asking

test('asking locks it, and says which trigger it was', () => {
  const clock = world()
  const h = harness(clock)
  assert.equal(h.watcher.lockNow(), true)
  assert.deepEqual(h.locks, ['manual'])
})

test('asking locks it even with Profile Lock switched off, and even after stopping', () => {
  // Somebody asked. A stopped watcher has stopped watching; it has not stopped taking instructions.
  const clock = world()
  const h = harness(clock, { enabled: false })
  h.watcher.stop()
  assert.equal(h.watcher.lockNow(), true)
  assert.deepEqual(h.locks, ['manual'])
})

test('locking an already-locked profile does nothing, so there is never a second lock screen', () => {
  const clock = world()
  const h = harness(clock)
  h.watcher.lockNow()
  assert.equal(h.watcher.lockNow(), false)
  assert.equal(h.watcher.systemLocked(), false)
  assert.equal(h.locks.length, 1)
})

// ---------------------------------------------------------------- the switch triggers

test('start, the computer locking, waking, and the last window closing each lock when switched on', () => {
  for (const [trigger, run] of [
    ['start', (w: ProfileLockWatcher) => w.started()],
    ['systemLock', (w: ProfileLockWatcher) => w.systemLocked()],
    ['resume', (w: ProfileLockWatcher) => w.resumed()],
    ['allWindowsClosed', (w: ProfileLockWatcher) => w.allWindowsClosed()]
  ] as const) {
    const clock = world()
    const h = harness(clock, { onStart: true, onResume: true, onSystemLock: true, onAllWindowsClosed: true })
    assert.equal(run(h.watcher), true, `${trigger} did not lock`)
    assert.deepEqual(h.locks, [trigger])
  }
})

test('each of those is honoured when switched off', () => {
  const clock = world()
  const h = harness(clock, {
    onStart: false,
    onResume: false,
    onSystemLock: false,
    onAllWindowsClosed: false
  })
  assert.equal(h.watcher.started(), false)
  assert.equal(h.watcher.systemLocked(), false)
  assert.equal(h.watcher.resumed(), false)
  assert.equal(h.watcher.allWindowsClosed(), false)
  assert.deepEqual(h.locks, [])
})

test('with Profile Lock off, none of them lock it', () => {
  const clock = world()
  const h = harness(clock, { enabled: false, onStart: true, onSystemLock: true, onResume: true })
  assert.equal(h.watcher.started(), false)
  assert.equal(h.watcher.systemLocked(), false)
  assert.equal(h.watcher.resumed(), false)
  assert.deepEqual(h.locks, [])
})

// ---------------------------------------------------------------- losing focus

test('losing focus locks it after its delay, timed from the blur', () => {
  const clock = world()
  const h = harness(clock, { onBlur: 30_000, inactivity: null })
  h.watcher.start()
  assert.equal(h.watcher.focusChanged(false), false, 'not at once -- the delay has not passed')
  assert.equal(clock.pending(), clock.now() + 30_000)
  clock.fire()
  assert.deepEqual(h.locks, ['blur'])
})

test('a zero blur delay locks the moment focus is lost', () => {
  const clock = world()
  const h = harness(clock, { onBlur: 0, inactivity: null })
  h.watcher.start()
  assert.equal(h.watcher.focusChanged(false), true)
  assert.deepEqual(h.locks, ['blur'])
})

test('coming back cancels it, and a later blur is timed from the later one', () => {
  const clock = world()
  const h = harness(clock, { onBlur: 30_000, inactivity: null })
  h.watcher.start()
  h.watcher.focusChanged(false)
  clock.at(clock.now() + 29_000)
  h.watcher.focusChanged(true)
  assert.equal(clock.pending(), null, 'nothing is owed while Orbis is in front')
  clock.at(clock.now() + 29_000)
  h.watcher.focusChanged(false)
  assert.deepEqual(h.locks, [], '58 seconds passed but never 30 out of focus')
})

test('the computer locking and then unlocking does not count as having been out of focus all that time', () => {
  // Otherwise every session lock longer than the blur delay would lock Orbis by the back door, whatever the blur setting
  // said -- and somebody who had set "never lock on blur" would find it locking on blur.
  const clock = world()
  const h = harness(clock, { onBlur: 30_000, inactivity: null, onSystemLock: false, afterSystemUnlock: 'restore' })
  h.watcher.start()
  h.watcher.focusChanged(false)
  clock.at(clock.now() + 10 * 60_000)
  assert.equal(h.watcher.systemUnlocked(), false)
  assert.deepEqual(h.locks, [])
  assert.equal(clock.pending(), null, 'and the blur clock was forgotten rather than left running')
})

test('waking from sleep forgets the blur clock too', () => {
  const clock = world()
  const h = harness(clock, { onBlur: 30_000, inactivity: null, onResume: false })
  h.watcher.start()
  h.watcher.focusChanged(false)
  clock.at(clock.now() + 60 * 60_000)
  assert.equal(h.watcher.resumed(), false)
  assert.deepEqual(h.locks, [])
})

// ---------------------------------------------------------------- idleness

test('idleness is read from the operating system, not guessed from what Orbis saw', () => {
  const clock = world()
  const h = harness(clock, { inactivity: 60_000, onBlur: null })
  h.watcher.start()
  // The computer has been idle for 59 seconds. Orbis itself has seen nothing either way.
  h.setIdle(59_000)
  clock.fire()
  assert.deepEqual(h.locks, [])
  h.setIdle(61_000)
  clock.fire()
  assert.deepEqual(h.locks, ['inactivity'])
})

test('when the system cannot say how idle it is, inactivity does not lock at all', () => {
  // A guess here would be a profile locking while somebody was using the computer.
  const clock = world()
  const h = harness(clock, { inactivity: 1_000, onBlur: null })
  h.setIdle(null)
  h.watcher.start()
  assert.equal(clock.pending(), null, 'nothing to wait for, because nothing can be measured')
  assert.deepEqual(h.locks, [])
})

test('a null inactivity means never, however idle the computer is', () => {
  const clock = world()
  const h = harness(clock, { inactivity: null, onBlur: null })
  h.setIdle(10 * 60 * 60 * 1000)
  h.watcher.start()
  assert.equal(clock.pending(), null)
})

test('the idle check is four looks per delay, clamped, rather than a poll', () => {
  // A quarter of the delay: that is what bounds how late a lock can be to a quarter of what was asked for.
  assert.equal(idleCheckInterval(15 * 60_000), 225_000)
  assert.equal(idleCheckInterval(60_000), 15_000)
  // And never faster than every fifteen seconds, whatever the delay.
  assert.equal(idleCheckInterval(1_000), 15_000)
  assert.equal(idleCheckInterval(0), 15_000)
  // Nor slower than every five minutes, so an hour-long policy is still accurate to within five.
  assert.equal(idleCheckInterval(24 * 60 * 60 * 1000), 5 * 60_000)
})

test('the timer is set for the sooner of idleness and the blur', () => {
  const clock = world()
  const h = harness(clock, { inactivity: 15 * 60_000, onBlur: 20_000 })
  h.setIdle(0)
  h.watcher.start()
  const idleOnly = clock.pending()
  h.watcher.focusChanged(false)
  const both = clock.pending()
  assert.ok(idleOnly !== null && both !== null)
  assert.equal(both, clock.now() + 20_000, 'the blur is sooner')
  assert.ok(both < idleOnly)
})

// ---------------------------------------------------------------- the clock's own housekeeping

test('a locked profile has no timer running', () => {
  const clock = world()
  const h = harness(clock, { inactivity: 60_000 })
  h.watcher.start()
  assert.notEqual(clock.pending(), null)
  h.watcher.lockNow()
  assert.equal(clock.pending(), null, 'the next thing that matters is somebody typing the password')
})

test('unlocking starts the clocks again from a person having just been there', () => {
  const clock = world()
  const h = harness(clock, { inactivity: 60_000, onBlur: 10_000 })
  h.watcher.start()
  h.watcher.focusChanged(false)
  h.watcher.lockNow()
  assert.equal(clock.pending(), null)
  h.unlock()
  assert.notEqual(clock.pending(), null)
  // The blur was forgotten: somebody has just typed a password into this window.
  clock.at(clock.now() + 11_000)
  clock.fire()
  assert.ok(!h.locks.includes('blur'), 'it locked on a blur from before it was unlocked')
})

test('changing the policy takes effect without waiting out the old delay', () => {
  const clock = world()
  const h = harness(clock, { inactivity: 60 * 60_000, onBlur: null })
  h.setIdle(0)
  h.watcher.start()
  const before = clock.pending()
  h.setPolicy({ inactivity: 60_000 })
  const after = clock.pending()
  assert.ok(before !== null && after !== null && after < before)
})

test('switching Profile Lock off stops the clock', () => {
  const clock = world()
  const h = harness(clock, { inactivity: 60_000 })
  h.watcher.start()
  assert.notEqual(clock.pending(), null)
  h.setPolicy({ enabled: false })
  assert.equal(clock.pending(), null)
})

test('stopping cancels the timer, and a stopped watcher locks nothing by itself', () => {
  const clock = world()
  const h = harness(clock, { inactivity: 60_000, onSystemLock: true })
  h.watcher.start()
  h.watcher.stop()
  assert.equal(clock.pending(), null)
  assert.equal(h.watcher.systemLocked(), false)
  assert.deepEqual(h.locks, [])
})

test('what should happen when the computer unlocks is reported, not decided here', () => {
  const clock = world()
  const h = harness(clock, { afterSystemUnlock: 'restore' })
  assert.equal(h.watcher.staysLockedAfterSystemUnlock(), false)
  h.setPolicy({ afterSystemUnlock: 'stay-locked' })
  assert.equal(h.watcher.staysLockedAfterSystemUnlock(), true)
})

test('requiring the password on every system unlock does exactly that', () => {
  const clock = world()
  const h = harness(clock, { afterSystemUnlock: 'require-password', onSystemLock: false })
  h.watcher.start()
  assert.equal(h.watcher.systemUnlocked(), true)
  assert.deepEqual(h.locks, ['systemUnlock'])
})
