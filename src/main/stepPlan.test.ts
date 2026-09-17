import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  beginStep,
  blockedBy,
  describe,
  fill,
  finish,
  newSession,
  nextStep,
  pause,
  progress,
  proposeStep,
  publicSession,
  readyCommand,
  recordExecution,
  recordVerification,
  replan,
  resume,
  skipStep,
  stop,
  userDone
} from '../shared/stepPlan.ts'
import type { StepSession } from '../shared/stepPlan.ts'

let n = 0
const id = (): string => `s${++n}`

const start = (goal = 'Find the cheapest flight'): StepSession => newSession({ id: 'run', profileId: 'default', goal, now: 1000 })

/** Proposes one step and runs it all the way through to a verified success. */
const runOne = (session: StepSession, intent: string, stepId = id()): StepSession => {
  let s = proposeStep(session, { intent, capability: 'navigation.go', params: { url: 'https://example.com' } }, stepId)
  s = beginStep(s, stepId)
  s = recordExecution(s, stepId, { ok: true })
  return recordVerification(s, stepId, { verified: true, detail: 'the page is open' })
}

test('a step is not successful because the command ran — the browser has to say so', () => {
  const step = id()
  let s = proposeStep(start(), { intent: 'Open the orders page', capability: 'navigation.go', params: { url: 'https://shop/orders' } }, step)
  s = beginStep(s, step)

  // The command came back fine. That is not enough.
  s = recordExecution(s, step, { ok: true, summary: 'navigated' })
  assert.equal(s.steps[0].phase, 'verifying')
  assert.equal(progress(s).done, 0, 'a command that ran is not a step that worked')

  s = recordVerification(s, step, { verified: true, detail: 'the address is https://shop/orders' })
  assert.equal(s.steps[0].phase, 'success')
  assert.equal(progress(s).done, 1)
})

test('the browser saying no is a failure, however well the command went', () => {
  const step = id()
  let s = proposeStep(start(), { intent: 'Click Checkout', capability: 'page.click', params: {} }, step)
  s = beginStep(s, step)
  s = recordExecution(s, step, { ok: true })
  s = recordVerification(s, step, { verified: false, detail: 'the basket is still open' })

  // Recoverable, so it will be tried again rather than given up on.
  assert.equal(s.steps[0].phase, 'retrying')
  assert.equal(s.steps[0].error?.code, 'verification-failed')
  assert.equal(s.steps[0].verification?.verified, false)
  assert.equal(progress(s).done, 0)
})

test('there is no route from executing to success without a verification', () => {
  const step = id()
  let s = proposeStep(start(), { intent: 'Type the address', capability: 'page.type', params: {} }, step)
  s = beginStep(s, step)
  // Trying to verify before the command came back does nothing at all.
  const early = recordVerification(s, step, { verified: true, detail: 'made up' })
  assert.equal(early.steps[0].phase, 'executing', 'a step still running cannot be declared verified')

  s = recordExecution(s, step, { ok: true })
  s = recordVerification(s, step, { verified: true, detail: 'the field holds the address' })
  assert.equal(s.steps[0].phase, 'success')
  // And it cannot be re-verified into something else afterwards.
  assert.equal(recordVerification(s, step, { verified: false, detail: 'no' }).steps[0].phase, 'success')
})

test('a control layer that verified as it went is believed, and one that failed is not', () => {
  const a = id()
  let s = proposeStep(start(), { intent: 'Open a tab', capability: 'tabs.create', params: {} }, a)
  s = beginStep(s, a)
  s = recordExecution(s, a, { ok: true, verification: { verified: true, detail: 'the tab exists' } })
  assert.equal(s.steps[0].phase, 'success')

  const b = id()
  let t = proposeStep(start(), { intent: 'Open a tab', capability: 'tabs.create', params: {} }, b)
  t = beginStep(t, b)
  t = recordExecution(t, b, { ok: true, verification: { verified: false, detail: 'no such tab' } })
  assert.notEqual(t.steps[0].phase, 'success')
})

test('a step is tried again until its limit, and then it stops', () => {
  const step = id()
  let s = proposeStep(start(), { intent: 'Click Next', capability: 'page.click', params: {}, retry: { attempts: 2 } }, step)
  const fail = { ok: false, error: { code: 'not-found' as const, message: 'no such button', recoverable: true } }

  s = beginStep(s, step)
  s = recordExecution(s, step, fail)
  assert.equal(s.steps[0].phase, 'retrying')
  assert.equal(s.steps[0].attempts, 1)
  assert.equal(nextStep(s)?.id, step, 'a step waiting for another attempt is the next thing to do')

  s = beginStep(s, step)
  s = recordExecution(s, step, fail)
  assert.equal(s.steps[0].phase, 'failed')
  assert.equal(s.steps[0].attempts, 2)
  assert.equal(nextStep(s), undefined)
})

test('a failure nothing can be done about is not tried again', () => {
  const step = id()
  let s = proposeStep(start(), { intent: 'Use a capability that is not there', capability: 'nope.nope', params: {} }, step)
  s = beginStep(s, step)
  s = recordExecution(s, step, { ok: false, error: { code: 'unknown-capability', message: 'Orbis cannot do that.', recoverable: false } })
  assert.equal(s.steps[0].phase, 'failed')
  assert.equal(s.steps[0].attempts, 1)
})

test('a step will not run when what it depends on did not work', () => {
  const first = id()
  const second = id()
  let s = proposeStep(start(), { intent: 'Sign in', capability: 'page.click', params: {} }, first)
  s = proposeStep(s, { intent: 'Open the account page', capability: 'navigation.go', params: {}, dependsOn: [first] }, second)

  s = beginStep(s, first)
  s = recordExecution(s, first, { ok: false, error: { code: 'failed', message: 'wrong password', recoverable: false } })
  assert.deepEqual(blockedBy(s, s.steps[1]).map((b) => b.id), [first])

  s = beginStep(s, second)
  assert.equal(s.steps[1].phase, 'failed')
  assert.match(s.steps[1].note ?? '', /Sign in/)
})

test('a dependency on a step that does not exist is dropped rather than blocking forever', () => {
  const step = id()
  const s = proposeStep(start(), { intent: 'Go', capability: 'navigation.go', params: {}, dependsOn: ['never-proposed'] }, step)
  assert.deepEqual(s.steps[0].dependsOn, [])
})

test('what a step learns is there for the steps after it, and a name nothing saved is left alone', () => {
  const step = id()
  let s = proposeStep(start(), { intent: 'Read the order number', capability: 'page.extract', params: {}, saveAs: 'order' }, step)
  s = beginStep(s, step)
  s = recordExecution(s, step, { ok: true, summary: { number: 'A-1234' } })
  s = recordVerification(s, step, { verified: true, detail: 'the number is on the page' })
  assert.deepEqual(s.variables.order, { number: 'A-1234' })

  const next = id()
  s = proposeStep(s, { intent: 'Search for it', capability: 'page.type', params: { text: 'Order {{order.number}}', other: '{{nothing}}' } }, next)
  const command = readyCommand(s, s.steps[1])
  assert.equal(command?.params.text, 'Order A-1234')
  assert.equal(command?.params.other, '{{nothing}}', 'a missing value stays visible rather than becoming the word undefined')
})

test('filling keeps the type when the whole value is one name', () => {
  assert.deepEqual(fill('{{list}}', { list: [1, 2, 3] }), [1, 2, 3])
  assert.equal(fill('{{count}} left', { count: 3 }), '3 left')
  assert.deepEqual(fill({ a: ['{{name}}'] }, { name: 'Ada' }), { a: ['Ada'] })
})

test('a step that needs a person stops the run until they say it is done, and it is still verified afterwards', () => {
  const step = id()
  let s = proposeStep(start(), { intent: 'Sign in', needsUser: 'Sign in to the site, then Orbis will carry on.' }, step)
  s = beginStep(s, step)
  assert.equal(s.status, 'waiting')
  assert.equal(s.steps[0].phase, 'waiting')
  assert.equal(describe(s), 'Sign in to the site, then Orbis will carry on.')
  assert.equal(nextStep(s), undefined, 'nothing else runs while a person is being waited for')

  s = userDone(s, step)
  assert.equal(s.status, 'running')
  assert.equal(s.steps[0].phase, 'verifying', 'being told it is done is not the browser saying so')
  s = recordVerification(s, step, { verified: true, detail: 'the account menu is showing' })
  assert.equal(s.steps[0].phase, 'success')
})

test('pausing holds everything, and resuming picks up where it was', () => {
  let s = runOne(start(), 'Open the site')
  const step = id()
  s = proposeStep(s, { intent: 'Search', capability: 'page.type', params: {} }, step)

  s = pause(s, 'Paused by you.')
  assert.equal(nextStep(s), undefined)
  assert.equal(beginStep(s, step).steps[1].phase, 'ready', 'a paused run starts nothing')
  assert.match(describe(s), /Paused after 1 of 2 steps/)

  s = resume(s)
  assert.equal(nextStep(s)?.id, step)
})

test('stopping cancels what never ran and keeps what did', () => {
  let s = runOne(start(), 'Open the site')
  const step = id()
  s = proposeStep(s, { intent: 'Buy it', capability: 'page.click', params: {} }, step)
  s = stop(s, 'Stopped by you.')

  assert.equal(s.status, 'stopped')
  assert.equal(s.steps[0].phase, 'success', 'what happened still happened')
  assert.equal(s.steps[1].phase, 'cancelled', 'what never ran did not fail — it was never tried')
  assert.equal(progress(s).done, 1)
  assert.equal(progress(s).failed, 0)
})

test('thinking again drops the rest of the plan and never rewrites what already happened', () => {
  let s = runOne(start(), 'Open the site')
  const step = id()
  s = proposeStep(s, { intent: 'Click the button that is not there', capability: 'page.click', params: {} }, step)
  s = replan(s, 'The page is laid out differently than expected.')

  assert.equal(s.status, 'thinking')
  assert.equal(s.replans, 1)
  assert.equal(s.steps[0].phase, 'success')
  assert.equal(s.steps[1].phase, 'skipped')
  assert.equal(s.steps[1].note, 'The page is laid out differently than expected.')
})

test('a run that keeps changing its mind stops instead of going round forever', () => {
  let s = start()
  for (let i = 0; i < 5; i++) {
    s = proposeStep(s, { intent: `Try ${i}`, capability: 'navigation.go', params: {} }, id())
    s = replan(s, 'not that way')
  }
  assert.equal(s.replans, 5)
  s = replan(s, 'nor that way')
  assert.equal(s.status, 'failed')
  assert.match(s.reason ?? '', /changed its approach/)
})

test('a run stops rather than propose more steps than it is allowed', () => {
  let s = newSession({ id: 'run', profileId: 'default', goal: 'loop', maxSteps: 2 })
  s = proposeStep(s, { intent: 'one', capability: 'navigation.go' }, id())
  s = proposeStep(s, { intent: 'two', capability: 'navigation.go' }, id())
  s = proposeStep(s, { intent: 'three', capability: 'navigation.go' }, id())
  assert.equal(s.steps.length, 2)
  assert.equal(s.status, 'failed')
  assert.match(s.reason ?? '', /more than 2 steps/)
})

test('progress counts what happened, never what is merely planned', () => {
  let s = runOne(start(), 'Open the site')
  const later = id()
  s = proposeStep(s, { intent: 'Do the rest of it', capability: 'page.click', params: {} }, later)
  const p = progress(s)
  assert.equal(p.done, 1)
  assert.equal(p.planned, 2)
  assert.equal(p.running, undefined, 'a step nobody has started is not running')

  s = skipStep(s, later, 'It turned out not to be needed.')
  assert.equal(progress(s).skipped, 1)
  assert.equal(progress(s).done, 1, 'skipping is not doing')
})

test('a run cannot be declared finished while a step is still in the air', () => {
  let s = runOne(start(), 'Open the site')
  const step = id()
  s = proposeStep(s, { intent: 'Still to do', capability: 'page.click', params: {} }, step)
  assert.equal(finish(s, 'All done.').status, 'running', 'nothing is finished while something is outstanding')

  s = skipStep(s, step, 'not needed')
  assert.equal(finish(s, 'All done.').status, 'done')
})

test('a run whose last step failed finishes as failed, whatever it is told', () => {
  const step = id()
  let s = proposeStep(start(), { intent: 'Click', capability: 'page.click', params: {} }, step)
  s = beginStep(s, step)
  s = recordExecution(s, step, { ok: false, error: { code: 'not-found', message: 'gone', recoverable: false } })
  s = finish(s, 'Everything worked.')
  assert.equal(s.status, 'failed')
})

test('the assistant reasoning is never kept, and what may be shown carries no parameters', () => {
  const step = id()
  let s = proposeStep(
    start(),
    {
      intent: 'Sign in',
      capability: 'page.type',
      params: { text: 'hunter2', locator: { css: '#password' } },
      thought: 'The user probably reuses this password, so I should try it first, and then...'
    },
    step
  )
  const stored = JSON.stringify(s)
  assert.ok(!stored.includes('probably reuses'), 'the reasoning is not in the session')
  assert.ok(!stored.includes('thought'), 'nor is there a field for it')

  s = beginStep(s, step)
  s = recordExecution(s, step, { ok: true, summary: 'typed' })
  s = recordVerification(s, step, { verified: true, detail: 'the field is filled' })

  const shown = JSON.stringify(publicSession(s))
  assert.ok(!shown.includes('hunter2'), 'what was typed does not travel')
  assert.ok(!shown.includes('#password'), 'nor does what it was typed into')
  assert.ok(shown.includes('Sign in'), 'what the step was for does')
  assert.ok(shown.includes('success'), 'and whether it worked')
  assert.deepEqual(publicSession(s).variables, [], 'variable names only, never their values')
})

test('what is said out loud matches what is true', () => {
  const fresh = start()
  assert.equal(describe(fresh), 'Working out where to start.')

  let s = proposeStep(fresh, { intent: 'Open the site', capability: 'navigation.go', params: {} }, id())
  const step = s.steps[0].id
  s = beginStep(s, step)
  assert.equal(describe(s), 'Open the site')

  s = recordExecution(s, step, { ok: true })
  s = recordVerification(s, step, { verified: true, detail: 'open' })
  s = finish(s, 'Found the cheapest flight.')
  assert.equal(describe(s), 'Found the cheapest flight.')
})

test('a step that failed and was then done another way does not fail the run', () => {
  const first = id()
  let s = proposeStep(start(), { intent: 'Click the orders link', capability: 'page.click', params: {} }, first)
  s = beginStep(s, first)
  s = recordExecution(s, first, { ok: false, error: { code: 'not-found', message: 'no such link', recoverable: false } })
  s = runOne(s, 'Go to the orders page directly')

  s = finish(s, 'The orders page is open.')
  assert.equal(s.status, 'done', 'the goal was reached, and the step that reached it was confirmed')
  assert.equal(s.reason, 'The orders page is open.')
  assert.equal(progress(s).failed, 1, 'the stumble is still on record')
})
