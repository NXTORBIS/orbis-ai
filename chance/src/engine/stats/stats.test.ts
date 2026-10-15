import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  clopperPearsonInterval,
  covariance,
  ecdfPoints,
  excessKurtosis,
  frequencyTable,
  histogram,
  mean,
  pearson,
  quantile,
  ranks,
  skewness,
  sortedCopy,
  spearman,
  summarizeSample,
  tConfidenceInterval,
  variance,
  wilsonInterval,
} from './descriptive';
import {
  benjaminiHochberg,
  chiSquareGoodnessOfFit,
  chiSquareIndependence,
  correlationTest,
  fSurvival,
  kolmogorovSmirnovTest,
  mannWhitneyTest,
  oneSampleTTest,
  oneWayAnova,
  pairedTTest,
  twoProportionTest,
  welchTTest,
} from './tests';
import { absorptionAnalysis, classifyChain, nStepDistribution, nStepMatrix, stationaryDistribution, validateChain } from './markov';
import { cleanColumn, detectDelimiter, groupBy, pairedValues, parseCsv, parseJsonDataset, splitLine } from './dataset';
import { normal } from '../distributions/continuous';

const A = [4.1, 5.2, 6.8, 3.3, 7.7, 5.5, 4.9, 6.1, 5.0, 8.2, 2.9, 6.6];
const B = [6.0, 7.1, 5.9, 8.3, 9.0, 6.4, 7.8, 5.1, 7.2, 6.9];

describe('descriptive statistics', () => {
  it('matches hand-computed values with documented conventions', () => {
    const d = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(mean(d)).toBe(5);
    // Sample variance with n−1: 32/7
    expect(variance(d)).toBeCloseTo(32 / 7, 14);
    // Population variance with n: 4
    expect(variance(d, 0)).toBeCloseTo(4, 14);
    // Type-7 quantiles (NumPy default)
    expect(quantile(d, 0.5)).toBe(4.5);
    expect(quantile(d, 0.25)).toBe(4);
    expect(quantile(d, 0.75)).toBe(5.5);
    expect(quantile(d, 0)).toBe(2);
    expect(quantile(d, 1)).toBe(9);
  });
  it('skewness and kurtosis match SciPy bias-corrected values', () => {
    // scipy.stats.skew(A, bias=False) and kurtosis(A, bias=False)
    expect(skewness(A)).toBeCloseTo(0.012715671851430738, 10);
    expect(excessKurtosis(A)).toBeCloseTo(-0.6911733371969029, 10);
    expect(Number.isNaN(skewness([1, 2]))).toBe(true);
    expect(Number.isNaN(excessKurtosis([1, 2, 3]))).toBe(true);
    expect(Number.isNaN(skewness([3, 3, 3, 3]))).toBe(true);
  });
  it('summary handles an empty and a single-value sample without crashing', () => {
    const empty = summarizeSample([]);
    expect(empty.n).toBe(0);
    expect(Number.isNaN(empty.mean)).toBe(true);
    const one = summarizeSample([5]);
    expect(one.mean).toBe(5);
    expect(Number.isNaN(one.variance)).toBe(true);
    expect(one.median).toBe(5);
  });
  it('is numerically stable for values with a huge offset', () => {
    const big = Array.from({ length: 1000 }, (_, i) => 1e9 + (i % 2));
    // True variance of alternating 0/1 around 1e9 is 0.25 (population) → 0.2502 sample.
    expect(variance(big)).toBeCloseTo(0.25025025025, 6);
  });
  it('correlation and covariance match hand calculations', () => {
    const x = [1, 2, 3, 4, 5];
    const y = [2, 4, 5, 4, 5];
    expect(pearson(x, y)).toBeCloseTo(0.7745966692414834, 14);
    expect(covariance(x, y)).toBeCloseTo(1.5, 14);
    expect(Number.isNaN(pearson([1, 1, 1], [1, 2, 3]))).toBe(true);
    expect(pearson([1, 2], [2, 4])).toBeCloseTo(1, 12);
  });
  it('ranks average ties and Spearman uses them', () => {
    expect(Array.from(ranks([10, 20, 20, 30]))).toEqual([1, 2.5, 2.5, 4]);
    // Perfectly monotone but non-linear: Spearman 1, Pearson < 1
    const x = [1, 2, 3, 4, 5];
    const y = [1, 4, 9, 16, 25];
    expect(spearman(x, y)).toBeCloseTo(1, 12);
    expect(pearson(x, y)).toBeLessThan(1);
  });
  it('frequency table and histogram account for every observation', () => {
    const ft = frequencyTable([1, 1, 2, 3, 3, 3])!;
    expect(ft).toEqual([
      { value: 1, count: 2, proportion: 1 / 3 },
      { value: 2, count: 1, proportion: 1 / 6 },
      { value: 3, count: 3, proportion: 0.5 },
    ]);
    expect(frequencyTable(Array.from({ length: 100 }, (_, i) => i), 50)).toBeNull();
    const h = histogram(sortedCopy(A));
    expect(h.reduce((a, b) => a + b.count, 0)).toBe(A.length);
    expect(h.reduce((a, b) => a + b.proportion, 0)).toBeCloseTo(1, 12);
    // Density integrates to 1.
    expect(h.reduce((a, b) => a + b.density * (b.x1 - b.x0), 0)).toBeCloseTo(1, 10);
    const constant = histogram(sortedCopy([5, 5, 5]));
    expect(constant).toHaveLength(1);
    expect(constant[0].count).toBe(3);
  });
  it('empirical CDF is nondecreasing, reaches 1 and handles ties', () => {
    const pts = ecdfPoints(sortedCopy([1, 1, 2, 3]));
    expect(pts[pts.length - 1].p).toBe(1);
    expect(pts.find((p) => p.x === 1)!.p).toBe(0.5);
    expect(pts.every((p, i) => i === 0 || p.p >= pts[i - 1].p)).toBe(true);
    const many = ecdfPoints(sortedCopy(Array.from({ length: 5000 }, (_, i) => i)), 100);
    expect(many.length).toBeLessThanOrEqual(100);
    expect(many[many.length - 1].p).toBe(1);
  });
  it('intervals behave correctly at the boundaries', () => {
    const w0 = wilsonInterval(0, 100);
    expect(w0.low).toBeCloseTo(0, 12);
    expect(w0.high).toBeGreaterThan(0);
    expect(w0.high).toBeLessThan(0.05);
    const wAll = wilsonInterval(100, 100);
    expect(wAll.high).toBe(1);
    expect(wAll.low).toBeGreaterThan(0.95);
    // Clopper–Pearson for 0/10 at 95%: upper bound 1 − 0.025^(1/10) = 0.3085
    expect(clopperPearsonInterval(0, 10).high).toBeCloseTo(0.3084971078187607, 9);
    expect(clopperPearsonInterval(0, 10).low).toBe(0);
    expect(clopperPearsonInterval(10, 10).high).toBe(1);
    // t interval for A at 95%, from scipy.stats.t.interval.
    const ti = tConfidenceInterval(mean(A), Math.sqrt(variance(A)), A.length);
    expect(ti.low).toBeCloseTo(4.481992183690506, 10);
    expect(ti.high).toBeCloseTo(6.568007816309493, 10);
  });
  it('property: variance is non-negative and quantiles are ordered', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -1e6, max: 1e6, noNaN: true }), { minLength: 2, maxLength: 200 }), (xs) => {
        const s = summarizeSample(xs);
        return s.variance >= -1e-9 && s.min <= s.q1 + 1e-9 && s.q1 <= s.median + 1e-9 && s.median <= s.q3 + 1e-9 && s.q3 <= s.max + 1e-9;
      }),
    );
  });
});

describe('hypothesis tests against SciPy reference values', () => {
  it('one-sample t test', () => {
    const r = oneSampleTTest(A, 5);
    expect(r.statistic).toBeCloseTo(1.1078701338372623, 10);
    expect(r.pValue).toBeCloseTo(0.2915544657345774, 10);
    expect(r.degreesOfFreedom).toBe(11);
    expect(r.effectSize!.name).toBe("Cohen's d");
    expect(r.limitations.join(' ')).toMatch(/not the probability that the null hypothesis is true/);
  });
  it('one-sided variants halve the two-sided p-value for a symmetric test', () => {
    const two = oneSampleTTest(A, 5, 'two-sided').pValue;
    const greater = oneSampleTTest(A, 5, 'greater').pValue;
    const less = oneSampleTTest(A, 5, 'less').pValue;
    expect(greater).toBeCloseTo(two / 2, 12);
    expect(greater + less).toBeCloseTo(1, 12);
  });
  it("Welch's two-sample t test with fractional degrees of freedom", () => {
    const r = welchTTest(A, B);
    expect(r.statistic).toBeCloseTo(-2.394633115233488, 10);
    expect(r.pValue).toBeCloseTo(0.026737566772573745, 10);
    expect(r.degreesOfFreedom as number).toBeCloseTo(19.646705616550708, 9);
    expect(r.interval!.high).toBeLessThan(0);
    expect(r.notes.join(' ')).toMatch(/fractional/);
  });
  it('paired t test', () => {
    const P = [1, 2, 3, 4, 5, 6, 7, 8];
    const Q = [2, 1, 5, 4, 8, 6, 9, 9];
    const r = pairedTTest(P, Q);
    expect(r.statistic).toBeCloseTo(-2.160246899469287, 10);
    expect(r.pValue).toBeCloseTo(0.06758329382336997, 10);
    expect(() => pairedTTest([1, 2, 3], [1, 2])).toThrow(/same number of observations/);
  });
  it('chi-square goodness of fit', () => {
    const r = chiSquareGoodnessOfFit([30, 14, 34, 45, 57, 20], new Array(6).fill(1 / 6));
    expect(r.statistic).toBeCloseTo(37.78, 10);
    expect(r.pValue).toBeCloseTo(4.177325475265192e-7, 15);
    expect(r.degreesOfFreedom).toBe(5);
  });
  it('chi-square independence', () => {
    const r = chiSquareIndependence([
      [10, 20, 30],
      [6, 9, 17],
    ]);
    expect(r.statistic).toBeCloseTo(0.27157465150403504, 10);
    expect(r.pValue).toBeCloseTo(0.873028283380073, 10);
    expect(r.degreesOfFreedom).toBe(2);
    expect(r.limitations.join(' ')).toMatch(/does not show that one variable causes/);
  });
  it('correlation test with Fisher z interval', () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const y = [2, 1, 4, 3, 7, 5, 9, 8, 12, 11];
    const r = correlationTest(x, y);
    expect(r.effectSize!.value).toBeCloseTo(0.9380851459834827, 12);
    expect(r.pValue).toBeCloseTo(5.96374577241189e-5, 12);
    // SciPy's interval uses 1/√(n−3); ours matches that convention.
    expect(r.interval!.low).toBeCloseTo(0.7535205354070307, 6);
    expect(r.interval!.high).toBeCloseTo(0.9855834197925522, 6);
    expect(r.limitations.join(' ')).toMatch(/does not establish causation/);
  });
  it('Mann-Whitney U with tie correction', () => {
    const r = mannWhitneyTest(A, B);
    expect(r.statistic).toBeCloseTo(28, 10);
    expect(r.pValue).toBeCloseTo(0.034856847263039586, 9);
    expect(r.limitations.join(' ')).toMatch(/not a test of medians/);
  });
  it('Kolmogorov-Smirnov against a fully specified normal', () => {
    const r = kolmogorovSmirnovTest(A, (x) => normal.cdf(x, { mu: 5.5, sigma: 1.5 }));
    expect(r.statistic).toBeCloseTo(0.10165575869853505, 10);
    // Our p-value uses the Stephens approximation; SciPy uses the exact method.
    expect(r.pValue).toBeGreaterThan(0.9);
    expect(r.limitations.join(' ')).toMatch(/estimated from this data/);
  });
  it('one-way ANOVA', () => {
    const r = oneWayAnova([
      { label: 'g1', values: [5, 6, 7, 8] },
      { label: 'g2', values: [10, 11, 12, 13] },
      { label: 'g3', values: [6, 7, 9, 10] },
    ]);
    expect(r.statistic).toBeCloseTo(11.85, 10);
    expect(r.pValue).toBeCloseTo(0.0030104152511272277, 12);
    expect(r.degreesOfFreedom).toEqual([2, 9]);
    expect(r.limitations.join(' ')).toMatch(/does not say which groups differ/);
  });
  it('F survival function matches SciPy', () => {
    expect(fSurvival(4.2, 2, 9)).toBeCloseTo(0.051477764080395685, 12);
    expect(fSurvival(0, 2, 9)).toBe(1);
  });
  it('two-proportion z test and small-count warning', () => {
    const r = twoProportionTest(45, 100, 30, 100);
    // pooled p = 0.375; z = 0.15 / √(0.375 · 0.625 · 0.02), checked in Python.
    expect(r.statistic).toBeCloseTo(2.1908902300206647, 12);
    expect(r.pValue).toBeCloseTo(0.02845973691631055, 12);
    expect(r.interval!.low).toBeGreaterThan(0);
    const small = twoProportionTest(1, 8, 0, 7);
    expect(small.notes.join(' ')).toMatch(/below the usual minimum of 5/);
  });
  it('rejects degenerate inputs with clear reasons', () => {
    expect(() => oneSampleTTest([5, 5, 5, 5], 5)).toThrow(/standard deviation is 0/);
    expect(() => oneSampleTTest([1], 0)).toThrow(/at least 2 observations/);
    expect(() => correlationTest([1, 2, 3], [1, 1, 1])).toThrow(/does not vary/);
    expect(() => correlationTest([1, 2, 3], [2, 4, 6])).toThrow(/exactly ±1/);
    expect(() => chiSquareGoodnessOfFit([5, 5], [0.5, 0.4])).toThrow(/sum to 0.9/);
    expect(() => chiSquareGoodnessOfFit([5, 5], [1, 0])).toThrow(/probability of 0 but 5 observation/);
    expect(() => chiSquareIndependence([[0, 0], [1, 2]])).toThrow(/at least one observation/);
    expect(() => oneWayAnova([{ label: 'a', values: [1, 1] }, { label: 'b', values: [1, 1] }])).toThrow(/no variation within the groups/);
    expect(() => twoProportionTest(5, 10, 15, 10)).toThrow(/between 0 and the number of trials/);
  });
  it('Benjamini-Hochberg adjustment is monotone and bounded', () => {
    const p = [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205];
    const adj = benjaminiHochberg(p);
    // Checked against R p.adjust(method = "BH")
    expect(adj[0]).toBeCloseTo(0.008, 10);
    expect(adj[1]).toBeCloseTo(0.032, 10);
    expect(adj[7]).toBeCloseTo(0.205, 10);
    expect(adj.every((q) => q <= 1)).toBe(true);
    const sortedAdj = p.map((_, i) => i).sort((a, b) => p[a] - p[b]).map((i) => adj[i]);
    expect(sortedAdj.every((q, i) => i === 0 || q >= sortedAdj[i - 1] - 1e-12)).toBe(true);
  });
});

describe('Markov chain analysis', () => {
  const twoState = [
    [0.7, 0.3],
    [0.1, 0.9],
  ];

  it('computes exact n-step distributions', () => {
    const one = nStepDistribution(twoState, [1, 0], 1);
    expect(one).toEqual([0.7, 0.3]);
    const two = nStepDistribution(twoState, [1, 0], 2);
    // [0.7,0.3]·P = [0.49+0.03, 0.21+0.27] = [0.52, 0.48]
    expect(two[0]).toBeCloseTo(0.52, 12);
    expect(two[1]).toBeCloseTo(0.48, 12);
    // Long run converges to the stationary distribution (0.25, 0.75).
    const far = nStepDistribution(twoState, [1, 0], 1000);
    expect(far[0]).toBeCloseTo(0.25, 10);
    expect(far[1]).toBeCloseTo(0.75, 10);
    expect(nStepDistribution(twoState, [0.3, 0.7], 0)).toEqual([0.3, 0.7]);
    // Repeated squaring agrees with iterative multiplication.
    const m = nStepMatrix(twoState, 100);
    expect(m[0][0]).toBeCloseTo(0.25, 10);
  });

  it('finds the stationary distribution exactly', () => {
    const r = stationaryDistribution(twoState);
    expect(r.distribution![0]).toBeCloseTo(0.25, 12);
    expect(r.distribution![1]).toBeCloseTo(0.75, 12);
    expect(r.unique).toBe(true);
    expect(r.meanRecurrenceTimes[0]).toBeCloseTo(4, 10);
    expect(r.classification.note).toMatch(/irreducible and aperiodic/);
  });

  it('identifies periodicity and refuses to pretend it converges', () => {
    const periodic = [
      [0, 1],
      [1, 0],
    ];
    const c = classifyChain(periodic);
    expect(c.irreducible).toBe(true);
    expect(c.aperiodic).toBe(false);
    expect(c.classes[0].period).toBe(2);
    const r = stationaryDistribution(periodic);
    expect(r.distribution![0]).toBeCloseTo(0.5, 12);
    expect(r.limitations.join(' ')).toMatch(/cycles/);
  });

  it('identifies reducible chains and multiple recurrent classes', () => {
    // Two absorbing-ish classes plus a transient state.
    const m = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0.5, 0, 0.5, 0],
      [0, 0.5, 0.25, 0.25],
    ];
    const c = classifyChain(m);
    expect(c.irreducible).toBe(false);
    expect(c.absorbingStates).toEqual([0, 1]);
    expect(c.classes.filter((x) => x.recurrent).length).toBe(2);
    expect(c.note).toMatch(/reducible/);
    const s = stationaryDistribution(m);
    expect(s.limitations.join(' ')).toMatch(/more than one stationary distribution exists/);
  });

  it('computes absorption times and probabilities (gambler ruin)', () => {
    // States 0..4 of wealth; 0 and 4 absorbing; fair steps otherwise.
    const n = 5;
    const m = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => {
        if (i === 0 || i === n - 1) return i === j ? 1 : 0;
        if (j === i - 1 || j === i + 1) return 0.5;
        return 0;
      }),
    );
    const r = absorptionAnalysis(m);
    expect(r.absorbingStates).toEqual([0, 4]);
    expect(r.transientStates).toEqual([1, 2, 3]);
    // Expected steps from wealth k in a fair walk on 0..N: k(N−k) = 3, 4, 3
    expect(r.expectedSteps[0]).toBeCloseTo(3, 10);
    expect(r.expectedSteps[1]).toBeCloseTo(4, 10);
    expect(r.expectedSteps[2]).toBeCloseTo(3, 10);
    // P(reach 4 before 0 | start at k) = k/N = 0.25, 0.5, 0.75
    expect(r.absorptionProbability[0][1]).toBeCloseTo(0.25, 10);
    expect(r.absorptionProbability[1][1]).toBeCloseTo(0.5, 10);
    expect(r.absorptionProbability[2][1]).toBeCloseTo(0.75, 10);
    // Each row sums to 1 across absorbing states.
    for (const row of r.absorptionProbability) expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('rejects an invalid transition matrix and an unsuitable absorption request', () => {
    expect(() => validateChain([[0.5, 0.4], [0.1, 0.9]])).toThrow(/sums to 0.9/);
    expect(() => validateChain([[1, 0], [0.5]])).toThrow(/must have 2 entries/);
    expect(() => validateChain([[-0.1, 1.1], [0.5, 0.5]])).toThrow(/invalid probability/);
    expect(() => absorptionAnalysis(twoState)).toThrow(/no absorbing state/);
    expect(() => nStepDistribution(twoState, [0.4, 0.4], 2)).toThrow(/sums to 0.8/);
    expect(() => nStepDistribution(twoState, [1, 0], -1)).toThrow(/whole number/);
  });
});

describe('dataset import', () => {
  it('parses CSV with a header, quoted fields and mixed types', () => {
    const csv = 'name,score,"full, name"\nAlice,10,"Alice A"\nBob,20,"Bob ""The Builder"" B"\n';
    const ds = parseCsv(csv);
    expect(ds.rowCount).toBe(2);
    expect(ds.columns.map((c) => c.name)).toEqual(['name', 'score', 'full, name']);
    expect(ds.columns[1].type).toBe('numeric');
    expect(Array.from(ds.columns[1].values)).toEqual([10, 20]);
    expect(ds.columns[0].type).toBe('categorical');
    expect(ds.columns[2].raw[1]).toBe('Bob "The Builder" B');
  });
  it('detects delimiters and headerless files', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectDelimiter('a;b\n1;2')).toBe(';');
    const ds = parseCsv('1,2\n3,4\n');
    expect(ds.columns.map((c) => c.name)).toEqual(['Column 1', 'Column 2']);
    expect(ds.notes.join(' ')).toMatch(/No header row was detected/);
  });
  it('reports malformed rows instead of discarding them silently', () => {
    const ds = parseCsv('a,b\n1,2\n3\n4,5,6\n7,8\n');
    expect(ds.rowCount).toBe(2);
    expect(ds.malformedRows).toHaveLength(2);
    expect(ds.notes.join(' ')).toMatch(/2 row\(s\) were skipped/);
    expect(ds.notes.join(' ')).toMatch(/line 3/);
  });
  it('recognises missing-value tokens and unreadable numbers separately', () => {
    // 39 numeric values and one unreadable one: above the 95% threshold, so the
    // column stays numeric and the bad cell is reported rather than hidden.
    const rows = [...Array.from({ length: 39 }, (_, i) => String(i + 1)), 'abc', 'NA', 'n/a'];
    const ds = parseCsv(['v', ...rows].join('\n'));
    const col = ds.columns[0];
    expect(col.type).toBe('numeric');
    expect(col.missing).toBe(2); // NA and n/a
    expect(col.invalid).toBe(1); // abc
    expect(ds.notes.join(' ')).toMatch(/1 value\(s\) could not be read as numbers/);
  });

  it('treats a column as categorical when too many cells are not numbers', () => {
    const ds = parseCsv('v\n1\n2\nabc\n4\n5\n');
    expect(ds.columns[0].type).toBe('categorical');
    expect(ds.columns[0].categories).toEqual(['1', '2', '4', '5', 'abc']);
  });
  it('parses spreadsheet-style numbers', () => {
    const ds = parseCsv('v\n"1,234.5"\n45%\n(200)\n£30\n');
    expect(Array.from(ds.columns[0].values)).toEqual([1234.5, 0.45, -200, 30]);
  });
  it('removes duplicate rows only when asked, and says so', () => {
    const csv = 'a,b\n1,2\n1,2\n3,4\n';
    expect(parseCsv(csv).rowCount).toBe(3);
    const dedup = parseCsv(csv, { dropDuplicates: true });
    expect(dedup.rowCount).toBe(2);
    expect(dedup.duplicateRowCount).toBe(1);
    expect(dedup.notes.join(' ')).toMatch(/duplicate row\(s\) were removed/);
  });
  it('rejects empty and oversized input with actionable messages', () => {
    expect(() => parseCsv('')).toThrow(/no data/);
    expect(() => parseCsv('a,b\n')).toThrow(/no data rows/);
    expect(() => parseCsv('a'.repeat(30 * 1024 * 1024))).toThrow(/larger than the supported limit/);
  });
  it('parses JSON arrays of objects and objects of arrays', () => {
    const a = parseJsonDataset('[{"x":1,"y":"a"},{"x":2,"y":"b"}]');
    expect(a.rowCount).toBe(2);
    expect(Array.from(a.columns[0].values)).toEqual([1, 2]);
    const b = parseJsonDataset('{"x":[1,2,3],"y":[4,5,6]}');
    expect(b.rowCount).toBe(3);
    expect(Array.from(b.columns[1].values)).toEqual([4, 5, 6]);
    const nums = parseJsonDataset('[1,2,3]');
    expect(Array.from(nums.columns[0].values)).toEqual([1, 2, 3]);
    expect(() => parseJsonDataset('{oops}')).toThrow(/not valid JSON/);
    expect(() => parseJsonDataset('[]')).toThrow(/empty/);
    expect(() => parseJsonDataset('5')).toThrow(/array of records or an object of arrays/);
  });
  it('treats JSON content as data, never as code', () => {
    const ds = parseJsonDataset('[{"x":1,"label":"<script>alert(1)</script>"}]');
    expect(ds.columns.find((c) => c.name === 'label')!.raw[0]).toBe('<script>alert(1)</script>');
    expect(ds.columns.find((c) => c.name === 'label')!.type).toBe('categorical');
  });
  it('applies missing-value policies and explains their effect', () => {
    const ds = parseCsv('v\n1\n2\nNA\n5\n');
    const col = ds.columns[0];
    const excluded = cleanColumn(col, 'exclude');
    expect(Array.from(excluded.values)).toEqual([1, 2, 5]);
    expect(excluded.note).toMatch(/were excluded/);
    const zeroed = cleanColumn(col, 'zero');
    expect(Array.from(zeroed.values)).toEqual([1, 2, 0, 5]);
    expect(zeroed.note).toMatch(/changes the mean and variance/);
    const meanFilled = cleanColumn(col, 'mean');
    expect(Array.from(meanFilled.values)).toEqual([1, 2, 8 / 3, 5]);
    expect(meanFilled.note).toMatch(/variance smaller than it should be/);
    expect(() => cleanColumn(ds.columns[0], 'exclude')).not.toThrow();
  });
  it('pairs and groups values, dropping incomplete rows transparently', () => {
    const ds = parseCsv('x,y,g\n1,2,a\n3,NA,a\n5,6,b\n');
    const p = pairedValues(ds.columns[0], ds.columns[1]);
    expect(Array.from(p.x)).toEqual([1, 5]);
    expect(p.dropped).toBe(1);
    const g = groupBy(ds.columns[0], ds.columns[2]);
    expect(g.map((x) => x.label)).toEqual(['a', 'b']);
    expect(Array.from(g[0].values)).toEqual([1, 3]);
    expect(() => cleanColumn(ds.columns[2])).toThrow(/not numeric/);
  });
  it('splitLine handles trailing and empty fields', () => {
    expect(splitLine('a,,c', ',')).toEqual(['a', '', 'c']);
    expect(splitLine('a,b,', ',')).toEqual(['a', 'b', '']);
    expect(splitLine('"a,b",c', ',')).toEqual(['a,b', 'c']);
  });
});
