import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newToken } from './auth.ts'
import { createHandlers } from './handlers.ts'
import type { HandlerDeps } from './handlers.ts'
import { createHelperServer } from './server.ts'
import { SecretsVault } from '../main/vault/store.ts'
import { secretsFromVault, secretChanges } from './secrets.ts'
import { readView } from './galaxy.ts'
import { newWorkflow } from '../shared/workflows.ts'
import type { ActiveWorkflowRun, RecordingState, Workflow } from '../shared/workflows'

const PANEL = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'
const TOKEN = newToken()
const PASSWORD = 'correct horse battery staple'
const SEEN_VALUE = 'sk-live-SUPER-SECRET-VALUE-123'

type Rpc = (channel: string, args?: unknown[]) => Promise<any>
async function withHelper<T>(extra: Partial<HandlerDeps>, fn: (rpc: Rpc) => Promise<T>): Promise<T> {
  const server = createHelperServer({ token: TOKEN, allowedOrigins: [PANEL], handlers: createHandlers({ apiKeys: [], ...extra }) })
  const { port } = await server.listen()
  const rpc: Rpc = async (channel, args = []) => {
    const res = await fetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, Origin: PANEL, 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, args }) })
    const text = await res.text()
    // Whatever the panel is sent, a secret's value must not be in it.
    assert.ok(!text.includes(SEEN_VALUE), `${channel} sent a secret value to the panel`)
    const lines = text.split('\n').filter(Boolean).map((l) => JSON.parse(l))
    const last = lines[lines.length - 1]
    if (last.error) throw Object.assign(new Error(last.error.message), { code: last.error.code })
    return last.result ?? last.value ?? last
  }
  try {
    return await fn(rpc)
  } finally {
    await server.close()
  }
}

test('secrets: locked vault says so; unlock, list without values, add, update keeps the old value, delete', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-sec-'))
  try {
    const vault = new SecretsVault(dir)
    await vault.create('p1', PASSWORD)
    vault.lock()
    const deps = secretsFromVault(vault, async () => 'p1')
    await withHelper({ secrets: () => deps }, async (rpc) => {
      const before = await rpc('secrets:status')
      assert.equal(before.exists, true)
      assert.equal(before.unlocked, false)
      await assert.rejects(rpc('secrets:list'), (e: any) => e.code === 'locked')
      await assert.rejects(rpc('secrets:unlock', ['wrong password']), (e: any) => e.code === 'wrong-password')
      assert.equal((await rpc('secrets:unlock', [PASSWORD])).unlocked, true)

      const added = await rpc('secrets:add', [{ kind: 'apiKey', name: 'Groq', provider: 'Groq', value: SEEN_VALUE, junk: 1 }])
      assert.equal(added.name, 'Groq')
      assert.equal(added.value, undefined)
      const list = await rpc('secrets:list')
      assert.equal(list.length, 1)
      assert.ok(!('value' in list[0]) && !('notes' in list[0]))
      assert.equal((await rpc('secrets:list', ['nothing-like-this'])).length, 0)

      // Rename without a value: the stored value stays.
      await rpc('secrets:update', [added.id, { name: 'Groq main', tags: ['work'] }])
      assert.equal(vault.reveal('p1', added.id).value, SEEN_VALUE)
      assert.equal(vault.reveal('p1', added.id).name, 'Groq main')
      // A new value replaces it.
      await rpc('secrets:update', [added.id, { value: 'new-value' }])
      assert.equal(vault.reveal('p1', added.id).value, 'new-value')

      await assert.rejects(rpc('secrets:update', ['no-such', { name: 'x' }]), (e: any) => e.code === 'not-found')
      assert.equal((await rpc('secrets:delete', [added.id])).removed, true)
      assert.equal((await rpc('secrets:list')).length, 0)
      assert.equal((await rpc('secrets:lock')).unlocked, false)
      await assert.rejects(rpc('secrets:add', [{ name: 'x' }]), (e: any) => e.code === 'locked')
      // There is deliberately no way to read a value.
      for (const channel of ['secrets:reveal', 'secrets:get', 'secrets:copy']) await assert.rejects(rpc(channel, ['x']))
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('secrets: bad shapes are refused and no vault is reported plainly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-sec-'))
  try {
    const vault = new SecretsVault(dir)
    await withHelper({ secrets: () => secretsFromVault(vault, async () => 'p2') }, async (rpc) => {
      await assert.rejects(rpc('secrets:list'), (e: any) => e.code === 'no-vault')
    })
    await vault.create('p2', PASSWORD)
    await withHelper({ secrets: () => secretsFromVault(vault, async () => 'p2') }, async (rpc) => {
      const cases: [string, unknown[]][] = [['secrets:add', ['x']], ['secrets:add', [{}]], ['secrets:add', [{ name: 'a', kind: 'zzz' }]], ['secrets:add', [{ name: 5 }]], ['secrets:update', [7, {}]], ['secrets:unlock', [5]], ['secrets:delete', [{}]]]
      for (const [channel, args] of cases) await assert.rejects(rpc(channel, args), (e: any) => e.code === 'bad-request', `${channel} ${JSON.stringify(args)}`)
    })
    assert.deepEqual(secretChanges({ name: 'n', value: 'v', evil: 1 }, { create: true }), { name: 'n', value: 'v' })
    await withHelper({ secrets: () => null }, async (rpc) => {
      await assert.rejects(rpc('secrets:status'), (e: any) => e.code === 'unavailable')
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------- workflows

function fakeEngine() {
  const wf: Workflow = { ...newWorkflow('Morning check', 'w1'), description: 'Open the news', status: 'ready', schedule: { enabled: true, kind: 'daily', at: 4_000_000_000_000 } }
  const plain: Workflow = { ...newWorkflow('No schedule', 'w2'), status: 'ready' }
  const store = new Map<string, Workflow>([[wf.id, wf], [plain.id, plain]])
  const active: ActiveWorkflowRun[] = []
  const controlled: string[] = []
  const engine = {
    list: async () => [...store.values(), { ...newWorkflow('Old', 'w3'), status: 'archived' as const }],
    get: async (id: string) => store.get(id) ?? null,
    save: async (w: Workflow) => (store.set(w.id, w), w),
    run: async (id: string) => {
      if (id === 'w2') throw Object.assign(new Error('Step 1: nothing to do'), { issues: [{ level: 'error', path: '1', message: 'nothing to do' }] })
      const run = { runId: 'run-1', workflowId: id, workflowName: 'Morning check', version: 1, trigger: 'manual', debug: false, state: { id: 'run-1', name: 'Morning check', source: 'user', status: 'running', currentStep: '1', variables: { password: 'hunter2' }, startedAt: 1, stepsRun: 0, stepIndex: 0, stepCount: 3 } } as unknown as ActiveWorkflowRun
      active.push(run)
      return run
    },
    control: (runId: string, action: string) => (controlled.push(`${runId}:${action}`), active.some((r) => r.runId === runId)),
    activeRuns: () => active,
    history: async () => [{ runId: 'old-1', workflowId: 'w1', workflowName: 'Morning check', version: 1, source: 'user', trigger: 'schedule', status: 'completed', startedAt: 1, finishedAt: 3, durationMs: 2, stepsRun: 3, steps: [] }] as never,
    stats: async () => ({ runs: 1, succeeded: 1, failed: 0, cancelled: 0, averageDurationMs: 2, retries: 0, stepFailures: {} }),
    nextRun: (id: string) => (id === 'w1' ? 4_000_000_000_000 : null),
    plan: async () => ({ lines: [{ path: '1', depth: 0, text: 'Open the news', changes: true, approval: 'never' as const, disabled: false }], issues: [] })
  }
  return { engine, store, controlled }
}

test('workflows: list, view steps, run, follow, stop, schedule on and off; no variables leave', async () => {
  const { engine, store, controlled } = fakeEngine()
  await withHelper({ workflows: () => ({ engine }) }, async (rpc) => {
    const list = await rpc('workflows:list')
    assert.deepEqual(list.workflows.map((w: any) => w.id), ['w1', 'w2'], 'archived ones are not listed')
    assert.equal(list.workflows[0].schedule.enabled, true)
    assert.equal(list.workflows[0].nextRun, 4_000_000_000_000)
    const one = await rpc('workflows:get', ['w1'])
    assert.equal(one.lines[0].text, 'Open the news')
    assert.equal(one.history[0].status, 'completed')
    await assert.rejects(rpc('workflows:get', ['nope']), (e: any) => e.code === 'not-found')

    const started = await rpc('workflows:run', ['w1', { inputs: { q: 'x', n: 2 } }])
    assert.equal(started.ok, true)
    assert.equal(started.run.stepCount, 3)
    assert.equal(JSON.stringify(started).includes('hunter2'), false, 'run variables stay home')
    assert.equal((await rpc('workflows:status', [started.run.runId])).run.status, 'running')
    assert.equal((await rpc('workflows:status', [])).active.length, 1)
    assert.equal((await rpc('workflows:status', ['old-1'])).active, false)
    await assert.rejects(rpc('workflows:status', ['ghost']), (e: any) => e.code === 'not-found')
    assert.equal((await rpc('workflows:stop', ['run-1'])).stopped, true)
    assert.deepEqual(controlled, ['run-1:stop'])

    const refused = await rpc('workflows:run', ['w2'])
    assert.equal(refused.ok, false)
    assert.equal(refused.issues[0].message, 'nothing to do')
    await assert.rejects(rpc('workflows:run', ['w1', { inputs: { a: { deep: 1 } } }]), (e: any) => e.code === 'bad-request')
    await assert.rejects(rpc('workflows:run', ['../x']), (e: any) => e.code === 'bad-request')

    assert.equal((await rpc('workflows:set-enabled', ['w1', false])).schedule.enabled, false)
    assert.equal(store.get('w1')!.schedule!.enabled, false)
    await assert.rejects(rpc('workflows:set-enabled', ['w2', true]), (e: any) => e.code === 'no-schedule')
    await assert.rejects(rpc('workflows:set-enabled', ['w1', 'yes']), (e: any) => e.code === 'bad-request')
  })
})

test('workflows: the record hook calls the recorder only when there is one', async () => {
  const { engine } = fakeEngine()
  await withHelper({ workflows: () => ({ engine }) }, async (rpc) => {
    assert.equal((await rpc('workflows:record-state')).available, false)
    await assert.rejects(rpc('workflows:record-start'), (e: any) => e.code === 'unavailable')
  })
  const calls: string[] = []
  let state: RecordingState = { active: false, paused: false, steps: [], inputs: [], startedAt: 0 }
  const recorder = {
    start: () => (calls.push('start'), (state = { ...state, active: true, startedAt: 5 })),
    stop: () => (calls.push('stop'), (state = { ...state, active: false })),
    current: () => state
  }
  await withHelper({ workflows: () => ({ engine, recorder }) }, async (rpc) => {
    assert.deepEqual(await rpc('workflows:record-state'), { available: true, active: false, paused: false, steps: 0, startedAt: 0 })
    assert.equal((await rpc('workflows:record-start')).active, true)
    assert.equal((await rpc('workflows:record-stop')).active, false)
    assert.deepEqual(calls, ['start', 'stop'])
  })
  await withHelper({ workflows: () => null }, async (rpc) => {
    await assert.rejects(rpc('workflows:list'), (e: any) => e.code === 'unavailable')
  })
})

// ---------------------------------------------------------------- galaxy

test('galaxy: view and describe go to the service with a checked view', async () => {
  const seen: unknown[] = []
  let refreshed = 0
  const graph = { nodes: [{ id: 'note:1', type: 'note', label: 'A' }], edges: [], builtAt: 1, totals: { note: 1 } }
  const galaxy = {
    view: async (v: unknown) => (seen.push(v), graph),
    describe: async (id: string) => ({ node: graph.nodes[0], counts: {}, links: [], id }),
    refresh: () => void refreshed++
  }
  await withHelper({ galaxy: () => galaxy as never }, async (rpc) => {
    const g = await rpc('galaxy:view', [{ types: ['note', 'bogus'], query: 'q', limit: 99999, evil: 1 }])
    assert.equal(g.nodes.length, 1)
    assert.deepEqual(seen[0], { types: ['note'], query: 'q', limit: 1500 })
    await rpc('galaxy:view', [])
    assert.deepEqual(seen[1], { limit: 400 })
    assert.equal(refreshed, 2)
    assert.equal((await rpc('galaxy:describe', ['note:1'])).node.label, 'A')
    await assert.rejects(rpc('galaxy:describe', [5]), (e: any) => e.code === 'bad-request')
    await assert.rejects(rpc('galaxy:view', ['x']), (e: any) => e.code === 'bad-request')
  })
  assert.deepEqual(readView({ depth: 2, from: 5 }), { depth: 2, from: 5, limit: 400 })
})

test('without the app the panel has no secrets, workflows or galaxy channels', async () => {
  await withHelper({}, async (rpc) => {
    for (const c of ['secrets:list', 'workflows:list', 'galaxy:view']) await assert.rejects(rpc(c))
  })
})
