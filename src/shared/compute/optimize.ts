/**
 * Optimization: finding the best value of something, and being honest about what "best" was found.
 *
 * Every method here is local unless it says otherwise. That is the single most important thing about this file, because
 * an optimizer that returns a number without saying whether it is *the* minimum or merely *a* minimum is an optimizer
 * that will eventually be believed about the wrong answer.
 *
 * So every result carries:
 *
 * - `status` -- converged, stalled, at the iteration limit, or infeasible. Never just a number.
 * - `certainty` -- whether this is the global optimum (provable only in the cases where it is), a local one, or the best
 *   point seen without either claim.
 * - `evaluations` -- what it cost, because an expensive objective changes what a caller should do next.
 * - `notes` -- what was assumed, what was clipped, what looked suspicious.
 *
 * ## What is provable here
 *
 * - A **golden-section search on a unimodal function over a bracket** finds the global minimum *within that bracket*, and
 *   only if the function really is unimodal there. Unimodality cannot be checked, so that is an assumption the caller
 *   makes, and it is recorded as one.
 * - A **linear programme** has a global optimum at a vertex, so the simplex method's answer is global. This is the only
 *   place in the file where `global` is claimed without qualification.
 * - **Everything else** -- gradient descent, Nelder-Mead, multi-start -- finds a local optimum. Multi-start improves the
 *   odds and proves nothing.
 *
 * Deterministic: multi-start uses the seeded generator from `statistics.ts`, so the same problem and seed give the same
 * answer. An optimizer whose result changes between runs is one nobody can debug.
 *
 * Pure. No network, no clock, no unseeded randomness.
 */

import { randomSource } from './statistics.ts'

export interface OptimizeError {
  error: 'invalid-argument' | 'not-finite' | 'infeasible' | 'unbounded' | 'no-variables'
  message: string
}

export const isOptimizeError = (value: unknown): value is OptimizeError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

export const OPTIMIZE_LIMITS = Object.freeze({
  variables: 200,
  constraints: 400,
  iterations: 100_000,
  starts: 200
})

/** How an attempt ended. Never collapsed into "it worked". */
export type OptimizeStatus =
  /** The convergence test was met. */
  | 'converged'
  /** Steps became too small to make progress, but the convergence test was never met. */
  | 'stalled'
  /** The iteration limit was reached while still improving. The answer is a snapshot, not a stopping point. */
  | 'iteration-limit'
  /** No point satisfies the constraints. */
  | 'infeasible'
  /** The objective can be improved without limit. */
  | 'unbounded'

/** What can honestly be claimed about the point that came back. */
export type Certainty =
  /** Provably the best. Only linear programmes, and unimodal brackets where the caller vouched for unimodality. */
  | 'global'
  /** A point where the objective cannot be improved locally. There may be better ones elsewhere. */
  | 'local'
  /** The best point seen. No claim that it is even a local optimum. */
  | 'best-seen'

export interface OptimizeResult {
  /** The variable values at the point found. */
  point: readonly number[]
  /** The objective there. */
  value: number
  status: OptimizeStatus
  certainty: Certainty
  iterations: number
  evaluations: number
  /** For a constrained problem: how far the point is outside the constraints. Zero when feasible. */
  violation: number
  notes: readonly string[]
}

export type Objective = (point: readonly number[]) => number

export interface Bound {
  low: number
  high: number
}

// ---------------------------------------------------------------- one variable

export interface LineSearchOptions {
  tolerance?: number
  iterations?: number
  /** The caller's claim that the function has exactly one minimum in the bracket. Recorded, never checked. */
  unimodal?: boolean
}

/**
 * The minimum of a function of one variable within a bracket, by golden-section search.
 *
 * Golden section keeps the bracket that must contain the minimum *if the function is unimodal there*, narrowing it by a
 * constant factor each step. It needs no derivative and never diverges.
 *
 * The unimodality assumption cannot be verified by sampling -- any finite number of points is consistent with another dip
 * between them -- so `unimodal` is the caller's claim and it changes only what is *claimed* about the answer, not how the
 * search runs. Without it the result is `local`, with it `global` within the bracket.
 */
export function minimiseOnInterval(
  f: (x: number) => number,
  low: number,
  high: number,
  options: LineSearchOptions = {}
): OptimizeResult | OptimizeError {
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    return { error: 'invalid-argument', message: 'A bracket has to be two finite numbers.' }
  }
  if (low >= high) return { error: 'invalid-argument', message: 'A bracket has to run from a lower number to a higher one.' }

  const tolerance = Math.max(Number.EPSILON, options.tolerance ?? 1e-9)
  const maximum = Math.min(OPTIMIZE_LIMITS.iterations, Math.max(1, Math.round(options.iterations ?? 500)))
  let evaluations = 0
  const evaluate = (x: number): number => {
    evaluations += 1
    let y: number
    try {
      y = f(x)
    } catch {
      // A point the function refuses is infinitely bad, so the search walks away from it rather than stopping.
      return Number.POSITIVE_INFINITY
    }
    return typeof y === 'number' && !Number.isNaN(y) ? y : Number.POSITIVE_INFINITY
  }

  // 1/φ. The ratio that lets each step reuse one of the previous step's interior points.
  const invPhi = (Math.sqrt(5) - 1) / 2
  let a = low
  let b = high
  let c = b - invPhi * (b - a)
  let d = a + invPhi * (b - a)
  let fc = evaluate(c)
  let fd = evaluate(d)
  let iterations = 0

  while (b - a > tolerance * (Math.abs(a) + Math.abs(b) + 1) && iterations < maximum) {
    iterations += 1
    if (fc < fd) {
      b = d
      d = c
      fd = fc
      c = b - invPhi * (b - a)
      fc = evaluate(c)
    } else {
      a = c
      c = d
      fc = fd
      d = a + invPhi * (b - a)
      fd = evaluate(d)
    }
  }

  const x = (a + b) / 2
  const value = evaluate(x)
  if (!Number.isFinite(value)) {
    return { error: 'not-finite', message: 'The function has no finite value anywhere in that bracket.' }
  }

  const converged = b - a <= tolerance * (Math.abs(a) + Math.abs(b) + 1)
  const notes: string[] = []
  const atEdge = Math.abs(x - low) < (high - low) * 1e-6 || Math.abs(x - high) < (high - low) * 1e-6
  if (atEdge) {
    notes.push(
      'The minimum is at an edge of the bracket. The real minimum may be outside it, so widen the bracket before trusting this.'
    )
  }
  if (options.unimodal === true) {
    notes.push('You stated the function has one minimum in this bracket. That was taken on trust and cannot be checked by sampling.')
  } else {
    notes.push(
      'This is a minimum of the bracket, not necessarily the only one. Golden-section search finds the global minimum only when the function has a single dip, which was not claimed here.'
    )
  }

  return {
    point: Object.freeze([x]),
    value,
    status: converged ? 'converged' : 'iteration-limit',
    // At an edge nothing is established at all; the point is simply the best that was seen.
    certainty: atEdge ? 'best-seen' : options.unimodal === true ? 'global' : 'local',
    iterations,
    evaluations,
    violation: 0,
    notes: Object.freeze(notes)
  }
}

/**
 * A bracket around a minimum, found by walking downhill from a starting point.
 *
 * Returned so a caller can hand it to `minimiseOnInterval` rather than guessing one. Null when the function keeps falling
 * -- which means there is no minimum in that direction, and that is worth knowing rather than being given a bracket that
 * happens to end where the search gave up.
 */
export function bracketMinimum(
  f: (x: number) => number,
  start: number,
  step = 1
): { low: number; high: number; evaluations: number } | null {
  if (!Number.isFinite(start) || !Number.isFinite(step) || step <= 0) return null
  let evaluations = 0
  const evaluate = (x: number): number => {
    evaluations += 1
    try {
      const y = f(x)
      return typeof y === 'number' && !Number.isNaN(y) ? y : Number.POSITIVE_INFINITY
    } catch {
      return Number.POSITIVE_INFINITY
    }
  }

  let a = start
  let fa = evaluate(a)
  let b = start + step
  let fb = evaluate(b)
  let direction = 1
  if (fb > fa) {
    // Downhill is the other way. Swap so the walk always goes down.
    direction = -1
    b = start - step
    fb = evaluate(b)
    if (fb > fa) return { low: Math.min(start - step, start + step), high: Math.max(start - step, start + step), evaluations }
  }

  let width = step
  for (let i = 0; i < 100; i++) {
    width *= 1.618
    const c = b + direction * width
    const fc = evaluate(c)
    if (fc > fb) {
      return { low: Math.min(a, c), high: Math.max(a, c), evaluations }
    }
    a = b
    fa = fb
    b = c
    fb = fc
    if (!Number.isFinite(b) || Math.abs(b) > 1e15) return null
  }
  // A hundred expansions without turning back up: there is no minimum this way.
  return null
}

// ---------------------------------------------------------------- many variables

export interface MinimiseOptions {
  /** A box the search must stay inside. One per variable, or none. */
  bounds?: readonly Bound[]
  tolerance?: number
  iterations?: number
  /** The initial size of the simplex, relative to each variable's scale. */
  step?: number
  /** A hard cap on objective calls, for an expensive objective. */
  maximumEvaluations?: number
}

/**
 * A local minimum of a function of several variables, by Nelder-Mead.
 *
 * Chosen over gradient descent as the default because it needs no derivative: a Page's objective is often a simulation or
 * a table lookup, where a numerical gradient is both expensive and noisy. It is slower on smooth problems, which is the
 * trade.
 *
 * It finds a **local** minimum. Nothing about the method establishes anything else, and the result says so.
 */
export function minimise(
  objective: Objective,
  start: readonly number[],
  options: MinimiseOptions = {}
): OptimizeResult | OptimizeError {
  const n = start.length
  if (n === 0) return { error: 'no-variables', message: 'There is nothing to optimize over.' }
  if (n > OPTIMIZE_LIMITS.variables) {
    return { error: 'invalid-argument', message: `This handles at most ${OPTIMIZE_LIMITS.variables} variables.` }
  }
  if (!start.every((one) => Number.isFinite(one))) {
    return { error: 'invalid-argument', message: 'The starting point has to be finite numbers.' }
  }
  const bounds = options.bounds
  if (bounds && bounds.length !== n) {
    return { error: 'invalid-argument', message: `There are ${n} variables but ${bounds.length} bounds.` }
  }
  if (bounds) {
    for (let i = 0; i < n; i++) {
      if (!(bounds[i].low <= bounds[i].high)) {
        return { error: 'invalid-argument', message: `Variable ${i + 1} has a lower bound above its upper bound.` }
      }
    }
  }

  const tolerance = Math.max(Number.EPSILON, options.tolerance ?? 1e-10)
  const maximum = Math.min(OPTIMIZE_LIMITS.iterations, Math.max(1, Math.round(options.iterations ?? 2000)))
  const evaluationCap = Math.max(n + 1, Math.round(options.maximumEvaluations ?? maximum * (n + 2)))

  const clamp = (point: number[]): number[] =>
    bounds ? point.map((one, i) => Math.min(bounds[i].high, Math.max(bounds[i].low, one))) : point

  let evaluations = 0
  let capped = false
  const evaluate = (point: readonly number[]): number => {
    if (evaluations >= evaluationCap) {
      capped = true
      return Number.POSITIVE_INFINITY
    }
    evaluations += 1
    let y: number
    try {
      y = objective(point)
    } catch {
      return Number.POSITIVE_INFINITY
    }
    return typeof y === 'number' && !Number.isNaN(y) ? y : Number.POSITIVE_INFINITY
  }

  // The initial simplex: the start plus one point displaced along each axis.
  const step = options.step ?? 0.05
  const vertices: { point: number[]; value: number }[] = []
  const first = clamp([...start])
  vertices.push({ point: first, value: evaluate(first) })
  for (let i = 0; i < n; i++) {
    const point = [...first]
    const size = point[i] !== 0 ? point[i] * step : step
    point[i] += size
    const clamped = clamp(point)
    // A bound can clamp the displacement to nothing, which would make the simplex degenerate. Push the other way instead.
    if (clamped[i] === first[i]) clamped[i] = first[i] - Math.abs(size)
    const settled = clamp(clamped)
    vertices.push({ point: settled, value: evaluate(settled) })
  }

  if (vertices.every((one) => !Number.isFinite(one.value))) {
    return { error: 'not-finite', message: 'The objective has no finite value anywhere near the starting point.' }
  }

  let iterations = 0
  let status: OptimizeStatus = 'iteration-limit'
  for (; iterations < maximum; iterations++) {
    vertices.sort((a, b) => a.value - b.value)
    const best = vertices[0]
    const worst = vertices[vertices.length - 1]

    // Converged when the simplex is small in both the objective and the point, so a flat valley does not read as success.
    const spreadValue = Math.abs(worst.value - best.value)
    const spreadPoint = Math.max(
      ...worst.point.map((one, i) => Math.abs(one - best.point[i]))
    )
    const scale = Math.abs(best.value) + tolerance
    if (spreadValue <= tolerance * scale && spreadPoint <= Math.sqrt(tolerance)) {
      status = 'converged'
      break
    }
    if (capped) {
      status = 'stalled'
      break
    }

    // The centroid of everything but the worst vertex: the direction the simplex wants to move.
    const centroid = new Array<number>(n).fill(0)
    for (let v = 0; v < vertices.length - 1; v++) {
      for (let i = 0; i < n; i++) centroid[i] += vertices[v].point[i] / (vertices.length - 1)
    }

    const along = (factor: number): { point: number[]; value: number } => {
      const point = clamp(centroid.map((one, i) => one + factor * (one - worst.point[i])))
      return { point, value: evaluate(point) }
    }

    const reflected = along(1)
    if (reflected.value < vertices[vertices.length - 2].value && reflected.value >= best.value) {
      vertices[vertices.length - 1] = reflected
      continue
    }
    if (reflected.value < best.value) {
      // Reflection improved on the best, so try going further the same way.
      const expanded = along(2)
      vertices[vertices.length - 1] = expanded.value < reflected.value ? expanded : reflected
      continue
    }
    const contracted = reflected.value < worst.value ? along(0.5) : along(-0.5)
    if (contracted.value < Math.min(reflected.value, worst.value)) {
      vertices[vertices.length - 1] = contracted
      continue
    }
    // Nothing helped: shrink the whole simplex towards the best vertex.
    for (let v = 1; v < vertices.length; v++) {
      const point = clamp(vertices[v].point.map((one, i) => best.point[i] + 0.5 * (one - best.point[i])))
      vertices[v] = { point, value: evaluate(point) }
    }
  }

  vertices.sort((a, b) => a.value - b.value)
  const best = vertices[0]
  if (!Number.isFinite(best.value)) {
    return { error: 'not-finite', message: 'The objective never took a finite value during the search.' }
  }

  const notes = [
    'Nelder-Mead finds a local minimum. There may be lower values elsewhere, and nothing about this method rules that out.'
  ]
  if (capped) notes.push(`The objective was called ${evaluations} times, which reached the cap. The search stopped early.`)
  if (status === 'iteration-limit') {
    notes.push(`Stopped at the ${maximum}-iteration limit while still moving. This point is a snapshot, not a settled answer.`)
  }
  if (bounds) {
    const onBound = best.point
      .map((one, i) => (Math.abs(one - bounds[i].low) < 1e-9 || Math.abs(one - bounds[i].high) < 1e-9 ? i + 1 : 0))
      .filter((one) => one > 0)
    if (onBound.length > 0) {
      notes.push(
        `Variable${onBound.length === 1 ? '' : 's'} ${onBound.join(', ')} ended on a bound. The unconstrained minimum is outside the box you set.`
      )
    }
  }

  return {
    point: Object.freeze([...best.point]),
    value: best.value,
    status,
    certainty: status === 'converged' ? 'local' : 'best-seen',
    iterations,
    evaluations,
    violation: 0,
    notes: Object.freeze(notes)
  }
}

/** The same search for a maximum, by minimising the negated objective. Kept explicit so no caller has to remember to negate. */
export function maximise(
  objective: Objective,
  start: readonly number[],
  options: MinimiseOptions = {}
): OptimizeResult | OptimizeError {
  const result = minimise((point) => -objective(point), start, options)
  if (isOptimizeError(result)) return result
  return { ...result, value: -result.value }
}

// ---------------------------------------------------------------- gradient descent

export interface GradientOptions extends MinimiseOptions {
  /** The exact gradient. Without it a central difference is used, which is slower and noisier. */
  gradient?: (point: readonly number[]) => number[]
}

/**
 * A local minimum by gradient descent with backtracking.
 *
 * Faster than Nelder-Mead on a smooth objective with a cheap gradient, and worse on anything noisy -- a numerical gradient
 * of a simulation is mostly noise, and descending noise goes nowhere slowly. Both are offered because neither is right for
 * every problem.
 *
 * The step size is chosen by backtracking until the objective actually decreases, rather than fixed: a fixed step either
 * crawls or diverges, depending on a scale the caller cannot know in advance.
 */
export function descend(
  objective: Objective,
  start: readonly number[],
  options: GradientOptions = {}
): OptimizeResult | OptimizeError {
  const n = start.length
  if (n === 0) return { error: 'no-variables', message: 'There is nothing to optimize over.' }
  if (!start.every((one) => Number.isFinite(one))) {
    return { error: 'invalid-argument', message: 'The starting point has to be finite numbers.' }
  }
  const bounds = options.bounds
  if (bounds && bounds.length !== n) {
    return { error: 'invalid-argument', message: `There are ${n} variables but ${bounds.length} bounds.` }
  }

  const tolerance = Math.max(Number.EPSILON, options.tolerance ?? 1e-8)
  const maximum = Math.min(OPTIMIZE_LIMITS.iterations, Math.max(1, Math.round(options.iterations ?? 1000)))
  let evaluations = 0
  const clamp = (point: number[]): number[] =>
    bounds ? point.map((one, i) => Math.min(bounds[i].high, Math.max(bounds[i].low, one))) : point
  const evaluate = (point: readonly number[]): number => {
    evaluations += 1
    try {
      const y = objective(point)
      return typeof y === 'number' && !Number.isNaN(y) ? y : Number.POSITIVE_INFINITY
    } catch {
      return Number.POSITIVE_INFINITY
    }
  }

  const gradientAt = (point: readonly number[]): number[] => {
    if (options.gradient) {
      try {
        const g = options.gradient(point)
        if (Array.isArray(g) && g.length === n && g.every((one) => Number.isFinite(one))) return g
      } catch {
        // Fall through to the numerical gradient rather than abandoning the search.
      }
    }
    const g = new Array<number>(n).fill(0)
    for (let i = 0; i < n; i++) {
      // Scaled to the variable, because a fixed step is far too large for a variable near 1e-6 and far too small near 1e6.
      const h = Math.max(1e-8, Math.abs(point[i]) * 1e-6)
      const up = [...point]
      const down = [...point]
      up[i] += h
      down[i] -= h
      const a = evaluate(up)
      const b = evaluate(down)
      g[i] = Number.isFinite(a) && Number.isFinite(b) ? (a - b) / (2 * h) : 0
    }
    return g
  }

  let point = clamp([...start])
  let value = evaluate(point)
  if (!Number.isFinite(value)) {
    return { error: 'not-finite', message: 'The objective has no finite value at the starting point.' }
  }

  let iterations = 0
  let status: OptimizeStatus = 'iteration-limit'
  let step = options.step ?? 1
  for (; iterations < maximum; iterations++) {
    const gradient = gradientAt(point)
    const size = Math.sqrt(gradient.reduce((total, one) => total + one * one, 0))
    if (size <= tolerance) {
      status = 'converged'
      break
    }

    // Backtracking: halve the step until the objective actually falls.
    let taken = false
    for (let back = 0; back < 60; back++) {
      const candidate = clamp(point.map((one, i) => one - step * gradient[i]))
      const candidateValue = evaluate(candidate)
      if (candidateValue < value) {
        point = candidate
        value = candidateValue
        taken = true
        // Grow the step a little, so a good direction is not walked at a pace set by an earlier bad one.
        step *= 1.2
        break
      }
      step /= 2
      if (step < 1e-18) break
    }
    if (!taken) {
      status = 'stalled'
      break
    }
  }

  const notes = [
    'Gradient descent finds a local minimum. A different starting point can reach a different one.'
  ]
  if (!options.gradient) {
    notes.push('The gradient was worked out by finite differences. On a noisy objective that gradient is mostly noise, and Nelder-Mead is the better choice.')
  }
  if (status === 'stalled') {
    notes.push('No step in the downhill direction improved the objective, so the search stopped. That usually means a minimum, a very flat region, or a noisy objective.')
  }
  if (status === 'iteration-limit') {
    notes.push(`Stopped at the ${maximum}-iteration limit while still improving.`)
  }

  return {
    point: Object.freeze(point),
    value,
    status,
    certainty: status === 'converged' ? 'local' : 'best-seen',
    iterations,
    evaluations,
    violation: 0,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- multi-start

export interface MultiStartOptions extends MinimiseOptions {
  starts?: number
  seed?: number
}

export interface MultiStartResult extends OptimizeResult {
  /** How many distinct minima the starts landed in. More than one is proof the problem has several. */
  distinctMinima: number
  /** The value found from each start, for a Page that wants to show the spread. */
  everyValue: readonly number[]
}

/**
 * Many local searches from scattered starting points, keeping the best.
 *
 * This raises confidence and proves nothing. If every start lands in the same place that is weak evidence of a single
 * minimum; if they land in several, that is *proof* of several, and the result says so -- a negative result here is the
 * only firm conclusion multi-start can give.
 *
 * Starting points are drawn from a seeded generator, so the same problem and seed give the same answer every time.
 */
export function multiStart(
  objective: Objective,
  bounds: readonly Bound[],
  options: MultiStartOptions = {}
): MultiStartResult | OptimizeError {
  if (bounds.length === 0) return { error: 'no-variables', message: 'Multi-start needs a box to draw starting points from.' }
  if (bounds.length > OPTIMIZE_LIMITS.variables) {
    return { error: 'invalid-argument', message: `This handles at most ${OPTIMIZE_LIMITS.variables} variables.` }
  }
  for (let i = 0; i < bounds.length; i++) {
    if (!Number.isFinite(bounds[i].low) || !Number.isFinite(bounds[i].high) || bounds[i].low > bounds[i].high) {
      return { error: 'invalid-argument', message: `The box for variable ${i + 1} is not a finite range.` }
    }
  }
  const starts = Math.min(OPTIMIZE_LIMITS.starts, Math.max(1, Math.round(options.starts ?? 12)))
  const seed = Math.round(options.seed ?? 1)
  const random = randomSource(seed)

  const results: OptimizeResult[] = []
  let evaluations = 0
  for (let s = 0; s < starts; s++) {
    // The first start is the centre of the box, which is reproducible and often good; the rest are scattered.
    const point = bounds.map((bound) =>
      s === 0 ? (bound.low + bound.high) / 2 : bound.low + random() * (bound.high - bound.low)
    )
    const result = minimise(objective, point, { ...options, bounds })
    if (isOptimizeError(result)) continue
    evaluations += result.evaluations
    results.push(result)
  }

  if (results.length === 0) {
    return { error: 'not-finite', message: 'No starting point in that box led anywhere with a finite objective.' }
  }

  results.sort((a, b) => a.value - b.value)
  const best = results[0]

  // Distinct minima: points far apart relative to the box, so a rounding difference does not count as a second minimum.
  const scale = Math.max(...bounds.map((one) => one.high - one.low), 1)
  const distinct: readonly number[][] = results.reduce<number[][]>((kept, one) => {
    const far = kept.every((other) => Math.max(...one.point.map((v, i) => Math.abs(v - other[i]))) > scale * 1e-4)
    if (far) kept.push([...one.point])
    return kept
  }, [])

  const notes = [
    `${results.length} local searches from scattered starting points, seed ${seed}. The same problem and seed give the same answer.`
  ]
  if (distinct.length > 1) {
    notes.push(
      `The starts landed in ${distinct.length} different minima, which proves this problem has more than one. The best of them is reported, and it is still not proven to be the global one.`
    )
  } else {
    notes.push(
      'Every start landed in the same place. That is weak evidence of a single minimum, not proof: a narrow one elsewhere would be missed by all of them.'
    )
  }

  return {
    ...best,
    certainty: 'local',
    evaluations,
    distinctMinima: distinct.length,
    everyValue: Object.freeze(results.map((one) => one.value)),
    notes: Object.freeze([...notes, ...best.notes])
  }
}

// ---------------------------------------------------------------- linear programming

export interface LinearConstraint {
  /** One weight per variable. */
  coefficients: readonly number[]
  relation: '<=' | '>=' | '='
  value: number
  label?: string
}

export interface LinearProgramme {
  /** The objective's weight on each variable. */
  objective: readonly number[]
  direction: 'minimise' | 'maximise'
  constraints: readonly LinearConstraint[]
  /** Variables are assumed non-negative unless this says otherwise, which is the usual convention and is stated here. */
  allowNegative?: boolean
}

export interface LinearResult extends OptimizeResult {
  /** Which constraints are exactly met at the optimum -- the ones actually limiting the answer. */
  binding: readonly string[]
  /** How much the objective would improve per unit of relaxation of each binding constraint. */
  shadowPrices: readonly { constraint: string; price: number }[]
}

/**
 * A linear programme, by the two-phase simplex method with Bland's rule.
 *
 * This is the one place in the file that can claim a **global** optimum: a linear objective over a convex polyhedron
 * attains its best value at a vertex, and simplex visits vertices. There is no local-minimum trap to fall into.
 *
 * Two phases, because the origin is not generally a feasible starting point. A `>=` constraint excludes it, and there is
 * no way to turn a `>=` into a `<=` -- multiplying an inequality by -1 reverses its direction, so a solver that "flips"
 * one is quietly solving a different problem. Phase one instead adds artificial variables and minimises their total: if
 * that total cannot be driven to zero, no point satisfies the constraints and the problem is genuinely infeasible.
 * Phase two then optimises the real objective from the feasible vertex phase one found.
 *
 * Bland's rule -- always take the lowest-indexed improving column -- is slower than the steepest-edge rules but cannot
 * cycle. A solver that returns slowly is better than one that occasionally never returns.
 */
export function solveLinearProgramme(programme: LinearProgramme): LinearResult | OptimizeError {
  const n = programme.objective.length
  if (n === 0) return { error: 'no-variables', message: 'A linear programme needs at least one variable.' }
  if (n > OPTIMIZE_LIMITS.variables) {
    return { error: 'invalid-argument', message: `This handles at most ${OPTIMIZE_LIMITS.variables} variables.` }
  }
  if (programme.constraints.length > OPTIMIZE_LIMITS.constraints) {
    return { error: 'invalid-argument', message: `This handles at most ${OPTIMIZE_LIMITS.constraints} constraints.` }
  }
  if (!programme.objective.every((one) => Number.isFinite(one))) {
    return { error: 'invalid-argument', message: 'Every objective weight has to be a finite number.' }
  }
  if (programme.allowNegative) {
    return {
      error: 'invalid-argument',
      message:
        'This solver assumes every variable is zero or more. A variable that may go negative has to be written as the difference of two non-negative ones, which keeps the method honest rather than hiding a transformation.'
    }
  }
  for (let i = 0; i < programme.constraints.length; i++) {
    const one = programme.constraints[i]
    if (one.coefficients.length !== n) {
      return {
        error: 'invalid-argument',
        message: `Constraint ${i + 1} has ${one.coefficients.length} weights but there are ${n} variables.`
      }
    }
    if (!one.coefficients.every((c) => Number.isFinite(c)) || !Number.isFinite(one.value)) {
      return { error: 'invalid-argument', message: `Constraint ${i + 1} has a value that is not a finite number.` }
    }
  }

  /** A constraint with a non-negative right-hand side. Flipping the sign flips the relation too; that is the whole point. */
  interface Row {
    coefficients: number[]
    relation: '<=' | '>=' | '='
    value: number
    label: string
    /** Whether the row was negated on the way in, so a shadow price comes back with the sign the caller expects. */
    flipped: boolean
  }

  const rows: Row[] = []
  for (let i = 0; i < programme.constraints.length; i++) {
    const one = programme.constraints[i]
    const label = one.label ?? `constraint ${i + 1}`
    let coefficients = [...one.coefficients]
    let relation = one.relation
    let value = one.value
    let flipped = false
    if (value < 0) {
      coefficients = coefficients.map((c) => -c)
      value = -value
      flipped = true
      // Multiplying an inequality by -1 reverses it. Getting this wrong solves a different problem silently.
      relation = relation === '<=' ? '>=' : relation === '>=' ? '<=' : '='
    }
    if (coefficients.every((c) => c === 0)) {
      // Nothing on the left: either trivially true or flatly impossible. Neither belongs in the tableau.
      const satisfied = relation === '<=' ? 0 <= value : relation === '>=' ? 0 >= value : value === 0
      if (!satisfied) {
        return {
          error: 'infeasible',
          message: `"${label}" has no variables in it and cannot be satisfied, so no set of values works.`
        }
      }
      continue
    }
    rows.push({ coefficients, relation, value, label, flipped })
  }

  const m = rows.length
  // Column layout: the real variables, then one slack or surplus per inequality, then one artificial per `>=` or `=`.
  const slackOf = new Array<number>(m).fill(-1)
  const artificialOf = new Array<number>(m).fill(-1)
  let columns = n
  for (let i = 0; i < m; i++) {
    if (rows[i].relation !== '=') {
      slackOf[i] = columns
      columns += 1
    }
  }
  const artificialStart = columns
  for (let i = 0; i < m; i++) {
    if (rows[i].relation !== '<=') {
      artificialOf[i] = columns
      columns += 1
    }
  }
  const width = columns + 1
  const rhs = columns

  const tableau: number[][] = rows.map((row, i) => {
    const line = new Array<number>(width).fill(0)
    for (let j = 0; j < n; j++) line[j] = row.coefficients[j]
    // A `<=` gets a slack that adds; a `>=` gets a surplus that subtracts, which is why it also needs an artificial.
    if (slackOf[i] >= 0) line[slackOf[i]] = row.relation === '<=' ? 1 : -1
    if (artificialOf[i] >= 0) line[artificialOf[i]] = 1
    line[rhs] = row.value
    return line
  })

  // The starting basis: the slack for a `<=` row, the artificial otherwise. Every basic value is the row's own
  // right-hand side, which is non-negative, so this really is a feasible starting point for phase one.
  const basis = rows.map((row, i) => (row.relation === '<=' ? slackOf[i] : artificialOf[i]))

  const limit = Math.min(OPTIMIZE_LIMITS.iterations, 40 * (n + m) + 2000)
  let iterations = 0

  /**
   * One run of simplex against a cost vector, minimising.
   *
   * Reduced costs are recomputed from the basis each step rather than carried in an objective row through every pivot.
   * That costs a pass over the tableau per iteration and removes a whole class of drift bug, which is the right trade at
   * these sizes.
   */
  const run = (cost: readonly number[], lastColumn: number): 'ok' | 'unbounded' | 'limit' => {
    while (iterations < limit) {
      let enter = -1
      for (let j = 0; j < lastColumn; j++) {
        let dual = 0
        for (let i = 0; i < m; i++) dual += cost[basis[i]] * tableau[i][j]
        // Bland's rule: the lowest-indexed improving column. Slower than steepest-edge, but it cannot cycle.
        if (cost[j] - dual < -1e-9) {
          enter = j
          break
        }
      }
      if (enter < 0) return 'ok'

      let leave = -1
      let bestRatio = Number.POSITIVE_INFINITY
      for (let i = 0; i < m; i++) {
        if (tableau[i][enter] <= 1e-9) continue
        const ratio = tableau[i][rhs] / tableau[i][enter]
        if (ratio < bestRatio - 1e-12 || (Math.abs(ratio - bestRatio) <= 1e-12 && (leave < 0 || basis[i] < basis[leave]))) {
          bestRatio = ratio
          leave = i
        }
      }
      // Nothing limits how far the entering variable can rise, so the objective falls forever in that direction.
      if (leave < 0) return 'unbounded'

      iterations += 1
      const pivot = tableau[leave][enter]
      for (let j = 0; j < width; j++) tableau[leave][j] /= pivot
      for (let i = 0; i < m; i++) {
        if (i === leave) continue
        const factor = tableau[i][enter]
        if (factor === 0) continue
        for (let j = 0; j < width; j++) tableau[i][j] -= factor * tableau[leave][j]
      }
      basis[leave] = enter
    }
    return 'limit'
  }

  const hasArtificials = artificialStart < columns
  if (hasArtificials) {
    // Phase one: drive the artificial variables to zero. Their total is what stands between here and a feasible point.
    const phaseOneCost = new Array<number>(columns).fill(0)
    for (let j = artificialStart; j < columns; j++) phaseOneCost[j] = 1
    const outcome = run(phaseOneCost, columns)
    if (outcome === 'limit') {
      return { error: 'invalid-argument', message: 'The simplex method did not finish within its iteration limit on this problem.' }
    }

    let artificialTotal = 0
    for (let i = 0; i < m; i++) {
      if (basis[i] >= artificialStart) artificialTotal += tableau[i][rhs]
    }
    if (artificialTotal > 1e-7) {
      // The artificials cannot be removed, which is exactly what "no point satisfies all of these at once" means.
      return { error: 'infeasible', message: 'No set of values satisfies all of these constraints at once.' }
    }

    // Any artificial still in the basis sits at zero. Pivot it out on a real column so phase two never touches one;
    // a row with no usable pivot is a constraint the others already imply, and it is simply left where it is.
    for (let i = 0; i < m; i++) {
      if (basis[i] < artificialStart) continue
      let replacement = -1
      for (let j = 0; j < artificialStart; j++) {
        if (Math.abs(tableau[i][j]) > 1e-9) {
          replacement = j
          break
        }
      }
      if (replacement < 0) continue
      const pivot = tableau[i][replacement]
      for (let j = 0; j < width; j++) tableau[i][j] /= pivot
      for (let k = 0; k < m; k++) {
        if (k === i) continue
        const factor = tableau[k][replacement]
        if (factor === 0) continue
        for (let j = 0; j < width; j++) tableau[k][j] -= factor * tableau[i][j]
      }
      basis[i] = replacement
    }
  }

  // Phase two. Simplex minimises, so maximising means minimising the negated objective.
  const maximising = programme.direction === 'maximise'
  const phaseTwoCost = new Array<number>(columns).fill(0)
  for (let j = 0; j < n; j++) phaseTwoCost[j] = maximising ? -programme.objective[j] : programme.objective[j]
  // Artificial columns are left out of the entering scan, so none can come back into the basis.
  const outcome = run(phaseTwoCost, artificialStart)
  if (outcome === 'limit') {
    return { error: 'invalid-argument', message: 'The simplex method did not finish within its iteration limit on this problem.' }
  }
  if (outcome === 'unbounded') {
    return {
      error: 'unbounded',
      message: 'The objective can be improved without limit, so something that should be bounded is not. A constraint is missing.'
    }
  }

  const point = new Array<number>(n).fill(0)
  for (let i = 0; i < m; i++) {
    if (basis[i] < n) point[basis[i]] = tableau[i][rhs]
  }
  for (let j = 0; j < n; j++) {
    // A meaningfully negative variable would mean the method went wrong; a tiny one is rounding.
    if (point[j] < -1e-7) return { error: 'infeasible', message: 'No set of values satisfies all of these constraints at once.' }
    if (point[j] < 0) point[j] = 0
  }

  // The answer is checked against the constraints as the caller wrote them, not against the tableau. A solver that only
  // believes its own arithmetic cannot notice when its arithmetic was wrong.
  let violation = 0
  const binding: string[] = []
  for (let i = 0; i < programme.constraints.length; i++) {
    const one = programme.constraints[i]
    const label = one.label ?? `constraint ${i + 1}`
    const left = one.coefficients.reduce((total, c, j) => total + c * point[j], 0)
    const scale = Math.max(1, Math.abs(left), Math.abs(one.value))
    const over =
      one.relation === '<=' ? left - one.value : one.relation === '>=' ? one.value - left : Math.abs(left - one.value)
    if (over > 1e-6 * scale) violation = Math.max(violation, over)
    if (Math.abs(left - one.value) <= 1e-7 * scale && !binding.includes(label)) binding.push(label)
  }
  if (violation > 0) {
    return { error: 'infeasible', message: 'No set of values satisfies all of these constraints at once.' }
  }

  const value = programme.objective.reduce((total, c, j) => total + c * point[j], 0)

  // A shadow price is the dual of a row: the cost-weighted column under that row's own unit vector. For a `<=` row that
  // is its slack; for anything else the artificial column, which is kept in the tableau for exactly this reason.
  const shadowPrices: { constraint: string; price: number }[] = []
  for (let i = 0; i < m; i++) {
    if (!binding.includes(rows[i].label)) continue
    const unit = rows[i].relation === '<=' ? slackOf[i] : artificialOf[i]
    if (unit < 0) continue
    let dual = 0
    for (let k = 0; k < m; k++) dual += phaseTwoCost[basis[k]] * tableau[k][unit]
    // Undo the two sign conventions: negating for a maximisation, and negating a row whose right-hand side was flipped.
    let price = maximising ? -dual : dual
    if (rows[i].flipped) price = -price
    if (Math.abs(price) > 1e-9 && !shadowPrices.some((one) => one.constraint === rows[i].label)) {
      shadowPrices.push({ constraint: rows[i].label, price })
    }
  }

  const notes = [
    'A linear objective over linear constraints has its best value at a corner of the feasible region, and simplex visits corners. This really is the global optimum, not a local one.',
    'Every variable is assumed to be zero or more.'
  ]
  if (hasArtificials) {
    notes.push('The origin was not a feasible starting point, so a first phase found one before the objective was optimised at all.')
  }
  if (binding.length > 0) {
    notes.push(
      `${binding.join(', ')} ${binding.length === 1 ? 'is' : 'are'} exactly met. Those are what is limiting the answer; the rest have room to spare.`
    )
  }
  if (shadowPrices.length > 0) {
    notes.push(
      'A shadow price is how much the objective would improve per unit of a binding constraint relaxed, and it holds only for a small relaxation.'
    )
  }

  const tidy = (one: number): number => (Math.abs(one) < 1e-10 ? 0 : one)
  return {
    point: Object.freeze(point.map(tidy)),
    value: tidy(value),
    status: 'converged',
    // The one honest `global` in this file.
    certainty: 'global',
    iterations,
    evaluations: iterations,
    violation: 0,
    binding: Object.freeze(binding),
    shadowPrices: Object.freeze(shadowPrices.map((one) => ({ constraint: one.constraint, price: tidy(one.price) }))),
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- constrained non-linear

export interface NonlinearConstraint {
  /** Returns zero or less when the constraint is met. */
  test: (point: readonly number[]) => number
  label: string
  kind: 'inequality' | 'equality'
}

export interface ConstrainedOptions extends MinimiseOptions {
  /** How hard a violation is punished. Raised over several rounds rather than set once. */
  penalty?: number
  rounds?: number
}

export interface ConstrainedResult extends OptimizeResult {
  /** Each constraint and how far outside it the answer is. Zero means met. */
  violations: readonly { constraint: string; by: number }[]
}

/**
 * A constrained minimum, by penalty with an increasing weight.
 *
 * The constraints are added to the objective as a penalty and the weight is raised over several rounds, each starting
 * where the last finished. A single large penalty makes the objective a cliff that Nelder-Mead cannot descend; a single
 * small one produces an answer that quietly breaks the constraints.
 *
 * This is an approximate method. The answer can sit slightly outside the constraints, and by how much is reported per
 * constraint rather than summarised into a single pass-or-fail -- a solution that breaks a budget by 0.001 and one that
 * breaks it by 400 are not the same news.
 */
export function minimiseConstrained(
  objective: Objective,
  start: readonly number[],
  constraints: readonly NonlinearConstraint[],
  options: ConstrainedOptions = {}
): ConstrainedResult | OptimizeError {
  if (start.length === 0) return { error: 'no-variables', message: 'There is nothing to optimize over.' }
  if (constraints.length > OPTIMIZE_LIMITS.constraints) {
    return { error: 'invalid-argument', message: `This handles at most ${OPTIMIZE_LIMITS.constraints} constraints.` }
  }

  const rounds = Math.max(1, Math.min(20, Math.round(options.rounds ?? 6)))
  let weight = Math.max(1e-6, options.penalty ?? 10)

  const measure = (point: readonly number[]): { constraint: string; by: number }[] =>
    constraints.map((one) => {
      let raw: number
      try {
        raw = one.test(point)
      } catch {
        // A constraint that cannot be evaluated is treated as badly broken, so the search moves away from the point.
        return { constraint: one.label, by: Number.POSITIVE_INFINITY }
      }
      if (!Number.isFinite(raw)) return { constraint: one.label, by: Number.POSITIVE_INFINITY }
      const by = one.kind === 'equality' ? Math.abs(raw) : Math.max(0, raw)
      return { constraint: one.label, by }
    })

  let point = [...start]
  let evaluations = 0
  let iterations = 0
  let status: OptimizeStatus = 'converged'

  for (let round = 0; round < rounds; round++) {
    const penalised: Objective = (candidate) => {
      const base = objective(candidate)
      if (!Number.isFinite(base)) return Number.POSITIVE_INFINITY
      let total = 0
      for (const one of measure(candidate)) {
        if (!Number.isFinite(one.by)) return Number.POSITIVE_INFINITY
        total += one.by * one.by
      }
      return base + weight * total
    }
    const result = minimise(penalised, point, options)
    if (isOptimizeError(result)) return result
    point = [...result.point]
    evaluations += result.evaluations
    iterations += result.iterations
    status = result.status
    // Ten-fold per round: enough to tighten meaningfully, gentle enough that each round starts near the last answer.
    weight *= 10
  }

  const violations = measure(point)
  const worst = violations.reduce((most, one) => Math.max(most, Number.isFinite(one.by) ? one.by : 0), 0)
  let value: number
  try {
    value = objective(point)
  } catch {
    return { error: 'not-finite', message: 'The objective could not be evaluated at the point that was found.' }
  }
  if (!Number.isFinite(value)) {
    return { error: 'not-finite', message: 'The objective has no finite value at the point that was found.' }
  }

  const broken = violations.filter((one) => one.by > 1e-6)
  const notes = [
    `Solved by penalty over ${rounds} rounds with the weight raised ten-fold each time. This is an approximate method: the answer can sit slightly outside the constraints.`,
    'A local minimum of the constrained problem. There may be better feasible points elsewhere.'
  ]
  if (broken.length > 0) {
    notes.push(
      `Still outside ${broken.length} constraint${broken.length === 1 ? '' : 's'}: ${broken.map((one) => `${one.constraint} by ${Number(one.by.toPrecision(3))}`).join(', ')}. Whether that matters is yours to judge, not this solver's.`
    )
  }

  return {
    point: Object.freeze(point),
    value,
    status: broken.length > 0 && worst > 1e-3 ? 'infeasible' : status,
    certainty: 'best-seen',
    iterations,
    evaluations,
    violation: worst,
    violations: Object.freeze(violations),
    notes: Object.freeze(notes)
  }
}

/** What every method here can and cannot claim, for a Page that wants to show it. */
export const OPTIMIZE_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Every method here finds a local optimum except the linear-programme solver, which finds the global one because a linear problem has no local traps.',
  'Multi-start raises confidence and proves nothing. Starts landing in several minima proves there are several; starts landing in one proves nothing at all.',
  'Golden-section search finds the global minimum of a bracket only if the function has a single dip there. That cannot be checked by sampling, so it is the caller’s claim.',
  'A numerical gradient of a noisy objective is mostly noise. Nelder-Mead is the better choice there, even though it is slower on smooth problems.',
  'Constrained problems are solved by penalty, which is approximate: the answer can sit slightly outside the constraints, and by how much is reported per constraint.',
  'Linear-programme variables are assumed to be zero or more. One that can go negative has to be written as the difference of two that cannot.',
  'A shadow price holds only for a small relaxation of its constraint.',
  'Multi-start draws its starting points from a seeded generator, so the same problem and seed give the same answer.'
])
