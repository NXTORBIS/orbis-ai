import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanProfileLockPolicy,
  DEFAULT_PROFILE_LOCK,
  describeProfileLock,
  nextProfileLockAt,
  PROFILE_LOCK_PRESETS,
  PROFILE_LOCK_TRIGGERS,
  shouldLockProfile,
  stayLockedAfterSystemUnlock,
  type ProfileLockPolicy
} from './profileLock.ts'

/**
 * When the whole profile locks.
 *
 * Every trigger here corresponds to a real Electron event or reading. These tests are about the decisions those events
 * lead to -- and above all about the two that are easy to get backwards: a profile that locks when nobody asked it to,
 * and a profile that does not lock when somebody did.
 */

const policy = (over: Partial<ProfileLockPolicy> = {}): ProfileLockPolicy => ({
  ...DEFAULT_PROFILE_LOCK,
  enabled: true,
  ...over
})

const at = (trigger: Parameters<typeof shouldLockProfile>[1]['trigger'], sinceMs = 0) => ({ trigger, sinceMs })

// ---------------------------------------------------------------- off means off

test('with Profile Lock off, nothing locks the profile by itself', () => {
  const off = { ...DEFAULT_PROFILE_LOCK, enabled: false }
  for (const trigger of PROFILE_LOCK_TRIGGERS) {
    if (trigger === 'manual') continue
    assert.equal(
      shouldLockProfile(off, at(trigger, 24 * 60 * 60 * 1000), false),
      false,
      `${trigger} locked a profile whose lock is off`
    )
  }
})

test('asking for it locks it even with the feature off', () => {
  // Somebody asked. Refusing on the grounds that a setting is off would be refusing to do the safe thing.
  assert.equal(shouldLockProfile({ ...DEFAULT_PROFILE_LOCK, enabled: false }, at('manual'), false), true)
})

test('the default is off, so nobody meets a password prompt they did not ask for', () => {
  assert.equal(DEFAULT_PROFILE_LOCK.enabled, false)
})

test('an already-locked profile is not locked again', () => {
  for (const trigger of PROFILE_LOCK_TRIGGERS) {
    assert.equal(shouldLockProfile(policy(), at(trigger, 60 * 60 * 1000), true), false, `${trigger} locked it twice`)
  }
})

// ---------------------------------------------------------------- the triggers

test('idleness locks it once the delay has passed, and not before', () => {
  const p = policy({ inactivity: 60_000 })
  assert.equal(shouldLockProfile(p, at('inactivity', 59_999), false), false)
  assert.equal(shouldLockProfile(p, at('inactivity', 60_000), false), true)
})

test('a null delay means never, however long it has been', () => {
  const p = policy({ inactivity: null, onBlur: null })
  assert.equal(shouldLockProfile(p, at('inactivity', 7 * 24 * 60 * 60 * 1000), false), false)
  assert.equal(shouldLockProfile(p, at('blur', 7 * 24 * 60 * 60 * 1000), false), false)
})

test('a zero delay means the instant it happens', () => {
  assert.equal(shouldLockProfile(policy({ onBlur: 0 }), at('blur', 0), false), true)
})

test('start, resume, system lock and the last window closing each have their own switch', () => {
  const on = policy({ onStart: true, onResume: true, onSystemLock: true, onAllWindowsClosed: true })
  const off = policy({ onStart: false, onResume: false, onSystemLock: false, onAllWindowsClosed: false })
  for (const trigger of ['start', 'resume', 'systemLock', 'allWindowsClosed'] as const) {
    assert.equal(shouldLockProfile(on, at(trigger), false), true, `${trigger} did not lock when switched on`)
    assert.equal(shouldLockProfile(off, at(trigger), false), false, `${trigger} locked when switched off`)
  }
})

// ---------------------------------------------------------------- coming back to the computer

test('only "require-password" locks the profile when the computer unlocks', () => {
  assert.equal(shouldLockProfile(policy({ afterSystemUnlock: 'require-password' }), at('systemUnlock'), false), true)
  assert.equal(shouldLockProfile(policy({ afterSystemUnlock: 'stay-locked' }), at('systemUnlock'), false), false)
  assert.equal(shouldLockProfile(policy({ afterSystemUnlock: 'restore' }), at('systemUnlock'), false), false)
})

test('"restore" is the only setting that lets the computer unlocking open Orbis again', () => {
  assert.equal(stayLockedAfterSystemUnlock(policy({ afterSystemUnlock: 'restore' })), false)
  assert.equal(stayLockedAfterSystemUnlock(policy({ afterSystemUnlock: 'stay-locked' })), true)
  assert.equal(stayLockedAfterSystemUnlock(policy({ afterSystemUnlock: 'require-password' })), true)
})

// ---------------------------------------------------------------- one timer

test('the timer is set for the sooner of idleness and losing focus', () => {
  const now = 1_000_000
  const p = policy({ inactivity: 60_000, onBlur: 10_000 })
  // Idle for 5 seconds already, and focus lost 1 second ago.
  const due = nextProfileLockAt(p, { idleSinceMs: 5_000, blurredAt: now - 1_000 }, now)
  assert.equal(due, now + 9_000, 'the blur delay is the sooner of the two')
})

test('the idle timer is measured from when the computer became idle, not from now', () => {
  const now = 1_000_000
  const p = policy({ inactivity: 60_000, onBlur: null })
  assert.equal(nextProfileLockAt(p, { idleSinceMs: 50_000 }, now), now + 10_000)
})

test('nothing owed means no timer at all', () => {
  const now = 1_000_000
  assert.equal(nextProfileLockAt(policy({ inactivity: null, onBlur: null }), { idleSinceMs: 5_000 }, now), null)
  assert.equal(nextProfileLockAt(policy(), {}, now), null, 'with nothing measured from, nothing is owed')
})

test('a profile lock that is off sets no timer, whatever the delays say', () => {
  const now = 1_000_000
  const off = { ...DEFAULT_PROFILE_LOCK, enabled: false, inactivity: 1_000, onBlur: 0 }
  assert.equal(nextProfileLockAt(off, { idleSinceMs: 10_000, blurredAt: now }, now), null)
})

// ---------------------------------------------------------------- reading one back

test('a policy from a file keeps what it can and falls back for the rest', () => {
  const read = cleanProfileLockPolicy(
    { enabled: true, inactivity: 30_000, afterSystemUnlock: 'require-password', onBlur: 'soon' },
    DEFAULT_PROFILE_LOCK
  )
  assert.equal(read.enabled, true)
  assert.equal(read.inactivity, 30_000)
  assert.equal(read.afterSystemUnlock, 'require-password')
  assert.equal(read.onBlur, DEFAULT_PROFILE_LOCK.onBlur, 'nonsense fell back rather than becoming a delay')
})

test('null survives, because null is a real answer and not a missing one', () => {
  assert.equal(cleanProfileLockPolicy({ inactivity: null }).inactivity, null)
})

test('a delay longer than a day is a day, and a negative one is nothing', () => {
  assert.equal(cleanProfileLockPolicy({ inactivity: 99 * 60 * 60 * 1000 }).inactivity, 24 * 60 * 60 * 1000)
  assert.equal(cleanProfileLockPolicy({ onBlur: -5 }).onBlur, 0)
})

test('an unknown unlock behaviour is not honoured', () => {
  assert.equal(cleanProfileLockPolicy({ afterSystemUnlock: 'open-everything' }).afterSystemUnlock, 'stay-locked')
})

test('nothing at all is the default, rather than a throw', () => {
  assert.deepEqual(cleanProfileLockPolicy(undefined), DEFAULT_PROFILE_LOCK)
  assert.deepEqual(cleanProfileLockPolicy(null), DEFAULT_PROFILE_LOCK)
  assert.deepEqual(cleanProfileLockPolicy('yes' as unknown), DEFAULT_PROFILE_LOCK)
})

// ---------------------------------------------------------------- presets

test('every preset is on, because a preset nobody switched on does nothing', () => {
  for (const [name, preset] of Object.entries(PROFILE_LOCK_PRESETS)) {
    assert.equal(preset.enabled, true, `${name} was off`)
  }
})

test('the presets really get stricter rather than only being named so', () => {
  const idle = (p: ProfileLockPolicy): number => p.inactivity ?? Number.POSITIVE_INFINITY
  assert.ok(idle(PROFILE_LOCK_PRESETS.standard) > idle(PROFILE_LOCK_PRESETS.strong))
  assert.ok(idle(PROFILE_LOCK_PRESETS.strong) > idle(PROFILE_LOCK_PRESETS['shared-computer']))
  assert.equal(PROFILE_LOCK_PRESETS['shared-computer'].onBlur, 0)
})

// ---------------------------------------------------------------- saying what it does

test('an off policy says so plainly', () => {
  assert.deepEqual(describeProfileLock({ ...DEFAULT_PROFILE_LOCK, enabled: false }), [
    'Orbis does not lock itself.'
  ])
})

test('a policy that is on but has nothing switched on inside it admits that', () => {
  // The case people do not notice: it looks protected and is not.
  const hollow = policy({
    inactivity: null,
    onBlur: null,
    onStart: false,
    onResume: false,
    onSystemLock: false,
    onAllWindowsClosed: false,
    afterSystemUnlock: 'stay-locked'
  })
  const said = describeProfileLock(hollow)
  assert.equal(said.length, 1)
  assert.match(said[0], /nothing is set to trigger it/)
})

test('what is on is what is said, and nothing else is', () => {
  const said = describeProfileLock(policy({ inactivity: 300_000, onBlur: null, onAllWindowsClosed: false }))
  assert.ok(said.some((line) => line.includes('5 minutes')))
  assert.ok(!said.some((line) => line.includes('window in front')), 'said something about a trigger that is off')
  assert.ok(!said.some((line) => line.includes('last Orbis window')))
})
