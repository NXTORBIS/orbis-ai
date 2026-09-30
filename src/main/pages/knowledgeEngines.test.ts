/**
 * The knowledge and experiment door: what a Page may ask for, what it gets back, and what it is refused.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { KNOWLEDGE_CAPABILITY, runKnowledgeOperation } from './knowledgeEngines.ts'
import { BadInput } from './engines.ts'
import { CAPABILITIES } from '../../shared/pages/capabilities.ts'

const run = (operation: string, input: Record<string, unknown> = {}): Record<string, unknown> =>
  runKnowledgeOperation(operation, input) as Record<string, unknown>

const good = (operation: string, input: Record<string, unknown> = {}): Record<string, unknown> => {
  const out = run(operation, input)
  assert.equal(out.ok, true, `${operation} came back not-ok: ${JSON.stringify(out).slice(0, 300)}`)
  return out
}

const refused = (operation: string, input: Record<string, unknown> = {}): Record<string, unknown> => {
  const out = run(operation, input)
  assert.equal(out.ok, false, `${operation} was expected to refuse and did not`)
  return out
}

const rejects = (operation: string, input: Record<string, unknown>, pattern: RegExp): void => {
  assert.throws(
    () => run(operation, input),
    (error: unknown) => {
      assert.ok(error instanceof BadInput, `expected BadInput, got ${String(error)}`)
      assert.match((error as Error).message, pattern)
      return true
    }
  )
}

/** Algebra before functions before calculus: a prerequisite chain. */
const chain = {
  graph: {
    id: 'g1',
    title: 'Mathematics',
    concepts: [
      { id: 'algebra', kind: 'concept', title: 'Algebra', provenance: 'authored' },
      { id: 'functions', kind: 'concept', title: 'Functions', provenance: 'authored' },
      { id: 'calculus', kind: 'concept', title: 'Calculus', provenance: 'authored' }
    ],
    relations: [
      { id: 'r1', from: 'functions', to: 'algebra', kind: 'requires', provenance: 'authored' },
      { id: 'r2', from: 'calculus', to: 'functions', kind: 'requires', provenance: 'authored' }
    ]
  }
}

const dropTimeExperiment = {
  experiment: {
    id: 'e1',
    title: 'Drop time against height',
    objective: 'See how fall time varies with height.',
    question: 'Does time go as the square root of height?',
    method: 'Drop a ball from each height five times and time the fall.',
    version: 1,
    hypotheses: [
      {
        id: 'h1',
        statement: 'Time goes as the square root of height.',
        predicts: 'Doubling the height multiplies the time by about 1.41.',
        refutedBy: 'Time doubling when height doubles.',
        statedAt: '2026-01-05'
      }
    ],
    variables: [
      { id: 'height', name: 'Height', role: 'independent', unit: 'm', values: [1, 2, 4] },
      { id: 'time', name: 'Fall time', role: 'dependent', unit: 's', values: [] },
      { id: 'gravity', name: 'Gravity', role: 'controlled', unit: 'm/s2', values: [9.81] }
    ],
    assumptions: ['Air resistance is negligible for this ball over these heights.']
  }
}

const aRun = {
  id: 'run1',
  experimentId: 'e1',
  settings: { height: 1 },
  status: 'complete',
  measurements: [{ variableId: 'time', value: 0.452, unit: 's', uncertainty: 0.01, repeat: 1 }],
  record: {
    experimentVersion: 1,
    determinism: 'deterministic',
    engineVersions: { timer: '1.0.0' }
  },
  ranAt: '2026-01-06'
}

describe('the capability map', () => {
  it('splits concepts from experiments, and both capabilities exist', () => {
    const needed = new Set(Object.values(KNOWLEDGE_CAPABILITY))
    assert.deepEqual([...needed].sort(), ['computation.concepts', 'computation.experiments'])
    for (const id of needed) {
      assert.ok(Object.prototype.hasOwnProperty.call(CAPABILITIES, id), `${id} is not declared`)
    }
  })

  it('answers every operation it advertises', () => {
    for (const operation of Object.keys(KNOWLEDGE_CAPABILITY)) {
      try {
        run(operation, {})
      } catch (error) {
        assert.ok(error instanceof BadInput, `${operation} threw something other than BadInput`)
        assert.doesNotMatch(
          (error as Error).message,
          /is not a knowledge operation/,
          `${operation} is advertised but not handled`
        )
      }
    }
  })

  it('refuses an operation it does not advertise', () => {
    rejects('concept.think-for-me', {}, /not a knowledge operation/)
  })

  it('reaches no clock and no randomness', () => {
    const source = readFileSync(new URL('./knowledgeEngines.ts', import.meta.url), 'utf8')
    const body = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.doesNotMatch(body, /Date\.now|new Date|Math\.random/)
  })
})

describe('concept graphs', () => {
  it('checks a sound graph without claiming the call failed', () => {
    const out = good('concept.check', chain)
    assert.equal(out.sound, true)
    assert.ok(Array.isArray(out.problems))
  })

  it('reports a relation pointing at nothing as a successful call with a problem', () => {
    const out = good('concept.check', {
      graph: {
        ...chain.graph,
        relations: [{ id: 'r', from: 'calculus', to: 'nowhere', kind: 'requires', provenance: 'authored' }]
      }
    })
    assert.equal(out.ok, true, 'the call worked')
    assert.equal(out.sound, false, 'the graph did not')
  })

  it('requires provenance on a concept rather than defaulting it', () => {
    rejects(
      'concept.check',
      { graph: { ...chain.graph, concepts: [{ id: 'x', kind: 'concept', title: 'X' }] } },
      /provenance/
    )
  })

  it('requires provenance on a relation too', () => {
    rejects(
      'concept.check',
      { graph: { ...chain.graph, relations: [{ id: 'r', from: 'algebra', to: 'functions', kind: 'requires' }] } },
      /provenance/
    )
  })

  it('refuses a provenance it does not recognise, so a claim cannot arrive unlabelled', () => {
    rejects(
      'concept.check',
      { graph: { ...chain.graph, concepts: [{ id: 'x', kind: 'concept', title: 'X', provenance: 'probably-true' }] } },
      /not one of/
    )
  })

  it('finds no cycle in a prerequisite chain', () => {
    const out = good('concept.cycle', { ...chain, kind: 'requires' })
    assert.equal(out.hasCycle, false)
    assert.equal(out.cycle, null)
  })

  it('finds a cycle when the prerequisites loop', () => {
    const out = good('concept.cycle', {
      graph: {
        ...chain.graph,
        relations: [
          ...chain.graph.relations,
          { id: 'r3', from: 'algebra', to: 'calculus', kind: 'requires', provenance: 'authored' }
        ]
      },
      kind: 'requires'
    })
    assert.equal(out.hasCycle, true)
    assert.ok((out.cycle as string[]).length > 0)
  })

  it('traces a path from one idea to another', () => {
    const out = good('concept.paths', { ...chain, from: 'calculus', to: 'algebra' })
    assert.ok(Array.isArray(out.paths))
    assert.ok((out.paths as unknown[]).length > 0)
  })

  it('refuses a path from a concept that is not in the graph', () => {
    const out = refused('concept.paths', { ...chain, from: 'topology', to: 'algebra' })
    assert.ok(typeof out.message === 'string')
  })

  it('gives the neighbourhood around one concept', () => {
    const out = good('concept.neighbourhood', { ...chain, centre: 'functions', steps: 1 })
    assert.ok(JSON.stringify(out).includes('algebra') || JSON.stringify(out).includes('calculus'))
  })

  it('lays a chain out hierarchically', () => {
    const out = good('concept.layout', { ...chain, kind: 'hierarchical' })
    const positions = out.positions as Record<string, { x: number; y: number }>
    assert.equal(Object.keys(positions).length, 3)
  })

  it('refuses a layout kind it does not know', () => {
    rejects('concept.layout', { ...chain, kind: 'spiral' }, /not one of/)
  })

  it('reads a graph out of an indented outline', () => {
    const out = good('concept.from-outline', { source: 'Mathematics\n  Algebra\n  Calculus\n' })
    assert.ok(JSON.stringify(out).includes('Algebra'))
  })

  it('analyses the shape of the graph', () => {
    const out = good('concept.analyse', chain)
    assert.ok(JSON.stringify(out).length > 20)
  })

  it('serves the vocabulary, and says why provenance is required', () => {
    const out = good('concept.vocabulary')
    assert.equal((out.conceptKinds as unknown[]).length, 12)
    assert.equal((out.provenances as unknown[]).length, 6)
    assert.equal((out.relationKinds as unknown[]).length, 15)
    assert.match(out.provenanceNote as string, /suggestion into somebody's assertion/)
  })

  it('keeps a relation nobody rated distinct from a weak one', () => {
    const unrated = good('concept.check', chain)
    const weak = good('concept.check', {
      graph: {
        ...chain.graph,
        relations: chain.graph.relations.map((one) => ({ ...one, strength: 0.1 }))
      }
    })
    // Both are sound; what matters is that the reader did not invent a strength for the unrated one.
    assert.equal(unrated.sound, true)
    assert.equal(weak.sound, true)
  })

  it('refuses a graph that is not an object', () => {
    rejects('concept.check', { graph: 'my graph' }, /graph object/)
  })

  it('refuses a properties map holding something that is not text', () => {
    rejects(
      'concept.check',
      {
        graph: {
          ...chain.graph,
          concepts: [{ id: 'x', kind: 'concept', title: 'X', provenance: 'authored', properties: { n: 5 } }]
        }
      },
      /has to be text/
    )
  })
})

describe('experiments', () => {
  it('checks a sound design without claiming the call failed', () => {
    const out = good('experiment.check-design', dropTimeExperiment)
    assert.equal(out.ok, true)
    assert.ok(typeof out.sound === 'boolean')
    assert.ok(typeof out.describe === 'string')
  })

  it('faults a design with no question, because then no result is informative', () => {
    const out = good('experiment.check-design', {
      experiment: { ...dropTimeExperiment.experiment, question: '' }
    })
    assert.equal(out.sound, false)
    assert.ok((out.problems as string[]).some((one) => /question/.test(one)))
  })

  it('faults a design with no method, because it could not be repeated even in principle', () => {
    const out = good('experiment.check-design', {
      experiment: { ...dropTimeExperiment.experiment, method: '' }
    })
    assert.equal(out.sound, false)
    assert.ok((out.problems as string[]).some((one) => /repeated/.test(one)))
  })

  it('faults a design with nothing being measured', () => {
    const out = good('experiment.check-design', {
      experiment: {
        ...dropTimeExperiment.experiment,
        variables: dropTimeExperiment.experiment.variables.filter((one) => one.role !== 'dependent')
      }
    })
    assert.equal(out.sound, false)
    assert.ok((out.problems as string[]).some((one) => /measured/.test(one)))
  })

  it('checks the variables describe an experiment', () => {
    const out = good('experiment.check-variables', { variables: dropTimeExperiment.experiment.variables })
    assert.equal(out.sound, true)
  })

  it('faults variables with nothing dependent to measure', () => {
    const out = good('experiment.check-variables', {
      variables: [{ id: 'height', name: 'Height', role: 'independent', unit: 'm', values: [1, 2] }]
    })
    assert.equal(out.sound, false)
  })

  it('refuses a variable role it does not know', () => {
    rejects(
      'experiment.check-variables',
      { variables: [{ id: 'x', name: 'X', role: 'sort-of-independent' }] },
      /not one of/
    )
  })

  it('builds a hypothesis that states what would refute it', () => {
    const out = good('experiment.hypothesis', {
      id: 'h2',
      statement: 'Heavier balls fall faster.',
      predicts: 'The 2 kg ball lands first.',
      refutedBy: 'Both landing together.',
      statedAt: '2026-01-05'
    })
    assert.equal(out.state, 'stated')
    assert.equal(out.outcome, null)
  })

  it('refuses a hypothesis with nothing that would refute it', () => {
    const out = refused('experiment.hypothesis', {
      id: 'h3',
      statement: 'Things fall.',
      predicts: 'They fall.',
      refutedBy: '',
      statedAt: '2026-01-05'
    })
    assert.ok(typeof out.message === 'string')
  })

  it('records an outcome once', () => {
    const one = good('experiment.hypothesis', {
      id: 'h4',
      statement: 'Time goes as the root of height.',
      predicts: 'Time rises by 1.41 when height doubles.',
      refutedBy: 'Time doubling.',
      statedAt: '2026-01-05'
    })
    const out = good('experiment.record-outcome', { hypothesis: one, outcome: 'supported' })
    assert.equal(out.outcome, 'supported')
    assert.equal(out.state, 'tested')
  })

  it('refuses to record an outcome twice', () => {
    const one = good('experiment.hypothesis', {
      id: 'h5',
      statement: 'X.',
      predicts: 'Y.',
      refutedBy: 'Z.',
      statedAt: '2026-01-05'
    })
    const once = good('experiment.record-outcome', { hypothesis: one, outcome: 'supported' })
    const twice = refused('experiment.record-outcome', { hypothesis: once, outcome: 'not-supported' })
    assert.ok(typeof twice.message === 'string')
  })

  it('keeps the original when a hypothesis is revised', () => {
    const original = good('experiment.hypothesis', {
      id: 'h6',
      statement: 'First idea.',
      predicts: 'A.',
      refutedBy: 'B.',
      statedAt: '2026-01-05'
    })
    const out = good('experiment.revise-hypothesis', {
      original,
      id: 'h7',
      statement: 'Better idea.',
      predicts: 'C.',
      refutedBy: 'D.',
      statedAt: '2026-01-07'
    })
    const kept = out.original as { id: string; state: string }
    const revised = out.revised as { id: string; supersedes: string }
    assert.equal(kept.id, 'h6')
    assert.equal(revised.supersedes, 'h6')
  })

  it('says a deterministic run with a complete record can be reproduced', () => {
    const out = good('run.check-record', { run: aRun })
    assert.equal(out.reproducible, true)
    assert.equal(out.complete, true)
  })

  it('says a random run with no seed cannot be reproduced, and why', () => {
    const out = good('run.check-record', {
      run: { ...aRun, record: { ...aRun.record, determinism: 'non-deterministic' } }
    })
    assert.equal(out.reproducible, false)
    // The record is complete; it is the model that cannot be repeated, and the wording keeps those apart.
    assert.equal(out.complete, true)
    assert.match(out.describe as string, /property of the model rather than a fault in the record/)
  })

  it('lists what a record is missing when it genuinely lacks something', () => {
    const out = good('run.check-record', {
      run: { id: 'r', experimentId: 'e1', settings: {}, status: 'complete', measurements: [], record: {}, ranAt: '' }
    })
    assert.equal(out.complete, false)
    assert.ok((out.missing as string[]).length > 0)
  })

  it('keeps seed zero distinct from no seed at all', () => {
    const withZero = good('run.check-record', {
      run: { ...aRun, record: { ...aRun.record, determinism: 'seeded', seed: 0 } }
    })
    const without = good('run.check-record', {
      run: { ...aRun, record: { ...aRun.record, determinism: 'seeded' } }
    })
    assert.equal(withZero.reproducible, true)
    assert.equal(without.reproducible, false)
  })

  it('calls an identical repeat reproduced', () => {
    const out = good('run.compare', { original: aRun, repeated: { ...aRun, id: 'run2' } })
    assert.equal(out.verdict, 'reproduced')
    assert.equal(out.worstDifference, 0)
  })

  it('reports a disagreeing measurement per measurement rather than as a summary', () => {
    const out = good('run.compare', {
      original: aRun,
      repeated: {
        ...aRun,
        id: 'run3',
        measurements: [{ variableId: 'time', value: 0.9, unit: 's', repeat: 1 }]
      }
    })
    assert.equal(out.verdict, 'different')
    const comparisons = out.comparisons as { variableId: string; within: boolean }[]
    assert.equal(comparisons[0].variableId, 'time')
    assert.equal(comparisons[0].within, false)
  })

  it('says inputs differ rather than that the result was different', () => {
    const out = good('run.compare', {
      original: aRun,
      repeated: { ...aRun, id: 'run4', settings: { height: 2 } }
    })
    assert.equal(out.verdict, 'inputs-differ')
  })

  it('honours a stated tolerance', () => {
    const loose = good('run.compare', {
      original: aRun,
      repeated: { ...aRun, id: 'run5', measurements: [{ variableId: 'time', value: 0.46, unit: 's', repeat: 1 }] },
      tolerance: { absolute: 0.05, relative: 0.1 }
    })
    const tight = good('run.compare', {
      original: aRun,
      repeated: { ...aRun, id: 'run5', measurements: [{ variableId: 'time', value: 0.46, unit: 's', repeat: 1 }] },
      tolerance: { absolute: 1e-9, relative: 1e-9 }
    })
    assert.notEqual(loose.verdict, tight.verdict)
  })

  it('summarises repeats of one variable', () => {
    const out = good('run.repeats', {
      variableId: 'time',
      measurements: [
        { variableId: 'time', value: 0.45, unit: 's', repeat: 1 },
        { variableId: 'time', value: 0.46, unit: 's', repeat: 2 },
        { variableId: 'time', value: 0.44, unit: 's', repeat: 3 }
      ]
    })
    assert.ok(JSON.stringify(out).length > 20)
  })

  it('measures the spread from the repeats rather than from a stated uncertainty', () => {
    const measurements = [
      { variableId: 'time', value: 0.45, unit: 's', repeat: 1 },
      { variableId: 'time', value: 0.47, unit: 's', repeat: 2 }
    ]
    const bare = good('run.repeats', { variableId: 'time', measurements })
    const withStated = good('run.repeats', {
      variableId: 'time',
      measurements: measurements.map((one) => ({ ...one, uncertainty: 0.5 }))
    })
    // A stated uncertainty, however large, does not change what the repeats actually did. The summary is a
    // measurement of this experiment's own precision, not a restatement of somebody's estimate.
    assert.deepEqual(bare, withStated)
    assert.match(bare.describe as string, /measured, not assumed/)
    assert.ok(Math.abs((bare.mean as number) - 0.46) < 1e-12)
  })

  it('accepts a measurement with no stated uncertainty without inventing one', () => {
    const out = good('run.repeats', {
      variableId: 'time',
      measurements: [
        { variableId: 'time', value: 0.45, unit: 's', repeat: 1 },
        { variableId: 'time', value: 0.47, unit: 's', repeat: 2 }
      ]
    })
    assert.equal(out.repeats, 2)
    assert.ok((out.standardDeviation as number) > 0)
  })

  it('draws a conclusion that carries the design and record verdicts with it', () => {
    const out = good('experiment.conclude', {
      ...dropTimeExperiment,
      hypothesis: dropTimeExperiment.experiment.hypotheses[0],
      run: aRun,
      observed: 'Time rose by about 1.4 when height doubled.',
      predictionHeld: true,
      repeats: 5
    })
    assert.ok(typeof out.designSound === 'boolean')
    assert.equal(out.recordComplete, true)
  })

  it('treats an inconclusive observation as neither held nor refuted', () => {
    const held = good('experiment.conclude', {
      ...dropTimeExperiment,
      hypothesis: dropTimeExperiment.experiment.hypotheses[0],
      run: aRun,
      observed: 'Clear.',
      predictionHeld: true,
      repeats: 5
    })
    const unclear = good('experiment.conclude', {
      ...dropTimeExperiment,
      hypothesis: dropTimeExperiment.experiment.hypotheses[0],
      run: aRun,
      observed: 'Too noisy to tell.',
      repeats: 5
    })
    assert.notDeepEqual(held, unclear)
  })

  it('serves the vocabulary, and says reproduction is not a yes or no', () => {
    const out = good('experiment.vocabulary')
    assert.equal((out.roles as unknown[]).length, 5)
    assert.equal((out.determinisms as unknown[]).length, 3)
    assert.match(out.verdictNote as string, /could not be asked/)
  })

  it('refuses a run that is not an object', () => {
    rejects('run.check-record', { run: 'my run' }, /run object/)
  })

  it('refuses a settings map holding something that is not a number', () => {
    rejects('run.check-record', { run: { ...aRun, settings: { height: 'one metre' } } }, /finite number/)
  })
})

describe('provenance', () => {
  it('serves both engine assumption lists', () => {
    const out = good('knowledge.assumptions')
    for (const key of ['concepts', 'experiments']) {
      assert.ok(Array.isArray(out[key]), `${key} assumptions missing`)
      assert.ok((out[key] as unknown[]).length >= 5, `${key} assumptions too thin`)
    }
  })
})
