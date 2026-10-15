/**
 * Power and — more usefully — minimum detectable effect.
 *
 * "Not significant" at n = 12 means almost nothing, so every test in this
 * module reports the smallest effect its sample size could have detected with
 * conventional power. A reader can then tell the difference between "there is
 * no effect here" and "this study could not have seen an effect of any
 * plausible size".
 *
 * Methods
 *  - Non-central F and chi-square tail probabilities use Patnaik's two-moment
 *    central approximation: χ²(df, λ) ≈ c · χ²(h) with c = (df+2λ)/(df+λ) and
 *    h = (df+λ)²/(df+2λ), which matches the first two moments exactly. The
 *    error is well under 1% of the power over the range used here.
 *  - Non-central t uses the Johnson–Welch normal approximation.
 *  - Minimum detectable effects invert these by Brent root finding.
 *
 * All of these are approximations and are reported as `numerical`, never as
 * exact power.
 */
import { brentRoot } from '../core/numeric';
import { chiSquare, studentT } from '../distributions/continuous';
import { normalCdf } from '../special/gamma';
import { fSurvival } from '../stats/tests';
import { EngineError } from '../core/result';

/** P(χ²(df, λ) > x), Patnaik two-moment approximation. */
export function noncentralChiSquareSurvival(x: number, df: number, lambda: number): number {
  if (!(df > 0)) throw new EngineError('Degrees of freedom must be positive.', 'range');
  if (lambda <= 0) return chiSquare.sf(x, { k: df });
  const c = (df + 2 * lambda) / (df + lambda);
  const h = (df + lambda) ** 2 / (df + 2 * lambda);
  return chiSquare.sf(x / c, { k: h });
}

/** P(F'(df1, df2, λ) > f), Patnaik two-moment approximation. */
export function noncentralFSurvival(f: number, df1: number, df2: number, lambda: number): number {
  if (!(df1 > 0) || !(df2 > 0)) throw new EngineError('Degrees of freedom must be positive.', 'range');
  if (lambda <= 0) return fSurvival(f, df1, df2);
  const c = (df1 + 2 * lambda) / (df1 + lambda);
  const h = (df1 + lambda) ** 2 / (df1 + 2 * lambda);
  // χ²'(df1, λ)/df1 > f  ⇔  c·χ²(h) > df1·f  ⇔  F(h, df2) > df1·f/(c·h)
  return fSurvival((df1 * f) / (c * h), h, df2);
}

/** P(T'(df, ncp) > t), Johnson–Welch normal approximation. */
export function noncentralTSurvival(t: number, df: number, ncp: number): number {
  if (!(df > 0)) throw new EngineError('Degrees of freedom must be positive.', 'range');
  const num = t * (1 - 1 / (4 * df)) - ncp;
  const den = Math.sqrt(1 + (t * t) / (2 * df));
  return 1 - normalCdf(num / den);
}

function tCritical(alpha: number, df: number, twoSided: boolean): number {
  return studentT.quantile(twoSided ? 1 - alpha / 2 : 1 - alpha, { nu: df, mu: 0, sigma: 1 });
}

/**
 * Power of a two-sample t test (and, with the efficiency factor applied, of
 * the Mann–Whitney test) against a standardised mean difference d.
 */
export function twoSampleTPower(d: number, n1: number, n2: number, alpha = 0.05, twoSided = true): number {
  if (n1 < 2 || n2 < 2) throw new EngineError('Each group needs at least 2 observations to assess power.', 'insufficient');
  const df = n1 + n2 - 2;
  const ncp = Math.abs(d) * Math.sqrt((n1 * n2) / (n1 + n2));
  const tc = tCritical(alpha, df, twoSided);
  const upper = noncentralTSurvival(tc, df, ncp);
  const lower = twoSided ? noncentralTSurvival(tc, df, -ncp) : 0;
  return Math.min(1, Math.max(0, upper + lower));
}

export function oneSampleTPower(d: number, n: number, alpha = 0.05, twoSided = true): number {
  if (n < 2) throw new EngineError('At least 2 observations are needed to assess power.', 'insufficient');
  const df = n - 1;
  const ncp = Math.abs(d) * Math.sqrt(n);
  const tc = tCritical(alpha, df, twoSided);
  const upper = noncentralTSurvival(tc, df, ncp);
  const lower = twoSided ? noncentralTSurvival(tc, df, -ncp) : 0;
  return Math.min(1, Math.max(0, upper + lower));
}

/** Power of a one-way F test against Cohen's f. */
export function anovaPower(cohensF: number, groupSizes: number[], alpha = 0.05): number {
  const k = groupSizes.length;
  if (k < 2) throw new EngineError('At least 2 groups are needed to assess power.', 'insufficient');
  const n = groupSizes.reduce((a, b) => a + b, 0);
  const df1 = k - 1;
  const df2 = n - k;
  if (df2 < 1) throw new EngineError('Too few observations to assess power.', 'insufficient');
  const fCrit = fCriticalValue(alpha, df1, df2);
  const lambda = cohensF * cohensF * n;
  return Math.min(1, Math.max(0, noncentralFSurvival(fCrit, df1, df2, lambda)));
}

/** The 1−α quantile of the central F distribution, by root finding on fSurvival. */
export function fCriticalValue(alpha: number, df1: number, df2: number): number {
  return brentRoot((f) => fSurvival(f, df1, df2) - alpha, 1e-12, 1e8, { tol: 1e-12 });
}

/** Power of a χ² test of fit/association against Cohen's w. */
export function chiSquarePower(w: number, df: number, n: number, alpha = 0.05): number {
  const crit = chiSquare.quantile(1 - alpha, { k: df });
  return Math.min(1, Math.max(0, noncentralChiSquareSurvival(crit, df, w * w * n)));
}

/** Invert a monotone power function for the effect giving the target power. */
function invertPower(power: (effect: number) => number, target: number, hi = 50): number {
  if (!(target > 0 && target < 1)) throw new EngineError('Target power must be between 0 and 1.', 'range');
  const f = (e: number) => power(e) - target;
  if (f(hi) < 0) {
    throw new EngineError(
      `Even an effect of ${hi} would not reach ${(target * 100).toFixed(0)}% power at this sample size, so no minimum detectable effect can be reported.`,
      'insufficient',
    );
  }
  return brentRoot(f, 1e-9, hi, { tol: 1e-10 });
}

/** Smallest standardised mean difference detectable with the given power. */
export function twoSampleMinimumDetectableEffect(n1: number, n2: number, alpha = 0.05, power = 0.8): number {
  return invertPower((d) => twoSampleTPower(d, n1, n2, alpha, true), power);
}

export function oneSampleMinimumDetectableEffect(n: number, alpha = 0.05, power = 0.8): number {
  return invertPower((d) => oneSampleTPower(d, n, alpha, true), power);
}

/** Smallest Cohen's f detectable by the one-way F test with the given power. */
export function anovaMinimumDetectableEffect(groupSizes: number[], alpha = 0.05, power = 0.8): number {
  return invertPower((f) => anovaPower(f, groupSizes, alpha), power);
}

export function chiSquareMinimumDetectableEffect(df: number, n: number, alpha = 0.05, power = 0.8): number {
  return invertPower((w) => chiSquarePower(w, df, n, alpha), power, 20);
}

/**
 * Asymptotic relative efficiency of the Mann–Whitney / Wilcoxon tests against
 * the t test for normal data: 3/π ≈ 0.955. The rank test therefore needs about
 * 1/0.955 times as many observations, so its minimum detectable effect at a
 * fixed n is inflated by 1/√0.955.
 */
export const RANK_TEST_ARE_NORMAL = 3 / Math.PI;
