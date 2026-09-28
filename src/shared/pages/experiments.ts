/**
 * Experiments: a hypothesis, variables, runs, and whether a run can be reproduced.
 *
 * `lab.ts` runs a graph and `study.ts` sweeps parameters. This is the layer that makes a run an *experiment*: a
 * question written down before the answer, variables classified as independent, dependent or controlled, and a record
 * complete enough that somebody -- including the person who ran it, months later -- can reproduce it or find out why
 * they cannot.
 *
 * ## A hypothesis is recorded before the run
 *
 * `state` moves from `stated` to `tested` and never back. A hypothesis edited after seeing the result is a different
 * hypothesis, and `reviseHypothesis` creates one rather than changing the original. Without that, every experiment
 * confirms its hypothesis.
 *
 * ## Reproduced is a measured claim
 *
 * Two runs agreeing means their outputs agree to a stated tolerance with the same seed, engine version and inputs.
 * Each of those is recorded and each is checked, and a run missing any of them is `not-reproducible` rather than
 * assumed fine.
 */

export interface ExperimentError {
  error: string
  message: string
}

export const isExperimentError = (value: unknown): value is ExperimentError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value

const fail = (error: string, message: string): ExperimentError => ({ error, message })

export const EXPERIMENT_LIMITS: Readonly<Record<'variables' | 'runs' | 'measurements' | 'hypotheses', number>> = Object.freeze({
  variables: 200,
  runs: 10_000,
  measurements: 100_000,
  hypotheses: 100
})

// ---------------------------------------------------------------- variables

export type Role = 'independent' | 'dependent' | 'controlled' | 'derived' | 'nuisance'

export interface Variable {
  id: string
  name: string
  role: Role
  unit: string
  /** For an independent variable: the values it is set to. For a controlled one: the single value it is held at. */
  values: number[]
  /** For a derived variable: what it is computed from. */
  from: string[]
  describe: string
}

export interface VariableCheck {
  ok: boolean
  problems: string[]
  notes: string[]
}

/**
 * Whether the variables describe an experiment.
 *
 * The checks are the design rules, not formalities. No dependent variable means nothing is being measured. No
 * independent variable means nothing is being varied, which is an observation rather than an experiment. A controlled
 * variable with several values is not controlled.
 */
export function checkVariables(variables: readonly Variable[]): VariableCheck {
  const problems: string[] = []
  const notes: string[] = []
  const names = new Set<string>()

  for (const one of variables) {
    if (names.has(one.id)) problems.push(`There are two variables with the id "${one.id}".`)
    names.add(one.id)

    if (one.role === 'controlled' && one.values.length > 1) {
      problems.push(`"${one.name}" is marked controlled and has ${one.values.length} values. A controlled variable is held at one value; if it varies, it is independent.`)
    }
    if (one.role === 'independent' && one.values.length < 2) {
      problems.push(`"${one.name}" is marked independent and has ${one.values.length === 0 ? 'no values' : 'one value'}. An independent variable is one that is varied.`)
    }
    if (one.role === 'derived' && one.from.length === 0) {
      problems.push(`"${one.name}" is derived and does not say what from.`)
    }
    for (const source of one.from) {
      if (!variables.some((other) => other.id === source)) {
        problems.push(`"${one.name}" is derived from "${source}", which is not a variable here.`)
      }
    }
  }

  const dependent = variables.filter((one) => one.role === 'dependent')
  const independent = variables.filter((one) => one.role === 'independent')

  if (dependent.length === 0) {
    problems.push('Nothing is marked as being measured. An experiment needs at least one dependent variable, or there is no result.')
  }
  if (independent.length === 0) {
    problems.push('Nothing is marked as being varied. Without an independent variable this is an observation rather than an experiment -- which is a fine thing to do, and a different thing.')
  }
  if (independent.length > 1) {
    notes.push(
      `${independent.length} variables are being varied at once. Any effect found is the effect of the combination unless the design separates them, which a full grid does and a diagonal does not.`
    )
  }

  const nuisance = variables.filter((one) => one.role === 'nuisance')
  if (nuisance.length > 0) {
    notes.push(
      `${nuisance.length} variable${nuisance.length === 1 ? ' is' : 's are'} recorded as nuisance: known to affect the result and not controlled. Anything found has to survive ${nuisance.length === 1 ? 'it' : 'them'}.`
    )
  }
  if (variables.filter((one) => one.role === 'controlled').length === 0 && independent.length > 0) {
    notes.push('Nothing is recorded as controlled. Either nothing else affects the result, or it has not been written down -- and the second is much more common.')
  }

  return { ok: problems.length === 0, problems, notes }
}

// ---------------------------------------------------------------- hypotheses

export type HypothesisState = 'stated' | 'tested' | 'superseded'

export interface Hypothesis {
  id: string
  statement: string
  /** What would be seen if it holds. Written before the run; this is what makes a test a test. */
  predicts: string
  /** What would show it false. A hypothesis nothing could refute is not one. */
  refutedBy: string
  state: HypothesisState
  /** Set only once, by `recordOutcome`. */
  outcome: 'supported' | 'not-supported' | 'inconclusive' | null
  /** The hypothesis this replaced, where it replaced one. */
  supersedes: string | null
  statedAt: string
}

export function hypothesis(id: string, statement: string, predicts: string, refutedBy: string, statedAt: string): Hypothesis | ExperimentError {
  if (statement.trim() === '') return fail('invalid-argument', 'A hypothesis needs a statement.')
  if (predicts.trim() === '') {
    return fail('no-prediction', 'A hypothesis needs to say what would be seen if it holds. Without a prediction made in advance, any result can be read as confirming it.')
  }
  if (refutedBy.trim() === '') {
    return fail(
      'not-refutable',
      'A hypothesis needs to say what would show it false. One that nothing could refute is not a hypothesis -- it cannot be tested, only illustrated.'
    )
  }
  return { id, statement, predicts, refutedBy, state: 'stated', outcome: null, supersedes: null, statedAt }
}

/**
 * The outcome recorded against a hypothesis.
 *
 * Once, and only for a hypothesis in the `stated` state. Recording a second outcome, or recording one against a
 * hypothesis written after the run, is the mechanism by which experiments come to confirm whatever they found.
 */
export function recordOutcome(one: Hypothesis, outcome: NonNullable<Hypothesis['outcome']>): Hypothesis | ExperimentError {
  if (one.state === 'tested') {
    return fail(
      'already-tested',
      `"${one.statement}" already has an outcome of ${one.outcome}. Recording a second one would overwrite what was found the first time; state a new hypothesis instead.`
    )
  }
  if (one.state === 'superseded') {
    return fail('superseded', `"${one.statement}" was replaced by a later hypothesis, so an outcome against it would not mean anything.`)
  }
  return { ...one, state: 'tested', outcome }
}

/**
 * A hypothesis revised into a new one, leaving the original alone.
 *
 * Editing a hypothesis after seeing the result is how every experiment comes to confirm itself. The original is
 * marked superseded and kept, so the record shows what was actually predicted in advance.
 */
export function reviseHypothesis(original: Hypothesis, id: string, statement: string, predicts: string, refutedBy: string, statedAt: string): { original: Hypothesis; revised: Hypothesis } | ExperimentError {
  const next = hypothesis(id, statement, predicts, refutedBy, statedAt)
  if (isExperimentError(next)) return next
  return {
    original: { ...original, state: 'superseded' },
    revised: { ...next, supersedes: original.id }
  }
}

// ---------------------------------------------------------------- runs

export type Determinism = 'deterministic' | 'seeded' | 'non-deterministic' | 'unknown'

export interface Measurement {
  variableId: string
  value: number
  unit: string
  /** Somebody's stated uncertainty, or `null`. Never computed from the value. */
  uncertainty: number | null
  repeat: number
}

export interface Run {
  id: string
  experimentId: string
  /** What the independent and controlled variables were set to. */
  settings: Record<string, number>
  measurements: Measurement[]
  status: 'complete' | 'partial' | 'failed' | 'cancelled'
  error: string
  /** Everything needed to run it again. A field missing here is a reason it cannot be reproduced. */
  record: {
    experimentVersion: number
    engineVersions: Record<string, string>
    seed: number | null
    determinism: Determinism
    /** Hashes of any datasets used, so a changed file is detectable. */
    datasetHashes: Record<string, string>
    /** Where live data came from and when, which is what makes a later run differ for a good reason. */
    externalData: { source: string; retrievedAt: string }[]
  }
  ranAt: string
}

export interface RecordCheck {
  complete: boolean
  missing: string[]
  reproducible: boolean
  describe: string
}

/**
 * Whether a run's record is complete enough to reproduce it.
 *
 * A non-deterministic run with no seed cannot be reproduced, and saying so is the point. A run that used live data is
 * reproducible only in the sense that the same code will run -- the data will have moved on, and that is recorded
 * separately because it is a different kind of irreproducibility.
 */
export function checkRecord(run: Run): RecordCheck {
  const missing: string[] = []

  if (run.record.experimentVersion <= 0) missing.push('the experiment version')
  if (Object.keys(run.record.engineVersions).length === 0) missing.push('the engine versions')
  if (run.record.determinism === 'unknown') missing.push('whether the model is deterministic')
  if (run.record.determinism === 'seeded' && run.record.seed === null) missing.push('the seed')
  if (run.ranAt.trim() === '') missing.push('when it ran')

  const reproducible =
    missing.length === 0 && run.record.determinism !== 'non-deterministic' && run.record.externalData.length === 0

  let describe: string
  if (run.record.determinism === 'non-deterministic') {
    describe = 'This run is not reproducible: the model is recorded as non-deterministic and has no seed. Running it again gives a different answer, and that is a property of the model rather than a fault in the record.'
  } else if (run.record.externalData.length > 0) {
    describe = `This run used live data from ${run.record.externalData.map((one) => one.source).join(', ')}, retrieved at ${run.record.externalData.map((one) => one.retrievedAt).join(', ')}. The code will run again identically; the data will not be the same, so a later run differing is expected rather than a discrepancy.`
  } else if (missing.length > 0) {
    describe = `This run cannot be reproduced: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not recorded.`
  } else {
    describe = `Everything needed to run this again is recorded${run.record.seed !== null ? `, including seed ${run.record.seed}` : ''}.`
  }

  return { complete: missing.length === 0, missing, reproducible, describe }
}

export interface Tolerance {
  absolute: number
  relative: number
}

export type ReproductionVerdict = 'reproduced' | 'numerically-equivalent' | 'different' | 'not-reproducible' | 'inputs-differ'

export interface Reproduction {
  verdict: ReproductionVerdict
  /** Per measurement, so a single disagreeing figure is findable rather than hidden in a summary. */
  comparisons: { variableId: string; original: number; repeated: number; difference: number; within: boolean }[]
  worstDifference: number
  tolerance: Tolerance
  describe: string
}

/**
 * Two runs compared, to a stated tolerance.
 *
 * Bit-for-bit equality is the wrong test for anything numerical: the same code on a different machine can differ in
 * the last place and that is not a failure to reproduce. So the comparison is `|a - b| <= absolute + relative * |b|`,
 * which is the standard form, and both parts are reported with the verdict.
 *
 * `reproduced` means exactly equal; `numerically-equivalent` means within tolerance. They are different claims and
 * are kept apart.
 */
export function compareRuns(original: Run, repeated: Run, tolerance: Tolerance = { absolute: 1e-12, relative: 1e-9 }): Reproduction {
  const originalCheck = checkRecord(original)

  const settingsMatch = Object.keys({ ...original.settings, ...repeated.settings }).every(
    (key) => original.settings[key] === repeated.settings[key]
  )
  const versionsMatch =
    original.record.experimentVersion === repeated.record.experimentVersion &&
    Object.keys({ ...original.record.engineVersions, ...repeated.record.engineVersions }).every(
      (key) => original.record.engineVersions[key] === repeated.record.engineVersions[key]
    )
  const seedsMatch = original.record.seed === repeated.record.seed
  const datasetsMatch = Object.keys({ ...original.record.datasetHashes, ...repeated.record.datasetHashes }).every(
    (key) => original.record.datasetHashes[key] === repeated.record.datasetHashes[key]
  )

  const byVariable = new Map(repeated.measurements.map((one) => [one.variableId, one]))
  const comparisons: Reproduction['comparisons'] = []
  let worstDifference = 0
  let allExact = true

  for (const one of original.measurements) {
    const other = byVariable.get(one.variableId)
    if (!other) continue
    const difference = Math.abs(one.value - other.value)
    const allowed = tolerance.absolute + tolerance.relative * Math.abs(other.value)
    if (difference !== 0) allExact = false
    worstDifference = Math.max(worstDifference, difference)
    comparisons.push({ variableId: one.variableId, original: one.value, repeated: other.value, difference, within: difference <= allowed })
  }

  const allWithin = comparisons.every((one) => one.within)

  let verdict: ReproductionVerdict
  if (!settingsMatch || !versionsMatch || !seedsMatch || !datasetsMatch) verdict = 'inputs-differ'
  else if (!originalCheck.reproducible) verdict = 'not-reproducible'
  else if (allExact && comparisons.length > 0) verdict = 'reproduced'
  else if (allWithin) verdict = 'numerically-equivalent'
  else verdict = 'different'

  const mismatches = [
    settingsMatch ? null : 'the settings',
    versionsMatch ? null : 'the versions',
    seedsMatch ? null : 'the seed',
    datasetsMatch ? null : 'the input data'
  ].filter((one): one is string => one !== null)

  const describe =
    verdict === 'inputs-differ'
      ? `These two runs do not have the same ${mismatches.join(', ')}, so any difference in the results is expected. This is not a failed reproduction; it is a comparison of two different things.`
      : verdict === 'not-reproducible'
        ? `The original run cannot be reproduced. ${originalCheck.describe}`
        : verdict === 'reproduced'
          ? `Every measurement is identical. The run reproduced exactly.`
          : verdict === 'numerically-equivalent'
            ? `Every measurement agrees to within ${tolerance.absolute} plus ${tolerance.relative} of its size; the largest difference is ${worstDifference.toExponential(2)}. That is not bit-for-bit identical, which for anything numerical is the wrong thing to ask for.`
            : `${comparisons.filter((one) => !one.within).length} of ${comparisons.length} measurements differ by more than the tolerance allows, the worst by ${worstDifference.toExponential(2)}. The inputs, versions and seed all match, so something outside the record is affecting the result.`

  return { verdict, comparisons, worstDifference, tolerance, describe }
}

// ---------------------------------------------------------------- repeats

export interface RepeatSummary {
  variableId: string
  repeats: number
  mean: number
  /** The spread across repeats, which is the experiment's own measure of its precision. */
  standardDeviation: number
  standardError: number
  min: number
  max: number
  describe: string
}

/**
 * Repeated measurements of the same quantity, summarised.
 *
 * The spread across repeats *is* the measurement's precision, measured rather than assumed. An experiment with one
 * repeat has no idea how precise it is, and a single-repeat summary says so rather than reporting a standard
 * deviation of zero -- which would be the most confident-looking wrong number available.
 */
export function summariseRepeats(variableId: string, measurements: readonly Measurement[]): RepeatSummary | ExperimentError {
  const mine = measurements.filter((one) => one.variableId === variableId)
  if (mine.length === 0) return fail('no-values', `There are no measurements of "${variableId}".`)

  const values = mine.map((one) => one.value)
  const mean = values.reduce((sum, one) => sum + one, 0) / values.length

  if (values.length === 1) {
    return {
      variableId,
      repeats: 1,
      mean,
      standardDeviation: Number.NaN,
      standardError: Number.NaN,
      min: mean,
      max: mean,
      describe:
        'There is one measurement, so there is no spread to report. A single reading gives no information about its own precision -- a standard deviation of zero would look confident and mean nothing.'
    }
  }

  let squared = 0
  for (const value of values) squared += (value - mean) ** 2
  const standardDeviation = Math.sqrt(squared / (values.length - 1))

  return {
    variableId,
    repeats: values.length,
    mean,
    standardDeviation,
    standardError: standardDeviation / Math.sqrt(values.length),
    min: Math.min(...values),
    max: Math.max(...values),
    describe: `${values.length} repeats, mean ${Number(mean.toPrecision(6))}, spread ${Number(standardDeviation.toPrecision(4))}. The spread across repeats is what the experiment knows about its own precision; it is measured, not assumed.`
  }
}

// ---------------------------------------------------------------- the experiment

export interface Experiment {
  id: string
  title: string
  objective: string
  question: string
  hypotheses: Hypothesis[]
  variables: Variable[]
  method: string
  assumptions: string[]
  version: number
}

export interface DesignCheck {
  ok: boolean
  problems: string[]
  notes: string[]
  describe: string
}

/**
 * Whether the experiment is one, before anything runs.
 *
 * Checking the design before the run is what an experiment designer is for. Every problem here is one that cannot be
 * fixed afterwards: a hypothesis written after the result is not a prediction, and a missing control cannot be added
 * retrospectively.
 */
export function checkDesign(experiment: Experiment): DesignCheck {
  const problems: string[] = []
  const notes: string[] = []

  if (experiment.question.trim() === '') {
    problems.push('The experiment does not say what question it answers. Without one, any result is interesting and none is informative.')
  }
  if (experiment.method.trim() === '') {
    problems.push('The method is not recorded, so the run could not be repeated even in principle.')
  }

  const variables = checkVariables(experiment.variables)
  problems.push(...variables.problems)
  notes.push(...variables.notes)

  const stated = experiment.hypotheses.filter((one) => one.state === 'stated')
  if (experiment.hypotheses.length === 0) {
    notes.push('There is no hypothesis. That is fine for an exploratory experiment, and it means the result cannot confirm or refute anything -- only describe.')
  } else if (stated.length === 0) {
    notes.push('Every hypothesis has already been tested or superseded. A new run against them would be re-testing, which is worth doing and is a different thing from a first test.')
  }

  if (experiment.assumptions.length === 0) {
    notes.push('No assumptions are recorded. Every experiment has some; the ones nobody writes down are the ones that turn out to matter.')
  }

  return {
    ok: problems.length === 0,
    problems,
    notes,
    describe:
      problems.length === 0
        ? `The design holds together: a question, a method, ${experiment.variables.filter((one) => one.role === 'independent').length} variable${experiment.variables.filter((one) => one.role === 'independent').length === 1 ? '' : 's'} being varied and ${experiment.variables.filter((one) => one.role === 'dependent').length} being measured.`
        : `${problems.length} problem${problems.length === 1 ? '' : 's'} with the design. Each of these is one that cannot be fixed after the run.`
  }
}

export interface Conclusion {
  hypothesisId: string
  /** What the measurements show, before any interpretation. */
  observed: string
  /** Whether the prediction held. Compared against what was written in advance. */
  predictionHeld: boolean | null
  outcome: NonNullable<Hypothesis['outcome']>
  /** Everything that stops this being stronger than it is. */
  limitations: string[]
  describe: string
}

/**
 * A conclusion, compared against the prediction that was recorded in advance.
 *
 * The comparison is against `predicts`, which was written before the run. That is the only thing that makes a result
 * a test rather than an observation dressed as one, and it is why `predicts` is required when a hypothesis is stated.
 */
export function concludeFrom(
  one: Hypothesis,
  observed: string,
  predictionHeld: boolean | null,
  design: DesignCheck,
  record: RecordCheck,
  repeats: number
): Conclusion {
  const limitations: string[] = []

  if (!design.ok) limitations.push(`The design has problems that cannot be fixed afterwards: ${design.problems.join(' ')}`)
  for (const note of design.notes) limitations.push(note)
  if (!record.reproducible) limitations.push(record.describe)
  if (repeats < 2) {
    limitations.push('The measurement was taken once, so nothing is known about how precise it is. A second reading would say more about the result than a third decimal place.')
  }

  const outcome: NonNullable<Hypothesis['outcome']> =
    predictionHeld === null ? 'inconclusive' : predictionHeld ? 'supported' : 'not-supported'

  return {
    hypothesisId: one.id,
    observed,
    predictionHeld,
    outcome,
    limitations,
    describe:
      outcome === 'inconclusive'
        ? `The result does not settle "${one.statement}" either way. That is a result: it says the experiment as designed cannot answer the question.`
        : outcome === 'supported'
          ? `The prediction made in advance -- ${one.predicts} -- held. That supports "${one.statement}" and does not prove it: the same observation is consistent with other explanations nobody has ruled out.`
          : `The prediction made in advance -- ${one.predicts} -- did not hold. ${one.refutedBy ? `The hypothesis said it would be refuted by: ${one.refutedBy}. ` : ''}A hypothesis that fails its own test is the most informative outcome an experiment has.`
  }
}

/** The assumptions the Page rests on, for a screen that wants to show them rather than have them inferred. */
export const EXPERIMENT_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A hypothesis says in advance what would be seen and what would refute it. One that nothing could refute is refused.',
  'An outcome is recorded once. A hypothesis revised after the result becomes a new one, and the original is kept.',
  'Variables are classified. A controlled variable that varies is not controlled, and nothing measured is not an experiment.',
  'A run records everything needed to repeat it, and a missing field is a stated reason it cannot be reproduced.',
  'Reproduced and numerically equivalent are different claims, and the tolerance is always reported.',
  'Two runs with different inputs are two different things, not a failed reproduction.',
  'A single measurement has no spread. A standard deviation of zero would look confident and mean nothing.',
  'A supported hypothesis is supported, not proved. The same observation is usually consistent with other explanations.'
])
