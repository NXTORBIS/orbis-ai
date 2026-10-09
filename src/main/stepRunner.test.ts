import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StepRun } from './stepRunner.ts'
import type { PlanReply, PlanRequest, StepRunnerDeps, StepRunnerView } from './stepRunner.ts'
import type { CommandResult } from '../shared/browserControl.ts'
import type { PageSignals } from '../shared/captcha.ts'

const CLEAR: PageSignals = { url: 'https://shop.example.com/cart', attributes: ['cart'], text: ['Your basket', 'Checkout'] }
const CHALLENGED: PageSignals = {
  url: 'https://shop.example.com/cart',
  frames: ['https://www.google.com/recaptcha/api2/anchor'],
  attributes: ['g-recaptcha'],
  text: ["I'm not a robot"]
}

const ok = (data?: unknown, verified = true): CommandResult => ({ ok: true, capability: 'x', data, verification: { verified, detail: 'checked' }, attempts: 1, durationMs: 1 })
const bad = (code: CommandResult['error'] extends undefined ? never : NonNullable<CommandResult['error']>['code'], recoverable = true): CommandResult => ({
  ok: false,
  capability: 'x',
  error: { code, message: `it went ${code}`, recoverable },
  attempts: 1,
  durationMs: 1
})

/** A runner wired to answers given in advance, so the loop can be watched without a browser. */
function harness(options: {
  plans: PlanReply[]
  run?: (command: { capability: string; params: Record<string, unknown> }, nth: number) => CommandResult
  signals?: (nth: number) => PageSignals
}): { run: StepRun; commands: { capability: string; params: Record<string, unknown> }[]; asked: PlanRequest[]; views: StepRunnerView[] } {
  const commands: { capability: string; params: Record<string, unknown> }[] = []
  const asked: PlanRequest[] = []
  const views: StepRunnerView[] = []
  const plans = [...options.plans]
  let runs = 0
  let looks = 0
  let ids = 0

  const deps: StepRunnerDeps = {
    execute: async (command) => {
      commands.push({ capability: command.capability, params: command.params })
      if (command.capability === 'state.check') return ok({ value: true })
      return options.run ? options.run(command, runs++) : ok('did it')
    },
    signals: async () => (options.signals ? options.signals(looks++) : CLEAR),
    observe: async () => 'A basket page with a Checkout button.',
    plan: async (request) => {
      asked.push(request)
      return plans.shift() ?? { kind: 'done', summary: 'Nothing more to do.' }
    },
    emit: (view) => views.push(view),
    newId: () => `id${++ids}`,
    wait: async () => undefined
  }
  return { run: new StepRun({ id: 'run-1', profileId: 'default', goal: 'Buy the thing' }, deps), commands, asked, views }
}

const step = (intent: string, capability = 'page.click', extra: Record<string, unknown> = {}): PlanReply => ({
  kind: 'step',
  step: { intent, capability, params: { locator: { text: 'Checkout' } }, ...extra }
})

test('it plans one step, runs it, checks the page, and only then asks for the next', async () => {
  const h = harness({ plans: [step('Open the basket', 'navigation.go'), step('Press Checkout'), { kind: 'done', summary: 'Ordered.' }] })
  const session = await h.run.start()

  assert.equal(session.status, 'done')
  assert.deepEqual(session.steps.map((s) => s.phase), ['success', 'success'])
  assert.deepEqual(h.commands.map((c) => c.capability), ['navigation.go', 'page.click'])
  // Asked three times: once before each step, and once more to learn there is nothing left.
  assert.equal(h.asked.length, 3)
  assert.deepEqual(h.asked[1].history, [{ intent: 'Open the basket', outcome: 'worked', detail: undefined }])
})

test('the assistant is told what the page looks like now, not what it looked like when the goal was given', async () => {
  const h = harness({ plans: [step('Press Checkout'), { kind: 'done', summary: 'Done.' }] })
  await h.run.start()
  assert.ok(h.asked.every((request) => request.page === 'A basket page with a Checkout button.'))
  assert.equal(h.asked[0].goal, 'Buy the thing')
})

test('a step is not successful because the command came back — the page is checked', async () => {
  const h = harness({ plans: [step('Press Checkout', 'page.click', { expect: { check: 'elementExists', selector: '.confirmation' } }), { kind: 'done', summary: 'Done.' }] })
  await h.run.start()
  assert.ok(h.commands.some((c) => c.capability === 'state.check'), 'what the step expected was asked of the real browser')
})

test('a step that expects nothing and is verified by nothing is not called done', async () => {
  const h = harness({ plans: [step('Press Checkout')], run: () => ({ ok: true, capability: 'page.click', attempts: 1, durationMs: 1 }) })
  const session = await h.run.start()
  const pressed = session.steps[0]
  assert.notEqual(pressed.phase, 'success')
  assert.match(pressed.error?.message ?? '', /not treating this as done/)
})

test('a failure is told to the assistant so it can try another way', async () => {
  const h = harness({
    plans: [step('Press the button that is not there'), step('Press the right one'), { kind: 'done', summary: 'Done.' }],
    run: (_c, nth) => (nth === 0 ? bad('not-found', false) : ok('did it'))
  })
  const session = await h.run.start()
  assert.equal(session.steps[0].phase, 'failed')
  assert.equal(session.steps[1].phase, 'success')
  assert.match(h.asked[1].lastFailure ?? '', /not-found/)
  assert.equal(h.asked[1].history[0].outcome, 'did not work')
})

test('a recoverable failure is tried again before it is given up on', async () => {
  let tries = 0
  const h = harness({
    plans: [step('Press Checkout'), { kind: 'done', summary: 'Done.' }],
    run: () => (tries++ === 0 ? bad('stale-element') : ok('did it'))
  })
  const session = await h.run.start()
  assert.equal(session.steps[0].phase, 'success')
  assert.equal(session.steps[0].attempts, 2)
  assert.equal(h.asked.length, 2, 'trying again is not a new step')
})

test('a step the assistant did not say how to do fails rather than silently passing', async () => {
  const h = harness({ plans: [{ kind: 'step', step: { intent: 'Somehow buy it' } }] })
  const session = await h.run.start()
  assert.equal(session.steps[0].phase, 'failed')
  assert.match(session.steps[0].error?.message ?? '', /not how to do it/)
})

test('giving up says so instead of flailing', async () => {
  const h = harness({ plans: [{ kind: 'give-up', why: 'This site has no basket.' }] })
  const session = await h.run.start()
  assert.equal(session.status, 'stopped')
  assert.equal(session.reason, 'This site has no basket.')
  assert.equal(h.commands.length, 0, 'nothing was done in the browser')
})

test('thinking again drops what has not run and keeps what has', async () => {
  const h = harness({ plans: [step('Open the basket', 'navigation.go'), { kind: 'replan', why: 'The basket moved.' }, step('Open the new basket', 'navigation.go'), { kind: 'done', summary: 'Done.' }] })
  const session = await h.run.start()
  assert.equal(session.replans, 1)
  assert.equal(session.steps[0].phase, 'success')
  assert.equal(session.status, 'done')
})

// ---------------------------------------------------------------- challenges

test('a challenge stops the run where it is, and nothing is retried past it', async () => {
  const h = harness({ plans: [step('Press Checkout'), step('Confirm')], signals: () => CHALLENGED })
  const session = await h.run.start()

  assert.equal(session.status, 'waiting')
  assert.equal(h.commands.length, 0, 'nothing was done in the browser while a site was asking for a person')
  const waiting = session.steps.find((s) => s.phase === 'waiting')
  assert.ok(waiting, 'the challenge became a step that waits')
  assert.match(waiting!.note ?? '', /shop\.example\.com/)
  assert.match(waiting!.note ?? '', /Tick the box on the page/)

  const view = h.run.view()
  assert.equal(view.captcha?.provider, 'recaptcha')
  assert.equal(view.captcha?.state, 'awaiting-user')
  assert.ok(!/token/i.test(JSON.stringify(view)), 'nothing token-shaped is anywhere in what is shown')
})

test('saying the challenge is done is not believed until the page agrees', async () => {
  let cleared = false
  const h = harness({ plans: [step('Press Checkout'), { kind: 'done', summary: 'Ordered.' }], signals: () => (cleared ? CLEAR : CHALLENGED) })
  await h.run.start()
  assert.equal(h.run.state.status, 'waiting')

  // Told it is done while it is still on the page: the run stays exactly where it was.
  await h.run.captchaDone()
  assert.equal(h.run.state.status, 'waiting')
  assert.equal(h.run.view().captcha?.state, 'awaiting-user')
  assert.equal(h.commands.length, 0)

  // Now it really is gone.
  cleared = true
  await h.run.captchaDone()
  assert.equal(h.run.state.status, 'done')
  assert.ok(h.commands.some((c) => c.capability === 'page.click'), 'the run carried on from where it stopped')
})

test('a challenge that appears mid-step stops the run rather than being worked around', async () => {
  let looks = 0
  const h = harness({
    plans: [step('Press Checkout'), step('Confirm')],
    // Clear when the step is planned, challenged by the time it has run.
    signals: () => (looks++ === 0 ? CLEAR : CHALLENGED)
  })
  const session = await h.run.start()
  assert.equal(session.status, 'waiting')
  assert.equal(session.steps[0].phase, 'skipped')
  assert.match(session.steps[0].note ?? '', /asked to verify a person/)
  assert.equal(h.commands.filter((c) => c.capability === 'page.click').length, 1, 'it was not tried again')
})

test('nothing offered about a challenge answers it', async () => {
  const h = harness({ plans: [step('Press Checkout')], signals: () => CHALLENGED })
  await h.run.start()
  const shown = JSON.stringify(h.run.view())
  for (const word of ['solve', 'bypass', 'g-recaptcha-response', 'sitekey']) {
    assert.ok(!shown.toLowerCase().includes(word), word)
  }
})

// ---------------------------------------------------------------- a person in charge

test('a run can be stopped part way, and what it already did is kept', async () => {
  let h: ReturnType<typeof harness>
  h = harness({
    plans: [step('Open the basket', 'navigation.go'), step('Press Checkout'), step('Confirm')],
    // Stopped by a person while the second command is in flight.
    run: (_c, nth) => {
      if (nth === 1) h.run.stopRun('Stopped by you.')
      return ok('did it')
    }
  })
  await h.run.start()
  assert.equal(h.run.state.status, 'stopped')
  assert.equal(h.run.state.reason, 'Stopped by you.')
  assert.equal(h.run.summary().done, 1, 'the step that finished before the stop still counts')
  assert.ok(!h.commands.some((c, i) => i > 1 && c.capability === 'page.click'), 'nothing was started after the stop')
})

test('skipping what is waiting lets the run carry on', async () => {
  let cleared = false
  const h = harness({ plans: [step('Press Checkout'), { kind: 'done', summary: 'Done.' }], signals: () => (cleared ? CLEAR : CHALLENGED) })
  await h.run.start()
  assert.equal(h.run.state.status, 'waiting')

  cleared = true
  await h.run.skipCurrent('You chose to skip this.')
  assert.equal(h.run.view().captcha, undefined, 'the challenge is no longer in the way')
})

test('what is shown carries intents and outcomes, never parameters', async () => {
  const h = harness({ plans: [{ kind: 'step', step: { intent: 'Sign in', capability: 'page.type', params: { text: 'hunter2' }, thought: 'they always reuse this' } }, { kind: 'done', summary: 'Done.' }] })
  await h.run.start()
  const shown = JSON.stringify(h.views.map((v) => v.session))
  assert.ok(!shown.includes('hunter2'), 'what was typed does not travel')
  assert.ok(!shown.includes('always reuse'), 'nor does the reasoning behind it')
  assert.ok(shown.includes('Sign in'))
  // But the browser really was given it.
  assert.equal(h.commands[0].params.text, 'hunter2')
})

test('every change is told to whoever is watching, and each one is already safe to show', async () => {
  const h = harness({ plans: [step('Press Checkout', 'page.click', { expect: { check: 'elementExists', selector: '.done' } }), { kind: 'done', summary: 'Done.' }] })
  await h.run.start()
  assert.ok(h.views.length > 3, 'the watcher sees the step move through its phases')
  assert.ok(h.views.every((view) => typeof view.saying === 'string' && view.saying.length > 0))
  const phases = h.views.map((v) => v.session.steps[0]?.phase).filter(Boolean)
  assert.ok(phases.includes('executing'))
  assert.ok(phases.includes('verifying'))
  assert.ok(phases.includes('success'))
  assert.ok(phases.indexOf('verifying') < phases.indexOf('success'), 'nothing reaches success before something looked')
})

test('a page still arriving is looked at again before a step is judged, and never assumed', async () => {
  let looks = 0
  const commands: string[] = []
  const deps: StepRunnerDeps = {
    execute: async (command) => {
      commands.push(command.capability)
      // Loading for the first two looks, there by the third.
      if (command.capability === 'state.check') return ok({ value: ++looks >= 3 })
      return ok('clicked')
    },
    signals: async () => CLEAR,
    observe: async () => 'page',
    plan: (() => {
      const plans: PlanReply[] = [step('Open orders', 'page.click', { expect: { check: 'urlMatches', pattern: '/orders' } }), { kind: 'done', summary: 'Open.' }]
      return async () => plans.shift() ?? { kind: 'done', summary: 'Open.' }
    })(),
    emit: () => undefined,
    newId: (() => { let n = 0; return () => `w${++n}` })(),
    wait: async () => undefined
  }
  const run = new StepRun({ id: 'r', profileId: 'default', goal: 'orders' }, deps)
  const session = await run.start()
  assert.equal(session.steps[0].phase, 'success')
  assert.equal(looks, 3, 'it looked until the page was there, and no further')
  assert.equal(session.status, 'done')
})

test('a page that never gets there is still a failure after the looks run out', async () => {
  let looks = 0
  const h = harness({ plans: [step('Open orders', 'page.click', { expect: { check: 'urlMatches', pattern: '/orders' } })] })
  // Replace the harness's always-yes check with one that always says no.
  const original = (h.run as unknown as { deps: StepRunnerDeps }).deps.execute
  ;(h.run as unknown as { deps: StepRunnerDeps }).deps.execute = async (command, runId) => {
    if (command.capability === 'state.check') {
      looks++
      return ok({ value: false })
    }
    return original(command, runId)
  }
  const session = await h.run.start()
  assert.notEqual(session.steps[0].phase, 'success')
  assert.ok(looks >= 5, `it looked ${looks} times before giving up`)
})

// ---------------------------------------------------------------- letting go at the end

/**
 * A run claims the tab it works on, and a claim is only released by the run's own name. Nothing told anybody a run
 * had ended, so claims outlived the runs that made them and the next run refused to touch that tab until Orbis was
 * restarted. These three say the end is announced exactly once, and only when it really is the end.
 */

test('the end of a run is announced once, so what it held can be let go of', async () => {
  const ends: string[] = []
  const h = harness({ plans: [step('Press Checkout'), { kind: 'done', summary: 'Ordered.' }] })
  ;(h.run as unknown as { deps: StepRunnerDeps }).deps.ended = (session) => ends.push(session.status)
  await h.run.start()
  assert.deepEqual(ends, ['done'])
})

test('a run that was stopped says so, and says it once', async () => {
  const ends: string[] = []
  const h = harness({ plans: [step('Press Checkout')] })
  ;(h.run as unknown as { deps: StepRunnerDeps }).deps.ended = (session) => ends.push(session.status)
  h.run.stopRun('Stopped by you.')
  h.run.stopRun('Stopped by you again.')
  assert.deepEqual(ends, ['stopped'], 'twice stopped is still one ending')
})

test('pausing is not the end, because it is still waiting for somebody', async () => {
  const ends: string[] = []
  const h = harness({ plans: [step('Press Checkout')] })
  ;(h.run as unknown as { deps: StepRunnerDeps }).deps.ended = (session) => ends.push(session.status)
  h.run.pauseRun()
  assert.deepEqual(ends, [], 'what a paused run holds is still its own')
})
