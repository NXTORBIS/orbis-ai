/**
 * Decision analysis: options, weights, hard constraints, risk, expected value and how much any of it can be relied on.
 *
 * Built on `compare.ts`, which already handles criteria, normalisation and weighted scoring. What this adds is
 * everything specific to deciding rather than comparing: the difference between a requirement and a preference, the
 * ways weights can be elicited, risk as a first-class object, decision trees, and the question of whether the answer
 * would survive better information.
 *
 * ## The user decides
 *
 * Nothing here recommends. It computes what follows from the weights and constraints somebody supplied, and it says
 * how much those choices determined the answer. A tool that says "choose B" has smuggled in a preference; one that
 * says "B leads under your weights, and A leads under a third of the reasonable alternatives" has not.
 *
 * ## A requirement is not a heavy weight
 *
 * An option that breaks a hard constraint is ineligible, full stop. Modelling it as a large penalty lets a
 * sufficiently good option buy its way past a requirement, which is exactly what a requirement means it cannot do.
 */

import { accurateSum } from '../compute/statistics.ts'
import {
  MISSING,
  hasValue,
  isCompareError,
  rank,
  stability,
  type Criterion,
  type Entity,
  type Ranking,
  type Stability
} from './compare.ts'

export interface DecisionError {
  error: string
  message: string
}

export const isDecisionError = (value: unknown): value is DecisionError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value

const fail = (error: string, message: string): DecisionError => ({ error, message })

export const DECISION_LIMITS: Readonly<Record<'options' | 'criteria' | 'risks' | 'depth' | 'branches' | 'comparisons', number>> =
  Object.freeze({
    options: 500,
    criteria: 100,
    risks: 500,
    depth: 12,
    branches: 2_000,
    comparisons: 2_000
  })

// ---------------------------------------------------------------- requirements and preferences

export interface Requirement {
  id: string
  criterionId: string
  statement: string
  test: (value: unknown) => boolean
  describe: string
}

export type Eligibility = 'eligible' | 'ineligible' | 'unknown'

export interface EligibilityResult {
  optionId: string
  optionName: string
  eligibility: Eligibility
  /** Requirements this option breaks. */
  broken: string[]
  /** Requirements that could not be tested because a value is missing. Not the same as passing. */
  untested: string[]
  describe: string
}

/**
 * Which options meet every requirement.
 *
 * Three outcomes, not two. An option missing the value a requirement tests is `unknown`, because it is neither known
 * to pass nor known to fail -- and dropping it would remove something that might be the right answer, while keeping
 * it silently would treat an unknown as a pass.
 */
export function checkEligibility(options: readonly Entity[], requirements: readonly Requirement[]): EligibilityResult[] {
  return options.map((option) => {
    const broken: string[] = []
    const untested: string[] = []

    for (const requirement of requirements) {
      const value = option.values[requirement.criterionId] ?? MISSING
      if (!hasValue(value)) {
        untested.push(requirement.statement)
        continue
      }
      let passes = false
      try {
        passes = requirement.test(value) === true
      } catch {
        // A requirement that throws has not been met. Treating a failure as a pass would let through exactly the
        // options the requirement exists to exclude.
        passes = false
      }
      if (!passes) broken.push(requirement.statement)
    }

    const eligibility: Eligibility = broken.length > 0 ? 'ineligible' : untested.length > 0 ? 'unknown' : 'eligible'
    return {
      optionId: option.id,
      optionName: option.name,
      eligibility,
      broken,
      untested,
      describe:
        eligibility === 'ineligible'
          ? `${option.name} does not meet ${broken.length === 1 ? 'a requirement' : `${broken.length} requirements`}: ${broken.join('; ')}. A requirement is not a heavy weight -- no amount of being good elsewhere makes up for it.`
          : eligibility === 'unknown'
            ? `${option.name} cannot be assessed against ${untested.join('; ')} because the value is not known. It is neither ruled in nor ruled out.`
            : `${option.name} meets every requirement.`
    }
  })
}

// ---------------------------------------------------------------- eliciting weights

export type WeightMethod = 'direct' | 'points' | 'ranking' | 'pairwise' | 'equal'

export interface WeightResult {
  weights: Record<string, number>
  method: WeightMethod
  /** For pairwise: how far the comparisons are from being consistent with each other. */
  consistency: number | null
  /** Whether the consistency is good enough that the weights mean something. */
  consistent: boolean
  notes: string[]
}

/** Equal weights, stated as a choice. "No weighting" is a weighting, and saying so is more honest than not. */
export function equalWeights(criteria: readonly Criterion[]): WeightResult {
  const weights: Record<string, number> = {}
  for (const one of criteria) weights[one.id] = 1 / criteria.length
  return {
    weights,
    method: 'equal',
    consistency: null,
    consistent: true,
    notes: ['Every criterion is weighted the same. That is a choice about what matters, not the absence of one.']
  }
}

/** Weights from a ranking, by the rank-sum rule: the top of `n` gets `n`, the next `n-1`, and so on. */
export function weightsFromRanking(order: readonly string[]): WeightResult | DecisionError {
  if (order.length === 0) return fail('no-values', 'There is nothing to rank.')
  if (new Set(order).size !== order.length) return fail('duplicate', 'A criterion appears more than once in the ranking.')

  const n = order.length
  const total = (n * (n + 1)) / 2
  const weights: Record<string, number> = {}
  order.forEach((id, i) => {
    weights[id] = (n - i) / total
  })

  return {
    weights,
    method: 'ranking',
    consistency: null,
    consistent: true,
    notes: [
      'Weights derived from the order alone, by the rank-sum rule. An order says which matters more and not by how much, so these weights are one reasonable reading of it rather than the only one.'
    ]
  }
}

export interface Comparison {
  a: string
  b: string
  /** How many times more important `a` is than `b`. 1 is equally important; 3 is moderately more; 9 is extremely. */
  ratio: number
}

/**
 * Weights from pairwise comparisons, by the eigenvector method.
 *
 * People are much better at "is cost or reliability more important, and by how much" than at "cost is 0.35". The cost
 * is that the answers can contradict each other -- saying A is twice B, B twice C, and A twice C is inconsistent --
 * and the consistency ratio measures exactly that. Below about 0.1 the contradictions are small enough that the
 * weights mean something; above it they do not, and the result says so rather than returning numbers anyway.
 */
export function weightsFromPairwise(criteria: readonly string[], comparisons: readonly Comparison[]): WeightResult | DecisionError {
  const n = criteria.length
  if (n < 2) return fail('no-values', 'Pairwise comparison needs at least two criteria.')
  if (n > 32) return fail('too-many', 'Pairwise comparison over more than 32 criteria needs more judgements than anybody can give consistently.')

  const index = new Map(criteria.map((one, i) => [one, i]))
  const matrix: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))

  for (const comparison of comparisons) {
    const i = index.get(comparison.a)
    const j = index.get(comparison.b)
    if (i === undefined || j === undefined) return fail('not-found', `A comparison mentions "${index.has(comparison.a) ? comparison.b : comparison.a}", which is not one of the criteria.`)
    if (!Number.isFinite(comparison.ratio) || comparison.ratio <= 0) return fail('invalid-argument', 'A comparison ratio has to be a positive number.')
    matrix[i][j] = comparison.ratio
    // The reciprocal is implied, not asked for: being told both would be a chance to contradict for no benefit.
    matrix[j][i] = 1 / comparison.ratio
  }

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (matrix[i][j] === 0) return fail('incomplete', `No comparison was given between "${criteria[i]}" and "${criteria[j]}". Every pair needs one.`)
    }
  }

  // The principal eigenvector by power iteration, which for a positive matrix converges to it.
  let vector = new Array<number>(n).fill(1 / n)
  for (let step = 0; step < 200; step++) {
    const next = matrix.map((row) => accurateSum(row.map((value, j) => value * vector[j])))
    const total = accurateSum(next)
    if (total === 0) break
    const normalised = next.map((one) => one / total)
    const moved = Math.max(...normalised.map((one, i) => Math.abs(one - vector[i])))
    vector = normalised
    if (moved < 1e-12) break
  }

  // Saaty's consistency index against the value expected from random judgements.
  const maxEigen = accurateSum(matrix.map((row, i) => accurateSum(row.map((value, j) => value * vector[j])) / Math.max(1e-12, vector[i]))) / n
  const index2 = (maxEigen - n) / Math.max(1, n - 1)
  const randomIndex = [0, 0, 0.58, 0.9, 1.12, 1.24, 1.32, 1.41, 1.45, 1.49][Math.min(9, n - 1)] || 1.49
  const consistency = randomIndex > 0 ? index2 / randomIndex : 0
  const consistent = consistency <= 0.1

  const weights: Record<string, number> = {}
  criteria.forEach((id, i) => {
    weights[id] = vector[i]
  })

  return {
    weights,
    method: 'pairwise',
    consistency,
    consistent,
    notes: [
      `Weights from the principal eigenvector of the comparison matrix.`,
      consistent
        ? `The consistency ratio is ${Number(consistency.toPrecision(3))}, below the 0.1 usually taken as acceptable, so the judgements hang together well enough for these weights to mean something.`
        : `The consistency ratio is ${Number(consistency.toPrecision(3))}, above 0.1. The judgements contradict each other -- something like saying A is twice B, B twice C, and A twice C. The weights are still computed, but they are averaging a set of statements that cannot all be true.`
    ]
  }
}

// ---------------------------------------------------------------- risk

export interface Risk {
  id: string
  optionId: string
  description: string
  /** Somebody's estimate, in [0,1]. Never derived from anything; a probability nobody supplied is not invented. */
  probability: number
  /** The cost if it happens, in whatever unit the decision uses. */
  impact: number
  mitigation: string
  /** The probability after mitigation, where one is planned. `null` where it is not. */
  residualProbability: number | null
  source: string
}

export interface RiskSummary {
  optionId: string
  risks: Risk[]
  /** Sum of probability times impact. The expected cost, which is not the worst case. */
  expectedCost: number
  /** The largest single impact, which is what "what if the worst happens" actually asks. */
  worstCase: number
  /** After mitigation, where planned. */
  mitigatedExpectedCost: number
  /** Risks whose probability nobody supplied. Excluded from the arithmetic and named. */
  unquantified: string[]
  describe: string
}

/**
 * The risks attached to an option, combined.
 *
 * Expected cost and worst case are both reported because they answer different questions and people conflate them.
 * A one-in-a-thousand chance of losing everything has a small expected cost and a catastrophic worst case, and a
 * summary that showed only the first would be the most misleading number on the screen.
 */
export function summariseRisks(optionId: string, risks: readonly Risk[]): RiskSummary | DecisionError {
  const mine = risks.filter((one) => one.optionId === optionId)
  const unquantified: string[] = []
  let expectedCost = 0
  let mitigatedExpectedCost = 0
  let worstCase = 0

  for (const risk of mine) {
    if (!Number.isFinite(risk.probability) || risk.probability < 0 || risk.probability > 1) {
      return fail('invalid-argument', `"${risk.description}" has a probability of ${risk.probability}, which is not between 0 and 1.`)
    }
    if (!Number.isFinite(risk.impact)) {
      unquantified.push(risk.description)
      continue
    }
    expectedCost += risk.probability * risk.impact
    mitigatedExpectedCost += (risk.residualProbability ?? risk.probability) * risk.impact
    worstCase = Math.max(worstCase, Math.abs(risk.impact))
  }

  return {
    optionId,
    risks: mine,
    expectedCost,
    worstCase,
    mitigatedExpectedCost,
    unquantified,
    describe:
      mine.length === 0
        ? 'No risks are recorded against this option. That is an absence of records, not an absence of risk.'
        : `${mine.length} risk${mine.length === 1 ? '' : 's'}. The expected cost is ${Number(expectedCost.toPrecision(6))} and the worst single impact is ${Number(worstCase.toPrecision(6))}. Those answer different questions: a rare catastrophe has a small expected cost and is still a catastrophe.${unquantified.length > 0 ? ` ${unquantified.length} risk${unquantified.length === 1 ? ' has' : 's have'} no impact figure and ${unquantified.length === 1 ? 'is' : 'are'} not in these totals.` : ''}`
  }
}

// ---------------------------------------------------------------- decision trees

export type TreeNode =
  /** A choice the decider makes. The value is the best of its branches, because they choose. */
  | { kind: 'decision'; id: string; label: string; branches: { label: string; node: TreeNode }[] }
  /** Something that happens to the decider. The value is the probability-weighted average. */
  | { kind: 'chance'; id: string; label: string; outcomes: { label: string; probability: number; node: TreeNode }[] }
  | { kind: 'outcome'; id: string; label: string; value: number }

export interface TreeResult {
  value: number
  /** At each decision, which branch the arithmetic picks. Not a recommendation; the consequence of the numbers given. */
  choices: { at: string; take: string; because: number }[]
  /** The spread of outcomes, which an expected value hides entirely. */
  range: { worst: number; best: number }
  /** How much of the value rests on probabilities nobody measured. */
  probabilityNotes: string[]
  describe: string
}

/**
 * A decision tree, folded back from the leaves.
 *
 * Expected value at a chance node and maximum at a decision node, which is the standard rule and rests on an
 * assumption worth naming: that the decider is indifferent between a certain amount and a gamble with the same mean.
 * Most people are not, especially where losing would be ruinous, so the range is reported beside the expected value.
 */
export function foldTree(root: TreeNode, depth = 0): TreeResult | DecisionError {
  if (depth > DECISION_LIMITS.depth) return fail('too-deep', `The tree is nested past the ${DECISION_LIMITS.depth} levels allowed.`)

  switch (root.kind) {
    case 'outcome':
      if (!Number.isFinite(root.value)) return fail('invalid-argument', `"${root.label}" has no finite value.`)
      return {
        value: root.value,
        choices: [],
        range: { worst: root.value, best: root.value },
        probabilityNotes: [],
        describe: `${root.label}: ${Number(root.value.toPrecision(6))}.`
      }

    case 'decision': {
      if (root.branches.length === 0) return fail('no-values', `"${root.label}" is a decision with no branches.`)
      const folded: { label: string; result: TreeResult }[] = []
      for (const branch of root.branches) {
        const result = foldTree(branch.node, depth + 1)
        if (isDecisionError(result)) return result
        folded.push({ label: branch.label, result })
      }
      // The decider picks, so the value of the node is the best branch.
      const best = folded.reduce((a, b) => (b.result.value > a.result.value ? b : a))
      return {
        value: best.result.value,
        choices: [
          { at: root.label, take: best.label, because: best.result.value },
          ...folded.flatMap((one) => one.result.choices)
        ],
        range: {
          worst: Math.min(...folded.map((one) => one.result.range.worst)),
          best: Math.max(...folded.map((one) => one.result.range.best))
        },
        probabilityNotes: folded.flatMap((one) => one.result.probabilityNotes),
        describe: `At "${root.label}" the arithmetic favours "${best.label}", worth ${Number(best.result.value.toPrecision(6))}.`
      }
    }

    case 'chance': {
      if (root.outcomes.length === 0) return fail('no-values', `"${root.label}" is a chance node with no outcomes.`)
      const total = accurateSum(root.outcomes.map((one) => one.probability))
      if (Math.abs(total - 1) > 1e-6) {
        return fail(
          'invalid-probability',
          `The outcomes of "${root.label}" have probabilities adding to ${Number(total.toPrecision(6))} rather than 1. Either one is missing or they overlap.`
        )
      }
      if (root.outcomes.some((one) => one.probability < 0 || one.probability > 1)) {
        return fail('invalid-probability', `An outcome of "${root.label}" has a probability outside 0 to 1.`)
      }

      let value = 0
      const choices: TreeResult['choices'] = []
      let worst = Number.POSITIVE_INFINITY
      let best = Number.NEGATIVE_INFINITY
      const notes: string[] = []
      for (const outcome of root.outcomes) {
        const result = foldTree(outcome.node, depth + 1)
        if (isDecisionError(result)) return result
        value += outcome.probability * result.value
        choices.push(...result.choices)
        worst = Math.min(worst, result.range.worst)
        best = Math.max(best, result.range.best)
        notes.push(...result.probabilityNotes)
      }
      notes.push(`"${root.label}" uses probabilities somebody supplied: ${root.outcomes.map((one) => `${one.label} ${Math.round(one.probability * 100)}%`).join(', ')}.`)

      return {
        value,
        choices,
        range: { worst, best },
        probabilityNotes: notes,
        describe: `"${root.label}" averages to ${Number(value.toPrecision(6))} across its outcomes. That average is not an outcome; the actual result will be one of ${root.outcomes.length}, between ${Number(worst.toPrecision(6))} and ${Number(best.toPrecision(6))}.`
      }
    }
  }
}

// ---------------------------------------------------------------- value of information

export interface InformationValue {
  /** What the decision is worth with what is known now. */
  withCurrentInformation: number
  /** What it would be worth if the uncertainty were resolved before choosing. */
  withPerfectInformation: number
  /** The difference: the most that resolving this uncertainty could possibly be worth. */
  value: number
  /** Whether knowing would change anything at all. */
  wouldChangeDecision: boolean
  describe: string
}

/**
 * How much it would be worth to resolve an uncertainty before deciding.
 *
 * The expected value of perfect information: what the decision is worth if the outcome were known in advance, minus
 * what it is worth now. It is an upper bound -- no real investigation is perfect -- and it is often zero, which is
 * the genuinely useful answer: if the same option wins whatever happens, finding out costs time and changes nothing.
 */
export function valueOfInformation(
  outcomes: readonly { label: string; probability: number; valuesByOption: Record<string, number> }[],
  optionIds: readonly string[]
): InformationValue | DecisionError {
  if (outcomes.length === 0) return fail('no-values', 'There are no outcomes to consider.')
  if (optionIds.length === 0) return fail('no-values', 'There are no options to choose between.')

  const total = accurateSum(outcomes.map((one) => one.probability))
  if (Math.abs(total - 1) > 1e-6) {
    return fail('invalid-probability', `The outcome probabilities add to ${Number(total.toPrecision(6))} rather than 1.`)
  }

  // Without the information: pick the option with the best average across outcomes.
  const averages = optionIds.map((id) => ({
    id,
    value: accurateSum(outcomes.map((one) => one.probability * (one.valuesByOption[id] ?? 0)))
  }))
  const bestNow = averages.reduce((a, b) => (b.value > a.value ? b : a))

  // With it: for each outcome pick the best option, then average.
  let withPerfect = 0
  const bestPerOutcome: string[] = []
  for (const outcome of outcomes) {
    let bestValue = Number.NEGATIVE_INFINITY
    let bestOption = optionIds[0]
    for (const id of optionIds) {
      const value = outcome.valuesByOption[id] ?? 0
      if (value > bestValue) {
        bestValue = value
        bestOption = id
      }
    }
    withPerfect += outcome.probability * bestValue
    bestPerOutcome.push(bestOption)
  }

  const value = withPerfect - bestNow.value
  const wouldChangeDecision = bestPerOutcome.some((one) => one !== bestNow.id)

  return {
    withCurrentInformation: bestNow.value,
    withPerfectInformation: withPerfect,
    value,
    wouldChangeDecision,
    describe: wouldChangeDecision
      ? `Knowing the outcome in advance would be worth at most ${Number(value.toPrecision(6))}, because the best option is not the same one in every case. That is an upper bound: no real investigation resolves an uncertainty perfectly, so anything costing more than this is not worth doing.`
      : `Resolving this uncertainty is worth nothing: "${bestNow.id}" is the best choice whichever way it turns out. Finding out would cost time and change nothing about the decision.`
  }
}

// ---------------------------------------------------------------- the whole decision

export interface DecisionResult {
  ranking: Ranking
  eligibility: EligibilityResult[]
  /** Only the eligible options, ranked. The ineligible ones are kept visible, not deleted. */
  shortlist: string[]
  stability: Stability | null
  risks: RiskSummary[]
  /** Deliberately not a recommendation. See the module comment. */
  summary: string
  caveats: string[]
}

/**
 * A decision, assembled.
 *
 * The order of operations matters: eligibility first, then ranking among the eligible only. Ranking everything and
 * then filtering would give a leader that might be ineligible, and a screen that showed it would have put an option
 * that cannot be chosen at the top of the list.
 */
export function decide(
  options: readonly Entity[],
  criteria: readonly Criterion[],
  requirements: readonly Requirement[],
  risks: readonly Risk[],
  settings: { checkStability?: boolean; seed?: number } = {}
): DecisionResult | DecisionError {
  if (options.length === 0) return fail('no-values', 'There are no options to decide between.')
  if (options.length > DECISION_LIMITS.options) return fail('too-many', `At most ${DECISION_LIMITS.options} options.`)

  const eligibility = checkEligibility(options, requirements)
  const eligible = options.filter((one) => {
    const found = eligibility.find((e) => e.optionId === one.id)
    return found?.eligibility !== 'ineligible'
  })

  if (eligible.length === 0) {
    return fail(
      'none-eligible',
      `No option meets every requirement. ${eligibility.map((one) => `${one.optionName}: ${one.broken.join('; ')}`).join('. ')}. Either a requirement has to give, or none of these will do.`
    )
  }

  const ranking = rank(eligible, criteria)
  if (isCompareError(ranking)) return fail(ranking.error, ranking.message)

  const measured = settings.checkStability === false ? null : stability(eligible, criteria, { seed: settings.seed })
  const stabilityResult = measured !== null && !isCompareError(measured) ? measured : null

  const riskSummaries: RiskSummary[] = []
  for (const option of eligible) {
    const summary = summariseRisks(option.id, risks)
    if (isDecisionError(summary)) return summary
    riskSummaries.push(summary)
  }

  const caveats: string[] = []
  const ineligible = eligibility.filter((one) => one.eligibility === 'ineligible')
  const unknown = eligibility.filter((one) => one.eligibility === 'unknown')
  if (ineligible.length > 0) {
    caveats.push(`${ineligible.map((one) => one.optionName).join(', ')} ${ineligible.length === 1 ? 'was' : 'were'} excluded for not meeting a requirement, and ${ineligible.length === 1 ? 'is' : 'are'} not in the ranking.`)
  }
  if (unknown.length > 0) {
    caveats.push(`${unknown.map((one) => one.optionName).join(', ')} could not be checked against every requirement, so ${unknown.length === 1 ? 'it is' : 'they are'} ranked without being known to qualify.`)
  }
  if (stabilityResult && stabilityResult.verdict !== 'stable') {
    caveats.push(stabilityResult.describe)
  }
  const withRisk = riskSummaries.filter((one) => one.worstCase > 0)
  if (withRisk.length > 0) {
    caveats.push(`Risk is recorded separately and is not in the scores. The worst single impact recorded is ${Number(Math.max(...withRisk.map((one) => one.worstCase)).toPrecision(6))}.`)
  }
  caveats.push('This is what follows from the weights and requirements given. It is not a recommendation, and different weights give a different order.')

  const leader = ranking.scores[0]
  return {
    ranking,
    eligibility,
    shortlist: eligible.map((one) => one.id),
    stability: stabilityResult,
    risks: riskSummaries,
    summary:
      leader === undefined
        ? 'Nothing could be scored.'
        : ranking.tied
          ? `${ranking.scores[0].entityName} and ${ranking.scores[1].entityName} score the same under these weights. There is nothing here to separate them; something outside the criteria would have to.`
          : `Under the weights given, ${leader.entityName} scores highest at ${Number(leader.total.toPrecision(4))}.${stabilityResult ? ` It held that position under ${Math.round(stabilityResult.leaderHeld * 100)}% of the weightings tried.` : ''}`,
    caveats
  }
}

/** The assumptions the Page rests on, for a screen that wants to show them rather than have them inferred. */
export const DECISION_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Nothing here recommends. It computes what follows from the weights and requirements somebody supplied.',
  'A requirement is not a heavy weight. An option that breaks one is ineligible however good it is elsewhere.',
  'An option missing the value a requirement tests is unknown: neither ruled in nor ruled out.',
  'Equal weights are a choice about what matters, not the absence of one.',
  'Pairwise judgements that contradict each other are reported as inconsistent rather than quietly averaged.',
  'Expected cost and worst case answer different questions, and both are shown.',
  'An expected value is not an outcome. The range it hides is reported beside it.',
  'Resolving an uncertainty is often worth nothing, and that is the useful answer when it is true.'
])
