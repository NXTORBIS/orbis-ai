/**
 * Log-likelihoods, observed-information standard errors and profile-likelihood
 * confidence intervals shared by the GEV and GPD fits.
 *
 * The likelihoods are the exact expressions for the GEV and GPD densities; the
 * maximisation, the Hessian and the profile intervals are numerical, so every
 * fitted quantity built on them is labelled 'numerical'.
 */
import { normalQuantile } from '../special/gamma';
import { solve, type Matrix } from '../stats/linalg';
import { brentRoot } from '../core/numeric';
import { nelderMead, numericalHessian } from './optimize';
import type { GevParams } from './gev';
import type { GpdParams } from './gpd';

/** GEV negative log-likelihood; +Infinity for data outside the support. */
export function gevNegLogLik(data: ArrayLike<number>, p: GevParams): number {
  if (!(p.scale > 0) || !Number.isFinite(p.scale) || !Number.isFinite(p.shape) || !Number.isFinite(p.location)) {
    return Infinity;
  }
  const n = data.length;
  const logSigma = Math.log(p.scale);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const z = (data[i] - p.location) / p.scale;
    if (p.shape === 0) {
      total += logSigma + z + Math.exp(-z);
    } else {
      const w = 1 + p.shape * z;
      if (w <= 0) return Infinity;
      const logW = Math.log1p(p.shape * z);
      total += logSigma + (1 + 1 / p.shape) * logW + Math.exp((-1 / p.shape) * logW);
    }
    if (!Number.isFinite(total)) return Infinity;
  }
  return total;
}

/**
 * GPD negative log-likelihood for exceedances, given as the raw values (not
 * the excesses); values at or below the threshold are not valid data for this
 * likelihood and make it +Infinity.
 */
export function gpdNegLogLik(exceedances: ArrayLike<number>, p: GpdParams): number {
  if (!(p.scale > 0) || !Number.isFinite(p.scale) || !Number.isFinite(p.shape)) return Infinity;
  const n = exceedances.length;
  const logSigma = Math.log(p.scale);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const y = (exceedances[i] - p.threshold) / p.scale;
    if (y < 0) return Infinity;
    if (p.shape === 0) {
      total += logSigma + y;
    } else {
      const w = 1 + p.shape * y;
      if (w <= 0) return Infinity;
      total += logSigma + (1 / p.shape + 1) * Math.log1p(p.shape * y);
    }
    if (!Number.isFinite(total)) return Infinity;
  }
  return total;
}

/** χ²_1 quantile at a confidence level, from the normal quantile: z²_{(1+level)/2}. */
export function chiSquare1Quantile(level: number): number {
  const z = normalQuantile((1 + level) / 2);
  return z * z;
}

/** Invert a symmetric matrix by solving against the identity. Returns null if singular. */
export function invertMatrix(m: Matrix): Matrix | null {
  const n = m.length;
  const inverse: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let col = 0; col < n; col++) {
    const rhs = new Array<number>(n).fill(0);
    rhs[col] = 1;
    const column = solve(
      m.map((row) => row.slice()),
      rhs,
    );
    if (column === null) return null;
    for (let row = 0; row < n; row++) inverse[row][col] = column[row];
  }
  for (const row of inverse) for (const v of row) if (!Number.isFinite(v)) return null;
  return inverse;
}

export interface StandardErrorResult {
  covariance: Matrix;
  standardErrors: number[];
}

/**
 * Standard errors from the observed information matrix (the numerical Hessian
 * of the negative log-likelihood at the maximum). Returns null when the
 * Hessian cannot be formed or is not positive definite — which is the honest
 * outcome when the optimum lies on a support boundary.
 */
export function observedInformationErrors(
  nll: (params: number[]) => number,
  estimate: number[],
): StandardErrorResult | null {
  const hessian = numericalHessian(nll, estimate);
  if (hessian === null) return null;
  const covariance = invertMatrix(hessian);
  if (covariance === null) return null;
  const standardErrors: number[] = [];
  for (let i = 0; i < estimate.length; i++) {
    const v = covariance[i][i];
    if (!(v > 0) || !Number.isFinite(v)) return null;
    standardErrors.push(Math.sqrt(v));
  }
  return { covariance, standardErrors };
}

export interface ProfileInterval {
  /** Lower confidence limit, or null when it could not be bracketed. */
  lower: number | null;
  /** Upper confidence limit, or null when it could not be bracketed. */
  upper: number | null;
  level: number;
  /** Points of the profile deviance curve, for plotting. */
  curve: { value: number; deviance: number }[];
  notes: string[];
}

/**
 * Profile-likelihood confidence interval for one scalar quantity.
 *
 * `profileNll(value)` must return the negative log-likelihood maximised over
 * the remaining (nuisance) parameters with the quantity fixed at `value`, or
 * null when that constrained fit fails. The interval is the set where the
 * deviance 2(ℓ_profile − ℓ_max) is below the χ²_1 critical value; the limits
 * are found by bracketing outward and then by Brent's method.
 */
export function profileLikelihoodInterval(
  profileNll: (value: number) => number | null,
  estimate: number,
  nllAtEstimate: number,
  options: { level?: number; initialStep?: number; maxExpansions?: number; curvePoints?: number } = {},
): ProfileInterval {
  const level = options.level ?? 0.95;
  const critical = chiSquare1Quantile(level);
  const baseStep = options.initialStep ?? Math.max(Math.abs(estimate) * 0.25, 0.05);
  const maxExpansions = options.maxExpansions ?? 24;
  const notes: string[] = [];
  const curve: { value: number; deviance: number }[] = [];

  const deviance = (value: number): number | null => {
    const nll = profileNll(value);
    if (nll === null || !Number.isFinite(nll)) return null;
    const d = 2 * (nll - nllAtEstimate);
    curve.push({ value, deviance: d });
    return d;
  };

  const findLimit = (direction: 1 | -1): number | null => {
    let step = baseStep;
    let previous = estimate;
    for (let i = 0; i < maxExpansions; i++) {
      const candidate = estimate + direction * step;
      const d = deviance(candidate);
      if (d === null) {
        // The constrained fit failed before the limit was reached; shrink once.
        step /= 2;
        if (step < baseStep * 1e-6) return null;
        continue;
      }
      if (d >= critical) {
        const g = (value: number): number => {
          const dv = deviance(value);
          return dv === null ? critical * 2 : dv - critical;
        };
        try {
          return brentRoot(g, previous, candidate, { tol: 1e-8, maxIter: 200 });
        } catch {
          return null;
        }
      }
      previous = candidate;
      step *= 1.6;
    }
    return null;
  };

  const lower = findLimit(-1);
  const upper = findLimit(1);
  if (lower === null) notes.push('The lower profile-likelihood limit could not be bracketed; it is not reported.');
  if (upper === null) notes.push('The upper profile-likelihood limit could not be bracketed; it is not reported.');
  curve.sort((a, b) => a.value - b.value);
  return { lower, upper, level, curve, notes };
}

/** Minimise an objective over nuisance parameters; returns null unless it converged. */
export function constrainedMinimum(
  objective: (x: number[]) => number,
  start: number[],
  step: number[],
): { x: number[]; fx: number } | null {
  const result = nelderMead(objective, start, { step, maxIterations: 1500, restarts: 0 });
  if (!result.converged || !Number.isFinite(result.fx)) return null;
  return { x: result.x, fx: result.fx };
}
