/**
 * The arithmetic. Nothing here asks a model anything.
 *
 * Orion reads the message, works out what the options are and what is being weighed, and later puts the answer
 * into words. Everything between those two jobs happens in this file, deterministically, from the structure: the
 * scaling, the weights, the hard requirements, the scores, the places, the ties, the ranges. Run it twice on the
 * same decision and it gives the same answer, which is the whole reason it is separate -- a model asked to "score
 * these three laptops out of ten" will happily produce three numbers, and they will be different numbers next
 * time.
 *
 * ## Five things this file refuses to do
 *
 * **It never reads a missing value as zero.** Zero is the worst possible score on a benefit criterion and the best
 * on a cost one, so "we do not know the price" would silently become "it is free". A criterion nobody has a value
 * for is left out of that option's score and counted against its coverage, and the option carries a range instead
 * of a figure.
 *
 * **It never lets a big weight excuse a broken requirement.** Hard requirements are applied first and separately.
 * An option over the budget is out, however good it is at everything else, and if nothing is under the budget it
 * says so rather than recommending the least-over one as though it were fine.
 *
 * **It never lets the raw numbers decide.** Price in hundreds of thousands and a rating out of five are brought
 * onto one scale per criterion before anything is added, and the method used is recorded.
 *
 * **It never claims 0.82 beats 0.81.** Scores within `tieWithin` share a place, and the result says they are tied.
 *
 * **It never produces a leader it cannot defend.** No feasible option, too little known, or a genuine dead heat all
 * produce `leaderId: null` with the reason, and the explanation then says there is no clear winner.
 */
import {
  DEFAULT_POLICY,
  rankEvidence,
  type Alternative,
  type ConstraintCheck,
  type Criterion,
  type Decision,
  type Known,
  type Meets,
  type Method,
  type Policy,
  type Result,
  type Scored,
  type ScoredPart
} from './types.ts'

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value)
const finite = (value: number): boolean => Number.isFinite(value)

// ---------------------------------------------------------------- bringing values onto one scale

/** A criterion's raw numbers turned into a function from raw to 0-to-1, with a sentence saying how. */
export interface Scaler {
  of(raw: number): number | null
  /** What was done, for the record: "price, cheapest is best, spread across what the options actually cost". */
  says: string
  /** True when every option had the same value, so this criterion cannot separate them. */
  flat: boolean
}

/**
 * How one criterion's values get onto the common scale.
 *
 * `observed` is every raw value anybody has for this criterion. It matters for `min-max`, which has nothing to
 * stretch between without it, and is ignored by the methods that scale against something fixed.
 */
export function scalerFor(criterion: Criterion, observed: readonly number[]): Scaler {
  const better = criterion.direction
  const numbers = observed.filter(finite)

  if (criterion.scaling === 'yes-no') {
    return {
      of: (raw) => (better === 'less-is-better' ? (raw ? 0 : 1) : raw ? 1 : 0),
      says: `${criterion.name}: ${better === 'less-is-better' ? 'not having it' : 'having it'} counts as better`,
      flat: new Set(numbers.map((one) => (one ? 1 : 0))).size <= 1 && numbers.length > 1
    }
  }

  if (criterion.scaling === 'bands') {
    const bands = criterion.bands ?? []
    return {
      of: (raw) => {
        // A banded criterion's raw value is the band's own worth, already between 0 and 1 by the time it is here.
        const worth = clamp01(raw)
        return better === 'less-is-better' ? 1 - worth : worth
      },
      says: `${criterion.name}: judged on a named scale (${bands.map((one) => one.name).join(', ') || 'no bands set'})`,
      flat: new Set(numbers).size <= 1 && numbers.length > 1
    }
  }

  if (criterion.scaling === 'own-scale' && criterion.scale) {
    const { worst, best } = criterion.scale
    const span = best - worst
    return {
      of: (raw) => (span === 0 ? 0.5 : clamp01((raw - worst) / span)),
      says: `${criterion.name}: on your own scale from ${worst} to ${best}`,
      flat: span === 0
    }
  }

  if (criterion.scaling === 'against-target' && criterion.target !== undefined && criterion.target !== 0) {
    const target = criterion.target
    return {
      of: (raw) => {
        if (better === 'less-is-better') return clamp01(1 - raw / target)
        if (better === 'closest-to-target') return clamp01(1 - Math.abs(raw - target) / Math.abs(target))
        return clamp01(raw / target)
      },
      says:
        better === 'less-is-better'
          ? `${criterion.name}: measured against ${target}${criterion.unit ? ' ' + criterion.unit : ''}, where being well under it is best`
          : `${criterion.name}: measured against ${target}${criterion.unit ? ' ' + criterion.unit : ''}`,
      flat: false
    }
  }

  // min-max, and the fallback for anything whose own settings are incomplete.
  const base = better === 'closest-to-target' && criterion.target !== undefined
    ? numbers.map((one) => Math.abs(one - (criterion.target as number)))
    : numbers
  const low = base.length ? Math.min(...base) : 0
  const high = base.length ? Math.max(...base) : 0
  const span = high - low
  /*
   * The same for everybody, which is a real finding -- and only sayable when there is more than one figure to
   * compare. With no figures at all, low and high are both nought and the span is nought, which is not every
   * option being the same; it is nobody having been measured. Saying "this is the same for every option" about a
   * criterion nobody has a figure for is a sentence that sends somebody looking for a difference that was never
   * recorded either way.
   */
  const flat = span === 0 && base.length > 1

  return {
    of: (raw) => {
      const value = better === 'closest-to-target' && criterion.target !== undefined ? Math.abs(raw - criterion.target) : raw
      /*
       * Every option the same: this criterion tells them apart not at all. Half rather than one, because one would
       * hand every option a full mark for a criterion that distinguished nothing, and two criteria like that would
       * outweigh the one criterion that actually separates them.
       */
      if (flat) return 0.5
      const spread = clamp01((value - low) / span)
      // Closest-to-target was turned into a distance above, and a smaller distance is better.
      return better === 'more-is-better' ? spread : 1 - spread
    },
    says: flat
      ? `${criterion.name}: every option is the same here, so it does not separate them`
      : better === 'more-is-better'
        ? `${criterion.name}: spread across what the options actually offer, more is better`
        : better === 'less-is-better'
          ? `${criterion.name}: spread across what the options actually ask, less is better`
          : `${criterion.name}: how close each option gets to ${criterion.target}`,
    flat
  }
}

/** Every raw value anybody has for a criterion. */
export const observedFor = (alternatives: readonly Alternative[], criterionId: string): number[] =>
  alternatives
    .map((one) => one.values[criterionId]?.value)
    .filter((one): one is number => typeof one === 'number' && finite(one))

/**
 * The same, but through whatever a what-if has replaced.
 *
 * It has to be the patched values: a scenario that changes one option's price changes what the cheapest and dearest
 * are, and scaling the patched price against the original spread puts it off the end of the scale.
 */
const observedThrough = (alternatives: readonly Alternative[], criterionId: string, options: RunOptions): number[] =>
  alternatives
    .map((one) => (options.values?.[`${one.id}/${criterionId}`] ?? one.values[criterionId])?.value)
    .filter((one): one is number => typeof one === 'number' && finite(one))

// ---------------------------------------------------------------- weights

export interface Weights {
  /** Criterion id to its share, adding up to 1. */
  share: Readonly<Record<string, number>>
  /** Anything the engine wants said about them. */
  notes: readonly string[]
}

/**
 * Importances turned into shares that add to one.
 *
 * Negative importances are treated as zero rather than quietly flipping a criterion's direction, which is what a
 * negative weight does in a weighted sum and is never what somebody meant by it.
 *
 * All of them zero means nobody has said what matters. Equal shares, and it says so -- the alternative is a score
 * of zero for everything, which looks like an answer and is not one.
 */
export function weightsFor(criteria: readonly Criterion[], override?: Readonly<Record<string, number>>): Weights {
  const notes: string[] = []
  const raw = criteria.map((one) => {
    const given = override?.[one.id] ?? one.importance
    const value = typeof given === 'number' && finite(given) ? given : 0
    if (value < 0) notes.push(`${one.name} was given a negative importance, which was read as nothing rather than as the opposite.`)
    return Math.max(0, value)
  })
  const total = raw.reduce((sum, one) => sum + one, 0)

  if (criteria.length === 0) return { share: {}, notes: ['There is nothing to weigh.'] }
  if (total === 0) {
    notes.push('Nothing was said about what matters most, so everything was given equal importance.')
    const even = 1 / criteria.length
    return { share: Object.fromEntries(criteria.map((one) => [one.id, even])), notes }
  }

  return { share: Object.fromEntries(criteria.map((one, at) => [one.id, raw[at] / total])), notes }
}

// ---------------------------------------------------------------- hard requirements

/**
 * Whether one option is on the right side of every line.
 *
 * `unknown` is not `meets`. An option whose price nobody knows has not been shown to be under the budget, and
 * treating silence as compliance is how an option that busts the budget ends up recommended.
 */
export function checkConstraints(decision: Decision, alternative: Alternative): ConstraintCheck[] {
  return decision.constraints.map((constraint) => {
    if (constraint.test === 'must-be-true' || constraint.test === 'must-be-false') {
      const held = constraint.criterionId ? alternative.values[constraint.criterionId] : undefined
      if (!held || held.value === null) return { constraintId: constraint.id, meets: 'unknown' as Meets }
      const isTrue = held.value !== 0
      const wanted = constraint.test === 'must-be-true'
      return { constraintId: constraint.id, meets: (isTrue === wanted ? 'meets' : 'fails') as Meets }
    }

    const held = constraint.criterionId ? alternative.values[constraint.criterionId] : undefined
    if (!held || held.value === null || constraint.limit === null) {
      return { constraintId: constraint.id, meets: 'unknown' as Meets }
    }

    const value = held.value
    const limit = constraint.limit
    const passes =
      constraint.test === 'at-most' ? value <= limit : constraint.test === 'at-least' ? value >= limit : value === limit

    if (passes) {
      /*
       * Known only to within a range, and the range crosses the line: it passes on the figure in hand but not on
       * the whole range, which is `conditional` rather than `meets`. Reporting it as clear would be reporting a
       * guess as a fact.
       */
      const crosses =
        (constraint.test === 'at-most' && held.high !== undefined && held.high > limit) ||
        (constraint.test === 'at-least' && held.low !== undefined && held.low < limit)
      if (crosses) {
        return {
          constraintId: constraint.id,
          meets: 'conditional' as Meets,
          ifAlso: `it comes in at the better end of ${held.low ?? value} to ${held.high ?? value}${constraint.unit ? ' ' + constraint.unit : ''}`
        }
      }
      return { constraintId: constraint.id, meets: 'meets' as Meets }
    }

    const over = constraint.test === 'at-most' ? value - limit : constraint.test === 'at-least' ? limit - value : Math.abs(value - limit)
    return { constraintId: constraint.id, meets: 'fails' as Meets, over }
  })
}

/** One word for how an option stands against all the lines at once: the worst of them. */
export function feasibilityOf(checks: readonly ConstraintCheck[]): Meets {
  if (checks.some((one) => one.meets === 'fails')) return 'fails'
  if (checks.some((one) => one.meets === 'unknown')) return 'unknown'
  if (checks.some((one) => one.meets === 'conditional')) return 'conditional'
  return 'meets'
}

// ---------------------------------------------------------------- scoring

export interface RunOptions {
  /** Weights to use instead of the decision's own. For what-ifs. */
  weights?: Readonly<Record<string, number>>
  /** Values to use instead, keyed `alternativeId/criterionId`. For what-ifs. */
  values?: Readonly<Record<string, Known>>
  /** New limits on hard requirements, keyed by constraint id. */
  limits?: Readonly<Record<string, number>>
  /** Criteria to leave out entirely. */
  without?: readonly string[]
  /** Overrides the decision's own policy. */
  policy?: Partial<Policy>
  /** Which run this is. Handed in so this file has no counter of its own. */
  run?: number
  /** For the timestamp, handed in so this file has no clock. */
  now?: number
}

const valueFor = (alternative: Alternative, criterionId: string, options: RunOptions): Known | undefined =>
  options.values?.[`${alternative.id}/${criterionId}`] ?? alternative.values[criterionId]

/**
 * The whole arithmetic, once.
 *
 * Reads nothing it is not given and keeps nothing: hand it the same decision twice and it answers the same twice.
 * That is what lets a what-if be a patch over the same call rather than a second engine.
 */
export function run(decision: Decision, options: RunOptions = {}): Result {
  const policy: Policy = { ...DEFAULT_POLICY, ...decision.policy, ...options.policy }
  const at = options.now ?? 0
  const runNumber = options.run ?? 1
  const notes: string[] = []

  const patched: Decision = options.limits
    ? {
        ...decision,
        constraints: decision.constraints.map((one) =>
          options.limits?.[one.id] !== undefined ? { ...one, limit: options.limits[one.id] } : one
        )
      }
    : decision

  const left = options.without?.length
    ? decision.criteria.filter((one) => !options.without?.includes(one.id))
    : decision.criteria
  if (options.without?.length) notes.push(`Left out of the comparison: ${options.without.length} of what was being weighed.`)

  if (decision.alternatives.length === 0) {
    return empty(decision, runNumber, policy, at, 'nothing-to-compare', [...notes, 'There are no options to compare yet.'])
  }

  /*
   * `drop-the-criterion` has to happen before the weights are worked out: the point of it is that every option is
   * judged on the same things, so a criterion missing for anybody is gone for everybody, and the remaining weights
   * share out what it had.
   */
  const criteria =
    policy.whenMissing === 'drop-the-criterion'
      ? left.filter((one) => decision.alternatives.every((alt) => valueFor(alt, one.id, options)?.value !== null && valueFor(alt, one.id, options) !== undefined))
      : left
  if (policy.whenMissing === 'drop-the-criterion' && criteria.length < left.length) {
    notes.push(`${left.length - criteria.length} of the things being weighed were left out because they are not known for every option.`)
  }

  const weights = weightsFor(criteria, options.weights)
  notes.push(...weights.notes)

  const scalers = new Map<string, Scaler>()
  for (const criterion of criteria) {
    const scaler = scalerFor(criterion, observedThrough(decision.alternatives, criterion.id, options))
    scalers.set(criterion.id, scaler)
    if (scaler.flat) notes.push(`${criterion.name} is the same for every option, so it does not help choose between them.`)
  }

  const scored: Scored[] = decision.alternatives.map((alternative) => {
    const parts: ScoredPart[] = []
    let covered = 0
    let sum = 0
    let worst = 0
    let best = 0

    for (const criterion of criteria) {
      const weight = weights.share[criterion.id] ?? 0
      const held = valueFor(alternative, criterion.id, options)
      const scaler = scalers.get(criterion.id)
      const raw = held?.value ?? null

      if (raw === null || !scaler) {
        parts.push({ criterionId: criterion.id, raw: null, scaled: null, weight: 0, contributed: 0, origin: held?.origin ?? 'unknown' })
        // Nothing is added for a criterion nobody knows. `best` gains the whole weight, which is the honest top end.
        best += weight
        continue
      }

      const scaled = scaler.of(raw)
      if (scaled === null) {
        parts.push({ criterionId: criterion.id, raw, scaled: null, weight: 0, contributed: 0, origin: held?.origin ?? 'unknown' })
        best += weight
        continue
      }

      covered += weight
      parts.push({ criterionId: criterion.id, raw, scaled, weight, contributed: weight * scaled, origin: held?.origin ?? 'unknown' })
      sum += weight * scaled

      // A range on the value becomes a range on the score, which is where "it depends what the price turns out to be" lives.
      const lowScaled = held?.low !== undefined ? scaler.of(held.low) : scaled
      const highScaled = held?.high !== undefined ? scaler.of(held.high) : scaled
      const pair = [lowScaled ?? scaled, highScaled ?? scaled]
      worst += weight * Math.min(...pair)
      best += weight * Math.max(...pair)
    }

    /*
     * Shared out over what is actually known, so an option judged on three of five criteria is not punished for the
     * two nobody has figures for. `coverage` is what stops that being a free pass: it says how much of the weight
     * the figure rests on, and a low one is reported rather than buried.
     */
    const score = covered > 0 ? sum / covered : 0
    const used = parts.map((part) => (part.weight > 0 && covered > 0 ? { ...part, weight: part.weight / covered, contributed: part.contributed / covered } : part))

    const checks = checkConstraints(patched, alternative)
    const knownness = criteria.length
      ? criteria.reduce((total, criterion) => total + rankEvidence(valueFor(alternative, criterion.id, options)?.origin ?? 'unknown'), 0) / criteria.length
      : 0

    return {
      alternativeId: alternative.id,
      score,
      atWorst: worst,
      atBest: best,
      coverage: covered,
      parts: used,
      checks,
      feasible: feasibilityOf(checks),
      place: 0,
      tied: false,
      evidence: knownness
    }
  })

  const method = options.policy?.method ?? policy.method
  return finish(patched, scored, { method, policy, run: runNumber, at, notes, criteria, options })
}

// ---------------------------------------------------------------- the methods

interface FinishOptions {
  method: Method
  policy: Policy
  run: number
  at: number
  notes: string[]
  criteria: readonly Criterion[]
  options: RunOptions
}

/**
 * Puts the options in order by whichever method was chosen, and decides whether there is a leader.
 *
 * Each method hands back two things: the order, and a **key** per option -- the figure that method actually used to
 * decide. The places and the ties come from the key, never from the weighted score, because for two of the methods
 * the weighted score is not what decided anything. Reading places off the score while the order came from
 * somewhere else is how two options the method deliberately separated end up sharing a place.
 */
function finish(decision: Decision, scored: Scored[], o: FinishOptions): Result {
  const notes = [...o.notes]
  const notBeaten = nonDominated(scored, o.criteria).map((one) => one.alternativeId)

  // Only an option shown to clear every line may lead. Everything else is ranked and shown, but never recommended.
  const eligible = scored.filter((one) => one.feasible === 'meets')
  const ruledOut = scored.filter((one) => one.feasible === 'fails')
  const nothingIsFeasible = eligible.length === 0 && ruledOut.length > 0

  const byScore = (): Map<string, number> => new Map(scored.map((one) => [one.alternativeId, one.score]))
  let key: Map<string, number>
  let howItWorked: string

  if (o.method === 'in-order-of-importance') {
    const ranked = [...o.criteria].sort((a, b) => b.importance - a.importance)
    /*
     * The key for taking the most important thing first: each criterion's scaled value, in importance order,
     * packed into one number so later criteria can only ever break a tie on the earlier ones. The base is a
     * hundred, which is wider than any pair of values can be apart once they are rounded to the tie band.
     */
    const step = Math.max(2, Math.ceil(1 / Math.max(o.policy.tieWithin, 0.001)))
    key = new Map(
      scored.map((one) => {
        let value = 0
        for (let at = 0; at < ranked.length; at++) {
          const part = one.parts.find((p) => p.criterionId === ranked[at].id)
          const banded = part?.scaled === null || part?.scaled === undefined ? 0 : Math.round(part.scaled * step)
          value += banded / Math.pow(step + 1, at)
        }
        return [one.alternativeId, value]
      })
    )
    howItWorked = `Compared on ${ranked[0]?.name ?? 'the most important thing'} first, and only on the next thing when that could not separate them.`
    notes.push('The figure beside each option is the weighted one, shown so the options can be compared; the order comes from taking the most important thing first.')
  } else if (o.method === 'rule-out') {
    // Clearing the requirements comes first; among those that clear them, the weighted figure.
    key = new Map(scored.map((one) => [one.alternativeId, rankValue(one) + one.score / 10]))
    howItWorked =
      eligible.length === 1
        ? 'Everything that broke a hard requirement was ruled out, and one option was left.'
        : eligible.length === 0
          ? 'Nothing clears every hard requirement.'
          : `Everything that broke a hard requirement was ruled out, which left ${eligible.length}; those were then weighed.`
  } else if (o.method === 'nothing-beats-it') {
    key = new Map(scored.map((one) => [one.alternativeId, (notBeaten.includes(one.alternativeId) ? 1 : 0) + one.score / 10]))
    howItWorked = `Looked for options that nothing else beats outright: ${notBeaten.length} of ${scored.length}.`
  } else if (o.method === 'closest-to-what-you-asked') {
    const withTargets = o.criteria.filter((one) => one.target !== undefined)
    key = byScore()
    if (withTargets.length === 0) {
      notes.push('No targets were set, so the options were weighed in the ordinary way instead.')
      howItWorked = 'Importance times how good each option is at each thing, added up.'
    } else {
      howItWorked = `Measured against the ${withTargets.length} target${withTargets.length === 1 ? '' : 's'} you set.`
    }
  } else if (o.method === 'expected-value') {
    const expected = new Map<string, number | null>()
    for (const alternative of decision.alternatives) expected.set(alternative.id, expectedValueOf(alternative))
    if ([...expected.values()].some((one) => one === null)) {
      notes.push(
        'Chance times outcome needs a chance and a value for every outcome of every option, and that is not known here, so the options were weighed in the ordinary way instead.'
      )
      key = byScore()
      howItWorked = 'Importance times how good each option is at each thing, added up.'
    } else {
      key = new Map(scored.map((one) => [one.alternativeId, expected.get(one.alternativeId) ?? 0]))
      howItWorked = 'Each outcome multiplied by its chance and added up, for every option.'
      notes.push('The figure beside each option is the weighted one; the order comes from chance times outcome.')
    }
  } else {
    key = byScore()
    howItWorked =
      'Importance times how good each option is at each thing, added up, with anything unknown left out and the rest shared over what is known.'
  }

  const keyOf = (one: Scored): number => key.get(one.alternativeId) ?? 0
  const order = [...scored].sort((a, b) => keyOf(b) - keyOf(a))

  /*
   * The band two keys have to be inside to share a place.
   *
   * The tie band is stated on the 0-to-1 scale the weighted score uses, so it only means the same thing for the
   * methods whose key *is* that score. For the others the key is a different quantity and the band for it is
   * exactness: those methods already decided what counts as too close, inside their own key.
   */
  const sameWithin = o.method === 'weighted-sum' || o.method === 'closest-to-what-you-asked' ? o.policy.tieWithin : 0

  let place = 0
  let previous: Scored | null = null
  for (const one of order) {
    const same = previous !== null && Math.abs(keyOf(previous) - keyOf(one)) <= sameWithin
    if (!same) place += 1
    one.place = place
    previous = one
  }
  for (const one of scored) one.tied = scored.some((other) => other !== one && other.place === one.place)

  /*
   * Nothing is known about anything.
   *
   * Every option scores nought, so they tie, and a dead heat is a finding -- but it was not this finding. Nothing
   * was close; nothing had been measured. Reported as what it is, so the card leads with the question rather than
   * with a table of noughts and a sentence about how evenly matched they are.
   */
  const nothingKnown = scored.length > 0 && scored.every((one) => one.coverage === 0)
  if (nothingKnown) {
    notes.push('Nothing is known yet about how these options compare on any of the things that matter.')
  }

  const thin = scored.filter((one) => one.coverage < o.policy.needsCoverage)
  if (thin.length > 0) {
    notes.push(
      thin.length === scored.length
        ? 'Too little is known about every option for the figures to be worth much; what is below is what can be said so far.'
        : `${thin.length} option${thin.length === 1 ? ' is' : 's are'} not properly comparable yet: less than ${Math.round(o.policy.needsCoverage * 100)}% of what matters is known about ${thin.length === 1 ? 'it' : 'them'}.`
    )
  }

  const leader = nothingKnown
    ? ({ id: null, why: 'too-little-known' } as { id: string | null; why?: Result['noLeader'] })
    : pickLeader(order, eligible, o, notBeaten, keyOf, sameWithin)
  if (nothingIsFeasible) {
    notes.push('No option clears every hard requirement, so none of them is being recommended.')
  }

  /*
   * Said out loud whenever an option outscores the leader and was passed over for not being comparable. Without
   * this the card shows a recommendation with something above it in the table and no explanation, which reads as
   * a bug in the ranking.
   */
  const passedOver = order.filter(
    (one) => one.feasible === 'meets' && one.alternativeId !== leader.id && keyOf(one) > keyOf(order.find((two) => two.alternativeId === leader.id) ?? one)
  )
  for (const one of passedOver.slice(0, 2)) {
    const name = decision.alternatives.find((two) => two.id === one.alternativeId)?.name ?? one.alternativeId
    notes.push(
      `${name} scores higher, but only ${Math.round(one.coverage * 100)}% of what matters is known about it, so it is not being put in front of options that have actually been compared.`
    )
  }

  return {
    decisionId: decision.id,
    run: o.run,
    method: o.method,
    whenMissing: o.policy.whenMissing,
    scored,
    leaderId: leader.id,
    ...(leader.why ? { noLeader: leader.why } : {}),
    nothingIsFeasible,
    notBeaten,
    howItWorked,
    notes,
    at: o.at
  }
}

const rankValue = (one: Scored): number => (one.feasible === 'meets' ? 3 : one.feasible === 'conditional' ? 2 : one.feasible === 'unknown' ? 1 : 0)

/** Who leads, or why nobody does. */
function pickLeader(
  order: readonly Scored[],
  eligible: readonly Scored[],
  o: FinishOptions,
  notBeaten: readonly string[],
  keyOf: (one: Scored) => number,
  sameWithin: number
): { id: string | null; why?: Result['noLeader'] } {
  if (order.length === 0) return { id: null, why: 'nothing-to-compare' }
  if (eligible.length === 0) {
    return { id: null, why: order.some((one) => one.feasible === 'fails') ? 'everything-ruled-out' : 'too-little-known' }
  }

  /*
   * An option may not be recommended while another one is better known.
   *
   * Sharing the weight over what is known means an option with one figure against it scores on that figure alone,
   * and an option with one *good* figure against it scores full marks. Orbis Notes, known only to have four days
   * of effort in it, came first over a project that had been compared on all three things that mattered -- and
   * "we know nothing about this one" is not a reason to choose it.
   *
   * Not a flat threshold, which would refuse an answer on every first pass where little is known about anything.
   * Two options each known to forty per cent are a fair comparison and the better one of them leads; forty against
   * a hundred is not a comparison at all.
   */
  const bestKnown = Math.max(...eligible.map((one) => one.coverage))
  const comparable = eligible.filter((one) => one.coverage >= o.policy.needsCoverage || one.coverage >= bestKnown - 1e-9)

  const top = order.find((one) => one.feasible === 'meets' && comparable.includes(one))
  if (!top) return { id: null, why: 'too-little-known' }

  if (o.policy.whenMissing === 'say-it-is-not-known' && top.coverage < o.policy.needsCoverage) {
    return { id: null, why: 'too-little-known' }
  }

  /*
   * This method was picked because too little is known to weigh things up, so the weighted figure cannot be used to
   * separate two options that nothing beats. More than one of them means there is no single answer yet, and saying
   * which preference would settle it is more use than naming one.
   */
  if (o.method === 'nothing-beats-it') {
    const standing = eligible.filter((one) => notBeaten.includes(one.alternativeId))
    if (standing.length === 1) return { id: standing[0].alternativeId }
    return { id: null, why: 'too-close-to-call' }
  }

  // Two options level on the figure this method used: saying one wins is inventing a difference the inputs cannot support.
  const alsoTop = eligible.filter((one) => one !== top && Math.abs(keyOf(one) - keyOf(top)) <= sameWithin)
  if (alsoTop.length > 0) {
    // Unless something else separates them: one of them being the only option nothing beats outright does.
    const clear = [top, ...alsoTop].filter((one) => notBeaten.includes(one.alternativeId))
    if (clear.length === 1) return { id: clear[0].alternativeId }
    return { id: null, why: 'too-close-to-call' }
  }

  return { id: top.alternativeId }
}

// ---------------------------------------------------------------- what nothing else beats

/**
 * Which options nothing else beats outright.
 *
 * One option beats another when it is at least as good on everything and better on something. Both have to have a
 * value for every criterion being compared: an option nobody has figures for is not beaten, it is unexamined, and
 * dropping it for that reason is how the quietly-best option disappears.
 */
export function nonDominated(scored: readonly Scored[], criteria: readonly Criterion[]): readonly Scored[] {
  const scaled = new Map<string, Map<string, number>>()
  for (const one of scored) {
    const row = new Map<string, number>()
    for (const part of one.parts) if (part.scaled !== null) row.set(part.criterionId, part.scaled)
    scaled.set(one.alternativeId, row)
  }

  const beats = (a: string, b: string): boolean => {
    const one = scaled.get(a)
    const two = scaled.get(b)
    if (!one || !two) return false
    let strictly = false
    for (const criterion of criteria) {
      const x = one.get(criterion.id)
      const y = two.get(criterion.id)
      // Not known for one of them: no claim either way can be made on this criterion, so no claim can be made at all.
      if (x === undefined || y === undefined) return false
      if (x < y) return false
      if (x > y) strictly = true
    }
    return strictly
  }

  return scored.filter((one) => !scored.some((other) => other !== one && beats(other.alternativeId, one.alternativeId)))
}

// ---------------------------------------------------------------- chance times outcome

/**
 * Chance times outcome, added up. Null when it cannot honestly be worked out.
 *
 * Null is the usual answer and the important one. The calculation needs a real chance and a real value for every
 * outcome; where they do not exist, this returns null and the caller falls back to weighing, rather than a
 * percentage being invented so that a formula has something to chew on.
 */
export function expectedValueOf(alternative: Alternative): number | null {
  const outcomes = alternative.outcomes
  if (!outcomes || outcomes.length === 0) return null
  let total = 0
  let chances = 0
  for (const one of outcomes) {
    if (one.chance.value === null || one.worth.value === null) return null
    if (!finite(one.chance.value) || !finite(one.worth.value)) return null
    if (one.chance.value < 0 || one.chance.value > 1) return null
    total += one.chance.value * one.worth.value
    chances += one.chance.value
  }
  // Chances that do not add up to one mean an outcome is missing, and the figure would be an average of part of it.
  if (Math.abs(chances - 1) > 0.02) return null
  return total
}

// ---------------------------------------------------------------- picking a method

/**
 * Which method suits the shape of this decision.
 *
 * Weighing is the default because it suits most decisions, not because it suits all of them, and three shapes are
 * genuinely different: one option left after the hard requirements is an answer with no arithmetic in it; real
 * chances and real outcomes are what chance-times-outcome is for; and fewer than two things to weigh cannot be
 * weighed at all.
 */
export function methodFor(decision: Decision): { method: Method; because: string } {
  if (decision.alternatives.length === 0) return { method: 'weighted-sum', because: 'There is nothing to compare yet.' }

  const clears = decision.alternatives.filter((one) => feasibilityOf(checkConstraints(decision, one)) === 'meets')
  if (decision.constraints.length > 0 && clears.length === 1) {
    return { method: 'rule-out', because: 'Only one option clears every hard requirement, so the requirements decide it.' }
  }
  if (decision.constraints.length > 0 && clears.length === 0) {
    return { method: 'rule-out', because: 'Nothing clears every hard requirement, which is the first thing to say.' }
  }

  if (decision.alternatives.every((one) => expectedValueOf(one) !== null)) {
    return { method: 'expected-value', because: 'Every option has outcomes with real chances attached, which is what chance times outcome needs.' }
  }

  const usable = decision.criteria.filter((criterion) => observedFor(decision.alternatives, criterion.id).length >= 2)
  if (usable.length < 2 && decision.criteria.length >= 2) {
    return { method: 'nothing-beats-it', because: 'Too little is known to weigh things up, so the most that can be said is which options nothing else beats.' }
  }

  const targets = decision.criteria.filter((one) => one.target !== undefined)
  if (targets.length >= 2 && targets.length >= decision.criteria.length / 2) {
    return { method: 'closest-to-what-you-asked', because: 'You set targets for most of what matters, so the options are measured against them.' }
  }

  return { method: 'weighted-sum', because: 'The options differ across several things that matter in different amounts, which is what weighing is for.' }
}

// ---------------------------------------------------------------- nothing to do

function empty(decision: Decision, run: number, policy: Policy, at: number, why: NonNullable<Result['noLeader']>, notes: string[]): Result {
  return {
    decisionId: decision.id,
    run,
    method: policy.method,
    whenMissing: policy.whenMissing,
    scored: [],
    leaderId: null,
    noLeader: why,
    nothingIsFeasible: false,
    notBeaten: [],
    howItWorked: 'Nothing was worked out: there is nothing to compare.',
    notes,
    at
  }
}
