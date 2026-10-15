/**
 * Stochastic approximation: optimise when only noisy information is available.
 *
 * Three estimators, and what each one needs to be true:
 *
 *  - SGD with a Robbins–Monro step sequence a_k = a/(k+1)^γ. Convergence needs
 *    Σa_k = ∞ AND Σa_k² < ∞, which for this family means γ ∈ (0.5, 1]. The
 *    conditions are CHECKED: a constant step size satisfies the first and fails
 *    the second, and the iterates then oscillate in a ball around the optimum
 *    forever. This module reports that as a non-convergence, with the reason,
 *    rather than returning the last iterate as though it were a solution.
 *  - SPSA (Spall 1992): two objective evaluations per iteration regardless of
 *    dimension, by perturbing every coordinate at once. Needs the gain sequences
 *    a_k = a/(k+A)^α and c_k = c/k^γ with α ∈ (0,1], γ > 0, α − 2γ > 0 among the
 *    standard conditions, and a three-times differentiable objective.
 *  - SAMPLE-PATH / infinitesimal perturbation analysis. Needs the sample path to
 *    be almost surely differentiable in the parameter and the derivative to be
 *    uniformly integrable, so that E[d/dθ] = d/dθ E[·]. Where that fails — a
 *    discontinuous path, a parameter that changes the number of events — IPA is
 *    not merely inaccurate, it converges to the wrong number, so the conditions
 *    are stated with every result.
 */
import { EngineError } from '../core/result';
import { stableSum } from '../core/numeric';
import { Random } from '../random/rng';
import type { Seed } from '../random/rng';
import { mean as sampleMean, variance as sampleVariance } from '../stats/descriptive';
import type { Provenance } from './types';

export interface StepSizeConditions {
  gamma: number;
  /** Σ a_k = ∞, needed so the iterates can travel any distance. */
  sumDiverges: boolean;
  /** Σ a_k² < ∞, needed so the noise is eventually averaged out. */
  sumSquaresConverges: boolean;
  satisfied: boolean;
  statement: string;
}

export function stepSizeConditions(gamma: number): StepSizeConditions {
  const sumDiverges = gamma <= 1;
  const sumSquaresConverges = gamma > 0.5;
  const satisfied = sumDiverges && sumSquaresConverges;
  let statement: string;
  if (satisfied) {
    statement = `a_k = a/(k+1)^${gamma} satisfies both Robbins–Monro conditions (Σa_k = ∞ because ${gamma} <= 1, Σa_k² < ∞ because ${gamma} > 0.5), so the iterates converge almost surely for a convex objective with bounded gradient noise.`;
  } else if (!sumSquaresConverges) {
    statement = `a_k = a/(k+1)^${gamma} does NOT satisfy Σa_k² < ∞ (${gamma} <= 0.5${gamma === 0 ? ', a constant step size' : ''}). The gradient noise is never averaged out, so the iterates do not converge: they enter a ball around the optimum whose radius is proportional to the step size and then wander inside it indefinitely. No iterate from such a run is a solution.`;
  } else {
    statement = `a_k = a/(k+1)^${gamma} does NOT satisfy Σa_k = ∞ (${gamma} > 1). The total distance the iterates can travel is finite, so they stall wherever the step budget runs out — which depends on the starting point, not on the optimum.`;
  }
  return { gamma, sumDiverges, sumSquaresConverges, satisfied, statement };
}

export type SaStatus = 'converged' | 'step-budget-exhausted' | 'step-size-conditions-violated';

export interface SgdOptions {
  dimension: number;
  /** Noisy gradient of the objective at x. */
  gradient(x: number[], rng: Random): number[];
  initial: number[];
  iterations: number;
  /** a in a_k = a/(k+1)^γ. */
  stepScale: number;
  /** γ in a_k = a/(k+1)^γ. 0 means a constant step size, which does not converge. */
  stepExponent: number;
  seed: Seed;
  /** Optional projection onto the feasible set, applied after every step. */
  project?(x: number[]): number[];
  /** Convergence is declared when the Polyak-averaged iterate moves less than this. */
  tolerance?: number;
}

export interface SaResult {
  status: SaStatus;
  /** Polyak average of the second half of the iterates, which is what converges. */
  x: number[];
  /** The raw final iterate, for comparison. */
  lastIterate: number[];
  iterations: number;
  /** Movement of the averaged iterate over the final tenth of the run. */
  finalDrift: number;
  conditions: StepSizeConditions;
  trajectory: number[];
  provenance: Provenance;
}

/**
 * Projected stochastic gradient descent with a Robbins–Monro step sequence.
 *
 * The reported point is the Polyak average of the second half of the run, which
 * is the iterate sequence that has the asymptotic normality; the raw last
 * iterate is returned alongside it because the difference between them is a
 * useful diagnostic and hiding it would be misleading.
 */
export function stochasticGradientDescent(options: SgdOptions): SaResult {
  const { dimension: n, iterations } = options;
  if (!Number.isInteger(n) || n < 1) throw new EngineError('The dimension must be a whole number of at least 1.', 'range');
  if (options.initial.length !== n) throw new EngineError(`The starting point has ${options.initial.length} entries but the dimension is ${n}.`, 'shape');
  if (!Number.isInteger(iterations) || iterations < 10) throw new EngineError('Stochastic approximation needs at least 10 iterations to say anything.', 'range');
  if (!(options.stepScale > 0)) throw new EngineError(`The step scale is ${String(options.stepScale)}; it must be positive.`, 'range');
  if (!Number.isFinite(options.stepExponent) || options.stepExponent < 0) throw new EngineError(`The step exponent is ${String(options.stepExponent)}; it must be finite and non-negative.`, 'range');
  const conditions = stepSizeConditions(options.stepExponent);
  const tolerance = options.tolerance ?? 1e-4;
  const rng = new Random(options.seed);
  let x = [...options.initial];
  const halfStart = Math.floor(iterations / 2);
  const running = new Array<number>(n).fill(0);
  let counted = 0;
  const trajectory: number[] = [];
  let avgAtNinety: number[] | null = null;
  for (let k = 0; k < iterations; k++) {
    const g = options.gradient(x, rng);
    if (g.length !== n) throw new EngineError(`The gradient returned ${g.length} entries but the dimension is ${n}.`, 'shape');
    const a = options.stepScale / Math.pow(k + 1, options.stepExponent);
    const next = x.map((v, j) => v - a * g[j]);
    for (const v of next) {
      if (!Number.isFinite(v)) {
        throw new EngineError(
          `The iterate diverged to ${String(v)} at step ${k + 1}. A stochastic-approximation run that overflows has not found a solution; reduce the step scale (currently ${options.stepScale}) or project onto a bounded set.`,
          'convergence',
        );
      }
    }
    x = options.project ? options.project(next) : next;
    if (k >= halfStart) {
      counted++;
      for (let j = 0; j < n; j++) running[j] += (x[j] - running[j]) / counted;
      if (k === Math.floor(iterations * 0.9)) avgAtNinety = [...running];
    }
    trajectory.push(stableSum(x.map((v) => v * v)) ** 0.5);
  }
  const averaged = [...running];
  const drift = avgAtNinety ? Math.sqrt(stableSum(averaged.map((v, j) => (v - (avgAtNinety as number[])[j]) ** 2))) : Infinity;
  let status: SaStatus;
  if (!conditions.satisfied) status = 'step-size-conditions-violated';
  else if (drift <= tolerance) status = 'converged';
  else status = 'step-budget-exhausted';
  return {
    status,
    x: averaged,
    lastIterate: x,
    iterations,
    finalDrift: drift,
    conditions,
    trajectory,
    provenance: {
      exactness: 'empirical',
      method: `Projected stochastic gradient descent, ${iterations} iterations, step a_k = ${options.stepScale}/(k+1)^${options.stepExponent}, Polyak averaging over the final half`,
      assumedInputs: [
        'The supplied gradient is an unbiased estimate of the true gradient. A biased gradient estimator makes the limit wrong, not merely noisy, and nothing here can detect that.',
        'The objective is convex on the projection set. Without convexity the run finds a stationary point at best.',
      ],
      limitations:
        status === 'step-size-conditions-violated'
          ? [
              conditions.statement,
              'This result is NOT a solution. It is reported so the step-size choice can be corrected; the returned point is the last place the iterates happened to be.',
            ]
          : [
              conditions.statement,
              status === 'converged'
                ? `The averaged iterate moved ${drift.toExponential(3)} over the final tenth of the run, within the requested tolerance ${tolerance.toExponential(1)}. That is evidence of convergence, not proof of it.`
                : `The averaged iterate was still moving ${drift.toExponential(3)} per final tenth of the run when the iteration budget ran out, above the tolerance ${tolerance.toExponential(1)}. The point is the best available, not a converged one.`,
            ],
    },
  };
}

/* ----------------------------------------------------------- SPSA */

export interface SpsaOptions {
  dimension: number;
  /** Noisy objective evaluation. SPSA needs no gradient at all. */
  objective(x: number[], rng: Random): number;
  initial: number[];
  iterations: number;
  /** a, A and α in a_k = a/(k+1+A)^α. */
  stepScale: number;
  stability?: number;
  stepExponent?: number;
  /** c and γ in c_k = c/(k+1)^γ. */
  perturbationScale: number;
  perturbationExponent?: number;
  seed: Seed;
  project?(x: number[]): number[];
  tolerance?: number;
}

/**
 * Simultaneous perturbation stochastic approximation.
 *
 * Two objective evaluations per iteration however large the dimension, by
 * perturbing every coordinate simultaneously with a symmetric Bernoulli vector.
 * The resulting gradient estimate is biased at any finite c_k and unbiased only
 * in the limit c_k → 0, which is why the perturbation must decay and why the
 * exponent conditions below are part of the result rather than a footnote.
 */
export function spsa(options: SpsaOptions): SaResult {
  const n = options.dimension;
  if (!Number.isInteger(n) || n < 1) throw new EngineError('The dimension must be a whole number of at least 1.', 'range');
  if (options.initial.length !== n) throw new EngineError(`The starting point has ${options.initial.length} entries but the dimension is ${n}.`, 'shape');
  if (!Number.isInteger(options.iterations) || options.iterations < 10) throw new EngineError('SPSA needs at least 10 iterations.', 'range');
  if (!(options.stepScale > 0) || !(options.perturbationScale > 0)) throw new EngineError('Both the step scale a and the perturbation scale c must be positive.', 'range');
  const alpha = options.stepExponent ?? 0.602;
  const gamma = options.perturbationExponent ?? 0.101;
  const A = options.stability ?? Math.max(1, Math.floor(options.iterations / 20));
  const conditionsOk = alpha > 0 && alpha <= 1 && gamma > 0 && alpha - 2 * gamma > 0;
  const conditions: StepSizeConditions = {
    gamma: alpha,
    sumDiverges: alpha <= 1,
    sumSquaresConverges: alpha > 0.5,
    satisfied: conditionsOk,
    statement: conditionsOk
      ? `α = ${alpha}, γ = ${gamma} satisfy Spall's conditions (α ∈ (0,1], γ > 0, α − 2γ = ${(alpha - 2 * gamma).toPrecision(3)} > 0), so the iterates converge almost surely for a three-times differentiable objective with bounded noise.`
      : `α = ${alpha}, γ = ${gamma} violate Spall's conditions (need α ∈ (0,1], γ > 0 and α − 2γ > 0; here α − 2γ = ${(alpha - 2 * gamma).toPrecision(3)}). The bias of the simultaneous-perturbation gradient does not vanish fast enough relative to the step size, so the iterates do not converge to the optimum.`,
  };
  const tolerance = options.tolerance ?? 1e-3;
  const rng = new Random(options.seed);
  let x = [...options.initial];
  const halfStart = Math.floor(options.iterations / 2);
  const running = new Array<number>(n).fill(0);
  let counted = 0;
  let avgAtNinety: number[] | null = null;
  const trajectory: number[] = [];
  for (let k = 0; k < options.iterations; k++) {
    const ak = options.stepScale / Math.pow(k + 1 + A, alpha);
    const ck = options.perturbationScale / Math.pow(k + 1, gamma);
    const delta = Array.from({ length: n }, () => (rng.bernoulli(0.5) ? 1 : -1));
    const plus = x.map((v, j) => v + ck * delta[j]);
    const minus = x.map((v, j) => v - ck * delta[j]);
    const yPlus = options.objective(options.project ? options.project(plus) : plus, rng);
    const yMinus = options.objective(options.project ? options.project(minus) : minus, rng);
    if (!Number.isFinite(yPlus) || !Number.isFinite(yMinus)) {
      throw new EngineError(`The objective returned a non-finite value at SPSA iteration ${k + 1}; a derivative-free method cannot proceed from that.`, 'finite');
    }
    const scale = (yPlus - yMinus) / (2 * ck);
    const next = x.map((v, j) => v - ak * (scale / delta[j]));
    x = options.project ? options.project(next) : next;
    for (const v of x) if (!Number.isFinite(v)) throw new EngineError(`The SPSA iterate diverged at step ${k + 1}; reduce the step scale.`, 'convergence');
    if (k >= halfStart) {
      counted++;
      for (let j = 0; j < n; j++) running[j] += (x[j] - running[j]) / counted;
      if (k === Math.floor(options.iterations * 0.9)) avgAtNinety = [...running];
    }
    trajectory.push(Math.sqrt(stableSum(x.map((v) => v * v))));
  }
  const averaged = [...running];
  const drift = avgAtNinety ? Math.sqrt(stableSum(averaged.map((v, j) => (v - (avgAtNinety as number[])[j]) ** 2))) : Infinity;
  const status: SaStatus = !conditionsOk ? 'step-size-conditions-violated' : drift <= tolerance ? 'converged' : 'step-budget-exhausted';
  return {
    status,
    x: averaged,
    lastIterate: x,
    iterations: options.iterations,
    finalDrift: drift,
    conditions,
    trajectory,
    provenance: {
      exactness: 'empirical',
      method: `SPSA, ${options.iterations} iterations (2 objective evaluations each, ${2 * options.iterations} in total regardless of the dimension ${n}), a_k = ${options.stepScale}/(k+1+${A})^${alpha}, c_k = ${options.perturbationScale}/(k+1)^${gamma}, Polyak averaging over the final half`,
      assumedInputs: [
        'The objective evaluations are noisy but unbiased, and the objective is smooth enough for the simultaneous-perturbation estimate to have vanishing bias.',
      ],
      limitations: [
        conditions.statement,
        'SPSA uses no derivative, so it cannot detect that it has converged to a local rather than a global optimum, and makes no claim to have done otherwise.',
        status === 'converged' ? `Averaged iterate drift ${drift.toExponential(3)} within tolerance ${tolerance.toExponential(1)}.` : `Averaged iterate drift ${drift.toExponential(3)} still above tolerance ${tolerance.toExponential(1)} when the budget ran out.`,
      ],
    },
  };
}

/* ----------------------------------- sample-path (IPA) gradients */

export interface IpaResult {
  gradient: number[];
  standardError: number[];
  draws: number;
  /** Conditions the interchange of derivative and expectation rests on. */
  conditions: string[];
  provenance: Provenance;
}

/**
 * Average a supplied sample-path derivative: an IPA gradient estimate.
 *
 * The estimator is E[dL/dθ] and it equals dE[L]/dθ only when the interchange is
 * valid. The conditions are returned with the number, because where they fail
 * IPA does not become noisy, it becomes wrong: for a path that jumps as θ
 * crosses a threshold, dL/dθ misses the jump entirely and the estimate converges
 * confidently to the wrong value.
 */
export function ipaGradient(
  pathDerivative: (rng: Random) => number[],
  options: { draws: number; seed: Seed; dimension: number; pathIsAlmostSurelyDifferentiable: boolean },
): IpaResult {
  if (!Number.isInteger(options.draws) || options.draws < 2) throw new EngineError('An IPA estimate needs at least 2 draws to report a standard error.', 'range');
  if (!options.pathIsAlmostSurelyDifferentiable) {
    throw new EngineError(
      'IPA was asked for on a sample path that is not almost surely differentiable in the parameter. The interchange of derivative and expectation then fails and the estimate converges to the WRONG number rather than to a noisy version of the right one. Use a likelihood-ratio (score function) estimator, or SPSA, instead.',
      'assumption',
    );
  }
  const rng = new Random(options.seed);
  const columns: number[][] = Array.from({ length: options.dimension }, () => []);
  for (let i = 0; i < options.draws; i++) {
    const d = pathDerivative(rng);
    if (d.length !== options.dimension) throw new EngineError(`The path derivative returned ${d.length} entries but the dimension is ${options.dimension}.`, 'shape');
    for (let j = 0; j < options.dimension; j++) columns[j].push(d[j]);
  }
  return {
    gradient: columns.map((c) => sampleMean(c)),
    standardError: columns.map((c) => Math.sqrt(sampleVariance(c) / options.draws)),
    draws: options.draws,
    conditions: [
      'The sample path L(θ, ω) is almost surely differentiable in θ at the point of interest.',
      'The path derivatives are uniformly integrable in a neighbourhood of θ, which is what licenses E[dL/dθ] = dE[L]/dθ.',
      'The common random numbers ω do not depend on θ: the same randomness drives the path at every parameter value.',
    ],
    provenance: {
      exactness: 'empirical',
      method: `Infinitesimal perturbation analysis: the mean of ${options.draws} independent sample-path derivatives, with its standard error`,
      assumedInputs: ['The caller asserts the path is almost surely differentiable; that assertion cannot be verified from the samples and is recorded as an assumption.'],
      limitations: [
        'Where the differentiability condition fails, this estimator is biased and the bias does not shrink with more draws. More samples narrow the standard error around the wrong number.',
        'The standard errors are per coordinate and ignore the correlation between coordinates; a joint confidence region needs the full covariance.',
      ],
    },
  };
}

/**
 * The newsvendor's sample-path derivative, which is the textbook IPA example
 * and is exact wherever x ≠ demand:
 *
 *     d/dx [ c·x − r·min(x, D) − v·(x − D)⁺ ] = c − r·1{D > x} − v·1{D <= x}.
 *
 * The path is non-differentiable exactly at x = D, an event of probability zero
 * for a continuous demand — which is why IPA is valid here and would not be for
 * a discrete demand, where that event has positive probability.
 */
export function newsvendorPathDerivative(
  x: number,
  spec: { unitCost: number; price: number; salvage: number },
  demand: (rng: Random) => number,
): (rng: Random) => number[] {
  return (rng: Random) => {
    const d = demand(rng);
    return [spec.unitCost - (d > x ? spec.price : spec.salvage)];
  };
}
