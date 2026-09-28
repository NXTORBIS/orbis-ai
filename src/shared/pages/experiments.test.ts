import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  EXPERIMENT_ASSUMPTIONS,
  checkDesign,
  checkRecord,
  checkVariables,
  compareRuns,
  concludeFrom,
  hypothesis,
  isExperimentError,
  recordOutcome,
  reviseHypothesis,
  summariseRepeats,
  type Experiment,
  type Hypothesis,
  type Measurement,
  type Run,
  type Variable
} from './experiments.ts'

const variable = (id: string, role: Variable['role'], options: Partial<Variable> = {}): Variable => ({
  id,
  name: options.name ?? id,
  role,
  unit: options.unit ?? '',
  values: options.values ?? (role === 'independent' ? [1, 2, 3] : role === 'controlled' ? [1] : []),
  from: options.from ?? [],
  describe: options.describe ?? ''
})

const stated = (): Hypothesis => {
  const one = hypothesis('h1', 'Period grows with the square root of length', 'Period against square root of length is a straight line', 'A clearly curved relationship', '2026-01-01')
  if (isExperimentError(one)) throw new Error(one.message)
  return one
}

const run = (id: string, options: Partial<Run> = {}): Run => ({
  id,
  experimentId: options.experimentId ?? 'e1',
  settings: options.settings ?? { length: 1 },
  measurements: options.measurements ?? [{ variableId: 'period', value: 2, unit: 's', uncertainty: null, repeat: 1 }],
  status: options.status ?? 'complete',
  error: options.error ?? '',
  record: options.record ?? {
    experimentVersion: 1,
    engineVersions: { simulation: '1' },
    seed: 42,
    determinism: 'seeded',
    datasetHashes: {},
    externalData: []
  },
  ranAt: options.ranAt ?? '2026-01-01T00:00:00Z'
})

describe('variables', () => {
  test('a controlled variable with several values is not controlled', () => {
    const check = checkVariables([variable('t', 'controlled', { values: [1, 2] }), variable('x', 'independent'), variable('y', 'dependent')])
    assert.equal(check.ok, false)
    assert.ok(check.problems.some((one) => /if it varies, it is independent/.test(one)))
  })

  test('an independent variable with one value is not being varied', () => {
    const check = checkVariables([variable('x', 'independent', { values: [1] }), variable('y', 'dependent')])
    assert.equal(check.ok, false)
    assert.ok(check.problems.some((one) => /is one that is varied/.test(one)))
  })

  test('nothing measured is not an experiment', () => {
    const check = checkVariables([variable('x', 'independent')])
    assert.equal(check.ok, false)
    assert.ok(check.problems.some((one) => /there is no result/.test(one)))
  })

  test('nothing varied is an observation, which is named as a fine different thing', () => {
    const check = checkVariables([variable('y', 'dependent')])
    assert.equal(check.ok, false)
    assert.ok(check.problems.some((one) => /a fine thing to do, and a different thing/.test(one)))
  })

  test('varying two things at once is noted as confounding unless the design separates them', () => {
    const check = checkVariables([variable('a', 'independent'), variable('b', 'independent'), variable('y', 'dependent')])
    assert.ok(check.notes.some((one) => /effect of the combination/.test(one)))
  })

  test('a derived variable has to say what it is derived from', () => {
    const check = checkVariables([variable('d', 'derived'), variable('x', 'independent'), variable('y', 'dependent')])
    assert.ok(check.problems.some((one) => /does not say what from/.test(one)))
  })

  test('nothing controlled is noted, because it is usually not written down rather than absent', () => {
    const check = checkVariables([variable('x', 'independent'), variable('y', 'dependent')])
    assert.ok(check.notes.some((one) => /the second is much more common/.test(one)))
  })

  test('a nuisance variable is recorded as uncontrolled and known to matter', () => {
    const check = checkVariables([variable('x', 'independent'), variable('y', 'dependent'), variable('n', 'nuisance')])
    assert.ok(check.notes.some((one) => /has to survive it/.test(one)))
  })
})

describe('hypotheses', () => {
  test('a hypothesis with no prediction is refused', () => {
    const one = hypothesis('h', 'Something happens', '', 'anything', '2026-01-01')
    assert.ok(isExperimentError(one))
    assert.match(one.message, /any result can be read as confirming it/)
  })

  test('a hypothesis nothing could refute is refused', () => {
    const one = hypothesis('h', 'Something happens', 'we will see something', '', '2026-01-01')
    assert.ok(isExperimentError(one))
    assert.match(one.message, /only illustrated/)
  })

  test('an outcome can be recorded once', () => {
    const first = recordOutcome(stated(), 'supported')
    assert.ok(!isExperimentError(first))
    assert.equal(first.state, 'tested')
    assert.equal(first.outcome, 'supported')

    const second = recordOutcome(first, 'not-supported')
    assert.ok(isExperimentError(second))
    assert.match(second.message, /state a new hypothesis instead/)
  })

  test('revising a hypothesis creates a new one and keeps the original', () => {
    const result = reviseHypothesis(stated(), 'h2', 'Period grows with length', 'A straight line against length', 'A curve', '2026-01-02')
    assert.ok(!isExperimentError(result))
    assert.equal(result.original.state, 'superseded')
    assert.equal(result.revised.supersedes, 'h1')
    assert.equal(result.original.statement, 'Period grows with the square root of length')
  })

  test('an outcome against a superseded hypothesis is refused', () => {
    const revised = reviseHypothesis(stated(), 'h2', 'x', 'y', 'z', '2026-01-02')
    assert.ok(!isExperimentError(revised))
    assert.ok(isExperimentError(recordOutcome(revised.original, 'supported')))
  })
})

describe('the record', () => {
  test('a complete record is reproducible', () => {
    const check = checkRecord(run('r1'))
    assert.equal(check.complete, true)
    assert.equal(check.reproducible, true)
    assert.match(check.describe, /including seed 42/)
  })

  test('a seeded run with no seed is missing it', () => {
    const check = checkRecord(run('r1', { record: { experimentVersion: 1, engineVersions: { s: '1' }, seed: null, determinism: 'seeded', datasetHashes: {}, externalData: [] } }))
    assert.equal(check.complete, false)
    assert.ok(check.missing.includes('the seed'))
  })

  test('a non-deterministic run says so is a property of the model rather than a fault', () => {
    const check = checkRecord(run('r1', { record: { experimentVersion: 1, engineVersions: { s: '1' }, seed: null, determinism: 'non-deterministic', datasetHashes: {}, externalData: [] } }))
    assert.equal(check.reproducible, false)
    assert.match(check.describe, /rather than a fault in the record/)
  })

  test('a run using live data says a later difference is expected', () => {
    const check = checkRecord(
      run('r1', {
        record: { experimentVersion: 1, engineVersions: { s: '1' }, seed: 1, determinism: 'seeded', datasetHashes: {}, externalData: [{ source: 'an API', retrievedAt: '2026-01-01' }] }
      })
    )
    assert.equal(check.reproducible, false)
    assert.match(check.describe, /expected rather than a discrepancy/)
  })

  test('an unknown determinism is missing information rather than assumed', () => {
    const check = checkRecord(run('r1', { record: { experimentVersion: 1, engineVersions: { s: '1' }, seed: 1, determinism: 'unknown', datasetHashes: {}, externalData: [] } }))
    assert.ok(check.missing.some((one) => /deterministic/.test(one)))
  })
})

describe('reproduction', () => {
  test('identical measurements reproduce exactly', () => {
    const result = compareRuns(run('r1'), run('r2'))
    assert.equal(result.verdict, 'reproduced')
    assert.equal(result.worstDifference, 0)
  })

  test('a tiny difference is numerically equivalent, which is a different claim', () => {
    const result = compareRuns(
      run('r1'),
      run('r2', { measurements: [{ variableId: 'period', value: 2 + 1e-13, unit: 's', uncertainty: null, repeat: 1 }] })
    )
    assert.equal(result.verdict, 'numerically-equivalent')
    assert.match(result.describe, /bit-for-bit identical, which for anything numerical is the wrong thing to ask for/)
  })

  test('a real difference with matching inputs points outside the record', () => {
    const result = compareRuns(
      run('r1'),
      run('r2', { measurements: [{ variableId: 'period', value: 5, unit: 's', uncertainty: null, repeat: 1 }] })
    )
    assert.equal(result.verdict, 'different')
    assert.match(result.describe, /something outside the record is affecting the result/)
  })

  test('different settings mean two different things, not a failed reproduction', () => {
    const result = compareRuns(run('r1'), run('r2', { settings: { length: 2 } }))
    assert.equal(result.verdict, 'inputs-differ')
    assert.match(result.describe, /not a failed reproduction/)
  })

  test('a different engine version is reported as inputs differing', () => {
    const result = compareRuns(
      run('r1'),
      run('r2', { record: { experimentVersion: 1, engineVersions: { simulation: '2' }, seed: 42, determinism: 'seeded', datasetHashes: {}, externalData: [] } })
    )
    assert.equal(result.verdict, 'inputs-differ')
    assert.match(result.describe, /the versions/)
  })

  test('a changed dataset hash is caught', () => {
    const result = compareRuns(
      run('r1', { record: { experimentVersion: 1, engineVersions: { simulation: '1' }, seed: 42, determinism: 'seeded', datasetHashes: { d: 'a' }, externalData: [] } }),
      run('r2', { record: { experimentVersion: 1, engineVersions: { simulation: '1' }, seed: 42, determinism: 'seeded', datasetHashes: { d: 'b' }, externalData: [] } })
    )
    assert.equal(result.verdict, 'inputs-differ')
    assert.match(result.describe, /the input data/)
  })

  test('an unreproducible original cannot be reproduced whatever the numbers say', () => {
    const unreproducible = run('r1', {
      record: { experimentVersion: 1, engineVersions: { simulation: '1' }, seed: null, determinism: 'non-deterministic', datasetHashes: {}, externalData: [] }
    })
    const result = compareRuns(unreproducible, { ...unreproducible, id: 'r2' })
    assert.equal(result.verdict, 'not-reproducible')
  })

  test('each measurement is compared separately, so a single disagreement is findable', () => {
    const result = compareRuns(
      run('r1', {
        measurements: [
          { variableId: 'a', value: 1, unit: '', uncertainty: null, repeat: 1 },
          { variableId: 'b', value: 2, unit: '', uncertainty: null, repeat: 1 }
        ]
      }),
      run('r2', {
        measurements: [
          { variableId: 'a', value: 1, unit: '', uncertainty: null, repeat: 1 },
          { variableId: 'b', value: 9, unit: '', uncertainty: null, repeat: 1 }
        ]
      })
    )
    assert.equal(result.comparisons.length, 2)
    assert.equal(result.comparisons.find((one) => one.variableId === 'a')?.within, true)
    assert.equal(result.comparisons.find((one) => one.variableId === 'b')?.within, false)
  })
})

describe('repeats', () => {
  const measurement = (value: number, repeat: number): Measurement => ({ variableId: 'p', value, unit: 's', uncertainty: null, repeat })

  test('the spread across repeats is the measured precision', () => {
    const summary = summariseRepeats('p', [measurement(2.0, 1), measurement(2.1, 2), measurement(1.9, 3)])
    assert.ok(!isExperimentError(summary))
    assert.equal(summary.repeats, 3)
    assert.ok(Math.abs(summary.mean - 2) < 1e-12)
    assert.ok(summary.standardDeviation > 0)
    assert.match(summary.describe, /measured, not assumed/)
  })

  test('a single reading has no spread, and does not report zero', () => {
    const summary = summariseRepeats('p', [measurement(2, 1)])
    assert.ok(!isExperimentError(summary))
    assert.ok(Number.isNaN(summary.standardDeviation))
    assert.match(summary.describe, /would look confident and mean nothing/)
  })

  test('a variable with no measurements is refused', () => {
    assert.ok(isExperimentError(summariseRepeats('missing', [])))
  })
})

describe('design', () => {
  const experiment = (options: Partial<Experiment> = {}): Experiment => ({
    id: 'e1',
    title: options.title ?? 'Pendulum',
    objective: options.objective ?? 'Find how period varies with length',
    question: options.question ?? 'Does the period depend on the length?',
    hypotheses: options.hypotheses ?? [stated()],
    variables: options.variables ?? [variable('length', 'independent'), variable('period', 'dependent'), variable('mass', 'controlled')],
    method: options.method ?? 'Time twenty swings at each length',
    assumptions: options.assumptions ?? ['The amplitude is small'],
    version: options.version ?? 1
  })

  test('a complete design holds together', () => {
    const check = checkDesign(experiment())
    assert.equal(check.ok, true)
    assert.match(check.describe, /a question, a method/)
  })

  test('no question makes every result interesting and none informative', () => {
    const check = checkDesign(experiment({ question: '' }))
    assert.equal(check.ok, false)
    assert.ok(check.problems.some((one) => /none is informative/.test(one)))
  })

  test('no method means it could not be repeated even in principle', () => {
    const check = checkDesign(experiment({ method: '' }))
    assert.ok(check.problems.some((one) => /even in principle/.test(one)))
  })

  test('no hypothesis is exploratory rather than wrong', () => {
    const check = checkDesign(experiment({ hypotheses: [] }))
    assert.equal(check.ok, true)
    assert.ok(check.notes.some((one) => /only describe/.test(one)))
  })

  test('no recorded assumptions is noted as the usual case rather than an absence', () => {
    const check = checkDesign(experiment({ assumptions: [] }))
    assert.ok(check.notes.some((one) => /the ones nobody writes down are the ones that turn out to matter/.test(one)))
  })

  test('problems are described as unfixable after the run', () => {
    const check = checkDesign(experiment({ question: '' }))
    assert.match(check.describe, /cannot be fixed after the run/)
  })
})

describe('conclusions', () => {
  const design = { ok: true, problems: [], notes: [], describe: '' }
  const record = { complete: true, missing: [], reproducible: true, describe: '' }

  test('a held prediction supports without proving', () => {
    const conclusion = concludeFrom(stated(), 'the plot is straight', true, design, record, 5)
    assert.equal(conclusion.outcome, 'supported')
    assert.match(conclusion.describe, /does not prove it/)
  })

  test('a failed prediction is called the most informative outcome', () => {
    const conclusion = concludeFrom(stated(), 'the plot curves', false, design, record, 5)
    assert.equal(conclusion.outcome, 'not-supported')
    assert.match(conclusion.describe, /most informative outcome an experiment has/)
  })

  test('an inconclusive result is a result about the design', () => {
    const conclusion = concludeFrom(stated(), 'too noisy to tell', null, design, record, 5)
    assert.equal(conclusion.outcome, 'inconclusive')
    assert.match(conclusion.describe, /cannot answer the question/)
  })

  test('a single measurement becomes a limitation', () => {
    const conclusion = concludeFrom(stated(), 'straight', true, design, record, 1)
    assert.ok(conclusion.limitations.some((one) => /say more about the result than a third decimal place/.test(one)))
  })

  test('an unreproducible run becomes a limitation', () => {
    const conclusion = concludeFrom(stated(), 'straight', true, design, { complete: false, missing: ['the seed'], reproducible: false, describe: 'It cannot be reproduced.' }, 5)
    assert.ok(conclusion.limitations.includes('It cannot be reproduced.'))
  })

  test('design problems become limitations on the conclusion', () => {
    const conclusion = concludeFrom(stated(), 'straight', true, { ok: false, problems: ['Nothing was controlled.'], notes: [], describe: '' }, record, 5)
    assert.ok(conclusion.limitations.some((one) => /Nothing was controlled/.test(one)))
  })
})

describe('the assumptions are stated', () => {
  test('the list names the distinctions the Page is built on', () => {
    assert.ok(EXPERIMENT_ASSUMPTIONS.length >= 8)
    assert.ok(EXPERIMENT_ASSUMPTIONS.some((one) => /says in advance/.test(one)))
    assert.ok(EXPERIMENT_ASSUMPTIONS.some((one) => /recorded once/.test(one)))
    assert.ok(EXPERIMENT_ASSUMPTIONS.some((one) => /supported, not proved/.test(one)))
  })
})
