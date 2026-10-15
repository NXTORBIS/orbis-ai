/**
 * Regression tests for defects found in review.
 *
 * Each test names the defect, states the input that exposed it, and asserts
 * the independently verified correct value.
 */
import { describe, expect, it } from 'vitest';
import { getDistribution } from './distributions/registry';
import { Rational } from './core/rational';
import { covariance, pearson, spearman } from './stats/descriptive';
import { chiSquareGoodnessOfFit, correlationTest } from './stats/tests';
import { latentToSpearmanCorrelation, spearmanToLatentCorrelation, type ScenarioModelConfig } from './scenario/model';
import { runSimulation } from './simulation/runner';

describe('discrete quantiles no longer shift at a CDF jump', () => {
  const uniform = getDistribution('discreteUniform');

  it('discreteUniform returns the smallest k with F(k) >= q', () => {
    // A relative fuzz of 1e-12 on q behaves like a tolerance on a count, so it
    // returned 3 here: F(3) = 0.5 < q, so the answer must be 4 (SciPy agrees).
    expect(uniform.quantile(0.5000000000000001, { a: 1, b: 6 })).toBe(4);
    expect(uniform.quantile(0.5, { a: 1, b: 6 })).toBe(3);
    // On a large support the same slack moved the answer by thousands of steps.
    expect(uniform.quantile(0.5 + 1e-13, { a: 0, b: 999999999 })).toBe(500000000);
    expect(uniform.quantile(0.5, { a: 0, b: 999999999 })).toBe(499999999);
  });

  it('discreteUniform agrees with the definition across the whole support', () => {
    for (const [a, b] of [[1, 6], [0, 9], [1, 100], [-5, 5], [0, 1]] as const) {
      const n = b - a + 1;
      for (let k = a; k <= b; k++) {
        const atJump = (k - a + 1) / n;
        // At the jump exactly, k attains it; a hair above, the next value does.
        expect(uniform.quantile(atJump, { a, b })).toBe(k);
        if (k < b) expect(uniform.quantile(Math.min(1, atJump + 1e-15), { a, b })).toBeGreaterThanOrEqual(k);
      }
    }
  });

  it('binomial and Poisson quantiles match SciPy just above a jump', () => {
    const binomial = getDistribution('binomial');
    const poisson = getDistribution('poisson');
    // F(3) = 0.17187500000000058 for Binomial(10, 0.5); q sits just above it.
    expect(binomial.quantile(0.1718750000001006, { n: 10, p: 0.5 })).toBe(4);
    expect(binomial.quantile(0.171875, { n: 10, p: 0.5 })).toBe(3);
    expect(poisson.quantile(0.23810330555364426, { lambda: 4 })).toBe(3);
  });

  it('an unbounded support has no finite quantile at q = 1', () => {
    expect(getDistribution('poisson').quantile(1, { lambda: 4 })).toBe(Infinity);
    expect(getDistribution('negativeBinomial').quantile(1, { r: 3, p: 0.4 })).toBe(Infinity);
    expect(getDistribution('geometric').quantile(1, { p: 0.2 })).toBe(Infinity);
    // A bounded support does have one.
    expect(getDistribution('binomial').quantile(1, { n: 10, p: 0.5 })).toBe(10);
    expect(uniform.quantile(1, { a: 1, b: 6 })).toBe(6);
  });
});

describe('quantile levels outside [0, 1] are rejected', () => {
  const cases: [string, Record<string, number>][] = [
    ['discreteUniform', { a: 1, b: 6 }],
    ['bernoulli', { p: 0.5 }],
    ['geometric', { p: 0.3 }],
    ['uniform', { a: 0, b: 1 }],
    ['normal', { mu: 0, sigma: 1 }],
    ['exponential', { lambda: 1 }],
    ['lognormal', { mu: 0, sigma: 1 }],
    ['weibull', { k: 1.5, lambda: 2 }],
    ['triangular', { a: 0, c: 1, b: 2 }],
    ['cauchy', { x0: 0, gamma: 1 }],
    ['pareto', { xm: 1, alpha: 2 }],
    ['gamma', { k: 2, theta: 1 }],
    ['beta', { alpha: 2, beta: 3 }],
  ];
  for (const [id, params] of cases) {
    it(`${id} rejects q outside the unit interval`, () => {
      const def = getDistribution(id);
      // uniform.quantile(1.5) used to return 1.5, outside its own support.
      expect(() => def.quantile(1.5, params)).toThrow(/between 0 and 1/);
      expect(() => def.quantile(-0.1, params)).toThrow(/between 0 and 1/);
      expect(() => def.quantile(NaN, params)).toThrow(/between 0 and 1/);
    });
  }
});

describe('exact rational arithmetic survives extreme magnitudes', () => {
  it('a tiny decimal keeps full precision', () => {
    // Previously 9.99988867182683e-301: a relative error of 1.1e-5, caused by
    // scaling through a single power of ten that had itself lost precision.
    const value = Rational.parse('1e-300')!.toNumber();
    expect(Math.abs(value - 1e-300) / 1e-300).toBeLessThan(1e-12);
  });

  it('a subnormal result is produced rather than zero', () => {
    // 1/10^310 and 1/10^320 are representable subnormals; both returned 0.
    expect(Rational.of(1n, 10n ** 310n).toNumber()).toBeGreaterThan(0);
    expect(Math.abs(Rational.of(1n, 10n ** 310n).toNumber() - 1e-310) / 1e-310).toBeLessThan(1e-6);
    expect(Rational.of(1n, 10n ** 320n).toNumber()).toBeGreaterThan(0);
  });

  it('ordinary and very large magnitudes are unaffected', () => {
    expect(Rational.of(1n, 4n).toNumber()).toBe(0.25);
    expect(Rational.of(10n ** 400n, 10n ** 100n).toNumber()).toBe(1e300);
    const big = Rational.of(123456789012345678901234567890n, 987654321098765432109876543n).toNumber();
    expect(Math.abs(big - 124.9999988609375) / 124.9999988609375).toBeLessThan(1e-12);
  });

  it('a value below the smallest subnormal underflows to zero', () => {
    expect(Rational.of(1n, 10n ** 400n).toNumber()).toBe(0);
  });
});

describe('the Gaussian copula realises the requested rank correlation', () => {
  const build = (rho: number): ScenarioModelConfig => ({
    variables: [
      { id: '1', name: 'a', label: 'A', kind: 'distribution', distributionId: 'lognormal', params: { mu: 0, sigma: 1 }, track: true },
      { id: '2', name: 'b', label: 'B', kind: 'distribution', distributionId: 'exponential', params: { lambda: 2 }, track: true },
    ],
    correlationGroups: [{ id: 'g', label: 'Linked', variables: ['a', 'b'], pairs: [{ a: 'a', b: 'b', rho }] }],
    outputs: [{ id: 'o', key: 'sum', label: 'Sum', expression: 'a + b', kind: 'continuous' }],
    assumptions: [],
  });

  it('the conversion between rank and latent correlation is self-inverse', () => {
    for (const rho of [-0.9, -0.4, 0, 0.25, 0.5, 0.8, 0.95]) {
      expect(latentToSpearmanCorrelation(spearmanToLatentCorrelation(rho))).toBeCloseTo(rho, 12);
    }
    // The conversion is not the identity: that was the defect.
    expect(spearmanToLatentCorrelation(0.8)).toBeCloseTo(0.8135, 3);
  });

  it.each([0.3, 0.5, 0.8, -0.7])('a requested rank correlation of %s is realised', (requested) => {
    // Feeding the target straight into the normal correlation matrix produced
    // (6/pi)*asin(rho/2) instead — 0.8 came out at about 0.786.
    const result = runSimulation({ modelId: 'scenario', config: build(requested), trials: 60000, seed: `copula-${requested}`, keepSamples: true });
    const realised = spearman(result.samples!['input:a'], result.samples!['input:b']);
    // Monte Carlo standard error at 60,000 trials is about 0.004.
    expect(Math.abs(realised - requested)).toBeLessThan(0.015);
  });

  it('the margins are unchanged by the coupling', () => {
    const result = runSimulation({ modelId: 'scenario', config: build(0.6), trials: 40000, seed: 'margins', keepSamples: true });
    const a = result.outputs.find((o) => o.spec.key === 'input:a')!;
    const b = result.outputs.find((o) => o.spec.key === 'input:b')!;
    // Lognormal(0, 1) has mean e^0.5 = 1.6487; Exponential(2) has mean 0.5.
    expect(a.summary.mean).toBeGreaterThan(1.55);
    expect(a.summary.mean).toBeLessThan(1.75);
    expect(b.summary.mean).toBeCloseTo(0.5, 1);
  });
});

describe('statistics reject mismatched inputs instead of answering wrongly', () => {
  it('correlation and covariance require equal lengths', () => {
    // pearson([1,2,3,100], [1,2,3]) returned 0.0333 by pairing a prefix while
    // averaging the whole of each array. The three usable pairs give exactly 1.
    expect(() => pearson([1, 2, 3, 100], [1, 2, 3])).toThrow(/equal-length/);
    expect(() => spearman([1, 2, 3, 100], [1, 2, 3])).toThrow(/equal-length/);
    expect(() => covariance([1, 2, 3, 100], [1, 2, 3])).toThrow(/equal-length/);
    expect(() => correlationTest([1, 2, 3, 100], [1, 2, 3])).toThrow(/paired observations/);
  });

  it('equal-length inputs still work', () => {
    expect(pearson([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 12);
    expect(spearman([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 12);
  });
});

describe('the goodness-of-fit effect size is named and bounded correctly', () => {
  it("reports Cohen's w rather than Cramér's V", () => {
    // sqrt(chi2/n) exceeded 1 while being labelled Cramér's V, which is bounded
    // by 1. The value is right for Cohen's w; only the name was wrong.
    const r = chiSquareGoodnessOfFit([100, 0, 0], [1 / 3, 1 / 3, 1 / 3]);
    expect(r.statistic).toBeCloseTo(200, 10);
    expect(r.effectSize!.name).toBe("Cohen's w");
    expect(r.effectSize!.value).toBeCloseTo(Math.SQRT2, 12);
    expect(r.effectSize!.interpretation).toMatch(/can exceed 1/);
  });
});

describe('numerical quantiles converge for extreme parameters', () => {
  it('a gamma distribution with a tiny shape parameter', () => {
    // The absolute tolerance floor of 1e-300 was far larger than the root, so
    // the answer was only accurate to that floor. Reference from mpmath.
    const q = getDistribution('gamma').quantile(0.5, { k: 0.001, theta: 1 });
    expect(Math.abs(q - 5.2442064082779e-302) / 5.2442064082779e-302).toBeLessThan(1e-6);
  });
});
