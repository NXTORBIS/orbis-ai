/**
 * Tests for the portfolio / aggregate risk module.
 *
 * Reference values are independent of the implementation: closed-form normal
 * formulas evaluated directly from normalQuantile/normalPdf inside the test,
 * analytic aggregate distributions (normal + normal = normal, Poisson +
 * Poisson = Poisson, gamma + gamma = gamma at a common scale), the textbook
 * two-asset minimum-variance formula, exact theorems (comonotonic additivity,
 * Euler additivity, Shapley efficiency), and hand-computed paths.
 *
 * Every Monte Carlo tolerance is justified where it appears. All randomness is
 * seeded.
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from '../core/result';
import { normalPdf, normalQuantile } from '../special/gamma';
import { Random, Xoshiro128 } from '../random/rng';
import { sortedCopy } from '../stats/descriptive';
import type { Matrix } from '../stats/linalg';

import {
  applyWeights,
  empiricalEs,
  empiricalExpectile,
  empiricalVar,
  quantileIntegralWeights,
  sampleMean,
} from './empirical';
import {
  closedFormNormalRisk,
  constructVarSubadditivityCounterexample,
  esMeasure,
  expectileMeasure,
  findVarSubadditivityViolation,
  getRiskMeasure,
  proportionalHazardsMeasure,
  RISK_MEASURES,
  varMeasure,
  wangTransformMeasure,
} from './measures';
import { comonotonicSumLaw, lawEs, lawVar, makeLaw } from './discrete';
import { distributionMarginal, marginalRisk, sampleMarginal, type Marginal } from './marginal';
import {
  aggregateBounds,
  aggregateComonotonic,
  aggregateCountermonotonic,
  aggregateIndependent,
  aggregateUnknownDependence,
  compareDependenceAssumptions,
} from './aggregate';
import {
  componentValueAtRisk,
  eulerAllocation,
  gaussianEulerAllocation,
  incrementalRiskContributions,
  makeScenarioSet,
  portfolioLosses,
  shapleyAllocation,
} from './allocation';
import {
  analyticEfficientFrontier,
  constrainedMeanVariance,
  estimateMoments,
  estimationErrorStudy,
  ledoitWolfShrinkage,
  minimumCvarPortfolio,
  resolveConstraints,
  riskParityPortfolio,
  targetReturnPortfolio,
} from './optimise';
import {
  backtestVar,
  cornishFisherQuantiles,
  drawdownAnalysis,
  esBacktestZ2,
  expectedMaximumDrawdownDriftless,
  kupiecTest,
  reverseStressTest,
  scenarioAggregate,
  scenarioAggregationSteps,
  stressTest,
} from './scenario';
import { checkCovariance, quadraticForm } from './numerics';

function rng(seed: string): Random {
  return new Random(new Xoshiro128(seed));
}

function normalSample(n: number, mu: number, sigma: number, seed: string): number[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => mu + sigma * r.normal());
}

/* ================================================================== *
 * Closed-form normal risk measures                                    *
 * ================================================================== */

describe('closed-form normal risk measures', () => {
  it('matches VaR = μ + σΦ⁻¹(α) and ES = μ + σφ(Φ⁻¹(α))/(1−α) exactly', () => {
    for (const [mu, sigma] of [
      [0, 1],
      [-3.5, 0.25],
      [120, 17],
      [1e4, 2.5e3],
    ] as [number, number][]) {
      for (const level of [0.5, 0.9, 0.95, 0.99, 0.999]) {
        // Reference computed here, directly from the definitions.
        const z = normalQuantile(level);
        const expectedVar = mu + sigma * z;
        const expectedEs = mu + (sigma * normalPdf(z)) / (1 - level);
        const got = closedFormNormalRisk(mu, sigma, level);
        expect(got.valueAtRisk).toBeCloseTo(expectedVar, 10);
        expect(Math.abs(got.expectedShortfall - expectedEs)).toBeLessThan(1e-10 * Math.max(1, Math.abs(expectedEs)));
        expect(got.exactness).toBe('exact');
        // ES is strictly above VaR at every level, always.
        expect(got.expectedShortfall).toBeGreaterThan(got.valueAtRisk);
      }
    }
  });

  it('refuses a non-positive standard deviation and a level outside (0, 1)', () => {
    expect(() => closedFormNormalRisk(0, 0, 0.95)).toThrow(EngineError);
    expect(() => closedFormNormalRisk(0, 1, 0)).toThrow(/greater than 0 and less than 1/);
    expect(() => closedFormNormalRisk(0, 1, 1)).toThrow(EngineError);
    expect(() => closedFormNormalRisk(0, 1, 1.2)).toThrow(EngineError);
  });

  it('the empirical ES is the exact quantile integral, not the average of the ⌈n(1−α)⌉ worst', () => {
    // n = 10, α = 0.95: the tail (0.95, 1] covers half of the top order
    // statistic's cell only, so ES = x_(10). With α = 0.93 it is a mixture.
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const sorted = sortedCopy(x);
    expect(empiricalEs(sorted, 0.95)).toBeCloseTo(10, 12);
    // α = 0.93 → (0.93, 1] = 0.02 of cell 10 ... wait: cell 10 is (0.9, 1].
    // overlap = 0.07 of width 0.07 → ES = 10 exactly as well.
    expect(empiricalEs(sorted, 0.93)).toBeCloseTo(10, 12);
    // α = 0.85 → (0.85,0.9] gives 0.05 weight to x=9 and 0.1 to x=10.
    expect(empiricalEs(sorted, 0.85)).toBeCloseTo((0.05 * 9 + 0.1 * 10) / 0.15, 12);
    // VaR is an actual order statistic.
    expect(empiricalVar(sorted, 0.95)).toBe(10);
    expect(empiricalVar(sorted, 0.85)).toBe(9);
  });
});

/* ================================================================== *
 * Comonotonic additivity — the cleanest exact test                    *
 * ================================================================== */

describe('comonotonic aggregation', () => {
  const marginals: Marginal[] = [
    distributionMarginal('A', 'normal', { mu: 10, sigma: 3 }),
    distributionMarginal('B', 'normal', { mu: -2, sigma: 7 }),
    distributionMarginal('C', 'lognormal', { mu: 1, sigma: 0.5 }),
    distributionMarginal('D', 'gamma', { k: 3, theta: 2 }),
  ];

  it('adds VaR and ES of the marginals exactly', () => {
    const levels = [0.8, 0.9, 0.95, 0.99, 0.995];
    const agg = aggregateComonotonic(marginals, levels);
    levels.forEach((level, i) => {
      const parts = marginals.map((m) => marginalRisk(m, level));
      const sumVar = parts.reduce((a, p) => a + p.valueAtRisk, 0);
      const sumEs = parts.reduce((a, p) => a + p.expectedShortfall, 0);
      expect(Math.abs(agg.rows[i].valueAtRisk! - sumVar)).toBeLessThan(1e-10 * Math.max(1, Math.abs(sumVar)));
      expect(Math.abs(agg.rows[i].expectedShortfall! - sumEs)).toBeLessThan(1e-10 * Math.max(1, Math.abs(sumEs)));
      expect(agg.rows[i].diversificationBenefitEs).toBe(0);
    });
    expect(agg.dependenceAssumption).toMatch(/COMONOTONIC/);
  });

  it('builds the comonotonic sum law so that quantiles add, for discrete marginals', () => {
    // Independent of the aggregation code above: construct the comonotonic
    // coupling explicitly and check the quantile identity.
    const a = makeLaw([0, 1, 2, 5], [0.4, 0.3, 0.2, 0.1]);
    const b = makeLaw([-3, 0, 4], [0.5, 0.25, 0.25]);
    const c = makeLaw([10, 20], [0.9, 0.1]);
    const sum = comonotonicSumLaw([a, b, c]);
    for (const alpha of [0.05, 0.3, 0.4, 0.5, 0.7, 0.9, 0.95, 0.99]) {
      expect(lawVar(sum, alpha)).toBeCloseTo(lawVar(a, alpha) + lawVar(b, alpha) + lawVar(c, alpha), 10);
      expect(lawEs(sum, alpha)).toBeCloseTo(lawEs(a, alpha) + lawEs(b, alpha) + lawEs(c, alpha), 9);
    }
  });

  it('is labelled exact for normal marginals and numerical when a marginal is inverted numerically', () => {
    expect(aggregateComonotonic([marginals[0], marginals[1]], [0.95]).exactness).toBe('exact');
    expect(aggregateComonotonic(marginals, [0.95]).exactness).toBe('numerical');
  });
});

/* ================================================================== *
 * Subadditivity: ES holds, VaR fails                                  *
 * ================================================================== */

describe('subadditivity', () => {
  it('ES is subadditive across many random portfolio pairs', () => {
    const r = rng('es-subadditivity');
    let pairs = 0;
    for (let trial = 0; trial < 120; trial++) {
      const n = 200;
      const x = new Array<number>(n);
      const y = new Array<number>(n);
      const shape = trial % 4;
      for (let i = 0; i < n; i++) {
        const z1 = r.normal();
        const z2 = r.normal();
        // A spread of marginal shapes and a spread of dependence, including
        // strongly positive and strongly negative association.
        const rho = -0.95 + (1.9 * (trial % 10)) / 9;
        const w = rho * z1 + Math.sqrt(1 - rho * rho) * z2;
        x[i] = shape === 0 ? z1 : shape === 1 ? Math.exp(z1) : shape === 2 ? z1 * z1 * z1 : Math.abs(z1) ** 1.5;
        y[i] = shape === 0 ? 3 * w - 1 : shape === 1 ? Math.exp(0.5 * w) : shape === 2 ? w * 5 : Math.abs(w) ** 2;
      }
      const sum = x.map((v, i) => v + y[i]);
      for (const level of [0.8, 0.9, 0.95, 0.99]) {
        const es = esMeasure(level);
        const lhs = es.evaluate(sortedCopy(sum));
        const rhs = es.evaluate(sortedCopy(x)) + es.evaluate(sortedCopy(y));
        // Exact inequality; the tolerance is only for floating-point addition.
        expect(lhs).toBeLessThanOrEqual(rhs + 1e-9 * Math.max(1, Math.abs(rhs)));
        pairs++;
      }
    }
    expect(pairs).toBe(480);
  });

  it('constructs an exact VaR counterexample in which diversification raises VaR', () => {
    const ce = constructVarSubadditivityCounterexample();
    expect(ce.varX).toBe(0);
    expect(ce.varY).toBe(0);
    expect(ce.varSum).toBe(100);
    expect(ce.varExcess).toBeGreaterThan(0);
    // ES does not violate subadditivity on the same pair.
    expect(ce.esSum).toBeLessThanOrEqual(ce.esX + ce.esY + 1e-12);
    expect(ce.esSlack).toBeGreaterThan(0);
    expect(ce.verified).toBe(true);
    expect(ce.exactness).toBe('exact');
    // Generic, not a single lucky parameter choice.
    for (const [p, level] of [
      [0.02, 0.97],
      [0.05, 0.93],
      [0.01, 0.99],
    ] as [number, number][]) {
      const other = constructVarSubadditivityCounterexample({ lossProbability: p, level, lossSize: 40 });
      expect(other.varSum).toBeGreaterThan(other.varX + other.varY);
      expect(other.esSum).toBeLessThanOrEqual(other.esX + other.esY + 1e-12);
    }
    // The construction refuses parameter combinations where it does not work,
    // instead of returning a non-example.
    expect(() => constructVarSubadditivityCounterexample({ lossProbability: 0.4, level: 0.99 })).toThrow(/needs 1 − p ≥ α/);
    expect(() => constructVarSubadditivityCounterexample({ lossProbability: 0.001, level: 0.99 })).toThrow(/needs \(1 − p\)² < α/);
  });

  it('finds a genuine VaR violation in sample data and verifies it numerically', () => {
    // Two exposures that are usually harmless and occasionally catastrophic.
    const r = rng('violation-finder');
    const build = (): number[] =>
      Array.from({ length: 100 }, () => (r.uniform() < 0.03 ? 100 + 5 * r.normal() : r.uniform()));
    const report = findVarSubadditivityViolation({ x: build(), y: build(), coupling: 'independent' });
    expect(report.violationFound).toBe(true);
    expect(report.esViolationFound).toBe(false);
    const worst = report.worst!;
    // Verify the violation directly from the numbers in the report.
    expect(worst.riskSum).toBeGreaterThan(worst.sumOfRisks);
    expect(worst.excess).toBeGreaterThan(0);
    expect(report.dependenceAssumption).toMatch(/independent coupling/);
  });

  it('reports the axioms each measure satisfies, with VaR not subadditive and ES coherent', () => {
    expect(varMeasure(0.95).axioms.subadditive).toBe(false);
    expect(varMeasure(0.95).axioms.coherent).toBe(false);
    expect(varMeasure(0.95).elicitable).toBe(true);
    expect(esMeasure(0.95).axioms.subadditive).toBe(true);
    expect(esMeasure(0.95).axioms.coherent).toBe(true);
    expect(esMeasure(0.95).elicitable).toBe(false);
    expect(esMeasure(0.95).elicitabilityNote).toMatch(/jointly elicitable/);
    expect(expectileMeasure(0.95).axioms.coherent).toBe(true);
    expect(expectileMeasure(0.95).elicitable).toBe(true);
    expect(expectileMeasure(0.3).axioms.coherent).toBe(false);
    // Every registered measure can be created with its defaults and evaluated.
    const sample = sortedCopy(normalSample(500, 0, 1, 'registry'));
    for (const def of RISK_MEASURES) {
      const m = def.create();
      expect(Number.isFinite(m.evaluate(sample))).toBe(true);
      expect(typeof m.backtestNote).toBe('string');
    }
    expect(RISK_MEASURES.map((d) => d.id).sort()).toEqual(
      ['entropic', 'es', 'expectile', 'meanSd', 'meanSemideviation', 'medianShortfall', 'ph', 'rvar', 'var', 'wang'].sort(),
    );
    expect(() => getRiskMeasure('nope')).toThrow(/Unknown risk measure/);
  });

  it('spectral measures integrate to the total weight, so they are averages of quantiles', () => {
    for (const m of [esMeasure(0.9), wangTransformMeasure(0.4), proportionalHazardsMeasure(3)]) {
      const w = m.spectralWeights(1000)!;
      let total = 0;
      for (let i = 0; i < w.length; i++) {
        total += w[i];
        expect(w[i]).toBeGreaterThanOrEqual(0);
      }
      expect(total).toBeCloseTo(1, 10);
      // A coherent distortion puts non-decreasing weight on worse outcomes.
      for (let i = 1; i < w.length; i++) expect(w[i]).toBeGreaterThanOrEqual(w[i - 1] - 1e-12);
    }
    // A constant loss is measured as itself by any of them (normalisation).
    const flat = Float64Array.from(new Array<number>(500).fill(7));
    for (const m of [esMeasure(0.95), wangTransformMeasure(1), proportionalHazardsMeasure(2)]) {
      expect(m.evaluate(flat)).toBeCloseTo(7, 10);
    }
  });
});

/* ================================================================== *
 * Independence: exact convolution against analytic aggregates          *
 * ================================================================== */

describe('independent aggregation', () => {
  it('matches the analytic normal aggregate (σ² adds)', () => {
    const a = distributionMarginal('A', 'normal', { mu: 5, sigma: 2 });
    const b = distributionMarginal('B', 'normal', { mu: -1, sigma: 3 });
    const levels = [0.9, 0.95, 0.99];
    const agg = aggregateIndependent([a, b], levels, { resolution: 400 });
    const sumSigma = Math.sqrt(2 * 2 + 3 * 3);
    levels.forEach((level, i) => {
      const exact = closedFormNormalRisk(4, sumSigma, level);
      // The lattice step is σ_min/400 = 0.005, so a quantile is accurate to
      // about half a step per marginal: 5e-3 is a generous bound on that.
      expect(agg.rows[i].valueAtRisk!).toBeCloseTo(exact.valueAtRisk, 2);
      expect(Math.abs(agg.rows[i].valueAtRisk! - exact.valueAtRisk)).toBeLessThan(5e-3);
      expect(Math.abs(agg.rows[i].expectedShortfall! - exact.expectedShortfall)).toBeLessThan(5e-3);
      // Diversification is real under independence: σ₁ + σ₂ = 5 > √13.
      expect(agg.rows[i].diversificationBenefitEs!).toBeGreaterThan(0);
    });
    expect(agg.mean).toBeCloseTo(4, 6);
    expect(agg.exactness).toBe('numerical');
  });

  it('matches the analytic Poisson aggregate exactly (λ adds)', () => {
    const a = distributionMarginal('A', 'poisson', { lambda: 3 });
    const b = distributionMarginal('B', 'poisson', { lambda: 7.5 });
    const c = distributionMarginal('C', 'poisson', { lambda: 1.25 });
    const levels = [0.5, 0.9, 0.95, 0.99, 0.999];
    const agg = aggregateIndependent([a, b, c], levels);
    expect(agg.exactness).toBe('exact');
    const total = distributionMarginal('total', 'poisson', { lambda: 11.75 });
    levels.forEach((level, i) => {
      // Reference: the exact law of a Poisson(11.75), independent of the
      // convolution code.
      const ref = marginalRisk(total, level);
      expect(ref.exactness).toBe('exact');
      expect(agg.rows[i].valueAtRisk!).toBe(ref.valueAtRisk);
      // Both sides truncate each Poisson support where the remaining
      // probability falls below 1e-14 and renormalise, which leaves a relative
      // difference of that order amplified by the tail weighting; 1e-7 bounds it.
      expect(Math.abs(agg.rows[i].expectedShortfall! - ref.expectedShortfall)).toBeLessThan(1e-7 * Math.max(1, ref.expectedShortfall));
    });
    expect(agg.mean).toBeCloseTo(11.75, 8);
  });

  it('matches the analytic gamma aggregate at a common scale (shapes add)', () => {
    const a = distributionMarginal('A', 'gamma', { k: 2, theta: 1.5 });
    const b = distributionMarginal('B', 'gamma', { k: 3.5, theta: 1.5 });
    const levels = [0.9, 0.95, 0.99];
    const agg = aggregateIndependent([a, b], levels, { resolution: 500 });
    const total = distributionMarginal('total', 'gamma', { k: 5.5, theta: 1.5 });
    levels.forEach((level, i) => {
      const ref = marginalRisk(total, level);
      // Lattice step = sd_min/500 = (1.5·√2)/500 ≈ 0.0042; 0.02 is a loose
      // bound covering the discretisation of both marginals.
      expect(Math.abs(agg.rows[i].valueAtRisk! - ref.valueAtRisk)).toBeLessThan(0.02);
      expect(Math.abs(agg.rows[i].expectedShortfall! - ref.expectedShortfall)).toBeLessThan(0.02);
    });
  });

  it('agrees with a simulated independent route within Monte Carlo error', () => {
    const a = distributionMarginal('A', 'normal', { mu: 0, sigma: 1 });
    const b = distributionMarginal('B', 'normal', { mu: 0, sigma: 1 });
    const exactAgg = aggregateIndependent([a, b], [0.95], { resolution: 300 });
    const r = rng('independent-simulation');
    const n = 400_000;
    const sims = new Float64Array(n);
    for (let i = 0; i < n; i++) sims[i] = r.normal() + r.normal();
    const sorted = sortedCopy(sims);
    const simEs = empiricalEs(sorted, 0.95);
    const exactEs = closedFormNormalRisk(0, Math.SQRT2, 0.95).expectedShortfall;
    // ES standard error ≈ sd(tail)/√(n(1−α)) ≈ 0.78/√20000 ≈ 0.0055; 4 SE.
    expect(Math.abs(simEs - exactEs)).toBeLessThan(0.025);
    expect(Math.abs(exactAgg.rows[0].expectedShortfall! - exactEs)).toBeLessThan(0.01);
  });
});

/* ================================================================== *
 * Fréchet–Hoeffding bounds bracket everything                         *
 * ================================================================== */

describe('Fréchet–Hoeffding bounds', () => {
  it('bracket the independent and comonotonic results for many configurations', () => {
    const configs: Marginal[][] = [
      [distributionMarginal('a', 'normal', { mu: 0, sigma: 1 }), distributionMarginal('b', 'normal', { mu: 0, sigma: 1 })],
      [distributionMarginal('a', 'normal', { mu: 3, sigma: 2 }), distributionMarginal('b', 'normal', { mu: -5, sigma: 0.5 })],
      [distributionMarginal('a', 'gamma', { k: 2, theta: 1 }), distributionMarginal('b', 'gamma', { k: 4, theta: 1 })],
      [distributionMarginal('a', 'lognormal', { mu: 0, sigma: 0.4 }), distributionMarginal('b', 'lognormal', { mu: 0.5, sigma: 0.3 })],
      [distributionMarginal('a', 'exponential', { lambda: 2 }), distributionMarginal('b', 'exponential', { lambda: 0.5 })],
      [
        distributionMarginal('a', 'normal', { mu: 1, sigma: 1 }),
        distributionMarginal('b', 'gamma', { k: 3, theta: 1 }),
        distributionMarginal('c', 'lognormal', { mu: 0, sigma: 0.5 }),
      ],
      [distributionMarginal('a', 'poisson', { lambda: 5 }), distributionMarginal('b', 'poisson', { lambda: 2 })],
      [distributionMarginal('a', 'uniform', { a: 0, b: 10 }), distributionMarginal('b', 'uniform', { a: -5, b: 5 })],
    ];
    let checks = 0;
    for (const marginals of configs) {
      for (const level of [0.9, 0.95, 0.99]) {
        const bounds = aggregateBounds(marginals, level);
        const como = aggregateComonotonic(marginals, [level]).rows[0];
        const ind = aggregateIndependent(marginals, [level], { resolution: 150 }).rows[0];
        const tol = 1e-6 * Math.max(1, Math.abs(bounds.varUpper));
        // ES ordering: mean ≤ independent ≤ comonotonic = upper bound.
        expect(bounds.esLower).toBeLessThanOrEqual(ind.expectedShortfall! + tol);
        expect(ind.expectedShortfall!).toBeLessThanOrEqual(como.expectedShortfall! + 1e-2);
        expect(como.expectedShortfall!).toBeLessThanOrEqual(bounds.esUpper + tol);
        // VaR ordering: lower bound ≤ independent ≤ comonotonic ≤ upper bound.
        expect(bounds.varLower).toBeLessThanOrEqual(ind.valueAtRisk! + tol);
        expect(ind.valueAtRisk!).toBeLessThanOrEqual(como.valueAtRisk! + 1e-2);
        expect(como.valueAtRisk!).toBeLessThanOrEqual(bounds.varUpper + tol);
        // The upper VaR bound is above VaR because ES dominates VaR.
        expect(bounds.varUpper).toBeGreaterThanOrEqual(bounds.varLower);
        checks++;
      }
    }
    expect(checks).toBe(24);
  });

  it('returns bounds and no point figure when dependence is unknown', () => {
    const marginals = [
      distributionMarginal('a', 'normal', { mu: 0, sigma: 1 }),
      distributionMarginal('b', 'normal', { mu: 0, sigma: 1 }),
    ];
    const res = aggregateUnknownDependence(marginals, [0.95, 0.99]);
    expect(res.dependenceAssumption).toMatch(/UNKNOWN DEPENDENCE/);
    for (const row of res.rows) {
      expect(row.valueAtRisk).toBeNull();
      expect(row.expectedShortfall).toBeNull();
      expect(row.varBounds.lower).toBeLessThan(row.varBounds.upper);
      expect(row.esBounds.lower).toBeLessThan(row.esBounds.upper);
    }
  });

  it('places the countermonotonic result below the independent one, and refuses three exposures', () => {
    const a = distributionMarginal('a', 'normal', { mu: 0, sigma: 1 });
    const b = distributionMarginal('b', 'normal', { mu: 0, sigma: 1 });
    const counter = aggregateCountermonotonic([a, b], [0.95]);
    const ind = aggregateIndependent([a, b], [0.95], { resolution: 300 });
    // Perfect negative dependence of two identical normals gives the constant 0.
    expect(Math.abs(counter.rows[0].expectedShortfall!)).toBeLessThan(1e-3);
    expect(counter.rows[0].expectedShortfall!).toBeLessThan(ind.rows[0].expectedShortfall!);
    expect(() => aggregateCountermonotonic([a, b, a], [0.95])).toThrow(/only defined for two exposures/);
  });

  it('compares every assumption at once and confirms the ordering', () => {
    const marginals = [
      distributionMarginal('a', 'gamma', { k: 2, theta: 3 }),
      distributionMarginal('b', 'gamma', { k: 5, theta: 1 }),
    ];
    const cmp = compareDependenceAssumptions(marginals, [0.95], {
      independence: { resolution: 150 },
      correlation: [
        [1, 0.6],
        [0.6, 1],
      ],
      trials: 20_000,
      seed: 'compare',
    });
    expect(cmp.orderingHolds).toBe(true);
    const kinds = cmp.results.map((r) => r.dependenceKind);
    expect(kinds).toContain('unknown');
    expect(kinds).toContain('comonotonic');
    expect(kinds).toContain('independence');
    expect(kinds).toContain('correlation');
    const gauss = cmp.results.find((r) => r.dependenceKind === 'correlation')!;
    // A simulated aggregate reports estimation uncertainty SEPARATELY from the
    // measure itself.
    const est = gauss.rows[0].estimation!;
    expect(est.trials).toBe(20_000);
    expect(est.esStandardError).toBeGreaterThan(0);
    expect(est.esInterval95!.low).toBeLessThan(gauss.rows[0].expectedShortfall!);
    expect(est.esInterval95!.high).toBeGreaterThan(gauss.rows[0].expectedShortfall!);
    expect(gauss.exactness).toBe('empirical');
    // Positive correlation sits between independence and comonotonicity.
    const ind = cmp.results.find((r) => r.dependenceKind === 'independence')!;
    const como = cmp.results.find((r) => r.dependenceKind === 'comonotonic')!;
    expect(gauss.rows[0].expectedShortfall!).toBeGreaterThan(ind.rows[0].expectedShortfall! - 0.05);
    expect(gauss.rows[0].expectedShortfall!).toBeLessThan(como.rows[0].expectedShortfall! + 0.05);
  });

  it('refuses an invalid correlation matrix, naming the eigenvalue', () => {
    const marginals = [
      distributionMarginal('a', 'normal', { mu: 0, sigma: 1 }),
      distributionMarginal('b', 'normal', { mu: 0, sigma: 1 }),
      distributionMarginal('c', 'normal', { mu: 0, sigma: 1 }),
    ];
    const bad: Matrix = [
      [1, 0.9, -0.9],
      [0.9, 1, 0.9],
      [-0.9, 0.9, 1],
    ];
    expect(() => compareDependenceAssumptions(marginals, [0.95], { correlation: bad, trials: 2000 })).toThrow(/not positive definite/);
    expect(() => checkCovariance(bad, 'correlation matrix')).toThrow(/smallest eigenvalue is -/);
  });
});

/* ================================================================== *
 * Allocation                                                          *
 * ================================================================== */

describe('risk allocation', () => {
  function scenarioMatrix(n: number, seed: string): number[][] {
    const r = rng(seed);
    return Array.from({ length: n }, () => {
      const common = r.normal();
      return [
        0.6 * common + 0.8 * r.normal(),
        1.5 * common + 1.0 * r.normal() + 0.2,
        0.2 * common + 2.0 * r.normal() - 0.1,
      ];
    });
  }

  it('Euler/component ES allocations sum exactly to the portfolio ES', () => {
    const set = makeScenarioSet(scenarioMatrix(5000, 'euler'), ['Credit', 'Market', 'Operational']);
    for (const weights of [
      [1, 1, 1],
      [0.5, 0.3, 0.2],
      [2, -1, 0.5],
    ]) {
      for (const level of [0.9, 0.95, 0.99]) {
        const alloc = eulerAllocation(set, weights, esMeasure(level));
        expect(Math.abs(alloc.residual)).toBeLessThan(1e-8 * Math.max(1, Math.abs(alloc.total)));
        expect(alloc.share.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 8);
      }
    }
  });

  it('allocates spectral measures other than ES, and refuses measures with no gradient', () => {
    const set = makeScenarioSet(scenarioMatrix(2000, 'euler-spectral'));
    for (const m of [wangTransformMeasure(0.5), proportionalHazardsMeasure(2), getRiskMeasure('rvar', { alpha: 0.9, beta: 0.99 })]) {
      const alloc = eulerAllocation(set, [1, 1, 1], m);
      expect(Math.abs(alloc.residual)).toBeLessThan(1e-8 * Math.max(1, Math.abs(alloc.total)));
    }
    expect(() => eulerAllocation(set, [1, 1, 1], getRiskMeasure('entropic', { theta: 0.5 }))).toThrow(/not a spectral risk measure/);
    expect(() => eulerAllocation(set, [1, 1, 1], varMeasure(0.95))).toThrow(/not a spectral risk measure/);
  });

  it('component VaR adds exactly to VaR and reports its single-scenario fragility', () => {
    const set = makeScenarioSet(scenarioMatrix(4000, 'component-var'));
    const weights = [1, 0.5, 2];
    const cv = componentValueAtRisk(set, weights, 0.95);
    // The components are read off the VaR scenario, so they add to VaR exactly.
    expect(Math.abs(cv.residual)).toBeLessThan(1e-9 * Math.max(1, Math.abs(cv.total)));
    expect(cv.total).toBe(empiricalVar(sortedCopy(portfolioLosses(set, weights)), 0.95));
    // The smoothed version does NOT add exactly, and says so rather than
    // rescaling the residual away.
    expect(cv.smoothed.scenariosUsed).toBeGreaterThan(1);
    expect(Math.abs(cv.smoothed.residual)).toBeGreaterThan(0);
    expect(cv.notes.join(' ')).toMatch(/ONE scenario/);
  });

  it('distinguishes marginal from incremental contributions', () => {
    const set = makeScenarioSet(scenarioMatrix(4000, 'incremental'));
    const res = incrementalRiskContributions(set, [1, 1, 1], esMeasure(0.95));
    expect(res.component).not.toBeNull();
    // They are different quantities: incremental contributions do not add up.
    expect(Math.abs(res.additivityGap)).toBeGreaterThan(1e-6);
    expect(res.sumOfIncremental).toBeLessThan(res.total);
    res.component!.forEach((c, i) => {
      expect(Number.isFinite(c)).toBe(true);
      expect(Number.isFinite(res.incremental[i])).toBe(true);
    });
  });

  it('Shapley allocation is efficient, symmetric, and equal for identical exposures', () => {
    const r = rng('shapley');
    const n = 600;
    const base = Array.from({ length: n }, () => [r.normal(), r.normal() * 2 + 0.3, r.normal() * 0.5]);
    const set = makeScenarioSet(base, ['A', 'B', 'C']);
    const measure = esMeasure(0.9);
    const alloc = shapleyAllocation(set, [1, 1, 1], measure);
    expect(Math.abs(alloc.residual)).toBeLessThan(1e-8 * Math.max(1, Math.abs(alloc.total)));
    expect(alloc.subsetsEvaluated).toBe(8);

    // Relabelling the exposures permutes the allocation and nothing else.
    const permuted = makeScenarioSet(base.map((row) => [row[2], row[0], row[1]]), ['C', 'A', 'B']);
    const allocP = shapleyAllocation(permuted, [1, 1, 1], measure);
    expect(allocP.shapley[0]).toBeCloseTo(alloc.shapley[2], 10);
    expect(allocP.shapley[1]).toBeCloseTo(alloc.shapley[0], 10);
    expect(allocP.shapley[2]).toBeCloseTo(alloc.shapley[1], 10);

    // Two identical exposures get exactly the same allocation.
    const twin = makeScenarioSet(base.map((row) => [row[0], row[0], row[1]]), ['A', 'A copy', 'B']);
    const allocT = shapleyAllocation(twin, [1, 1, 1], measure);
    expect(allocT.shapley[0]).toBeCloseTo(allocT.shapley[1], 12);
  });

  it('refuses a Shapley allocation when 2^n is infeasible', () => {
    const r = rng('shapley-limit');
    const set = makeScenarioSet(Array.from({ length: 50 }, () => Array.from({ length: 20 }, () => r.normal())));
    expect(() => shapleyAllocation(set, new Array<number>(20).fill(1), esMeasure(0.9))).toThrow(/2\^20/);
  });

  it('matches the closed-form Gaussian Euler allocation', () => {
    const sigma: Matrix = [
      [0.04, 0.012, 0],
      [0.012, 0.09, 0.006],
      [0, 0.006, 0.0225],
    ];
    const w = [0.5, 0.3, 0.2];
    const alloc = gaussianEulerAllocation(sigma, w, [0, 0, 0], 0.99);
    expect(alloc.componentSd.reduce((a, b) => a + b, 0)).toBeCloseTo(alloc.portfolioSd, 12);
    expect(alloc.portfolioSd).toBeCloseTo(Math.sqrt(quadraticForm(sigma, w)), 14);
    expect(alloc.componentEs.reduce((a, b) => a + b, 0)).toBeCloseTo(alloc.totalEs, 10);
    expect(alloc.exactness).toBe('exact');
  });
});

/* ================================================================== *
 * Mean–variance optimisation                                          *
 * ================================================================== */

describe('mean–variance optimisation', () => {
  it('recovers the two-asset minimum-variance closed form', () => {
    for (const [s1, s2, cov] of [
      [0.2, 0.3, 0.012],
      [0.1, 0.1, -0.004],
      [0.5, 0.15, 0.0],
      [0.25, 0.4, 0.05],
    ] as [number, number, number][]) {
      const sigma: Matrix = [
        [s1 * s1, cov],
        [cov, s2 * s2],
      ];
      // Textbook formula: w₁ = (σ₂² − σ₁₂)/(σ₁² + σ₂² − 2σ₁₂).
      const w1 = (s2 * s2 - cov) / (s1 * s1 + s2 * s2 - 2 * cov);
      const fr = analyticEfficientFrontier([0.05, 0.08], sigma, { points: 3 });
      expect(fr.minimumVariance.weights[0]).toBeCloseTo(w1, 8);
      expect(fr.minimumVariance.weights[1]).toBeCloseTo(1 - w1, 8);
      expect(fr.exactness).toBe('exact');
    }
  });

  it('produces a convex frontier, and a tangency portfolio that beats random portfolios', () => {
    const sigma: Matrix = [
      [0.04, 0.01, 0.005, 0.002],
      [0.01, 0.0625, 0.008, 0.004],
      [0.005, 0.008, 0.09, 0.012],
      [0.002, 0.004, 0.012, 0.0225],
    ];
    const mu = [0.05, 0.07, 0.11, 0.06];
    const rf = 0.01;
    const fr = analyticEfficientFrontier(mu, sigma, { points: 40, riskFreeRate: rf });
    // Variance is a convex function of the target return along the frontier.
    for (let i = 1; i + 1 < fr.points.length; i++) {
      const second = fr.points[i + 1].variance - 2 * fr.points[i].variance + fr.points[i - 1].variance;
      expect(second).toBeGreaterThan(-1e-12);
    }
    // Minimum variance really is the minimum.
    for (const p of fr.points) expect(p.variance).toBeGreaterThanOrEqual(fr.minimumVariance.variance - 1e-12);
    const tangency = fr.tangency!;
    const tangencySharpe = (tangency.expectedReturn - rf) / tangency.standardDeviation;
    const r = rng('random-portfolios');
    for (let t = 0; t < 200; t++) {
      // Random budget-feasible weights, including short positions.
      const raw = Array.from({ length: 4 }, () => (t % 2 === 0 ? r.uniform() : r.normal()));
      const total = raw.reduce((a, b) => a + b, 0);
      if (Math.abs(total) < 1e-6) continue;
      const w = raw.map((v) => v / total);
      const sd = Math.sqrt(quadraticForm(sigma, w));
      const sharpe = (w.reduce((a, v, i) => a + v * mu[i], 0) - rf) / sd;
      expect(sharpe).toBeLessThanOrEqual(tangencySharpe + 1e-9);
    }
    expect(fr.capitalMarketLine!.slope).toBeCloseTo(tangencySharpe, 10);
    expect(fr.capitalMarketLine!.intercept).toBe(rf);
  });

  it('never improves the unconstrained objective by adding a no-short constraint', () => {
    const sigma: Matrix = [
      [0.04, 0.03, 0.001],
      [0.03, 0.045, 0.002],
      [0.001, 0.002, 0.09],
    ];
    const mu = [0.04, 0.09, 0.06];
    for (const lambda of [0, 0.5, 2, 10]) {
      const free = constrainedMeanVariance(mu, sigma, lambda, resolveConstraints(3, undefined, true));
      const noShort = constrainedMeanVariance(mu, sigma, lambda, resolveConstraints(3, undefined, false));
      expect(noShort.objective).toBeGreaterThanOrEqual(free.objective - 1e-9);
      for (const w of noShort.weights) expect(w).toBeGreaterThanOrEqual(-1e-9);
      expect(noShort.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    }
    // The comparison is not vacuous: with shorts allowed the return-seeking
    // optimum does take a short position, which the no-short run cannot.
    const aggressive = constrainedMeanVariance(mu, sigma, 10, resolveConstraints(3, undefined, true));
    expect(Math.min(...aggressive.weights)).toBeLessThan(-1e-6);
  });

  it('handles box, group and target-return constraints and refuses infeasible ones', () => {
    const sigma: Matrix = [
      [0.04, 0.01, 0.0],
      [0.01, 0.0625, 0.01],
      [0.0, 0.01, 0.09],
    ];
    const mu = [0.04, 0.07, 0.10];
    const boxed = constrainedMeanVariance(mu, sigma, 1, resolveConstraints(3, { lower: [0.1, 0.1, 0.1], upper: [0.5, 0.5, 0.5] }, false));
    boxed.weights.forEach((w) => {
      expect(w).toBeGreaterThanOrEqual(0.1 - 1e-9);
      expect(w).toBeLessThanOrEqual(0.5 + 1e-9);
    });
    const grouped = constrainedMeanVariance(
      mu,
      sigma,
      1,
      resolveConstraints(3, { groups: [{ label: 'risky', members: [1, 2], lower: 0, upper: 0.3 }] }, false),
    );
    expect(grouped.weights[1] + grouped.weights[2]).toBeLessThanOrEqual(0.3 + 1e-7);
    const target = targetReturnPortfolio(mu, sigma, 0.08, {});
    expect(target.expectedReturn).toBeCloseTo(0.08, 6);
    // Unreachable target, inefficient target, impossible bounds, bad group:
    // each refused rather than approximated.
    expect(() => targetReturnPortfolio(mu, sigma, 0.2, {})).toThrow(/not attainable/);
    expect(() => targetReturnPortfolio(mu, sigma, 0.045, {})).toThrow(/below the minimum-variance portfolio/);
    expect(() => resolveConstraints(3, { lower: [0.5, 0.5, 0.5] }, false)).toThrow(/infeasible/);
    expect(() => resolveConstraints(3, { groups: [{ label: 'g', members: [0, 1], lower: 1.5, upper: 2 }] }, false)).toThrow(/infeasible/);
    expect(() => resolveConstraints(3, { lower: [0.6, 0, 0], upper: [0.2, 1, 1] }, false)).toThrow(/above its upper bound/);
  });

  it('gives no diversification at ρ = 1 and finds the zero-variance portfolio at ρ = −1', () => {
    const s1 = 0.2;
    const s2 = 0.35;
    // ρ = 1: the portfolio standard deviation is exactly the weighted average.
    const perfect: Matrix = [
      [s1 * s1, s1 * s2],
      [s1 * s2, s2 * s2],
    ];
    for (const w1 of [0, 0.25, 0.5, 0.75, 1]) {
      const w = [w1, 1 - w1];
      expect(Math.sqrt(quadraticForm(perfect, w))).toBeCloseTo(w1 * s1 + (1 - w1) * s2, 14);
    }
    // ρ = −1 exactly is singular, and that is refused rather than fudged.
    const opposite: Matrix = [
      [s1 * s1, -s1 * s2],
      [-s1 * s2, s2 * s2],
    ];
    expect(() => checkCovariance(opposite)).toThrow(/not positive definite/);
    // Just inside positive definiteness, the optimiser finds the hedge:
    // w₁ = σ₂/(σ₁ + σ₂) gives (almost) zero variance.
    const rho = -0.999999;
    const nearly: Matrix = [
      [s1 * s1, rho * s1 * s2],
      [rho * s1 * s2, s2 * s2],
    ];
    const sol = constrainedMeanVariance([0.05, 0.05], nearly, 0, resolveConstraints(2, undefined, false), { maxIterations: 200000, tolerance: 1e-16 });
    expect(sol.weights[0]).toBeCloseTo(s2 / (s1 + s2), 4);
    // Two-asset minimum variance in closed form: σ₁²σ₂²(1 − ρ²)/(σ₁² + σ₂² − 2ρσ₁σ₂).
    const analyticMin = (s1 * s1 * s2 * s2 * (1 - rho * rho)) / (s1 * s1 + s2 * s2 - 2 * rho * s1 * s2);
    expect(analyticMin).toBeLessThan(1e-7);
    expect(sol.variance).toBeCloseTo(analyticMin, 10);
  });
});

/* ================================================================== *
 * Risk parity                                                         *
 * ================================================================== */

describe('risk parity', () => {
  it('equalises risk contributions', () => {
    const sigma: Matrix = [
      [0.04, 0.012, 0.002, 0.001],
      [0.012, 0.09, 0.015, 0.003],
      [0.002, 0.015, 0.0225, 0.004],
      [0.001, 0.003, 0.004, 0.16],
    ];
    const rp = riskParityPortfolio(sigma);
    expect(rp.converged).toBe(true);
    for (const share of rp.riskContributionShares) expect(share).toBeCloseTo(0.25, 8);
    expect(rp.maximumShareDeviation).toBeLessThan(1e-8);
    expect(rp.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(rp.riskContributions.reduce((a, b) => a + b, 0)).toBeCloseTo(rp.portfolioSd, 10);
  });

  it('gives weights proportional to 1/σ for uncorrelated assets (closed form)', () => {
    const sds = [0.1, 0.2, 0.4, 0.05];
    const sigma: Matrix = sds.map((s, i) => sds.map((_t, j) => (i === j ? s * s : 0)));
    const rp = riskParityPortfolio(sigma);
    const inv = sds.map((s) => 1 / s);
    const total = inv.reduce((a, b) => a + b, 0);
    rp.weights.forEach((w, i) => expect(w).toBeCloseTo(inv[i] / total, 10));
  });
});

/* ================================================================== *
 * Mean–ES (CVaR) optimisation                                         *
 * ================================================================== */

describe('CVaR optimisation', () => {
  function normalScenarios(n: number, seed: string): { scenarios: number[][]; sigma: Matrix; mu: number[] } {
    const r = rng(seed);
    const sds = [0.02, 0.03, 0.05];
    const rho = 0.3;
    const scenarios: number[][] = [];
    for (let i = 0; i < n; i++) {
      const common = r.normal();
      scenarios.push(sds.map((s) => s * (Math.sqrt(rho) * common + Math.sqrt(1 - rho) * r.normal())));
    }
    const moments = estimateMoments(scenarios);
    return { scenarios, sigma: moments.covariance, mu: moments.mean };
  }

  it('is no worse than the mean–variance portfolio on the same scenarios', () => {
    const { scenarios, sigma, mu } = normalScenarios(3000, 'cvar-vs-mv');
    const constraints = resolveConstraints(3, undefined, false);
    const mv = constrainedMeanVariance(mu, sigma, 0, constraints);
    const esOf = (w: number[]): number => {
      const losses = scenarios.map((row) => -row.reduce((a, v, i) => a + v * w[i], 0));
      return empiricalEs(sortedCopy(losses), 0.95);
    };
    const cvar = minimumCvarPortfolio(scenarios, 0.95, { starts: [mv.weights] });
    expect(cvar.expectedShortfall).toBeLessThanOrEqual(esOf(mv.weights) + 1e-12);
    expect(cvar.expectedShortfall).toBeCloseTo(esOf(cvar.weights), 12);
    expect(cvar.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 8);
    // On normal scenarios the two optima nearly coincide (a known result).
    cvar.weights.forEach((w, i) => expect(Math.abs(w - mv.weights[i])).toBeLessThan(0.1));
  });

  it('prefers the skew-aware portfolio when the scenarios are skewed', () => {
    // Asset 0: same variance as asset 1 but a rare large loss. Variance cannot
    // see the difference; ES can.
    const r = rng('cvar-skew');
    const n = 4000;
    const scenarios: number[][] = [];
    for (let i = 0; i < n; i++) {
      const jump = r.uniform() < 0.02 ? -0.5 : 0.01;
      scenarios.push([jump, 0.1 * r.normal() * 1.0]);
    }
    const cvar = minimumCvarPortfolio(scenarios, 0.95, {});
    // The optimiser avoids the jump asset.
    expect(cvar.weights[0]).toBeLessThan(0.5);
    expect(cvar.valueAtRisk).toBeLessThanOrEqual(cvar.expectedShortfall + 1e-12);
  });

  it('refuses a level with too few tail scenarios, naming the count', () => {
    const r = rng('cvar-thin');
    const scenarios = Array.from({ length: 100 }, () => [r.normal(), r.normal()]);
    expect(() => minimumCvarPortfolio(scenarios, 0.999, {})).toThrow(/of the 100 scenarios lie in the tail/);
  });
});

/* ================================================================== *
 * Estimation error — the error maximiser                              *
 * ================================================================== */

describe('estimation error', () => {
  it('shows materially dispersed optimal weights, and less dispersion under Ledoit–Wolf shrinkage', () => {
    // Eight assets with IDENTICAL true expected returns and a common factor:
    // every difference the optimiser finds is estimation noise.
    const r = rng('error-maximiser');
    const d = 8;
    const n = 60;
    const returns: number[][] = [];
    for (let t = 0; t < n; t++) {
      const common = r.normal();
      returns.push(Array.from({ length: d }, () => 0.01 + 0.04 * (0.5 * common + Math.sqrt(1 - 0.25) * r.normal())));
    }
    const study = estimationErrorStudy(returns, { resamples: 120, seed: 'resample', riskFreeRate: 0, objective: 'tangency' });
    // A budget of 1 shared between 8 assets; a total absolute movement above
    // 0.5 means the "optimal" weights are not identifiable from the data.
    expect(study.meanAbsoluteDeviation).toBeGreaterThan(0.5);
    expect(study.verdict).toMatch(/not identifiable|honest uncertainty/);
    expect(study.shrunk).not.toBeNull();
    expect(study.dispersionReduction).toBeGreaterThan(0);
    expect(study.shrunk!.averageIntensity).toBeGreaterThan(0);
    expect(study.shrunk!.averageIntensity).toBeLessThanOrEqual(1);
    // Per-asset dispersion is reported, so the user sees the range, not a point.
    study.weightInterval.forEach((iv) => expect(iv.high).toBeGreaterThan(iv.low));
  });

  it('estimates the Ledoit–Wolf intensity from the data and keeps the matrix well conditioned', () => {
    const r = rng('ledoit-wolf');
    const d = 10;
    const n = 30;
    const returns = Array.from({ length: n }, () => Array.from({ length: d }, () => 0.02 * r.normal()));
    const sh = ledoitWolfShrinkage(returns);
    expect(sh.intensity).toBeGreaterThan(0);
    expect(sh.intensity).toBeLessThanOrEqual(1);
    // The sample covariance of 30 observations of 10 assets is far worse
    // conditioned than the shrunk one (and may be singular).
    const shrunkCheck = checkCovariance(sh.shrunk);
    expect(shrunkCheck.smallestEigenvalue).toBeGreaterThan(0);
    // Shrinkage preserves the average variance (trace/d) by construction.
    const traceSample = sh.sample.reduce((a, row, i) => a + row[i], 0) / d;
    const traceShrunk = sh.shrunk.reduce((a, row, i) => a + row[i], 0) / d;
    expect(traceShrunk).toBeCloseTo(traceSample, 12);
  });
});

/* ================================================================== *
 * Scenario aggregation, stress and reverse stress                     *
 * ================================================================== */

describe('scenario analysis', () => {
  it('aggregates scenarios as a cancellable generator', () => {
    const r = rng('scenario-generator');
    const set = makeScenarioSet(Array.from({ length: 10_000 }, () => [r.normal(), 2 * r.normal()]));
    const steps = scenarioAggregationSteps(set, [1, 1], [0.95], { chunkSize: 1024 });
    let yields = 0;
    let last = 0;
    let next = steps.next();
    while (!next.done) {
      yields++;
      expect(next.value).toBeGreaterThan(last);
      last = next.value;
      next = steps.next();
    }
    // 10000/1024 = 10 chunks: the loop yields between each, which is what lets
    // a worker receive a cancel message.
    expect(yields).toBe(10);
    expect(last).toBe(1);
    const result = next.value;
    expect(result.scenarios).toBe(10_000);
    expect(result.rows[0].esStandardError).toBeGreaterThan(0);
    expect(result.rows[0].varInterval95!.low).toBeLessThan(result.rows[0].valueAtRisk);
    expect(result.exactness).toBe('empirical');
  });

  it('refuses a level with too few tail scenarios, reporting how many', () => {
    const r = rng('thin-tail');
    const set = makeScenarioSet(Array.from({ length: 200 }, () => [r.normal()]));
    expect(() => scenarioAggregate(set, [1], [0.999])).toThrow(/only 0.20 of the 200 scenarios lie in the tail/);
  });

  it('reports the effect of named shocks on every measure', () => {
    const r = rng('stress');
    const set = makeScenarioSet(
      Array.from({ length: 4000 }, () => {
        const c = r.normal();
        return [0.5 * c + r.normal(), 0.5 * c + r.normal()];
      }),
      ['Book A', 'Book B'],
    );
    const measures = [varMeasure(0.99), esMeasure(0.99), esMeasure(0.95)];
    const results = stressTest(
      set,
      [1, 1],
      [
        { label: 'Volatility doubles', volatilityMultiplier: [2, 2] },
        { label: 'Loss level shifts', meanShift: [1, 1] },
        {
          label: 'Correlation goes to 0.95',
          correlation: [
            [1, 0.95],
            [0.95, 1],
          ],
          seed: 'stress-corr',
        },
      ],
      measures,
    );
    expect(results).toHaveLength(3);
    // Doubling volatility increases every tail measure.
    for (const m of measures) expect(results[0].change[m.name]).toBeGreaterThan(0);
    // A shift of +1 per book moves the mean by 2 and every quantile with it.
    expect(results[1].change[esMeasure(0.95).name]).toBeCloseTo(2, 6);
    // Raising correlation raises aggregate tail risk while leaving marginals alone.
    expect(results[2].change[esMeasure(0.99).name]).toBeGreaterThan(0);
    expect(results[2].description).toMatch(/attaches no probability/);
  });

  it('answers the reverse question: what shock loses a given amount', () => {
    const sigma: Matrix = [
      [0.04, 0.01],
      [0.01, 0.09],
    ];
    const w = [1, 2];
    const target = 1.5;
    const res = reverseStressTest(w, sigma, target);
    // The shock really does produce the target loss.
    expect(res.factorShock.reduce((a, v, i) => a + v * w[i], 0)).toBeCloseTo(target, 12);
    // And it is the minimum-norm one: zᵀΣ⁻¹z = target²/(wᵀΣw).
    expect(res.mahalanobisDistance).toBeCloseTo(target / Math.sqrt(quadraticForm(sigma, w)), 12);
    expect(res.exactness).toBe('exact');
    expect(res.equivalentNormalProbability).toBeGreaterThan(0);
    expect(res.equivalentNormalProbability).toBeLessThan(0.5);
    // No direction of exposure at all: the target can never be reached.
    expect(() => reverseStressTest([0, 0], sigma, 1)).toThrow(/zero variance/);
  });
});

/* ================================================================== *
 * Drawdown                                                            *
 * ================================================================== */

describe('drawdown analysis', () => {
  it('matches a hand-computed maximum drawdown', () => {
    // Path: 100, 120, 90, 110, 80, 130.
    // Running peak: 100, 120, 120, 120, 120, 130.
    // Drawdowns:     0,   0,  30/120 = 0.25, 10/120 ≈ 0.08333, 40/120 ≈ 0.33333, 0.
    // Maximum drawdown = 40/120 = 1/3 exactly, at index 4 from the peak at index 1.
    const res = drawdownAnalysis([100, 120, 90, 110, 80, 130]);
    expect(res.maximumDrawdown).toBeCloseTo(1 / 3, 12);
    expect(res.maximumDrawdownPeak).toBe(1);
    expect(res.maximumDrawdownTrough).toBe(4);
    expect(res.drawdownSeries[2]).toBeCloseTo(0.25, 12);
    expect(res.drawdownSeries[3]).toBeCloseTo(10 / 120, 12);
    // Average of the six drawdown values above.
    expect(res.averageDrawdown).toBeCloseTo((0 + 0 + 0.25 + 10 / 120 + 40 / 120 + 0) / 6, 12);
    expect(res.episodes[0].peakIndex).toBe(1);
    expect(res.episodes[0].recovered).toBe(true);
  });

  it('is 0 for a rising path and the full decline for a falling one', () => {
    expect(drawdownAnalysis([1, 2, 3, 4, 5, 6]).maximumDrawdown).toBe(0);
    const falling = drawdownAnalysis([100, 80, 60, 40, 20, 10]);
    expect(falling.maximumDrawdown).toBeCloseTo(0.9, 12);
    expect(falling.episodes[0].recovered).toBe(false);
    const absolute = drawdownAnalysis([100, 80, 60, 40, 20, 10], { relative: false });
    expect(absolute.maximumDrawdown).toBeCloseTo(90, 12);
  });

  it('reports CDaR, durations and the Calmar ratio, and refuses a non-positive path', () => {
    const r = rng('drawdown-path');
    const path = [100];
    for (let i = 0; i < 500; i++) path.push(path[path.length - 1] * Math.exp(0.0004 + 0.01 * r.normal()));
    const res = drawdownAnalysis(path, { level: 0.95, periodsPerYear: 252 });
    expect(res.conditionalDrawdownAtRisk).toBeGreaterThanOrEqual(res.averageDrawdown);
    expect(res.conditionalDrawdownAtRisk).toBeLessThanOrEqual(res.maximumDrawdown + 1e-12);
    expect(res.longestDuration).toBeGreaterThan(0);
    expect(res.calmarRatio).not.toBeNull();
    expect(() => drawdownAnalysis([1, -1, 2])).toThrow(/strictly positive path/);
    expect(() => drawdownAnalysis([5])).toThrow(/at least 2 points/);
  });

  it('gives the exact expected maximum drawdown of a driftless walk and refuses drift', () => {
    const res = expectedMaximumDrawdownDriftless(1, 400);
    // √(π/2)·σ·√T, computed independently here.
    expect(res.expected).toBeCloseTo(Math.sqrt(Math.PI / 2) * 20, 12);
    expect(res.exactness).toBe('exact');
    expect(() => expectedMaximumDrawdownDriftless(1, 100, 0.01)).toThrow(/only for a driftless walk/);
    // Cross-check by simulation: 3000 driftless paths of 400 steps.
    const r = rng('mdd-simulation');
    let total = 0;
    const paths = 3000;
    for (let p = 0; p < paths; p++) {
      let x = 0;
      let peak = 0;
      let mdd = 0;
      for (let t = 0; t < 400; t++) {
        x += r.normal();
        if (x > peak) peak = x;
        if (peak - x > mdd) mdd = peak - x;
      }
      total += mdd;
    }
    const simulated = total / paths;
    // MDD has sd ≈ 0.5·E[MDD]; with 3000 paths the standard error is about
    // 0.009·E[MDD]. Discrete monitoring also biases the simulated maximum
    // DOWNWARDS by O(1/√steps) ≈ 5%, because the continuous path's extremes
    // between observations are missed. 8% covers both effects.
    expect(simulated).toBeLessThan(res.expected);
    expect(Math.abs(simulated - res.expected) / res.expected).toBeLessThan(0.08);
  });
});

/* ================================================================== *
 * Cornish–Fisher                                                      *
 * ================================================================== */

describe('Cornish–Fisher expansion', () => {
  it('reduces exactly to the normal quantile with no skew and no excess kurtosis', () => {
    const levels = [0.5, 0.75, 0.9, 0.95, 0.99, 0.999];
    const res = cornishFisherQuantiles(10, 2, 0, 0, levels);
    res.quantiles.forEach(({ level, value, normalValue }) => {
      expect(value).toBeCloseTo(10 + 2 * normalQuantile(level), 12);
      expect(value).toBeCloseTo(normalValue, 12);
    });
    expect(res.globallyMonotone).toBe(true);
    expect(res.exactness).toBe('numerical');
  });

  it('adjusts the tail for mild skewness while staying monotone', () => {
    const res = cornishFisherQuantiles(0, 1, 0.3, 0.4, [0.9, 0.95, 0.99]);
    expect(res.globallyMonotone).toBe(true);
    // Positive skewness pushes the upper quantiles out.
    res.quantiles.forEach((q) => expect(q.value).toBeGreaterThan(q.normalValue));
    // Quantiles increase with the level, as a quantile function must.
    for (let i = 1; i < res.quantiles.length; i++) expect(res.quantiles[i].value).toBeGreaterThan(res.quantiles[i - 1].value);
  });

  it('REFUSES a skewness/kurtosis pair outside the monotonicity domain', () => {
    // S = 2, K = 6: derivative = 0.0833z² + 0.667z + 0.8055, whose minimum is
    // 0.8055 − 0.667²/(4·0.0833) = −0.528 < 0 at z = −4. Non-monotone, so the
    // expansion would return quantiles that fall as the level rises.
    expect(() => cornishFisherQuantiles(0, 1, 2, 6, [0.95])).toThrow(/outside its validity domain/);
    expect(() => cornishFisherQuantiles(0, 1, 2, 6, [0.95])).toThrow(/not monotone/);
    // The same case can be inspected without being returned as a quantile.
    const forced = cornishFisherQuantiles(0, 1, 2, 6, [0.95], { requireGlobalMonotonicity: false });
    expect(forced.globallyMonotone).toBe(false);
    expect(forced.minimumDerivative).toBeLessThan(0);
    // Impossible moment combinations are refused outright.
    expect(() => cornishFisherQuantiles(0, 1, 3, 0, [0.95])).toThrow(/jointly impossible/);
    expect(() => cornishFisherQuantiles(0, 0, 0, 0, [0.95])).toThrow(/greater than 0/);
  });
});

/* ================================================================== *
 * Backtesting                                                         *
 * ================================================================== */

describe('risk-measure backtesting', () => {
  it('does not reject a correctly calibrated VaR model, and does reject a wrong one', () => {
    // Losses from a known distribution: N(0, 1). The correct 95% VaR is Φ⁻¹(0.95).
    // Ten independent seeds, so the conclusion is not one lucky sample: a 5%
    // test should reject the TRUE model about 0.5 times in 10, and rejecting
    // 3 or more would itself be a one-in-a-hundred event.
    const n = 2000;
    let rejections = 0;
    let wrongRejections = 0;
    for (let s = 0; s < 10; s++) {
      const losses = normalSample(n, 0, 1, `backtest-calibration-${s}`);
      const good = backtestVar(losses, new Array<number>(n).fill(normalQuantile(0.95)), 0.95);
      // sd of the exception rate is √(0.05·0.95/2000) = 0.49 percentage points,
      // so 5% ± 1.5 points is about 3 standard errors.
      expect(good.exceptions / n).toBeGreaterThan(0.035);
      expect(good.exceptions / n).toBeLessThan(0.065);
      if (good.kupiec.rejectedAt5Percent) rejections++;
      // A VaR set far too low must be rejected every time — a backtest that
      // never fires is useless.
      const bad = backtestVar(losses, new Array<number>(n).fill(normalQuantile(0.8)), 0.95);
      expect(bad.exceptions / n).toBeGreaterThan(0.15);
      expect(bad.kupiec.pValue).toBeLessThan(1e-9);
      expect(bad.trafficLight.zone).toBe('red');
      if (bad.kupiec.rejectedAt5Percent) wrongRejections++;
    }
    expect(rejections).toBeLessThanOrEqual(2);
    expect(wrongRejections).toBe(10);
  });

  it('detects clustered exceptions with Christoffersen\'s independence test', () => {
    // 200 observations with all 20 exceptions in one block: the rate is right,
    // the timing is not.
    const n = 200;
    const losses = new Array<number>(n).fill(0);
    for (let i = 50; i < 70; i++) losses[i] = 10;
    const forecasts = new Array<number>(n).fill(1);
    const report = backtestVar(losses, forecasts, 0.9);
    expect(report.exceptions).toBe(20);
    expect(report.kupiec.rejectedAt5Percent).toBe(false);
    expect(report.christoffersen.clustered).toBe(true);
    expect(report.christoffersen.independencePValue).toBeLessThan(0.01);
    expect(report.christoffersen.conditionalCoveragePValue).toBeLessThan(0.05);
  });

  it('puts an over-breaching model in the red zone and refuses impossible inputs', () => {
    expect(trafficZone(4, 250, 0.01)).toBe('green');
    expect(trafficZone(8, 250, 0.01)).toBe('yellow');
    expect(trafficZone(20, 250, 0.01)).toBe('red');
    expect(() => kupiecTest(10, 5, 0.05)).toThrow(/between 0 and 5/);
    expect(() => kupiecTest(1, 100, 0)).toThrow(/strictly between 0 and 1/);
  });

  it('runs the Acerbi–Székely ES backtest and reports no fabricated p-value', () => {
    const n = 2000;
    const losses = normalSample(n, 0, 1, 'es-backtest');
    const level = 0.95;
    const z = normalQuantile(level);
    const varF = new Array<number>(n).fill(z);
    const esF = new Array<number>(n).fill(normalPdf(z) / (1 - level));
    const correct = esBacktestZ2(losses, varF, esF, level);
    // Z₂ ≈ 0 for a correct model. Its sd is roughly √(1/(n(1−α))) ≈ 0.1, so
    // 0.3 is three standard errors.
    expect(Math.abs(correct.z2)).toBeLessThan(0.3);
    // Halving the predicted ES must make Z₂ clearly positive.
    const understated = esBacktestZ2(losses, varF, esF.map((v) => v / 2), level);
    expect(understated.z2).toBeGreaterThan(0.5);
    expect(understated.interpretation).toMatch(/understates/);
    expect(understated.notes.join(' ')).toMatch(/No p-value is reported/);
    expect(() => esBacktestZ2(losses, varF, new Array<number>(n).fill(0), level)).toThrow(/greater than 0/);
  });
});

function trafficZone(exceptions: number, n: number, rate: number): string {
  const r = rng('traffic');
  void r;
  const losses = new Array<number>(n).fill(0);
  for (let i = 0; i < exceptions; i++) losses[i * 3] = 10;
  return backtestVar(losses, new Array<number>(n).fill(1), 1 - rate).trafficLight.zone;
}

/* ================================================================== *
 * Expectiles                                                          *
 * ================================================================== */

describe('expectiles', () => {
  it('has the ½-expectile exactly equal to the mean', () => {
    for (const seed of ['e1', 'e2', 'e3']) {
      const sample = sortedCopy(normalSample(400, 3, 2, seed));
      expect(Math.abs(empiricalExpectile(sample, 0.5) - sampleMean(sample))).toBeLessThan(1e-10);
    }
    // Including a deliberately skewed sample.
    const skewed = sortedCopy([0, 0, 0, 0, 1, 1, 2, 50]);
    expect(Math.abs(empiricalExpectile(skewed, 0.5) - sampleMean(skewed))).toBeLessThan(1e-10);
  });

  it('is monotone in the level and sits between the mean and the maximum', () => {
    const sample = sortedCopy(normalSample(1000, 0, 1, 'expectile-monotone'));
    let prev = -Infinity;
    for (const tau of [0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99]) {
      const e = empiricalExpectile(sample, tau);
      expect(e).toBeGreaterThan(prev);
      prev = e;
    }
    expect(empiricalExpectile(sample, 0.99)).toBeLessThanOrEqual(sample[sample.length - 1]);
    expect(empiricalExpectile(sample, 0.01)).toBeGreaterThanOrEqual(sample[0]);
    expect(() => empiricalExpectile(sample, 0)).toThrow(/strictly between 0 and 1/);
  });
});

/* ================================================================== *
 * Monte Carlo standard error                                          *
 * ================================================================== */

describe('Monte Carlo error of an estimated risk measure', () => {
  it('shrinks as 1/√n, and is reported separately from the measure itself', () => {
    const sizes = [2000, 8000, 32_000, 128_000];
    const logN: number[] = [];
    const logSe: number[] = [];
    for (const n of sizes) {
      const set = makeScenarioSet(normalSample(n, 0, 1, `mc-se-${n}`).map((v) => [v]));
      const res = scenarioAggregate(set, [1], [0.95]);
      const row = res.rows[0];
      expect(row.esStandardError).toBeGreaterThan(0);
      logN.push(Math.log(n));
      logSe.push(Math.log(row.esStandardError!));
      // The interval is about the ESTIMATE; it brackets the reported figure and
      // is a different statement from the risk measure (a tail quantile).
      expect(row.esInterval95!.low).toBeLessThan(row.expectedShortfall);
      expect(row.esInterval95!.high).toBeGreaterThan(row.expectedShortfall);
      expect(row.varInterval95!.low).toBeLessThan(row.valueAtRisk);
    }
    // Fit the slope of log(SE) on log(n): the theoretical value is −1/2.
    const meanX = logN.reduce((a, b) => a + b, 0) / logN.length;
    const meanY = logSe.reduce((a, b) => a + b, 0) / logSe.length;
    let num = 0;
    let den = 0;
    for (let i = 0; i < logN.length; i++) {
      num += (logN[i] - meanX) * (logSe[i] - meanY);
      den += (logN[i] - meanX) ** 2;
    }
    const slope = num / den;
    // Four sample sizes spanning 64×; the fitted slope is itself noisy, so
    // ±0.08 around −0.5 is a reasonable band.
    expect(slope).toBeGreaterThan(-0.58);
    expect(slope).toBeLessThan(-0.42);
  });
});

/* ================================================================== *
 * Refusals                                                            *
 * ================================================================== */

describe('refusals', () => {
  it('refuses a non-positive-definite covariance matrix, naming the eigenvalue', () => {
    const bad: Matrix = [
      [1, 2],
      [2, 1],
    ];
    expect(() => checkCovariance(bad)).toThrow(/smallest eigenvalue is -1/);
    expect(() => analyticEfficientFrontier([0.1, 0.1], bad)).toThrow(/not positive definite/);
    expect(() => riskParityPortfolio(bad)).toThrow(/not positive definite/);
    // A non-symmetric matrix is refused too, rather than quietly symmetrised.
    expect(() =>
      checkCovariance([
        [1, 0.5],
        [0.2, 1],
      ]),
    ).toThrow(/not symmetric/);
  });

  it('refuses weights that do not sum to the budget', () => {
    const sigma: Matrix = [
      [0.04, 0],
      [0, 0.09],
    ];
    // The optimiser projects onto the budget, so the refusal lives in the
    // constraint resolution: bounds that cannot reach a total of 1.
    expect(() => resolveConstraints(2, { upper: [0.2, 0.2] }, false)).toThrow(/between 0 and 0.4, which excludes the required budget of 1/);
    expect(() => resolveConstraints(2, { lower: [0.8, 0.8] }, false)).toThrow(/infeasible/);
    void sigma;
  });

  it('refuses a confidence level outside (0, 1) everywhere it is used', () => {
    const sample = sortedCopy(normalSample(100, 0, 1, 'levels'));
    expect(() => empiricalVar(sample, 0)).toThrow(/greater than 0 and less than 1/);
    expect(() => empiricalVar(sample, 1)).toThrow(EngineError);
    expect(() => empiricalEs(sample, -0.1)).toThrow(EngineError);
    expect(() => esMeasure(1.5)).toThrow(EngineError);
    expect(() => varMeasure(0)).toThrow(EngineError);
    expect(() => aggregateComonotonic([distributionMarginal('a', 'normal', { mu: 0, sigma: 1 })], [1.2])).toThrow(EngineError);
  });

  it('refuses an Expected Shortfall whose tail mean does not exist', () => {
    // Pareto with shape ≤ 1 has an infinite mean, so ES is not a number.
    const heavy = distributionMarginal('heavy', 'pareto', { xm: 1, alpha: 0.8 });
    expect(() => marginalRisk(heavy, 0.95)).toThrow(/infinite mean/);
    // A finite but heavy tail (α = 1.5) still has an Expected Shortfall.
    const heavyButFinite = distributionMarginal('heavy2', 'pareto', { xm: 1, alpha: 1.5 });
    const r = marginalRisk(heavyButFinite, 0.95);
    expect(r.expectedShortfall).toBeGreaterThan(r.valueAtRisk);
  });

  it('refuses malformed scenario sets and mismatched weights', () => {
    expect(() => makeScenarioSet([])).toThrow(/At least one scenario/);
    expect(() => makeScenarioSet([[1, 2], [3]])).toThrow(/Every scenario must cover/);
    expect(() => makeScenarioSet([[1, Number.NaN]])).toThrow(/not a finite number/);
    const set = makeScenarioSet([
      [1, 2],
      [3, 4],
    ]);
    expect(() => portfolioLosses(set, [1])).toThrow(/weights were given for 2 exposures/);
    expect(() => makeScenarioSet([[1, 2]], ['only one'])).toThrow(/labels were given/);
  });

  it('refuses a sample marginal that is too small and a distribution that is unknown', () => {
    expect(() => sampleMarginal('tiny', [1])).toThrow(/at least 2 observations/);
    expect(() => distributionMarginal('x', 'not-a-distribution', {})).toThrow();
    expect(() => aggregateIndependent([distributionMarginal('a', 'normal', { mu: 0, sigma: 1 })], [0.95], { resolution: 2 })).toThrow(/at least 10 cells/);
  });

  it('weights of a quantile integral are a valid averaging kernel', () => {
    const w = quantileIntegralWeights(100, 0.9, 1);
    expect(applyWeights(new Array<number>(100).fill(5), w)).toBeCloseTo(5, 12);
    expect(() => quantileIntegralWeights(10, 0.9, 0.9)).toThrow(/a < b/);
    expect(() => quantileIntegralWeights(10, -0.1, 0.5)).toThrow(/inside \[0, 1\]/);
  });
});
