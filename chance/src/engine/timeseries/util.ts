/**
 * Internal helpers for the time-series module: series validation that names
 * the offending index, tail probabilities, an unconstrained optimiser, OLS,
 * and the stationarity-preserving parameter transform used by the ARMA fits.
 */
import { EngineError } from '../core/result';
import { incompleteBeta, incompleteGamma, normalQuantile } from '../special/gamma';
import { solve } from '../stats/linalg';
import { stableSum } from '../core/numeric';

/**
 * Validate an observed series. A missing or non-finite observation is a hard
 * failure naming its index: silently dropping or zero-filling it would change
 * the time ordering, which is the one thing this module must not do.
 */
export function checkSeries(x: ArrayLike<number>, minLength: number, label = 'series'): number[] {
  if (!Number.isInteger(minLength) || minLength < 1) {
    throw new EngineError(`Internal: minLength for ${label} must be a positive integer.`, 'invalid');
  }
  const n = x.length;
  if (n < minLength) {
    throw new EngineError(
      `The ${label} has n = ${n} observations but at least ${minLength} are required for this computation.`,
      'too-short',
    );
  }
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const v = x[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new EngineError(
        `The ${label} has a missing or non-finite observation at index ${i} (value: ${String(v)}). ` +
          'Time-series methods need a complete, evenly spaced series; impute or trim it explicitly before analysing it.',
        'missing-observation',
      );
    }
    out[i] = v;
  }
  return out;
}

/** Validate a seasonal period against the length of the series. */
export function checkPeriod(period: number, n: number): number {
  if (!Number.isInteger(period) || period < 2) {
    throw new EngineError(`The seasonal period must be a whole number of at least 2 (received ${period}).`, 'range');
  }
  if (period >= n) {
    throw new EngineError(
      `The seasonal period (${period}) is not shorter than the series (n = ${n}); there is no second cycle to compare against.`,
      'too-short',
    );
  }
  return period;
}

export function checkLag(maxLag: number, n: number): number {
  if (!Number.isInteger(maxLag) || maxLag < 1) {
    throw new EngineError(`The maximum lag must be a whole number of at least 1 (received ${maxLag}).`, 'range');
  }
  if (maxLag >= n) {
    throw new EngineError(
      `The maximum lag (${maxLag}) must be smaller than the number of observations (n = ${n}).`,
      'range',
    );
  }
  return maxLag;
}

/** Upper tail of the chi-square distribution, P(X > x). */
export function chiSquareSf(x: number, df: number): number {
  if (!(df > 0)) throw new EngineError(`Chi-square tail needs df > 0 (received ${df}).`, 'range');
  if (x <= 0) return 1;
  return incompleteGamma(df / 2, x / 2).upper;
}

/** Two-sided p-value from Student's t with `df` degrees of freedom. */
export function studentTTwoSided(t: number, df: number): number {
  if (!(df > 0)) throw new EngineError(`Student t tail needs df > 0 (received ${df}).`, 'range');
  const x = df / (df + t * t);
  return incompleteBeta(x, df / 2, 0.5).lower;
}

export function zQuantile(p: number): number {
  return normalQuantile(p);
}

export function meanOf(x: ArrayLike<number>): number {
  if (x.length === 0) throw new EngineError('Cannot take the mean of an empty series.', 'empty');
  return stableSum(x) / x.length;
}

/** Population (ddof = 0) variance; used wherever a periodogram or ACF needs it. */
export function varianceOf(x: ArrayLike<number>, ddof = 0): number {
  const n = x.length;
  if (n - ddof <= 0) throw new EngineError(`Variance needs n > ${ddof} observations (n = ${n}).`, 'too-short');
  const m = meanOf(x);
  const d = new Array<number>(n);
  for (let i = 0; i < n; i++) d[i] = (x[i] - m) * (x[i] - m);
  return stableSum(d) / (n - ddof);
}

export interface OlsFit {
  /** Coefficients in the order the design columns were supplied. */
  beta: number[];
  /** Standard errors of the coefficients. */
  se: number[];
  residuals: number[];
  /** Residual sum of squares. */
  rss: number;
  /** Residual variance with the usual n - k denominator. */
  sigma2: number;
  /** Coefficient covariance matrix. */
  cov: number[][];
  r2: number;
  n: number;
  k: number;
}

/**
 * Ordinary least squares by solving the normal equations. The design matrix is
 * supplied as a list of rows. Returns null-free results or throws: a singular
 * design is a refusal, not a zeroed coefficient.
 */
export function ols(designRows: number[][], y: number[]): OlsFit {
  const n = designRows.length;
  if (n !== y.length) throw new EngineError('Internal: design and response lengths differ.', 'invalid');
  const k = n > 0 ? designRows[0].length : 0;
  if (k === 0) throw new EngineError('The regression has no predictors.', 'invalid');
  if (n <= k) {
    throw new EngineError(
      `The regression has ${n} usable observations for ${k} parameters; at least ${k + 1} are required.`,
      'too-short',
    );
  }
  const xtx: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xty = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i++) {
    const row = designRows[i];
    for (let a = 0; a < k; a++) {
      xty[a] += row[a] * y[i];
      for (let b = a; b < k; b++) xtx[a][b] += row[a] * row[b];
    }
  }
  for (let a = 0; a < k; a++) for (let b = 0; b < a; b++) xtx[a][b] = xtx[b][a];
  const beta = solve(
    xtx.map((r) => [...r]),
    [...xty],
  );
  if (beta === null) {
    throw new EngineError(
      'The regression design is singular to working precision (perfectly collinear predictors or a constant series). No coefficients can be reported.',
      'singular',
    );
  }
  const residuals = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let fit = 0;
    for (let a = 0; a < k; a++) fit += designRows[i][a] * beta[a];
    residuals[i] = y[i] - fit;
  }
  const rss = stableSum(residuals.map((r) => r * r));
  const sigma2 = rss / (n - k);
  // Invert X'X column by column.
  const cov: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let c = 0; c < k; c++) {
    const e = new Array<number>(k).fill(0);
    e[c] = 1;
    const col = solve(
      xtx.map((r) => [...r]),
      e,
    );
    if (col === null) throw new EngineError('The regression design is singular; standard errors are unavailable.', 'singular');
    for (let r = 0; r < k; r++) cov[r][c] = col[r] * sigma2;
  }
  const se = new Array<number>(k);
  for (let a = 0; a < k; a++) {
    const v = cov[a][a];
    if (!(v >= 0)) throw new EngineError('The regression produced a negative variance estimate.', 'numerical');
    se[a] = Math.sqrt(v);
  }
  const ybar = meanOf(y);
  const tss = stableSum(y.map((v) => (v - ybar) * (v - ybar)));
  return { beta, se, residuals, rss, sigma2, cov, r2: tss > 0 ? 1 - rss / tss : 0, n, k };
}

export interface MinimiseResult {
  x: number[];
  fx: number;
  iterations: number;
  converged: boolean;
}

/**
 * Nelder–Mead simplex minimisation on unconstrained coordinates. Used for the
 * exponential-smoothing SSE, the ARMA likelihood and the GARCH likelihood;
 * callers enforce parameter constraints by reparameterisation, never by
 * clipping, so the objective is defined everywhere the simplex can reach.
 */
export function nelderMead(
  f: (x: number[]) => number,
  x0: number[],
  opts: { maxIter?: number; tol?: number; step?: number } = {},
): MinimiseResult {
  const d = x0.length;
  if (d === 0) throw new EngineError('Internal: optimiser called with no parameters.', 'invalid');
  const maxIter = opts.maxIter ?? 300 + 150 * d;
  const tol = opts.tol ?? 1e-8;
  const step = opts.step ?? 0.3;
  const simplex: number[][] = [[...x0]];
  for (let i = 0; i < d; i++) {
    const p = [...x0];
    p[i] += step * (p[i] === 0 ? 1 : Math.abs(p[i]));
    simplex.push(p);
  }
  const safe = (x: number[]): number => {
    const v = f(x);
    return Number.isFinite(v) ? v : 1e300;
  };
  let fv = simplex.map(safe);
  let iterations = 0;
  let converged = false;
  while (iterations < maxIter) {
    iterations++;
    const order = fv.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
    const sorted = order.map(([, i]) => simplex[i]);
    const sortedF = order.map(([v]) => v);
    for (let i = 0; i <= d; i++) {
      simplex[i] = sorted[i];
      fv[i] = sortedF[i];
    }
    const spreadF = Math.abs(fv[d] - fv[0]);
    let spreadX = 0;
    for (let i = 1; i <= d; i++) {
      for (let j = 0; j < d; j++) spreadX = Math.max(spreadX, Math.abs(simplex[i][j] - simplex[0][j]));
    }
    let scaleX = 1;
    for (let j = 0; j < d; j++) scaleX = Math.max(scaleX, Math.abs(simplex[0][j]));
    if (spreadF <= tol * (Math.abs(fv[0]) + tol) && spreadX <= 1e-5 * scaleX) {
      converged = true;
      break;
    }
    const centroid = new Array<number>(d).fill(0);
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) centroid[j] += simplex[i][j] / d;
    const reflect = centroid.map((c, j) => c + (c - simplex[d][j]));
    const fr = safe(reflect);
    if (fr < fv[0]) {
      const expand = centroid.map((c, j) => c + 2 * (c - simplex[d][j]));
      const fe = safe(expand);
      if (fe < fr) {
        simplex[d] = expand;
        fv[d] = fe;
      } else {
        simplex[d] = reflect;
        fv[d] = fr;
      }
    } else if (fr < fv[d - 1]) {
      simplex[d] = reflect;
      fv[d] = fr;
    } else {
      const outside = fr < fv[d];
      const contract = outside
        ? centroid.map((c, j) => c + 0.5 * (c - simplex[d][j]))
        : centroid.map((c, j) => c - 0.5 * (c - simplex[d][j]));
      const fc = safe(contract);
      if (fc < Math.min(fr, fv[d])) {
        simplex[d] = contract;
        fv[d] = fc;
      } else {
        for (let i = 1; i <= d; i++) simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]));
        fv = simplex.map(safe);
      }
    }
  }
  const best = fv.indexOf(Math.min(...fv));
  return { x: simplex[best], fx: fv[best], iterations, converged };
}

/** Restart Nelder–Mead once; a second run from the first optimum is cheap insurance. */
export function minimise(
  f: (x: number[]) => number,
  x0: number[],
  opts: { maxIter?: number; tol?: number; step?: number } = {},
): MinimiseResult {
  const first = nelderMead(f, x0, opts);
  const second = nelderMead(f, first.x, { ...opts, step: 0.05 });
  const best = second.fx <= first.fx ? second : first;
  return { ...best, converged: first.converged || second.converged, iterations: first.iterations + second.iterations };
}

/**
 * Map `p` unconstrained reals to AR coefficients of a stationary AR(p).
 * The reals become partial autocorrelations through tanh, and the
 * Levinson–Durbin recursion turns those into coefficients whose characteristic
 * roots are guaranteed outside the unit circle (Monahan 1984). This is why the
 * ARMA optimiser can never wander into a non-stationary region.
 */
export function pacfToAr(raw: number[]): number[] {
  const p = raw.length;
  if (p === 0) return [];
  const phi: number[] = new Array<number>(p).fill(0);
  const work: number[] = new Array<number>(p).fill(0);
  for (let k = 0; k < p; k++) {
    const r = Math.tanh(raw[k]);
    work[k] = r;
    for (let j = 0; j < k; j++) work[j] = phi[j] - r * phi[k - 1 - j];
    for (let j = 0; j <= k; j++) phi[j] = work[j];
  }
  return phi;
}

/** Inverse of `pacfToAr`, for seeding the optimiser from a Yule–Walker fit. */
export function arToPacf(phi: number[]): number[] {
  const p = phi.length;
  if (p === 0) return [];
  let cur = [...phi];
  const raw = new Array<number>(p).fill(0);
  for (let k = p - 1; k >= 0; k--) {
    const r = cur[k];
    const clamped = Math.max(-0.999999, Math.min(0.999999, r));
    raw[k] = Math.atanh(clamped);
    if (k === 0) break;
    const prev = new Array<number>(k).fill(0);
    const denom = 1 - clamped * clamped;
    if (Math.abs(denom) < 1e-12) {
      for (let j = 0; j < k; j++) prev[j] = 0;
    } else {
      for (let j = 0; j < k; j++) prev[j] = (cur[j] + clamped * cur[k - 1 - j]) / denom;
    }
    cur = prev;
  }
  return raw;
}

/** Characteristic roots of 1 - a1 z - ... - ap z^p all outside the unit circle? */
export function isStationaryAr(phi: number[]): boolean {
  // Equivalent test: the companion matrix has spectral radius < 1. Use the
  // Levinson inverse: the AR is stationary iff every implied partial
  // autocorrelation lies strictly inside (-1, 1).
  if (phi.length === 0) return true;
  let cur = [...phi];
  for (let k = cur.length - 1; k >= 0; k--) {
    const r = cur[k];
    if (!Number.isFinite(r) || Math.abs(r) >= 1) return false;
    if (k === 0) break;
    const denom = 1 - r * r;
    const prev = new Array<number>(k).fill(0);
    for (let j = 0; j < k; j++) prev[j] = (cur[j] + r * cur[k - 1 - j]) / denom;
    cur = prev;
  }
  return true;
}

/** MA invertibility shares the same algebra as AR stationarity. */
export function isInvertibleMa(theta: number[]): boolean {
  return isStationaryAr(theta);
}
