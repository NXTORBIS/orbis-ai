/**
 * Simulation: running a model forward, and knowing when the answer is the model rather than the world.
 *
 * A simulation produces numbers that look exactly like measurements and are not. Everything here is therefore built so
 * that a result cannot be mistaken for an observation: every trace is stamped `simulated`, every run records the seed and
 * the step size that produced it, and every integrator reports its own error rather than presenting its output as fact.
 *
 * ## What this file refuses to hide
 *
 * - **Step size is not a detail.** Euler with a step twice as large is not slightly less accurate, it is a different
 *   answer. Every result carries the step used, and `compareStepSizes` exists so a Page can show what changing it does.
 * - **An integrator that has lost the plot.** A conserved quantity drifting is proof the numbers are wrong, and cheap to
 *   check. `withInvariant` watches one and says when it stops holding.
 * - **Stiffness.** An explicit method on a stiff system does not fail loudly, it oscillates and diverges. That is detected
 *   and named, because "your step size is too big for this system" is actionable and "the answer is 1e40" is not.
 * - **Randomness.** Every stochastic run takes a seed and reports it. A simulation nobody can reproduce is an anecdote.
 * - **A sweep that proves nothing.** Running a model at fifty parameter values shows how the model behaves, which is not
 *   how the world behaves. Every sweep result says so.
 *
 * Pure. No network, no clock, no unseeded randomness.
 */

import { randomSource, mean, standardDeviation, isStatisticsError, percentile } from './statistics.ts'

export interface SimulationError {
  error: 'invalid-argument' | 'not-finite' | 'diverged' | 'too-many-steps' | 'no-variables' | 'stiff'
  message: string
}

export const isSimulationError = (value: unknown): value is SimulationError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

export const SIMULATION_LIMITS = Object.freeze({
  steps: 2_000_000,
  /** Samples kept in a trace. Beyond this the trace is thinned, which is reported. */
  tracePoints: 20_000,
  variables: 200,
  runs: 10_000,
  sweepPoints: 2000
})

/** The state of a system at one instant: a time and the value of every variable. */
export interface State {
  time: number
  values: readonly number[]
}

/** The rate of change of every variable, given the current state. The model, in other words. */
export type Derivative = (time: number, values: readonly number[]) => number[]

export type Method = 'euler' | 'rk4' | 'adaptive'

/** Why a run stopped. Never collapsed into "it finished". */
export type RunStatus =
  /** Reached the end time asked for. */
  | 'complete'
  /** A stop condition the caller set was met. */
  | 'stopped-early'
  /** Values grew without bound. The model may be wrong, or the step too big. */
  | 'diverged'
  /** The step size the error target demanded became too small to make progress. */
  | 'too-stiff'
  /** The step ceiling was reached before the end time. */
  | 'step-limit'

export interface RunResult {
  /** The trace, thinned if it was longer than can usefully be held. */
  trace: readonly State[]
  final: State
  status: RunStatus
  method: Method
  /** The step used, or for an adaptive run the smallest and largest it chose. */
  step: { initial: number; smallest: number; largest: number }
  steps: number
  /** Derivative evaluations, which is the honest measure of what a run cost. */
  evaluations: number
  /**
   * The estimated error at the end, where the method can estimate one.
   *
   * Null for Euler and RK4, which have no error estimate of their own -- and null is the honest answer there rather than
   * a number produced by a rule of thumb.
   */
  estimatedError: number | null
  /** Always `simulated`. Not configurable, because that is the whole point of this field. */
  provenance: 'simulated'
  notes: readonly string[]
}

export interface RunOptions {
  method?: Method
  /** The fixed step, or the first step of an adaptive run. */
  step?: number
  /** For an adaptive run: the local error it aims to keep each step under. */
  tolerance?: number
  maximumSteps?: number
  /** Stop when this returns true. Checked after every accepted step. */
  stopWhen?: (state: State) => boolean
  /** Anything above this in absolute value is divergence rather than a large number. */
  divergeAbove?: number
  /** Keep at most this many points in the trace. */
  tracePoints?: number
}

// ---------------------------------------------------------------- integration

/** The Dormand-Prince coefficients: a fifth-order step and a fourth-order one from the same evaluations. */
const DP_A: readonly (readonly number[])[] = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]
]
const DP_C: readonly number[] = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1]
/** The fifth-order solution's weights. */
const DP_B5: readonly number[] = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0]
/** The fourth-order solution's weights. The difference between the two is the error estimate. */
const DP_B4: readonly number[] = [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40]

/**
 * A system of differential equations integrated forward in time.
 *
 * Three methods, and the choice genuinely matters:
 *
 * - `euler` -- one evaluation per step, error proportional to the step. Included because it is what everybody writes
 *   first and because seeing it drift beside RK4 teaches more than being told. Not a default.
 * - `rk4` -- four evaluations per step, error proportional to the step to the fourth power. The right choice for a smooth
 *   system when the caller knows a good step size.
 * - `adaptive` -- Dormand-Prince, which computes a fourth- and a fifth-order answer from the same evaluations and uses
 *   their difference to choose the next step. The default, because it finds its own step size and reports its own error.
 *
 * Divergence is detected and named rather than returned as a very large number, and a step size the error target keeps
 * shrinking towards zero is reported as stiffness -- which is a property of the system, not a failure of the caller.
 */
export function integrate(
  derivative: Derivative,
  start: State,
  until: number,
  options: RunOptions = {}
): RunResult | SimulationError {
  const n = start.values.length
  if (n === 0) return { error: 'no-variables', message: 'A system needs at least one variable.' }
  if (n > SIMULATION_LIMITS.variables) {
    return { error: 'invalid-argument', message: `This handles at most ${SIMULATION_LIMITS.variables} variables.` }
  }
  if (!Number.isFinite(start.time) || !start.values.every((one) => Number.isFinite(one))) {
    return { error: 'invalid-argument', message: 'The starting state has to be finite numbers.' }
  }
  if (!Number.isFinite(until)) return { error: 'invalid-argument', message: 'The end time has to be a finite number.' }
  if (until === start.time) {
    return { error: 'invalid-argument', message: 'The end time is the start time, so there is nothing to integrate over.' }
  }

  const method = options.method ?? 'adaptive'
  const forward = until > start.time
  const span = Math.abs(until - start.time)
  const requested = options.step ?? span / 1000
  if (!Number.isFinite(requested) || requested <= 0) {
    return { error: 'invalid-argument', message: 'The step size has to be a positive finite number.' }
  }
  const tolerance = Math.max(1e-14, options.tolerance ?? 1e-8)
  const maximumSteps = Math.min(SIMULATION_LIMITS.steps, Math.max(1, Math.round(options.maximumSteps ?? 200_000)))
  const divergeAbove = options.divergeAbove ?? 1e12

  let evaluations = 0
  let failed = false
  const rate = (time: number, values: readonly number[]): number[] | null => {
    evaluations += 1
    let out: number[]
    try {
      out = derivative(time, values)
    } catch {
      failed = true
      return null
    }
    if (!Array.isArray(out) || out.length !== n || !out.every((one) => Number.isFinite(one))) {
      failed = true
      return null
    }
    return out
  }

  const trace: State[] = [{ time: start.time, values: Object.freeze([...start.values]) }]
  let time = start.time
  let values = [...start.values]
  let step = Math.min(requested, span)
  let smallest = step
  let largest = step
  let steps = 0
  let status: RunStatus = 'complete'
  let estimatedError: number | null = null
  let rejections = 0

  const done = (): boolean => (forward ? time >= until - 1e-15 : time <= until + 1e-15)

  while (!done() && steps < maximumSteps) {
    // Never overshoot the end: the last step is trimmed to land exactly on it.
    const remaining = Math.abs(until - time)
    let h = Math.min(step, remaining)

    if (method === 'euler') {
      const k = rate(time, values)
      if (k === null) break
      values = values.map((one, i) => one + (forward ? h : -h) * k[i])
      time += forward ? h : -h
    } else if (method === 'rk4') {
      const signed = forward ? h : -h
      const k1 = rate(time, values)
      if (k1 === null) break
      const k2 = rate(time + signed / 2, values.map((one, i) => one + (signed / 2) * k1[i]))
      if (k2 === null) break
      const k3 = rate(time + signed / 2, values.map((one, i) => one + (signed / 2) * k2[i]))
      if (k3 === null) break
      const k4 = rate(time + signed, values.map((one, i) => one + signed * k3[i]))
      if (k4 === null) break
      values = values.map((one, i) => one + (signed / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]))
      time += signed
    } else {
      // Dormand-Prince. Two answers of different order from one set of evaluations, so the error costs nothing extra.
      const signed = forward ? h : -h
      const k: number[][] = []
      let broke = false
      for (let stage = 0; stage < 7; stage++) {
        const at = values.map((one, i) => {
          let sum = one
          for (let j = 0; j < stage; j++) sum += signed * DP_A[stage][j] * k[j][i]
          return sum
        })
        const evaluated = rate(time + signed * DP_C[stage], at)
        if (evaluated === null) {
          broke = true
          break
        }
        k.push(evaluated)
      }
      if (broke) break

      const fifth = values.map((one, i) => one + signed * DP_B5.reduce((total, b, s) => total + b * k[s][i], 0))
      const fourth = values.map((one, i) => one + signed * DP_B4.reduce((total, b, s) => total + b * k[s][i], 0))
      // The error scaled by the size of the answer, so a variable near 1e6 is not judged by an absolute threshold.
      let error = 0
      for (let i = 0; i < n; i++) {
        const scale = Math.max(1, Math.abs(fifth[i]), Math.abs(values[i]))
        error = Math.max(error, Math.abs(fifth[i] - fourth[i]) / scale)
      }
      estimatedError = error

      if (error > tolerance && h > span * 1e-13) {
        // Rejected. Shrink and try again; this step does not count as progress.
        rejections += 1
        // The standard fifth-order controller, with a safety factor so it does not sit exactly on the tolerance.
        const shrink = Math.max(0.1, 0.9 * Math.pow(tolerance / Math.max(error, 1e-300), 0.2))
        step = h * shrink
        smallest = Math.min(smallest, step)
        if (step < span * 1e-13) {
          // The controller wants a step too small to make progress. That is what stiffness looks like from here.
          status = 'too-stiff'
          break
        }
        continue
      }

      values = fifth
      time += signed
      // Accepted: grow the step for next time, but never by more than five-fold in one go.
      const grow = Math.min(5, Math.max(0.1, 0.9 * Math.pow(tolerance / Math.max(error, 1e-300), 0.2)))
      step = h * grow
      largest = Math.max(largest, Math.min(step, span))
      smallest = Math.min(smallest, h)
    }

    steps += 1
    if (method !== 'adaptive') {
      smallest = Math.min(smallest, h)
      largest = Math.max(largest, h)
    }

    if (!values.every((one) => Number.isFinite(one)) || values.some((one) => Math.abs(one) > divergeAbove)) {
      status = 'diverged'
      break
    }

    trace.push({ time, values: Object.freeze([...values]) })

    if (options.stopWhen) {
      let stop = false
      try {
        stop = options.stopWhen({ time, values }) === true
      } catch {
        // A stop condition that throws is not a reason to keep running forever, but it is not a stop either.
        stop = false
      }
      if (stop) {
        status = 'stopped-early'
        break
      }
    }
  }

  if (failed) {
    return {
      error: 'not-finite',
      message: `The model did not return ${n} finite rates at time ${Number(time.toPrecision(6))}. Every variable needs a rate of change, and every rate has to be a number.`
    }
  }
  if (status === 'complete' && !done() && steps >= maximumSteps) status = 'step-limit'

  const notes: string[] = []
  if (method === 'euler') {
    notes.push(
      "Euler's method: the error falls in proportion to the step, so halving the step roughly halves the error. On anything but a short, gentle run it drifts visibly. Compare against RK4 before believing it."
    )
  }
  if (method === 'rk4') {
    notes.push(
      'Fixed-step RK4. The error falls with the fourth power of the step, but nothing here measured it -- RK4 has no error estimate of its own, and none is invented. Run it at two step sizes to see whether the answer moves.'
    )
  }
  if (method === 'adaptive') {
    notes.push(
      `Dormand-Prince, choosing its own step to keep the estimated error under ${tolerance} each step. That is a local error: it says nothing about how much error has accumulated over the whole run.`
    )
    if (rejections > 0) notes.push(`${rejections} steps were rejected and retried smaller.`)
  }
  if (status === 'diverged') {
    notes.push(
      `Values passed ${divergeAbove} and the run stopped. Either the model really does blow up, or the step was too large for it -- those look identical from here, and trying a smaller step tells them apart.`
    )
  }
  if (status === 'too-stiff') {
    notes.push(
      'The error target kept demanding a smaller step until it was too small to make progress. That is stiffness: the system has processes on wildly different timescales, and an explicit method like this one cannot follow the fast one cheaply. A smaller tolerance will not help.'
    )
  }
  if (status === 'step-limit') {
    notes.push(`Stopped at the ${maximumSteps}-step limit before reaching the end time.`)
  }
  if (status === 'stopped-early') notes.push('A stop condition was met before the end time.')

  const limit = Math.min(SIMULATION_LIMITS.tracePoints, Math.max(2, Math.round(options.tracePoints ?? SIMULATION_LIMITS.tracePoints)))
  let kept: State[] = trace
  if (trace.length > limit) {
    // Thinned evenly, always keeping the first and last, so the ends of the run are exact.
    kept = []
    for (let i = 0; i < limit - 1; i++) kept.push(trace[Math.floor((i * (trace.length - 1)) / (limit - 1))])
    kept.push(trace[trace.length - 1])
    notes.push(`The trace was thinned from ${trace.length} points to ${kept.length} for holding. The final state is exact; the points between are a sample.`)
  }

  return {
    trace: Object.freeze(kept),
    final: { time, values: Object.freeze([...values]) },
    status,
    method,
    step: { initial: Math.min(requested, span), smallest, largest },
    steps,
    evaluations,
    estimatedError: method === 'adaptive' ? estimatedError : null,
    provenance: 'simulated',
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- checking the integrator

export interface InvariantResult {
  run: RunResult
  /** The quantity at the start, which is what everything else is judged against. */
  initial: number
  final: number
  /** The largest the quantity ever strayed, relative to its starting value. */
  worstDrift: number
  /** True when the drift stayed under the tolerance for the whole run. */
  held: boolean
  verdict: string
}

/**
 * A run with a quantity that should not change being watched.
 *
 * Energy in a closed system, total population, mass, charge. If it drifts, the numbers are wrong -- not approximately
 * right, wrong -- and this is the cheapest check there is that the integration actually worked. A simulation nobody
 * checked this way is a simulation nobody has any reason to believe.
 *
 * Note that the converse does not hold, and the verdict says so: a conserved quantity staying put does not make the rest
 * of the answer right.
 *
 * Expect some drift from any method here, including the adaptive one. None of them is symplectic, so on an oscillator
 * the energy creeps rather than staying put exactly, and over a long run that creep accumulates. What matters is whether
 * it stays inside what the caller can live with, which is why the allowance is theirs to set.
 */
export function withInvariant(
  derivative: Derivative,
  start: State,
  until: number,
  invariant: (state: State) => number,
  // `allowedDrift` and not `tolerance`: `RunOptions.tolerance` is the integrator's local error target, and one name
  // meaning two things here would mean loosening the allowed drift silently loosened the integration that produced it.
  options: RunOptions & { allowedDrift?: number } = {}
): InvariantResult | SimulationError {
  const run = integrate(derivative, start, until, options)
  if (isSimulationError(run)) return run

  const measure = (state: State): number => {
    try {
      const value = invariant(state)
      return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN
    } catch {
      return Number.NaN
    }
  }

  const initial = measure(start)
  if (!Number.isFinite(initial)) {
    return { error: 'not-finite', message: 'The quantity being watched has no finite value at the starting state.' }
  }
  const scale = Math.max(Math.abs(initial), 1e-12)
  let worstDrift = 0
  for (const state of run.trace) {
    const value = measure(state)
    if (!Number.isFinite(value)) {
      worstDrift = Number.POSITIVE_INFINITY
      break
    }
    worstDrift = Math.max(worstDrift, Math.abs(value - initial) / scale)
  }
  const final = measure(run.final)
  if (Number.isFinite(final)) worstDrift = Math.max(worstDrift, Math.abs(final - initial) / scale)

  const allowed = options.allowedDrift ?? 1e-6
  const held = worstDrift <= allowed

  const verdict = held
    ? `The quantity stayed within ${Number((worstDrift * 100).toPrecision(2))}% of its starting value for the whole run, which is inside the ${Number((allowed * 100).toPrecision(2))}% you allowed. That is evidence the integration worked. It is not evidence the model is right.`
    : `The quantity drifted by up to ${Number((worstDrift * 100).toPrecision(3))}% of its starting value, which is outside the ${Number((allowed * 100).toPrecision(2))}% you allowed. Something that should not change did, so these numbers are wrong: use a smaller step, a better method, or check the model conserves what you think it does.`

  return { run, initial, final, worstDrift, held, verdict }
}

export interface StepComparison {
  runs: readonly { step: number; final: readonly number[]; status: RunStatus; evaluations: number }[]
  /** How much the answer moved between the two finest steps, relative to the answer's size. */
  changeAtFinest: number
  /** True when halving the step stopped changing the answer meaningfully. */
  settled: boolean
  verdict: string
}

/**
 * The same run at several step sizes, so the caller can see whether the answer depends on the step.
 *
 * This is the single most useful thing anybody can do with a fixed-step integrator, and almost nobody does it. An answer
 * that changes when the step is halved is an answer about the integrator; one that stops changing is at least an answer
 * about the model.
 */
export function compareStepSizes(
  derivative: Derivative,
  start: State,
  until: number,
  steps: readonly number[],
  options: RunOptions = {}
): StepComparison | SimulationError {
  const usable = [...new Set(steps.filter((one) => Number.isFinite(one) && one > 0))].sort((a, b) => b - a)
  if (usable.length < 2) {
    return { error: 'invalid-argument', message: 'Comparing step sizes needs at least two different positive step sizes.' }
  }
  if (usable.length > 12) {
    return { error: 'invalid-argument', message: 'Comparing more than twelve step sizes at once is not useful; pick a spread.' }
  }

  const runs: { step: number; final: readonly number[]; status: RunStatus; evaluations: number }[] = []
  for (const step of usable) {
    // Fixed-step throughout: an adaptive run would choose its own step and make the comparison meaningless.
    const run = integrate(derivative, start, until, { ...options, step, method: options.method === 'euler' ? 'euler' : 'rk4' })
    if (isSimulationError(run)) return run
    runs.push({ step, final: run.final.values, status: run.status, evaluations: run.evaluations })
  }

  const finest = runs[runs.length - 1]
  const nextFinest = runs[runs.length - 2]
  let change = 0
  for (let i = 0; i < finest.final.length; i++) {
    const scale = Math.max(1e-12, Math.abs(finest.final[i]))
    change = Math.max(change, Math.abs(finest.final[i] - nextFinest.final[i]) / scale)
  }
  const settled = change < 1e-4

  return {
    runs: Object.freeze(runs),
    changeAtFinest: change,
    settled,
    verdict: settled
      ? `Going from a step of ${nextFinest.step} to ${finest.step} changed the answer by ${Number((change * 100).toPrecision(2))}%. The answer has stopped depending on the step, which is the least you should check before believing it.`
      : `Going from a step of ${nextFinest.step} to ${finest.step} still changed the answer by ${Number((change * 100).toPrecision(3))}%. The answer still depends on the step, so it is telling you about the integrator rather than about the model. Use a smaller step.`
  }
}

// ---------------------------------------------------------------- stochastic runs

export interface Trial<T> {
  index: number
  seed: number
  outcome: T
}

export interface MonteCarloRun<T> {
  trials: readonly Trial<T>[]
  /** The seed every trial seed was derived from. Re-running with this gives exactly the same trials. */
  seed: number
  requested: number
  /** Trials that threw or produced nothing usable. Counted, never silently dropped. */
  failed: number
  provenance: 'simulated'
  notes: readonly string[]
}

/**
 * A model run many times with different randomness.
 *
 * Each trial gets its own seed derived from the run's seed, so a single trial can be re-run in isolation to debug it --
 * which is the thing that makes a stochastic simulation debuggable at all, and the reason trials do not simply share one
 * generator.
 */
export function monteCarlo<T>(
  trial: (random: () => number, index: number) => T,
  runs: number,
  options: { seed?: number } = {}
): MonteCarloRun<T> | SimulationError {
  const count = Math.round(runs)
  if (!Number.isFinite(count) || count < 1) {
    return { error: 'invalid-argument', message: 'The number of runs has to be at least one.' }
  }
  if (count > SIMULATION_LIMITS.runs) {
    return { error: 'invalid-argument', message: `This runs at most ${SIMULATION_LIMITS.runs} trials at once.` }
  }
  const seed = Math.round(options.seed ?? 1)

  const trials: Trial<T>[] = []
  let failed = 0
  for (let i = 0; i < count; i++) {
    // A distinct, reproducible seed per trial. The multiplier is odd so consecutive trials do not share a stream.
    const trialSeed = (seed + i * 2654435761) | 0
    const random = randomSource(trialSeed === 0 ? 1 : trialSeed)
    try {
      const outcome = trial(random, i)
      if (outcome === undefined) failed += 1
      else trials.push({ index: i, seed: trialSeed, outcome })
    } catch {
      failed += 1
    }
  }

  if (trials.length === 0) {
    return { error: 'not-finite', message: `All ${count} trials failed to produce a result.` }
  }

  const notes = [
    `${trials.length} trials from seed ${seed}. Each trial has its own seed, so any one of them can be re-run on its own.`,
    'These are simulated outcomes. They describe the model, not the world.'
  ]
  if (failed > 0) notes.push(`${failed} of ${count} trials produced nothing and were left out. The rest are not a random sample of what was asked for.`)

  return { trials: Object.freeze(trials), seed, requested: count, failed, provenance: 'simulated', notes: Object.freeze(notes) }
}

export interface OutcomeSummary {
  runs: number
  mean: number
  standardDeviation: number
  /** The middle of the outcomes, which differs from the mean for a skewed distribution. */
  median: number
  low: number
  high: number
  /** The range that covers the given fraction of outcomes. Not a confidence interval, and the note says so. */
  interval: { low: number; high: number; level: number }
  notes: readonly string[]
}

/**
 * The distribution of a numeric outcome across trials.
 *
 * The interval here is a **spread of outcomes**, not a confidence interval on the mean. They are routinely confused and
 * they answer different questions: one says where a single future run is likely to land, the other says how well the
 * average is pinned down. The note states which this is every time.
 */
export function summariseOutcomes(values: readonly number[], level = 0.9): OutcomeSummary | SimulationError {
  const usable = values.filter((one) => typeof one === 'number' && Number.isFinite(one))
  if (usable.length < 2) {
    return { error: 'invalid-argument', message: 'Summarising outcomes needs at least two finite values.' }
  }
  if (!Number.isFinite(level) || level <= 0 || level >= 1) {
    return { error: 'invalid-argument', message: 'A coverage level is a fraction strictly between 0 and 1.' }
  }

  const centre = mean(usable)
  const spread = standardDeviation(usable, 'sample')
  const middle = percentile(usable, 0.5)
  if (isStatisticsError(centre) || isStatisticsError(spread) || isStatisticsError(middle)) {
    return { error: 'not-finite', message: 'These outcomes could not be summarised.' }
  }
  const low = percentile(usable, (1 - level) / 2) as number
  const high = percentile(usable, 1 - (1 - level) / 2) as number

  const notes = [
    `This interval covers ${Math.round(level * 100)}% of the simulated outcomes. It says where a single further run would probably land, not how well the average is pinned down -- those are different questions and this is the first one.`,
    'Simulated outcomes. The spread reflects the randomness written into the model, not any uncertainty about whether the model is right.'
  ]
  if (usable.length !== values.length) {
    notes.push(`${values.length - usable.length} outcomes were not finite numbers and were left out.`)
  }
  // Nonparametric skew: the gap between mean and median in standard deviations. It runs from -1 to 1, and a tenth is
  // where the two start telling different stories. A single large outlier inflates the standard deviation, so a looser
  // threshold than this would miss exactly the case where quoting the mean alone does the most damage.
  const nonparametricSkew = ((centre as number) - (middle as number)) / (spread as number)
  if (Math.abs(nonparametricSkew) > 0.1) {
    notes.push(
      `The mean (${Number((centre as number).toPrecision(4))}) and the median (${Number((middle as number).toPrecision(4))}) are noticeably apart, so the outcomes are skewed and the mean alone will mislead.`
    )
  }

  return {
    runs: usable.length,
    mean: centre as number,
    standardDeviation: spread as number,
    median: middle as number,
    low: Math.min(...usable),
    high: Math.max(...usable),
    interval: { low, high, level },
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- experiments

export interface SweepPoint<T> {
  /** The parameter values at this point, by name. */
  parameters: Readonly<Record<string, number>>
  outcome: T | null
  /** Why there is no outcome, when there is none. */
  failed: string | null
}

export interface SweepResult<T> {
  points: readonly SweepPoint<T>[]
  /** The names swept over, in the order their axes vary. */
  names: readonly string[]
  ran: number
  failed: number
  provenance: 'simulated'
  notes: readonly string[]
}

export interface SweepAxis {
  name: string
  from: number
  to: number
  /** How many values along this axis, including both ends. */
  count: number
  /** Spaced by ratio rather than by difference, for a parameter that spans orders of magnitude. */
  logarithmic?: boolean
}

/**
 * A model run across a grid of parameter values.
 *
 * The grid grows multiplicatively -- three axes of ten points is a thousand runs -- so the total is checked against a
 * limit before anything runs, rather than discovered halfway through.
 *
 * A sweep shows how the *model* responds to its parameters. That is not the same as how the world responds, and the note
 * says so on every result, because a heat map of simulated outcomes looks exactly like a heat map of measurements.
 */
export function sweep<T>(
  run: (parameters: Readonly<Record<string, number>>) => T,
  axes: readonly SweepAxis[],
  options: { limit?: number } = {}
): SweepResult<T> | SimulationError {
  if (axes.length === 0) return { error: 'no-variables', message: 'A sweep needs at least one parameter to vary.' }
  const names = axes.map((one) => one.name)
  if (new Set(names).size !== names.length) {
    return { error: 'invalid-argument', message: 'Two axes have the same parameter name.' }
  }

  let total = 1
  for (const axis of axes) {
    const count = Math.round(axis.count)
    if (!Number.isFinite(count) || count < 1) {
      return { error: 'invalid-argument', message: `Axis "${axis.name}" needs at least one point.` }
    }
    if (!Number.isFinite(axis.from) || !Number.isFinite(axis.to)) {
      return { error: 'invalid-argument', message: `Axis "${axis.name}" has a range that is not finite.` }
    }
    if (axis.logarithmic && (axis.from <= 0 || axis.to <= 0)) {
      return { error: 'invalid-argument', message: `Axis "${axis.name}" is logarithmic, so its range cannot include zero or a negative.` }
    }
    total *= count
  }
  const limit = Math.min(SIMULATION_LIMITS.sweepPoints, Math.max(1, Math.round(options.limit ?? SIMULATION_LIMITS.sweepPoints)))
  if (total > limit) {
    return {
      error: 'too-many-steps',
      message: `That grid is ${total} runs, which is over the ${limit} allowed. A sweep grows multiplicatively: ${axes.map((one) => `${one.name}×${Math.round(one.count)}`).join(' ')}. Use fewer points per axis or fewer axes.`
    }
  }

  const valuesFor = (axis: SweepAxis): number[] => {
    const count = Math.round(axis.count)
    if (count === 1) return [axis.from]
    if (axis.logarithmic) {
      const a = Math.log10(axis.from)
      const b = Math.log10(axis.to)
      return Array.from({ length: count }, (_, i) => Math.pow(10, a + ((b - a) * i) / (count - 1)))
    }
    return Array.from({ length: count }, (_, i) => axis.from + ((axis.to - axis.from) * i) / (count - 1))
  }

  const grids = axes.map(valuesFor)
  const points: SweepPoint<T>[] = []
  let failed = 0

  // The cartesian product, last axis varying fastest, so a two-axis sweep reads row by row.
  const indices = new Array<number>(axes.length).fill(0)
  for (let k = 0; k < total; k++) {
    const parameters: Record<string, number> = {}
    for (let a = 0; a < axes.length; a++) parameters[axes[a].name] = grids[a][indices[a]]
    const frozen = Object.freeze({ ...parameters })
    try {
      const outcome = run(frozen)
      if (outcome === undefined) {
        failed += 1
        points.push({ parameters: frozen, outcome: null, failed: 'the run produced nothing' })
      } else {
        points.push({ parameters: frozen, outcome, failed: null })
      }
    } catch (cause) {
      failed += 1
      points.push({
        parameters: frozen,
        outcome: null,
        failed: cause instanceof Error ? cause.message : 'the run failed'
      })
    }
    for (let a = axes.length - 1; a >= 0; a--) {
      indices[a] += 1
      if (indices[a] < grids[a].length) break
      indices[a] = 0
    }
  }

  const notes = [
    `${points.length} runs across ${axes.length} parameter${axes.length === 1 ? '' : 's'}.`,
    'This shows how the model responds to its parameters. It does not show how the world responds, however smooth the surface looks.'
  ]
  if (failed > 0) {
    notes.push(`${failed} of the ${points.length} runs failed. Those points are holes in the grid, not zeroes, and drawing them as zero would invent a feature that is not there.`)
  }

  return {
    points: Object.freeze(points),
    names: Object.freeze(names),
    ran: points.length - failed,
    failed,
    provenance: 'simulated',
    notes: Object.freeze(notes)
  }
}

export interface Sensitivity {
  parameter: string
  /** How much the outcome moves per unit of the parameter, around the base point. */
  slope: number
  /** The same, scaled so parameters in different units can be compared: percent out per percent in. */
  elasticity: number | null
  /** The outcome when this parameter is moved down and up. */
  low: number
  high: number
}

export interface SensitivityResult {
  base: number
  sensitivities: readonly Sensitivity[]
  /** Parameters ordered by how much they matter, most first. */
  ranked: readonly string[]
  notes: readonly string[]
}

/**
 * Which parameters the outcome actually depends on, by moving each one at a time.
 *
 * One-at-a-time, which is the honest limitation and is stated in the notes: it cannot see an interaction, where two
 * parameters matter together but neither matters alone. That needs a full sweep, and pretending otherwise is how a
 * sensitivity table ends up saying a parameter is irrelevant when it is not.
 *
 * Elasticity -- percent out per percent in -- is reported alongside the raw slope, because a slope of 1000 in one unit
 * and 0.001 in another can be the same relationship, and ranking by raw slope ranks by units.
 */
export function sensitivity(
  run: (parameters: Readonly<Record<string, number>>) => number,
  base: Readonly<Record<string, number>>,
  options: { fraction?: number } = {}
): SensitivityResult | SimulationError {
  const names = Object.keys(base)
  if (names.length === 0) return { error: 'no-variables', message: 'There are no parameters to test.' }
  const fraction = options.fraction ?? 0.05
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction >= 1) {
    return { error: 'invalid-argument', message: 'The fraction to move each parameter by is between 0 and 1.' }
  }

  const evaluate = (parameters: Record<string, number>): number => {
    try {
      const value = run(Object.freeze({ ...parameters }))
      return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN
    } catch {
      return Number.NaN
    }
  }

  const baseValue = evaluate({ ...base })
  if (!Number.isFinite(baseValue)) {
    return { error: 'not-finite', message: 'The model has no finite outcome at the base parameters.' }
  }

  const sensitivities: Sensitivity[] = []
  for (const name of names) {
    const centre = base[name]
    if (!Number.isFinite(centre)) continue
    // Scaled to the parameter, with a floor so a parameter sitting at zero still gets moved.
    const delta = centre !== 0 ? Math.abs(centre) * fraction : fraction
    const down = evaluate({ ...base, [name]: centre - delta })
    const up = evaluate({ ...base, [name]: centre + delta })
    if (!Number.isFinite(down) || !Number.isFinite(up)) {
      sensitivities.push({ parameter: name, slope: Number.NaN, elasticity: null, low: down, high: up })
      continue
    }
    const slope = (up - down) / (2 * delta)
    const elasticity = centre !== 0 && baseValue !== 0 ? (slope * centre) / baseValue : null
    sensitivities.push({ parameter: name, slope, elasticity, low: down, high: up })
  }

  const rankable = sensitivities.filter((one) => Number.isFinite(one.slope))
  const ranked = [...rankable]
    .sort((a, b) => {
      // Ranked by elasticity where both have one, because a raw slope ranks by units rather than by importance.
      const sizeA = a.elasticity === null ? Math.abs(a.slope) : Math.abs(a.elasticity)
      const sizeB = b.elasticity === null ? Math.abs(b.slope) : Math.abs(b.elasticity)
      return sizeB - sizeA
    })
    .map((one) => one.parameter)

  const notes = [
    `Each parameter was moved ${Math.round(fraction * 100)}% either side of its base value on its own.`,
    'Moving one parameter at a time cannot see an interaction: two parameters that only matter together will both look irrelevant here. A full sweep is the only thing that finds those.',
    'Ranked by elasticity -- percent out per percent in -- because a raw slope ranks by the units a parameter happens to be in.'
  ]
  const broken = sensitivities.filter((one) => !Number.isFinite(one.slope)).map((one) => one.parameter)
  if (broken.length > 0) {
    notes.push(`The model produced nothing finite when ${broken.join(', ')} ${broken.length === 1 ? 'was' : 'were'} moved, so ${broken.length === 1 ? 'it has' : 'they have'} no sensitivity here rather than a sensitivity of zero.`)
  }

  return { base: baseValue, sensitivities: Object.freeze(sensitivities), ranked: Object.freeze(ranked), notes: Object.freeze(notes) }
}

/** What every simulation here is and is not, for a Page that wants to show it. */
export const SIMULATION_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Every result here is simulated. It describes a model, not the world, and it is stamped that way so it cannot be mistaken for a measurement.',
  'The step size is part of the answer. An answer that changes when the step is halved is telling you about the integrator, not about the model.',
  'Euler and RK4 have no error estimate of their own, so none is reported for them. The adaptive method reports a local error, which is not the error accumulated over the whole run.',
  'A conserved quantity that drifts proves the numbers are wrong. One that holds does not prove the model is right.',
  'Divergence and a step that is too large look identical from inside a run. Trying a smaller step is what tells them apart.',
  'Stiffness is a property of the system, not a mistake. An explicit method cannot follow a stiff system cheaply, and a tighter tolerance makes it worse rather than better.',
  'Every stochastic run records its seed, and every trial has its own, so any single trial can be re-run on its own.',
  'The spread of simulated outcomes is not a confidence interval on the mean, and it carries no uncertainty about whether the model itself is right.',
  'Moving one parameter at a time cannot find an interaction between two of them.',
  'A failed run in a sweep is a hole in the grid, not a zero.'
])
