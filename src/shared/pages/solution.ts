/**
 * The Universal Solution Page's model: a problem, formalised, solved and verified.
 *
 * The shape this enforces is the reason it exists. A problem arrives as text, and what happens next is *not* "ask a
 * model and show the answer". It becomes a structured representation -- known quantities, an unknown, constraints,
 * assumptions -- and that representation is what an engine is given. Every stage is inspectable, and the assumptions
 * are editable, because an assumption nobody can see is an assumption nobody can disagree with.
 *
 * ## Verification is not confidence
 *
 * There is no confidence score here. A solution is verified by substituting it back, or by a second method agreeing,
 * or it is not verified -- and `Verification` says which of those happened. A number between 0 and 1 that came from
 * nothing in particular is the single most misleading thing a solver can display.
 *
 * ## Nothing here computes
 *
 * This file selects engines and records what they returned. The arithmetic belongs to the compute modules, and a
 * method that no engine can carry out is reported as unavailable rather than approximated.
 */

import { type Rational } from '../compute/algebra.ts'

export interface SolutionError {
  error: string
  message: string
}

export const isSolutionError = (value: unknown): value is SolutionError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value

const fail = (error: string, message: string): SolutionError => ({ error, message })

export const SOLUTION_LIMITS: Readonly<Record<'variables' | 'constraints' | 'assumptions' | 'methods' | 'steps' | 'branches', number>> =
  Object.freeze({
    variables: 64,
    constraints: 64,
    assumptions: 64,
    methods: 8,
    steps: 200,
    branches: 32
  })

// ---------------------------------------------------------------- the problem

export type Domain =
  | 'algebra'
  | 'calculus'
  | 'geometry'
  | 'linear-algebra'
  | 'discrete'
  | 'probability'
  | 'statistics'
  | 'mechanics'
  | 'thermodynamics'
  | 'electricity'
  | 'chemistry'
  | 'data-analysis'
  | 'optimisation'
  | 'finance'
  | 'logic'
  | 'unknown'

/** Where a piece of the problem came from. Never inferred; a value Orbis worked out is not a value somebody gave. */
export type Origin = 'stated' | 'inferred' | 'assumed' | 'derived' | 'looked-up'

export interface Quantity {
  id: string
  name: string
  /** `null` for the unknown, which is the point of it being the unknown. */
  value: number | null
  unit: string
  origin: Origin
  /** What in the original text this came from, so a wrong reading can be traced. */
  from: string
}

export interface Assumption {
  id: string
  statement: string
  origin: Origin
  /** Whether the answer changes if this is dropped. Filled in by a sensitivity check, not declared. */
  loadBearing: boolean | null
  /** Somebody looked at this and accepted it. An assumption nobody reviewed is not the same as one somebody agreed to. */
  accepted: boolean
}

export interface Constraint {
  id: string
  statement: string
  /** Checked against a candidate answer. A constraint that cannot be checked is recorded but does not validate. */
  check: ((values: Record<string, number>) => boolean) | null
  origin: Origin
}

export interface Problem {
  id: string
  /** Exactly as it was given. Never rewritten in place; a normalisation is a separate field. */
  original: string
  normalised: string
  domain: Domain
  subdomain: string
  known: Quantity[]
  /** What is being asked for. More than one is allowed and is common. */
  unknowns: Quantity[]
  constraints: Constraint[]
  assumptions: Assumption[]
  /** Equations as text, compiled by the expression engine rather than executed. */
  relations: string[]
  objective: { kind: 'solve' | 'minimise' | 'maximise' | 'prove' | 'describe'; of: string } | null
  source: { kind: 'typed' | 'voice' | 'image' | 'file' | 'page' | 'browser'; reference: string }
}

export const emptyProblem = (id: string, original: string): Problem => ({
  id,
  original,
  normalised: original.trim().replace(/\s+/g, ' '),
  domain: 'unknown',
  subdomain: '',
  known: [],
  unknowns: [],
  constraints: [],
  assumptions: [],
  relations: [],
  objective: null,
  source: { kind: 'typed', reference: '' }
})

// ---------------------------------------------------------------- classification

export interface DomainSignal {
  domain: Domain
  /** Words that pointed at this domain, so a wrong classification can be argued with rather than only overridden. */
  matched: string[]
  score: number
}

/**
 * The vocabulary each domain is recognised by.
 *
 * A table rather than scattered conditions, for the reason the search engine learned the hard way: a vocabulary that
 * lives in code drifts from the vocabulary that lives in the manifests, and the mismatch is invisible because both
 * sides look reasonable on their own.
 */
export const DOMAIN_WORDS: Readonly<Record<Domain, readonly string[]>> = Object.freeze({
  algebra: ['solve', 'equation', 'factor', 'factorise', 'expand', 'simplify', 'polynomial', 'quadratic', 'roots', 'inequality'],
  calculus: ['derivative', 'differentiate', 'integral', 'integrate', 'limit', 'rate of change', 'tangent', 'maximum', 'minimum', 'area under'],
  geometry: ['triangle', 'circle', 'angle', 'perimeter', 'polygon', 'parallel', 'perpendicular', 'radius', 'diameter', 'congruent'],
  'linear-algebra': ['matrix', 'matrices', 'determinant', 'eigenvalue', 'eigenvector', 'vector space', 'rank', 'basis', 'linear system'],
  discrete: ['permutation', 'combination', 'prime', 'divisor', 'modulo', 'congruence', 'graph', 'vertices', 'factorial', 'gcd'],
  probability: ['probability', 'chance', 'likelihood', 'random', 'dice', 'coin', 'expected value', 'distribution'],
  statistics: ['mean', 'median', 'standard deviation', 'variance', 'correlation', 'regression', 'sample', 'hypothesis test', 'confidence interval'],
  mechanics: ['velocity', 'acceleration', 'force', 'mass', 'momentum', 'friction', 'projectile', 'newton', 'kinetic energy'],
  thermodynamics: ['temperature', 'heat', 'entropy', 'pressure', 'ideal gas', 'thermal', 'specific heat'],
  electricity: ['current', 'voltage', 'resistance', 'circuit', 'ohm', 'capacitor', 'charge', 'ampere'],
  chemistry: ['mole', 'molar', 'concentration', 'reaction', 'equilibrium', 'stoichiometry', 'ph', 'titration'],
  'data-analysis': ['dataset', 'column', 'rows', 'csv', 'filter', 'group by', 'aggregate', 'outlier'],
  optimisation: ['minimise', 'maximise', 'optimal', 'constraint', 'objective function', 'feasible', 'linear programme'],
  finance: ['interest', 'loan', 'investment', 'compound', 'annuity', 'present value', 'return', 'portfolio'],
  logic: ['truth table', 'tautology', 'implies', 'contradiction', 'satisfiable', 'proposition', 'if and only if'],
  unknown: []
})

/**
 * Which domains a problem's text points at.
 *
 * Several, deliberately. A projectile problem is mechanics and calculus, and forcing a single label means the second
 * engine never gets offered. The signals are ranked and all of them are returned.
 */
export function classifyProblem(text: string): DomainSignal[] {
  const lower = ` ${text.toLowerCase()} `
  const signals: DomainSignal[] = []

  for (const [domain, words] of Object.entries(DOMAIN_WORDS) as [Domain, readonly string[]][]) {
    if (domain === 'unknown') continue
    const matched = words.filter((word) => lower.includes(` ${word}`) || lower.includes(`${word} `) || lower.includes(` ${word} `))
    if (matched.length === 0) continue
    // Longer phrases are more specific than single words, so they count for more.
    const score = matched.reduce((sum, word) => sum + (word.includes(' ') ? 2 : 1), 0)
    signals.push({ domain, matched, score })
  }

  signals.sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain))
  return signals
}

export interface Formalisation {
  problem: Problem
  /** What could not be read out of the text. Named, because the person can supply it. */
  missing: string[]
  /** Readings that could have gone another way, so an ambiguity is visible rather than silently resolved. */
  ambiguities: { about: string; chosen: string; alternatives: string[] }[]
  notes: string[]
}

/**
 * Numbers with units pulled out of a problem's text.
 *
 * Deliberately conservative. A number with a unit beside it is a quantity; a bare number is recorded with no unit and
 * an origin of `inferred`, which is what it is. Anything this cannot read is listed as missing rather than guessed,
 * because a guessed initial velocity produces a confident wrong answer.
 */
export function readQuantities(text: string): Quantity[] {
  const found: Quantity[] = []
  const seen = new Set<string>()

  // A number, then an optional unit word. The unit list is deliberately short: recognising "5 apples" as a quantity
  // in apples is worse than not recognising it at all.
  const pattern = /(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*(m\/s\^?2|km\/h|m\/s|kg|km|cm|mm|mol|kPa|MPa|Pa|Hz|kJ|kW|mA|kg\/m\^?3|[mgsNJWVAKLC%]|degrees?|radians?|seconds?|minutes?|hours?|metres?|meters?|grams?|litres?|liters?)?\b/g

  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const value = Number(match[1])
    if (!Number.isFinite(value)) continue
    const unit = match[2] ?? ''
    // The words just before the number usually name it, which is the only naming this can honestly do.
    const before = text.slice(Math.max(0, match.index - 40), match.index)
    const name = (/([A-Za-z][A-Za-z\s]{0,24})\s*(?:is|of|=|:)?\s*$/.exec(before)?.[1] ?? '').trim()
    const id = `q${found.length + 1}`
    const key = `${value}|${unit}`
    if (seen.has(key)) continue
    seen.add(key)
    found.push({
      id,
      name: name === '' ? `value ${found.length + 1}` : name,
      value,
      unit,
      origin: 'stated',
      from: match[0].trim()
    })
  }

  return found.slice(0, SOLUTION_LIMITS.variables)
}

/** What is being asked for, from the phrasing. `null` when the text does not say, which is not a failure. */
export function readObjective(text: string): Problem['objective'] {
  const lower = text.toLowerCase()
  const of = (pattern: RegExp): string => (pattern.exec(lower)?.[1] ?? '').trim()

  if (/\b(minimi[sz]e|smallest|least|lowest)\b/.test(lower)) {
    return { kind: 'minimise', of: of(/minimi[sz]e\s+(?:the\s+)?([a-z\s]{1,30})/) }
  }
  if (/\b(maximi[sz]e|largest|greatest|highest)\b/.test(lower)) {
    return { kind: 'maximise', of: of(/maximi[sz]e\s+(?:the\s+)?([a-z\s]{1,30})/) }
  }
  if (/\b(prove|show that|verify that)\b/.test(lower)) {
    return { kind: 'prove', of: of(/(?:prove|show) that\s+(.{1,60})/) }
  }
  if (/\b(solve|find|calculate|determine|compute|what is|how (?:much|many|long|far|fast))\b/.test(lower)) {
    return {
      kind: 'solve',
      of: of(/(?:solve for|find|calculate|determine|compute)\s+(?:the\s+)?([a-z\s]{1,30})/) || of(/what is\s+(?:the\s+)?([a-z\s]{1,30})/)
    }
  }
  if (/\b(explain|describe|why)\b/.test(lower)) return { kind: 'describe', of: '' }
  return null
}

/**
 * A problem read out of text, with every reading recorded as a reading.
 *
 * The ambiguities are the part worth having. "Find the speed" when two speeds are mentioned is genuinely ambiguous,
 * and a formaliser that picks one silently produces an answer to a question nobody asked.
 */
export function formalise(problem: Problem): Formalisation {
  const signals = classifyProblem(problem.normalised)
  const quantities = readQuantities(problem.normalised)
  const objective = readObjective(problem.normalised)

  const ambiguities: Formalisation['ambiguities'] = []
  const missing: string[] = []
  const notes: string[] = []

  if (signals.length > 1 && signals[0].score === signals[1].score) {
    ambiguities.push({
      about: 'domain',
      chosen: signals[0].domain,
      alternatives: signals.filter((one) => one.score === signals[0].score).map((one) => one.domain)
    })
  }

  const unnamed = quantities.filter((one) => one.name.startsWith('value '))
  if (unnamed.length > 0) {
    notes.push(
      `${unnamed.length} of the ${quantities.length} numbers found could not be given a name from the text around them. They are listed with their values so they can be named.`
    )
  }
  if (quantities.length === 0) {
    missing.push('any numeric quantities')
  }
  if (objective === null) {
    missing.push('what is being asked for')
    notes.push('The text does not say what to find. Orbis has not guessed; say what the unknown is.')
  }

  const unitless = quantities.filter((one) => one.unit === '')
  if (unitless.length > 0 && signals.some((one) => ['mechanics', 'thermodynamics', 'electricity', 'chemistry'].includes(one.domain))) {
    notes.push(
      `${unitless.length} number${unitless.length === 1 ? ' has' : 's have'} no unit in the text. For a physical problem that matters: the same number means different things in different units, and Orbis has not assumed any.`
    )
  }

  return {
    problem: {
      ...problem,
      domain: signals[0]?.domain ?? 'unknown',
      known: quantities,
      objective
    },
    missing,
    ambiguities,
    notes
  }
}

// ---------------------------------------------------------------- methods

export interface Method {
  id: string
  name: string
  /** The engine operation it would call. A method with no operation is a method Orbis cannot carry out. */
  operation: string | null
  domain: Domain
  /** What has to be true for this to apply. Checked before the method is offered. */
  requires: string[]
  /** What it assumes beyond the problem statement, which is what an answer from it depends on. */
  assumes: string[]
  describe: string
}

export interface MethodChoice {
  applicable: Method[]
  /** Methods that would apply but need something the problem does not have. Named, so the gap is visible. */
  blocked: { method: Method; missing: string[] }[]
  /** Methods with no engine behind them. Reported as unavailable rather than left off the list silently. */
  unavailable: Method[]
  describe: string
}

/**
 * Which methods apply to a problem.
 *
 * Three categories, and the difference matters. `applicable` can run now. `blocked` would run given something the
 * person can supply, and saying what is missing is more useful than not offering it. `unavailable` is a method that
 * exists in mathematics and not in Orbis -- reported, because "Orbis cannot do this" is a better answer than an
 * approximation that looks like the real thing.
 */
export function chooseMethods(problem: Problem, catalogue: readonly Method[], available: ReadonlySet<string>): MethodChoice {
  const has = new Set([
    ...problem.known.filter((one) => one.value !== null).map((one) => one.name.toLowerCase()),
    ...problem.known.filter((one) => one.value !== null).map((one) => one.id)
  ])

  const applicable: Method[] = []
  const blocked: MethodChoice['blocked'] = []
  const unavailable: Method[] = []

  for (const method of catalogue) {
    if (method.domain !== problem.domain && method.domain !== 'unknown') continue
    if (method.operation === null || !available.has(method.operation)) {
      unavailable.push(method)
      continue
    }
    const missing = method.requires.filter((one) => !has.has(one.toLowerCase()))
    if (missing.length === 0) applicable.push(method)
    else blocked.push({ method, missing })
  }

  return {
    applicable,
    blocked,
    unavailable,
    describe:
      applicable.length === 0 && blocked.length === 0 && unavailable.length === 0
        ? `Orbis has no method for a ${problem.domain} problem of this shape.`
        : `${applicable.length} method${applicable.length === 1 ? '' : 's'} can run now.${blocked.length > 0 ? ` ${blocked.length} more would, given what ${blocked.length === 1 ? 'it needs' : 'they need'}.` : ''}${unavailable.length > 0 ? ` ${unavailable.length} ${unavailable.length === 1 ? 'is a method' : 'are methods'} Orbis does not have an engine for.` : ''}`
  }
}

// ---------------------------------------------------------------- solutions

export interface Step {
  index: number
  /** What was done. Not prose about what was done -- the actual operation. */
  operation: string
  /** The state before and after, so a step can be checked rather than only read. */
  before: string
  after: string
  /** The rule or identity that justifies it, where there is one. */
  because: string
}

export type VerificationKind =
  | 'substituted'
  | 'second-method'
  | 'inverse-operation'
  | 'constraint-check'
  | 'dimensional'
  | 'none'

export interface Verification {
  kind: VerificationKind
  passed: boolean
  /** What was actually computed to check, so "verified" is a claim somebody can audit. */
  evidence: string
  describe: string
}

export interface Solution {
  id: string
  methodId: string
  /** The answer, in whatever form the engine produced. */
  value: number | string | Rational | null
  unit: string
  steps: Step[]
  verifications: Verification[]
  /** Everything the answer depends on beyond the problem as stated. */
  assumptions: string[]
  warnings: string[]
  /** Deliberately not a confidence score. See the module comment. */
  status: 'verified' | 'unverified' | 'failed-verification' | 'partial'
  describe: string
}

/**
 * A solution's status, from its verifications rather than from a judgement.
 *
 * The four states are exhaustive and each means something specific. `verified` means at least one check ran and
 * passed. `failed-verification` means one ran and did not, which is worse than not checking. `unverified` means
 * nothing checked, which is neither good nor bad but is not the same as verified. `partial` means some checks passed
 * and some did not.
 */
export function statusOf(verifications: readonly Verification[]): Solution['status'] {
  const real = verifications.filter((one) => one.kind !== 'none')
  if (real.length === 0) return 'unverified'
  const passed = real.filter((one) => one.passed).length
  if (passed === real.length) return 'verified'
  if (passed === 0) return 'failed-verification'
  return 'partial'
}

/** Substituting an answer back into the relations it was meant to satisfy. The strongest cheap check there is. */
export function verifyBySubstitution(
  relations: readonly string[],
  values: Record<string, number>,
  evaluate: (expression: string, scope: Record<string, number>) => number | null,
  tolerance = 1e-9
): Verification {
  if (relations.length === 0) {
    return { kind: 'none', passed: false, evidence: '', describe: 'There are no relations to substitute into, so nothing could be checked this way.' }
  }

  const results: string[] = []
  let allPassed = true
  for (const relation of relations) {
    const sides = relation.split('=')
    if (sides.length !== 2) {
      results.push(`"${relation}" is not an equation, so it could not be checked.`)
      allPassed = false
      continue
    }
    const left = evaluate(sides[0], values)
    const right = evaluate(sides[1], values)
    if (left === null || right === null) {
      results.push(`"${relation}" could not be evaluated with these values.`)
      allPassed = false
      continue
    }
    const scale = Math.max(1, Math.abs(left), Math.abs(right))
    const ok = Math.abs(left - right) <= tolerance * scale
    if (!ok) allPassed = false
    results.push(`${sides[0].trim()} = ${Number(left.toPrecision(8))} against ${sides[1].trim()} = ${Number(right.toPrecision(8))}${ok ? '' : ' -- these differ'}`)
  }

  return {
    kind: 'substituted',
    passed: allPassed,
    evidence: results.join('; '),
    describe: allPassed
      ? 'The answer was put back into the original equations and both sides agree. That is a check on the answer, not on whether the equations describe the problem.'
      : 'The answer was put back into the original equations and they do not balance. Either the answer or the setting-up is wrong.'
  }
}

/** Two methods compared. Agreement is evidence; disagreement is a finding and is never averaged away. */
export function verifyByAgreement(a: Solution, b: Solution, tolerance = 1e-6): Verification {
  if (typeof a.value !== 'number' || typeof b.value !== 'number') {
    return {
      kind: 'none',
      passed: false,
      evidence: '',
      describe: 'The two answers are not both numbers, so they cannot be compared this way.'
    }
  }
  const scale = Math.max(1, Math.abs(a.value), Math.abs(b.value))
  const agree = Math.abs(a.value - b.value) <= tolerance * scale
  return {
    kind: 'second-method',
    passed: agree,
    evidence: `${a.methodId} gives ${Number(a.value.toPrecision(10))} and ${b.methodId} gives ${Number(b.value.toPrecision(10))}`,
    describe: agree
      ? `Two different methods give the same answer. They can still both be wrong in the same way if they share an assumption, but independent agreement is real evidence.`
      : `Two methods disagree: ${Number(a.value.toPrecision(8))} against ${Number(b.value.toPrecision(8))}. One of them is wrong, and averaging them would produce a third answer that is also wrong.`
  }
}

/** Whether an answer satisfies the problem's own constraints. A constraint that cannot be checked says so. */
export function verifyConstraints(constraints: readonly Constraint[], values: Record<string, number>): Verification {
  const checkable = constraints.filter((one) => one.check !== null)
  if (checkable.length === 0) {
    return {
      kind: 'none',
      passed: false,
      evidence: '',
      describe: constraints.length === 0 ? 'There are no constraints to check.' : `All ${constraints.length} constraints are stated in words that Orbis cannot check automatically.`
    }
  }

  const broken: string[] = []
  for (const one of checkable) {
    let holds = false
    try {
      holds = (one.check as (v: Record<string, number>) => boolean)(values) === true
    } catch {
      holds = false
    }
    if (!holds) broken.push(one.statement)
  }

  return {
    kind: 'constraint-check',
    passed: broken.length === 0,
    evidence: `${checkable.length - broken.length} of ${checkable.length} constraints hold`,
    describe:
      broken.length === 0
        ? `The answer satisfies all ${checkable.length} constraints that could be checked.${constraints.length > checkable.length ? ` ${constraints.length - checkable.length} stated in words were not checked.` : ''}`
        : `The answer breaks ${broken.length} constraint${broken.length === 1 ? '' : 's'}: ${broken.join('; ')}. An answer that breaks a constraint of the problem is not a solution to it.`
  }
}

/** Whether the answer's unit is the unit the unknown was asked in. A cheap check that catches real mistakes. */
export function verifyDimensions(expected: string, got: string): Verification {
  if (expected === '' || got === '') {
    return {
      kind: 'none',
      passed: false,
      evidence: '',
      describe: 'One side has no unit, so there is nothing to compare. A missing unit is not the same as a matching one.'
    }
  }
  const same = expected.replace(/\s/g, '') === got.replace(/\s/g, '')
  return {
    kind: 'dimensional',
    passed: same,
    evidence: `asked in ${expected}, answered in ${got}`,
    describe: same
      ? `The answer is in ${got}, which is what was asked for.`
      : `The answer is in ${got} and the question asked for ${expected}. Either a conversion is missing or the wrong quantity was found.`
  }
}

// ---------------------------------------------------------------- what-if and branches

export interface Branch {
  id: string
  name: string
  /** The branch this came from. `null` for one taken off the original problem. */
  parent: string | null
  /** Only the quantities that differ. The original problem is never modified. */
  changes: Record<string, number>
  solutionId: string | null
  describe: string
}

export interface Difference {
  quantity: string
  from: number
  to: number
  outputFrom: number | null
  outputTo: number | null
  absolute: number | null
  relative: number | null
  describe: string
}

/**
 * A branch resolved against the original problem.
 *
 * The original is never touched. That is what makes a branch a branch rather than an edit: the comparison is always
 * against what was actually asked, however many changes have been made since.
 */
export function resolveBranch(problem: Problem, branches: readonly Branch[], branchId: string): Record<string, number> | SolutionError {
  const byId = new Map(branches.map((one) => [one.id, one]))
  const chain: Branch[] = []
  let current = byId.get(branchId)
  if (!current) return fail('not-found', `There is no branch called "${branchId}".`)

  const seen = new Set<string>()
  while (current) {
    if (seen.has(current.id)) return fail('cycle', 'These branches refer back to each other.')
    if (chain.length >= SOLUTION_LIMITS.branches) return fail('too-deep', `Branches are nested past the ${SOLUTION_LIMITS.branches} allowed.`)
    seen.add(current.id)
    chain.unshift(current)
    const parent: string | null = current.parent
    current = parent === null ? undefined : byId.get(parent)
    if (chain[0].parent !== null && current === undefined) {
      return fail('not-found', `"${chain[0].name}" branches from "${chain[0].parent}", which does not exist.`)
    }
  }

  const values: Record<string, number> = {}
  for (const one of problem.known) {
    if (one.value !== null) values[one.id] = one.value
  }
  for (const branch of chain) {
    for (const [id, value] of Object.entries(branch.changes)) {
      if (!problem.known.some((one) => one.id === id)) {
        return fail('not-found', `"${branch.name}" changes "${id}", which is not a quantity in this problem.`)
      }
      values[id] = value
    }
  }
  return values
}

/** A branch's answer against the original's, computed rather than described. */
export function compareBranch(
  problem: Problem,
  original: Record<string, number>,
  branch: Record<string, number>,
  originalOutput: number | null,
  branchOutput: number | null
): Difference[] {
  const byId = new Map(problem.known.map((one) => [one.id, one]))
  const out: Difference[] = []

  for (const id of new Set([...Object.keys(original), ...Object.keys(branch)])) {
    if (original[id] === branch[id]) continue
    const name = byId.get(id)?.name ?? id
    out.push({
      quantity: name,
      from: original[id],
      to: branch[id],
      outputFrom: originalOutput,
      outputTo: branchOutput,
      absolute: originalOutput !== null && branchOutput !== null ? branchOutput - originalOutput : null,
      relative:
        originalOutput !== null && branchOutput !== null && originalOutput !== 0
          ? (branchOutput - originalOutput) / Math.abs(originalOutput)
          : null,
      describe:
        originalOutput === null || branchOutput === null
          ? `${name} changed from ${original[id]} to ${branch[id]}. The effect on the answer is not known, because one of the two was not solved.`
          : `${name} changed from ${original[id]} to ${branch[id]}, and the answer moved from ${Number(originalOutput.toPrecision(6))} to ${Number(branchOutput.toPrecision(6))}.`
    })
  }
  return out
}

// ---------------------------------------------------------------- checking somebody's answer

export interface AnswerCheck {
  correct: boolean
  /** How far off, when both are numbers. */
  difference: number | null
  relative: number | null
  /** Whether the two agree once units are taken into account. */
  unitsMatch: boolean | null
  describe: string
  /** A guess at what went wrong, only where the pattern is recognisable. Never invented. */
  likelyMistake: string | null
}

/**
 * Somebody's answer against the computed one.
 *
 * Never decided by a model's judgement. Two numbers are compared numerically with a tolerance, and the verdict is
 * arithmetic. Where the difference has a recognisable shape -- a factor of exactly two, a sign, a factor of 1000 --
 * that is named as a possibility, because those are the mistakes people actually make.
 */
export function checkAnswer(
  given: number | string,
  computed: number | string,
  options: { tolerance?: number; givenUnit?: string; computedUnit?: string } = {}
): AnswerCheck {
  const unitsMatch =
    options.givenUnit === undefined || options.computedUnit === undefined
      ? null
      : options.givenUnit.replace(/\s/g, '') === options.computedUnit.replace(/\s/g, '')

  if (typeof given !== 'number' || typeof computed !== 'number') {
    const same = String(given).trim().toLowerCase() === String(computed).trim().toLowerCase()
    return {
      correct: same,
      difference: null,
      relative: null,
      unitsMatch,
      describe: same ? 'The two answers are the same.' : `The answer given is "${given}" and the computed one is "${computed}".`,
      likelyMistake: null
    }
  }

  const tolerance = options.tolerance ?? 1e-6
  const scale = Math.max(1, Math.abs(computed))
  const difference = given - computed
  const correct = Math.abs(difference) <= tolerance * scale

  let likelyMistake: string | null = null
  if (!correct && computed !== 0) {
    const ratio = given / computed
    if (Math.abs(ratio + 1) < 1e-6) likelyMistake = 'The magnitude is right and the sign is not. Check the direction, or a subtraction done the other way round.'
    else if (Math.abs(ratio - 2) < 1e-6) likelyMistake = 'The answer is exactly twice the computed one. A factor of two often comes from a halving that was left out -- an average, a triangle area, or the half in a kinematic equation.'
    else if (Math.abs(ratio - 0.5) < 1e-6) likelyMistake = 'The answer is exactly half the computed one, which often means a factor of two was applied that should not have been.'
    else if (Math.abs(ratio - 1000) < 1e-6 || Math.abs(ratio - 0.001) < 1e-9) likelyMistake = 'The answer differs by a factor of exactly a thousand, which is usually a unit prefix -- grams against kilograms, metres against kilometres.'
    else if (Math.abs(ratio - 100) < 1e-6 || Math.abs(ratio - 0.01) < 1e-9) likelyMistake = 'The answer differs by a factor of exactly a hundred, which is often a percentage that was or was not divided by a hundred.'
    else if (Math.abs(ratio - Math.PI / 180) < 1e-9 || Math.abs(ratio - 180 / Math.PI) < 1e-9) likelyMistake = 'The answer differs by the factor between degrees and radians.'
  }

  return {
    correct,
    difference,
    relative: computed === 0 ? null : difference / Math.abs(computed),
    unitsMatch,
    describe: correct
      ? unitsMatch === false
        ? 'The number is right but the unit is not.'
        : 'That matches the computed answer.'
      : `The computed answer is ${Number(computed.toPrecision(8))} and the one given is ${Number(given.toPrecision(8))}, a difference of ${Number(difference.toPrecision(6))}.`,
    likelyMistake
  }
}

export interface WorkCheck {
  steps: { index: number; ok: boolean; describe: string }[]
  /** The first step that does not follow. Everything after it is unchecked rather than wrong. */
  firstProblem: number | null
  describe: string
}

/**
 * Somebody's working, checked step by step.
 *
 * Stops reporting at the first step that does not follow, and says the rest were not checked rather than marking
 * them wrong. A step after a mistake can be perfectly correct reasoning applied to a wrong number, and calling it
 * wrong teaches the wrong lesson.
 */
export function checkWork(
  steps: readonly { expression: string; claims: number }[],
  evaluate: (expression: string) => number | null,
  tolerance = 1e-9
): WorkCheck {
  const out: WorkCheck['steps'] = []
  let firstProblem: number | null = null

  for (let i = 0; i < steps.length; i++) {
    if (firstProblem !== null) {
      out.push({ index: i, ok: false, describe: 'Not checked: an earlier step does not follow, so anything after it rests on a value that is already wrong.' })
      continue
    }
    const value = evaluate(steps[i].expression)
    if (value === null) {
      out.push({ index: i, ok: false, describe: `"${steps[i].expression}" could not be evaluated.` })
      firstProblem = i
      continue
    }
    const scale = Math.max(1, Math.abs(value), Math.abs(steps[i].claims))
    const ok = Math.abs(value - steps[i].claims) <= tolerance * scale
    out.push({
      index: i,
      ok,
      describe: ok
        ? `${steps[i].expression} does give ${Number(steps[i].claims.toPrecision(8))}.`
        : `${steps[i].expression} gives ${Number(value.toPrecision(8))}, not ${Number(steps[i].claims.toPrecision(8))}.`
    })
    if (!ok) firstProblem = i
  }

  return {
    steps: out,
    firstProblem,
    describe:
      firstProblem === null
        ? `All ${steps.length} steps follow.`
        : `Step ${firstProblem + 1} does not follow. The steps after it were not checked: a correct step applied to a wrong number is still correct reasoning, and marking it wrong would be misleading.`
  }
}

/** The assumptions the Page rests on, for a screen that wants to show them rather than have them inferred. */
export const SOLUTION_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A problem is formalised into a structure that can be inspected and edited, not passed to a model as text.',
  'Every quantity records where it came from. A value Orbis inferred is never shown as one somebody stated.',
  'An assumption nobody reviewed is marked as such. Accepted and unexamined are different states.',
  'There is no confidence score. A solution is verified by a check that ran, or it is unverified.',
  'Two methods disagreeing is a finding. The answers are never averaged.',
  'A method Orbis has no engine for is reported as unavailable, never approximated.',
  'Checking an answer is arithmetic, not judgement. A recognisable mistake is named only where the pattern is real.',
  'Working is checked until the first step that does not follow; the rest are unchecked rather than wrong.'
])
