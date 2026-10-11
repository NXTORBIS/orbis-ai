/**
 * Reading a decision back from the disk.
 *
 * A file can be edited by anything, can have been written by an older Orbis, and can have been half-written when
 * the machine went off. So a decision coming off the disk is checked exactly as hard as one coming back from a
 * model: every id, every direction, every figure, and the version at the top.
 *
 * ## A version that is not understood is not a decision to be repaired
 *
 * `v` higher than this Orbis knows means a newer Orbis wrote it. Reading it anyway -- dropping the fields this
 * version does not recognise and then writing it back -- is how a saved decision silently becomes a worse copy of
 * itself. So an unknown version is refused, which leaves the file exactly as it is for the Orbis that can read it.
 *
 * ## Anything that cannot be checked is dropped, not defaulted
 *
 * A figure whose criterion no longer exists goes. A requirement about a criterion that is not there goes. The
 * alternative -- keeping them and hoping -- puts every option at "cannot tell" against a line nothing is measured
 * on, which is a decision that can never produce an answer and no screen that could explain why.
 */
import {
  DECISION_VERSION,
  DEFAULT_POLICY,
  type Alternative,
  type Assumption,
  type Band,
  type Constraint,
  type ConstraintCheck,
  type ConstraintTest,
  type Criterion,
  type Decision,
  type DecisionSort,
  type Direction,
  type Gap,
  type Known,
  type Meets,
  type Method,
  type Origin,
  type Outcome,
  type Policy,
  type Result,
  type Revision,
  type Scaling,
  type Scenario,
  type Scored,
  type ScoredPart,
  type WhenMissing
} from './types.ts'

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const words = (value: unknown, most: number): string => (typeof value === 'string' ? value.slice(0, most) : '')
const num = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const maybeNum = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const flag = (value: unknown, fallback = false): boolean => (typeof value === 'boolean' ? value : fallback)
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
const id = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 64) : ''

const ORIGINS: readonly Origin[] = ['measured', 'user-said', 'from-source', 'derived', 'estimated', 'assumed', 'unknown']
const DIRECTIONS: readonly Direction[] = ['more-is-better', 'less-is-better', 'closest-to-target']
const SCALINGS: readonly Scaling[] = ['min-max', 'against-target', 'bands', 'yes-no', 'own-scale']
const TESTS: readonly ConstraintTest[] = ['at-most', 'at-least', 'must-equal', 'must-be-true', 'must-be-false']
const MEETS: readonly Meets[] = ['meets', 'fails', 'conditional', 'unknown']
const SORTS: readonly DecisionSort[] = ['buying', 'what-to-build-first', 'learning', 'time', 'technical', 'high-stakes', 'other']
const METHODS: readonly Method[] = ['weighted-sum', 'in-order-of-importance', 'rule-out', 'nothing-beats-it', 'closest-to-what-you-asked', 'expected-value']
const MISSING: readonly WhenMissing[] = ['share-out-the-rest', 'drop-the-criterion', 'say-it-is-not-known']
const WORTHS = ['would-decide-it', 'could-change-it', 'would-not-change-it', 'not-tested'] as const
const MATTERS = ['a-lot', 'some', 'little', 'not-tested'] as const
const REVERSIBILITY = ['easy', 'some-cost', 'hard', 'effectively-final', 'unknown'] as const
const NO_LEADER = ['everything-ruled-out', 'too-little-known', 'too-close-to-call', 'nothing-to-compare'] as const

function cleanKnown(raw: unknown): Known | null {
  const one = object(raw)
  const value = maybeNum(one.value)
  const origin = oneOf(one.origin, ORIGINS, 'unknown')
  // Not known is a value, but it has to be the right one: null with `unknown`, never a number with `unknown`.
  if (value === null) return { value: null, origin: 'unknown' }
  const low = maybeNum(one.low)
  const high = maybeNum(one.high)
  const says = words(one.says, 160)
  const band = words(one.band, 40)
  return {
    value,
    origin: origin === 'unknown' ? 'estimated' : origin,
    ...(low !== null && low <= value ? { low } : {}),
    ...(high !== null && high >= value ? { high } : {}),
    ...(says ? { says } : {}),
    ...(band ? { band } : {})
  }
}

function cleanCriterion(raw: unknown): Criterion | null {
  const one = object(raw)
  const theId = id(one.id)
  const name = words(one.name, 60).trim()
  if (theId === '' || name === '') return null

  const bands = list(one.bands)
    .map((two): Band | null => {
      const band = object(two)
      const bandName = words(band.name, 40).trim()
      const worth = maybeNum(band.worth)
      return bandName === '' || worth === null ? null : { name: bandName, worth: Math.min(1, Math.max(0, worth)) }
    })
    .filter((two): two is Band => two !== null)
    .slice(0, 8)

  const target = maybeNum(one.target)
  const scaleRaw = object(one.scale)
  const worst = maybeNum(scaleRaw.worst)
  const best = maybeNum(scaleRaw.best)
  let scaling = oneOf(one.scaling, SCALINGS, 'min-max')
  // A scaling whose own settings are gone cannot be used; spreading across the observed values always can be.
  if (scaling === 'against-target' && (target === null || target === 0)) scaling = 'min-max'
  if (scaling === 'bands' && bands.length < 2) scaling = 'min-max'
  if (scaling === 'own-scale' && (worst === null || best === null)) scaling = 'min-max'

  return {
    id: theId,
    name,
    describe: words(one.describe, 240),
    direction: oneOf(one.direction, DIRECTIONS, 'more-is-better'),
    importance: Math.min(100, Math.max(0, num(one.importance, 1))),
    scaling,
    unit: words(one.unit, 24),
    ...(bands.length >= 2 ? { bands } : {}),
    ...(target !== null ? { target } : {}),
    ...(worst !== null && best !== null ? { scale: { worst, best } } : {}),
    origin: oneOf(one.origin, ORIGINS, 'user-said'),
    ...(words(one.because, 200) ? { because: words(one.because, 200) } : {})
  }
}

function cleanOutcome(raw: unknown): Outcome | null {
  const one = object(raw)
  const says = words(one.says, 200).trim()
  const chance = cleanKnown(one.chance)
  const worth = cleanKnown(one.worth)
  if (says === '' || !chance || !worth) return null
  if (chance.value === null || chance.value < 0 || chance.value > 1) return null
  return { says, chance, worth }
}

function cleanAlternative(raw: unknown, criteria: ReadonlySet<string>): Alternative | null {
  const one = object(raw)
  const theId = id(one.id)
  const name = words(one.name, 80).trim()
  if (theId === '' || name === '') return null

  const values: Record<string, Known> = {}
  for (const [key, held] of Object.entries(object(one.values))) {
    // A figure about something that is not being weighed cannot be shown and cannot be scored.
    if (!criteria.has(key)) continue
    const made = cleanKnown(held)
    if (made && made.value !== null) values[key] = made
  }

  const outcomes = list(one.outcomes)
    .map((two) => cleanOutcome(two))
    .filter((two): two is Outcome => two !== null)
    .slice(0, 10)

  return {
    id: theId,
    name,
    describe: words(one.describe, 300),
    values,
    upsides: list(one.upsides).map((two) => words(two, 160)).filter((two) => two.trim() !== '').slice(0, 6),
    downsides: list(one.downsides).map((two) => words(two, 160)).filter((two) => two.trim() !== '').slice(0, 6),
    origin: oneOf(one.origin, ORIGINS, 'user-said'),
    ...(typeof one.reversibility === 'string' ? { reversibility: oneOf(one.reversibility, REVERSIBILITY, 'unknown') } : {}),
    ...(outcomes.length ? { outcomes } : {})
  }
}

function cleanConstraint(raw: unknown, criteria: ReadonlySet<string>): Constraint | null {
  const one = object(raw)
  const theId = id(one.id)
  const says = words(one.says, 200).trim()
  if (theId === '' || says === '') return null
  const criterionId = id(one.criterionId)
  if (criterionId === '' || !criteria.has(criterionId)) return null
  const test = oneOf(one.test, TESTS, 'at-most')
  const limit = maybeNum(one.limit)
  if (test !== 'must-be-true' && test !== 'must-be-false' && limit === null) return null
  return {
    id: theId,
    says,
    criterionId,
    test,
    limit: test === 'must-be-true' || test === 'must-be-false' ? null : limit,
    unit: words(one.unit, 24),
    origin: oneOf(one.origin, ORIGINS, 'user-said')
  }
}

function cleanPolicy(raw: unknown): Policy {
  const one = object(raw)
  return {
    method: oneOf(one.method, METHODS, DEFAULT_POLICY.method),
    whenMissing: oneOf(one.whenMissing, MISSING, DEFAULT_POLICY.whenMissing),
    tieWithin: Math.min(0.2, Math.max(0, num(one.tieWithin, DEFAULT_POLICY.tieWithin))),
    needsCoverage: Math.min(1, Math.max(0, num(one.needsCoverage, DEFAULT_POLICY.needsCoverage)))
  }
}

/**
 * A decision off the disk, or null.
 *
 * Null means the file is not a decision this Orbis can use -- including when it was written by a newer one. The
 * caller treats that as a decision it does not have rather than one to fix, and `storedFile.ts` decides what
 * happens to the file.
 */
export function cleanDecision(raw: unknown): Decision | null {
  const one = object(raw)
  const theId = id(one.id)
  if (theId === '') return null
  const v = num(one.v, 0)
  // A newer shape than this Orbis knows. Left alone rather than read badly.
  if (v < 1 || v > DECISION_VERSION) return null

  const criteria = list(one.criteria)
    .map((two) => cleanCriterion(two))
    .filter((two): two is Criterion => two !== null)
    .slice(0, 20)
  const criterionIds = new Set(criteria.map((two) => two.id))

  const alternatives = list(one.alternatives)
    .map((two) => cleanAlternative(two, criterionIds))
    .filter((two): two is Alternative => two !== null)
    .slice(0, 12)
  const alternativeIds = new Set(alternatives.map((two) => two.id))
  if (alternatives.length === 0) return null

  const constraints = list(one.constraints)
    .map((two) => cleanConstraint(two, criterionIds))
    .filter((two): two is Constraint => two !== null)
    .slice(0, 12)

  const about = (value: unknown): { criterionId?: string; alternativeId?: string; constraintId?: string } => {
    const held = object(value)
    const criterionId = id(held.criterionId)
    const alternativeId = id(held.alternativeId)
    const constraintId = id(held.constraintId)
    return {
      ...(criterionId && criterionIds.has(criterionId) ? { criterionId } : {}),
      ...(alternativeId && alternativeIds.has(alternativeId) ? { alternativeId } : {}),
      ...(constraintId && constraints.some((two) => two.id === constraintId) ? { constraintId } : {})
    }
  }

  const assumptions = list(one.assumptions)
    .map((two): Assumption | null => {
      const held = object(two)
      const theirId = id(held.id)
      const says = words(held.says, 240).trim()
      if (theirId === '' || says === '') return null
      return { id: theirId, says, about: about(held.about), matters: oneOf(held.matters, MATTERS, 'not-tested') }
    })
    .filter((two): two is Assumption => two !== null)
    .slice(0, 12)

  const gaps = list(one.gaps)
    .map((two): Gap | null => {
      const held = object(two)
      const theirId = id(held.id)
      const asks = words(held.asks, 240).trim()
      if (theirId === '' || asks === '') return null
      const howToFind = words(held.howToFind, 200)
      return {
        id: theirId,
        asks,
        about: about(held.about),
        worth: oneOf(held.worth, WORTHS, 'not-tested'),
        ...(howToFind ? { howToFind } : {})
      }
    })
    .filter((two): two is Gap => two !== null)
    .slice(0, 12)

  const history = list(one.history)
    .map((two): Revision | null => {
      const held = object(two)
      const what = words(held.what, 400).trim()
      if (what === '') return null
      return { at: num(held.at, 0), what, from: words(held.from, 300) }
    })
    .filter((two): two is Revision => two !== null)
    .slice(-40)

  const madeAt = num(one.madeAt, 0)
  return {
    id: theId,
    v: DECISION_VERSION,
    title: words(one.title, 80).trim() || 'A decision',
    question: words(one.question, 400),
    aim: words(one.aim, 300),
    alternatives,
    criteria,
    constraints,
    preferences: list(one.preferences).map((two) => words(two, 160)).filter((two) => two.trim() !== '').slice(0, 8),
    assumptions,
    gaps,
    policy: cleanPolicy(one.policy),
    conversationId: id(one.conversationId),
    saved: flag(one.saved),
    sort: oneOf(one.sort, SORTS, 'other'),
    madeAt,
    changedAt: num(one.changedAt, madeAt),
    history
  }
}

function cleanPart(raw: unknown, criteria: ReadonlySet<string>): ScoredPart | null {
  const one = object(raw)
  const criterionId = id(one.criterionId)
  if (criterionId === '' || !criteria.has(criterionId)) return null
  return {
    criterionId,
    raw: maybeNum(one.raw),
    scaled: maybeNum(one.scaled),
    weight: Math.max(0, num(one.weight, 0)),
    contributed: num(one.contributed, 0),
    origin: oneOf(one.origin, ORIGINS, 'unknown')
  }
}

/**
 * A result off the disk, or null.
 *
 * Checked against the decision it belongs to, because the two are saved together and could have come apart: a
 * result naming an option the decision no longer has would draw a row for something that is not in the comparison.
 */
export function cleanResult(raw: unknown, decision: Decision): Result | null {
  const one = object(raw)
  if (id(one.decisionId) !== decision.id) return null
  const criteria = new Set(decision.criteria.map((two) => two.id))
  const alternatives = new Set(decision.alternatives.map((two) => two.id))

  const scored = list(one.scored)
    .map((two): Scored | null => {
      const held = object(two)
      const alternativeId = id(held.alternativeId)
      if (alternativeId === '' || !alternatives.has(alternativeId)) return null
      const checks = list(held.checks)
        .map((three): ConstraintCheck | null => {
          const check = object(three)
          const constraintId = id(check.constraintId)
          if (constraintId === '' || !decision.constraints.some((four) => four.id === constraintId)) return null
          const over = maybeNum(check.over)
          const ifAlso = words(check.ifAlso, 200)
          return { constraintId, meets: oneOf(check.meets, MEETS, 'unknown'), ...(over !== null ? { over } : {}), ...(ifAlso ? { ifAlso } : {}) }
        })
        .filter((three): three is ConstraintCheck => three !== null)

      return {
        alternativeId,
        score: Math.min(1, Math.max(0, num(held.score, 0))),
        atWorst: Math.min(1, Math.max(0, num(held.atWorst, 0))),
        atBest: Math.min(1, Math.max(0, num(held.atBest, 0))),
        coverage: Math.min(1, Math.max(0, num(held.coverage, 0))),
        parts: list(held.parts).map((three) => cleanPart(three, criteria)).filter((three): three is ScoredPart => three !== null),
        checks,
        feasible: oneOf(held.feasible, MEETS, 'unknown'),
        place: Math.max(1, Math.round(num(held.place, 1))),
        tied: flag(held.tied),
        evidence: Math.min(1, Math.max(0, num(held.evidence, 0)))
      }
    })
    .filter((two): two is Scored => two !== null)

  if (scored.length === 0) return null
  const leaderId = id(one.leaderId)
  const noLeader = typeof one.noLeader === 'string' ? oneOf(one.noLeader, NO_LEADER, 'too-little-known') : undefined

  return {
    decisionId: decision.id,
    run: Math.max(1, Math.round(num(one.run, 1))),
    method: oneOf(one.method, METHODS, 'weighted-sum'),
    whenMissing: oneOf(one.whenMissing, MISSING, 'share-out-the-rest'),
    scored,
    leaderId: leaderId !== '' && alternatives.has(leaderId) ? leaderId : null,
    ...(noLeader ? { noLeader } : {}),
    nothingIsFeasible: flag(one.nothingIsFeasible),
    notBeaten: list(one.notBeaten).map((two) => id(two)).filter((two) => two !== '' && alternatives.has(two)),
    howItWorked: words(one.howItWorked, 400),
    notes: list(one.notes).map((two) => words(two, 400)).filter((two) => two.trim() !== '').slice(0, 12),
    at: num(one.at, 0)
  }
}

/** A what-if off the disk, checked against the decision it patches. */
export function cleanScenario(raw: unknown, decision: Decision): Scenario | null {
  const one = object(raw)
  const theId = id(one.id)
  if (theId === '') return null
  const criteria = new Set(decision.criteria.map((two) => two.id))
  const alternatives = new Set(decision.alternatives.map((two) => two.id))
  const constraints = new Set(decision.constraints.map((two) => two.id))

  const weights: Record<string, number> = {}
  for (const [key, value] of Object.entries(object(one.weights))) {
    const made = maybeNum(value)
    if (criteria.has(key) && made !== null && made >= 0) weights[key] = Math.min(100, made)
  }

  const values: Record<string, Known> = {}
  for (const [key, held] of Object.entries(object(one.values))) {
    const [alternativeId, criterionId] = key.split('/')
    if (!alternatives.has(alternativeId ?? '') || !criteria.has(criterionId ?? '')) continue
    const made = cleanKnown(held)
    if (made && made.value !== null) values[key] = made
  }

  const limits: Record<string, number> = {}
  for (const [key, value] of Object.entries(object(one.limits))) {
    const made = maybeNum(value)
    if (constraints.has(key) && made !== null) limits[key] = made
  }

  const without = list(one.without).map((two) => id(two)).filter((two) => criteria.has(two)).slice(0, 8)

  const nothing = Object.keys(weights).length === 0 && Object.keys(values).length === 0 && Object.keys(limits).length === 0 && without.length === 0
  if (nothing) return null

  return {
    id: theId,
    name: words(one.name, 80).trim() || 'a what-if',
    ...(Object.keys(weights).length ? { weights } : {}),
    ...(Object.keys(values).length ? { values } : {}),
    ...(Object.keys(limits).length ? { limits } : {}),
    ...(without.length ? { without } : {}),
    madeAt: num(one.madeAt, 0)
  }
}
