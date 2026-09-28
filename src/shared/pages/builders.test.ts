import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  align,
  bindingCycle,
  bindingGraph,
  BuilderRegistry,
  builtInBuilders,
  BUILDER_ASSUMPTIONS,
  checkBehaviour,
  distribute,
  emptyArtifact,
  isBuilderError,
  migrate,
  resolveSelection,
  routeConnector,
  snap,
  validate,
  type Artifact,
  type ArtifactObject,
  type Builder,
  type Connector,
  type FieldValue
} from './builders.ts'

const object = (id: string, type: string, over: Partial<ArtifactObject> = {}): ArtifactObject => ({
  id,
  type,
  box: { x: 0, y: 0, width: 100, height: 40 },
  text: id,
  fields: {},
  layerId: 'base',
  groupId: null,
  locked: false,
  hidden: false,
  ...over
})

const connector = (id: string, from: string, to: string, type: string, over: Partial<Connector> = {}): Connector => ({
  id,
  from,
  to,
  type,
  text: '',
  layerId: 'base',
  waypoints: [],
  ...over
})

const registryOf = (...extra: Builder[]): BuilderRegistry => {
  const registry = new BuilderRegistry()
  for (const builder of [...builtInBuilders(), ...extra]) assert.equal(registry.register(builder), null)
  return registry
}

const artifactOf = (builderId: string, objects: ArtifactObject[], connectors: Connector[] = [], version = 1): Artifact => ({
  ...emptyArtifact('a', builderId, 'An artifact', version),
  objects,
  connectors
})

// ------------------------------------------------------------ the registry

test('registering the same builder twice is refused', () => {
  const registry = new BuilderRegistry()
  const builder: Builder = { id: 'x', name: 'X', objectTypes: ['a'], connectorTypes: [], version: 1 }
  assert.equal(registry.register(builder), null)
  assert.ok(isBuilderError(registry.register(builder)))
})

test('a builder allowing no object types is refused', () => {
  const registry = new BuilderRegistry()
  const result = registry.register({ id: 'x', name: 'X', objectTypes: [], connectorTypes: [], version: 1 })
  assert.ok(isBuilderError(result))
  assert.match(result.message, /nothing can be put in it/)
})

test('validating an artifact from an unregistered builder is refused', () => {
  const result = validate(new BuilderRegistry(), artifactOf('ghost', []))
  assert.ok(isBuilderError(result))
})

// ------------------------------------------------------------ framework validation

test('a connector pointing at nothing is blocking', () => {
  const report = validate(registryOf(), artifactOf('flowchart', [object('a', 'step')], [connector('c', 'a', 'gone', 'next')]))
  assert.ok(!isBuilderError(report))
  assert.ok(report.issues.some((one) => one.kind === 'dangling-connector' && one.blocking))
})

test('an object type the builder does not know is blocking, and the allowed types are named', () => {
  const report = validate(registryOf(), artifactOf('flowchart', [object('a', 'hexagon')]))
  assert.ok(!isBuilderError(report))
  const issue = report.issues.find((one) => one.kind === 'unknown-type')
  assert.match(issue?.describe ?? '', /start, end, step/)
})

test('an object on a layer that does not exist is blocking', () => {
  const report = validate(registryOf(), artifactOf('flowchart', [object('a', 'step', { layerId: 'gone' })]))
  assert.ok(!isBuilderError(report))
  assert.ok(report.issues.some((one) => one.kind === 'missing-layer'))
})

test('groups containing each other are found', () => {
  const artifact = artifactOf('flowchart', [])
  artifact.groups = [
    { id: 'g1', name: 'A', parentId: 'g2' },
    { id: 'g2', name: 'B', parentId: 'g1' }
  ]
  const report = validate(registryOf(), artifact)
  assert.ok(!isBuilderError(report))
  assert.ok(report.issues.some((one) => one.kind === 'group-cycle'))
})

test('a builder with no rules is reported as having none rather than valid', () => {
  const registry = registryOf({ id: 'bare', name: 'Bare', objectTypes: ['thing'], connectorTypes: [], version: 1 })
  const report = validate(registry, artifactOf('bare', [object('a', 'thing')]))
  assert.ok(!isBuilderError(report))
  assert.equal(report.builderHasNoRules, true)
  assert.equal(report.ok, true)
  assert.match(report.describe, /registers no rules of its own/)
})

test('an object with a size that cannot be drawn is blocking', () => {
  const report = validate(registryOf(), artifactOf('flowchart', [object('a', 'step', { box: { x: 0, y: 0, width: NaN, height: 10 } })]))
  assert.ok(!isBuilderError(report))
  assert.ok(report.issues.some((one) => one.kind === 'bad-size'))
})

// ------------------------------------------------------------ selection

test('selecting one member of a group selects the group', () => {
  const artifact = artifactOf('flowchart', [object('a', 'step', { groupId: 'g' }), object('b', 'step', { groupId: 'g' }), object('c', 'step')])
  artifact.groups = [{ id: 'g', name: 'G', parentId: null }]
  assert.deepEqual(resolveSelection(artifact, ['a']).objectIds, ['a', 'b'])
})

test('nested groups select from the top', () => {
  const artifact = artifactOf('flowchart', [object('a', 'step', { groupId: 'inner' }), object('b', 'step', { groupId: 'outer' })])
  artifact.groups = [
    { id: 'inner', name: 'I', parentId: 'outer' },
    { id: 'outer', name: 'O', parentId: null }
  ]
  assert.deepEqual(resolveSelection(artifact, ['a']).objectIds, ['a', 'b'])
})

test('a locked object is excluded and the reason is given', () => {
  const artifact = artifactOf('flowchart', [object('a', 'step', { locked: true }), object('b', 'step')])
  const selection = resolveSelection(artifact, ['a', 'b'])
  assert.deepEqual(selection.objectIds, ['b'])
  assert.match(selection.excluded[0]?.why ?? '', /locked/)
})

test('an object on a locked layer is excluded and the layer is named', () => {
  const artifact = artifactOf('flowchart', [object('a', 'step', { layerId: 'frozen' })])
  artifact.layers.push({ id: 'frozen', name: 'Background', order: 1, visible: true, locked: true })
  const selection = resolveSelection(artifact, ['a'])
  assert.deepEqual(selection.objectIds, [])
  assert.match(selection.excluded[0]?.why ?? '', /Background/)
})

test('selecting an object that is not there is simply ignored', () => {
  assert.deepEqual(resolveSelection(artifactOf('flowchart', []), ['gone']).objectIds, [])
})

// ------------------------------------------------------------ geometry

test('aligning left moves everything to the leftmost edge', () => {
  const objects = [object('a', 'step', { box: { x: 10, y: 0, width: 100, height: 40 } }), object('b', 'step', { box: { x: 50, y: 0, width: 60, height: 40 } })]
  const moved = align(objects, 'left')
  assert.ok(!isBuilderError(moved))
  assert.equal(moved.get('b')?.x, 10)
})

test('aligning right accounts for each object width', () => {
  const objects = [object('a', 'step', { box: { x: 0, y: 0, width: 100, height: 40 } }), object('b', 'step', { box: { x: 0, y: 0, width: 60, height: 40 } })]
  const moved = align(objects, 'right')
  assert.ok(!isBuilderError(moved))
  assert.equal(moved.get('b')?.x, 40)
})

test('centring puts every object on the selection midline', () => {
  const objects = [object('a', 'step', { box: { x: 0, y: 0, width: 100, height: 40 } }), object('b', 'step', { box: { x: 0, y: 0, width: 50, height: 40 } })]
  const moved = align(objects, 'centre-x')
  assert.ok(!isBuilderError(moved))
  assert.equal(moved.get('a')?.x, 0)
  assert.equal(moved.get('b')?.x, 25)
})

test('aligning one object is refused, because it is already aligned with itself', () => {
  const result = align([object('a', 'step')], 'left')
  assert.ok(isBuilderError(result))
  assert.match(result.message, /already aligned with itself/)
})

test('distributing equalises the gaps rather than the centres', () => {
  const objects = [
    object('a', 'step', { box: { x: 0, y: 0, width: 10, height: 10 } }),
    object('b', 'step', { box: { x: 20, y: 0, width: 50, height: 10 } }),
    object('c', 'step', { box: { x: 100, y: 0, width: 10, height: 10 } })
  ]
  const moved = distribute(objects, 'x')
  assert.ok(!isBuilderError(moved))
  const gap1 = (moved.get('b')?.x as number) - 10
  const gap2 = 100 - ((moved.get('b')?.x as number) + 50)
  assert.equal(Math.round(gap1 * 1e9) / 1e9, Math.round(gap2 * 1e9) / 1e9)
})

test('distributing leaves the outermost objects where they were', () => {
  const objects = [
    object('a', 'step', { box: { x: 0, y: 0, width: 10, height: 10 } }),
    object('b', 'step', { box: { x: 20, y: 0, width: 10, height: 10 } }),
    object('c', 'step', { box: { x: 100, y: 0, width: 10, height: 10 } })
  ]
  const moved = distribute(objects, 'x')
  assert.ok(!isBuilderError(moved))
  assert.equal(moved.get('a')?.x, 0)
  assert.equal(moved.get('c')?.x, 100)
})

test('distributing two objects is refused, because there is only one gap', () => {
  const result = distribute([object('a', 'step'), object('b', 'step')], 'x')
  assert.ok(isBuilderError(result))
})

test('snapping to a grid rounds and a grid of zero leaves the value alone', () => {
  assert.equal(snap(13, 10), 10)
  assert.equal(snap(16, 10), 20)
  assert.equal(snap(13, 0), 13)
})

// ------------------------------------------------------------ routing

test('an automatic route is orthogonal', () => {
  const artifact = artifactOf('flowchart', [
    object('a', 'step', { box: { x: 0, y: 0, width: 100, height: 40 } }),
    object('b', 'step', { box: { x: 300, y: 0, width: 100, height: 40 } })
  ])
  const route = routeConnector(artifact, connector('c', 'a', 'b', 'next'))
  assert.ok(!isBuilderError(route))
  assert.equal(route.manual, false)
  for (let i = 1; i < route.points.length; i += 1) {
    const before = route.points[i - 1] as { x: number; y: number }
    const after = route.points[i] as { x: number; y: number }
    assert.ok(before.x === after.x || before.y === after.y)
  }
})

test('user waypoints are used exactly as placed', () => {
  const artifact = artifactOf('flowchart', [object('a', 'step'), object('b', 'step', { box: { x: 300, y: 0, width: 100, height: 40 } })])
  const route = routeConnector(artifact, connector('c', 'a', 'b', 'next', { waypoints: [{ x: 7, y: 7 }] }))
  assert.ok(!isBuilderError(route))
  assert.equal(route.manual, true)
  assert.deepEqual(route.points[1], { x: 7, y: 7 })
})

test('objects a route passes through are reported rather than routed around', () => {
  const artifact = artifactOf('flowchart', [
    object('a', 'step', { box: { x: 0, y: 0, width: 50, height: 40 } }),
    object('b', 'step', { box: { x: 400, y: 0, width: 50, height: 40 } }),
    object('middle', 'step', { box: { x: 180, y: -10, width: 60, height: 60 } })
  ])
  const route = routeConnector(artifact, connector('c', 'a', 'b', 'next'))
  assert.ok(!isBuilderError(route))
  assert.deepEqual(route.crosses, ['middle'])
})

test('routing a dangling connector is refused', () => {
  const route = routeConnector(artifactOf('flowchart', [object('a', 'step')]), connector('c', 'a', 'gone', 'next'))
  assert.ok(isBuilderError(route))
})

// ------------------------------------------------------------ behaviour

test('a behaviour pointing at an object that is not there is blocking', () => {
  const artifact = artifactOf('form', [object('a', 'text-field')])
  const issues = checkBehaviour(artifact, { objectId: 'a', on: 'click', actions: [{ do: 'go-to', objectId: 'gone' }] })
  assert.ok(issues.some((one) => one.kind === 'missing-target' && one.blocking))
})

test('an open action addressing anything outside Orbis is blocking', () => {
  const artifact = artifactOf('form', [object('a', 'text-field')])
  const issues = checkBehaviour(artifact, { objectId: 'a', on: 'click', actions: [{ do: 'open', address: 'https://example.com' }] })
  const issue = issues.find((one) => one.kind === 'external-address')
  assert.equal(issue?.blocking, true)
  assert.match(issue?.describe ?? '', /user's decision each time/)
})

test('an orbis address is allowed', () => {
  const artifact = artifactOf('form', [object('a', 'text-field')])
  const issues = checkBehaviour(artifact, { objectId: 'a', on: 'click', actions: [{ do: 'open', address: 'orbis://pages/markets' }] })
  assert.deepEqual(issues, [])
})

test('a compute action with an empty expression is blocking', () => {
  const artifact = artifactOf('calculator', [object('a', 'input'), object('b', 'output')])
  const issues = checkBehaviour(artifact, { objectId: 'a', on: 'change', actions: [{ do: 'compute', expression: '  ', into: 'b' }] })
  assert.ok(issues.some((one) => one.kind === 'empty-expression'))
})

test('a behaviour that does nothing is reported without blocking', () => {
  const artifact = artifactOf('form', [object('a', 'text-field')])
  const issues = checkBehaviour(artifact, { objectId: 'a', on: 'click', actions: [] })
  assert.equal(issues.find((one) => one.kind === 'no-actions')?.blocking, false)
})

test('the binding graph names what writes into what', () => {
  const edges = bindingGraph([{ objectId: 'a', on: 'change', actions: [{ do: 'compute', expression: 'a * 2', into: 'b' }] }])
  assert.deepEqual(edges, [{ from: 'a', to: 'b', expression: 'a * 2' }])
})

test('a circular binding is found before anything runs', () => {
  const cycle = bindingCycle([
    { objectId: 'a', on: 'change', actions: [{ do: 'compute', expression: 'b', into: 'b' }] },
    { objectId: 'b', on: 'change', actions: [{ do: 'compute', expression: 'a', into: 'a' }] }
  ])
  assert.ok(cycle)
  assert.ok(cycle.includes('a') && cycle.includes('b'))
})

test('a binding chain with no cycle returns null', () => {
  assert.equal(
    bindingCycle([
      { objectId: 'a', on: 'change', actions: [{ do: 'compute', expression: 'a', into: 'b' }] },
      { objectId: 'b', on: 'change', actions: [{ do: 'compute', expression: 'b', into: 'c' }] }
    ]),
    null
  )
})

// ------------------------------------------------------------ migration

const versioned = (version: number, migrations: Record<number, (a: Artifact) => Artifact>): Builder => ({
  id: 'versioned',
  name: 'Versioned',
  objectTypes: ['thing'],
  connectorTypes: [],
  version,
  migrations
})

test('migration runs one version at a time and names each step', () => {
  const registry = registryOf(
    versioned(3, {
      1: (a) => ({ ...a, version: 2, title: `${a.title}+v2` }),
      2: (a) => ({ ...a, version: 3, title: `${a.title}+v3` })
    })
  )
  const result = migrate(registry, artifactOf('versioned', [], [], 1))
  assert.ok(!isBuilderError(result))
  assert.deepEqual(result.steps, [{ from: 1, to: 2 }, { from: 2, to: 3 }])
  assert.match(result.artifact.title, /\+v2\+v3$/)
})

test('an artifact already current is returned unchanged', () => {
  const registry = registryOf(versioned(1, {}))
  const result = migrate(registry, artifactOf('versioned', [], [], 1))
  assert.ok(!isBuilderError(result))
  assert.deepEqual(result.steps, [])
})

test('a missing migration step is refused rather than guessed at', () => {
  const registry = registryOf(versioned(3, { 1: (a) => ({ ...a, version: 2 }) }))
  const result = migrate(registry, artifactOf('versioned', [], [], 1))
  assert.ok(isBuilderError(result))
  assert.match(result.message, /no migration from version 2 to 3/)
})

test('an artifact from a newer version is refused rather than quietly stripped', () => {
  const registry = registryOf(versioned(1, {}))
  const result = migrate(registry, artifactOf('versioned', [], [], 5))
  assert.ok(isBuilderError(result))
  assert.equal(result.error, 'from-the-future')
  assert.match(result.message, /quietly drop/)
})

test('a migration that produces the wrong version is caught', () => {
  const registry = registryOf(versioned(3, { 1: (a) => ({ ...a, version: 3 }) }))
  const result = migrate(registry, artifactOf('versioned', [], [], 1))
  assert.ok(isBuilderError(result))
  assert.equal(result.error, 'bad-migration')
})

// ------------------------------------------------------------ the built-in builders

const issuesFor = (artifact: Artifact): string[] => {
  const report = validate(registryOf(), artifact)
  assert.ok(!isBuilderError(report))
  return report.issues.map((one) => one.kind)
}

test('a flowchart decision with one way out is a step', () => {
  const artifact = artifactOf('flowchart', [object('d', 'decision'), object('e', 'end')], [connector('c', 'd', 'e', 'next')])
  assert.ok(issuesFor(artifact).includes('decision-one-way'))
})

test('a flowchart decision with unlabelled branches is reported without blocking', () => {
  const artifact = artifactOf(
    'flowchart',
    [object('d', 'decision'), object('e', 'end'), object('e2', 'end')],
    [connector('c1', 'd', 'e', 'next'), connector('c2', 'd', 'e2', 'next')]
  )
  const report = validate(registryOf(), artifact)
  assert.ok(!isBuilderError(report))
  assert.equal(report.issues.find((one) => one.kind === 'decision-unlabelled')?.blocking, false)
  assert.equal(report.ok, true)
})

test('a flowchart with no end is reported without blocking', () => {
  const artifact = artifactOf('flowchart', [object('s', 'start')])
  const report = validate(registryOf(), artifact)
  assert.ok(!isBuilderError(report))
  assert.ok(report.issues.some((one) => one.kind === 'no-end'))
  assert.equal(report.ok, true)
})

test('unreachable flowchart objects are reported without blocking', () => {
  const artifact = artifactOf('flowchart', [object('s', 'start'), object('e', 'end'), object('island', 'step'), object('island2', 'step')], [
    connector('c1', 's', 'e', 'next'),
    connector('c2', 'island', 'island2', 'next'),
    connector('c3', 'island2', 'island', 'next')
  ])
  assert.ok(issuesFor(artifact).includes('unreachable'))
})

test('a mind map with two roots is two mind maps', () => {
  const artifact = artifactOf('mind-map', [object('r1', 'root'), object('r2', 'root')])
  const report = validate(registryOf(), artifact)
  assert.ok(!isBuilderError(report))
  const issue = report.issues.find((one) => one.kind === 'root-count')
  assert.equal(issue?.blocking, true)
  assert.match(issue?.describe ?? '', /Two roots is two mind maps/)
})

test('a mind map branch with two parents is a graph', () => {
  const artifact = artifactOf(
    'mind-map',
    [object('r', 'root'), object('a', 'branch'), object('b', 'branch')],
    [connector('c1', 'r', 'b', 'child'), connector('c2', 'a', 'b', 'child')]
  )
  assert.ok(issuesFor(artifact).includes('two-parents'))
})

test('a timeline event with no time cannot be placed', () => {
  assert.ok(issuesFor(artifactOf('timeline', [object('e', 'event')])).includes('no-time'))
})

test('a timeline period that ends before it starts is blocking', () => {
  const artifact = artifactOf('timeline', [object('p', 'period', { fields: { at: 10, until: 5 } as Record<string, FieldValue> })])
  assert.ok(issuesFor(artifact).includes('backwards'))
})

test('a form field with no name cannot be read', () => {
  assert.ok(issuesFor(artifactOf('form', [object('f', 'text-field')])).includes('unnamed-field'))
})

test('two form fields with the same name mean only one is read', () => {
  const artifact = artifactOf('form', [
    object('f1', 'text-field', { fields: { name: 'email' } }),
    object('f2', 'text-field', { fields: { name: 'email' } })
  ])
  assert.ok(issuesFor(artifact).includes('duplicate-name'))
})

test('a checklist item ticked before what it waits on is reported without blocking', () => {
  const artifact = artifactOf(
    'checklist',
    [object('a', 'item'), object('b', 'item', { fields: { done: true } })],
    [connector('c', 'a', 'b', 'blocks')]
  )
  const report = validate(registryOf(), artifact)
  assert.ok(!isBuilderError(report))
  assert.equal(report.issues.find((one) => one.kind === 'out-of-order')?.blocking, false)
})

test('a decision-tree question with one answer asks nothing', () => {
  const artifact = artifactOf('decision-tree', [object('q', 'question'), object('o', 'outcome')], [connector('c', 'q', 'o', 'answer', { text: 'yes' })])
  assert.ok(issuesFor(artifact).includes('question-one-answer'))
})

test('a decision-tree outcome with something after it is blocking', () => {
  const artifact = artifactOf(
    'decision-tree',
    [object('o', 'outcome'), object('q', 'question')],
    [connector('c', 'o', 'q', 'answer', { text: 'next' })]
  )
  assert.ok(issuesFor(artifact).includes('outcome-continues'))
})

test('an unlabelled decision-tree answer is blocking', () => {
  const artifact = artifactOf(
    'decision-tree',
    [object('q', 'question'), object('o1', 'outcome'), object('o2', 'outcome')],
    [connector('c1', 'q', 'o1', 'answer', { text: '' }), connector('c2', 'q', 'o2', 'answer', { text: 'no' })]
  )
  assert.ok(issuesFor(artifact).includes('unlabelled-answer'))
})

test('a table with two columns of the same name is blocking', () => {
  const artifact = artifactOf('table', [
    object('c1', 'column', { fields: { name: 'total' } }),
    object('c2', 'column', { fields: { name: 'total' } })
  ])
  assert.ok(issuesFor(artifact).includes('duplicate-column'))
})

test('a calculator output with no formula never shows anything', () => {
  assert.ok(issuesFor(artifactOf('calculator', [object('o', 'output')])).includes('no-formula'))
})

test('a well-formed flowchart passes', () => {
  const artifact = artifactOf(
    'flowchart',
    [object('s', 'start'), object('d', 'decision'), object('e', 'end'), object('e2', 'end')],
    [
      connector('c0', 's', 'd', 'next'),
      connector('c1', 'd', 'e', 'yes'),
      connector('c2', 'd', 'e2', 'no')
    ]
  )
  const report = validate(registryOf(), artifact)
  assert.ok(!isBuilderError(report))
  assert.deepEqual(report.issues, [])
  assert.equal(report.ok, true)
})

test('the stated assumptions are frozen and rule out code in artifacts', () => {
  assert.equal(Object.isFrozen(BUILDER_ASSUMPTIONS), true)
  assert.ok(BUILDER_ASSUMPTIONS.some((one) => /never code/.test(one)))
})
