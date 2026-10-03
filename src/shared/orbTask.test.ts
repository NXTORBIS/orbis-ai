import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_REPEATS,
  MAX_TRIES,
  classifyFailure,
  decideRecovery,
  describeOutcome,
  groundPlan,
  needsConfirming,
  newTask,
  nextPass,
  ready,
  runnable,
  settle,
  stuck
} from './orbTask.ts'
import type { OrbStep } from './orbTask.ts'
import type { CapabilityDescriptor } from './browserControl.ts'

const cap = (id: string, extra: Partial<CapabilityDescriptor> = {}): CapabilityDescriptor => ({
  id,
  domain: 'tabs' as CapabilityDescriptor['domain'],
  name: id,
  description: id,
  params: { url: { type: 'string', description: 'where' } },
  mutates: true,
  effects: ['read'],
  confirmation: 'none',
  requires: [],
  provider: 'window',
  available: true,
  ...extra
})

const step = (id: string, capability: string, extra: Partial<OrbStep> = {}): OrbStep => ({
  id,
  name: id,
  capability,
  params: {},
  needs: [],
  status: 'planned',
  tries: 0,
  ...extra
})

// ---------------------------------------------------------------- success means the browser said so

test('a command that succeeded and was verified is done', () => {
  const s = settle(step('a', 'tabs.create'), { ok: true, verification: { verified: true, detail: 'the tab is open' }, attempts: 1 })
  assert.equal(s.status, 'done')
  assert.equal(s.failure, undefined)
})

test('a command that returned ok but was never verified is NOT success', () => {
  // The control layer checks its own work. A capability that did not check has not shown that anything happened, and
  // reporting it as done would be telling somebody something false about their browser.
  const s = settle(step('a', 'tabs.create'), { ok: true, attempts: 1 })
  assert.equal(s.status, 'failed')
  assert.equal(s.failure?.kind, 'unverified')
})

test('a command that returned ok but failed its own verification is not success either', () => {
  const s = settle(step('a', 'tabs.create'), { ok: true, verification: { verified: false, detail: 'no such tab afterwards' }, attempts: 1 })
  assert.equal(s.status, 'failed')
  assert.equal(s.failure?.message, 'no such tab afterwards')
})

// ---------------------------------------------------------------- failures are told apart

test('every control error code becomes a kind that decides something', () => {
  assert.equal(classifyFailure({ code: 'stale-element', message: '', recoverable: true }), 'stale')
  assert.equal(classifyFailure({ code: 'blocked', message: '', recoverable: false }), 'blocked')
  assert.equal(classifyFailure({ code: 'declined', message: '', recoverable: false }), 'declined')
  assert.equal(classifyFailure({ code: 'verification-failed', message: '', recoverable: true }), 'unverified')
  assert.equal(classifyFailure(undefined), 'unknown')
})

test('a protection that refused is never retried, and never pushed at', () => {
  assert.equal(decideRecovery('blocked', 1, true), 'ask-user')
  assert.equal(decideRecovery('blocked', 3, true), 'ask-user')
})

test('a person who said no is not asked again', () => {
  assert.equal(decideRecovery('declined', 1, true), 'give-up')
})

test('a stale reference is looked at again rather than repeated', () => {
  assert.equal(decideRecovery('stale', 1, true), 're-perceive')
})

test('something the browser cannot do now is re-planned, not retried', () => {
  assert.equal(decideRecovery('unavailable', 1, true), 're-plan')
  assert.equal(decideRecovery('unknown-capability', 1, true), 're-plan')
})

test('only what the control layer called recoverable is retried', () => {
  assert.equal(decideRecovery('unknown', 1, true), 'retry')
  assert.equal(decideRecovery('unknown', 1, false), 're-plan')
})

test('retrying stops', () => {
  assert.equal(decideRecovery('unknown', MAX_TRIES, true), 'give-up')
  assert.equal(decideRecovery('stale', MAX_TRIES, true), 're-plan')
})

test('stopping is the end of it', () => {
  assert.equal(decideRecovery('aborted', 0, true), 'give-up')
})

// ---------------------------------------------------------------- a plan may only use what exists

test('a capability the browser does not have cannot be planned', () => {
  const { steps, refused } = groundPlan([step('a', 'downloads.deleteAll')], [cap('tabs.create')])
  assert.equal(steps.length, 0)
  assert.match(refused[0].why, /no capability called downloads\.deleteAll/)
})

test('a capability that is unavailable is refused in the browser’s own words', () => {
  const { steps, refused } = groundPlan([step('a', 'page.click')], [cap('page.click', { available: false, unavailableReason: 'There is no web page in front.' })])
  assert.equal(steps.length, 0)
  assert.equal(refused[0].why, 'There is no web page in front.')
})

test('a step that needed a refused step is refused with it, rather than leaving half a plan', () => {
  const plan = [step('a', 'nope.thing'), step('b', 'tabs.create', { needs: ['a'] })]
  const { steps, refused } = groundPlan(plan, [cap('tabs.create')])
  assert.equal(steps.length, 0)
  assert.equal(refused.length, 2)
})

test('parameters the capability does not declare are dropped rather than passed on', () => {
  const { steps } = groundPlan([step('a', 'tabs.create', { params: { url: 'https://example.com', nonsense: 1 } })], [cap('tabs.create')])
  assert.deepEqual(steps[0].params, { url: 'https://example.com' })
})

test('what needs asking first comes from each capability’s own policy', () => {
  const caps = [cap('tabs.create'), cap('downloads.remove', { confirmation: 'always' })]
  const gates = needsConfirming([step('a', 'tabs.create'), step('b', 'downloads.remove')], caps)
  assert.deepEqual(gates.map((s) => s.capability), ['downloads.remove'])
})

test('"when consequential" asks about what cannot be undone, and not about what can', () => {
  const caps = [
    cap('tabs.create', { confirmation: 'when-consequential' }),
    cap('history.clear', { confirmation: 'when-consequential' })
  ]
  const gates = needsConfirming([step('a', 'tabs.create'), step('b', 'history.clear')], caps)
  // Asking before opening a tab is how an assistant becomes one nobody lets near their browser.
  assert.deepEqual(gates.map((s) => s.capability), ['history.clear'])
})

// ---------------------------------------------------------------- order, dependencies and what may run together

test('a step waits for what it needs', () => {
  const steps = [step('a', 'tabs.create'), step('b', 'page.read', { needs: ['a'] })]
  assert.equal(ready(steps[1], steps), false)
  steps[0] = { ...steps[0], status: 'done' }
  assert.equal(ready(steps[1], steps), true)
})

test('two things that change the browser never run at the same time', () => {
  const caps = [cap('tabs.create'), cap('tabs.close')]
  const go = runnable([step('a', 'tabs.create'), step('b', 'tabs.close')], caps)
  assert.equal(go.length, 1)
})

test('reading is safe together, so reads go in parallel', () => {
  const caps = [cap('page.read', { mutates: false }), cap('tabs.list', { mutates: false })]
  const go = runnable([step('a', 'page.read'), step('b', 'tabs.list')], caps)
  assert.equal(go.length, 2)
})

test('a plan that cannot get any further says so', () => {
  const steps = [step('a', 'tabs.create', { status: 'failed' }), step('b', 'page.read', { needs: ['a'] })]
  assert.equal(stuck(steps), true)
})

// ---------------------------------------------------------------- saying what happened

test('anything unfinished means the task did not succeed, whatever else went right', () => {
  const task = newTask('t', 'do a thing')
  task.steps = [
    step('a', 'tabs.create', { status: 'done' }),
    step('b', 'page.click', { status: 'failed', failure: { kind: 'not-found', message: 'No button matched.', recovery: 'give-up' } })
  ]
  const said = describeOutcome(task)
  assert.match(said, /did not finish/i)
  assert.match(said, /No button matched/)
  assert.doesNotMatch(said, /^Done/)
})

test('a task where everything was confirmed says so, and says it was confirmed', () => {
  const task = newTask('t', 'do a thing')
  task.steps = [step('a', 'tabs.create', { status: 'done' }), step('b', 'page.read', { status: 'done' })]
  assert.match(describeOutcome(task), /2 steps, each confirmed by the browser/)
})

test('a task with no steps does not claim to have done anything', () => {
  assert.equal(describeOutcome(newTask('t', 'x')), 'Nothing was done.')
})

// ---------------------------------------------------------------- going round again

const done = (one: OrbStep): OrbStep => ({ ...one, status: 'done', tries: 1, result: { ok: true, attempts: 1 } })

test('a finished group with passes left goes round again, and its steps start clean', () => {
  /**
   * "Watch the next five Shorts" is one plan run five times, not five plans. The steps are reset rather than
   * rebuilt -- and what they did last time is dropped on purpose, because a result from the previous Short is not
   * evidence about this one. Leaving it would make a loop look like it had already verified a thing it has not done.
   */
  const steps = [
    done(step('a', 'media.waitFor', { group: 'watch', repeat: 3, pass: 1 })),
    done(step('b', 'page.scroll', { group: 'watch', pass: 1 }))
  ]
  const again = nextPass(steps)
  assert.ok(again)
  assert.equal(again.pass, 2)
  assert.equal(again.group, 'watch')
  assert.ok(again.steps.every((s) => s.status === 'planned'))
  assert.ok(again.steps.every((s) => s.pass === 2))
  assert.ok(again.steps.every((s) => s.tries === 0 && s.result === undefined))
})

test('a group stops exactly when it has been round the number of times asked', () => {
  const atLast = [
    done(step('a', 'media.waitFor', { group: 'watch', repeat: 3, pass: 3 })),
    done(step('b', 'page.scroll', { group: 'watch', pass: 3 }))
  ]
  assert.equal(nextPass(atLast), null, 'three of three is finished')
})

test('a group with a failed step does not go round again', () => {
  /**
   * Repeating over a failure turns one problem into fifty. A pass that did not finish is a task to report on, not a
   * reason to try the same thing again four more times.
   */
  const broken = [
    done(step('a', 'media.waitFor', { group: 'watch', repeat: 5, pass: 1 })),
    { ...step('b', 'page.scroll', { group: 'watch', pass: 1 }), status: 'failed' as const }
  ]
  assert.equal(nextPass(broken), null)
})

test('a group still part-way through does not go round again', () => {
  const midway = [
    done(step('a', 'media.waitFor', { group: 'watch', repeat: 5, pass: 1 })),
    step('b', 'page.scroll', { group: 'watch', pass: 1 })
  ]
  assert.equal(nextPass(midway), null)
})

test('steps outside the group are left exactly as they are', () => {
  // The thing that opened YouTube is not part of watching it, and repeating it would open a second tab each time.
  const steps = [
    done(step('open', 'tabs.create')),
    done(step('a', 'media.waitFor', { group: 'watch', repeat: 2, pass: 1 }))
  ]
  const again = nextPass(steps)
  assert.ok(again)
  assert.equal(again.steps.find((s) => s.id === 'open')?.status, 'done')
  assert.equal(again.steps.find((s) => s.id === 'a')?.status, 'planned')
})

test('a plan with no group never loops', () => {
  assert.equal(nextPass([done(step('a', 'tabs.create')), done(step('b', 'page.click'))]), null)
})

test('a repeat beyond the limit is held to it, rather than refused', () => {
  /**
   * The cap is not a judgement about what somebody might want; it is the line past which a mistake in a plan stops
   * being a long task and becomes a browser doing something thousands of times unattended.
   */
  const steps = [done(step('a', 'page.scroll', { group: 'g', repeat: MAX_REPEATS, pass: MAX_REPEATS }))]
  assert.equal(nextPass(steps), null)

  const huge = [done(step('a', 'page.scroll', { group: 'g', repeat: 9999, pass: MAX_REPEATS }))]
  assert.equal(nextPass(huge), null, 'held at the cap however large the number asked for')
})

test('two groups each keep their own count', () => {
  const steps = [
    done(step('a', 'media.waitFor', { group: 'watch', repeat: 2, pass: 1 })),
    done(step('b', 'page.extract', { group: 'collect', repeat: 3, pass: 2 }))
  ]
  const first = nextPass(steps)
  assert.ok(first)
  // Whichever comes first, only its own members move.
  const moved = first.steps.filter((s) => s.status === 'planned').map((s) => s.group)
  assert.equal(new Set(moved).size, 1)
})

test('a step that only reads is done when it returned, not when a change is proved', () => {
  /**
   * The control layer attaches a verification to anything that changes the browser and omits one from anything that
   * only looks -- there is no "after" to check when nothing happened. Reading that absence as "the browser did not
   * confirm it" made every reading step fail, and took every task containing one down with it.
   */
  const read = settle(step('r', 'page.read'), { ok: true, data: { title: 'Example' }, attempts: 1 }, false)
  assert.equal(read.status, 'done')
  assert.equal(read.failure, undefined)
})

test('a step that changes something still has to be confirmed', () => {
  // The guarantee that matters, unchanged: a claim about the world needs the world to agree.
  const unproven = settle(step('c', 'tabs.create'), {
    ok: true,
    verification: { verified: false, detail: 'No new tab appeared.' },
    attempts: 1
  })
  assert.equal(unproven.status, 'failed')
  assert.equal(unproven.failure?.kind, 'unverified')

  const proven = settle(step('c', 'tabs.create'), {
    ok: true,
    verification: { verified: true, detail: 'Tab 7 opened.' },
    attempts: 1
  })
  assert.equal(proven.status, 'done')
})
