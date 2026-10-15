/**
 * Generalised Pareto fit by the empirical-Bayes profile method of
 * Zhang & Stephens (2009), as used for Pareto-smoothed importance sampling.
 *
 * The fitted shape k is the quantity of interest, not the smoothing: k is an
 * estimate of the tail index of the importance-weight distribution, and the
 * weights have finite variance only for k < 0.5 and a finite mean only for
 * k < 1. The estimator is weakly informatively shrunk toward k = 0.5 with the
 * weight of 10 observations, which is what keeps it usable for short tails.
 */
import { logSumExp } from '../core/numeric';
import { EngineError } from '../core/result';

export interface ParetoFit {
  /** Shape parameter (tail index). */
  readonly k: number;
  /** Scale parameter. */
  readonly sigma: number;
  readonly points: number;
  readonly exactness: 'numerical';
}

/**
 * Fit a generalised Pareto to positive exceedances.
 *
 * @param exceedances values above a threshold; non-positive entries are
 * dropped, because an exceedance of zero carries no tail information.
 */
export function fitGeneralisedPareto(exceedances: readonly number[]): ParetoFit {
  const x = exceedances.filter((v) => v > 0 && Number.isFinite(v)).sort((a, b) => a - b);
  const n = x.length;
  if (n < 5) {
    throw new EngineError(
      `A generalised Pareto fit needs at least 5 positive exceedances; ${n} were usable out of ${exceedances.length}.`,
      'insufficient',
    );
  }
  const prior = 3;
  const m = 30 + Math.floor(Math.sqrt(n));
  const xStar = x[Math.max(0, Math.floor(n / 4 + 0.5) - 1)]; // sample first quartile
  if (!(xStar > 0) || !(x[n - 1] > 0)) {
    throw new EngineError('The exceedances are degenerate (quartile or maximum is not positive), so no Pareto tail can be fitted.', 'degenerate');
  }
  // Grid of theta = k/sigma values, denser near the data-driven centre.
  const theta = new Array<number>(m);
  for (let j = 1; j <= m; j++) {
    theta[j - 1] = 1 / x[n - 1] + (1 - Math.sqrt(m / (j - 0.5))) / (prior * xStar);
  }
  // Profile log-likelihood (up to a constant): n·[ log(−theta/k(theta)) − k(theta) − 1 ].
  const logLik = new Array<number>(m);
  for (let j = 0; j < m; j++) {
    const kj = profileK(theta[j], x);
    const ratio = -theta[j] / kj;
    logLik[j] = ratio > 0 ? n * (Math.log(ratio) - kj - 1) : -Infinity;
  }
  const norm = logSumExp(logLik);
  if (!Number.isFinite(norm)) {
    throw new EngineError('The generalised Pareto profile likelihood is degenerate on the whole grid, so the tail index cannot be estimated.', 'degenerate');
  }
  let thetaHat = 0;
  for (let j = 0; j < m; j++) thetaHat += theta[j] * Math.exp(logLik[j] - norm);
  let k = profileK(thetaHat, x);
  const sigma = -k / thetaHat;
  // Weakly informative shrinkage toward 0.5 with the weight of 10 points.
  const priorWeight = 10;
  k = (k * n + priorWeight * 0.5) / (n + priorWeight);
  if (!Number.isFinite(k) || !Number.isFinite(sigma) || sigma <= 0) {
    throw new EngineError(
      `The generalised Pareto fit did not converge to a usable parameter pair (k = ${String(k)}, sigma = ${String(sigma)}).`,
      'degenerate',
    );
  }
  return { k, sigma, points: n, exactness: 'numerical' };
}

/** k(theta) = mean log(1 − theta·x), the profile shape at a given theta. */
function profileK(theta: number, x: readonly number[]): number {
  let s = 0;
  for (const v of x) s += Math.log1p(-theta * v);
  return s / x.length;
}
