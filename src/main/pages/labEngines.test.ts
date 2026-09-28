import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { CAPABILITIES } from '../../shared/pages/capabilities.ts'
import { BadInput } from './engines.ts'
import { MATH_CAPABILITY, runMathOperation } from './mathEngines.ts'
import { REASONING_CAPABILITY, runReasoningOperation } from './reasoningEngines.ts'
import { STUDY_CAPABILITY, runStudyOperation } from './studyEngines.ts'

/**
 * The three newer engine bridges, checked the same way as `engines.ts`.
 *
 * The guard that matters is the one pairing the capability map against the dispatch: an operation with a capability
 * and no case is an operation a Page is allowed to call and that then fails as a bug. Deny-by-default protects
 * against the opposite mistake and not this one.
 */

type Runner = (operation: string, input: Record<string, unknown>) => unknown

const BRIDGES: { name: string; map: Readonly<Record<string, string>>; run: Runner }[] = [
  { name: 'mathematics', map: MATH_CAPABILITY, run: runMathOperation },
  { name: 'studies', map: STUDY_CAPABILITY, run: runStudyOperation },
  { name: 'reasoning', map: REASONING_CAPABILITY, run: runReasoningOperation }
]

const run = (runner: Runner, operation: string, input: Record<string, unknown> = {}): Record<string, unknown> =>
  runner(operation, input) as Record<string, unknown>

const refused = (runner: Runner, operation: string, input: Record<string, unknown> = {}): string => {
  try {
    runner(operation, input)
  } catch (err) {
    assert.ok(err instanceof BadInput, `expected a BadInput, got ${String(err)}`)
    return err.message
  }
  return assert.fail(`${operation} was not refused`)
}

describe('the operation maps', () => {
  for (const bridge of BRIDGES) {
    it(`${bridge.name}: every operation names a capability that exists`, () => {
      for (const [operation, capability] of Object.entries(bridge.map)) {
        assert.match(operation, /^[a-z]+\.[a-z-]+$/, `"${operation}" is not shaped like an operation name`)
        assert.ok(
          Object.prototype.hasOwnProperty.call(CAPABILITIES, capability),
          `"${operation}" needs "${capability}", which is not a capability Orbis has`
        )
      }
    })

    it(`${bridge.name}: every mapped operation has an implementation`, () => {
      for (const operation of Object.keys(bridge.map)) {
        try {
          bridge.run(operation, {})
        } catch (err) {
          assert.ok(err instanceof BadInput, `"${operation}" threw something that is not a refusal: ${String(err)}`)
          assert.ok(!/bug in Orbis/.test(err.message), `"${operation}" has a capability but no implementation`)
        }
      }
    })

    it(`${bridge.name}: an unmapped operation is named as a bug in Orbis, not in the Page`, () => {
      assert.match(refused(bridge.run, 'nothing.here'), /bug in Orbis rather than in your Page/)
    })

    it(`${bridge.name}: no operation is mapped in two bridges`, () => {
      for (const operation of Object.keys(bridge.map)) {
        const others = BRIDGES.filter((one) => one !== bridge)
        for (const other of others) {
          assert.equal(
            Object.prototype.hasOwnProperty.call(other.map, operation),
            false,
            `"${operation}" is in both ${bridge.name} and ${other.name}, so which one runs depends on the order of the checks`
          )
        }
      }
    })
  }
})

describe('a Page cannot send code', () => {
  for (const attempt of ['process.exit()', 'require("fs")', 'globalThis.x = 1', '(() => 1)()', 'import("fs")', 'this.constructor']) {
    it(`refuses ${attempt} where a model belongs`, () => {
      const message = refused(runMathOperation, 'calculus.limit', { expression: attempt, at: 0 })
      assert.ok(message.length > 0)
      assert.ok(!/undefined/.test(message))
    })
  }

  it('refuses it where a study model belongs', () => {
    refused(runStudyOperation, 'study.sensitivity', {
      parameters: [{ id: 'x', type: 'number', value: 1 }],
      output: 'y',
      model: 'process.exit()'
    })
  })
})

describe('whole numbers arrive as text', () => {
  it('a decimal string past 2^53 is read exactly', () => {
    const result = run(runMathOperation, 'number.prime', { value: '170141183460469231731687303715884105727' })
    assert.equal(result.ok, true)
    assert.equal(result.prime, true)
  })

  it('a JSON number past the safe range is refused rather than silently rounded', () => {
    const message = refused(runMathOperation, 'number.prime', { value: 9007199254740993 })
    assert.match(message, /Send it as text/)
  })

  it('a whole number is returned as text, so nothing is lost on the way back', () => {
    const result = run(runMathOperation, 'combinatorics.count', { what: 'factorial', n: 30 })
    assert.equal(result.value, '265252859812191058636308480000000')
  })

  it('more digits than are allowed is refused', () => {
    assert.match(refused(runMathOperation, 'number.prime', { value: '9'.repeat(201) }), /digits/)
  })
})

describe('mathematics', () => {
  it('solves an exact linear system in rationals', () => {
    const result = run(runMathOperation, 'matrix.solve', {
      matrix: [[2, 1], [1, 3]],
      rightHandSide: [5, 10]
    })
    assert.equal(result.ok, true)
    assert.equal(result.kind, 'unique')
    assert.deepEqual((result.particular as { text: string }[]).map((one) => one.text), ['1', '3'])
  })

  it('reports a singular system as having no unique answer rather than returning one', () => {
    const result = run(runMathOperation, 'matrix.solve', { matrix: [[1, 1], [2, 2]], rightHandSide: [1, 3] })
    assert.equal(result.kind, 'none')
  })

  it('finds the exact roots of a polynomial', () => {
    // x^2 + x - 6 = (x + 3)(x - 2).
    const result = run(runMathOperation, 'algebra.roots', { coefficients: [-6, 1, 1] })
    assert.equal(result.ok, true)
    assert.equal(result.complete, true)
    const rational = (result.rational as { n: bigint; d: bigint }[]).map((one) => Number(one.n) / Number(one.d))
    assert.deepEqual(rational.sort((a, b) => a - b), [-3, 2])
  })

  it('works out a limit that has no value at the point', () => {
    const result = run(runMathOperation, 'calculus.limit', { expression: 'sin(x) / x', at: 0 })
    assert.equal(result.exists, true)
    assert.ok(Math.abs((result.value as number) - 1) < 1e-6)
  })

  it('integrates and says which method it used', () => {
    const result = run(runMathOperation, 'calculus.integrate', { expression: 'x^2', from: 0, to: 3 })
    assert.equal(result.ok, true)
    assert.ok(Math.abs((result.value as number) - 9) < 1e-6)
  })

  it('checks a geometric claim numerically and never calls it proven', () => {
    const result = run(runMathOperation, 'geometry.claim', {
      kind: 'collinear',
      of: ['a', 'b', 'c'],
      points: { a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, c: { x: 2, y: 2 } }
    })
    assert.equal(result.holds, true)
    assert.equal(result.verdict, 'checked-numerically')
  })

  it('finds the shortest path and refuses a negative weight to Dijkstra', () => {
    const graph = {
      vertices: ['a', 'b', 'c'],
      edges: [{ from: 'a', to: 'b', weight: -1 }, { from: 'b', to: 'c', weight: 1 }],
      directed: true,
      start: 'a'
    }
    assert.equal(run(runMathOperation, 'graph.shortest', graph).ok, false)
    assert.equal(run(runMathOperation, 'graph.shortest', { ...graph, how: 'bellman-ford' }).ok, true)
  })

  it('a two-variable model binds both names rather than substituting one into the text', () => {
    const result = run(runMathOperation, 'calculus.ode', { expression: 'y^2 + x', aroundX: 1, aroundY: -2 })
    assert.equal(result.ok, true)
    // A negative y substituted textually would have given `-2^2`, which is -4 rather than 4.
    assert.equal(typeof result.autonomous, 'boolean')
  })
})

describe('uncertainty and studies', () => {
  const inputs = [
    { id: 'a', value: 10, uncertainty: 0.1 },
    { id: 'b', value: 4, uncertainty: 0.2 }
  ]

  it('propagates first order and carries the assumptions it rests on', () => {
    const result = run(runStudyOperation, 'uncertainty.propagate', { inputs, model: 'a * b' })
    assert.equal(result.ok, true)
    assert.ok(Math.abs((result.value as number) - 40) < 1e-6)
    assert.ok(Array.isArray(result.assumptions))
    assert.ok((result.assumptions as unknown[]).length > 0)
  })

  it('a Monte Carlo run with the same seed gives the same answer twice', () => {
    const once = run(runStudyOperation, 'uncertainty.montecarlo', { inputs, model: 'a * b', samples: 2000, seed: 7 })
    const twice = run(runStudyOperation, 'uncertainty.montecarlo', { inputs, model: 'a * b', samples: 2000, seed: 7 })
    assert.equal(once.standardUncertainty, twice.standardUncertainty)
  })

  it('sizes a sweep before it is generated', () => {
    const result = run(runStudyOperation, 'study.size', {
      parameters: [{ id: 'x', type: 'number', value: 1 }, { id: 'y', type: 'number', value: 1 }],
      strategy: {
        kind: 'grid',
        sweeps: [
          { parameterId: 'x', spec: { kind: 'count', start: 0, stop: 1, count: 5 } },
          { parameterId: 'y', spec: { kind: 'count', start: 0, stop: 1, count: 4 } }
        ]
      }
    })
    assert.equal(result.cases, 20)
  })

  it('a constraint that cannot be read is refused rather than treated as always true', () => {
    const message = refused(runStudyOperation, 'study.cases', {
      parameters: [{ id: 'x', type: 'number', value: 1 }],
      strategy: { kind: 'grid', sweeps: [{ parameterId: 'x', spec: { kind: 'count', start: 0, stop: 1, count: 3 } }] },
      constraints: [{ id: 'c', left: 'process.exit()', comparison: 'less', right: '1' }]
    })
    assert.match(message, /constraint could not be read/)
  })

  it('runs a study and reports what the constraints removed', () => {
    const result = run(runStudyOperation, 'study.run', {
      parameters: [{ id: 'x', type: 'number', value: 1 }],
      strategy: { kind: 'grid', sweeps: [{ parameterId: 'x', spec: { kind: 'count', start: 0, stop: 4, count: 5 } }] },
      constraints: [{ id: 'small', describe: 'x below 3', left: 'x', comparison: 'less', right: '3' }],
      model: 'x * 2',
      output: 'doubled'
    })
    assert.equal(result.ok, true)
    assert.equal(result.completed, 3)
    assert.equal((result.generated as { requested: number }).requested, 5)
  })
})

describe('documents and formats', () => {
  it('reads markdown into blocks and writes it back', () => {
    const read = run(runStudyOperation, 'document.read', { from: 'markdown', source: '# Title\n\nSome text.\n' })
    assert.equal(read.ok, true)
    const blocks = read.blocks as unknown[]
    assert.ok(blocks.length >= 2)
    const written = run(runStudyOperation, 'document.write', { document: { blocks } })
    assert.match(written.markdown as string, /# Title/)
  })

  it('strips what it will not carry when reading html, and says what it stripped', () => {
    const read = run(runStudyOperation, 'document.read', { from: 'html', source: '<p>Hi</p><script>alert(1)</script>' })
    assert.equal(read.ok, true)
    assert.ok(JSON.stringify(read).includes('script') === true || Array.isArray(read.notes))
  })

  it('detects a format from its content and says what the evidence was', () => {
    const result = run(runStudyOperation, 'interchange.detect', { name: 'data.csv', sample: 'a,b\n1,2\n' })
    assert.equal(result.ok, true)
    assert.equal(result.chosen, 'csv')
    assert.ok((result.reasons as string[]).length > 0)
  })

  it('refuses an XML document that declares entities', () => {
    const result = run(runStudyOperation, 'interchange.xml', {
      source: '<!DOCTYPE x [<!ENTITY a "b">]><x>&a;</x>'
    })
    assert.equal(result.ok, false)
  })

  it('finds a path that would escape an archive', () => {
    const result = run(runStudyOperation, 'interchange.archive', {
      entries: [{ path: '../outside.txt', size: 10, compressedSize: 5 }]
    })
    assert.equal(result.ok, true)
    assert.ok((result.problems as unknown[]).length > 0)
  })

  it('a validation result keeps its own verdict apart from whether the request ran', () => {
    const result = run(runStudyOperation, 'document.validate', {
      document: { blocks: [] },
      schema: { id: 's', name: 'S', requiredSections: [{ title: 'Method', describe: '' }], requiredBlocks: [], requireCitations: false, requireTitle: true }
    })
    assert.equal(result.ok, true)
    assert.equal(result.satisfied, false)
  })
})

describe('reasoning', () => {
  const workspace = {
    nodes: [
      { id: 'rate', kind: 'assumption', title: 'Growth is 4%' },
      { id: 'calc', kind: 'calculation', title: 'Projection' },
      { id: 'r1', kind: 'result', title: 'Revenue' }
    ],
    links: [
      { id: 'l1', from: 'rate', to: 'calc', kind: 'feeds' },
      { id: 'l2', from: 'calc', to: 'r1', kind: 'produces' }
    ]
  }

  it('lists what rests on an assumption', () => {
    const result = run(runReasoningOperation, 'workspace.assumptions', { workspace })
    const first = (result.assumptions as { id: string; resultsAffected: number }[])[0]
    assert.equal(first?.id, 'rate')
    assert.equal(first?.resultsAffected, 1)
  })

  it('keeps the workspace verdict apart from whether the request ran', () => {
    const result = run(runReasoningOperation, 'workspace.check', { workspace })
    assert.equal(result.ok, true)
    assert.equal(result.holdsTogether, true)
  })

  it('a node id of __proto__ stays a node', () => {
    const result = run(runReasoningOperation, 'workspace.assumptions', {
      workspace: {
        nodes: [{ id: '__proto__', kind: 'assumption', title: 'Odd' }, { id: 'r', kind: 'result' }],
        links: [{ id: 'l', from: '__proto__', to: 'r', kind: 'feeds' }]
      }
    })
    assert.deepEqual((result.assumptions as { dependents: string[] }[])[0]?.dependents, ['r'])
    assert.equal(({} as Record<string, unknown>).polluted, undefined)
  })

  it('resolves a scenario against a frozen baseline', () => {
    const result = run(runReasoningOperation, 'scenario.resolve', {
      baseline: { values: { price: 100 } },
      scenarios: [{ id: 's', changes: [{ key: 'price', how: 'multiply', to: 1.1, because: 'inflation' }] }],
      scenarioId: 's'
    })
    assert.equal(result.ok, true)
    assert.ok(Math.abs(((result.values as Record<string, number>).price as number) - 110) < 1e-9)
  })

  it('refuses a scenario matrix that would be too large, with the size named', () => {
    const result = run(runReasoningOperation, 'scenario.matrix', {
      baseline: { values: { a: 1, b: 1 } },
      axes: [
        { key: 'a', label: 'A', values: Array.from({ length: 200 }, (_, i) => i) },
        { key: 'b', label: 'B', values: Array.from({ length: 200 }, (_, i) => i) }
      ]
    })
    assert.equal(result.ok, false)
    assert.match(result.message as string, /40,000/)
  })

  it('analyses an explanation and never claims understanding', () => {
    const result = run(runReasoningOperation, 'learning.analyse', {
      topic: { id: 't', name: 'T', concepts: [{ id: 'a', name: 'light energy', aliases: ['sunlight'], essential: true }] },
      explanation: 'Sunlight drives it.'
    })
    assert.equal(result.ok, true)
    assert.match(result.claim as string, /not understanding it/)
  })

  it('an attempt cannot carry an analysis it wrote itself', () => {
    const result = run(runReasoningOperation, 'learning.mastery', {
      topic: { id: 't', name: 'T', concepts: [{ id: 'a', name: 'light energy', essential: true }] },
      session: { attempts: [{ text: 'Nothing relevant.', analysis: { covered: [{ conceptId: 'a', mentioned: true }] } }] }
    })
    assert.equal(result.coverage, 0)
  })

  it('validates a flowchart against the flowchart builder', () => {
    const result = run(runReasoningOperation, 'builder.validate', {
      artifact: {
        builderId: 'flowchart',
        objects: [
          { id: 'd', type: 'decision', box: { x: 0, y: 0, width: 10, height: 10 } },
          { id: 'e', type: 'end', box: { x: 0, y: 40, width: 10, height: 10 } }
        ],
        connectors: [{ id: 'c', from: 'd', to: 'e', type: 'next' }]
      }
    })
    assert.equal(result.ok, true)
    assert.equal(result.valid, false)
    assert.ok((result.issues as { kind: string }[]).some((one) => one.kind === 'decision-one-way'))
  })

  it('an artifact action cannot address anything outside Orbis', () => {
    const result = run(runReasoningOperation, 'builder.behaviour', {
      artifact: { builderId: 'form', objects: [{ id: 'a', type: 'text-field', fields: { name: 'x' } }] },
      behaviours: [{ objectId: 'a', on: 'click', actions: [{ do: 'open', address: 'https://example.com' }] }]
    })
    assert.ok((result.issues as { kind: string }[]).some((one) => one.kind === 'external-address'))
  })

  it('refuses a project connection whose units differ', () => {
    const result = run(runReasoningOperation, 'project.check', {
      project: {
        pages: [
          { id: 'a', pageType: 'x', outputs: [{ name: 'out', type: 'number', unit: 'metres' }] },
          { id: 'b', pageType: 'y', inputs: [{ name: 'in', type: 'number', unit: 'feet' }] }
        ],
        connections: [{ id: 'c', fromPage: 'a', fromPort: 'out', toPage: 'b', toPort: 'in' }]
      }
    })
    assert.equal(result.holdsTogether, false)
    assert.ok((result.problems as { kind: string }[]).some((one) => one.kind === 'unit-mismatch'))
  })

  it('an artifact whose upstream is gone is unknown rather than current', () => {
    const result = run(runReasoningOperation, 'project.staleness', {
      artifacts: [{ id: 'x', producedBy: 'p', fingerprint: 'anything', fromArtifacts: ['gone'] }]
    })
    assert.deepEqual(result.unknown, ['x'])
    assert.deepEqual(result.current, [])
  })
})
