/**
 * Tests for the extended distribution library.
 *
 * Reference values are never taken from this file's own implementations. They
 * come from one of three independent places:
 *
 *  1. SPECIAL-CASE REDUCTIONS against the distributions already in the
 *     registry (which are themselves checked against SciPy fixtures). An
 *     Erlang with k = 1 *is* an exponential; a Rayleigh *is* a Weibull with
 *     shape 2; F(1, ν) *is* the square of a Student t. If the new code
 *     disagrees with the old code on the same mathematical object, the new
 *     code is wrong.
 *  2. CLOSED-FORM IDENTITIES that hold by definition: F(Q(q)) = q for exact
 *     quantiles, cdf + sf = 1, the pmf summing to 1, and the published moment
 *     constants (σ√(π/2), 2b², s²π²/3, μ + βγ, μ³/λ) written as literals.
 *  3. NUMERICAL QUADRATURE / SUMMATION performed here in the test, which is
 *     independent of the analytic moment formulas being checked.
 */
import { describe, expect, it } from 'vitest';
import { Random } from '../random/rng';
import { normalCdf } from '../special/gamma';
import { getDistribution, validateParams } from './registry';
import { EXTENDED_DISTRIBUTIONS } from './extended';
import type { DistributionDef, Params } from './types';

const byId = new Map(EXTENDED_DISTRIBUTIONS.map((d) => [d.id, d]));
const get = (id: string): DistributionDef => {
  const d = byId.get(id);
  if (!d) throw new Error(`missing distribution ${id}`);
  return d;
};

/** Relative closeness assertion with an absolute floor. */
function close(actual: number, expected: number, relTol: number, absTol = 0): void {
  const err = Math.abs(actual - expected);
  const ok = err <= absTol || err <= relTol * Math.abs(expected);
  if (!ok) {
    throw new Error(`expected ${expected}, got ${actual} (abs err ${err}, rel err ${err / Math.abs(expected)})`);
  }
}

const laplace = get('laplace');
const logistic = get('logistic');
const rayleigh = get('rayleigh');
const gumbel = get('gumbel');
const frechet = get('frechet');
const fDist = get('fDistribution');
const inverseGaussian = get('inverseGaussian');
const betaPrime = get('betaPrime');
const erlang = get('erlang');
const nakagami = get('nakagami');
const burr12 = get('burr12');
const halfNormal = get('halfNormal');
const truncatedNormal = get('truncatedNormal');
const vonMises = get('vonMises');
const levy = get('levy');
const kumaraswamy = get('kumaraswamy');
const betaBinomial = get('betaBinomial');
const zipf = get('zipf');
const skellam = get('skellam');
const logarithmic = get('logarithmic');
const yuleSimon = get('yuleSimon');
const comPoisson = get('comPoisson');

/* ================================================================== *
 * 1. Special-case reductions against the existing registry
 * ================================================================== */

describe('reduction: Erlang(k = 1, λ) is Exponential(λ)', () => {
  const exponential = getDistribution('exponential');
  const lambda = 1.7;
  const xs = [0, 0.01, 0.1, 0.5, 1, 2, 5, 10, 25];
  it('matches the pdf and cdf of the existing exponential', () => {
    for (const x of xs) {
      close(erlang.pdf(x, { k: 1, lambda }), exponential.pdf(x, { lambda }), 1e-10, 1e-300);
      close(erlang.cdf(x, { k: 1, lambda }), exponential.cdf(x, { lambda }), 1e-10, 1e-300);
      close(erlang.sf(x, { k: 1, lambda }), exponential.sf(x, { lambda }), 1e-10, 1e-300);
    }
  });
  it('matches the quantiles of the existing exponential', () => {
    for (const q of [0.001, 0.05, 0.25, 0.5, 0.75, 0.95, 0.999]) {
      close(erlang.quantile(q, { k: 1, lambda }), exponential.quantile(q, { lambda }), 1e-10);
    }
  });
});

describe('reduction: Erlang(k, λ) is Gamma(shape = k, scale = 1/λ)', () => {
  const gamma = getDistribution('gamma');
  for (const [k, lambda] of [
    [2, 1],
    [4, 1.5],
    [9, 0.4],
  ]) {
    describe(`k = ${k}, λ = ${lambda}`, () => {
      const ep = { k, lambda };
      const gp = { k, theta: 1 / lambda };
      it('pdf and cdf agree to 1e-10', () => {
        for (let i = 0; i <= 30; i++) {
          const x = (i * (3 * k)) / (10 * lambda);
          close(erlang.pdf(x, ep), gamma.pdf(x, gp), 1e-10, 1e-300);
          close(erlang.cdf(x, ep), gamma.cdf(x, gp), 1e-10, 1e-300);
          close(erlang.sf(x, ep), gamma.sf(x, gp), 1e-9, 1e-300);
        }
      });
      it('quantiles agree to 1e-9', () => {
        for (const q of [0.001, 0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 0.999]) {
          close(erlang.quantile(q, ep), gamma.quantile(q, gp), 1e-9);
        }
      });
      it('moments agree exactly with the gamma formulas', () => {
        const em = erlang.mean(ep);
        const gm = gamma.mean(gp);
        expect(em.defined && gm.defined).toBe(true);
        if (em.defined && gm.defined) close(em.value, gm.value, 1e-14);
        const ev = erlang.variance(ep);
        const gv = gamma.variance(gp);
        if (ev.defined && gv.defined) close(ev.value, gv.value, 1e-14);
      });
    });
  }
});

describe('reduction: Rayleigh(σ) is Weibull(shape 2, scale σ√2)', () => {
  const weibull = getDistribution('weibull');
  const sigma = 1.7;
  const wp = { k: 2, lambda: sigma * Math.SQRT2 };
  it('pdf, cdf and sf agree to 1e-12', () => {
    for (let i = 0; i <= 40; i++) {
      const x = i * 0.25;
      close(rayleigh.pdf(x, { sigma }), weibull.pdf(x, wp), 1e-12, 1e-300);
      close(rayleigh.cdf(x, { sigma }), weibull.cdf(x, wp), 1e-12, 1e-300);
      close(rayleigh.sf(x, { sigma }), weibull.sf(x, wp), 1e-12, 1e-300);
    }
  });
  it('quantiles agree to 1e-12', () => {
    for (const q of [0.001, 0.1, 0.5, 0.9, 0.999]) {
      close(rayleigh.quantile(q, { sigma }), weibull.quantile(q, wp), 1e-12);
    }
  });
  it('mean and variance agree with the Weibull values', () => {
    const rm = rayleigh.mean({ sigma });
    const wm = weibull.mean(wp);
    if (rm.defined && wm.defined) close(rm.value, wm.value, 1e-13);
    const rv = rayleigh.variance({ sigma });
    const wv = weibull.variance(wp);
    if (rv.defined && wv.defined) close(rv.value, wv.value, 1e-12);
  });
});

describe('reduction: Half-normal(σ) is |Normal(0, σ)|', () => {
  const normal = getDistribution('normal');
  const sigma = 2.3;
  it('cdf equals 2Φ(x/σ) − 1 and pdf is twice the normal density', () => {
    for (let i = 0; i <= 40; i++) {
      const x = i * 0.2;
      close(halfNormal.cdf(x, { sigma }), 2 * normal.cdf(x, { mu: 0, sigma }) - 1, 1e-12, 1e-14);
      close(halfNormal.pdf(x, { sigma }), 2 * normal.pdf(x, { mu: 0, sigma }), 1e-13, 1e-300);
      close(halfNormal.sf(x, { sigma }), 2 * normal.sf(x, { mu: 0, sigma }), 1e-12, 1e-300);
    }
  });
  it('quantile is the corresponding two-sided normal quantile', () => {
    for (const q of [0.001, 0.25, 0.5, 0.9, 0.999]) {
      close(halfNormal.quantile(q, { sigma }), normal.quantile((1 + q) / 2, { mu: 0, sigma }), 1e-12);
    }
  });
});

describe('reduction: Beta-binomial(n, 1, 1) is discrete uniform on {0..n}', () => {
  it('every pmf value equals 1/(n+1)', () => {
    for (const n of [1, 5, 12, 40]) {
      for (let k = 0; k <= n; k++) {
        close(betaBinomial.pdf(k, { n, alpha: 1, beta: 1 }), 1 / (n + 1), 1e-13);
      }
    }
  });
  it('cdf matches the discrete uniform on {0..n}', () => {
    const du = getDistribution('discreteUniform');
    const n = 9;
    for (let k = -1; k <= n + 1; k++) {
      close(betaBinomial.cdf(k, { n, alpha: 1, beta: 1 }), du.cdf(k, { a: 0, b: n }), 1e-13, 1e-14);
    }
  });
});

describe('reduction: Beta-binomial with large α, β approaches the binomial', () => {
  const binomial = getDistribution('binomial');
  const n = 10;
  const p = 0.4;
  it('converges as the prior concentrates at a fixed ratio', () => {
    let previous = Infinity;
    for (const scale of [10, 100, 1000, 100000, 10000000]) {
      const prm = { n, alpha: scale * p, beta: scale * (1 - p) };
      let maxDiff = 0;
      for (let k = 0; k <= n; k++) {
        maxDiff = Math.max(maxDiff, Math.abs(betaBinomial.pdf(k, prm) - binomial.pdf(k, { n, p })));
      }
      expect(maxDiff).toBeLessThan(previous);
      previous = maxDiff;
    }
    // The remaining gap is governed by the variance inflation factor
    // (α+β+n)/(α+β+1), which approaches 1 like (n−1)/(α+β): at α+β = 1e7 and
    // n = 10 that is 9e-7 on the variance, so a pmf gap of order 1e-7 is the
    // correct limit behaviour and not a defect.
    expect(previous).toBeLessThan(1e-6);
  });
  it('the mean is exactly nα/(α+β) = np at every concentration', () => {
    for (const scale of [1, 10, 1000]) {
      const m = betaBinomial.mean({ n, alpha: scale * p, beta: scale * (1 - p) });
      expect(m.defined).toBe(true);
      if (m.defined) close(m.value, n * p, 1e-13);
    }
  });
});

describe('reduction: F(1, ν) is the square of a Student t with ν degrees of freedom', () => {
  const studentT = getDistribution('studentT');
  for (const nu of [1, 4, 12]) {
    it(`ν = ${nu}: P(F ≤ x) = P(|T| ≤ √x)`, () => {
      for (const x of [0.01, 0.1, 0.5, 1, 2, 4, 10, 50, 200]) {
        const tp = { nu, mu: 0, sigma: 1 };
        const expected = 1 - 2 * studentT.sf(Math.sqrt(x), tp);
        close(fDist.cdf(x, { d1: 1, d2: nu }), expected, 1e-10, 1e-14);
        close(fDist.sf(x, { d1: 1, d2: nu }), 2 * studentT.sf(Math.sqrt(x), tp), 1e-10, 1e-300);
      }
    });
  }
});

describe('reduction: Truncated normal with a = −∞, b = +∞ is the normal', () => {
  const normal = getDistribution('normal');
  const p = { mu: 1.5, sigma: 2, a: -Infinity, b: Infinity };
  const np = { mu: 1.5, sigma: 2 };
  it('pdf, cdf and sf are identical', () => {
    for (let i = -40; i <= 40; i++) {
      const x = 1.5 + i * 0.3;
      close(truncatedNormal.pdf(x, p), normal.pdf(x, np), 1e-14, 1e-300);
      close(truncatedNormal.cdf(x, p), normal.cdf(x, np), 1e-14, 1e-300);
      close(truncatedNormal.sf(x, p), normal.sf(x, np), 1e-14, 1e-300);
    }
  });
  it('quantiles are identical', () => {
    for (const q of [1e-6, 0.001, 0.1, 0.5, 0.9, 0.999, 1 - 1e-6]) {
      close(truncatedNormal.quantile(q, p), normal.quantile(q, np), 1e-13);
    }
  });
  it('mean and variance reduce to μ and σ²', () => {
    const m = truncatedNormal.mean(p);
    const v = truncatedNormal.variance(p);
    const s = truncatedNormal.skewness(p);
    const k = truncatedNormal.excessKurtosis(p);
    expect(m.defined && v.defined && s.defined && k.defined).toBe(true);
    if (m.defined) close(m.value, 1.5, 1e-14);
    if (v.defined) close(v.value, 4, 1e-13);
    if (s.defined) expect(Math.abs(s.value)).toBeLessThan(1e-12);
    if (k.defined) expect(Math.abs(k.value)).toBeLessThan(1e-12);
  });
  it('one-sided truncation at the mean doubles the density and halves nothing else', () => {
    const half = { mu: 0, sigma: 1, a: 0, b: Infinity };
    close(truncatedNormal.pdf(0.7, half), 2 * normal.pdf(0.7, { mu: 0, sigma: 1 }), 1e-14);
    // A standard normal truncated to [0, ∞) is the half-normal with σ = 1.
    for (const x of [0.1, 0.5, 1, 2, 4]) {
      close(truncatedNormal.cdf(x, half), halfNormal.cdf(x, { sigma: 1 }), 1e-12);
      close(truncatedNormal.sf(x, half), halfNormal.sf(x, { sigma: 1 }), 1e-11, 1e-300);
    }
  });
});

describe('truncated normal under extreme truncation', () => {
  // With a = μ + 20σ the retained mass is about 2.75e-89. Anything that forms
  // Φ(β) − Φ(α) in the lower tail returns 0 here and the distribution
  // collapses; the survival-function form keeps full relative precision.
  // b = 40 rather than +∞ so that validateParams, which requires finite
  // parameters, applies; the mass beyond 40σ is below the smallest double.
  const p = { mu: 0, sigma: 1, a: 20, b: 40 };
  it('is a valid distribution with a finite normalisation', () => {
    expect(validateParams(truncatedNormal, p)).toEqual([]);
    expect(Number.isFinite(truncatedNormal.pdf(20.05, p))).toBe(true);
    expect(truncatedNormal.pdf(20.05, p)).toBeGreaterThan(0);
  });
  it('quantiles are ordered, inside the interval, and invert the cdf', () => {
    let last = 20;
    for (const q of [0.001, 0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 0.999]) {
      const x = truncatedNormal.quantile(q, p);
      expect(x).toBeGreaterThan(last);
      expect(x).toBeLessThan(40);
      last = x;
      close(truncatedNormal.cdf(x, p), q, 1e-9);
    }
  });
  it('the conditional mean sits just above the truncation point (≈ a + 1/a)', () => {
    const m = truncatedNormal.mean(p);
    expect(m.defined).toBe(true);
    // For the standard normal, E[Z | Z > a] = φ(a)/Φ(−a) → a + 1/a for large a.
    if (m.defined) close(m.value, 20 + 1 / 20, 1e-3);
  });
  it('refuses a truncation interval whose probability underflows to zero', () => {
    const impossible = { mu: 0, sigma: 1, a: 100, b: 200 };
    const issues = validateParams(truncatedNormal, impossible);
    expect(issues.length).toBeGreaterThan(0);
    expect(() => truncatedNormal.pdf(150, impossible)).toThrow();
    const m = truncatedNormal.mean(impossible);
    expect(m.defined).toBe(false);
  });
});

describe('reduction: Skellam with μ₂ = 0 is Poisson(μ₁)', () => {
  const poisson = getDistribution('poisson');
  const mu1 = 4.5;
  it('pmf, cdf and sf match the Poisson', () => {
    for (let k = 0; k <= 25; k++) {
      close(skellam.pdf(k, { mu1, mu2: 0 }), poisson.pdf(k, { lambda: mu1 }), 1e-13, 1e-300);
      close(skellam.cdf(k, { mu1, mu2: 0 }), poisson.cdf(k, { lambda: mu1 }), 1e-12, 1e-300);
      close(skellam.sf(k, { mu1, mu2: 0 }), poisson.sf(k, { lambda: mu1 }), 1e-11, 1e-300);
    }
    expect(skellam.pdf(-1, { mu1, mu2: 0 })).toBe(0);
    expect(skellam.cdf(-1, { mu1, mu2: 0 })).toBe(0);
  });
  it('with μ₁ = 0 it is the negative of a Poisson(μ₂)', () => {
    for (let k = 0; k <= 20; k++) {
      close(skellam.pdf(-k, { mu1: 0, mu2: 3 }), poisson.pdf(k, { lambda: 3 }), 1e-13, 1e-300);
    }
  });
  it('the pmf is the exact Bessel expression at a published point', () => {
    // Skellam(1, 1) at k = 0 is e^{−2}·I₀(2) = 0.13533528323661270 · 2.2795853023360673.
    close(skellam.pdf(0, { mu1: 1, mu2: 1 }), Math.exp(-2) * 2.2795853023360673, 1e-12);
    // I₁(2) = 1.5906368546373291.
    close(skellam.pdf(1, { mu1: 1, mu2: 1 }), Math.exp(-2) * 1.5906368546373291, 1e-12);
    close(skellam.pdf(-1, { mu1: 1, mu2: 1 }), Math.exp(-2) * 1.5906368546373291, 1e-12);
  });
});

describe('reduction: Conway–Maxwell–Poisson limits', () => {
  const poisson = getDistribution('poisson');
  const geometric = getDistribution('geometric');
  const bernoulli = getDistribution('bernoulli');
  it('ν = 1 is exactly Poisson(λ)', () => {
    for (const lambda of [0.5, 4, 17]) {
      for (let k = 0; k <= 40; k++) {
        close(comPoisson.pdf(k, { lambda, nu: 1 }), poisson.pdf(k, { lambda }), 1e-12, 1e-300);
        close(comPoisson.cdf(k, { lambda, nu: 1 }), poisson.cdf(k, { lambda }), 1e-12, 1e-300);
      }
      const m = comPoisson.mean({ lambda, nu: 1 });
      const v = comPoisson.variance({ lambda, nu: 1 });
      if (m.defined) close(m.value, lambda, 1e-10);
      if (v.defined) close(v.value, lambda, 1e-10);
    }
  });
  it('ν = 0 with λ < 1 is the geometric distribution on {0, 1, …}', () => {
    const lambda = 0.4;
    for (let k = 0; k <= 30; k++) {
      // The registry geometric counts trials from 1, so shift by one.
      close(comPoisson.pdf(k, { lambda, nu: 0 }), geometric.pdf(k + 1, { p: 1 - lambda }), 1e-12, 1e-300);
    }
    const m = comPoisson.mean({ lambda, nu: 0 });
    if (m.defined) close(m.value, lambda / (1 - lambda), 1e-9);
  });
  it('refuses ν = 0 with λ ≥ 1, where the normalising series diverges', () => {
    const issues = validateParams(comPoisson, { lambda: 1.2, nu: 0 });
    expect(issues.length).toBeGreaterThan(0);
    expect(() => comPoisson.pdf(3, { lambda: 1.2, nu: 0 })).toThrow();
  });
  it('refuses parameters whose normalising constant cannot be summed', () => {
    const issues = validateParams(comPoisson, { lambda: 1000, nu: 0.05 });
    expect(issues.length).toBeGreaterThan(0);
    expect(() => comPoisson.mean({ lambda: 1000, nu: 0.05 })).toThrow();
  });
  it('large ν approaches Bernoulli(λ/(1+λ))', () => {
    const lambda = 0.5;
    const p = lambda / (1 + lambda);
    for (let k = 0; k <= 1; k++) {
      close(comPoisson.pdf(k, { lambda, nu: 400 }), bernoulli.pdf(k, { p }), 1e-12);
    }
    expect(comPoisson.pdf(2, { lambda, nu: 400 })).toBeLessThan(1e-100);
  });
});

/* ================================================================== *
 * 2. Closed-form identities and published constants
 * ================================================================== */

describe('closed-form quantiles invert the cdf exactly', () => {
  const qs = [0.001, 0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 0.999];
  const cases: Array<[string, DistributionDef, Params]> = [
    ['laplace', laplace, { mu: -2, b: 3 }],
    ['logistic', logistic, { mu: 1, s: 0.7 }],
    ['rayleigh', rayleigh, { sigma: 2.5 }],
    ['gumbel', gumbel, { mu: 0.5, beta: 1.5 }],
    ['frechet', frechet, { alpha: 2.5, s: 1.5, m: -1 }],
    ['burr12', burr12, { c: 2.5, k: 1.3 }],
    ['halfNormal', halfNormal, { sigma: 0.8 }],
    ['kumaraswamy', kumaraswamy, { a: 2.5, b: 4 }],
    ['levy', levy, { mu: 1, c: 2 }],
    ['truncatedNormal', truncatedNormal, { mu: 0, sigma: 1, a: -0.5, b: 3 }],
  ];
  for (const [id, def, prm] of cases) {
    it(`${id}: cdf(quantile(q)) = q to 1e-12`, () => {
      expect(def.closedFormQuantile).toBe(true);
      for (const q of qs) {
        close(def.cdf(def.quantile(q, prm), prm), q, 1e-12);
      }
    });
  }
  it('every definition reports whether its quantile is closed form', () => {
    for (const def of EXTENDED_DISTRIBUTIONS) {
      expect(typeof def.closedFormQuantile).toBe('boolean');
    }
  });
});

describe('published moment values', () => {
  it('Gumbel mean is μ + βγ with γ = 0.5772156649015329', () => {
    const m = gumbel.mean({ mu: 3, beta: 2 });
    expect(m.defined).toBe(true);
    if (m.defined) close(m.value, 3 + 2 * 0.5772156649015329, 1e-15);
    const v = gumbel.variance({ mu: 3, beta: 2 });
    if (v.defined) close(v.value, (Math.PI * Math.PI * 4) / 6, 1e-15);
    const s = gumbel.skewness({ mu: 3, beta: 2 });
    if (s.defined) close(s.value, 1.1395470994046486, 1e-15);
  });
  it('Rayleigh mean is σ√(π/2) and variance (2 − π/2)σ²', () => {
    const sigma = 3.25;
    const m = rayleigh.mean({ sigma });
    if (m.defined) close(m.value, sigma * Math.sqrt(Math.PI / 2), 1e-15);
    const v = rayleigh.variance({ sigma });
    if (v.defined) close(v.value, (2 - Math.PI / 2) * sigma * sigma, 1e-15);
    const md = rayleigh.mode({ sigma });
    if (md.defined) expect(md.value).toBe(sigma);
  });
  it('Laplace variance is 2b²', () => {
    const v = laplace.variance({ mu: 7, b: 1.75 });
    if (v.defined) close(v.value, 2 * 1.75 * 1.75, 1e-15);
    const k = laplace.excessKurtosis({ mu: 7, b: 1.75 });
    if (k.defined) expect(k.value).toBe(3);
  });
  it('Logistic variance is s²π²/3', () => {
    const v = logistic.variance({ mu: 0, s: 1.4 });
    if (v.defined) close(v.value, (1.4 * 1.4 * Math.PI * Math.PI) / 3, 1e-15);
    const k = logistic.excessKurtosis({ mu: 0, s: 1.4 });
    if (k.defined) close(k.value, 1.2, 1e-15);
  });
  it('Inverse Gaussian variance is μ³/λ', () => {
    const v = inverseGaussian.variance({ mu: 2, lambda: 3 });
    if (v.defined) close(v.value, 8 / 3, 1e-15);
    const s = inverseGaussian.skewness({ mu: 2, lambda: 3 });
    if (s.defined) close(s.value, 3 * Math.sqrt(2 / 3), 1e-15);
  });
  it('Half-normal mean is σ√(2/π) and variance σ²(1 − 2/π)', () => {
    const m = halfNormal.mean({ sigma: 2 });
    if (m.defined) close(m.value, 2 * Math.sqrt(2 / Math.PI), 1e-15);
    const v = halfNormal.variance({ sigma: 2 });
    if (v.defined) close(v.value, 4 * (1 - 2 / Math.PI), 1e-15);
  });
  it('Erlang mean is k/λ and variance k/λ²', () => {
    const m = erlang.mean({ k: 7, lambda: 2 });
    if (m.defined) close(m.value, 3.5, 1e-15);
    const v = erlang.variance({ k: 7, lambda: 2 });
    if (v.defined) close(v.value, 7 / 4, 1e-15);
  });
  it('Skellam mean is μ₁ − μ₂ and variance μ₁ + μ₂', () => {
    const m = skellam.mean({ mu1: 4, mu2: 2.5 });
    if (m.defined) close(m.value, 1.5, 1e-15);
    const v = skellam.variance({ mu1: 4, mu2: 2.5 });
    if (v.defined) close(v.value, 6.5, 1e-15);
  });
  it('Beta-binomial variance is nαβ(α+β+n)/((α+β)²(α+β+1))', () => {
    const v = betaBinomial.variance({ n: 10, alpha: 2, beta: 3 });
    if (v.defined) close(v.value, (10 * 2 * 3 * (5 + 10)) / (25 * 6), 1e-14);
  });
  it('Yule–Simon mean is ρ/(ρ−1) and is undefined for ρ ≤ 1', () => {
    const m = yuleSimon.mean({ rho: 2.5 });
    if (m.defined) close(m.value, 2.5 / 1.5, 1e-15);
    expect(yuleSimon.mean({ rho: 0.8 }).defined).toBe(false);
    expect(yuleSimon.variance({ rho: 1.5 }).defined).toBe(false);
  });
  it('Von Mises reports the circular variance 1 − I₁(κ)/I₀(κ) instead of a linear one', () => {
    const v = vonMises.variance({ mu: 0, kappa: 2 });
    expect(v.defined).toBe(false);
    if (!v.defined) {
      // I₁(2)/I₀(2) = 1.5906368546373291 / 2.2795853023360673 = 0.6977746579640289.
      expect(v.reason).toContain((1 - 0.6977746579640289).toPrecision(8));
    }
  });
});

describe('moments that do not exist are reported as undefined, never as numbers', () => {
  it('F distribution', () => {
    expect(fDist.mean({ d1: 4, d2: 2 }).defined).toBe(false);
    expect(fDist.mean({ d1: 4, d2: 1 }).defined).toBe(false);
    expect(fDist.mean({ d1: 4, d2: 2.5 }).defined).toBe(true);
    expect(fDist.variance({ d1: 4, d2: 4 }).defined).toBe(false);
    expect(fDist.skewness({ d1: 4, d2: 6 }).defined).toBe(false);
    expect(fDist.excessKurtosis({ d1: 4, d2: 8 }).defined).toBe(false);
    const m = fDist.mean({ d1: 3, d2: 10 });
    if (m.defined) close(m.value, 10 / 8, 1e-15);
  });
  it('Lévy has no moments at all', () => {
    for (const m of [levy.mean({ mu: 0, c: 1 }), levy.variance({ mu: 0, c: 1 }), levy.skewness({ mu: 0, c: 1 }), levy.excessKurtosis({ mu: 0, c: 1 })]) {
      expect(m.defined).toBe(false);
      if (!m.defined) expect(m.reason.length).toBeGreaterThan(10);
    }
    const mode = levy.mode({ mu: 2, c: 3 });
    if (mode.defined) close(mode.value, 2 + 1, 1e-15);
  });
  it('Burr XII requires c·k > n for the n-th moment', () => {
    expect(burr12.mean({ c: 0.5, k: 1 }).defined).toBe(false);
    expect(burr12.variance({ c: 1, k: 2 }).defined).toBe(false);
    expect(burr12.skewness({ c: 1, k: 3 }).defined).toBe(false);
    expect(burr12.excessKurtosis({ c: 1, k: 4 }).defined).toBe(false);
    expect(burr12.mean({ c: 2, k: 2 }).defined).toBe(true);
    // Burr XII with c = 1 is a Pareto type II (Lomax): E[X] = 1/(k−1).
    const m = burr12.mean({ c: 1, k: 3 });
    if (m.defined) close(m.value, 0.5, 1e-13);
  });
  it('Fréchet and beta prime report infinite moments as undefined', () => {
    expect(frechet.mean({ alpha: 0.9, s: 1, m: 0 }).defined).toBe(false);
    expect(frechet.variance({ alpha: 2, s: 1, m: 0 }).defined).toBe(false);
    expect(betaPrime.mean({ alpha: 2, beta: 1 }).defined).toBe(false);
    expect(betaPrime.variance({ alpha: 2, beta: 2 }).defined).toBe(false);
    // Beta prime with β = 2: E[X] = α/(β−1) = α.
    const m = betaPrime.mean({ alpha: 3, beta: 2 });
    if (m.defined) close(m.value, 3, 1e-13);
  });
});

describe('Kumaraswamy and Zipf closed forms', () => {
  it('Kumaraswamy(1, 1) is the standard uniform', () => {
    const uniform = getDistribution('uniform');
    for (let i = 0; i <= 10; i++) {
      const x = i / 10;
      close(kumaraswamy.pdf(x, { a: 1, b: 1 }), uniform.pdf(x, { a: 0, b: 1 }), 1e-14);
      close(kumaraswamy.cdf(x, { a: 1, b: 1 }), x, 1e-14, 1e-16);
    }
    expect(kumaraswamy.mode({ a: 1, b: 1 }).defined).toBe(false);
  });
  it('Kumaraswamy(1, b) has mean 1/(b+1) and cdf 1 − (1 − x)^b', () => {
    const b = 3;
    const m = kumaraswamy.mean({ a: 1, b });
    if (m.defined) close(m.value, 1 / (b + 1), 1e-13);
    for (const x of [0.1, 0.4, 0.9]) {
      close(kumaraswamy.cdf(x, { a: 1, b }), 1 - Math.pow(1 - x, b), 1e-14);
    }
  });
  it('Zipf with s = 1 and N = 4 has pmf proportional to 1/k with H = 25/12', () => {
    const h = 1 + 1 / 2 + 1 / 3 + 1 / 4;
    for (let k = 1; k <= 4; k++) {
      close(zipf.pdf(k, { s: 1, bigN: 4 }), 1 / (k * h), 1e-14);
    }
    const m = zipf.mean({ s: 1, bigN: 4 });
    if (m.defined) close(m.value, 4 / h, 1e-13);
    expect(zipf.cdf(4, { s: 1, bigN: 4 })).toBe(1);
    expect(zipf.sf(4, { s: 1, bigN: 4 })).toBe(0);
  });
  it('Zipf with s = 0 is uniform on {1..N}', () => {
    for (let k = 1; k <= 5; k++) close(zipf.pdf(k, { s: 1e-300, bigN: 5 }), 0.2, 1e-12);
  });
  it('Logarithmic pmf and mean match the closed forms', () => {
    const p = 0.5;
    const scale = -1 / Math.log1p(-p);
    for (let k = 1; k <= 8; k++) {
      close(logarithmic.pdf(k, { p }), (scale * Math.pow(p, k)) / k, 1e-14);
    }
    const m = logarithmic.mean({ p });
    // p = 1/2: mean = (1/ln2)·1 = 1.4426950408889634.
    if (m.defined) close(m.value, 1.4426950408889634, 1e-13);
  });
  it('Yule–Simon survival function is k·B(k, ρ+1), e.g. ρ = 1 gives 1/(k+1)', () => {
    for (let k = 1; k <= 10; k++) {
      close(yuleSimon.sf(k, { rho: 1 }), 1 / (k + 1), 1e-13);
      close(yuleSimon.pdf(k, { rho: 1 }), 1 / (k * (k + 1)), 1e-13);
    }
  });
  it('Nakagami(m = 1, Ω) is Rayleigh with σ = √(Ω/2)', () => {
    const omega = 3;
    const sigma = Math.sqrt(omega / 2);
    for (const x of [0.1, 0.5, 1, 2, 4]) {
      close(nakagami.pdf(x, { m: 1, omega }), rayleigh.pdf(x, { sigma }), 1e-12);
      close(nakagami.cdf(x, { m: 1, omega }), rayleigh.cdf(x, { sigma }), 1e-12);
    }
  });
  it('Nakagami(m = 1/2, Ω) is half-normal with σ = √Ω', () => {
    const omega = 2;
    for (const x of [0.1, 0.5, 1, 3]) {
      close(nakagami.pdf(x, { m: 0.5, omega }), halfNormal.pdf(x, { sigma: Math.sqrt(omega) }), 1e-12);
      close(nakagami.cdf(x, { m: 0.5, omega }), halfNormal.cdf(x, { sigma: Math.sqrt(omega) }), 1e-11);
    }
  });
  it('Inverse Gaussian cdf matches the two-term normal expression at a point', () => {
    // F(1) with μ = 1, λ = 1 is Φ(0) + e² Φ(−2) = 0.5 + e²·0.022750131948179195.
    const expected = 0.5 + Math.exp(2) * 0.022750131948179195;
    close(inverseGaussian.cdf(1, { mu: 1, lambda: 1 }), expected, 1e-12);
  });
  it('Lévy cdf is erfc(√(c/2y)) — F(c/2) = erfc(1) = 0.15729920705028513', () => {
    close(levy.cdf(0.5, { mu: 0, c: 1 }), 0.15729920705028513, 1e-12);
    close(levy.sf(0.5, { mu: 0, c: 1 }), 1 - 0.15729920705028513, 1e-12);
  });
});

/* ================================================================== *
 * 3. Generic invariants, applied to every distribution
 * ================================================================== */

interface Case {
  def: DistributionDef;
  params: Params;
  /** Which moments can be checked against numerical integration/summation. */
  moments: 'none' | 'meanVar' | 'all';
  /** Whether a far-tail survival check applies (false for bounded support). */
  farTail: boolean;
  /** Panels for the quadrature / terms for the sum. */
  panels?: number;
  /** Relative tolerance for the quadrature identity. */
  quadTol?: number;
  /** Relative tolerance for the mean/variance comparison. */
  momentTol?: number;
}

const CASES: Case[] = [
  { def: laplace, params: { mu: 1, b: 2 }, moments: 'all', farTail: true },
  { def: logistic, params: { mu: 0, s: 1.5 }, moments: 'all', farTail: true },
  { def: rayleigh, params: { sigma: 2 }, moments: 'all', farTail: true },
  { def: gumbel, params: { mu: 1, beta: 2 }, moments: 'all', farTail: true },
  { def: frechet, params: { alpha: 8, s: 2, m: 1 }, moments: 'meanVar', farTail: true, momentTol: 1e-4 },
  { def: fDist, params: { d1: 5, d2: 12 }, moments: 'meanVar', farTail: true, momentTol: 1e-4 },
  { def: inverseGaussian, params: { mu: 2, lambda: 3 }, moments: 'all', farTail: true, momentTol: 1e-5 },
  { def: betaPrime, params: { alpha: 2, beta: 8 }, moments: 'meanVar', farTail: true, momentTol: 1e-5 },
  { def: erlang, params: { k: 3, lambda: 2 }, moments: 'all', farTail: true },
  { def: nakagami, params: { m: 2, omega: 3 }, moments: 'all', farTail: true },
  { def: burr12, params: { c: 3, k: 3 }, moments: 'meanVar', farTail: true, momentTol: 1e-5 },
  { def: halfNormal, params: { sigma: 1.5 }, moments: 'all', farTail: true },
  { def: truncatedNormal, params: { mu: 0.5, sigma: 1, a: -1, b: 2 }, moments: 'all', farTail: false },
  { def: vonMises, params: { mu: 0.3, kappa: 2 }, moments: 'none', farTail: false, panels: 200 },
  { def: levy, params: { mu: 0, c: 1 }, moments: 'none', farTail: true, panels: 1200 },
  { def: kumaraswamy, params: { a: 2, b: 3 }, moments: 'all', farTail: false },
  { def: betaBinomial, params: { n: 12, alpha: 2, beta: 3 }, moments: 'all', farTail: false },
  { def: zipf, params: { s: 1.5, bigN: 50 }, moments: 'all', farTail: false },
  { def: skellam, params: { mu1: 4, mu2: 2.5 }, moments: 'all', farTail: true },
  { def: logarithmic, params: { p: 0.6 }, moments: 'all', farTail: true },
  { def: yuleSimon, params: { rho: 5 }, moments: 'meanVar', farTail: true, momentTol: 1e-4 },
  { def: comPoisson, params: { lambda: 4, nu: 1.4 }, moments: 'all', farTail: false },
];

it('every extended distribution is covered by the generic invariant cases', () => {
  expect(new Set(CASES.map((c) => c.def.id)).size).toBe(EXTENDED_DISTRIBUTIONS.length);
  expect(EXTENDED_DISTRIBUTIONS.length).toBeGreaterThanOrEqual(22);
});

/** 5-point Gauss–Legendre nodes/weights, used only by the tests. */
const GLX = [0, 0.5384693101056831, -0.5384693101056831, 0.906179845938664, -0.906179845938664];
const GLW = [0.5688888888888889, 0.4786286704993665, 0.4786286704993665, 0.2369268850561891, 0.2369268850561891];

/** Composite Gauss–Legendre integral of g over the given panel edges. */
function quadrature(edges: number[], g: (x: number) => number): number {
  let total = 0;
  for (let j = 0; j + 1 < edges.length; j++) {
    const lo = edges[j];
    const hi = edges[j + 1];
    if (!(hi > lo)) continue;
    const half = (hi - lo) / 2;
    const mid = (hi + lo) / 2;
    let acc = 0;
    for (let i = 0; i < 5; i++) acc += GLW[i] * g(mid + half * GLX[i]);
    total += acc * half;
  }
  return total;
}

/**
 * Panel edges for the quadrature. For a bounded support the panels are uniform
 * (no quantile evaluation needed). For an unbounded one the edges are placed at
 * the quantiles of a uniform grid in the *normal* z scale, z ∈ [−6.5, 6.5],
 * which spans probabilities from 4e-11 to 1 − 4e-11 while still refining
 * geometrically into both tails. Equally spaced probabilities would put a
 * single panel across the whole of a heavy tail, where no 5-point rule can
 * integrate a density that varies by many orders of magnitude; with this
 * spacing the measured quadrature error is at the 1e-15 level for every case
 * here, which is what the tolerances below are set from.
 */
const edgeCache = new Map<Case, number[]>();

function panelEdges(c: Case): number[] {
  const cached = edgeCache.get(c);
  if (cached) return cached;
  const edges = buildPanelEdges(c);
  edgeCache.set(c, edges);
  return edges;
}

function buildPanelEdges(c: Case): number[] {
  const n = c.panels ?? 400;
  const s = c.def.support(c.params);
  const edges: number[] = [];
  if (Number.isFinite(s.min) && Number.isFinite(s.max)) {
    for (let j = 0; j <= n; j++) edges.push(s.min + ((s.max - s.min) * j) / n);
    return edges;
  }
  for (let j = 0; j <= n; j++) edges.push(c.def.quantile(normalCdf(-6.5 + (13 * j) / n), c.params));
  return edges;
}

/** Support points of a discrete distribution, truncated at a far quantile. */
function discreteSupport(c: Case): number[] {
  const s = c.def.support(c.params);
  const lo = Number.isFinite(s.min) ? s.min : c.def.quantile(1e-15, c.params);
  const hi = Number.isFinite(s.max) ? s.max : c.def.quantile(1 - 1e-15, c.params);
  const out: number[] = [];
  for (let k = lo; k <= hi; k++) out.push(k);
  return out;
}

describe.each(CASES.map((c) => [c.def.id, c] as const))('invariants: %s', (_id, c) => {
  const { def, params } = c;
  const support = def.support(params);
  const discrete = def.kind === 'discrete';

  const grid: number[] = discrete
    ? discreteSupport(c)
    : Array.from({ length: 41 }, (_, i) => def.quantile(0.002 + (0.996 * i) / 40, params));

  it('has valid parameters', () => {
    expect(validateParams(def, params)).toEqual([]);
  });

  it('cdf is monotone non-decreasing and bounded by 0 and 1', () => {
    let previous = -Infinity;
    for (const x of grid) {
      const v = def.cdf(x, params);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(previous - 1e-15);
      previous = v;
    }
  });

  it('cdf is exactly 0 at/below the lower support bound and exactly 1 at the upper', () => {
    if (discrete) {
      expect(def.cdf(support.min - 1, params)).toBe(0);
      expect(def.sf(support.min - 1, params)).toBe(1);
    } else {
      expect(def.cdf(support.min, params)).toBe(0);
      expect(def.sf(support.min, params)).toBe(1);
    }
    expect(def.cdf(support.max, params)).toBe(1);
    expect(def.sf(support.max, params)).toBe(0);
    if (Number.isFinite(support.min)) {
      expect(def.pdf(support.min - 1, params)).toBe(0);
      expect(def.cdf(support.min - 1, params)).toBe(0);
    }
    if (Number.isFinite(support.max)) {
      expect(def.pdf(support.max + 1, params)).toBe(0);
      expect(def.cdf(support.max + 1, params)).toBe(1);
    }
  });

  it('cdf and sf sum to 1', () => {
    for (const x of grid) {
      close(def.cdf(x, params) + def.sf(x, params), 1, 1e-10);
    }
  });

  it('quantile inverts the cdf', () => {
    if (discrete) {
      // Generalised inverse: F(Q(q)) ≥ q, and Q(q) is the smallest such value.
      for (const q of [0.001, 0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 0.999]) {
        const k = def.quantile(q, params);
        expect(Number.isInteger(k)).toBe(true);
        expect(def.cdf(k, params)).toBeGreaterThanOrEqual(q - 1e-15);
        if (k > support.min) expect(def.cdf(k - 1, params)).toBeLessThan(q + 1e-15);
      }
    } else {
      for (const x of grid) {
        const q = def.cdf(x, params);
        if (q <= 0 || q >= 1) continue;
        const back = def.quantile(q, params);
        close(back, x, 1e-6, 1e-9);
      }
    }
  });

  it('pdf is non-negative and logPdf agrees with log(pdf)', () => {
    for (const x of grid) {
      const d = def.pdf(x, params);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(Number.isNaN(d)).toBe(false);
      if (d > 0 && Number.isFinite(d)) {
        close(def.logPdf(x, params), Math.log(d), 1e-9, 1e-12);
      }
    }
  });

  if (c.farTail) {
    it('sf stays positive and strictly decreasing where 1 − cdf has underflowed to 0', () => {
      const centre = def.quantile(0.9, params);
      const base = Number.isFinite(support.min) ? support.min : 0;
      let found: number | null = null;
      let step = Math.max(1, Math.abs(centre - base));
      for (let i = 0; i < 400 && found === null; i++) {
        const x = base + step;
        if (def.cdf(x, params) === 1 && def.sf(x, params) > 0) found = x;
        step *= discrete ? 2 : 1.5;
      }
      expect(found).not.toBeNull();
      if (found !== null) {
        // 1 − cdf is exactly 0 here; the survival function is not.
        expect(1 - def.cdf(found, params)).toBe(0);
        const s1 = def.sf(found, params);
        expect(s1).toBeGreaterThan(0);
        const next = discrete ? found + Math.max(1, Math.round(found * 0.2)) : found * 1.2 + 1;
        const s2 = def.sf(next, params);
        expect(s2).toBeGreaterThan(0);
        expect(s2).toBeLessThan(s1);
      }
    });
  }

  it('the density integrates (or the pmf sums) to the probability of the window', () => {
    if (discrete) {
      const ks = discreteSupport(c);
      let total = 0;
      for (const k of ks) total += def.pdf(k, params);
      const window = def.cdf(ks[ks.length - 1], params) - (ks[0] > support.min ? def.cdf(ks[0] - 1, params) : 0);
      close(total, window, 1e-9);
      close(total, 1, 1e-9);
    } else {
      const edges = panelEdges(c);
      const lo = edges[0];
      const hi = edges[edges.length - 1];
      const integral = quadrature(edges, (x) => def.pdf(x, params));
      const window = def.cdf(hi, params) - def.cdf(lo, params);
      close(integral, window, c.quadTol ?? 1e-9);
      // The window itself holds all but a negligible amount of the mass.
      expect(def.cdf(lo, params) + def.sf(hi, params)).toBeLessThan(1e-8);
      close(integral, 1, 1e-8);
    }
  });

  if (c.moments !== 'none') {
    it('mean and variance match a numerical integral/sum of the density', () => {
      const tol = c.momentTol ?? 1e-7;
      let m1: number;
      let m2: number;
      let m3 = 0;
      let m4 = 0;
      if (discrete) {
        m1 = 0;
        m2 = 0;
        for (const k of discreteSupport(c)) {
          const w = def.pdf(k, params);
          m1 += k * w;
          m2 += k * k * w;
          m3 += k * k * k * w;
          m4 += k * k * k * k * w;
        }
      } else {
        const edges = panelEdges(c);
        m1 = quadrature(edges, (x) => x * def.pdf(x, params));
        m2 = quadrature(edges, (x) => x * x * def.pdf(x, params));
        m3 = quadrature(edges, (x) => x * x * x * def.pdf(x, params));
        m4 = quadrature(edges, (x) => x * x * x * x * def.pdf(x, params));
      }
      const mean = def.mean(params);
      expect(mean.defined).toBe(true);
      if (mean.defined) close(mean.value, m1, tol, 1e-9);
      const variance = def.variance(params);
      expect(variance.defined).toBe(true);
      if (variance.defined) close(variance.value, m2 - m1 * m1, Math.max(tol * 100, 1e-5), 1e-9);
      if (c.moments === 'all') {
        const v = m2 - m1 * m1;
        const mu3 = m3 - 3 * m1 * m2 + 2 * m1 ** 3;
        const mu4 = m4 - 4 * m1 * m3 + 6 * m1 * m1 * m2 - 3 * m1 ** 4;
        const skew = def.skewness(params);
        if (skew.defined && Number.isFinite(skew.value)) {
          close(skew.value, mu3 / Math.pow(v, 1.5), 1e-4, 1e-6);
        }
        const kurt = def.excessKurtosis(params);
        if (kurt.defined && Number.isFinite(kurt.value)) {
          close(kurt.value, mu4 / (v * v) - 3, 1e-4, 1e-6);
        }
      }
    });
  }

  it('the mode is a point of maximum density where it is reported', () => {
    const mode = def.mode(params);
    if (!mode.defined) return;
    const atMode = def.pdf(mode.value, params);
    for (const x of grid) {
      expect(def.pdf(x, params)).toBeLessThanOrEqual(atMode * (1 + 1e-9) + 1e-300);
    }
  });

  it('sample() agrees with cdf(): sample mean within 4 standard errors and a KS check', () => {
    const n = 200000;
    const rng = new Random(`extended-${def.id}`);
    const draws = new Float64Array(n);
    for (let i = 0; i < n; i++) draws[i] = def.sample(rng, params);
    for (let i = 0; i < n; i++) expect(Number.isNaN(draws[i])).toBe(false);

    const mean = def.mean(params);
    const variance = def.variance(params);
    if (mean.defined && variance.defined && Number.isFinite(mean.value) && Number.isFinite(variance.value)) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += draws[i];
      const sampleMean = sum / n;
      const se = Math.sqrt(variance.value / n);
      expect(Math.abs(sampleMean - mean.value)).toBeLessThanOrEqual(4 * se);
    }

    // Kolmogorov–Smirnov style check on a subsample of order statistics. The
    // empirical cdf is the fraction of draws ≤ x (found by binary search), not
    // the index of the order statistic: for a discrete law many draws share a
    // value and the two are not the same.
    draws.sort();
    const atMost = (x: number): number => {
      let lo = 0;
      let hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (draws[mid] <= x) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    const checks = 250;
    let d = 0;
    for (let j = 1; j <= checks; j++) {
      const idx = Math.floor((j * n) / (checks + 1));
      const x = draws[idx];
      d = Math.max(d, Math.abs(atMost(x) / n - def.cdf(x, params)));
    }
    // 1.95/√n ≈ 0.0044 is the 0.1% KS critical value at n = 200,000; for a
    // discrete law the empirical cdf jumps, so allow a little more.
    expect(d).toBeLessThan(discrete ? 0.01 : 0.006);
  });
});

/* ================================================================== *
 * 4. Invalid parameters
 * ================================================================== */

describe('invalid parameters produce issues, never numbers', () => {
  for (const def of EXTENDED_DISTRIBUTIONS) {
    it(`${def.id} rejects out-of-range and non-finite parameters`, () => {
      const base: Params = Object.fromEntries(def.params.map((p) => [p.key, p.defaultValue]));
      expect(validateParams(def, base)).toEqual([]);
      for (const spec of def.params) {
        expect(validateParams(def, { ...base, [spec.key]: NaN }).length).toBeGreaterThan(0);
        expect(validateParams(def, { ...base, [spec.key]: Infinity }).length).toBeGreaterThan(0);
        if (spec.min !== undefined) {
          const below = spec.minExclusive ? spec.min : spec.min - 1;
          // For an inclusive bound as extreme as −1e300, min − 1 rounds back to
          // min and is a legal value; there is nothing to test there.
          if (Number.isFinite(below) && (spec.minExclusive || below < spec.min)) {
            expect(validateParams(def, { ...base, [spec.key]: below }).length).toBeGreaterThan(0);
          }
        }
        if (spec.max !== undefined && Number.isFinite(spec.max) && spec.max < 1e300) {
          expect(validateParams(def, { ...base, [spec.key]: spec.max + 1 }).length).toBeGreaterThan(0);
        }
        if (spec.integer) {
          expect(validateParams(def, { ...base, [spec.key]: spec.defaultValue + 0.5 }).length).toBeGreaterThan(0);
        }
      }
    });
  }

  it('quantile levels outside [0, 1] are rejected rather than extrapolated', () => {
    for (const def of EXTENDED_DISTRIBUTIONS) {
      const base: Params = Object.fromEntries(def.params.map((p) => [p.key, p.defaultValue]));
      expect(() => def.quantile(-0.1, base)).toThrow();
      expect(() => def.quantile(1.5, base)).toThrow();
      expect(() => def.quantile(NaN, base)).toThrow();
    }
  });

  it('truncated normal rejects b ≤ a', () => {
    expect(validateParams(truncatedNormal, { mu: 0, sigma: 1, a: 2, b: 1 }).length).toBeGreaterThan(0);
    expect(validateParams(truncatedNormal, { mu: 0, sigma: 1, a: 1, b: 1 }).length).toBeGreaterThan(0);
  });
});
