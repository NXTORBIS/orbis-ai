/**
 * Tests for the non-parametric module.
 *
 * Every reference value is independent of the implementation under test:
 *  - brute-force enumerators written here from scratch (Mann–Whitney,
 *    Wilcoxon signed rank, Fisher),
 *  - analytic identities (F = t², Kruskal–Wallis with 2 groups = the
 *    Mann–Whitney χ², the studentised range with k = 2 reducing to √2·|t|,
 *    Friedman with 2 conditions reducing to the sign counts),
 *  - published studentised range table values,
 *  - and simulation under a known truth (type I error and power).
 *
 * Cross-checks against `stats/tests.ts` are valuable because that code is
 * already covered by its own SciPy-referenced tests, so agreement there is
 * agreement with an external reference.
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from '../core/result';
import { Random } from '../random/rng';
import { mean, variance } from '../stats/descriptive';
import { welchTTest } from '../stats/tests';
import {
  adjustPValues,
  barnardExactTest,
  bartlettTest,
  bootstrapInterval,
  brunnerMunzelTest,
  cochranArmitageTrend,
  dunnTest,
  fisherExact2x2,
  fisherFreemanHalton,
  flignerKilleenTest,
  friedmanTest,
  gamesHowell,
  hodgesLehmannShift,
  kruskalWallisTest,
  ksTwoSampleTest,
  leveneTest,
  mannWhitneyUTest,
  mcnemarTest,
  meanDifference,
  moodMedianTest,
  nemenyiTest,
  oneWayAnovaTest,
  permutationTest,
  permutationTestSteps,
  signTest,
  studentizedRangeQuantile,
  studentizedRangeSf,
  tukeyHsd,
  twoByTwoEffects,
  twoWayAnovaTest,
  welchAnovaTest,
  wilcoxonSignedRankTest,
} from './index';
import { studentT } from '../distributions/continuous';

// ---------------------------------------------------------------------------
// Independent brute-force enumerators, written from the definitions.
// ---------------------------------------------------------------------------

/** All k-subsets of [0..n-1] as index arrays. */
function subsets(n: number, k: number): number[][] {
  const out: number[][] = [];
  const cur: number[] = [];
  const go = (start: number) => {
    if (cur.length === k) {
      out.push([...cur]);
      return;
    }
    for (let i = start; i < n; i++) {
      cur.push(i);
      go(i + 1);
      cur.pop();
    }
  };
  go(0);
  return out;
}

/** U = #{(x, y) : x > y} + ½#{(x, y) : x = y}, straight from the definition. */
function uStatistic(xs: number[], ys: number[]): number {
  let u = 0;
  for (const x of xs) for (const y of ys) u += x > y ? 1 : x === y ? 0.5 : 0;
  return u;
}

/**
 * Exact two-sided Mann–Whitney p-value by enumerating every split of the
 * pooled values into groups of the observed sizes, counting a split as extreme
 * when its U is at least as far from n₁n₂/2 as the observed U.
 */
function enumerateMannWhitney(a: number[], b: number[]): { twoSided: number; greater: number; less: number } {
  const pooled = [...a, ...b];
  const n = pooled.length;
  const n1 = a.length;
  const observed = uStatistic(a, b);
  const centre = (n1 * b.length) / 2;
  let extremeTwo = 0;
  let extremeGreater = 0;
  let extremeLess = 0;
  let total = 0;
  for (const idx of subsets(n, n1)) {
    const set = new Set(idx);
    const xs = idx.map((i) => pooled[i]);
    const ys = pooled.filter((_, i) => !set.has(i));
    const u = uStatistic(xs, ys);
    total++;
    if (Math.abs(u - centre) >= Math.abs(observed - centre) - 1e-12) extremeTwo++;
    if (u >= observed - 1e-12) extremeGreater++;
    if (u <= observed + 1e-12) extremeLess++;
  }
  return { twoSided: extremeTwo / total, greater: extremeGreater / total, less: extremeLess / total };
}

/**
 * Exact Wilcoxon signed-rank p-value by enumerating all 2ⁿ sign patterns of
 * the ranks, independently of the module's dynamic programming.
 */
function enumerateSignedRank(diffs: number[]): { twoSided: number; greater: number } {
  const nonZero = diffs.filter((d) => d !== 0);
  const n = nonZero.length;
  const absSorted = [...nonZero].map(Math.abs).sort((p, q) => p - q);
  const rankOf = (v: number) => absSorted.indexOf(Math.abs(v)) + 1;
  let observed = 0;
  for (const d of nonZero) if (d > 0) observed += rankOf(d);
  const centre = (n * (n + 1)) / 4;
  let extremeTwo = 0;
  let extremeGreater = 0;
  const total = 2 ** n;
  for (let mask = 0; mask < total; mask++) {
    let w = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) w += i + 1;
    if (Math.abs(w - centre) >= Math.abs(observed - centre) - 1e-12) extremeTwo++;
    if (w >= observed - 1e-12) extremeGreater++;
  }
  return { twoSided: extremeTwo / total, greater: extremeGreater / total };
}

/** Hypergeometric probability, written directly with factorials. */
function logFact(n: number): number {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}
function hyperProbability(x: number, r1: number, r2: number, c1: number): number {
  const n = r1 + r2;
  return Math.exp(
    logFact(r1) - logFact(x) - logFact(r1 - x) + logFact(r2) - logFact(c1 - x) - logFact(r2 - (c1 - x)) + logFact(c1) + logFact(n - c1) - logFact(n),
  );
}

/** Pooled two-sample t statistic, written out so it is not borrowed. */
function pooledT(a: number[], b: number[]): number {
  const na = a.length;
  const nb = b.length;
  const sp2 = ((na - 1) * variance(a) + (nb - 1) * variance(b)) / (na + nb - 2);
  return (mean(a) - mean(b)) / Math.sqrt(sp2 * (1 / na + 1 / nb));
}

function normalSample(rng: Random, n: number, mu = 0, sigma = 1): number[] {
  return Array.from({ length: n }, () => mu + sigma * rng.normal());
}

// ---------------------------------------------------------------------------

describe('Mann–Whitney exact null distribution', () => {
  it('matches brute-force enumeration of every rank split to 1e-12', () => {
    const cases: [number[], number[]][] = [
      [[1.5, 2.5, 7.5], [3.5, 4.5, 5.5, 6.5]],
      [[10, 12, 14, 16], [11, 13, 15, 17, 19]],
      [[0.1, 0.4, 0.9, 1.6, 2.5], [0.2, 0.3, 0.8, 1.1]],
      [[5, 6], [1, 2, 3, 4, 7, 8]],
    ];
    for (const [a, b] of cases) {
      const reference = enumerateMannWhitney(a, b);
      const two = mannWhitneyUTest(a, b, { alternative: 'two-sided' });
      const greater = mannWhitneyUTest(a, b, { alternative: 'greater' });
      const less = mannWhitneyUTest(a, b, { alternative: 'less' });
      expect(two.pValueRoute).toBe('exact');
      expect(two.exactness).toBe('exact');
      expect(two.statistic).toBeCloseTo(uStatistic(a, b), 12);
      expect(two.pValue).toBeCloseTo(reference.twoSided, 12);
      expect(greater.pValue).toBeCloseTo(reference.greater, 12);
      expect(less.pValue).toBeCloseTo(reference.less, 12);
    }
  });

  it('reports the exact route and its reason, and the asymptotic route beyond the limit', () => {
    const rng = new Random('mw-route');
    const big = mannWhitneyUTest(normalSample(rng, 30), normalSample(rng, 30));
    expect(big.pValueRoute).toBe('asymptotic');
    expect(big.exactness).toBe('numerical');
    expect(big.pValueRouteReason).toMatch(/exceeds the exact limit/);
    expect(big.pValueRouteReason).toMatch(/continuity correction/);
  });

  it('reports the common-language effect size and the rank-biserial correlation', () => {
    const r = mannWhitneyUTest([1, 2, 3, 4], [5, 6, 7, 8]);
    // Every value in A is below every value in B, so P(A > B) = 0.
    expect(r.effectSizes[0].value).toBe(0);
    expect(r.effectSizes[1].value).toBe(-1);
    expect(r.effectSizes[0].name).toMatch(/Common-language/);
  });
});

describe('Hodges–Lehmann shift', () => {
  it('is the median of all pairwise differences', () => {
    const a = [4, 6, 8, 10];
    const b = [1, 2, 3];
    const diffs: number[] = [];
    for (const x of a) for (const y of b) diffs.push(x - y);
    diffs.sort((p, q) => p - q);
    const expected = (diffs[5] + diffs[6]) / 2;
    expect(hodgesLehmannShift(a, b).estimate).toBeCloseTo(expected, 12);
  });

  it('gives an interval that excludes 0 exactly when the exact test rejects', () => {
    // The interval is the set of shifts the test would not reject, so the two
    // must agree. This is a property of the construction, not a fitted value.
    const cases: [number[], number[]][] = [
      [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]],
      [[1, 3, 5, 7, 9], [2, 4, 6, 8, 10]],
      [[1, 2, 3, 4, 5, 6], [4.5, 5.5, 6.5, 7.5, 8.5, 9.5]],
    ];
    for (const [a, b] of cases) {
      const hl = hodgesLehmannShift(a, b, 0.95);
      const p = mannWhitneyUTest(a, b).pValue;
      const excludesZero = hl.interval.low > 0 || hl.interval.high < 0;
      expect(excludesZero).toBe(p < 0.05);
    }
  });
});

describe('Wilcoxon signed rank', () => {
  it('matches brute-force enumeration over all sign patterns to 1e-12', () => {
    const cases: number[][] = [
      [1.1, -2.3, 3.7, 4.2, -0.5, 6.1],
      [0.4, 1.2, 2.9, 3.3, 4.8, 5.2, 6.6],
      [-1, -2.5, 3.25, -4.5, 5.75],
    ];
    for (const diffs of cases) {
      const reference = enumerateSignedRank(diffs);
      const a = diffs.map((d, i) => d + i * 10);
      const b = a.map((v, i) => v - diffs[i]);
      const two = wilcoxonSignedRankTest(a, b);
      const greater = wilcoxonSignedRankTest(a, b, { alternative: 'greater' });
      expect(two.pValueRoute).toBe('exact');
      expect(two.pValue).toBeCloseTo(reference.twoSided, 12);
      expect(greater.pValue).toBeCloseTo(reference.greater, 12);
    }
  });

  it('drops zero differences with the standard reduction and says so', () => {
    const a = [1, 2, 3, 4, 5, 6];
    const b = [1, 1, 1, 1, 1, 1];
    const r = wilcoxonSignedRankTest(a, b);
    expect(r.diagnostics.zerosDropped).toBe(1);
    expect(r.diagnostics.n).toBe(5);
    expect(r.limitations.join(' ')).toMatch(/standard reduction/);
  });

  it('uses the tie-corrected asymptotic route when absolute differences tie', () => {
    const a = [2, 4, 2, 4, 2, 4, 2, 4, 2, 4, 2, 4];
    const b = a.map((_, i) => (i % 2 === 0 ? 1 : 1));
    const r = wilcoxonSignedRankTest(a, b);
    expect(r.ties.tiesPresent).toBe(true);
    expect(r.ties.correctionApplied).toBe(true);
    expect(r.pValueRoute).toBe('asymptotic');
    expect(r.diagnostics.varianceW).toBeLessThan(r.diagnostics.varianceWNoTieCorrection);
  });
});

describe('Sign test', () => {
  it('is an exact binomial tail', () => {
    // 7 of 8 differences positive: two-sided p = 2·P(X ≤ 1) with X ~ Bin(8, ½)
    // = 2·(1 + 8)/256 = 9/128.
    const a = [2, 2, 2, 2, 2, 2, 2, 0];
    const b = [1, 1, 1, 1, 1, 1, 1, 1];
    const r = signTest(a, b);
    expect(r.exactness).toBe('exact');
    expect(r.pValue).toBeCloseTo(18 / 256, 12);
  });
});

describe("McNemar's test", () => {
  it('agrees with the binomial reference and orders exact ≥ mid-p', () => {
    // b = 12, c = 3: exact two-sided = 2·P(X ≤ 3), X ~ Bin(15, ½).
    const table = [[20, 12], [3, 25]];
    let lower = 0;
    for (let k = 0; k <= 3; k++) lower += Math.exp(logFact(15) - logFact(k) - logFact(15 - k)) * 0.5 ** 15;
    const exact = mcnemarTest(table, { variant: 'exact' });
    const mid = mcnemarTest(table, { variant: 'mid-p' });
    const chi = mcnemarTest(table, { variant: 'chi-square' });
    expect(exact.pValue).toBeCloseTo(2 * lower, 12);
    expect(mid.pValue).toBeLessThan(exact.pValue);
    expect(chi.pValueRoute).toBe('asymptotic');
    // Continuity-corrected χ² = (|12−3|−1)²/15 = 64/15.
    expect(chi.statistic).toBeCloseTo(64 / 15, 12);
  });

  it('refuses a table with no discordant pairs', () => {
    expect(() => mcnemarTest([[10, 0], [0, 10]])).toThrow(EngineError);
    expect(() => mcnemarTest([[10, 0], [0, 10]])).toThrow(/concordant/);
  });
});

describe('Known reductions to already-tested code', () => {
  it('Kruskal–Wallis with 2 groups equals the Mann–Whitney χ² approximation (1e-10)', () => {
    const rng = new Random('kw-reduction');
    for (let rep = 0; rep < 5; rep++) {
      const a = normalSample(rng, 9);
      const b = normalSample(rng, 11, 0.4);
      const kw = kruskalWallisTest([{ values: a }, { values: b }]);
      const mw = mannWhitneyUTest(a, b);
      expect(kw.statistic).toBeCloseTo(mw.diagnostics.chiSquareEquivalent, 10);
    }
  });

  it('Kruskal–Wallis with 2 tied groups still equals the tie-corrected Mann–Whitney χ² (1e-10)', () => {
    const a = [1, 1, 2, 2, 3, 3, 4];
    const b = [2, 2, 3, 3, 4, 4, 5, 5];
    const kw = kruskalWallisTest([{ values: a }, { values: b }]);
    const mw = mannWhitneyUTest(a, b);
    expect(kw.ties.correctionApplied).toBe(true);
    expect(kw.statistic).toBeCloseTo(mw.diagnostics.chiSquareEquivalent, 10);
  });

  it('one-way ANOVA with 2 equal-sized groups gives F = t² against the existing t test (1e-10)', () => {
    const rng = new Random('anova-reduction');
    for (let rep = 0; rep < 5; rep++) {
      const a = normalSample(rng, 12);
      const b = normalSample(rng, 12, 0.5);
      const anova = oneWayAnovaTest([{ values: a }, { values: b }]);
      // With equal group sizes Welch's statistic coincides with the pooled one,
      // so the existing (SciPy-checked) t test is a valid reference.
      const t = welchTTest(a, b).statistic;
      expect(t).toBeCloseTo(pooledT(a, b), 10);
      expect(anova.statistic).toBeCloseTo(t * t, 10);
      // The p-values agree with the pooled t test on n₁+n₂−2 degrees of
      // freedom. (Welch's t statistic coincides with the pooled one at equal
      // group sizes, but its degrees of freedom do not, so the comparison is
      // made against the pooled reference distribution.)
      const pooledP = 2 * studentT.sf(Math.abs(t), { nu: a.length + b.length - 2, mu: 0, sigma: 1 });
      expect(anova.pValue).toBeCloseTo(pooledP, 10);
    }
  });

  it("Welch's ANOVA with 2 groups gives F = t² against the existing Welch t test (1e-10)", () => {
    const rng = new Random('welch-reduction');
    for (let rep = 0; rep < 5; rep++) {
      const a = normalSample(rng, 8, 0, 1);
      const b = normalSample(rng, 15, 0.6, 3);
      const welch = welchAnovaTest([{ values: a }, { values: b }]);
      const t = welchTTest(a, b);
      expect(welch.statistic).toBeCloseTo(t.statistic ** 2, 10);
      expect(welch.pValue).toBeCloseTo(t.pValue, 10);
      expect(Array.isArray(welch.degreesOfFreedom) ? welch.degreesOfFreedom[1] : NaN).toBeCloseTo(t.degreesOfFreedom as number, 8);
    }
  });

  it('Friedman with 2 conditions reduces to the sign counts, and tracks the sign test', () => {
    const rng = new Random('friedman-reduction');
    const blocks: number[][] = [];
    for (let i = 0; i < 20; i++) {
      const base = rng.normal();
      blocks.push([base, base + 0.5 + 0.3 * rng.normal()]);
    }
    const fr = friedmanTest(blocks);
    const positives = blocks.filter((r) => r[0] > r[1]).length;
    const negatives = blocks.length - positives;
    // With k = 2 the Friedman statistic is exactly (n₊ − n₋)²/n.
    expect(fr.statistic).toBeCloseTo((positives - negatives) ** 2 / blocks.length, 10);
    const sign = signTest(blocks.map((r) => r[0]), blocks.map((r) => r[1]));
    // The asymptotic Friedman p-value and the exact sign-test p-value are the
    // normal approximation and the exact version of the same comparison.
    expect(Math.abs(fr.pValue - sign.pValue)).toBeLessThan(0.05);
  });

  it("the studentised range with k = 2 reduces analytically to √2·|t| (1e-8)", () => {
    for (const df of [4, 12, 60]) {
      for (const q of [0.8, 2, 4]) {
        const expected = 2 * studentT.sf(q / Math.SQRT2, { nu: df, mu: 0, sigma: 1 });
        expect(studentizedRangeSf(q, 2, df)).toBeCloseTo(expected, 8);
      }
    }
  });
});

describe("Fisher's exact test", () => {
  it('gives the tea-tasting p-value 17/70 one-sided (1e-6) and matches a direct hypergeometric sum', () => {
    const table = [[3, 1], [1, 3]];
    const r = fisherExact2x2(table, { alternative: 'greater' });
    expect(r.pValue).toBeCloseTo(17 / 70, 12);
    expect(r.pValue).toBeCloseTo(0.242857, 6);
    // Direct sum over the hypergeometric tail, computed here from factorials.
    const direct = hyperProbability(3, 4, 4, 4) + hyperProbability(4, 4, 4, 4);
    expect(r.pValue).toBeCloseTo(direct, 12);
    // Two-sided by the "no more probable than observed" rule = 34/70.
    const two = fisherExact2x2(table);
    expect(two.twoSidedByProbability).toBeCloseTo(34 / 70, 12);
    expect(two.pValueRouteReason).toMatch(/no more probable/);
  });

  it('reports both two-sided definitions and uses the one it names', () => {
    // On this table the two definitions genuinely disagree (0.040959 against
    // 0.081918), which is the point of reporting both.
    const table = [[3, 1], [1, 9]];
    const byProb = fisherExact2x2(table, { twoSided: 'probability' });
    const byDouble = fisherExact2x2(table, { twoSided: 'doubling' });
    expect(byProb.pValue).toBeCloseTo(byProb.twoSidedByProbability, 15);
    expect(byDouble.pValue).toBeCloseTo(byDouble.twoSidedByDoubling, 15);
    expect(byProb.twoSidedByProbability).toBeCloseTo(0.040959, 6);
    expect(byProb.twoSidedByDoubling).toBeCloseTo(0.081918, 6);
  });

  it('exact conditional odds-ratio interval satisfies its defining tail equation', () => {
    // The upper limit ψ solves P_ψ(X ≤ a) = 0.025 for the non-central
    // hypergeometric distribution; check that directly from the weights.
    const r = fisherExact2x2([[3, 1], [1, 3]]);
    const psi = r.interval?.high as number;
    const weights = [0, 1, 2, 3, 4].map((x) => Math.exp(logFact(4) - logFact(x) - logFact(4 - x)) ** 2);
    const terms = weights.map((w, x) => w * psi ** x);
    const total = terms.reduce((p, q) => p + q, 0);
    const lower = terms.slice(0, 4).reduce((p, q) => p + q, 0);
    expect(lower / total).toBeCloseTo(0.025, 8);
  });

  it('Fisher–Freeman–Halton agrees with Fisher on a 2 × 2 table (1e-12)', () => {
    const table = [[3, 7], [8, 2]];
    expect(fisherFreemanHalton(table).pValue).toBeCloseTo(fisherExact2x2(table).pValue, 12);
  });

  it('Fisher–Freeman–Halton refuses a table that is too large rather than approximating', () => {
    expect(() => fisherFreemanHalton([[5, 6, 7], [8, 9, 10], [11, 12, 13]], { budget: 50 })).toThrow(/refused rather than approximated/);
  });

  it("Barnard's test is more powerful than Fisher's on the same table", () => {
    const table = [[7, 12], [8, 3]];
    expect(barnardExactTest(table).pValue).toBeLessThan(fisherExact2x2(table).pValue);
  });

  it('odds ratio, risk ratio and NNT come out of the definitions', () => {
    const e = twoByTwoEffects([[10, 90], [20, 80]]);
    expect(e.oddsRatio.value).toBeCloseTo((10 * 80) / (90 * 20), 12);
    expect(e.riskRatio.value).toBeCloseTo(0.1 / 0.2, 12);
    expect(e.riskDifference.value).toBeCloseTo(-0.1, 12);
    expect(e.numberNeededToTreat.value).toBeCloseTo(10, 12);
    expect(e.numberNeededToTreat.kind).toBe('benefit');
    // The exact conditional interval is wider than the Wald interval.
    expect(e.oddsRatio.exactInterval?.low).toBeLessThan(e.oddsRatio.waldInterval?.low as number);
    expect(e.oddsRatio.exactInterval?.high).toBeGreaterThan(e.oddsRatio.waldInterval?.high as number);
  });

  it('Cochran–Armitage finds a monotone trend a χ² test of a flat pattern would not', () => {
    const trend = cochranArmitageTrend([2, 5, 9, 14], [20, 20, 20, 20]);
    expect(trend.pValue).toBeLessThan(0.001);
    expect(trend.diagnostics.slope).toBeCloseTo(0.2, 10);
    // A non-monotone pattern with the same overall spread gives no trend.
    const flat = cochranArmitageTrend([2, 14, 14, 2], [20, 20, 20, 20]);
    expect(flat.pValue).toBeGreaterThan(0.5);
  });
});

describe('Permutation test', () => {
  it('exhaustive enumeration matches the brute-force mean-difference reference', () => {
    const a = [1, 4, 6, 9];
    const b = [2, 3, 7, 11, 12];
    const r = permutationTest([{ values: a }, { values: b }], meanDifference, { alternative: 'two-sided' });
    expect(r.pValueRoute).toBe('exact');
    // Reference: enumerate every split here.
    const pooled = [...a, ...b];
    const observed = mean(a) - mean(b);
    let extreme = 0;
    let total = 0;
    for (const idx of subsets(pooled.length, a.length)) {
      const set = new Set(idx);
      const xs = idx.map((i) => pooled[i]);
      const ys = pooled.filter((_, i) => !set.has(i));
      total++;
      if (Math.abs(mean(xs) - mean(ys)) >= Math.abs(observed) - 1e-12) extreme++;
    }
    expect(r.pValue).toBeCloseTo(extreme / total, 12);
  });

  it('Monte Carlo converges to the exact enumerated p-value within its reported standard error', () => {
    const a = [1, 4, 6, 9, 13, 14];
    const b = [2, 3, 7, 11, 12, 15, 16];
    const exact = permutationTest([{ values: a }, { values: b }], meanDifference);
    const mc = permutationTest([{ values: a }, { values: b }], meanDifference, {
      maxExactPermutations: 10,
      monteCarloSamples: 20000,
      seed: 'perm-mc',
    });
    expect(mc.pValueRoute).toBe('monte-carlo');
    expect(mc.exactness).toBe('empirical');
    const se = mc.diagnostics.monteCarloStandardError;
    expect(se).toBeGreaterThan(0);
    // Within 3 standard errors: a 99.7% interval for a correct sampler.
    expect(Math.abs(mc.pValue - exact.pValue)).toBeLessThan(3 * se);
  });

  it('is a cancellable generator that yields between chunks', () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8];
    const b = [2, 3, 4, 5, 6, 7, 8, 9];
    const steps = permutationTestSteps([{ values: a }, { values: b }], meanDifference, {
      maxExactPermutations: 1,
      monteCarloSamples: 5000,
      chunkSize: 1000,
      seed: 'perm-chunks',
    });
    let yields = 0;
    let next = steps.next();
    while (!next.done) {
      yields++;
      expect(next.value.completed).toBeGreaterThan(0);
      expect(next.value.route).toBe('monte-carlo');
      next = steps.next();
    }
    expect(yields).toBe(5);
    expect(next.value.diagnostics.permutations).toBe(5000);
  });

  it('never reports p = 0 from Monte Carlo', () => {
    const a = Array.from({ length: 12 }, (_, i) => i);
    const b = Array.from({ length: 12 }, (_, i) => i + 50);
    const mc = permutationTest([{ values: a }, { values: b }], meanDifference, {
      maxExactPermutations: 10,
      monteCarloSamples: 2000,
      seed: 'perm-zero',
    });
    expect(mc.pValue).toBeGreaterThan(0);
    expect(mc.pValue).toBeCloseTo(1 / 2001, 12);
  });
});

describe('Bootstrap intervals', () => {
  it('percentile, basic and BCa bracket a well-behaved mean', () => {
    const rng = new Random('boot-basic');
    const data = normalSample(rng, 40, 5, 2);
    const r = bootstrapInterval(data, mean, { resamples: 1000, seed: 'boot-1' });
    expect(r.estimate).toBeCloseTo(mean(data), 12);
    for (const ci of [r.percentile, r.basic, r.bca]) {
      expect(ci.low).toBeLessThan(r.estimate);
      expect(ci.high).toBeGreaterThan(r.estimate);
    }
    expect(r.exactness).toBe('empirical');
  });

  it('BCa covers close to 95% and beats the percentile interval on a skewed statistic', () => {
    // 300 replications of the mean of 15 exponential(1) observations. The
    // sampling distribution is right-skewed, which is exactly the case where
    // the percentile interval is known to undercover and BCa to correct it.
    // Truth: the mean is 1.
    const rng = new Random('bca-coverage');
    let bca = 0;
    let percentile = 0;
    const reps = 300;
    for (let i = 0; i < reps; i++) {
      const data = Array.from({ length: 15 }, () => rng.exponential(1));
      const r = bootstrapInterval(data, mean, { resamples: 400, seed: `bca-${i}` });
      if (r.bca.low <= 1 && r.bca.high >= 1) bca++;
      if (r.percentile.low <= 1 && r.percentile.high >= 1) percentile++;
    }
    const bcaRate = bca / reps;
    const percentileRate = percentile / reps;
    console.log(`coverage of a nominal 95% interval for the mean of 15 exponential(1) values: BCa ${bcaRate}, percentile ${percentileRate}`);
    // Binomial standard error at p = 0.93 with 300 reps is about 0.015, so a
    // ±4 SE window is [0.87, 0.99]; a method with real 95% coverage and a
    // method that undercovers badly are easily distinguished at this width.
    expect(bcaRate).toBeGreaterThan(0.87);
    expect(bcaRate).toBeLessThanOrEqual(1);
    expect(bcaRate).toBeGreaterThanOrEqual(percentileRate);
  });

  it('refuses a statistic that does not vary under resampling', () => {
    expect(() => bootstrapInterval([3, 3, 3, 3, 3], mean, { resamples: 200 })).toThrow(/identical/);
  });
});

describe('Multiplicity corrections', () => {
  const p = [0.001, 0.008, 0.012, 0.03, 0.04, 0.2, 0.5, 0.9];

  it('Holm is uniformly no more conservative than Bonferroni and both control FWER', () => {
    const bonf = adjustPValues(p, 'bonferroni', 0.05);
    const holm = adjustPValues(p, 'holm', 0.05);
    for (let i = 0; i < p.length; i++) {
      expect(holm.adjusted[i]).toBeLessThanOrEqual(bonf.adjusted[i] + 1e-15);
      expect(holm.adjusted[i]).toBeGreaterThanOrEqual(p[i] - 1e-15);
    }
    expect(holm.rejectedCount).toBeGreaterThanOrEqual(bonf.rejectedCount);
  });

  it('Benjamini–Hochberg rejects at least as many as Holm, and Benjamini–Yekutieli at most as many as BH', () => {
    const holm = adjustPValues(p, 'holm', 0.05);
    const bh = adjustPValues(p, 'benjamini-hochberg', 0.05);
    const by = adjustPValues(p, 'benjamini-yekutieli', 0.05);
    expect(bh.rejectedCount).toBeGreaterThanOrEqual(holm.rejectedCount);
    expect(by.rejectedCount).toBeLessThanOrEqual(bh.rejectedCount);
    for (let i = 0; i < p.length; i++) expect(bh.adjusted[i]).toBeLessThanOrEqual(holm.adjusted[i] + 1e-15);
  });

  it('adjusted p-values are monotone in the original ordering (a classic implementation bug)', () => {
    const shuffled = [0.04, 0.9, 0.001, 0.5, 0.012, 0.2, 0.008, 0.03];
    for (const method of ['bonferroni', 'holm', 'hochberg', 'benjamini-hochberg', 'benjamini-yekutieli'] as const) {
      const adj = adjustPValues(shuffled, method, 0.05).adjusted;
      for (let i = 0; i < shuffled.length; i++) {
        for (let j = 0; j < shuffled.length; j++) {
          if (shuffled[i] < shuffled[j]) expect(adj[i]).toBeLessThanOrEqual(adj[j] + 1e-15);
        }
      }
    }
  });

  it('refuses a value that is not a p-value', () => {
    expect(() => adjustPValues([0.1, 1.4], 'holm')).toThrow(EngineError);
    expect(() => adjustPValues([], 'holm')).toThrow(/No p-values/);
  });
});

describe('Post-hoc procedures', () => {
  const rng = new Random('posthoc');
  const groups = [
    { label: 'A', values: normalSample(rng, 10, 0) },
    { label: 'B', values: normalSample(rng, 10, 1.5) },
    { label: 'C', values: normalSample(rng, 10, 3) },
  ];

  it('Tukey HSD matches published studentised range critical values', () => {
    // Reference: standard published tables of the studentised range q_{0.05}.
    expect(studentizedRangeQuantile(0.95, 3, 10)).toBeCloseTo(3.88, 2);
    expect(studentizedRangeQuantile(0.95, 4, 20)).toBeCloseTo(3.96, 2);
    expect(studentizedRangeQuantile(0.95, 5, 30)).toBeCloseTo(4.1, 2);
    expect(studentizedRangeQuantile(0.99, 3, 12)).toBeCloseTo(5.05, 2);
    expect(studentizedRangeQuantile(0.95, 10, Infinity)).toBeCloseTo(4.47, 2);
  });

  it('Tukey adjusted p-values exceed the unadjusted pairwise t p-values, and say they are adjusted', () => {
    const r = tukeyHsd(groups);
    expect(r.comparisons).toHaveLength(3);
    for (const c of r.comparisons) {
      expect(c.pValueAdjusted).toBeGreaterThan(c.pValueUnadjusted);
      expect(c.interval).not.toBeNull();
    }
    expect(r.multiplicityControl).toMatch(/family-wise/);
  });

  it("Dunn's test adjusts and reports which control it used", () => {
    const r = dunnTest(groups, { adjust: 'holm' });
    expect(r.comparisons).toHaveLength(3);
    for (const c of r.comparisons) expect(c.pValueAdjusted).toBeGreaterThanOrEqual(c.pValueUnadjusted - 1e-15);
    expect(r.multiplicityControl).toMatch(/holm/);
    const bonf = dunnTest(groups, { adjust: 'bonferroni' });
    for (let i = 0; i < 3; i++) {
      expect(r.comparisons[i].pValueAdjusted).toBeLessThanOrEqual(bonf.comparisons[i].pValueAdjusted + 1e-15);
    }
  });

  it('Games–Howell handles unequal variances and still adjusts', () => {
    const rng2 = new Random('gh');
    const uneven = [
      { label: 'A', values: normalSample(rng2, 12, 0, 1) },
      { label: 'B', values: normalSample(rng2, 12, 2, 5) },
      { label: 'C', values: normalSample(rng2, 12, 4, 0.5) },
    ];
    const r = gamesHowell(uneven);
    expect(r.comparisons).toHaveLength(3);
    for (const c of r.comparisons) expect(c.pValueAdjusted).toBeGreaterThan(c.pValueUnadjusted);
    expect(r.assumptions.join(' ')).toMatch(/NOT assumed equal/);
  });

  it('Nemenyi reports a critical difference and adjusted p-values for Friedman data', () => {
    const rng3 = new Random('nemenyi');
    const blocks = Array.from({ length: 15 }, () => {
      const base = rng3.normal();
      return [base, base + 1, base + 2.5];
    });
    const r = nemenyiTest(blocks);
    expect(r.comparisons).toHaveLength(3);
    for (const c of r.comparisons) expect(c.pValueAdjusted).toBeGreaterThanOrEqual(c.pValueUnadjusted - 1e-12);
    expect(r.notes.join(' ')).toMatch(/Critical difference/);
  });
});

describe('Calibration under the null and power against a real effect', () => {
  // 500 datasets with no effect. At a true size of 0.05 the standard error of
  // the observed rejection rate is √(0.05·0.95/500) = 0.00975, so a ±0.035
  // window is about 3.6 standard errors — wide enough that a correct test
  // essentially never fails, and narrow enough that a test whose true size is
  // 0.10 (double) or 0.02 is caught every time.
  const REPS = 500;
  const TOLERANCE = 0.035;
  const rates: Record<string, number> = {};

  it('Mann–Whitney, Kruskal–Wallis and ANOVA all hold their 5% type I error rate', () => {
    const rng = new Random('null-calibration');
    let mw = 0;
    let kw = 0;
    let anova = 0;
    let welch = 0;
    for (let i = 0; i < REPS; i++) {
      const a = normalSample(rng, 15);
      const b = normalSample(rng, 15);
      const c = normalSample(rng, 15);
      if (mannWhitneyUTest(a, b).pValue < 0.05) mw++;
      if (kruskalWallisTest([{ values: a }, { values: b }, { values: c }]).pValue < 0.05) kw++;
      if (oneWayAnovaTest([{ values: a }, { values: b }, { values: c }]).pValue < 0.05) anova++;
      if (welchAnovaTest([{ values: a }, { values: b }, { values: c }]).pValue < 0.05) welch++;
    }
    rates.mannWhitney = mw / REPS;
    rates.kruskalWallis = kw / REPS;
    rates.anova = anova / REPS;
    rates.welchAnova = welch / REPS;
    // Printed so the measured rates are visible in the test output.
    console.log('type I error rates at α = 0.05:', rates);
    expect(Math.abs(rates.mannWhitney - 0.05)).toBeLessThan(TOLERANCE);
    expect(Math.abs(rates.kruskalWallis - 0.05)).toBeLessThan(TOLERANCE);
    expect(Math.abs(rates.anova - 0.05)).toBeLessThan(TOLERANCE);
    expect(Math.abs(rates.welchAnova - 0.05)).toBeLessThan(TOLERANCE);
  });

  it('and all detect a large real effect', () => {
    const rng = new Random('power-check');
    const reps = 200;
    let mw = 0;
    let kw = 0;
    let anova = 0;
    for (let i = 0; i < reps; i++) {
      const a = normalSample(rng, 15, 0);
      const b = normalSample(rng, 15, 1.5);
      const c = normalSample(rng, 15, 3);
      if (mannWhitneyUTest(a, b).pValue < 0.05) mw++;
      if (kruskalWallisTest([{ values: a }, { values: b }, { values: c }]).pValue < 0.05) kw++;
      if (oneWayAnovaTest([{ values: a }, { values: b }, { values: c }]).pValue < 0.05) anova++;
    }
    // d = 1.5 with n = 15 per group gives a t-test power above 0.95; the rank
    // test is close behind, and the 3-group tests face a larger spread still.
    expect(mw / reps).toBeGreaterThan(0.85);
    expect(kw / reps).toBeGreaterThan(0.95);
    expect(anova / reps).toBeGreaterThan(0.95);
  });

  it("Brunner–Munzel holds its size under unequal variances where Mann–Whitney's claim is about more than location", () => {
    const rng = new Random('bm-size');
    const reps = 300;
    let bm = 0;
    for (let i = 0; i < reps; i++) {
      const a = normalSample(rng, 20, 0, 1);
      const b = normalSample(rng, 20, 0, 4);
      if (brunnerMunzelTest(a, b).pValue < 0.05) bm++;
    }
    // Under equal medians with very different spreads the relative effect is
    // still ½, so a valid test must not over-reject. 300 reps gives a standard
    // error of 0.0126; allow up to 0.10 for the known small-sample liberality.
    console.log('Brunner–Munzel type I error under heteroscedasticity:', bm / reps);
    expect(bm / reps).toBeLessThan(0.1);
  });
});

describe('Tie handling', () => {
  it('Mann–Whitney corrects the variance of U for ties and reports it', () => {
    const a = [1, 1, 1, 2, 2, 2, 3, 3];
    const b = [2, 2, 3, 3, 3, 4, 4, 4];
    const r = mannWhitneyUTest(a, b);
    expect(r.ties.tiesPresent).toBe(true);
    expect(r.ties.correctionApplied).toBe(true);
    expect(r.ties.detail).toMatch(/corrected for ties/);
    expect(r.diagnostics.varianceU).toBeLessThan(r.diagnostics.varianceUNoTieCorrection);
    expect(r.pValueRoute).toBe('asymptotic');
    expect(r.pValueRouteReason).toMatch(/Tied observations/);
  });

  it('Kruskal–Wallis inflates H by the tie divisor and says so', () => {
    const tied = [
      { label: 'A', values: [1, 1, 1, 2, 2, 2] },
      { label: 'B', values: [2, 2, 3, 3, 3, 3] },
      { label: 'C', values: [3, 3, 4, 4, 4, 4] },
    ];
    const r = kruskalWallisTest(tied);
    expect(r.ties.correctionApplied).toBe(true);
    expect(r.diagnostics.tieDivisor).toBeLessThan(1);
    expect(r.statistic).toBeGreaterThan(r.diagnostics.hUncorrected);
  });

  it('Friedman corrects for ties within blocks', () => {
    const blocks = [
      [1, 1, 2],
      [2, 2, 3],
      [1, 2, 2],
      [3, 3, 4],
      [1, 1, 1],
      [2, 3, 3],
    ];
    const r = friedmanTest(blocks);
    expect(r.ties.tiesPresent).toBe(true);
    expect(r.ties.correctionApplied).toBe(true);
    expect(r.diagnostics.tieDivisor).toBeLessThan(1);
    expect(r.statistic).toBeGreaterThan(r.diagnostics.qUncorrected);
  });

  it('a KS test with ties drops to the conservative asymptotic route and says why', () => {
    const r = ksTwoSampleTest([1, 2, 2, 3, 4, 5], [2, 3, 3, 4, 5, 6]);
    expect(r.pValueRoute).toBe('asymptotic');
    expect(r.pValueRouteReason).toMatch(/Tied values/);
    expect(r.limitations.join(' ')).toMatch(/conservative/);
  });
});

describe('Effect sizes and group tables', () => {
  it('one-way ANOVA reports η², ω², partial η² and the group means', () => {
    const r = oneWayAnovaTest([
      { label: 'low', values: [1, 2, 3, 4] },
      { label: 'mid', values: [3, 4, 5, 6] },
      { label: 'high', values: [8, 9, 10, 11] },
    ]);
    const names = r.effectSizes.map((e) => e.name);
    expect(names.some((n) => n.includes('η²'))).toBe(true);
    expect(names.some((n) => n.includes('ω²'))).toBe(true);
    expect(names.some((n) => n.includes('Partial'))).toBe(true);
    expect(r.groups).toHaveLength(3);
    expect(r.groups[0].mean).toBeCloseTo(2.5, 12);
    expect(r.groups[2].label).toBe('high');
    // η² = SSB/SST by definition.
    expect(r.diagnostics.etaSquared).toBeCloseTo(r.diagnostics.ssBetween / (r.diagnostics.ssBetween + r.diagnostics.ssWithin), 12);
    // ω² is smaller than η², being bias corrected.
    expect(r.diagnostics.omegaSquared).toBeLessThan(r.diagnostics.etaSquared);
  });

  it('Welch ANOVA explains when to prefer it', () => {
    const r = welchAnovaTest([
      { label: 'A', values: [1, 2, 3, 4, 5] },
      { label: 'B', values: [1, 5, 9, 13, 20] },
      { label: 'C', values: [4, 4.5, 5, 5.5, 6] },
    ]);
    expect(r.limitations.join(' ')).toMatch(/Prefer this test over the classical F test/);
    expect(r.assumptions.join(' ')).toMatch(/NOT assumed equal/);
  });

  it('two-way ANOVA separates both main effects and the interaction', () => {
    // A crossed design built so that factor A shifts the mean, factor B does
    // not, and the interaction is zero by construction.
    // The same residual pattern in every cell, so SS(B) and SS(A×B) are
    // exactly 0 by construction and only factor A can be detected.
    const residuals = [-3, -1.5, -0.5, 0, 0.5, 1.5, 3, 0];
    const cells = [] as { levelA: string; levelB: string; values: number[] }[];
    for (const [ia, la] of ['a1', 'a2'].entries()) {
      for (const lb of ['b1', 'b2']) {
        cells.push({ levelA: la, levelB: lb, values: residuals.map((e) => 3 * ia + e) });
      }
    }
    const r = twoWayAnovaTest(cells);
    expect(r.factorA.pValue).toBeLessThan(0.001);
    expect(r.factorB.diagnostics.ss).toBeCloseTo(0, 12);
    expect(r.interaction.diagnostics.ss).toBeCloseTo(0, 12);
    expect(r.factorB.pValue).toBeCloseTo(1, 12);
    expect(r.interaction.pValue).toBeCloseTo(1, 12);
    expect(r.cellMeans).toHaveLength(4);
    // Orthogonality of a balanced design: the sums of squares add up.
    const total = r.factorA.diagnostics.ss + r.factorB.diagnostics.ss + r.interaction.diagnostics.ss + r.interaction.diagnostics.msError * r.interaction.diagnostics.df2;
    const all = cells.flatMap((c) => c.values);
    const grand = mean(all);
    const ssTotal = all.reduce((acc, v) => acc + (v - grand) ** 2, 0);
    expect(total).toBeCloseTo(ssTotal, 8);
  });

  it('refuses an unbalanced two-way design instead of picking a convention', () => {
    const cells = [
      { levelA: 'a1', levelB: 'b1', values: [1, 2, 3] },
      { levelA: 'a1', levelB: 'b2', values: [2, 3, 4] },
      { levelA: 'a2', levelB: 'b1', values: [3, 4, 5] },
      { levelA: 'a2', levelB: 'b2', values: [4, 5] },
    ];
    expect(() => twoWayAnovaTest(cells)).toThrow(/balanced/);
  });
});

describe('Variance tests', () => {
  const rng = new Random('variance');
  const equal = [
    { label: 'A', values: normalSample(rng, 25, 0, 1) },
    { label: 'B', values: normalSample(rng, 25, 0, 1) },
    { label: 'C', values: normalSample(rng, 25, 0, 1) },
  ];
  const unequal = [
    { label: 'A', values: normalSample(rng, 25, 0, 1) },
    { label: 'B', values: normalSample(rng, 25, 0, 4) },
    { label: 'C', values: normalSample(rng, 25, 0, 8) },
  ];

  it('all three detect clearly unequal variances and leave equal ones alone', () => {
    expect(leveneTest(equal).pValue).toBeGreaterThan(0.05);
    expect(leveneTest(unequal).pValue).toBeLessThan(0.01);
    expect(bartlettTest(unequal).pValue).toBeLessThan(0.01);
    expect(flignerKilleenTest(unequal).pValue).toBeLessThan(0.01);
  });

  it('Levene defaults to the median-centred Brown–Forsythe form and offers the mean-centred one', () => {
    expect(leveneTest(unequal).name).toMatch(/Brown–Forsythe/);
    expect(leveneTest(unequal, { center: 'mean' }).name).toMatch(/mean-centred/);
    expect(leveneTest(unequal, { center: 'mean' }).statistic).not.toBeCloseTo(leveneTest(unequal).statistic, 6);
  });

  it('Bartlett warns that it is sensitive to non-normality', () => {
    expect(bartlettTest(unequal).limitations.join(' ')).toMatch(/extremely sensitive to departures from normality/);
  });
});

describe('Minimum detectable effect and the meaning of a non-significant result', () => {
  it('a non-significant result states that failure to reject is not evidence of no effect', () => {
    const r = mannWhitneyUTest([1, 2, 3, 4, 5, 6], [2, 3, 4, 5, 6, 7]);
    expect(r.sensitivity.rejected).toBe(false);
    expect(r.sensitivity.statement).toMatch(/not evidence that there is no effect/);
    expect(r.sensitivity.minimumDetectableEffect).not.toBeNull();
  });

  it('the minimum detectable effect shrinks as n grows', () => {
    const rng = new Random('mde');
    const small = mannWhitneyUTest(normalSample(rng, 8), normalSample(rng, 8));
    const medium = mannWhitneyUTest(normalSample(rng, 25), normalSample(rng, 25));
    const large = mannWhitneyUTest(normalSample(rng, 100), normalSample(rng, 100));
    const mdes = [small, medium, large].map((r) => r.sensitivity.minimumDetectableEffect?.value as number);
    expect(mdes[0]).toBeGreaterThan(mdes[1]);
    expect(mdes[1]).toBeGreaterThan(mdes[2]);
    // n = 8 per group cannot see anything below a very large effect.
    expect(mdes[0]).toBeGreaterThan(1.3);
    // n = 100 per group reaches a small-to-medium effect.
    expect(mdes[2]).toBeLessThan(0.45);
  });

  it('reports achieved power against a conventional effect for ANOVA and Kruskal–Wallis', () => {
    const rng = new Random('power-report');
    const groups = [
      { values: normalSample(rng, 12) },
      { values: normalSample(rng, 12) },
      { values: normalSample(rng, 12) },
    ];
    for (const r of [oneWayAnovaTest(groups), kruskalWallisTest(groups)]) {
      expect(r.sensitivity.achievedPower).toBeGreaterThan(0);
      expect(r.sensitivity.achievedPower).toBeLessThan(1);
      expect(r.sensitivity.minimumDetectableEffect?.scale).toMatch(/Cohen's f/);
    }
  });
});

describe('Brunner–Munzel, KS and Mood', () => {
  it('Brunner–Munzel estimates the relative effect with an interval', () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const b = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const r = brunnerMunzelTest(a, b);
    // Count the pairs directly: the relative effect is P(A < B) + ½P(A = B).
    let count = 0;
    for (const x of a) for (const y of b) count += x < y ? 1 : x === y ? 0.5 : 0;
    expect(r.diagnostics.pHat).toBeCloseTo(count / (a.length * b.length), 10);
    expect(r.interval?.low).toBeLessThan(r.diagnostics.pHat);
    expect(r.interval?.high).toBeGreaterThan(r.diagnostics.pHat);
  });

  it('the two-sample KS exact p-value for completely separated samples is 2/C(n₁+n₂, n₁)', () => {
    const r = ksTwoSampleTest([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]);
    expect(r.statistic).toBe(1);
    expect(r.pValueRoute).toBe('exact');
    expect(r.pValue).toBeCloseTo(2 / 252, 12);
  });

  it("Mood's median test counts above and at-or-below the pooled median", () => {
    const r = moodMedianTest([
      { label: 'A', values: [1, 2, 3, 4, 5] },
      { label: 'B', values: [11, 12, 13, 14, 15] },
    ]);
    expect(r.pValue).toBeLessThan(0.05);
    expect(r.notes.join(' ')).toMatch(/above/);
  });

  it('refuses when every value falls on one side of the pooled median', () => {
    expect(() =>
      moodMedianTest([
        { label: 'A', values: [1, 2] },
        { label: 'B', values: [2, 2] },
      ]),
    ).toThrow(/same side of the pooled median/);
  });
});

describe('Refusals: never a plausible-looking number', () => {
  it('refuses an empty group', () => {
    expect(() => kruskalWallisTest([{ label: 'A', values: [] }, { label: 'B', values: [1, 2, 3] }])).toThrow(/is empty/);
    expect(() => oneWayAnovaTest([{ values: [] }, { values: [1, 2] }])).toThrow(EngineError);
  });

  it('refuses a single-observation group where the test needs two', () => {
    expect(() => oneWayAnovaTest([{ label: 'A', values: [1] }, { label: 'B', values: [1, 2, 3] }])).toThrow(/at least 2 are needed/);
    expect(() => brunnerMunzelTest([1], [1, 2, 3])).toThrow(/at least 2 are needed/);
    expect(() => welchAnovaTest([{ values: [1] }, { values: [1, 2, 3] }])).toThrow(EngineError);
  });

  it('refuses data with no variation', () => {
    expect(() => kruskalWallisTest([{ values: [2, 2, 2] }, { values: [2, 2, 2] }])).toThrow(/no variation/);
    expect(() => oneWayAnovaTest([{ values: [2, 2, 2] }, { values: [5, 5, 5] }])).toThrow(/within-group variance is 0/);
    expect(() => welchAnovaTest([{ values: [2, 2, 2] }, { values: [5, 5, 5] }])).toThrow(/zero variance/);
    expect(() => bartlettTest([{ values: [2, 2, 2] }, { values: [1, 5, 9] }])).toThrow(/zero variance/);
    expect(() => mannWhitneyUTest([2, 2, 2], [2, 2, 2])).toThrow(/no variation/);
  });

  it('refuses fewer than 2 groups', () => {
    expect(() => kruskalWallisTest([{ values: [1, 2, 3] }])).toThrow(/at least 2 groups/);
    expect(() => oneWayAnovaTest([{ values: [1, 2, 3] }])).toThrow(/at least 2 groups/);
    expect(() => tukeyHsd([{ values: [1, 2, 3] }])).toThrow(/at least 2 groups/);
  });

  it('refuses mismatched pair lengths', () => {
    expect(() => wilcoxonSignedRankTest([1, 2, 3], [1, 2])).toThrow(/matched pairs/);
    expect(() => signTest([1, 2, 3], [1, 2])).toThrow(/matched pairs/);
    expect(() => friedmanTest([[1, 2, 3], [1, 2]])).toThrow(/rectangular/);
  });

  it('refuses an exact test on a table that is too large, and Barnard beyond its limit', () => {
    expect(() => fisherFreemanHalton([[20, 20, 20], [20, 20, 20], [20, 20, 20]], { budget: 1000 })).toThrow(/exact test is refused/);
    const big = [[200, 200], [200, 200]];
    expect(() => barnardExactTest(big)).toThrow(/limit is 300/);
  });

  it('refuses a degenerate contingency table', () => {
    expect(() => fisherExact2x2([[5, 0], [5, 0]])).toThrow(/empty row or column/);
    expect(() => cochranArmitageTrend([0, 0, 0], [10, 10, 10])).toThrow(/same outcome/);
  });

  it('refuses non-finite input rather than treating it as a number', () => {
    expect(() => kruskalWallisTest([{ values: [1, NaN, 3] }, { values: [1, 2, 3] }])).toThrow(/not a finite number/);
    expect(() => mannWhitneyUTest([1, 2, Infinity], [1, 2, 3])).toThrow(/not a finite number/);
  });
});

describe('Uniform result contract', () => {
  it('every test returns the same shape, with a route, a reason, ties and a sensitivity statement', () => {
    const rng = new Random('contract');
    const a = normalSample(rng, 12);
    const b = normalSample(rng, 12, 0.8);
    const c = normalSample(rng, 12, 1.6);
    const results = [
      mannWhitneyUTest(a, b),
      brunnerMunzelTest(a, b),
      ksTwoSampleTest(a, b),
      moodMedianTest([{ values: a }, { values: b }]),
      wilcoxonSignedRankTest(a, b),
      signTest(a, b),
      mcnemarTest([[10, 7], [2, 11]]),
      oneWayAnovaTest([{ values: a }, { values: b }, { values: c }]),
      welchAnovaTest([{ values: a }, { values: b }, { values: c }]),
      kruskalWallisTest([{ values: a }, { values: b }, { values: c }]),
      friedmanTest(a.map((v, i) => [v, b[i], c[i]])),
      leveneTest([{ values: a }, { values: b }, { values: c }]),
      bartlettTest([{ values: a }, { values: b }, { values: c }]),
      flignerKilleenTest([{ values: a }, { values: b }, { values: c }]),
      fisherExact2x2([[4, 9], [10, 3]]),
      fisherFreemanHalton([[4, 9], [10, 3]]),
      cochranArmitageTrend([2, 6, 11], [15, 15, 15]),
      barnardExactTest([[4, 9], [10, 3]]),
      permutationTest([{ values: a }, { values: b }], meanDifference, { maxExactPermutations: 10, monteCarloSamples: 500, seed: 'contract' }),
    ];
    for (const r of results) {
      expect(typeof r.name).toBe('string');
      expect(r.pValue).toBeGreaterThanOrEqual(0);
      expect(r.pValue).toBeLessThanOrEqual(1);
      expect(Number.isFinite(r.statistic)).toBe(true);
      expect(['exact', 'asymptotic', 'monte-carlo']).toContain(r.pValueRoute);
      expect(r.pValueRouteReason.length).toBeGreaterThan(20);
      expect(['exact', 'numerical', 'empirical', 'assumed']).toContain(r.exactness);
      expect(r.effectSizes.length).toBeGreaterThan(0);
      expect(r.assumptions.length).toBeGreaterThan(0);
      expect(r.limitations.length).toBeGreaterThan(0);
      expect(typeof r.ties.detail).toBe('string');
      expect(typeof r.sensitivity.statement).toBe('string');
      if (!r.sensitivity.rejected) expect(r.sensitivity.statement).toMatch(/not evidence/);
      // An asymptotic route must be labelled numerical and a Monte Carlo one
      // empirical. An exact route is labelled exact unless some part of the
      // computation is numerical — Barnard's nuisance maximisation is, and it
      // says so — in which case the weaker label is the honest one.
      if (r.pValueRoute === 'monte-carlo') expect(r.exactness).toBe('empirical');
      if (r.pValueRoute === 'asymptotic') expect(r.exactness).toBe('numerical');
      if (r.pValueRoute === 'exact') expect(['exact', 'numerical']).toContain(r.exactness);
    }
  });
});
