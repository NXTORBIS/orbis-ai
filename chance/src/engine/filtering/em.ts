/**
 * Parameter learning for a linear-Gaussian state-space model: expectation
 * maximisation over the smoothed moments, and direct maximisation of the exact
 * likelihood.
 *
 * EM (Shumway & Stoffer's formulation). The E-step is the RTS smoother, which
 * supplies E[x_t], E[x_t x_tᵀ] and E[x_t x_{t−1}ᵀ] — the last of which is the
 * lag-one smoothed covariance, and is the reason the smoother computes it. The
 * M-step then has closed-form solutions for A, Q, C and R.
 *
 * MONOTONICITY IS CHECKED, NOT ASSUMED. EM cannot decrease the log-likelihood:
 * each iteration maximises a lower bound that touches the likelihood at the
 * current parameters. So if the likelihood goes DOWN, the implementation is
 * wrong — a transposed matrix, a wrong sign, a mismatched index — and the right
 * response is to say so rather than to let the run drift to a worse answer and
 * report it as a fit. Every decrease beyond floating-point noise is recorded in
 * `monotonicityViolations` and reported as a bug in the warnings.
 *
 * What EM does NOT give: a well-identified answer. A state-space model is only
 * identified up to a similarity transform of the state unless the structure
 * pins it down, and EM converges to a local maximum. Both limitations are in
 * the explanation.
 */
import { EngineError } from '../core/result';
import { stableSum } from '../core/numeric';
import {
  cloneMat,
  cols,
  identity,
  matAdd,
  matMul,
  matSub,
  matVec,
  outer,
  rows,
  solveSPDMat,
  symmetrise,
  transpose,
  zeros,
  type Mat,
  type Vec,
} from './matrix';
import { accessModel, kalmanFilter, kalmanSmoother } from './kalman';
import { explainFiltering, type EmResult, type FilterProgress, type LinearGaussianModel, type Observation, type RunControl } from './types';

export interface EmUpdateFlags {
  A?: boolean;
  C?: boolean;
  Q?: boolean;
  R?: boolean;
  mu0?: boolean;
  /**
   * Off by default. A single series carries almost no information about the
   * prior covariance, and updating it typically drives Sigma0 to zero and
   * makes the early states look far more certain than they are.
   */
  Sigma0?: boolean;
}

export interface EmOptions extends RunControl {
  maxIterations?: number;
  /** Relative change in the log-likelihood below which the fit is converged. */
  tolerance?: number;
  update?: EmUpdateFlags;
}

/** EM as a generator, so a long fit can be cancelled between iterations. */
export function* emSteps(
  initial: LinearGaussianModel,
  observations: Observation[],
  options: EmOptions = {},
): Generator<FilterProgress, EmResult, void> {
  const T = observations.length;
  if (T < 2) {
    throw new EngineError(
      `Fitting a state-space model by EM needs at least 2 time steps; ${T} were supplied. The transition matrix is ` +
        'estimated from consecutive pairs, and there are none.',
      'insufficient-data',
    );
  }
  const acc = accessModel(initial, T);
  if (acc.timeVarying) {
    throw new EngineError(
      'EM here estimates constant matrices, but A, C, Q or R was supplied as a time-varying sequence. There is no ' +
        'single value to estimate; fix the sequence and estimate the remaining parameters, or reparameterise.',
      'invalid',
    );
  }
  if (initial.B !== undefined) {
    throw new EngineError('EM with control inputs is not implemented here; remove B or subtract its effect first.', 'unsupported');
  }
  const maxIter = options.maxIterations ?? 200;
  const tol = options.tolerance ?? 1e-8;
  const flags: Required<EmUpdateFlags> = {
    A: options.update?.A ?? true,
    C: options.update?.C ?? true,
    Q: options.update?.Q ?? true,
    R: options.update?.R ?? true,
    mu0: options.update?.mu0 ?? true,
    Sigma0: options.update?.Sigma0 ?? false,
  };
  const n = acc.n;
  const m = acc.m;

  let model: LinearGaussianModel = {
    A: cloneMat(acc.A(0)),
    C: cloneMat(acc.C(0)),
    Q: cloneMat(acc.Q(0)),
    R: cloneMat(acc.R(0)),
    mu0: initial.mu0.slice(),
    Sigma0: cloneMat(symmetrise(initial.Sigma0)),
    stateNames: initial.stateNames,
    observationNames: initial.observationNames,
  };

  const path: number[] = [];
  const violations: { iteration: number; decrease: number }[] = [];
  const warnings: string[] = [];
  let converged = false;
  let partial = false;
  let iterations = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    const sm = kalmanSmoother(model, observations);
    const ll = sm.logLikelihood;
    if (!Number.isFinite(ll)) {
      throw new EngineError(`The log-likelihood at EM iteration ${iter} is ${ll}, so the fit cannot continue.`, 'finite');
    }
    if (path.length > 0) {
      const prev = path[path.length - 1];
      const decrease = prev - ll;
      // Tolerance: EM is exactly monotone in real arithmetic, so anything
      // beyond accumulated rounding (scaled by the likelihood magnitude) is a
      // genuine fault, not noise.
      const noise = 1e-7 * (Math.abs(prev) + 1);
      if (decrease > noise) violations.push({ iteration: iter, decrease });
    }
    path.push(ll);
    iterations = iter + 1;

    if (path.length >= 2) {
      const prev = path[path.length - 2];
      if (Math.abs(ll - prev) <= tol * (Math.abs(prev) + 1)) {
        converged = true;
        break;
      }
    }

    // ---- M step ----
    const e = sm.smoothedMean;
    const P = sm.smoothedCov;
    const prevMean = (t: number): Vec => (t === 0 ? sm.initialMean : e[t - 1]);
    const prevCov = (t: number): Mat => (t === 0 ? sm.initialCov : P[t - 1]);

    let S11 = zeros(n, n);
    let S10 = zeros(n, n);
    let S00 = zeros(n, n);
    for (let t = 0; t < T; t++) {
      S11 = matAdd(S11, matAdd(P[t], outer(e[t], e[t])));
      S10 = matAdd(S10, matAdd(sm.lagOneCov[t], outer(e[t], prevMean(t))));
      S00 = matAdd(S00, matAdd(prevCov(t), outer(prevMean(t), prevMean(t))));
    }
    S11 = symmetrise(S11);
    S00 = symmetrise(S00);

    const Aold = model.A as Mat;
    const Anew = flags.A ? transpose(solveSPDMat(S00, transpose(S10), 'The smoothed second-moment matrix S00')) : Aold;
    const Qnew = flags.Q
      ? symmetrise(
          scale(
            matAdd(
              matSub(S11, matAdd(matMul(Anew, transpose(S10)), matMul(S10, transpose(Anew)))),
              matMul(matMul(Anew, S00), transpose(Anew)),
            ),
            1 / T,
          ),
        )
      : (model.Q as Mat);

    // Observation equation: only steps with a usable measurement contribute.
    let Syx = zeros(m, n);
    let Sxx = zeros(n, n);
    let Syy = zeros(m, m);
    let observedSteps = 0;
    for (let t = 0; t < T; t++) {
      const obs = observations[t];
      if (obs === null) continue;
      const y: number[] = [];
      let complete = true;
      for (let j = 0; j < m; j++) {
        const v = obs[j];
        if (v === null || v === undefined) {
          complete = false;
          break;
        }
        y.push(v);
      }
      if (!complete) continue;
      observedSteps++;
      Syx = matAdd(Syx, outer(y, e[t]));
      Sxx = matAdd(Sxx, matAdd(P[t], outer(e[t], e[t])));
      Syy = matAdd(Syy, outer(y, y));
    }
    if (observedSteps === 0) {
      throw new EngineError(
        'No time step has a complete observation vector, so the observation equation cannot be estimated at all.',
        'insufficient-data',
      );
    }
    const Cnew = flags.C ? transpose(solveSPDMat(symmetrise(Sxx), transpose(Syx), 'The smoothed state second moment')) : (model.C as Mat);
    const Rnew = flags.R
      ? symmetrise(
          scale(
            matAdd(
              matSub(Syy, matAdd(matMul(Cnew, transpose(Syx)), matMul(Syx, transpose(Cnew)))),
              matMul(matMul(Cnew, symmetrise(Sxx)), transpose(Cnew)),
            ),
            1 / observedSteps,
          ),
        )
      : (model.R as Mat);

    model = {
      A: Anew,
      C: Cnew,
      Q: ensureProper(Qnew, 'the re-estimated process-noise covariance Q'),
      R: ensureProper(Rnew, 'the re-estimated measurement-noise covariance R'),
      mu0: flags.mu0 ? sm.initialMean.slice() : model.mu0,
      Sigma0: flags.Sigma0 ? ensureProper(symmetrise(sm.initialCov), 'the re-estimated prior covariance Sigma0') : model.Sigma0,
      stateNames: model.stateNames,
      observationNames: model.observationNames,
    };

    yield { completed: iter + 1, total: maxIter };
    if (options.isCancelled?.()) {
      partial = true;
      warnings.push(`The fit was cancelled after ${iter + 1} iterations; the parameters returned are the latest iterate, not a converged fit.`);
      break;
    }
  }

  // The likelihood of the FINAL parameters, which the loop has not yet scored.
  const finalLl = kalmanFilter(model, observations).logLikelihood;
  if (path.length > 0) {
    const decrease = path[path.length - 1] - finalLl;
    if (decrease > 1e-7 * (Math.abs(path[path.length - 1]) + 1)) {
      violations.push({ iteration: iterations, decrease });
    }
  }
  path.push(finalLl);

  if (violations.length > 0) {
    warnings.push(
      `BUG: the log-likelihood DECREASED at ${violations.length} EM iteration(s), the largest drop being ` +
        `${Math.max(...violations.map((v) => v.decrease)).toExponential(3)} at iteration ${violations[0].iteration}. ` +
        'EM maximises a lower bound that touches the likelihood at the current parameters, so this cannot happen in ' +
        'exact arithmetic: it indicates an error in the M-step or in the smoothed moments, not a property of the data. ' +
        'Treat the fitted parameters as unreliable.',
    );
  }
  if (!converged && !partial) {
    warnings.push(
      `EM reached the iteration limit of ${maxIter} without the log-likelihood settling to within ${tol}. ` +
        'The parameters returned are the last iterate and are NOT a converged maximum.',
    );
  }

  return {
    model,
    logLikelihoodPath: path,
    logLikelihood: path[path.length - 1],
    iterations,
    converged,
    monotonicityViolations: violations,
    exactness: 'numerical',
    explanation: explainFiltering(
      'Expectation maximisation over smoothed moments',
      'numerical',
      [
        { label: 'Iterations', value: String(iterations) },
        { label: 'Converged', value: converged ? 'yes' : 'no' },
        { label: 'Log-likelihood', value: path[path.length - 1].toFixed(6) },
        { label: 'E step', expression: 'RTS smoother: E[x_t], E[x_t x_tᵀ], E[x_t x_{t−1}ᵀ]' },
        { label: 'M step', expression: 'A = S10 S00⁻¹,  Q = (S11 − A S10ᵀ)/T,  C = Syx Sxx⁻¹,  R = (Syy − C Syxᵀ)/T' },
        { label: 'Monotonicity violations', value: String(violations.length) },
      ],
      [
        'The model is linear-Gaussian with constant matrices over the series.',
        `Parameters estimated: ${Object.entries(flags).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}.`,
      ],
      [
        'EM converges to a LOCAL maximum. A different start can give a different fit; compare several starts before trusting one.',
        'A general state-space model is identified only up to a similarity transform of the state, so the fitted A and C are not individually meaningful unless the structure fixes them — the implied dynamics are.',
        'No standard errors are reported: they would need the observed information matrix, which EM does not produce as a by-product.',
      ],
    ),
    warnings,
    partial,
  };
}

function scale(a: Mat, s: number): Mat {
  return a.map((r) => r.map((v) => v * s));
}

/** Refuse a re-estimated covariance that is not a covariance. */
function ensureProper(a: Mat, label: string): Mat {
  const sym = symmetrise(a);
  for (let i = 0; i < rows(sym); i++) {
    for (let j = 0; j < cols(sym); j++) {
      if (!Number.isFinite(sym[i][j])) {
        throw new EngineError(`EM produced a non-finite entry (${sym[i][j]}) at [${i}][${j}] of ${label}.`, 'finite');
      }
    }
  }
  for (let i = 0; i < rows(sym); i++) {
    if (!(sym[i][i] > 0)) {
      throw new EngineError(
        `EM drove the diagonal entry ${i} of ${label} to ${sym[i][i].toExponential(3)}, which is not a variance. ` +
          'This usually means the model has more noise parameters than the series can identify — a state that is ' +
          'explained entirely by measurement noise, or vice versa. No fitted parameters are returned.',
        'degenerate',
      );
    }
  }
  return sym;
}

export function fitByEm(initial: LinearGaussianModel, observations: Observation[], options: EmOptions = {}): EmResult {
  const it = emSteps(initial, observations, options);
  let s = it.next();
  while (!s.done) s = it.next();
  return s.value;
}

export interface DirectFitResult {
  parameters: number[];
  model: LinearGaussianModel;
  logLikelihood: number;
  iterations: number;
  converged: boolean;
  exactness: 'numerical';
  explanation: ReturnType<typeof explainFiltering>;
  warnings: string[];
}

/**
 * Direct maximisation of the exact Kalman log-likelihood over an arbitrary
 * parameterisation, by Nelder-Mead.
 *
 * Why offer this as well as EM: EM is reliable and slow, and it can only
 * estimate the matrices it has closed forms for. A parameterisation with
 * constraints — a shared variance, a known structure, a positive scalar — is
 * easier to maximise directly. Nelder-Mead is used because the parameterisation
 * is an arbitrary callback, so no derivative is available; it is derivative-free
 * and robust, and it is slow, which is the honest trade.
 *
 * A non-converged search is reported as non-converged. The caller gets the best
 * point found and is told it is not a maximum.
 */
/**
 * Direct maximisation as a generator, yielding after every Nelder-Mead
 * iteration. Each iteration is one or more complete Kalman filter runs over
 * the whole series, so a few hundred of them is seconds of work: on the main
 * thread that is a frozen tab, and a caller that cannot interrupt the loop
 * cannot offer a Cancel either. The yield is what makes both possible, the
 * same arrangement `emSteps` uses.
 */
export function* maximiseLikelihoodSteps(
  parameterise: (p: number[]) => LinearGaussianModel,
  start: number[],
  observations: Observation[],
  options: { maxIterations?: number; tolerance?: number; initialStep?: number } = {},
): Generator<FilterProgress, DirectFitResult, void> {
  const k = start.length;
  if (k === 0) throw new EngineError('Direct maximisation needs at least one free parameter.', 'required');
  const maxIter = options.maxIterations ?? 2000;
  const tol = options.tolerance ?? 1e-9;
  const step = options.initialStep ?? 0.1;

  const negLl = (p: number[]): number => {
    let model: LinearGaussianModel;
    try {
      model = parameterise(p);
    } catch {
      return Infinity; // Outside the admissible region; Nelder-Mead will back off.
    }
    try {
      const ll = kalmanFilter(model, observations).logLikelihood;
      return Number.isFinite(ll) ? -ll : Infinity;
    } catch {
      return Infinity;
    }
  };

  const simplex: { p: number[]; f: number }[] = [{ p: start.slice(), f: negLl(start) }];
  if (!Number.isFinite(simplex[0].f)) {
    throw new EngineError(
      'The starting parameters give no finite likelihood, so the search has nowhere to begin. Check that the start ' +
        'produces a valid model (positive-definite R, a usable prior).',
      'invalid',
    );
  }
  for (let i = 0; i < k; i++) {
    const p = start.slice();
    p[i] += step * (Math.abs(p[i]) > 0 ? Math.abs(p[i]) : 1);
    yield { completed: 0, total: maxIter };
    simplex.push({ p, f: negLl(p) });
  }
  let iterations = 0;
  let converged = false;
  for (; iterations < maxIter; iterations++) {
    const progress: FilterProgress = { completed: iterations, total: maxIter };
    if (iterations > 0) yield progress;
    simplex.sort((a, b) => a.f - b.f);
    const best = simplex[0];
    const worst = simplex[simplex.length - 1];
    if (Number.isFinite(worst.f) && Math.abs(worst.f - best.f) <= tol * (Math.abs(best.f) + 1)) {
      converged = true;
      break;
    }
    const centroid = new Array<number>(k).fill(0);
    for (let i = 0; i < simplex.length - 1; i++) for (let j = 0; j < k; j++) centroid[j] += simplex[i].p[j] / (simplex.length - 1);
    const reflect = centroid.map((c, j) => c + (c - worst.p[j]));
    // One objective evaluation is a complete Kalman filter run over the whole
    // series, so the yield is here rather than only at the top of the loop: a
    // single iteration would otherwise block for as long as all of its trial
    // points together.
    yield progress;
    const fr = negLl(reflect);
    if (fr < simplex[simplex.length - 2].f && fr >= best.f) {
      simplex[simplex.length - 1] = { p: reflect, f: fr };
      continue;
    }
    if (fr < best.f) {
      const expand = centroid.map((c, j) => c + 2 * (c - worst.p[j]));
      yield progress;
      const fe = negLl(expand);
      simplex[simplex.length - 1] = fe < fr ? { p: expand, f: fe } : { p: reflect, f: fr };
      continue;
    }
    const contract = centroid.map((c, j) => c + 0.5 * (worst.p[j] - c));
    yield progress;
    const fc = negLl(contract);
    if (fc < worst.f) {
      simplex[simplex.length - 1] = { p: contract, f: fc };
      continue;
    }
    for (let i = 1; i < simplex.length; i++) {
      const p = simplex[i].p.map((v, j) => best.p[j] + 0.5 * (v - best.p[j]));
      yield progress;
      simplex[i] = { p, f: negLl(p) };
    }
  }
  simplex.sort((a, b) => a.f - b.f);
  const bestPoint = simplex[0];
  const warnings: string[] = [];
  if (!converged) {
    warnings.push(
      `The Nelder-Mead search reached its iteration limit of ${maxIter} without the simplex collapsing to within ` +
        `${tol}. The parameters returned are the best point found, not a maximum.`,
    );
  }
  warnings.push(
    'Nelder-Mead finds a local optimum and provides no standard errors. Compare several starting points, and use the ' +
      'innovation diagnostics on the fitted model before relying on it.',
  );
  return {
    parameters: bestPoint.p,
    model: parameterise(bestPoint.p),
    logLikelihood: -bestPoint.f,
    iterations,
    converged,
    exactness: 'numerical',
    explanation: explainFiltering(
      'Direct maximisation of the exact Kalman likelihood (Nelder-Mead)',
      'numerical',
      [
        { label: 'Free parameters', value: String(k) },
        { label: 'Iterations', value: String(iterations) },
        { label: 'Converged', value: converged ? 'yes' : 'no' },
        { label: 'Log-likelihood', value: (-bestPoint.f).toFixed(6) },
      ],
      ['The likelihood evaluated is the exact one from the Kalman recursion; only the search over parameters is approximate.'],
      [
        'Derivative-free search: robust but slow, and it can stop at a local optimum or on a flat ridge.',
        'Parameters outside the admissible region are given an infinite objective, so a badly chosen parameterisation can wall the search in.',
      ],
    ),
    warnings,
  };
}

/**
 * Direct maximisation, run to completion. Identical to draining
 * `maximiseLikelihoodSteps`; kept for callers that have no progress to report.
 */
export function maximiseLikelihood(
  parameterise: (p: number[]) => LinearGaussianModel,
  start: number[],
  observations: Observation[],
  options: { maxIterations?: number; tolerance?: number; initialStep?: number } = {},
): DirectFitResult {
  const it = maximiseLikelihoodSteps(parameterise, start, observations, options);
  let s = it.next();
  while (!s.done) s = it.next();
  return s.value;
}

/** Sum of a column of numbers with compensated summation, exposed for callers. */
export function totalOf(values: number[]): number {
  return stableSum(values);
}

/** Identity-initialised model skeleton, a convenient EM starting point. */
export function defaultStart(n: number, m: number, options: { stateNames?: string[] } = {}): LinearGaussianModel {
  return {
    A: identity(n),
    C: m === n ? identity(n) : Array.from({ length: m }, (_, i) => Array.from({ length: n }, (_, j) => (j === i % n ? 1 : 0))),
    Q: identity(n),
    R: identity(m),
    mu0: new Array<number>(n).fill(0),
    Sigma0: identity(n).map((r) => r.map((v) => v * 10)),
    stateNames: options.stateNames,
  };
}

/** A·x for callers that only import this module. */
export function applyTransition(a: Mat, x: Vec): Vec {
  return matVec(a, x);
}
