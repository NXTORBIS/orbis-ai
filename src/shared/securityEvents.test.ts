import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanSecurityEvent,
  cleanSecurityEvents,
  describeSecurityEvent,
  isNotable,
  MAX_SECURITY_EVENTS,
  SECURITY_EVENT_KINDS,
  type SecurityEvent
} from './securityEvents.ts'

/**
 * The security log.
 *
 * Most of these tests are about what it refuses to hold. A log is the one place in a security feature where a secret gets
 * written down by accident and then kept, so the shape being narrow is the whole safety argument -- and a narrow shape is
 * only safe if it really drops what it does not recognise.
 */

// ---------------------------------------------------------------- what it refuses to hold

test('an address, a title or a password offered alongside a real event is dropped', () => {
  const cleaned = cleanSecurityEvent({
    kind: 'TAB_LOCKED',
    at: 1000,
    tabId: 4,
    url: 'https://bank.example/statement',
    title: 'Current account — £41,203.55',
    password: 'Banking',
    plaintext: 'correct horse battery staple',
    pageText: 'Balance: £41,203.55',
    screenshot: 'data:image/png;base64,AAA'
  })
  assert.ok(cleaned)
  // `password` is the *name* of a tab password -- the person's own word for it. Everything else is gone.
  assert.deepEqual(cleaned, { kind: 'TAB_LOCKED', at: 1000, tabId: 4, password: 'Banking' })
  const said = JSON.stringify(cleaned)
  for (const giveaway of ['bank.example', '41,203', 'correct horse', 'data:image', 'Current account']) {
    assert.ok(!said.includes(giveaway), `"${giveaway}" survived`)
  }
})

test('there is no field for a page, whatever it is called', () => {
  // Tried under several names, because the risk is somebody adding one that happens to pass through.
  for (const key of ['url', 'href', 'address', 'site', 'host', 'domain', 'title', 'text', 'content', 'secret', 'key']) {
    const cleaned = cleanSecurityEvent({ kind: 'TAB_LOCKED', [key]: 'https://bank.example/' })
    assert.ok(cleaned)
    assert.equal((cleaned as unknown as Record<string, unknown>)[key], undefined, `"${key}" got through`)
  }
})

test('an unknown kind is not recorded at all', () => {
  assert.equal(cleanSecurityEvent({ kind: 'PASSWORD_WAS', at: 1 }), null)
  assert.equal(cleanSecurityEvent({ kind: '', at: 1 }), null)
  assert.equal(cleanSecurityEvent({ at: 1 }), null)
})

test('nothing at all is nothing, rather than a throw', () => {
  for (const nonsense of [null, undefined, 'TAB_LOCKED', 42, []]) {
    assert.equal(cleanSecurityEvent(nonsense), null)
  }
})

// ---------------------------------------------------------------- what it does hold

test('every kind has something to say about it', () => {
  for (const kind of SECURITY_EVENT_KINDS) {
    const said = describeSecurityEvent({ kind, at: 0 })
    assert.ok(said.length > 0, `${kind} says nothing`)
    assert.notEqual(said, 'Something happened', `${kind} has no sentence of its own`)
  }
})

test('the trigger is added where it makes the sentence clearer, and left out where it does not', () => {
  assert.match(describeSecurityEvent({ kind: 'TAB_AUTO_LOCKED', at: 0, by: 'systemLock' }), /this computer locked/)
  assert.match(describeSecurityEvent({ kind: 'TAB_AUTO_LOCKED', at: 0, by: 'inactivity' }), /after inactivity/)
  // "A tab was locked manually" adds nothing, so the trigger is dropped rather than padded on.
  assert.equal(describeSecurityEvent({ kind: 'TAB_LOCKED', at: 0, by: 'manual' }), 'A tab was locked')
})

test('a password’s name appears, because that is what makes an event recognisable', () => {
  assert.match(
    describeSecurityEvent({ kind: 'TAB_PASSWORD_RESET', at: 0, password: 'Banking' }),
    /Banking/
  )
})

test('a count is shown only when there is more than one', () => {
  assert.match(describeSecurityEvent({ kind: 'PANIC_LOCK', at: 0, count: 4 }), /4 tabs/)
  assert.ok(!describeSecurityEvent({ kind: 'PANIC_LOCK', at: 0, count: 1 }).includes('1 tabs'))
})

test('a name longer than a name is cut, and an empty one is left out', () => {
  const long = cleanSecurityEvent({ kind: 'TAB_LOCKED', password: 'x'.repeat(200) })
  assert.equal(long?.password?.length, 60)
  assert.equal(cleanSecurityEvent({ kind: 'TAB_LOCKED', password: '   ' })?.password, undefined)
})

test('a tab id must be a whole number to be recorded', () => {
  assert.equal(cleanSecurityEvent({ kind: 'TAB_LOCKED', tabId: 4 })?.tabId, 4)
  assert.equal(cleanSecurityEvent({ kind: 'TAB_LOCKED', tabId: '4' })?.tabId, undefined)
  assert.equal(cleanSecurityEvent({ kind: 'TAB_LOCKED', tabId: 1.5 })?.tabId, undefined)
})

// ---------------------------------------------------------------- the things worth noticing

test('the failures and the irreversible things are the notable ones', () => {
  for (const kind of ['FAILED_TAB_UNLOCK', 'FAILED_ACCOUNT_UNLOCK', 'TAB_PASSWORD_RESET', 'TAB_UNPROTECTED'] as const) {
    assert.equal(isNotable(kind), true, `${kind} is not marked notable`)
  }
  // Ordinary use is not. A log that marks everything marks nothing.
  for (const kind of ['TAB_LOCKED', 'TAB_UNLOCKED', 'ACCOUNT_UNLOCKED', 'WINDOW_LOCK_DETECTED'] as const) {
    assert.equal(isNotable(kind), false, `${kind} is marked notable`)
  }
})

// ---------------------------------------------------------------- the list

test('a list comes back newest first', () => {
  const events = cleanSecurityEvents([
    { kind: 'TAB_LOCKED', at: 100 },
    { kind: 'TAB_UNLOCKED', at: 300 },
    { kind: 'PANIC_LOCK', at: 200 }
  ])
  assert.deepEqual(
    events.map((e) => e.at),
    [300, 200, 100]
  )
})

test('only what it is kept, and the newest are what survive', () => {
  const many: SecurityEvent[] = Array.from({ length: MAX_SECURITY_EVENTS + 120 }, (_unused, i) => ({
    kind: 'TAB_LOCKED',
    at: i
  }))
  const kept = cleanSecurityEvents(many)
  assert.equal(kept.length, MAX_SECURITY_EVENTS)
  assert.equal(kept[0].at, MAX_SECURITY_EVENTS + 119, 'the newest is first')
  assert.ok(kept.every((e) => e.at >= 120), 'the oldest were the ones dropped')
})

test('nonsense in a list is dropped without taking the list with it', () => {
  const kept = cleanSecurityEvents([
    { kind: 'TAB_LOCKED', at: 1 },
    null,
    'TAB_LOCKED',
    { kind: 'NOT_A_KIND', at: 2 },
    { kind: 'PANIC_LOCK', at: 3 }
  ])
  assert.deepEqual(
    kept.map((e) => e.kind),
    ['PANIC_LOCK', 'TAB_LOCKED']
  )
})

test('a list that is not a list is an empty one', () => {
  assert.deepEqual(cleanSecurityEvents(null), [])
  assert.deepEqual(cleanSecurityEvents({ events: [] }), [])
})
