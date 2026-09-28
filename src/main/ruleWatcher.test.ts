import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RuleWatcher, workflowReadings, type RunLike } from './ruleWatcher.ts'
import { RULES_SCHEMA_VERSION, type Readings, type StoredRule } from '../shared/rules.ts'
import { DEFAULT_NOTIFICATIONS } from '../shared/experience.ts'

const AT = Date.UTC(2026, 8, 27, 12, 0, 0)

const rule = (over: Partial<StoredRule> = {}): StoredRule => ({
  id: 'r1',
  name: 'Tell me when the workflow finishes',
  schemaVersion: RULES_SCHEMA_VERSION,
  enabled: true,
  test: { source: 'workflow', field: 'status', operator: 'equals', value: 'succeeded' },
  notify: { title: 'Workflow finished', body: 'Research Report' },
  cooldownMs: 0,
  repeat: 'always',
  createdAt: AT,
  updatedAt: AT,
  ...over
})

interface Harness {
  watcher: RuleWatcher
  said: { title: string; body: string }[]
  stored: StoredRule[][]
  set(readings: Readings): void
}

const harness = (rules: StoredRule[], notifications = DEFAULT_NOTIFICATIONS): Harness => {
  let readings: Readings = {}
  const said: { title: string; body: string }[] = []
  const stored: StoredRule[][] = []
  let current = rules
  const watcher = new RuleWatcher({
    read: () => readings,
    rules: () => current,
    notifications: () => notifications,
    remember: (next) => {
      stored.push(next)
      current = next
    },
    notify: (title, body) => said.push({ title, body })
  })
  return { watcher, said, stored, set: (r) => { readings = r } }
}

// ---------------------------------------------------------------- looking

test('what is already true when Orbis starts is not news', async () => {
  const h = harness([rule()])
  h.set({ workflow: { status: 'succeeded' } })
  // start() looks once, and records what it finds without saying it.
  await h.watcher.start()
  await h.watcher.look()
  h.watcher.stop()
  assert.deepEqual(h.said, [], 'a workflow that finished before Orbis opened is not announced at launch')
})

test('a change while watching is announced, once', async () => {
  const h = harness([rule()])
  h.set({ workflow: { status: 'running' } })
  await h.watcher.start()

  h.set({ workflow: { status: 'succeeded' } })
  await h.watcher.look()
  assert.equal(h.said.length, 1)
  assert.deepEqual(h.said[0], { title: 'Workflow finished', body: 'Research Report' })

  // Still succeeded. Being told once is being told.
  await h.watcher.look()
  await h.watcher.look()
  assert.equal(h.said.length, 1)
  h.watcher.stop()
})

test('what a rule saw is written down, so a restart does not repeat it', async () => {
  const h = harness([rule()])
  h.set({ workflow: { status: 'running' } })
  await h.watcher.start()
  h.set({ workflow: { status: 'succeeded' } })
  await h.watcher.look()
  h.watcher.stop()

  const last = h.stored[h.stored.length - 1]
  assert.equal(last[0].lastResult, true)
  assert.equal(typeof last[0].lastFiredAt, 'number')
})

test('quiet hours silence a rule without spending its one chance to speak', async () => {
  const night = {
    ...DEFAULT_NOTIFICATIONS,
    quietHours: { enabled: true, from: '00:00', to: '23:59' }
  }
  const h = harness([rule()], night)
  h.set({ workflow: { status: 'running' } })
  await h.watcher.start()
  h.set({ workflow: { status: 'succeeded' } })
  await h.watcher.look()
  assert.deepEqual(h.said, [], 'nothing is shown during quiet hours')

  const last = h.stored[h.stored.length - 1]
  assert.equal(last[0].lastFiredAt, undefined, 'it has not spoken, so its cooldown has not started')
  h.watcher.stop()
})

test('a category turned off turns its rules off', async () => {
  const off = { ...DEFAULT_NOTIFICATIONS, categories: { workflows: false } }
  const h = harness([rule()], off)
  h.set({ workflow: { status: 'running' } })
  await h.watcher.start()
  h.set({ workflow: { status: 'succeeded' } })
  await h.watcher.look()
  assert.deepEqual(h.said, [])
  h.watcher.stop()
})

test('a source that throws keeps the rules quiet rather than stuck', async () => {
  const said: { title: string }[] = []
  const watcher = new RuleWatcher({
    read: () => {
      throw new Error('the engine is not up')
    },
    rules: () => [rule()],
    notifications: () => DEFAULT_NOTIFICATIONS,
    remember: () => {},
    notify: (title) => said.push({ title })
  })
  await watcher.start()
  await watcher.look()
  watcher.stop()
  assert.deepEqual(said, [])
})

test('a rule watching something nobody reports never fires', async () => {
  const h = harness([rule({ test: { source: 'download', field: 'status', operator: 'equals', value: 'complete' } })])
  h.set({ workflow: { status: 'running' } })
  await h.watcher.start()
  h.set({ workflow: { status: 'succeeded' } })
  await h.watcher.look()
  assert.deepEqual(h.said, [], 'a missing reading is nothing to compare, not a match')
  h.watcher.stop()
})

test('stopping stops it', async () => {
  const h = harness([rule()])
  h.set({ workflow: { status: 'running' } })
  await h.watcher.start()
  h.watcher.stop()
  h.set({ workflow: { status: 'succeeded' } })
  await h.watcher.look()
  assert.deepEqual(h.said, [])
})

test('nothing is written when the rules have learned nothing', async () => {
  const h = harness([rule()])
  h.set({ workflow: { status: 'running' } })
  await h.watcher.start()
  const afterPriming = h.stored.length

  // Three looks at a world that has not changed. A rule that has learned nothing must not cost a disk write, nor a
  // message to every window, each time it is asked.
  await h.watcher.look()
  await h.watcher.look()
  await h.watcher.look()
  assert.equal(h.stored.length, afterPriming, 'looking is not remembering')
  h.watcher.stop()
})

test('no rules means nothing is read back or written', async () => {
  const h = harness([])
  await h.watcher.start()
  await h.watcher.look()
  assert.deepEqual(h.stored, [])
  h.watcher.stop()
})

// ---------------------------------------------------------------- what is being read

const run = (over: Partial<RunLike['state']> = {}): RunLike => ({
  state: { name: 'Research Report', status: 'running', stepIndex: 4, stepCount: 10, ...over }
})

test('nothing running is no readings, not readings of zero', () => {
  assert.deepEqual(workflowReadings([]), {}, 'no workflow has not failed')
})

test('a run is reported as it is', () => {
  const now = workflowReadings([run()])
  assert.equal(now.workflow.status, 'running')
  assert.equal(now.workflow.name, 'Research Report')
  assert.equal(now.workflow.progress, 40)
  assert.equal(now.workflow.step, 4)
  assert.equal(now.workflow.steps, 10)
  assert.equal(now.workflow.running, 1)
})

test('progress with no step count is not guessed', () => {
  const now = workflowReadings([run({ stepCount: undefined })])
  assert.equal(now.workflow.progress, 0)
  assert.equal(now.workflow.steps, undefined, 'a count nobody knows is not reported')
})

test('with several running, the one furthest along is the one reported', () => {
  const now = workflowReadings([run({ stepIndex: 1 }), run({ name: 'Nightly', stepIndex: 9 })])
  assert.equal(now.workflow.name, 'Nightly')
  assert.equal(now.workflow.progress, 90)
  assert.equal(now.workflow.running, 2, 'and how many there are is reported honestly')
})

test('what a run is waiting for is readable, and the absence of waiting is not a wait', () => {
  assert.equal(workflowReadings([run()]).workflow.waitingFor, '')
  const paused = workflowReadings([run({ status: 'paused', waitingFor: { kind: 'user' } })])
  assert.equal(paused.workflow.waitingFor, 'user')
})
