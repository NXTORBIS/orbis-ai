import test from 'node:test'
import assert from 'node:assert/strict'
import { alreadyRunning, blockedBy, conflicts, resourcesOf, schedule } from './workflowQueue.ts'
import type { QueuedRun, Resource, Running } from './workflowQueue.ts'
import type { CapabilityDescriptor } from './browserControl.ts'
import type { Workflow, WorkflowStep } from './workflows.ts'

const cap = (id: string, domain: string, mutates: boolean): CapabilityDescriptor => ({
  id,
  domain: domain as CapabilityDescriptor['domain'],
  name: id,
  description: id,
  params: {},
  mutates,
  confirmation: 'none',
  requires: [],
  provider: 'window',
  available: true
})

const CAPS = [
  cap('page.read', 'page', false),
  cap('page.type', 'page', true),
  cap('tabs.list', 'tabs', false),
  cap('tabs.create', 'tabs', true),
  cap('notes.add', 'notes', true),
  cap('clipboard.write', 'clipboard', true)
]

const flow = (steps: WorkflowStep[]): Workflow => ({ steps } as Workflow)
const action = (id: string, capability: string, extra: Partial<WorkflowStep> = {}): WorkflowStep =>
  ({ id, type: 'action', name: id, capability, params: {}, ...extra }) as WorkflowStep

const run = (runId: string, resources: Resource[], extra: Partial<QueuedRun> = {}): QueuedRun => ({
  runId,
  workflowId: `w-${runId}`,
  priority: 0,
  queuedAt: 0,
  resources,
  profileId: 'p1',
  ...extra
})

const busy = (runId: string, resources: Resource[], profileId = 'p1'): Running => ({ runId, workflowId: `w-${runId}`, resources, profileId })

// ---------------------------------------------------------------- what a workflow reaches for

test('what a workflow touches is read from the registry, not guessed from names', () => {
  const found = resourcesOf(flow([action('a', 'page.read'), action('b', 'notes.add')]), CAPS)
  assert.deepEqual(
    found.map((r) => `${r.kind}${r.write ? '(write)' : ''}`).sort(),
    ['page', 'store(write)']
  )
})

test('a workflow that reads a page and later types into it holds the page for writing', () => {
  const found = resourcesOf(flow([action('a', 'page.read'), action('b', 'page.type')]), CAPS)
  assert.equal(found.length, 1)
  assert.equal(found[0].write, true)
})

test('what a branch or a loop contains is still something the workflow reaches for', () => {
  const nested = flow([
    { id: 'if1', type: 'if', name: 'check', condition: {}, then: [action('a', 'page.type')], else: [] } as unknown as WorkflowStep,
    { id: 'r1', type: 'repeat', name: 'loop', times: 3, steps: [action('b', 'clipboard.write')] } as unknown as WorkflowStep
  ])
  const kinds = resourcesOf(nested, CAPS).map((r) => r.kind).sort()
  assert.deepEqual(kinds, ['clipboard', 'page'])
})

test('a capability this Orbis does not have reaches for nothing', () => {
  assert.deepEqual(resourcesOf(flow([action('a', 'nope.thing')]), CAPS), [])
})

test('a disabled step reaches for nothing', () => {
  assert.deepEqual(resourcesOf(flow([action('a', 'page.type', { enabled: false })]), CAPS), [])
})

// ---------------------------------------------------------------- what may share

test('two readers of the same thing can go together', () => {
  assert.equal(conflicts({ kind: 'page', id: '', write: false }, { kind: 'page', id: '', write: false }), false)
})

test('a writer excludes everyone else on the same thing', () => {
  assert.equal(conflicts({ kind: 'page', id: '', write: true }, { kind: 'page', id: '', write: false }), true)
  assert.equal(conflicts({ kind: 'page', id: '', write: true }, { kind: 'page', id: '', write: true }), true)
})

test('different things do not collide', () => {
  assert.equal(conflicts({ kind: 'page', id: '', write: true }, { kind: 'clipboard', id: '', write: true }), false)
})

test('two named stores do not collide, but an unnamed claim covers them all', () => {
  assert.equal(conflicts({ kind: 'store', id: 'notes', write: true }, { kind: 'store', id: 'tasks', write: true }), false)
  assert.equal(conflicts({ kind: 'store', id: '', write: true }, { kind: 'store', id: 'tasks', write: true }), true)
})

// ---------------------------------------------------------------- waiting, and why

test('a run waiting on another is told which one and what for', () => {
  const blocked = blockedBy(run('r2', [{ kind: 'page', id: '', write: true }]), [busy('r1', [{ kind: 'page', id: '', write: true }])])
  assert.equal(blocked?.by, 'r1')
  assert.match(blocked!.reason, /waiting for another workflow to finish with the page/)
})

test('one profile never waits on another profile’s work', () => {
  // Profiles are separate worlds; letting one hold the other up would leak the fact that it is running at all.
  const blocked = blockedBy(run('r2', [{ kind: 'page', id: '', write: true }], { profileId: 'p2' }), [busy('r1', [{ kind: 'page', id: '', write: true }], 'p1')])
  assert.equal(blocked, null)
})

test('a run that clashes with nothing is not blocked', () => {
  assert.equal(blockedBy(run('r2', [{ kind: 'clipboard', id: '', write: true }]), [busy('r1', [{ kind: 'page', id: '', write: true }])]), null)
})

// ---------------------------------------------------------------- what starts next

test('runs that reach for different things start together', () => {
  const { start } = schedule(
    [run('a', [{ kind: 'page', id: '', write: true }]), run('b', [{ kind: 'clipboard', id: '', write: true }])],
    []
  )
  assert.deepEqual(start.map((r) => r.runId), ['a', 'b'])
})

test('runs that reach for the same thing are serialised, and the held one says why', () => {
  const { start, waiting } = schedule(
    [run('a', [{ kind: 'page', id: '', write: true }]), run('b', [{ kind: 'page', id: '', write: true }])],
    []
  )
  assert.deepEqual(start.map((r) => r.runId), ['a'])
  assert.equal(waiting[0].runId, 'b')
  assert.match(waiting[0].reason, /page/)
})

test('priority decides order, and equal priorities keep the order they were asked in', () => {
  const { start } = schedule(
    [
      run('old', [{ kind: 'clipboard', id: '', write: true }], { queuedAt: 1 }),
      run('urgent', [{ kind: 'page', id: '', write: true }], { priority: 10, queuedAt: 5 }),
      run('newer', [{ kind: 'settings', id: '', write: true }], { queuedAt: 2 })
    ],
    []
  )
  assert.deepEqual(start.map((r) => r.runId), ['urgent', 'old', 'newer'])
})

test('a run held back keeps its place rather than losing it to one queued later', () => {
  const { start, waiting } = schedule(
    [
      run('first', [{ kind: 'page', id: '', write: true }], { queuedAt: 1 }),
      run('second', [{ kind: 'page', id: '', write: true }], { queuedAt: 2 })
    ],
    [busy('running', [{ kind: 'page', id: '', write: true }])]
  )
  assert.deepEqual(start, [])
  assert.deepEqual(waiting.map((w) => w.runId), ['first', 'second'])
})

test('the limit on how many run at once is respected, and said', () => {
  const many = [1, 2, 3, 4, 5].map((n) => run(`r${n}`, [{ kind: 'store', id: `s${n}`, write: true }]))
  const { start, waiting } = schedule(many, [], 3)
  assert.equal(start.length, 3)
  assert.match(waiting[0].reason, /free slot/)
})

// ---------------------------------------------------------------- not twice

test('a workflow already running is found, so it is not started a second time', () => {
  const running = [busy('r1', [])]
  running[0].workflowId = 'w9'
  assert.equal(alreadyRunning('w9', 'p1', running)?.runId, 'r1')
  assert.equal(alreadyRunning('w9', 'p2', running), null)
  assert.equal(alreadyRunning('other', 'p1', running), null)
})
