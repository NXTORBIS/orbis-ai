import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  assessStaleness,
  assumptionRegister,
  buildReport,
  checkStructure,
  compareApproaches,
  emptyWorkspace,
  ifAssumptionChanged,
  isWorkspaceError,
  topologicalOrder,
  WORKSPACE_ASSUMPTIONS,
  type Approach,
  type Link,
  type LinkKind,
  type NodeKind,
  type NodeState,
  type WorkNode,
  type Workspace
} from './workspace.ts'

const node = (id: string, kind: NodeKind, over: Partial<WorkNode> = {}): WorkNode => ({
  id,
  kind,
  title: id,
  detail: '',
  state: 'open',
  approachId: null,
  value: null,
  unit: '',
  computedFrom: '',
  owner: '',
  ...over
})

const link = (from: string, to: string, kind: LinkKind): Link => ({ id: `${from}->${to}`, from, to, kind })

const workspaceOf = (nodes: WorkNode[], links: Link[]): Workspace => ({ id: 'w', title: 'A workspace', nodes, links })

// ------------------------------------------------------------ structure

test('an empty workspace holds together', () => {
  const result = checkStructure(emptyWorkspace('w', 'Empty'))
  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
})

test('a link to a node that is not there is blocking', () => {
  const result = checkStructure(workspaceOf([node('a', 'goal')], [link('a', 'ghost', 'feeds')]))
  assert.equal(result.ok, false)
  const problem = result.problems.find((one) => one.kind === 'missing-node')
  assert.ok(problem)
  assert.deepEqual(problem?.ids, ['ghost'])
})

test('two nodes with the same id are refused', () => {
  const result = checkStructure(workspaceOf([node('a', 'goal'), node('a', 'note')], []))
  assert.equal(result.ok, false)
  assert.ok(result.problems.some((one) => one.kind === 'duplicate'))
})

test('a cycle in the flow links is found and named', () => {
  const result = checkStructure(
    workspaceOf(
      [node('a', 'calculation', { title: 'A' }), node('b', 'calculation', { title: 'B' })],
      [link('a', 'b', 'feeds'), link('b', 'a', 'feeds')]
    )
  )
  assert.equal(result.ok, false)
  const cycle = result.problems.find((one) => one.kind === 'cycle')
  assert.ok(cycle)
  assert.match(cycle?.describe ?? '', /circle/)
})

test('a supporting loop is not a cycle, because reasoning really has that shape', () => {
  const result = checkStructure(
    workspaceOf([node('a', 'evidence'), node('b', 'hypothesis')], [link('a', 'b', 'supports'), link('b', 'a', 'supports')])
  )
  assert.equal(result.problems.some((one) => one.kind === 'cycle'), false)
})

test('a subproblem feeding nothing and answering nothing is detached', () => {
  const result = checkStructure(workspaceOf([node('s', 'subproblem'), node('g', 'goal')], []))
  assert.deepEqual(result.detached, ['s'])
  assert.match(result.notes.join(' '), /no longer does/)
})

test('an abandoned subproblem is not reported as detached', () => {
  const result = checkStructure(workspaceOf([node('s', 'subproblem', { state: 'abandoned' })], []))
  assert.deepEqual(result.detached, [])
})

test('a goal with nothing answering it is reported but not blocking', () => {
  const result = checkStructure(workspaceOf([node('g', 'goal', { title: 'Ship it' })], []))
  assert.equal(result.ok, true)
  const problem = result.problems.find((one) => one.kind === 'unanswered-goal')
  assert.ok(problem)
  assert.equal(problem?.blocking, false)
  assert.match(problem?.describe ?? '', /Ship it/)
})

test('a goal with a conclusion answering it is not reported', () => {
  const result = checkStructure(workspaceOf([node('g', 'goal'), node('c', 'conclusion')], [link('c', 'g', 'answers')]))
  assert.equal(result.problems.some((one) => one.kind === 'unanswered-goal'), false)
})

// ------------------------------------------------------------ ordering

test('the order follows the flow links', () => {
  const order = topologicalOrder(
    workspaceOf([node('c', 'result'), node('a', 'input'), node('b', 'calculation')], [link('a', 'b', 'feeds'), link('b', 'c', 'produces')])
  )
  assert.ok(!isWorkspaceError(order))
  assert.deepEqual(order, ['a', 'b', 'c'])
})

test('the order is stable when nothing constrains it', () => {
  const nodes = [node('z', 'note'), node('a', 'note'), node('m', 'note')]
  const first = topologicalOrder(workspaceOf(nodes, []))
  const second = topologicalOrder(workspaceOf([...nodes].reverse(), []))
  assert.deepEqual(first, second)
})

test('a cycle gives an error naming what is stuck', () => {
  const order = topologicalOrder(
    workspaceOf([node('a', 'calculation', { title: 'A' }), node('b', 'calculation', { title: 'B' })], [link('a', 'b', 'feeds'), link('b', 'a', 'feeds')])
  )
  assert.ok(isWorkspaceError(order))
  assert.equal(order.error, 'cycle')
  assert.match(order.message, /A/)
})

test('supporting links do not constrain the order', () => {
  const order = topologicalOrder(workspaceOf([node('a', 'evidence'), node('b', 'hypothesis')], [link('b', 'a', 'supports')]))
  assert.ok(!isWorkspaceError(order))
  assert.equal(order.length, 2)
})

// ------------------------------------------------------------ assumptions

const register = () =>
  workspaceOf(
    [
      node('rate', 'assumption', { title: 'Growth is 4% a year', detail: 'guessed in week one' }),
      node('horizon', 'assumption', { title: 'Five year horizon' }),
      node('calc', 'calculation', { title: 'Projection' }),
      node('r1', 'result', { title: 'Revenue in 2030' }),
      node('d1', 'decision', { title: 'Hire or not' }),
      node('spare', 'assumption', { title: 'Nobody uses this' })
    ],
    [link('rate', 'calc', 'feeds'), link('horizon', 'calc', 'feeds'), link('calc', 'r1', 'produces'), link('r1', 'd1', 'feeds')]
  )

test('the register lists every assumption with what rests on it', () => {
  const entries = assumptionRegister(register())
  assert.equal(entries.length, 3)
  const rate = entries.find((one) => one.id === 'rate')
  assert.deepEqual(rate?.dependents, ['calc', 'd1', 'r1'])
  assert.equal(rate?.resultsAffected, 2)
})

test('the register is ordered by how much rests on each assumption', () => {
  const entries = assumptionRegister(register())
  assert.equal(entries[entries.length - 1]?.id, 'spare')
})

test('an assumption nothing rests on says so plainly', () => {
  const entries = assumptionRegister(register())
  const spare = entries.find((one) => one.id === 'spare')
  assert.equal(spare?.dependents.length, 0)
  assert.match(spare?.describe ?? '', /Nothing rests on/)
})

test('contradicting links do not count as things resting on an assumption', () => {
  const workspace = workspaceOf(
    [node('a', 'assumption'), node('e', 'evidence')],
    [link('a', 'e', 'contradicts')]
  )
  assert.deepEqual(assumptionRegister(workspace)[0]?.dependents, [])
})

test('an assumption reviewed since it was written is marked reviewed', () => {
  const workspace = workspaceOf([node('a', 'assumption', { state: 'answered' })], [])
  assert.equal(assumptionRegister(workspace)[0]?.reviewed, true)
})

test('what changing an assumption would reach is listed in working order', () => {
  const result = ifAssumptionChanged(register(), 'rate')
  assert.ok(!isWorkspaceError(result))
  assert.deepEqual(result.wouldRecheck, ['calc', 'r1', 'd1'])
  assert.equal(result.loadBearing, true)
  assert.equal(result.resultsAffected, 2)
})

test('an assumption nothing rests on is flagged as a probably-missing link', () => {
  const result = ifAssumptionChanged(register(), 'spare')
  assert.ok(!isWorkspaceError(result))
  assert.equal(result.loadBearing, false)
  assert.match(result.describe, /not linked to it/)
})

test('asking about something that is not an assumption is refused by kind', () => {
  const result = ifAssumptionChanged(register(), 'calc')
  assert.ok(isWorkspaceError(result))
  assert.equal(result.error, 'wrong-kind')
})

test('asking about a node that is not there is refused', () => {
  const result = ifAssumptionChanged(register(), 'nope')
  assert.ok(isWorkspaceError(result))
  assert.equal(result.error, 'not-found')
})

// ------------------------------------------------------------ staleness

const printOf = (one: WorkNode, upstream: readonly string[]): string => `${one.kind}:${one.value ?? ''}:${upstream.join(',')}`

test('a node whose inputs are unchanged is current', () => {
  const a = node('a', 'input', { value: 2 })
  const b = node('b', 'result', { value: 4 })
  const workspace = workspaceOf([a, b], [link('a', 'b', 'feeds')])
  a.computedFrom = printOf(a, [])
  b.computedFrom = printOf(b, [a.computedFrom])

  const result = assessStaleness(workspace, printOf)
  assert.ok(!isWorkspaceError(result))
  assert.deepEqual(result.stale, [])
  assert.deepEqual(result.current, ['a', 'b'])
})

test('changing an input makes what rests on it stale, and says which', () => {
  const a = node('a', 'assumption', { title: 'Rate', value: 2 })
  const b = node('b', 'result', { title: 'Revenue', value: 4 })
  const workspace = workspaceOf([a, b], [link('a', 'b', 'feeds')])
  a.computedFrom = printOf({ ...a, value: 1 }, [])
  b.computedFrom = printOf(b, [a.computedFrom])

  const result = assessStaleness(workspace, printOf)
  assert.ok(!isWorkspaceError(result))
  assert.deepEqual(result.stale, ['a', 'b'])
  const reason = result.reasons.find((one) => one.nodeId === 'b')
  assert.match(reason?.because ?? '', /Rate changed/)
})

test('a node that has never been worked out is not stale', () => {
  const workspace = workspaceOf([node('a', 'question')], [])
  const result = assessStaleness(workspace, printOf)
  assert.ok(!isWorkspaceError(result))
  assert.deepEqual(result.stale, [])
  assert.deepEqual(result.current, [])
})

test('a node downstream of a blocked one is blocked, not stale', () => {
  const a = node('a', 'experiment', { state: 'blocked', title: 'Awaiting data' })
  const b = node('b', 'result', { title: 'Analysis' })
  b.computedFrom = 'anything'
  const result = assessStaleness(workspaceOf([a, b], [link('a', 'b', 'feeds')]), printOf)
  assert.ok(!isWorkspaceError(result))
  assert.deepEqual(result.blocked, ['a', 'b'])
  assert.equal(result.stale.includes('b'), false)
  assert.match(result.reasons.find((one) => one.nodeId === 'b')?.because ?? '', /blocked/)
})

test('staleness over a cycle is an error rather than a wrong answer', () => {
  const result = assessStaleness(
    workspaceOf([node('a', 'calculation'), node('b', 'calculation')], [link('a', 'b', 'feeds'), link('b', 'a', 'feeds')]),
    printOf
  )
  assert.ok(isWorkspaceError(result))
})

// ------------------------------------------------------------ approaches

const approach = (id: string, name: string, resultId: string | null): Approach => ({
  id,
  subproblemId: 's',
  name,
  describe: '',
  resultId
})

test('two approaches agreeing is reported as evidence, with the caveat about shared assumptions', () => {
  const workspace = workspaceOf([node('r1', 'result', { value: 10 }), node('r2', 'result', { value: 10 })], [])
  const result = compareApproaches(workspace, [approach('a1', 'Analytic', 'r1'), approach('a2', 'Numeric', 'r2')], 's')
  assert.ok(!isWorkspaceError(result))
  assert.equal(result.agree, true)
  assert.match(result.describe, /shared? an assumption|share an assumption/)
})

test('two approaches disagreeing refuses to average them', () => {
  const workspace = workspaceOf([node('r1', 'result', { value: 10 }), node('r2', 'result', { value: 14 })], [])
  const result = compareApproaches(workspace, [approach('a1', 'Analytic', 'r1'), approach('a2', 'Numeric', 'r2')], 's')
  assert.ok(!isWorkspaceError(result))
  assert.equal(result.agree, false)
  assert.equal(result.spread, 4)
  assert.match(result.describe, /averaging/)
})

test('one approach with a number has nothing to compare against', () => {
  const workspace = workspaceOf([node('r1', 'result', { value: 10 })], [])
  const result = compareApproaches(workspace, [approach('a1', 'Analytic', 'r1')], 's')
  assert.ok(!isWorkspaceError(result))
  assert.equal(result.agree, null)
  assert.match(result.describe, /cheapest check/)
})

test('approaches with no numbers yet report that rather than agreement', () => {
  const workspace = workspaceOf([node('r1', 'result')], [])
  const result = compareApproaches(workspace, [approach('a1', 'Analytic', 'r1'), approach('a2', 'Numeric', null)], 's')
  assert.ok(!isWorkspaceError(result))
  assert.equal(result.agree, null)
  assert.equal(result.spread, null)
})

test('comparing approaches to a subproblem that has none is refused', () => {
  const result = compareApproaches(emptyWorkspace('w', 'x'), [], 's')
  assert.ok(isWorkspaceError(result))
  assert.equal(result.error, 'not-found')
})

test('agreement is judged relative to the size of the numbers', () => {
  const workspace = workspaceOf([node('r1', 'result', { value: 1e9 }), node('r2', 'result', { value: 1e9 + 1 })], [])
  const result = compareApproaches(workspace, [approach('a1', 'A', 'r1'), approach('a2', 'B', 'r2')], 's', 1e-6)
  assert.ok(!isWorkspaceError(result))
  assert.equal(result.agree, true)
})

// ------------------------------------------------------------ report

const reportable = () =>
  workspaceOf(
    [
      node('g', 'goal', { title: 'Should we open a second site', detail: 'by March' }),
      node('a1', 'assumption', { title: 'Rent stays flat' }),
      node('c1', 'constraint', { title: 'Budget under 200k' }),
      node('calc', 'calculation', { title: 'Payback' }),
      node('r1', 'result', { title: 'Payback period', value: 18, unit: 'months' }),
      node('cn', 'conclusion', { title: 'Open it' })
    ],
    [link('a1', 'calc', 'feeds'), link('calc', 'r1', 'produces'), link('cn', 'g', 'answers')]
  )

test('the report is built from real nodes and carries their ids', () => {
  const report = buildReport(reportable())
  const results = report.sections.find((one) => one.heading === 'Results')
  assert.deepEqual(results?.nodeIds, ['r1'])
  assert.match(results?.body[0] ?? '', /18 months/)
})

test('an unreviewed assumption that results rest on becomes a caveat', () => {
  const report = buildReport(reportable())
  assert.match(report.caveats.join(' '), /Rent stays flat/)
})

test('open questions become a caveat rather than being left out', () => {
  const workspace = reportable()
  workspace.nodes.push(node('q', 'question', { title: 'What is the lease term' }))
  const report = buildReport(workspace)
  assert.match(report.caveats.join(' '), /What is the lease term/)
})

test('stale nodes make the report say what in it is out of date', () => {
  const report = buildReport(reportable(), { current: [], stale: ['r1'], reasons: [], blocked: [] })
  assert.match(report.caveats.join(' '), /Payback period/)
  assert.match(report.caveats.join(' '), /out of date/)
})

test('blocked nodes make the report say something is missing from it', () => {
  const report = buildReport(reportable(), { current: [], stale: [], reasons: [], blocked: ['calc'] })
  assert.match(report.caveats.join(' '), /missing from this report/)
})

test('contradicting pairs are named as unresolved', () => {
  const workspace = reportable()
  workspace.nodes.push(node('e1', 'evidence'), node('e2', 'evidence'))
  workspace.links.push(link('e1', 'e2', 'contradicts'))
  const report = buildReport(workspace)
  assert.match(report.caveats.join(' '), /contradict each other/)
})

test('results with no conclusion are reported as findings without meaning', () => {
  const workspace = reportable()
  workspace.nodes = workspace.nodes.filter((one) => one.kind !== 'conclusion')
  const report = buildReport(workspace)
  assert.match(report.caveats.join(' '), /not what it means/)
})

test('abandoned nodes are left out of the report', () => {
  const workspace = reportable()
  const abandoned = workspace.nodes.find((one) => one.id === 'r1') as WorkNode
  abandoned.state = 'abandoned' as NodeState
  const report = buildReport(workspace)
  assert.equal(report.sections.some((one) => one.heading === 'Results'), false)
})

test('a clean workspace with a conclusion still reports its open assumptions honestly', () => {
  const workspace = reportable()
  const assumption = workspace.nodes.find((one) => one.id === 'a1') as WorkNode
  assumption.state = 'answered'
  const report = buildReport(workspace)
  assert.equal(report.caveats.length, 0)
})

// ------------------------------------------------------------ hazards

test('a node id of __proto__ does not reach Object.prototype', () => {
  const workspace = workspaceOf(
    [node('__proto__', 'assumption', { title: 'Odd' }), node('r', 'result')],
    [link('__proto__', 'r', 'feeds')]
  )
  const entries = assumptionRegister(workspace)
  assert.deepEqual(entries[0]?.dependents, ['r'])
  assert.equal(({} as Record<string, unknown>).polluted, undefined)
})

test('the stated assumptions are frozen', () => {
  assert.equal(Object.isFrozen(WORKSPACE_ASSUMPTIONS), true)
  assert.ok(WORKSPACE_ASSUMPTIONS.some((one) => /averaging/.test(one)))
})
