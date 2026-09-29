/**
 * Constraints over named quantities — declared, checked with units, and never quietly assumed to hold.
 *
 * The shared constraint engine for Orbis Pages. A constraint here is data, not code: a Page declares what must be
 * true, and this file says whether it is, whether it cannot be told, or whether the constraint itself is malformed.
 *
 * ## The distinction this whole file is built around
 *
 * A check has **three** outcomes, not two.
 *
 * ```
 * satisfied     -- the values were available and the constraint holds
 * violated      -- the values were available and it does not
 * unevaluable   -- something it needs is missing, so nothing is known either way
 * ```
 *
 * Treating the third as the first is the failure mode this exists to prevent. A design rule that cannot be checked
 * because a dimension has not been entered yet is not a design rule that passed, and a summary that counts it among
 * the satisfied is telling the reader something false. `allSatisfied` is therefore false whenever anything is
 * unevaluable, and the count of unevaluable constraints is carried beside the others rather than folded into them.
 *
 * ## The other distinctions
 *
 * ```
 * violated        vs   malformed       -- comparing metres to seconds is a broken rule, not a broken design
 * unsatisfiable   vs   violated        -- x > 10 and x < 5 conflict with each other whatever x is
 * binding         vs   merely met      -- a constraint exactly at its limit is the one holding the answer back
 * narrowed        vs   solved          -- propagation shrinks a range; it does not find a value
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

import {
  evaluateExpression,
  isEvaluateError,
  isParseError,
  parseExpression,
  variablesOf
} from './expression.ts'
import { isUnitError, parseUnit, sameDimension, type ResolvedUnit } from './units.ts'

// ---------------------------------------------------------------- failure

export interface ConstraintError {
  error: 'invalid-argument' | 'not-finite' | 'unparsable' | 'unit-mismatch' | 'unknown-unit' | 'empty' | 'too-many'
  message: string
}

export const isConstraintError = (value: unknown): value is ConstraintError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: ConstraintError['error'], message: string): ConstraintError => ({ error, message })

export const MAXIMUM_CONSTRAINTS = 2000
export const MAXIMUM_PROPAGATION_PASSES = 50

// ---------------------------------------------------------------- values

/** A named value, optionally carrying a unit. */
export interface Value {
  value: number
  /** Empty for a plain number. */
  unit: string
}

export const plain = (value: number): Value => ({ value, unit: '' })

/** A set of named values, held in a Map so a variable called `constructor` cannot reach anything it should not. */
export type Values = ReadonlyMap<string, Value>

/** Builds a value set from a plain object, safely. */
export function valuesFrom(source: Readonly<Record<string, number | Value>>): Values {
  const out = new Map<string, Value>()
  for (const key of Object.keys(source)) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue
    const one = source[key]
    if (one === undefined) continue
    out.set(key, typeof one === 'number' ? plain(one) : one)
  }
  return out
}

interface Scaled {
  /** The value converted to the base unit of its dimension, so two quantities can be compared. */
  base: number
  unit: ResolvedUnit | null
}

function toBase(one: Value): Scaled | ConstraintError {
  if (!Number.isFinite(one.value)) return fail('not-finite', 'The value is not a finite number.')
  if (one.unit === '') return { base: one.value, unit: null }
  const parsed = parseUnit(one.unit)
  if (isUnitError(parsed)) return fail('unknown-unit', parsed.message)
  return { base: one.value * parsed.factor + parsed.offset, unit: parsed }
}

/** Whether two units describe the same kind of thing. A null unit is a plain number and matches only another one. */
function comparable(a: ResolvedUnit | null, b: ResolvedUnit | null): boolean {
  if (a === null && b === null) return true
  if (a === null || b === null) return false
  return sameDimension(a.dimension, b.dimension)
}

const unitName = (one: ResolvedUnit | null): string => (one === null ? 'a plain number' : one.display)

// ---------------------------------------------------------------- constraints

export type Comparison = 'less' | 'less-or-equal' | 'greater' | 'greater-or-equal' | 'equals' | 'not-equals'

export const COMPARISONS: readonly Comparison[] = Object.freeze([
  'less',
  'less-or-equal',
  'greater',
  'greater-or-equal',
  'equals',
  'not-equals'
])

export const COMPARISON_WORDS: Readonly<Record<Comparison, string>> = Object.freeze({
  less: 'is below',
  'less-or-equal': 'is at most',
  greater: 'is above',
  'greater-or-equal': 'is at least',
  equals: 'equals',
  'not-equals': 'does not equal'
})

/**
 * A constraint, as data.
 *
 * Note what a comparison carries: two *expressions* as text and a comparison between them, rather than one expression
 * containing a comparison operator. The shared expression grammar is arithmetic only — it has no `<` and no booleans —
 * which is deliberate: an expression that can return a boolean is an expression that can hide a decision inside a
 * calculation. The comparison lives beside the arithmetic where it can be seen.
 */
export type Constraint =
  | {
      kind: 'range'
      id: string
      label: string
      variable: string
      /** Omit either end for a one-sided range. */
      minimum?: Value
      maximum?: Value
      /** Whether the ends themselves are allowed. Defaults to true — an inclusive range. */
      minimumInclusive?: boolean
      maximumInclusive?: boolean
      why?: string
    }
  | {
      kind: 'comparison'
      id: string
      label: string
      left: string
      comparison: Comparison
      right: string
      /** How close counts as equal, for the equality comparisons. Defaults to zero. */
      tolerance?: number
      why?: string
    }
  | {
      kind: 'sum'
      id: string
      label: string
      variables: readonly string[]
      total: Value
      tolerance?: number
      why?: string
    }
  | {
      kind: 'required'
      id: string
      label: string
      variables: readonly string[]
      why?: string
    }
  | {
      kind: 'ordered'
      id: string
      label: string
      /** Each must be at or below the next, in this order. */
      variables: readonly string[]
      /** True to require each strictly below the next. */
      strict?: boolean
      why?: string
    }

export type Status = 'satisfied' | 'violated' | 'unevaluable' | 'malformed'

export interface Check {
  constraintId: string
  label: string
  status: Status
  /**
   * How much room is left before the constraint would be violated, in base units.
   *
   * Positive for a satisfied constraint, negative for a violated one, and null where the idea does not apply —
   * an inequality has a margin, a `not-equals` does not. Zero means the constraint is exactly at its limit.
   */
  margin: number | null
  /**
   * True when the constraint sits exactly at its limit.
   *
   * These are the ones worth showing first. A constraint with room to spare is not affecting the answer; a binding
   * one is the thing holding it where it is, and relaxing it is the only change that would move anything.
   */
  binding: boolean
  /** Variables the constraint needed and did not get. */
  missing: readonly string[]
  why: string
}

export interface Report {
  checks: readonly Check[]
  satisfied: number
  violated: number
  unevaluable: number
  malformed: number
  /**
   * True only when every constraint was evaluated and every one holds.
   *
   * False whenever anything was unevaluable. An unchecked rule is not a passed rule, and a summary that says
   * otherwise is the reason this field is defined this way rather than as "nothing violated".
   */
  allSatisfied: boolean
  /** The constraints currently holding the answer where it is. */
  binding: readonly string[]
  why: string
}

const compare = (left: number, comparison: Comparison, right: number, tolerance: number): boolean => {
  switch (comparison) {
    case 'less': return left < right
    case 'less-or-equal': return left <= right
    case 'greater': return left > right
    case 'greater-or-equal': return left >= right
    case 'equals': return Math.abs(left - right) <= tolerance
    case 'not-equals': return Math.abs(left - right) > tolerance
  }
}

const marginOf = (left: number, comparison: Comparison, right: number): number | null => {
  switch (comparison) {
    case 'less':
    case 'less-or-equal':
      return right - left
    case 'greater':
    case 'greater-or-equal':
      return left - right
    case 'equals':
      return -Math.abs(left - right)
    case 'not-equals':
      // There is no continuous room to spare: any value but one satisfies it, and that one fails outright.
      return null
  }
}

const number = (value: number): string => String(Number(value.toPrecision(6)))

function checkOne(constraint: Constraint, values: Values): Check {
  const base = { constraintId: constraint.id, label: constraint.label }
  const unevaluable = (missing: readonly string[]): Check => ({
    ...base,
    status: 'unevaluable',
    margin: null,
    binding: false,
    missing,
    why: `Nothing is known about this rule: ${missing.length === 1 ? `${missing[0]} has` : `${missing.join(', ')} have`} no value yet. That is not the same as the rule holding.`
  })
  const malformed = (why: string): Check => ({ ...base, status: 'malformed', margin: null, binding: false, missing: [], why })

  switch (constraint.kind) {
    case 'required': {
      const missing = constraint.variables.filter((one) => !values.has(one))
      if (constraint.variables.length === 0) return malformed('A "required" constraint names no variables, so there is nothing for it to require.')
      return {
        ...base,
        status: missing.length === 0 ? 'satisfied' : 'violated',
        margin: null,
        binding: false,
        missing: [],
        why: missing.length === 0
          ? `All ${constraint.variables.length} required value${constraint.variables.length === 1 ? ' is' : 's are'} present.`
          : `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required and not given. This is a violation rather than something unevaluable — the rule is about presence, and absence is the answer.`
      }
    }

    case 'range': {
      const held = values.get(constraint.variable)
      if (held === undefined) return unevaluable([constraint.variable])
      if (constraint.minimum === undefined && constraint.maximum === undefined) {
        return malformed('A range constraint with neither a minimum nor a maximum permits everything, which is not a constraint.')
      }
      const scaled = toBase(held)
      if (isConstraintError(scaled)) return malformed(`${constraint.variable}: ${scaled.message}`)
      const lowInclusive = constraint.minimumInclusive ?? true
      const highInclusive = constraint.maximumInclusive ?? true

      let lowMargin: number | null = null
      let highMargin: number | null = null
      const reasons: string[] = []
      let violated = false

      if (constraint.minimum !== undefined) {
        const bound = toBase(constraint.minimum)
        if (isConstraintError(bound)) return malformed(`The minimum: ${bound.message}`)
        if (!comparable(scaled.unit, bound.unit)) {
          return malformed(`${constraint.variable} is in ${unitName(scaled.unit)} and the minimum is in ${unitName(bound.unit)}. Those measure different kinds of thing, so the comparison has no meaning — the rule is broken, not the value.`)
        }
        lowMargin = scaled.base - bound.base
        const holds = lowInclusive ? scaled.base >= bound.base : scaled.base > bound.base
        if (!holds) {
          violated = true
          reasons.push(`${number(held.value)}${held.unit === '' ? '' : ` ${held.unit}`} is below the ${lowInclusive ? 'minimum' : 'exclusive minimum'} of ${number(constraint.minimum.value)}${constraint.minimum.unit === '' ? '' : ` ${constraint.minimum.unit}`}`)
        }
      }
      if (constraint.maximum !== undefined) {
        const bound = toBase(constraint.maximum)
        if (isConstraintError(bound)) return malformed(`The maximum: ${bound.message}`)
        if (!comparable(scaled.unit, bound.unit)) {
          return malformed(`${constraint.variable} is in ${unitName(scaled.unit)} and the maximum is in ${unitName(bound.unit)}. Those measure different kinds of thing, so the comparison has no meaning — the rule is broken, not the value.`)
        }
        highMargin = bound.base - scaled.base
        const holds = highInclusive ? scaled.base <= bound.base : scaled.base < bound.base
        if (!holds) {
          violated = true
          reasons.push(`${number(held.value)}${held.unit === '' ? '' : ` ${held.unit}`} is above the ${highInclusive ? 'maximum' : 'exclusive maximum'} of ${number(constraint.maximum.value)}${constraint.maximum.unit === '' ? '' : ` ${constraint.maximum.unit}`}`)
        }
      }

      const margins = [lowMargin, highMargin].filter((one): one is number => one !== null)
      const margin = margins.length === 0 ? null : Math.min(...margins)
      return {
        ...base,
        status: violated ? 'violated' : 'satisfied',
        margin,
        binding: !violated && margin === 0,
        missing: [],
        why: violated
          ? reasons.join('; ') + '.'
          : margin === 0
            ? `${constraint.variable} sits exactly on its limit. This is the rule holding the answer where it is; nothing moves unless it is relaxed.`
            : `${constraint.variable} is inside its range, with ${number(margin ?? 0)} to spare in base units.`
      }
    }

    case 'comparison': {
      const left = parseExpression(constraint.left)
      if (isParseError(left)) return malformed(`The left side does not parse: ${left.message}`)
      const right = parseExpression(constraint.right)
      if (isParseError(right)) return malformed(`The right side does not parse: ${right.message}`)
      if (!COMPARISONS.includes(constraint.comparison)) {
        return malformed(`There is no comparison called "${constraint.comparison}". The ones here are ${COMPARISONS.join(', ')}.`)
      }
      const needed = [...new Set([...variablesOf(left), ...variablesOf(right)])]
      const missing = needed.filter((one) => !values.has(one))
      if (missing.length > 0) return unevaluable(missing)

      const scope: Record<string, number> = Object.create(null)
      let unit: ResolvedUnit | null | undefined
      let mixed = false
      for (const name of needed) {
        const held = values.get(name)
        if (held === undefined) continue
        const scaled = toBase(held)
        if (isConstraintError(scaled)) return malformed(`${name}: ${scaled.message}`)
        Object.defineProperty(scope, name, { value: scaled.base, enumerable: true, writable: false, configurable: false })
        if (unit === undefined) unit = scaled.unit
        else if (!comparable(unit, scaled.unit)) mixed = true
      }
      if (mixed) {
        return malformed(
          `The variables in this comparison are not all the same kind of quantity, and the expressions are evaluated in base units, so combining them would produce a number with no meaning. Compare quantities of one kind, or convert first.`
        )
      }
      const leftValue = evaluateExpression(left, scope)
      if (isEvaluateError(leftValue)) return malformed(`The left side has no value: ${leftValue.message}`)
      const rightValue = evaluateExpression(right, scope)
      if (isEvaluateError(rightValue)) return malformed(`The right side has no value: ${rightValue.message}`)
      const tolerance = constraint.tolerance ?? 0
      if (!Number.isFinite(tolerance) || tolerance < 0) return malformed('The tolerance must be a non-negative finite number.')

      const holds = compare(leftValue, constraint.comparison, rightValue, tolerance)
      const margin = marginOf(leftValue, constraint.comparison, rightValue)
      return {
        ...base,
        status: holds ? 'satisfied' : 'violated',
        margin,
        binding: holds && margin === 0,
        missing: [],
        why: `${constraint.left} is ${number(leftValue)} and ${constraint.right} is ${number(rightValue)}, in base units. The rule says the first ${COMPARISON_WORDS[constraint.comparison]} the second, and it ${holds ? 'does' : 'does not'}.`
      }
    }

    case 'sum': {
      if (constraint.variables.length === 0) return malformed('A sum constraint names no variables, so there is nothing to add up.')
      const missing = constraint.variables.filter((one) => !values.has(one))
      if (missing.length > 0) return unevaluable(missing)
      const target = toBase(constraint.total)
      if (isConstraintError(target)) return malformed(`The total: ${target.message}`)
      let total = 0
      for (const name of constraint.variables) {
        const held = values.get(name)
        if (held === undefined) continue
        const scaled = toBase(held)
        if (isConstraintError(scaled)) return malformed(`${name}: ${scaled.message}`)
        if (!comparable(scaled.unit, target.unit)) {
          return malformed(`${name} is in ${unitName(scaled.unit)} and the total is in ${unitName(target.unit)}. A sum of different kinds of quantity has no meaning.`)
        }
        total += scaled.base
      }
      const tolerance = constraint.tolerance ?? 0
      if (!Number.isFinite(tolerance) || tolerance < 0) return malformed('The tolerance must be a non-negative finite number.')
      const difference = total - target.base
      const holds = Math.abs(difference) <= tolerance
      return {
        ...base,
        status: holds ? 'satisfied' : 'violated',
        margin: tolerance - Math.abs(difference),
        binding: holds && Math.abs(difference) === tolerance && tolerance === 0,
        missing: [],
        why: holds
          ? `The ${constraint.variables.length} values total ${number(total)} in base units, against a target of ${number(target.base)}.`
          : `The ${constraint.variables.length} values total ${number(total)} in base units, which is ${number(Math.abs(difference))} ${difference > 0 ? 'over' : 'under'} the target of ${number(target.base)}.`
      }
    }

    case 'ordered': {
      if (constraint.variables.length < 2) return malformed('An ordering constraint needs at least two variables to put in order.')
      const missing = constraint.variables.filter((one) => !values.has(one))
      if (missing.length > 0) return unevaluable(missing)
      const scaled: { name: string; base: number; unit: ResolvedUnit | null }[] = []
      for (const name of constraint.variables) {
        const held = values.get(name)
        if (held === undefined) continue
        const one = toBase(held)
        if (isConstraintError(one)) return malformed(`${name}: ${one.message}`)
        scaled.push({ name, base: one.base, unit: one.unit })
      }
      const first = scaled[0]
      if (first !== undefined) {
        for (const one of scaled) {
          if (!comparable(first.unit, one.unit)) {
            return malformed(`${first.name} is in ${unitName(first.unit)} and ${one.name} is in ${unitName(one.unit)}. Quantities of different kinds cannot be put in order against each other.`)
          }
        }
      }
      const strict = constraint.strict ?? false
      const breaks: string[] = []
      let tightest = Number.POSITIVE_INFINITY
      for (let i = 1; i < scaled.length; i += 1) {
        const before = scaled[i - 1]
        const now = scaled[i]
        if (before === undefined || now === undefined) continue
        const gap = now.base - before.base
        tightest = Math.min(tightest, gap)
        const holds = strict ? gap > 0 : gap >= 0
        if (!holds) breaks.push(`${before.name} (${number(before.base)}) is ${gap === 0 ? 'equal to' : 'above'} ${now.name} (${number(now.base)})`)
      }
      const holds = breaks.length === 0
      return {
        ...base,
        status: holds ? 'satisfied' : 'violated',
        margin: Number.isFinite(tightest) ? tightest : null,
        binding: holds && tightest === 0 && !strict,
        missing: [],
        why: holds
          ? `The ${scaled.length} values are in ${strict ? 'strictly increasing' : 'non-decreasing'} order, with a tightest gap of ${number(tightest)} in base units.`
          : `${breaks.join('; ')}.`
      }
    }
  }
}

/** Checks a set of constraints against a set of values. */
export function check(constraints: readonly Constraint[], values: Values): Report | ConstraintError {
  if (constraints.length > MAXIMUM_CONSTRAINTS) {
    return fail('too-many', `${constraints.length} constraints is more than the ${MAXIMUM_CONSTRAINTS} this engine checks at once.`)
  }
  const seen = new Set<string>()
  for (const one of constraints) {
    if (typeof one.id !== 'string' || one.id === '') return fail('invalid-argument', 'Every constraint needs an id.')
    if (seen.has(one.id)) return fail('invalid-argument', `Two constraints share the id "${one.id}", so a result could not say which was meant.`)
    seen.add(one.id)
  }

  const checks = constraints.map((one) => checkOne(one, values))
  const satisfied = checks.filter((one) => one.status === 'satisfied').length
  const violated = checks.filter((one) => one.status === 'violated').length
  const unevaluable = checks.filter((one) => one.status === 'unevaluable').length
  const malformed = checks.filter((one) => one.status === 'malformed').length
  const binding = checks.filter((one) => one.binding).map((one) => one.constraintId)

  const parts: string[] = []
  if (satisfied > 0) parts.push(`${satisfied} satisfied`)
  if (violated > 0) parts.push(`${violated} violated`)
  if (unevaluable > 0) parts.push(`${unevaluable} not checkable yet`)
  if (malformed > 0) parts.push(`${malformed} malformed`)

  return {
    checks,
    satisfied,
    violated,
    unevaluable,
    malformed,
    allSatisfied: violated === 0 && unevaluable === 0 && malformed === 0 && checks.length > 0,
    binding,
    why: checks.length === 0
      ? 'There are no constraints, so nothing was checked. That is not the same as everything being fine.'
      : `${parts.join(', ')}.${unevaluable > 0 ? ' The ones that could not be checked are not counted as passing: a rule nothing is known about has not been met.' : ''}${malformed > 0 ? ' A malformed rule is a problem with the rule, not with the values.' : ''}${binding.length > 0 ? ` ${binding.length} ${binding.length === 1 ? 'is' : 'are'} exactly at the limit.` : ''}`
  }
}

// ---------------------------------------------------------------- do the constraints agree with each other

export interface Interval {
  variable: string
  /** Null means unbounded on that side. */
  minimum: number | null
  maximum: number | null
  minimumInclusive: boolean
  maximumInclusive: boolean
  /** Which constraints produced these bounds. */
  from: readonly string[]
}

export interface Conflict {
  variable: string
  /** The constraints that cannot all hold at once. */
  constraintIds: readonly string[]
  detail: string
}

export interface Feasibility {
  /** True when no pair of range constraints contradicts another. */
  possible: boolean
  intervals: readonly Interval[]
  conflicts: readonly Conflict[]
  why: string
}

/**
 * Asks whether the constraints can all hold at once, before asking whether they do.
 *
 * A different question from checking values, and worth asking first: `x > 10` together with `x < 5` is not a design
 * that fails, it is a specification that no value could ever meet. Reporting that as "x violates a constraint" sends
 * someone looking for a better x, and there isn't one.
 *
 * Only the range constraints are examined. Detecting conflicts among arbitrary expressions is undecidable in
 * general, so this reports what it can prove rather than claiming to have checked everything — which is why
 * `possible` being true is stated as "no contradiction found" and not as "satisfiable".
 */
export function feasible(constraints: readonly Constraint[]): Feasibility | ConstraintError {
  if (constraints.length > MAXIMUM_CONSTRAINTS) {
    return fail('too-many', `${constraints.length} constraints is more than the ${MAXIMUM_CONSTRAINTS} this engine examines at once.`)
  }
  const intervals = new Map<string, Interval>()
  const conflicts: Conflict[] = []

  for (const one of constraints) {
    if (one.kind !== 'range') continue
    let low: number | null = null
    let high: number | null = null
    if (one.minimum !== undefined) {
      const scaled = toBase(one.minimum)
      if (isConstraintError(scaled)) continue
      low = scaled.base
    }
    if (one.maximum !== undefined) {
      const scaled = toBase(one.maximum)
      if (isConstraintError(scaled)) continue
      high = scaled.base
    }
    const lowInclusive = one.minimumInclusive ?? true
    const highInclusive = one.maximumInclusive ?? true

    if (low !== null && high !== null) {
      const impossible = low > high || (low === high && !(lowInclusive && highInclusive))
      if (impossible) {
        conflicts.push({
          variable: one.variable,
          constraintIds: [one.id],
          detail: `"${one.label}" asks for ${one.variable} to be ${lowInclusive ? 'at least' : 'above'} ${number(low)} and ${highInclusive ? 'at most' : 'below'} ${number(high)} at the same time. No value satisfies that; the rule contradicts itself.`
        })
        continue
      }
    }

    const existing = intervals.get(one.variable)
    if (existing === undefined) {
      intervals.set(one.variable, {
        variable: one.variable,
        minimum: low,
        maximum: high,
        minimumInclusive: lowInclusive,
        maximumInclusive: highInclusive,
        from: [one.id]
      })
      continue
    }
    // Keep the tighter of each bound, and remember that the ends are exclusive if either says so.
    let minimum = existing.minimum
    let minimumInclusive = existing.minimumInclusive
    if (low !== null && (minimum === null || low > minimum)) {
      minimum = low
      minimumInclusive = lowInclusive
    } else if (low !== null && low === minimum) {
      minimumInclusive = minimumInclusive && lowInclusive
    }
    let maximum = existing.maximum
    let maximumInclusive = existing.maximumInclusive
    if (high !== null && (maximum === null || high < maximum)) {
      maximum = high
      maximumInclusive = highInclusive
    } else if (high !== null && high === maximum) {
      maximumInclusive = maximumInclusive && highInclusive
    }
    intervals.set(one.variable, {
      variable: one.variable,
      minimum,
      maximum,
      minimumInclusive,
      maximumInclusive,
      from: [...existing.from, one.id]
    })
  }

  for (const interval of intervals.values()) {
    if (interval.minimum === null || interval.maximum === null) continue
    const impossible =
      interval.minimum > interval.maximum ||
      (interval.minimum === interval.maximum && !(interval.minimumInclusive && interval.maximumInclusive))
    if (impossible) {
      conflicts.push({
        variable: interval.variable,
        constraintIds: interval.from,
        detail: `Together, ${interval.from.map((id) => `"${id}"`).join(' and ')} leave no value for ${interval.variable}: they require it to be ${interval.minimumInclusive ? 'at least' : 'above'} ${number(interval.minimum)} and ${interval.maximumInclusive ? 'at most' : 'below'} ${number(interval.maximum)}. Each is satisfiable alone; no value satisfies both.`
      })
    }
  }

  const possible = conflicts.length === 0
  return {
    possible,
    intervals: [...intervals.values()],
    conflicts,
    why: possible
      ? `No contradiction found among ${intervals.size} constrained variable${intervals.size === 1 ? '' : 's'}. Only the range constraints were examined — conflicts hidden inside expressions cannot be found in general, so this says nothing was proved impossible rather than that everything is possible.`
      : `${conflicts.length} contradiction${conflicts.length === 1 ? '' : 's'} found. These are specifications no value could meet, so looking for a better value will not help — one of the rules has to change.`
  }
}

export interface Narrowing {
  intervals: readonly Interval[]
  /** Variables whose range this narrowed, with how much of the original span was removed. */
  narrowed: readonly { variable: string; removed: number }[]
  passes: number
  /** True when the passes ran out before the intervals stopped changing. */
  stoppedEarly: boolean
  why: string
}

/**
 * Narrows the ranges that variables can take, using the sum constraints to inform the range ones.
 *
 * Interval propagation: if x and y are each in [0, 100] and x + y = 50, then neither can exceed 50. Repeating until
 * nothing changes tightens what is known without solving anything.
 *
 * It narrows; it does not solve. A narrowed interval of [20, 20] means that is the only value left given these
 * constraints — which is a deduction, not a measurement, and a Page should present it as one.
 */
export function narrow(constraints: readonly Constraint[]): Narrowing | ConstraintError {
  const start = feasible(constraints)
  if (isConstraintError(start)) return start
  const intervals = new Map<string, Interval>(start.intervals.map((one) => [one.variable, { ...one }]))
  const original = new Map<string, Interval>(start.intervals.map((one) => [one.variable, { ...one }]))

  const sums = constraints.filter((one): one is Extract<Constraint, { kind: 'sum' }> => one.kind === 'sum')
  let passes = 0
  let changed = true
  while (changed && passes < MAXIMUM_PROPAGATION_PASSES) {
    changed = false
    passes += 1
    for (const one of sums) {
      const target = toBase(one.total)
      if (isConstraintError(target)) continue
      const tolerance = one.tolerance ?? 0
      for (const variable of one.variables) {
        // The most this variable can be is the total, less the least everything else can be.
        let othersMinimum = 0
        let othersMaximum = 0
        let boundedBelow = true
        let boundedAbove = true
        for (const other of one.variables) {
          if (other === variable) continue
          const interval = intervals.get(other)
          if (interval === undefined || interval.minimum === null) boundedBelow = false
          else othersMinimum += interval.minimum
          if (interval === undefined || interval.maximum === null) boundedAbove = false
          else othersMaximum += interval.maximum
        }
        const current = intervals.get(variable) ?? {
          variable,
          minimum: null,
          maximum: null,
          minimumInclusive: true,
          maximumInclusive: true,
          from: []
        }
        let next = current
        if (boundedBelow) {
          const implied = target.base + tolerance - othersMinimum
          if (current.maximum === null || implied < current.maximum) {
            next = { ...next, maximum: implied, maximumInclusive: true, from: [...new Set([...next.from, one.id])] }
            changed = true
          }
        }
        if (boundedAbove) {
          const implied = target.base - tolerance - othersMaximum
          if (current.minimum === null || implied > current.minimum) {
            next = { ...next, minimum: implied, minimumInclusive: true, from: [...new Set([...next.from, one.id])] }
            changed = true
          }
        }
        if (next !== current) intervals.set(variable, next)
      }
    }
  }

  const narrowed: { variable: string; removed: number }[] = []
  for (const [variable, now] of intervals) {
    const before = original.get(variable)
    if (before === undefined) {
      narrowed.push({ variable, removed: 0 })
      continue
    }
    const spanBefore = before.minimum === null || before.maximum === null ? Number.POSITIVE_INFINITY : before.maximum - before.minimum
    const spanNow = now.minimum === null || now.maximum === null ? Number.POSITIVE_INFINITY : now.maximum - now.minimum
    if (Number.isFinite(spanBefore) && spanNow < spanBefore) narrowed.push({ variable, removed: spanBefore - spanNow })
    else if (!Number.isFinite(spanBefore) && Number.isFinite(spanNow)) narrowed.push({ variable, removed: Number.POSITIVE_INFINITY })
  }

  const stoppedEarly = changed && passes >= MAXIMUM_PROPAGATION_PASSES
  const pinned = [...intervals.values()].filter(
    (one) => one.minimum !== null && one.maximum !== null && one.maximum - one.minimum === 0
  )
  return {
    intervals: [...intervals.values()],
    narrowed,
    passes,
    stoppedEarly,
    why: stoppedEarly
      ? `Stopped after ${MAXIMUM_PROPAGATION_PASSES} passes with the intervals still shrinking. What is below is correct as far as it goes — every value outside these ranges really is ruled out — but there may be more to remove.`
      : `Settled after ${passes} pass${passes === 1 ? '' : 'es'}. ${narrowed.length === 0 ? 'Nothing was narrowed: the constraints do not inform each other.' : `${narrowed.length} variable${narrowed.length === 1 ? '' : 's'} narrowed.`}${pinned.length > 0 ? ` ${pinned.map((one) => one.variable).join(', ')} ${pinned.length === 1 ? 'has' : 'have'} only one value left — a deduction from the constraints, not a measurement.` : ''} Narrowing rules values out; it does not find the answer.`
  }
}

// ---------------------------------------------------------------- reading a report

/** The constraints worth showing first: violated, then malformed, then binding, then the rest. */
export function rank(report: Report): readonly Check[] {
  const order: Record<Status, number> = { violated: 0, malformed: 1, unevaluable: 3, satisfied: 4 }
  // A satisfied constraint sitting exactly on its limit is the thing holding the answer where it is, so it comes
  // ahead of the ones nothing is known about — which is why it takes the rank between them.
  const rankOf = (one: Check): number => (one.binding ? 2 : (order[one.status] ?? 9))
  return [...report.checks].sort((a, b) => {
    const byStatus = rankOf(a) - rankOf(b)
    if (byStatus !== 0) return byStatus
    const aMargin = a.margin ?? Number.POSITIVE_INFINITY
    const bMargin = b.margin ?? Number.POSITIVE_INFINITY
    return aMargin - bMargin
  })
}
