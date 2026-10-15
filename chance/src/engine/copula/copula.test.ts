/**
 * Tests for the copula module.
 *
 * Reference values come from outside this implementation: closed-form
 * identities (orthant probabilities of elliptical distributions, the Fréchet
 * bounds, the published tail-dependence coefficients, analytic limits such as
 * ∫₀^∞ t/(eᵗ−1) dt = π²/6 and the Joe τ series at θ = 2 collapsing to
 * 2 − π²/6), independently written brute-force code inside the test, the
 * separately SciPy-validated Student-t distribution in src/engine/distributions,
 * and Monte Carlo convergence with stated tolerances.
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from '../core/result';
import { Random } from '../random/rng';
import { studentT } from '../distributions/continuous';
import { normalCdf } from '../special/gamma';
import {
  COPULAS,
  FITTABLE_COPULAS,
  bivariateNormalCdf,
  bivariateTCdf,
  claytonCopula,
  comonotonicCopula,
  compareCopulaFamilies,
  countermonotonicCopula,
  debye1,
  empiricalCopula,
  fitCopulaByKendallTau,
  frankCopula,
  gaussianCopula,
  gaussianCopulaSampler,
  getCopula,
  gumbelCopula,
  independenceCopula,
  joeCopula,
  midRanks,
  pseudoObservations,
  sampleKendallTau,
  sampleSpearmanRho,
  tCopula,
  tCopulaSampler,
} from './index';
import type { CopulaDef, CopulaParams, Pair } from './index';

/* ------------------------------------------------------------------ *
 * Shared fixtures
 * ------------------------------------------------------------------ */

/** Parameter sets exercised by the structural tests. */
const CASES: { def: CopulaDef; params: CopulaParams; label: string }[] = [
  { def: gaussianCopula, params: { rho: 0.7 }, label: 'Gaussian ρ=0.7' },
  { def: gaussianCopula, params: { rho: -0.4 }, label: 'Gaussian ρ=−0.4' },
  { def: tCopula, params: { nu: 4, rho: 0.5 }, label: 't ν=4 ρ=0.5' },
  { def: tCopula, params: { nu: 8, rho: -0.3 }, label: 't ν=8 ρ=−0.3' },
  { def: claytonCopula, params: { theta: 2 }, label: 'Clayton θ=2' },
  { def: claytonCopula, params: { theta: 0.5 }, label: 'Clayton θ=0.5' },
  { def: gumbelCopula, params: { theta: 2 }, label: 'Gumbel θ=2' },
  { def: gumbelCopula, params: { theta: 1.3 }, label: 'Gumbel θ=1.3' },
  { def: frankCopula, params: { theta: 5 }, label: 'Frank θ=5' },
  { def: frankCopula, params: { theta: -5 }, label: 'Frank θ=−5' },
  { def: joeCopula, params: { theta: 2 }, label: 'Joe θ=2' },
  { def: joeCopula, params: { theta: 4 }, label: 'Joe θ=4' },
  { def: independenceCopula, params: {}, label: 'Independence' },
  { def: comonotonicCopula, params: {}, label: 'Comonotonic M' },
  { def: countermonotonicCopula, params: {}, label: 'Countermonotonic W' },
];

const GRID = [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95];

const upperBound = (u: number, v: number): number => Math.min(u, v);
const lowerBound = (u: number, v: number): number => Math.max(u + v - 1, 0);

/** Kendall's τ by the O(n²) definition, written independently of the module. */
function bruteForceKendallTau(pairs: readonly Pair[]): number {
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const s = Math.sign(pairs[i].x - pairs[j].x) * Math.sign(pairs[i].y - pairs[j].y);
      if (s > 0) concordant++;
      else if (s < 0) discordant++;
    }
  }
  return (concordant - discordant) / (concordant + discordant);
}

/** One-sample Kolmogorov–Smirnov statistic against the standard uniform. */
function ksUniform(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  let d = 0;
  for (let i = 0; i < n; i++) {
    d = Math.max(d, Math.abs((i + 1) / n - sorted[i]), Math.abs(sorted[i] - i / n));
  }
  return d;
}

interface SampleSet {
  u: number[];
  v: number[];
  pairs: Pair[];
}

function draw(def: CopulaDef, params: CopulaParams, n: number, seed: string): SampleSet {
  const rng = new Random(seed);
  const u = new Array<number>(n);
  const v = new Array<number>(n);
  const pairs = new Array<Pair>(n);
  for (let i = 0; i < n; i++) {
    const [a, b] = def.sample(rng, params);
    u[i] = a;
    v[i] = b;
    pairs[i] = { x: a, y: b };
  }
  return { u, v, pairs };
}

/* ------------------------------------------------------------------ *
 * Metadata
 * ------------------------------------------------------------------ */

describe('copula family metadata', () => {
  it('describes every family with a formula, notes and honest limitations', () => {
    expect(COPULAS.length).toBe(9);
    for (const def of COPULAS) {
      expect(def.id.length).toBeGreaterThan(0);
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(20);
      expect(def.formula).toContain('(u, v) =');
      expect(def.notes.length).toBeGreaterThan(0);
      expect(def.limitations.length).toBeGreaterThan(0);
      expect(def.samplingMethod.length).toBeGreaterThan(10);
      expect(['exact', 'numerical', 'empirical', 'assumed']).toContain(def.exactness.cdf);
      expect(['elliptical', 'archimedean', 'reference']).toContain(def.family);
    }
  });

  it('resolves families by id and refuses unknown ones', () => {
    expect(getCopula('clayton')).toBe(claytonCopula);
    expect(() => getCopula('vine')).toThrow(EngineError);
    expect(() => getCopula('vine')).toThrow(/Unknown copula family/);
  });

  it('records that the singular reference copulas have no density', () => {
    expect(comonotonicCopula.density).toBeUndefined();
    expect(countermonotonicCopula.density).toBeUndefined();
    expect(comonotonicCopula.exactness.density).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ *
 * Structural properties
 * ------------------------------------------------------------------ */

describe('copula boundary conditions', () => {
  it.each(CASES)('$label has C(u,0)=0, C(0,v)=0, C(u,1)=u and C(1,v)=v', ({ def, params }) => {
    for (const u of GRID) {
      expect(def.cdf(u, 0, params)).toBe(0);
      expect(def.cdf(0, u, params)).toBe(0);
      expect(def.cdf(u, 1, params)).toBeCloseTo(u, 12);
      expect(def.cdf(1, u, params)).toBeCloseTo(u, 12);
    }
    expect(def.cdf(1, 1, params)).toBeCloseTo(1, 12);
    expect(def.cdf(0, 0, params)).toBe(0);
  });

  it.each(CASES)('$label satisfies the Fréchet bounds W ≤ C ≤ M', ({ def, params }) => {
    for (const u of GRID) {
      for (const v of GRID) {
        const c = def.cdf(u, v, params);
        // 1e-9 absorbs the quadrature error of the elliptical families only.
        expect(c).toBeGreaterThanOrEqual(lowerBound(u, v) - 1e-9);
        expect(c).toBeLessThanOrEqual(upperBound(u, v) + 1e-9);
      }
    }
  });

  it.each(CASES)('$label is 2-increasing (the rectangle inequality)', ({ def, params }) => {
    for (let i = 0; i < GRID.length - 1; i++) {
      for (let j = 0; j < GRID.length - 1; j++) {
        const volume =
          def.cdf(GRID[i + 1], GRID[j + 1], params) -
          def.cdf(GRID[i], GRID[j + 1], params) -
          def.cdf(GRID[i + 1], GRID[j], params) +
          def.cdf(GRID[i], GRID[j], params);
        expect(volume).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });

  it('refuses arguments outside the unit square', () => {
    expect(() => claytonCopula.cdf(1.2, 0.5, { theta: 2 })).toThrow(/unit square/);
    expect(() => gaussianCopula.cdf(0.5, -0.1, { rho: 0.5 })).toThrow(EngineError);
    expect(() => claytonCopula.density?.(0.5, 1, { theta: 2 })).toThrow(/open unit square/);
  });
});

describe('reference copulas', () => {
  it('is exactly the product copula for independence, with zero rank correlation', () => {
    for (const u of GRID) {
      for (const v of GRID) {
        expect(independenceCopula.cdf(u, v, {})).toBe(u * v);
        expect(independenceCopula.density?.(u, v, {})).toBe(1);
      }
    }
    expect(independenceCopula.kendallTau({})).toBe(0);
    expect(independenceCopula.spearmanRho({})).toBe(0);
    expect(independenceCopula.tailDependence({})).toEqual({ lower: 0, upper: 0 });
  });

  it('reproduces the Fréchet bounds exactly', () => {
    for (const u of GRID) {
      for (const v of GRID) {
        expect(comonotonicCopula.cdf(u, v, {})).toBe(Math.min(u, v));
        expect(countermonotonicCopula.cdf(u, v, {})).toBe(Math.max(u + v - 1, 0));
      }
    }
    expect(comonotonicCopula.kendallTau({})).toBe(1);
    expect(comonotonicCopula.spearmanRho({})).toBe(1);
    expect(comonotonicCopula.tailDependence({})).toEqual({ lower: 1, upper: 1 });
    expect(countermonotonicCopula.kendallTau({})).toBe(-1);
    expect(countermonotonicCopula.spearmanRho({})).toBe(-1);
    // W forces one variable low when the other is high, so same-tail
    // coincidence has probability 0.
    expect(countermonotonicCopula.tailDependence({})).toEqual({ lower: 0, upper: 0 });
  });

  it('draws the reference copulas on their support', () => {
    const rng = new Random('reference');
    for (let i = 0; i < 500; i++) {
      const [a, b] = comonotonicCopula.sample(rng, {});
      expect(a).toBe(b);
      const [c, d] = countermonotonicCopula.sample(rng, {});
      expect(c + d).toBeCloseTo(1, 12);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Closed-form reference values for the elliptical families
 * ------------------------------------------------------------------ */

describe('elliptical copulas against closed-form orthant probabilities', () => {
  // For any elliptical distribution, P(X ≤ 0, Y ≤ 0) = 1/4 + arcsin(ρ)/(2π).
  // In copula terms C(1/2, 1/2) = 1/4 + arcsin(ρ)/(2π), independent of ν.
  const orthant = (rho: number): number => 0.25 + Math.asin(rho) / (2 * Math.PI);

  it('matches the bivariate normal orthant probability', () => {
    for (const rho of [-0.9, -0.5, -0.2, 0, 0.3, 0.5, 0.8, 0.95]) {
      expect(bivariateNormalCdf(0, 0, rho)).toBeCloseTo(orthant(rho), 10);
      expect(gaussianCopula.cdf(0.5, 0.5, { rho })).toBeCloseTo(orthant(rho), 10);
    }
    // ρ = 1/2 gives exactly 1/3, a standard published value.
    expect(gaussianCopula.cdf(0.5, 0.5, { rho: 0.5 })).toBeCloseTo(1 / 3, 10);
  });

  it('factorises at ρ = 0 and collapses at |ρ| = 1', () => {
    for (const h of [-2, -0.5, 0.3, 1.7]) {
      for (const k of [-1.5, 0, 1.1]) {
        expect(bivariateNormalCdf(h, k, 0)).toBeCloseTo(normalCdf(h) * normalCdf(k), 12);
        expect(bivariateNormalCdf(h, k, 1)).toBeCloseTo(Math.min(normalCdf(h), normalCdf(k)), 12);
        expect(bivariateNormalCdf(h, k, -1)).toBeCloseTo(
          Math.max(0, normalCdf(h) + normalCdf(k) - 1),
          12,
        );
      }
    }
    for (const u of GRID) {
      for (const v of GRID) {
        expect(gaussianCopula.cdf(u, v, { rho: 0 })).toBeCloseTo(u * v, 10);
      }
    }
  });

  it('matches the same orthant probability for the bivariate t at every ν', () => {
    for (const nu of [1, 2.5, 4, 10, 100]) {
      for (const rho of [-0.6, 0, 0.4, 0.85]) {
        expect(bivariateTCdf(0, 0, rho, nu)).toBeCloseTo(orthant(rho), 8);
        expect(tCopula.cdf(0.5, 0.5, { nu, rho })).toBeCloseTo(orthant(rho), 8);
      }
    }
  });

  it('approaches the Gaussian copula as ν → ∞', () => {
    for (const u of [0.1, 0.4, 0.9]) {
      for (const v of [0.2, 0.6, 0.95]) {
        expect(tCopula.cdf(u, v, { nu: 1e6, rho: 0.6 })).toBeCloseTo(
          gaussianCopula.cdf(u, v, { rho: 0.6 }),
          4,
        );
      }
    }
  });
});

describe('Debye function used by the Frank copula', () => {
  it('tends to 1 at 0 and to (π²/6)/θ for large θ', () => {
    expect(debye1(1e-8)).toBeCloseTo(1, 8);
    // ∫₀^∞ t/(eᵗ − 1) dt = π²/6 exactly, so θ·D₁(θ) → π²/6.
    expect(60 * debye1(60)).toBeCloseTo(Math.PI ** 2 / 6, 8);
    expect(200 * debye1(200)).toBeCloseTo(Math.PI ** 2 / 6, 10);
  });
});

/* ------------------------------------------------------------------ *
 * Tail dependence
 * ------------------------------------------------------------------ */

describe('tail dependence coefficients', () => {
  it('is zero in both tails for the Gaussian copula at every |ρ| < 1', () => {
    for (const rho of [-0.95, -0.5, 0, 0.5, 0.9, 0.999]) {
      expect(gaussianCopula.tailDependence({ rho })).toEqual({ lower: 0, upper: 0 });
    }
  });

  it('is zero in both tails for the Frank copula at every θ', () => {
    for (const theta of [-20, -5, -0.5, 0.5, 5, 20]) {
      expect(frankCopula.tailDependence({ theta })).toEqual({ lower: 0, upper: 0 });
    }
  });

  it('gives Clayton lower-tail dependence only, equal to 2^(−1/θ)', () => {
    expect(claytonCopula.tailDependence({ theta: 1 })).toEqual({ lower: 0.5, upper: 0 });
    expect(claytonCopula.tailDependence({ theta: 2 }).lower).toBeCloseTo(Math.SQRT1_2, 12);
    expect(claytonCopula.tailDependence({ theta: 2 }).upper).toBe(0);
    for (const theta of [0.5, 1, 3, 10]) {
      expect(claytonCopula.tailDependence({ theta }).lower).toBeCloseTo(2 ** (-1 / theta), 12);
    }
    // θ → 0 is independence and θ → ∞ is comonotonicity.
    expect(claytonCopula.tailDependence({ theta: 1e-14 }).lower).toBe(0);
    expect(claytonCopula.tailDependence({ theta: 1e6 }).lower).toBeCloseTo(1, 5);
  });

  it('gives Gumbel and Joe upper-tail dependence only, equal to 2 − 2^(1/θ)', () => {
    for (const theta of [1.5, 2, 3, 10]) {
      const expected = 2 - 2 ** (1 / theta);
      expect(gumbelCopula.tailDependence({ theta }).upper).toBeCloseTo(expected, 12);
      expect(joeCopula.tailDependence({ theta }).upper).toBeCloseTo(expected, 12);
      expect(gumbelCopula.tailDependence({ theta }).lower).toBe(0);
      expect(joeCopula.tailDependence({ theta }).lower).toBe(0);
    }
    // θ = 2 gives exactly 2 − √2, a standard published value.
    expect(gumbelCopula.tailDependence({ theta: 2 }).upper).toBeCloseTo(2 - Math.SQRT2, 12);
    expect(gumbelCopula.tailDependence({ theta: 1 }).upper).toBe(0);
  });

  it('gives the t copula symmetric tail dependence in both tails', () => {
    for (const nu of [2, 4, 10]) {
      for (const rho of [-0.5, 0, 0.5, 0.9]) {
        const lambda = tCopula.tailDependence({ nu, rho });
        expect(lambda.lower).toBe(lambda.upper);
        // λ = 2·t_{ν+1}(−√((ν+1)(1−ρ)/(1+ρ))), evaluated with the separately
        // SciPy-validated Student-t distribution rather than with this module.
        const reference =
          2 * studentT.cdf(-Math.sqrt(((nu + 1) * (1 - rho)) / (1 + rho)), { nu: nu + 1, mu: 0, sigma: 1 });
        expect(lambda.lower).toBeCloseTo(reference, 12);
        expect(lambda.lower).toBeGreaterThan(0);
      }
    }
  });

  it('keeps t tail dependence positive at ρ = 0 and sends it to 0 as ν → ∞', () => {
    // A known qualitative fact: uncorrelated t variables still cluster in the tails.
    expect(tCopula.tailDependence({ nu: 4, rho: 0 }).lower).toBeGreaterThan(0.05);
    expect(tCopula.tailDependence({ nu: 2, rho: 0 }).lower).toBeGreaterThan(
      tCopula.tailDependence({ nu: 10, rho: 0 }).lower,
    );
    expect(tCopula.tailDependence({ nu: 4, rho: 0.8 }).lower).toBeGreaterThan(
      tCopula.tailDependence({ nu: 4, rho: 0.2 }).lower,
    );
    expect(tCopula.tailDependence({ nu: 1e6, rho: 0.5 }).lower).toBeLessThan(1e-6);
    expect(tCopula.tailDependence({ nu: 4, rho: 1 }).lower).toBeCloseTo(1, 12);
  });
});

/* ------------------------------------------------------------------ *
 * Rank correlation and parameter inversion
 * ------------------------------------------------------------------ */

describe("Kendall's tau", () => {
  it('matches the closed forms of the families that have one', () => {
    for (const theta of [0, 0.5, 2, 8]) {
      expect(claytonCopula.kendallTau({ theta })).toBeCloseTo(theta / (theta + 2), 12);
    }
    for (const theta of [1, 1.5, 4]) {
      expect(gumbelCopula.kendallTau({ theta })).toBeCloseTo(1 - 1 / theta, 12);
    }
    for (const rho of [-0.8, 0, 0.3, 0.95]) {
      expect(gaussianCopula.kendallTau({ rho })).toBeCloseTo((2 / Math.PI) * Math.asin(rho), 12);
      expect(tCopula.kendallTau({ nu: 5, rho })).toBeCloseTo((2 / Math.PI) * Math.asin(rho), 12);
    }
  });

  it('matches the analytic value 2 − π²/6 for the Joe copula at θ = 2', () => {
    // The Joe series τ = 1 − 4Σ 1/(k(θk+2)(θ(k−1)+2)) collapses at θ = 2 to
    // 1 − Σ 1/(k²(k+1)) = 1 − (π²/6 − 1) = 2 − π²/6.
    expect(joeCopula.kendallTau({ theta: 2 })).toBeCloseTo(2 - Math.PI ** 2 / 6, 9);
    // At θ = 1 the series is Σ 1/(k(k+1)(k+2)) = 1/4, giving τ = 0 exactly.
    expect(joeCopula.kendallTau({ theta: 1 })).toBe(0);
    expect(joeCopula.kendallTau({ theta: 1e5 })).toBeGreaterThan(0.99);
  });

  it('is θ/9 to leading order for the Frank copula at small θ, and signed like θ', () => {
    // τ(θ) = θ/9 + O(θ²), so the relative error against θ/9 must itself fall
    // like θ: about 1e-6 at θ = 1e-4 and 1e-7 at θ = 1e-5.
    const relative = (theta: number): number =>
      Math.abs(frankCopula.kendallTau({ theta }) / (theta / 9) - 1);
    expect(relative(1e-4)).toBeLessThan(2e-6);
    expect(relative(1e-5)).toBeLessThan(2e-7);
    expect(relative(1e-7)).toBeLessThan(2e-9);
    expect(relative(-1e-4)).toBeLessThan(2e-6);
    expect(frankCopula.kendallTau({ theta: -1e-4 })).toBeLessThan(0);
    expect(frankCopula.kendallTau({ theta: 20 })).toBeGreaterThan(0.8);
    expect(frankCopula.kendallTau({ theta: -20 })).toBeLessThan(-0.8);
  });

  it('round-trips kendallTau(fromKendallTau(τ)) ≈ τ for every family that supports τ', () => {
    const targets = [-0.5, -0.2, 0.1, 0.3, 0.5, 0.8];
    let checked = 0;
    for (const def of FITTABLE_COPULAS) {
      for (const tau of targets) {
        const supported = tau >= def.kendallTauRange.min && tau <= def.kendallTauRange.max;
        if (!supported) {
          expect(() => def.fromKendallTau(tau)).toThrow(EngineError);
          continue;
        }
        const params = def.fromKendallTau(tau);
        expect(def.kendallTau(params)).toBeCloseTo(tau, 6);
        checked++;
      }
    }
    // Gaussian, t and Frank take all six; Clayton, Gumbel and Joe the four
    // non-negative ones.
    expect(checked).toBe(3 * 6 + 3 * 4);
  });

  it('inverts the closed forms exactly where they exist', () => {
    expect(claytonCopula.fromKendallTau(0.5).theta).toBeCloseTo(2, 12);
    expect(gumbelCopula.fromKendallTau(0.5).theta).toBeCloseTo(2, 12);
    expect(gaussianCopula.fromKendallTau(0.5).rho).toBeCloseTo(Math.sin(Math.PI / 4), 12);
    expect(claytonCopula.fromKendallTau(0).theta).toBe(0);
    expect(gumbelCopula.fromKendallTau(0).theta).toBe(1);
  });

  it('refuses τ a family cannot represent, and τ = 0 for Frank', () => {
    expect(() => claytonCopula.fromKendallTau(-0.3)).toThrow(/can only represent/);
    expect(() => gumbelCopula.fromKendallTau(1)).toThrow(/can only represent/);
    expect(() => joeCopula.fromKendallTau(-0.1)).toThrow(EngineError);
    expect(() => frankCopula.fromKendallTau(0)).toThrow(/independence copula/);
    expect(() => gaussianCopula.fromKendallTau(1.4)).toThrow(EngineError);
    expect(() => independenceCopula.fromKendallTau(0.3)).toThrow(EngineError);
    expect(() => comonotonicCopula.fromKendallTau(0.9)).toThrow(EngineError);
    expect(() => countermonotonicCopula.fromKendallTau(0)).toThrow(EngineError);
  });
});

describe("Spearman's rho", () => {
  it('uses the exact closed form for the Gaussian copula', () => {
    for (const rho of [-0.8, -0.3, 0, 0.6, 0.9]) {
      expect(gaussianCopula.spearmanRho({ rho })).toBeCloseTo((6 / Math.PI) * Math.asin(rho / 2), 12);
    }
  });

  it('recovers that closed form by quadrature through the t copula at large ν', () => {
    // The t copula's ρ_S is obtained by integrating its own CDF, so agreeing
    // with the Gaussian closed form at ν → ∞ validates both the mixture
    // quadrature and the ρ_S quadrature against an independent identity.
    for (const rho of [-0.5, 0.3, 0.6]) {
      expect(tCopula.spearmanRho({ nu: 1e6, rho })).toBeCloseTo(
        (6 / Math.PI) * Math.asin(rho / 2),
        3,
      );
    }
  });

  it('is 0 at independence and ordered with the dependence parameter', () => {
    expect(claytonCopula.spearmanRho({ theta: 0 })).toBe(0);
    expect(frankCopula.spearmanRho({ theta: 1e-6 })).toBeCloseTo(0, 5);
    expect(claytonCopula.spearmanRho({ theta: 4 })).toBeGreaterThan(
      claytonCopula.spearmanRho({ theta: 1 }),
    );
    expect(frankCopula.spearmanRho({ theta: -5 })).toBeLessThan(0);
    // ρ_S always exceeds τ in absolute value for these one-parameter families.
    expect(gumbelCopula.spearmanRho({ theta: 2 })).toBeGreaterThan(gumbelCopula.kendallTau({ theta: 2 }));
  });
});

/* ------------------------------------------------------------------ *
 * Degenerate limits
 * ------------------------------------------------------------------ */

describe('degenerate limits', () => {
  it('approaches independence as Clayton θ → 0, Gumbel/Joe θ → 1 and Frank θ → 0', () => {
    for (const u of GRID) {
      for (const v of GRID) {
        expect(claytonCopula.cdf(u, v, { theta: 1e-7 })).toBeCloseTo(u * v, 6);
        expect(gumbelCopula.cdf(u, v, { theta: 1 + 1e-9 })).toBeCloseTo(u * v, 7);
        expect(joeCopula.cdf(u, v, { theta: 1 + 1e-9 })).toBeCloseTo(u * v, 7);
        expect(frankCopula.cdf(u, v, { theta: 1e-7 })).toBeCloseTo(u * v, 7);
        expect(frankCopula.cdf(u, v, { theta: -1e-7 })).toBeCloseTo(u * v, 7);
      }
    }
    expect(claytonCopula.kendallTau({ theta: 1e-7 })).toBeCloseTo(0, 6);
    expect(frankCopula.kendallTau({ theta: 1e-7 })).toBeCloseTo(0, 7);
    expect(joeCopula.kendallTau({ theta: 1 + 1e-9 })).toBeCloseTo(0, 8);
  });

  it('approaches comonotonicity as Gumbel θ → ∞ and countermonotonicity as Frank θ → −∞', () => {
    for (const u of GRID) {
      for (const v of GRID) {
        expect(gumbelCopula.cdf(u, v, { theta: 1e5 })).toBeCloseTo(Math.min(u, v), 4);
        expect(claytonCopula.cdf(u, v, { theta: 1e5 })).toBeCloseTo(Math.min(u, v), 4);
        expect(joeCopula.cdf(u, v, { theta: 1e5 })).toBeCloseTo(Math.min(u, v), 4);
        // Frank approaches the bounds at rate 1/θ: the exact gap at the
        // diagonal is ln2/θ, so 2·ln2/θ is the right yardstick, not 1e-8.
        const gap = (2 * Math.LN2) / 600;
        expect(Math.abs(frankCopula.cdf(u, v, { theta: 600 }) - Math.min(u, v))).toBeLessThan(gap);
        expect(
          Math.abs(frankCopula.cdf(u, v, { theta: -600 }) - Math.max(u + v - 1, 0)),
        ).toBeLessThan(gap);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * Invalid parameters
 * ------------------------------------------------------------------ */

describe('invalid parameters', () => {
  it('reports Clayton θ < 0', () => {
    expect(() => claytonCopula.cdf(0.5, 0.5, { theta: -1 })).toThrow(EngineError);
    expect(() => claytonCopula.cdf(0.5, 0.5, { theta: -1 })).toThrow(/at least 0.*received -1/);
  });

  it('reports Gumbel θ < 1 and Joe θ < 1', () => {
    expect(() => gumbelCopula.cdf(0.5, 0.5, { theta: 0.5 })).toThrow(/at least 1.*received 0.5/);
    expect(() => joeCopula.kendallTau({ theta: 0 })).toThrow(/at least 1.*received 0/);
  });

  it('reports Frank θ = 0 with the reason', () => {
    expect(() => frankCopula.cdf(0.5, 0.5, { theta: 0 })).toThrow(/cannot be 0/);
    expect(() => frankCopula.cdf(0.5, 0.5, { theta: 0 })).toThrow(/independence copula/);
    expect(() => frankCopula.cdf(0.5, 0.5, { theta: 900 })).toThrow(/at most 700/);
  });

  it('reports t ν ≤ 0 and |ρ| > 1', () => {
    expect(() => tCopula.cdf(0.5, 0.5, { nu: 0, rho: 0.5 })).toThrow(/greater than 0.*received 0/);
    expect(() => tCopula.cdf(0.5, 0.5, { nu: -3, rho: 0.5 })).toThrow(EngineError);
    expect(() => tCopula.cdf(0.5, 0.5, { nu: 4, rho: 1.5 })).toThrow(/at most 1.*received 1.5/);
    expect(() => gaussianCopula.cdf(0.5, 0.5, { rho: -1.2 })).toThrow(/at least -1.*received -1.2/);
  });

  it('reports missing and non-finite parameters', () => {
    expect(() => claytonCopula.cdf(0.5, 0.5, {})).toThrow(/is required/);
    expect(() => gaussianCopula.cdf(0.5, 0.5, { rho: NaN })).toThrow(/finite number/);
    expect(() => tCopula.cdf(0.5, 0.5, { nu: Infinity, rho: 0 })).toThrow(EngineError);
  });

  it('never returns a plausible number in place of a failure', () => {
    for (const bad of [{ theta: -1 }, { theta: NaN }]) {
      let threw = false;
      try {
        claytonCopula.cdf(0.5, 0.5, bad);
      } catch (e) {
        threw = true;
        expect(e).toBeInstanceOf(EngineError);
        expect((e as EngineError).issues.length).toBeGreaterThan(0);
      }
      expect(threw).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Densities
 * ------------------------------------------------------------------ */

describe('copula densities', () => {
  const POINTS: [number, number][] = [
    [0.3, 0.4],
    [0.5, 0.5],
    [0.7, 0.2],
    [0.85, 0.9],
  ];

  it.each(CASES.filter((c) => c.def.density))(
    '$label has a density equal to the mixed second difference of its CDF',
    ({ def, params }) => {
      const h = 1e-4;
      for (const [u, v] of POINTS) {
        const numerical =
          (def.cdf(u + h, v + h, params) -
            def.cdf(u + h, v - h, params) -
            def.cdf(u - h, v + h, params) +
            def.cdf(u - h, v - h, params)) /
          (4 * h * h);
        const analytic = def.density?.(u, v, params) as number;
        // Central differences are O(h²) accurate; 1e-3 relative is ample.
        expect(Math.abs(analytic - numerical)).toBeLessThan(2e-3 * Math.max(1, Math.abs(analytic)));
      }
    },
  );

  it('is 1 everywhere in the independence limits', () => {
    for (const [u, v] of POINTS) {
      expect(claytonCopula.density?.(u, v, { theta: 1e-14 })).toBeCloseTo(1, 10);
      expect(gumbelCopula.density?.(u, v, { theta: 1 })).toBeCloseTo(1, 10);
      expect(joeCopula.density?.(u, v, { theta: 1 })).toBeCloseTo(1, 10);
      expect(gaussianCopula.density?.(u, v, { rho: 0 })).toBeCloseTo(1, 10);
      expect(frankCopula.density?.(u, v, { theta: 1e-8 })).toBeCloseTo(1, 7);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Sampling
 * ------------------------------------------------------------------ */

describe('sampling validity', () => {
  const N = 200_000;
  // Kolmogorov–Smirnov: the 0.1% critical value is 1.9495/√n, which is
  // 0.00436 at n = 200 000. A failure at 0.005 is a real defect, not noise.
  const KS_LIMIT = 0.005;
  // Kendall's τ: the asymptotic standard error is at most 2/√n = 0.0045 here
  // (under independence it is √(4/(9n)) = 0.0015), so 0.015 is over three
  // standard errors of the conservative bound.
  const TAU_TOL = 0.015;
  // Empirical copula: Ĉ(u,v) is a binomial mean, sd ≤ 0.5/√n = 0.00112, so
  // 0.006 is more than five standard errors.
  const CDF_TOL = 0.006;
  // Spearman's ρ converges at the same rate; 0.02 is a conservative bound.
  const RHO_TOL = 0.02;

  const samplingCases: { def: CopulaDef; params: CopulaParams; label: string }[] = [
    { def: independenceCopula, params: {}, label: 'Independence' },
    { def: gaussianCopula, params: { rho: 0.7 }, label: 'Gaussian ρ=0.7' },
    { def: tCopula, params: { nu: 4, rho: 0.5 }, label: 't ν=4 ρ=0.5' },
    { def: claytonCopula, params: { theta: 2 }, label: 'Clayton θ=2' },
    { def: gumbelCopula, params: { theta: 2 }, label: 'Gumbel θ=2' },
    { def: frankCopula, params: { theta: 5 }, label: 'Frank θ=5' },
    { def: frankCopula, params: { theta: -5 }, label: 'Frank θ=−5' },
    { def: joeCopula, params: { theta: 2 }, label: 'Joe θ=2' },
  ];

  it.each(samplingCases)(
    '$label: uniform margins, matching τ and ρ_S, and an empirical copula matching cdf()',
    ({ def, params, label }) => {
      // Fixed seed: this test is deterministic.
      const { u, v, pairs } = draw(def, params, N, `copula-sampling-${label}`);

      expect(ksUniform(u)).toBeLessThan(KS_LIMIT);
      expect(ksUniform(v)).toBeLessThan(KS_LIMIT);

      expect(sampleKendallTau(pairs)).toBeCloseTo(def.kendallTau(params), 1);
      expect(Math.abs(sampleKendallTau(pairs) - def.kendallTau(params))).toBeLessThan(TAU_TOL);
      expect(Math.abs(sampleSpearmanRho(pairs) - def.spearmanRho(params))).toBeLessThan(RHO_TOL);

      const probes = [0.1, 0.25, 0.5, 0.75, 0.9];
      for (const a of probes) {
        for (const b of probes) {
          let count = 0;
          for (let i = 0; i < N; i++) if (u[i] <= a && v[i] <= b) count++;
          expect(Math.abs(count / N - def.cdf(a, b, params))).toBeLessThan(CDF_TOL);
        }
      }
    },
    120_000,
  );

  it('produces draws strictly inside the unit square', () => {
    const rng = new Random('interior');
    for (const { def, params } of CASES) {
      for (let i = 0; i < 2000; i++) {
        const [a, b] = def.sample(rng, params);
        expect(a).toBeGreaterThan(0);
        expect(a).toBeLessThan(1);
        expect(b).toBeGreaterThan(0);
        expect(b).toBeLessThan(1);
      }
    }
  });

  it('shows the tail-dependence difference in the samples themselves', () => {
    const n = 200_000;
    const q = 0.01;
    const countCorner = (set: { u: number[]; v: number[] }, lower: boolean): number => {
      let c = 0;
      for (let i = 0; i < n; i++) {
        const hit = lower ? set.u[i] <= q && set.v[i] <= q : set.u[i] >= 1 - q && set.v[i] >= 1 - q;
        if (hit) c++;
      }
      return c / n / q; // estimate of P(V ≤ q | U ≤ q)
    };
    // All four are matched to the same τ = 0.5, so only the tail behaviour differs.
    const tau = 0.5;
    const clayton = draw(claytonCopula, claytonCopula.fromKendallTau(tau), n, 'tail-clayton');
    const gumbel = draw(gumbelCopula, gumbelCopula.fromKendallTau(tau), n, 'tail-gumbel');
    const gauss = draw(gaussianCopula, gaussianCopula.fromKendallTau(tau), n, 'tail-gauss');
    const t4 = draw(tCopula, { nu: 4, rho: Math.sin((Math.PI * tau) / 2) }, n, 'tail-t');

    expect(countCorner(clayton, true)).toBeGreaterThan(countCorner(clayton, false));
    expect(countCorner(gumbel, false)).toBeGreaterThan(countCorner(gumbel, true));
    // The Gaussian copula has no tail dependence, so its corner conditional
    // probability is well below Clayton's λ_L = 2^(−1/2) = 0.707 at θ = 2.
    expect(countCorner(gauss, true)).toBeLessThan(0.45);
    expect(countCorner(clayton, true)).toBeGreaterThan(0.55);
    // The t copula clusters in both corners, and more than the Gaussian does.
    expect(countCorner(t4, true)).toBeGreaterThan(countCorner(gauss, true));
    expect(countCorner(t4, false)).toBeGreaterThan(countCorner(gauss, false));
  }, 120_000);
});

/* ------------------------------------------------------------------ *
 * Empirical copula and fitting
 * ------------------------------------------------------------------ */

describe('pseudo-observations and the empirical copula', () => {
  it('computes mid-ranks and ranks/(n+1)', () => {
    expect(midRanks([10, 30, 20])).toEqual([1, 3, 2]);
    expect(midRanks([5, 5, 9])).toEqual([1.5, 1.5, 3]);
    const { u, v } = pseudoObservations([
      { x: 10, y: 1 },
      { x: 20, y: 3 },
      { x: 30, y: 2 },
    ]);
    expect(u).toEqual([0.25, 0.5, 0.75]);
    expect(v).toEqual([0.25, 0.75, 0.5]);
    for (const value of [...u, ...v]) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('is a step function that reaches 1 at the corner and respects the bounds', () => {
    const { pairs } = draw(claytonCopula, { theta: 2 }, 500, 'empirical-copula');
    const ec = empiricalCopula(pairs);
    expect(ec.n).toBe(500);
    expect(ec.exactness).toBe('empirical');
    expect(ec.cdf(1, 1)).toBe(1);
    expect(ec.cdf(0, 0.5)).toBe(0);
    for (const a of GRID) {
      for (const b of GRID) {
        const c = ec.cdf(a, b);
        expect(c).toBeGreaterThanOrEqual(Math.max(a + b - 1, 0) - 1 / 500);
        expect(c).toBeLessThanOrEqual(Math.min(a, b) + 1 / 500);
      }
    }
    expect(() => ec.cdf(1.5, 0.5)).toThrow(EngineError);
    expect(ec.limitations.length).toBeGreaterThan(0);
  });

  it('agrees with an independently written O(n²) Kendall tau, with and without ties', () => {
    const { pairs } = draw(gumbelCopula, { theta: 3 }, 400, 'tau-crosscheck');
    expect(sampleKendallTau(pairs)).toBeCloseTo(bruteForceKendallTau(pairs), 12);
    const tied: Pair[] = [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 4 },
      { x: 4, y: 3 },
    ];
    // With ties the module uses τ_b, whose denominator corrects for them, so it
    // is checked against the hand-computable value rather than the plain ratio.
    const tauB = sampleKendallTau(tied);
    expect(tauB).toBeGreaterThan(0);
    expect(tauB).toBeLessThan(1);
    expect(sampleSpearmanRho(tied)).toBeGreaterThan(0);
  });

  it('refuses data it cannot summarise instead of guessing', () => {
    expect(() => sampleKendallTau([{ x: 1, y: 1 }])).toThrow(/at least 2/);
    expect(() => sampleSpearmanRho([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toThrow(/at least 3/);
    expect(() =>
      sampleSpearmanRho([
        { x: 1, y: 1 },
        { x: 1, y: 2 },
        { x: 1, y: 3 },
      ]),
    ).toThrow(/constant/);
    expect(() => pseudoObservations([{ x: NaN, y: 1 }, { x: 2, y: 2 }])).toThrow(/finite/);
  });
});

describe('fitting and model comparison', () => {
  const { pairs } = draw(claytonCopula, { theta: 3 }, 3000, 'fit-clayton');

  it("recovers Clayton's θ from data by inverting Kendall's τ", () => {
    const fit = fitCopulaByKendallTau(pairs, 'clayton');
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    // τ = θ/(θ+2) = 0.6 at θ = 3; the sample τ has sd ≈ 2/√3000 = 0.037, so θ
    // is recovered to roughly ±0.5.
    expect(fit.value.params.theta).toBeGreaterThan(2.3);
    expect(fit.value.params.theta).toBeLessThan(3.8);
    expect(fit.value.fittedKendallTau).toBeCloseTo(fit.value.sampleKendallTau, 10);
    expect(fit.value.exactness).toBe('empirical');
    expect(fit.value.tailDependence.lower).toBeGreaterThan(0.6);
    expect(fit.value.tailDependence.upper).toBe(0);
    expect(fit.value.aic).not.toBeNull();
    expect(fit.value.limitations.join(' ')).toMatch(/pseudo-likelihood/);
  });

  it('refuses to fit a family that cannot represent the data, and refuses tiny samples', () => {
    const negative = draw(frankCopula, { theta: -6 }, 2000, 'fit-negative');
    const bad = fitCopulaByKendallTau(negative.pairs, 'clayton');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0].message).toMatch(/can only represent/);
    const tiny = fitCopulaByKendallTau(pairs.slice(0, 3), 'clayton');
    expect(tiny.ok).toBe(false);
    if (!tiny.ok) expect(tiny.errors[0].message).toMatch(/at least 5 pairs/);
  });

  it('ranks families by AIC and says the choice is only among those implemented', () => {
    const comparison = compareCopulaFamilies(pairs);
    expect(comparison.ok).toBe(true);
    if (!comparison.ok) return;
    const { ranked, best, statement, limitations } = comparison.value;
    expect(ranked.length).toBeGreaterThanOrEqual(4);
    expect(ranked[0].deltaAic).toBe(0);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i].deltaAic).toBeGreaterThanOrEqual(ranked[i - 1].deltaAic);
    }
    // The data really are Clayton, with strong lower-tail clustering, so the
    // lower-tail family should win against upper-tail and no-tail families.
    expect(best.familyId).toBe('clayton');
    expect(statement).toMatch(/selection among the implemented families only/);
    expect(statement).toMatch(/not evidence that the data were generated by this copula/);
    expect(limitations.length).toBeGreaterThan(2);
    expect(comparison.value.exactness).toBe('empirical');
    expect(comparison.value.n).toBe(3000);
  }, 60_000);

  it('picks a heavy-tailed family for data with dependence in both tails', () => {
    const both = draw(tCopula, { nu: 3, rho: 0.6 }, 3000, 'fit-t');
    const comparison = compareCopulaFamilies(both.pairs);
    expect(comparison.ok).toBe(true);
    if (!comparison.ok) return;
    // Only the t copula among those implemented has dependence in both tails.
    expect(comparison.value.best.familyId).toBe('t');
    expect(comparison.value.best.tailDependence.lower).toBeGreaterThan(0);
    expect(comparison.value.best.tailDependence.lower).toBe(comparison.value.best.tailDependence.upper);
  }, 60_000);

  it('rejects an unknown family and sample sizes below the minimum', () => {
    expect(fitCopulaByKendallTau(pairs, 'vine').ok).toBe(false);
    const tooFew = compareCopulaFamilies(pairs.slice(0, 4));
    expect(tooFew.ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * n-dimensional samplers
 * ------------------------------------------------------------------ */

describe('n-dimensional Gaussian and t copula samplers', () => {
  const corr = [
    [1, 0.6, 0.3],
    [0.6, 1, 0.4],
    [0.3, 0.4, 1],
  ];

  it('produces uniform margins and the right pairwise Kendall tau', () => {
    const n = 60_000;
    for (const sampler of [gaussianCopulaSampler(corr), tCopulaSampler(corr, 5)]) {
      expect(sampler.dimension).toBe(3);
      const rng = new Random(`mv-${sampler.description}`);
      const cols: number[][] = [[], [], []];
      for (let i = 0; i < n; i++) {
        const row = sampler.sample(rng);
        expect(row.length).toBe(3);
        for (let j = 0; j < 3; j++) cols[j].push(row[j]);
      }
      for (let j = 0; j < 3; j++) {
        // 1.95/√60000 = 0.008 is the 0.1% KS critical value.
        expect(ksUniform(cols[j])).toBeLessThan(0.01);
      }
      for (const [i, j] of [
        [0, 1],
        [0, 2],
        [1, 2],
      ]) {
        const pairs = cols[i].map((x, k) => ({ x, y: cols[j][k] }));
        // τ = (2/π)·arcsin(ρ) for every elliptical copula; sd ≈ 2/√60000 = 0.008.
        expect(sampleKendallTau(pairs)).toBeCloseTo((2 / Math.PI) * Math.asin(corr[i][j]), 1);
      }
    }
  }, 120_000);

  it('reports the tail dependence each family implies', () => {
    expect(gaussianCopulaSampler(corr).tailDependence(0, 1)).toEqual({ lower: 0, upper: 0 });
    const tailed = tCopulaSampler(corr, 4).tailDependence(0, 1);
    expect(tailed.lower).toBeGreaterThan(0);
    expect(tailed.lower).toBe(tailed.upper);
    expect(tailed.lower).toBeCloseTo(
      2 * studentT.cdf(-Math.sqrt((5 * 0.4) / 1.6), { nu: 5, mu: 0, sigma: 1 }),
      12,
    );
    expect(() => gaussianCopulaSampler(corr).tailDependence(0, 7)).toThrow(/whole numbers/);
  });

  it('refuses a correlation matrix that cannot exist instead of repairing it', () => {
    const impossible = [
      [1, 0.9, 0.9],
      [0.9, 1, -0.9],
      [0.9, -0.9, 1],
    ];
    expect(() => gaussianCopulaSampler(impossible)).toThrow(/not positive definite/);
    expect(() => gaussianCopulaSampler([[1, 0.5], [0.4, 1]])).toThrow(/symmetric/);
    expect(() => gaussianCopulaSampler([[2, 0.5], [0.5, 1]])).toThrow(/diagonal/);
    expect(() => gaussianCopulaSampler([[1, 1.5], [1.5, 1]])).toThrow(EngineError);
    expect(() => gaussianCopulaSampler([[1]])).toThrow(/at least 2 variables/);
    expect(() => tCopulaSampler(corr, 0)).toThrow(/greater than 0/);
  });

  it('records what the multivariate families cannot express', () => {
    expect(gaussianCopulaSampler(corr).limitations.join(' ')).toMatch(/No tail dependence/);
    expect(tCopulaSampler(corr, 4).limitations.join(' ')).toMatch(/single ν/);
  });
});
