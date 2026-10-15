import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import reference from './__fixtures__/scipy-reference.json';
import { DISTRIBUTIONS, defaultParams, getDistribution, intervalProbability, plotRange, summarize, validateParams } from './registry';
import { Random } from '../random/rng';

type Ref = number | 'inf' | '-inf' | null;
const val = (v: Ref) => (v === 'inf' ? Infinity : v === '-inf' ? -Infinity : v === null ? NaN : v);

function close(actual: number, expected: number, relTol: number, absTol = 1e-300) {
  if (!Number.isFinite(expected)) {
    expect(actual).toBe(expected);
    return;
  }
  const err = Math.abs(actual - expected);
  const ok = err <= absTol || err <= relTol * Math.abs(expected);
  if (!ok) throw new Error(`expected ${expected}, got ${actual} (rel err ${err / Math.abs(expected)})`);
}

describe('distributions match SciPy reference values', () => {
  for (const c of reference.cases) {
    const def = getDistribution(c.id);
    const params = c.params as unknown as Record<string, number>;
    describe(`${c.id} ${JSON.stringify(params)}`, () => {
      it('has valid parameters', () => expect(validateParams(def, params)).toEqual([]));
      it('pdf / cdf / sf', () => {
        for (const pt of c.points) {
          close(def.pdf(pt.x, params), val(pt.pdf as Ref), 1e-9, 1e-300);
          close(def.cdf(pt.x, params), val(pt.cdf as Ref), 1e-9, 1e-16);
          close(def.sf(pt.x, params), val(pt.sf as Ref), 1e-9, 1e-16);
        }
      });
      it('quantiles', () => {
        for (const qq of c.quantiles) {
          const expected = val(qq.x as Ref);
          const got = def.quantile(qq.q, params);
          if (def.kind === 'discrete') expect(got).toBe(expected);
          else close(got, expected, 1e-8, 1e-12);
        }
      });
      it('moments', () => {
        const s = summarize(def, params);
        const m = c.moments;
        const check = (mom: { defined: boolean; value?: number }, ref: Ref) => {
          const e = val(ref);
          if (Number.isNaN(e)) expect(mom.defined).toBe(false);
          // SciPy reports an infinite variance where the mean itself does not exist; we report "undefined".
          else if (!Number.isFinite(e) && !s.mean.defined) expect(mom.defined).toBe(false);
          else {
            expect(mom.defined).toBe(true);
            close(mom.value!, e, 1e-9, 1e-12);
          }
        };
        check(s.mean, m.mean as Ref);
        check(s.variance, m.variance as Ref);
        // SciPy reports infinite skew/kurtosis where we report "undefined"; only compare finite ones.
        if (Number.isFinite(val(m.skewness as Ref))) check(s.skewness, m.skewness as Ref);
        if (Number.isFinite(val(m.kurtosis as Ref))) check(s.excessKurtosis, m.kurtosis as Ref);
        if (def.kind === 'discrete') expect(s.median).toBe(val(m.median as Ref));
        else close(s.median, val(m.median as Ref), 1e-9, 1e-12);
      });
    });
  }
});

describe('distribution invariants (property-based)', () => {
  for (const def of DISTRIBUTIONS) {
    it(`${def.id}: CDF nondecreasing, in [0,1], cdf + sf = 1`, () => {
      const params = defaultParams(def);
      const range = plotRange(def, params);
      fc.assert(
        fc.property(fc.double({ min: range.min, max: range.max, noNaN: true }), fc.double({ min: 0, max: range.max - range.min, noNaN: true }), (x, d) => {
          const f1 = def.cdf(x, params);
          const f2 = def.cdf(x + d, params);
          const s1 = def.sf(x, params);
          return f1 >= 0 && f1 <= 1 && f2 >= f1 - 1e-15 && Math.abs(f1 + s1 - 1) < 1e-12;
        }),
        { numRuns: 200 },
      );
    });
    if (def.kind === 'discrete') {
      it(`${def.id}: pmf sums to the mass the CDF claims`, () => {
        // This test used to walk the whole support from `s.min` to the
        // 1 - 1e-15 quantile. Two distributions make that impossible, and
        // between them they stopped this file from ever finishing a run:
        //
        //   - Skellam's support is the whole of the integers, so `s.min` is
        //     -Infinity. `-Infinity + 1` is -Infinity, so `k` never advances
        //     and the loop never terminates. Not slow: infinite.
        //   - Yule-Simon's tail is heavy enough that its 1 - 1e-15 quantile is
        //     44,739,241, i.e. forty-five million pdf evaluations.
        //
        // So the window is taken from the quantile function at both ends, and
        // the sum is compared against the mass the CDF assigns to that same
        // window. That is a stronger statement than summing to one — it checks
        // the pmf and the CDF against each other — and it stays finite for
        // every distribution. The total mass is then checked separately, to
        // the accuracy the excluded tails allow.
        const params = defaultParams(def);
        const s = def.support(params);
        const tail = 1e-13;
        const lo = Math.ceil(Number.isFinite(s.min) ? s.min : def.quantile(tail, params));
        const hi = Math.floor(Number.isFinite(s.max) ? s.max : def.quantile(1 - tail, params));
        expect(Number.isFinite(lo) && Number.isFinite(hi), `window [${lo}, ${hi}] is not finite`).toBe(true);
        expect(hi - lo, `window [${lo}, ${hi}] has ${hi - lo} terms`).toBeLessThan(5_000_000);

        let total = 0;
        for (let k = lo; k <= hi; k++) total += def.pdf(k, params);

        // The CDF's own mass for [lo, hi]. sf(hi) is used rather than
        // 1 - cdf(hi) so that a tiny upper tail does not lose its precision to
        // cancellation.
        const windowMass = 1 - def.cdf(lo - 1, params) - def.sf(hi, params);
        expect(Math.abs(total - windowMass)).toBeLessThan(1e-9);

        // And the window really does hold essentially all of the mass, so the
        // "sums to one" claim still has teeth.
        expect(total).toBeGreaterThan(1 - 1e-6);
        expect(total).toBeLessThan(1 + 1e-9);
      });
    }
    it(`${def.id}: variance non-negative when defined`, () => {
      const v = def.variance(defaultParams(def));
      if (v.defined) expect(v.value).toBeGreaterThanOrEqual(0);
    });
  }
});

describe('sampling agrees with the model', () => {
  const N = 40000;
  for (const def of DISTRIBUTIONS) {
    if (def.id === 'cauchy') continue; // no mean to compare against
    it(`${def.id}: sample mean within 5 standard errors`, () => {
      const params = defaultParams(def);
      const mean = def.mean(params);
      const variance = def.variance(params);
      if (!mean.defined || !variance.defined || !Number.isFinite(variance.value)) return;
      const rng = new Random(`test-${def.id}`);
      let s = 0;
      for (let i = 0; i < N; i++) s += def.sample(rng, params);
      const se = Math.sqrt(variance.value / N);
      expect(Math.abs(s / N - mean.value)).toBeLessThan(5 * se + 1e-12);
    });
  }
  it('large-parameter samplers (binomial, poisson) have correct mean', () => {
    const rng = new Random('large');
    let sb = 0;
    let sp = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      sb += rng.binomial(100000, 0.37);
      sp += rng.poisson(1234.5);
    }
    expect(Math.abs(sb / n - 37000)).toBeLessThan(5 * Math.sqrt((100000 * 0.37 * 0.63) / n));
    expect(Math.abs(sp / n - 1234.5)).toBeLessThan(5 * Math.sqrt(1234.5 / n));
  });
});

describe('validation and intervals', () => {
  it('rejects invalid parameters with field-specific messages', () => {
    const b = getDistribution('binomial');
    const issues = validateParams(b, { n: 5.5, p: 1.2 });
    expect(issues.map((i) => i.field).sort()).toEqual(['n', 'p']);
    const h = getDistribution('hypergeometric');
    expect(validateParams(h, { N: 10, K: 12, n: 3 })[0].field).toBe('K');
    expect(() => summarize(getDistribution('normal'), { mu: 0, sigma: 0 })).toThrow(/greater than 0/);
  });
  it('discrete interval semantics respect inclusivity', () => {
    const d = getDistribution('binomial');
    const p = { n: 10, p: 0.5 };
    const le = intervalProbability(d, p, { kind: 'le', a: 3 }).probability;
    const lt = intervalProbability(d, p, { kind: 'lt', a: 3 }).probability;
    const eq = intervalProbability(d, p, { kind: 'eq', a: 3 }).probability;
    expect(le - lt).toBeCloseTo(eq, 14);
    expect(eq).toBeCloseTo(120 / 1024, 14);
    const between = intervalProbability(d, p, { kind: 'between', a: 3, b: 5 }).probability;
    expect(between).toBeCloseTo((120 + 210 + 252) / 1024, 14);
  });
  it('continuous point probability is zero and explained', () => {
    const r = intervalProbability(getDistribution('normal'), { mu: 0, sigma: 1 }, { kind: 'eq', a: 0 });
    expect(r.probability).toBe(0);
    expect(r.note).toMatch(/density/);
  });
  it('far-tail interval keeps relative precision', () => {
    const r = intervalProbability(getDistribution('normal'), { mu: 0, sigma: 1 }, { kind: 'gt', a: 9 });
    expect(Math.abs(r.probability - 1.1285884059538324e-19) / 1.1285884059538324e-19).toBeLessThan(1e-9);
  });
  it('plot range reports mass outside the visible window', () => {
    const r = plotRange(getDistribution('normal'), { mu: 0, sigma: 1 });
    expect(r.massOutside).toBeCloseTo(0.001, 6);
  });
});
