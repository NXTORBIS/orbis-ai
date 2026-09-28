import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  LAB_ASSUMPTIONS,
  LAB_LIMITS,
  assessHealth,
  assessStaleness,
  checkCompatibility,
  checkConnection,
  checkGraph,
  checkpointFrom,
  compareRuns,
  emptyProject,
  fingerprintAll,
  fingerprintNode,
  isLabError,
  nameExecution,
  planExecution,
  restoreCheckpoint,
  runProject,
  topologicalOrder,
  whatToRerun,
  type Edge,
  type LabNode,
  type LabProject,
  type NodeResult,
  type Port
} from './lab.ts'

const port = (id: string, kind: Port['kind'], options: Partial<Port> = {}): Port => ({
  id,
  name: options.name ?? id,
  kind,
  unit: options.unit ?? '',
  required: options.required ?? true,
  describe: options.describe ?? ''
})

const node = (id: string, options: Partial<LabNode> = {}): LabNode => ({
  id,
  kind: options.kind ?? 'expression',
  name: options.name ?? id,
  operation: options.operation ?? 'mathematics.evaluate',
  configuration: options.configuration ?? {},
  inputs: options.inputs ?? [],
  outputs: options.outputs ?? [port('out', 'number')],
  status: options.status ?? 'idle',
  deterministic: options.deterministic ?? true,
  seed: options.seed ?? null,
  cost: options.cost ?? { calls: 1, memoryBytes: 1024 },
  retryPolicy: options.retryPolicy ?? { attempts: 1, onlyWhen: 'never' },
  optional: options.optional ?? false
})

const edge = (id: string, from: string, to: string, fromPort = 'out', toPort = 'in'): Edge => ({
  id,
  from: { nodeId: from, portId: fromPort },
  to: { nodeId: to, portId: toPort }
})

/** A -> B -> C, with B and C each taking one number in. */
const chain = (): LabProject => ({
  ...emptyProject('p', 'Chain', 'page', 'profile'),
  nodes: [
    node('a', { name: 'Input' }),
    node('b', { name: 'Middle', inputs: [port('in', 'number')] }),
    node('c', { name: 'Output', inputs: [port('in', 'number')] })
  ],
  edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
  engineVersions: { expression: '1' }
})

describe('connections', () => {
  test('matching kinds connect with no conversion', () => {
    const check = checkConnection(port('o', 'number'), port('i', 'number'))
    assert.equal(check.ok, true)
    assert.equal(check.conversion, null)
  })

  test('an integer flows into a number', () => {
    const check = checkConnection(port('o', 'integer'), port('i', 'number'))
    assert.equal(check.ok, true)
    assert.equal(check.conversion, 'integer->number')
    assert.equal(check.lossy, false)
  })

  test('a quantity into a number is allowed and says what it costs', () => {
    const check = checkConnection(port('o', 'quantity'), port('i', 'number'))
    assert.equal(check.ok, true)
    assert.equal(check.lossy, true)
    assert.match(check.message, /losing its unit/)
  })

  test('text into a matrix is refused rather than coerced', () => {
    const check = checkConnection(port('o', 'text'), port('i', 'matrix'))
    assert.equal(check.ok, false)
    assert.match(check.message, /computes something you did not ask for/)
  })

  test('two quantities in different units connect through a conversion', () => {
    const check = checkConnection(port('o', 'quantity', { unit: 'm' }), port('i', 'quantity', { unit: 'cm' }))
    assert.equal(check.ok, true)
    assert.equal(check.conversion, 'm->cm')
  })

  test('two quantities in the same unit need no conversion', () => {
    const check = checkConnection(port('o', 'quantity', { unit: 'm' }), port('i', 'quantity', { unit: 'm' }))
    assert.equal(check.conversion, null)
  })
})

describe('graph validation', () => {
  test('a well-formed graph passes', () => {
    const check = checkGraph(chain())
    assert.equal(check.ok, true)
    assert.deepEqual(check.problems, [])
  })

  test('a cycle is refused, naming the nodes in it', () => {
    const project = chain()
    project.edges.push(edge('e3', 'c', 'a', 'out', 'in'))
    project.nodes[0].inputs = [port('in', 'number')]
    const check = checkGraph(project)
    assert.equal(check.ok, false)
    const cycle = check.problems.find((one) => one.kind === 'cycle')
    assert.ok(cycle)
    assert.match(cycle.describe, /Input/)
    assert.match(cycle.describe, /Middle/)
  })

  test('a node connected to itself is a cycle too', () => {
    const project: LabProject = {
      ...emptyProject('p', 'Self', 'page', 'profile'),
      nodes: [node('a', { inputs: [port('in', 'number')] })],
      edges: [edge('e', 'a', 'a')]
    }
    assert.equal(checkGraph(project).ok, false)
  })

  test('a required input with nothing supplying it is a blocker, and it is named', () => {
    const project = chain()
    project.edges = [edge('e2', 'b', 'c')]
    const check = checkGraph(project)
    assert.equal(check.ok, false)
    const problem = check.problems.find((one) => one.kind === 'unconnected-required')
    assert.ok(problem)
    assert.match(problem.describe, /"Middle" needs in/)
  })

  test('a required input supplied in the configuration is satisfied', () => {
    const project = chain()
    project.edges = [edge('e2', 'b', 'c')]
    project.nodes[1].configuration = { in: 5 }
    assert.equal(checkGraph(project).ok, true)
  })

  test('a connection to a port that does not exist is refused', () => {
    const project = chain()
    project.edges.push(edge('e3', 'a', 'c', 'nope', 'in'))
    const check = checkGraph(project)
    assert.ok(check.problems.some((one) => one.kind === 'missing-port'))
  })

  test('a type mismatch is a blocker', () => {
    const project = chain()
    project.nodes[1].inputs = [port('in', 'matrix')]
    const check = checkGraph(project)
    assert.equal(check.ok, false)
    assert.ok(check.problems.some((one) => one.kind === 'type-mismatch'))
  })

  test('a lossy conversion is allowed and reported before anything runs', () => {
    const project = chain()
    project.nodes[0].outputs = [port('out', 'quantity', { unit: 'm' })]
    const check = checkGraph(project)
    assert.equal(check.ok, true)
    assert.ok(check.conversions.some((one) => one.lossy))
    assert.ok(check.notes.some((one) => /loses something on the way through/.test(one)))
  })

  test('a node that is not deterministic and has no seed is called out', () => {
    const project = chain()
    project.nodes[1].deterministic = false
    const check = checkGraph(project)
    assert.ok(check.notes.some((one) => /cannot be reproduced/.test(one)))
  })

  test('two nodes with the same id are refused', () => {
    const project = chain()
    project.nodes.push(node('a', { name: 'Duplicate' }))
    assert.ok(checkGraph(project).problems.some((one) => one.kind === 'duplicate'))
  })

  test('a graph past the node ceiling is refused', () => {
    const project = emptyProject('p', 'Big', 'page', 'profile')
    project.nodes = Array.from({ length: LAB_LIMITS.nodes + 1 }, (_, i) => node(`n${i}`))
    assert.ok(checkGraph(project).problems.some((one) => one.kind === 'too-large'))
  })
})

describe('ordering', () => {
  test('the order follows the connections, not the list order', () => {
    const project = chain()
    // Reversing the node list must not change the order they run in.
    project.nodes.reverse()
    const order = topologicalOrder(project)
    assert.ok(!isLabError(order))
    assert.deepEqual(order, ['a', 'b', 'c'])
  })

  test('the order is stable between calls, so two runs are comparable', () => {
    const project: LabProject = {
      ...emptyProject('p', 'Wide', 'page', 'profile'),
      nodes: [node('z'), node('y'), node('x'), node('sink', { inputs: [port('in', 'number')] })],
      edges: [edge('e', 'x', 'sink')]
    }
    const first = topologicalOrder(project)
    const second = topologicalOrder(project)
    assert.ok(!isLabError(first) && !isLabError(second))
    assert.deepEqual(first, second)
  })

  test('independent nodes land in the same group', () => {
    const project: LabProject = {
      ...emptyProject('p', 'Fan', 'page', 'profile'),
      nodes: [
        node('source'),
        node('a', { inputs: [port('in', 'number')] }),
        node('b', { inputs: [port('in', 'number')] }),
        node('sink', { inputs: [port('in', 'number'), port('in2', 'number')] })
      ],
      edges: [edge('e1', 'source', 'a'), edge('e2', 'source', 'b'), edge('e3', 'a', 'sink'), edge('e4', 'b', 'sink', 'out', 'in2')]
    }
    const plan = planExecution(project)
    assert.ok(!isLabError(plan))
    assert.deepEqual(plan.groups, [['source'], ['a', 'b'], ['sink']])
  })
})

describe('planning', () => {
  test('a plan estimates the work before anything runs', () => {
    const project = chain()
    for (const one of project.nodes) one.cost = { calls: 1000, memoryBytes: 2048 }
    const plan = planExecution(project)
    assert.ok(!isLabError(plan))
    assert.equal(plan.estimated.calls, 3000)
    assert.equal(plan.estimated.nodes, 3)
  })

  test('peak memory is the largest group, not the whole graph', () => {
    const project: LabProject = {
      ...emptyProject('p', 'Fan', 'page', 'profile'),
      nodes: [
        node('source', { cost: { calls: 1, memoryBytes: 100 } }),
        node('a', { inputs: [port('in', 'number')], cost: { calls: 1, memoryBytes: 500 } }),
        node('b', { inputs: [port('in', 'number')], cost: { calls: 1, memoryBytes: 500 } })
      ],
      edges: [edge('e1', 'source', 'a'), edge('e2', 'source', 'b')]
    }
    const plan = planExecution(project)
    assert.ok(!isLabError(plan))
    // a and b share a group: 1000. The source is in its own group at 100.
    assert.equal(plan.estimated.memoryBytes, 1000)
  })

  test('a cached node is skipped and reported', () => {
    const plan = planExecution(chain(), { cached: ['a'] })
    assert.ok(!isLabError(plan))
    assert.deepEqual(plan.skipped, ['a'])
    assert.deepEqual(plan.order, ['b', 'c'])
    assert.ok(plan.notes.some((one) => /will not be run again/.test(one)))
  })

  test('forcing ignores the cache', () => {
    const plan = planExecution(chain(), { cached: ['a'], force: true })
    assert.ok(!isLabError(plan))
    assert.deepEqual(plan.skipped, [])
    assert.equal(plan.order.length, 3)
  })

  test('running one node pulls in everything it needs', () => {
    const plan = planExecution(chain(), { only: ['c'] })
    assert.ok(!isLabError(plan))
    assert.deepEqual(plan.order, ['a', 'b', 'c'])
  })

  test('running a node whose inputs are cached runs only it', () => {
    const plan = planExecution(chain(), { only: ['c'], cached: ['a', 'b'] })
    assert.ok(!isLabError(plan))
    assert.deepEqual(plan.order, ['c'])
  })

  test('a heavy run is flagged as worth confirming', () => {
    const project = chain()
    project.nodes[0].cost = { calls: 5_000_000, memoryBytes: 1024 }
    const plan = planExecution(project)
    assert.ok(!isLabError(plan))
    assert.equal(plan.heavy, true)
    assert.ok(plan.notes.some((one) => /worth confirming/.test(one)))
  })

  test('a node that is not in the project cannot be asked for', () => {
    assert.ok(isLabError(planExecution(chain(), { only: ['nope'] })))
  })

  test('a plan of a cyclic graph is the cycle error, not a partial order', () => {
    const project = chain()
    project.nodes[0].inputs = [port('in', 'number')]
    project.edges.push(edge('e3', 'c', 'a'))
    assert.ok(isLabError(planExecution(project)))
  })
})

describe('fingerprints and staleness', () => {
  test('a fingerprint does not depend on the order of configuration keys', () => {
    const a = node('n', { configuration: { x: 1, y: 2 } })
    const b = node('n', { configuration: { y: 2, x: 1 } })
    assert.equal(fingerprintNode(a, [], '1'), fingerprintNode(b, [], '1'))
  })

  test('changing the configuration, the engine or the seed changes the fingerprint', () => {
    const base = node('n', { configuration: { x: 1 } })
    const first = fingerprintNode(base, [], '1')
    assert.notEqual(first, fingerprintNode(node('n', { configuration: { x: 2 } }), [], '1'))
    assert.notEqual(first, fingerprintNode(base, [], '2'))
    assert.notEqual(first, fingerprintNode(node('n', { configuration: { x: 1 }, seed: 5 }), [], '1'))
  })

  test('a change upstream changes every fingerprint downstream', () => {
    const before = fingerprintAll(chain())
    assert.ok(!isLabError(before))
    const after = chain()
    after.nodes[0].configuration = { changed: true }
    const now = fingerprintAll(after)
    assert.ok(!isLabError(now))
    assert.notEqual(before.get('a'), now.get('a'))
    assert.notEqual(before.get('b'), now.get('b'))
    assert.notEqual(before.get('c'), now.get('c'))
  })

  test('results matching the current fingerprints are current', () => {
    const project = chain()
    const fingerprints = fingerprintAll(project)
    assert.ok(!isLabError(fingerprints))
    const results: NodeResult[] = project.nodes.map((one) => ({
      nodeId: one.id,
      outputs: { out: 1 },
      status: 'completed',
      error: '',
      fingerprint: fingerprints.get(one.id) as string,
      calls: 1,
      seed: null,
      engineVersion: '1',
      attempts: 1
    }))
    const staleness = assessStaleness(project, results)
    assert.ok(!isLabError(staleness))
    assert.deepEqual(staleness.stale, [])
    assert.equal(staleness.current.length, 3)
  })

  test('changing an input makes everything downstream stale, and each says why', () => {
    const project = chain()
    const fingerprints = fingerprintAll(project)
    assert.ok(!isLabError(fingerprints))
    const results: NodeResult[] = project.nodes.map((one) => ({
      nodeId: one.id,
      outputs: { out: 1 },
      status: 'completed',
      error: '',
      fingerprint: fingerprints.get(one.id) as string,
      calls: 1,
      seed: null,
      engineVersion: '1',
      attempts: 1
    }))

    const edited = chain()
    edited.nodes[0].configuration = { changed: true }
    const staleness = assessStaleness(edited, results)
    assert.ok(!isLabError(staleness))
    assert.deepEqual(staleness.stale.sort(), ['a', 'b', 'c'])
    assert.match(staleness.reasons.find((one) => one.nodeId === 'a')?.because ?? '', /itself changed/)
    assert.match(staleness.reasons.find((one) => one.nodeId === 'b')?.because ?? '', /Input changed/)
  })

  test('a node with no result is missing, not stale', () => {
    const staleness = assessStaleness(chain(), [])
    assert.ok(!isLabError(staleness))
    assert.deepEqual(staleness.missing.sort(), ['a', 'b', 'c'])
    assert.deepEqual(staleness.stale, [])
  })

  test('a node downstream of a failure is blocked, not stale', () => {
    const project = chain()
    const results: NodeResult[] = [
      { nodeId: 'a', outputs: {}, status: 'failed', error: 'boom', fingerprint: 'x', calls: 0, seed: null, engineVersion: '1', attempts: 1 }
    ]
    const staleness = assessStaleness(project, results)
    assert.ok(!isLabError(staleness))
    assert.deepEqual(staleness.blocked, ['b', 'c'])
  })

  test('what to rerun is only the nodes that need it, in order', () => {
    const project = chain()
    const fingerprints = fingerprintAll(project)
    assert.ok(!isLabError(fingerprints))
    const results: NodeResult[] = [
      { nodeId: 'a', outputs: { out: 1 }, status: 'completed', error: '', fingerprint: fingerprints.get('a') as string, calls: 1, seed: null, engineVersion: '1', attempts: 1 }
    ]
    const rerun = whatToRerun(project, results, 'c')
    assert.ok(!isLabError(rerun))
    assert.deepEqual(rerun, ['b', 'c'])
  })
})

describe('running', () => {
  const evaluate = (one: LabNode): { outputs: Record<string, unknown>; calls: number } => ({ outputs: { out: one.id }, calls: 1 })

  test('every node runs in order and the results are recorded', () => {
    const execution = runProject(chain(), evaluate, { executionId: 'e1' })
    assert.ok(!isLabError(execution))
    assert.equal(execution.completed, 3)
    assert.equal(execution.failed, 0)
    assert.equal(execution.calls, 3)
    assert.deepEqual(execution.results.map((one) => one.nodeId), ['a', 'b', 'c'])
  })

  test('inputs arrive from the nodes that produced them', () => {
    const seen: Record<string, unknown>[] = []
    const execution = runProject(chain(), (one, inputs) => {
      seen.push({ ...inputs })
      return { outputs: { out: `${one.id}-value` }, calls: 1 }
    }, { executionId: 'e1' })
    assert.ok(!isLabError(execution))
    assert.deepEqual(seen[1], { in: 'a-value' })
    assert.deepEqual(seen[2], { in: 'b-value' })
  })

  test('a failure blocks what depends on it rather than failing it too', () => {
    const execution = runProject(chain(), (one) => {
      if (one.id === 'b') throw new Error('the middle broke')
      return { outputs: { out: one.id }, calls: 1 }
    }, { executionId: 'e1' })
    assert.ok(!isLabError(execution))
    assert.equal(execution.failed, 1)
    assert.equal(execution.blocked, 1)
    assert.equal(execution.results.find((one) => one.nodeId === 'c')?.status, 'blocked')
    assert.match(execution.results.find((one) => one.nodeId === 'c')?.error ?? '', /Middle failed/)
    assert.ok(execution.notes.some((one) => /marked blocked rather than failed/.test(one)))
  })

  test('an optional node that fails does not block what comes after it', () => {
    const project = chain()
    project.nodes[1].optional = true
    const execution = runProject(project, (one) => {
      if (one.id === 'b') throw new Error('optional failure')
      return { outputs: { out: one.id }, calls: 1 }
    }, { executionId: 'e1' })
    assert.ok(!isLabError(execution))
    assert.equal(execution.blocked, 0)
    assert.ok(execution.notes.some((one) => /optional node/.test(one)))
  })

  test('a graph that does not validate is refused without running anything', () => {
    const project = chain()
    project.edges = []
    let called = 0
    const execution = runProject(project, () => {
      called += 1
      return { outputs: {}, calls: 1 }
    }, { executionId: 'e1' })
    assert.ok(isLabError(execution))
    assert.equal(called, 0)
    assert.match(execution.recovery, /Nothing was started/)
  })

  test('cancelling keeps what finished and marks the rest as never run', () => {
    let done = 0
    const execution = runProject(chain(), (one) => {
      done += 1
      return { outputs: { out: one.id }, calls: 1 }
    }, { executionId: 'e1', cancelled: () => done >= 1 })
    assert.ok(!isLabError(execution))
    assert.equal(execution.completed, 1)
    assert.equal(execution.cancelled, true)
    assert.ok(execution.notes.some((one) => /This is a partial run/.test(one)))
  })

  test('a retry policy retries a transient failure but not a deterministic one', () => {
    const project = chain()
    project.nodes[1].retryPolicy = { attempts: 3, onlyWhen: 'transient' }
    project.nodes[1].deterministic = true
    let attempts = 0
    runProject(project, (one) => {
      if (one.id === 'b') {
        attempts += 1
        throw new Error('always fails')
      }
      return { outputs: { out: one.id }, calls: 1 }
    }, { executionId: 'e1' })
    // A deterministic node fails the same way every time, so retrying it is wasted work.
    assert.equal(attempts, 1)
  })

  test('a non-deterministic node is retried under a transient policy', () => {
    const project = chain()
    project.nodes[1].retryPolicy = { attempts: 3, onlyWhen: 'transient' }
    project.nodes[1].deterministic = false
    project.nodes[1].seed = 1
    let attempts = 0
    runProject(project, (one) => {
      if (one.id === 'b') {
        attempts += 1
        if (attempts < 3) throw new Error('flaky')
      }
      return { outputs: { out: one.id }, calls: 1 }
    }, { executionId: 'e1' })
    assert.equal(attempts, 3)
  })

  test('events are emitted in order and only for what happened', () => {
    const events: string[] = []
    const execution = runProject(chain(), evaluate, {
      executionId: 'e1',
      onEvent: (event) => events.push(event.kind)
    })
    assert.ok(!isLabError(execution))
    assert.equal(events[0], 'EXECUTION_STARTED')
    assert.equal(events[events.length - 1], 'EXECUTION_COMPLETED')
    assert.equal(events.filter((one) => one === 'NODE_COMPLETED').length, 3)
    assert.equal(events.filter((one) => one === 'NODE_FAILED').length, 0)
  })

  test('a run with an unseeded random node says it cannot be reproduced, and names it', () => {
    const project = chain()
    project.nodes[1].deterministic = false
    const execution = runProject(project, evaluate, { executionId: 'e1' })
    assert.ok(!isLabError(execution))
    assert.equal(execution.reproducibility.deterministic, false)
    assert.match(execution.reproducibility.why, /Middle/)
  })

  test('a fully deterministic run says the same project gives the same answers', () => {
    const execution = runProject(chain(), evaluate, { executionId: 'e1' })
    assert.ok(!isLabError(execution))
    assert.equal(execution.reproducibility.deterministic, true)
    assert.match(execution.reproducibility.why, /gives the same answers/)
  })

  test('a run is named from what it did, not from a counter', () => {
    const plan = planExecution(chain())
    assert.ok(!isLabError(plan))
    assert.equal(nameExecution(chain(), plan), 'Chain: everything')
    const partial = planExecution(chain(), { only: ['a'] })
    assert.ok(!isLabError(partial))
    assert.equal(nameExecution(chain(), partial), 'Chain: Input')
  })
})

describe('health', () => {
  const evaluate = (one: LabNode): { outputs: Record<string, unknown>; calls: number } => ({ outputs: { out: one.id }, calls: 1 })

  test('a project with no results is unknown, not healthy', () => {
    const report = assessHealth(chain(), [])
    assert.equal(report.health, 'unknown')
    assert.match(report.describe, /nothing is known/)
  })

  test('a project whose results all match is healthy', () => {
    const project = chain()
    const execution = runProject(project, evaluate, { executionId: 'e1' })
    assert.ok(!isLabError(execution))
    assert.equal(assessHealth(project, execution.results).health, 'healthy')
  })

  test('a project with a failure is failed, and the node is named', () => {
    const project = chain()
    const execution = runProject(project, (one) => {
      if (one.id === 'b') throw new Error('broke')
      return { outputs: { out: one.id }, calls: 1 }
    }, { executionId: 'e1' })
    assert.ok(!isLabError(execution))
    const report = assessHealth(project, execution.results)
    assert.equal(report.health, 'failed')
    assert.ok(report.attention.some((one) => one.nodeId === 'b'))
  })

  test('a project whose results are stale needs attention', () => {
    const project = chain()
    const execution = runProject(project, evaluate, { executionId: 'e1' })
    assert.ok(!isLabError(execution))
    const edited = chain()
    edited.nodes[0].configuration = { changed: true }
    const report = assessHealth(edited, execution.results)
    assert.equal(report.health, 'needs-attention')
    assert.ok(report.attention.length > 0)
  })

  test('a graph that cannot run at all is failed rather than unknown', () => {
    const project = chain()
    project.edges = []
    assert.equal(assessHealth(project, []).health, 'failed')
  })
})

describe('checkpoints', () => {
  const evaluate = (one: LabNode): { outputs: Record<string, unknown>; calls: number } => ({ outputs: { out: one.id }, calls: 1 })

  test('a checkpoint holds only the completed results', () => {
    const project = chain()
    const execution = runProject(project, (one) => {
      if (one.id === 'b') throw new Error('broke')
      return { outputs: { out: one.id }, calls: 1 }
    }, { executionId: 'e1' })
    assert.ok(!isLabError(execution))
    const checkpoint = checkpointFrom('cp1', project, execution)
    assert.deepEqual(checkpoint.results.map((one) => one.nodeId), ['a'])
  })

  test('restoring keeps only what still corresponds to the project', () => {
    const project = chain()
    const execution = runProject(project, evaluate, { executionId: 'e1' })
    assert.ok(!isLabError(execution))
    const checkpoint = checkpointFrom('cp1', project, execution)

    const edited = chain()
    edited.nodes[1].configuration = { changed: true }
    edited.version = 2
    const restored = restoreCheckpoint(edited, checkpoint)
    assert.ok(!isLabError(restored))
    assert.deepEqual(restored.usable.map((one) => one.nodeId), ['a'])
    assert.equal(restored.discarded.length, 2)
    assert.match(restored.discarded[0].why, /no longer corresponds to anything/)
  })

  test('a result computed under a different engine version is discarded, with the reason', () => {
    const project = chain()
    const execution = runProject(project, evaluate, { executionId: 'e1' })
    assert.ok(!isLabError(execution))
    const checkpoint = checkpointFrom('cp1', project, execution)

    const upgraded = chain()
    upgraded.engineVersions = { expression: '2' }
    const restored = restoreCheckpoint(upgraded, checkpoint)
    assert.ok(!isLabError(restored))
    assert.equal(restored.usable.length, 0)
    assert.ok(restored.discarded.every((one) => /engine version/.test(one.why)))
  })

  test('a result for a node that no longer exists is discarded', () => {
    const project = chain()
    const execution = runProject(project, evaluate, { executionId: 'e1' })
    assert.ok(!isLabError(execution))
    const checkpoint = checkpointFrom('cp1', project, execution)

    const trimmed = chain()
    trimmed.nodes = trimmed.nodes.filter((one) => one.id !== 'c')
    trimmed.edges = trimmed.edges.filter((one) => one.to.nodeId !== 'c')
    const restored = restoreCheckpoint(trimmed, checkpoint)
    assert.ok(!isLabError(restored))
    assert.ok(restored.discarded.some((one) => one.nodeId === 'c' && /no longer in the project/.test(one.why)))
  })

  test('restoring an unchanged project keeps everything', () => {
    const project = chain()
    const execution = runProject(project, evaluate, { executionId: 'e1' })
    assert.ok(!isLabError(execution))
    const restored = restoreCheckpoint(project, checkpointFrom('cp1', project, execution))
    assert.ok(!isLabError(restored))
    assert.equal(restored.usable.length, 3)
    assert.equal(restored.discarded.length, 0)
  })
})

describe('comparing runs', () => {
  test('two runs of the same deterministic project agree', () => {
    const project = chain()
    const first = runProject(project, (one) => ({ outputs: { out: one.id }, calls: 1 }), { executionId: 'e1' })
    const second = runProject(project, (one) => ({ outputs: { out: one.id }, calls: 1 }), { executionId: 'e2' })
    assert.ok(!isLabError(first) && !isLabError(second))
    const comparison = compareRuns(project, first, second)
    assert.deepEqual(comparison.differing, [])
    assert.ok(comparison.notes.some((one) => /gave the same answer/.test(one)))
  })

  test('a difference that should not have happened is flagged as worth investigating', () => {
    const project = chain()
    const first = runProject(project, (one) => ({ outputs: { out: one.id }, calls: 1 }), { executionId: 'e1' })
    const second = runProject(project, (one) => ({ outputs: { out: `${one.id}-different` }, calls: 1 }), { executionId: 'e2' })
    assert.ok(!isLabError(first) && !isLabError(second))
    const comparison = compareRuns(project, first, second)
    assert.ok(comparison.differing.every((one) => !one.expected))
    assert.match(comparison.differing[0].describe, /Something outside the recorded configuration/)
    assert.ok(comparison.notes.some((one) => /worth investigating/.test(one)))
  })

  test('a difference from a node that is not deterministic is expected, not a finding', () => {
    const project = chain()
    project.nodes[1].deterministic = false
    project.nodes[1].seed = 1
    const first = runProject(project, (one) => ({ outputs: { out: one.id }, calls: 1 }), { executionId: 'e1' })
    const second = runProject(project, (one) => ({ outputs: { out: one.id === 'b' ? 'other' : one.id }, calls: 1 }), { executionId: 'e2' })
    assert.ok(!isLabError(first) && !isLabError(second))
    const comparison = compareRuns(project, first, second)
    assert.equal(comparison.differing.find((one) => one.nodeId === 'b')?.expected, true)
  })
})

describe('compatibility', () => {
  test('a project needing an engine that is not here cannot be opened', () => {
    const report = checkCompatibility(chain(), { engines: {}, capabilities: [] })
    assert.equal(report.canOpen, false)
    assert.match(report.problems[0].describe, /will not substitute a different one/)
  })

  test('a different engine version opens with a note rather than being refused', () => {
    const report = checkCompatibility(chain(), { engines: { expression: '2' }, capabilities: [] })
    assert.equal(report.canOpen, true)
    assert.ok(report.notes.some((one) => /not reproduced under a different version/.test(one)))
  })

  test('a missing capability is fixable, so the project can still be opened', () => {
    const report = checkCompatibility(chain(), { engines: { expression: '1' }, capabilities: [] }, ['network.fetch'])
    assert.equal(report.canOpen, true)
    assert.equal(report.problems[0].fixable, true)
  })

  test('everything present opens cleanly', () => {
    const report = checkCompatibility(chain(), { engines: { expression: '1' }, capabilities: ['compute'] }, ['compute'])
    assert.equal(report.canOpen, true)
    assert.deepEqual(report.problems, [])
  })
})

describe('the assumptions are stated', () => {
  test('the list names what the runtime does and refuses to do', () => {
    assert.ok(LAB_ASSUMPTIONS.length >= 8)
    assert.ok(LAB_ASSUMPTIONS.some((one) => /never computes anything/.test(one)))
    assert.ok(LAB_ASSUMPTIONS.some((one) => /blocked, not failed/.test(one)))
    assert.ok(LAB_ASSUMPTIONS.some((one) => /unknown, not healthy/.test(one)))
  })
})
