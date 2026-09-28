/**
 * Structured comparison: entities, criteria, normalisation, weighting and trade-offs.
 *
 * The hard part of comparing things is not the arithmetic. It is that the arithmetic is only meaningful once several
 * decisions have been made explicitly -- which direction is better, how a rating compares with a price, what to do
 * about a value nobody has -- and a tool that makes those quietly produces a ranking that looks objective and is not.
 *
 * ## Missing is not zero
 *
 * A value nobody knows is `missing`, and it stays missing through normalisation and scoring. Treating it as zero
 * silently ranks the option with the unknown price as the cheapest, which is the opposite of what is true.
 *
 * ## There is no universally best option
 *
 * A weighted score is a function of the weights, and different weights give different winners. So nothing here
 * returns "the best"; it returns the best *under the weighting given*, and `stability` says how much of the weight
 * space agrees.
 */

import { accurateSum } from '../compute/statistics.ts'

export interface CompareError {
  error: string
  message: string
}

export const isCompareError = (value: unknown): value is CompareError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value

const fail = (error: string, message: string): CompareError => ({ error, message })

export const COMPARE_LIMITS: Readonly<Record<'entities' | 'criteria' | 'samples' | 'scenarios', number>> = Object.freeze({
  entities: 2_000,
  criteria: 200,
  samples: 20_000,
  scenarios: 100
})

// ---------------------------------------------------------------- values

/** A value that is genuinely unknown. Never zero, never an empty string, never the middle of the range. */
export const MISSING = Object.freeze({ kind: 'missing' as const })
export type Missing = typeof MISSING

/** A value that cannot be compared on this criterion at all, which is different from not knowing it. */
export const NOT_APPLICABLE = Object.freeze({ kind: 'not-applicable' as const })
export type NotApplicable = typeof NOT_APPLICABLE

export type CriterionValue = number | boolean | string | Missing | NotApplicable

export const isMissing = (value: CriterionValue): value is Missing =>
  typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'missing'

export const isNotApplicable = (value: CriterionValue): value is NotApplicable =>
  typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'not-applicable'

export const hasValue = (value: CriterionValue): value is Exclude<CriterionValue, typeof MISSING | typeof NOT_APPLICABLE> =>
  !isMissing(value) && !isNotApplicable(value)

// ---------------------------------------------------------------- criteria

export type CriterionKind = 'number' | 'currency' | 'boolean' | 'category' | 'rating' | 'date' | 'text'

/**
 * Which way is better on this criterion.
 *
 * `neutral` is a real option and matters: a criterion recorded for context -- a colour, a manufacturer -- should be
 * shown and should not contribute to any score. Forcing every criterion into better-or-worse is how a comparison ends
 * up ranking laptops by how alphabetically late their brand is.
 */
export type Direction = 'higher-better' | 'lower-better' | 'target' | 'range' | 'neutral'

export interface Criterion {
  id: string
  name: string
  kind: CriterionKind
  direction: Direction
  unit: string
  /** For `target`: the value being aimed at. For `range`: the ends of the acceptable band. */
  target: number | null
  range: { low: number; high: number } | null
  /** The allowed values and their order, for a rating. Order is what makes a rating comparable at all. */
  scale: string[]
  weight: number
  describe: string
  /** Where the values for this criterion came from, so a sourced figure and a guessed one are distinguishable. */
  source: string
}

export interface Entity {
  id: string
  name: string
  /** Keyed by criterion id. A criterion with no entry is missing, which is a state and not an absence. */
  values: Record<string, CriterionValue>
  describe: string
  source: string
}

export function criterion(id: string, name: string, kind: CriterionKind, direction: Direction, options: Partial<Criterion> = {}): Criterion | CompareError {
  if (id.trim() === '') return fail('invalid-argument', 'A criterion needs an id.')
  if (direction === 'target' && (options.target === undefined || options.target === null || !Number.isFinite(options.target))) {
    return fail('invalid-argument', `"${name}" is scored against a target, so it needs one.`)
  }
  if (direction === 'range' && (!options.range || !Number.isFinite(options.range.low) || !Number.isFinite(options.range.high) || options.range.low > options.range.high)) {
    return fail('invalid-argument', `"${name}" is scored against a range, so it needs a low and a high with the low below the high.`)
  }
  if (kind === 'rating' && (!options.scale || options.scale.length < 2)) {
    return fail('invalid-argument', `"${name}" is a rating, so it needs at least two ordered levels. Without an order the values cannot be compared.`)
  }
  if (options.weight !== undefined && (!Number.isFinite(options.weight) || options.weight < 0)) {
    return fail('invalid-argument', 'A weight cannot be negative.')
  }

  return {
    id,
    name,
    kind,
    direction,
    unit: options.unit ?? '',
    target: options.target ?? null,
    range: options.range ?? null,
    scale: options.scale ?? [],
    weight: options.weight ?? 1,
    describe: options.describe ?? '',
    source: options.source ?? ''
  }
}

// ---------------------------------------------------------------- normalisation

export interface Normalised {
  entityId: string
  criterionId: string
  /** 0 is worst and 1 is best among the entities being compared. `null` where the value is missing. */
  score: number | null
  raw: CriterionValue
  /** What made this 0 or 1, because a normalised score means nothing without knowing what it was relative to. */
  relativeTo: { worst: number; best: number } | null
  describe: string
}

/**
 * Values put on a common scale, relative to the entities actually being compared.
 *
 * Relative, not absolute, and that is worth stating on the screen: a laptop scoring 1 on price is the cheapest *of
 * these*, not cheap. Adding a cheaper option changes every price score, which is correct and surprises people.
 *
 * A neutral criterion is not normalised. There is no better or worse to map onto.
 */
export function normalise(entities: readonly Entity[], one: Criterion): Normalised[] | CompareError {
  if (entities.length === 0) return fail('no-values', 'There are no entities to compare.')
  if (one.direction === 'neutral') {
    return entities.map((entity) => ({
      entityId: entity.id,
      criterionId: one.id,
      score: null,
      raw: entity.values[one.id] ?? MISSING,
      relativeTo: null,
      describe: `${one.name} is recorded for context and has no better or worse, so it is not scored.`
    }))
  }

  const numeric = new Map<string, number>()
  for (const entity of entities) {
    const value = entity.values[one.id] ?? MISSING
    const asNumber = toNumber(value, one)
    if (asNumber !== null) numeric.set(entity.id, asNumber)
  }

  if (numeric.size === 0) {
    // Still per-entity: "does not apply to this one" and "nobody knows it for this one" are different facts, and
    // collapsing them into one sentence about the criterion loses the distinction exactly where it is needed.
    return entities.map((entity) => {
      const raw = entity.values[one.id] ?? MISSING
      return {
        entityId: entity.id,
        criterionId: one.id,
        score: null,
        raw,
        relativeTo: null,
        describe: isNotApplicable(raw)
          ? `${one.name} does not apply to ${entity.name}, which is different from not knowing it. No entity has a usable value for it, so nothing can be scored on it.`
          : `No entity has a usable value for ${one.name}, so nothing can be scored on it.`
      }
    })
  }

  const values = [...numeric.values()]
  const low = Math.min(...values)
  const high = Math.max(...values)

  return entities.map((entity) => {
    const raw = entity.values[one.id] ?? MISSING
    const asNumber = numeric.get(entity.id)
    if (asNumber === undefined) {
      return {
        entityId: entity.id,
        criterionId: one.id,
        score: null,
        raw,
        relativeTo: null,
        describe: isNotApplicable(raw)
          ? `${one.name} does not apply to ${entity.name}, which is different from not knowing it.`
          : `${entity.name} has no value for ${one.name}. It is left unscored rather than treated as zero, which would rank it as if it were the worst.`
      }
    }

    let score: number
    switch (one.direction) {
      case 'higher-better':
        score = high === low ? 1 : (asNumber - low) / (high - low)
        break
      case 'lower-better':
        score = high === low ? 1 : (high - asNumber) / (high - low)
        break
      case 'target': {
        const target = one.target as number
        const furthest = Math.max(Math.abs(high - target), Math.abs(low - target))
        score = furthest === 0 ? 1 : 1 - Math.abs(asNumber - target) / furthest
        break
      }
      case 'range': {
        const { low: from, high: to } = one.range as { low: number; high: number }
        if (asNumber >= from && asNumber <= to) score = 1
        else {
          const outside = asNumber < from ? from - asNumber : asNumber - to
          const furthest = Math.max(Math.abs(high - to), Math.abs(low - from), 1e-12)
          score = Math.max(0, 1 - outside / furthest)
        }
        break
      }
      default:
        score = 0
    }

    return {
      entityId: entity.id,
      criterionId: one.id,
      score,
      raw,
      relativeTo: { worst: one.direction === 'lower-better' ? high : low, best: one.direction === 'lower-better' ? low : high },
      describe:
        high === low
          ? `Every entity has the same ${one.name}, so this criterion does not separate them.`
          : `Scored against the others: ${Number(low.toPrecision(6))} to ${Number(high.toPrecision(6))} across the entities compared. A score of 1 is the best of these, not good in absolute terms.`
    }
  })
}

/** A criterion value as a number, or `null` where there is none to be had. */
function toNumber(value: CriterionValue, one: Criterion): number | null {
  if (!hasValue(value)) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (one.kind === 'rating') {
    // Position in the declared order. `indexOf` on the array, never a lookup on an object -- a level called
    // "constructor" is a level somebody can write.
    const index = one.scale.indexOf(value)
    return index === -1 ? null : index / Math.max(1, one.scale.length - 1)
  }
  return null
}

// ---------------------------------------------------------------- differences

export interface Difference {
  criterionId: string
  criterionName: string
  a: CriterionValue
  b: CriterionValue
  absolute: number | null
  relative: number | null
  /** Which one is better on this criterion, or `null` where the criterion has no direction or a value is missing. */
  better: 'a' | 'b' | 'equal' | null
  comparable: boolean
  describe: string
}

/**
 * Two entities, criterion by criterion.
 *
 * A percentage difference is only computed where one means something. "Steel is 40% more titanium than aluminium" is
 * not a sentence, and a comparison engine that produces it has stopped tracking what its numbers are.
 */
export function differences(a: Entity, b: Entity, criteria: readonly Criterion[]): Difference[] {
  return criteria.map((one) => {
    const valueA = a.values[one.id] ?? MISSING
    const valueB = b.values[one.id] ?? MISSING
    const numberA = toNumber(valueA, one)
    const numberB = toNumber(valueB, one)

    // A value that is present but not numeric -- a category, a piece of text -- is comparable for sameness even
    // though there is no distance between its values. Treating it as "no usable value" would be reporting that
    // steel and aluminium cannot be told apart, which is not what having no arithmetic means.
    if (!hasValue(valueA) || !hasValue(valueB)) {
      return {
        criterionId: one.id,
        criterionName: one.name,
        a: valueA,
        b: valueB,
        absolute: null,
        relative: null,
        better: null,
        comparable: false,
        describe: `${one.name} cannot be compared: ${!hasValue(valueA) ? a.name : b.name} has no usable value for it.`
      }
    }

    if (numberA === null || numberB === null) {
      const same = String(valueA) === String(valueB)
      return {
        criterionId: one.id,
        criterionName: one.name,
        a: valueA,
        b: valueB,
        absolute: null,
        relative: null,
        better: same ? 'equal' : null,
        comparable: true,
        describe: same
          ? `${one.name}: both are ${String(valueA)}.`
          : `${one.name}: ${String(valueA)} against ${String(valueB)}. These are categories, so there is no difference to subtract.`
      }
    }

    // A category has no distance between its values. Subtracting two of them would produce a number with no meaning.
    const quantitative = one.kind === 'number' || one.kind === 'currency' || one.kind === 'rating' || one.kind === 'date'
    const absolute = quantitative ? numberB - numberA : null
    const relative = quantitative && numberA !== 0 ? (numberB - numberA) / Math.abs(numberA) : null

    let better: Difference['better'] = null
    if (one.direction === 'higher-better') better = numberB > numberA ? 'b' : numberB < numberA ? 'a' : 'equal'
    else if (one.direction === 'lower-better') better = numberB < numberA ? 'b' : numberB > numberA ? 'a' : 'equal'
    else if (one.direction === 'target' && one.target !== null) {
      const distanceA = Math.abs(numberA - one.target)
      const distanceB = Math.abs(numberB - one.target)
      better = distanceB < distanceA ? 'b' : distanceB > distanceA ? 'a' : 'equal'
    }

    return {
      criterionId: one.id,
      criterionName: one.name,
      a: valueA,
      b: valueB,
      absolute,
      relative,
      better,
      comparable: true,
      describe: quantitative
        ? `${one.name}: ${String(valueA)}${one.unit ? ` ${one.unit}` : ''} against ${String(valueB)}${one.unit ? ` ${one.unit}` : ''}.`
        : `${one.name}: ${String(valueA)} against ${String(valueB)}. These are categories, so there is no difference to subtract.`
    }
  })
}

// ---------------------------------------------------------------- scoring

export interface Score {
  entityId: string
  entityName: string
  total: number
  /** Per criterion, so a total can be taken apart rather than only trusted. */
  contributions: { criterionId: string; criterionName: string; normalised: number | null; weight: number; contribution: number }[]
  /** Criteria this entity could not be scored on, which is what makes its total less comparable than the others. */
  unscored: string[]
  /** The weight actually used, which is less than the total weight when something was missing. */
  weightUsed: number
  describe: string
}

export interface Ranking {
  scores: Score[]
  /** The best under *this* weighting. Never called "the best". */
  leader: string | null
  /** True where two or more entities are within rounding of each other at the top. */
  tied: boolean
  /** Entities whose totals rest on less weight than the others, so their positions are less comparable. */
  incomplete: string[]
  weights: Record<string, number>
  notes: string[]
}

/**
 * A weighted score, with everything it rests on kept alongside it.
 *
 * Missing values are excluded from both the numerator and the denominator, so an entity missing a criterion is scored
 * on what is known about it rather than penalised for the gap. That is the least-wrong option and it is still not
 * neutral: `incomplete` names the entities it applies to, because a total from 60% of the weight is not directly
 * comparable with one from all of it.
 */
export function rank(entities: readonly Entity[], criteria: readonly Criterion[]): Ranking | CompareError {
  if (entities.length === 0) return fail('no-values', 'There are no entities to rank.')
  if (entities.length > COMPARE_LIMITS.entities) return fail('too-many', `At most ${COMPARE_LIMITS.entities.toLocaleString('en')} entities.`)
  if (criteria.length > COMPARE_LIMITS.criteria) return fail('too-many', `At most ${COMPARE_LIMITS.criteria} criteria.`)

  const scoring = criteria.filter((one) => one.direction !== 'neutral')
  if (scoring.length === 0) {
    return fail('no-values', 'Every criterion is neutral, so there is nothing to score on. A criterion needs a direction to contribute to a ranking.')
  }

  const normalisedBy = new Map<string, Normalised[]>()
  for (const one of scoring) {
    const values = normalise(entities, one)
    if (isCompareError(values)) return values
    normalisedBy.set(one.id, values)
  }

  const totalWeight = accurateSum(scoring.map((one) => one.weight))
  if (totalWeight <= 0) return fail('invalid-argument', 'Every weight is zero, so nothing contributes to the total.')

  const scores: Score[] = entities.map((entity) => {
    const contributions: Score['contributions'] = []
    const unscored: string[] = []
    let weighted = 0
    let weightUsed = 0

    for (const one of scoring) {
      const found = normalisedBy.get(one.id)?.find((n) => n.entityId === entity.id)
      if (!found || found.score === null) {
        unscored.push(one.name)
        contributions.push({ criterionId: one.id, criterionName: one.name, normalised: null, weight: one.weight, contribution: 0 })
        continue
      }
      const contribution = found.score * one.weight
      weighted += contribution
      weightUsed += one.weight
      contributions.push({ criterionId: one.id, criterionName: one.name, normalised: found.score, weight: one.weight, contribution })
    }

    const total = weightUsed > 0 ? weighted / weightUsed : 0
    return {
      entityId: entity.id,
      entityName: entity.name,
      total,
      contributions,
      unscored,
      weightUsed,
      describe:
        unscored.length === 0
          ? `Scored on all ${scoring.length} criteria.`
          : `Scored on ${scoring.length - unscored.length} of ${scoring.length} criteria; ${unscored.join(', ')} ${unscored.length === 1 ? 'was' : 'were'} missing. The total uses only the weight that could be applied, so it is not directly comparable with a total from all of it.`
    }
  })

  const ordered = [...scores].sort((a, b) => b.total - a.total)
  const tied = ordered.length > 1 && Math.abs(ordered[0].total - ordered[1].total) < 1e-9
  const incomplete = scores.filter((one) => one.weightUsed < totalWeight - 1e-12).map((one) => one.entityName)

  const weights: Record<string, number> = {}
  for (const one of scoring) weights[one.id] = one.weight / totalWeight

  const notes: string[] = [
    'This is the order under the weights given. Different weights give a different order, which is why no option is called the best outright.'
  ]
  if (tied) notes.push(`${ordered[0].entityName} and ${ordered[1].entityName} score the same. Under this weighting there is no separating them.`)
  if (incomplete.length > 0) {
    notes.push(`${incomplete.join(', ')} ${incomplete.length === 1 ? 'is' : 'are'} missing a value for at least one criterion, so ${incomplete.length === 1 ? 'its total rests' : 'their totals rest'} on less weight than the others.`)
  }

  return { scores: ordered, leader: ordered[0]?.entityId ?? null, tied, incomplete, weights, notes }
}

// ---------------------------------------------------------------- sensitivity

export interface Stability {
  /** The share of the weightings tried under which the leader stayed the leader. */
  leaderHeld: number
  leader: string | null
  /** Who else led, and how often. */
  alternatives: { entityId: string; entityName: string; share: number }[]
  samples: number
  seed: number
  verdict: 'stable' | 'sensitive' | 'highly-sensitive'
  describe: string
}

/**
 * How much of the weight space agrees with the current leader.
 *
 * Weights are drawn from a Dirichlet-like distribution by normalising exponentials, which covers the simplex evenly
 * rather than clustering near the middle. The result is a measured share, not a label: "stable" means the leader held
 * in most of the sample, and the number it came from is reported beside it.
 */
export function stability(entities: readonly Entity[], criteria: readonly Criterion[], options: { samples?: number; seed?: number } = {}): Stability | CompareError {
  const samples = Math.max(100, Math.min(COMPARE_LIMITS.samples, Math.round(options.samples ?? 2000)))
  const seed = Math.round(options.seed ?? 1)

  const base = rank(entities, criteria)
  if (isCompareError(base)) return base
  const leader = base.leader

  const scoring = criteria.filter((one) => one.direction !== 'neutral')
  const wins = new Map<string, number>()

  // A small deterministic generator, so the answer is the same every run.
  let state = (seed | 0) || 1
  const next = (): number => {
    state = (Math.imul(state ^ (state >>> 15), 0x2545f491) ^ (state >>> 13)) >>> 0
    return (state + 0.5) / 4294967296
  }

  for (let s = 0; s < samples; s++) {
    // Exponentials normalised: the standard way to draw a point uniformly from the simplex.
    const drawn = scoring.map(() => -Math.log(Math.max(1e-12, next())))
    const total = accurateSum(drawn)
    const weighted = scoring.map((one, i) => ({ ...one, weight: drawn[i] / total }))
    const result = rank(entities, weighted)
    if (isCompareError(result) || result.leader === null) continue
    wins.set(result.leader, (wins.get(result.leader) ?? 0) + 1)
  }

  const counted = accurateSum([...wins.values()])
  const leaderHeld = leader !== null && counted > 0 ? (wins.get(leader) ?? 0) / counted : 0
  const byName = new Map(entities.map((one) => [one.id, one.name]))

  const alternatives = [...wins.entries()]
    .filter(([id]) => id !== leader)
    .map(([id, count]) => ({ entityId: id, entityName: byName.get(id) ?? id, share: count / counted }))
    .sort((a, b) => b.share - a.share)

  const verdict: Stability['verdict'] = leaderHeld >= 0.8 ? 'stable' : leaderHeld >= 0.5 ? 'sensitive' : 'highly-sensitive'

  return {
    leaderHeld,
    leader,
    alternatives,
    samples,
    seed,
    verdict,
    describe:
      leaderHeld >= 0.8
        ? `${byName.get(leader ?? '') ?? 'The leader'} came first under ${Math.round(leaderHeld * 100)}% of ${samples.toLocaleString('en')} weightings drawn across the whole range. The result does not depend much on the exact weights.`
        : `${byName.get(leader ?? '') ?? 'The leader'} came first under only ${Math.round(leaderHeld * 100)}% of ${samples.toLocaleString('en')} weightings. ${alternatives.length > 0 ? `${alternatives[0].entityName} led under ${Math.round(alternatives[0].share * 100)}%.` : ''} The answer here is mostly a statement about the weights rather than about the options.`
  }
}

// ---------------------------------------------------------------- trade-offs

export interface ParetoResult {
  /** Entities nothing else beats on every criterion at once. */
  frontier: string[]
  /** Each dominated entity, and what dominates it. That is the useful half: it says why to stop considering one. */
  dominated: { entityId: string; entityName: string; dominatedBy: string[] }[]
  criteria: string[]
  describe: string
}

/**
 * The Pareto frontier: options that nothing beats on everything at once.
 *
 * Weight-free, which is what makes it worth computing before any weighting. An option outside the frontier is worse
 * than something else on every criterion, so no weighting whatsoever makes it the best -- that is a conclusion nobody
 * can argue with, unlike a ranking.
 */
export function pareto(entities: readonly Entity[], criteria: readonly Criterion[]): ParetoResult | CompareError {
  const scoring = criteria.filter((one) => one.direction !== 'neutral')
  if (scoring.length === 0) return fail('no-values', 'A Pareto frontier needs at least one criterion with a direction.')
  if (entities.length === 0) return fail('no-values', 'There are no entities to compare.')

  const normalisedBy = new Map<string, Map<string, number | null>>()
  for (const one of scoring) {
    const values = normalise(entities, one)
    if (isCompareError(values)) return values
    normalisedBy.set(one.id, new Map(values.map((n) => [n.entityId, n.score])))
  }

  const scoreOf = (entityId: string, criterionId: string): number | null => normalisedBy.get(criterionId)?.get(entityId) ?? null

  const dominates = (a: string, b: string): boolean => {
    let strictlyBetter = false
    for (const one of scoring) {
      const scoreA = scoreOf(a, one.id)
      const scoreB = scoreOf(b, one.id)
      // A criterion either of them is missing cannot support domination: it is not known to be at least as good.
      if (scoreA === null || scoreB === null) return false
      if (scoreA < scoreB - 1e-12) return false
      if (scoreA > scoreB + 1e-12) strictlyBetter = true
    }
    return strictlyBetter
  }

  const frontier: string[] = []
  const dominated: ParetoResult['dominated'] = []
  for (const entity of entities) {
    const by = entities.filter((other) => other.id !== entity.id && dominates(other.id, entity.id))
    if (by.length === 0) frontier.push(entity.id)
    else dominated.push({ entityId: entity.id, entityName: entity.name, dominatedBy: by.map((one) => one.id) })
  }

  return {
    frontier,
    dominated,
    criteria: scoring.map((one) => one.id),
    describe:
      dominated.length === 0
        ? `Every option is on the frontier: each is better than every other on at least one criterion. There is a genuine trade-off between all of them, and no weighting can remove it.`
        : `${frontier.length} of ${entities.length} options are on the frontier. ${dominated.map((one) => one.entityName).join(', ')} ${dominated.length === 1 ? 'is' : 'are'} beaten by something else on every criterion at once, so no weighting makes ${dominated.length === 1 ? 'it' : 'them'} best.`
  }
}

export interface TradeOff {
  a: string
  b: string
  /** Criteria where the first is better and the second is worse, and the reverse. This is what a trade-off is. */
  gains: { criterionName: string; by: string }[]
  losses: { criterionName: string; by: string }[]
  describe: string
}

/** What choosing one option over another gains and costs, criterion by criterion. */
export function tradeOff(a: Entity, b: Entity, criteria: readonly Criterion[]): TradeOff {
  const found = differences(a, b, criteria)
  const gains: TradeOff['gains'] = []
  const losses: TradeOff['losses'] = []

  for (const one of found) {
    if (!one.comparable || one.better === null || one.better === 'equal') continue
    const by =
      one.absolute === null
        ? `${String(one.a)} against ${String(one.b)}`
        : `${Number(Math.abs(one.absolute).toPrecision(4))}${criteria.find((c) => c.id === one.criterionId)?.unit ? ` ${criteria.find((c) => c.id === one.criterionId)?.unit}` : ''}`
    if (one.better === 'b') gains.push({ criterionName: one.criterionName, by })
    else losses.push({ criterionName: one.criterionName, by })
  }

  return {
    a: a.id,
    b: b.id,
    gains,
    losses,
    describe:
      gains.length === 0 && losses.length === 0
        ? `${b.name} and ${a.name} are the same on every criterion that could be compared.`
        : losses.length === 0
          ? `${b.name} is better than ${a.name} on ${gains.length} criteria and worse on none, so there is no trade-off between them.`
          : `Choosing ${b.name} over ${a.name} gains ${gains.map((one) => one.criterionName).join(', ')} and costs ${losses.map((one) => one.criterionName).join(', ')}.`
  }
}

// ---------------------------------------------------------------- filtering

export interface Filter {
  criterionId: string
  test: 'above' | 'below' | 'equals' | 'one-of' | 'present'
  value: number | string | null
  values: string[]
}

export interface FilterResult {
  kept: string[]
  removed: { entityId: string; entityName: string; because: string }[]
  /** Entities removed only because a value was missing. Distinguished, because that is not the same as failing. */
  removedForMissing: string[]
  describe: string
}

/**
 * Entities filtered, with the reason each one went.
 *
 * Removing for a missing value is reported separately. "This laptop does not meet your budget" and "nobody published
 * this laptop's price" are different facts, and a filter that reports both the same way loses the option that might
 * have been the right one.
 */
export function filterEntities(entities: readonly Entity[], criteria: readonly Criterion[], filters: readonly Filter[]): FilterResult {
  const byId = new Map(criteria.map((one) => [one.id, one]))
  const kept: string[] = []
  const removed: FilterResult['removed'] = []
  const removedForMissing: string[] = []

  for (const entity of entities) {
    let survives = true
    let because = ''
    let missing = false

    for (const filter of filters) {
      const one = byId.get(filter.criterionId)
      if (!one) continue
      const value = entity.values[filter.criterionId] ?? MISSING

      if (!hasValue(value)) {
        if (filter.test === 'present') {
          survives = false
          because = `${one.name} is not known for ${entity.name}.`
          missing = true
          break
        }
        survives = false
        because = `${one.name} is not known for ${entity.name}, so this filter could not be applied to it.`
        missing = true
        break
      }

      const asNumber = toNumber(value, one)
      let holds = true
      switch (filter.test) {
        case 'above':
          holds = asNumber !== null && typeof filter.value === 'number' && asNumber > filter.value
          break
        case 'below':
          holds = asNumber !== null && typeof filter.value === 'number' && asNumber < filter.value
          break
        case 'equals':
          holds = String(value) === String(filter.value)
          break
        case 'one-of':
          holds = filter.values.includes(String(value))
          break
        case 'present':
          holds = true
          break
      }
      if (!holds) {
        survives = false
        because = `${one.name} is ${String(value)}${one.unit ? ` ${one.unit}` : ''}, which does not pass the filter.`
        break
      }
    }

    if (survives) kept.push(entity.id)
    else {
      removed.push({ entityId: entity.id, entityName: entity.name, because })
      if (missing) removedForMissing.push(entity.id)
    }
  }

  return {
    kept,
    removed,
    removedForMissing,
    describe:
      removedForMissing.length === 0
        ? `${kept.length} of ${entities.length} pass.`
        : `${kept.length} of ${entities.length} pass. ${removedForMissing.length} ${removedForMissing.length === 1 ? 'was' : 'were'} removed only because a value is not known, which is not the same as failing the filter.`
  }
}

/** The assumptions the Page rests on, for a screen that wants to show them rather than have them inferred. */
export const COMPARE_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A value nobody knows is missing, never zero. Treating it as zero ranks the unknown as the worst.',
  'Not applicable and not known are different states and are reported differently.',
  'A normalised score is relative to the options being compared, so a score of 1 is the best of these rather than good.',
  'A criterion with no direction is shown and does not contribute to any score.',
  'A percentage difference is computed only where one means something. Categories have no distance between them.',
  'There is no universally best option. What is reported is the best under the weighting given.',
  'The Pareto frontier is weight-free: an option outside it is beaten on everything, so no weighting makes it best.',
  'An entity filtered out for a missing value is reported separately from one that failed the filter.'
])
