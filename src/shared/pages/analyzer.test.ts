import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  ANALYZER_ASSUMPTIONS,
  ANALYZER_LIMITS,
  assessQuality,
  cacheKey,
  checkFinding,
  checkFreshness,
  compareResults,
  emptyRegistry,
  handoff,
  isAnalyzerError,
  planAnalysis,
  register,
  selectAnalyzers,
  summariseFindings,
  type AnalysisInput,
  type AnalysisResult,
  type Analyzer,
  type ColumnFacts,
  type Finding,
  type Registry
} from './analyzer.ts'

const analyzer = (id: string, options: Partial<Analyzer> = {}): Analyzer => ({
  id,
  name: options.name ?? id,
  version: options.version ?? '1',
  accepts: options.accepts ?? ['table'],
  requires: options.requires ?? [],
  cost: options.cost ?? { perRow: 1, fixed: 10 },
  produces: options.produces ?? 'computed',
  describe: options.describe ?? 'does something'
})

const input = (options: Partial<AnalysisInput> = {}): AnalysisInput => ({
  id: options.id ?? 'i1',
  kind: options.kind ?? 'table',
  name: options.name ?? 'data.csv',
  contentHash: options.contentHash ?? 'abc123',
  version: options.version ?? 1,
  bytes: options.bytes ?? 1000,
  source: options.source ?? 'local',
  shape: options.shape ?? { rows: 100, columns: 4 }
})

const finding = (options: Partial<Finding> = {}): Finding => ({
  id: options.id ?? 'f1',
  analyzerId: options.analyzerId ?? 'a1',
  type: options.type ?? 'outlier',
  severity: options.severity ?? 'notice',
  summary: options.summary ?? 'Something was found',
  certainty: options.certainty ?? 'computed',
  evidence: options.evidence ?? [{ kind: 'rows', ids: [1, 2] }],
  method: options.method ?? 'IQR',
  suggestion: options.suggestion ?? '',
  assumptions: options.assumptions ?? []
})

const result = (options: Partial<AnalysisResult> = {}): AnalysisResult => ({
  id: options.id ?? 'r1',
  analyzerId: options.analyzerId ?? 'a1',
  analyzerVersion: options.analyzerVersion ?? '1',
  inputId: options.inputId ?? 'i1',
  inputVersion: options.inputVersion ?? 1,
  inputHash: options.inputHash ?? 'abc123',
  findings: options.findings ?? [],
  measurements: options.measurements ?? { mean: 5 },
  configuration: options.configuration ?? { method: 'iqr' },
  status: options.status ?? 'complete',
  error: options.error ?? '',
  calls: options.calls ?? 1
})

const registry = (...analyzers: Analyzer[]): Registry => {
  let one = emptyRegistry()
  for (const a of analyzers) {
    const next = register(one, a)
    if (isAnalyzerError(next)) throw new Error(next.message)
    one = next
  }
  return one
}

describe('the registry', () => {
  test('a duplicate id is refused with something to do about it', () => {
    const one = registry(analyzer('a'))
    const result2 = register(one, analyzer('a'))
    assert.ok(isAnalyzerError(result2))
    assert.match(result2.recovery, /different id/)
  })

  test('an analyzer that accepts nothing is refused, because it could never run', () => {
    const result2 = register(emptyRegistry(), analyzer('a', { accepts: [] }))
    assert.ok(isAnalyzerError(result2))
    assert.match(result2.message, /could never run/)
  })

  test('analyzers are selected by input kind', () => {
    const one = registry(analyzer('table', { accepts: ['table'] }), analyzer('text', { accepts: ['text'] }))
    const selection = selectAnalyzers(one, input(), new Set())
    assert.deepEqual(selection.chosen.map((a) => a.id), ['table'])
    assert.deepEqual(selection.inapplicable.map((a) => a.id), ['text'])
  })

  test('an analyzer whose engine is missing is named rather than quietly skipped', () => {
    const one = registry(analyzer('needs', { requires: ['statistics.summarise'] }))
    const selection = selectAnalyzers(one, input(), new Set())
    assert.equal(selection.chosen.length, 0)
    assert.deepEqual(selection.unavailable[0].missing, ['statistics.summarise'])
    assert.match(selection.describe, /not available/)
  })

  test('an analyzer whose engine is present is chosen', () => {
    const one = registry(analyzer('needs', { requires: ['statistics.summarise'] }))
    const selection = selectAnalyzers(one, input(), new Set(['statistics.summarise']))
    assert.equal(selection.chosen.length, 1)
  })
})

describe('planning', () => {
  test('a plan is produced before anything runs, with the cost from declarations', () => {
    const plan = planAnalysis(input(), [analyzer('a', { cost: { perRow: 2, fixed: 50 } })])
    assert.ok(!isAnalyzerError(plan))
    assert.equal(plan.estimatedCalls, 50 + 2 * 100)
    assert.ok(plan.notes.some((one) => /not from a measurement/.test(one)))
  })

  test('stages are ordered by their dependencies', () => {
    const plan = planAnalysis(input(), [analyzer('second'), analyzer('first')], new Map([['second', ['first']]]))
    assert.ok(!isAnalyzerError(plan))
    assert.deepEqual(plan.stages.map((one) => one.analyzerId), ['first', 'second'])
  })

  test('a circular dependency is refused before anything runs', () => {
    const plan = planAnalysis(input(), [analyzer('a'), analyzer('b')], new Map([['a', ['b']], ['b', ['a']]]))
    assert.ok(isAnalyzerError(plan))
    assert.match(plan.message, /circle/)
  })

  test('a heavy plan is flagged as worth confirming', () => {
    const plan = planAnalysis(input({ shape: { rows: 1_000_000 } }), [analyzer('a', { cost: { perRow: 100, fixed: 0 } })])
    assert.ok(!isAnalyzerError(plan))
    assert.equal(plan.heavy, true)
    assert.ok(plan.notes.some((one) => /worth confirming/.test(one)))
  })

  test('an empty plan is refused', () => {
    assert.ok(isAnalyzerError(planAnalysis(input(), [])))
  })
})

describe('findings', () => {
  test('a finding with no evidence is not a finding', () => {
    const check = checkFinding(finding({ evidence: [] }))
    assert.equal(check.ok, false)
    assert.ok(check.problems.some((one) => /it is an assertion/.test(one)))
  })

  test('a finding with no method is refused, because it cannot be argued with', () => {
    const check = checkFinding(finding({ method: '' }))
    assert.equal(check.ok, false)
    assert.ok(check.problems.some((one) => /cannot be argued with or reproduced/.test(one)))
  })

  test('an interpretation cannot be the highest severity on its own', () => {
    const check = checkFinding(finding({ certainty: 'interpreted', severity: 'critical' }))
    assert.equal(check.ok, false)
    assert.ok(check.problems.some((one) => /can be wrong in a way a measurement cannot/.test(one)))
  })

  test('a well-formed finding passes', () => {
    assert.equal(checkFinding(finding()).ok, true)
  })

  test('findings that fail their check are kept out and reported', () => {
    const summary = summariseFindings([finding(), finding({ id: 'f2', evidence: [] })])
    assert.equal(summary.total, 1)
    assert.equal(summary.rejected.length, 1)
    assert.ok(summary.notes.some((one) => /kept out/.test(one)))
  })

  test('interpretations are counted separately and called out', () => {
    const summary = summariseFindings([finding({ certainty: 'interpreted', severity: 'notice' }), finding({ id: 'f2' })])
    assert.equal(summary.byCertainty.interpreted, 1)
    assert.ok(summary.notes.some((one) => /can be wrong in a way a count cannot/.test(one)))
  })

  test('finding nothing is the result rather than a gap to fill', () => {
    const summary = summariseFindings([])
    assert.equal(summary.total, 0)
    assert.ok(summary.notes.some((one) => /no finding was invented/.test(one)))
  })

  test('nothing above a notice is not a statement that the data is fine', () => {
    const summary = summariseFindings([finding({ severity: 'info' })])
    assert.ok(summary.notes.some((one) => /not a statement that the data is fine/.test(one)))
  })

  test('findings are counted by severity and analyzer', () => {
    const summary = summariseFindings([
      finding({ id: 'f1', severity: 'warning', analyzerId: 'a' }),
      finding({ id: 'f2', severity: 'warning', analyzerId: 'b' }),
      finding({ id: 'f3', severity: 'info', analyzerId: 'a' })
    ])
    assert.equal(summary.bySeverity.warning, 2)
    assert.equal(summary.byAnalyzer.a, 2)
  })
})

describe('freshness', () => {
  test('nothing changed means current and reproducible', () => {
    const report = checkFreshness(result(), input(), analyzer('a1'), { method: 'iqr' })
    assert.equal(report.freshness, 'current')
    assert.equal(report.reproducible, true)
  })

  test('a changed input is stale, and says why it is hard to notice', () => {
    const report = checkFreshness(result(), input({ contentHash: 'different' }), analyzer('a1'), { method: 'iqr' })
    assert.equal(report.freshness, 'stale-input')
    assert.match(report.describe, /looks exactly like a chart of the current data/)
  })

  test('a changed analyzer version is its own kind of stale', () => {
    const report = checkFreshness(result(), input(), analyzer('a1', { version: '2' }), { method: 'iqr' })
    assert.equal(report.freshness, 'stale-analyzer')
    assert.match(report.describe, /not directly comparable/)
  })

  test('changed settings mean it answers a different question', () => {
    const report = checkFreshness(result(), input(), analyzer('a1'), { method: 'z-score' })
    assert.equal(report.freshness, 'stale-configuration')
    assert.match(report.describe, /different question/)
  })

  test('a cache key changes when anything it depends on changes', () => {
    const base = cacheKey('h', 'a', '1', { method: 'iqr' })
    assert.notEqual(base, cacheKey('other', 'a', '1', { method: 'iqr' }))
    assert.notEqual(base, cacheKey('h', 'a', '2', { method: 'iqr' }))
    assert.notEqual(base, cacheKey('h', 'a', '1', { method: 'z' }))
    assert.equal(base, cacheKey('h', 'a', '1', { method: 'iqr' }))
  })

  test('the cache key does not depend on the order of the settings', () => {
    assert.equal(cacheKey('h', 'a', '1', { x: '1', y: '2' }), cacheKey('h', 'a', '1', { y: '2', x: '1' }))
  })
})

describe('comparing results', () => {
  test('identical inputs giving different numbers is a finding about the tool', () => {
    const difference = compareResults(result({ measurements: { mean: 5 } }), result({ id: 'r2', measurements: { mean: 6 } }))
    assert.equal(difference.shouldMatch, true)
    assert.equal(difference.measurementsChanged.length, 1)
    assert.ok(difference.notes.some((one) => /outside the recorded configuration/.test(one)))
  })

  test('a different input version explains the difference', () => {
    const difference = compareResults(result(), result({ id: 'r2', inputHash: 'other', measurements: { mean: 9 } }))
    assert.equal(difference.shouldMatch, false)
    assert.ok(difference.notes.some((one) => /about the data rather than about the analysis/.test(one)))
  })

  test('a changed configuration with identical numbers is pointed out too', () => {
    const difference = compareResults(result(), result({ id: 'r2', configuration: { method: 'z' } }))
    assert.ok(difference.notes.some((one) => /does not reach these measurements/.test(one)))
  })

  test('added and removed findings are reported', () => {
    const difference = compareResults(result({ findings: [finding({ id: 'f1' })] }), result({ id: 'r2', findings: [finding({ id: 'f2' })] }))
    assert.deepEqual(difference.findingsAdded, ['f2'])
    assert.deepEqual(difference.findingsRemoved, ['f1'])
  })
})

describe('data quality', () => {
  const column = (name: string, options: Partial<ColumnFacts> = {}): ColumnFacts => ({
    name,
    present: options.present ?? 100,
    missing: options.missing ?? 0,
    distinct: options.distinct ?? 50,
    duplicated: options.duplicated ?? 0,
    types: options.types ?? { number: 100 },
    numeric: options.numeric ?? null
  })

  test('missing values are reported with their share', () => {
    const profile = assessQuality(100, [column('price', { present: 40, missing: 60 })])
    const issue = profile.issues.find((one) => one.kind === 'missing')
    assert.ok(issue)
    assert.equal(issue.count, 60)
    assert.ok(Math.abs(issue.share - 0.6) < 1e-12)
    assert.match(issue.suggestion, /describes the minority that is present/)
  })

  test('a mostly-present column gets the other suggestion', () => {
    const profile = assessQuality(100, [column('price', { present: 95, missing: 5 })])
    const issue = profile.issues.find((one) => one.kind === 'missing')
    assert.match(issue?.suggestion ?? '', /Leaving it out and treating it as zero give different answers/)
  })

  test('a constant column is reported as explaining no variation', () => {
    const profile = assessQuality(100, [column('country', { distinct: 1 })])
    const issue = profile.issues.find((one) => one.kind === 'constant')
    assert.ok(issue)
    assert.match(issue.suggestion, /cannot explain any variation/)
  })

  test('mixed types name the minority, which is what to look at', () => {
    const profile = assessQuality(100, [column('age', { types: { number: 97, text: 3 } })])
    const issue = profile.issues.find((one) => one.kind === 'type-mixed')
    assert.ok(issue)
    assert.equal(issue.count, 3)
    assert.match(issue.describe, /97 number, 3 text/)
  })

  test('a column where every value is unique is recognised as an identifier', () => {
    const profile = assessQuality(100, [column('id', { present: 100, distinct: 100 })])
    const issue = profile.issues.find((one) => one.kind === 'high-cardinality')
    assert.ok(issue)
    assert.match(issue.suggestion, /which is not a summary/)
  })

  test('an outlier is not called an error', () => {
    const profile = assessQuality(100, [column('value', { numeric: { min: -500, max: 900, outliers: [3, 17] } })])
    const issue = profile.issues.find((one) => one.kind === 'suspicious-outlier')
    assert.ok(issue)
    assert.match(issue.suggestion, /not automatically an error/)
    assert.deepEqual((issue.evidence as { ids: number[] }).ids, [3, 17])
  })

  test('a clean column is listed, so nothing found is distinguishable from nothing checked', () => {
    const profile = assessQuality(100, [column('fine')])
    assert.deepEqual(profile.clean, ['fine'])
    assert.ok(profile.notes.some((one) => /different from the data being correct/.test(one)))
  })

  test('columns that were not checked are named', () => {
    const profile = assessQuality(100, [column('a'), column('b')], ['a'])
    assert.deepEqual(profile.notChecked, ['b'])
    assert.ok(profile.notes.some((one) => /nothing here says anything about it/.test(one)))
  })
})

describe('handoff', () => {
  test('provenance travels with the payload', () => {
    const packaged = handoff(result(), input(), analyzer('a1'), 'page', { kind: 'table', data: [] })
    assert.equal(packaged.provenance.inputName, 'data.csv')
    assert.equal(packaged.provenance.analyzerVersion, '1')
    assert.equal(packaged.from.resultId, 'r1')
  })

  test('an incomplete analysis says so in the caveats', () => {
    const packaged = handoff(result({ status: 'partial', error: 'ran out of time' }), input(), analyzer('a1'), 'page', { kind: 'table', data: [] })
    assert.ok(packaged.caveats.some((one) => /did not finish/.test(one)))
  })

  test('interpretations in the result are flagged to the receiver', () => {
    const packaged = handoff(
      result({ findings: [finding({ certainty: 'interpreted' }), finding({ id: 'f2' })] }),
      input(),
      analyzer('a1'),
      'page',
      { kind: 'table', data: [] }
    )
    assert.ok(packaged.caveats.some((one) => /interpretations rather than measurements/.test(one)))
  })

  test('the version it came from is always stated', () => {
    const packaged = handoff(result(), input(), analyzer('a1'), 'page', { kind: 'table', data: [] })
    assert.ok(packaged.caveats.some((one) => /describe the earlier version/.test(one)))
  })
})

describe('the assumptions are stated', () => {
  test('the list names the distinctions the Page is built on', () => {
    assert.ok(ANALYZER_ASSUMPTIONS.length >= 8)
    assert.ok(ANALYZER_ASSUMPTIONS.some((one) => /without evidence is an assertion/.test(one)))
    assert.ok(ANALYZER_ASSUMPTIONS.some((one) => /Finding nothing is the result/.test(one)))
    assert.ok(ANALYZER_ASSUMPTIONS.some((one) => /carries its provenance/.test(one)))
  })

  test('the limits are readable numbers rather than magic constants', () => {
    assert.ok(ANALYZER_LIMITS.findings >= 1000)
    assert.ok(ANALYZER_LIMITS.stages >= 8)
  })
})
