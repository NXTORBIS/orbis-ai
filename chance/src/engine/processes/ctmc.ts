/**
 * Continuous-time Markov chains.
 *
 * A CTMC on a finite state space is specified by a generator matrix Q: the
 * off-diagonal entry q_ij ≥ 0 is the rate of jumping from i to j, and each
 * row sums to 0 so that −q_ii is the total rate of leaving i. Holding times
 * are Exponential(−q_ii) and the jump destination is chosen proportionally to
 * the off-diagonal rates.
 *
 * What is computed and how:
 *  - P(t) = exp(Qt) by SCALING AND SQUARING with a truncated Taylor series.
 *    The matrix is scaled by 2^{-s} until its ∞-norm is at most 1/2, the
 *    series is summed until the terms fall below machine precision (which
 *    converges quickly for a small-norm matrix and has no cancellation
 *    problems because the scaled matrix is small), then the result is squared
 *    s times. This is labelled 'numerical'. Uniformisation
 *    (P(t) = Σ e^{−Λt}(Λt)^k/k! · (I + Q/Λ)^k) would also be acceptable and
 *    is more obviously probability-preserving, but needs a truncation rule
 *    that depends on Λt; scaling and squaring was chosen because its error is
 *    governed by one norm bound that holds for every t.
 *  - the stationary distribution from πQ = 0 with Σπ = 1, by Gaussian
 *    elimination → 'numerical' (an exact linear solve up to rounding).
 *  - expected hitting times by solving the linear system → 'numerical'.
 *  - Gillespie / next-reaction simulation → 'empirical'.
 */
import { EngineError, Validator } from '../core/result';
import { identity, matMul, matVec, solve, type Matrix } from '../stats/linalg';
import { stableSum } from '../core/numeric';
import type { Random } from '../random/rng';
import { quantity, type ProcessDefinition, type Quantity, type RunHooks } from './types';
import { ensembleSteps } from './ensemble';

export const ctmcDefinition: ProcessDefinition = {
  id: 'ctmc',
  name: 'Continuous-time Markov chain',
  category: 'markov-jump',
  description:
    'A system that sits in one of finitely many states and jumps between them at constant rates: machine up/down, queue lengths, disease stages, system components.',
  formula: "P(t) = exp(Qt);  P'(t) = QP(t);  πQ = 0 for the stationary distribution",
  stateSpaceText: 'A finite set of states; the chain is right-continuous with exponential holding times',
  params: [],
  assumptions: [
    'Transition rates are constant in time and depend only on the current state (the Markov property).',
    'Holding times are exponential, so the time already spent in a state carries no information about when it will leave.',
    'Every row of Q sums to 0 and every off-diagonal rate is non-negative.',
  ],
  limitations: [
    'Exponential holding times are often wrong: repair times and service times usually have a mode away from zero. A phase-type expansion of the state space can fix this.',
    'The stationary distribution exists and is unique only for an irreducible chain. For a reducible chain the linear system has many solutions and this module says so rather than returning one arbitrarily.',
    'The matrix exponential is a numerical computation. For a stiff generator (rates differing by many orders of magnitude) check the row sums of the result, which this module reports.',
  ],
  exactResults: [
    'Holding time in state i ~ Exponential(−q_ii)',
    'Embedded jump chain: P(i → j) = q_ij/(−q_ii)',
    'Two-state chain: closed form P(t) with the mixing rate α + β',
  ],
};

/**
 * Validate a generator matrix: square, finite, off-diagonals ≥ 0, rows summing
 * to 0. Anything else raises an `EngineError` naming the offending row.
 */
export function validateGenerator(Q: Matrix, tol = 1e-9): void {
  const n = Q.length;
  if (n < 1) throw new EngineError('The generator matrix needs at least one state.', 'shape');
  for (let i = 0; i < n; i++) {
    if (Q[i].length !== n) {
      throw new EngineError(`Row ${i + 1} of the generator has ${Q[i].length} entries; it must have ${n} (one per state).`, 'shape');
    }
    for (let j = 0; j < n; j++) {
      const v = Q[i][j];
      if (!Number.isFinite(v)) {
        throw new EngineError(`Generator entry (${i + 1}, ${j + 1}) is ${v}. All rates must be finite numbers.`, 'finite');
      }
      if (i !== j && v < 0) {
        throw new EngineError(
          `Generator entry (${i + 1}, ${j + 1}) is ${v}. Off-diagonal entries are transition RATES and cannot be negative.`,
          'range',
        );
      }
      if (i === j && v > 0) {
        throw new EngineError(
          `Diagonal entry (${i + 1}, ${i + 1}) is ${v}. The diagonal must be −(sum of the other rates in the row) and therefore cannot be positive.`,
          'range',
        );
      }
    }
    const rowSum = stableSum(Q[i]);
    if (Math.abs(rowSum) > tol) {
      throw new EngineError(
        `Row ${i + 1} of the generator sums to ${rowSum.toPrecision(8)}, not 0. Every row of a generator matrix must sum to 0: the diagonal entry is minus the total rate of leaving that state. Set q_${i + 1}${i + 1} = ${(rowSum - Q[i][i]).toPrecision(8) === '0' ? 0 : (-(rowSum - Q[i][i])).toPrecision(8)}.`,
        'sum',
      );
    }
  }
}

function infNorm(A: Matrix): number {
  let m = 0;
  for (const row of A) {
    let s = 0;
    for (const v of row) s += Math.abs(v);
    if (s > m) m = s;
  }
  return m;
}

function scaleMatrix(A: Matrix, c: number): Matrix {
  return A.map((row) => row.map((v) => v * c));
}

function addMatrix(A: Matrix, B: Matrix): Matrix {
  return A.map((row, i) => row.map((v, j) => v + B[i][j]));
}

/**
 * exp(A) by scaling and squaring with a truncated Taylor series.
 *
 * Scale: choose s so that ‖A/2^s‖_∞ ≤ 1/2. Sum the Taylor series for the
 * scaled matrix until a term contributes less than `tol` relative to the
 * accumulated norm (at most `maxTerms` terms). Square the result s times.
 */
export function matrixExponential(
  A: Matrix,
  options: { tol?: number; maxTerms?: number } = {},
): Matrix {
  const n = A.length;
  for (const row of A) {
    if (row.length !== n) throw new EngineError('The matrix exponential needs a square matrix.', 'shape');
    for (const v of row) {
      if (!Number.isFinite(v)) throw new EngineError(`The matrix contains a non-finite entry (${v}); the exponential is undefined.`, 'finite');
    }
  }
  const tol = options.tol ?? 1e-18;
  const maxTerms = options.maxTerms ?? 60;
  const norm = infNorm(A);
  if (norm === 0) return identity(n);
  const s = Math.max(0, Math.ceil(Math.log2(norm / 0.5)));
  const scaled = scaleMatrix(A, Math.pow(2, -s));
  let result = identity(n);
  let term = identity(n);
  let converged = false;
  for (let k = 1; k <= maxTerms; k++) {
    term = scaleMatrix(matMul(term, scaled), 1 / k);
    result = addMatrix(result, term);
    if (infNorm(term) < tol) {
      converged = true;
      break;
    }
  }
  if (!converged) {
    throw new EngineError(
      `The Taylor series for the matrix exponential did not reach the tolerance in ${maxTerms} terms after scaling. No matrix is returned rather than an inaccurate one.`,
      'convergence',
    );
  }
  for (let i = 0; i < s; i++) result = matMul(result, result);
  return result;
}

export interface TransientResult {
  t: number;
  /** P(t)[i][j] = P(X(t) = j | X(0) = i). */
  matrix: Matrix;
  /** Distribution at time t given an initial distribution, when supplied. */
  distribution?: number[];
  exactness: 'numerical';
  method: string;
  /** Largest |row sum − 1| of P(t): a direct check on the computation. */
  rowSumError: number;
  warnings: string[];
}

/** P(t) = exp(Qt) for a validated generator. */
export function ctmcTransient(Q: Matrix, t: number, initial?: number[]): TransientResult {
  validateGenerator(Q);
  const v = new Validator();
  v.nonNegative(t, 't', 'Time t');
  v.throwIfInvalid();
  const P = matrixExponential(scaleMatrix(Q, t));
  let rowSumError = 0;
  let negative = 0;
  for (const row of P) {
    rowSumError = Math.max(rowSumError, Math.abs(stableSum(row) - 1));
    for (const x of row) if (x < -1e-10) negative++;
  }
  if (rowSumError > 1e-8) {
    throw new EngineError(
      `The computed P(${t}) has rows summing to within ${rowSumError.toExponential(3)} of 1, which is too far for a transition matrix. The generator is probably stiff (very different rates). No distribution is reported.`,
      'numerical',
    );
  }
  const warnings: string[] = [];
  if (negative > 0) {
    warnings.push(`${negative} entries of P(t) are slightly negative (at the level of rounding error) and should be read as 0.`);
  }
  const result: TransientResult = {
    t,
    matrix: P,
    exactness: 'numerical',
    method: 'exp(Qt) by scaling and squaring with a truncated Taylor series',
    rowSumError,
    warnings,
  };
  if (initial) {
    const iv = new Validator();
    if (initial.length !== Q.length) {
      iv.add(`The initial distribution has ${initial.length} entries but the chain has ${Q.length} states.`, 'initial', 'shape');
    } else {
      for (const p of initial) iv.probability(p, 'initial', 'Initial probability');
      const sum = stableSum(initial);
      if (Math.abs(sum - 1) > 1e-9) iv.add(`The initial distribution sums to ${sum.toPrecision(8)}, not 1.`, 'initial', 'sum');
    }
    iv.throwIfInvalid();
    result.distribution = matVec(transpose(P), initial);
  }
  return result;
}

function transpose(A: Matrix): Matrix {
  return A[0].map((_, j) => A.map((row) => row[j]));
}

export interface StationaryResult {
  distribution: number[];
  /** max_j |(πQ)_j|, the residual of the defining equation. */
  residual: number;
  exactness: 'numerical';
  formula: string;
  warnings: string[];
}

/**
 * Stationary distribution from πQ = 0, Σπ = 1.
 *
 * The system QᵗπᵗT = 0 is singular by construction, so the last equation is
 * replaced by the normalisation Σπ = 1. A singular system after that
 * replacement means the chain is reducible and the stationary distribution is
 * not unique; that is reported as an error, not resolved arbitrarily.
 */
export function ctmcStationary(Q: Matrix): StationaryResult {
  validateGenerator(Q);
  const n = Q.length;
  if (n === 1) {
    return { distribution: [1], residual: 0, exactness: 'numerical', formula: 'a single state', warnings: [] };
  }
  const A: Matrix = [];
  for (let j = 0; j < n - 1; j++) {
    A.push(Array.from({ length: n }, (_, i) => Q[i][j]));
  }
  A.push(new Array<number>(n).fill(1));
  const b = new Array<number>(n).fill(0);
  b[n - 1] = 1;
  const pi = solve(A, b);
  if (!pi) {
    throw new EngineError(
      'The equations πQ = 0 with Σπ = 1 are singular, which means the chain is reducible: it has more than one closed communicating class, so there is no unique stationary distribution. Analyse each closed class separately instead.',
      'singular',
    );
  }
  const negative = pi.filter((p) => p < -1e-9).length;
  if (negative > 0) {
    throw new EngineError(
      `The solution of πQ = 0 has ${negative} negative component(s), so it is not a probability distribution. This happens for a generator that is not a valid single irreducible chain. No distribution is reported.`,
      'numerical',
    );
  }
  const clamped = pi.map((p) => Math.max(0, p));
  const total = stableSum(clamped);
  const normalised = clamped.map((p) => p / total);
  let residual = 0;
  for (let j = 0; j < n; j++) {
    residual = Math.max(residual, Math.abs(stableSum(normalised.map((p, i) => p * Q[i][j]))));
  }
  const warnings: string[] = [];
  if (residual > 1e-9) {
    warnings.push(`The residual of πQ = 0 is ${residual.toExponential(3)}, larger than expected from rounding alone. The generator may be stiff.`);
  }
  return {
    distribution: normalised,
    residual,
    exactness: 'numerical',
    formula: 'πQ = 0 with Σπ = 1, by Gaussian elimination with partial pivoting',
    warnings,
  };
}

export interface HittingTimeResult {
  /** Expected time to reach the target set from each state; 0 for targets. */
  expected: number[];
  targets: number[];
  exactness: 'numerical';
  formula: string;
  notes: string[];
}

/**
 * Expected hitting times of a target set, by solving
 *     Σ_{j ∉ A} q_ij h_j = −1   for i ∉ A,   h_j = 0 for j ∈ A.
 *
 * A singular system means some non-target state cannot reach the target at
 * all, so its expected hitting time is infinite. That is reported as an error
 * naming the situation rather than as a large finite number.
 */
export function ctmcHittingTimes(Q: Matrix, targets: number[]): HittingTimeResult {
  validateGenerator(Q);
  const n = Q.length;
  const v = new Validator();
  if (targets.length === 0) v.add('At least one target state is required.', 'targets', 'required');
  for (const t of targets) v.integer(t, 'targets', 'Target state index', 0, n - 1);
  v.throwIfInvalid();
  const isTarget = new Array<boolean>(n).fill(false);
  for (const t of targets) isTarget[t] = true;
  const rest: number[] = [];
  for (let i = 0; i < n; i++) if (!isTarget[i]) rest.push(i);
  if (rest.length === 0) {
    return {
      expected: new Array<number>(n).fill(0),
      targets: [...targets],
      exactness: 'numerical',
      formula: 'every state is a target',
      notes: ['Every state is in the target set, so the hitting time is 0 everywhere.'],
    };
  }
  const A: Matrix = rest.map((i) => rest.map((j) => Q[i][j]));
  const b = rest.map(() => -1);
  const h = solve(A, b);
  if (!h) {
    throw new EngineError(
      'The hitting-time system is singular: at least one state cannot reach the target set, so its expected hitting time is infinite. No finite number is reported. Check that the target set is reachable from every other state.',
      'singular',
    );
  }
  const bad = h.findIndex((x) => !Number.isFinite(x) || x < -1e-9);
  if (bad >= 0) {
    throw new EngineError(
      `The expected hitting time from state ${rest[bad] + 1} came out as ${h[bad]}, which is not a valid time. The target set is probably unreachable from it.`,
      'numerical',
    );
  }
  const expected = new Array<number>(n).fill(0);
  rest.forEach((i, idx) => {
    expected[i] = Math.max(0, h[idx]);
  });
  return {
    expected,
    targets: [...targets],
    exactness: 'numerical',
    formula: 'Σ_{j ∉ A} q_ij h_j = −1 for i ∉ A, h = 0 on A',
    notes: [
      'These are expected times, not typical times: for a chain with a rare escape route the distribution of the hitting time is close to exponential and the mean is far above the median.',
      'The expected hitting time of a set is not the same as the expected hitting time of each member.',
    ],
  };
}

/** Exact closed-form P(t) for the two-state chain with rates α (0→1), β (1→0). */
export function twoStateTransition(alpha: number, beta: number, t: number): { matrix: Matrix; exactness: 'exact'; formula: string } {
  const v = new Validator();
  v.nonNegative(alpha, 'alpha', 'Rate 0→1');
  v.nonNegative(beta, 'beta', 'Rate 1→0');
  v.nonNegative(t, 't', 'Time t');
  if (v.valid && alpha + beta === 0) {
    v.add('Both rates are 0, so the chain never moves and there is nothing to compute.', 'alpha', 'degenerate');
  }
  v.throwIfInvalid();
  const s = alpha + beta;
  const e = Math.exp(-s * t);
  return {
    matrix: [
      [(beta + alpha * e) / s, (alpha * (1 - e)) / s],
      [(beta * (1 - e)) / s, (alpha + beta * e) / s],
    ],
    exactness: 'exact',
    formula: 'P(t) = [[β+αe^{−(α+β)t}, α(1−e^{−(α+β)t})], [β(1−e^{−(α+β)t}), α+βe^{−(α+β)t}]]/(α+β)',
  };
}

/* ------------------------------------------------------------------ *
 * Gillespie simulation
 * ------------------------------------------------------------------ */

export interface CtmcJump {
  time: number;
  state: number;
}

/**
 * One trajectory by the Gillespie direct method: draw an Exponential(−q_ii)
 * holding time, then pick the destination with probability q_ij/(−q_ii).
 *
 * An absorbing state (total rate 0) ends the trajectory; it is not treated as
 * an error.
 */
export function sampleCtmcTrajectory(rng: Random, Q: Matrix, initialState: number, horizon: number): CtmcJump[] {
  validateGenerator(Q);
  const n = Q.length;
  const v = new Validator();
  v.integer(initialState, 'initialState', 'Initial state index', 0, n - 1);
  v.nonNegative(horizon, 'horizon', 'Horizon');
  v.throwIfInvalid();
  const jumps: CtmcJump[] = [{ time: 0, state: initialState }];
  let state = initialState;
  let t = 0;
  for (;;) {
    const rate = -Q[state][state];
    if (rate <= 0) return jumps; // absorbing
    t += rng.exponential(rate);
    if (t > horizon) return jumps;
    // Destination proportional to the off-diagonal rates.
    let u = rng.uniform() * rate;
    let next = -1;
    for (let j = 0; j < n; j++) {
      if (j === state) continue;
      u -= Q[state][j];
      if (u <= 0) {
        next = j;
        break;
      }
    }
    if (next < 0) {
      // Rounding only; take the largest remaining rate.
      let best = -1;
      let bestRate = -1;
      for (let j = 0; j < n; j++) if (j !== state && Q[state][j] > bestRate) { bestRate = Q[state][j]; best = j; }
      if (best < 0) throw new EngineError(`State ${state + 1} has a positive total rate but no positive transition rate, which is contradictory.`, 'inconsistent');
      next = best;
    }
    state = next;
    jumps.push({ time: t, state });
  }
}

/** The state at each grid time, from a jump list. */
export function ctmcStateOnGrid(jumps: CtmcJump[], times: number[]): number[] {
  const out = new Array<number>(times.length);
  let idx = 0;
  for (let j = 0; j < times.length; j++) {
    while (idx + 1 < jumps.length && jumps[idx + 1].time <= times[j]) idx++;
    out[j] = jumps[idx].state;
  }
  return out;
}

/** Time spent in each state along one trajectory, up to the horizon. */
export function occupancyTimes(jumps: CtmcJump[], states: number, horizon: number): number[] {
  const out = new Array<number>(states).fill(0);
  for (let i = 0; i < jumps.length; i++) {
    const start = jumps[i].time;
    const end = i + 1 < jumps.length ? jumps[i + 1].time : horizon;
    if (end > start) out[jumps[i].state] += Math.min(end, horizon) - start;
  }
  return out;
}

export interface GillespieResult {
  /** Fraction of time spent in each state, pooled over all trajectories. */
  occupancy: number[];
  stationaryComparison?: { distribution: number[]; maxAbsoluteDifference: number };
  pathsUsed: number;
  partial: boolean;
  horizon: number;
  exactness: 'empirical';
  warnings: string[];
}

/**
 * Long-run occupancy by Gillespie simulation, yielding between chunks of
 * trajectories so a worker can be cancelled mid-run.
 */
export function* ctmcGillespieSteps(
  Q: Matrix,
  initialState: number,
  horizon: number,
  trajectories: number,
  seed: string,
  hooks: RunHooks = {},
  chunkSize = 50,
): Generator<number, GillespieResult, void> {
  validateGenerator(Q);
  const n = Q.length;
  const v = new Validator();
  v.integer(initialState, 'initialState', 'Initial state index', 0, n - 1);
  v.positive(horizon, 'horizon', 'Horizon');
  v.integer(trajectories, 'trajectories', 'Number of trajectories', 1);
  v.throwIfInvalid();

  const ensemble = yield* ensembleSteps(
    (rng) => occupancyTimes(sampleCtmcTrajectory(rng, Q, initialState, horizon), n, horizon),
    Array.from({ length: n }, (_, i) => i),
    trajectories,
    seed,
    hooks,
    chunkSize,
  );
  const totals = new Array<number>(n).fill(0);
  for (const path of ensemble.paths) for (let i = 0; i < n; i++) totals[i] += path[i];
  const grand = stableSum(totals);
  if (!(grand > 0)) {
    throw new EngineError('No time was accumulated in the simulation, so no occupancy can be reported.', 'insufficient');
  }
  const occupancy = totals.map((x) => x / grand);
  const warnings: string[] = [
    'Occupancy fractions are time averages from finite trajectories started in one state. They approach the stationary distribution only for an irreducible chain and a horizon long compared with the slowest mixing time.',
  ];
  if (ensemble.partial) warnings.push(`Partial run: ${ensemble.pathsCompleted.toLocaleString('en-US')} of ${trajectories.toLocaleString('en-US')} trajectories completed.`);
  const result: GillespieResult = {
    occupancy,
    pathsUsed: ensemble.pathsCompleted,
    partial: ensemble.partial,
    horizon,
    exactness: 'empirical',
    warnings,
  };
  try {
    const stat = ctmcStationary(Q);
    result.stationaryComparison = {
      distribution: stat.distribution,
      maxAbsoluteDifference: Math.max(...occupancy.map((o, i) => Math.abs(o - stat.distribution[i]))),
    };
  } catch {
    // A reducible chain has no unique stationary distribution; the occupancy
    // is still a valid description of the simulated trajectories.
    warnings.push('No unique stationary distribution exists for this generator, so the occupancy is not compared with one.');
  }
  return result;
}

/** Exact holding-time and embedded-jump description of a state. */
export function ctmcStateSummary(Q: Matrix, state: number): { holdingRate: Quantity; meanHoldingTime: Quantity; jumpProbabilities: number[] } {
  validateGenerator(Q);
  const v = new Validator();
  v.integer(state, 'state', 'State index', 0, Q.length - 1);
  v.throwIfInvalid();
  const rate = -Q[state][state];
  if (rate === 0) {
    throw new EngineError(`State ${state + 1} is absorbing (total rate 0): there is no holding-time distribution and no jump to describe.`, 'absorbing');
  }
  return {
    holdingRate: quantity('Total exit rate', rate, 'exact', { formula: '−q_ii' }),
    meanHoldingTime: quantity('E[holding time]', 1 / rate, 'exact', { formula: '1/(−q_ii)' }),
    jumpProbabilities: Q[state].map((q, j) => (j === state ? 0 : q / rate)),
  };
}
