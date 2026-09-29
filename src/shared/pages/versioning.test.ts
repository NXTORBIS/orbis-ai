import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { compile, isCompileError, type Compiled } from './compiler.ts'
import { SPEC_VERSION, type PageSpec } from './spec.ts'
import {
  byNewest,
  carryValues,
  describeVersion,
  difference,
  fork,
  isVersionError,
  lineage,
  nextVersionFor,
  nodeById,
  openableNode,
  prune,
  publish,
  publishedNode,
  regenerate,
  startGraph,
  VERSION_LIMITS,
  withdraw,
  type PageVersionNode,
  type VersionGraph
} from './versioning.ts'

const OPERATIONS: Readonly<Record<string, string>> = Object.freeze({
  'units.convert': 'computation.units',
  'statistics.summary': 'computation.statistics',
  'motion.projectile': 'computation.physics'
})

const spec = (parts: Partial<PageSpec> = {}): PageSpec => ({
  specVersion: SPEC_VERSION,
  title: 'Projectile Range',
  purpose: 'Work out how far something thrown at an angle travels before it lands.',
  inputs: [
    { name: 'speed', kind: 'number', label: 'Launch speed', initial: 20, minimum: 0, maximum: 200 },
    { name: 'angle', kind: 'number', label: 'Launch angle', initial: 45, minimum: 0, maximum: 90 }
  ],
  steps: [
    {
      name: 'flight',
      operation: 'motion.projectile',
      arguments: { speed: { input: 'speed' }, angle: { input: 'angle' }, gravity: { value: 9.81 } },
      when: 'change'
    }
  ],
  outputs: [{ name: 'range', label: 'How far it goes', display: 'statistic', step: 'flight', pick: 'range' }],
  sections: [
    { title: 'The throw', members: ['speed', 'angle'] },
    { title: 'Where it lands', members: ['range'] }
  ],
  notes: ['There is no air resistance in this calculation.'],
  keywords: ['projectile', 'range'],
  ...parts
})

const build = (one: PageSpec, pageId = 'page_a1b2c3d4e5f6a7b8c9d0e1f2'): Compiled => {
  const compiled = compile(one, { operations: OPERATIONS, pageId })
  assert.ok(!isCompileError(compiled), JSON.stringify(isCompileError(compiled) ? compiled.problems : ''))
  return compiled
}

const graphOf = (one: Compiled, now = 1000): VersionGraph =>
  startGraph({ pageId: one.manifest.pageId, versionId: 'v1', spec: one.spec, manifest: one.manifest, document: one.document, now })

describe('the graph', () => {
  it('starts with one draft and nothing published', () => {
    const graph = graphOf(build(spec()))
    assert.equal(graph.nodes.length, 1)
    assert.equal(graph.nodes[0].state, 'draft')
    assert.equal(graph.publishedVersionId, null)
    assert.equal(publishedNode(graph), null)
  })

  it('opens the newest draft while nothing is published, and the published one once something is', () => {
    let graph = graphOf(build(spec()))
    assert.equal(openableNode(graph)?.versionId, 'v1')
    const published = publish(graph, 'v1')
    assert.ok(!isVersionError(published))
    graph = published
    assert.equal(openableNode(graph)?.versionId, 'v1')
    assert.equal(graph.nodes[0].state, 'published')
  })

  it('refuses to publish a version that is not there, or one already in use', () => {
    const graph = graphOf(build(spec()))
    const missing = publish(graph, 'v9')
    assert.ok(isVersionError(missing) && missing.error === 'unknown-version')
    const first = publish(graph, 'v1')
    assert.ok(!isVersionError(first))
    const again = publish(first, 'v1')
    assert.ok(isVersionError(again) && again.error === 'already-published')
  })
})

describe('regenerate', () => {
  const start = (): VersionGraph => {
    const published = publish(graphOf(build(spec())), 'v1')
    assert.ok(!isVersionError(published))
    return published
  }

  it('adds a version and leaves every existing one exactly as it was', () => {
    const before = start()
    const next = build(
      spec({
        inputs: [...spec().inputs, { name: 'height', kind: 'number', label: 'Launch height', initial: 0, minimum: 0, maximum: 100 }],
        steps: [
          {
            name: 'flight',
            operation: 'motion.projectile',
            arguments: { speed: { input: 'speed' }, angle: { input: 'angle' }, height: { input: 'height' }, gravity: { value: 9.81 } },
            when: 'change'
          }
        ],
        sections: [
          { title: 'The throw', members: ['speed', 'angle', 'height'] },
          { title: 'Where it lands', members: ['range'] }
        ]
      })
    )
    const result = regenerate(before, 'v1', { versionId: 'v2', ...next }, 'add a launch height', 2000)
    assert.ok(!isVersionError(result))
    // The contract of this whole file: the old node is byte-for-byte what it was.
    assert.deepEqual(nodeById(result.graph, 'v1'), nodeById(before, 'v1'))
    assert.equal(result.graph.nodes.length, 2)
    assert.equal(result.node.parentVersionId, 'v1')
    assert.equal(result.node.state, 'draft')
    // And publishing is still the old one until somebody says otherwise.
    assert.equal(result.graph.publishedVersionId, 'v1')
  })

  it('insists on knowing what the new version was for', () => {
    const before = start()
    const next = build(spec())
    for (const reason of ['', '   ', 'x'.repeat(VERSION_LIMITS.reasonLength + 1)]) {
      const result = regenerate(before, 'v1', { versionId: 'v2', ...next }, reason, 2000)
      assert.ok(isVersionError(result) && result.error === 'bad-reason', JSON.stringify(reason.slice(0, 10)))
    }
  })

  it('refuses to build from a version that is not there', () => {
    const result = regenerate(start(), 'v9', { versionId: 'v2', ...build(spec()) }, 'why not', 2000)
    assert.ok(isVersionError(result) && result.error === 'unknown-version')
  })

  it('supersedes rather than deletes when the new version is published', () => {
    const before = start()
    const result = regenerate(before, 'v1', { versionId: 'v2', ...build(spec({ title: 'Projectile Distance' })) }, 'rename it', 2000)
    assert.ok(!isVersionError(result))
    const published = publish(result.graph, 'v2')
    assert.ok(!isVersionError(published))
    assert.equal(nodeById(published, 'v1')?.state, 'superseded')
    assert.equal(nodeById(published, 'v2')?.state, 'published')
    // Going back is publishing the old node again, not rebuilding it.
    const back = publish(published, 'v1')
    assert.ok(!isVersionError(back))
    assert.equal(nodeById(back, 'v1')?.state, 'published')
    assert.equal(nodeById(back, 'v2')?.state, 'superseded')
    assert.deepEqual(nodeById(back, 'v1')?.document, nodeById(before, 'v1')?.document)
  })
})

describe('what changed, and what version that makes', () => {
  const previous = { major: 2, minor: 3, patch: 4 }

  it('calls losing something a major change, because a Page somebody filled in will not behave the same', () => {
    const before = spec()
    const after = spec({
      inputs: [before.inputs[0]],
      steps: [{ ...before.steps[0], arguments: { speed: { input: 'speed' }, gravity: { value: 9.81 } } }],
      sections: [
        { title: 'The throw', members: ['speed'] },
        { title: 'Where it lands', members: ['range'] }
      ]
    })
    const diff = difference(before, after, [], [], previous)
    assert.ok(diff.changes.some((one) => one.kind === 'removed' && one.name === 'angle'))
    assert.deepEqual(diff.nextVersion, { major: 3, minor: 0, patch: 0 })
  })

  it('calls changing a kind a major change too', () => {
    const before = spec()
    const after = spec({
      inputs: [{ ...before.inputs[0], kind: 'quantity', unit: 'm/s', minimum: undefined, maximum: undefined }, before.inputs[1]]
    })
    assert.deepEqual(difference(before, after, [], [], previous).nextVersion, { major: 3, minor: 0, patch: 0 })
  })

  it('calls adding something a minor change', () => {
    const before = spec()
    const after = spec({ inputs: [...before.inputs, { name: 'height', kind: 'number', label: 'Launch height' }] })
    const diff = difference(before, after, [], [], previous)
    assert.ok(diff.changes.some((one) => one.kind === 'added'))
    assert.deepEqual(diff.nextVersion, { major: 2, minor: 4, patch: 0 })
  })

  it('calls a reworded label a patch', () => {
    const before = spec()
    const after = spec({ inputs: [{ ...before.inputs[0], label: 'Speed at launch' }, before.inputs[1]] })
    const diff = difference(before, after, [], [], previous)
    assert.deepEqual(diff.nextVersion, { major: 2, minor: 3, patch: 5 })
  })

  it('calls asking for a new permission a major change, whatever else happened', () => {
    const diff = difference(spec(), spec(), ['computation.physics'], ['computation.physics', 'storage.page'], previous)
    assert.ok(diff.wantsMore)
    assert.deepEqual(diff.newCapabilities, ['storage.page'])
    assert.deepEqual(diff.nextVersion, { major: 3, minor: 0, patch: 0 })
  })

  it('does not call a permission being given up a major change', () => {
    const diff = difference(spec(), spec(), ['computation.physics', 'storage.page'], ['computation.physics'], previous)
    assert.equal(diff.wantsMore, false)
    assert.deepEqual(diff.nextVersion, { major: 2, minor: 3, patch: 5 })
  })

  it('notices a calculation being done a different way', () => {
    const before = spec()
    const after = spec({
      steps: [{ ...before.steps[0], operation: 'statistics.summary', arguments: { values: { input: 'speed' } } }]
    })
    const diff = difference(before, after, [], [], previous)
    assert.ok(diff.changes.some((one) => one.kind === 'retyped' && one.what === 'step'))
    assert.deepEqual(diff.nextVersion, { major: 3, minor: 0, patch: 0 })
  })

  it('computes the same version from the same changes, wherever it is asked', () => {
    const before = spec()
    const after = spec({ inputs: [...before.inputs, { name: 'height', kind: 'number', label: 'Launch height' }] })
    const diff = difference(before, after, [], [], previous)
    assert.deepEqual(nextVersionFor(previous, diff), diff.nextVersion)
  })
})

describe('carrying somebody’s numbers across', () => {
  it('carries what the new version would have let them type', () => {
    const before = spec()
    const carried = carryValues(before, spec(), { speed: 30, angle: 60 })
    assert.deepEqual(carried.values, { speed: 30, angle: 60 })
    assert.deepEqual(carried.dropped, [])
  })

  it('drops a value the new version would refuse, and says which and why', () => {
    const before = spec()
    const after = spec({ inputs: [{ ...before.inputs[0], minimum: 50 }, before.inputs[1]] })
    const carried = carryValues(before, after, { speed: 30, angle: 60 })
    assert.deepEqual(carried.values, { angle: 60 })
    assert.equal(carried.dropped.length, 1)
    assert.equal(carried.dropped[0].name, 'speed')
    assert.ok(carried.dropped[0].why.includes('outside'))
  })

  it('never converts a unit, because that is arithmetic on somebody’s data nobody asked for', () => {
    const before = spec({
      inputs: [{ name: 'weight', kind: 'quantity', label: 'Weight', unit: 'kg' }, spec().inputs[1]]
    })
    const after = spec({
      inputs: [{ name: 'weight', kind: 'quantity', label: 'Weight', unit: 'lb' }, spec().inputs[1]]
    })
    const carried = carryValues(before, after, { weight: 70 })
    assert.deepEqual(carried.values, {})
    assert.ok(carried.dropped[0].why.includes('kg'))
    assert.ok(carried.dropped[0].why.includes('lb'))
  })

  it('drops a choice that is no longer one of the choices', () => {
    const options = [
      { value: 'grass', label: 'Grass' },
      { value: 'sand', label: 'Sand' }
    ]
    const before = spec({ inputs: [{ name: 'surface', kind: 'choice', label: 'Surface', options }] })
    const after = spec({ inputs: [{ name: 'surface', kind: 'choice', label: 'Surface', options: [options[1]] }] })
    assert.deepEqual(carryValues(before, after, { surface: 'grass' }).values, {})
    assert.deepEqual(carryValues(before, after, { surface: 'sand' }).values, { surface: 'sand' })
  })

  it('drops a value whose kind changed rather than coercing it', () => {
    const before = spec()
    const after = spec({ inputs: [{ name: 'speed', kind: 'text', label: 'Launch speed' }, before.inputs[1]] })
    const carried = carryValues(before, after, { speed: 30, angle: 60 })
    assert.deepEqual(carried.values, { angle: 60 })
    assert.ok(carried.dropped[0].why.includes('number'))
  })

  it('drops a saved value of the wrong shape, which is what a hand-edited file looks like', () => {
    const before = spec()
    const carried = carryValues(before, spec(), { speed: 'thirty', angle: 60 })
    assert.deepEqual(carried.values, { angle: 60 })
  })

  it('ignores a field that was never saved rather than inventing one', () => {
    const carried = carryValues(spec(), spec(), { angle: 60 })
    assert.deepEqual(carried.values, { angle: 60 })
    assert.deepEqual(carried.dropped, [])
  })
})

describe('forking', () => {
  it('makes a separate Page with its own address, starting from that version', () => {
    const source = graphOf(build(spec()))
    const other = build(spec({ title: 'Projectile Range For Golf' }), 'page_ffffffffffffffffffffffff')
    const forked = fork(source, 'v1', { pageId: other.manifest.pageId, versionId: 'w1', manifest: other.manifest, now: 3000 })
    assert.ok(!isVersionError(forked))
    assert.equal(forked.pageId, other.manifest.pageId)
    assert.equal(forked.forkedFrom, `${source.pageId}/v1`)
    assert.deepEqual(forked.nodes[0].version, { major: 1, minor: 0, patch: 0 })
    // The document is the one it was forked from, not the one the new manifest was compiled with.
    assert.deepEqual(forked.nodes[0].document, source.nodes[0].document)
    // And the source is untouched.
    assert.equal(source.nodes.length, 1)
  })

  it('refuses to fork a version that is not there', () => {
    const forked = fork(graphOf(build(spec())), 'v9', {
      pageId: 'page_ffffffffffffffffffffffff',
      versionId: 'w1',
      manifest: build(spec()).manifest,
      now: 3000
    })
    assert.ok(isVersionError(forked) && forked.error === 'unknown-version')
  })
})

describe('reading the history', () => {
  const chain = (): VersionGraph => {
    let graph = graphOf(build(spec()))
    for (const [from, to] of [
      ['v1', 'v2'],
      ['v2', 'v3']
    ]) {
      const result = regenerate(graph, from, { versionId: to, ...build(spec({ title: `Projectile ${to}` })) }, `step ${to}`, 2000)
      assert.ok(!isVersionError(result))
      graph = result.graph
    }
    return graph
  }

  it('walks back to the first version', () => {
    const walked = lineage(chain(), 'v3')
    assert.ok(!isVersionError(walked))
    assert.deepEqual(walked.map((one) => one.versionId), ['v3', 'v2', 'v1'])
  })

  it('refuses a history that refers to itself rather than hanging', () => {
    // A stored graph is a file, and a file can be edited.
    const graph = chain()
    const looped: VersionGraph = {
      ...graph,
      nodes: graph.nodes.map((one) => (one.versionId === 'v1' ? { ...one, parentVersionId: 'v3' } : one))
    }
    const walked = lineage(looped, 'v3')
    assert.ok(isVersionError(walked) && walked.error === 'too-deep')
  })

  it('describes a version by what it was asked to be', () => {
    const graph = chain()
    assert.ok(describeVersion(nodeById(graph, 'v1') as PageVersionNode).includes('the first version'))
    assert.ok(describeVersion(nodeById(graph, 'v2') as PageVersionNode).includes('step v2'))
  })

  it('sorts newest first', () => {
    const graph = chain()
    const sorted = [...graph.nodes].sort(byNewest)
    assert.equal(sorted[0].versionId, 'v3')
  })
})

describe('withdrawing and pruning', () => {
  it('leaves a Page with nothing published when the published one is withdrawn', () => {
    const published = publish(graphOf(build(spec())), 'v1')
    assert.ok(!isVersionError(published))
    const gone = withdraw(published, 'v1')
    assert.ok(!isVersionError(gone))
    assert.equal(gone.publishedVersionId, null)
    assert.equal(nodeById(gone, 'v1')?.state, 'withdrawn')
    // Still there, so what it was can be read.
    assert.equal(gone.nodes.length, 1)
  })

  it('never drops the published version, a draft, or anything something descends from', () => {
    const one = build(spec())
    const nodes: PageVersionNode[] = []
    for (let i = 0; i < VERSION_LIMITS.versions + 10; i++) {
      nodes.push({
        versionId: `v${i}`,
        // A flat history, so nothing is anything else's parent and everything old is droppable.
        parentVersionId: null,
        version: { major: 1, minor: i, patch: 0 },
        state: i === 0 ? 'published' : i === 1 ? 'draft' : 'superseded',
        reason: `step ${i}`,
        createdAt: 1000 + i,
        spec: one.spec,
        manifest: one.manifest,
        document: one.document
      })
    }
    const pruned = prune({ pageId: one.manifest.pageId, nodes, publishedVersionId: 'v0', forkedFrom: null })
    assert.equal(pruned.nodes.length, VERSION_LIMITS.versions)
    assert.ok(nodeById(pruned, 'v0') !== null, 'the published one survives')
    assert.ok(nodeById(pruned, 'v1') !== null, 'the draft survives')
    // The oldest superseded ones went first.
    assert.equal(nodeById(pruned, 'v2'), null)
  })

  it('drops nothing when a history is all drafts, however long it gets', () => {
    const one = build(spec())
    const nodes: PageVersionNode[] = new Array(VERSION_LIMITS.versions + 5).fill(0).map((_, i) => ({
      versionId: `v${i}`,
      parentVersionId: null,
      version: { major: 1, minor: i, patch: 0 },
      state: 'draft' as const,
      reason: null,
      createdAt: 1000 + i,
      spec: one.spec,
      manifest: one.manifest,
      document: one.document
    }))
    const pruned = prune({ pageId: one.manifest.pageId, nodes, publishedVersionId: null, forkedFrom: null })
    assert.equal(pruned.nodes.length, nodes.length)
  })
})
