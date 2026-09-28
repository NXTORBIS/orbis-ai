/**
 * The Universal Analyzer: a registry of analyzers, the plan they produce, and findings with their evidence attached.
 *
 * The structure is the point. An analysis is not "look at this and tell me things"; it is a declared input, a chosen
 * set of analyzers, a plan somebody can read before it runs, and findings that each point back at the row, line or
 * span they came from. A finding with no evidence is not a finding, and this file has nowhere to put one.
 *
 * ## Deterministic and interpretive are separate
 *
 * A count is a count. "This dataset looks like sales data" is an interpretation. They are different kinds of claim and
 * they are stored in different fields, because a screen that renders them identically is inviting somebody to act on
 * a guess as though it were a measurement.
 *
 * ## Staleness
 *
 * A result belongs to the exact input version that produced it. Change the input and the results are stale, which is
 * reported rather than left to be noticed -- a chart of last week's data looks exactly like a chart of this week's.
 */

export interface AnalyzerError {
  error: string
  message: string
  recovery: string
}

export const isAnalyzerError = (value: unknown): value is AnalyzerError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value && 'recovery' in value

const fail = (error: string, message: string, recovery: string): AnalyzerError => ({ error, message, recovery })

export const ANALYZER_LIMITS: Readonly<Record<'findings' | 'analyzers' | 'stages' | 'evidence' | 'inputBytes', number>> = Object.freeze({
  findings: 10_000,
  analyzers: 64,
  stages: 32,
  evidence: 500,
  inputBytes: 256 * 1024 * 1024
})

// ---------------------------------------------------------------- inputs

export type InputKind = 'table' | 'text' | 'document' | 'code' | 'equation' | 'measurements' | 'graph' | 'json' | 'unknown'

export interface AnalysisInput {
  id: string
  kind: InputKind
  name: string
  /** A hash of the content. Results are tied to this, which is what makes staleness detectable. */
  contentHash: string
  /** Bumped whenever the content changes, so two versions of the same input are distinguishable. */
  version: number
  bytes: number
  source: string
  /** Shape facts the analyzers can dispatch on, filled in by whoever ingested it. */
  shape: { rows?: number; columns?: number; words?: number; lines?: number; nodes?: number }
}

// ---------------------------------------------------------------- the registry

export type Certainty = 'measured' | 'computed' | 'inferred' | 'interpreted'

export interface Analyzer {
  id: string
  name: string
  version: string
  accepts: InputKind[]
  /** Engine operations this needs. An analyzer whose engine is absent is not offered. */
  requires: string[]
  /** Roughly what it costs, so a plan can be estimated before it runs. */
  cost: { perRow: number; fixed: number }
  /** The strongest kind of claim it can make. An interpretive analyzer can never produce a measurement. */
  produces: Certainty
  describe: string
}

export interface Registry {
  analyzers: Analyzer[]
}

export const emptyRegistry = (): Registry => ({ analyzers: [] })

export function register(registry: Registry, one: Analyzer): Registry | AnalyzerError {
  if (registry.analyzers.some((other) => other.id === one.id)) {
    return fail('duplicate', `There is already an analyzer called "${one.id}".`, 'Give it a different id, or update the existing one.')
  }
  if (registry.analyzers.length >= ANALYZER_LIMITS.analyzers) {
    return fail('too-many', `At most ${ANALYZER_LIMITS.analyzers} analyzers can be registered.`, 'Remove one that is no longer used.')
  }
  if (one.accepts.length === 0) {
    return fail('invalid-argument', `"${one.name}" accepts no kind of input, so it could never run.`, 'Say which kinds of input it handles.')
  }
  return { analyzers: [...registry.analyzers, one] }
}

export interface Selection {
  chosen: Analyzer[]
  /** Analyzers that handle this input but need an engine that is not here. Named rather than silently skipped. */
  unavailable: { analyzer: Analyzer; missing: string[] }[]
  /** Analyzers that do not handle this kind of input at all. */
  inapplicable: Analyzer[]
  describe: string
}

/** Which analyzers can run on an input. Three outcomes, because "cannot" has two different reasons. */
export function selectAnalyzers(registry: Registry, input: AnalysisInput, available: ReadonlySet<string>): Selection {
  const chosen: Analyzer[] = []
  const unavailable: Selection['unavailable'] = []
  const inapplicable: Analyzer[] = []

  for (const one of registry.analyzers) {
    if (!one.accepts.includes(input.kind)) {
      inapplicable.push(one)
      continue
    }
    const missing = one.requires.filter((operation) => !available.has(operation))
    if (missing.length > 0) unavailable.push({ analyzer: one, missing })
    else chosen.push(one)
  }

  return {
    chosen,
    unavailable,
    inapplicable,
    describe:
      chosen.length === 0
        ? `Nothing can analyse a ${input.kind} input here.${unavailable.length > 0 ? ` ${unavailable.length} analyzer${unavailable.length === 1 ? '' : 's'} would, but ${unavailable.length === 1 ? 'its engine is' : 'their engines are'} not available.` : ''}`
        : `${chosen.length} analyzer${chosen.length === 1 ? '' : 's'} can run.${unavailable.length > 0 ? ` ${unavailable.length} more would, given ${unavailable.flatMap((one) => one.missing).join(', ')}.` : ''}`
  }
}

// ---------------------------------------------------------------- the plan

export interface Stage {
  index: number
  analyzerId: string
  analyzerName: string
  /** Stages this one needs the output of. */
  after: string[]
  estimatedCalls: number
  describe: string
}

export interface Plan {
  stages: Stage[]
  estimatedCalls: number
  /** True where the estimate is past what should be started without asking. */
  heavy: boolean
  notes: string[]
}

/**
 * What would run, in what order, and what it would cost -- shown before anything runs.
 *
 * A plan somebody can read is the difference between a tool that analyses and a tool that does something to your data.
 * The estimate is from declared costs rather than measured, and says so.
 */
export function planAnalysis(input: AnalysisInput, analyzers: readonly Analyzer[], dependencies: ReadonlyMap<string, string[]> = new Map()): Plan | AnalyzerError {
  if (analyzers.length === 0) {
    return fail('no-analyzers', 'There is nothing to run.', 'Choose at least one analyzer.')
  }
  if (analyzers.length > ANALYZER_LIMITS.stages) {
    return fail('too-many', `A plan holds at most ${ANALYZER_LIMITS.stages} stages.`, 'Run fewer analyzers at a time.')
  }

  // Order by dependency, refusing a cycle before anything runs.
  const byId = new Map(analyzers.map((one) => [one.id, one]))
  const remaining = new Map(analyzers.map((one) => [one.id, new Set((dependencies.get(one.id) ?? []).filter((other) => byId.has(other)))]))
  const order: string[] = []

  while (remaining.size > 0) {
    const ready = [...remaining.entries()].filter(([, needs]) => needs.size === 0).map(([id]) => id).sort()
    if (ready.length === 0) {
      return fail(
        'cycle',
        `These analyzers depend on each other in a circle, so none can run first: ${[...remaining.keys()].join(', ')}.`,
        'Remove one of the dependencies between them.'
      )
    }
    for (const id of ready) {
      order.push(id)
      remaining.delete(id)
    }
    for (const needs of remaining.values()) for (const id of ready) needs.delete(id)
  }

  const rows = input.shape.rows ?? input.shape.lines ?? input.shape.words ?? 1
  const stages: Stage[] = order.map((id, index) => {
    const one = byId.get(id) as Analyzer
    const calls = one.cost.fixed + one.cost.perRow * rows
    return {
      index,
      analyzerId: id,
      analyzerName: one.name,
      after: (dependencies.get(id) ?? []).filter((other) => byId.has(other)),
      estimatedCalls: calls,
      describe: `${one.name}: ${one.describe}`
    }
  })

  const estimatedCalls = stages.reduce((sum, one) => sum + one.estimatedCalls, 0)
  const heavy = estimatedCalls > 5_000_000

  const notes = [
    `${stages.length} stage${stages.length === 1 ? '' : 's'} over ${rows.toLocaleString('en')} ${input.shape.rows !== undefined ? 'rows' : input.shape.lines !== undefined ? 'lines' : 'items'}. The estimate comes from what each analyzer declares it costs, not from a measurement.`
  ]
  if (heavy) notes.push('This is a long analysis. It is worth confirming before it starts.')

  return { stages, estimatedCalls, heavy, notes }
}

// ---------------------------------------------------------------- findings

export type Severity = 'info' | 'notice' | 'warning' | 'critical'

/** Where a finding came from. Every finding has at least one, because a finding without one is an assertion. */
export type Evidence =
  | { kind: 'rows'; ids: number[]; column?: string }
  | { kind: 'column'; name: string }
  | { kind: 'span'; from: number; to: number; excerpt: string }
  | { kind: 'line'; file: string; from: number; to: number }
  | { kind: 'value'; label: string; value: number }
  | { kind: 'computation'; operation: string; inputs: string; result: string }

export interface Finding {
  id: string
  analyzerId: string
  type: string
  severity: Severity
  summary: string
  /** How strong a claim this is. An interpretation is never stored as a measurement. */
  certainty: Certainty
  /** At least one. The type does not allow an empty list to mean anything useful. */
  evidence: Evidence[]
  method: string
  /** What to do, where there is something specific. Never "investigate further". */
  suggestion: string
  /** Assumptions the finding rests on, which are what somebody would argue with. */
  assumptions: string[]
}

export interface FindingCheck {
  ok: boolean
  problems: string[]
}

/**
 * Whether a finding is one.
 *
 * The evidence check is the substantive one: a finding with nothing behind it is an assertion, and letting one through
 * means the findings list stops being a list of things that were found.
 */
export function checkFinding(one: Finding): FindingCheck {
  const problems: string[] = []
  if (one.evidence.length === 0) {
    problems.push(`"${one.summary}" has no evidence. A finding points at the rows, lines or computation it came from; without that it is an assertion.`)
  }
  if (one.evidence.length > ANALYZER_LIMITS.evidence) {
    problems.push(`"${one.summary}" carries more than ${ANALYZER_LIMITS.evidence} pieces of evidence. Summarise it instead.`)
  }
  if (one.summary.trim() === '') problems.push('A finding needs a summary.')
  if (one.method.trim() === '') {
    problems.push(`"${one.summary}" does not say how it was found. Without the method, the result cannot be argued with or reproduced.`)
  }
  if (one.certainty === 'interpreted' && one.severity === 'critical') {
    problems.push(
      `"${one.summary}" is an interpretation marked critical. An interpretation can be wrong in a way a measurement cannot, so it should not carry the highest severity on its own.`
    )
  }
  return { ok: problems.length === 0, problems }
}

export interface FindingSummary {
  total: number
  bySeverity: Record<Severity, number>
  byCertainty: Record<Certainty, number>
  byAnalyzer: Record<string, number>
  /** Findings that failed their own check and were kept out of the list. */
  rejected: { finding: string; problems: string[] }[]
  notes: string[]
}

/** The findings, counted and checked. Anything that is not a finding is kept out and reported as such. */
export function summariseFindings(findings: readonly Finding[]): FindingSummary {
  const bySeverity: Record<Severity, number> = { info: 0, notice: 0, warning: 0, critical: 0 }
  const byCertainty: Record<Certainty, number> = { measured: 0, computed: 0, inferred: 0, interpreted: 0 }
  const byAnalyzer: Record<string, number> = {}
  const rejected: FindingSummary['rejected'] = []
  let total = 0

  for (const one of findings) {
    const check = checkFinding(one)
    if (!check.ok) {
      rejected.push({ finding: one.summary || one.id, problems: check.problems })
      continue
    }
    total += 1
    bySeverity[one.severity] += 1
    byCertainty[one.certainty] += 1
    byAnalyzer[one.analyzerId] = (byAnalyzer[one.analyzerId] ?? 0) + 1
  }

  const notes: string[] = []
  if (rejected.length > 0) {
    notes.push(`${rejected.length} finding${rejected.length === 1 ? ' was' : 's were'} kept out because ${rejected.length === 1 ? 'it does' : 'they do'} not meet what a finding has to carry.`)
  }
  if (byCertainty.interpreted > 0) {
    notes.push(
      `${byCertainty.interpreted} of ${total} findings are interpretations rather than measurements. They are shown separately because they can be wrong in a way a count cannot.`
    )
  }
  if (bySeverity.critical === 0 && bySeverity.warning === 0 && total > 0) {
    notes.push('Nothing rose above a notice. That is what the analysis found, not a statement that the data is fine.')
  }
  if (total === 0 && rejected.length === 0) {
    notes.push('Nothing was found. That is the result; no finding was invented to fill the space.')
  }

  return { total, bySeverity, byCertainty, byAnalyzer, rejected, notes }
}

// ---------------------------------------------------------------- results and staleness

export interface AnalysisResult {
  id: string
  analyzerId: string
  analyzerVersion: string
  inputId: string
  /** The input version and hash this came from. Both, because a version can be bumped without content changing. */
  inputVersion: number
  inputHash: string
  findings: Finding[]
  /** Everything the analyzer measured, keyed by name. Numbers only; anything else is a finding. */
  measurements: Record<string, number>
  configuration: Record<string, string>
  status: 'complete' | 'partial' | 'failed'
  error: string
  calls: number
}

export type Freshness = 'current' | 'stale-input' | 'stale-analyzer' | 'stale-configuration'

export interface FreshnessReport {
  resultId: string
  freshness: Freshness
  describe: string
  /** Whether rerunning would give the same answer. Only true when nothing has changed. */
  reproducible: boolean
}

/**
 * Whether a result still corresponds to the input as it stands.
 *
 * Three distinct kinds of stale, because the remedy differs. A changed input needs a rerun. A changed analyzer version
 * needs a rerun and means the old and new numbers are not comparable. A changed configuration means the result
 * answers a different question than the one now being asked.
 */
export function checkFreshness(
  result: AnalysisResult,
  input: AnalysisInput,
  analyzer: Analyzer,
  configuration: Record<string, string>
): FreshnessReport {
  if (result.inputHash !== input.contentHash) {
    return {
      resultId: result.id,
      freshness: 'stale-input',
      reproducible: false,
      describe: `The input has changed since this was computed. The numbers shown describe the earlier version, and a chart of them looks exactly like a chart of the current data.`
    }
  }
  if (result.analyzerVersion !== analyzer.version) {
    return {
      resultId: result.id,
      freshness: 'stale-analyzer',
      reproducible: false,
      describe: `This was computed with ${analyzer.name} version ${result.analyzerVersion} and the current one is ${analyzer.version}. Rerunning may give a different answer, and the two are not directly comparable.`
    }
  }
  const same = Object.keys({ ...result.configuration, ...configuration }).every((key) => result.configuration[key] === configuration[key])
  if (!same) {
    return {
      resultId: result.id,
      freshness: 'stale-configuration',
      reproducible: false,
      describe: 'The settings have changed since this was computed, so it answers a different question from the one being asked now.'
    }
  }
  return {
    resultId: result.id,
    freshness: 'current',
    reproducible: true,
    describe: 'The input, the analyzer and the settings are all as they were, so rerunning would give the same answer.'
  }
}

/** A cache key from everything a deterministic result depends on. Anything left out makes the cache lie. */
export function cacheKey(inputHash: string, analyzerId: string, analyzerVersion: string, configuration: Record<string, string>): string {
  const parts = [`input:${inputHash}`, `analyzer:${analyzerId}@${analyzerVersion}`, ...Object.keys(configuration).sort().map((key) => `${key}=${configuration[key]}`)]
  let hash = 0x811c9dc5
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      hash ^= part.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    hash ^= 0x1f
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

// ---------------------------------------------------------------- comparison

export interface ResultDifference {
  measurementsChanged: { name: string; from: number; to: number; absolute: number; relative: number | null }[]
  findingsAdded: string[]
  findingsRemoved: string[]
  findingsChanged: { id: string; from: string; to: string }[]
  /** True when the two came from the same input and analyzer, so any difference should not exist. */
  shouldMatch: boolean
  notes: string[]
}

/**
 * Two analyses compared.
 *
 * The case worth catching is two results that should be identical and are not. Same input hash, same analyzer version,
 * same settings, different numbers means something outside the recorded configuration is affecting the answer -- and
 * that is a finding about the tool rather than about the data.
 */
export function compareResults(a: AnalysisResult, b: AnalysisResult): ResultDifference {
  const measurementsChanged: ResultDifference['measurementsChanged'] = []
  for (const name of new Set([...Object.keys(a.measurements), ...Object.keys(b.measurements)])) {
    const from = a.measurements[name]
    const to = b.measurements[name]
    if (from === undefined || to === undefined || from === to) continue
    measurementsChanged.push({
      name,
      from,
      to,
      absolute: to - from,
      relative: from === 0 ? null : (to - from) / Math.abs(from)
    })
  }

  const aFindings = new Map(a.findings.map((one) => [one.id, one]))
  const bFindings = new Map(b.findings.map((one) => [one.id, one]))
  const findingsAdded = [...bFindings.keys()].filter((one) => !aFindings.has(one))
  const findingsRemoved = [...aFindings.keys()].filter((one) => !bFindings.has(one))
  const findingsChanged: ResultDifference['findingsChanged'] = []
  for (const [id, one] of aFindings) {
    const other = bFindings.get(id)
    if (!other || other.summary === one.summary) continue
    findingsChanged.push({ id, from: one.summary, to: other.summary })
  }

  const shouldMatch =
    a.inputHash === b.inputHash &&
    a.analyzerId === b.analyzerId &&
    a.analyzerVersion === b.analyzerVersion &&
    Object.keys({ ...a.configuration, ...b.configuration }).every((key) => a.configuration[key] === b.configuration[key])

  const anythingChanged = measurementsChanged.length > 0 || findingsAdded.length > 0 || findingsRemoved.length > 0 || findingsChanged.length > 0

  const notes: string[] = []
  if (shouldMatch && anythingChanged) {
    notes.push(
      'These two results came from the same input, the same analyzer version and the same settings, and they differ. Something outside the recorded configuration is affecting the answer, which is worth investigating before either is relied on.'
    )
  }
  if (!shouldMatch && !anythingChanged) {
    notes.push('The configuration differs and every number is the same, so whatever changed does not reach these measurements.')
  }
  if (a.inputHash !== b.inputHash) {
    notes.push('These came from different versions of the input, so the differences are about the data rather than about the analysis.')
  }

  return { measurementsChanged, findingsAdded, findingsRemoved, findingsChanged, shouldMatch, notes }
}

// ---------------------------------------------------------------- data quality

export interface QualityIssue {
  kind: 'missing' | 'duplicate' | 'constant' | 'type-mixed' | 'out-of-range' | 'high-cardinality' | 'suspicious-outlier'
  column: string
  count: number
  /** The share of the rows affected, which is what decides whether it matters. */
  share: number
  evidence: Evidence
  describe: string
  suggestion: string
}

export interface QualityProfile {
  rows: number
  columns: number
  issues: QualityIssue[]
  /** Columns with nothing wrong. Listed, because "no issues" needs to be distinguishable from "not checked". */
  clean: string[]
  notChecked: string[]
  notes: string[]
}

export interface ColumnFacts {
  name: string
  present: number
  missing: number
  distinct: number
  duplicated: number
  types: Record<string, number>
  numeric: { min: number; max: number; outliers: number[] } | null
}

/**
 * Data quality, from column facts somebody measured.
 *
 * Takes measurements rather than the data: the counting belongs to the data engine, and doing it again here would be
 * a second implementation that can disagree with the first. What this adds is which counts matter and why.
 */
export function assessQuality(rows: number, columns: readonly ColumnFacts[], checked: readonly string[] = []): QualityProfile {
  const issues: QualityIssue[] = []
  const clean: string[] = []
  const wasChecked = checked.length === 0 ? columns.map((one) => one.name) : checked

  for (const column of columns) {
    let found = false

    if (column.missing > 0) {
      const share = rows === 0 ? 0 : column.missing / rows
      found = true
      issues.push({
        kind: 'missing',
        column: column.name,
        count: column.missing,
        share,
        evidence: { kind: 'column', name: column.name },
        describe: `${column.missing} of ${rows} values in ${column.name} are missing (${Math.round(share * 100)}%).`,
        suggestion:
          share > 0.5
            ? `More than half of ${column.name} is missing. Anything computed from it describes the minority that is present, which is rarely what was wanted.`
            : `Decide what a missing value means here before anything is computed from the column. Leaving it out and treating it as zero give different answers.`
      })
    }

    if (column.duplicated > 0) {
      found = true
      issues.push({
        kind: 'duplicate',
        column: column.name,
        count: column.duplicated,
        share: rows === 0 ? 0 : column.duplicated / rows,
        evidence: { kind: 'column', name: column.name },
        describe: `${column.duplicated} values in ${column.name} appear more than once.`,
        suggestion: 'Repetition is only a problem where the column is meant to identify a row. Check whether it is.'
      })
    }

    if (column.present > 1 && column.distinct === 1) {
      found = true
      issues.push({
        kind: 'constant',
        column: column.name,
        count: column.present,
        share: 1,
        evidence: { kind: 'column', name: column.name },
        describe: `${column.name} has the same value in every row.`,
        suggestion: 'A constant column cannot explain any variation, so it will not appear in any correlation or model. It can be left out without losing anything.'
      })
    }

    const kinds = Object.keys(column.types).filter((one) => column.types[one] > 0)
    if (kinds.length > 1) {
      found = true
      const minority = kinds.map((one) => ({ one, count: column.types[one] })).sort((a, b) => a.count - b.count)[0]
      issues.push({
        kind: 'type-mixed',
        column: column.name,
        count: minority.count,
        share: rows === 0 ? 0 : minority.count / rows,
        evidence: { kind: 'column', name: column.name },
        describe: `${column.name} holds more than one kind of value: ${kinds.map((one) => `${column.types[one]} ${one}`).join(', ')}.`,
        suggestion: `The ${minority.count} ${minority.one} value${minority.count === 1 ? '' : 's'} will either fail to convert or convert to something unintended. Look at ${minority.count === 1 ? 'it' : 'them'} before converting the column.`
      })
    }

    if (column.present > 20 && column.distinct === column.present) {
      found = true
      issues.push({
        kind: 'high-cardinality',
        column: column.name,
        count: column.distinct,
        share: 1,
        evidence: { kind: 'column', name: column.name },
        describe: `Every value in ${column.name} is different.`,
        suggestion: 'A column where every value is unique is usually an identifier. Grouping or averaging by it gives one row per row, which is not a summary.'
      })
    }

    if (column.numeric && column.numeric.outliers.length > 0) {
      found = true
      issues.push({
        kind: 'suspicious-outlier',
        column: column.name,
        count: column.numeric.outliers.length,
        share: rows === 0 ? 0 : column.numeric.outliers.length / rows,
        evidence: { kind: 'rows', ids: column.numeric.outliers.slice(0, 50), column: column.name },
        describe: `${column.numeric.outliers.length} value${column.numeric.outliers.length === 1 ? '' : 's'} in ${column.name} are far from the rest, between ${Number(column.numeric.min.toPrecision(6))} and ${Number(column.numeric.max.toPrecision(6))}.`,
        suggestion: 'An outlier is not automatically an error. Look at the rows before removing anything: a genuine extreme and a typo look the same to the arithmetic.'
      })
    }

    if (!found) clean.push(column.name)
  }

  const notChecked = columns.filter((one) => !wasChecked.includes(one.name)).map((one) => one.name)

  const notes: string[] = []
  if (issues.length === 0 && columns.length > 0) {
    notes.push(`Nothing was found in the ${wasChecked.length} column${wasChecked.length === 1 ? '' : 's'} checked. That is different from the data being correct: only the checks listed were run.`)
  }
  if (notChecked.length > 0) {
    notes.push(`${notChecked.join(', ')} ${notChecked.length === 1 ? 'was' : 'were'} not checked, so nothing here says anything about ${notChecked.length === 1 ? 'it' : 'them'}.`)
  }

  return { rows, columns: columns.length, issues, clean, notChecked, notes }
}

// ---------------------------------------------------------------- handoff

export interface Handoff {
  /** What the receiving Page gets. Structured, never a rendering of it. */
  payload: { kind: string; data: unknown }
  from: { pageId: string; resultId: string; inputId: string }
  /** Carried through, so the receiving Page can trace a number back to the file it came from. */
  provenance: { inputName: string; inputHash: string; analyzerId: string; analyzerVersion: string; method: string }
  /** What the receiver should know before acting on it. */
  caveats: string[]
}

/**
 * An analysis result packaged for another Page.
 *
 * The provenance travels with it. A finding that arrives somewhere else without knowing which file and which analyzer
 * version produced it is a number with no way back to its source, and the second Page has no way to know it is stale.
 */
export function handoff(result: AnalysisResult, input: AnalysisInput, analyzer: Analyzer, pageId: string, payload: { kind: string; data: unknown }): Handoff {
  const caveats: string[] = []

  if (result.status !== 'complete') {
    caveats.push(`The analysis did not finish: it is ${result.status}${result.error ? ` (${result.error})` : ''}. What is here covers only part of the input.`)
  }
  const interpreted = result.findings.filter((one) => one.certainty === 'interpreted')
  if (interpreted.length > 0) {
    caveats.push(`${interpreted.length} of the ${result.findings.length} findings are interpretations rather than measurements.`)
  }
  caveats.push(`Computed from "${input.name}" at version ${result.inputVersion}. If that file has changed since, these numbers describe the earlier version.`)

  return {
    payload,
    from: { pageId, resultId: result.id, inputId: input.id },
    provenance: {
      inputName: input.name,
      inputHash: result.inputHash,
      analyzerId: analyzer.id,
      analyzerVersion: result.analyzerVersion,
      method: result.findings[0]?.method ?? ''
    },
    caveats
  }
}

/** The assumptions the Page rests on, for a screen that wants to show them rather than have them inferred. */
export const ANALYZER_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Every finding points at the rows, lines or computation it came from. A finding without evidence is an assertion and is kept out.',
  'A measurement and an interpretation are stored in different fields and shown differently.',
  'The plan is shown before anything runs, with what it will cost from what each analyzer declares.',
  'An analyzer whose engine is missing is named as unavailable rather than quietly skipped.',
  'A result is tied to the exact input version that produced it, and is marked stale when that changes.',
  'Two identical runs that differ is a finding about the tool, not about the data.',
  'Finding nothing is the result. No finding is invented to fill the space.',
  'A handoff carries its provenance, so a number can always be traced back to the file it came from.'
])
