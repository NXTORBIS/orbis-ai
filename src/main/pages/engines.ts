/**
 * The engines a Page can reach, and the reading of what it sent.
 *
 * `service.ts` decides *whether* an operation may run. This file is what runs once it may: the bridge between a payload
 * that arrived from untrusted code and the computation modules, which expect real arguments.
 *
 * ## A Page never sends code
 *
 * Several of these engines take a function -- an objective to minimise, a system of equations to integrate, a curve to
 * plot. A Page cannot send one of those, and this file does not accept one. Instead a Page sends an **expression**, as
 * text, and `compile` turns it into a callable using the AST interpreter in `expression.ts`.
 *
 * That is the whole point. The interpreter walks a parsed tree; there is no `eval`, no `new Function`, and no path by
 * which text from a Page becomes code the JavaScript engine runs. A Page describing `x^2 + 3x` gets arithmetic. A Page
 * sending `process.exit()` gets a parse error, because that is not an expression.
 *
 * ## Everything is bounded
 *
 * An optimizer will call an objective a hundred thousand times, and a sweep multiplies that again. So every operation
 * runs against a shared evaluation budget: the compiled function counts every call, and the budget throws when it runs
 * out. Without that, one Page sending a slow expression to a multi-start optimizer makes the main process unresponsive,
 * and no capability check would have stopped it -- the Page was allowed to do arithmetic, and that is all it did.
 */

import {
  evaluateExpression,
  isEvaluateError,
  isParseError,
  parseExpression,
  sizeOf,
  type Expression
} from '../../shared/compute/expression.ts'
import {
  DISTRIBUTIONS,
  chiSquareTest,
  describeCorrelation,
  histogram,
  isStatisticsError,
  meanInterval,
  outliers,
  pairedT,
  pearson,
  quantileOf,
  ranks,
  regress,
  spearman,
  summarise,
  twoSampleT,
  oneSampleT,
  weightedMean
} from '../../shared/compute/statistics.ts'
import {
  DATA_ASSUMPTIONS,
  aggregateCells,
  buildTable,
  columnIndex,
  filterTable,
  groupBy,
  joinTables,
  parseDelimited,
  profileTable,
  retypeColumn,
  sortTable,
  toDelimited,
  type Aggregate,
  type Comparison,
  type Condition,
  type Filter,
  type Table
} from '../../shared/compute/data.ts'
import {
  axisFor,
  buildPlot,
  decimate,
  isPlotError,
  samplePolar,
  sampleFunction,
  sampleParametric,
  seriesFromPoints,
  seriesFromSamples,
  type Point
} from '../../shared/compute/plot.ts'
import {
  addMeasurements,
  agree,
  convertMeasurement,
  describeMeasurement,
  divideMeasurements,
  fromRepeated,
  isMeasurementError,
  measurement,
  multiplyMeasurements,
  propagateByMonteCarlo,
  reportMeasurement,
  significantFigures,
  subtractMeasurements,
  type Measurement,
  type Provenance,
  type Uncertainty
} from '../../shared/compute/measurement.ts'
import {
  isOptimizeError,
  minimise,
  minimiseConstrained,
  minimiseOnInterval,
  multiStart,
  solveLinearProgramme,
  type Bound,
  type LinearConstraint
} from '../../shared/compute/optimize.ts'
import {
  compareStepSizes,
  integrate,
  isSimulationError,
  monteCarlo,
  sensitivity,
  summariseOutcomes,
  sweep,
  withInvariant,
  type Derivative,
  type SweepAxis
} from '../../shared/compute/simulation.ts'

/** Which capability each of these operations needs. Merged into the service's map, so the same deny-by-default applies. */
export const ENGINE_CAPABILITY: Readonly<Record<string, string>> = Object.freeze({
  'statistics.summarise': 'computation.statistics',
  'statistics.weighted': 'computation.statistics',
  'statistics.correlate': 'computation.statistics',
  'statistics.regress': 'computation.statistics',
  'statistics.interval': 'computation.statistics',
  'statistics.test': 'computation.statistics',
  'statistics.distribution': 'computation.statistics',
  'statistics.outliers': 'computation.statistics',
  'statistics.histogram': 'computation.statistics',
  'statistics.ranks': 'computation.statistics',

  'data.parse': 'computation.data',
  'data.profile': 'computation.data',
  'data.sort': 'computation.data',
  'data.filter': 'computation.data',
  'data.aggregate': 'computation.data',
  'data.join': 'computation.data',
  'data.retype': 'computation.data',
  'data.export': 'computation.data',

  'plot.function': 'computation.plot',
  'plot.parametric': 'computation.plot',
  'plot.polar': 'computation.plot',
  'plot.points': 'computation.plot',
  'plot.axis': 'computation.plot',
  'plot.decimate': 'computation.plot',

  'measurement.make': 'computation.measurement',
  'measurement.combine': 'computation.measurement',
  'measurement.repeated': 'computation.measurement',
  'measurement.convert': 'computation.measurement',
  'measurement.agree': 'computation.measurement',
  'measurement.propagate': 'computation.measurement',
  'measurement.figures': 'computation.measurement',

  'optimise.interval': 'computation.optimise',
  'optimise.minimise': 'computation.optimise',
  'optimise.multistart': 'computation.optimise',
  'optimise.linear': 'computation.optimise',
  'optimise.constrained': 'computation.optimise',

  'simulate.integrate': 'computation.simulate',
  'simulate.invariant': 'computation.simulate',
  'simulate.steps': 'computation.simulate',
  'simulate.montecarlo': 'computation.simulate',
  'simulate.sweep': 'computation.simulate',
  'simulate.sensitivity': 'computation.simulate'
})

/** How much any one operation may be given, and how much work it may cause. */
export const ENGINE_LIMITS: Readonly<Record<'expression' | 'nodes' | 'values' | 'rows' | 'columns' | 'text' | 'evaluations' | 'variables' | 'series' | 'trials', number>> = Object.freeze({
  expression: 2000,
  nodes: 4000,
  /** Numbers in a single array argument. */
  values: 100_000,
  /** Rows and columns of a table sent in one message. */
  rows: 50_000,
  columns: 512,
  /** Characters of text handed to the delimited parser. */
  text: 4 * 1024 * 1024,
  /**
   * Calls to a compiled expression across one whole operation.
   *
   * 500,000 rather than a rounder, larger number because it has to actually bind. The hungriest single request
   * reachable through this file is a fine-stepped RK4 integration, which costs four evaluations per step and tops out
   * near 800,000 -- so a ceiling above that would never be reached by anything and would be decoration. At this size a
   * request that reaches the ceiling has already spent roughly a tenth of a second of the main process, which is about
   * as long as one Page should be able to hold it.
   */
  evaluations: 500_000,
  variables: 32,
  series: 20,
  trials: 5000
})

/** Thrown for anything the caller got wrong. Caught in `service.ts` and turned into a refusal the Page can read. */
class BadInput extends Error {}

const fail = (message: string): never => {
  throw new BadInput(message)
}

// ---------------------------------------------------------------- reading a payload

/**
 * Readers for an untrusted payload.
 *
 * Every one of these either returns the right type or throws. Nothing coerces: a string where a number belongs is an
 * error rather than a `NaN` that travels three functions before causing a confusing failure.
 */
class Reader {
  // Written out rather than as a parameter property: Node runs this file by stripping types, and a parameter property
  // is syntax rather than a type, so it would not survive the strip.
  private readonly input: Record<string, unknown>

  constructor(input: Record<string, unknown>) {
    this.input = input
  }

  has(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.input, key) && this.input[key] !== undefined
  }

  raw(key: string): unknown {
    return Object.prototype.hasOwnProperty.call(this.input, key) ? this.input[key] : undefined
  }

  text(key: string, max = ENGINE_LIMITS.expression): string {
    const value = this.raw(key)
    if (typeof value !== 'string') return fail(`"${key}" has to be text.`)
    if (value.length > max) return fail(`"${key}" is longer than the ${max} characters allowed.`)
    return value
  }

  optionalText(key: string, fallback = '', max = ENGINE_LIMITS.expression): string {
    return this.has(key) ? this.text(key, max) : fallback
  }

  number(key: string): number {
    const value = this.raw(key)
    if (typeof value !== 'number' || !Number.isFinite(value)) return fail(`"${key}" has to be a finite number.`)
    return value
  }

  optionalNumber(key: string, fallback: number): number {
    return this.has(key) ? this.number(key) : fallback
  }

  boolean(key: string, fallback = false): boolean {
    const value = this.raw(key)
    if (value === undefined) return fallback
    if (typeof value !== 'boolean') return fail(`"${key}" has to be true or false.`)
    return value
  }

  numbers(key: string, max = ENGINE_LIMITS.values): number[] {
    const value = this.raw(key)
    if (!Array.isArray(value)) return fail(`"${key}" has to be a list of numbers.`)
    if (value.length > max) return fail(`"${key}" has more than the ${max} values allowed.`)
    // Non-numbers are refused rather than filtered: a caller who sent one has a bug, and hiding it does them no favours.
    return value.map((one, i) => {
      if (typeof one !== 'number' || !Number.isFinite(one)) {
        return fail(`"${key}" has something at position ${i + 1} that is not a finite number.`)
      }
      return one
    })
  }

  strings(key: string, max = ENGINE_LIMITS.columns): string[] {
    const value = this.raw(key)
    if (!Array.isArray(value)) return fail(`"${key}" has to be a list of text.`)
    if (value.length > max) return fail(`"${key}" has more than the ${max} entries allowed.`)
    return value.map((one, i) => {
      if (typeof one !== 'string') return fail(`"${key}" has something at position ${i + 1} that is not text.`)
      if (one.length > 1000) return fail(`"${key}" has an entry at position ${i + 1} that is too long.`)
      return one
    })
  }

  list(key: string, max: number): Record<string, unknown>[] {
    const value = this.raw(key)
    if (!Array.isArray(value)) return fail(`"${key}" has to be a list.`)
    if (value.length > max) return fail(`"${key}" has more than the ${max} entries allowed.`)
    return value.map((one, i) => {
      if (typeof one !== 'object' || one === null || Array.isArray(one)) {
        return fail(`"${key}" has something at position ${i + 1} that is not an object.`)
      }
      return one as Record<string, unknown>
    })
  }

  /** A `{name: number}` map, with its keys checked so nothing reaches a prototype. */
  named(key: string, max = ENGINE_LIMITS.variables): Record<string, number> {
    const value = this.raw(key)
    if (value === undefined) return {}
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return fail(`"${key}" has to be a set of named values.`)
    }
    const out: Record<string, number> = Object.create(null)
    let count = 0
    for (const [name, held] of Object.entries(value as Record<string, unknown>)) {
      if (count >= max) return fail(`"${key}" has more than the ${max} names allowed.`)
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return fail(`"${name}" is not a usable name.`)
      if (typeof held !== 'number' || !Number.isFinite(held)) return fail(`"${name}" has to be a finite number.`)
      out[name] = held
      count += 1
    }
    // Back to a plain object, but built from a null-prototype one, so no inherited key can have been picked up.
    return { ...out }
  }

  choice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
    const value = this.raw(key)
    if (value === undefined) return fallback
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      return fail(`"${key}" has to be one of: ${allowed.join(', ')}.`)
    }
    return value as T
  }

  points(key: string): Point[] {
    const value = this.raw(key)
    if (!Array.isArray(value)) return fail(`"${key}" has to be a list of points.`)
    if (value.length > ENGINE_LIMITS.values) return fail(`"${key}" has more than the ${ENGINE_LIMITS.values} points allowed.`)
    return value.map((one, i) => {
      if (typeof one !== 'object' || one === null) return fail(`"${key}" has something at position ${i + 1} that is not a point.`)
      const record = one as Record<string, unknown>
      const x = record.x
      const y = record.y
      if (typeof x !== 'number' || typeof y !== 'number') {
        return fail(`"${key}" has a point at position ${i + 1} without a numeric x and y.`)
      }
      return { x, y }
    })
  }
}

// ---------------------------------------------------------------- expressions as models

/**
 * A shared ceiling on how much work one operation may cause.
 *
 * Held per operation rather than per call, because the thing worth bounding is the total. An optimizer making a hundred
 * thousand cheap calls and one making a thousand expensive ones are the same problem from the process's point of view.
 */
class Budget {
  private spent = 0
  private over = false
  private readonly ceiling: number

  constructor(ceiling: number) {
    this.ceiling = ceiling
  }

  /**
   * One call spent. Returns whether there was any left.
   *
   * A flag rather than an exception, and that is not a style choice. Several of these engines catch anything their model
   * throws and treat it as "no value here" -- the integrator does exactly that, so a `throw` from in here was being
   * swallowed and reported as a broken model rather than as an exhausted budget. A flag cannot be caught by accident.
   * The caller returns a non-finite value, the engine stops on its own terms, and `runEngineOperation` reports the real
   * reason once it is back in charge.
   */
  spend(): boolean {
    if (this.over) return false
    this.spent += 1
    if (this.spent > this.ceiling) {
      this.over = true
      return false
    }
    return true
  }

  get exhausted(): boolean {
    return this.over
  }

  get used(): number {
    return this.spent
  }

  get limit(): number {
    return this.ceiling
  }
}

/** An expression, parsed and size-checked. */
function parse(text: string): Expression {
  const parsed = parseExpression(text)
  if (isParseError(parsed)) throw new BadInput(parsed.message)
  if (sizeOf(parsed) > ENGINE_LIMITS.nodes) throw new BadInput('That expression is too large to work with.')
  return parsed
}

/**
 * An expression turned into a callable.
 *
 * The returned function evaluates the parsed tree with the interpreter. Text from a Page never becomes JavaScript: there
 * is no `eval` and no `new Function` anywhere on this path, and a Page sending something that is not an expression gets a
 * parse error rather than a running program.
 *
 * A point where the expression has no value returns `NaN` rather than throwing, because every engine that takes a
 * function here already treats a non-finite result as "undefined here" and handles it -- an optimizer walks away from
 * such a point, and a plot breaks the curve. Throwing would turn a hole in a domain into a failed request.
 */
function compile(text: string, names: readonly string[], budget: Budget, extra: Record<string, number> = {}) {
  const tree = parse(text)
  for (const name of names) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new BadInput(`"${name}" is not a usable variable name.`)
  }
  return (values: readonly number[]): number => {
    // Out of budget reads as "no value here", which every engine taking one of these already handles.
    if (!budget.spend()) return Number.NaN
    const scope: Record<string, number> = { ...extra }
    for (let i = 0; i < names.length; i++) scope[names[i]] = values[i]
    const result = evaluateExpression(tree, scope)
    // Not finite here means "no value at this point", which every caller of this already knows how to handle.
    return isEvaluateError(result) ? Number.NaN : result
  }
}

/** Several expressions compiled as one system, for a set of differential equations. */
function compileSystem(texts: readonly string[], names: readonly string[], budget: Budget, timeName: string): Derivative {
  if (texts.length !== names.length) {
    throw new BadInput(`There are ${names.length} variables but ${texts.length} rates of change. Every variable needs one.`)
  }
  const trees = texts.map((one) => parse(one))
  for (const name of names) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new BadInput(`"${name}" is not a usable variable name.`)
  }
  return (time, values) => {
    if (!budget.spend()) return names.map(() => Number.NaN)
    const scope: Record<string, number> = { [timeName]: time }
    for (let i = 0; i < names.length; i++) scope[names[i]] = values[i]
    return trees.map((tree) => {
      const result = evaluateExpression(tree, scope)
      // A rate that has no value is returned as NaN, and the integrator refuses the whole run rather than stepping on.
      return isEvaluateError(result) ? Number.NaN : result
    })
  }
}

// ---------------------------------------------------------------- results

/** Anything from an engine that may be an error, turned into a result a Page can read. */
const settle = <T>(value: T, isError: (one: unknown) => boolean): unknown =>
  isError(value) ? { ok: false, ...(value as object) } : { ok: true, ...(value as object) }

/** A measurement in a shape that survives being sent to a Page. */
const measurementOut = (one: Measurement): Record<string, unknown> => ({
  value: one.value,
  unit: one.unit.display,
  dimension: one.unit.dimension,
  uncertainty: one.uncertainty,
  provenance: one.provenance,
  resolution: one.resolution,
  note: one.note,
  report: reportMeasurement(one),
  describe: describeMeasurement(one)
})

/** A table in a shape that survives being sent to a Page. */
const tableOut = (table: Table): Record<string, unknown> => ({
  columns: table.columns.map((one) => ({
    id: one.id,
    name: one.name,
    type: one.type,
    unit: one.unit?.display ?? null,
    confidence: one.confidence,
    reason: one.reason,
    categories: one.categories
  })),
  rows: table.rows.map((row) => ({ id: row.id, cells: row.cells })),
  source: table.source
})

// ---------------------------------------------------------------- the dispatch

/**
 * One engine operation, carried out.
 *
 * Reached only from `service.ts`, and only after the capability check has passed. Everything it throws is a `BadInput`
 * carrying a message meant for the person using the Page.
 *
 * The budget is checked here, after the engine has returned, rather than inside the expression it bounds -- see
 * `Budget.spend`. An engine that ran out of budget will have produced *something*, usually a truncated or empty answer,
 * and reporting that as a result would be worse than reporting nothing: it looks like an answer.
 */
export function runEngineOperation(operation: string, input: Record<string, unknown>): unknown {
  const budget = new Budget(ENGINE_LIMITS.evaluations)
  const value = dispatch(operation, input, budget)
  if (budget.exhausted) {
    throw new BadInput(
      `This ran past the ${budget.limit.toLocaleString('en')} calculations one request is allowed, so there is no answer to give. Narrow the range, take a larger step, use fewer points, or split it into several requests.`
    )
  }
  return value
}

function dispatch(operation: string, input: Record<string, unknown>, budget: Budget): unknown {
  const read = new Reader(input)

  switch (operation) {
    // ---------------------------------------------------------------- statistics
    case 'statistics.summarise':
      return settle(summarise(read.numbers('values')), isStatisticsError)

    case 'statistics.correlate': {
      const a = read.numbers('a')
      const b = read.numbers('b')
      const kind = read.choice('kind', ['pearson', 'spearman'] as const, 'pearson')
      const r = kind === 'pearson' ? pearson(a, b) : spearman(a, b)
      if (isStatisticsError(r)) return { ok: false, ...r }
      // The description always ends with the causation warning, which is the point of returning it rather than a number.
      return { ok: true, kind, correlation: r, describe: describeCorrelation(r) }
    }

    case 'statistics.regress': {
      // Predictors first, then the outcome: the engine's own order, kept rather than quietly swapped here.
      const predictors = read.list('predictors', ENGINE_LIMITS.variables).map((one) => new Reader(one).numbers('values'))
      return settle(regress(predictors, read.numbers('outcome')), isStatisticsError)
    }

    case 'statistics.interval':
      return settle(meanInterval(read.numbers('values'), read.optionalNumber('level', 0.95)), isStatisticsError)

    case 'statistics.test': {
      const kind = read.choice('kind', ['one-sample', 'two-sample', 'paired', 'chi-square'] as const, 'one-sample')
      switch (kind) {
        case 'one-sample':
          return settle(oneSampleT(read.numbers('values'), read.number('against')), isStatisticsError)
        case 'two-sample':
          return settle(twoSampleT(read.numbers('a'), read.numbers('b')), isStatisticsError)
        case 'paired':
          return settle(pairedT(read.numbers('a'), read.numbers('b')), isStatisticsError)
        case 'chi-square': {
          const raw = read.raw('observed')
          if (!Array.isArray(raw)) return fail('"observed" has to be a list of rows of counts.')
          if (raw.length > 100) return fail('"observed" has more than the 100 rows allowed.')
          const observed = raw.map((row, i) => new Reader({ row }).numbers('row', 100).map((one) => {
            if (one < 0) return fail(`Row ${i + 1} has a negative count, which is not a count.`)
            return one
          }))
          return settle(chiSquareTest(observed), isStatisticsError)
        }
      }
      break
    }

    case 'statistics.distribution': {
      const id = read.text('distribution', 64)
      // `hasOwnProperty`, not indexing: `DISTRIBUTIONS['constructor']` would otherwise be a function.
      if (!Object.prototype.hasOwnProperty.call(DISTRIBUTIONS, id)) {
        return fail(`Orbis has no distribution called "${id}".`)
      }
      const shape = DISTRIBUTIONS[id]
      const parameters = read.numbers('parameters', 16)
      const at = read.optionalNumber('at', Number.NaN)
      const probability = read.optionalNumber('probability', Number.NaN)
      return {
        ok: true,
        id: shape.id,
        name: shape.name,
        support: shape.support,
        discrete: shape.discrete,
        parameters: shape.parameters,
        density: Number.isFinite(at) ? shape.density(at, ...parameters) : null,
        cumulative: Number.isFinite(at) ? shape.cumulative(at, ...parameters) : null,
        quantile: Number.isFinite(probability) ? quantileOf(shape, probability, ...parameters) : null
      }
    }

    case 'statistics.outliers':
      return settle(
        outliers(read.numbers('values'), read.choice('method', ['iqr', 'z-score', 'modified-z'] as const, 'iqr')),
        isStatisticsError
      )

    case 'statistics.histogram':
      return settle(
        histogram(
          read.numbers('values'),
          read.choice('rule', ['freedman-diaconis', 'sturges', 'square-root', 'fixed'] as const, 'freedman-diaconis'),
          read.has('bins') ? read.number('bins') : undefined
        ),
        isStatisticsError
      )

    case 'statistics.ranks': {
      const result = ranks(read.numbers('values'))
      if (isStatisticsError(result)) return { ok: false, ...result }
      return { ok: true, ranks: result }
    }

    // ---------------------------------------------------------------- weighted mean sits with statistics
    case 'statistics.weighted':
      return settle(weightedMean(read.numbers('values'), read.numbers('weights')), isStatisticsError)

    // ---------------------------------------------------------------- data
    case 'data.parse': {
      const result = parseDelimited(read.text('text', ENGINE_LIMITS.text), {
        delimiter: read.has('delimiter') ? read.text('delimiter', 8) : undefined,
        header: read.has('header') ? read.boolean('header') : undefined,
        source: read.optionalText('source', '', 200) || undefined
      })
      if ('error' in result) return { ok: false, ...result }
      // The delimiter and the header row were both guesses, so they come back with the notes that say how.
      return {
        ok: true,
        table: tableOut(result.table),
        delimiter: result.delimiter,
        headerRow: result.headerRow,
        notes: result.notes,
        assumptions: DATA_ASSUMPTIONS
      }
    }

    case 'data.profile': {
      const table = tableFrom(read)
      return { ok: true, ...profileTable(table) }
    }

    case 'data.sort': {
      const keys = read.list('keys', ENGINE_LIMITS.columns).map((one) => {
        const entry = new Reader(one)
        return { columnId: entry.text('column', 200), descending: entry.boolean('descending', false) }
      })
      if (keys.length === 0) return fail('Sorting needs at least one column to sort by.')
      const sorted = sortTable(tableFrom(read), keys)
      if ('error' in sorted) return { ok: false, ...sorted }
      return { ok: true, table: tableOut(sorted) }
    }

    case 'data.filter': {
      const table = tableFrom(read)
      const before = table.rows.length
      const filtered = filterTable(table, filterFrom(read, 'filter', 0))
      if ('error' in filtered) return { ok: false, ...filtered }
      return {
        ok: true,
        table: tableOut(filtered),
        // How many rows a filter removed is the thing people get wrong about their own filters, so it is part of the answer.
        kept: filtered.rows.length,
        removed: before - filtered.rows.length
      }
    }

    case 'data.aggregate': {
      const table = tableFrom(read)
      const aggregate = read.choice(
        'aggregate',
        ['count', 'count-values', 'count-distinct', 'sum', 'mean', 'median', 'minimum', 'maximum', 'standard-deviation', 'first', 'last'] as const,
        'count'
      ) as Aggregate
      const by = read.has('by') ? read.strings('by', 8) : []
      const columnId = read.text('column', 200)

      if (by.length > 0) {
        const groups = groupBy(table, by, [{ columnId, aggregate }])
        if ('error' in groups) return { ok: false, ...groups }
        return {
          ok: true,
          grouped: true,
          groups: groups.map((group) => ({
            key: group.keyText,
            rows: group.rows.length,
            values: group.values
          }))
        }
      }

      const at = columnIndex(table, columnId)
      if (at < 0) return { ok: false, error: 'unknown-column', message: `There is no column called "${columnId}".` }
      const value = aggregateCells(table.rows.map((row) => row.cells[at]), aggregate, table.columns[at])
      return { ok: true, grouped: false, aggregate, value }
    }

    case 'data.join': {
      const left = tableFrom(read, 'left')
      const right = tableFrom(read, 'right')
      const joined = joinTables(
        left,
        right,
        read.text('leftColumn', 200),
        read.text('rightColumn', 200),
        read.choice('kind', ['inner', 'left', 'full'] as const, 'inner')
      )
      if ('error' in joined) return { ok: false, ...joined }
      return { ok: true, ...joined, table: tableOut(joined.table) }
    }

    case 'data.retype': {
      const retyped = retypeColumn(
        tableFrom(read),
        read.text('column', 200),
        read.choice('type', ['number', 'integer', 'text', 'date', 'boolean', 'category', 'quantity'] as const, 'text'),
        read.has('unit') ? read.text('unit', 200) : undefined
      )
      if ('error' in retyped) return { ok: false, ...retyped }
      return { ok: true, table: tableOut(retyped) }
    }

    case 'data.export': {
      const text = toDelimited(tableFrom(read), read.optionalText('delimiter', ',', 8))
      return { ok: true, text }
    }

    // ---------------------------------------------------------------- plotting
    case 'plot.function': {
      const variable = read.optionalText('variable', 'x', 40)
      const f = compile(read.text('expression'), [variable], budget, read.named('parameters'))
      const sampled = sampleFunction((x) => f([x]), read.number('from'), read.number('to'), {
        initial: read.has('initial') ? read.number('initial') : undefined,
        tolerance: read.has('tolerance') ? read.number('tolerance') : undefined,
        maximum: read.has('maximum') ? read.number('maximum') : undefined
      })
      if (isPlotError(sampled)) return { ok: false, ...sampled }
      const series = seriesFromSamples('f', read.optionalText('label', read.text('expression'), 200), sampled)
      return { ok: true, series, evaluations: budget.used }
    }

    case 'plot.parametric': {
      const parameter = read.optionalText('parameter', 't', 40)
      const named = read.named('parameters')
      const fx = compile(read.text('x'), [parameter], budget, named)
      const fy = compile(read.text('y'), [parameter], budget, named)
      const sampled = sampleParametric((t) => fx([t]), (t) => fy([t]), read.number('from'), read.number('to'), {
        initial: read.has('initial') ? read.number('initial') : undefined
      })
      if (isPlotError(sampled)) return { ok: false, ...sampled }
      return { ok: true, series: seriesFromSamples('p', read.optionalText('label', 'curve', 200), sampled), evaluations: budget.used }
    }

    case 'plot.polar': {
      const parameter = read.optionalText('parameter', 'theta', 40)
      const r = compile(read.text('expression'), [parameter], budget, read.named('parameters'))
      const sampled = samplePolar((t) => r([t]), read.optionalNumber('from', 0), read.optionalNumber('to', Math.PI * 2), {
        initial: read.has('initial') ? read.number('initial') : undefined
      })
      if (isPlotError(sampled)) return { ok: false, ...sampled }
      return { ok: true, series: seriesFromSamples('r', read.optionalText('label', 'curve', 200), sampled), evaluations: budget.used }
    }

    case 'plot.points': {
      const series = read.list('series', ENGINE_LIMITS.series).map((one, i) => {
        const entry = new Reader(one)
        return seriesFromPoints(entry.optionalText('id', `s${i}`, 80), entry.optionalText('label', `series ${i + 1}`, 200), entry.points('points'), {
          kind: entry.choice('kind', ['line', 'scatter', 'area', 'bar', 'step'] as const, 'line'),
          provenance: entry.choice('provenance', ['measured', 'computed', 'simulated', 'imported', 'unknown'] as const, 'unknown'),
          gapLargerThan: entry.has('gapLargerThan') ? entry.number('gapLargerThan') : undefined
        })
      })
      const plot = buildPlot(read.optionalText('id', 'plot', 80), series, {
        title: read.optionalText('title', '', 200),
        equalAspect: read.boolean('equalAspect', false)
      })
      if (isPlotError(plot)) return { ok: false, ...plot }
      return { ok: true, plot }
    }

    case 'plot.axis':
      return settle(
        axisFor(read.numbers('values'), {
          scale: read.choice('scale', ['linear', 'log', 'symlog'] as const, 'linear'),
          label: read.optionalText('label', '', 200),
          includeZero: read.boolean('includeZero', false),
          ticks: read.has('ticks') ? read.number('ticks') : undefined
        }),
        isPlotError
      )

    case 'plot.decimate': {
      const result = decimate(read.points('points'), read.optionalNumber('target', 4000))
      return { ok: true, ...result }
    }

    // ---------------------------------------------------------------- measurement
    case 'measurement.make': {
      const one = measurementFrom(read)
      return { ok: true, ...measurementOut(one) }
    }

    case 'measurement.combine': {
      const a = measurementFrom(read, 'a')
      const b = measurementFrom(read, 'b')
      const how = read.choice('how', ['add', 'subtract', 'multiply', 'divide'] as const, 'add')
      const correlation = read.optionalNumber('correlation', 0)
      const result =
        how === 'add'
          ? addMeasurements(a, b, correlation)
          : how === 'subtract'
            ? subtractMeasurements(a, b, correlation)
            : how === 'multiply'
              ? multiplyMeasurements(a, b, correlation)
              : divideMeasurements(a, b, correlation)
      if (isMeasurementError(result)) return { ok: false, ...result }
      return { ok: true, ...measurementOut(result) }
    }

    case 'measurement.repeated': {
      const result = fromRepeated(read.numbers('readings', 100_000), read.text('unit', 200), {
        provenance: read.choice('provenance', ['measured', 'simulated', 'derived', 'imported', 'assumed', 'unknown'] as const, 'measured'),
        note: read.optionalText('note', '', 400)
      })
      if (isMeasurementError(result)) return { ok: false, ...result }
      return { ok: true, measurement: measurementOut(result.measurement), readings: result.readings, spread: result.spread, notes: result.notes }
    }

    case 'measurement.convert': {
      const result = convertMeasurement(measurementFrom(read), read.text('to', 200))
      if (isMeasurementError(result)) return { ok: false, ...result }
      return { ok: true, ...measurementOut(result) }
    }

    case 'measurement.agree': {
      const result = agree(measurementFrom(read, 'a'), measurementFrom(read, 'b'), read.optionalNumber('coverage', 2))
      return settle(result, isMeasurementError)
    }

    case 'measurement.propagate': {
      const inputs = read.list('inputs', ENGINE_LIMITS.variables).map((one) => measurementFrom(new Reader(one)))
      const names = read.strings('names', ENGINE_LIMITS.variables)
      if (names.length !== inputs.length) return fail('There has to be one name for each input measurement.')
      const f = compile(read.text('expression'), names, budget)
      const result = propagateByMonteCarlo(inputs, (values) => f(values), {
        samples: read.optionalNumber('samples', 20_000),
        seed: read.optionalNumber('seed', 1),
        level: read.optionalNumber('level', 0.95)
      })
      return settle(result, isMeasurementError)
    }

    case 'measurement.figures': {
      const written = read.text('written', 200)
      return { ok: true, written, ...significantFigures(written) }
    }

    // ---------------------------------------------------------------- optimization
    case 'optimise.interval': {
      const variable = read.optionalText('variable', 'x', 40)
      const f = compile(read.text('expression'), [variable], budget, read.named('parameters'))
      const result = minimiseOnInterval((x) => f([x]), read.number('from'), read.number('to'), {
        unimodal: read.boolean('unimodal', false),
        tolerance: read.has('tolerance') ? read.number('tolerance') : undefined
      })
      return settle(result, isOptimizeError)
    }

    case 'optimise.minimise': {
      const names = read.strings('variables', ENGINE_LIMITS.variables)
      const f = compile(read.text('expression'), names, budget, read.named('parameters'))
      const maximise = read.boolean('maximise', false)
      const result = minimise((point) => (maximise ? -f(point) : f(point)), read.numbers('start', ENGINE_LIMITS.variables), {
        bounds: read.has('bounds') ? boundsFrom(read, names.length) : undefined,
        iterations: read.has('iterations') ? read.number('iterations') : undefined
      })
      if (isOptimizeError(result)) return { ok: false, ...result }
      return { ok: true, ...result, value: maximise ? -result.value : result.value, variables: names }
    }

    case 'optimise.multistart': {
      const names = read.strings('variables', ENGINE_LIMITS.variables)
      const f = compile(read.text('expression'), names, budget, read.named('parameters'))
      const result = multiStart(f, boundsFrom(read, names.length), {
        starts: read.optionalNumber('starts', 12),
        seed: read.optionalNumber('seed', 1)
      })
      if (isOptimizeError(result)) return { ok: false, ...result }
      return { ok: true, ...result, variables: names }
    }

    case 'optimise.linear': {
      const constraints: LinearConstraint[] = read.list('constraints', 200).map((one) => {
        const entry = new Reader(one)
        return {
          coefficients: entry.numbers('coefficients', ENGINE_LIMITS.variables),
          relation: entry.choice('relation', ['<=', '>=', '='] as const, '<='),
          value: entry.number('value'),
          label: entry.optionalText('label', '', 200) || undefined
        }
      })
      const result = solveLinearProgramme({
        objective: read.numbers('objective', ENGINE_LIMITS.variables),
        direction: read.choice('direction', ['minimise', 'maximise'] as const, 'maximise'),
        constraints
      })
      return settle(result, isOptimizeError)
    }

    case 'optimise.constrained': {
      const names = read.strings('variables', ENGINE_LIMITS.variables)
      const named = read.named('parameters')
      const f = compile(read.text('expression'), names, budget, named)
      const constraints = read.list('constraints', 100).map((one, i) => {
        const entry = new Reader(one)
        const test = compile(entry.text('expression'), names, budget, named)
        return {
          label: entry.optionalText('label', `constraint ${i + 1}`, 200),
          kind: entry.choice('kind', ['inequality', 'equality'] as const, 'inequality'),
          test: (point: readonly number[]) => test(point)
        }
      })
      const result = minimiseConstrained(f, read.numbers('start', ENGINE_LIMITS.variables), constraints, {
        rounds: read.optionalNumber('rounds', 6)
      })
      if (isOptimizeError(result)) return { ok: false, ...result }
      return { ok: true, ...result, variables: names }
    }

    // ---------------------------------------------------------------- simulation
    case 'simulate.integrate': {
      const names = read.strings('variables', ENGINE_LIMITS.variables)
      const derivative = compileSystem(read.strings('rates', ENGINE_LIMITS.variables), names, budget, read.optionalText('time', 't', 40))
      const result = integrate(derivative, { time: read.optionalNumber('from', 0), values: read.numbers('start', ENGINE_LIMITS.variables) }, read.number('to'), {
        method: read.choice('method', ['euler', 'rk4', 'adaptive'] as const, 'adaptive'),
        step: read.has('step') ? read.number('step') : undefined,
        tolerance: read.has('tolerance') ? read.number('tolerance') : undefined,
        tracePoints: read.optionalNumber('tracePoints', 2000)
      })
      if (isSimulationError(result)) return { ok: false, ...result }
      return { ok: true, ...result, variables: names }
    }

    case 'simulate.invariant': {
      const names = read.strings('variables', ENGINE_LIMITS.variables)
      const timeName = read.optionalText('time', 't', 40)
      const derivative = compileSystem(read.strings('rates', ENGINE_LIMITS.variables), names, budget, timeName)
      const quantity = compile(read.text('quantity'), names, budget)
      const result = withInvariant(
        derivative,
        { time: read.optionalNumber('from', 0), values: read.numbers('start', ENGINE_LIMITS.variables) },
        read.number('to'),
        (state) => quantity(state.values),
        {
          method: read.choice('method', ['euler', 'rk4', 'adaptive'] as const, 'adaptive'),
          step: read.has('step') ? read.number('step') : undefined,
          allowedDrift: read.optionalNumber('allowedDrift', 1e-6)
        }
      )
      if (isSimulationError(result)) return { ok: false, ...result }
      return { ok: true, ...result, variables: names }
    }

    case 'simulate.steps': {
      const names = read.strings('variables', ENGINE_LIMITS.variables)
      const derivative = compileSystem(read.strings('rates', ENGINE_LIMITS.variables), names, budget, read.optionalText('time', 't', 40))
      const result = compareStepSizes(
        derivative,
        { time: read.optionalNumber('from', 0), values: read.numbers('start', ENGINE_LIMITS.variables) },
        read.number('to'),
        read.numbers('steps', 12),
        { method: read.choice('method', ['euler', 'rk4'] as const, 'rk4') }
      )
      return settle(result, isSimulationError)
    }

    case 'simulate.montecarlo': {
      // The trial expression sees `random`, a fresh draw each call, plus whatever parameters were sent.
      const named = read.named('parameters')
      const tree = parse(read.text('expression'))
      const runs = Math.min(ENGINE_LIMITS.trials, read.optionalNumber('runs', 1000))
      const result = monteCarlo<number>(
        (random) => {
          if (!budget.spend()) throw new Error('out of budget')
          const outcome = evaluateExpression(tree, { ...named, random: random() })
          if (isEvaluateError(outcome)) throw new Error(outcome.message)
          return outcome
        },
        runs,
        { seed: read.optionalNumber('seed', 1) }
      )
      if (isSimulationError(result)) return { ok: false, ...result }
      const values = result.trials.map((one) => one.outcome)
      const summary = summariseOutcomes(values, read.optionalNumber('level', 0.9))
      return {
        ok: true,
        seed: result.seed,
        requested: result.requested,
        failed: result.failed,
        provenance: result.provenance,
        notes: result.notes,
        summary: isSimulationError(summary) ? null : summary
      }
    }

    case 'simulate.sweep': {
      const axes: SweepAxis[] = read.list('axes', 6).map((one) => {
        const entry = new Reader(one)
        return {
          name: entry.text('name', 80),
          from: entry.number('from'),
          to: entry.number('to'),
          count: entry.number('count'),
          logarithmic: entry.boolean('logarithmic', false)
        }
      })
      const names = axes.map((one) => one.name)
      const f = compile(read.text('expression'), names, budget, read.named('parameters'))
      const result = sweep((parameters) => f(names.map((name) => parameters[name])), axes, {
        limit: read.has('limit') ? read.number('limit') : undefined
      })
      return settle(result, isSimulationError)
    }

    case 'simulate.sensitivity': {
      const base = read.named('base')
      const names = Object.keys(base)
      const f = compile(read.text('expression'), names, budget, read.named('parameters'))
      const result = sensitivity((parameters) => f(names.map((name) => parameters[name])), base, {
        fraction: read.optionalNumber('fraction', 0.05)
      })
      return settle(result, isSimulationError)
    }
  }

  // Unreachable from `service.ts`, which checks the operation against the map first. Kept so that adding an entry to the
  // map without adding a case here fails loudly rather than returning undefined.
  return fail(`"${operation}" has a capability but no implementation, which is a bug in Orbis rather than in your Page.`)
}

// ---------------------------------------------------------------- shared readers

/** A table rebuilt from what a Page sent. Headers and rows, exactly as `buildTable` wants them. */
function tableFrom(read: Reader, key = 'table'): Table {
  const value = read.raw(key)
  if (typeof value !== 'object' || value === null) throw new BadInput(`"${key}" has to be a table.`)
  const entry = new Reader(value as Record<string, unknown>)
  const headers = entry.strings('headers', ENGINE_LIMITS.columns)
  const rawRows = entry.raw('rows')
  if (!Array.isArray(rawRows)) throw new BadInput(`"${key}" needs a list of rows.`)
  if (rawRows.length > ENGINE_LIMITS.rows) throw new BadInput(`"${key}" has more than the ${ENGINE_LIMITS.rows} rows allowed.`)
  const rows = rawRows.map((row, i) => {
    if (!Array.isArray(row)) throw new BadInput(`Row ${i + 1} is not a list of values.`)
    if (row.length > ENGINE_LIMITS.columns) throw new BadInput(`Row ${i + 1} has too many values.`)
    // Everything arrives as text and is typed by the engine, which is the only way a round trip loses nothing.
    return row.map((cell) => (cell === null || cell === undefined ? '' : String(cell).slice(0, 4000)))
  })
  const table = buildTable(headers, rows, { source: entry.optionalText('source', '', 200) || undefined })
  if ('error' in table) throw new BadInput((table as { message: string }).message)
  return table as Table
}

/** A measurement rebuilt from what a Page sent. */
function measurementFrom(read: Reader, key?: string): Measurement {
  const source = key === undefined ? read : new Reader((read.raw(key) ?? {}) as Record<string, unknown>)
  if (key !== undefined && (typeof read.raw(key) !== 'object' || read.raw(key) === null)) {
    throw new BadInput(`"${key}" has to be a measurement.`)
  }
  const kind = source.choice('uncertaintyKind', ['standard', 'expanded', 'bound'] as const, 'standard')
  const uncertainty: Uncertainty = {
    value: Math.abs(source.optionalNumber('uncertainty', 0)),
    kind,
    coverageFactor: source.optionalNumber('coverageFactor', kind === 'expanded' ? 2 : 1),
    source: source.choice('uncertaintySource', ['instrument', 'repeated', 'stated', 'propagated', 'estimated', 'none'] as const, 'stated')
  }
  const one = measurement(source.number('value'), source.text('unit', 200), {
    uncertainty,
    // `unknown` rather than `measured`, so a Page that says nothing does not have its numbers called measurements.
    provenance: source.choice('provenance', ['measured', 'simulated', 'derived', 'imported', 'assumed', 'unknown'] as const, 'unknown') as Provenance,
    note: source.optionalText('note', '', 400),
    resolution: source.has('resolution') ? source.number('resolution') : null
  })
  if (isMeasurementError(one)) throw new BadInput(one.message)
  return one
}

/**
 * A filter rebuilt from what a Page sent.
 *
 * Nesting is bounded by depth rather than by total size: a deeply nested filter is cheap to write and expensive to walk,
 * and a stack overflow inside the main process is not something a Page should be able to cause.
 */
function filterFrom(read: Reader, key: string, depth: number): Filter {
  if (depth > 4) throw new BadInput('That filter is nested more deeply than the four levels allowed.')
  const value = read.raw(key)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadInput(`"${key}" has to be a filter.`)
  }
  const entry = new Reader(value as Record<string, unknown>)
  const conditions: Condition[] = entry.list('conditions', 64).map((one) => {
    const part = new Reader(one)
    const comparison = part.choice(
      'comparison',
      [
        'equals',
        'not-equals',
        'contains',
        'starts-with',
        'ends-with',
        'greater',
        'greater-or-equal',
        'less',
        'less-or-equal',
        'between',
        'is-empty',
        'is-not-empty',
        'is-invalid',
        'is-one-of'
      ] as const,
      'equals'
    ) as Comparison
    return {
      columnId: part.text('column', 200),
      comparison,
      value: simpleValue(part.raw('value')),
      value2: simpleValue(part.raw('value2')) as string | number | undefined,
      values: part.has('values') ? entryValues(part) : undefined,
      caseSensitive: part.boolean('caseSensitive', false)
    }
  })

  const groups = entry.has('groups')
    ? entry.list('groups', 8).map((one, i) => filterFrom(new Reader({ [`group ${i}`]: one }), `group ${i}`, depth + 1))
    : undefined

  if (conditions.length === 0 && (groups === undefined || groups.length === 0)) {
    throw new BadInput('A filter needs at least one condition.')
  }
  return { match: entry.choice('match', ['all', 'any'] as const, 'all'), conditions, groups }
}

/** A comparison value: text, a number or a boolean, and nothing else. */
function simpleValue(raw: unknown): string | number | boolean | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) throw new BadInput('A filter cannot compare against a number that is not finite.')
    return raw
  }
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'string') {
    if (raw.length > 4000) throw new BadInput('That filter value is too long.')
    return raw
  }
  throw new BadInput('A filter compares against text, a number or true/false.')
}

/** The allowed set for an `is-one-of` condition. */
function entryValues(part: Reader): (string | number)[] {
  const raw = part.raw('values')
  if (!Array.isArray(raw)) throw new BadInput('"values" has to be a list.')
  if (raw.length > 500) throw new BadInput('"values" has more than the 500 entries allowed.')
  return raw.map((one) => {
    const simple = simpleValue(one)
    if (typeof simple === 'boolean' || simple === undefined) throw new BadInput('"values" holds text or numbers.')
    return simple
  })
}

/** A box of bounds, one per variable. */
function boundsFrom(read: Reader, count: number): Bound[] {
  const bounds = read.list('bounds', ENGINE_LIMITS.variables).map((one) => {
    const entry = new Reader(one)
    return { low: entry.number('low'), high: entry.number('high') }
  })
  if (bounds.length !== count) {
    throw new BadInput(`There are ${count} variables but ${bounds.length} bounds. Every variable needs one.`)
  }
  return bounds
}

export { BadInput, Reader }
