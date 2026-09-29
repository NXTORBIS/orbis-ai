/**
 * Productivity: estimating how long work takes, finding what actually holds it up, and deciding what to do next.
 *
 * The shared productivity engine for Orbis Pages. Estimates come back as ranges because a single number is a lie,
 * the critical path is computed from the dependency graph rather than guessed, and priority scores carry the weights
 * that produced them so they can be argued with.
 *
 * ## Why an estimate is always a range
 *
 * A single-number estimate is read as a commitment and is almost always wrong low, because people estimate the case
 * where nothing goes wrong. A three-point estimate makes the optimism visible: if the optimistic and pessimistic
 * figures are close together, that is a claim about certainty, and it is usually a sign that nobody thought about
 * what could go wrong rather than that nothing could.
 *
 * ## Why adding buffers to every task is wrong
 *
 * Padding each task individually and adding the padded numbers gives a total far larger than the risk justifies,
 * because the delays are partly independent and partly cancel. The correct total buffer grows as the square root of
 * the number of tasks, not linearly — this engine computes both and shows the difference, which is usually large.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * estimate      vs  commitment       -- a range with a confidence against a date somebody will be held to
 * effort        vs  duration         -- ten hours of work against how long until it is done
 * critical path vs  the longest list -- what determines the end date against what has the most items
 * slack         vs  spare time       -- how late a task can be without moving the end against idle capacity
 * priority      vs  urgency          -- what matters against what is shouting
 * utilisation   vs  throughput       -- how busy against how much gets finished
 * ```
 *
 * Pure. No network, no clock, no storage. Every date and duration is supplied.
 */

export interface ProductivityError {
  error: 'invalid-argument' | 'not-finite' | 'out-of-range' | 'cycle' | 'unknown-task' | 'too-many' | 'no-solution'
  message: string
}

export const isProductivityError = (value: unknown): value is ProductivityError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: ProductivityError['error'], message: string, involves: readonly string[] = []): ProductivityError => ({
  error,
  message: involves.length > 0 ? `${message} Involves: ${involves.join(', ')}.` : message
})

const finite = (value: number): boolean => Number.isFinite(value)

export const PRODUCTIVITY_LIMITS = Object.freeze({ tasks: 2000, dependencies: 20_000, items: 5000, samples: 2000 })

// ---------------------------------------------------------------- estimation

export interface EstimateReport {
  optimistic: number
  likely: number
  pessimistic: number
  /** The PERT expected value, weighting the likely case four times. */
  expected: number
  /** The plain average, for comparison — it treats the tail as though it were as likely as the middle. */
  simpleAverage: number
  standardDeviation: number
  /** What to promise for a given confidence, assuming the distribution the method implies. */
  atConfidence: readonly { confidence: number; duration: number }[]
  /** How lopsided the estimate is. Large means the pessimistic tail dominates. */
  skew: number
  /** How wide the range is relative to the middle. Very small usually means nobody considered what could go wrong. */
  relativeSpread: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * A three-point estimate, with what to promise at each confidence level.
 *
 * The confidence table is the useful part. The PERT expected value is roughly a 50% figure — half the time the work
 * takes longer — and promising it is why half of all estimates are missed. An 85% figure is usually substantially
 * larger, and that gap is the cost of a commitment rather than a guess.
 *
 * A very narrow range is flagged. Optimistic and pessimistic figures ten percent apart is a claim of near-certainty
 * about work that has not been done yet, and it almost always means the pessimistic case was not thought about.
 */
export function estimate(input: {
  optimistic: number
  likely: number
  pessimistic: number
  confidences?: readonly number[]
}): EstimateReport | ProductivityError {
  const { optimistic, likely, pessimistic } = input
  for (const [name, value] of Object.entries({ optimistic, likely, pessimistic })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    if (value < 0) return fail('invalid-argument', `"${name}" cannot be negative.`)
  }
  if (optimistic > likely || likely > pessimistic) {
    return fail(
      'invalid-argument',
      `The three figures have to be in order: optimistic (${optimistic}) at or below likely (${likely}) at or below pessimistic (${pessimistic}).`
    )
  }

  const expected = (optimistic + 4 * likely + pessimistic) / 6
  const standardDeviation = (pessimistic - optimistic) / 6
  const simpleAverage = (optimistic + likely + pessimistic) / 3

  const confidences = input.confidences ?? [0.5, 0.7, 0.85, 0.95]
  for (const one of confidences) {
    if (!finite(one) || one <= 0 || one >= 1) return fail('out-of-range', 'Every confidence is a fraction between 0 and 1.')
  }
  if (confidences.length > 32) return fail('too-many', 'That is more than the 32 confidence levels this reports.')

  // The normal quantile by the Beasley-Springer-Moro approximation, good to about 1e-9 over the useful range.
  const quantile = (p: number): number => {
    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
    const low = 0.02425
    if (p < low) {
      const q = Math.sqrt(-2 * Math.log(p))
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    }
    if (p > 1 - low) return -quantile(1 - p)
    const q = p - 0.5
    const r = q * q
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  }

  const atConfidence = confidences.map((confidence) => ({
    confidence,
    duration: expected + quantile(confidence) * standardDeviation
  }))

  const skew = standardDeviation === 0 ? 0 : (pessimistic - likely - (likely - optimistic)) / standardDeviation
  const relativeSpread = likely === 0 ? 0 : (pessimistic - optimistic) / likely

  const warnings: string[] = []
  if (relativeSpread < 0.2 && pessimistic > 0) {
    warnings.push(
      `The optimistic and pessimistic figures are only ${(relativeSpread * 100).toFixed(0)}% apart. That is a claim of near-certainty about work not yet done, and it usually means the pessimistic case was not thought about rather than that nothing could go wrong.`
    )
  }
  if (skew > 1) {
    warnings.push(
      `The estimate is heavily skewed toward the pessimistic end. Where that is real — an unknown dependency, a first attempt at something — the expected value is a poor guide and the high-confidence figure is the one to work from.`
    )
  }
  if (optimistic === likely && likely === pessimistic) {
    warnings.push('All three figures are the same, so this is a single-number estimate wearing three hats. It carries no information about uncertainty at all.')
  }

  const at85 = atConfidence.find((one) => Math.abs(one.confidence - 0.85) < 1e-9)

  return {
    optimistic,
    likely,
    pessimistic,
    expected,
    simpleAverage,
    standardDeviation,
    atConfidence: Object.freeze(atConfidence),
    skew,
    relativeSpread,
    notes: Object.freeze([
      `The PERT expected value is ${expected.toFixed(3)}, weighting the likely case four times. The plain average of the three is ${simpleAverage.toFixed(3)}.`,
      `The expected value is roughly a 50% figure: half the time the work takes longer. ${at85 === undefined ? '' : `An 85% figure is ${at85.duration.toFixed(3)} — ${(((at85.duration - expected) / Math.max(expected, 1e-9)) * 100).toFixed(0)}% more, and that gap is the cost of a commitment rather than a guess.`}`,
      `The standard deviation is taken as a sixth of the range, which assumes the optimistic and pessimistic figures are about three standard deviations out. If they were meant as absolute bounds, the real spread is smaller.`,
      'The confidence figures assume a normal distribution, which real task durations are not — they have a long right tail. Treat the high-confidence numbers as a floor rather than a ceiling.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface BufferReport {
  /** The sum of the individual expected durations. */
  baseDuration: number
  /** Each task padded to the given confidence, then added. Almost always far too much. */
  paddedSum: number
  /** The correct aggregate buffer, which grows as the square root of the task count. */
  aggregateBuffer: number
  /** The total with the aggregate buffer, which is the figure to use. */
  recommendedTotal: number
  /** How much padding each task individually over-buffers by. */
  overBufferFactor: number
  taskCount: number
  confidence: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * The correct buffer for a set of tasks, against the wrong one everybody uses.
 *
 * Padding each task and adding the padded numbers is the commonest estimation error in project work. The delays are
 * partly independent, so their variances add rather than their standard deviations — the aggregate buffer grows as
 * the square root of the number of tasks. Over twenty tasks the difference is more than fourfold, and that is
 * schedule everybody knows is padding and nobody can defend.
 */
export function aggregateBuffer(input: {
  tasks: readonly { label?: string; expected: number; standardDeviation: number }[]
  confidence?: number
}): BufferReport | ProductivityError {
  const { tasks } = input
  if (tasks.length === 0) return fail('invalid-argument', 'There are no tasks.')
  if (tasks.length > PRODUCTIVITY_LIMITS.tasks) return fail('too-many', `That is ${tasks.length} tasks; this handles up to ${PRODUCTIVITY_LIMITS.tasks}.`)
  const confidence = input.confidence ?? 0.85
  if (!finite(confidence) || confidence <= 0.5 || confidence >= 1) {
    return fail('out-of-range', 'The confidence is a fraction above 0.5 and below 1. Below 0.5 there is no buffer to compute.')
  }

  let base = 0
  let varianceSum = 0
  for (const [i, one] of tasks.entries()) {
    if (!finite(one.expected) || one.expected < 0) return fail('invalid-argument', `Task ${i + 1} has an expected duration that is not zero or more.`)
    if (!finite(one.standardDeviation) || one.standardDeviation < 0) {
      return fail('invalid-argument', `Task ${i + 1} has a standard deviation that is not zero or more.`)
    }
    base += one.expected
    varianceSum += one.standardDeviation * one.standardDeviation
  }

  // The z value for the confidence, from the same approximation the estimate function uses.
  const z = Math.sqrt(2) * inverseErf(2 * confidence - 1)
  const paddedSum = base + z * tasks.reduce((sum, one) => sum + one.standardDeviation, 0)
  const aggregate = z * Math.sqrt(varianceSum)

  const warnings: string[] = []
  const factor = aggregate === 0 ? 1 : (paddedSum - base) / aggregate
  if (factor > 2) {
    warnings.push(
      `Padding each task to ${(confidence * 100).toFixed(0)}% and adding them gives ${(paddedSum - base).toFixed(1)} of buffer, against a correct aggregate of ${aggregate.toFixed(1)} — ${factor.toFixed(1)} times too much. That is the padding everyone recognises and nobody can defend.`
    )
  }

  return {
    baseDuration: base,
    paddedSum,
    aggregateBuffer: aggregate,
    recommendedTotal: base + aggregate,
    overBufferFactor: factor,
    taskCount: tasks.length,
    confidence,
    notes: Object.freeze([
      `${tasks.length} tasks totalling ${base.toFixed(1)} expected, plus an aggregate buffer of ${aggregate.toFixed(1)} at ${(confidence * 100).toFixed(0)}% confidence: ${(base + aggregate).toFixed(1)} in all.`,
      'Variances add, standard deviations do not. That is why the aggregate buffer grows as the square root of the task count rather than linearly, and why padding each task separately over-buffers so badly.',
      'This assumes the delays are independent. A shared cause — one person on every task, one supplier for everything — makes them correlated, and then the buffer does need to be closer to the padded sum.',
      'The buffer belongs to the project, not to any task. Held per task it gets absorbed silently and the project is still late.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

/** The inverse error function, by the Giles approximation. Good to about 1e-7, which a buffer does not out-resolve. */
function inverseErf(x: number): number {
  const w = -Math.log((1 - x) * (1 + x))
  if (w < 5) {
    const v = w - 2.5
    let p = 2.81022636e-8
    p = 3.43273939e-7 + p * v
    p = -3.5233877e-6 + p * v
    p = -4.39150654e-6 + p * v
    p = 0.00021858087 + p * v
    p = -0.00125372503 + p * v
    p = -0.00417768164 + p * v
    p = 0.246640727 + p * v
    p = 1.50140941 + p * v
    return p * x
  }
  const v = Math.sqrt(w) - 3
  let p = -0.000200214257
  p = 0.000100950558 + p * v
  p = 0.00134934322 + p * v
  p = -0.00367342844 + p * v
  p = 0.00573950773 + p * v
  p = -0.0076224613 + p * v
  p = 0.00943887047 + p * v
  p = 1.00167406 + p * v
  p = 2.83297682 + p * v
  return p * x
}

// ---------------------------------------------------------------- critical path

export interface Task {
  id: string
  label?: string
  duration: number
  /** Task ids that must finish before this one starts. */
  dependsOn?: readonly string[]
}

export interface CriticalPathReport {
  /** The shortest time the whole thing can take. */
  projectDuration: number
  tasks: readonly {
    id: string
    label: string
    duration: number
    earliestStart: number
    earliestFinish: number
    latestStart: number
    latestFinish: number
    /** How late this can be without delaying the project. Zero means it is on the critical path. */
    slack: number
    onCriticalPath: boolean
  }[]
  /** The chain of tasks that decides the end date. */
  criticalPath: readonly string[]
  /** More than one chain can be critical, and shortening only one of them changes nothing. */
  parallelCriticalPaths: number
  /** Tasks with almost no slack, which become critical the moment anything slips. */
  nearCritical: readonly { id: string; slack: number }[]
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * The critical path through a dependency graph, with slack for every task.
 *
 * Slack is the number that matters and the one people do not have: a task with ten days of slack can be late by ten
 * days and cost nothing, and effort spent hurrying it is wasted. Only the critical path decides the end date, and
 * shortening anything else changes nothing at all.
 *
 * A circular dependency is refused by name with the cycle listed, because it is a real error in the plan rather than
 * something to be worked around — and the near-critical tasks are reported separately, since a task with one day of
 * slack joins the critical path the moment anything slips.
 */
export function criticalPath(input: { tasks: readonly Task[] }): CriticalPathReport | ProductivityError {
  const { tasks } = input
  if (tasks.length === 0) return fail('invalid-argument', 'There are no tasks.')
  if (tasks.length > PRODUCTIVITY_LIMITS.tasks) return fail('too-many', `That is ${tasks.length} tasks; this handles up to ${PRODUCTIVITY_LIMITS.tasks}.`)

  const byId = new Map<string, Task>()
  for (const one of tasks) {
    if (typeof one.id !== 'string' || one.id.trim().length === 0) return fail('invalid-argument', 'Every task needs an id.')
    if (byId.has(one.id)) return fail('invalid-argument', `Two tasks are both called "${one.id}".`)
    if (!finite(one.duration) || one.duration < 0) return fail('invalid-argument', `"${one.id}" has a duration that is not zero or more.`)
    byId.set(one.id, one)
  }
  let dependencyCount = 0
  for (const one of tasks) {
    for (const dependency of one.dependsOn ?? []) {
      if (!byId.has(dependency)) {
        return fail('unknown-task', `"${one.id}" depends on "${dependency}", which is not a task here.`, [one.id])
      }
      if (dependency === one.id) return fail('cycle', `"${one.id}" depends on itself.`, [one.id])
      dependencyCount += 1
    }
  }
  if (dependencyCount > PRODUCTIVITY_LIMITS.dependencies) {
    return fail('too-many', `That is ${dependencyCount} dependencies; this handles up to ${PRODUCTIVITY_LIMITS.dependencies}.`)
  }

  // Topological order by Kahn's algorithm, which also detects a cycle and can say which tasks are in it.
  const incoming = new Map<string, number>()
  const dependents = new Map<string, string[]>()
  for (const one of tasks) {
    incoming.set(one.id, (one.dependsOn ?? []).length)
    for (const dependency of one.dependsOn ?? []) {
      const list = dependents.get(dependency) ?? []
      list.push(one.id)
      dependents.set(dependency, list)
    }
  }
  const ready = tasks.filter((one) => (incoming.get(one.id) as number) === 0).map((one) => one.id)
  const order: string[] = []
  while (ready.length > 0) {
    const id = ready.shift() as string
    order.push(id)
    for (const next of dependents.get(id) ?? []) {
      const remaining = (incoming.get(next) as number) - 1
      incoming.set(next, remaining)
      if (remaining === 0) ready.push(next)
    }
  }
  if (order.length !== tasks.length) {
    const stuck = tasks.filter((one) => !order.includes(one.id)).map((one) => one.id)
    return fail(
      'cycle',
      'The dependencies go in a circle, so no order of work satisfies them. This is an error in the plan rather than something to work around.',
      stuck
    )
  }

  // Forward pass for the earliest times.
  const earliestFinish = new Map<string, number>()
  const earliestStart = new Map<string, number>()
  for (const id of order) {
    const task = byId.get(id) as Task
    const start = Math.max(0, ...(task.dependsOn ?? []).map((one) => earliestFinish.get(one) ?? 0))
    earliestStart.set(id, start)
    earliestFinish.set(id, start + task.duration)
  }
  const projectDuration = Math.max(...[...earliestFinish.values()])

  // Backward pass for the latest times.
  const latestFinish = new Map<string, number>()
  const latestStart = new Map<string, number>()
  for (const id of [...order].reverse()) {
    const task = byId.get(id) as Task
    const followers = dependents.get(id) ?? []
    const finish = followers.length === 0 ? projectDuration : Math.min(...followers.map((one) => latestStart.get(one) as number))
    latestFinish.set(id, finish)
    latestStart.set(id, finish - task.duration)
  }

  const described = order.map((id) => {
    const task = byId.get(id) as Task
    const slack = (latestStart.get(id) as number) - (earliestStart.get(id) as number)
    return {
      id,
      label: task.label ?? id,
      duration: task.duration,
      earliestStart: earliestStart.get(id) as number,
      earliestFinish: earliestFinish.get(id) as number,
      latestStart: latestStart.get(id) as number,
      latestFinish: latestFinish.get(id) as number,
      slack,
      onCriticalPath: Math.abs(slack) < 1e-9
    }
  })

  // The critical path, walked from a zero-slack start to a zero-slack end.
  const critical = described.filter((one) => one.onCriticalPath)
  const path: string[] = []
  let current = critical.find((one) => one.earliestStart === 0)
  const seen = new Set<string>()
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id)
    path.push(current.id)
    const followers = (dependents.get(current.id) ?? []).map((id) => described.find((one) => one.id === id))
    current = followers.find((one) => one !== undefined && one.onCriticalPath)
  }

  // How many independent chains are critical. Shortening one of several changes nothing.
  const criticalStarts = critical.filter((one) => one.earliestStart === 0).length

  const nearCritical = described
    .filter((one) => !one.onCriticalPath && one.slack <= Math.max(1, projectDuration * 0.05))
    .map((one) => ({ id: one.id, slack: one.slack }))
    .sort((a, b) => a.slack - b.slack)

  const warnings: string[] = []
  if (criticalStarts > 1) {
    warnings.push(
      `There are ${criticalStarts} independent chains with no slack. Shortening one of them will not move the end date — the others will simply become the constraint.`
    )
  }
  if (nearCritical.length > 0) {
    warnings.push(
      `${nearCritical.length} task${nearCritical.length === 1 ? '' : 's'} have less than ${Math.max(1, projectDuration * 0.05).toFixed(1)} of slack. They join the critical path the moment anything slips, and a plan that watches only the critical path will not see them coming.`
    )
  }
  const totalSlack = described.reduce((sum, one) => sum + one.slack, 0)
  if (totalSlack === 0 && described.length > 1) {
    warnings.push('Every task is on the critical path, so every task is late if any is. A plan with no slack anywhere has no capacity to absorb anything at all.')
  }

  return {
    projectDuration,
    tasks: Object.freeze(described),
    criticalPath: Object.freeze(path),
    parallelCriticalPaths: criticalStarts,
    nearCritical: Object.freeze(nearCritical),
    notes: Object.freeze([
      `The project takes ${projectDuration} at the earliest, along a critical path of ${path.length} task${path.length === 1 ? '' : 's'}: ${path.join(' -> ')}.`,
      'Only the critical path decides the end date. Shortening anything with slack changes nothing, and effort spent hurrying it is wasted.',
      `Slack is reported for every task. ${described.filter((one) => one.slack > 0).length} of ${described.length} have some.`,
      'This assumes unlimited resources: two tasks with no dependency between them are taken to run at once even if the same person would have to do both. Resource levelling is a different and harder problem.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- prioritisation

export type PriorityMethod = 'weighted-score' | 'wsjf' | 'rice' | 'value-effort'

export const PRIORITY_METHODS: readonly PriorityMethod[] = Object.freeze(['weighted-score', 'wsjf', 'rice', 'value-effort'])

export const PRIORITY_FACTS: Readonly<Record<PriorityMethod, { label: string; formula: string; suits: string; caution: string }>> =
  Object.freeze({
    'weighted-score': {
      label: 'Weighted score',
      formula: 'The sum of each criterion times its weight.',
      suits: 'Any set of criteria you can agree weights for.',
      caution: 'The weights carry the whole decision. Choosing them after seeing the scores is how a ranking gets reverse-engineered to a conclusion somebody already had.'
    },
    wsjf: {
      label: 'Weighted shortest job first',
      formula: '(business value + time criticality + risk reduction) / job size',
      suits: 'A backlog where everything is worth doing and the question is order.',
      caution: 'Systematically favours small work. A large high-value item can stay at the bottom for ever, which is a known failure of the method rather than a finding about the item.'
    },
    rice: {
      label: 'RICE',
      formula: '(reach x impact x confidence) / effort',
      suits: 'Product decisions where reach can actually be estimated.',
      caution: 'The confidence multiplier is the only honest part and the one most often set to 100% by default, which removes it.'
    },
    'value-effort': {
      label: 'Value against effort',
      formula: 'value / effort, with the quadrant named.',
      suits: 'A quick sort into quick wins, big bets, fill-ins and money pits.',
      caution: 'Two numbers cannot express a dependency. An item worth little on its own can be the thing that unlocks three others.'
    }
  })

export interface PriorityReport {
  method: PriorityMethod
  label: string
  formula: string
  ranked: readonly {
    id: string
    label: string
    score: number
    rank: number
    /** How each criterion contributed, so the score can be argued with. */
    contributions: readonly { criterion: string; value: number; weight: number; contribution: number; share: number }[]
    quadrant: string | null
  }[]
  /** Items whose scores are close enough that the order between them is not meaningful. */
  tooCloseToCall: readonly { first: string; second: string; gap: number }[]
  caution: string
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Rank a list by a named method, with each criterion's contribution shown.
 *
 * The contributions are the point. A score of 42 is not arguable; "72% of that came from the reach estimate, which
 * is a guess" is. Every method here has a known bias and states it — WSJF favours small work, RICE hides its
 * uncertainty when confidence is left at 100%, and a weighted score is entirely determined by weights somebody chose.
 *
 * Items whose scores are within a few percent are reported as too close to call, because the arithmetic will always
 * produce an order and the difference between 41 and 42 is not one.
 */
export function prioritise(input: {
  method?: PriorityMethod
  items: readonly { id: string; label?: string; criteria: Readonly<Record<string, number>> }[]
  /** For weighted-score: the weight of each criterion. */
  weights?: Readonly<Record<string, number>>
}): PriorityReport | ProductivityError {
  const method = input.method ?? 'weighted-score'
  const facts = PRIORITY_FACTS[method]
  if (!facts) return fail('invalid-argument', `"${method}" is not one of: ${PRIORITY_METHODS.join(', ')}.`)
  const { items } = input
  if (items.length === 0) return fail('invalid-argument', 'There are no items to rank.')
  if (items.length > PRODUCTIVITY_LIMITS.items) return fail('too-many', `That is ${items.length} items; this handles up to ${PRODUCTIVITY_LIMITS.items}.`)

  const required: Readonly<Record<PriorityMethod, readonly string[]>> = {
    'weighted-score': [],
    wsjf: ['businessValue', 'timeCriticality', 'riskReduction', 'jobSize'],
    rice: ['reach', 'impact', 'confidence', 'effort'],
    'value-effort': ['value', 'effort']
  }

  const reserved = new Set(['__proto__', 'constructor', 'prototype'])
  const seen = new Set<string>()
  for (const one of items) {
    if (typeof one.id !== 'string' || one.id.trim().length === 0) return fail('invalid-argument', 'Every item needs an id.')
    for (const name of Object.keys(one.criteria)) {
      if (reserved.has(name)) {
        return fail('invalid-argument', `"${name}" cannot be a criterion name. It is a reserved property name and using it would reach into the object machinery rather than naming anything.`)
      }
    }
    if (seen.has(one.id)) return fail('invalid-argument', `Two items are both called "${one.id}".`)
    seen.add(one.id)
    for (const field of required[method]) {
      const value = one.criteria[field]
      if (value === undefined) {
        return fail('invalid-argument', `${facts.label} needs "${field}" and "${one.id}" does not have it. The formula is: ${facts.formula}`)
      }
      if (!finite(value)) return fail('not-finite', `"${one.id}" has a "${field}" that is not a finite number.`)
    }
    for (const [name, value] of Object.entries(one.criteria)) {
      if (!finite(value)) return fail('not-finite', `"${one.id}" has a "${name}" that is not a finite number.`)
    }
  }

  const weights = input.weights ?? {}
  const warnings: string[] = []

  const scored = items.map((one) => {
    const contributions: PriorityReport['ranked'][number]['contributions'][number][] = []
    let score: number
    let quadrant: string | null = null

    if (method === 'weighted-score') {
      // Looked up through hasOwnProperty, never by plain indexing: a criterion called "constructor" would otherwise
      // pick up a function off Object.prototype and turn the whole score into NaN.
      const weightFor = (name: string): number =>
        Object.prototype.hasOwnProperty.call(weights, name) ? weights[name] : 1
      let total = 0
      for (const [name, value] of Object.entries(one.criteria)) {
        total += value * weightFor(name)
      }
      score = total
      for (const [name, value] of Object.entries(one.criteria)) {
        const weight = weightFor(name)
        contributions.push({
          criterion: name,
          value,
          weight,
          contribution: value * weight,
          share: total === 0 ? 0 : (value * weight) / total
        })
      }
    } else if (method === 'wsjf') {
      const { businessValue, timeCriticality, riskReduction, jobSize } = one.criteria
      if (jobSize <= 0) {
        score = Number.POSITIVE_INFINITY
      } else {
        score = (businessValue + timeCriticality + riskReduction) / jobSize
      }
      const numerator = businessValue + timeCriticality + riskReduction
      for (const [name, value] of Object.entries({ businessValue, timeCriticality, riskReduction })) {
        contributions.push({
          criterion: name,
          value,
          weight: 1,
          contribution: value / Math.max(jobSize, 1e-9),
          share: numerator === 0 ? 0 : value / numerator
        })
      }
      contributions.push({ criterion: 'jobSize', value: jobSize, weight: -1, contribution: -jobSize, share: 0 })
    } else if (method === 'rice') {
      const { reach, impact, confidence, effort } = one.criteria
      if (confidence > 1) {
        warnings.push(`"${one.id}" has a confidence of ${confidence}. RICE confidence is a fraction from 0 to 1; a percentage will inflate the score a hundredfold.`)
      }
      score = effort <= 0 ? Number.POSITIVE_INFINITY : (reach * impact * confidence) / effort
      for (const [name, value] of Object.entries({ reach, impact, confidence })) {
        contributions.push({ criterion: name, value, weight: 1, contribution: value, share: 0 })
      }
      contributions.push({ criterion: 'effort', value: effort, weight: -1, contribution: -effort, share: 0 })
      if (confidence >= 1) {
        warnings.push(`"${one.id}" has a confidence of 1, which removes the only part of RICE that accounts for not knowing. A default of 100% confidence makes the method a plain value-over-effort score.`)
      }
    } else {
      const { value, effort } = one.criteria
      score = effort <= 0 ? Number.POSITIVE_INFINITY : value / effort
      const medianValue = items.reduce((sum, item) => sum + item.criteria.value, 0) / items.length
      const medianEffort = items.reduce((sum, item) => sum + item.criteria.effort, 0) / items.length
      quadrant =
        value >= medianValue && effort < medianEffort
          ? 'quick win'
          : value >= medianValue
            ? 'big bet'
            : effort < medianEffort
              ? 'fill-in'
              : 'money pit'
      contributions.push(
        { criterion: 'value', value, weight: 1, contribution: value, share: 1 },
        { criterion: 'effort', value: effort, weight: -1, contribution: -effort, share: 0 }
      )
    }

    return { id: one.id, label: one.label ?? one.id, score, contributions: Object.freeze(contributions), quadrant }
  })

  const ranked = [...scored]
    .sort((a, b) => b.score - a.score)
    .map((one, i) => ({ ...one, rank: i + 1 }))

  // Scores within 5% of each other are not meaningfully ordered.
  const tooClose: PriorityReport['tooCloseToCall'][number][] = []
  for (let i = 1; i < ranked.length; i += 1) {
    const gap = ranked[i - 1].score - ranked[i].score
    const scale = Math.max(Math.abs(ranked[i - 1].score), 1e-9)
    if (gap / scale < 0.05) tooClose.push({ first: ranked[i - 1].id, second: ranked[i].id, gap })
  }

  if (tooClose.length > 0) {
    warnings.push(
      `${tooClose.length} adjacent pair${tooClose.length === 1 ? '' : 's'} scored within 5% of each other. The arithmetic will always produce an order and that difference is not one — treat those as tied.`
    )
  }
  if (method === 'weighted-score' && Object.keys(weights).length === 0) {
    warnings.push(
      'No weights were given, so every criterion counts equally. That is a decision, not a neutral default — it says a criterion with a 1-to-5 scale matters as much as one with a 1-to-100 scale.'
    )
  }
  if (method === 'wsjf') {
    const sizes = items.map((one) => one.criteria.jobSize)
    if (Math.max(...sizes) / Math.max(Math.min(...sizes), 1e-9) > 10) {
      warnings.push(
        'The job sizes span more than a factor of ten. WSJF systematically favours small work, so the largest items here will rank low almost regardless of their value — that is a property of the method, not a finding about them.'
      )
    }
  }

  return {
    method,
    label: facts.label,
    formula: facts.formula,
    ranked: Object.freeze(ranked),
    tooCloseToCall: Object.freeze(tooClose),
    caution: facts.caution,
    notes: Object.freeze([
      `${facts.label}: ${facts.formula} Suits ${facts.suits}`,
      `Caution: ${facts.caution}`,
      'Each criterion’s contribution is shown, because a score of 42 is not arguable and "72% of that came from the reach estimate" is.',
      'A ranking is an input to a decision, not the decision. Nothing here knows about dependencies, deadlines or who is available.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- flow

export interface FlowReport {
  /** Items finished per unit time. */
  throughput: number
  /** How many items are in progress. */
  workInProgress: number
  /** How long an item takes from start to finish, by Little's law. */
  cycleTime: number
  /** What cycle time would be at a given WIP limit. */
  atWipLimits: readonly { wip: number; cycleTime: number }[]
  /** Utilisation, and the queueing penalty it carries. */
  utilisation: number | null
  /** How much the queue multiplies waiting time at that utilisation. */
  queueMultiplier: number | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Cycle time from throughput and work in progress, by Little's law, with the queueing penalty of high utilisation.
 *
 * Little's law is exact and almost never used: cycle time is work in progress divided by throughput, so halving the
 * number of things in progress halves how long each takes, with no change in how fast anybody works. That is the
 * single most useful fact about flow and it is counter-intuitive enough that it gets ignored.
 *
 * The queueing penalty is the other half. Waiting time goes as utilisation over one minus utilisation, so at 90%
 * busy the queue is nine times as long as at 50% — which is why a team planned to full capacity delivers more slowly
 * than one planned to 80%, not faster.
 */
export function flow(input: {
  /** Items per unit time. */
  throughput?: number
  workInProgress?: number
  cycleTime?: number
  /** The fraction of capacity in use, for the queueing penalty. */
  utilisation?: number
  /** WIP limits to compare. */
  wipLimits?: readonly number[]
}): FlowReport | ProductivityError {
  const given = ['throughput', 'workInProgress', 'cycleTime'].filter((one) => input[one as 'throughput'] !== undefined)
  if (given.length < 2) {
    return fail(
      'invalid-argument',
      "Little's law relates three quantities, so two of them fix the third. Give any two of throughput, workInProgress and cycleTime."
    )
  }
  if (given.length === 3) {
    const implied = (input.workInProgress as number) / (input.throughput as number)
    if (Math.abs(implied - (input.cycleTime as number)) > Math.max(implied, 1) * 0.01) {
      return fail(
        'no-solution',
        `All three were given and they do not agree: ${input.workInProgress} in progress at ${input.throughput} per unit time implies a cycle time of ${implied.toFixed(3)}, not ${input.cycleTime}. One of the three measurements is wrong.`
      )
    }
  }

  for (const name of given) {
    const value = input[name as 'throughput'] as number
    if (!finite(value) || value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
  }

  const throughput = input.throughput ?? (input.workInProgress as number) / (input.cycleTime as number)
  const workInProgress = input.workInProgress ?? throughput * (input.cycleTime as number)
  const cycleTime = input.cycleTime ?? workInProgress / throughput

  const limits = input.wipLimits ?? [1, 2, 3, 5, 8, 13]
  for (const one of limits) {
    if (!finite(one) || one <= 0) return fail('invalid-argument', 'Every WIP limit has to be greater than zero.')
  }
  if (limits.length > 64) return fail('too-many', 'That is more than the 64 WIP limits this compares.')

  let utilisation: number | null = null
  let queueMultiplier: number | null = null
  const warnings: string[] = []
  if (input.utilisation !== undefined) {
    utilisation = input.utilisation
    if (!finite(utilisation) || utilisation <= 0 || utilisation >= 1) {
      return fail(
        'out-of-range',
        'Utilisation is a fraction above 0 and below 1. At exactly 1 the queue grows without bound and there is no steady state to compute — which is itself the answer to planning a team at full capacity.'
      )
    }
    queueMultiplier = utilisation / (1 - utilisation)
    if (utilisation > 0.85) {
      warnings.push(
        `At ${(utilisation * 100).toFixed(0)}% utilisation the queue is ${queueMultiplier.toFixed(1)} times the service time, against ${(0.8 / 0.2).toFixed(1)} at 80%. Planning to full capacity makes delivery slower, not faster, and this is the arithmetic of why.`
      )
    }
  }

  if (workInProgress > throughput * 10) {
    warnings.push(
      `${workInProgress} items in progress at ${throughput} finished per unit time is a cycle time of ${cycleTime.toFixed(1)}. Cutting the work in progress is the only lever here that shortens it without anybody working faster.`
    )
  }

  return {
    throughput,
    workInProgress,
    cycleTime,
    atWipLimits: Object.freeze(limits.map((wip) => ({ wip, cycleTime: wip / throughput }))),
    utilisation,
    queueMultiplier,
    notes: Object.freeze([
      `${workInProgress} items in progress and ${throughput} finished per unit time gives a cycle time of ${cycleTime.toFixed(3)}.`,
      "Little's law is exact: cycle time is work in progress over throughput. Halving what is in progress halves how long each item takes, with nobody working any faster — which is the most useful and least believed fact about flow.",
      utilisation === null
        ? 'Give a utilisation for the queueing penalty, which is the other half of the picture.'
        : `At ${(utilisation * 100).toFixed(0)}% utilisation the queue multiplies waiting by ${(queueMultiplier as number).toFixed(2)}. That penalty rises without limit as utilisation approaches 1.`,
      "Little's law holds over the long run in a stable system. It says nothing about any individual item, and a system whose work in progress is still growing is not stable."
    ]),
    warnings: Object.freeze(warnings)
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const PRODUCTIVITY_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Estimates are ranges with confidence levels. The expected value is roughly a 50% figure and promising it is why half of all estimates are missed.',
  'A very narrow three-point range is flagged, because it is a claim of certainty about work not yet done.',
  'Confidence figures assume a normal distribution, which task durations are not — they have a long right tail, so treat high-confidence numbers as a floor.',
  'Aggregate buffers grow as the square root of the task count, because variances add and standard deviations do not. Padding each task separately over-buffers badly and the factor is reported.',
  'Buffer arithmetic assumes independent delays. A shared cause makes them correlated and the buffer has to be larger.',
  'The critical path assumes unlimited resources: two unrelated tasks run at once even if one person would have to do both.',
  'Slack is reported for every task, and near-critical tasks separately, because they join the critical path the moment anything slips.',
  'A circular dependency is refused by name with the cycle listed. It is an error in the plan.',
  'Every prioritisation method names its known bias. WSJF favours small work; RICE with confidence at 1 is just value over effort.',
  'Items scoring within 5% of each other are reported as too close to call, because the arithmetic always produces an order and that difference is not one.',
  "Little's law is exact over the long run in a stable system and says nothing about any individual item."
])
