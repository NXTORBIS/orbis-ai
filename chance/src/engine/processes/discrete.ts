/**
 * Discrete-time processes: random walks (with the exact gambler's-ruin
 * results), AR(1), and the Galton–Watson branching process.
 */
import { EngineError, Validator } from '../core/result';
import { stableSum } from '../core/numeric';
import type { Random } from '../random/rng';
import { quantity, type NormalLaw, type ProcessDefinition, type Quantity, type RunHooks } from './types';
import { ensembleSteps } from './ensemble';
import { wilsonInterval } from '../stats/descriptive';
import { defined, undefinedMoment, type Moment } from '../distributions/types';

/* ------------------------------------------------------------------ *
 * Random walk and gambler's ruin
 * ------------------------------------------------------------------ */

export const randomWalkDefinition: ProcessDefinition = {
  id: 'random-walk',
  name: 'Random walk',
  category: 'discrete-time',
  description:
    'A position that moves up by one with probability p and down by one with probability 1−p at every step. The simple symmetric case p = 1/2 has no drift; p ≠ 1/2 drifts at rate 2p−1 per step.',
  formula: 'X_n = X_0 + Σ_{i=1}^{n} ξ_i,  ξ_i = +1 with probability p, −1 with probability q = 1−p',
  stateSpaceText: 'X_n ∈ ℤ (shifted by the start), n = 0, 1, 2, …',
  params: [
    { key: 'p', label: 'Up probability', symbol: 'p', description: 'Probability of a +1 step.', defaultValue: 0.5, min: 0, max: 1 },
    { key: 'start', label: 'Start position', symbol: 'k', description: 'Position at step 0.', defaultValue: 0, integer: true },
  ],
  assumptions: [
    'Steps are independent and identically distributed — the walk has no memory of its path.',
    'p is constant over time and does not depend on the current position.',
    'Steps are of fixed size 1 (scale the output for other step sizes).',
  ],
  limitations: [
    'A symmetric walk is recurrent but its expected time to return grows without bound; "it always comes back" does not mean "it comes back soon".',
    'The exact ruin results below assume the two barriers 0 and N are the only ones, and that the walk stops on reaching either.',
    'For p = 1/2 the expected number of steps to absorption is k(N−k), which is large: a fair game between players of similar means takes a very long time to end.',
  ],
  exactResults: [
    'E[X_n] = k + n(2p−1), Var[X_n] = 4npq',
    "Gambler's ruin, probability of reaching N before 0 from k: ((q/p)^k − 1)/((q/p)^N − 1) for p ≠ 1/2, k/N for p = 1/2",
    'Expected duration until absorption: k(N−k) for p = 1/2, otherwise k/(q−p) − (N/(q−p))·(1−(q/p)^k)/(1−(q/p)^N)',
  ],
};

export interface RandomWalkParams {
  p: number;
  start: number;
}

function validateWalk(p: RandomWalkParams): void {
  const v = new Validator();
  v.probability(p.p, 'p', 'Up probability p');
  v.finite(p.start, 'start', 'Start position');
  v.throwIfInvalid();
}

/** Exact mean and variance of X_n. */
export function randomWalkMoments(params: RandomWalkParams, n: number): { mean: Quantity; variance: Quantity } {
  validateWalk(params);
  const v = new Validator();
  v.integer(n, 'n', 'Number of steps', 0);
  v.throwIfInvalid();
  const q = 1 - params.p;
  return {
    mean: quantity('E[X_n]', params.start + n * (params.p - q), 'exact', { formula: 'k + n(2p−1)' }),
    variance: quantity('Var[X_n]', 4 * n * params.p * q, 'exact', { formula: '4npq' }),
  };
}

export interface GamblersRuin {
  /** Probability of reaching N (the target) before 0. */
  winProbability: Quantity;
  /** Probability of reaching 0 (ruin) before N; the complement. */
  ruinProbability: Quantity;
  /** Expected number of steps until one of the two barriers is hit. */
  expectedDuration: Quantity;
  notes: string[];
}

/**
 * Exact gambler's-ruin results for a walk started at k with absorbing
 * barriers 0 and N.
 *
 * Probability of reaching N before 0:
 *     p ≠ 1/2:  ((q/p)^k − 1)/((q/p)^N − 1)
 *     p = 1/2:  k/N
 * Expected duration until absorption:
 *     p = 1/2:  k(N − k)
 *     p ≠ 1/2:  k/(q−p) − (N/(q−p))·(1 − (q/p)^k)/(1 − (q/p)^N)
 *
 * Both are classical (Feller, vol. I, ch. XIV). The ratio formula is written
 * with r = q/p; for p very small r^N overflows, so the win probability is
 * evaluated in logs in that regime.
 */
export function gamblersRuin(p: number, k: number, N: number): GamblersRuin {
  const v = new Validator();
  v.probability(p, 'p', 'Up probability p');
  v.integer(N, 'N', 'Target wealth N', 2);
  v.integer(k, 'k', 'Starting wealth k', 0);
  if (v.valid && k > N) v.add(`The starting wealth k = ${k} cannot exceed the target N = ${N}.`, 'k', 'range');
  v.throwIfInvalid();
  if (p === 0 || p === 1) {
    throw new EngineError(
      `With p = ${p} the walk is deterministic, so the ruin problem has no randomness: the gambler ${p === 1 ? 'always reaches the target' : 'is always ruined'}. Use 0 < p < 1.`,
      'degenerate',
    );
  }
  if (k === 0 || k === N) {
    const won = k === N;
    return {
      winProbability: quantity('P(reach N before 0)', won ? 1 : 0, 'exact', { formula: 'the walk starts on a barrier' }),
      ruinProbability: quantity('P(ruin)', won ? 0 : 1, 'exact', { formula: 'the walk starts on a barrier' }),
      expectedDuration: quantity('E[steps to absorption]', 0, 'exact', { formula: 'already absorbed' }),
      notes: ['The walk starts on an absorbing barrier, so it is already finished.'],
    };
  }
  const q = 1 - p;
  const fair = p === 0.5;
  let win: number;
  if (fair) {
    win = k / N;
  } else {
    const logR = Math.log(q) - Math.log(p);
    // (r^k − 1)/(r^N − 1), evaluated so that huge r^N cannot overflow.
    if (logR * N > 700) win = Math.exp(logR * (k - N)); // r^k/r^N to leading order
    else {
      const rk = Math.exp(logR * k);
      const rN = Math.exp(logR * N);
      win = (rk - 1) / (rN - 1);
    }
  }
  let duration: number;
  if (fair) {
    duration = k * (N - k);
  } else {
    const r = q / p;
    const denom = q - p;
    const rk = Math.pow(r, k);
    const rN = Math.pow(r, N);
    duration =
      Number.isFinite(rN) && rN !== 1
        ? k / denom - (N / denom) * ((1 - rk) / (1 - rN))
        : k / denom - (N / denom) * (rk / rN);
  }
  if (!Number.isFinite(win) || win < -1e-12 || win > 1 + 1e-12 || !Number.isFinite(duration) || duration < 0) {
    throw new EngineError(
      `The gambler's-ruin formulas lost accuracy for p=${p}, k=${k}, N=${N} (win probability ${win}, duration ${duration}). No number is reported rather than a wrong one; reduce N or move p away from 0/1.`,
      'numerical',
    );
  }
  const winClamped = Math.min(1, Math.max(0, win));
  return {
    winProbability: quantity('P(reach N before 0)', winClamped, 'exact', {
      formula: fair ? 'k/N' : '((q/p)^k − 1)/((q/p)^N − 1)',
    }),
    ruinProbability: quantity('P(reach 0 before N)', 1 - winClamped, 'exact', {
      formula: fair ? '1 − k/N' : '1 − ((q/p)^k − 1)/((q/p)^N − 1)',
    }),
    expectedDuration: quantity('E[steps to absorption]', duration, 'exact', {
      formula: fair ? 'k(N − k)' : 'k/(q−p) − (N/(q−p))·(1−(q/p)^k)/(1−(q/p)^N)',
      note: 'Steps until either barrier is reached, not steps until ruin. Absorption is certain, so this expectation is finite.',
    }),
    notes: [
      'Both barriers are absorbing and there is no other stopping rule; a time limit or a bet-size change invalidates these formulas.',
      fair
        ? 'A fair game ends in ruin with probability 1 − k/N, and the expected number of steps is k(N−k) — long games are the norm.'
        : 'Even a small edge compounds: the win probability is exponential in the starting wealth.',
    ],
  };
}

export type WalkOutcome = 'reachedTarget' | 'ruined' | 'unresolved';

export interface RuinSimulationResult {
  pathsUsed: number;
  partial: boolean;
  reachedTarget: number;
  ruined: number;
  unresolved: number;
  winFrequency: number;
  winInterval: { low: number; high: number; level: number };
  /** Mean duration over resolved paths only. */
  meanDuration: number | null;
  exactness: 'empirical';
  warnings: string[];
}

/**
 * Simulate the ruin problem, yielding between chunks of walks.
 *
 * `maxSteps` caps each walk. Walks that hit the cap are reported separately as
 * `unresolved` and excluded from the duration mean; they are never silently
 * counted as either outcome.
 */
export function* gamblersRuinSimulationSteps(
  p: number,
  k: number,
  N: number,
  walks: number,
  seed: string,
  maxSteps = 2_000_000,
  hooks: RunHooks = {},
  chunkSize = 500,
): Generator<number, RuinSimulationResult, void> {
  const v = new Validator();
  v.probability(p, 'p', 'Up probability p');
  v.integer(N, 'N', 'Target wealth N', 2);
  v.integer(k, 'k', 'Starting wealth k', 1);
  v.integer(walks, 'walks', 'Number of walks', 1);
  v.integer(maxSteps, 'maxSteps', 'Step cap', 1);
  if (v.valid && k >= N) v.add(`The starting wealth k = ${k} must be below the target N = ${N}.`, 'k', 'range');
  v.throwIfInvalid();

  // Each walk records (outcome, duration); the grid is a formality here, so
  // the shared ensemble generator is used with a two-value "path".
  const ensemble = yield* ensembleSteps(
    (rng) => {
      let x = k;
      let steps = 0;
      while (x > 0 && x < N && steps < maxSteps) {
        x += rng.uniform() < p ? 1 : -1;
        steps++;
      }
      const outcome = x >= N ? 1 : x <= 0 ? -1 : 0;
      return [outcome, steps];
    },
    [0, 1],
    walks,
    seed,
    hooks,
    chunkSize,
  );
  let reached = 0;
  let ruined = 0;
  let unresolved = 0;
  const durations: number[] = [];
  for (const path of ensemble.paths) {
    if (path[0] === 1) reached++;
    else if (path[0] === -1) ruined++;
    else unresolved++;
    if (path[0] !== 0) durations.push(path[1]);
  }
  const resolved = reached + ruined;
  const interval = wilsonInterval(reached, resolved > 0 ? resolved : 1);
  const warnings: string[] = [];
  if (unresolved > 0) {
    warnings.push(
      `${unresolved.toLocaleString('en-US')} of ${ensemble.pathsCompleted.toLocaleString('en-US')} walks hit the ${maxSteps.toLocaleString('en-US')}-step cap without being absorbed. They are excluded from the frequencies and the duration mean, which are therefore conditional on absorption within the cap. Raise the cap to remove the bias.`,
    );
  }
  if (ensemble.partial) {
    warnings.push(`Partial run: ${ensemble.pathsCompleted.toLocaleString('en-US')} of ${walks.toLocaleString('en-US')} walks completed.`);
  }
  if (resolved === 0) {
    throw new EngineError('No simulated walk reached either barrier within the step cap, so no frequency can be reported. Raise the step cap.', 'insufficient');
  }
  return {
    pathsUsed: ensemble.pathsCompleted,
    partial: ensemble.partial,
    reachedTarget: reached,
    ruined,
    unresolved,
    winFrequency: reached / resolved,
    winInterval: { low: interval.low, high: interval.high, level: 0.95 },
    meanDuration: durations.length ? stableSum(durations) / durations.length : null,
    exactness: 'empirical',
    warnings,
  };
}

/** One random-walk path on an integer step grid (times must be integers). */
export function sampleRandomWalkPath(rng: Random, params: RandomWalkParams, times: number[]): number[] {
  validateWalk(params);
  const out = new Array<number>(times.length);
  let x = params.start;
  let prev = 0;
  for (let j = 0; j < times.length; j++) {
    const n = times[j];
    if (!Number.isInteger(n) || n < 0) {
      throw new EngineError(`A random walk is only defined at whole step counts; the grid contains ${n}.`, 'integer');
    }
    for (let i = prev; i < n; i++) x += rng.uniform() < params.p ? 1 : -1;
    out[j] = x;
    prev = n;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * AR(1)
 * ------------------------------------------------------------------ */

export const ar1Definition: ProcessDefinition = {
  id: 'ar1',
  name: 'AR(1) autoregression',
  category: 'discrete-time',
  description:
    'A discrete-time series where each value is a fraction φ of the previous one plus fresh noise. The discrete-time counterpart of the Ornstein–Uhlenbeck process.',
  formula: 'X_{t+1} = c + φ·X_t + ε_{t+1},  ε ~ Normal(0, σ²) i.i.d.',
  stateSpaceText: 'X_t ∈ ℝ, t = 0, 1, 2, …',
  params: [
    { key: 'phi', label: 'Persistence', symbol: 'φ', description: 'Carry-over from one period to the next. Must satisfy |φ| < 1 for a stationary process.', defaultValue: 0.7, min: -1, max: 1, minExclusive: true, maxExclusive: true },
    { key: 'intercept', label: 'Intercept', symbol: 'c', description: 'Constant term; the long-run mean is c/(1−φ).', defaultValue: 0 },
    { key: 'noiseSd', label: 'Shock SD', symbol: 'σ', description: 'Standard deviation of the per-period shock (not of the series, which is σ/√(1−φ²)).', defaultValue: 1, min: 0, minExclusive: true },
    { key: 'x0', label: 'Start value', symbol: 'x₀', description: 'Value at t = 0.', defaultValue: 0 },
  ],
  assumptions: [
    'Shocks are independent, mean zero and of constant variance.',
    '|φ| < 1, so shocks decay and the series has a stationary distribution.',
    'The relationship is linear and φ, c, σ do not change over time.',
  ],
  limitations: [
    'Only one lag of memory. A series with cycles or seasonality needs more lags.',
    'Estimates of φ from short samples are biased towards zero, and near-unit-root series are very hard to distinguish from a random walk.',
    'With |φ| ≥ 1 there is no stationary distribution at all: the variance grows without bound and this module refuses to report one.',
  ],
  exactResults: [
    'Stationary mean c/(1−φ)',
    'Stationary variance σ²/(1−φ²)',
    'Autocorrelation ρ(k) = φ^k',
    'Conditional law: X_{t+k} | X_t = x ~ Normal(c(1−φ^k)/(1−φ) + φ^k x, σ²(1−φ^{2k})/(1−φ²))',
  ],
};

export interface Ar1Params {
  phi: number;
  intercept: number;
  noiseSd: number;
  x0: number;
}

function validateAr1(p: Ar1Params, requireStationary: boolean): void {
  const v = new Validator();
  v.finite(p.phi, 'phi', 'Persistence φ');
  v.finite(p.intercept, 'intercept', 'Intercept c');
  v.positive(p.noiseSd, 'noiseSd', 'Shock SD σ');
  v.finite(p.x0, 'x0', 'Start value x₀');
  v.throwIfInvalid();
  if (requireStationary && Math.abs(p.phi) >= 1) {
    throw new EngineError(
      `φ = ${p.phi} has |φ| ≥ 1, so this AR(1) process is not stationary: shocks never decay, the variance grows without bound (it is σ²·t for φ = 1) and no stationary mean, variance or autocorrelation exists. The formula σ²/(1−φ²) would return a negative or infinite value, so nothing is reported. Use |φ| < 1, or model the series as a random walk (φ = 1) in differences.`,
      'nonstationary',
    );
  }
}

export interface Ar1Stationary {
  mean: Quantity;
  variance: Quantity;
  sd: Quantity;
  autocorrelation(k: number): Quantity;
  halfLife: Moment;
}

/** Exact stationary law. Refuses when |φ| ≥ 1. */
export function ar1Stationary(p: Ar1Params): Ar1Stationary {
  validateAr1(p, true);
  const variance = (p.noiseSd * p.noiseSd) / (1 - p.phi * p.phi);
  return {
    mean: quantity('E[X]', p.intercept / (1 - p.phi), 'exact', { formula: 'c/(1−φ)' }),
    variance: quantity('Var[X]', variance, 'exact', {
      formula: 'σ²/(1−φ²)',
      note: 'Larger than the shock variance σ² whenever φ ≠ 0, because shocks accumulate.',
    }),
    sd: quantity('SD[X]', Math.sqrt(variance), 'exact', { formula: 'σ/√(1−φ²)' }),
    autocorrelation: (k: number) => {
      const v = new Validator();
      v.integer(k, 'k', 'Lag k', 0);
      v.throwIfInvalid();
      return quantity(`ρ(${k})`, Math.pow(p.phi, k), 'exact', { formula: 'φ^k' });
    },
    halfLife:
      p.phi > 0
        ? defined(Math.log(0.5) / Math.log(p.phi))
        : undefinedMoment('With φ ≤ 0 a deviation alternates sign rather than decaying monotonically, so a half-life is not meaningful. Use |φ|^k to measure decay of magnitude.'),
  };
}

/** Exact k-step-ahead conditional law from a known current value. */
export function ar1Conditional(p: Ar1Params, x: number, k: number): NormalLaw {
  validateAr1(p, true);
  const v = new Validator();
  v.finite(x, 'x', 'Current value');
  v.integer(k, 'k', 'Horizon k', 0);
  v.throwIfInvalid();
  const phik = Math.pow(p.phi, k);
  const variance = ((p.noiseSd * p.noiseSd) * (1 - phik * phik)) / (1 - p.phi * p.phi);
  return {
    mean: (p.intercept * (1 - phik)) / (1 - p.phi) + phik * x,
    variance,
    sd: Math.sqrt(variance),
    exactness: 'exact',
    formula: 'Normal(c(1−φ^k)/(1−φ) + φ^k x, σ²(1−φ^{2k})/(1−φ²))',
  };
}

/**
 * Simulate an AR(1) path at integer times. `startFromStationary` draws X₀ from
 * the stationary law instead of using x₀, which removes the burn-in; it
 * requires |φ| < 1.
 */
export function sampleAr1Path(
  rng: Random,
  p: Ar1Params,
  times: number[],
  startFromStationary = false,
): number[] {
  validateAr1(p, startFromStationary);
  let x = p.x0;
  if (startFromStationary) {
    const s = ar1Stationary(p);
    x = s.mean.value + s.sd.value * rng.normal();
  }
  const out = new Array<number>(times.length);
  let prev = 0;
  for (let j = 0; j < times.length; j++) {
    const n = times[j];
    if (!Number.isInteger(n) || n < 0) {
      throw new EngineError(`AR(1) is a discrete-time process and is only defined at whole times; the grid contains ${n}.`, 'integer');
    }
    for (let i = prev; i < n; i++) x = p.intercept + p.phi * x + p.noiseSd * rng.normal();
    out[j] = x;
    prev = n;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Galton–Watson branching process
 * ------------------------------------------------------------------ */

export const branchingProcessDefinition: ProcessDefinition = {
  id: 'galton-watson',
  name: 'Galton–Watson branching process',
  category: 'discrete-time',
  description:
    'Each individual in a generation independently produces a random number of offspring. Models epidemic chains, surname survival, nuclear chain reactions and the early growth of anything that reproduces.',
  formula: 'Z_{n+1} = Σ_{i=1}^{Z_n} X_i^{(n)},  X i.i.d. with generating function G(s) = E[s^X]',
  stateSpaceText: 'Z_n ∈ {0, 1, 2, …}; 0 is absorbing (extinction)',
  params: [],
  assumptions: [
    'Every individual reproduces independently with the same offspring distribution.',
    'No immigration, no interaction and no resource limit — the population never saturates.',
    'Generations are discrete and non-overlapping.',
  ],
  limitations: [
    'Because there is no carrying capacity, a supercritical process grows without bound. Use it for the early phase only.',
    'The criticality rule is knife-edge: a mean offspring of 1.01 and 0.99 behave completely differently in the long run, and real data can rarely distinguish them.',
    'Extinction probability is the smallest fixed point of G and is found by iteration here; near criticality the iteration converges very slowly, and this module reports a failure rather than a half-converged number.',
  ],
  exactResults: [
    'E[Z_n] = m^n where m = E[X]',
    'Extinction is certain if and only if m ≤ 1 (excluding the degenerate case X ≡ 1)',
    'For m > 1 the extinction probability is the unique root of G(s) = s in (0, 1)',
  ],
};

export interface ExtinctionResult {
  probability: number;
  mean: number;
  regime: 'subcritical' | 'critical' | 'supercritical';
  iterations: number;
  exactness: 'exact' | 'numerical';
  formula: string;
  note: string;
}

/**
 * Extinction probability as the smallest fixed point of the offspring
 * generating function, found by iterating q ← G(q) from q = 0.
 *
 * The iteration q_{n+1} = G(q_n) from 0 increases monotonically to the
 * smallest fixed point (this is the standard proof), so it cannot overshoot.
 * For m ≤ 1 the answer is exactly 1 by the criticality theorem and is returned
 * as 'exact' without iterating. For m > 1 the limit is reported as 'numerical'
 * and a non-convergent iteration raises an `EngineError` rather than
 * returning the last iterate.
 *
 * `gf` must be the probability generating function G(s) = E[s^X] on [0, 1].
 */
export function extinctionProbability(
  gf: (s: number) => number,
  meanOffspring: number,
  options: { tol?: number; maxIter?: number } = {},
): ExtinctionResult {
  const v = new Validator();
  v.nonNegative(meanOffspring, 'meanOffspring', 'Mean offspring m');
  v.throwIfInvalid();
  const tol = options.tol ?? 1e-13;
  const maxIter = options.maxIter ?? 100_000;
  const g0 = gf(0);
  if (!Number.isFinite(g0) || g0 < 0 || g0 > 1) {
    throw new EngineError(`The offspring generating function returned G(0) = ${g0}. A probability generating function must map [0,1] into [0,1].`, 'domain');
  }
  if (meanOffspring <= 1) {
    if (g0 === 0 && Math.abs(meanOffspring - 1) < 1e-15) {
      // X ≡ 1 almost surely: the population is constant and never dies out.
      const g1 = gf(0.5);
      if (Math.abs(g1 - 0.5) < 1e-12) {
        return {
          probability: 0,
          mean: meanOffspring,
          regime: 'critical',
          iterations: 0,
          exactness: 'exact',
          formula: 'G(s) = s identically: every individual has exactly one offspring',
          note: 'The degenerate case X ≡ 1. The population size never changes, so extinction is impossible — the usual "m ≤ 1 implies certain extinction" statement excludes it.',
        };
      }
    }
    return {
      probability: 1,
      mean: meanOffspring,
      regime: meanOffspring < 1 ? 'subcritical' : 'critical',
      iterations: 0,
      exactness: 'exact',
      formula: 'criticality theorem: extinction is certain iff m ≤ 1 (excluding X ≡ 1)',
      note:
        meanOffspring === 1
          ? 'The critical case: extinction is certain even though the expected population size stays at its initial value forever. The expectation is carried by ever rarer, ever larger survivors.'
          : 'Subcritical: each generation shrinks in expectation and the line dies out with probability 1.',
    };
  }
  let q = 0;
  for (let i = 1; i <= maxIter; i++) {
    const next = gf(q);
    if (!Number.isFinite(next) || next < 0 || next > 1) {
      throw new EngineError(`The offspring generating function returned G(${q}) = ${next}, outside [0, 1]. Check the offspring distribution.`, 'domain');
    }
    if (Math.abs(next - q) < tol) {
      return {
        probability: next,
        mean: meanOffspring,
        regime: 'supercritical',
        iterations: i,
        exactness: 'numerical',
        formula: 'smallest root of G(s) = s in [0, 1), by iterating q ← G(q) from 0',
        note: 'The iteration from 0 increases monotonically to the smallest fixed point, so it cannot overshoot the answer. With probability 1 − q the population grows without bound.',
      };
    }
    q = next;
  }
  throw new EngineError(
    `The extinction-probability iteration did not converge to ${tol} in ${maxIter.toLocaleString('en-US')} steps (last value ${q}). This happens when the mean offspring is extremely close to 1, where the fixed point is nearly tangent to the diagonal. No number is reported rather than a half-converged one; supply a looser tolerance deliberately if an approximate value is acceptable.`,
    'convergence',
  );
}

/** Generating function and mean of an offspring pmf given as p[0..K]. */
export function offspringPmfGeneratingFunction(pmf: number[]): { gf: (s: number) => number; mean: number } {
  const v = new Validator();
  if (pmf.length < 1) v.add('The offspring distribution needs at least one probability.', 'pmf', 'shape');
  for (let k = 0; k < pmf.length; k++) v.probability(pmf[k], 'pmf', `Offspring probability for k = ${k}`);
  const total = v.valid ? stableSum(pmf) : NaN;
  if (v.valid && Math.abs(total - 1) > 1e-9) {
    v.add(`The offspring probabilities sum to ${total.toPrecision(8)}, not 1.`, 'pmf', 'sum');
  }
  v.throwIfInvalid();
  return {
    gf: (s: number) => stableSum(pmf.map((p, k) => p * Math.pow(s, k))),
    mean: stableSum(pmf.map((p, k) => p * k)),
  };
}

/** Poisson(λ) offspring: G(s) = exp(λ(s−1)), mean λ. */
export function poissonOffspring(lambda: number): { gf: (s: number) => number; mean: number } {
  const v = new Validator();
  v.nonNegative(lambda, 'lambda', 'Mean offspring λ');
  v.throwIfInvalid();
  return { gf: (s: number) => Math.exp(lambda * (s - 1)), mean: lambda };
}

export interface BranchingSimulationResult {
  pathsUsed: number;
  partial: boolean;
  extinct: number;
  extinctionFrequency: number;
  extinctionInterval: { low: number; high: number; level: number };
  /** Lines still alive at the generation cap: not yet extinct, not immortal. */
  survivedToCap: number;
  /** Mean generation of extinction, over the lines that died out. */
  meanExtinctionGeneration: number | null;
  exactness: 'empirical';
  warnings: string[];
}

/**
 * Simulate branching lines, yielding between chunks.
 *
 * A line that is still alive at `maxGenerations` is counted as "survived to
 * the cap", not as "never extinct": the observed frequency is a lower bound on
 * the extinction probability and the warning says so.
 */
export function* branchingSimulationSteps(
  sampleOffspring: (rng: Random) => number,
  initialPopulation: number,
  generations: number,
  lines: number,
  seed: string,
  maxPopulation = 1_000_000,
  hooks: RunHooks = {},
  chunkSize = 200,
): Generator<number, BranchingSimulationResult, void> {
  const v = new Validator();
  v.integer(initialPopulation, 'initialPopulation', 'Initial population', 1);
  v.integer(generations, 'generations', 'Generation cap', 1);
  v.integer(lines, 'lines', 'Number of simulated lines', 1);
  v.integer(maxPopulation, 'maxPopulation', 'Population cap', 1);
  v.throwIfInvalid();

  const ensemble = yield* ensembleSteps(
    (rng) => {
      let z = initialPopulation;
      let gen = 0;
      while (z > 0 && gen < generations) {
        let next = 0;
        for (let i = 0; i < z; i++) {
          const kids = sampleOffspring(rng);
          if (!Number.isInteger(kids) || kids < 0) {
            throw new EngineError(`The offspring sampler produced ${kids}. Offspring counts must be whole numbers of 0 or more.`, 'integer');
          }
          next += kids;
          if (next > maxPopulation) break;
        }
        z = Math.min(next, maxPopulation + 1);
        gen++;
        if (z > maxPopulation) break;
      }
      return [z === 0 ? 1 : 0, z === 0 ? gen : -1];
    },
    [0, 1],
    lines,
    seed,
    hooks,
    chunkSize,
  );
  let extinct = 0;
  const genOfExtinction: number[] = [];
  for (const path of ensemble.paths) {
    if (path[0] === 1) {
      extinct++;
      genOfExtinction.push(path[1]);
    }
  }
  const n = ensemble.pathsCompleted;
  const interval = wilsonInterval(extinct, n);
  const warnings: string[] = [
    `Lines still alive after ${generations} generations are counted as not extinct, so the frequency below is a LOWER bound on the extinction probability. A subcritical or critical process can die out much later than the cap.`,
  ];
  if (ensemble.partial) warnings.push(`Partial run: ${n.toLocaleString('en-US')} of ${lines.toLocaleString('en-US')} lines completed.`);
  return {
    pathsUsed: n,
    partial: ensemble.partial,
    extinct,
    extinctionFrequency: extinct / n,
    extinctionInterval: { low: interval.low, high: interval.high, level: 0.95 },
    survivedToCap: n - extinct,
    meanExtinctionGeneration: genOfExtinction.length ? stableSum(genOfExtinction) / genOfExtinction.length : null,
    exactness: 'empirical',
    warnings,
  };
}

/** Exact expected population size E[Z_n] = z₀·m^n. */
export function branchingExpectedSize(initialPopulation: number, meanOffspring: number, n: number): Quantity {
  const v = new Validator();
  v.integer(initialPopulation, 'initialPopulation', 'Initial population', 0);
  v.nonNegative(meanOffspring, 'meanOffspring', 'Mean offspring m');
  v.integer(n, 'n', 'Generation n', 0);
  v.throwIfInvalid();
  return quantity('E[Z_n]', initialPopulation * Math.pow(meanOffspring, n), 'exact', {
    formula: 'z₀·m^n',
    note: 'In the critical case m = 1 this stays at z₀ forever even though extinction is certain: the expectation is kept up by increasingly unlikely large populations.',
  });
}
