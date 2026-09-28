/**
 * Parameter studies, sensitivity and what-if.
 *
 * A model, a set of parameters, and a systematic way of changing them and running it again. The thing this replaces is
 * a slider that redraws a chart: a slider knows a number moved, and this knows which cases were run, which succeeded,
 * what the model version was, and whether the results still correspond to the model as it stands now.
 *
 * ## The parts that are not obvious
 *
 * **Case identifiers are positional and stable.** `case-000007` is the seventh case the generator produced for this
 * configuration, and it is the seventh again next time. A random id would make two runs incomparable, which defeats the
 * point of running twice.
 *
 * **A grid's size is computed before anything runs.** Four parameters at a hundred values each is a hundred million
 * cases, and the difference between refusing that and starting it is the difference between an error message and an
 * unresponsive application.
 *
 * **A partial study says so.** Fifty of a hundred cases completed is not a study of fifty cases; `summarise` reports
 * both numbers, and a cancelled or failed case keeps its parameters so it can be looked at rather than disappearing.
 *
 * **Staleness is structural.** Every result carries the fingerprint of the model and parameters it came from. Change
 * either and `staleAgainst` says which results no longer correspond to anything -- rather than the results silently
 * continuing to be displayed next to a model they were not produced by.
 */

import { accurateSum, percentile } from './statistics.ts'
import { isUnitError, parseUnit, type ResolvedUnit } from './units.ts'
import { drawFrom, randomStream, type Distribution, type RandomStream } from './uncertainty.ts'

export interface StudyError {
  error: string
  message: string
}

export const isStudyError = (value: unknown): value is StudyError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value

const fail = (error: string, message: string): StudyError => ({ error, message })

/**
 * The ceilings.
 *
 * `cases` is the one that matters. It is not a performance target: it is the number past which a study stops being
 * something a person waits for and becomes something that has to be cancelled.
 */
export const STUDY_LIMITS: Readonly<Record<'cases' | 'parameters' | 'values' | 'scenarios' | 'depth', number>> = Object.freeze({
  cases: 100_000,
  parameters: 32,
  values: 5_000,
  scenarios: 500,
  depth: 8
})

/** Past this, a study is worth confirming rather than starting. Separate from the hard ceiling on purpose. */
export const CONFIRM_ABOVE = 2_000

// ---------------------------------------------------------------- parameters

export type ParameterType = 'number' | 'integer' | 'boolean' | 'category' | 'quantity'

/** A value a parameter can take. Deliberately narrow: anything richer belongs in the model, not in the sweep. */
export type ParameterValue = number | boolean | string

export interface Parameter {
  id: string
  name: string
  type: ParameterType
  /** The value the baseline uses. Every study runs its baseline from these. */
  value: ParameterValue
  unit: ResolvedUnit | null
  /** Inclusive unless `exclusive` says otherwise. `null` on a side means unbounded there. */
  bounds: { low: number | null; high: number | null; exclusiveLow: boolean; exclusiveHigh: boolean }
  /** The allowed set, for a categorical parameter. Empty for everything else. */
  categories: string[]
  /** How this parameter is distributed, for the sampling strategies. `null` means it is only ever swept. */
  distribution: Distribution | null
  /** Whether this parameter is pinned. A locked parameter keeps its baseline value however a strategy is written. */
  locked: boolean
  group: string
  describe: string
}

export interface ParameterOptions {
  name?: string
  unit?: string
  bounds?: { low?: number | null; high?: number | null; exclusiveLow?: boolean; exclusiveHigh?: boolean }
  categories?: string[]
  distribution?: Distribution | null
  locked?: boolean
  group?: string
  describe?: string
}

/**
 * A parameter, validated against its own declaration.
 *
 * The type is enforced rather than advisory. An integer parameter whose baseline is 2.5 is refused here, because the
 * alternative is a sweep that produces 2.5 and a model that silently truncates it, and then a result nobody can trace
 * back to an input.
 */
export function parameter(id: string, type: ParameterType, value: ParameterValue, options: ParameterOptions = {}): Parameter | StudyError {
  const cleanId = String(id).trim()
  if (cleanId === '') return fail('invalid-argument', 'A parameter needs an id.')

  let unit: ResolvedUnit | null = null
  if (options.unit !== undefined && options.unit !== '') {
    if (type !== 'quantity' && type !== 'number' && type !== 'integer') {
      return fail('invalid-argument', `A ${type} parameter cannot have a unit.`)
    }
    const parsed = parseUnit(options.unit)
    if (isUnitError(parsed)) return fail('invalid-unit', parsed.message)
    unit = parsed
  }
  if (type === 'quantity' && unit === null) {
    return fail('invalid-argument', 'A quantity parameter needs a unit. Without one it is a number, and should say so.')
  }

  const categories = (options.categories ?? []).map((one) => String(one))
  if (type === 'category') {
    if (categories.length === 0) return fail('invalid-argument', 'A categorical parameter needs the categories it can take.')
    if (new Set(categories).size !== categories.length) return fail('invalid-argument', 'A categorical parameter has a repeated category.')
  } else if (categories.length > 0) {
    return fail('invalid-argument', `A ${type} parameter cannot have categories.`)
  }

  const bounds = {
    low: options.bounds?.low ?? null,
    high: options.bounds?.high ?? null,
    exclusiveLow: options.bounds?.exclusiveLow ?? false,
    exclusiveHigh: options.bounds?.exclusiveHigh ?? false
  }
  if (bounds.low !== null && !Number.isFinite(bounds.low)) return fail('invalid-argument', 'A lower bound has to be a finite number.')
  if (bounds.high !== null && !Number.isFinite(bounds.high)) return fail('invalid-argument', 'An upper bound has to be a finite number.')
  if (bounds.low !== null && bounds.high !== null && bounds.low > bounds.high) {
    return fail('invalid-argument', 'A lower bound above the upper bound leaves no value the parameter can take.')
  }

  const one: Parameter = {
    id: cleanId,
    name: options.name ?? cleanId,
    type,
    value,
    unit,
    bounds,
    categories,
    distribution: options.distribution ?? null,
    locked: options.locked ?? false,
    group: options.group ?? '',
    describe: options.describe ?? ''
  }

  const problem = checkValue(one, value)
  if (problem) return fail('invalid-argument', `The baseline value of ${one.name} is not allowed: ${problem}`)
  return one
}

/** Why a value is not allowed for a parameter, or `null` when it is. */
export function checkValue(one: Parameter, value: ParameterValue): string | null {
  switch (one.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : 'it has to be true or false.'
    case 'category':
      if (typeof value !== 'string') return 'it has to be one of the categories.'
      // `includes` on the declared list, never a lookup on an object -- a category called "constructor" is a category.
      return one.categories.includes(value) ? null : `"${value}" is not one of ${one.categories.join(', ')}.`
    case 'integer':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'it has to be a finite number.'
      if (!Number.isInteger(value)) return `${value} is not a whole number.`
      return checkBounds(one, value)
    case 'number':
    case 'quantity':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'it has to be a finite number.'
      return checkBounds(one, value)
  }
}

function checkBounds(one: Parameter, value: number): string | null {
  const { low, high, exclusiveLow, exclusiveHigh } = one.bounds
  if (low !== null && (exclusiveLow ? value <= low : value < low)) {
    return `${value} is below the ${exclusiveLow ? 'exclusive ' : ''}lower bound of ${low}.`
  }
  if (high !== null && (exclusiveHigh ? value >= high : value > high)) {
    return `${value} is above the ${exclusiveHigh ? 'exclusive ' : ''}upper bound of ${high}.`
  }
  return null
}

// ---------------------------------------------------------------- derived parameters

export interface DerivedParameter {
  id: string
  name: string
  /** The ids it is computed from. A derived parameter is never swept directly; it is recomputed. */
  from: string[]
  compute: (values: Record<string, ParameterValue>) => ParameterValue
  unit: string
  describe: string
}

/**
 * The order parameters have to be computed in, or the cycle that stops there being one.
 *
 * Kahn's algorithm, and the cycle is reported by name rather than by index, because the person who wrote `area` in
 * terms of `radius` in terms of `area` needs to be told which two they were.
 */
export function resolveOrder(
  parameters: readonly Parameter[],
  derived: readonly DerivedParameter[]
): string[] | StudyError {
  const known = new Set(parameters.map((one) => one.id))
  const pending = new Map(derived.map((one) => [one.id, new Set(one.from)]))

  for (const one of derived) {
    if (known.has(one.id)) return fail('duplicate', `"${one.id}" is both a parameter and a derived parameter.`)
    for (const from of one.from) {
      if (!known.has(from) && !pending.has(from)) {
        return fail('not-found', `"${one.name}" is computed from "${from}", which is not a parameter.`)
      }
    }
  }

  const order: string[] = []
  let progressed = true
  while (pending.size > 0 && progressed) {
    progressed = false
    for (const [id, needs] of pending) {
      if ([...needs].every((one) => known.has(one))) {
        order.push(id)
        known.add(id)
        pending.delete(id)
        progressed = true
      }
    }
  }

  if (pending.size > 0) {
    return fail(
      'cycle',
      `These derived parameters depend on each other in a circle, so none of them can be computed first: ${[...pending.keys()].join(', ')}.`
    )
  }
  return order
}

/** A case with its derived parameters filled in. Recomputed for every case, never carried over from the baseline. */
export function withDerived(
  values: Record<string, ParameterValue>,
  derived: readonly DerivedParameter[],
  order: readonly string[]
): Record<string, ParameterValue> | StudyError {
  const byId = new Map(derived.map((one) => [one.id, one]))
  const result: Record<string, ParameterValue> = { ...values }
  for (const id of order) {
    const one = byId.get(id)
    if (!one) continue
    try {
      const value = one.compute(result)
      if (typeof value === 'number' && !Number.isFinite(value)) {
        return fail('not-finite', `"${one.name}" has no finite value for this case.`)
      }
      result[id] = value
    } catch (error) {
      return fail('derived-failed', `"${one.name}" could not be computed: ${error instanceof Error ? error.message : 'it failed'}.`)
    }
  }
  return result
}

// ---------------------------------------------------------------- value generators

/** How a parameter's values are produced for a sweep. */
export type ValueSpec =
  /** Exactly these values, in this order. */
  | { kind: 'list'; values: ParameterValue[] }
  /** From `start` to `stop` in steps of `step`. The endpoint is included only when it lands on a step. */
  | { kind: 'step'; start: number; stop: number; step: number }
  /** `count` points from `start` to `stop`, both endpoints included. */
  | { kind: 'count'; start: number; stop: number; count: number }
  /** `count` points spaced evenly in the logarithm, for a quantity spanning orders of magnitude. */
  | { kind: 'log'; start: number; stop: number; count: number }
  /** Every declared category. */
  | { kind: 'categories' }

/**
 * The values a spec produces.
 *
 * `step` is the awkward one. Adding a step repeatedly accumulates floating point error, so that a sweep from 0 to 1 in
 * steps of 0.1 can end at 0.9999999999999999 and drop the endpoint. Multiplying the index by the step instead keeps
 * each value as close to exact as the arithmetic allows, and the endpoint is then tested with a tolerance.
 */
export function valuesFor(one: Parameter, spec: ValueSpec): ParameterValue[] | StudyError {
  const values = generate(one, spec)
  if (isStudyError(values)) return values
  if (values.length === 0) return fail('no-values', `The sweep of ${one.name} produces no values.`)
  if (values.length > STUDY_LIMITS.values) {
    return fail('too-many', `The sweep of ${one.name} produces ${values.length.toLocaleString('en')} values, past the ${STUDY_LIMITS.values.toLocaleString('en')} allowed for one parameter.`)
  }
  for (const value of values) {
    const problem = checkValue(one, value)
    if (problem) return fail('out-of-domain', `The sweep of ${one.name} produces ${String(value)}, which is not allowed: ${problem}`)
  }
  return values
}

function generate(one: Parameter, spec: ValueSpec): ParameterValue[] | StudyError {
  switch (spec.kind) {
    case 'list':
      return [...spec.values]

    case 'categories':
      if (one.type !== 'category') return fail('invalid-argument', `${one.name} is not categorical, so it has no categories to sweep.`)
      return [...one.categories]

    case 'step': {
      if (!Number.isFinite(spec.start) || !Number.isFinite(spec.stop) || !Number.isFinite(spec.step)) {
        return fail('invalid-argument', 'A stepped range needs three finite numbers.')
      }
      if (spec.step === 0) return fail('invalid-argument', 'A step of zero never reaches the end of the range.')
      if (Math.sign(spec.stop - spec.start) !== Math.sign(spec.step) && spec.stop !== spec.start) {
        return fail('invalid-argument', `A step of ${spec.step} moves away from ${spec.stop}, so the range never ends.`)
      }
      const span = spec.stop - spec.start
      const steps = Math.floor(Math.abs(span / spec.step) + 1e-9)
      if (steps + 1 > STUDY_LIMITS.values) {
        return fail('too-many', `That step gives ${(steps + 1).toLocaleString('en')} values, past the ${STUDY_LIMITS.values.toLocaleString('en')} allowed.`)
      }
      // Index times step, not repeated addition: repeated addition drifts and loses the endpoint.
      const out: number[] = []
      for (let i = 0; i <= steps; i++) out.push(spec.start + i * spec.step)
      return out
    }

    case 'count': {
      if (!Number.isFinite(spec.start) || !Number.isFinite(spec.stop)) {
        return fail('invalid-argument', 'A counted range needs two finite endpoints.')
      }
      if (!Number.isInteger(spec.count) || spec.count < 1) return fail('invalid-argument', 'A counted range needs a whole number of points, at least one.')
      if (spec.count > STUDY_LIMITS.values) {
        return fail('too-many', `${spec.count.toLocaleString('en')} points is past the ${STUDY_LIMITS.values.toLocaleString('en')} allowed.`)
      }
      if (spec.count === 1) return [spec.start]
      const out: number[] = []
      for (let i = 0; i < spec.count; i++) out.push(spec.start + ((spec.stop - spec.start) * i) / (spec.count - 1))
      // The last point is set exactly rather than computed, so the endpoint is the endpoint.
      out[out.length - 1] = spec.stop
      return out
    }

    case 'log': {
      if (!Number.isFinite(spec.start) || !Number.isFinite(spec.stop)) {
        return fail('invalid-argument', 'A logarithmic range needs two finite endpoints.')
      }
      if (spec.start <= 0 || spec.stop <= 0) {
        return fail('invalid-argument', 'A logarithmic range needs both endpoints above zero. There is no logarithm of zero or of a negative number.')
      }
      if (!Number.isInteger(spec.count) || spec.count < 1) return fail('invalid-argument', 'A logarithmic range needs a whole number of points, at least one.')
      if (spec.count > STUDY_LIMITS.values) {
        return fail('too-many', `${spec.count.toLocaleString('en')} points is past the ${STUDY_LIMITS.values.toLocaleString('en')} allowed.`)
      }
      if (spec.count === 1) return [spec.start]
      const a = Math.log(spec.start)
      const b = Math.log(spec.stop)
      const out: number[] = []
      for (let i = 0; i < spec.count; i++) out.push(Math.exp(a + ((b - a) * i) / (spec.count - 1)))
      out[out.length - 1] = spec.stop
      return out
    }
  }
}

// ---------------------------------------------------------------- constraints

export interface Constraint {
  id: string
  describe: string
  /** True when the case is allowed. Cross-parameter constraints live here; per-parameter ones are bounds. */
  holds: (values: Record<string, ParameterValue>) => boolean
}

/** Which constraints a case breaks. Empty when it is allowed. */
export function brokenBy(values: Record<string, ParameterValue>, constraints: readonly Constraint[]): Constraint[] {
  const broken: Constraint[] = []
  for (const one of constraints) {
    let holds = false
    try {
      holds = one.holds(values) === true
    } catch {
      // A constraint that throws is a constraint that did not hold. Treating a failure as "allowed" would let exactly
      // the cases the constraint exists to exclude through.
      holds = false
    }
    if (!holds) broken.push(one)
  }
  return broken
}

// ---------------------------------------------------------------- cases

export type CaseStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped'

export interface StudyCase {
  /** Positional and stable: the same configuration produces the same id for the same case, every time. */
  id: string
  index: number
  values: Record<string, ParameterValue>
  /** The parameters that differ from the baseline, which is what makes a case readable in a list. */
  changed: string[]
  status: CaseStatus
  /** Why the case was skipped, when it was. */
  reason: string
}

export const caseId = (index: number): string => `case-${String(index + 1).padStart(6, '0')}`

export type SweepStrategy =
  /** One parameter at a time; everything else stays at its baseline. The baseline itself is included once, first. */
  | { kind: 'one-at-a-time'; sweeps: { parameterId: string; spec: ValueSpec }[] }
  /** Every combination. Guarded by the size check before anything is generated. */
  | { kind: 'grid'; sweeps: { parameterId: string; spec: ValueSpec }[] }
  /** Independent random draws from each parameter's distribution. */
  | { kind: 'random'; parameterIds: string[]; count: number; seed: number }
  /** Stratified: each parameter's range is cut into `count` equal-probability slices, one draw per slice, shuffled. */
  | { kind: 'latin-hypercube'; parameterIds: string[]; count: number; seed: number }

export interface GeneratedCases {
  cases: StudyCase[]
  /** Cases the generator produced and the constraints excluded. Counted, because "9 of 25 ran" needs both numbers. */
  excluded: { index: number; values: Record<string, ParameterValue>; broke: string[] }[]
  /** What the grid would have been before constraints. */
  requested: number
  strategy: SweepStrategy['kind']
  notes: string[]
}

/**
 * How many cases a strategy would produce, before producing any.
 *
 * This exists so a hundred-million-case grid is an error message rather than an unresponsive application, and it runs
 * on the sweep sizes alone without generating a single case.
 */
export function estimateSize(parameters: readonly Parameter[], strategy: SweepStrategy): number | StudyError {
  const byId = new Map(parameters.map((one) => [one.id, one]))
  switch (strategy.kind) {
    case 'random':
    case 'latin-hypercube':
      if (!Number.isInteger(strategy.count) || strategy.count < 1) return fail('invalid-argument', 'A sampled study needs a whole number of cases, at least one.')
      return strategy.count

    case 'one-at-a-time': {
      let total = 1 // the baseline
      for (const sweep of strategy.sweeps) {
        const one = byId.get(sweep.parameterId)
        if (!one) return fail('not-found', `There is no parameter called "${sweep.parameterId}".`)
        const values = valuesFor(one, sweep.spec)
        if (isStudyError(values)) return values
        total += values.length
      }
      return total
    }

    case 'grid': {
      let total = 1
      for (const sweep of strategy.sweeps) {
        const one = byId.get(sweep.parameterId)
        if (!one) return fail('not-found', `There is no parameter called "${sweep.parameterId}".`)
        const values = valuesFor(one, sweep.spec)
        if (isStudyError(values)) return values
        total *= values.length
        // Checked inside the loop: the product of four hundreds overflows the useful range long before the last one.
        if (total > STUDY_LIMITS.cases) return total
      }
      return total
    }
  }
}

/**
 * The cases a strategy produces.
 *
 * Constraints are applied as the cases are generated rather than afterwards, so an excluded case is never counted as
 * one that will run. The excluded ones are kept with the constraint that excluded them, because "why is my grid only
 * nine cases" is the question that follows.
 */
export function generateCases(
  parameters: readonly Parameter[],
  strategy: SweepStrategy,
  constraints: readonly Constraint[] = [],
  derived: readonly DerivedParameter[] = []
): GeneratedCases | StudyError {
  if (parameters.length === 0) return fail('no-values', 'A study needs at least one parameter.')
  if (parameters.length > STUDY_LIMITS.parameters) {
    return fail('too-many', `A study is limited to ${STUDY_LIMITS.parameters} parameters.`)
  }
  const ids = new Set<string>()
  for (const one of parameters) {
    if (ids.has(one.id)) return fail('duplicate', `There are two parameters called "${one.id}".`)
    ids.add(one.id)
  }

  const order = resolveOrder(parameters, derived)
  if (isStudyError(order)) return order

  const requested = estimateSize(parameters, strategy)
  if (isStudyError(requested)) return requested
  if (requested > STUDY_LIMITS.cases) {
    return fail(
      'too-many',
      `That would be ${requested.toLocaleString('en')} cases, past the ${STUDY_LIMITS.cases.toLocaleString('en')} a study is allowed. Sweep fewer values, sweep fewer parameters together, or sample instead of taking every combination.`
    )
  }

  const byId = new Map(parameters.map((one) => [one.id, one]))
  const baseline: Record<string, ParameterValue> = {}
  for (const one of parameters) baseline[one.id] = one.value

  const rows: Record<string, ParameterValue>[] = []
  const notes: string[] = []

  switch (strategy.kind) {
    case 'one-at-a-time': {
      rows.push({ ...baseline })
      for (const sweep of strategy.sweeps) {
        const one = byId.get(sweep.parameterId)
        if (!one) return fail('not-found', `There is no parameter called "${sweep.parameterId}".`)
        if (one.locked) {
          notes.push(`${one.name} is locked, so it was not swept.`)
          continue
        }
        const values = valuesFor(one, sweep.spec)
        if (isStudyError(values)) return values
        for (const value of values) rows.push({ ...baseline, [one.id]: value })
      }
      break
    }

    case 'grid': {
      const axes: { id: string; values: ParameterValue[] }[] = []
      for (const sweep of strategy.sweeps) {
        const one = byId.get(sweep.parameterId)
        if (!one) return fail('not-found', `There is no parameter called "${sweep.parameterId}".`)
        if (one.locked) {
          notes.push(`${one.name} is locked, so it was not swept.`)
          continue
        }
        const values = valuesFor(one, sweep.spec)
        if (isStudyError(values)) return values
        axes.push({ id: one.id, values })
      }
      if (axes.length === 0) {
        rows.push({ ...baseline })
        break
      }
      // Odometer order: the last axis varies fastest, so a grid read top to bottom groups by the first parameter.
      const counters = new Array<number>(axes.length).fill(0)
      for (;;) {
        const row: Record<string, ParameterValue> = { ...baseline }
        for (let a = 0; a < axes.length; a++) row[axes[a].id] = axes[a].values[counters[a]]
        rows.push(row)
        let a = axes.length - 1
        while (a >= 0) {
          counters[a] += 1
          if (counters[a] < axes[a].values.length) break
          counters[a] = 0
          a -= 1
        }
        if (a < 0) break
      }
      break
    }

    case 'random':
    case 'latin-hypercube': {
      const sampled: Parameter[] = []
      for (const id of strategy.parameterIds) {
        const one = byId.get(id)
        if (!one) return fail('not-found', `There is no parameter called "${id}".`)
        if (one.locked) {
          notes.push(`${one.name} is locked, so it was not sampled.`)
          continue
        }
        if (!one.distribution) {
          return fail('no-distribution', `${one.name} has no distribution, so it cannot be sampled. Give it one, or sweep it instead.`)
        }
        sampled.push(one)
      }
      if (sampled.length === 0) return fail('no-values', 'No parameter is being sampled.')

      const columns = new Map<string, number[]>()
      for (let i = 0; i < sampled.length; i++) {
        const one = sampled[i]
        const stream = randomStream(strategy.seed, i + 1)
        columns.set(
          one.id,
          strategy.kind === 'random'
            ? Array.from({ length: strategy.count }, () => drawFrom(one.distribution as Distribution, stream))
            : latinColumn(one.distribution as Distribution, strategy.count, stream)
        )
      }
      for (let r = 0; r < strategy.count; r++) {
        const row: Record<string, ParameterValue> = { ...baseline }
        for (const one of sampled) {
          const raw = (columns.get(one.id) as number[])[r]
          row[one.id] = one.type === 'integer' ? Math.round(raw) : raw
        }
        rows.push(row)
      }
      notes.push(
        strategy.kind === 'latin-hypercube'
          ? `Latin hypercube with seed ${strategy.seed}: each parameter's range was cut into ${strategy.count} equally likely slices and drawn from once, so the sample covers the range more evenly than independent draws would.`
          : `Independent random draws with seed ${strategy.seed}.`
      )
      break
    }
  }

  const cases: StudyCase[] = []
  const excluded: GeneratedCases['excluded'] = []
  let index = 0
  for (const row of rows) {
    const complete = withDerived(row, derived, order)
    if (isStudyError(complete)) {
      excluded.push({ index, values: row, broke: [complete.message] })
      index += 1
      continue
    }
    const broke = brokenBy(complete, constraints)
    if (broke.length > 0) {
      excluded.push({ index, values: complete, broke: broke.map((one) => one.describe || one.id) })
      index += 1
      continue
    }
    const changed = parameters.filter((one) => complete[one.id] !== baseline[one.id]).map((one) => one.id)
    cases.push({ id: caseId(index), index, values: complete, changed, status: 'pending', reason: '' })
    index += 1
  }

  if (excluded.length > 0) {
    notes.push(
      `${excluded.length.toLocaleString('en')} of ${rows.length.toLocaleString('en')} generated cases broke a constraint and were left out before anything ran.`
    )
  }
  if (cases.length > CONFIRM_ABOVE) {
    notes.push(`${cases.length.toLocaleString('en')} cases is a long study. It is worth confirming before it starts.`)
  }

  return { cases, excluded, requested, strategy: strategy.kind, notes }
}

/**
 * One column of a Latin hypercube.
 *
 * The range is cut into `count` slices of equal probability, one value is drawn from each slice, and then the column is
 * shuffled so that the slice index of one parameter is not tied to the slice index of the next. Without the shuffle
 * every parameter would move together and the sample would be a diagonal line through the space.
 */
function latinColumn(distribution: Distribution, count: number, stream: RandomStream): number[] {
  const values: number[] = []
  for (let i = 0; i < count; i++) {
    // The draw is placed inside slice i rather than anywhere, which is what stratification means.
    const inside = (i + stream.next()) / count
    values.push(quantileOfDistribution(distribution, inside, stream))
  }
  // Fisher-Yates, from the same stream, so the shuffle is part of the seeded sequence.
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(stream.next() * (i + 1))
    const swap = values[i]
    values[i] = values[j]
    values[j] = swap
  }
  return values
}

/**
 * The value at a given probability, for the distributions a sweep can stratify.
 *
 * Only the ones with a closed-form inverse are stratified. For anything else the honest fallback is an ordinary draw,
 * which loses the stratification but does not invent a quantile the distribution does not have.
 */
function quantileOfDistribution(one: Distribution, fraction: number, stream: RandomStream): number {
  const clamped = Math.min(1 - 1e-9, Math.max(1e-9, fraction))
  switch (one.kind) {
    case 'exact':
      return one.value
    case 'uniform':
      return one.low + clamped * (one.high - one.low)
    case 'triangular': {
      const span = one.high - one.low
      const split = (one.peak - one.low) / span
      return clamped < split
        ? one.low + Math.sqrt(clamped * span * (one.peak - one.low))
        : one.high - Math.sqrt((1 - clamped) * span * (one.high - one.peak))
    }
    case 'normal':
      return one.mean + normalQuantile(clamped) * one.standardDeviation
    case 'lognormal':
      return Math.exp(one.logMean + normalQuantile(clamped) * one.logStandardDeviation)
    default:
      return drawFrom(one, stream)
  }
}

/** The standard normal quantile, by Acklam's rational approximation. Accurate to about 1e-9, which is ample here. */
export function normalQuantile(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const low = 0.02425
  if (p < low) {
    const s = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * s + c[1]) * s + c[2]) * s + c[3]) * s + c[4]) * s + c[5]) / ((((d[0] * s + d[1]) * s + d[2]) * s + d[3]) * s + 1)
  }
  if (p > 1 - low) {
    const s = Math.sqrt(-2 * Math.log(1 - p))
    return -(((((c[0] * s + c[1]) * s + c[2]) * s + c[3]) * s + c[4]) * s + c[5]) / ((((d[0] * s + d[1]) * s + d[2]) * s + d[3]) * s + 1)
  }
  const s = p - 0.5
  const r = s * s
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * s / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

// ---------------------------------------------------------------- running

export type FailurePolicy = 'stop' | 'continue' | 'skip-rest'

export interface CaseResult {
  caseId: string
  index: number
  values: Record<string, ParameterValue>
  outputs: Record<string, number>
  status: CaseStatus
  error: string
  /** Deterministic: the number of model calls, not a wall clock. A study run twice reports the same work. */
  calls: number
}

export interface StudyRun {
  results: CaseResult[]
  completed: number
  failed: number
  skipped: number
  cancelled: number
  /** Cases never reached, because the study stopped. Distinct from skipped, which were reached and passed over. */
  pending: number
  policy: FailurePolicy
  /** The fingerprint the results correspond to. Change the model or the parameters and these results are stale. */
  fingerprint: string
  notes: string[]
}

export interface RunOptions {
  policy?: FailurePolicy
  /** Checked before each case. Cancelling leaves the finished results alone and marks the rest as never run. */
  cancelled?: () => boolean
  /** Which outputs to keep. Anything the model returns that is not named here is dropped rather than stored. */
  outputs?: string[]
  onCase?: (result: CaseResult, done: number, total: number) => void
  /** Results from an earlier run of the same fingerprint, reused rather than recomputed. */
  reuse?: readonly CaseResult[]
}

/**
 * Every case, run against the real model.
 *
 * The failure policy is explicit because the three sensible answers are genuinely different studies. `stop` gives a
 * partial study and says so. `continue` gives a study with holes in it, which is usually what a sweep across a domain
 * boundary should give. `skip-rest` marks everything after the failure as skipped rather than leaving it pending, so
 * the distinction between "not reached" and "deliberately passed over" survives into the results.
 */
export function runStudy(
  cases: readonly StudyCase[],
  model: (values: Record<string, ParameterValue>) => Record<string, number>,
  fingerprint: string,
  options: RunOptions = {}
): StudyRun {
  const policy = options.policy ?? 'continue'
  const results: CaseResult[] = []
  const notes: string[] = []
  const reuse = new Map((options.reuse ?? []).map((one) => [one.caseId, one]))
  let reused = 0
  let stopped = false

  for (let i = 0; i < cases.length; i++) {
    const one = cases[i]

    if (stopped) {
      results.push({
        caseId: one.id,
        index: one.index,
        values: one.values,
        outputs: {},
        status: policy === 'skip-rest' ? 'skipped' : 'pending',
        error: policy === 'skip-rest' ? 'Skipped after an earlier case failed.' : 'Not reached; the study stopped earlier.',
        calls: 0
      })
      continue
    }

    if (options.cancelled?.()) {
      results.push({
        caseId: one.id,
        index: one.index,
        values: one.values,
        outputs: {},
        status: 'cancelled',
        error: 'Cancelled before this case ran.',
        calls: 0
      })
      continue
    }

    const cached = reuse.get(one.id)
    if (cached && cached.status === 'completed' && sameValues(cached.values, one.values)) {
      results.push({ ...cached })
      reused += 1
      options.onCase?.(cached, i + 1, cases.length)
      continue
    }

    let result: CaseResult
    try {
      const outputs = model(one.values)
      const kept: Record<string, number> = {}
      const names = options.outputs ?? Object.keys(outputs)
      for (const name of names) {
        // `hasOwnProperty`, never a bare index: an output named `constructor` is a name somebody can write.
        if (!Object.prototype.hasOwnProperty.call(outputs, name)) continue
        const value = outputs[name]
        if (typeof value === 'number' && Number.isFinite(value)) kept[name] = value
      }
      const missing = names.filter((name) => !Object.prototype.hasOwnProperty.call(kept, name))
      result =
        missing.length > 0
          ? {
              caseId: one.id,
              index: one.index,
              values: one.values,
              outputs: kept,
              status: 'failed',
              error: `The model gave no finite value for ${missing.join(', ')}.`,
              calls: 1
            }
          : { caseId: one.id, index: one.index, values: one.values, outputs: kept, status: 'completed', error: '', calls: 1 }
    } catch (error) {
      result = {
        caseId: one.id,
        index: one.index,
        values: one.values,
        outputs: {},
        status: 'failed',
        error: error instanceof Error ? error.message.slice(0, 200) : 'The model failed.',
        calls: 1
      }
    }

    results.push(result)
    options.onCase?.(result, i + 1, cases.length)
    if (result.status === 'failed' && policy !== 'continue') stopped = true
  }

  const count = (status: CaseStatus): number => results.filter((one) => one.status === status).length
  const completed = count('completed')
  const failed = count('failed')

  if (failed > 0) {
    notes.push(
      policy === 'continue'
        ? `${failed} of ${cases.length} cases failed. They are kept with their parameters, so the part of the range the model does not cover can be seen.`
        : `The study stopped at the first failure, so ${count('pending') + count('skipped')} cases never ran. This is a partial study of ${completed} cases, not a study of ${cases.length}.`
    )
  }
  if (reused > 0) {
    notes.push(`${reused} of ${cases.length} cases were reused from an earlier run with the same model and the same values.`)
  }
  if (count('cancelled') > 0) {
    notes.push(`Cancelled: ${completed} cases finished and are kept, ${count('cancelled')} never ran.`)
  }

  return {
    results,
    completed,
    failed,
    skipped: count('skipped'),
    cancelled: count('cancelled'),
    pending: count('pending'),
    policy,
    fingerprint,
    notes
  }
}

const sameValues = (a: Record<string, ParameterValue>, b: Record<string, ParameterValue>): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (a[key] !== b[key]) return false
  }
  return true
}

/**
 * The fingerprint a run's results are tied to.
 *
 * Deterministic and order-independent for the parameters, because reordering the parameter list does not change what
 * was computed. FNV-1a because it is short, stable and does not need a dependency; this identifies a configuration,
 * it does not authenticate one.
 */
export function fingerprintOf(
  modelVersion: string,
  parameters: readonly Parameter[],
  extra: readonly string[] = []
): string {
  const parts = [
    `model:${modelVersion}`,
    ...parameters
      .map((one) => `${one.id}:${one.type}:${String(one.value)}:${one.unit?.display ?? ''}:${one.locked ? 'locked' : 'free'}`)
      .sort(),
    ...[...extra].sort()
  ]
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

/** Which of an earlier run's results no longer correspond to the configuration as it stands now. */
export function staleAgainst(run: StudyRun, fingerprint: string): { stale: boolean; why: string } {
  if (run.fingerprint === fingerprint) return { stale: false, why: 'The model and parameters are the same ones these results came from.' }
  return {
    stale: true,
    why: 'The model or the parameters have changed since these results were produced, so they no longer correspond to anything. Run the study again.'
  }
}

// ---------------------------------------------------------------- sensitivity

export interface LocalSensitivity {
  parameterId: string
  name: string
  /** The slope of the output with respect to this parameter, at the baseline. */
  derivative: number
  /** Dimensionless: the proportional change in the output for a proportional change in the parameter. */
  elasticity: number | null
  /** The step the derivative was taken over, reported because the answer depends on it. */
  step: number
  method: 'finite-difference'
}

/**
 * How the outputs move for a small change in each parameter, at the baseline.
 *
 * Central differences, and the step is reported. It has to be: a finite-difference derivative is a property of the step
 * as well as of the model, and a model with a kink or a threshold near the baseline gives a different answer for a step
 * of 1e-6 than for one of 1e-3. Reporting the step is what lets somebody notice that.
 */
export function localSensitivity(
  parameters: readonly Parameter[],
  outputName: string,
  model: (values: Record<string, ParameterValue>) => Record<string, number>,
  options: { relativeStep?: number } = {}
): LocalSensitivity[] | StudyError {
  const baseline: Record<string, ParameterValue> = {}
  for (const one of parameters) baseline[one.id] = one.value

  const at = model(baseline)
  if (!Object.prototype.hasOwnProperty.call(at, outputName) || !Number.isFinite(at[outputName])) {
    return fail('not-finite', `The model gives no finite "${outputName}" at the baseline, so nothing can be differentiated around it.`)
  }
  const middle = at[outputName]

  const relativeStep = options.relativeStep ?? 1e-5
  const out: LocalSensitivity[] = []
  for (const one of parameters) {
    if (one.locked) continue
    if (one.type !== 'number' && one.type !== 'quantity') {
      // An integer, boolean or category has no derivative. Producing one by nudging it by 1e-5 and dividing would be
      // arithmetic on a value the model never actually sees.
      continue
    }
    const value = one.value as number
    const step = Math.max(1e-10, Math.abs(value) * relativeStep)
    const up = { ...baseline, [one.id]: value + step }
    const down = { ...baseline, [one.id]: value - step }
    if (checkValue(one, up[one.id]) || checkValue(one, down[one.id])) {
      // Stepping outside the parameter's own domain would be measuring the slope somewhere the parameter cannot go.
      continue
    }
    const a = model(up)[outputName]
    const b = model(down)[outputName]
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue
    const derivative = (a - b) / (2 * step)
    out.push({
      parameterId: one.id,
      name: one.name,
      derivative,
      elasticity: middle !== 0 && value !== 0 ? (derivative * value) / middle : null,
      step,
      method: 'finite-difference'
    })
  }

  if (out.length === 0) {
    return fail('no-values', 'No parameter could be differentiated: they are all locked, not continuous, or at the edge of their own domain.')
  }
  return out
}

export interface TornadoEntry {
  parameterId: string
  name: string
  low: { value: ParameterValue; output: number } | null
  high: { value: ParameterValue; output: number } | null
  baseline: number
  /** The full swing over the range tested, which is what the bar length actually is. */
  swing: number
  /** Share of the total swing across all parameters. */
  share: number
  /** True where the output falls as the parameter rises, which a bar chart otherwise hides. */
  inverted: boolean
}

/**
 * The one-at-a-time swing for each parameter over its own range.
 *
 * This is what a tornado plot is, and the honest caveat is built into the shape: each bar is the effect of moving one
 * parameter with the rest at baseline. A model with interactions has bars that do not add up to what moving everything
 * together does, and no arrangement of them would.
 */
export function tornado(
  parameters: readonly Parameter[],
  ranges: readonly { parameterId: string; low: ParameterValue; high: ParameterValue }[],
  outputName: string,
  model: (values: Record<string, ParameterValue>) => Record<string, number>
): { entries: TornadoEntry[]; baseline: number; notes: string[] } | StudyError {
  const byId = new Map(parameters.map((one) => [one.id, one]))
  const values: Record<string, ParameterValue> = {}
  for (const one of parameters) values[one.id] = one.value

  const at = model(values)
  if (!Object.prototype.hasOwnProperty.call(at, outputName) || !Number.isFinite(at[outputName])) {
    return fail('not-finite', `The model gives no finite "${outputName}" at the baseline.`)
  }
  const baseline = at[outputName]

  const entries: TornadoEntry[] = []
  for (const range of ranges) {
    const one = byId.get(range.parameterId)
    if (!one) return fail('not-found', `There is no parameter called "${range.parameterId}".`)
    if (one.locked) continue

    const evaluate = (value: ParameterValue): { value: ParameterValue; output: number } | null => {
      if (checkValue(one, value)) return null
      try {
        const result = model({ ...values, [one.id]: value })[outputName]
        return Number.isFinite(result) ? { value, output: result } : null
      } catch {
        return null
      }
    }

    const low = evaluate(range.low)
    const high = evaluate(range.high)
    const outputs = [low?.output, high?.output, baseline].filter((one2): one2 is number => one2 !== undefined)
    const swing = Math.max(...outputs) - Math.min(...outputs)
    entries.push({
      parameterId: one.id,
      name: one.name,
      low,
      high,
      baseline,
      swing,
      share: 0,
      inverted: low !== null && high !== null && high.output < low.output
    })
  }

  if (entries.length === 0) return fail('no-values', 'No parameter had a range that could be tested.')

  const total = accurateSum(entries.map((one) => one.swing))
  for (const entry of entries) entry.share = total > 0 ? entry.swing / total : 0
  entries.sort((a, b) => b.swing - a.swing)

  const notes = [
    'Each bar is the effect of moving one parameter with the rest at their baseline. Where parameters interact, the bars will not add up to the effect of moving several at once, and no ordering of them would.'
  ]
  const missing = entries.filter((one) => one.low === null || one.high === null)
  if (missing.length > 0) {
    notes.push(
      `${missing.map((one) => one.name).join(', ')} could not be evaluated at one end of the range tested, so ${missing.length === 1 ? 'its bar covers' : 'their bars cover'} less than asked for.`
    )
  }
  if (entries.some((one) => one.inverted)) {
    notes.push(`${entries.filter((one) => one.inverted).map((one) => one.name).join(', ')} moves the output down as it rises.`)
  }

  return { entries, baseline, notes }
}

// ---------------------------------------------------------------- scenarios

export interface Scenario {
  id: string
  name: string
  /** The scenario this one is derived from. `null` for a branch off the baseline. */
  parent: string | null
  /** Only what differs. Storing a full copy would make a later change to the baseline invisible. */
  overrides: Record<string, ParameterValue>
  describe: string
}

export type Override =
  | { kind: 'set'; value: ParameterValue }
  | { kind: 'multiply'; factor: number }
  | { kind: 'add'; amount: number }
  | { kind: 'percent'; percent: number }

/** An override applied to a value. Relative forms are resolved here so a scenario can be written either way. */
export function applyOverride(current: ParameterValue, override: Override): ParameterValue | StudyError {
  switch (override.kind) {
    case 'set':
      return override.value
    case 'multiply':
      if (typeof current !== 'number') return fail('invalid-argument', 'Only a number can be multiplied.')
      if (!Number.isFinite(override.factor)) return fail('invalid-argument', 'A multiplier has to be a finite number.')
      return current * override.factor
    case 'add':
      if (typeof current !== 'number') return fail('invalid-argument', 'Only a number can be added to.')
      if (!Number.isFinite(override.amount)) return fail('invalid-argument', 'An amount has to be a finite number.')
      return current + override.amount
    case 'percent':
      if (typeof current !== 'number') return fail('invalid-argument', 'Only a number can change by a percentage.')
      if (!Number.isFinite(override.percent)) return fail('invalid-argument', 'A percentage has to be a finite number.')
      return current * (1 + override.percent / 100)
  }
}

/**
 * The values a scenario resolves to, following its chain of parents back to the baseline.
 *
 * The baseline is never modified. That is the property the whole thing rests on: a scenario is a view of the baseline
 * with some values replaced, and a hundred scenarios do not make a hundred copies that drift apart when the baseline
 * changes.
 */
export function resolveScenario(
  parameters: readonly Parameter[],
  scenarios: readonly Scenario[],
  scenarioId: string
): { values: Record<string, ParameterValue>; lineage: string[] } | StudyError {
  const byId = new Map(scenarios.map((one) => [one.id, one]))
  const chain: Scenario[] = []
  let current = byId.get(scenarioId)
  if (!current) return fail('not-found', `There is no scenario called "${scenarioId}".`)

  const seen = new Set<string>()
  while (current) {
    if (seen.has(current.id)) return fail('cycle', `The scenarios "${current.id}" and its parents refer back to each other.`)
    seen.add(current.id)
    if (chain.length >= STUDY_LIMITS.depth) {
      return fail('too-deep', `Scenarios are nested more than the ${STUDY_LIMITS.depth} levels allowed.`)
    }
    chain.unshift(current)
    current = current.parent === null ? undefined : byId.get(current.parent)
    if (chain[0].parent !== null && current === undefined) {
      return fail('not-found', `"${chain[0].name}" is branched from "${chain[0].parent}", which does not exist.`)
    }
  }

  const parameterById = new Map(parameters.map((one) => [one.id, one]))
  const values: Record<string, ParameterValue> = {}
  for (const one of parameters) values[one.id] = one.value

  for (const scenario of chain) {
    for (const [id, value] of Object.entries(scenario.overrides)) {
      const one = parameterById.get(id)
      if (!one) return fail('not-found', `"${scenario.name}" overrides "${id}", which is not a parameter.`)
      if (one.locked) return fail('locked', `"${scenario.name}" overrides ${one.name}, which is locked.`)
      const problem = checkValue(one, value)
      if (problem) return fail('out-of-domain', `"${scenario.name}" sets ${one.name} to ${String(value)}, which is not allowed: ${problem}`)
      values[id] = value
    }
  }

  return { values, lineage: chain.map((one) => one.id) }
}

/**
 * A name from what the scenario actually changes.
 *
 * Generated rather than random, because a list of "Scenario 4, Scenario 7, Scenario 12" is a list nobody can read. A
 * caller is free to rename; this is the default, not a fixed label.
 */
export function nameScenario(parameters: readonly Parameter[], overrides: Record<string, ParameterValue>): string {
  const byId = new Map(parameters.map((one) => [one.id, one]))
  const parts: string[] = []
  for (const [id, value] of Object.entries(overrides)) {
    const one = byId.get(id)
    if (!one) continue
    if (typeof value === 'number' && typeof one.value === 'number' && one.value !== 0) {
      const ratio = value / one.value
      if (Math.abs(ratio - 2) < 1e-9) parts.push(`${one.name} doubled`)
      else if (Math.abs(ratio - 0.5) < 1e-9) parts.push(`${one.name} halved`)
      else parts.push(`${one.name} ${value > one.value ? 'up' : 'down'} to ${formatValue(value, one)}`)
    } else if (typeof value === 'boolean') {
      parts.push(`${one.name} ${value ? 'on' : 'off'}`)
    } else {
      parts.push(`${one.name} ${formatValue(value, one)}`)
    }
  }
  if (parts.length === 0) return 'No change'
  if (parts.length <= 2) return parts.join(', ')
  return `${parts.slice(0, 2).join(', ')} and ${parts.length - 2} more`
}

const formatValue = (value: ParameterValue, one: Parameter): string => {
  if (typeof value !== 'number') return String(value)
  const text = Number(value.toPrecision(6)).toString()
  return one.unit && one.unit.display !== '' ? `${text} ${one.unit.display}` : text
}

export interface Delta {
  name: string
  baseline: number
  scenario: number
  absolute: number
  /** `null` where the baseline is zero and a ratio would say nothing. */
  relative: number | null
  direction: 'up' | 'down' | 'same'
}

export interface ScenarioComparison {
  changedParameters: { id: string; name: string; from: ParameterValue; to: ParameterValue }[]
  deltas: Delta[]
  /** Outputs the scenario produced and the baseline did not, or the other way round. */
  onlyOneSide: string[]
  notes: string[]
}

/** A scenario against its baseline, with the differences computed rather than described. */
export function compareToBaseline(
  parameters: readonly Parameter[],
  baselineValues: Record<string, ParameterValue>,
  scenarioValues: Record<string, ParameterValue>,
  baselineOutputs: Record<string, number>,
  scenarioOutputs: Record<string, number>
): ScenarioComparison {
  const byId = new Map(parameters.map((one) => [one.id, one]))
  const changedParameters: ScenarioComparison['changedParameters'] = []
  for (const id of new Set([...Object.keys(baselineValues), ...Object.keys(scenarioValues)])) {
    if (baselineValues[id] === scenarioValues[id]) continue
    changedParameters.push({
      id,
      name: byId.get(id)?.name ?? id,
      from: baselineValues[id],
      to: scenarioValues[id]
    })
  }

  const deltas: Delta[] = []
  const onlyOneSide: string[] = []
  for (const name of new Set([...Object.keys(baselineOutputs), ...Object.keys(scenarioOutputs)])) {
    const hasBase = Object.prototype.hasOwnProperty.call(baselineOutputs, name)
    const hasScenario = Object.prototype.hasOwnProperty.call(scenarioOutputs, name)
    if (!hasBase || !hasScenario) {
      onlyOneSide.push(name)
      continue
    }
    const from = baselineOutputs[name]
    const to = scenarioOutputs[name]
    deltas.push({
      name,
      baseline: from,
      scenario: to,
      absolute: to - from,
      relative: from === 0 ? null : (to - from) / Math.abs(from),
      direction: to > from ? 'up' : to < from ? 'down' : 'same'
    })
  }
  deltas.sort((a, b) => Math.abs(b.relative ?? 0) - Math.abs(a.relative ?? 0))

  const notes: string[] = []
  if (changedParameters.length === 0) {
    notes.push('Nothing was changed, so any difference in the outputs comes from the model itself rather than from the scenario.')
  }
  if (onlyOneSide.length > 0) {
    notes.push(`${onlyOneSide.join(', ')} exists on only one side, so there is nothing to compare it against.`)
  }
  const unmoved = deltas.filter((one) => one.direction === 'same')
  if (unmoved.length > 0 && changedParameters.length > 0) {
    notes.push(`${unmoved.map((one) => one.name).join(', ')} did not move at all. The parameters that changed do not reach ${unmoved.length === 1 ? 'it' : 'them'}.`)
  }

  return { changedParameters, deltas, onlyOneSide, notes }
}

/** Where two scenarios set the same parameter to different values, which is why they cannot simply be merged. */
export function conflictsBetween(a: Scenario, b: Scenario): { parameterId: string; a: ParameterValue; b: ParameterValue }[] {
  const conflicts: { parameterId: string; a: ParameterValue; b: ParameterValue }[] = []
  for (const [id, value] of Object.entries(a.overrides)) {
    if (!Object.prototype.hasOwnProperty.call(b.overrides, id)) continue
    if (b.overrides[id] !== value) conflicts.push({ parameterId: id, a: value, b: b.overrides[id] })
  }
  return conflicts
}

/** Two scenarios combined, or the conflicts that stop them being. Never resolved silently by preferring one side. */
export function mergeScenarios(a: Scenario, b: Scenario, id: string, name: string): Scenario | StudyError {
  const conflicts = conflictsBetween(a, b)
  if (conflicts.length > 0) {
    return fail(
      'conflict',
      `"${a.name}" and "${b.name}" both set ${conflicts.map((one) => one.parameterId).join(', ')}, to different values. Choose which to keep; merging cannot decide that.`
    )
  }
  return { id, name, parent: a.parent, overrides: { ...a.overrides, ...b.overrides }, describe: `${a.name} combined with ${b.name}` }
}

// ---------------------------------------------------------------- threshold and target search

export interface SearchResult {
  parameterId: string
  /** The value found, or `null` when the target is not crossed anywhere in the range searched. */
  value: number | null
  output: number | null
  /** How close the search got. The target is rarely hit exactly, and pretending it was would be a lie about precision. */
  residual: number | null
  iterations: number
  bracketed: boolean
  describe: string
}

/**
 * The parameter value at which an output reaches a target.
 *
 * Bisection on a bracket, which needs the target to be crossed between the two ends. The alternative -- reading a value
 * off a chart -- is an approximation whose error nobody can state, and this refuses rather than guessing when the
 * bracket does not contain a crossing.
 *
 * A model that crosses the target more than once inside the bracket has more than one answer; bisection finds one of
 * them, and the result says so rather than implying it is the only one.
 */
export function findTarget(
  parameters: readonly Parameter[],
  parameterId: string,
  outputName: string,
  target: number,
  range: { low: number; high: number },
  model: (values: Record<string, ParameterValue>) => Record<string, number>,
  options: { tolerance?: number; maxIterations?: number } = {}
): SearchResult | StudyError {
  const one = parameters.find((p) => p.id === parameterId)
  if (!one) return fail('not-found', `There is no parameter called "${parameterId}".`)
  if (one.type !== 'number' && one.type !== 'quantity' && one.type !== 'integer') {
    return fail('invalid-argument', `${one.name} is not numeric, so there is no value between two others to search.`)
  }
  if (!Number.isFinite(target)) return fail('invalid-argument', 'A target has to be a finite number.')
  if (!Number.isFinite(range.low) || !Number.isFinite(range.high) || range.low >= range.high) {
    return fail('invalid-argument', 'A search range needs a low value below a high one.')
  }

  const values: Record<string, ParameterValue> = {}
  for (const p of parameters) values[p.id] = p.value

  const at = (x: number): number | null => {
    const rounded = one.type === 'integer' ? Math.round(x) : x
    if (checkValue(one, rounded)) return null
    try {
      const result = model({ ...values, [one.id]: rounded })[outputName]
      return Number.isFinite(result) ? result - target : null
    } catch {
      return null
    }
  }

  const fLow = at(range.low)
  const fHigh = at(range.high)
  if (fLow === null || fHigh === null) {
    return fail('not-finite', `The model gives no finite "${outputName}" at one end of the range, so the target cannot be bracketed.`)
  }

  if (fLow === 0) {
    return { parameterId, value: range.low, output: target, residual: 0, iterations: 0, bracketed: true, describe: `${outputName} is exactly ${target} at the bottom of the range.` }
  }
  if (fHigh === 0) {
    return { parameterId, value: range.high, output: target, residual: 0, iterations: 0, bracketed: true, describe: `${outputName} is exactly ${target} at the top of the range.` }
  }
  if (Math.sign(fLow) === Math.sign(fHigh)) {
    return {
      parameterId,
      value: null,
      output: null,
      residual: null,
      iterations: 0,
      bracketed: false,
      describe: `${outputName} is ${fLow > 0 ? 'above' : 'below'} ${target} at both ends of the range tested, so it does not cross it anywhere in between -- or it crosses an even number of times and comes back. Widen the range, or narrow it around where you expect the crossing.`
    }
  }

  const tolerance = options.tolerance ?? 1e-9
  const maxIterations = Math.min(500, Math.max(1, Math.round(options.maxIterations ?? 200)))
  let low = range.low
  let high = range.high
  let lowSign = Math.sign(fLow)
  let middle = (low + high) / 2
  let residual = Number.NaN
  let iterations = 0

  for (; iterations < maxIterations; iterations++) {
    middle = (low + high) / 2
    const value = at(middle)
    if (value === null) {
      return fail('not-finite', `The model gives no finite "${outputName}" partway through the range, at ${middle}.`)
    }
    residual = value
    if (Math.abs(value) <= tolerance || high - low <= Math.abs(middle) * 1e-15) break
    if (Math.sign(value) === lowSign) low = middle
    else high = middle
    lowSign = Math.sign(at(low) ?? lowSign)
  }

  const found = one.type === 'integer' ? Math.round(middle) : middle
  return {
    parameterId,
    value: found,
    output: residual + target,
    residual,
    iterations,
    bracketed: true,
    describe:
      Math.abs(residual) <= tolerance
        ? `${outputName} reaches ${target} when ${one.name} is ${formatValue(found, one)}. Found by bisection in ${iterations} steps; if the model crosses the target more than once in the range, this is one crossing and not necessarily the only one.`
        : `The closest ${one.name} found is ${formatValue(found, one)}, where ${outputName} is ${Number((residual + target).toPrecision(6))} rather than ${target}. Bisection ran out of steps.`
  }
}

// ---------------------------------------------------------------- response surfaces

export interface SurfacePoint {
  x: number
  y: number
  value: number
  /** Whether this point was computed or filled in between computed ones. Never conflated. */
  computed: boolean
}

export interface ResponseSurface {
  xParameter: string
  yParameter: string
  outputName: string
  xValues: number[]
  yValues: number[]
  /** Row-major, indexed `[y][x]`. `null` where the case failed, which is not the same as zero. */
  grid: (number | null)[][]
  points: SurfacePoint[]
  computed: number
  missing: number
  notes: string[]
}

/**
 * A two-parameter grid of results, arranged for a heatmap or contour.
 *
 * A failed case is `null` and stays `null`. Interpolating over it would produce a smooth surface with a hole filled in
 * by arithmetic rather than by the model, and a reader has no way to tell the difference once it is drawn.
 */
export function responseSurface(
  results: readonly CaseResult[],
  xParameter: string,
  yParameter: string,
  outputName: string
): ResponseSurface | StudyError {
  const xSet = new Set<number>()
  const ySet = new Set<number>()
  for (const one of results) {
    const x = one.values[xParameter]
    const y = one.values[yParameter]
    if (typeof x !== 'number' || typeof y !== 'number') {
      return fail('invalid-argument', 'A response surface needs both parameters to be numeric.')
    }
    xSet.add(x)
    ySet.add(y)
  }
  if (xSet.size === 0) return fail('no-values', 'There are no results to build a surface from.')

  const xValues = [...xSet].sort((a, b) => a - b)
  const yValues = [...ySet].sort((a, b) => a - b)
  const xIndex = new Map(xValues.map((one, i) => [one, i]))
  const yIndex = new Map(yValues.map((one, i) => [one, i]))

  const grid: (number | null)[][] = yValues.map(() => new Array<number | null>(xValues.length).fill(null))
  const points: SurfacePoint[] = []
  let computed = 0
  for (const one of results) {
    const x = one.values[xParameter] as number
    const y = one.values[yParameter] as number
    const value = one.status === 'completed' ? one.outputs[outputName] : undefined
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    grid[yIndex.get(y) as number][xIndex.get(x) as number] = value
    points.push({ x, y, value, computed: true })
    computed += 1
  }

  const cells = xValues.length * yValues.length
  const notes: string[] = []
  if (computed < cells) {
    notes.push(
      `${cells - computed} of ${cells} points on the grid have no value, because those cases failed or were not run. They are left empty rather than filled in, so nothing drawn from this shows a value the model did not produce.`
    )
  }
  if (computed < results.length) {
    notes.push(`${results.length - computed} results were not placed, because they did not produce "${outputName}".`)
  }

  return { xParameter, yParameter, outputName, xValues, yValues, grid, points, computed, missing: cells - computed, notes }
}

// ---------------------------------------------------------------- robustness and summary

export interface Robustness {
  outputName: string
  minimum: number
  maximum: number
  range: number
  median: number
  /** The interquartile range divided by the median: a scale-free measure of spread, defined where the median is not zero. */
  spread: number | null
  /**
   * The share of cases inside a band around the baseline. Defined by the band, which the caller sets -- there is no
   * universal "robust", and a number that did not say what it measured would be an invented score.
   */
  withinBand: { fraction: number; band: number } | null
  worstCase: { caseId: string; value: number } | null
  bestCase: { caseId: string; value: number } | null
  cases: number
  notes: string[]
}

/**
 * How much an output varies across everything that was run.
 *
 * Every figure here is a plain statistic of the results with its definition attached. There is deliberately no single
 * "robustness score": one would need a weighting of range against spread against worst case that nothing in the problem
 * supplies, and inventing one would produce a number that looks comparable between studies and is not.
 */
export function robustness(
  run: StudyRun,
  outputName: string,
  options: { baseline?: number; band?: number; higherIsBetter?: boolean } = {}
): Robustness | StudyError {
  const usable = run.results.filter(
    (one) => one.status === 'completed' && typeof one.outputs[outputName] === 'number' && Number.isFinite(one.outputs[outputName])
  )
  if (usable.length === 0) return fail('no-values', `No completed case produced a finite "${outputName}".`)

  const values = usable.map((one) => one.outputs[outputName])
  const sorted = [...values].sort((a, b) => a - b)
  const median = percentile(sorted, 0.5) as number
  const q1 = percentile(sorted, 0.25) as number
  const q3 = percentile(sorted, 0.75) as number

  const higherIsBetter = options.higherIsBetter ?? true
  const byValue = [...usable].sort((a, b) => a.outputs[outputName] - b.outputs[outputName])
  const lowest = byValue[0]
  const highest = byValue[byValue.length - 1]

  let withinBand: Robustness['withinBand'] = null
  if (options.baseline !== undefined && options.band !== undefined && Number.isFinite(options.baseline) && options.band > 0) {
    const inside = values.filter((one) => Math.abs(one - (options.baseline as number)) <= (options.band as number)).length
    withinBand = { fraction: inside / values.length, band: options.band }
  }

  const notes: string[] = [
    `Measured across the ${usable.length} of ${run.results.length} cases that completed. A study with failures measures the part of the range the model covers, not the range that was asked for.`
  ]
  if (run.failed > 0) notes.push(`${run.failed} cases failed and are not included.`)

  return {
    outputName,
    minimum: sorted[0],
    maximum: sorted[sorted.length - 1],
    range: sorted[sorted.length - 1] - sorted[0],
    median,
    spread: median === 0 ? null : (q3 - q1) / Math.abs(median),
    withinBand,
    worstCase: higherIsBetter
      ? { caseId: lowest.caseId, value: lowest.outputs[outputName] }
      : { caseId: highest.caseId, value: highest.outputs[outputName] },
    bestCase: higherIsBetter
      ? { caseId: highest.caseId, value: highest.outputs[outputName] }
      : { caseId: lowest.caseId, value: lowest.outputs[outputName] },
    cases: usable.length,
    notes
  }
}

export interface StudyDifference {
  addedParameters: string[]
  removedParameters: string[]
  changedParameters: { id: string; from: string; to: string }[]
  addedCases: string[]
  removedCases: string[]
  changedResults: { caseId: string; outputName: string; from: number; to: number }[]
  sameFingerprint: boolean
  notes: string[]
}

/** Two studies compared: what changed in the configuration and what changed in the answers. */
export function compareStudies(
  a: { parameters: readonly Parameter[]; run: StudyRun },
  b: { parameters: readonly Parameter[]; run: StudyRun }
): StudyDifference {
  const aParams = new Map(a.parameters.map((one) => [one.id, one]))
  const bParams = new Map(b.parameters.map((one) => [one.id, one]))

  const describe = (one: Parameter): string => `${one.type} ${String(one.value)}${one.unit?.display ? ` ${one.unit.display}` : ''}${one.locked ? ' (locked)' : ''}`

  const addedParameters = [...bParams.keys()].filter((id) => !aParams.has(id))
  const removedParameters = [...aParams.keys()].filter((id) => !bParams.has(id))
  const changedParameters: StudyDifference['changedParameters'] = []
  for (const [id, one] of aParams) {
    const other = bParams.get(id)
    if (!other) continue
    if (describe(one) !== describe(other)) changedParameters.push({ id, from: describe(one), to: describe(other) })
  }

  const aResults = new Map(a.run.results.map((one) => [one.caseId, one]))
  const bResults = new Map(b.run.results.map((one) => [one.caseId, one]))
  const addedCases = [...bResults.keys()].filter((id) => !aResults.has(id))
  const removedCases = [...aResults.keys()].filter((id) => !bResults.has(id))

  const changedResults: StudyDifference['changedResults'] = []
  for (const [id, one] of aResults) {
    const other = bResults.get(id)
    if (!other) continue
    for (const name of new Set([...Object.keys(one.outputs), ...Object.keys(other.outputs)])) {
      const from = one.outputs[name]
      const to = other.outputs[name]
      if (typeof from === 'number' && typeof to === 'number' && from !== to) {
        changedResults.push({ caseId: id, outputName: name, from, to })
      }
    }
  }

  const sameFingerprint = a.run.fingerprint === b.run.fingerprint
  const notes: string[] = []
  if (sameFingerprint && changedResults.length > 0) {
    notes.push(
      `${changedResults.length} results differ although the model and parameters are recorded as the same. Either something not in the fingerprint changed, or the model is not deterministic.`
    )
  }
  if (!sameFingerprint && changedResults.length === 0 && addedCases.length === 0 && removedCases.length === 0) {
    notes.push('The configuration changed but every result is the same, so whatever changed does not reach these outputs.')
  }

  return { addedParameters, removedParameters, changedParameters, addedCases, removedCases, changedResults, sameFingerprint, notes }
}

/** The assumptions the engine rests on, for a Page that wants to show them rather than have them inferred. */
export const STUDY_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Every case runs the real model. Nothing between computed points is filled in unless it is marked as filled in.',
  'A case identifier is positional, so the same configuration produces the same identifiers every time and two runs can be compared.',
  'A study that did not finish reports how many cases ran and how many did not, rather than reporting the ones that did.',
  'A failed case keeps its parameters, so the part of the range the model does not cover can be seen.',
  'One-at-a-time sensitivity measures each parameter with the rest at baseline, and does not add up to moving several at once where a model has interactions.',
  'A finite-difference derivative depends on the step it was taken over, so the step is reported with it.',
  'A threshold is found by bisecting the real model, never by reading a value off a chart.',
  'Results carry the fingerprint of the model and parameters they came from, and are marked stale when either changes.'
])
