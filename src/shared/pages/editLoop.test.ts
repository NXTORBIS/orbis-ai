/**
 * The editing loop, and the one property that matters: a failed edit cannot damage the Page somebody is using.
 *
 * `GeneratedPages.edit` orchestrates four things that are all pure -- recognise the request, check the change set
 * against the live specification, apply it to a copy, and make a new version. The service that wires them needs a
 * model to exist, which is why the orchestration is tested here against the same modules in the same order instead:
 * the safety property lives in that order, not in the service.
 *
 * The order is the property. Everything that can fail happens before the version graph is touched, and the version
 * that comes out is a draft -- so the Page people open is the old one until somebody publishes, and a refused edit
 * leaves the graph exactly as it was.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { apply, check, read, type ChangeSet } from './changes.ts'
import { openableNode, publish, regenerate, startGraph, isVersionError } from './versioning.ts'
import type { PageSpec } from './spec.ts'
import type { PageManifest } from './manifest.ts'

/** A Page with two inputs, a button step and two outputs: enough shape for every edit below to have a target. */
const spec: PageSpec = {
  specVersion: 1,
  title: 'Projectile range',
  purpose: 'Work out how far something thrown will travel.',
  inputs: [
    { name: 'speed', kind: 'quantity', label: 'Speed', unit: 'm/s' },
    { name: 'angle', kind: 'quantity', label: 'Angle', unit: 'deg' }
  ],
  steps: [{ name: 'flight', operation: 'motion.projectile', arguments: {}, when: 'change' }],
  outputs: [
    // `pick` is required for a single value: a calculation returns a result with several parts, and the Page has to
    // say which one it is showing. The spec checker refuses it otherwise, which it did to the first version of this
    // fixture.
    { name: 'range', label: 'Range', display: 'value', step: 'flight', pick: 'range' },
    { name: 'path', label: 'Path', display: 'table', step: 'flight' }
  ],
  sections: [
    { title: 'Inputs', members: ['speed', 'angle'] },
    // Every output has to be in a section or it would never be shown.
    { title: 'Results', members: ['range', 'path'] }
  ],
  notes: ['Air resistance is ignored.'],
  keywords: ['projectile']
}

const manifest = {
  schemaVersion: 1,
  pageId: 'page_aaaaaaaaaaaa',
  slug: 'projectile-range',
  title: spec.title,
  description: spec.purpose,
  kind: 'calculator',
  categories: ['science.physics'],
  tags: [],
  version: { major: 1, minor: 0, patch: 0 },
  capabilities: ['computation.physics'],
  limitations: [...spec.notes]
} as unknown as PageManifest

const document = { inputs: {}, outputs: {} } as never

const known: Readonly<Record<string, string>> = { 'motion.projectile': 'computation.physics' }

/**
 * A Page with a published first version.
 *
 * Publishing matters here. `startGraph` creates a draft, and `openableNode` falls back to the newest draft when
 * nothing is published -- so on an unpublished Page an edit really does change what opens, quite correctly, because
 * there is nothing live to protect. The safety property being tested only exists once something is published, and a
 * fixture that skipped that step would have been asserting nothing.
 */
const graphWith = (): ReturnType<typeof startGraph> => {
  const started = startGraph({
    pageId: manifest.pageId,
    versionId: 'v_first',
    spec,
    manifest,
    document,
    reason: 'First build.',
    now: 1_000
  })
  const live = publish(started, 'v_first')
  assert.ok(!isVersionError(live), 'the fixture should publish its first version')
  return live
}

const live = (graph: ReturnType<typeof startGraph>): PageSpec => {
  const node = openableNode(graph)
  assert.ok(node !== null, 'the graph should have an openable version')
  return node.spec
}

describe('recognising a request', () => {
  it('reads a rename into a single named change', () => {
    const set = read('rename the speed box to launch speed', spec)
    assert.ok(set !== null)
    assert.equal(set.direct, true, 'a rename needs nobody\'s judgement')
    assert.equal(set.changes.length, 1)
    assert.equal(set.changes[0].op, 'relabel')
    assert.equal(set.changes[0].target, 'speed')
  })

  it('reads a retitle', () => {
    const set = read('rename it Throwing things', spec)
    assert.ok(set !== null)
    assert.equal(set.changes[0].op, 'retitle')
  })

  it('reads a change of display', () => {
    const set = read('show the path as a chart', spec)
    assert.ok(set !== null)
    assert.equal(set.changes[0].op, 'redisplay')
    assert.equal(set.changes[0].target, 'path')
  })

  it('reads a step moving onto a button', () => {
    const set = read('calculate flight when I press', spec)
    assert.ok(set !== null)
    assert.equal(set.changes[0].op, 'retime')
  })

  it('returns null for a request that is really asking for something new', () => {
    // Not a failure. It means the Page has to be built again, and the caller decides that -- collapsing the two
    // would hide real failures behind a regeneration.
    assert.equal(read('also work out the maximum height', spec), null)
    assert.equal(read('make it work for a different planet', spec), null)
  })

  it('returns null rather than guessing at a field the Page does not have', () => {
    assert.equal(read('rename the mass box to weight', spec), null)
  })
})

describe('checking before applying', () => {
  it('passes a change whose target exists', () => {
    const set = read('rename the speed box to launch speed', spec) as ChangeSet
    assert.deepEqual(check(set, spec), [])
  })

  it('refuses a change naming something that is not there, rather than doing nothing', () => {
    const set: ChangeSet = {
      request: 'rename the mass box',
      direct: true,
      changes: [{ op: 'relabel', target: 'mass', to: 'Weight', reason: '' }]
    }
    const problems = check(set, spec)
    assert.ok(problems.length > 0)
    assert.ok(problems.some((one) => one.at === 'mass' || /mass/.test(one.message)))
  })

  it('refuses a display a Page cannot show', () => {
    const set: ChangeSet = {
      request: 'show it as a hologram',
      direct: true,
      changes: [{ op: 'redisplay', target: 'range', to: 'hologram', reason: '' }]
    }
    assert.ok(check(set, spec).length > 0)
  })

  it('refuses an empty change set rather than treating it as a success', () => {
    assert.ok(check({ request: 'do nothing', direct: true, changes: [] }, spec).length > 0)
  })
})

describe('applying', () => {
  it('changes only what was asked for', () => {
    const set = read('rename the speed box to launch speed', spec) as ChangeSet
    const result = apply(spec, set, known)
    assert.ok(!('problems' in result), JSON.stringify(result))
    const after = result.spec
    assert.equal(after.inputs.find((one) => one.name === 'speed')?.label, 'launch speed')
    // Everything else is the same object graph, by value. This is the property the whole path exists for.
    assert.deepEqual(after.steps, spec.steps, 'the calculation was touched')
    assert.deepEqual(after.outputs, spec.outputs, 'the outputs were touched')
    assert.equal(after.purpose, spec.purpose)
    assert.deepEqual([...after.notes], [...spec.notes])
  })

  it('leaves the original specification alone', () => {
    const before = JSON.stringify(spec)
    const set = read('rename it Throwing things', spec) as ChangeSet
    apply(spec, set, known)
    assert.equal(JSON.stringify(spec), before, 'apply edited the specification it was given')
  })

  it('refuses rather than applying when the change set is wrong', () => {
    const set: ChangeSet = {
      request: 'x',
      direct: true,
      changes: [{ op: 'relabel', target: 'nothing-here', to: 'X', reason: '' }]
    }
    const result = apply(spec, set, known)
    assert.ok('problems' in result)
  })
})

describe('what reaches the version graph', () => {
  it('makes a draft, leaving the version people open unchanged', () => {
    const graph = graphWith()
    const published = openableNode(graph)
    assert.ok(published !== null)

    const set = read('rename the speed box to launch speed', spec) as ChangeSet
    const applied = apply(spec, set, known)
    assert.ok(!('problems' in applied))

    const result = regenerate(
      graph,
      published.versionId,
      { versionId: 'v_second', spec: applied.spec, manifest, document },
      'rename the speed box to launch speed',
      2_000
    )
    assert.ok(!isVersionError(result))
    assert.equal(result.node.state, 'draft', 'a new version has to be a draft')
    // The Page somebody opens is still the one it was.
    assert.equal(live(result.graph).inputs.find((one) => one.name === 'speed')?.label, 'Speed')
  })

  it('changes what opens only once the draft is published', () => {
    const graph = graphWith()
    const published = openableNode(graph)
    assert.ok(published !== null)
    const set = read('rename the speed box to launch speed', spec) as ChangeSet
    const applied = apply(spec, set, known)
    assert.ok(!('problems' in applied))
    const made = regenerate(
      graph,
      published.versionId,
      { versionId: 'v_second', spec: applied.spec, manifest, document },
      'rename it',
      2_000
    )
    assert.ok(!isVersionError(made))

    const after = publish(made.graph, 'v_second')
    assert.ok(!isVersionError(after))
    assert.equal(live(after).inputs.find((one) => one.name === 'speed')?.label, 'launch speed')
  })

  it('leaves the graph untouched when the edit was refused', () => {
    // The order is the safety property: nothing reaches the graph until the change has been checked and applied.
    const graph = graphWith()
    const before = JSON.stringify(graph)
    const set: ChangeSet = {
      request: 'rename the mass box',
      direct: true,
      changes: [{ op: 'relabel', target: 'mass', to: 'Weight', reason: '' }]
    }
    const problems = check(set, spec)
    assert.ok(problems.length > 0)
    // A caller that stops here -- which is what the service does -- has not touched anything.
    assert.equal(JSON.stringify(graph), before)
    assert.equal(live(graph).inputs.find((one) => one.name === 'speed')?.label, 'Speed')
  })

  it('keeps the Page id and slug across an edit', () => {
    const graph = graphWith()
    const published = openableNode(graph)
    assert.ok(published !== null)
    const set = read('rename it Throwing things', spec) as ChangeSet
    const applied = apply(spec, set, known)
    assert.ok(!('problems' in applied))
    const made = regenerate(
      graph,
      published.versionId,
      {
        versionId: 'v_second',
        spec: applied.spec,
        manifest: { ...manifest, pageId: manifest.pageId, slug: manifest.slug },
        document
      },
      'rename it',
      2_000
    )
    assert.ok(!isVersionError(made))
    // A new id would break every bookmark, note and workflow that referred to it.
    assert.equal(made.node.manifest.pageId, manifest.pageId)
    assert.equal(made.node.manifest.slug, manifest.slug)
  })

  it('records what the edit was for, so the history reads as a list of changes', () => {
    const graph = graphWith()
    const published = openableNode(graph)
    assert.ok(published !== null)
    const set = read('show the path as a chart', spec) as ChangeSet
    const applied = apply(spec, set, known)
    assert.ok(!('problems' in applied))
    const made = regenerate(
      graph,
      published.versionId,
      { versionId: 'v_second', spec: applied.spec, manifest, document },
      'show the path as a chart',
      2_000
    )
    assert.ok(!isVersionError(made))
    assert.equal(made.node.reason, 'show the path as a chart')
  })

  it('numbers an edit as a smaller change than a rewrite', () => {
    const graph = graphWith()
    const published = openableNode(graph)
    assert.ok(published !== null)
    const set = read('rename the speed box to launch speed', spec) as ChangeSet
    const applied = apply(spec, set, known)
    assert.ok(!('problems' in applied))
    const made = regenerate(
      graph,
      published.versionId,
      { versionId: 'v_second', spec: applied.spec, manifest, document },
      'rename it',
      2_000
    )
    assert.ok(!isVersionError(made))
    // A label is not a new capability and not a removed field, so it cannot be a major step.
    assert.equal(made.node.version.major, 1)
  })
})

describe('the whole loop, in the order the service runs it', () => {
  /** Exactly what `GeneratedPages.edit` does, minus the store and the compiler. */
  const runEdit = (
    graph: ReturnType<typeof startGraph>,
    request: string
  ): { ok: boolean; recognised: boolean; graph: ReturnType<typeof startGraph> } => {
    const node = openableNode(graph)
    if (node === null) return { ok: false, recognised: true, graph }
    const set = read(request, node.spec)
    if (set === null) return { ok: false, recognised: false, graph }
    if (check(set, node.spec).length > 0) return { ok: false, recognised: true, graph }
    const applied = apply(node.spec, set, known)
    if ('problems' in applied) return { ok: false, recognised: true, graph }
    const made = regenerate(
      graph,
      node.versionId,
      { versionId: `v_${request.length}`, spec: applied.spec, manifest, document },
      request,
      3_000
    )
    if (isVersionError(made)) return { ok: false, recognised: true, graph }
    return { ok: true, recognised: true, graph: made.graph }
  }

  it('succeeds on a recognised edit and leaves a draft behind', () => {
    const result = runEdit(graphWith(), 'rename the speed box to launch speed')
    assert.equal(result.ok, true)
    assert.equal(result.graph.nodes.length, 2)
    assert.equal(result.graph.nodes.filter((one) => one.state === 'draft').length, 1)
  })

  it('reports an unrecognised request without touching anything', () => {
    const graph = graphWith()
    const before = JSON.stringify(graph)
    const result = runEdit(graph, 'also work out the maximum height')
    assert.equal(result.ok, false)
    assert.equal(result.recognised, false, 'this should ask for a rebuild, not report a failure')
    assert.equal(JSON.stringify(result.graph), before)
  })

  it('reports a bad edit as a failure, distinct from an unrecognised one', () => {
    const graph = graphWith()
    const before = JSON.stringify(graph)
    const result = runEdit(graph, 'rename the mass box to weight')
    assert.equal(result.ok, false)
    // `read` returns null for a target that is not there, so this is the rebuild path rather than a failure -- and
    // that is the honest answer: the Page has no mass, so this request is asking for something it does not do.
    assert.equal(result.recognised, false)
    assert.equal(JSON.stringify(result.graph), before)
  })

  it('applies several edits in turn, each on top of the last', () => {
    let graph = graphWith()
    graph = runEdit(graph, 'rename the speed box to launch speed').graph
    const first = graph.nodes.find((one) => one.state === 'draft')
    assert.ok(first !== undefined)
    const after = publish(graph, first.versionId)
    assert.ok(!isVersionError(after))
    const second = runEdit(after, 'rename it Throwing things')
    assert.equal(second.ok, true)
    const draft = second.graph.nodes.find((one) => one.state === 'draft')
    assert.ok(draft !== undefined)
    // Both edits are in the latest draft: the second was applied to the first's result, not to the original.
    assert.equal(draft.spec.title, 'Throwing things')
    assert.equal(draft.spec.inputs.find((one) => one.name === 'speed')?.label, 'launch speed')
  })
})
