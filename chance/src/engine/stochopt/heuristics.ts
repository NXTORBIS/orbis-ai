/**
 * Metaheuristics for the combinatorial problems the linear machinery cannot
 * reach, with the guarantee they offer stated plainly: none.
 *
 * Simulated annealing converges in distribution to the set of global optima
 * under a logarithmic cooling schedule, which is far too slow to run; every
 * practical schedule — including the geometric one here — gives up that
 * guarantee. The cross-entropy method converges to a degenerate sampling
 * distribution, which need not be concentrated on an optimum. Both therefore
 * return `globalOptimumGuaranteed: false` on every run, and the field is not
 * optional. A heuristic result that does not carry its own disclaimer will be
 * read as an optimum, which is the failure mode this field exists to prevent.
 */
import { EngineError } from '../core/result';
import { stableSum } from '../core/numeric';
import { Random } from '../random/rng';
import type { Seed } from '../random/rng';
import type { Provenance } from './types';

export interface HeuristicGuarantee {
  /** Always false. Neither method finds a certified global optimum in finite time. */
  globalOptimumGuaranteed: false;
  statement: string;
}

export interface AnnealingOptions<T> {
  initial: T;
  /** Lower is better. */
  energy(state: T): number;
  /** A random neighbour of the state. */
  neighbour(state: T, rng: Random): T;
  iterations: number;
  initialTemperature: number;
  /** Geometric cooling factor per iteration, in (0,1). */
  coolingRate: number;
  seed: Seed;
}

export interface HeuristicResult<T> {
  best: T;
  bestEnergy: number;
  /** Energy of the final state, which is usually worse than the best seen. */
  finalEnergy: number;
  evaluations: number;
  accepted: number;
  /** Best energy as the run progressed, for a convergence plot. */
  history: number[];
  guarantee: HeuristicGuarantee;
  provenance: Provenance;
}

/**
 * Simulated annealing with a geometric cooling schedule
 * T_k = T₀ · ρ^k.
 */
export function simulatedAnnealing<T>(options: AnnealingOptions<T>): HeuristicResult<T> {
  const { iterations, initialTemperature: T0, coolingRate: rho } = options;
  if (!Number.isInteger(iterations) || iterations < 1) throw new EngineError('Simulated annealing needs at least 1 iteration.', 'range');
  if (!(T0 > 0)) throw new EngineError(`The initial temperature is ${String(T0)}; it must be positive or every uphill move is rejected and the run is plain hill climbing.`, 'range');
  if (!(rho > 0 && rho < 1)) throw new EngineError(`The cooling rate is ${String(rho)}; a geometric schedule needs a factor strictly inside (0,1).`, 'range');
  const rng = new Random(options.seed);
  let state = options.initial;
  let energy = options.energy(state);
  if (!Number.isFinite(energy)) throw new EngineError(`The initial state has energy ${String(energy)}; annealing cannot start from an infeasible or undefined state.`, 'finite');
  let best = state;
  let bestEnergy = energy;
  let accepted = 0;
  let evaluations = 1;
  const history: number[] = [];
  for (let k = 0; k < iterations; k++) {
    const temperature = T0 * Math.pow(rho, k);
    const candidate = options.neighbour(state, rng);
    const candidateEnergy = options.energy(candidate);
    evaluations++;
    if (!Number.isFinite(candidateEnergy)) {
      // An infeasible neighbour is simply rejected; it is not an error.
      history.push(bestEnergy);
      continue;
    }
    const delta = candidateEnergy - energy;
    if (delta <= 0 || (temperature > 0 && rng.uniform() < Math.exp(-delta / temperature))) {
      state = candidate;
      energy = candidateEnergy;
      accepted++;
      if (energy < bestEnergy) {
        bestEnergy = energy;
        best = state;
      }
    }
    history.push(bestEnergy);
  }
  const finalTemperature = T0 * Math.pow(rho, iterations);
  return {
    best,
    bestEnergy,
    finalEnergy: energy,
    evaluations,
    accepted,
    history,
    guarantee: {
      globalOptimumGuaranteed: false,
      statement: `No global guarantee. Simulated annealing converges in distribution to the global optima only under a cooling schedule no faster than T_k ∝ 1/log k; this run used the geometric schedule T_k = ${T0} · ${rho}^k, which cools from ${T0} to ${finalTemperature.toExponential(3)} over ${iterations} iterations and is far faster than that. The returned state is the best of ${evaluations} evaluations and may be arbitrarily far from optimal.`,
    },
    provenance: {
      exactness: 'empirical',
      method: `Simulated annealing, ${iterations} iterations, geometric cooling T_k = ${T0}·${rho}^k, ${accepted} moves accepted (${((accepted / iterations) * 100).toFixed(1)}%)`,
      assumedInputs: ['The neighbourhood structure is the user\'s; the result depends on it at least as much as on the schedule.'],
      limitations: [
        'The result is a random variable. Two runs with different seeds will generally return different states, and the spread across seeds is the only available measure of reliability.',
        `An acceptance rate of ${((accepted / iterations) * 100).toFixed(1)}% is informative: near 0% the schedule cooled too fast and the run was hill climbing from one point; near 100% it never cooled and the run was a random walk.`,
      ],
    },
  };
}

export interface CrossEntropyOptions {
  /** Number of binary decisions. */
  dimension: number;
  /** Lower is better. */
  objective(x: number[]): number;
  iterations: number;
  sampleSize: number;
  /** Fraction of each sample kept as the elite set. */
  eliteFraction?: number;
  /** Smoothing on the probability update, in (0,1]. 1 means no smoothing. */
  smoothing?: number;
  seed: Seed;
  /** Probabilities are clipped away from 0 and 1 by this much, to keep exploring. */
  floor?: number;
}

export interface CrossEntropyResult extends HeuristicResult<number[]> {
  /** Final sampling probabilities. Degenerate (all near 0 or 1) means the method has committed. */
  probabilities: number[];
  /** Mean elite objective per iteration. */
  eliteHistory: number[];
}

/**
 * The cross-entropy method for binary combinatorial problems.
 *
 * Sample from independent Bernoullis, keep the best fraction, and move the
 * Bernoulli parameters towards the elite frequencies. The independence of the
 * coordinates is the method's whole speed and its whole weakness: it cannot
 * represent "exactly one of these two", so on problems whose optima need such
 * a correlation it converges to a blend that is not a solution.
 */
export function crossEntropyMethod(options: CrossEntropyOptions): CrossEntropyResult {
  const n = options.dimension;
  if (!Number.isInteger(n) || n < 1) throw new EngineError('The cross-entropy method needs at least 1 binary decision.', 'range');
  if (!Number.isInteger(options.sampleSize) || options.sampleSize < 4) throw new EngineError('Each cross-entropy iteration needs a sample of at least 4.', 'range');
  if (!Number.isInteger(options.iterations) || options.iterations < 1) throw new EngineError('The cross-entropy method needs at least 1 iteration.', 'range');
  const eliteFraction = options.eliteFraction ?? 0.1;
  if (!(eliteFraction > 0 && eliteFraction <= 0.5)) throw new EngineError(`The elite fraction is ${String(eliteFraction)}; it must lie in (0, 0.5].`, 'range');
  const smoothing = options.smoothing ?? 0.7;
  if (!(smoothing > 0 && smoothing <= 1)) throw new EngineError(`The smoothing parameter is ${String(smoothing)}; it must lie in (0, 1].`, 'range');
  const floor = options.floor ?? 0.01;
  if (!(floor >= 0 && floor < 0.5)) throw new EngineError(`The probability floor is ${String(floor)}; it must lie in [0, 0.5).`, 'range');
  const eliteCount = Math.max(1, Math.round(eliteFraction * options.sampleSize));
  const rng = new Random(options.seed);
  let p = new Array<number>(n).fill(0.5);
  let best: number[] = new Array<number>(n).fill(0);
  let bestEnergy = Infinity;
  let evaluations = 0;
  const history: number[] = [];
  const eliteHistory: number[] = [];
  for (let it = 0; it < options.iterations; it++) {
    const samples: { x: number[]; value: number }[] = [];
    for (let s = 0; s < options.sampleSize; s++) {
      const x = p.map((pi) => (rng.bernoulli(pi) ? 1 : 0));
      const value = options.objective(x);
      evaluations++;
      if (!Number.isFinite(value)) continue; // infeasible draws are discarded
      samples.push({ x, value });
      if (value < bestEnergy) {
        bestEnergy = value;
        best = x;
      }
    }
    if (samples.length === 0) {
      throw new EngineError(
        `Every one of the ${options.sampleSize} draws at cross-entropy iteration ${it + 1} was infeasible, so there is no elite set and the sampling distribution cannot be updated. Supply a penalty-based objective that returns a finite value for infeasible points instead of an infinite one.`,
        'degenerate',
      );
    }
    samples.sort((a, b) => a.value - b.value);
    const elite = samples.slice(0, Math.min(eliteCount, samples.length));
    eliteHistory.push(stableSum(elite.map((e) => e.value)) / elite.length);
    const freq = new Array<number>(n).fill(0);
    for (const e of elite) for (let j = 0; j < n; j++) freq[j] += e.x[j] / elite.length;
    p = p.map((pi, j) => Math.min(1 - floor, Math.max(floor, smoothing * freq[j] + (1 - smoothing) * pi)));
    history.push(bestEnergy);
  }
  const degenerate = p.every((pi) => pi <= floor + 1e-12 || pi >= 1 - floor - 1e-12);
  return {
    best,
    bestEnergy,
    finalEnergy: bestEnergy,
    evaluations,
    accepted: evaluations,
    history,
    probabilities: p,
    eliteHistory,
    guarantee: {
      globalOptimumGuaranteed: false,
      statement: `No global guarantee. The cross-entropy method converges to a degenerate sampling distribution, but not necessarily one concentrated on a global optimum; the smoothing parameter ${smoothing} trades the speed of that collapse against the chance of collapsing onto the wrong point. The returned solution is the best of ${evaluations} evaluations.`,
    },
    provenance: {
      exactness: 'empirical',
      method: `Cross-entropy method over independent Bernoullis: ${options.iterations} iterations × ${options.sampleSize} samples, elite fraction ${eliteFraction}, smoothing ${smoothing}, probability floor ${floor}`,
      assumedInputs: ['The objective is evaluated exactly on each sampled point; a noisy objective needs averaging within each evaluation or the elite set is selected on noise.'],
      limitations: [
        'The sampling distribution treats the coordinates as independent, so a constraint linking two decisions cannot be represented and must be handled by the objective as a penalty.',
        degenerate
          ? 'The final sampling distribution is degenerate, so further iterations would change nothing: the method has committed, which is not the same as being right.'
          : 'The final sampling distribution is NOT degenerate, so the method had not finished converging when the iteration budget ran out; more iterations may still improve the answer.',
      ],
    },
  };
}

/**
 * Exhaustive enumeration for small binary problems, so a heuristic can be
 * scored against the truth rather than against another heuristic. Refuses
 * anything large enough for the enumeration to be the slow part.
 */
export function bruteForceBinary(dimension: number, objective: (x: number[]) => number, maxDimension = 22): { best: number[]; bestValue: number; evaluated: number } {
  if (!Number.isInteger(dimension) || dimension < 1) throw new EngineError('Brute force needs at least 1 binary decision.', 'range');
  if (dimension > maxDimension) {
    throw new EngineError(
      `Exhaustive enumeration of ${dimension} binary decisions means ${2 ** dimension} evaluations, above the limit of 2^${maxDimension}. There is no answer to report rather than a slow one: raise maxDimension deliberately if that is what is wanted.`,
      'range',
    );
  }
  const total = 2 ** dimension;
  let best: number[] = [];
  let bestValue = Infinity;
  let evaluated = 0;
  for (let mask = 0; mask < total; mask++) {
    const x = Array.from({ length: dimension }, (_, j) => (mask >> j) & 1);
    const v = objective(x);
    evaluated++;
    if (Number.isFinite(v) && v < bestValue) {
      bestValue = v;
      best = x;
    }
  }
  if (best.length === 0) throw new EngineError('No feasible point exists among all 2^n binary vectors; the problem as stated has no solution.', 'infeasible');
  return { best, bestValue, evaluated };
}
