/**
 * Exact Gaussian-process regression.
 *
 * ## The computation
 *
 * With training inputs X, targets y, kernel k and noise variance σ², write
 * K_y = K(X, X) + σ²·diag(w). Everything follows from ONE Cholesky
 * factorisation K_y = L·Lᵀ:
 *
 *     α      = L⁻ᵀ(L⁻¹ r)                      (r = y − F·β, the residual)
 *     mean   = f(x*)ᵀβ + k*ᵀα
 *     var    = k(x*, x*) − vᵀv,   v = L⁻¹k*    (+ a drift term, see below)
 *     log|K| = 2·Σ log Lᵢᵢ
 *     log p(y) = −½ rᵀα − Σ log Lᵢᵢ − (n/2)·log 2π
 *
 * No inverse is formed and no determinant is computed directly. The variance
 * is computed as k** − vᵀv rather than k** − k*ᵀK⁻¹k* for the same reason: the
 * triangular solve is stable where an inverse is not.
 *
 * ## Mean functions, and why they matter here
 *
 *  - `zero`: the textbook GP. The posterior mean reverts to 0 away from data.
 *  - `constant` with a value: a known mean — **simple kriging**.
 *  - `constant` without a value: the mean level is unknown and estimated by
 *    generalised least squares — this is exactly **ordinary kriging**, and the
 *    predictive variance picks up the extra term that accounts for not knowing
 *    the mean.
 *  - `polynomial`: a polynomial drift estimated the same way — **universal
 *    kriging**.
 *
 * Kriging and GP regression are the same mathematics; the tests cross-check
 * one against the other.
 *
 * ## Exactness
 *
 * Given the hyperparameters, the predictive mean and variance are `exact`
 * (a closed-form Gaussian conditional). Fitted hyperparameters are
 * `numerical`, and a model that needed jitter says so.
 */
import { EngineError, Validator, type Exactness, type Issue } from '../core/result';
import type { JobProgress } from '../core/progress';
import { normalQuantile } from '../special/gamma';
import { Random } from '../random/rng';
import type { Matrix } from '../stats/linalg';
import {
  choleskyInverseDiagonal,
  choleskySolve,
  choleskyWithJitter,
  logDetFromCholesky,
  minimizeLbfgs,
  solveLower,
  traceCholeskySolve,
  cholesky,
} from './linalg';
import { buildKernel, type Kernel, type KernelSpec } from './kernels';
import {
  GP_LIMITS,
  INTERVAL_LABEL,
  covarianceMemoryBytes,
  describeBytes,
  type ArdReport,
  type FitReport,
  type GpInterval,
  type GpPrediction,
  type JitterReport,
  type RestartOutcome,
} from './types';

export type MeanSpec =
  | { readonly kind: 'zero' }
  | { readonly kind: 'constant'; readonly value?: number }
  | { readonly kind: 'polynomial'; readonly degree: number };

export interface GpTrainingData {
  /** Inputs, one row per observation. Every row must have the same length. */
  readonly X: readonly (readonly number[])[];
  readonly y: readonly number[];
}

export interface GpModelRequest extends GpTrainingData {
  readonly kernel: KernelSpec;
  /** Kernel parameter values in slot order; the kernel's defaults when absent. */
  readonly kernelValues?: readonly number[];
  /**
   * Observation-noise variance σ². Zero means noise-free interpolation, which
   * is handled by jitter rather than by dividing by zero.
   */
  readonly noiseVariance: number;
  /**
   * Per-observation noise weights w (heteroskedastic noise): observation i has
   * noise variance σ²·wᵢ. Omit for equal noise.
   */
  readonly noiseWeights?: readonly number[];
  readonly mean?: MeanSpec;
  /** Override the exact-GP size limit. Still capped at GP_LIMITS.absoluteMaxN. */
  readonly maxExactN?: number;
}

export interface GpModel {
  readonly X: readonly (readonly number[])[];
  readonly y: readonly number[];
  readonly n: number;
  readonly dimension: number;
  readonly kernel: Kernel;
  readonly noiseVariance: number;
  readonly noiseWeights: readonly number[];
  readonly mean: MeanSpec;
  /** Lower Cholesky factor of K_y. */
  readonly L: Matrix;
  /** K_y⁻¹·residual. */
  readonly alpha: readonly number[];
  /** Drift coefficients, or null for a zero mean. */
  readonly beta: readonly number[] | null;
  /** Drift design matrix F (n×p), or null. */
  readonly basis: Matrix | null;
  /** Cholesky of FᵀK⁻¹F, for the drift contribution to the variance. */
  readonly driftL: Matrix | null;
  /** K⁻¹F, needed by the drift variance term. */
  readonly kInvBasis: Matrix | null;
  readonly logMarginalLikelihood: number;
  /** True when the mean was profiled out, making the likelihood a profile. */
  readonly profiled: boolean;
  readonly jitter: JitterReport;
  readonly warnings: readonly string[];
}

function basisRow(x: readonly number[], mean: MeanSpec): number[] | null {
  if (mean.kind === 'zero') return null;
  if (mean.kind === 'constant') return mean.value === undefined ? [1] : null;
  const row = [1];
  for (let deg = 1; deg <= mean.degree; deg++) {
    for (let i = 0; i < x.length; i++) row.push(Math.pow(x[i], deg));
  }
  return row;
}

function validateData(req: GpModelRequest): { X: number[][]; y: number[]; d: number; issues: Issue[] } {
  const v = new Validator();
  const X = req.X.map((row) => Array.from(row));
  const y = Array.from(req.y);
  if (X.length === 0) {
    v.add(
      'The training set is empty. A Gaussian process conditioned on no data is the prior, not a fit; call the prior functions explicitly if that is what you want.',
      'X',
      'required',
    );
    return { X, y, d: 0, issues: v.issues };
  }
  const d = X[0].length;
  if (d < 1) v.add('Training inputs must have at least one dimension.', 'X', 'range');
  for (let i = 0; i < X.length; i++) {
    if (X[i].length !== d) {
      v.add(`Training input ${i} has ${X[i].length} dimensions but input 0 has ${d}.`, 'X', 'length');
      break;
    }
    for (let j = 0; j < X[i].length; j++) {
      if (!Number.isFinite(X[i][j])) {
        v.add(`Training input ${i}, dimension ${j} is not a finite number.`, 'X', 'finite');
        break;
      }
    }
  }
  if (y.length !== X.length) {
    v.add(`There are ${X.length} training inputs but ${y.length} targets.`, 'y', 'length');
  }
  for (let i = 0; i < y.length; i++) {
    if (!Number.isFinite(y[i])) {
      v.add(`Training target ${i} is not a finite number.`, 'y', 'finite');
      break;
    }
  }
  return { X, y, d, issues: v.issues };
}

function resolveNoise(req: GpModelRequest, n: number): number[] {
  if (!Number.isFinite(req.noiseVariance) || req.noiseVariance < 0) {
    throw new EngineError(
      `The observation-noise variance must be a finite number of 0 or more; received ${req.noiseVariance}. A negative variance is not a variance, so no result is produced.`,
      'range',
    );
  }
  if (!req.noiseWeights) return new Array<number>(n).fill(1);
  if (req.noiseWeights.length !== n) {
    throw new EngineError(
      `Heteroskedastic noise needs one weight per observation: ${n} expected, ${req.noiseWeights.length} given.`,
      'length',
    );
  }
  const w = Array.from(req.noiseWeights);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(w[i]) || w[i] < 0) {
      throw new EngineError(`Noise weight ${i} must be a finite number of 0 or more; received ${w[i]}.`, 'range');
    }
  }
  return w;
}

function checkSizeLimit(n: number, maxExactN: number | undefined): void {
  const limit = Math.min(maxExactN ?? GP_LIMITS.maxExactN, GP_LIMITS.absoluteMaxN);
  if (n > limit) {
    throw new EngineError(
      `Exact Gaussian-process inference needs an n×n covariance matrix and its Cholesky factor: with n = ${n} that is ` +
        `${describeBytes(covarianceMemoryBytes(n))} of memory and roughly ${((n / 1000) ** 3).toPrecision(2)}×10⁹ ` +
        `floating-point operations, which would block the page. The exact limit for this request is n = ${limit} ` +
        `(absolute cap ${GP_LIMITS.absoluteMaxN}). Use a subset of the data or an inducing-point sparse approximation ` +
        'from this module instead — both are labelled as approximations with their bias direction — or raise maxExactN ' +
        'deliberately if you accept the cost.',
      'size',
    );
  }
}

/** Refuse duplicate inputs that carry different targets with no noise to explain it. */
function checkContradictoryDuplicates(X: number[][], y: number[], noise: number[], sigma2: number): void {
  const seen = new Map<string, number>();
  for (let i = 0; i < X.length; i++) {
    const key = X[i].join(',');
    const prev = seen.get(key);
    if (prev === undefined) {
      seen.set(key, i);
      continue;
    }
    const totalNoise = sigma2 * noise[i] + sigma2 * noise[prev];
    if (totalNoise === 0 && y[i] !== y[prev]) {
      throw new EngineError(
        `Observations ${prev} and ${i} have identical inputs (${X[i].join(', ')}) but different targets ` +
          `(${y[prev]} and ${y[i]}) with the noise variance set to 0. A noise-free GP must interpolate every point ` +
          'exactly, and no function can take two values at one input. Either set a positive noise variance or remove ' +
          'the contradiction; nothing is returned for an impossible model.',
        'contradiction',
      );
    }
  }
}

export function covarianceMatrix(k: Kernel, A: readonly (readonly number[])[], B?: readonly (readonly number[])[]): Matrix {
  const right = B ?? A;
  const out: Matrix = Array.from({ length: A.length }, () => new Array<number>(right.length).fill(0));
  if (!B) {
    for (let i = 0; i < A.length; i++) {
      for (let j = 0; j <= i; j++) {
        const v = k.k(A[i], A[j]);
        out[i][j] = v;
        out[j][i] = v;
      }
    }
    return out;
  }
  for (let i = 0; i < A.length; i++) for (let j = 0; j < right.length; j++) out[i][j] = k.k(A[i], right[j]);
  return out;
}

/**
 * Condition a GP on data. The hyperparameters are taken as given — this is
 * the `exact` part of the module.
 */
export function conditionGp(req: GpModelRequest): GpModel {
  const { X, y, d, issues } = validateData(req);
  if (issues.length) throw new EngineError(issues);
  const n = X.length;
  checkSizeLimit(n, req.maxExactN);
  const noiseWeights = resolveNoise(req, n);
  checkContradictoryDuplicates(X, y, noiseWeights, req.noiseVariance);
  const mean: MeanSpec = req.mean ?? { kind: 'zero' };
  if (mean.kind === 'polynomial' && (!Number.isInteger(mean.degree) || mean.degree < 0 || mean.degree > 3)) {
    throw new EngineError('A polynomial drift must have a whole degree between 0 and 3.', 'range');
  }
  const kernel = buildKernel(req.kernel, d, req.kernelValues);

  const K = covarianceMatrix(kernel, X);
  for (let i = 0; i < n; i++) K[i][i] += req.noiseVariance * noiseWeights[i];
  const { L, jitter } = choleskyWithJitter(K);

  const warnings: string[] = [];
  if (jitter.needed) warnings.push(jitter.note);
  if (req.noiseVariance === 0) {
    warnings.push(
      'The noise variance is 0, so this is noise-free interpolation: the posterior mean passes through every training ' +
        'target exactly and the latent variance at a training input is 0. The predictive interval for a new observation ' +
        'then coincides with the latent interval, because there is no noise to add.',
    );
  }

  // Drift (generalised least squares) when the mean is unknown.
  const rows = X.map((x) => basisRow(x, mean));
  let beta: number[] | null = null;
  let basis: Matrix | null = null;
  let driftL: Matrix | null = null;
  let kInvBasis: Matrix | null = null;
  let residual = y.slice();
  let profiled = false;
  if (mean.kind === 'constant' && mean.value !== undefined) {
    residual = y.map((v) => v - (mean.value as number));
  } else if (rows[0]) {
    basis = rows as Matrix;
    const p = basis[0].length;
    if (p >= n) {
      throw new EngineError(
        `The drift has ${p} coefficients but there are only ${n} observations: the mean is not identified and nothing can be estimated from it.`,
        'identifiability',
      );
    }
    kInvBasis = Array.from({ length: n }, () => new Array<number>(p).fill(0));
    for (let c = 0; c < p; c++) {
      const col = choleskySolve(
        L,
        basis.map((row) => row[c]),
      );
      for (let i = 0; i < n; i++) kInvBasis[i][c] = col[i];
    }
    // M = FᵀK⁻¹F (p×p), small.
    const M: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    for (let a = 0; a < p; a++) {
      for (let b = 0; b < p; b++) {
        let s = 0;
        for (let i = 0; i < n; i++) s += basis[i][a] * kInvBasis[i][b];
        M[a][b] = s;
      }
    }
    const ML = cholesky(M);
    if (!ML) {
      throw new EngineError(
        'The drift design matrix is collinear under the GP metric (FᵀK⁻¹F is singular), so the mean coefficients are not identified. Reduce the polynomial degree.',
        'identifiability',
      );
    }
    driftL = ML;
    const rhs = new Array<number>(p).fill(0);
    const kInvY = choleskySolve(L, y);
    for (let a = 0; a < p; a++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += basis[i][a] * kInvY[i];
      rhs[a] = s;
    }
    beta = choleskySolve(ML, rhs);
    residual = y.map((v, i) => v - basis![i].reduce((s, f, a) => s + f * beta![a], 0));
    profiled = true;
    warnings.push(
      'The mean function was estimated by generalised least squares and profiled out of the marginal likelihood. The ' +
        'reported log marginal likelihood is therefore a PROFILE likelihood at the fitted mean, not the integrated ' +
        'marginal likelihood, and comparisons with a zero-mean model are not like for like.',
    );
  }

  const alpha = choleskySolve(L, residual);
  let quad = 0;
  for (let i = 0; i < n; i++) quad += residual[i] * alpha[i];
  const logMarginalLikelihood = -0.5 * quad - 0.5 * logDetFromCholesky(L) - (n / 2) * Math.log(2 * Math.PI);

  return {
    X,
    y,
    n,
    dimension: d,
    kernel,
    noiseVariance: req.noiseVariance,
    noiseWeights,
    mean,
    L,
    alpha,
    beta,
    basis,
    driftL,
    kInvBasis,
    logMarginalLikelihood,
    profiled,
    jitter,
    warnings,
  };
}

function interval(center: number, sd: number, level: number, kind: GpInterval['kind']): GpInterval {
  const z = normalQuantile(0.5 + level / 2);
  return { kind, level, lower: center - z * sd, upper: center + z * sd, label: INTERVAL_LABEL[kind] };
}

export interface PredictOptions {
  /** Central mass of both intervals. Default 0.95. */
  readonly level?: number;
  /** Noise weight assumed for a new observation at each test input. Default 1. */
  readonly noiseWeights?: readonly number[];
}

export interface GpPredictionSet {
  readonly predictions: readonly GpPrediction[];
  /** 'exact' for an exact GP given its hyperparameters; 'numerical' for a sparse approximation. */
  readonly exactness: Exactness;
  readonly jitter: JitterReport;
  readonly warnings: readonly string[];
  readonly notes: readonly string[];
}

/** Posterior mean and the two variances at each test input. */
export function predictGp(
  model: GpModel,
  Xstar: readonly (readonly number[])[],
  options: PredictOptions = {},
): GpPredictionSet {
  const level = options.level ?? 0.95;
  if (!(level > 0 && level < 1)) {
    throw new EngineError(`The interval level must be strictly between 0 and 1; received ${level}.`, 'range');
  }
  if (Xstar.length === 0) {
    throw new EngineError('No test inputs were supplied, so there is nothing to predict.', 'required');
  }
  if (Xstar.length > GP_LIMITS.maxPredictPoints) {
    throw new EngineError(
      `${Xstar.length} test inputs exceeds the ${GP_LIMITS.maxPredictPoints}-point limit for one prediction call. Split the request.`,
      'size',
    );
  }
  for (const x of Xstar) {
    if (x.length !== model.dimension) {
      throw new EngineError(
        `Test inputs must have ${model.dimension} dimensions to match the training data; received ${x.length}.`,
        'length',
      );
    }
    for (const v of x) {
      if (!Number.isFinite(v)) throw new EngineError('Test inputs must be finite numbers.', 'finite');
    }
  }
  const warnings: string[] = [];
  const predictions: GpPrediction[] = [];
  const p = model.basis ? model.basis[0].length : 0;
  for (let t = 0; t < Xstar.length; t++) {
    const xs = Xstar[t];
    const kstar = model.X.map((xi) => model.kernel.k(xi, xs));
    const kss = model.kernel.k(xs, xs);
    const v = solveLower(model.L, kstar);
    let vv = 0;
    for (let i = 0; i < v.length; i++) vv += v[i] * v[i];
    let mean = 0;
    for (let i = 0; i < kstar.length; i++) mean += kstar[i] * model.alpha[i];
    let latentVariance = kss - vv;
    if (model.mean.kind === 'constant' && model.mean.value !== undefined) {
      mean += model.mean.value;
    } else if (model.basis && model.beta && model.driftL && model.kInvBasis) {
      const fs = basisRow(xs, model.mean);
      if (!fs) throw new EngineError('Internal: a drift model lost its basis.', 'internal');
      for (let a = 0; a < p; a++) mean += fs[a] * model.beta[a];
      // u = f(x*) − FᵀK⁻¹k*, and the variance gains uᵀ(FᵀK⁻¹F)⁻¹u: the price
      // of not knowing the mean. This is what makes ordinary kriging's
      // variance larger than simple kriging's.
      const u = new Array<number>(p).fill(0);
      for (let a = 0; a < p; a++) {
        let s = 0;
        for (let i = 0; i < model.n; i++) s += model.kInvBasis[i][a] * kstar[i];
        u[a] = fs[a] - s;
      }
      const w = solveLower(model.driftL, u);
      for (let a = 0; a < p; a++) latentVariance += w[a] * w[a];
    }
    if (latentVariance < 0) {
      const tol = 1e-8 * Math.max(kss, 1);
      if (latentVariance < -tol) {
        throw new EngineError(
          `The latent variance at test input ${t} came out as ${latentVariance.toExponential(3)}, which is negative by ` +
            'more than rounding error. The covariance matrix is too ill-conditioned for this prediction to mean ' +
            'anything; no number is returned. Increase the noise variance, remove near-duplicate inputs, or shorten ' +
            'the length scale.',
          'numerical',
        );
      }
      if (latentVariance < -Number.EPSILON) {
        warnings.push(
          `The latent variance at test input ${t} was ${latentVariance.toExponential(2)} — negative only by rounding ` +
            'error at a point effectively identical to a training input — and has been reported as 0.',
        );
      }
      latentVariance = 0;
    }
    const w = options.noiseWeights?.[t] ?? 1;
    const noiseVariance = model.noiseVariance * w;
    const predictiveVariance = latentVariance + noiseVariance;
    predictions.push({
      x: xs,
      mean,
      latentVariance,
      latentSd: Math.sqrt(latentVariance),
      latentInterval: interval(mean, Math.sqrt(latentVariance), level, 'latent-credible'),
      predictiveVariance,
      predictiveSd: Math.sqrt(predictiveVariance),
      predictiveInterval: interval(mean, Math.sqrt(predictiveVariance), level, 'predictive'),
      noiseVariance,
    });
  }
  return {
    predictions,
    exactness: 'exact',
    jitter: model.jitter,
    warnings: [...model.warnings, ...warnings],
    notes: [
      `${INTERVAL_LABEL['latent-credible']}: the uncertainty about the function itself.`,
      `${INTERVAL_LABEL.predictive}: the latent uncertainty PLUS the observation-noise variance ${model.noiseVariance}. ` +
        'It is the wider of the two and is the one to compare against new measurements.',
      'Both intervals are exact given the hyperparameters: they are the closed-form conditional of a joint Gaussian, not an approximation.',
    ],
  };
}

/** Full predictive covariance across test inputs — needed to sample functions. */
export function predictiveCovariance(model: GpModel, Xstar: readonly (readonly number[])[]): Matrix {
  const m = Xstar.length;
  const Kstar = covarianceMatrix(model.kernel, model.X, Xstar); // n×m
  const V: Matrix = [];
  for (let c = 0; c < m; c++) {
    V.push(solveLower(model.L, Kstar.map((row) => row[c])));
  }
  // V[c] is L⁻¹k*_c; Σ_cd = k(x_c, x_d) − V[c]·V[d].
  const out: Matrix = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  const p = model.basis ? model.basis[0].length : 0;
  const U: Matrix = [];
  if (model.basis && model.driftL && model.kInvBasis) {
    for (let c = 0; c < m; c++) {
      const fs = basisRow(Xstar[c], model.mean);
      if (!fs) throw new EngineError('Internal: a drift model lost its basis.', 'internal');
      const u = new Array<number>(p).fill(0);
      for (let a = 0; a < p; a++) {
        let s = 0;
        for (let i = 0; i < model.n; i++) s += model.kInvBasis[i][a] * Kstar[i][c];
        u[a] = fs[a] - s;
      }
      U.push(solveLower(model.driftL, u));
    }
  }
  for (let c = 0; c < m; c++) {
    for (let dd = 0; dd <= c; dd++) {
      let s = model.kernel.k(Xstar[c], Xstar[dd]);
      for (let i = 0; i < V[c].length; i++) s -= V[c][i] * V[dd][i];
      if (U.length) for (let a = 0; a < p; a++) s += U[c][a] * U[dd][a];
      out[c][dd] = s;
      out[dd][c] = s;
    }
  }
  return out;
}

export interface FunctionSamples {
  readonly Xstar: readonly (readonly number[])[];
  /** One row per sampled function. */
  readonly samples: readonly (readonly number[])[];
  readonly exactness: 'empirical';
  readonly jitter: JitterReport;
  readonly note: string;
}

/**
 * Draw whole functions from the posterior at the given inputs.
 *
 * Sampled functions are `empirical`: each is one draw, and the spread of a
 * finite set of draws is itself a Monte Carlo estimate. The intervals from
 * `predictGp` are the exact statement; the samples are for seeing what the
 * posterior looks like.
 */
export function samplePosteriorFunctions(
  model: GpModel,
  Xstar: readonly (readonly number[])[],
  count: number,
  seed: string,
): FunctionSamples {
  if (!Number.isInteger(count) || count < 1) {
    throw new EngineError(`The number of sampled functions must be a whole number of at least 1; received ${count}.`, 'range');
  }
  const means = predictGp(model, Xstar).predictions.map((p) => p.mean);
  const cov = predictiveCovariance(model, Xstar);
  const { L, jitter } = choleskyWithJitter(cov, { baseScale: Math.max(...cov.map((r, i) => Math.abs(r[i])), 1e-12) });
  const rng = new Random(`gp:posterior:${seed}`);
  const samples: number[][] = [];
  for (let s = 0; s < count; s++) {
    const z = Array.from({ length: Xstar.length }, () => rng.normal());
    samples.push(means.map((m, i) => m + L[i].reduce((acc, lij, j) => acc + lij * z[j], 0)));
  }
  return {
    Xstar,
    samples,
    exactness: 'empirical',
    jitter,
    note:
      'Each row is one draw of the whole function from the posterior, generated through the Cholesky factor of the ' +
      'predictive covariance, so the draws are correctly correlated across inputs. They are empirical: use the exact ' +
      'intervals for any quantitative statement.',
  };
}

/** Draw whole functions from the PRIOR — the GP before any data. */
export function samplePriorFunctions(
  spec: KernelSpec,
  dimension: number,
  Xstar: readonly (readonly number[])[],
  count: number,
  seed: string,
  kernelValues?: readonly number[],
  mean: MeanSpec = { kind: 'zero' },
): FunctionSamples {
  const k = buildKernel(spec, dimension, kernelValues);
  const cov = covarianceMatrix(k, Xstar);
  const { L, jitter } = choleskyWithJitter(cov);
  const offset = mean.kind === 'constant' && mean.value !== undefined ? mean.value : 0;
  const base = Xstar.map(() => offset);
  const rng = new Random(`gp:prior:${seed}`);
  const samples: number[][] = [];
  for (let s = 0; s < count; s++) {
    const z = Array.from({ length: Xstar.length }, () => rng.normal());
    samples.push(base.map((m, i) => m + L[i].reduce((acc, lij, j) => acc + lij * z[j], 0)));
  }
  return {
    Xstar,
    samples,
    exactness: 'empirical',
    jitter,
    note: 'Draws from the PRIOR over functions: what the kernel assumes before seeing any data.',
  };
}

/** The prior predictive at a point: mean 0 (or the known mean) and variance k(x, x). */
export function priorPrediction(
  spec: KernelSpec,
  dimension: number,
  Xstar: readonly (readonly number[])[],
  options: { readonly kernelValues?: readonly number[]; readonly noiseVariance?: number; readonly level?: number; readonly mean?: MeanSpec } = {},
): GpPredictionSet {
  const k = buildKernel(spec, dimension, options.kernelValues);
  const level = options.level ?? 0.95;
  const noise = options.noiseVariance ?? 0;
  const mean = options.mean ?? { kind: 'zero' };
  const m0 = mean.kind === 'constant' && mean.value !== undefined ? mean.value : 0;
  const predictions = Xstar.map((xs) => {
    const kss = k.k(xs, xs);
    return {
      x: xs,
      mean: m0,
      latentVariance: kss,
      latentSd: Math.sqrt(kss),
      latentInterval: interval(m0, Math.sqrt(kss), level, 'latent-credible'),
      predictiveVariance: kss + noise,
      predictiveSd: Math.sqrt(kss + noise),
      predictiveInterval: interval(m0, Math.sqrt(kss + noise), level, 'predictive'),
      noiseVariance: noise,
    };
  });
  return {
    predictions,
    exactness: 'exact',
    jitter: { added: 0, attempts: [], needed: false, note: 'No factorisation was needed: there is no data.' },
    warnings: [],
    notes: ['With no training data the posterior IS the prior: mean 0 (or the known mean) and variance k(x, x) exactly.'],
  };
}

/* ------------------------------------------------------------------ *
 * Leave-one-out cross-validation, in closed form
 * ------------------------------------------------------------------ */

export interface LooResult {
  /** LOO predictive mean for each training point. */
  readonly means: readonly number[];
  /** LOO predictive variance INCLUDING the noise, for each training point. */
  readonly variances: readonly number[];
  readonly residuals: readonly number[];
  /** Σ log N(yᵢ; μ₋ᵢ, σ²₋ᵢ): the log pseudo-likelihood. */
  readonly logPredictiveDensity: number;
  readonly meanSquaredError: number;
  /** Standardised residuals; well calibrated if their variance is near 1. */
  readonly standardisedResiduals: readonly number[];
  readonly exactness: 'exact';
  readonly note: string;
}

/**
 * Leave-one-out cross-validation from the Cholesky factor already computed.
 *
 * Rasmussen & Williams (2006) eq. 5.12: with α = K_y⁻¹y and cᵢ = [K_y⁻¹]ᵢᵢ,
 *
 *     μ₋ᵢ = yᵢ − αᵢ/cᵢ        σ²₋ᵢ = 1/cᵢ
 *
 * This is EXACT, not an approximation: refitting the GP n times gives the same
 * numbers (the tests check that against brute force). It is free given the
 * factorisation, which is why it is the cross-validation to use here.
 */
export function looCrossValidation(model: GpModel): LooResult {
  if (model.profiled) {
    throw new EngineError(
      'The closed-form leave-one-out identity assumes a fixed mean function. This model estimated its mean by ' +
        'generalised least squares, so leaving a point out would also change the mean estimate and the identity no ' +
        'longer holds. Refit with a zero or known mean, or do brute-force cross-validation deliberately.',
      'unsupported',
    );
  }
  const c = choleskyInverseDiagonal(model.L);
  const means: number[] = [];
  const variances: number[] = [];
  const residuals: number[] = [];
  const standardised: number[] = [];
  let lpd = 0;
  let sse = 0;
  for (let i = 0; i < model.n; i++) {
    if (!(c[i] > 0)) {
      throw new EngineError(
        `The leave-one-out identity needs a positive diagonal of K⁻¹; entry ${i} came out as ${c[i]}. The covariance matrix is too ill-conditioned for cross-validation here.`,
        'numerical',
      );
    }
    const mu = model.y[i] - model.alpha[i] / c[i];
    const varI = 1 / c[i];
    means.push(mu);
    variances.push(varI);
    const r = model.y[i] - mu;
    residuals.push(r);
    standardised.push(r / Math.sqrt(varI));
    sse += r * r;
    lpd += -0.5 * Math.log(2 * Math.PI * varI) - (r * r) / (2 * varI);
  }
  return {
    means,
    variances,
    residuals,
    logPredictiveDensity: lpd,
    meanSquaredError: sse / model.n,
    standardisedResiduals: standardised,
    exactness: 'exact',
    note:
      'Leave-one-out predictions computed in closed form from the single Cholesky factor. The variances INCLUDE the ' +
      'observation noise, because a left-out point is a noisy observation; the standardised residuals should have ' +
      'variance near 1 if the model is calibrated.',
  };
}

/* ------------------------------------------------------------------ *
 * Hyperparameter fitting
 * ------------------------------------------------------------------ */

export interface HyperObjective {
  /** Number of free log-parameters. */
  readonly size: number;
  readonly names: readonly string[];
  /** log marginal likelihood and its gradient with respect to the LOG parameters. */
  evaluate(logTheta: readonly number[]): { value: number; gradient: number[] };
  /** Build the model at a parameter vector. */
  model(logTheta: readonly number[]): GpModel;
}

export interface FitOptions {
  /** Fit the noise variance too. Default true unless noiseVariance is 0. */
  readonly fitNoise?: boolean;
  readonly restarts?: number;
  readonly seed?: string;
  readonly maxIterations?: number;
  /** Bounds on each log-parameter. Defaults to [log 1e-6, log 1e6]. */
  readonly logBounds?: readonly [number, number];
  /** Treat restarts as agreeing when their log marginal likelihoods differ by less than this. */
  readonly identifiabilityTolerance?: number;
}

/**
 * The log marginal likelihood as a function of the log-hyperparameters, with
 * its analytic gradient.
 *
 *     ∂/∂θ log p(y) = ½·tr((ααᵀ − K_y⁻¹)·∂K_y/∂θ)
 *
 * The trace is evaluated as trace(K_y⁻¹·∂K) via n triangular solves — the
 * inverse is never formed — and the chain rule to log space multiplies by θ.
 */
export function hyperObjective(req: GpModelRequest, options: FitOptions = {}): HyperObjective {
  const { X, y, d, issues } = validateData(req);
  if (issues.length) throw new EngineError(issues);
  const n = X.length;
  checkSizeLimit(n, req.maxExactN);
  const weights = resolveNoise(req, n);
  const probe = buildKernel(req.kernel, d, req.kernelValues);
  const trainable = probe.trainableIndices;
  const fitNoise = options.fitNoise ?? req.noiseVariance > 0;
  if (fitNoise && !(req.noiseVariance > 0)) {
    throw new EngineError(
      'Fitting the noise variance needs a positive starting value: log(0) is not a number. Give a small positive noiseVariance as the starting point, or set fitNoise: false for noise-free interpolation.',
      'range',
    );
  }
  const names = [...trainable.map((i) => probe.slots[i].name), ...(fitNoise ? ['noiseVariance'] : [])];
  const size = names.length;
  if (size === 0) {
    throw new EngineError('This model has no trainable hyperparameters, so there is nothing to fit.', 'required');
  }

  const expand = (logTheta: readonly number[]): { values: number[]; noise: number } => {
    const values = Array.from(probe.values);
    for (let j = 0; j < trainable.length; j++) {
      const slot = probe.slots[trainable[j]];
      const raw = Math.exp(logTheta[j]);
      values[trainable[j]] = slot.positive ? raw : logTheta[j];
    }
    const noise = fitNoise ? Math.exp(logTheta[trainable.length]) : req.noiseVariance;
    return { values, noise };
  };

  return {
    size,
    names,
    model(logTheta) {
      const { values, noise } = expand(logTheta);
      return conditionGp({ ...req, kernelValues: values, noiseVariance: noise });
    },
    evaluate(logTheta) {
      const { values, noise } = expand(logTheta);
      const k = buildKernel(req.kernel, d, values);
      const K = covarianceMatrix(k, X);
      for (let i = 0; i < n; i++) K[i][i] += noise * weights[i];
      const factored = choleskyWithJitter(K);
      const L = factored.L;
      const alpha = choleskySolve(L, y);
      let quad = 0;
      for (let i = 0; i < n; i++) quad += y[i] * alpha[i];
      const value = -0.5 * quad - 0.5 * logDetFromCholesky(L) - (n / 2) * Math.log(2 * Math.PI);

      // Gradient matrices: one grad() call per pair gives every slot at once.
      const gradients: Matrix[] = trainable.map(() => Array.from({ length: n }, () => new Array<number>(n).fill(0)));
      for (let i = 0; i < n; i++) {
        for (let jj = 0; jj <= i; jj++) {
          const g = k.grad(X[i], X[jj]);
          for (let t = 0; t < trainable.length; t++) {
            const v = g[trainable[t]];
            gradients[t][i][jj] = v;
            gradients[t][jj][i] = v;
          }
        }
      }
      const gradient = new Array<number>(size).fill(0);
      for (let t = 0; t < trainable.length; t++) {
        const G = gradients[t];
        let quadTerm = 0;
        for (let i = 0; i < n; i++) {
          let s = 0;
          for (let jj = 0; jj < n; jj++) s += G[i][jj] * alpha[jj];
          quadTerm += alpha[i] * s;
        }
        const tr = traceCholeskySolve(L, G);
        const dTheta = 0.5 * (quadTerm - tr);
        const slot = probe.slots[trainable[t]];
        gradient[t] = slot.positive ? dTheta * values[trainable[t]] : dTheta;
      }
      if (fitNoise) {
        const diag = choleskyInverseDiagonal(L);
        let quadTerm = 0;
        let tr = 0;
        for (let i = 0; i < n; i++) {
          quadTerm += weights[i] * alpha[i] * alpha[i];
          tr += weights[i] * diag[i];
        }
        gradient[trainable.length] = 0.5 * (quadTerm - tr) * noise;
      }
      return { value, gradient };
    },
  };
}

/**
 * Fit the hyperparameters by maximising the log marginal likelihood from
 * several starting points.
 *
 * **Why multiple restarts are not optional.** The marginal likelihood of a GP
 * is multimodal: there is typically one optimum that explains the data as
 * signal with a short length scale and another that explains it as noise with
 * a long one. A single restart lands in whichever basin the initialisation
 * happened to sit in and then reports a confident, over- or under-smoothed
 * fit with no indication that a different answer was available. This function
 * therefore runs several restarts and reports the spread across them: if the
 * attained marginal likelihoods differ materially, the fit is NOT identified
 * and the point estimate should not be trusted on its own.
 *
 * Refuses when no restart converges, rather than returning the best failure.
 */
export function* fitHyperparametersSteps(
  req: GpModelRequest,
  options: FitOptions = {},
): Generator<JobProgress, { readonly model: GpModel; readonly fit: FitReport; readonly objective: HyperObjective }, void> {
  const objective = hyperObjective(req, options);
  const restarts = options.restarts ?? 8;
  if (!Number.isInteger(restarts) || restarts < 1) {
    throw new EngineError(`The number of restarts must be a whole number of at least 1; received ${restarts}.`, 'range');
  }
  const bounds = options.logBounds ?? [Math.log(1e-6), Math.log(1e6)];
  const box = Array.from({ length: objective.size }, () => bounds);
  const rng = new Random(`gp:fit:${options.seed ?? 'default'}`);
  const start0 = startingPoint(req, objective);
  const outcomes: RestartOutcome[] = [];
  for (let r = 0; r < restarts; r++) {
    const start =
      r === 0
        ? start0
        : start0.map((v) => {
            // Restarts are spread over roughly four orders of magnitude in the
            // natural parameters: enough to land in a different basin.
            const jitter = (rng.uniform() * 2 - 1) * Math.log(100);
            return Math.min(Math.max(v + jitter, bounds[0]), bounds[1]);
          });
    const res = minimizeLbfgs(
      (x) => {
        const e = objective.evaluate(x);
        return { value: -e.value, gradient: e.gradient.map((g) => -g) };
      },
      start,
      { bounds: box, maxIterations: options.maxIterations ?? 150 },
    );
    yield { completed: r + 1, total: restarts, label: `Restart ${r + 1} of ${restarts}` };
    outcomes.push({
      restart: r,
      startLog: start,
      finalLog: res.x,
      logMarginalLikelihood: -res.value,
      converged: res.converged,
      iterations: res.iterations,
      reason: res.reason,
    });
  }
  const converged = outcomes.filter((o) => o.converged && Number.isFinite(o.logMarginalLikelihood));
  if (converged.length === 0) {
    throw new EngineError(
      `None of the ${restarts} restarts of the marginal-likelihood optimiser converged. Reasons: ` +
        `${outcomes.map((o) => `restart ${o.restart}: ${o.reason}`).join(' | ')}. No hyperparameter estimate is ` +
        'reported, because an unconverged optimum is not an estimate. Try a different kernel, rescale the inputs, or ' +
        'widen the parameter bounds.',
      'non-convergence',
    );
  }
  const best = converged.reduce((a, b) => (b.logMarginalLikelihood > a.logMarginalLikelihood ? b : a));
  const lmls = converged.map((o) => o.logMarginalLikelihood);
  const lo = Math.min(...lmls);
  const hi = Math.max(...lmls);
  const meanLml = lmls.reduce((s, v) => s + v, 0) / lmls.length;
  const sd =
    lmls.length > 1 ? Math.sqrt(lmls.reduce((s, v) => s + (v - meanLml) ** 2, 0) / (lmls.length - 1)) : 0;
  const tol = options.identifiabilityTolerance ?? 1;
  const identifiable = hi - lo <= tol;
  const model = objective.model(best.finalLog);
  const fit: FitReport = {
    restarts,
    convergedRestarts: converged.length,
    best,
    outcomes,
    logMarginalLikelihoodRange: [lo, hi],
    logMarginalLikelihoodSd: sd,
    identifiable,
    exactness: 'numerical',
    note: identifiable
      ? `${converged.length} of ${restarts} restarts converged and all reached within ${tol} log unit of the best ` +
        `log marginal likelihood (${best.logMarginalLikelihood.toFixed(3)}), so the fit appears identified.`
      : `${converged.length} of ${restarts} restarts converged but they reached log marginal likelihoods spanning ` +
        `${lo.toFixed(3)} to ${hi.toFixed(3)} — a spread of ${(hi - lo).toFixed(3)}. The marginal likelihood is ` +
        'multimodal here and the hyperparameters are NOT identified by this data: the best optimum is reported, but ' +
        'a different, materially different fit explains the data almost as well. Treat the point estimate with ' +
        'suspicion and consider the fully Bayesian treatment instead.',
  };
  return { model, fit, objective };
}

/**
 * Fit the hyperparameters, driven to completion on the calling thread. Prefer
 * `fitHyperparametersSteps` (or the `gp.fit-hyperparameters` engine job) on
 * the main thread: with several restarts this blocks for seconds.
 */
export function fitHyperparameters(
  req: GpModelRequest,
  options: FitOptions = {},
): { readonly model: GpModel; readonly fit: FitReport; readonly objective: HyperObjective } {
  const steps = fitHyperparametersSteps(req, options);
  let s = steps.next();
  while (!s.done) s = steps.next();
  return s.value;
}

/** Data-driven starting point: median input spacing, variance of y, small noise. */
function startingPoint(req: GpModelRequest, objective: HyperObjective): number[] {
  const X = req.X.map((r) => Array.from(r));
  const y = Array.from(req.y);
  const n = X.length;
  const d = X[0].length;
  const spacing: number[] = [];
  for (let i = 0; i < Math.min(n, 60); i++) {
    for (let j = i + 1; j < Math.min(n, 60); j++) {
      let s = 0;
      for (let a = 0; a < d; a++) s += (X[i][a] - X[j][a]) ** 2;
      if (s > 0) spacing.push(Math.sqrt(s));
    }
  }
  spacing.sort((a, b) => a - b);
  const medianSpacing = spacing.length ? spacing[Math.floor(spacing.length / 2)] : 1;
  const ymean = y.reduce((s, v) => s + v, 0) / n;
  const yvar = Math.max(y.reduce((s, v) => s + (v - ymean) ** 2, 0) / Math.max(n - 1, 1), 1e-6);
  return objective.names.map((name) => {
    if (name === 'noiseVariance') return Math.log(Math.max(req.noiseVariance, yvar * 0.01));
    if (name.includes('lengthScale')) return Math.log(Math.max(medianSpacing, 1e-6));
    if (name.includes('period')) return Math.log(Math.max(medianSpacing * 4, 1e-6));
    if (name.includes('variance')) return Math.log(yvar);
    if (name.includes('alpha')) return 0;
    if (name.includes('bias')) return 0;
    return 0;
  });
}

/**
 * Automatic relevance determination: rank the inputs by their fitted length
 * scales. A short length scale in dimension i means the output changes fast
 * along it; a very long one means that input is close to irrelevant.
 *
 * This is a free sensitivity analysis and it complements the Sobol indices in
 * `src/engine/sensitivity/`: ARD measures how fast the function varies per
 * input under the GP's stationary prior, whereas a Sobol index measures how
 * much of the OUTPUT VARIANCE a given input accounts for under an input
 * distribution. They answer different questions and can disagree.
 */
export function ardReport(model: GpModel): ArdReport | null {
  const slots = model.kernel.lengthScaleSlots;
  if (slots.length === 0) return null;
  const byDim = new Map<number, number[]>();
  for (const s of slots) {
    const dim = model.kernel.slots[s].dimension;
    if (dim === null) continue;
    const list = byDim.get(dim) ?? [];
    list.push(model.kernel.values[s]);
    byDim.set(dim, list);
  }
  if (byDim.size < 1) return null;
  const raw = Array.from(byDim.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([dim, values]) => ({
      dimension: dim,
      // With several length-scale groups (a sum of kernels) the geometric mean
      // is used, so the ranking is not dominated by whichever term happens to
      // have the largest scale.
      lengthScale: Math.exp(values.reduce((s, v) => s + Math.log(v), 0) / values.length),
    }));
  const total = raw.reduce((s, e) => s + 1 / e.lengthScale, 0);
  const ranked = raw
    .map((e) => ({ ...e, relevance: 1 / e.lengthScale, relevanceShare: 1 / e.lengthScale / total }))
    .sort((a, b) => b.relevance - a.relevance)
    .map((e, i) => ({ ...e, rank: i + 1 }))
    .sort((a, b) => a.dimension - b.dimension);
  return {
    entries: ranked,
    exactness: 'numerical',
    note:
      'Relevance is 1/ℓᵢ from the fitted per-dimension length scales. Rank 1 is the input the function varies fastest ' +
      'in. These are hyperparameter estimates, so they inherit the identifiability of the fit: check the restart ' +
      'spread before reading much into a ranking.',
    limitations: [
      'ARD relevance is not a variance decomposition. A Sobol index answers a different question and the two can disagree.',
      'Relevance is scale-dependent: an input measured in millimetres gets a short length scale for no substantive reason. Standardise the inputs before comparing.',
      'A length scale pushed to its upper bound means "this input appears irrelevant", not "this input is irrelevant".',
    ],
  };
}
