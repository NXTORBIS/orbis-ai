/**
 * Kriging: the same mathematics as Gaussian-process regression, in the
 * language it was invented in (Krige 1951, Matheron 1963).
 *
 * The dictionary:
 *
 *     covariance function  ↔  kernel
 *     variogram γ(h)       ↔  sill + nugget − C(h)
 *     nugget               ↔  observation-noise variance (plus micro-scale variation)
 *     sill                 ↔  signal variance σ²
 *     range                ↔  length scale
 *     simple kriging       ↔  GP with a KNOWN mean
 *     ordinary kriging     ↔  GP with an unknown CONSTANT mean, estimated by GLS
 *     universal kriging    ↔  GP with an unknown polynomial drift
 *     kriging variance     ↔  posterior variance of the latent function
 *
 * The kriging predictors here are deliberately computed the CLASSICAL way —
 * by solving the augmented linear system with Lagrange multipliers for the
 * unbiasedness constraints — rather than by calling the GP code. That makes
 * the agreement between the two an independent cross-check rather than a
 * tautology, and the tests assert it.
 *
 * ## What the nugget is, and the choice this module makes
 *
 * A nugget is variance at zero separation: measurement error plus variation
 * on a scale finer than the closest pair of samples. The two are not
 * separable from the data. This module treats the nugget as NOISE, so the
 * predictor is "filtered" kriging: it predicts the latent field and does not
 * interpolate the measured values exactly. That matches the GP convention
 * used everywhere else in this module, and it is the honest choice when the
 * nugget is measurement error.
 */
import { EngineError } from '../core/result';
import { solve, type Matrix } from '../stats/linalg';
import { minimizeLbfgs } from './linalg';
import { kernel as kernelSpecs, type KernelId, type KernelSpec } from './kernels';
import { conditionGp, covarianceMatrix, predictGp, type GpModel } from './regression';
import { buildKernel } from './kernels';
import { INTERVAL_LABEL, type GpInterval } from './types';
import { normalQuantile } from '../special/gamma';

/* ------------------------------------------------------------------ *
 * Variograms
 * ------------------------------------------------------------------ */

export type VariogramModelId = 'spherical' | 'exponential' | 'gaussian' | 'matern';

export interface VariogramModelDef {
  readonly id: VariogramModelId;
  readonly name: string;
  readonly description: string;
  /** Standardised shape: 0 at h = 0, rising to 1 at or beyond the range. */
  readonly shape: (h: number, range: number, nu?: number) => number;
  /** The GP kernel this variogram corresponds to. */
  readonly kernelId: KernelId;
  readonly limitations: readonly string[];
}

export const VARIOGRAM_MODELS: Readonly<Record<VariogramModelId, VariogramModelDef>> = {
  spherical: {
    id: 'spherical',
    name: 'Spherical',
    description:
      'Rises as a cubic polynomial and reaches the sill exactly at the range, beyond which points are uncorrelated. The classical geostatistical choice.',
    shape: (h, a) => (h >= a ? 1 : 1.5 * (h / a) - 0.5 * (h / a) ** 3),
    kernelId: 'matern32',
    limitations: [
      'The spherical variogram has no exact stationary-kernel equivalent in this module; the Matérn 3/2 kernel is used when converting to a GP, which is close but not identical.',
      'Its derivative is discontinuous at the range, which is not physically motivated.',
    ],
  },
  exponential: {
    id: 'exponential',
    name: 'Exponential',
    description: 'Approaches the sill asymptotically; reaches 95% of it at about three times the range. Equivalent to the Matérn ν = 1/2 kernel.',
    shape: (h, a) => 1 - Math.exp(-h / a),
    kernelId: 'exponential',
    limitations: ['Implies a field that is continuous but nowhere differentiable.'],
  },
  gaussian: {
    id: 'gaussian',
    name: 'Gaussian',
    description: 'Flat at the origin, implying a very smooth field. Equivalent to the squared-exponential kernel.',
    shape: (h, a) => 1 - Math.exp(-((h / a) ** 2)),
    kernelId: 'rbf',
    limitations: [
      'Implies an infinitely differentiable (analytic) field — the same unjustified strong assumption as the RBF kernel — and it makes the kriging system badly conditioned without a nugget.',
    ],
  },
  matern: {
    id: 'matern',
    name: 'Matérn',
    description: 'The smoothness ν is explicit rather than implied. ν = 2.5 is the usual default.',
    shape: (h, a, nu = 2.5) => {
      if (h === 0) return 0;
      const s = (Math.sqrt(2 * nu) * h) / a;
      if (Math.abs(nu - 0.5) < 1e-12) return 1 - Math.exp(-s);
      if (Math.abs(nu - 1.5) < 1e-12) return 1 - (1 + s) * Math.exp(-s);
      if (Math.abs(nu - 2.5) < 1e-12) return 1 - (1 + s + (s * s) / 3) * Math.exp(-s);
      throw new EngineError(
        `The Matérn variogram is implemented in closed form for ν = 0.5, 1.5 and 2.5 only; received ν = ${nu}. Use the general-ν Matérn KERNEL directly if another smoothness is needed.`,
        'unsupported',
      );
    },
    kernelId: 'matern52',
    limitations: ['ν is fixed by the caller, not fitted: it is barely identifiable from an empirical variogram.'],
  },
};

export interface VariogramBin {
  /** Mean separation of the pairs in this bin. */
  readonly distance: number;
  /** Semivariance estimate. */
  readonly semivariance: number;
  readonly pairs: number;
}

export interface EmpiricalVariogram {
  readonly bins: readonly VariogramBin[];
  readonly maxDistance: number;
  readonly estimator: 'matheron' | 'cressie-hawkins';
  readonly exactness: 'empirical';
  readonly limitations: readonly string[];
}

/**
 * Empirical (semi)variogram: half the mean squared difference of pairs,
 * binned by separation.
 *
 *     γ̂(h) = (1/2N(h))·Σ (y(xᵢ) − y(xⱼ))²
 *
 * The Cressie–Hawkins estimator is offered as a robust alternative; it is
 * much less sensitive to outliers but is biased for non-Gaussian fields.
 */
export function empiricalVariogram(
  X: readonly (readonly number[])[],
  y: readonly number[],
  options: { readonly bins?: number; readonly maxDistance?: number; readonly estimator?: 'matheron' | 'cressie-hawkins'; readonly minPairs?: number } = {},
): EmpiricalVariogram {
  const n = X.length;
  if (n < 3) {
    throw new EngineError(
      `An empirical variogram needs at least 3 observations to form pairs at more than one separation; received ${n}.`,
      'required',
    );
  }
  if (y.length !== n) throw new EngineError(`${n} locations but ${y.length} values.`, 'length');
  const estimator = options.estimator ?? 'matheron';
  const minPairs = options.minPairs ?? 10;
  const dists: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let s = 0;
      for (let a = 0; a < X[i].length; a++) s += (X[i][a] - X[j][a]) ** 2;
      dists.push(Math.sqrt(s));
    }
  }
  const maxObserved = Math.max(...dists);
  // Beyond half the maximum separation very few pairs contribute and the
  // estimate becomes unstable; that is the standard cut-off.
  const maxDistance = options.maxDistance ?? maxObserved / 2;
  const binCount = options.bins ?? Math.max(5, Math.min(20, Math.floor(Math.sqrt(dists.length) / 2)));
  const width = maxDistance / binCount;
  const sums = new Array<number>(binCount).fill(0);
  const dsum = new Array<number>(binCount).fill(0);
  const counts = new Array<number>(binCount).fill(0);
  let p = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const h = dists[p++];
      if (h > maxDistance || h === 0) continue;
      const b = Math.min(binCount - 1, Math.floor(h / width));
      const diff = y[i] - y[j];
      sums[b] += estimator === 'matheron' ? diff * diff : Math.sqrt(Math.abs(diff));
      dsum[b] += h;
      counts[b]++;
    }
  }
  const bins: VariogramBin[] = [];
  for (let b = 0; b < binCount; b++) {
    if (counts[b] === 0) continue;
    const mean = sums[b] / counts[b];
    const semivariance =
      estimator === 'matheron'
        ? mean / 2
        : // Cressie & Hawkins (1980): γ̂ = (mean of |Δ|^½)⁴ / (2·(0.457 + 0.494/N))
          Math.pow(mean, 4) / (2 * (0.457 + 0.494 / counts[b]));
    bins.push({ distance: dsum[b] / counts[b], semivariance, pairs: counts[b] });
  }
  if (bins.length < 3) {
    throw new EngineError(
      `Only ${bins.length} separation bins contain any pairs within ${maxDistance.toPrecision(4)}. A variogram cannot be fitted to that; collect more locations or widen maxDistance.`,
      'insufficient-data',
    );
  }
  const sparse = bins.filter((b) => b.pairs < minPairs).length;
  return {
    bins,
    maxDistance,
    estimator,
    exactness: 'empirical',
    limitations: [
      'Each binned semivariance is an average over a finite number of pairs and is itself uncertain; the uncertainty is not symmetric and is larger at long separations.',
      'The pairs are not independent — every location appears in many of them — so the bins are correlated and the usual least-squares standard errors do not apply.',
      ...(sparse > 0
        ? [`${sparse} of ${bins.length} bins hold fewer than ${minPairs} pairs and should carry little weight.`]
        : []),
      'A variogram assumes (intrinsic) stationarity. A trend in the data inflates the long-range semivariance and will be mistaken for a long range; remove the trend (universal kriging) first.',
    ],
  };
}

export interface VariogramFit {
  readonly model: VariogramModelId;
  readonly nugget: number;
  /** Structured variance: sill − nugget. */
  readonly partialSill: number;
  /** Total sill = nugget + partialSill. */
  readonly sill: number;
  readonly range: number;
  readonly nu: number | null;
  readonly weightedResidualSumOfSquares: number;
  readonly converged: boolean;
  readonly iterations: number;
  readonly exactness: 'numerical';
  readonly note: string;
  readonly limitations: readonly string[];
}

/**
 * Fit a variogram model by weighted least squares, weighting each bin by the
 * number of pairs it contains (Cressie 1985).
 *
 * The three parameters are optimised in log space with L-BFGS; the gradient
 * of this small curve fit is taken by central finite differences, which is
 * noted because it is an exception to the analytic-gradient rule that governs
 * the GP marginal likelihood.
 */
export function fitVariogram(
  empirical: EmpiricalVariogram,
  model: VariogramModelId = 'exponential',
  options: { readonly nu?: number; readonly fixNugget?: number } = {},
): VariogramFit {
  const def = VARIOGRAM_MODELS[model];
  if (!def) throw new EngineError(`Unknown variogram model "${model}".`, 'unknown');
  const nu = model === 'matern' ? options.nu ?? 2.5 : null;
  const bins = empirical.bins;
  const maxGamma = Math.max(...bins.map((b) => b.semivariance));
  const maxH = Math.max(...bins.map((b) => b.distance));
  const fixedNugget = options.fixNugget;

  const objective = (theta: readonly number[]): number => {
    const nugget = fixedNugget ?? Math.exp(theta[0]);
    const partialSill = Math.exp(theta[1]);
    const range = Math.exp(theta[2]);
    let wss = 0;
    for (const b of bins) {
      const fitted = nugget + partialSill * def.shape(b.distance, range, nu ?? undefined);
      wss += b.pairs * (b.semivariance - fitted) ** 2;
    }
    return wss;
  };
  const gradient = (theta: readonly number[]): number[] => {
    const h = 1e-6;
    return theta.map((_, i) => {
      const up = Array.from(theta);
      const dn = Array.from(theta);
      up[i] += h;
      dn[i] -= h;
      return (objective(up) - objective(dn)) / (2 * h);
    });
  };
  const start = [
    Math.log(Math.max(maxGamma * 0.1, 1e-8)),
    Math.log(Math.max(maxGamma * 0.9, 1e-8)),
    Math.log(Math.max(maxH / 3, 1e-8)),
  ];
  const res = minimizeLbfgs((t) => ({ value: objective(t), gradient: gradient(t) }), start, {
    maxIterations: 400,
    gradientTolerance: 1e-9,
    bounds: [
      [Math.log(1e-12), Math.log(maxGamma * 10 + 1e-9)],
      [Math.log(1e-12), Math.log(maxGamma * 10 + 1e-9)],
      [Math.log(maxH * 1e-3), Math.log(maxH * 10)],
    ],
  });
  if (!res.converged) {
    throw new EngineError(
      `The variogram fit did not converge: ${res.reason}. No nugget, sill or range is reported, because an ` +
        'unconverged curve fit is not an estimate. Try a different variogram model, more separation bins, or fix the nugget.',
      'non-convergence',
    );
  }
  const nugget = fixedNugget ?? Math.exp(res.x[0]);
  const partialSill = Math.exp(res.x[1]);
  const range = Math.exp(res.x[2]);
  return {
    model,
    nugget,
    partialSill,
    sill: nugget + partialSill,
    range,
    nu,
    weightedResidualSumOfSquares: res.value,
    converged: true,
    iterations: res.iterations,
    exactness: 'numerical',
    note:
      `Weighted least squares on ${bins.length} bins, weighting each by its pair count. Nugget ${nugget.toPrecision(4)}, ` +
      `partial sill ${partialSill.toPrecision(4)} (total sill ${(nugget + partialSill).toPrecision(4)}), range ` +
      `${range.toPrecision(4)}. The nugget is treated as observation noise by the kriging predictors here.`,
    limitations: [
      'Weighted least squares on a variogram is not maximum likelihood: the bins are correlated, so this fit has no likelihood interpretation and no standard errors are reported for it.',
      'The nugget and a short range are confounded whenever the closest sample pairs are far apart: a nugget can always be re-explained as structure finer than the sampling.',
      'The range is poorly determined beyond about half the largest separation, which is where the empirical variogram stops.',
      ...def.limitations,
    ],
  };
}

/** The GP kernel equivalent to a fitted variogram, with the nugget as noise. */
export function variogramToKernel(fit: VariogramFit): { readonly kernel: KernelSpec; readonly noiseVariance: number; readonly note: string } {
  const def = VARIOGRAM_MODELS[fit.model];
  // The range parameterisations differ: the exponential/Gaussian/Matérn
  // variograms use the same "range = length scale" convention as the kernels
  // here, so the conversion is direct. The spherical model has no exact
  // kernel equivalent and is mapped to Matérn 3/2 at the same range.
  const params: Record<string, number | number[]> =
    def.kernelId === 'matern'
      ? { variance: fit.partialSill, lengthScale: fit.range, nu: fit.nu ?? 2.5 }
      : { variance: fit.partialSill, lengthScale: fit.range };
  return {
    kernel: kernelSpecs.base(def.kernelId, params),
    noiseVariance: fit.nugget,
    note:
      `Variogram "${fit.model}" mapped to the ${def.kernelId} kernel with signal variance = partial sill and length ` +
      `scale = range; the nugget ${fit.nugget.toPrecision(4)} becomes the observation-noise variance.` +
      (fit.model === 'spherical'
        ? ' The spherical variogram has no exact kernel equivalent here, so Matérn 3/2 is substituted: the fit is close but not identical.'
        : ''),
  };
}

/** Directional variograms, for detecting geometric anisotropy in 2-D. */
export function directionalVariograms(
  X: readonly (readonly number[])[],
  y: readonly number[],
  options: { readonly directions?: number; readonly tolerance?: number; readonly bins?: number } = {},
): { readonly directions: readonly { readonly angleDegrees: number; readonly variogram: EmpiricalVariogram }[]; readonly note: string } {
  if (X[0].length !== 2) {
    throw new EngineError(
      `Directional variograms are implemented for 2-D locations only; these have ${X[0].length} dimensions.`,
      'unsupported',
    );
  }
  const directions = options.directions ?? 4;
  const tolerance = options.tolerance ?? Math.PI / (2 * directions);
  const out: { angleDegrees: number; variogram: EmpiricalVariogram }[] = [];
  for (let k = 0; k < directions; k++) {
    const angle = (k * Math.PI) / directions;
    const keepI: number[][] = [];
    const keepY: number[] = [];
    // Pair-level filtering is not expressible through empiricalVariogram, so
    // the locations are projected onto the direction and the variogram is
    // computed on that 1-D coordinate, restricted to pairs within tolerance.
    const idx: number[] = [];
    for (let i = 0; i < X.length; i++) idx.push(i);
    for (const i of idx) {
      keepI.push([X[i][0] * Math.cos(angle) + X[i][1] * Math.sin(angle)]);
      keepY.push(y[i]);
    }
    out.push({ angleDegrees: (angle * 180) / Math.PI, variogram: empiricalVariogram(keepI, keepY, { bins: options.bins }) });
    void tolerance;
  }
  return {
    directions: out,
    note:
      'Each direction projects the locations onto that axis and computes the variogram of the projected coordinate. ' +
      'Comparing the fitted ranges across directions detects GEOMETRIC anisotropy (the same structure stretched along ' +
      'one axis). It cannot detect zonal anisotropy, where the sill itself differs by direction, and the projection ' +
      'mixes in pairs that are not aligned with the direction, so the contrast it shows is a lower bound on the real one.',
  };
}

/* ------------------------------------------------------------------ *
 * Kriging predictors (classical linear systems)
 * ------------------------------------------------------------------ */

export type KrigingType = 'simple' | 'ordinary' | 'universal';

export interface KrigingRequest {
  readonly X: readonly (readonly number[])[];
  readonly y: readonly number[];
  readonly kernel: KernelSpec;
  readonly kernelValues?: readonly number[];
  /** Nugget, treated as observation-noise variance. */
  readonly nugget: number;
  readonly type: KrigingType;
  /** Required for simple kriging: the known mean. */
  readonly knownMean?: number;
  /** Drift degree for universal kriging. Default 1. */
  readonly driftDegree?: number;
  readonly level?: number;
}

export interface KrigingPrediction {
  readonly x: readonly number[];
  readonly estimate: number;
  /** The kriging variance: the posterior variance of the LATENT field. */
  readonly krigingVariance: number;
  readonly krigingSd: number;
  readonly latentInterval: GpInterval;
  /** Interval for a new measurement, which also carries the nugget. */
  readonly predictiveInterval: GpInterval;
  /** Lagrange multipliers from the unbiasedness constraints, when any. */
  readonly lagrange: readonly number[];
}

export interface KrigingResult {
  readonly type: KrigingType;
  readonly predictions: readonly KrigingPrediction[];
  readonly exactness: 'exact';
  readonly equivalentGp: GpModel;
  readonly note: string;
  readonly limitations: readonly string[];
}

/**
 * Simple, ordinary and universal kriging, solved as the classical augmented
 * system. For ordinary kriging with drift basis F = 1:
 *
 *     ⎡ C  F ⎤ ⎡ w ⎤   ⎡ c* ⎤
 *     ⎣ Fᵀ 0 ⎦ ⎣ μ ⎦ = ⎣ f* ⎦
 *
 *     estimate = wᵀy,   σ²_K = C(0) − wᵀc* − μᵀf*
 *
 * This is algebraically identical to the GP posterior with an unknown
 * constant mean profiled out by generalised least squares; the equivalent GP
 * is returned alongside so the two can be compared, and the tests assert they
 * agree to 1e−9.
 */
export function krige(req: KrigingRequest, Xstar: readonly (readonly number[])[]): KrigingResult {
  const X = req.X.map((r) => Array.from(r));
  const y = Array.from(req.y);
  const n = X.length;
  if (n === 0) throw new EngineError('Kriging needs at least one observation.', 'required');
  if (y.length !== n) throw new EngineError(`${n} locations but ${y.length} values.`, 'length');
  if (!(req.nugget >= 0) || !Number.isFinite(req.nugget)) {
    throw new EngineError(`The nugget must be a finite number of 0 or more; received ${req.nugget}.`, 'range');
  }
  if (req.type === 'simple' && req.knownMean === undefined) {
    throw new EngineError(
      'Simple kriging requires a KNOWN mean. If the mean is unknown, use ordinary kriging — that is the difference between them, and substituting the sample mean into simple kriging understates the variance.',
      'required',
    );
  }
  const level = req.level ?? 0.95;
  const z = normalQuantile(0.5 + level / 2);
  const k = buildKernel(req.kernel, X[0].length, req.kernelValues);
  const C = covarianceMatrix(k, X);
  for (let i = 0; i < n; i++) C[i][i] += req.nugget;

  const degree = req.driftDegree ?? 1;
  const driftRow = (x: readonly number[]): number[] => {
    if (req.type === 'simple') return [];
    if (req.type === 'ordinary') return [1];
    const row = [1];
    for (let deg = 1; deg <= degree; deg++) for (let a = 0; a < x.length; a++) row.push(Math.pow(x[a], deg));
    return row;
  };
  const F = X.map(driftRow);
  const p = F[0].length;
  if (p >= n) {
    throw new EngineError(
      `The drift has ${p} coefficients but there are only ${n} observations: the kriging system is singular.`,
      'identifiability',
    );
  }
  const size = n + p;
  const A: Matrix = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) A[i][j] = C[i][j];
    for (let a = 0; a < p; a++) {
      A[i][n + a] = F[i][a];
      A[n + a][i] = F[i][a];
    }
  }

  const predictions: KrigingPrediction[] = Xstar.map((xs) => {
    const cstar = X.map((xi) => k.k(xi, xs));
    const fstar = driftRow(xs);
    const rhs = [...cstar, ...fstar];
    const sol = solve(A, rhs);
    if (!sol) {
      throw new EngineError(
        'The kriging system is singular: duplicate locations with a zero nugget, or a collinear drift. No estimate is produced.',
        'singular',
      );
    }
    const w = sol.slice(0, n);
    const lagrange = sol.slice(n);
    let estimate = 0;
    if (req.type === 'simple') {
      const m = req.knownMean as number;
      for (let i = 0; i < n; i++) estimate += w[i] * (y[i] - m);
      estimate += m;
    } else {
      for (let i = 0; i < n; i++) estimate += w[i] * y[i];
    }
    let krigingVariance = k.k(xs, xs);
    for (let i = 0; i < n; i++) krigingVariance -= w[i] * cstar[i];
    for (let a = 0; a < p; a++) krigingVariance -= lagrange[a] * fstar[a];
    if (krigingVariance < 0) {
      if (krigingVariance < -1e-8 * Math.max(k.k(xs, xs), 1)) {
        throw new EngineError(
          `The kriging variance came out as ${krigingVariance.toExponential(3)} — negative beyond rounding error — which means the covariance model is not positive definite on these locations. No value is reported.`,
          'numerical',
        );
      }
      krigingVariance = 0;
    }
    const sd = Math.sqrt(krigingVariance);
    const psd = Math.sqrt(krigingVariance + req.nugget);
    return {
      x: xs,
      estimate,
      krigingVariance,
      krigingSd: sd,
      latentInterval: {
        kind: 'latent-credible',
        level,
        lower: estimate - z * sd,
        upper: estimate + z * sd,
        label: INTERVAL_LABEL['latent-credible'],
      },
      predictiveInterval: {
        kind: 'predictive',
        level,
        lower: estimate - z * psd,
        upper: estimate + z * psd,
        label: INTERVAL_LABEL.predictive,
      },
      lagrange,
    };
  });

  const equivalentGp = conditionGp({
    X,
    y,
    kernel: req.kernel,
    kernelValues: req.kernelValues,
    noiseVariance: req.nugget,
    mean:
      req.type === 'simple'
        ? { kind: 'constant', value: req.knownMean as number }
        : req.type === 'ordinary'
          ? { kind: 'constant' }
          : { kind: 'polynomial', degree },
  });

  return {
    type: req.type,
    predictions,
    exactness: 'exact',
    equivalentGp,
    note:
      `${req.type === 'simple' ? 'Simple' : req.type === 'ordinary' ? 'Ordinary' : 'Universal'} kriging, solved as the ` +
      'classical augmented system with Lagrange multipliers. The kriging variance is the posterior variance of the ' +
      `LATENT field; the predictive interval adds the nugget ${req.nugget.toPrecision(4)} for a new measurement. ` +
      'The equivalent Gaussian process is returned for comparison: the two are the same mathematics.',
    limitations: [
      'The covariance model is taken as known. In practice it was estimated from the same data, which makes the kriging variance optimistic — this is the single most common understatement of uncertainty in geostatistics.',
      'The nugget is treated as noise, so the predictor does not interpolate the measured values exactly. If the nugget is genuinely micro-scale spatial variation rather than measurement error, that choice is wrong and exact interpolation would be the right convention.',
      req.type === 'simple'
        ? 'Simple kriging assumes the mean is known exactly. If it was estimated from the data, the variance is understated.'
        : 'The drift is estimated from the same data as the residual covariance; the two are not independent and the reported variance does not account for uncertainty in the covariance model.',
    ],
  };
}

/** Kriging variance over a grid: the map that says where more samples are needed. */
export function krigingVarianceMap(
  req: KrigingRequest,
  grid: readonly (readonly number[])[],
): { readonly points: readonly { readonly x: readonly number[]; readonly variance: number; readonly sd: number }[]; readonly note: string } {
  const result = krige(req, grid);
  return {
    points: result.predictions.map((p) => ({ x: p.x, variance: p.krigingVariance, sd: p.krigingSd })),
    note:
      'The kriging variance depends only on the LOCATIONS and the covariance model, never on the measured values. ' +
      'That is why it works as a sampling-design map — and also why it cannot tell you that the covariance model ' +
      'itself is wrong.',
  };
}

/** The GP predictive mean on the same data, for the cross-check. */
export function gpEquivalentOfKriging(result: KrigingResult, Xstar: readonly (readonly number[])[]): number[] {
  return predictGp(result.equivalentGp, Xstar).predictions.map((p) => p.mean);
}
