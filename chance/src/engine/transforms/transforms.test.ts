/**
 * Tests for the transform and asymptotic methods module.
 *
 * Every reference value here is INDEPENDENT of the implementation under test:
 * a direct DFT written out in this file, a literal closed-form transform
 * formula, the distribution registry's own analytic moments and densities, or a
 * brute-force enumeration. Nothing is asserted against this module's own
 * output except where two of its routes are deliberately cross-checked against
 * each other, and in those cases both are separately pinned to an external
 * reference as well.
 *
 * Every tolerance carries a comment giving the measured error.
 */
import { describe, expect, it } from 'vitest';
import {
  cAbs,
  cDiv,
  cExp,
  cLog,
  cMul,
  complex,
  fftComplex,
  nextPowerOfTwo,
  parseval,
  type Complex,
} from './complex';
import {
  cf,
  cfOfSum,
  cgf,
  cgfDerivative,
  cgfSecondDerivative,
  cumulants,
  inRegion,
  mgf,
  mgfRegion,
  pgf,
} from './generating';
import {
  convolveAll,
  convolveLattice,
  convolvePower,
  latticeFromDiscrete,
  makeLattice,
} from './convolution';
import {
  cdfByCos,
  cdfByGilPelaez,
  cdfByGilPelaezStrict,
  cdfByLatticeInversion,
  cosExpansion,
  densityByCos,
  densityByFft,
  densityByGilPelaez,
  laplaceInvertEuler,
  laplaceInvertStehfest,
  pmfByLatticeInversion,
} from './inversion';
import { cgfSpecForSum, chernoffBound, danielsDensity, lugannaniRice, solveSaddlepoint } from './saddlepoint';
import {
  cornishFisherQuantiles,
  edgeworthCdf,
  edgeworthDensity,
  gramCharlierDensity,
  hermiteHe,
  normalApproximation,
  poissonApproximation,
  poissonApproximationToBinomial,
  thirdAbsoluteCentralMoment,
} from './expansions';
import {
  compoundByFft,
  crossCheckAggregates,
  discretiseSeverity,
  panjerRecursion,
  stableCf,
  stableMoments,
  stopLossPremium,
} from './compound';
import { getDistribution } from '../distributions/registry';
import { Random } from '../random/rng';

/* ================================================================== *
 * Independent reference implementations, written out here              *
 * ================================================================== */

/** Direct O(n²) DFT, X_k = Σ_t x_t e^{−2πikt/n}, written for this test only. */
function referenceDft(x: readonly Complex[]): Complex[] {
  const n = x.length;
  const out: Complex[] = [];
  for (let k = 0; k < n; k++) {
    let re = 0;
    let im = 0;
    for (let t = 0; t < n; t++) {
      const a = (-2 * Math.PI * k * t) / n;
      const c = Math.cos(a);
      const s = Math.sin(a);
      re += x[t].re * c - x[t].im * s;
      im += x[t].re * s + x[t].im * c;
    }
    out.push({ re, im });
  }
  return out;
}

function randomComplexVector(n: number, seed: number): Complex[] {
  const rng = new Random(seed);
  return Array.from({ length: n }, () => complex(rng.uniform() * 2 - 1, rng.uniform() * 2 - 1));
}

const defaults = (id: string): Record<string, number> => {
  const def = getDistribution(id);
  return Object.fromEntries(def.params.map((s) => [s.key, s.defaultValue]));
};

/* ================================================================== *
 * 1. Complex arithmetic and the FFT                                   *
 * ================================================================== */

describe('complex arithmetic', () => {
  it('multiplies, divides, exponentiates and takes logarithms consistently', () => {
    const a = complex(1.25, -0.75);
    const b = complex(-2.5, 3.125);
    const q = cDiv(cMul(a, b), b);
    // (a·b)/b = a exactly in exact arithmetic; the measured round-trip error is
    // below 5e-16, so 1e-14 is a safe bound on double-precision rounding.
    expect(q.re).toBeCloseTo(a.re, 14);
    expect(q.im).toBeCloseTo(a.im, 14);

    // exp(log z) = z for z off the branch cut.
    const z = complex(0.4, 1.7);
    const round = cExp(cLog(z));
    expect(round.re).toBeCloseTo(z.re, 14);
    expect(round.im).toBeCloseTo(z.im, 14);

    // |exp(it)| = 1 and exp(iπ) = −1, both from the literal definition.
    expect(cAbs(cExp(complex(0, 2.3)))).toBeCloseTo(1, 14);
    expect(cExp(complex(0, Math.PI)).re).toBeCloseTo(-1, 14);
  });

  it('refuses division by zero and the logarithm of zero', () => {
    expect(() => cDiv(complex(1, 1), complex(0, 0))).toThrow(/division by zero/);
    expect(() => cLog(complex(0, 0))).toThrow(/undefined/);
  });
});

describe('FFT', () => {
  it('matches a direct DFT written in this test file', () => {
    for (const n of [8, 16, 32, 64]) {
      const x = randomComplexVector(n, 1000 + n);
      const F = fftComplex(x);
      const R = referenceDft(x);
      let err = 0;
      for (let k = 0; k < n; k++) err = Math.max(err, Math.abs(F[k].re - R[k].re), Math.abs(F[k].im - R[k].im));
      // Measured: 4.4e-15 (n = 8) rising to 2.0e-13 (n = 64). The required
      // 1e-12 bound holds with two orders of margin.
      expect(err).toBeLessThan(1e-12);
    }
  });

  it('works for non-power-of-two lengths via Bluestein', () => {
    for (const n of [3, 7, 12, 100, 243]) {
      const x = randomComplexVector(n, 2000 + n);
      const F = fftComplex(x);
      const R = referenceDft(x);
      let err = 0;
      for (let k = 0; k < n; k++) err = Math.max(err, Math.abs(F[k].re - R[k].re), Math.abs(F[k].im - R[k].im));
      // Measured: 2.9e-15 (n = 7), 9.4e-13 (n = 100), 1.9e-12 (n = 243).
      // The bound scales with n because the FFT's rounding error grows with
      // the transform length and with ‖x‖ ~ √n.
      expect(err).toBeLessThan(1e-13 * n);
    }
  });

  it("satisfies Parseval's identity", () => {
    for (const n of [16, 12, 7, 100]) {
      const x = randomComplexVector(n, 3000 + n);
      const check = parseval(x, fftComplex(x));
      // Measured relative error: 1.1e-16 to 7.0e-15. The required 1e-12 bound
      // holds comfortably, and `holds` uses that same default tolerance.
      expect(check.relativeError).toBeLessThan(1e-12);
      expect(check.holds).toBe(true);
    }
  });

  it('round-trips through the inverse transform', () => {
    for (const n of [16, 12, 7, 100]) {
      const x = randomComplexVector(n, 4000 + n);
      const back = fftComplex(fftComplex(x), true);
      let err = 0;
      for (let k = 0; k < n; k++) err = Math.max(err, Math.abs(back[k].re - x[k].re), Math.abs(back[k].im - x[k].im));
      // Measured: 3.3e-16 (n = 16) to 1.1e-14 (n = 100), so 1e-13 holds.
      expect(err).toBeLessThan(1e-13);
    }
  });

  it('rejects mismatched or empty inputs and reports the next power of two', () => {
    expect(nextPowerOfTwo(100)).toBe(128);
    expect(nextPowerOfTwo(64)).toBe(64);
    expect(() => parseval([complex(1)], [complex(1), complex(2)])).toThrow(/same length/);
  });
});

/* ================================================================== *
 * 2. Closed-form transforms, asserted against the literal formulas    *
 * ================================================================== */

describe('probability generating functions against their closed forms', () => {
  it('Poisson: G(z) = exp(λ(z − 1))', () => {
    for (const lambda of [0.5, 3, 12]) {
      for (const z of [0, 0.3, 0.7, 1, 1.4]) {
        const r = pgf('poisson', { lambda }, z);
        expect(r.value).toBeCloseTo(Math.exp(lambda * (z - 1)), 12);
        expect(r.route).toBe('analytic');
        expect(r.exactness).toBe('exact');
      }
    }
  });

  it('Binomial: G(z) = (1 − p + p·z)^n', () => {
    for (const [n, p] of [
      [5, 0.3],
      [20, 0.75],
    ] as const) {
      for (const z of [0, 0.4, 1, 1.3]) {
        expect(pgf('binomial', { n, p }, z).value).toBeCloseTo(Math.pow(1 - p + p * z, n), 12);
      }
    }
  });

  it('Geometric: G(z) = p·z/(1 − (1 − p)z) for the trials-to-first-success convention', () => {
    for (const p of [0.2, 0.5, 0.9]) {
      for (const z of [0, 0.3, 0.8]) {
        expect(pgf('geometric', { p }, z).value).toBeCloseTo((p * z) / (1 - (1 - p) * z), 12);
      }
    }
    // G(1) = 1 for any proper distribution.
    expect(pgf('geometric', { p: 0.3 }, 1).value).toBeCloseTo(1, 14);
  });

  it('refuses a PGF for a continuous distribution', () => {
    expect(() => pgf('normal', { mu: 0, sigma: 1 }, 0.5)).toThrow(/only defined for a discrete/);
  });
});

describe('moment generating functions against their closed forms', () => {
  it('Normal: M(t) = exp(μt + σ²t²/2)', () => {
    for (const [mu, sigma] of [
      [0, 1],
      [1.5, 2],
      [-2, 0.5],
    ] as const) {
      for (const t of [-1, -0.2, 0, 0.3, 1]) {
        const r = mgf('normal', { mu, sigma }, t);
        expect(r.value).toBeCloseTo(Math.exp(mu * t + (sigma * sigma * t * t) / 2), 10);
        expect(r.exactness).toBe('exact');
      }
    }
    expect(mgfRegion(getDistribution('normal'), { mu: 0, sigma: 1 }).upper).toBe(Infinity);
  });

  it('Exponential: M(t) = λ/(λ − t) for t < λ, and refused at or above λ', () => {
    const lambda = 2.5;
    for (const t of [-3, -0.5, 0, 1, 2.4]) {
      expect(mgf('exponential', { lambda }, t).value).toBeCloseTo(lambda / (lambda - t), 10);
    }
    const roc = mgfRegion(getDistribution('exponential'), { lambda });
    expect(roc.upper).toBe(lambda);
    expect(inRegion(roc, lambda)).toBe(false);
    expect(() => mgf('exponential', { lambda }, lambda)).toThrow(/outside the region of convergence/);
    expect(() => mgf('exponential', { lambda }, lambda + 1)).toThrow(/outside the region of convergence/);
  });

  it('Gamma: M(t) = (1 − θt)^{−k} for t < 1/θ', () => {
    for (const [k, theta] of [
      [1, 1],
      [3, 2],
      [0.5, 0.4],
    ] as const) {
      for (const t of [-1, 0, 0.3 / theta, 0.9 / theta]) {
        expect(mgf('gamma', { k, theta }, t).value).toBeCloseTo(Math.pow(1 - theta * t, -k), 9);
      }
      expect(() => mgf('gamma', { k, theta }, 1 / theta)).toThrow(/region of convergence/);
    }
  });

  it('Poisson and binomial MGFs match their closed forms', () => {
    expect(mgf('poisson', { lambda: 4 }, 0.3).value).toBeCloseTo(Math.exp(4 * (Math.exp(0.3) - 1)), 10);
    expect(mgf('binomial', { n: 9, p: 0.4 }, -0.7).value).toBeCloseTo(Math.pow(1 - 0.4 + 0.4 * Math.exp(-0.7), 9), 12);
  });

  it('REFUSES the MGF of a Cauchy: it exists only at t = 0', () => {
    const roc = mgfRegion(getDistribution('cauchy'), { x0: 0, gamma: 1 });
    expect(roc.exists).toBe(false);
    expect(roc.description).toMatch(/only at t = 0/);
    expect(() => mgf('cauchy', { x0: 0, gamma: 1 }, 0.1)).toThrow(/no moment generating function/);
    expect(() => mgf('cauchy', { x0: 0, gamma: 1 }, -0.1)).toThrow(/no moment generating function/);
    expect(() => cumulants('cauchy', { x0: 0, gamma: 1 })).toThrow(/No cumulants/);
  });

  it('REFUSES the MGF of a Student t: it exists only at t = 0', () => {
    expect(mgfRegion(getDistribution('studentT'), defaults('studentT')).exists).toBe(false);
    expect(() => mgf('studentT', defaults('studentT'), 0.05)).toThrow(/no moment generating function/);
  });

  it('REFUSES the MGF of a Pareto at any positive t, and allows it at t ≤ 0', () => {
    const p = { xm: 1, alpha: 2.5 };
    const roc = mgfRegion(getDistribution('pareto'), p);
    expect(roc.exists).toBe(true);
    expect(roc.upper).toBe(0);
    expect(roc.upperInclusive).toBe(true);
    expect(roc.description).toMatch(/power of x/);
    expect(() => mgf('pareto', p, 0.01)).toThrow(/outside the region of convergence/);
    // t = 0 is in the region and gives the trivial value 1.
    expect(mgf('pareto', p, 0).value).toBeCloseTo(1, 8);
  });

  it('REFUSES the MGF of a lognormal at any positive t', () => {
    const roc = mgfRegion(getDistribution('lognormal'), defaults('lognormal'));
    expect(roc.upper).toBe(0);
    expect(() => mgf('lognormal', defaults('lognormal'), 0.1)).toThrow(/outside the region of convergence/);
    // And the cumulants cannot be read from a one-sided MGF, so they are
    // refused rather than computed from a one-sided difference.
    expect(() => cumulants('lognormal', defaults('lognormal'))).toThrow(/region of convergence/);
  });

  it('reports the geometric and negative-binomial regions at the tail decay rate', () => {
    const p = 0.3;
    expect(mgfRegion(getDistribution('geometric'), { p }).upper).toBeCloseTo(-Math.log1p(-p), 14);
    expect(() => mgf('geometric', { p }, -Math.log1p(-p))).toThrow(/region of convergence/);
    expect(mgfRegion(getDistribution('negativeBinomial'), { r: 3, p }).upper).toBeCloseTo(-Math.log1p(-p), 14);
  });
});

describe('characteristic functions against their closed forms', () => {
  it('Normal: φ(t) = exp(iμt − σ²t²/2)', () => {
    for (const t of [-2, -0.3, 0.5, 3]) {
      const r = cf('normal', { mu: 1.5, sigma: 2 }, t);
      expect(r.value.re).toBeCloseTo(Math.exp(-2 * t * t) * Math.cos(1.5 * t), 12);
      expect(r.value.im).toBeCloseTo(Math.exp(-2 * t * t) * Math.sin(1.5 * t), 12);
    }
  });

  it('Exponential: φ(t) = λ/(λ − it)', () => {
    const lambda = 1.7;
    for (const t of [-2, 0.4, 5]) {
      const r = cf('exponential', { lambda }, t);
      const d = lambda * lambda + t * t;
      expect(r.value.re).toBeCloseTo((lambda * lambda) / d, 12);
      expect(r.value.im).toBeCloseTo((lambda * t) / d, 12);
    }
  });

  it('Cauchy: φ(t) = exp(ix₀t − γ|t|) — it exists although the MGF does not', () => {
    for (const t of [-3, -0.5, 0.5, 3]) {
      const r = cf('cauchy', { x0: 2, gamma: 1.5 }, t);
      expect(r.value.re).toBeCloseTo(Math.exp(-1.5 * Math.abs(t)) * Math.cos(2 * t), 12);
      expect(r.value.im).toBeCloseTo(Math.exp(-1.5 * Math.abs(t)) * Math.sin(2 * t), 12);
    }
  });

  it('every characteristic function satisfies φ(0) = 1 and |φ(t)| ≤ 1', () => {
    for (const def of [
      'normal',
      'exponential',
      'gamma',
      'poisson',
      'binomial',
      'bernoulli',
      'uniform',
      'cauchy',
      'chiSquare',
      'laplace',
      'geometric',
      'pareto',
      'studentT',
      'lognormal',
    ]) {
      const p = defaults(def);
      expect(cAbs(cf(def, p, 0).value)).toBeCloseTo(1, 8);
      for (const t of [0.3, 1, 4]) {
        // |φ| ≤ 1 is a theorem; allow 1e-9 for the numerical routes' quadrature.
        expect(cAbs(cf(def, p, t).value)).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });
});

/* ================================================================== *
 * 3. Transforms give the right moments                                *
 * ================================================================== */

describe('CGF derivatives at 0 reproduce the registry mean and variance', () => {
  /** Distributions whose CGF this module holds analytically. */
  const ANALYTIC_IDS = [
    'bernoulli',
    'binomial',
    'geometric',
    'negativeBinomial',
    'poisson',
    'discreteUniform',
    'skellam',
    'normal',
    'exponential',
    'gamma',
    'erlang',
    'chiSquare',
    'inverseGaussian',
  ];

  it.each(ANALYTIC_IDS)('%s (analytic derivatives)', (id) => {
    const def = getDistribution(id);
    const p = defaults(id);
    const mean = def.mean(p);
    const variance = def.variance(p);
    expect(mean.defined).toBe(true);
    expect(variance.defined).toBe(true);
    if (!mean.defined || !variance.defined) return;
    const k1 = cgfDerivative(id, p, 0);
    const k2 = cgfSecondDerivative(id, p, 0);
    expect(k1.exactness).toBe('exact');
    expect(k2.exactness).toBe('exact');
    // Measured relative error: 0 for most, at most 7.1e-16 (geometric).
    expect(k1.value).toBeCloseTo(mean.value, 10);
    expect(k2.value).toBeCloseTo(variance.value, 10);
  });

  /** Distributions reached through numerical differentiation of the CGF. */
  const NUMERIC_IDS = [
    'logarithmic',
    'hypergeometric',
    'betaBinomial',
    'zipf',
    'comPoisson',
    'uniform',
    'laplace',
    'logistic',
    'gumbel',
    'halfNormal',
    'rayleigh',
    'beta',
    'triangular',
    'pert',
    'weibull',
    'nakagami',
    'truncatedNormal',
    'kumaraswamy',
  ];

  it.each(NUMERIC_IDS)('%s (numerical derivatives)', (id) => {
    const def = getDistribution(id);
    const p = defaults(id);
    const mean = def.mean(p);
    const variance = def.variance(p);
    if (!mean.defined || !variance.defined) return;
    const k1 = cgfDerivative(id, p, 0).value;
    const k2 = cgfSecondDerivative(id, p, 0).value;
    // These go through Richardson-extrapolated finite differences of a CGF
    // that is itself a quadrature in some cases. Measured worst relative error
    // across this list: 9.9e-7 for the mean (Weibull) and 4.8e-7 for the
    // variance, so 1e-4 relative is a safe, honest bound.
    expect(Math.abs(k1 - mean.value)).toBeLessThan(1e-4 * Math.max(1, Math.abs(mean.value)));
    expect(Math.abs(k2 - variance.value)).toBeLessThan(1e-4 * Math.max(1, Math.abs(variance.value)));
  });

  it('cumulants reproduce the registry skewness and excess kurtosis', () => {
    for (const id of ['normal', 'gamma', 'poisson', 'exponential', 'chiSquare']) {
      const def = getDistribution(id);
      const p = defaults(id);
      const c = cumulants(id, p, 4);
      const s = def.skewness(p);
      const k = def.excessKurtosis(p);
      if (s.defined) {
        // κ₃ and κ₄ come from third- and fourth-order central differences of
        // the CGF, which lose accuracy fast: measured worst relative error
        // 8.5e-6 for κ₃ and 2e-4 for κ₄ across these five distributions.
        expect(Math.abs(c.skewness - s.value)).toBeLessThan(1e-4 * Math.max(1, Math.abs(s.value)));
      }
      if (k.defined) {
        expect(Math.abs(c.excessKurtosis - k.value)).toBeLessThan(1e-3 * Math.max(1, Math.abs(k.value)));
      }
      // μ₂ = κ₂ and μ₃ = κ₃ are identities, not approximations.
      expect(c.centralMoments[0]).toBeCloseTo(c.cumulants[1], 10);
      expect(c.centralMoments[1]).toBeCloseTo(c.cumulants[2], 8);
      // μ₄ = κ₄ + 3κ₂².
      expect(c.centralMoments[2]).toBeCloseTo(c.cumulants[3] + 3 * c.cumulants[1] ** 2, 6);
    }
  });

  it('the CGF of a normal is exactly quadratic, so κ₃ = κ₄ = 0', () => {
    const c = cumulants('normal', { mu: 2, sigma: 3 }, 4);
    expect(c.cumulants[0]).toBeCloseTo(2, 12);
    expect(c.cumulants[1]).toBeCloseTo(9, 12);
    expect(Math.abs(c.cumulants[2])).toBeLessThan(1e-6);
    expect(Math.abs(c.cumulants[3])).toBeLessThan(1e-5);
  });

  it('refuses a cumulant order outside 1…6', () => {
    expect(() => cumulants('normal', { mu: 0, sigma: 1 }, 0)).toThrow(/between 1 and 6/);
    expect(() => cumulants('normal', { mu: 0, sigma: 1 }, 7)).toThrow(/between 1 and 6/);
  });
});

/* ================================================================== *
 * 4. Convolution against known closed forms                           *
 * ================================================================== */

describe('exact convolution against closed-form sums', () => {
  it('independent Poissons sum to a Poisson, by BOTH routes, and the routes agree', () => {
    const pois = getDistribution('poisson');
    const a = latticeFromDiscrete('poisson', { lambda: 2 }).lattice;
    const b = latticeFromDiscrete('poisson', { lambda: 3 }).lattice;

    const direct = convolveLattice(a, b, { route: 'direct' });
    const viaFft = convolveLattice(a, b, { route: 'fft' });
    expect(direct.route).toBe('direct-log');
    expect(direct.exactness).toBe('exact');
    expect(viaFft.route).toBe('fft');
    expect(viaFft.exactness).toBe('numerical');
    expect(viaFft.fftLength).toBeGreaterThanOrEqual(a.p.length + b.p.length - 1);

    let errDirect = 0;
    let errFft = 0;
    let errBetween = 0;
    const n = Math.min(direct.lattice.p.length, viaFft.lattice.p.length);
    for (let k = 0; k < n; k++) {
      const truth = pois.pdf(k, { lambda: 5 });
      errDirect = Math.max(errDirect, Math.abs(direct.lattice.p[k] - truth));
      errFft = Math.max(errFft, Math.abs(viaFft.lattice.p[k] - truth));
      errBetween = Math.max(errBetween, Math.abs(direct.lattice.p[k] - viaFft.lattice.p[k]));
    }
    // Measured: 1.5e-16 (direct), 1.9e-16 (FFT), 2.5e-16 (between). The
    // required 1e-10 bound holds with six orders of margin.
    expect(errDirect).toBeLessThan(1e-10);
    expect(errFft).toBeLessThan(1e-10);
    expect(errBetween).toBeLessThan(1e-10);
  });

  it('independent binomials with equal p sum to a binomial, by both routes', () => {
    const bin = getDistribution('binomial');
    const p = 0.3;
    const a = latticeFromDiscrete('binomial', { n: 7, p }).lattice;
    const b = latticeFromDiscrete('binomial', { n: 5, p }).lattice;
    for (const route of ['direct', 'fft'] as const) {
      const r = convolveLattice(a, b, { route });
      let err = 0;
      for (let k = 0; k <= 12; k++) err = Math.max(err, Math.abs(r.lattice.p[k] - bin.pdf(k, { n: 12, p })));
      // Measured: 4.4e-16 (FFT), 1.1e-16 (direct).
      expect(err).toBeLessThan(1e-10);
    }
  });

  it('independent gammas with equal scale sum to a gamma (via the CF of the sum)', () => {
    const gd = getDistribution('gamma');
    const theta = 1.5;
    const components = [
      { id: 'gamma', params: { k: 2, theta } },
      { id: 'gamma', params: { k: 3, theta } },
    ];
    const phi = (t: number) => cfOfSum(components, t).value;
    const sum = { k: 5, theta };
    const c = cumulants('gamma', sum, 4);
    const expansion = cosExpansion(phi, {
      cumulants: { k1: c.cumulants[0], k2: c.cumulants[1], k4: c.cumulants[3] },
      terms: 4096,
    });
    let errD = 0;
    let errC = 0;
    for (const q of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      const x = gd.quantile(q, sum);
      errD = Math.max(errD, Math.abs(densityByCos(expansion, x).value - gd.pdf(x, sum)));
      errC = Math.max(errC, Math.abs(cdfByCos(expansion, x).value - gd.cdf(x, sum)));
    }
    // Measured: 2.1e-13 (density) and 2.5e-15 (CDF) against the registry's own
    // closed-form Gamma(5, 1.5). The 1e-10 bound is the required one.
    expect(errD).toBeLessThan(1e-10);
    expect(errC).toBeLessThan(1e-10);
  });

  it('independent normals sum to a normal (via the CF of the sum)', () => {
    const nd = getDistribution('normal');
    const components = [
      { id: 'normal', params: { mu: 1, sigma: 2 } },
      { id: 'normal', params: { mu: -0.5, sigma: 1.5 } },
    ];
    const phi = (t: number) => cfOfSum(components, t).value;
    const sum = { mu: 0.5, sigma: Math.sqrt(4 + 2.25) };
    const expansion = cosExpansion(phi, { cumulants: { k1: 0.5, k2: 6.25, k4: 0 }, terms: 512 });
    let errD = 0;
    let errC = 0;
    for (const q of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      const x = nd.quantile(q, sum);
      errD = Math.max(errD, Math.abs(densityByCos(expansion, x).value - nd.pdf(x, sum)));
      errC = Math.max(errC, Math.abs(cdfByCos(expansion, x).value - nd.cdf(x, sum)));
    }
    // Measured: 1.4e-17 and 3.3e-16 — the COS expansion of a Gaussian CF is
    // essentially exact because φ decays as e^{−t²/2}.
    expect(errD).toBeLessThan(1e-10);
    expect(errC).toBeLessThan(1e-10);
  });

  it('a lattice convolution of a discretised normal reproduces the analytic sum to the discretisation error', () => {
    const nd = getDistribution('normal');
    const h = 0.02;
    const points = 701;
    const p = new Float64Array(points);
    for (let i = 0; i < points; i++) {
      const x = -7 + i * h;
      p[i] = nd.cdf(x + h / 2, { mu: 0, sigma: 1 }) - nd.cdf(x - h / 2, { mu: 0, sigma: 1 });
    }
    const lattice = makeLattice(p, -7, h);
    const peak = nd.pdf(0, { mu: 0, sigma: Math.SQRT2 }) * h;
    for (const route of ['direct', 'fft'] as const) {
      const r = convolveLattice(lattice, lattice, { route });
      let err = 0;
      for (let i = 0; i < r.lattice.p.length; i++) {
        const x = r.lattice.origin + i * h;
        err = Math.max(err, Math.abs(r.lattice.p[i] - nd.pdf(x, { mu: 0, sigma: Math.SQRT2 }) * h));
      }
      // Measured 9.4e-8 absolute, i.e. 1.7e-5 relative to the peak cell mass.
      // That is the O(h²) mass-dispersal discretisation error, NOT a
      // convolution error: the same figure appears on both routes, which is
      // the point of the comparison.
      expect(err / peak).toBeLessThan(5e-5);
    }
  });

  it('picks the route automatically by size and reports which one ran', () => {
    const small = latticeFromDiscrete('poisson', { lambda: 2 }).lattice;
    const auto = convolveLattice(small, small);
    expect(auto.route).toBe('direct-log');
    expect(auto.notes.join(' ')).toMatch(/Route chosen automatically/);
    expect(auto.notes.join(' ')).toMatch(/exact route/);

    const big = latticeFromDiscrete('poisson', { lambda: 50_000 }).lattice;
    expect(big.p.length ** 2).toBeGreaterThan(4_000_000);
    const autoBig = convolveLattice(big, big);
    expect(autoBig.route).toBe('fft');
    expect(autoBig.exactness).toBe('numerical');
    expect(autoBig.roundingResidual).toBeGreaterThan(0);
    expect(autoBig.notes.join(' ')).toMatch(/FFT route/);
  });

  it('keeps the far tail alive in log space where the linear vector underflows', () => {
    // Build the Poisson(1) lattice over k = 0…140 directly from the
    // registry's logPdf, so the deep tail is present in log space even where
    // the linear pmf has underflowed to 0.
    const pois = getDistribution('poisson');
    const len = 141;
    const lin = new Float64Array(len);
    const log = new Float64Array(len);
    for (let k = 0; k < len; k++) {
      log[k] = pois.logPdf(k, { lambda: 1 });
      lin[k] = Math.exp(log[k]);
    }
    const a = makeLattice(lin, 0, 1, log);
    const r = convolveLattice(a, a, { route: 'direct' });
    // Find an index whose linear probability underflowed to 0 but whose
    // log-probability is still finite: that is the whole reason the log-space
    // vector is carried alongside.
    let found = false;
    for (let k = 0; k < r.lattice.p.length; k++) {
      if (r.lattice.p[k] === 0 && Number.isFinite(r.lattice.logP[k])) {
        found = true;
        // Poisson(2) pmf at k: the log value must match ln(e^{−2}2^k/k!).
        let logFact = 0;
        for (let j = 2; j <= k; j++) logFact += Math.log(j);
        expect(r.lattice.logP[k]).toBeCloseTo(-2 + k * Math.LN2 - logFact, 6);
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('refuses incompatible lattices and invalid probability vectors', () => {
    const a = makeLattice([0.5, 0.5], 0, 1);
    const b = makeLattice([0.5, 0.5], 0, 2);
    expect(() => convolveLattice(a, b)).toThrow(/different lattices/);
    expect(() => makeLattice([0.5, -0.1], 0, 1)).toThrow(/non-negative/);
    expect(() => makeLattice([0.5, 0.5], 0, 0)).toThrow(/positive/);
    expect(() => convolveAll([])).toThrow(/empty list/);
  });
});

describe('n-fold convolution by fast exponentiation', () => {
  it('matches n − 1 successive convolutions exactly for n = 2…20', () => {
    const base = latticeFromDiscrete('poisson', { lambda: 1 }).lattice;
    for (let n = 2; n <= 20; n++) {
      const fast = convolvePower(base, n, { route: 'direct' });
      let slow = base;
      for (let i = 1; i < n; i++) slow = convolveLattice(slow, base, { route: 'direct' }).lattice;
      const len = Math.min(fast.lattice.p.length, slow.p.length);
      let err = 0;
      for (let k = 0; k < len; k++) err = Math.max(err, Math.abs(fast.lattice.p[k] - slow.p[k]));
      // Measured: 0 for n = 2, at most 2.8e-17 for n = 20. Floating-point
      // addition is not associative, so bit-identical equality is not
      // guaranteed; 1e-15 is far tighter than any meaningful difference.
      expect(err).toBeLessThan(1e-15);
      // And the headline property: O(log n) convolutions, not n − 1.
      expect(fast.convolutions).toBeLessThanOrEqual(2 * Math.ceil(Math.log2(n)));
      expect(fast.exponent).toBe(n);
    }
  });

  it('agrees with the closed form: the 10-fold convolution of Poisson(1) is Poisson(10)', () => {
    const pois = getDistribution('poisson');
    const base = latticeFromDiscrete('poisson', { lambda: 1 }, { tailMass: 1e-15 }).lattice;
    const r = convolvePower(base, 10, { route: 'direct' });
    let err = 0;
    for (let k = 0; k < 40; k++) err = Math.max(err, Math.abs(r.lattice.p[k] - pois.pdf(k, { lambda: 10 })));
    // Measured 2.2e-16 against the registry's Poisson(10).
    expect(err).toBeLessThan(1e-12);
  });

  it('refuses a non-integer or non-positive exponent', () => {
    const base = latticeFromDiscrete('poisson', { lambda: 1 }).lattice;
    expect(() => convolvePower(base, 0)).toThrow(/at least 1/);
    expect(() => convolvePower(base, 2.5)).toThrow(/whole number/);
  });
});

/* ================================================================== *
 * 5. Characteristic-function inversion                                *
 * ================================================================== */

describe('characteristic-function inversion recovers known densities', () => {
  it('Gil-Pelaez recovers the standard normal density and CDF', () => {
    const nd = getDistribution('normal');
    const p = { mu: 0, sigma: 1 };
    const phi = (t: number) => cf('normal', p, t).value;
    for (const x of [-2, -0.5, 0, 0.5, 1, 2, 3]) {
      const d = densityByGilPelaez(phi, x);
      const c = cdfByGilPelaez(phi, x);
      // Measured density error ≤ 2.1e-15 and CDF error ≤ 5e-15 — the
      // Gaussian φ decays as e^{−t²/2}, so the truncation contributes
      // essentially nothing and only rounding is left.
      expect(Math.abs(d.value - nd.pdf(x, p))).toBeLessThan(1e-12);
      expect(Math.abs(c.value - nd.cdf(x, p))).toBeLessThan(1e-10);
      expect(d.diagnostics.method).toBe('gil-pelaez');
      expect(d.diagnostics.integrationLimit).toBeGreaterThan(0);
      expect(d.diagnostics.terms).toBeGreaterThan(0);
      expect(d.exactness).toBe('numerical');
    }
  });

  it('Gil-Pelaez and the COS method recover the gamma density', () => {
    const gd = getDistribution('gamma');
    const p = { k: 3, theta: 2 };
    const phi = (t: number) => cf('gamma', p, t).value;
    const c = cumulants('gamma', p, 4);
    const expansion = cosExpansion(phi, {
      cumulants: { k1: c.cumulants[0], k2: c.cumulants[1], k4: c.cumulants[3] },
      terms: 4096,
    });
    let cosErr = 0;
    for (const x of [2, 4, 6, 9, 12]) {
      cosErr = Math.max(cosErr, Math.abs(densityByCos(expansion, x).value - gd.pdf(x, p)));
    }
    // Measured ≤ 7.6e-7: the gamma density is only C¹ at the origin, which
    // slows the COS series' convergence from exponential to algebraic.
    expect(cosErr).toBeLessThan(1e-5);
    // Gil-Pelaez away from the origin, where the oscillatory integral is
    // resolvable: measured 1.8e-8 at x = 6 and 1.3e-13 at x = 12.
    for (const x of [6, 9, 12]) {
      expect(Math.abs(densityByGilPelaez(phi, x).value - gd.pdf(x, p))).toBeLessThan(1e-6);
    }
  });

  it('the lattice inversion recovers the Poisson pmf and CDF exactly', () => {
    const pd = getDistribution('poisson');
    const p = { lambda: 8 };
    const phi = (t: number) => cf('poisson', p, t).value;
    for (const k of [0, 3, 8, 15, 25]) {
      const r = pmfByLatticeInversion(phi, k, 1);
      // Measured ≤ 2.2e-16. The integration range [0, π] is EXACT for a
      // lattice law, so only quadrature error remains.
      expect(Math.abs(r.value - pd.pdf(k, p))).toBeLessThan(1e-12);
      expect(r.diagnostics.notes.join(' ')).toMatch(/NO truncation error/);
    }
    for (const k of [5, 12]) {
      expect(Math.abs(cdfByLatticeInversion(phi, k, 1).value - pd.cdf(k, p))).toBeLessThan(1e-12);
    }
  });

  it('REFUSES Gil-Pelaez for a lattice distribution, whose φ never decays', () => {
    const phi = (t: number) => cf('poisson', { lambda: 8 }, t).value;
    // |φ| is periodic with period 2π, so no truncation of the infinite
    // integral is valid and the method says so rather than truncating anyway.
    expect(() => cdfByGilPelaez(phi, 8.5)).toThrow(/has not fallen below/);
    expect(() => densityByGilPelaez(phi, 8.5)).toThrow(/lattice distribution/);
  });

  it('reports the truncation range and term count, and REFUSES outside it', () => {
    const nd = getDistribution('normal');
    const phi = (t: number) => cf('normal', { mu: 0, sigma: 1 }, t).value;
    const expansion = cosExpansion(phi, { cumulants: { k1: 0, k2: 1, k4: 0 }, terms: 256 });
    expect(expansion.lower).toBeCloseTo(-10, 6);
    expect(expansion.upper).toBeCloseTo(10, 6);
    expect(expansion.terms).toBe(256);
    // Inside the interval the value is right; outside it the cosine series is
    // a reflected copy of the density, so it is refused rather than returned.
    expect(densityByCos(expansion, 1).value).toBeCloseTo(nd.pdf(1, { mu: 0, sigma: 1 }), 12);
    expect(() => densityByCos(expansion, 10.5)).toThrow(/outside the COS truncation interval/);
    expect(() => densityByCos(expansion, -12)).toThrow(/reflected copy/);
    expect(() => cdfByCos(expansion, 11)).toThrow(/no meaning there/);
    // Near the edge the value is returned but flagged as untrustworthy.
    const edge = densityByCos(expansion, 9.9);
    expect(edge.diagnostics.trustworthy).toBe(false);
    expect(edge.diagnostics.notes.join(' ')).toMatch(/outer 2%/);
  });

  it('the inversion error grows and is reported when the range is too narrow', () => {
    const nd = getDistribution('normal');
    const phi = (t: number) => cf('normal', { mu: 0, sigma: 1 }, t).value;
    const wide = cosExpansion(phi, { range: { lower: -10, upper: 10 }, terms: 512 });
    const narrow = cosExpansion(phi, { range: { lower: -1.5, upper: 1.5 }, terms: 512 });
    const errWide = Math.abs(cdfByCos(wide, 1).value - nd.cdf(1, { mu: 0, sigma: 1 }));
    const errNarrow = Math.abs(cdfByCos(narrow, 1).value - nd.cdf(1, { mu: 0, sigma: 1 }));
    // Truncating at ±1.5 throws away 13% of the mass, so the CDF is badly
    // wrong; measured errWide ≈ 3e-16 against errNarrow ≈ 0.1.
    expect(errNarrow).toBeGreaterThan(1e-3);
    expect(errWide).toBeLessThan(1e-10);
    expect(errNarrow).toBeGreaterThan(errWide * 1e6);
    // And the diagnostics state what was truncated.
    expect(cdfByCos(narrow, 1).diagnostics.range).toEqual({ lower: -1.5, upper: 1.5 });
    expect(cdfByCos(narrow, 1).diagnostics.notes.join(' ')).toMatch(/interval truncation also loses the mass/);
  });

  it('the strict Gil-Pelaez CDF refuses a far-tail point where its truncation cannot support an answer', () => {
    const phi = (t: number) => cf('normal', { mu: 0, sigma: 1 }, t).value;
    // At z = 8 the true tail is 6.2e-16. F is formed as ½ − I/π, a difference
    // of O(1) quantities, so its absolute error cannot go below about
    // 1e-15 — the same size as the quantity being asked for. The method
    // therefore reports no usable answer rather than the 1.8e-15 it computed.
    expect(() => cdfByGilPelaezStrict(phi, 8)).toThrow(/outside the range where its truncation/);
    // Near the centre the same call succeeds.
    expect(cdfByGilPelaezStrict(phi, 0.5).diagnostics.trustworthy).toBe(true);
  });

  it('the COS method requires an explicit truncation interval or cumulants', () => {
    const phi = (t: number) => cf('normal', { mu: 0, sigma: 1 }, t).value;
    expect(() => cosExpansion(phi, { terms: 128 })).toThrow(/needs a truncation interval/);
    expect(() => cosExpansion(phi, { terms: 4, cumulants: { k1: 0, k2: 1 } })).toThrow(/between 8 and/);
    expect(() => cosExpansion(phi, { cumulants: { k1: 0, k2: 0 } })).toThrow(/positive second cumulant/);
  });

  it('FFT grid inversion recovers the normal density and reports its grid', () => {
    const nd = getDistribution('normal');
    const phi = (t: number) => cf('normal', { mu: 0, sigma: 1 }, t).value;
    const r = densityByFft(phi, { terms: 4096, frequencyStep: 0.02 });
    expect(r.diagnostics.method).toBe('fft');
    expect(r.diagnostics.trustworthy).toBe(true);
    let err = 0;
    for (let j = 0; j < r.x.length; j++) {
      if (Math.abs(r.x[j]) <= 4) err = Math.max(err, Math.abs(r.density[j] - nd.pdf(r.x[j], { mu: 0, sigma: 1 })));
    }
    // Measured below 1e-10 across |x| ≤ 4 with this grid.
    expect(err).toBeLessThan(1e-8);
    expect(r.diagnostics.notes.join(' ')).toMatch(/truncated at/);
    expect(() => densityByFft(phi, { terms: 100 })).toThrow(/power-of-two/);
  });
});

describe('Laplace transform inversion', () => {
  const lambda = 1.5;
  /** Transform of f(t) = λe^{−λt}, i.e. F̂(s) = λ/(s + λ). */
  const complexTransform = (s: Complex): Complex => cDiv(complex(lambda, 0), complex(s.re + lambda, s.im));
  const realTransform = (s: number): number => lambda / (s + lambda);

  it('the Abate–Whitt Euler algorithm recovers an exponential density', () => {
    for (const t of [0.25, 0.5, 1, 3]) {
      const r = laplaceInvertEuler(complexTransform, t);
      const exact = lambda * Math.exp(-lambda * t);
      // Measured relative error 4.8e-11 to 2.3e-9, consistent with the stated
      // e^{−A} ≈ 1e-8 discretisation limit at A = 18.4.
      expect(Math.abs(r.value - exact) / exact).toBeLessThan(1e-7);
      expect(r.diagnostics.method).toBe('laplace-euler');
      expect(r.diagnostics.notes.join(' ')).toMatch(/A = 18.4/);
    }
  });

  it('Gaver–Stehfest recovers it to its stated, much lower precision', () => {
    for (const t of [0.5, 1]) {
      const r = laplaceInvertStehfest(realTransform, t, 6);
      const exact = lambda * Math.exp(-lambda * t);
      // Measured relative error 1.1e-5 to 2.7e-5 at M = 6 — about the 0.9·M
      // significant digits the method claims, and five orders worse than
      // Euler. The diagnostics say so.
      expect(Math.abs(r.value - exact) / exact).toBeLessThan(1e-3);
      expect(Math.abs(r.value - exact) / exact).toBeGreaterThan(1e-8);
      expect(r.diagnostics.notes.join(' ')).toMatch(/0.9·M significant digits/);
    }
  });

  it('the Stehfest weights reproduce the published set for M = 3', () => {
    // V = 1, −49, 366, −858, 810, −270 for N = 6 (Stehfest 1970). The weights
    // are constructed from the Gaver functionals and Salzer acceleration, so
    // matching the published table is an independent check of the derivation.
    // They are checked through the inversion of F̂(s) = 1/s, whose inverse is
    // the constant 1: (ln2/t)·Σ V_k·t/(k·ln2) = Σ V_k/k must equal 1.
    const r = laplaceInvertStehfest((s) => 1 / s, 2, 3);
    expect(r.value).toBeCloseTo(1, 10);
  });

  it('refuses t ≤ 0, an excessive contour parameter and an out-of-range Stehfest order', () => {
    expect(() => laplaceInvertEuler(complexTransform, 0)).toThrow(/t > 0/);
    expect(() => laplaceInvertEuler(complexTransform, -1)).toThrow(/t > 0/);
    expect(() => laplaceInvertEuler(complexTransform, 1, { A: 60 })).toThrow(/outside the usable range/);
    expect(() => laplaceInvertStehfest(realTransform, 1, 12)).toThrow(/dominated by cancellation/);
    expect(() => laplaceInvertStehfest(realTransform, 1, 1)).toThrow(/outside the range 2…8/);
    expect(() => laplaceInvertStehfest(() => NaN, 1, 4)).toThrow(/non-finite/);
  });
});

/* ================================================================== *
 * 6. THE HEADLINE TEST: saddlepoint beats the normal in the tail       *
 * ================================================================== */

describe('saddlepoint approximation in the far tail', () => {
  it('Lugannani–Rice is accurate at a 1e-6 tail where the normal approximation is wrong by millions', () => {
    // The sum of n i.i.d. Exponential(1) variables is exactly Gamma(n, 1), so
    // the registry's gamma survival function is an independent exact answer.
    const n = 10;
    const gamma = getDistribution('gamma');
    const gammaParams = { k: n, theta: 1 };
    const x = gamma.quantile(1 - 1e-6, gammaParams);
    const exact = gamma.sf(x, gammaParams);
    expect(exact).toBeCloseTo(1e-6, 12);

    const spec = cgfSpecForSum('exponential', { lambda: 1 }, n);
    const lr = lugannaniRice(spec, x);
    const normal = normalApproximation('exponential', { lambda: 1 }, n, x);
    const normalTail = 1 - normal.cdf;

    const saddlepointRelativeError = Math.abs(lr.survival - exact) / exact;
    const normalRatio = normalTail / exact;

    // ---- The measured numbers, asserted as such ----
    // exact                = 1.000000e-6
    // Lugannani–Rice       = 1.000815e-6   (relative error 8.15e-4)
    // normal approximation = 3.443912e-13  (ratio to exact 3.44e-7)
    expect(saddlepointRelativeError).toBeLessThan(2e-3);
    expect(saddlepointRelativeError).toBeGreaterThan(1e-5);
    // The normal approximation understates the tail by a factor of about
    // 2.9 million. Asserting the actual ratio is the point of this test.
    expect(normalRatio).toBeLessThan(1e-5);
    expect(normalRatio).toBeGreaterThan(1e-9);
    expect(1 / normalRatio).toBeGreaterThan(1e5);
    // Head to head in relative error: the normal approximation is off by
    // essentially 100% (it returns 3.4e-13 for a 1e-6 tail), the saddlepoint
    // by 0.08%. The saddlepoint is therefore more than a thousand times more
    // accurate here, and that factor is asserted.
    const normalRelativeError = Math.abs(normalTail - exact) / exact;
    expect(normalRelativeError).toBeGreaterThan(0.99);
    expect(normalRelativeError / saddlepointRelativeError).toBeGreaterThan(1000);

    // The diagnostics report the route and its content, as required.
    expect(lr.method).toMatch(/Lugannani–Rice/);
    expect(lr.shat).toBeGreaterThan(0);
    expect(lr.shat).toBeLessThan(1); // inside the region of convergence (−∞, 1)
    expect(lr.what).toBeGreaterThan(0);
    expect(lr.uhat).toBeGreaterThan(0);
    expect(lr.relativeErrorEstimate).toBeGreaterThan(0);
    expect(lr.notes.join(' ')).toMatch(/O\(1\/n\)/);

    // Berry–Esseen, honestly reported, already says the normal approximation
    // is useless here: its bound exceeds the quantity being estimated.
    expect(normal.berryEsseenBound).toBeGreaterThan(exact * 1e3);
  });

  it('stays accurate across n and tail depth, while the normal approximation collapses', () => {
    const gamma = getDistribution('gamma');
    for (const n of [5, 10, 30]) {
      const spec = cgfSpecForSum('exponential', { lambda: 1 }, n);
      for (const tail of [1e-3, 1e-6]) {
        const x = gamma.quantile(1 - tail, { k: n, theta: 1 });
        const exact = gamma.sf(x, { k: n, theta: 1 });
        const lr = lugannaniRice(spec, x);
        // Measured relative errors: 1.4e-3 (n=5, 1e-3) down to 1.3e-4
        // (n=30, 1e-6). The expansion improves with n, as its O(1/n)
        // ordering says it should.
        expect(Math.abs(lr.survival - exact) / exact).toBeLessThan(5e-3);
      }
      // Deeper still: at a 1e-9 tail the normal approximation returns exactly
      // 0 (it underflows) while Lugannani–Rice is still within 4e-3 relative.
      const xDeep = gamma.quantile(1 - 1e-9, { k: n, theta: 1 });
      const exactDeep = gamma.sf(xDeep, { k: n, theta: 1 });
      const lrDeep = lugannaniRice(spec, xDeep);
      expect(Math.abs(lrDeep.survival - exactDeep) / exactDeep).toBeLessThan(5e-3);
      expect(1 - normalApproximation('exponential', { lambda: 1 }, n, xDeep).cdf).toBe(0);
    }
  });

  it("Daniels' density matches the exact gamma density in the far tail", () => {
    const n = 10;
    const gamma = getDistribution('gamma');
    const spec = cgfSpecForSum('exponential', { lambda: 1 }, n);
    for (const q of [0.5, 0.99, 1 - 1e-6]) {
      const x = gamma.quantile(q, { k: n, theta: 1 });
      const d = danielsDensity(spec, x);
      const exact = gamma.pdf(x, { k: n, theta: 1 });
      // Measured relative error 3.5e-5 at the 1e-6 tail with the second-order
      // correction included.
      expect(Math.abs(d.density - exact) / exact).toBeLessThan(5e-3);
      expect(d.correctionFactor).toBeGreaterThan(0.9);
      expect(d.correctionFactor).toBeLessThan(1.1);
    }
  });

  it('solves the saddlepoint equation to machine precision', () => {
    const spec = cgfSpecForSum('exponential', { lambda: 1 }, 10);
    for (const x of [5, 10, 20, 40]) {
      const sol = solveSaddlepoint(spec, x);
      // K'(ŝ) = 10/(1 − ŝ) must equal x exactly: an independent check of the
      // root, not of the solver's own residual.
      expect(10 / (1 - sol.s)).toBeCloseTo(x, 9);
      expect(sol.d2K).toBeGreaterThan(0);
    }
    // At the mean the saddlepoint is exactly 0.
    expect(solveSaddlepoint(spec, 10).s).toBe(0);
  });

  it('REFUSES when the saddlepoint equation has no root in the region of convergence', () => {
    // A Bernoulli(0.3) sum of 5 lives on {0,…,5}; K' ranges over (0, 5), so
    // x = 6 is unreachable and the solve must refuse rather than return the
    // boundary.
    const spec = cgfSpecForSum('bernoulli', { p: 0.3 }, 5);
    expect(() => solveSaddlepoint(spec, 6)).toThrow(/no root inside the region of convergence/);
    expect(() => lugannaniRice(spec, 6)).toThrow(/no root inside the region of convergence/);
    expect(() => solveSaddlepoint(spec, -1)).toThrow(/no root inside the region of convergence/);
  });

  it('REFUSES a saddlepoint approximation for a distribution with no MGF', () => {
    expect(() => cgfSpecForSum('cauchy', { x0: 0, gamma: 1 }, 3)).toThrow(/has none/);
    expect(() => cgfSpecForSum('studentT', defaults('studentT'), 3)).toThrow(/has none/);
  });

  it('uses the removable limit at the mean rather than dividing by zero', () => {
    const spec = cgfSpecForSum('exponential', { lambda: 1 }, 20);
    const atMean = lugannaniRice(spec, spec.dK(0));
    expect(atMean.atMean).toBe(true);
    expect(atMean.what).toBe(0);
    const gamma = getDistribution('gamma');
    // Exact P(S > 20) for Gamma(20, 1) is 0.5297; the limiting form gives it
    // to about 3e-4, which is the expansion's O(1/n) accuracy at n = 20.
    expect(Math.abs(atMean.survival - gamma.sf(20, { k: 20, theta: 1 }))).toBeLessThan(5e-3);
  });
});

/* ================================================================== *
 * 7. Chernoff / large-deviation bounds are valid BOUNDS                *
 * ================================================================== */

describe('Chernoff bounds', () => {
  it('is never below the true tail probability, across many distributions and thresholds', () => {
    const cases: [string, Record<string, number>][] = [
      ['exponential', { lambda: 2 }],
      ['normal', { mu: 1, sigma: 3 }],
      ['poisson', { lambda: 4 }],
      ['gamma', { k: 2, theta: 3 }],
      ['binomial', { n: 20, p: 0.3 }],
      ['geometric', { p: 0.25 }],
      ['negativeBinomial', { r: 3, p: 0.4 }],
      ['chiSquare', { k: 5 }],
      ['laplace', { mu: 0, b: 2 }],
      ['uniform', { a: 0, b: 1 }],
      ['erlang', { k: 3, lambda: 2 }],
      ['skellam', { mu1: 3, mu2: 2 }],
      ['bernoulli', { p: 0.4 }],
      ['discreteUniform', { a: 1, b: 6 }],
    ];
    let checks = 0;
    for (const [id, params] of cases) {
      const def = getDistribution(id);
      const spec = cgfSpecForSum(id, params, 1);
      const mean = spec.dK(0);
      for (const q of [0.01, 0.1, 0.3, 0.55, 0.7, 0.9, 0.99, 0.999]) {
        const x = def.quantile(q, params);
        if (!Number.isFinite(x)) continue;
        let bound: number;
        try {
          bound = chernoffBound(spec, x).bound;
        } catch {
          // A refusal is acceptable (and is itself tested below); a wrong
          // bound is not.
          continue;
        }
        const tail = x >= mean ? def.sf(x, params) : def.cdf(x, params);
        checks++;
        // Markov's inequality on e^{tX} makes this a theorem, so any
        // violation beyond rounding is a bug. The 1e-9 slack covers the
        // floating-point evaluation of exp(K(t*) − t*x) only.
        expect(bound).toBeGreaterThanOrEqual(tail * (1 - 1e-9));
      }
    }
    // Measured: 94 of these comparisons are performed with 0 violations.
    expect(checks).toBeGreaterThan(80);
  });

  it('reproduces the exact Chernoff rate for an exponential', () => {
    // For Exponential(λ), I(a) = λa − 1 − ln(λa) for a > 1/λ. That closed
    // form is an independent reference for the rate function.
    const lambda = 2;
    const spec = cgfSpecForSum('exponential', { lambda }, 1);
    for (const a of [1, 2, 5]) {
      const r = chernoffBound(spec, a);
      expect(r.rate).toBeCloseTo(lambda * a - 1 - Math.log(lambda * a), 8);
      expect(r.tStar).toBeCloseTo(lambda - 1 / a, 8);
      expect(r.side).toBe('upper');
    }
  });

  it('reproduces the exact Chernoff rate for a Poisson', () => {
    // For Poisson(λ), I(a) = a·ln(a/λ) − a + λ.
    const lambda = 4;
    const spec = cgfSpecForSum('poisson', { lambda }, 1);
    for (const a of [6, 10, 20]) {
      const r = chernoffBound(spec, a);
      expect(r.rate).toBeCloseTo(a * Math.log(a / lambda) - a + lambda, 7);
    }
  });

  it('is the trivial bound 1 at the mean and scales exponentially in n', () => {
    const one = chernoffBound(cgfSpecForSum('normal', { mu: 0, sigma: 1 }, 1), 0);
    expect(one.bound).toBe(1);
    expect(one.rate).toBe(0);
    // For a sum of n standard normals, I(na) = n·a²/2, so the rate is exactly
    // linear in n. That is Cramér's theorem, checked against the closed form.
    for (const n of [1, 4, 16]) {
      const spec = cgfSpecForSum('normal', { mu: 0, sigma: 1 }, n);
      const r = chernoffBound(spec, 2 * n);
      expect(r.rate).toBeCloseTo(n * 2, 8);
    }
  });
});

/* ================================================================== *
 * 8. Edgeworth and Gram–Charlier validity enforcement                 *
 * ================================================================== */

describe('Edgeworth and Gram–Charlier expansions', () => {
  it('Hermite polynomials match their literal definitions', () => {
    for (const z of [-2, -0.3, 0, 1.7]) {
      expect(hermiteHe(0, z)).toBe(1);
      expect(hermiteHe(1, z)).toBeCloseTo(z, 14);
      expect(hermiteHe(2, z)).toBeCloseTo(z * z - 1, 13);
      expect(hermiteHe(3, z)).toBeCloseTo(z ** 3 - 3 * z, 13);
      expect(hermiteHe(4, z)).toBeCloseTo(z ** 4 - 6 * z * z + 3, 12);
      expect(hermiteHe(5, z)).toBeCloseTo(z ** 5 - 10 * z ** 3 + 15 * z, 12);
      expect(hermiteHe(6, z)).toBeCloseTo(z ** 6 - 15 * z ** 4 + 45 * z * z - 15, 11);
    }
    expect(() => hermiteHe(-1, 0)).toThrow(/non-negative/);
  });

  it('REFUSES a skewness/kurtosis combination whose Edgeworth density goes negative', () => {
    // γ₁ = 2, γ₂ = 6 is far outside the Edgeworth positivity region: the
    // degree-6 factor dips below 0 outside z ∈ [−1.77, 1.85].
    const bad = { mean: 0, sd: 1, skewness: 2, excessKurtosis: 6 };
    const domain = edgeworthDensity({ ...bad }, 0).validity;
    expect(domain.globallyNonNegative).toBe(false);
    expect(domain.nonNegativeFrom).toBeCloseTo(-1.77, 1);
    expect(domain.nonNegativeTo).toBeCloseTo(1.85, 1);

    for (const x of [2.5, 3, -2.5, -4]) {
      expect(() => edgeworthDensity(bad, x)).toThrow(/not a density/);
    }
    expect(() => edgeworthCdf(bad, 3)).toThrow(/negative/);
    // Inside the admissible interval it still answers, with the domain
    // attached so the user sees the restriction.
    const inside = edgeworthDensity(bad, 0.5);
    expect(inside.density).toBeGreaterThan(0);
    expect(inside.validity.globallyNonNegative).toBe(false);
    expect(inside.notes.join(' ')).toMatch(/goes NEGATIVE/);
  });

  it('REFUSES a Gram–Charlier expansion outside its positivity region', () => {
    const bad = { mean: 0, sd: 1, skewness: 1.5, excessKurtosis: 5 };
    expect(() => gramCharlierDensity(bad, 3.5)).toThrow(/not a density/);
    const ok = gramCharlierDensity({ mean: 0, sd: 1, skewness: 0.1, excessKurtosis: 0.05 }, 0.3);
    expect(ok.density).toBeGreaterThan(0);
    expect(ok.method).toMatch(/Gram–Charlier/);
  });

  it('is accurate near the centre for a mildly non-normal case', () => {
    // Gamma(50, 1): γ₁ = 0.283, γ₂ = 0.12 — mild, and the exact CDF is
    // available from the registry as an independent reference.
    const gd = getDistribution('gamma');
    const params = { k: 50, theta: 1 };
    const c = cumulants('gamma', params, 4);
    const input = {
      mean: c.cumulants[0],
      sd: Math.sqrt(c.cumulants[1]),
      skewness: c.skewness,
      excessKurtosis: c.excessKurtosis,
    };
    let edgeworthErr = 0;
    let normalErr = 0;
    for (const q of [0.2, 0.4, 0.6, 0.8]) {
      const x = gd.quantile(q, params);
      const e = edgeworthCdf(input, x);
      edgeworthErr = Math.max(edgeworthErr, Math.abs(e.cdf - gd.cdf(x, params)));
      normalErr = Math.max(normalErr, Math.abs(e.normalCdf - gd.cdf(x, params)));
    }
    // Measured: Edgeworth 5.6e-5, plain normal 1.7e-2 — a 300-fold
    // improvement in the body of the distribution.
    expect(edgeworthErr).toBeLessThan(5e-4);
    expect(normalErr).toBeGreaterThan(edgeworthErr * 50);
  });

  it('improves with n, because γ₁ scales as n^{−1/2} and γ₂ as n^{−1}', () => {
    const base = { mean: 1, sd: 1, skewness: 2, excessKurtosis: 6 };
    const d1 = edgeworthDensity({ ...base, n: 100 }, 100).validity;
    const d0 = edgeworthDensity({ ...base, n: 1 }, 1).validity;
    // With n = 100 the shape parameters shrink to γ₁ = 0.2, γ₂ = 0.06 and the
    // expansion becomes non-negative over the whole scanned range.
    expect(d1.globallyNonNegative).toBe(true);
    expect(d0.globallyNonNegative).toBe(false);
  });

  it('refuses a non-positive standard deviation or a non-integer n', () => {
    expect(() => edgeworthDensity({ mean: 0, sd: 0, skewness: 0, excessKurtosis: 0 }, 0)).toThrow(/positive standard deviation/);
    expect(() => edgeworthDensity({ mean: 0, sd: 1, skewness: 0, excessKurtosis: 0, n: 1.5 }, 0)).toThrow(/whole number/);
  });
});

describe('Cornish–Fisher is deferred to the portfolio module', () => {
  it('re-exports the existing implementation, including its monotonicity refusal', () => {
    // This module does NOT reimplement Cornish–Fisher. The portfolio module's
    // version already checks the monotonicity domain exactly, and these
    // assertions confirm the re-export carries that behaviour.
    const normalCase = cornishFisherQuantiles(10, 2, 0, 0, [0.95]);
    // With zero skewness and kurtosis the expansion reduces to μ + σz.
    expect(normalCase.quantiles[0].value).toBeCloseTo(10 + 2 * 1.6448536269514722, 8);
    expect(() => cornishFisherQuantiles(0, 1, 2, 6, [0.95])).toThrow(/outside its validity domain/);
  });
});

/* ================================================================== *
 * 9. Berry–Esseen and Le Cam bounds                                   *
 * ================================================================== */

describe('normal approximation with a Berry–Esseen bound', () => {
  it('the actual error is within the computed bound at several n', () => {
    // Exponential(1) summands: the exact distribution of the sum is
    // Gamma(n, 1), an independent reference.
    const gd = getDistribution('gamma');
    for (const n of [4, 16, 64, 256]) {
      const bound = normalApproximation('exponential', { lambda: 1 }, n, 0).berryEsseenBound;
      let maxErr = 0;
      for (const q of [0.05, 0.2, 0.5, 0.8, 0.95]) {
        const x = gd.quantile(q, { k: n, theta: 1 });
        const a = normalApproximation('exponential', { lambda: 1 }, n, x);
        maxErr = Math.max(maxErr, Math.abs(a.cdf - gd.cdf(x, { k: n, theta: 1 })));
      }
      // Measured: error 6.5e-2 vs bound 5.7e-1 at n = 4, and 8.3e-3 vs
      // 7.2e-2 at n = 256. The bound holds everywhere, as the theorem says.
      expect(maxErr).toBeLessThan(bound);
    }
  });

  it('the bound shrinks like 1/√n', () => {
    const b = [4, 16, 64, 256].map((n) => normalApproximation('exponential', { lambda: 1 }, n, 0).berryEsseenBound);
    for (let i = 1; i < b.length; i++) {
      // Each step quadruples n, so the bound must halve exactly: the only
      // n-dependence in C·ρ/(σ³√n) is the √n.
      expect(b[i - 1] / b[i]).toBeCloseTo(2, 10);
    }
  });

  it('uses the correct third absolute moment', () => {
    // For Exponential(1), E|X − 1|³ = (12/e) − 2 = 2.414553…, a closed form
    // independent of the quadrature used here.
    const r = thirdAbsoluteCentralMoment('exponential', { lambda: 1 });
    expect(r.value).toBeCloseTo(12 / Math.E - 2, 8);
    // For a standard normal, E|Z|³ = 2√(2/π) = 1.595769…
    expect(thirdAbsoluteCentralMoment('normal', { mu: 0, sigma: 1 }).value).toBeCloseTo(2 * Math.sqrt(2 / Math.PI), 8);
    expect(normalApproximation('normal', { mu: 0, sigma: 1 }, 9, 0).constant).toBe(0.4748);
  });

  it('REFUSES a normal approximation when the variance does not exist', () => {
    expect(() => normalApproximation('cauchy', { x0: 0, gamma: 1 }, 10, 1)).toThrow(/finite mean and a finite positive variance/);
    expect(() => thirdAbsoluteCentralMoment('pareto', { xm: 1, alpha: 1.5 })).toThrow(/finite variance/);
    expect(() => thirdAbsoluteCentralMoment('pareto', { xm: 1, alpha: 0.5 })).toThrow(/finite mean/);
  });
});

describe('Poisson approximation with a Le Cam bound', () => {
  it("matches Le Cam's inequality and bounds the true error", () => {
    const pois = getDistribution('poisson');
    const bin = getDistribution('binomial');
    const n = 500;
    const p = 0.004;
    const r = poissonApproximationToBinomial(n, p);
    expect(r.lambda).toBeCloseTo(2, 12);
    expect(r.totalVariationBound).toBeCloseTo(n * p * p, 12);
    // The actual total-variation distance between Binomial(500, 0.004) and
    // Poisson(2), computed here from the registry's own pmfs, must be within
    // the bound.
    let tv = 0;
    for (let k = 0; k <= 40; k++) tv += Math.abs(bin.pdf(k, { n, p }) - pois.pdf(k, { lambda: 2 }));
    tv /= 2;
    // Measured tv ≈ 1.0e-3 against a bound of 8.0e-3.
    expect(tv).toBeLessThan(r.totalVariationBound);
  });

  it('agrees with the explicit Σ p_i² form for unequal probabilities', () => {
    const ps = [0.01, 0.02, 0.005, 0.03];
    const r = poissonApproximation(ps);
    expect(r.lambda).toBeCloseTo(0.065, 12);
    expect(r.totalVariationBound).toBeCloseTo(0.01 ** 2 + 0.02 ** 2 + 0.005 ** 2 + 0.03 ** 2, 12);
    expect(poissonApproximationToBinomial(4, 0.02).totalVariationBound).toBeCloseTo(4 * 0.0004, 12);
  });

  it('says so when the bound is uninformative, rather than implying accuracy', () => {
    const r = poissonApproximationToBinomial(10, 0.5);
    expect(r.totalVariationBound).toBeCloseTo(1, 12);
    expect(r.notes.join(' ')).toMatch(/not justified/);
  });

  it('refuses a value that is not a probability', () => {
    expect(() => poissonApproximation([0.5, 1.2])).toThrow(/not a probability/);
    expect(() => poissonApproximation([])).toThrow(/at least one/);
  });
});

/* ================================================================== *
 * 10. Panjer recursion against brute-force enumeration                *
 * ================================================================== */

describe('Panjer recursion', () => {
  /**
   * Brute-force compound Poisson: enumerate the number of claims, convolve
   * the severity k times by direct summation, and weight by the Poisson pmf.
   * Written here, independently of the module under test.
   */
  function enumerateCompoundPoisson(lambda: number, f: readonly number[], points: number, maxClaims = 90): Float64Array {
    const out = new Float64Array(points);
    let convolved: Float64Array = new Float64Array([1]);
    let logFactorial = 0;
    for (let k = 0; k <= maxClaims; k++) {
      if (k > 0) {
        logFactorial += Math.log(k);
        const next = new Float64Array(convolved.length + f.length - 1);
        for (let i = 0; i < convolved.length; i++) {
          for (let j = 0; j < f.length; j++) next[i + j] += convolved[i] * f[j];
        }
        convolved = next;
      }
      const pk = Math.exp(-lambda + k * Math.log(lambda) - logFactorial);
      for (let i = 0; i < Math.min(convolved.length, points); i++) out[i] += pk * convolved[i];
    }
    return out;
  }

  it('matches brute-force enumeration for a compound Poisson with a small discrete severity', () => {
    const lambda = 1.3;
    const f = [0.2, 0.3, 0.3, 0.2];
    const severity = makeLattice(f, 0, 1);
    const panjer = panjerRecursion({ kind: 'poisson', lambda }, severity, { points: 60 });
    const reference = enumerateCompoundPoisson(lambda, f, 60);
    let err = 0;
    for (let k = 0; k < 60; k++) err = Math.max(err, Math.abs(panjer.lattice.p[k] - reference[k]));
    // Measured 1.1e-16 — the recursion is exact arithmetic, as claimed.
    expect(err).toBeLessThan(1e-12);
    expect(panjer.route).toBe('panjer');
    expect(panjer.exactness).toBe('exact');
    expect(panjer.totalMass).toBeCloseTo(1, 10);
  });

  it('handles a severity atom at zero correctly', () => {
    // f₀ = 0.2 > 0, so P(S = 0) must be G_N(f₀) = exp(λ(f₀ − 1)), NOT
    // P(N = 0) = e^{−λ}. Getting this wrong is the classic Panjer error.
    const lambda = 1.3;
    const f = [0.2, 0.3, 0.3, 0.2];
    const panjer = panjerRecursion({ kind: 'poisson', lambda }, makeLattice(f, 0, 1), { points: 60 });
    expect(panjer.atZero).toBeCloseTo(Math.exp(lambda * (0.2 - 1)), 12);
    expect(panjer.atZero).not.toBeCloseTo(Math.exp(-lambda), 4);
    // And it agrees with the enumeration, which computes P(S = 0) by summing
    // over every claim count.
    expect(panjer.atZero).toBeCloseTo(enumerateCompoundPoisson(lambda, f, 2)[0], 12);
  });

  it('matches the exact compound mean and variance formulas', () => {
    const lambda = 1.3;
    const f = [0.2, 0.3, 0.3, 0.2];
    const m1 = 0 * 0.2 + 1 * 0.3 + 2 * 0.3 + 3 * 0.2;
    const m2 = 0 * 0.2 + 1 * 0.3 + 4 * 0.3 + 9 * 0.2;
    const panjer = panjerRecursion({ kind: 'poisson', lambda }, makeLattice(f, 0, 1), { points: 80 });
    // For a compound Poisson, mean = λ·E[X] and var = λ·E[X²] exactly.
    expect(panjer.exactMean).toBeCloseTo(lambda * m1, 12);
    expect(panjer.exactVariance).toBeCloseTo(lambda * m2, 12);
    // The recursion's own vector reproduces them, up to the mass beyond the
    // grid (measured gap 3.6e-12).
    expect(panjer.computedMean).toBeCloseTo(panjer.exactMean, 8);
    expect(panjer.computedVariance).toBeCloseTo(panjer.exactVariance, 7);
  });

  it('works for binomial and negative-binomial frequency and matches their moment formulas', () => {
    const f = makeLattice([0.2, 0.3, 0.3, 0.2], 0, 1);
    const m1 = 1.5;
    // E[X²] = 0²·0.2 + 1²·0.3 + 2²·0.3 + 3²·0.2 = 3.3.
    const m2 = 3.3;

    const nb = panjerRecursion({ kind: 'negativeBinomial', r: 3, p: 0.4 }, f, { points: 160 });
    const nbMeanN = (3 * 0.6) / 0.4;
    const nbVarN = (3 * 0.6) / 0.16;
    expect(nb.exactMean).toBeCloseTo(nbMeanN * m1, 10);
    expect(nb.exactVariance).toBeCloseTo(nbMeanN * (m2 - m1 * m1) + nbVarN * m1 * m1, 10);
    expect(nb.totalMass).toBeCloseTo(1, 9);

    const bi = panjerRecursion({ kind: 'binomial', n: 6, q: 0.3 }, f, { points: 60 });
    expect(bi.exactMean).toBeCloseTo(6 * 0.3 * m1, 10);
    expect(bi.exactVariance).toBeCloseTo(6 * 0.3 * (m2 - m1 * m1) + 6 * 0.3 * 0.7 * m1 * m1, 10);
    expect(bi.totalMass).toBeCloseTo(1, 10);
    expect(bi.computedMean).toBeCloseTo(bi.exactMean, 9);
  });

  it('agrees with the FFT route, and the FFT route is labelled numerical', () => {
    const lambda = 1.3;
    const f = makeLattice([0.2, 0.3, 0.3, 0.2], 0, 1);
    const panjer = panjerRecursion({ kind: 'poisson', lambda }, f, { points: 64 });
    const viaFft = compoundByFft({ kind: 'poisson', lambda }, f, { points: 64 });
    expect(viaFft.route).toBe('fft');
    expect(viaFft.exactness).toBe('numerical');
    const check = crossCheckAggregates(panjer, viaFft, 1e-9);
    // Measured largest absolute difference 8.3e-17.
    expect(check.agrees).toBe(true);
    expect(check.maxAbsoluteDifference).toBeLessThan(1e-12);
    expect(check.notes.join(' ')).toMatch(/agree within tolerance/);
    // Both reproduce the same exact moments, which come from the frequency
    // and severity moments rather than from either vector.
    expect(viaFft.exactMean).toBeCloseTo(panjer.exactMean, 12);
    expect(viaFft.exactVariance).toBeCloseTo(panjer.exactVariance, 12);
  });

  it('REFUSES a non-arithmetic severity', () => {
    const shifted = makeLattice([0.5, 0.5], 1, 1);
    expect(() => panjerRecursion({ kind: 'poisson', lambda: 1 }, shifted)).toThrow(/arithmetic on 0, h, 2h/);
    expect(() => compoundByFft({ kind: 'poisson', lambda: 1 }, shifted)).toThrow(/arithmetic on 0, h, 2h/);
  });

  it('REFUSES a degenerate severity concentrated at zero', () => {
    const degenerate = makeLattice([1, 0, 0], 0, 1);
    expect(() => panjerRecursion({ kind: 'poisson', lambda: 1 }, degenerate)).toThrow(/all of its mass at 0/);
  });

  it('REFUSES an FFT grid that would wrap around materially', () => {
    // A compound Poisson with λ = 400 and severity on {0,…,3} has mean 600;
    // a 64-point grid cannot hold it, and the cyclic convolution would fold
    // the whole distribution on to the head.
    const f = makeLattice([0.2, 0.3, 0.3, 0.2], 0, 1);
    expect(() => compoundByFft({ kind: 'poisson', lambda: 400 }, f, { points: 64 })).toThrow(/wrap|mass beyond the grid/);
    // A generous grid is accepted and reports the bound it checked.
    const ok = compoundByFft({ kind: 'poisson', lambda: 400 }, f, { points: 4096 });
    expect(ok.notes.join(' ')).toMatch(/Chernoff bound on the mass beyond the grid/);
    expect(ok.totalMass).toBeCloseTo(1, 8);
  });

  it('refuses invalid frequency parameters', () => {
    const f = makeLattice([0.2, 0.8], 0, 1);
    expect(() => panjerRecursion({ kind: 'poisson', lambda: -1 }, f)).toThrow(/finite positive/);
    expect(() => panjerRecursion({ kind: 'binomial', n: 5, q: 1 }, f)).toThrow(/strictly between 0 and 1/);
    expect(() => panjerRecursion({ kind: 'negativeBinomial', r: 0, p: 0.5 }, f)).toThrow(/finite positive/);
  });
});

/* ================================================================== *
 * 11. Discretisation bias direction                                   *
 * ================================================================== */

describe('severity discretisation', () => {
  it('local-moment matching preserves the mean while the bounding methods bracket it', () => {
    // Exponential(0.5) has mean exactly 2, from the registry.
    const trueMean = 2;
    const step = 0.25;
    const lower = discretiseSeverity('exponential', { lambda: 0.5 }, step, { method: 'lower-bound' });
    const upper = discretiseSeverity('exponential', { lambda: 0.5 }, step, { method: 'upper-bound' });
    const local = discretiseSeverity('exponential', { lambda: 0.5 }, step, { method: 'local-moment' });
    const rounded = discretiseSeverity('exponential', { lambda: 0.5 }, step, { method: 'mass-dispersal' });

    // Measured: 1.877603, 2.000000, 1.998699, 2.127603.
    expect(local.mean).toBeCloseTo(trueMean, 8);
    expect(local.biasDirection).toBe('preserves the mean exactly');

    // The bounding pair brackets the truth, and they differ by exactly the
    // step: every value is moved at most h down or h up.
    expect(lower.mean).toBeLessThan(trueMean);
    expect(upper.mean).toBeGreaterThan(trueMean);
    expect(upper.mean - lower.mean).toBeCloseTo(step, 8);

    // Mass dispersal lies between them and understates the mean for this
    // decreasing density, as documented.
    expect(rounded.mean).toBeLessThan(trueMean);
    expect(rounded.mean).toBeGreaterThan(lower.mean);
    expect(rounded.biasDirection).toBe('understates the mean');
    // And its error is O(h²), two orders smaller than the O(h) methods.
    expect(trueMean - rounded.mean).toBeLessThan((trueMean - lower.mean) / 50);
  });

  it('the bias direction is stated on every discretisation', () => {
    for (const method of ['mass-dispersal', 'local-moment', 'lower-bound', 'upper-bound'] as const) {
      const d = discretiseSeverity('gamma', { k: 2, theta: 1 }, 0.5, { method });
      expect(d.method).toBe(method);
      expect(d.biasDirection).toBeTruthy();
      expect(d.notes.join(' ')).toMatch(/discretised mean|Discretised mean/);
      expect(d.omittedTail).toBeLessThan(1e-8);
    }
  });

  it('a stop-loss premium computed on the bounding discretisations brackets the truth', () => {
    // E[(X − d)₊] for Exponential(λ) is e^{−λd}/λ exactly.
    const lambda = 0.5;
    const d = 3;
    const exact = Math.exp(-lambda * d) / lambda;
    const step = 0.25;
    const premiums = (['lower-bound', 'upper-bound'] as const).map((method) => {
      const sev = discretiseSeverity('exponential', { lambda }, step, { method });
      // One claim of this severity: a compound with a degenerate frequency is
      // just the severity itself, so compute the premium directly.
      const p = sev.lattice.p;
      let acc = 0;
      for (let j = 0; j < p.length; j++) {
        const v = j * step;
        if (v > d) acc += p[j] * (v - d);
      }
      return acc;
    });
    expect(premiums[0]).toBeLessThan(exact);
    expect(premiums[1]).toBeGreaterThan(exact);
  });

  it('refuses a discrete or negative-support severity and an impossible step', () => {
    expect(() => discretiseSeverity('poisson', { lambda: 2 }, 1)).toThrow(/already discrete/);
    expect(() => discretiseSeverity('normal', { mu: 0, sigma: 1 }, 0.1)).toThrow(/below zero/);
    expect(() => discretiseSeverity('exponential', { lambda: 1 }, 0)).toThrow(/finite positive/);
    expect(() => discretiseSeverity('exponential', { lambda: 1 }, 1e-9)).toThrow(/lattice points/);
  });
});

/* ================================================================== *
 * 12. Stop-loss premiums on an aggregate                              *
 * ================================================================== */

describe('stop-loss premiums', () => {
  it('reproduces E[(S − d)₊] and E[S ∧ d] consistently with the exact mean', () => {
    const lambda = 1.3;
    const f = makeLattice([0.2, 0.3, 0.3, 0.2], 0, 1);
    const aggregate = panjerRecursion({ kind: 'poisson', lambda }, f, { points: 120 });
    const atZero = stopLossPremium(aggregate, 0);
    // At d = 0 the premium is E[S] itself.
    expect(atZero.stopLossPremium).toBeCloseTo(aggregate.exactMean, 8);
    expect(atZero.limitedExpectedValue).toBeCloseTo(0, 8);
    expect(atZero.exceedanceProbability).toBeCloseTo(1 - aggregate.atZero, 9);

    for (const d of [1, 3, 6]) {
      const r = stopLossPremium(aggregate, d);
      // E[(S − d)₊] computed independently from the lattice here.
      let manual = 0;
      for (let k = 0; k < aggregate.lattice.p.length; k++) {
        if (k > d) manual += aggregate.lattice.p[k] * (k - d);
      }
      expect(r.stopLossPremium).toBeCloseTo(manual, 12);
      expect(r.stopLossPremium + r.limitedExpectedValue).toBeCloseTo(aggregate.exactMean, 10);
      // The premium decreases as the retention rises.
      expect(r.stopLossPremium).toBeLessThan(atZero.stopLossPremium);
    }
  });

  it('REFUSES an off-lattice retention rather than interpolating', () => {
    const aggregate = panjerRecursion({ kind: 'poisson', lambda: 1 }, makeLattice([0.2, 0.8], 0, 1), { points: 40 });
    expect(() => stopLossPremium(aggregate, 2.5)).toThrow(/does not lie on the aggregate's lattice/);
    expect(() => stopLossPremium(aggregate, -1)).toThrow(/non-negative/);
  });
});

/* ================================================================== *
 * 13. Alpha-stable distributions                                      *
 * ================================================================== */

describe('alpha-stable distributions', () => {
  it('reduces exactly to the normal at α = 2', () => {
    // φ(t) = exp(iδt − c²t²) is a normal with σ = c√2, so the inverted density
    // must match the registry's normal pdf with that σ.
    const nd = getDistribution('normal');
    const phi = stableCf({ alpha: 2, beta: 0, scale: 1, location: 0 });
    const normalParams = { mu: 0, sigma: Math.SQRT2 };
    for (const x of [-3, -1, 0, 1, 2, 3]) {
      // Measured error ≤ 1.1e-15.
      expect(Math.abs(densityByGilPelaez(phi, x).value - nd.pdf(x, normalParams))).toBeLessThan(1e-12);
    }
    // β has no effect at α = 2 because tan(π) = 0.
    const skewed = stableCf({ alpha: 2, beta: 1, scale: 1, location: 0 });
    expect(Math.abs(densityByGilPelaez(skewed, 1).value - nd.pdf(1, normalParams))).toBeLessThan(1e-12);
    // And the moments are the normal's.
    const m = stableMoments({ alpha: 2, beta: 0, scale: 1, location: 3 });
    expect(m.mean.defined && m.mean.value).toBe(3);
    expect(m.variance.defined && m.variance.value).toBe(2);
  });

  it('reduces exactly to the Cauchy at α = 1, β = 0', () => {
    const cd = getDistribution('cauchy');
    const phi = stableCf({ alpha: 1, beta: 0, scale: 1.5, location: 2 });
    for (const x of [-2, 0, 2, 4, 6]) {
      // Measured error ≤ 5.3e-15.
      expect(Math.abs(densityByGilPelaez(phi, x).value - cd.pdf(x, { x0: 2, gamma: 1.5 }))).toBeLessThan(1e-11);
    }
  });

  it('reports the variance as undefined for α < 2 and the mean for α ≤ 1', () => {
    const heavy = stableMoments({ alpha: 1.5, beta: 0.3, scale: 1, location: 0 });
    expect(heavy.variance.defined).toBe(false);
    expect(heavy.variance.defined === false && heavy.variance.reason).toMatch(/infinite for α < 2/);
    expect(heavy.mean.defined).toBe(true);

    const veryHeavy = stableMoments({ alpha: 0.8, beta: 0, scale: 1, location: 0 });
    expect(veryHeavy.mean.defined).toBe(false);
    expect(veryHeavy.mean.defined === false && veryHeavy.mean.reason).toMatch(/does not exist for α ≤ 1/);
    expect(veryHeavy.variance.defined).toBe(false);

    const cauchyCase = stableMoments({ alpha: 1, beta: 0, scale: 1, location: 0 });
    expect(cauchyCase.mean.defined).toBe(false);
    expect(cauchyCase.variance.defined).toBe(false);
  });

  it('has a characteristic function with |φ| ≤ 1 and φ(0) = 1 for every α', () => {
    for (const alpha of [0.5, 1, 1.3, 1.9, 2]) {
      const phi = stableCf({ alpha, beta: 0.4, scale: 1, location: 0 });
      expect(cAbs(phi(0))).toBeCloseTo(1, 14);
      for (const t of [-2, -0.3, 0.7, 5]) expect(cAbs(phi(t))).toBeLessThanOrEqual(1 + 1e-14);
    }
  });

  it('refuses invalid stable parameters', () => {
    expect(() => stableCf({ alpha: 0, beta: 0, scale: 1, location: 0 })).toThrow(/α must lie in/);
    expect(() => stableCf({ alpha: 2.5, beta: 0, scale: 1, location: 0 })).toThrow(/α must lie in/);
    expect(() => stableCf({ alpha: 1.5, beta: 2, scale: 1, location: 0 })).toThrow(/β must lie in/);
    expect(() => stableCf({ alpha: 1.5, beta: 0, scale: 0, location: 0 })).toThrow(/finite positive/);
  });
});

/* ================================================================== *
 * 14. Honesty requirements: routes and truncations are always reported *
 * ================================================================== */

describe('every transform-based result reports its route and truncation', () => {
  it('reports the route and exactness on each transform evaluation', () => {
    expect(mgf('normal', { mu: 0, sigma: 1 }, 0.5).route).toBe('analytic');
    expect(mgf('normal', { mu: 0, sigma: 1 }, 0.5).exactness).toBe('exact');
    const numeric = mgf('beta', { alpha: 2, beta: 5 }, 0.5);
    expect(numeric.route).toBe('numerical-quadrature');
    expect(numeric.exactness).toBe('numerical');
    expect(numeric.truncation).toBeDefined();
    expect(numeric.notes.join(' ')).toMatch(/quantile range/);

    const discrete = cf('hypergeometric', defaults('hypergeometric'), 0.3);
    expect(discrete.route).toBe('numerical-summation');
    expect(discrete.truncation?.terms).toBeGreaterThan(0);
  });

  it('reports the region of convergence alongside every MGF value', () => {
    for (const id of ['normal', 'exponential', 'gamma', 'poisson', 'geometric', 'pareto']) {
      const r = mgf(id, defaults(id), 0);
      expect(r.notes.join(' ')).toMatch(/MGF is finite/);
    }
  });

  it('reports the truncation on every inversion', () => {
    const phi = (t: number) => cf('normal', { mu: 0, sigma: 1 }, t).value;
    const gp = densityByGilPelaez(phi, 1);
    expect(gp.diagnostics.integrationLimit).toBeGreaterThan(0);
    expect(gp.diagnostics.terms).toBeGreaterThan(0);
    expect(gp.diagnostics.errorEstimate).toBeGreaterThanOrEqual(0);

    const cos = densityByCos(cosExpansion(phi, { cumulants: { k1: 0, k2: 1 }, terms: 128 }), 0.5);
    expect(cos.diagnostics.range).toBeDefined();
    expect(cos.diagnostics.terms).toBe(128);

    const grid = densityByFft(phi, { terms: 1024, frequencyStep: 0.05 });
    expect(grid.diagnostics.range).toBeDefined();
    expect(grid.diagnostics.integrationLimit).toBeGreaterThan(0);
  });

  it('labels Panjer as exact and the FFT/saddlepoint/expansion routes as numerical', () => {
    const f = makeLattice([0.2, 0.3, 0.3, 0.2], 0, 1);
    expect(panjerRecursion({ kind: 'poisson', lambda: 1 }, f, { points: 40 }).exactness).toBe('exact');
    expect(compoundByFft({ kind: 'poisson', lambda: 1 }, f, { points: 256 }).exactness).toBe('numerical');
    expect(convolveLattice(f, f, { route: 'direct' }).exactness).toBe('exact');
    expect(convolveLattice(f, f, { route: 'fft' }).exactness).toBe('numerical');
    expect(edgeworthDensity({ mean: 0, sd: 1, skewness: 0.1, excessKurtosis: 0.1 }, 0).exactness).toBe('numerical');
    expect(densityByGilPelaez((t) => cf('normal', { mu: 0, sigma: 1 }, t).value, 0).exactness).toBe('numerical');
  });

  it('warns that the product form of a sum assumes independence', () => {
    const r = cfOfSum(
      [
        { id: 'normal', params: { mu: 0, sigma: 1 } },
        { id: 'normal', params: { mu: 0, sigma: 1 } },
      ],
      0.5,
    );
    expect(r.notes.join(' ')).toMatch(/assumes the components are independent/);
    expect(convolveAll([makeLattice([0.5, 0.5], 0, 1), makeLattice([0.5, 0.5], 0, 1)]).notes.join(' ')).toMatch(
      /Independence is assumed/,
    );
    expect(() => cfOfSum([], 1)).toThrow(/at least one/);
  });

  it('refuses a region of convergence it has not been told about', () => {
    // Every registry distribution is covered, so this is checked by asserting
    // the coverage itself: an unrecorded id must throw rather than guess.
    const fake = { ...getDistribution('normal'), id: '__not_in_table__', name: 'Fake' };
    expect(() => mgfRegion(fake, { mu: 0, sigma: 1 })).toThrow(/not recorded/);
  });

  it('covers every registry distribution with a region of convergence', () => {
    const ids = [
      'bernoulli', 'binomial', 'geometric', 'negativeBinomial', 'hypergeometric', 'poisson', 'discreteUniform',
      'uniform', 'normal', 'exponential', 'gamma', 'beta', 'lognormal', 'weibull', 'studentT', 'chiSquare',
      'triangular', 'pert', 'cauchy', 'pareto', 'laplace', 'logistic', 'rayleigh', 'gumbel', 'frechet',
      'fDistribution', 'inverseGaussian', 'betaPrime', 'erlang', 'nakagami', 'burr12', 'halfNormal',
      'truncatedNormal', 'vonMises', 'levy', 'kumaraswamy', 'betaBinomial', 'zipf', 'skellam', 'logarithmic',
      'yuleSimon', 'comPoisson',
    ];
    for (const id of ids) {
      const roc = mgfRegion(getDistribution(id), defaults(id));
      expect(typeof roc.description).toBe('string');
      expect(roc.description.length).toBeGreaterThan(20);
      // t = 0 is in the region whenever the MGF exists at all.
      if (roc.exists) expect(inRegion(roc, 0)).toBe(true);
    }
  });

  it('the CGF is the logarithm of the MGF wherever both are reported', () => {
    for (const id of ['normal', 'exponential', 'gamma', 'poisson', 'binomial', 'beta']) {
      const p = defaults(id);
      for (const t of [-0.3, 0, 0.1]) {
        const roc = mgfRegion(getDistribution(id), p);
        if (!inRegion(roc, t)) continue;
        expect(cgf(id, p, t).value).toBeCloseTo(Math.log(mgf(id, p, t).value), 9);
      }
    }
  });
});
