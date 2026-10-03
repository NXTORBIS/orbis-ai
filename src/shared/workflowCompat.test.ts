import test from 'node:test'
import assert from 'node:assert/strict'
import { affected, dependencies, migrate, missing, runnable } from './workflowCompat.ts'
import type { CapabilityDescriptor } from './browserControl.ts'
import type { Workflow, WorkflowStep } from './workflows.ts'

const cap = (id: string, extra: Partial<CapabilityDescriptor> = {}): CapabilityDescriptor => ({
  id,
  domain: id.split('.')[0] as CapabilityDescriptor['domain'],
  name: id,
  description: id,
  params: {},
  mutates: true,
  effects: ['read'],
  confirmation: 'none',
  requires: [],
  provider: 'window',
  available: true,
  ...extra
})

const action = (name: string, capability: string, extra: Partial<WorkflowStep> = {}): WorkflowStep =>
  ({ id: name, type: 'action', name, capability, params: {}, ...extra }) as WorkflowStep

const flow = (steps: WorkflowStep[], id = 'w1'): Workflow => ({ id, name: 'W', steps } as Workflow)

// ---------------------------------------------------------------- what it needs

test('what a workflow reaches for is gathered from its own steps, including inside branches and loops', () => {
  const w = flow([
    action('Go', 'navigation.go'),
    { id: 'if1', type: 'if', name: 'check', condition: {}, then: [action('Click', 'page.click')], else: [action('Type', 'page.type')] } as unknown as WorkflowStep,
    { id: 'r1', type: 'repeat', name: 'loop', times: 2, steps: [action('Save', 'notes.add')] } as unknown as WorkflowStep
  ])
  assert.deepEqual(dependencies(w).map((d) => d.id).sort(), ['navigation.go', 'notes.add', 'page.click', 'page.type'])
})

test('a dependency records where it is used, so a missing one can be pointed at', () => {
  const w = flow([action('First', 'page.click'), action('Second', 'page.click')])
  assert.deepEqual(dependencies(w)[0].steps, ['First', 'Second'])
})

test('a disabled step needs nothing', () => {
  assert.deepEqual(dependencies(flow([action('Off', 'page.click', { enabled: false })])), [])
})

// ---------------------------------------------------------------- what is missing, and what that means

test('a capability that is gone and one that is merely unusable now are told apart', () => {
  // They mean different things to a person: one needs the workflow changed, the other needs the right moment.
  const w = flow([action('Gone', 'downloads.purge'), action('Later', 'page.click')])
  const problems = missing(w, [cap('page.click', { available: false, unavailableReason: 'There is no web page in front.' })])
  assert.deepEqual(problems.map((p) => p.reason).sort(), ['absent', 'unavailable'])
  assert.equal(problems.find((p) => p.reason === 'unavailable')?.detail, 'There is no web page in front.')
})

test('a workflow calling a workflow that no longer exists is a missing dependency too', () => {
  const w = flow([{ id: 'c1', type: 'call', name: 'Run other', workflowId: 'gone' } as unknown as WorkflowStep])
  const problems = missing(w, [], [])
  assert.equal(problems[0].kind, 'workflow')
  assert.match(problems[0].detail, /no longer exists/)
})

test('a workflow whose dependencies are all present is runnable', () => {
  const w = flow([action('Go', 'navigation.go')])
  assert.deepEqual(runnable(w, [cap('navigation.go')]), { ok: true, why: '' })
})

test('a workflow that cannot run says which kind of problem it has', () => {
  const gone = runnable(flow([action('Gone', 'downloads.purge')]), [cap('navigation.go')])
  assert.equal(gone.ok, false)
  assert.match(gone.why, /no longer has/)

  const notNow = runnable(flow([action('Click', 'page.click')]), [cap('page.click', { available: false, unavailableReason: 'No page in front.' })])
  assert.equal(notNow.ok, false)
  assert.equal(notNow.why, 'No page in front.')
})

// ---------------------------------------------------------------- repairing only what is certain

test('a capability that was plainly renamed is offered as a rename, not applied', () => {
  const w = flow([action('Close it', 'tabs.close')])
  const result = migrate(w, [cap('tabs.closeTab'), cap('navigation.go')])
  assert.equal(result.changes.length, 1)
  assert.deepEqual({ was: result.changes[0].was, now: result.changes[0].now }, { was: 'tabs.close', now: 'tabs.closeTab' })
  // The original is untouched; the migrated copy is a proposal.
  assert.equal(w.steps[0] && (w.steps[0] as { capability: string }).capability, 'tabs.close')
  assert.equal((result.migrated.steps[0] as { capability: string }).capability, 'tabs.closeTab')
})

test('a capability that is simply gone is not guessed at', () => {
  const result = migrate(flow([action('Wipe', 'downloads.purge')]), [cap('navigation.go'), cap('page.click')])
  assert.deepEqual(result.changes, [])
  assert.equal(result.unrepairable.length, 1)
  assert.equal(result.unrepairable[0].id, 'downloads.purge')
})

test('two equally plausible successors means neither is offered', () => {
  // A workflow pointed at the wrong one of two similar capabilities is worse than one that refuses to run, because
  // it runs -- against somebody's real browser.
  const result = migrate(flow([action('Close', 'tabs.close')]), [cap('tabs.closed'), cap('tabs.closer')])
  assert.deepEqual(result.changes, [])
  assert.equal(result.unrepairable.length, 1)
})

test('a rename is not proposed across domains', () => {
  const result = migrate(flow([action('Close', 'tabs.close')]), [cap('page.close')])
  assert.deepEqual(result.changes, [])
})

test('renames reach inside branches and loops', () => {
  const w = flow([
    { id: 'r1', type: 'repeat', name: 'loop', times: 2, steps: [action('Close', 'tabs.close')] } as unknown as WorkflowStep
  ])
  const result = migrate(w, [cap('tabs.closeTab')])
  const inner = (result.migrated.steps[0] as unknown as { steps: { capability: string }[] }).steps[0]
  assert.equal(inner.capability, 'tabs.closeTab')
})

test('a workflow with nothing missing is returned unchanged', () => {
  const w = flow([action('Go', 'navigation.go')])
  const result = migrate(w, [cap('navigation.go')])
  assert.deepEqual(result.changes, [])
  assert.equal(result.migrated, w, 'the same object, because nothing needed changing')
})

// ---------------------------------------------------------------- after an update

test('the workflows an update has broken are found together, rather than one at a time when they fail', () => {
  const library = [
    flow([action('Go', 'navigation.go')], 'ok'),
    flow([action('Wipe', 'downloads.purge')], 'broken1'),
    flow([action('Old', 'tabs.ancient')], 'broken2')
  ]
  const hurt = affected(library, [cap('navigation.go')])
  assert.deepEqual(hurt.map((h) => h.workflow.id).sort(), ['broken1', 'broken2'])
  assert.equal(hurt[0].problems[0].reason, 'absent')
})
