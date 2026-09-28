import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TabLockWatcher, type TabInfo } from './tabLockWatcher.ts'
import {
  DEFAULT_POLICY,
  POLICY_PRESETS,
  type DomainRule,
  type LockTrigger,
  type TabLockPolicy
} from '../shared/tabLock.ts'

/**
 * What actually locks a tab, and when.
 *
 * The decisions live in `shared/tabLock.ts` and are tested there. These are about the bookkeeping: that the right moment
 * is measured from, that one timer covers every tab, that a closed credential locks everything it covered without
 * anybody walking the tab list, and that the interface is told each time something changes.
 */

/** A clock and the single timer slot the watcher is allowed, so no test waits for a real second. */
const clockWithTimer = (): {
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
  watcher: TabLockWatcher
  changes: { tabId: number; locked: boolean; reason: LockTrigger | null }[]
  setPolicy(groupId: string, policy: TabLockPolicy): void
  setRules(rules: DomainRule[]): void
  close(groupId: string): void
  open(groupId: string): void
}

const harness = (
  clock: ReturnType<typeof clockWithTimer>,
  fallback: TabLockPolicy = DEFAULT_POLICY
): Harness => {
  const groups = new Map<string, TabLockPolicy>()
  let rules: DomainRule[] = []
  const closed = new Set<string>()
  const changes: Harness['changes'] = []

  const watcher = new TabLockWatcher({
    config: () => ({ groups, rules, fallback }),
    isGroupOpen: (groupId) => !closed.has(groupId),
    onChanged: (tabId, locked, reason) => changes.push({ tabId, locked, reason }),
    now: clock.now,
    // Handing the timer to the test clock is most of what there is to check about a single shared timer: whether one was
    // set at all, and for when.
    schedule: (atMs, run) => {
      clock.set({ at: atMs, run })
      return () => clock.set(null)
    }
  })

  return {
    watcher,
    changes,
    setPolicy: (groupId, policy) => groups.set(groupId, policy),
    setRules: (next) => {
      rules = next
    },
    close: (groupId) => closed.add(groupId),
    open: (groupId) => closed.delete(groupId)
  }
}

const tab = (tabId: number, url = 'https://example.com/page', title = 'Example'): TabInfo => ({
  tabId,
  url,
  title,
  favicon: 'https://example.com/favicon.ico'
})

// ---------------------------------------------------------------- protecting

test('a tab asked to lock is locked, and the interface is told once', () => {
  const clock = clockWithTimer()
  const { watcher, changes } = harness(clock)
  watcher.protect(1, 'personal')
  assert.equal(watcher.isLocked(1), true)
  assert.equal(watcher.isProtected(1), true)
  assert.deepEqual(changes, [{ tabId: 1, locked: true, reason: 'manual' }])
})

test('an unprotected tab is never locked, whatever the policy says', () => {
  const clock = clockWithTimer()
  const { watcher } = harness(clock, POLICY_PRESETS.maximum)
  assert.equal(watcher.isLocked(9), false)
  assert.equal(watcher.mayRead(9), true)
  watcher.focusChanged(false)
  assert.equal(watcher.isLocked(9), false)
})

test('locking a tab twice does not tell the interface twice', () => {
  const clock = clockWithTimer()
  const { watcher, changes } = harness(clock)
  watcher.protect(1, 'personal')
  assert.equal(watcher.lock(1, 'panic'), false)
  assert.equal(changes.length, 1)
})

test('unprotecting is the only thing that stops protection; nothing automatic does it', () => {
  const clock = clockWithTimer()
  const { watcher } = harness(clock, POLICY_PRESETS.maximum)
  watcher.protect(1, 'personal', false)
  watcher.focusChanged(false)
  assert.equal(watcher.isLocked(1), true, 'blur locked it')
  assert.equal(watcher.isProtected(1), true, 'and it is still protected')
  watcher.unprotect(1)
  assert.equal(watcher.isProtected(1), false)
})

// ---------------------------------------------------------------- the credential

test('a credential that is not open means its tabs are locked, whatever was last recorded', () => {
  const clock = clockWithTimer()
  const h = harness(clock)
  h.watcher.protect(1, 'personal', false)
  assert.equal(h.watcher.isLocked(1), false)
  h.close('personal')
  // Nothing walked the tab list. Closing the credential is enough, which is what makes switching profile safe.
  assert.equal(h.watcher.isLocked(1), true)
  assert.equal(h.watcher.mayRead(1), false)
})

test('closing one credential leaves another alone', () => {
  const clock = clockWithTimer()
  const h = harness(clock)
  h.watcher.protect(1, 'personal', false)
  h.watcher.protect(2, 'work', false)
  h.close('personal')
  assert.equal(h.watcher.isLocked(1), true)
  assert.equal(h.watcher.isLocked(2), false)
})

test('locking a credential locks every tab it covers and no others', () => {
  const clock = clockWithTimer()
  const h = harness(clock)
  h.watcher.protect(1, 'personal', false)
  h.watcher.protect(2, 'personal', false)
  h.watcher.protect(3, 'work', false)
  assert.equal(h.watcher.lockGroup('personal'), 2)
  assert.equal(h.watcher.isLocked(3), false)
})

test('panic locks everything protected at once', () => {
  const clock = clockWithTimer()
  const h = harness(clock)
  h.watcher.protect(1, 'personal', false)
  h.watcher.protect(2, 'work', false)
  h.watcher.protect(3, 'work')
  // Three protected, one already locked: two change.
  assert.equal(h.watcher.panic(), 2)
  assert.equal(
    h.watcher.all().every((t) => t.locked),
    true
  )
})

// ---------------------------------------------------------------- the policy in force

test('a tab override beats its credential, which beats the profile default', () => {
  const clock = clockWithTimer()
  const h = harness(clock, { ...DEFAULT_POLICY, inactivity: 60_000, label: 'Profile' })
  h.setPolicy('personal', { ...DEFAULT_POLICY, inactivity: 30_000, label: 'Group' })
  h.watcher.protect(1, 'personal', false)
  assert.equal(h.watcher.policyFor(1).inactivity, 30_000)
  assert.equal(h.watcher.policyFor(1).label, 'Group')
  h.watcher.setTabPolicy(1, { inactivity: 5_000 })
  assert.equal(h.watcher.policyFor(1).inactivity, 5_000)
  assert.equal(h.watcher.policyFor(1).label, 'Group', 'fields it did not set still come from the group')
})

// ---------------------------------------------------------------- what the triggers measure from

test('leaving a tab locks it after its delay, and the tab arrived at is not "left"', () => {
  const clock = clockWithTimer()
  const h = harness(clock, { ...DEFAULT_POLICY, tabSwitch: 10_000, inactivity: null })
  h.watcher.protect(1, 'personal', false)
  h.watcher.protect(2, 'personal', false)

  h.watcher.activated(2) // tab 1 was left
  assert.equal(h.watcher.isLocked(1), false, 'not yet -- the delay has not passed')

  clock.at(clock.now() + 9_999)
  h.watcher.activated(2)
  assert.equal(h.watcher.isLocked(1), false)

  clock.at(clock.now() + 2)
  h.watcher.activated(2)
  assert.equal(h.watcher.isLocked(1), true)
  assert.equal(h.watcher.isLocked(2), false, 'the tab in front was never switched away from')
})

test('coming back to a tab restarts its leaving clock', () => {
  const clock = clockWithTimer()
  const h = harness(clock, { ...DEFAULT_POLICY, tabSwitch: 10_000, inactivity: null })
  h.watcher.protect(1, 'personal', false)
  h.watcher.activated(2)
  clock.at(clock.now() + 9_000)
  h.watcher.activated(1) // back to it
  clock.at(clock.now() + 9_000)
  h.watcher.activated(2)
  assert.equal(h.watcher.isLocked(1), false, '18 seconds passed, but never 10 away from it')
})

test('a zero delay means the instant it happens', () => {
  const clock = clockWithTimer()
  const h = harness(clock, { ...DEFAULT_POLICY, tabSwitch: 0 })
  h.watcher.protect(1, 'personal', false)
  h.watcher.activated(2)
  assert.equal(h.watcher.isLocked(1), true)
})

test('a null delay means never, however long it is', () => {
  const clock = clockWithTimer()
  const h = harness(clock, {
    ...DEFAULT_POLICY,
    tabSwitch: null,
    windowBlur: null,
    inactivity: null,
    minimize: null
  })
  h.watcher.protect(1, 'personal', false)
  h.watcher.activated(2)
  clock.at(clock.now() + 7 * 24 * 60 * 60 * 1000)
  h.watcher.activated(2)
  h.watcher.focusChanged(false)
  h.watcher.minimizeChanged(true)
  assert.equal(h.watcher.isLocked(1), false)
  assert.equal(clock.pending(), null, 'and nothing was scheduled, because nothing is owed')
})

test('losing focus locks the tab in front too', () => {
  // The whole point. A protected tab being looked at when somebody alt-tabs away is exactly the case that matters.
  const clock = clockWithTimer()
  const h = harness(clock, { ...DEFAULT_POLICY, windowBlur: 0 })
  h.watcher.protect(1, 'personal', false)
  h.watcher.activated(1)
  h.watcher.focusChanged(false)
  assert.equal(h.watcher.isLocked(1), true)
})

test('regaining focus forgets the blur, so a later blur is timed from the later one', () => {
  const clock = clockWithTimer()
  const h = harness(clock, { ...DEFAULT_POLICY, windowBlur: 10_000, inactivity: null })
  h.watcher.protect(1, 'personal', false)
  h.watcher.focusChanged(false)
  clock.at(clock.now() + 9_000)
  h.watcher.focusChanged(true)
  clock.at(clock.now() + 9_000)
  h.watcher.focusChanged(false)
  assert.equal(h.watcher.isLocked(1), false)
})

test('minimising is timed from the minimise, and restoring forgets it', () => {
  const clock = clockWithTimer()
  const h = harness(clock, { ...DEFAULT_POLICY, minimize: 5_000, inactivity: null })
  h.watcher.protect(1, 'personal', false)
  h.watcher.minimizeChanged(true)
  assert.equal(clock.pending(), clock.now() + 5_000)
  h.watcher.minimizeChanged(false)
  assert.equal(clock.pending(), null)
})

test('doing something in a tab restarts its inactivity clock', () => {
  const clock = clockWithTimer()
  const h = harness(clock, { ...DEFAULT_POLICY, inactivity: 10_000 })
  h.watcher.protect(1, 'personal', false)
  clock.at(clock.now() + 9_000)
  h.watcher.interacted(1)
  assert.equal(clock.pending(), clock.now() + 10_000, 'the timer moved with the activity')
})

test('the system locking locks protected tabs, with no delay to wait out', () => {
  const clock = clockWithTimer()
  const h = harness(clock, { ...DEFAULT_POLICY, onSystemLock: true })
  h.watcher.protect(1, 'personal', false)
  assert.equal(h.watcher.systemLocked(), 1)
  assert.equal(h.watcher.isLocked(1), true)
})

test('a policy that says not to lock on system lock is honoured', () => {
  const clock = clockWithTimer()
  const h = harness(clock, { ...DEFAULT_POLICY, onSystemLock: false })
  h.watcher.protect(1, 'personal', false)
  assert.equal(h.watcher.systemLocked(), 0)
  assert.equal(h.watcher.isLocked(1), false)
})

test('sleep and startup each have their own switch', () => {
  const clock = clockWithTimer()
  const h = harness(clock, { ...DEFAULT_POLICY, onSleep: false, onStartup: true })
  h.watcher.protect(1, 'personal', false)
  assert.equal(h.watcher.systemSuspended(), 0)
  assert.equal(h.watcher.started(), 1)
})

test('the reason a tab locked is remembered, so the lock screen can say it', () => {
  const clock = clockWithTimer()
  const h = harness(clock, { ...DEFAULT_POLICY, windowBlur: 0 })
  h.watcher.protect(1, 'personal', false)
  h.watcher.focusChanged(false)
  assert.equal(h.changes.at(-1)?.reason, 'windowBlur')
  assert.equal(h.watcher.all()[0].lockedBy, 'windowBlur')
})

// ---------------------------------------------------------------- one timer

test('one timer is set for the soonest thing owed across every tab', () => {
  const clock = clockWithTimer()
  const h = harness(clock, { ...DEFAULT_POLICY, inactivity: 60_000 })
  h.watcher.protect(1, 'personal', false)
  const first = clock.pending()
  h.setPolicy('work', { ...DEFAULT_POLICY, inactivity: 5_000 })
  h.watcher.protect(2, 'work', false)
  const second = clock.pending()
  assert.ok(first !== null && second !== null)
  assert.equal(second, clock.now() + 5_000, 'the sooner of the two')
  assert.ok(second < first)
})

test('when the timer comes round the tab that is owed locks, and the next one is set', () => {
  const clock = clockWithTimer()
  const h = harness(clock, { ...DEFAULT_POLICY, inactivity: 60_000 })
  h.watcher.protect(1, 'personal', false)
  h.setPolicy('work', { ...DEFAULT_POLICY, inactivity: 5_000 })
  h.watcher.protect(2, 'work', false)

  clock.fire()
  assert.equal(h.watcher.isLocked(2), true, 'the five-second one locked')
  assert.equal(h.watcher.isLocked(1), false, 'the sixty-second one did not')
  // Tab 1 is still owed, so a timer is still set -- in the past now, because the clock jumped, which is exactly what a
  // real one does after a long sleep.
  assert.notEqual(clock.pending(), null)
})

test('a locked tab is not timed for again', () => {
  const clock = clockWithTimer()
  const h = harness(clock, { ...DEFAULT_POLICY, inactivity: 5_000 })
  h.watcher.protect(1, 'personal')
  assert.equal(clock.pending(), null, 'it is already locked; there is nothing to wait for')
})

test('unlocking starts the clocks again', () => {
  const clock = clockWithTimer()
  const h = harness(clock, { ...DEFAULT_POLICY, inactivity: 5_000 })
  h.watcher.protect(1, 'personal')
  assert.equal(clock.pending(), null)
  h.watcher.markUnlocked(1)
  assert.equal(clock.pending(), clock.now() + 5_000)
})

test('stopping cancels the timer, and resetting forgets every tab', () => {
  const clock = clockWithTimer()
  const h = harness(clock, { ...DEFAULT_POLICY, inactivity: 5_000 })
  h.watcher.protect(1, 'personal', false)
  assert.notEqual(clock.pending(), null)
  h.watcher.stop()
  assert.equal(clock.pending(), null)
  h.watcher.reset()
  assert.equal(h.watcher.all().length, 0)
  assert.equal(h.watcher.isProtected(1), false)
})

test('a tab that has gone leaves no lock surface behind', () => {
  const clock = clockWithTimer()
  const h = harness(clock)
  h.watcher.protect(1, 'personal')
  const before = h.changes.length
  h.watcher.forget(1)
  assert.equal(h.changes.length, before, 'nothing to tell the interface about a tab that no longer exists')
  assert.equal(h.watcher.isProtected(1), false)
})

// ---------------------------------------------------------------- rules

test('a rule protects a tab when it navigates somewhere the rule covers', () => {
  const clock = clockWithTimer()
  const h = harness(clock)
  h.setRules([{ id: 'r1', pattern: '*.bank.example', enabled: true, groupId: 'money', schedule: null }])
  h.watcher.applyRules(tab(1, 'https://secure.bank.example/accounts'))
  assert.equal(h.watcher.isLocked(1), true)
  assert.equal(h.watcher.groupOf(1), 'money')
})

test('a rule leaves an address it does not cover alone', () => {
  const clock = clockWithTimer()
  const h = harness(clock)
  h.setRules([{ id: 'r1', pattern: 'bank.example', enabled: true, groupId: 'money', schedule: null }])
  h.watcher.applyRules(tab(1, 'https://news.example/today'))
  assert.equal(h.watcher.isProtected(1), false)
})

test('a rule does not move an already-protected tab to a different credential', () => {
  const clock = clockWithTimer()
  const h = harness(clock)
  h.setRules([{ id: 'r1', pattern: 'bank.example', enabled: true, groupId: 'money', schedule: null }])
  h.watcher.protect(1, 'personal')
  h.watcher.applyRules(tab(1, 'https://bank.example/'))
  assert.equal(h.watcher.groupOf(1), 'personal', 'it kept the credential its owner chose')
})

test('navigating away from a protected site keeps the protection', () => {
  // Otherwise one redirect would be enough to unprotect a tab.
  const clock = clockWithTimer()
  const h = harness(clock)
  h.setRules([{ id: 'r1', pattern: 'bank.example', enabled: true, groupId: 'money', schedule: null }])
  h.watcher.applyRules(tab(1, 'https://bank.example/'))
  h.watcher.applyRules(tab(1, 'https://news.example/'))
  assert.equal(h.watcher.isProtected(1), true)
  assert.equal(h.watcher.isLocked(1), true)
})

test('a rule that is switched off protects nothing', () => {
  const clock = clockWithTimer()
  const h = harness(clock)
  h.setRules([{ id: 'r1', pattern: 'bank.example', enabled: false, groupId: 'money', schedule: null }])
  h.watcher.applyRules(tab(1, 'https://bank.example/'))
  assert.equal(h.watcher.isProtected(1), false)
})

// ---------------------------------------------------------------- what may be said

test('a locked tab describes itself without giving anything away', () => {
  const clock = clockWithTimer()
  const h = harness(clock)
  h.watcher.protect(1, 'personal')
  const safe = h.watcher.describe(tab(1, 'https://bank.example/accounts/41203', 'Current account — £41,203.55'))
  assert.equal(safe.locked, true)
  assert.equal(safe.url, null)
  assert.equal(safe.favicon, null)
  assert.equal(safe.contentAvailable, false)
  assert.equal(safe.previewAvailable, false)
  const said = JSON.stringify(safe)
  for (const giveaway of ['bank.example', '41,203', '41203', 'Current account']) {
    assert.ok(!said.includes(giveaway), `"${giveaway}" leaked`)
  }
})

test('an unlocked protected tab describes itself normally', () => {
  const clock = clockWithTimer()
  const h = harness(clock)
  h.watcher.protect(1, 'personal', false)
  const safe = h.watcher.describe(tab(1, 'https://bank.example/accounts', 'Current account'))
  assert.equal(safe.locked, false)
  assert.equal(safe.url, 'https://bank.example/accounts')
  assert.equal(safe.title, 'Current account')
  assert.equal(safe.contentAvailable, true)
})

test('a list of tabs is safe as a list, not just one at a time', () => {
  const clock = clockWithTimer()
  const h = harness(clock)
  h.watcher.protect(2, 'personal')
  const safe = h.watcher.describeAll([
    tab(1, 'https://news.example/', 'The news'),
    tab(2, 'https://bank.example/', 'My money'),
    tab(3, 'https://docs.example/', 'Notes')
  ])
  assert.deepEqual(
    safe.map((s) => s.url),
    ['https://news.example/', null, 'https://docs.example/']
  )
  assert.ok(!JSON.stringify(safe).includes('bank.example'))
})

test('nothing may read a locked tab, whatever it is', () => {
  const clock = clockWithTimer()
  const h = harness(clock)
  h.watcher.protect(1, 'personal')
  assert.equal(h.watcher.mayRead(1), false)
  h.watcher.markUnlocked(1)
  assert.equal(h.watcher.mayRead(1), true)
})

test('a locked tab that has been reopened is still locked after a reset and re-protect', () => {
  // Session restore: the watcher is told again, and protection is the starting state rather than something earned back.
  const clock = clockWithTimer()
  const h = harness(clock)
  h.watcher.protect(1, 'personal', false)
  h.watcher.reset()
  h.watcher.protect(1, 'personal', true, 'startup')
  assert.equal(h.watcher.isLocked(1), true)
  assert.equal(h.watcher.all()[0].lockedBy, 'startup')
})
