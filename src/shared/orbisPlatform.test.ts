import test from 'node:test'
import assert from 'node:assert/strict'
import { asFailure, backoffMs, failure, respondTo } from './orbisError.ts'
import { createBus, newCorrelationId } from './orbisEvents.ts'
import type { OrbisEvent } from './orbisEvents.ts'

// ---------------------------------------------------------------- one vocabulary for failure

test('a control-layer code keeps its meaning in the shared vocabulary', () => {
  assert.equal(asFailure({ code: 'stale-element', message: 'gone' }).kind, 'stale')
  assert.equal(asFailure({ code: 'blocked', message: 'no' }).kind, 'security')
  assert.equal(asFailure({ code: 'verification-failed', message: 'x' }).kind, 'unverified')
  assert.equal(asFailure({ code: 'declined', message: 'no' }).kind, 'cancelled')
})

test('a helper code keeps its meaning too', () => {
  assert.equal(asFailure({ code: 'no-key', message: 'no key' }).kind, 'authentication')
  assert.equal(asFailure({ code: 'bad-request', message: 'bad' }).kind, 'validation')
  assert.equal(asFailure({ code: 'no-browser', message: 'none' }).kind, 'unavailable')
})

test('the shapes the platform itself throws are recognised', () => {
  assert.equal(asFailure(Object.assign(new Error('x'), { name: 'AbortError' })).kind, 'cancelled')
  assert.equal(asFailure(Object.assign(new Error('x'), { name: 'TimeoutError' })).kind, 'timeout')
  assert.equal(asFailure(Object.assign(new TypeError('fetch failed'), { name: 'TypeError' })).kind, 'network')
})

test('a code decides, even when the words suggest otherwise', () => {
  // A code is a fact; a message is prose. Reading the prose when a code exists is how meanings drift.
  const f = asFailure({ code: 'stale-element', message: 'permission denied somewhere in the text' })
  assert.equal(f.kind, 'stale')
})

test('with no code, the words are read, and say unknown when they say nothing', () => {
  assert.equal(asFailure('The request timed out').kind, 'timeout')
  assert.equal(asFailure('ECONNREFUSED').kind, 'network')
  assert.equal(asFailure('Permission denied').kind, 'permission')
  assert.equal(asFailure('something odd happened').kind, 'unknown')
})

test('anything at all can be turned into a failure, because failures arrive from everywhere', () => {
  for (const thrown of [null, undefined, 42, 'a string', {}, new Error('x')]) {
    const f = asFailure(thrown)
    assert.ok(f.kind, `no kind for ${String(thrown)}`)
    assert.equal(typeof f.message, 'string')
  }
})

test('what is retryable and what needs a person are decided in one place', () => {
  assert.deepEqual(
    { r: failure('timeout', 'x').retryable, u: failure('timeout', 'x').userFixable },
    { r: true, u: false }
  )
  // A permission refusal is never retried: doing the same thing again cannot change the answer.
  assert.deepEqual(
    { r: failure('permission', 'x').retryable, u: failure('permission', 'x').userFixable },
    { r: false, u: true }
  )
  assert.equal(failure('security', 'x').retryable, false)
})

test('the response to a failure follows from its kind, not from its message', () => {
  assert.equal(respondTo(failure('timeout', 'x'), 0), 'retry')
  assert.equal(respondTo(failure('stale', 'x'), 0), 'refresh')
  assert.equal(respondTo(failure('authentication', 'x'), 0), 'ask-user')
  assert.equal(respondTo(failure('cancelled', 'x'), 0), 'stop')
  assert.equal(respondTo(failure('unavailable', 'x'), 0), 'stop')
})

test('retrying stops rather than going round forever', () => {
  assert.equal(respondTo(failure('timeout', 'x'), 3), 'stop')
  assert.equal(respondTo(failure('stale', 'x'), 3), 'stop')
})

test('backing off grows and then stops growing, so a failing provider is not hammered', () => {
  assert.ok(backoffMs(0) < backoffMs(1))
  assert.ok(backoffMs(1) < backoffMs(2))
  assert.equal(backoffMs(50), backoffMs(60), 'it reaches a ceiling')
})

// ---------------------------------------------------------------- one place things are announced

test('a subscriber hears what it asked for and nothing else', () => {
  const bus = createBus()
  const heard: string[] = []
  bus.subscribe({ names: ['tab.created'] }, (e) => heard.push(e.name))
  bus.publish('tab.created', {})
  bus.publish('tab.closed', {})
  assert.deepEqual(heard, ['tab.created'])
})

test('a subscriber with no filter hears everything', () => {
  const bus = createBus()
  let count = 0
  bus.subscribe({}, () => { count += 1 })
  bus.publish('tab.created', {})
  bus.publish('download.failed', {})
  assert.equal(count, 2)
})

test('one profile never hears another profile’s events', () => {
  // Isolation that relies on every listener remembering to check is not isolation.
  const bus = createBus()
  const heard: string[] = []
  bus.subscribe({ profileId: 'a' }, (e) => heard.push(String(e.profileId)))
  bus.publish('tab.created', {}, { profileId: 'a' })
  bus.publish('tab.created', {}, { profileId: 'b' })
  assert.deepEqual(heard, ['a'])
})

test('a listener that throws does not stop the others', () => {
  const problems: unknown[] = []
  const bus = createBus({ onListenerError: (error) => problems.push(error) })
  let reached = false
  bus.subscribe({}, () => { throw new Error('broken subscriber') })
  bus.subscribe({}, () => { reached = true })
  bus.publish('tab.created', {})
  assert.equal(reached, true, 'the second listener still ran')
  assert.equal(problems.length, 1, 'and the breakage was reported rather than swallowed')
})

test('a one-shot listener hears once and detaches itself', () => {
  const bus = createBus()
  let count = 0
  bus.subscribe({ once: true }, () => { count += 1 })
  bus.publish('tab.created', {})
  bus.publish('tab.created', {})
  assert.equal(count, 1)
  assert.equal(bus.listenerCount(), 0, 'it let go of itself')
})

test('unsubscribing works, and a listener that unsubscribes mid-delivery does not break the walk', () => {
  const bus = createBus()
  let second = 0
  const off = bus.subscribe({}, () => off())
  bus.subscribe({}, () => { second += 1 })
  bus.publish('tab.created', {})
  assert.equal(second, 1)
  assert.equal(bus.listenerCount(), 1)
})

test('events tied to one request can be followed, and two requests told apart', () => {
  const bus = createBus()
  const mine = newCorrelationId()
  const theirs = newCorrelationId()
  assert.notEqual(mine, theirs)
  const heard: OrbisEvent[] = []
  bus.subscribe({ correlationId: mine }, (e) => heard.push(e))
  bus.publish('workflow.started', {}, { correlationId: mine })
  bus.publish('workflow.started', {}, { correlationId: theirs })
  assert.equal(heard.length, 1)
})

test('throttling drops what arrives too fast, keeping the first', () => {
  let clock = 0
  const bus = createBus({ now: () => clock })
  const heard: number[] = []
  bus.subscribe({ throttleMs: 100 }, (e) => heard.push(e.at))
  bus.publish('page.changed', {})
  clock = 50
  bus.publish('page.changed', {})
  clock = 150
  bus.publish('page.changed', {})
  assert.deepEqual(heard, [0, 150])
})

test('debouncing waits for quiet and keeps the newest', async () => {
  const bus = createBus()
  const heard: unknown[] = []
  bus.subscribe({ debounceMs: 20 }, (e) => heard.push(e.detail))
  bus.publish('page.changed', 'first')
  bus.publish('page.changed', 'second')
  bus.publish('page.changed', 'last')
  assert.deepEqual(heard, [], 'nothing yet')
  await new Promise((r) => setTimeout(r, 45))
  assert.deepEqual(heard, ['last'])
})

test('priority decides who hears first, for the rare listener that must', () => {
  const bus = createBus()
  const order: string[] = []
  bus.subscribe({}, () => order.push('ordinary'))
  bus.subscribe({ priority: 10 }, () => order.push('first'))
  bus.publish('tab.created', {})
  assert.deepEqual(order, ['first', 'ordinary'])
})

test('the bus remembers recent events for diagnosis, and is bounded', () => {
  const bus = createBus({ keep: 3 })
  for (const n of [1, 2, 3, 4, 5]) bus.publish('tab.created', n)
  const recent = bus.recent()
  assert.equal(recent.length, 3, 'bounded, so it cannot grow without limit')
  assert.deepEqual(recent.map((e) => e.detail), [3, 4, 5])
})

test('every event carries where it came from and when, without being asked', () => {
  const bus = createBus({ now: () => 1234 })
  const event = bus.publish('search.completed', { q: 'x' }, { source: 'search' })
  assert.equal(event.source, 'search')
  assert.equal(event.at, 1234)
  assert.ok(event.id)
})
