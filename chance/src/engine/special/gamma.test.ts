import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  digamma,
  erf,
  erfc,
  gammaFn,
  incompleteBeta,
  incompleteGamma,
  logChoose,
  logGamma,
  normalCdf,
  normalQuantile,
  normalSf,
} from './gamma';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

describe('logGamma / gamma', () => {
  it('matches factorials and known values', () => {
    expect(gammaFn(5)).toBeCloseTo(24, 12);
    expect(rel(gammaFn(0.5), Math.sqrt(Math.PI))).toBeLessThan(1e-14);
    expect(rel(gammaFn(1.5), Math.sqrt(Math.PI) / 2)).toBeLessThan(1e-14);
    // Γ(0.1) = 9.513507698668731836...
    expect(rel(gammaFn(0.1), 9.513507698668732)).toBeLessThan(1e-13);
    // lnΓ(100.5) from mpmath
    expect(rel(logGamma(100.5), 361.4355404677776)).toBeLessThan(1e-13);
    expect(rel(logGamma(1000), 5905.220423209181)).toBeLessThan(1e-14);
  });
  it('handles negative non-integers via reflection', () => {
    // Γ(−0.5) = −2√π
    expect(rel(gammaFn(-0.5), -2 * Math.sqrt(Math.PI))).toBeLessThan(1e-13);
    expect(Number.isNaN(gammaFn(-2))).toBe(true);
  });
  it('logChoose(52, 5) = ln 2598960', () => {
    expect(rel(Math.exp(logChoose(52, 5)), 2598960)).toBeLessThan(1e-13);
  });
});

describe('incomplete gamma', () => {
  it('P(1, x) = 1 − e^{−x}', () => {
    for (const x of [0.01, 0.5, 1, 3, 10, 30]) {
      const t = incompleteGamma(1, x);
      expect(rel(t.lower, -Math.expm1(-x))).toBeLessThan(1e-13);
      expect(rel(t.upper, Math.exp(-x))).toBeLessThan(1e-13);
    }
  });
  it('reference values', () => {
    // P(3, 2) = 1 − e^{−2}(1 + 2 + 2) = 0.32332358381693654
    expect(rel(incompleteGamma(3, 2).lower, 0.32332358381693654)).toBeLessThan(1e-13);
    // Q(10, 25) small tail: = Σ_{k<10} e^{-25} 25^k/k! = 2.2758...e-5 (checked via Poisson CDF)
    let s = 0;
    let term = Math.exp(-25);
    for (let k = 0; k < 10; k++) {
      s += term;
      term *= 25 / (k + 1);
    }
    expect(rel(incompleteGamma(10, 25).upper, s)).toBeLessThan(1e-11);
  });
  it('large shape parameter stays accurate near the centre', () => {
    // For a = 1e4, P(a, a) → 0.5 + O(1/√a); reference 0.50132978...
    const p = incompleteGamma(10000, 10000).lower;
    expect(p).toBeGreaterThan(0.501);
    expect(p).toBeLessThan(0.5015);
  });
  it('tails sum to one (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.05, max: 500, noNaN: true }), fc.double({ min: 0, max: 800, noNaN: true }), (a, x) => {
        const t = incompleteGamma(a, x);
        return t.lower >= 0 && t.lower <= 1 && Math.abs(t.lower + t.upper - 1) < 1e-12;
      }),
    );
  });
});

describe('incomplete beta', () => {
  it('I_x(1,1) = x and I_x(a,1) = x^a', () => {
    expect(incompleteBeta(0.3, 1, 1).lower).toBeCloseTo(0.3, 14);
    expect(rel(incompleteBeta(0.6, 2.5, 1).lower, 0.6 ** 2.5)).toBeLessThan(1e-13);
  });
  it('binomial identity: P(X ≤ k) = I_{1−p}(n−k, k+1)', () => {
    // n=10, p=0.3, k=3 → 0.6496107184000001
    expect(rel(incompleteBeta(0.7, 7, 4).lower, 0.6496107184)).toBeLessThan(1e-12);
  });
  it('symmetric case I_0.5(a,a) = 0.5', () => {
    for (const a of [0.5, 2, 30, 400]) expect(incompleteBeta(0.5, a, a).lower).toBeCloseTo(0.5, 12);
  });
  it('rejects invalid domain', () => {
    expect(() => incompleteBeta(1.2, 1, 1)).toThrow();
    expect(() => incompleteBeta(0.5, 0, 1)).toThrow();
  });
});

describe('error function and normal', () => {
  it('erf reference values', () => {
    expect(rel(erf(0.5), 0.5204998778130465)).toBeLessThan(1e-14);
    expect(rel(erf(1), 0.8427007929497149)).toBeLessThan(1e-14);
    expect(rel(erfc(3), 2.209049699858544e-5)).toBeLessThan(1e-12);
    expect(rel(erfc(10), 2.088487583762545e-45)).toBeLessThan(1e-10);
    expect(rel(erfc(-1), 1.8427007929497148)).toBeLessThan(1e-14);
  });
  it('normal CDF reference values including far tails', () => {
    expect(normalCdf(0)).toBe(0.5);
    expect(rel(normalCdf(1.96), 0.9750021048517795)).toBeLessThan(1e-14);
    expect(rel(normalCdf(-1), 0.15865525393145707)).toBeLessThan(1e-13);
    expect(rel(normalCdf(-8), 6.22096057427178e-16)).toBeLessThan(1e-10);
    expect(rel(normalSf(10), 7.619853024160527e-24)).toBeLessThan(1e-10);
  });
  it('normal quantile reference values', () => {
    expect(rel(normalQuantile(0.975), 1.959963984540054)).toBeLessThan(1e-14);
    expect(rel(normalQuantile(0.95), 1.6448536269514722)).toBeLessThan(1e-14);
    expect(rel(normalQuantile(0.001), -3.090232306167813)).toBeLessThan(1e-13);
    expect(rel(normalQuantile(1e-20), -9.26234008979841)).toBeLessThan(1e-12);
    expect(normalQuantile(0.5)).toBeCloseTo(0, 15);
  });
  it('quantile inverts CDF (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: 1e-12, max: 1 - 1e-12, noNaN: true }), (p) => {
        const x = normalQuantile(p);
        const back = p < 0.5 ? normalCdf(x) : 1 - normalSf(x);
        return Math.abs(back - p) <= 1e-13 * Math.max(1, p < 0.5 ? 1 : 1) + 1e-14 * p;
      }),
    );
  });
  it('digamma reference values', () => {
    expect(digamma(1)).toBeCloseTo(-0.5772156649015329, 13);
    expect(digamma(0.5)).toBeCloseTo(-1.9635100260214235, 13);
  });
});
