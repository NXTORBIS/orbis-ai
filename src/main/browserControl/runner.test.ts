import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Plan, RunState, StepRecord } from '../../shared/browserControl.ts'
import { BrowserControl, fail } from './registry.ts'
import { PlanRun } from './runner.ts'

const approve = async (): Promise<boolean> => true
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function makeControl(): { control: BrowserControl; log: string[] } {
  const log: string[] = []
  const control = new BrowserControl()
  control.register({
    id: 'tabs.touch',
    domain: 'tabs',
    name: 'Touch a tab',
    description: 'Records a use of a tab',
    params: { label: { type: 'string', description: 'label' } },
    mutates: true,
    confirmation: 'none',
    run: (p) => {
      log.push(String(p.label ?? 'touch'))
      return { label: p.label }
    }
  })
  control.register({
    id: 'tabs.slow',
    domain: 'tabs',
    name: 'Slow',
    description: 'Takes a while, stopping early when aborted',
    params: { ms: { type: 'integer', description: 'ms' } },
    mutates: true,
    confirmation: 'none',
    run: async (p, ctx) => {
      const end = Date.now() + Number(p.ms ?? 1000)
      while (Date.now() < end) {
        if (ctx.signal?.aborted) fail('aborted', 'Stopped.')
        await sleep(10)
      }
      return { slept: p.ms }
    }
  })
  control.register({ id: 'state.check', domain: 'state', name: 'Check', description: 'Check', params: { condition: { type: 'object', description: 'c', required: true } }, mutates: false, confirmation: 'none', run: (p) => ({ value: (p.condition as { value?: boolean }).value === true }) })
  return { control, log }
}

const runPlan = (plan: Plan, extra: Partial<ConstructorParameters<typeof PlanRun>[1]> = {}, control = makeControl().control) => {
  const states: RunState[] = []
  const records: StepRecord[] = []
  const run = new PlanRun(plan, { control, source: 'automation', confirm: approve, emit: (s) => states.push(s), onStep: (r) => records.push(r), ...extra })
  return { run, states, records }
}

test('transform steps shape data deterministically; disabled steps are skipped and recorded', async () => {
  const { run, records } = runPlan({
    name: 't',
    variables: { raw: ' Total: $1,250.75 ' },
    steps: [
      { transform: { input: '{{raw}}', operations: [{ op: 'regex', pattern: '\\$([\\d,.]+)' }, { op: 'number' }], saveAs: 'total' } },
      { label: 'never', enabled: false, set: { ran: true } },
      { set: { doubled: '{{total}}' } }
    ],
    outputs: [{ name: 'total', from: 'total' }]
  })
  const final = await run.start()
  assert.equal(final.status, 'completed')
  assert.equal(run.outputs().total, 1250.75)
  assert.equal(final.variables.ran, undefined)
  assert.equal(records.find((r) => r.label === 'never')?.status, 'skipped')
})

test('a confirm step asks the user; declining fails the run, never continues', async () => {
  let asked = ''
  const { run } = runPlan({ name: 'c', steps: [{ confirm: { message: 'Send the email to {{to}}?' } }, { set: { sent: true } }], variables: { to: 'a@b.c' } }, { confirm: async (r) => ((asked = r.action), false) })
  const final = await run.start()
  assert.equal(asked, 'Send the email to a@b.c?')
  assert.equal(final.status, 'failed')
  assert.equal(final.error?.code, 'declined')
  assert.equal(final.variables.sent, undefined)
})

test('a user-action step waits for the user and re-checks the expected state before continuing', async () => {
  let signedIn = false
  const { control } = makeControl()
  control.register({ id: 'state.check', domain: 'state', name: 'Check', description: 'Check', params: { condition: { type: 'object', description: 'c', required: true } }, mutates: false, confirmation: 'none', run: () => ({ value: signedIn }) })
  const { run, states } = runPlan({ name: 'u', steps: [{ userAction: { message: 'Sign in, then continue.', until: { check: 'elementExists', locator: { text: 'Sign out' } } } }, { set: { done: true } }] }, {}, control)
  const finished = run.start()
  await sleep(20)
  assert.equal(states.at(-1)?.status, 'waiting-user')
  assert.equal(states.at(-1)?.waitingFor?.message, 'Sign in, then continue.')
  run.control('resume')
  await sleep(20)
  assert.equal(states.at(-1)?.status, 'waiting-user')
  assert.match(states.at(-1)?.waitingFor?.message ?? '', /isn't done yet/)
  signedIn = true
  run.control('resume')
  const final = await finished
  assert.equal(final.status, 'completed')
  assert.equal(final.variables.done, true)
})

test('Orion steps return structured decisions; answers outside the choices fail; low confidence pauses', async () => {
  const good = runPlan(
    { name: 'o', steps: [{ ask: { prompt: 'Which is primary?', include: ['variables'], expects: 'decision', choices: ['a@x.com', 'b@x.com'], saveAs: 'pick' } }] },
    { ask: async (req) => ({ decision: 'b@x.com', confidence: 0.93, reasoning: String(req.context.variables !== undefined) }) }
  )
  const done = await good.run.start()
  assert.equal(done.status, 'completed')
  assert.deepEqual((done.variables.pick as { decision: string }).decision, 'b@x.com')

  const bad = runPlan({ name: 'o2', steps: [{ ask: { prompt: 'Pick', include: [], expects: 'decision', choices: ['yes', 'no'], saveAs: 'x' } }] }, { ask: async () => ({ decision: 'delete everything', confidence: 1 }) })
  const failed = await bad.run.start()
  assert.equal(failed.status, 'failed')
  assert.match(failed.error?.message ?? '', /isn't one of the choices/)

  const unsure = runPlan({ name: 'o3', steps: [{ ask: { prompt: 'Done?', include: [], expects: 'boolean', minConfidence: 0.8, saveAs: 'ok' } }] }, { ask: async () => ({ value: true, confidence: 0.4 }) })
  const pending = unsure.run.start()
  await sleep(20)
  assert.equal(unsure.states.at(-1)?.status, 'waiting-user')
  assert.match(unsure.states.at(-1)?.waitingFor?.message ?? '', /only 40% sure/)
  unsure.run.control('resume')
  assert.equal((await pending).status, 'completed')
})

test('calling another workflow isolates its variables and returns its outputs; loops of calls are stopped', async () => {
  const child: Plan = { name: 'child', variables: { secretInside: 'x' }, steps: [{ set: { result: 'made for {{who}}' } }], outputs: [{ name: 'result', from: 'result' }] }
  const { run } = runPlan(
    { name: 'parent', variables: { who: 'Ada', mine: 1 }, steps: [{ call: { workflowId: 'child', inputs: { who: '{{who}}' }, saveAs: 'out' } }] },
    { resolveCall: async (id) => (id === 'child' ? child : null) }
  )
  const final = await run.start()
  assert.equal(final.status, 'completed')
  assert.deepEqual(final.variables.out, { result: 'made for Ada' })
  assert.equal(final.variables.mine, 1)
  assert.equal(final.variables.secretInside, undefined)

  const looping: Plan = { name: 'loop', steps: [{ call: { workflowId: 'loop', inputs: {} } }] }
  const loop = runPlan(looping, { resolveCall: async () => looping })
  const ended = await loop.run.start()
  assert.equal(ended.status, 'failed')
  assert.match(ended.error?.message ?? '', /too deeply/)
})

test('action timeouts fail the step with a clear error', async () => {
  const { run, records } = runPlan({ name: 'slow', steps: [{ do: 'tabs.slow', params: { ms: 2000 }, timeoutMs: 60, label: 'Slow step' }] })
  const final = await run.start()
  assert.equal(final.status, 'failed')
  assert.equal(final.error?.code, 'timeout')
  assert.match(final.error?.message ?? '', /Slow step/)
  assert.equal(records[0].status, 'failed')
})

test('the debugger pauses before each action and steps through one at a time', async () => {
  const { control, log } = makeControl()
  const { run, states } = runPlan({ name: 'dbg', steps: [{ do: 'tabs.touch', params: { label: 'one' } }, { do: 'tabs.touch', params: { label: 'two' } }, { do: 'tabs.touch', params: { label: 'three' } }] }, { debug: true }, control)
  const finished = run.start()
  await sleep(20)
  assert.equal(states.at(-1)?.waitingFor?.kind, 'debugger')
  assert.deepEqual(log, [])
  run.control('step')
  await sleep(20)
  assert.deepEqual(log, ['one'])
  assert.equal(states.at(-1)?.status, 'paused')
  run.control('resume')
  assert.equal((await finished).status, 'completed')
  assert.deepEqual(log, ['one', 'two', 'three'])
})

test('checkpoints mark progress and a run can resume from one without redoing earlier steps', async () => {
  const { control, log } = makeControl()
  const checkpoints: { nextTopIndex: number; variables: Record<string, unknown> }[] = []
  const plan: Plan = { name: 'cp', variables: { apiKey: 'sk-1', note: 'kept' }, steps: [{ do: 'tabs.touch', params: { label: 'a' } }, { do: 'tabs.touch', params: { label: 'b' } }, { do: 'tabs.touch', params: { label: 'c' } }] }
  await runPlan(plan, { checkpoint: (c) => checkpoints.push(c) }, control).run.start()
  assert.deepEqual(checkpoints.map((c) => c.nextTopIndex), [1, 2, 3])
  assert.equal(checkpoints[0].variables.apiKey, undefined)
  assert.equal(checkpoints[0].variables.note, 'kept')
  log.length = 0
  await runPlan(plan, { resumeFrom: 2 }, control).run.start()
  assert.deepEqual(log, ['c'])
})

test('two runs cannot change the same tab at once; the lock is released when a run ends', async () => {
  const { control } = makeControl()
  const holder = runPlan({ name: 'A', steps: [{ do: 'tabs.touch', params: { label: 'A' }, target: { tabId: 't1' } }, { userAction: { message: 'hold' } }] }, {}, control)
  const holding = holder.run.start()
  await sleep(20)
  const blocked = await runPlan({ name: 'B', steps: [{ do: 'tabs.touch', params: { label: 'B' }, target: { tabId: 't1' } }] }, {}, control).run.start()
  assert.equal(blocked.status, 'failed')
  assert.equal(blocked.error?.code, 'blocked')
  const other = await runPlan({ name: 'C', steps: [{ do: 'tabs.touch', params: { label: 'C' }, target: { tabId: 't2' } }] }, {}, control).run.start()
  assert.equal(other.status, 'completed')
  holder.run.control('resume')
  await holding
  assert.deepEqual(control.heldLocks(), {})
  const after = await runPlan({ name: 'D', steps: [{ do: 'tabs.touch', params: { label: 'D' }, target: { tabId: 't1' } }] }, {}, control).run.start()
  assert.equal(after.status, 'completed')
})
