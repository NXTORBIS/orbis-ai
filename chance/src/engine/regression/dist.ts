/**
 * Tail probabilities and quantiles used by regression inference.
 *
 * These delegate to the already-tested engine pieces: the Student-t and
 * chi-square definitions in the distribution registry, the F tail in the
 * hypothesis-test module, and the incomplete gamma/beta functions that are
 * checked against SciPy fixtures. Nothing distributional is re-derived here.
 */
import { getDistribution } from '../distributions/registry';
import { fSurvival } from '../stats/tests';
import { incompleteGamma, normalCdf, normalQuantile } from '../special/gamma';

const T = getDistribution('studentT');
const CHISQ = getDistribution('chiSquare');

/** P(|T_df| > |t|) — the two-sided p-value for a t statistic. */
export function tTwoSided(t: number, df: number): number {
  if (!Number.isFinite(t)) return Number.isNaN(t) ? NaN : 0;
  if (!(df > 0)) return NaN;
  return 2 * T.sf(Math.abs(t), { nu: df, mu: 0, sigma: 1 });
}

/** The 1 − (1−level)/2 quantile of T_df, i.e. the two-sided critical value. */
export function tCritical(level: number, df: number): number {
  return T.quantile(0.5 + level / 2, { nu: df, mu: 0, sigma: 1 });
}

/** P(χ²_df > x). */
export function chiSquareSf(x: number, df: number): number {
  if (!(df > 0)) return NaN;
  if (x <= 0) return 1;
  // Via the regularised upper incomplete gamma: P(χ²_k > x) = Q(k/2, x/2).
  return incompleteGamma(df / 2, x / 2).upper;
}

/** The `q` quantile of χ²_df. */
export function chiSquareQuantile(q: number, df: number): number {
  return CHISQ.quantile(q, { k: df });
}

/** P(F_{d1,d2} > f). */
export function fSf(f: number, d1: number, d2: number): number {
  return fSurvival(f, d1, d2);
}

export { normalCdf, normalQuantile };
