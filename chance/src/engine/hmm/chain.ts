/**
 * Advanced analysis of observed (fully visible) discrete-time Markov chains.
 *
 * This complements `stats/markov.ts`, which already covers chain
 * classification, the stationary distribution, expected absorption times and
 * absorption probabilities; those functions are reused here rather than
 * reimplemented. What is added is the material that file lacks:
 *
 *  - the full mean-first-passage-time matrix and the Kemeny constant;
 *  - hitting probabilities for an arbitrary target set;
 *  - the fundamental matrix, expected visit counts, and the VARIANCE of the
 *    absorption time (the existing file gives only the mean, and the mean of a
 *    heavily skewed absorption time on its own is misleading);
 *  - periodicity and the distinction between "a stationary distribution
 *    exists" and "the chain converges to it";
 *  - the rate of convergence, via the second-largest eigenvalue modulus, and
 *    the total-variation distance to stationarity as a function of n;
 *  - reversibility and detailed balance;
 *  - a likelihood-ratio test of the Markov property itself against
 *    second-order dependence, and order selection by AIC/BIC.
 */
import { EngineError, type Exactness } from '../core/result';
import { incompleteGamma } from '../special/gamma';
import { identity, matMul, solve, type Matrix } from '../stats/linalg';
import { classifyChain, stationaryDistribution, validateChain } from '../stats/markov';

export interface MeanFirstPassageResult {
  /** mfpt[i][j] = expected number of steps to first reach j starting from i; 0 on the diagonal. */
  mfpt: Matrix;
  /** Expected return time to each state: m_ii = 1 / π_i exactly. */
  returnTimes: number[];
  stationary: number[];
  /** Σ_j π_j m_ij, computed from every starting state i. */
  kemenyByStart: number[];
  /** The Kemeny constant: the common value of the above. */
  kemeny: number;
  /** Largest discrepancy between the kemenyByStart values. */
  kemenyInvariance: number;
  exactness: Exactness;
  method: string;
  notes: string[];
}

function requireIrreducible(matrix: Matrix, what: string): number[] {
  validateChain(matrix);
  const cls = classifyChain(matrix);
  if (!cls.irreducible) {
    throw new EngineError(
      `${what} is only defined for an irreducible chain, and this chain has ${cls.classes.length} communicating classes. Some states can never be reached from some others, so the passage time between them is infinite rather than a number. Analyse each recurrent class separately.`,
      'unsupported',
    );
  }
  const st = stationaryDistribution(matrix);
  if (!st.distribution) {
    throw new EngineError(`${what} needs the stationary distribution, which could not be computed for this matrix: the linear system is singular.`, 'numerical');
  }
  return st.distribution;
}

/**
 * Mean first passage times, by solving one linear system per target state.
 *
 * For each target j, the times from every other state satisfy
 * m_ij = 1 + Σ_{k≠j} P_ik m_kj. The diagonal is the expected RETURN time,
 * which equals 1/π_j exactly — one of the few identities in this subject that
 * is both simple and genuinely useful as a check on an implementation.
 */
export function meanFirstPassageTimes(matrix: Matrix): MeanFirstPassageResult {
  const pi = requireIrreducible(matrix, 'The mean first passage time');
  const n = matrix.length;
  const mfpt: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let j = 0; j < n; j++) {
    const others = Array.from({ length: n }, (_, i) => i).filter((i) => i !== j);
    if (!others.length) continue;
    const a: Matrix = others.map((i) => others.map((k) => (i === k ? 1 : 0) - matrix[i][k]));
    const b = others.map(() => 1);
    const sol = solve(a, b);
    if (!sol || sol.some((x) => !Number.isFinite(x) || x < 0)) {
      throw new EngineError(
        `The mean first passage times to state ${j + 1} could not be computed: the linear system (I − Q) is singular or gives a negative time, which means state ${j + 1} is not reachable from every other state.`,
        'numerical',
      );
    }
    others.forEach((i, idx) => {
      mfpt[i][j] = sol[idx];
    });
  }
  const returnTimes = pi.map((p, i) => {
    if (!(p > 0)) throw new EngineError(`State ${i + 1} has stationary probability 0, so its expected return time is infinite rather than a number.`, 'undefined');
    return 1 / p;
  });
  const kemenyByStart = Array.from({ length: n }, (_, i) => {
    let s = 0;
    for (let j = 0; j < n; j++) s += pi[j] * mfpt[i][j];
    return s;
  });
  const kemeny = kemenyByStart.reduce((a, b) => a + b, 0) / n;
  const kemenyInvariance = Math.max(...kemenyByStart) - Math.min(...kemenyByStart);
  return {
    mfpt,
    returnTimes,
    stationary: pi,
    kemenyByStart,
    kemeny,
    kemenyInvariance,
    exactness: 'exact',
    method: 'One linear system per target state, solved by Gaussian elimination. The expected return times on the diagonal are the exact reciprocals of the stationary probabilities.',
    notes: [
      'A first passage time is an expectation. Its distribution is strongly right-skewed for most chains, so the typical passage is shorter than the mean and the occasional one is far longer.',
      'The Kemeny constant is the expected number of steps to reach a state drawn from the stationary distribution. Remarkably, it does not depend on where you start — that invariance is the theorem, and the per-start values above are reported so it can be seen rather than taken on trust.',
    ],
  };
}

export interface HittingProbabilityResult {
  target: number[];
  /** probability[i] = P(the chain ever reaches the target set | start in i). */
  probability: number[];
  /** States from which the target is unreachable, so the probability is exactly 0. */
  unreachableFrom: number[];
  exactness: Exactness;
  method: string;
  notes: string[];
}

/** Probability of ever hitting a target set, from every state. */
export function hittingProbabilities(matrix: Matrix, target: number[]): HittingProbabilityResult {
  validateChain(matrix);
  const n = matrix.length;
  if (!target.length) throw new EngineError('The target set is empty, so there is nothing to hit.', 'required');
  const inTarget = new Array<boolean>(n).fill(false);
  for (const t of target) {
    if (!Number.isInteger(t) || t < 0 || t >= n) throw new EngineError(`The target set contains ${t}, which is not one of the ${n} states.`, 'range');
    inTarget[t] = true;
  }
  // Reverse reachability: which states can reach the target at all. States that
  // cannot have probability exactly 0, and including them in the linear system
  // would make it singular.
  const canReach = inTarget.slice();
  for (let pass = 0; pass < n; pass++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (canReach[i]) continue;
      for (let j = 0; j < n; j++) {
        if (matrix[i][j] > 0 && canReach[j]) {
          canReach[i] = true;
          changed = true;
          break;
        }
      }
    }
    if (!changed) break;
  }
  const probability = new Array<number>(n).fill(0);
  for (const t of target) probability[t] = 1;
  const unknown = Array.from({ length: n }, (_, i) => i).filter((i) => !inTarget[i] && canReach[i]);
  if (unknown.length) {
    const a: Matrix = unknown.map((i) => unknown.map((k) => (i === k ? 1 : 0) - matrix[i][k]));
    const b = unknown.map((i) => {
      let s = 0;
      for (const t of target) s += matrix[i][t];
      return s;
    });
    const sol = solve(a, b);
    if (!sol || sol.some((x) => !Number.isFinite(x))) {
      throw new EngineError('Hitting probabilities could not be computed: the linear system is singular even after removing the states that cannot reach the target.', 'numerical');
    }
    unknown.forEach((i, idx) => {
      probability[i] = Math.min(1, Math.max(0, sol[idx]));
    });
  }
  return {
    target: [...target],
    probability,
    unreachableFrom: Array.from({ length: n }, (_, i) => i).filter((i) => !canReach[i]),
    exactness: 'exact',
    method: 'Solves h = P·h with h = 1 on the target set, after removing the states from which the target is unreachable (for which the probability is exactly 0).',
    notes: ['This is the probability of hitting the set at any time, with no limit on how long it takes. A high hitting probability says nothing about whether it happens soon.'],
  };
}

export interface FundamentalMatrixResult {
  transientStates: number[];
  absorbingStates: number[];
  /** visits[i][j] = expected number of times the chain is in transient j, starting from transient i. */
  visits: Matrix;
  /** Expected steps to absorption from each transient state (row sums of N). */
  expectedSteps: number[];
  /** Variance of the number of steps to absorption from each transient state. */
  varianceSteps: number[];
  sdSteps: number[];
  exactness: Exactness;
  method: string;
  notes: string[];
}

/**
 * The fundamental matrix N = (I − Q)⁻¹ with the variance of the absorption
 * time: Var(τ) = (2N − I)·τ − τ∘τ.
 *
 * The mean alone is a poor summary — absorption times are typically skewed
 * with a long tail, so the standard deviation is often the same size as the
 * mean and "expected 20 steps" routinely means anything from 1 to 80.
 */
export function fundamentalMatrix(matrix: Matrix): FundamentalMatrixResult {
  validateChain(matrix);
  const n = matrix.length;
  const absorbing = Array.from({ length: n }, (_, i) => i).filter((i) => matrix[i][i] === 1);
  if (!absorbing.length) {
    throw new EngineError('This chain has no absorbing state (no state with a self-transition probability of 1), so there is no absorption time to analyse. Use the mixing time or the mean first passage times instead.', 'unsupported');
  }
  const transient = Array.from({ length: n }, (_, i) => i).filter((i) => !absorbing.includes(i));
  if (!transient.length) {
    return {
      transientStates: [],
      absorbingStates: absorbing,
      visits: [],
      expectedSteps: [],
      varianceSteps: [],
      sdSteps: [],
      exactness: 'exact',
      method: 'Every state is absorbing, so the chain is absorbed after 0 steps with no variance.',
      notes: [],
    };
  }
  const t = transient.length;
  const iq: Matrix = Array.from({ length: t }, (_, i) => Array.from({ length: t }, (_, j) => (i === j ? 1 : 0) - matrix[transient[i]][transient[j]]));
  // N column by column: (I − Q)·N_col = e_col.
  const visits: Matrix = Array.from({ length: t }, () => new Array<number>(t).fill(0));
  for (let c = 0; c < t; c++) {
    const e = new Array<number>(t).fill(0);
    e[c] = 1;
    const col = solve(iq, e);
    if (!col || col.some((x) => !Number.isFinite(x) || x < -1e-9)) {
      throw new EngineError(
        `The fundamental matrix could not be computed: (I − Q) is singular for transient state ${transient[c] + 1}, which means that state cannot reach any absorbing state and is never absorbed at all.`,
        'numerical',
      );
    }
    for (let r = 0; r < t; r++) visits[r][c] = col[r];
  }
  const expectedSteps = visits.map((row) => row.reduce((a, b) => a + b, 0));
  // Var(τ) = (2N − I)τ − τ∘τ.
  const varianceSteps = new Array<number>(t);
  for (let i = 0; i < t; i++) {
    let s = 0;
    for (let j = 0; j < t; j++) s += (2 * visits[i][j] - (i === j ? 1 : 0)) * expectedSteps[j];
    const v = s - expectedSteps[i] * expectedSteps[i];
    if (!Number.isFinite(v)) throw new EngineError(`The variance of the absorption time from state ${transient[i] + 1} is not a finite number.`, 'numerical');
    varianceSteps[i] = Math.max(0, v);
  }
  return {
    transientStates: transient,
    absorbingStates: absorbing,
    visits,
    expectedSteps,
    varianceSteps,
    sdSteps: varianceSteps.map(Math.sqrt),
    exactness: 'exact',
    method: 'Fundamental matrix N = (I − Q)⁻¹ by exact linear algebra. Expected absorption time τ = N·1 and Var(τ) = (2N − I)·τ − τ∘τ.',
    notes: [
      'The variance here is a property of the chain, not sampling error: it describes how much individual absorption times differ from each other, and it is exact.',
      'Absorption times are geometric-tailed, so the standard deviation is often close to the mean. Quoting the mean alone implies a precision the process does not have.',
      'N[i][j] is the expected number of visits to j before absorption, counting the starting state as a visit.',
    ],
  };
}

export interface PeriodicityResult {
  classes: { states: number[]; recurrent: boolean; period: number | null }[];
  /** Period of the chain when it is irreducible. */
  period: number | null;
  aperiodic: boolean;
  irreducible: boolean;
  exactness: Exactness;
  method: string;
  notes: string[];
}

/**
 * Period of each recurrent class, and the aperiodicity check.
 *
 * This matters because the two statements people routinely conflate are not
 * the same: a stationary distribution can exist while the chain never
 * converges to it. A deterministic alternation between two states has a
 * perfectly good stationary distribution of (1/2, 1/2) and the distribution
 * after n steps never gets any closer to it — it just flips.
 */
export function periodicity(matrix: Matrix): PeriodicityResult {
  validateChain(matrix);
  const cls = classifyChain(matrix);
  const recurrent = cls.classes.filter((c) => c.recurrent);
  const period = cls.irreducible ? (recurrent[0]?.period ?? null) : null;
  const notes: string[] = [];
  if (cls.aperiodic) {
    notes.push('Every recurrent class has period 1, so the chain is aperiodic and the distribution after n steps does converge to the stationary distribution.');
  } else {
    notes.push(
      `The chain is periodic (period ${period ?? recurrent.map((c) => c.period).join(', ')}). A stationary distribution still exists, and it still gives the long-run FRACTION of time spent in each state — but the distribution after n steps does not converge to it. It cycles forever with the period of the chain, so "the starting state stops mattering" is never true here.`,
    );
    notes.push('Aperiodicity is exactly what the convergence theorem needs, and it is a separate condition from the existence of the stationary distribution. Reporting a mixing time for a periodic chain would be meaningless, so this module refuses to.');
  }
  return {
    classes: cls.classes,
    period,
    aperiodic: cls.aperiodic,
    irreducible: cls.irreducible,
    exactness: 'exact',
    method: 'Period of each recurrent class as the greatest common divisor of its cycle lengths, from a breadth-first labelling of the transition graph.',
    notes,
  };
}

export interface Complex {
  re: number;
  im: number;
}

export interface EigenvalueResult {
  values: Complex[];
  moduli: number[];
  converged: boolean;
  iterations: number;
  /** |Σλ − trace(P)|: an independent check that the eigenvalues are right. */
  traceResidual: number;
  method: string;
}

/** Modified Gram–Schmidt QR decomposition. */
function qrDecompose(a: Matrix): { q: Matrix; r: Matrix } {
  const n = a.length;
  const q: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const r: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  // Columns of A.
  const v: Matrix = Array.from({ length: n }, (_, j) => Array.from({ length: n }, (_, i) => a[i][j]));
  for (let j = 0; j < n; j++) {
    for (let k = 0; k < j; k++) {
      let dot = 0;
      for (let i = 0; i < n; i++) dot += q[i][k] * v[j][i];
      r[k][j] = dot;
      for (let i = 0; i < n; i++) v[j][i] -= dot * q[i][k];
    }
    let norm = 0;
    for (let i = 0; i < n; i++) norm += v[j][i] * v[j][i];
    norm = Math.sqrt(norm);
    r[j][j] = norm;
    if (norm < 1e-300) {
      // Degenerate column: any unit vector orthogonal to the rest will do.
      for (let i = 0; i < n; i++) q[i][j] = i === j ? 1 : 0;
    } else {
      for (let i = 0; i < n; i++) q[i][j] = v[j][i] / norm;
    }
  }
  return { q, r };
}

/**
 * Eigenvalues of a small real matrix by unshifted QR iteration.
 *
 * The iteration drives the matrix towards real Schur form; a complex
 * conjugate pair survives as a 2×2 block on the diagonal, and those blocks
 * are solved as quadratics. The sum of the recovered eigenvalues is compared
 * against the trace as an independent convergence check, so a failed
 * iteration is reported rather than passed off as an answer.
 */
export function qrEigenvalues(a: Matrix, maxIterations = 2000, tolerance = 1e-13): EigenvalueResult {
  const n = a.length;
  if (n === 0) throw new EngineError('Eigenvalues of an empty matrix are undefined.', 'shape');
  let m = a.map((r) => [...r]);
  let trace = 0;
  for (let i = 0; i < n; i++) trace += a[i][i];
  let iterations = 0;
  for (let it = 0; it < maxIterations; it++) {
    iterations = it + 1;
    const { q, r } = qrDecompose(m);
    m = matMul(r, q);
    if (m.some((row) => row.some((x) => !Number.isFinite(x)))) {
      throw new EngineError(`The QR eigenvalue iteration produced a non-finite value at iteration ${iterations}; the eigenvalues of this matrix could not be computed.`, 'numerical');
    }
    // Stop once every subdiagonal entry is either negligible or part of a
    // settled 2x2 block (checked by the entry below it being negligible).
    let settled = true;
    for (let i = 1; i < n; i++) {
      const scale = Math.abs(m[i - 1][i - 1]) + Math.abs(m[i][i]) + 1e-300;
      if (Math.abs(m[i][i - 1]) > tolerance * scale) {
        if (i + 1 < n && Math.abs(m[i + 1][i]) > tolerance * (Math.abs(m[i][i]) + Math.abs(m[i + 1][i + 1]) + 1e-300)) settled = false;
        else if (i >= 2 && Math.abs(m[i - 1][i - 2]) > tolerance * (Math.abs(m[i - 2][i - 2]) + Math.abs(m[i - 1][i - 1]) + 1e-300)) settled = false;
      }
    }
    if (settled && it > 2) break;
  }
  const values: Complex[] = [];
  let i = 0;
  while (i < n) {
    const sub = i + 1 < n ? Math.abs(m[i + 1][i]) : 0;
    const scale = i + 1 < n ? Math.abs(m[i][i]) + Math.abs(m[i + 1][i + 1]) + 1e-300 : 1;
    if (i + 1 < n && sub > 1e-8 * scale) {
      const p = m[i][i];
      const q2 = m[i][i + 1];
      const r2 = m[i + 1][i];
      const s = m[i + 1][i + 1];
      const tr = p + s;
      const det = p * s - q2 * r2;
      const disc = (tr * tr) / 4 - det;
      if (disc >= 0) {
        const root = Math.sqrt(disc);
        values.push({ re: tr / 2 + root, im: 0 }, { re: tr / 2 - root, im: 0 });
      } else {
        const root = Math.sqrt(-disc);
        values.push({ re: tr / 2, im: root }, { re: tr / 2, im: -root });
      }
      i += 2;
    } else {
      values.push({ re: m[i][i], im: 0 });
      i += 1;
    }
  }
  let sum = 0;
  for (const v of values) sum += v.re;
  const traceResidual = Math.abs(sum - trace);
  return {
    values,
    moduli: values.map((v) => Math.hypot(v.re, v.im)),
    converged: traceResidual < 1e-8 * (1 + Math.abs(trace)) && values.length === n,
    iterations,
    traceResidual,
    method: 'Unshifted QR iteration (modified Gram–Schmidt), with 2×2 diagonal blocks solved as quadratics to recover complex conjugate pairs.',
  };
}

export interface PowerMethodResult {
  slem: number;
  converged: boolean;
  iterations: number;
  /** Spread of the last window of growth ratios: the convergence diagnostic. */
  ratioSpread: number;
  method: string;
}

/**
 * Second-largest eigenvalue modulus by the power method on the deflated
 * matrix B = P − 1·π, whose spectrum is that of P with the Perron eigenvalue 1
 * replaced by 0. ‖Bᵏv‖^(1/k) converges to the spectral radius of B even when
 * the dominant eigenvalue is a complex pair, so the estimate is taken as the
 * geometric mean of the growth ratios over a trailing window, and the spread
 * of that window is reported as the convergence diagnostic.
 */
export function slemByPowerMethod(matrix: Matrix, stationary: number[], maxIterations = 100000): PowerMethodResult {
  const n = matrix.length;
  const b: Matrix = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => matrix[i][j] - stationary[j]));
  const v = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 1 : -1) + 0.5 / (i + 1));
  const burnIn = Math.min(200, Math.floor(maxIterations / 4));
  const logs: number[] = [];
  let iterations = 0;
  for (let it = 0; it < maxIterations; it++) {
    iterations = it + 1;
    const w = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += b[i][j] * v[j];
      w[i] = s;
    }
    let norm = 0;
    for (let i = 0; i < n; i++) norm += w[i] * w[i];
    norm = Math.sqrt(norm);
    if (!Number.isFinite(norm)) throw new EngineError('The power method for the second eigenvalue diverged to a non-finite value.', 'numerical');
    if (norm < 1e-290) {
      // The deflated matrix annihilated the iterate: every non-Perron
      // eigenvalue is 0.
      return { slem: 0, converged: true, iterations, ratioSpread: 0, method: 'Power method on the deflated matrix; the iterate vanished, so all non-Perron eigenvalues are 0.' };
    }
    if (it >= burnIn) logs.push(Math.log(norm));
    for (let i = 0; i < n; i++) v[i] = w[i] / norm;
  }
  if (!logs.length) throw new EngineError('The power method did not run long enough to estimate the second eigenvalue.', 'numerical');
  const mean = (xs: number[]): number => xs.reduce((a, x) => a + x, 0) / xs.length;
  // A complex conjugate pair makes the per-step growth ratio oscillate with the
  // pair's argument, so no single ratio is the modulus; the running geometric
  // mean is, and it converges like 1/k. The two halves of the averaging window
  // give an honest estimate of how far that convergence has got.
  const half = Math.floor(logs.length / 2);
  const slem = Math.exp(mean(logs));
  const firstHalf = Math.exp(mean(logs.slice(0, half)));
  const secondHalf = Math.exp(mean(logs.slice(half)));
  const spread = Math.abs(secondHalf - firstHalf);
  return {
    slem,
    converged: spread < 1e-4 * Math.max(1e-12, slem),
    iterations,
    ratioSpread: spread,
    method: 'Power method on the deflated matrix B = P - 1 pi; the estimate is the geometric mean of the per-step growth, which converges to the spectral radius even for a complex conjugate pair.',
  };
}

export interface ConvergenceResult {
  stationary: number[];
  slem: number;
  /** The same quantity from the independent second method, as a cross-check. */
  slemCrossCheck: number;
  slemAgreement: number;
  eigenvalues: Complex[];
  /** 1 / (1 − SLEM): the number of steps over which correlations decay by e. */
  relaxationTime: number;
  /** Smallest n with max_i TV(Pⁿ_i, π) ≤ threshold. */
  mixingTime: number;
  mixingThreshold: number;
  /** tvDistance[n − 1] = max_i TV(Pⁿ_i, π). */
  tvDistance: number[];
  /** The geometric bound the SLEM predicts for the decay. */
  predictedDecay: number[];
  eigenMethod: string;
  crossCheckMethod: string;
  eigenConverged: boolean;
  exactness: Exactness;
  notes: string[];
}

/** Total-variation distance to stationarity, max over starting states, for n = 1..steps. */
export function tvDistanceToStationary(matrix: Matrix, stationary: number[], steps: number): number[] {
  validateChain(matrix);
  if (!Number.isInteger(steps) || steps < 1) throw new EngineError('The number of steps must be a whole number of 1 or more.', 'range');
  const n = matrix.length;
  let power = identity(n);
  const out = new Array<number>(steps);
  for (let s = 0; s < steps; s++) {
    power = matMul(power, matrix);
    let worst = 0;
    for (let i = 0; i < n; i++) {
      let d = 0;
      for (let j = 0; j < n; j++) d += Math.abs(power[i][j] - stationary[j]);
      worst = Math.max(worst, 0.5 * d);
    }
    out[s] = worst;
  }
  return out;
}

/**
 * How many steps until the starting state stops mattering.
 *
 * The convergence rate is governed by the second-largest eigenvalue modulus:
 * the distance to stationarity decays like SLEMⁿ. Two independent numerical
 * methods are run and compared, because an eigenvalue of a non-symmetric
 * matrix is exactly the sort of quantity a single iteration can get quietly
 * wrong.
 */
export function convergenceRate(matrix: Matrix, options: { threshold?: number; maxSteps?: number } = {}): ConvergenceResult {
  const pi = requireIrreducible(matrix, 'The convergence rate');
  const period = periodicity(matrix);
  if (!period.aperiodic) {
    throw new EngineError(
      `This chain is periodic (period ${period.period ?? 'greater than 1'}), so it never converges to its stationary distribution and has no mixing time. The distribution after n steps cycles forever: after an even number of steps it is one thing and after an odd number another. The stationary distribution still describes the long-run fraction of time spent in each state, and that is the only "long run" statement this chain supports.`,
      'periodic',
    );
  }
  const threshold = options.threshold ?? 0.25;
  if (!(threshold > 0) || threshold >= 1) throw new EngineError('The mixing-time threshold must be between 0 and 1.', 'range');
  const eig = qrEigenvalues(matrix);
  const power = slemByPowerMethod(matrix, pi);
  if (!eig.converged && !power.converged) {
    throw new EngineError(
      `Neither eigenvalue method converged for this matrix (QR trace residual ${eig.traceResidual.toPrecision(4)}, power-method ratio spread ${power.ratioSpread.toPrecision(4)}), so the convergence rate cannot be reported. No rate is better than a wrong one.`,
      'numerical',
    );
  }
  // Drop one eigenvalue closest to the Perron root 1, then take the largest
  // remaining modulus.
  const indexed = eig.moduli.map((m, i) => ({ m, i }));
  let perron = 0;
  for (let i = 1; i < indexed.length; i++) {
    if (Math.abs(eig.values[i].re - 1) + Math.abs(eig.values[i].im) < Math.abs(eig.values[perron].re - 1) + Math.abs(eig.values[perron].im)) perron = i;
  }
  const rest = indexed.filter((x) => x.i !== perron).map((x) => x.m);
  const slemQr = rest.length ? Math.max(...rest) : 0;
  const slem = eig.converged ? slemQr : power.slem;
  const slemCrossCheck = eig.converged ? power.slem : slemQr;
  if (!(slem >= 0) || slem >= 1 - 1e-12) {
    throw new EngineError(
      `The second-largest eigenvalue modulus came out as ${slem.toPrecision(6)}, which is not strictly less than 1. For an irreducible aperiodic chain it must be, so the eigenvalue computation has failed rather than discovered something; no convergence rate is reported.`,
      'numerical',
    );
  }
  const maxSteps = options.maxSteps ?? Math.min(500000, Math.max(200, Math.ceil((40 * 1) / Math.max(1e-12, 1 - slem))));
  const tv = tvDistanceToStationary(matrix, pi, maxSteps);
  let mixingTime = -1;
  for (let i = 0; i < tv.length; i++) {
    if (tv[i] <= threshold) {
      mixingTime = i + 1;
      break;
    }
  }
  if (mixingTime < 0) {
    throw new EngineError(
      `The chain had not come within a total-variation distance of ${threshold} of its stationary distribution after ${maxSteps} steps, so no mixing time is reported. The chain mixes far more slowly than its eigenvalues suggested, or the matrix is nearly reducible.`,
      'numerical',
    );
  }
  const relaxationTime = 1 / (1 - slem);
  return {
    stationary: pi,
    slem,
    slemCrossCheck,
    slemAgreement: Math.abs(slem - slemCrossCheck),
    eigenvalues: eig.values,
    relaxationTime,
    mixingTime,
    mixingThreshold: threshold,
    tvDistance: tv.slice(0, Math.min(tv.length, Math.max(mixingTime * 4, 50))),
    predictedDecay: Array.from({ length: Math.min(tv.length, Math.max(mixingTime * 4, 50)) }, (_, i) => Math.pow(slem, i + 1)),
    eigenMethod: eig.converged ? eig.method : power.method,
    crossCheckMethod: eig.converged ? power.method : eig.method,
    eigenConverged: eig.converged && power.converged,
    exactness: 'numerical',
    notes: [
      `After about ${mixingTime} step(s) the distribution is within a total-variation distance of ${threshold} of the stationary distribution: that is when the starting state has stopped mattering much. Total-variation distance is the largest difference in probability this chain can assign to any event, so it is the strongest sense of "close".`,
      `The decay is geometric at rate ${slem.toPrecision(6)} per step, giving a relaxation time of ${relaxationTime.toPrecision(4)} steps. The distance never reaches exactly 0 in finite time; it only gets small.`,
      'The eigenvalues are computed by iteration, so these are numerical approximations, not exact values. Two independent methods are run and the agreement between them is reported above.',
      'A chain can have a small SLEM and still mix slowly from an unlucky starting state early on; the total-variation curve, not the eigenvalue, is the honest answer at small n.',
    ],
  };
}

export interface ReversibilityResult {
  reversible: boolean;
  stationary: number[];
  /** flow[i][j] = π_i P_ij; reversibility means this matrix is symmetric. */
  flow: Matrix;
  /** Largest |π_i P_ij − π_j P_ji| over all pairs. */
  maxViolation: number;
  worstPair: { from: number; to: number; forward: number; backward: number } | null;
  tolerance: number;
  exactness: Exactness;
  method: string;
  notes: string[];
}

/** Detailed balance check: π_i P_ij = π_j P_ji for every pair. */
export function reversibility(matrix: Matrix, tolerance = 1e-12): ReversibilityResult {
  const pi = requireIrreducible(matrix, 'The reversibility check');
  const n = matrix.length;
  const flow: Matrix = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => pi[i] * matrix[i][j]));
  let maxViolation = 0;
  let worstPair: { from: number; to: number; forward: number; backward: number } | null = null;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.abs(flow[i][j] - flow[j][i]);
      if (d > maxViolation) {
        maxViolation = d;
        worstPair = { from: i, to: j, forward: flow[i][j], backward: flow[j][i] };
      }
    }
  }
  const reversible = maxViolation <= tolerance;
  return {
    reversible,
    stationary: pi,
    flow,
    maxViolation,
    worstPair,
    tolerance,
    exactness: 'exact',
    method: 'Detailed balance: the stationary probability flow π_i P_ij is compared with the reverse flow π_j P_ji for every pair of states.',
    notes: [
      reversible
        ? 'The chain satisfies detailed balance, so it is reversible: a long run of the chain looks statistically identical played backwards, and every eigenvalue of the transition matrix is real.'
        : `The chain is not reversible: the largest imbalance is ${maxViolation.toPrecision(4)} between states ${(worstPair?.from ?? 0) + 1} and ${(worstPair?.to ?? 0) + 1}, where the forward flow is ${worstPair?.forward.toPrecision(6)} and the reverse flow ${worstPair?.backward.toPrecision(6)}. The chain has a direction, so the transition matrix can have complex eigenvalues and the distribution can spiral rather than decay towards stationarity.`,
      'Reversibility is a property of the chain together with its stationary distribution, not of the matrix alone.',
    ],
  };
}

export interface MarkovOrderTestResult {
  states: number;
  /** Likelihood-ratio statistic G² for first order against second order. */
  statistic: number;
  degreesOfFreedom: number;
  pValue: number;
  /** Degrees of freedom actually supported by the observed contexts. */
  effectiveDegreesOfFreedom: number;
  tripleCount: number;
  reject: boolean
  alpha: number;
  exactness: Exactness;
  method: string;
  notes: string[];
}

function chiSquareSurvival(x: number, df: number): number {
  if (df <= 0) throw new EngineError('A chi-square test needs at least one degree of freedom.', 'range');
  if (!(x >= 0)) throw new EngineError(`The test statistic came out as ${x}, which is not a valid chi-square value.`, 'numerical');
  return incompleteGamma(df / 2, x / 2).upper;
}

function countTriples(sequence: number[], states: number): { n3: number[][][]; total: number } {
  const n3: number[][][] = Array.from({ length: states }, () => Array.from({ length: states }, () => new Array<number>(states).fill(0)));
  let total = 0;
  for (let t = 0; t + 2 < sequence.length; t++) {
    n3[sequence[t]][sequence[t + 1]][sequence[t + 2]] += 1;
    total += 1;
  }
  return { n3, total };
}

function validateSequence(sequence: number[], states: number, minLength: number): void {
  if (!Number.isInteger(states) || states < 2) throw new EngineError('Testing the Markov property needs at least 2 states.', 'range');
  if (sequence.length < minLength) {
    throw new EngineError(`The observed sequence has ${sequence.length} values, which is too few to test the Markov property; at least ${minLength} are needed.`, 'insufficient');
  }
  for (let t = 0; t < sequence.length; t++) {
    const v = sequence[t];
    if (!Number.isInteger(v) || v < 0 || v >= states) {
      throw new EngineError(`The sequence contains ${v} at index ${t}, which is not one of the ${states} states (valid values are 0 to ${states - 1}).`, 'range');
    }
  }
}

/**
 * Likelihood-ratio test of the Markov property.
 *
 * H₀: the next state depends only on the current one (first order).
 * H₁: it also depends on the one before (second order).
 *
 * People assume the Markov property as a matter of course and almost never
 * check it. G² = 2 Σ n_ijk · log[ (n_ijk / n_ij) / (n_jk / n_j) ] is
 * asymptotically chi-square with S(S−1)² degrees of freedom under H₀.
 */
export function markovPropertyTest(sequence: number[], states: number, alpha = 0.05): MarkovOrderTestResult {
  validateSequence(sequence, states, 3);
  const { n3, total } = countTriples(sequence, states);
  const n2Context = Array.from({ length: states }, (_, i) => Array.from({ length: states }, (_, j) => n3[i][j].reduce((a, b) => a + b, 0)));
  const n2Pair = Array.from({ length: states }, () => new Array<number>(states).fill(0));
  const n1 = new Array<number>(states).fill(0);
  for (let i = 0; i < states; i++) {
    for (let j = 0; j < states; j++) {
      for (let k = 0; k < states; k++) {
        n2Pair[j][k] += n3[i][j][k];
        n1[j] += n3[i][j][k];
      }
    }
  }
  let g2 = 0;
  for (let i = 0; i < states; i++) {
    for (let j = 0; j < states; j++) {
      for (let k = 0; k < states; k++) {
        const c = n3[i][j][k];
        if (c === 0) continue;
        const pFull = c / n2Context[i][j];
        const pReduced = n2Pair[j][k] / n1[j];
        if (!(pReduced > 0)) {
          throw new EngineError(`The test cannot be computed: the transition ${j} → ${k} occurs after state ${i} but the first-order model gives it probability 0, which can only happen if the counts are inconsistent.`, 'numerical');
        }
        g2 += 2 * c * Math.log(pFull / pReduced);
      }
    }
  }
  if (g2 < 0 && g2 > -1e-9) g2 = 0;
  const df = states * (states - 1) * (states - 1);
  // Effective df: contexts and transitions actually observed.
  const observedContexts = n2Context.flat().filter((c) => c > 0).length;
  const observedStates = n1.filter((c) => c > 0).length;
  const effectiveDf = Math.max(1, (observedContexts - observedStates) * (states - 1));
  const pValue = chiSquareSurvival(g2, df);
  const notes = [
    'A high p-value is not evidence that the Markov property holds. It means this particular test, with this much data, could not detect second-order dependence — and the test needs a lot of data, because the number of cells grows with the cube of the number of states.',
    `The statistic is compared against a chi-square distribution with ${df} degrees of freedom, which is the asymptotic null distribution. With ${total} triples and ${states ** 2} possible contexts, that approximation needs roughly five observations per cell to be trustworthy; here the average is ${(total / states ** 2).toPrecision(3)}.`,
    'Rejection says the first-order model is inadequate, not that a second-order model is right. Longer-range dependence, non-stationarity and a mis-specified state space all show up here as the same rejection.',
  ];
  if (total < 5 * states ** 3) {
    notes.push(`There are only ${total} triples for ${states ** 3} cells, so the chi-square approximation to the null distribution is doubtful and the p-value should be read as a rough indication.`);
  }
  return {
    states,
    statistic: g2,
    degreesOfFreedom: df,
    pValue,
    effectiveDegreesOfFreedom: effectiveDf,
    tripleCount: total,
    reject: pValue < alpha,
    alpha,
    exactness: 'empirical',
    method: 'Likelihood-ratio (G²) test of a first-order against a second-order Markov chain, using the counts of consecutive triples; the null distribution is chi-square with S(S−1)² degrees of freedom.',
    notes,
  };
}

export interface OrderSelectionRow {
  order: number;
  logLikelihood: number;
  freeParameters: number;
  aic: number;
  bic: number;
}

export interface OrderSelectionResult {
  rows: OrderSelectionRow[];
  bestByAic: number;
  bestByBic: number;
  sampleSize: number;
  exactness: Exactness;
  method: string;
  notes: string[];
}

/**
 * Markov chain order selection by AIC and BIC.
 *
 * All orders are scored on the same set of transitions (the last
 * T − maxOrder of them) so the likelihoods are comparable; scoring different
 * orders on different amounts of data is a common and invisible error.
 */
export function selectChainOrder(sequence: number[], states: number, maxOrder = 2): OrderSelectionResult {
  if (!Number.isInteger(maxOrder) || maxOrder < 1 || maxOrder > 4) {
    throw new EngineError('The maximum order must be a whole number between 1 and 4; beyond that the number of parameters exceeds any realistic amount of data.', 'range');
  }
  validateSequence(sequence, states, maxOrder + 2);
  const sampleSize = sequence.length - maxOrder;
  if (sampleSize < 1) throw new EngineError(`The sequence is too short to score an order-${maxOrder} model.`, 'insufficient');
  const rows: OrderSelectionRow[] = [];
  for (let k = 0; k <= maxOrder; k++) {
    const counts = new Map<string, number[]>();
    for (let t = maxOrder; t < sequence.length; t++) {
      const key = sequence.slice(t - k, t).join(',');
      let row = counts.get(key);
      if (!row) {
        row = new Array<number>(states).fill(0);
        counts.set(key, row);
      }
      row[sequence[t]] += 1;
    }
    let ll = 0;
    for (const row of counts.values()) {
      const total = row.reduce((a, b) => a + b, 0);
      for (const c of row) if (c > 0) ll += c * Math.log(c / total);
    }
    const p = Math.pow(states, k) * (states - 1);
    rows.push({ order: k, logLikelihood: ll, freeParameters: p, aic: 2 * p - 2 * ll, bic: p * Math.log(sampleSize) - 2 * ll });
  }
  const bestByAic = rows.reduce((a, b) => (b.aic < a.aic ? b : a)).order;
  const bestByBic = rows.reduce((a, b) => (b.bic < a.bic ? b : a)).order;
  return {
    rows,
    bestByAic,
    bestByBic,
    sampleSize,
    exactness: 'empirical',
    method: `Maximum-likelihood fit of each order from 0 to ${maxOrder}, all scored on the same ${sampleSize} transitions, with AIC = 2p − 2logL and BIC = p·log(n) − 2logL.`,
    notes: [
      'The log-likelihood increases with the order by construction, because a higher-order model contains the lower-order one. Only the penalised criteria carry information.',
      `An order-k model has S^k(S−1) parameters: for ${states} states that is ${Array.from({ length: maxOrder + 1 }, (_, k) => `${k}: ${Math.pow(states, k) * (states - 1)}`).join(', ')}. The count grows geometrically, so high orders are unidentifiable long before they are implausible.`,
      bestByAic === bestByBic
        ? `Both criteria choose order ${bestByAic}.`
        : `AIC chooses order ${bestByAic} and BIC chooses order ${bestByBic}; BIC penalises parameters more heavily as the sample grows, and the disagreement is the honest answer.`,
      'Order selection assumes the chain is stationary over the whole sequence. A chain whose transition probabilities change part way through will usually be reported as higher order than it is.',
    ],
  };
}
