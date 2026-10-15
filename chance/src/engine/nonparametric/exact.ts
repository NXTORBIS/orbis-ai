/**
 * Exact null distributions, by dynamic programming over the combinatorics of
 * the permutation null. These are exact in the strong sense: every
 * rearrangement is counted, no normal approximation is involved, and the
 * resulting p-values are rational numbers computed in floating point only at
 * the final division.
 *
 *  - Mann–Whitney U: the number of ways to split n₁+n₂ ranks so that U = u is
 *    the number of partitions of u into at most n₁ parts of size at most n₂,
 *    which satisfies c(n₁,n₂,u) = c(n₁−1,n₂,u−n₂) + c(n₁,n₂−1,u). The DP below
 *    uses the equivalent forward recurrence
 *    dp_i[j][u] = dp_{i−1}[j][u−j] + dp_i[j−1][u].
 *  - Wilcoxon signed rank: W⁺ is the sum of a subset of {1,…,n}, so its null
 *    distribution is a subset-sum count.
 *  - Two-sample Kolmogorov–Smirnov: the number of lattice paths from (0,0) to
 *    (n₁,n₂) that never reach the forbidden band |i/n₁ − j/n₂| ≥ d.
 *
 * Exact counts are held in doubles. The limits below keep every count well
 * inside 2^53, so the counts themselves are exact integers; the KS path count
 * is rescaled in log space because it can overflow.
 */
import { EngineError } from '../core/result';
import { logChoose } from '../special/gamma';
import type { Alternative } from './support';

/**
 * Largest n₁·n₂ for which the exact Mann–Whitney distribution is built. At the
 * limit (n₁ = n₂ = 20) the total count C(40,20) ≈ 1.4·10¹¹ is an exact double.
 */
export const MANN_WHITNEY_EXACT_MAX_PRODUCT = 400;
/** Largest n for the exact signed-rank distribution: 2²⁵ ≈ 3.4·10⁷ counts. */
export const SIGNED_RANK_EXACT_MAX_N = 25;
/** Largest n₁·n₂ for the exact two-sample KS p-value. */
export const KS_EXACT_MAX_PRODUCT = 10000;

export interface NullDistribution {
  /** pmf[k] = P(statistic = k) under the null. */
  pmf: Float64Array;
  /** counts[k] = number of arrangements giving statistic = k. */
  counts: Float64Array;
  total: number;
}

/** Exact null distribution of Mann–Whitney U (support 0 … n₁·n₂). */
export function mannWhitneyNullDistribution(n1: number, n2: number): NullDistribution {
  if (!Number.isInteger(n1) || !Number.isInteger(n2) || n1 < 1 || n2 < 1) {
    throw new EngineError('Exact Mann–Whitney distribution needs two positive group sizes.', 'range');
  }
  if (n1 * n2 > MANN_WHITNEY_EXACT_MAX_PRODUCT) {
    throw new EngineError(
      `The exact Mann–Whitney null distribution is only built for n₁·n₂ ≤ ${MANN_WHITNEY_EXACT_MAX_PRODUCT}; here n₁·n₂ = ${n1 * n2}.`,
      'limit',
    );
  }
  const maxU = n1 * n2;
  const width = maxU + 1;
  // prev[j] = dp_{i-1}[j], cur[j] = dp_i[j].
  let prev: Float64Array[] = [];
  for (let j = 0; j <= n2; j++) {
    const row = new Float64Array(width);
    row[0] = 1; // dp_0[j][0] = 1: no A observations, U = 0.
    prev.push(row);
  }
  for (let i = 1; i <= n1; i++) {
    const cur: Float64Array[] = [];
    const zero = new Float64Array(width);
    zero[0] = 1; // dp_i[0][0] = 1: no B observations, U = 0.
    cur.push(zero);
    for (let j = 1; j <= n2; j++) {
      const row = new Float64Array(width);
      const prevRow = prev[j];
      const left = cur[j - 1];
      for (let u = 0; u < width; u++) {
        const fromA = u - j >= 0 ? prevRow[u - j] : 0;
        row[u] = fromA + left[u];
      }
      cur.push(row);
    }
    prev = cur;
  }
  const counts = prev[n2];
  let total = 0;
  for (let u = 0; u < width; u++) total += counts[u];
  const pmf = new Float64Array(width);
  for (let u = 0; u < width; u++) pmf[u] = counts[u] / total;
  return { pmf, counts, total };
}

function lowerTail(pmf: Float64Array, k: number): number {
  let s = 0;
  for (let i = 0; i <= k && i < pmf.length; i++) s += pmf[i];
  return Math.min(1, s);
}

function upperTail(pmf: Float64Array, k: number): number {
  let s = 0;
  for (let i = Math.max(0, k); i < pmf.length; i++) s += pmf[i];
  return Math.min(1, s);
}

/**
 * Exact Mann–Whitney p-value for the statistic U₁ of group A.
 * `greater` means group A tends to exceed group B (large U₁).
 * The two-sided value is 2·min(tails), capped at 1; the null distribution of U
 * is symmetric about n₁n₂/2, so this equals the probability of a U at least as
 * far from the centre as the observed one.
 */
export function mannWhitneyExactP(u1: number, n1: number, n2: number, alt: Alternative): number {
  if (!Number.isInteger(u1)) {
    throw new EngineError(
      'U is not an integer, which happens only with tied observations. The exact null distribution does not apply to tied data.',
      'invalid',
    );
  }
  const { pmf } = mannWhitneyNullDistribution(n1, n2);
  switch (alt) {
    case 'greater':
      return upperTail(pmf, u1);
    case 'less':
      return lowerTail(pmf, u1);
    case 'two-sided':
      return Math.min(1, 2 * Math.min(lowerTail(pmf, u1), upperTail(pmf, u1)));
  }
}

/** Exact null distribution of the Wilcoxon signed-rank statistic W⁺. */
export function signedRankNullDistribution(n: number): NullDistribution {
  if (!Number.isInteger(n) || n < 1) throw new EngineError('Exact signed-rank distribution needs n ≥ 1.', 'range');
  if (n > SIGNED_RANK_EXACT_MAX_N) {
    throw new EngineError(
      `The exact signed-rank null distribution is only built for n ≤ ${SIGNED_RANK_EXACT_MAX_N}; here n = ${n}.`,
      'limit',
    );
  }
  const maxW = (n * (n + 1)) / 2;
  const counts = new Float64Array(maxW + 1);
  counts[0] = 1;
  for (let r = 1; r <= n; r++) {
    for (let w = maxW; w >= r; w--) counts[w] += counts[w - r];
  }
  const total = 2 ** n;
  const pmf = new Float64Array(maxW + 1);
  for (let w = 0; w <= maxW; w++) pmf[w] = counts[w] / total;
  return { pmf, counts, total };
}

/**
 * Exact Wilcoxon signed-rank p-value for W⁺ with n non-zero differences.
 * `greater` means the differences tend to be positive (large W⁺).
 */
export function signedRankExactP(wPlus: number, n: number, alt: Alternative): number {
  if (!Number.isInteger(wPlus)) {
    throw new EngineError(
      'W⁺ is not an integer, which happens only when the absolute differences are tied. The exact null distribution does not apply to tied data.',
      'invalid',
    );
  }
  const { pmf } = signedRankNullDistribution(n);
  switch (alt) {
    case 'greater':
      return upperTail(pmf, wPlus);
    case 'less':
      return lowerTail(pmf, wPlus);
    case 'two-sided':
      return Math.min(1, 2 * Math.min(lowerTail(pmf, wPlus), upperTail(pmf, wPlus)));
  }
}

/**
 * Exact two-sided p-value P(D ≥ d) for the two-sample KS statistic, by
 * counting the lattice paths that stay strictly inside the band. Valid only
 * when there are no ties between the two samples.
 */
export function ksTwoSampleExactP(d: number, n1: number, n2: number): number {
  if (!(d >= 0)) throw new EngineError('The KS statistic must be non-negative.', 'range');
  if (n1 < 1 || n2 < 1) throw new EngineError('Both samples need at least one observation.', 'empty');
  if (n1 * n2 > KS_EXACT_MAX_PRODUCT) {
    throw new EngineError(
      `The exact two-sample KS p-value is only computed for n₁·n₂ ≤ ${KS_EXACT_MAX_PRODUCT}; here n₁·n₂ = ${n1 * n2}.`,
      'limit',
    );
  }
  if (d === 0) return 1;
  // Strictly inside: |i/n1 − j/n2| < d, with a tolerance so that a boundary
  // that should be an equality is treated as extreme rather than inside.
  const tol = 1e-12 * Math.max(1, d);
  const inside = (i: number, j: number): boolean => Math.abs(i / n1 - j / n2) < d - tol;
  const BIG = 1e250;
  let logScale = 0;
  let row = new Float64Array(n2 + 1);
  row[0] = inside(0, 0) ? 1 : 0;
  for (let j = 1; j <= n2; j++) row[j] = inside(0, j) ? row[j - 1] : 0;
  for (let i = 1; i <= n1; i++) {
    const next = new Float64Array(n2 + 1);
    next[0] = inside(i, 0) ? row[0] : 0;
    for (let j = 1; j <= n2; j++) next[j] = inside(i, j) ? next[j - 1] + row[j] : 0;
    let max = 0;
    for (let j = 0; j <= n2; j++) if (next[j] > max) max = next[j];
    if (max > BIG) {
      for (let j = 0; j <= n2; j++) next[j] /= BIG;
      logScale += Math.log(BIG);
    }
    row = next;
  }
  const insideCount = row[n2];
  if (insideCount <= 0) return 1;
  const logP = Math.log(insideCount) + logScale - logChoose(n1 + n2, n1);
  return Math.min(1, Math.max(0, 1 - Math.exp(logP)));
}
