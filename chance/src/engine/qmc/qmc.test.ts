/**
 * Tests for the quasi-Monte Carlo and variance-reduction module.
 *
 * Reference values are independent of this implementation: every integral is
 * known in closed form (∫x dx, ∫x² dx, ∫4/(1+x²) dx = π, Π x_i over the cube,
 * the Genz families, a Gaussian orthant probability) and the rare-event
 * reference is normalSf from src/engine/special/gamma.ts, which is validated
 * elsewhere against SciPy. Nothing is asserted against this module's own
 * output. All seeds are fixed.
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from '../core/result';
import { normalCdf, normalSf } from '../special/gamma';
import { SOBOL_MAX_DIMENSION, sobolSequence } from './sobol';
import { haltonSequence, radicalInverse } from './halton';
import { faureSequence } from './faure';
import { latticeRule } from './lattice';
import {
  centredDiscrepancyL2,
  expectedRandomStarDiscrepancy,
  materialise,
  maxAbsPairCorrelation,
  starDiscrepancyL2,
} from './discrepancy';
import {
  allocateStrata,
  equalStrata,
  imanConover,
  latinHypercube,
  orthogonalArrayLhs,
  rankCorrelationMatrix,
  stratifiedSample,
  systematicSample,
  uniformPointSet,
} from './stratified';
import {
  antitheticVariates,
  commonRandomNumbers,
  conditionalMonteCarlo,
  controlVariates,
  fixedEffortSplitting,
  importanceSampling,
  multilevelMonteCarlo,
  plainMonteCarlo,
  plainNormalTailProbability,
  russianRoulette,
  tiltedNormalTailProbability,
} from './variance';
import { QmcStream, integrate, integrationSteps, randomisedQmcIntegrate } from './integrate';
import { TEST_INTEGRANDS, compareConvergence, fitLogLogSlope } from './convergence';

describe('Sobol sequence', () => {
  it('is perfectly balanced: the first 2^m points put exactly one point in each of the 2^m equal subintervals, in every dimension', () => {
    // This is the defining (0,m,1)-net property of each one-dimensional
    // projection of a Sobol net. It is exact arithmetic — no tolerance.
    const dimension = 10;
    for (let m = 4; m <= 10; m++) {
      const n = 2 ** m;
      const points = materialise(sobolSequence({ dimension }), n);
      for (let k = 0; k < dimension; k++) {
        const occupancy = new Int32Array(n);
        for (let i = 0; i < n; i++) {
          occupancy[Math.floor(points.values[i * dimension + k] * n)]++;
        }
        for (let b = 0; b < n; b++) {
          expect(occupancy[b], `m=${m}, dimension ${k + 1}, subinterval ${b}`).toBe(1);
        }
      }
    }
  });

  it('keeps the balance property under a random digital shift', () => {
    // A digital shift is an XOR of the bit strings, which permutes the 2^m
    // subintervals; the net property therefore survives exactly.
    const dimension = 6;
    for (let m = 5; m <= 9; m++) {
      const n = 2 ** m;
      const points = materialise(sobolSequence({ dimension, randomisation: 'digital-shift', seed: `shift-${m}` }), n);
      for (let k = 0; k < dimension; k++) {
        const occupancy = new Int32Array(n);
        for (let i = 0; i < n; i++) occupancy[Math.floor(points.values[i * dimension + k] * n)]++;
        expect(Array.from(occupancy).every((c) => c === 1), `m=${m}, dimension ${k + 1}`).toBe(true);
      }
    }
  });

  it('produces points strictly in [0,1) with no duplicates and no degenerate coordinate', () => {
    const dimension = 12;
    const n = 2048;
    const points = materialise(sobolSequence({ dimension }), n);
    const seen = new Set<string>();
    for (let i = 0; i < n; i++) {
      const row: number[] = [];
      for (let k = 0; k < dimension; k++) {
        const x = points.values[i * dimension + k];
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(1);
        row.push(x);
      }
      seen.add(row.join(','));
    }
    expect(seen.size).toBe(n);
    // No coordinate is constant, and each has mean near 1/2 (exactly 1/2 − 1/(2N)
    // for a balanced net, so the tolerance only needs to absorb that offset).
    for (let k = 0; k < dimension; k++) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += points.values[i * dimension + k];
      expect(Math.abs(sum / n - 0.5)).toBeLessThan(0.01);
    }
  });

  it('is deterministic: the same seed and randomisation reproduce identical points', () => {
    const a = materialise(sobolSequence({ dimension: 8, randomisation: 'owen', seed: 'fixed' }), 256);
    const b = materialise(sobolSequence({ dimension: 8, randomisation: 'owen', seed: 'fixed' }), 256);
    const c = materialise(sobolSequence({ dimension: 8, randomisation: 'owen', seed: 'other' }), 256);
    expect(Array.from(a.values)).toEqual(Array.from(b.values));
    expect(Array.from(a.values)).not.toEqual(Array.from(c.values));
  });

  it('supports random access consistent with sequential access', () => {
    const seq = sobolSequence({ dimension: 5 });
    const sequential: number[][] = [];
    for (let i = 0; i < 40; i++) sequential.push(Array.from(seq.point(i)));
    const fresh = sobolSequence({ dimension: 5 });
    expect(Array.from(fresh.point(37))).toEqual(sequential[37]);
    expect(Array.from(fresh.point(3))).toEqual(sequential[3]);
  });

  it('refuses a dimension beyond its direction numbers rather than fabricating one', () => {
    expect(() => sobolSequence({ dimension: SOBOL_MAX_DIMENSION + 1 })).toThrow(EngineError);
    try {
      sobolSequence({ dimension: SOBOL_MAX_DIMENSION + 1 });
    } catch (e) {
      expect((e as EngineError).message).toMatch(/direction numbers/);
    }
    expect(() => sobolSequence({ dimension: 0 })).toThrow(EngineError);
    expect(() => sobolSequence({ dimension: 4, randomisation: 'digital-shift' })).toThrow(/seed/);
  });
});

describe('Halton sequence', () => {
  it('reproduces the radical inverse by hand', () => {
    // 1/2, 1/4, 3/4 in base 2 and 1/3, 2/3, 1/9 in base 3 — arithmetic, not a fixture.
    expect(radicalInverse(1, 2)).toBeCloseTo(0.5, 15);
    expect(radicalInverse(2, 2)).toBeCloseTo(0.25, 15);
    expect(radicalInverse(3, 2)).toBeCloseTo(0.75, 15);
    expect(radicalInverse(1, 3)).toBeCloseTo(1 / 3, 15);
    expect(radicalInverse(2, 3)).toBeCloseTo(2 / 3, 15);
    expect(radicalInverse(3, 3)).toBeCloseTo(1 / 9, 15);
  });

  it('produces points strictly in [0,1) with no duplicates', () => {
    const points = materialise(haltonSequence({ dimension: 5 }), 1000);
    const seen = new Set<string>();
    for (let i = 0; i < points.count; i++) {
      const row: number[] = [];
      for (let k = 0; k < 5; k++) {
        const x = points.values[i * 5 + k];
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(1);
        row.push(x);
      }
      seen.add(row.join(','));
    }
    expect(seen.size).toBe(points.count);
  });

  it('exhibits its documented high-dimensional failure, which scrambling repairs', () => {
    // In 30+ dimensions the large prime bases agree digit-for-digit over the
    // first few hundred indices, so some coordinate pair is nearly collinear.
    // Thresholds: plain Halton exceeds 0.6 here (measured 0.77 at d=30);
    // scrambled Halton and Sobol stay below 0.3 at N=512. Generous margins,
    // because the claim being tested is a qualitative gap, not a precise value.
    const n = 512;
    const plain = maxAbsPairCorrelation(materialise(haltonSequence({ dimension: 30 }), n)).value;
    const scrambled = maxAbsPairCorrelation(
      materialise(haltonSequence({ dimension: 30, scramble: true, seed: 'halton-fix' }), n),
    ).value;
    const sobol = maxAbsPairCorrelation(materialise(sobolSequence({ dimension: 30 }), n)).value;
    expect(plain).toBeGreaterThan(0.6);
    expect(plain).toBeGreaterThan(sobol * 2);
    expect(scrambled).toBeLessThan(plain / 2);
    expect(scrambled).toBeLessThan(0.3);
  });

  it('leaps and skips without leaving [0,1)', () => {
    const points = materialise(haltonSequence({ dimension: 4, leap: 31, skip: 409 }), 300);
    for (const x of points.values) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('Faure and lattice constructions', () => {
  it('Faure base is the smallest prime at least the dimension, and digit 0 gives van der Corput', () => {
    expect(faureSequence({ dimension: 5 }).base).toBe(5);
    expect(faureSequence({ dimension: 6 }).base).toBe(7);
    expect(faureSequence({ dimension: 30 }).base).toBe(31);
    const seq = faureSequence({ dimension: 3 });
    // Coordinate 0 of a Faure sequence in base 3 is the base-3 radical inverse.
    for (const i of [1, 2, 3, 4, 10, 25]) {
      expect(seq.point(i)[0]).toBeCloseTo(radicalInverse(i, 3), 12);
    }
  });

  it('Faure points stay in [0,1) and integrate a known integral well', () => {
    const t = TEST_INTEGRANDS.product(3);
    const r = integrate({ dimension: 3, samples: 4096, integrand: t.f, sampler: { kind: 'faure' }, seed: 'f' });
    // Tolerance: 1e-3 is loose next to the measured 3e-4, and far below the
    // ~2e-3 a plain Monte Carlo run of the same size would typically show.
    expect(Math.abs(r.estimate - t.exact)).toBeLessThan(1e-3);
  });

  it('the searched lattice generating vector beats a deliberately bad one on the same criterion', () => {
    const good = latticeRule({ dimension: 4, count: 1024 });
    expect(good.figureOfMerit).toBeGreaterThan(0);
    // The CBC search minimises the shift-averaged worst-case error, so by
    // construction its merit must be no worse than the a = 1 "diagonal"
    // lattice, which is the classic pathological choice.
    const bad = latticeRule({ dimension: 4, count: 1024, candidates: 1 });
    expect(good.figureOfMerit).toBeLessThanOrEqual(bad.figureOfMerit + 1e-12);
    const points = materialise(good, 1024);
    for (const x of points.values) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('refuses a lattice point index outside the rule', () => {
    const rule = latticeRule({ dimension: 2, count: 64 });
    expect(() => rule.point(64)).toThrow(EngineError);
  });
});

describe('discrepancy', () => {
  it('ranks low-discrepancy point sets below independent uniforms', () => {
    const d = 3;
    const n = 512;
    const sobol = starDiscrepancyL2(materialise(sobolSequence({ dimension: d }), n));
    const lattice = starDiscrepancyL2(materialise(latticeRule({ dimension: d, count: n }), n));
    const randomExpected = expectedRandomStarDiscrepancy(n, d);
    // Expected L2 star discrepancy of N i.i.d. points is √((2^-d − 3^-d)/N),
    // an exact analytic value; the QMC sets must be well below it.
    expect(sobol).toBeLessThan(randomExpected / 2);
    expect(lattice).toBeLessThan(randomExpected / 2);
    // Averaging over several independent uniform sets keeps this check stable.
    let total = 0;
    for (let r = 0; r < 5; r++) total += starDiscrepancyL2(uniformPointSet(d, n, `u${r}`));
    expect(total / 5).toBeGreaterThan(sobol * 3);
  });

  it('computes the centred L2 discrepancy and refuses an oversized point set', () => {
    const points = materialise(sobolSequence({ dimension: 2 }), 256);
    expect(centredDiscrepancyL2(points)).toBeGreaterThan(0);
    expect(() => starDiscrepancyL2(points, 64)).toThrow(/O\(N²\)/);
  });
});

describe('known integrals', () => {
  const cases = [
    { name: '∫₀¹ x dx = 1/2', t: TEST_INTEGRANDS.linear },
    { name: '∫₀¹ x² dx = 1/3', t: TEST_INTEGRANDS.quadratic },
    { name: '∫₀¹ 4/(1+x²) dx = π', t: TEST_INTEGRANDS.pi },
    { name: '∫ Π x_i over [0,1]⁵ = 2⁻⁵', t: TEST_INTEGRANDS.product(5) },
    { name: 'Genz continuous, d = 3', t: TEST_INTEGRANDS.genzContinuous(3) },
    { name: 'Genz product peak, d = 2', t: TEST_INTEGRANDS.genzProductPeak(2) },
    { name: 'Genz oscillatory, d = 1', t: TEST_INTEGRANDS.genzOscillatory1d() },
  ];

  for (const { name, t } of cases) {
    it(`Sobol beats plain Monte Carlo at the same N on ${name}`, () => {
      const n = 4096;
      const sobol = integrate({ dimension: t.dimension, samples: n, integrand: t.f, sampler: { kind: 'sobol' }, seed: 'k' });
      // Averaging |error| over 8 independent Monte Carlo runs removes the
      // chance that one lucky random run beats Sobol; the claim is about the
      // typical error, so it must be tested against the typical error.
      let mcError = 0;
      const runs = 8;
      for (let r = 0; r < runs; r++) {
        const mc = integrate({
          dimension: t.dimension,
          samples: n,
          integrand: t.f,
          sampler: { kind: 'monte-carlo' },
          seed: `mc-${r}`,
        });
        mcError += Math.abs(mc.estimate - t.exact);
      }
      mcError /= runs;
      const sobolError = Math.abs(sobol.estimate - t.exact);
      // Factor 5 is far inside the measured 10×–60,000× gap on these smooth
      // integrands, but leaves room for the one-dimensional cases where the
      // Monte Carlo average happens to be small.
      expect(sobolError * 5).toBeLessThan(mcError);
    });
  }

  it('estimates a Gaussian orthant probability against the exact independent-normal value', () => {
    // P(Z₁ < 1, Z₂ < 1, Z₃ < 1) for independent standard normals is Φ(1)³.
    const exact = normalCdf(1) ** 3;
    const r = integrate({
      dimension: 3,
      samples: 8192,
      integrand: (x) => (x[0] < 1 && x[1] < 1 && x[2] < 1 ? 1 : 0),
      sampler: { kind: 'sobol', randomisation: 'digital-shift' },
      seed: 'orthant',
      marginals: [0, 1, 2].map(() => ({ distributionId: 'normal', params: { mu: 0, sigma: 1 } })),
    });
    // An indicator integrand is discontinuous, so QMC gains far less here; 0.01
    // absolute is about three Monte Carlo standard errors at this N.
    expect(Math.abs(r.estimate - exact)).toBeLessThan(0.01);
    expect(r.assumptions.join(' ')).toMatch(/independent/);
  });
});

describe('observed convergence rates', () => {
  it('measures plain Monte Carlo near N^{-1/2} and Sobol clearly steeper on a smooth integrand', () => {
    const t = TEST_INTEGRANDS.pi;
    const comparison = compareConvergence({
      dimension: 1,
      integrand: t.f,
      exactValue: t.exact,
      sampleSizes: [64, 128, 256, 512, 1024, 2048, 4096, 8192],
      seed: 'convergence',
      // 40 replications per point keeps the Monte Carlo RMSE estimate tight
      // enough that the fitted slope lands within ~0.1 of −0.5.
      replications: 40,
    });
    const byLabel = new Map(comparison.methods.map((m) => [m.label, m]));
    const mc = byLabel.get('Plain Monte Carlo');
    const sobol = byLabel.get('Sobol (unrandomised)');
    const rqmc = byLabel.get('Sobol (randomised, digital shift)');
    expect(mc && sobol && rqmc).toBeTruthy();
    if (!mc || !sobol || !rqmc) return;
    // Measured, not asserted from theory: a fitted slope within 0.12 of −0.5.
    expect(mc.fit.slope).toBeGreaterThan(-0.62);
    expect(mc.fit.slope).toBeLessThan(-0.38);
    expect(mc.fit.rSquared).toBeGreaterThan(0.9);
    // Sobol must be clearly better than N^{-1/2}; measured near −1.0.
    expect(sobol.fit.slope).toBeLessThan(-0.75);
    expect(rqmc.fit.slope).toBeLessThan(-0.75);
    expect(comparison.errorRatioAtLargestN['Sobol (unrandomised)']).toBeLessThan(0.2);
  });

  it('refuses to fit a rate from too few usable points', () => {
    expect(() => fitLogLogSlope([{ samples: 10, error: 1 }, { samples: 20, error: 0 }])).toThrow(/at least three/);
  });
});

describe('Latin hypercube and stratification', () => {
  it('occupies each of the N strata exactly once in every dimension', () => {
    const d = 6;
    const n = 97;
    const design = latinHypercube({ dimension: d, count: n, seed: 'lhs' });
    for (let k = 0; k < d; k++) {
      const occupancy = new Int32Array(n);
      for (let i = 0; i < n; i++) occupancy[Math.floor(design.values[i * d + k] * n)]++;
      expect(Array.from(occupancy).every((c) => c === 1), `dimension ${k + 1}`).toBe(true);
    }
  });

  it('has lower mean-squared error than plain Monte Carlo for a one-dimensional mean', () => {
    // ∫₀¹ e^x dx = e − 1 exactly.
    const exact = Math.E - 1;
    const f = (x: Float64Array): number => Math.exp(x[0]);
    const replications = 60;
    let lhsMse = 0;
    let mcMse = 0;
    for (let r = 0; r < replications; r++) {
      const lhs = integrate({ dimension: 1, samples: 256, integrand: f, sampler: { kind: 'lhs' }, seed: `lhs-${r}` });
      const mc = plainMonteCarlo({ integrand: f, dimension: 1, samples: 256, seed: `mc-${r}` });
      lhsMse += (lhs.estimate - exact) ** 2;
      mcMse += (mc.estimate - exact) ** 2;
    }
    // For a smooth monotone 1-D integrand LHS removes essentially all the
    // variance (measured ratio ~10^-5). A factor of 10 is a very safe floor.
    expect(lhsMse * 10).toBeLessThan(mcMse);
  });

  it('reports a conservative standard error for LHS and says so', () => {
    const r = integrate({ dimension: 1, samples: 256, integrand: (x) => Math.exp(x[0]), sampler: { kind: 'lhs' }, seed: 'lhs-se' });
    expect(r.standardError).not.toBeNull();
    expect(r.errorBasis.kind).toBe('iid');
    if (r.errorBasis.kind === 'iid') expect(r.errorBasis.note).toMatch(/CONSERVATIVE/);
  });

  it('Iman–Conover reaches the target rank correlation and keeps the Latin hypercube property', () => {
    const d = 3;
    const n = 400;
    const target = [
      [1, 0.7, -0.3],
      [0.7, 1, 0],
      [-0.3, 0, 1],
    ];
    const design = latinHypercube({ dimension: d, count: n, seed: 'ic', targetRankCorrelation: target });
    const observed = rankCorrelationMatrix(design);
    // Iman–Conover is an approximate rank-correlation restriction; 0.06 is the
    // usual working tolerance at N = 400 and is comfortably met here.
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) {
        expect(Math.abs(observed[i][j] - target[i][j]), `ρ(${i},${j})`).toBeLessThan(0.06);
      }
    }
    for (let k = 0; k < d; k++) {
      const occupancy = new Int32Array(n);
      for (let i = 0; i < n; i++) occupancy[Math.floor(design.values[i * d + k] * n)]++;
      expect(Array.from(occupancy).every((c) => c === 1)).toBe(true);
    }
  });

  it('refuses a correlation matrix that is not positive definite', () => {
    const impossible = [
      [1, 0.9, -0.9],
      [0.9, 1, 0.9],
      [-0.9, 0.9, 1],
    ];
    expect(() => latinHypercube({ dimension: 3, count: 50, seed: 'pd', targetRankCorrelation: impossible })).toThrow(
      /positive definite/,
    );
    const design = latinHypercube({ dimension: 2, count: 10, seed: 'pd2' });
    expect(() => imanConover(design, [[1, 0.5, 0], [0.5, 1, 0], [0, 0, 1]], 's')).toThrow(/2×2/);
    expect(() => imanConover(design, [[1, 0.5], [0.4, 1]], 's')).toThrow(/symmetric/);
  });

  it('builds an orthogonal-array LHS that is balanced in every two-dimensional projection', () => {
    const p = 7;
    const design = orthogonalArrayLhs({ prime: p, dimension: 4, seed: 'oa' });
    expect(design.count).toBe(p * p);
    // Strength 2: for every pair of columns, each of the p² coarse cells is hit
    // exactly once. That is the property plain LHS does not have.
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) {
        const cells = new Int32Array(p * p);
        for (let i = 0; i < design.count; i++) {
          const ia = Math.floor(design.values[i * 4 + a] * p);
          const ib = Math.floor(design.values[i * 4 + b] * p);
          cells[ia * p + ib]++;
        }
        expect(Array.from(cells).every((c) => c === 1), `columns ${a},${b}`).toBe(true);
      }
    }
    expect(() => orthogonalArrayLhs({ prime: 8, dimension: 3, seed: 'oa' })).toThrow(/prime/);
    expect(() => orthogonalArrayLhs({ prime: 3, dimension: 5, seed: 'oa' })).toThrow(/dimensions/);
  });

  it('allocates strata proportionally and by Neyman, and refuses Neyman without standard deviations', () => {
    const strata = [
      { from: 0, to: 0.5, weight: 0.5, sd: 1 },
      { from: 0.5, to: 0.8, weight: 0.3, sd: 10 },
      { from: 0.8, to: 1, weight: 0.2, sd: 1 },
    ];
    const prop = allocateStrata(strata, 100, 'proportional');
    expect(prop.counts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(prop.counts[0]).toBeGreaterThan(prop.counts[1]);
    const neyman = allocateStrata(strata, 100, 'neyman');
    expect(neyman.counts.reduce((a, b) => a + b, 0)).toBe(100);
    // W·σ is 0.5, 3.0, 0.2, so the high-variance middle stratum must dominate.
    expect(neyman.counts[1]).toBeGreaterThan(neyman.counts[0]);
    expect(neyman.counts[1]).toBeGreaterThan(60);
    expect(() => allocateStrata(equalStrata(3), 30, 'neyman')).toThrow(/standard deviation/);
  });

  it('draws stratified and systematic samples with the right balance', () => {
    const strata = equalStrata(10);
    const { values, strataIndex } = stratifiedSample(strata, new Array(10).fill(5), 'strat');
    expect(values.length).toBe(50);
    for (let i = 0; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(strata[strataIndex[i]].from);
      expect(values[i]).toBeLessThan(strata[strataIndex[i]].to);
    }
    const systematic = systematicSample(20, 'sys');
    for (let i = 1; i < 20; i++) expect(systematic[i] - systematic[i - 1]).toBeCloseTo(0.05, 12);
    expect(systematic[0]).toBeGreaterThanOrEqual(0);
    expect(systematic[19]).toBeLessThan(1);
  });
});

describe('antithetic variates', () => {
  it('reduces variance and induces a negative correlation for a monotone integrand', () => {
    const result = antitheticVariates({ integrand: (x) => 4 / (1 + x[0] * x[0]), dimension: 1, pairs: 4000, seed: 'anti' });
    expect(result.diagnostics.inducedCorrelation).toBeLessThan(-0.9);
    // Measured factor is ~64 for this integrand; 5 is a safe floor.
    expect(result.efficiency.varianceReductionFactor).toBeGreaterThan(5);
    expect(result.efficiency.effectiveSampleSizeGain).toBeGreaterThan(0);
    expect(Math.abs(result.estimate - Math.PI)).toBeLessThan(0.01);
  });

  it('reports HARM, not a win, for a symmetric non-monotone integrand', () => {
    const result = antitheticVariates({ integrand: (x) => (x[0] - 0.5) ** 2, dimension: 1, pairs: 4000, seed: 'anti' });
    // f(U) = f(1−U) exactly here, so ρ = +1 and the factor is exactly 1/2.
    expect(result.diagnostics.inducedCorrelation).toBeGreaterThan(0.99);
    expect(result.efficiency.varianceReductionFactor).toBeLessThan(1);
    expect(result.efficiency.effectiveSampleSizeGain).toBeLessThan(0);
    expect(result.warnings.join(' ')).toMatch(/HURT/);
    expect(Math.abs(result.estimate - 1 / 12)).toBeLessThan(0.002);
  });
});

describe('control variates', () => {
  it('drives the variance nearly to zero with a perfectly correlated control', () => {
    // f(x) = 2x + 1 and c(x) = x are perfectly correlated, E[c] = 1/2 exactly,
    // so the adjusted estimator is constant and the estimate is exact.
    const result = controlVariates({
      integrand: (x) => 2 * x[0] + 1,
      control: (x) => x[0],
      controlMean: 0.5,
      dimension: 1,
      samples: 4000,
      seed: 'cv',
    });
    expect(Math.abs(result.diagnostics.beta - 2)).toBeLessThan(1e-9);
    expect(result.efficiency.varianceReductionFactor).toBeGreaterThan(1e6);
    expect(Math.abs(result.estimate - 2)).toBeLessThan(1e-9);
    expect(result.warnings.join(' ')).toMatch(/bias/);
  });

  it('leaves the variance essentially unchanged, not worse, with an uncorrelated control', () => {
    const result = controlVariates({
      integrand: (x) => x[0],
      control: (x) => Math.sin(40 * x[1]),
      controlMean: 0,
      dimension: 2,
      samples: 8000,
      seed: 'cv2',
    });
    expect(Math.abs(result.diagnostics.controlCorrelation)).toBeLessThan(0.05);
    // Fitting β on noise costs an O(1/N) amount of variance, so the factor sits
    // just below or just above 1; 0.98 bounds that loss.
    expect(result.efficiency.varianceReductionFactor).toBeGreaterThan(0.98);
    expect(result.efficiency.varianceReductionFactor).toBeLessThan(1.1);
    expect(result.warnings.join(' ')).toMatch(/uncorrelated/);
  });

  it('removes the in-sample bias when a split is requested, and refuses a constant control', () => {
    const split = controlVariates({
      integrand: (x) => Math.exp(x[0]),
      control: (x) => x[0],
      controlMean: 0.5,
      dimension: 1,
      samples: 4000,
      seed: 'cv3',
      splitFraction: 0.2,
    });
    expect(split.method).toMatch(/held-out/);
    expect(split.efficiency.varianceReductionFactor).toBeGreaterThan(5);
    expect(() =>
      controlVariates({ integrand: (x) => x[0], control: () => 1, controlMean: 1, dimension: 1, samples: 100, seed: 'cv4' }),
    ).toThrow(/constant/);
  });
});

describe('importance sampling for a rare event', () => {
  const threshold = 4.5;
  // Reference value: P(Z > 4.5) = 3.3977e-6 from normalSf, which is validated
  // against SciPy elsewhere in this codebase, not against this module.
  const exact = normalSf(threshold);

  it('has the reference value this test depends on', () => {
    expect(exact).toBeCloseTo(3.3977e-6, 10);
  });

  it('plain Monte Carlo at N = 100,000 is hopeless and says "not observed" instead of returning 0', () => {
    let notObserved = 0;
    const seeds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    for (const seed of seeds) {
      const r = plainNormalTailProbability({ threshold, samples: 100_000, seed });
      if (!r.observed) {
        notObserved++;
        expect(r.successes).toBe(0);
        expect(r.message).toMatch(/NOT OBSERVED/);
        // No numeric estimate field exists on the unobserved branch at all.
        expect('estimate' in r).toBe(false);
      } else {
        // When it does see one draw, the estimate is wrong by a large factor —
        // which is the point: 1/100,000 is three times the true value.
        expect(r.successes).toBeLessThan(3);
        expect(Math.abs(r.estimate / exact - 1)).toBeGreaterThan(0.5);
      }
    }
    // Expected successes is 0.34, so most seeds must see nothing at all.
    expect(notObserved).toBeGreaterThanOrEqual(5);
  });

  it('exponentially tilted importance sampling recovers the exact value within a few per cent', () => {
    const r = tiltedNormalTailProbability({ threshold, samples: 20_000, seed: 'tilt' });
    expect(r.exactValue).toBe(exact);
    // 3% at N = 20,000; the measured relative error is 0.5%. The tolerance is
    // the task's "within a few per cent", not a fitted value.
    expect(r.relativeError).toBeLessThan(0.03);
    expect(r.degenerate).toBe(false);
    // Measured efficiency against the exact plain-MC variance p(1−p): the gain
    // is of order 1/p, tens of thousands.
    expect(r.efficiency.varianceReductionFactor).toBeGreaterThan(1000);
    expect(r.efficiency.effectiveSampleSize).toBeGreaterThan(1e7);
  });

  it('detects degenerate weights and raises a loud warning', () => {
    // A deliberately terrible proposal: estimate E[X] for X ~ Exp(1) by
    // sampling from Exp(5), whose likelihood ratio e^{4x}/5 explodes in the
    // tail, so a handful of draws carry nearly all the weight.
    const r = importanceSampling({
      samples: 5000,
      seed: 'degenerate',
      draw: (rng) => {
        const x = rng.exponential(5);
        return { value: x, logWeight: Math.log(1 / 5) + 4 * x };
      },
    });
    expect(r.degenerate).toBe(true);
    expect(r.weightEfficiency).toBeLessThan(0.1);
    expect(r.maxWeightShare).toBeGreaterThan(0.1);
    expect(r.warnings.join(' ')).toMatch(/DEGENERATE IMPORTANCE WEIGHTS/);
  });

  it('refuses a non-finite weight or too few samples', () => {
    expect(() =>
      importanceSampling({ samples: 10, seed: 'nf', draw: () => ({ value: 1, logWeight: NaN }) }),
    ).toThrow(/not finite/);
    expect(() => importanceSampling({ samples: 1, seed: 'nf', draw: () => ({ value: 1, logWeight: 0 }) })).toThrow(
      /at least 2/,
    );
  });
});

describe('conditional Monte Carlo, common random numbers and rare-event machinery', () => {
  it('Rao–Blackwellisation removes variance for a closed-form conditional expectation', () => {
    // h(U₁,U₂) = 1{U₁+U₂ < 1}; E[h | U₁] = 1 − U₁ in closed form, exact value 1/2.
    const result = conditionalMonteCarlo({
      raw: (x) => (x[0] + x[1] < 1 ? 1 : 0),
      conditional: (x) => 1 - x[0],
      dimension: 2,
      samples: 20_000,
      seed: 'cond',
    });
    expect(Math.abs(result.estimate - 0.5)).toBeLessThan(0.005);
    // Var(h) = 1/4, Var(1−U) = 1/12, so the factor is 3 in the limit.
    expect(result.efficiency.varianceReductionFactor).toBeGreaterThan(2.5);
    expect(result.warnings).toHaveLength(0);
  });

  it('flags a conditional expectation that is not the conditional expectation', () => {
    const result = conditionalMonteCarlo({
      raw: (x) => (x[0] + x[1] < 1 ? 1 : 0),
      conditional: (x) => 0.9 - x[0],
      dimension: 2,
      samples: 20_000,
      seed: 'cond2',
    });
    expect(result.warnings.join(' ')).toMatch(/disagree/);
  });

  it('common random numbers sharply reduce the variance of the estimated difference', () => {
    // Two configurations differing only in one coefficient: the shared noise
    // cancels in the difference.
    const result = commonRandomNumbers({
      configurationA: (x) => Math.exp(2 * x[0]) + x[1],
      configurationB: (x) => Math.exp(2 * x[0]) + 0.9 * x[1],
      dimension: 2,
      samples: 8000,
      seed: 'crn',
    });
    // Measured factor is several hundred; 20 is a safe floor.
    expect(result.varianceReductionFactor).toBeGreaterThan(20);
    expect(result.correlation).toBeGreaterThan(0.9);
    expect(result.standardErrorCrn).toBeLessThan(result.standardErrorIndependent);
    // The true difference is E[0.1·U] = 0.05.
    expect(Math.abs(result.differenceEstimate - 0.05)).toBeLessThan(0.002);
    expect(result.warnings).toHaveLength(0);
  });

  it('common random numbers report no benefit when the configurations are unsynchronised', () => {
    const result = commonRandomNumbers({
      configurationA: (x) => x[0],
      configurationB: (x) => x[1],
      dimension: 2,
      samples: 4000,
      seed: 'crn2',
    });
    expect(result.varianceReductionFactor).toBeLessThan(1.5);
    expect(result.warnings.join(' ')).toMatch(/no measurable benefit/);
  });

  it('Russian roulette is unbiased for a geometric series', () => {
    // Σ_{k≥0} 0.5^k = 2 exactly.
    const r = russianRoulette({ term: (k) => 0.5 ** k, survival: 0.6, samples: 40_000, seed: 'rr' });
    // Three standard errors of the measured estimate.
    expect(Math.abs(r.estimate - 2)).toBeLessThan(3 * (r.standardError ?? Infinity));
    expect(r.meanTermsEvaluated).toBeGreaterThan(1);
    expect(() => russianRoulette({ term: () => 1, survival: 1, samples: 10, seed: 'rr' })).toThrow(/strictly between/);
  });

  it('multilevel splitting estimates a rare random-walk event and refuses to multiply by zero', () => {
    // A standard normal random walk of at most 20 steps; the event is reaching
    // level 8. Levels at 2, 4, 6, 8 keep each stage probability workable.
    type State = { position: number; steps: number };
    const spec = {
      initial: () => ({ position: 0, steps: 0 }),
      advance: (s: State, rng: { normal(): number }) => ({ position: s.position + rng.normal(), steps: s.steps + 1 }),
      score: (s: State) => s.position,
      absorbed: (s: State) => s.steps >= 20,
      clone: (s: State) => ({ ...s }),
    };
    const result = fixedEffortSplitting({ spec, levels: [2, 4, 6, 8], particles: 400, seed: 'split' });
    // Independent reference: by the reflection principle, for a driftless
    // Gaussian walk P(max_{n≤20} S_n ≥ 8) ≈ 2·P(S_20 ≥ 8) = 2·(1 − Φ(8/√20)) =
    // 0.0736. The discrete walk is slightly below that continuous-time value,
    // so 25% is a generous band around an externally computed number.
    const reflection = 2 * normalSf(8 / Math.sqrt(20));
    expect(Math.abs(result.estimate / reflection - 1)).toBeLessThan(0.25);
    expect(result.stageProbabilities).toHaveLength(4);
    expect(result.warnings.join(' ')).toMatch(/optimistic/);
    // One far level with few particles must refuse rather than return 0.
    expect(() => fixedEffortSplitting({ spec, levels: [30], particles: 20, seed: 'split2' })).toThrow(/fabricated/);
  });

  it('multilevel Monte Carlo allocates by level variance and reports its cost', () => {
    // Y_0 ~ N(1, 1), Y_1 ~ N(0.1, 0.01), Y_2 ~ N(0.01, 0.0001): a converging
    // hierarchy whose exact total is 1.11.
    const means = [1, 0.1, 0.01];
    const sds = [1, 0.1, 0.01];
    const result = multilevelMonteCarlo({
      maxLevel: 2,
      sampleLevel: (l, rng) => means[l] + sds[l] * rng.normal(),
      costPerSample: (l) => 2 ** l,
      targetStandardError: 0.01,
      seed: 'mlmc',
      pilotSamples: 200,
    });
    expect(Math.abs(result.estimate - 1.11)).toBeLessThan(0.04);
    expect(result.standardError).toBeLessThan(0.015);
    // Cheap coarse level must take far more samples than the expensive fine one.
    expect(result.levels[0].samples).toBeGreaterThan(result.levels[2].samples);
    expect(result.warnings.join(' ')).toMatch(/bias/);
    expect(() =>
      multilevelMonteCarlo({
        maxLevel: 1,
        sampleLevel: (_l, rng) => rng.normal(),
        costPerSample: () => 1,
        targetStandardError: 1e-9,
        seed: 'mlmc2',
        pilotSamples: 50,
      }),
    ).toThrow(/cap/);
  });
});

describe('error estimation honesty', () => {
  it('refuses to report a standard error for unrandomised QMC', () => {
    const r = integrate({
      dimension: 2,
      samples: 1024,
      integrand: TEST_INTEGRANDS.product(2).f,
      sampler: { kind: 'sobol', randomisation: 'none' },
      seed: 'none',
    });
    expect(r.standardError).toBeNull();
    expect(r.errorBasis.kind).toBe('unavailable');
    if (r.errorBasis.kind === 'unavailable') expect(r.errorBasis.reason).toMatch(/no statistical error estimate/);
    expect(() =>
      integrate({
        dimension: 2,
        samples: 1024,
        integrand: TEST_INTEGRANDS.product(2).f,
        sampler: { kind: 'sobol', randomisation: 'none' },
        seed: 'none',
        requireStandardError: true,
      }),
    ).toThrow(/No standard error is available/);
  });

  it('also refuses for a single randomised replication, and explains the replication route', () => {
    const r = integrate({
      dimension: 2,
      samples: 1024,
      integrand: TEST_INTEGRANDS.product(2).f,
      sampler: { kind: 'sobol', randomisation: 'digital-shift' },
      seed: 'one',
    });
    expect(r.standardError).toBeNull();
    if (r.errorBasis.kind === 'unavailable') expect(r.errorBasis.reason).toMatch(/randomisedQmcIntegrate/);
  });

  it('gives a valid interval across independent randomisations that covers the exact value near the nominal rate', () => {
    const t = TEST_INTEGRANDS.pi;
    const trials = 40;
    let covered = 0;
    for (let trial = 0; trial < trials; trial++) {
      const r = randomisedQmcIntegrate(
        {
          dimension: 1,
          samples: 1024,
          integrand: t.f,
          sampler: { kind: 'sobol', randomisation: 'digital-shift' },
          seed: `rqmc-${trial}`,
        },
        16,
      );
      expect(r.errorBasis.kind).toBe('replications');
      // Student-t with 15 degrees of freedom, 95% two-sided: 2.131.
      if (Math.abs(r.estimate - t.exact) <= 2.131 * r.standardError) covered++;
    }
    // Nominal coverage is 0.95. With 40 trials the binomial standard error on
    // the observed rate is about 0.035, so 0.80 is roughly four standard
    // errors below nominal — a failure here means the error estimate is broken,
    // not unlucky. (RQMC error distributions are not exactly normal, so some
    // undercoverage is expected and permitted.)
    expect(covered / trials).toBeGreaterThanOrEqual(0.8);
    expect(() =>
      randomisedQmcIntegrate(
        { dimension: 1, samples: 64, integrand: t.f, sampler: { kind: 'sobol' }, seed: 'few' },
        1,
      ),
    ).toThrow(/at least 2/);
  });

  it('warns when too few randomisations are used', () => {
    const t = TEST_INTEGRANDS.linear;
    const r = randomisedQmcIntegrate(
      { dimension: 1, samples: 256, integrand: t.f, sampler: { kind: 'sobol', randomisation: 'owen' }, seed: 'few2' },
      4,
    );
    expect(r.warnings.join(' ')).toMatch(/at least 8/);
    expect(r.replicateEstimates).toHaveLength(4);
  });
});

describe('the integrator as a cancellable generator', () => {
  it('yields more than once and is deterministic for a fixed seed', () => {
    const t = TEST_INTEGRANDS.quadratic;
    const run = (): { yields: number; estimate: number } => {
      const steps = integrationSteps({
        dimension: 1,
        samples: 4096,
        integrand: t.f,
        sampler: { kind: 'sobol', randomisation: 'digital-shift' },
        seed: 'gen',
        chunkSize: 512,
      });
      let yields = 0;
      let next = steps.next();
      while (!next.done) {
        yields++;
        next = steps.next();
      }
      return { yields, estimate: next.value.estimate };
    };
    const a = run();
    const b = run();
    expect(a.yields).toBe(8);
    expect(b.estimate).toBe(a.estimate);
    expect(Math.abs(a.estimate - t.exact)).toBeLessThan(1e-4);
  });

  it('cancels between chunks and marks the result partial', () => {
    const steps = integrationSteps(
      {
        dimension: 2,
        samples: 8192,
        integrand: TEST_INTEGRANDS.product(2).f,
        sampler: { kind: 'sobol' },
        seed: 'cancel',
        chunkSize: 1024,
      },
      { isCancelled: () => true },
    );
    const first = steps.next();
    expect(first.done).toBe(false);
    const finished = steps.next();
    expect(finished.done).toBe(true);
    if (!finished.done) return;
    expect(finished.value.partial).toBe(true);
    expect(finished.value.samples).toBe(1024);
    expect(finished.value.warnings.join(' ')).toMatch(/cancelled/);
  });

  it('reports progress', () => {
    const seen: number[] = [];
    integrate(
      {
        dimension: 1,
        samples: 1000,
        integrand: TEST_INTEGRANDS.linear.f,
        sampler: { kind: 'monte-carlo' },
        seed: 'prog',
        chunkSize: 250,
      },
      { onProgress: (p) => seen.push(p.completed) },
    );
    expect(seen).toEqual([250, 500, 750, 1000]);
  });
});

describe('refusals', () => {
  it('refuses zero samples rather than returning an estimate of zero', () => {
    expect(() =>
      integrate({ dimension: 1, samples: 0, integrand: TEST_INTEGRANDS.linear.f, sampler: { kind: 'monte-carlo' }, seed: 'z' }),
    ).toThrow(/not an estimate of zero/);
  });

  it('refuses a non-finite integrand value and names the problem', () => {
    expect(() =>
      integrate({
        dimension: 1,
        samples: 64,
        integrand: (x) => (x[0] < 2 ? NaN : 1),
        sampler: { kind: 'monte-carlo' },
        seed: 'nan',
      }),
    ).toThrow(/NaN/);
    expect(() =>
      integrate({
        dimension: 1,
        samples: 64,
        integrand: () => Infinity,
        sampler: { kind: 'sobol' },
        seed: 'inf',
      }),
    ).toThrow(/no substitute will be used/);
    expect(() =>
      plainMonteCarlo({ integrand: () => NaN, dimension: 1, samples: 10, seed: 'nan2' }),
    ).toThrow(EngineError);
  });

  it('refuses a dimension beyond the Sobol direction numbers through the integrator too', () => {
    expect(() =>
      integrate({
        dimension: SOBOL_MAX_DIMENSION + 5,
        samples: 64,
        integrand: () => 1,
        sampler: { kind: 'sobol' },
        seed: 'big',
      }),
    ).toThrow(/direction numbers/);
  });

  it('refuses a marginal list that does not match the dimension, and an odd antithetic count', () => {
    expect(() =>
      integrate({
        dimension: 2,
        samples: 64,
        integrand: () => 1,
        sampler: { kind: 'monte-carlo' },
        seed: 'm',
        marginals: [{ distributionId: 'normal', params: { mu: 0, sigma: 1 } }],
      }),
    ).toThrow(/One marginal distribution per dimension/);
    expect(() =>
      integrate({ dimension: 1, samples: 63, integrand: () => 1, sampler: { kind: 'antithetic' }, seed: 'odd' }),
    ).toThrow(/even number/);
  });
});

describe('QmcStream, the adapter that refuses to be a random stream', () => {
  it('hands out exactly the dimension of coordinates per trial and then refuses', () => {
    const stream = new QmcStream(sobolSequence({ dimension: 3 }), 10);
    stream.startTrial();
    const first = [stream.next(), stream.next(), stream.next()];
    expect(first.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(() => stream.next()).toThrow(/not a random stream/);
    expect(stream.consumed).toBe(3);
  });

  it('refuses to run past the trial count it was built for', () => {
    const stream = new QmcStream(sobolSequence({ dimension: 2 }), 2);
    stream.startTrial();
    stream.startTrial();
    expect(() => stream.startTrial()).toThrow(/built for 2 trials/);
  });

  it('reproduces the sequence it wraps', () => {
    const seq = sobolSequence({ dimension: 2, randomisation: 'digital-shift', seed: 'stream' });
    const expected = seq.point(0);
    const stream = new QmcStream(sobolSequence({ dimension: 2, randomisation: 'digital-shift', seed: 'stream' }), 4);
    stream.startTrial();
    expect(stream.next()).toBe(expected[0]);
    expect(stream.next()).toBe(expected[1]);
  });
});
