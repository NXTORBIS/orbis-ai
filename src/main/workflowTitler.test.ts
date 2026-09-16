import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WorkflowTitler } from './workflows/titler.ts'
import { newWorkflow } from '../shared/workflows.ts'
import { titleIdentity } from '../shared/workflowTitle.ts'
import type { Workflow, WorkflowStep } from '../shared/workflows'

const action = (capability: string, params: Record<string, unknown> = {}): WorkflowStep =>
  ({ id: capability, name: capability, type: 'action', capability, params }) as WorkflowStep

/** A workflow with enough about it to be worth naming. */
const workflowFor = (changes: Partial<Workflow> = {}): Workflow => ({
  ...newWorkflow('Untitled workflow', 'w1', 1000),
  schedule: { enabled: true, kind: 'daily', at: 8 * 3600_000 },
  steps: [action('browser.open', { url: 'https://mail.google.com' })],
  ...changes
})

/** A stand-in Orbis: a stored workflow, a recorded list of what Orion was asked, and what the window was told. */
function harness(options: { answers?: (string | null)[]; start?: Workflow } = {}) {
  let stored = options.start ?? workflowFor()
  const asked: string[] = []
  const announced: string[] = []
  const answers = [...(options.answers ?? ['Daily Email Summary'])]
  const titler = new WorkflowTitler({
    get: async () => stored,
    save: async (workflow) => {
      stored = workflow
      return workflow
    },
    ask: async (context) => {
      asked.push(context)
      return answers.length > 1 ? (answers.shift() ?? null) : (answers[0] ?? null)
    },
    announce: (workflow) => announced.push(workflow.name)
  })
  return {
    titler,
    asked,
    announced,
    get stored() {
      return stored
    },
    set stored(next: Workflow) {
      stored = next
    }
  }
}

test('a new workflow is named by Orion, without being asked to be', async () => {
  const h = harness()
  await h.titler.regenerate('w1')

  assert.equal(h.asked.length, 1, 'Orion was asked once')
  assert.equal(h.stored.name, 'Daily Email Summary')
  assert.equal(h.stored.titleSource, 'ai')
  assert.equal(h.stored.lastTitleContext, titleIdentity(workflowFor()), 'what it was for when it was named is recorded')
  assert.ok(h.stored.lastGeneratedAt)
  assert.equal(h.stored.titleVersion, 1)
  assert.deepEqual(h.announced, ['Daily Email Summary'], 'the window is told, so it appears without a reload')
})

test('the name Orion is asked for describes the purpose, and carries nothing secret', async () => {
  const h = harness({
    start: workflowFor({
      description: 'Every morning, summarise the important mail. The password is hunter2',
      steps: [action('browser.open', { url: 'https://mail.google.com' })]
    })
  })
  await h.titler.regenerate('w1')
  assert.match(h.asked[0], /Schedule: daily/)
  assert.match(h.asked[0], /mail\.google\.com/)
  assert.ok(!h.asked[0].includes('hunter2'))
})

test('a name somebody chose themselves is never taken away', async () => {
  const h = harness({ start: workflowFor({ name: 'My morning thing', titleSource: 'user' }) })

  // However much the workflow then changes.
  h.titler.onSaved(h.stored)
  h.stored = { ...h.stored, steps: [action('browser.open', { url: 'https://news.example.com' })] }
  h.titler.onSaved(h.stored)
  await new Promise((r) => setTimeout(r, 60))

  assert.equal(h.asked.length, 0, 'Orion is not even asked')
  assert.equal(h.stored.name, 'My morning thing')
  assert.equal(h.stored.titleSource, 'user')
})

test('asking outright takes naming back from the user, and hands it to Orion again', async () => {
  const h = harness({ start: workflowFor({ name: 'My morning thing', titleSource: 'user' }), answers: ['Daily Email Summary'] })
  const named = await h.titler.regenerate('w1')

  assert.equal(named?.name, 'Daily Email Summary')
  assert.equal(h.stored.titleSource, 'ai', 'it is Orbis’s to name again')
  assert.equal(h.stored.titleVersion, 1)
})

test('a workflow that has not changed its purpose is not renamed, and Orion is not asked', async () => {
  const settled = workflowFor({ name: 'Daily Email Summary', titleSource: 'ai', lastTitleContext: titleIdentity(workflowFor()) })
  const h = harness({ start: settled })

  // Every one of these is implementation, not purpose.
  for (const change of [
    { schedule: { enabled: true, kind: 'daily' as const, at: 9 * 3600_000 } },
    { steps: [{ ...action('browser.open', { url: 'https://mail.google.com' }), timeoutMs: 60_000 } as unknown as WorkflowStep] },
    { settings: { ...settled.settings, maxIterations: 50 } }
  ]) {
    h.stored = { ...settled, ...change }
    h.titler.onSaved(h.stored)
  }
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(h.asked.length, 0, 'none of that is a new workflow')
  assert.equal(h.stored.name, 'Daily Email Summary')
})

test('Orion failing leaves the workflow and its name exactly as they were', async () => {
  const h = harness({ start: workflowFor({ name: 'Daily Email Summary', titleSource: 'ai' }), answers: [null] })
  const result = await h.titler.regenerate('w1')

  assert.equal(result, null)
  assert.equal(h.stored.name, 'Daily Email Summary', 'nothing is invented in its place')
  assert.equal(h.stored.titleVersion, 0, 'and nothing is recorded as generated')
  assert.equal(h.stored.lastGeneratedAt, undefined)
  assert.deepEqual(h.announced, [])
})

test('an unnamed workflow Orion cannot name stays untitled rather than getting a made-up name', async () => {
  const h = harness({ answers: [null] })
  await h.titler.regenerate('w1')
  assert.equal(h.stored.name, 'Untitled workflow')
  assert.deepEqual(h.announced, [])
})

test('a name that only rewords the old one is not worth the change', async () => {
  const settled = workflowFor({ name: 'Daily Email Summary', titleSource: 'ai' })
  const h = harness({ start: settled, answers: ['Email Summary Daily'] })

  // A real change of purpose, so Orion is asked; but its answer says the same thing as the name already there.
  h.stored = { ...settled, steps: [...settled.steps, action('page.read')], lastTitleContext: 'something else' }
  h.titler.onSaved(h.stored)
  await new Promise((r) => setTimeout(r, 3200))

  assert.equal(h.asked.length, 1)
  assert.equal(h.stored.name, 'Daily Email Summary', 'the name somebody already recognises stays')
  assert.equal(h.stored.lastTitleContext, titleIdentity(h.stored), 'but it is not reconsidered again on every save')
})

test('several edits in a row ask Orion once, not once each', async () => {
  const h = harness()
  for (let i = 0; i < 6; i++) {
    h.stored = { ...h.stored, steps: [action('browser.open', { url: `https://site${i}.example` })] }
    h.titler.onSaved(h.stored)
    await new Promise((r) => setTimeout(r, 30))
  }
  await new Promise((r) => setTimeout(r, 3200))
  assert.equal(h.asked.length, 1, 'the edits settled into one request')
})

test('nothing is asked for a workflow with nothing in it yet', async () => {
  const h = harness({ start: newWorkflow('Untitled workflow', 'w1', 1000) })
  h.titler.onSaved(h.stored)
  await new Promise((r) => setTimeout(r, 3200))
  assert.equal(h.asked.length, 0, 'there is nothing to describe')
  assert.equal(h.stored.name, 'Untitled workflow')
})

test('stopping cancels what was queued', async () => {
  const h = harness()
  h.titler.onSaved(h.stored)
  h.titler.stop()
  await new Promise((r) => setTimeout(r, 3200))
  assert.equal(h.asked.length, 0)
})
