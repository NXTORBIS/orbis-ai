/**
 * Tests for the elicitation module.
 *
 * REFERENCE VALUES ARE INDEPENDENT OF THE IMPLEMENTATION UNDER TEST.
 * The quantile-recovery tests feed in quantiles computed by the DISTRIBUTION
 * REGISTRY (which is itself checked against SciPy fixtures) and assert that the
 * fitter recovers the parameters those quantiles came from. The maximum-entropy
 * tests assert against the textbook closed forms (exponential, normal, uniform)
 * evaluated through the registry's own densities. The calibration tests
 * construct judges whose miscalibration is known analytically and assert the
 * measured value matches the closed-form prediction. Nothing is asserted
 * against a number this module produced.
 *
 * Every random construction uses a fixed seed through `Random`, so each
 * assertion below is deterministic.
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from '../core/result';
import { stableSum } from '../core/numeric';
import { getDistribution } from '../distributions/registry';
import { Random } from '../random/rng';
import { cdfLower, cdfUpper } from '../imprecise/pbox';

import {
  quantilesFromInterval,
  validateElicitedQuantiles,
  type ElicitedQuantile,
} from './types';
import { fitElicitedQuantiles, fitQuantilesToFamily } from './quantiles';
import {
  compareFramings,
  fitChipAllocation,
  nextBisectionQuestion,
  nextFixedIntervalQuestion,
  quantilesFromFixedInterval,
  readProbabilityWheel,
} from './protocols';
import {
  elicitImpreciseProbabilities,
  elicitImpreciseQuantiles,
  maximumEntropyCompletion,
} from './completion';
import {
  checkConjunction,
  checkPartitionCoherence,
  checkSubadditivity,
  compareProbabilityFormats,
  detectAnchoring,
  detectPartitionDependence,
} from './coherence';
import {
  comparePools,
  cookeClassicalMethod,
  correlatedExpertAggregate,
  crossValidateWeighting,
  disagreementMeasures,
  linearPool,
  logarithmicPool,
} from './aggregate';
import {
  calibrationUncertainty,
  intervalCalibration,
  scoreBinaryRecord,
  scoreContinuousRecord,
} from './tracking';

const NORMAL = getDistribution('normal');
const STD = { mu: 0, sigma: 1 };
/** Standard normal quantile, used to derive the analytic reference values. */
const z = (p: number): number => NORMAL.quantile(p, STD);
/** Standard normal CDF. */
const Phi = (x: number): number => NORMAL.cdf(x, STD);

/** Quantiles of a known registry distribution, presented as if a judge had stated them. */
function statedFrom(id: string, params: Record<string, number>, levels: readonly number[]): ElicitedQuantile[] {
  const def = getDistribution(id);
  return levels.map((level) => ({ level, value: def.quantile(level, params) }));
}

describe('elicitation: turning stated quantiles into a distribution', () => {
  const levels = [0.05, 0.25, 0.5, 0.75, 0.95];

  it('recovers a known normal from its own exact quantiles', () => {
    const truth = { mu: 120, sigma: 18 };
    const fit = fitQuantilesToFamily('normal', statedFrom('normal', truth, levels));
    // The quantiles were generated FROM these parameters, so an exact
    // least-squares fit must return them. 1e-6 is far looser than the ~1e-13
    // the optimiser actually achieves and leaves room for the simplex's
    // termination tolerance without admitting a wrong answer.
    expect(fit.params.mu).toBeCloseTo(truth.mu, 6);
    expect(fit.params.sigma).toBeCloseTo(truth.sigma, 6);
    // Residuals are in the judge's units; the stated span here is ~59, so 1e-6
    // is a relative error below 2e-8.
    for (const r of fit.residuals) expect(Math.abs(r.residual)).toBeLessThan(1e-6);
    expect(fit.rmse).toBeLessThan(1e-6);
  });

  it('recovers a known lognormal from its own exact quantiles', () => {
    const truth = { mu: 3.2, sigma: 0.7 };
    const fit = fitQuantilesToFamily('lognormal', statedFrom('lognormal', truth, levels));
    expect(fit.params.mu).toBeCloseTo(truth.mu, 6);
    expect(fit.params.sigma).toBeCloseTo(truth.sigma, 6);
    expect(fit.rmse).toBeLessThan(1e-6);
  });

  it('recovers a known beta from its own exact quantiles', () => {
    const truth = { alpha: 2.5, beta: 6 };
    const fit = fitQuantilesToFamily('beta', statedFrom('beta', truth, levels));
    // Beta quantiles come from numerical inversion of the incomplete beta
    // function, so 5 decimals rather than 6; the observed error is ~1e-12.
    expect(fit.params.alpha).toBeCloseTo(truth.alpha, 5);
    expect(fit.params.beta).toBeCloseTo(truth.beta, 5);
    // The beta support is [0, 1] so the residual scale is tiny; 1e-8 absolute.
    expect(fit.rmse).toBeLessThan(1e-8);
  });

  it('picks the normal family when the quantiles came from a normal', () => {
    const truth = { mu: 50, sigma: 7 };
    const result = fitElicitedQuantiles(statedFrom('normal', truth, levels));
    expect(result.best.distributionId).toBe('normal');
    expect(result.best.params.mu).toBeCloseTo(truth.mu, 5);
    expect(result.best.params.sigma).toBeCloseTo(truth.sigma, 5);
    expect(result.exactness).toBe('assumed');
  });

  it('reports a material family sensitivity: families that fit equally well disagree in the tail', () => {
    // Three quantiles, two free parameters in most families: several families
    // reproduce them to within a judge's precision and then diverge.
    const result = fitElicitedQuantiles([
      { level: 0.1, value: 10 },
      { level: 0.5, value: 25 },
      { level: 0.9, value: 90 },
    ]);
    expect(result.familySensitivity.nearTiedFamilies.length).toBeGreaterThan(1);
    // Every near-tied family reproduces the stated quantiles within the tie
    // band, which is anchored to 2% of the stated span (80), i.e. 1.6 units.
    for (const id of result.familySensitivity.nearTiedFamilies) {
      const f = result.fits.find((x) => x.distributionId === id);
      expect(f).toBeDefined();
      expect((f as { rmse: number }).rmse).toBeLessThanOrEqual(result.tieBand);
    }
    // ...and they imply materially different tail probabilities. The far probe
    // sits four stated spans above the top stated value, a region the judge
    // said nothing about.
    const far = result.familySensitivity.probes[result.familySensitivity.probes.length - 1];
    expect(far.x).toBeCloseTo(90 + 4 * 80, 10);
    // A factor of 3 or more between the smallest and largest exceedance is
    // "materially different" by any standard; the observed ratio is ~14.
    expect(far.ratio).toBeGreaterThan(3);
    expect(result.familySensitivity.material).toBe(true);
    expect(result.familySensitivity.maxSpread).toBeGreaterThan(result.familySensitivity.materialThreshold);
    // The caveat must be surfaced, not merely computed.
    expect(result.warnings.join(' ')).toMatch(/DOMINANT UNCERTAINTY/);
    expect(result.basis.caveats.join(' ')).toMatch(/familySensitivity/);
  });

  it('fits a chip allocation and reports the granularity floor', () => {
    const result = fitChipAllocation(
      [
        { lower: 0, upper: 10, chips: 2 },
        { lower: 10, upper: 20, chips: 8 },
        { lower: 20, upper: 30, chips: 6 },
        { lower: 30, upper: 40, chips: 4 },
      ],
      { families: ['normal', 'lognormal', 'gamma', 'weibull'] },
    );
    expect(result.totalChips).toBe(20);
    expect(result.granularity).toBeCloseTo(0.05, 12);
    // Cumulative probabilities at the three interior edges.
    expect(result.impliedQuantiles.map((q) => q.level)).toEqual([0.1, 0.5, 0.8]);
    expect(result.impliedQuantiles.map((q) => q.value)).toEqual([10, 20, 30]);
    expect(result.exactness).toBe('assumed');
    expect(result.fit.exactness).toBe('assumed');
  });

  it('runs a bisection protocol in probability, median first', () => {
    const first = nextBisectionQuestion([]);
    expect(first.done).toBe(false);
    expect(first.targetLevel).toBe(0.5);
    expect(first.prompt).toMatch(/equally likely/);
    const second = nextBisectionQuestion([{ level: 0.5, value: 100 }]);
    // Both outer brackets are 0.5 wide; the first widest found is (0, 0.5).
    expect(second.targetLevel).toBe(0.25);
    const third = nextBisectionQuestion([
      { level: 0.25, value: 80 },
      { level: 0.5, value: 100 },
    ]);
    // Now the widest bracket is (0.5, 1).
    expect(third.targetLevel).toBe(0.75);
    const stopped = nextBisectionQuestion(
      [
        { level: 0.25, value: 80 },
        { level: 0.5, value: 100 },
        { level: 0.75, value: 130 },
      ],
      { maxQuestions: 3 },
    );
    expect(stopped.done).toBe(true);
    expect(stopped.exactness).toBe('assumed');
  });

  it('runs a fixed-interval protocol over the interior of the stated range', () => {
    const q1 = nextFixedIntervalQuestion([], { lower: 0, upper: 60 }, { points: 5 });
    // Interior points of a 7-point grid over [0, 60]: 10, 20, 30, 40, 50.
    expect(q1.targetValue).toBeCloseTo(10, 10);
    const q2 = nextFixedIntervalQuestion([{ level: 0.2, value: 10 }], { lower: 0, upper: 60 }, { points: 5 });
    expect(q2.targetValue).toBeCloseTo(20, 10);
    const answered = [10, 20, 30, 40, 50].map((v, i) => ({ level: 0.1 + i * 0.15, value: v }));
    const done = nextFixedIntervalQuestion(answered, { lower: 0, upper: 60 }, { points: 5 });
    expect(done.done).toBe(true);
    // The analyst's grid is named as a caveat, because it anchors the judge.
    expect(q1.basis.caveats.join(' ')).toMatch(/chosen by the analyst/);
    const qs = quantilesFromFixedInterval([
      { value: 10, probability: 0.1 },
      { value: 30, probability: 0.5 },
      { value: 50, probability: 0.9 },
    ]);
    expect(qs).toEqual([
      { level: 0.1, value: 10 },
      { level: 0.5, value: 30 },
      { level: 0.9, value: 50 },
    ]);
  });

  it('reports framing effects between a fixed-probability and a fixed-value elicitation', () => {
    const result = compareFramings([
      // The same judge, the same quantity. The fixed-probability framing gives
      // the narrower interval, which is the documented direction.
      { framing: 'fixed-probability', quantiles: quantilesFromInterval(100, 90, 110, 0.9) },
      { framing: 'fixed-value', quantiles: quantilesFromInterval(100, 70, 140, 0.9) },
    ]);
    expect(result.framingEffectDetected).toBe(true);
    // Widths 20 and 70.
    expect(result.widthRatio).toBeCloseTo(3.5, 10);
    expect(result.medianSpread).toBeCloseTo(0, 10);
    expect(result.exactness).toBe('assumed');
    expect(result.warnings.join(' ')).toMatch(/framing effect/i);
  });

  it('reads a probability wheel and flags the compression zone', () => {
    const mid = readProbabilityWheel(0.4);
    expect(mid.inCompressionZone).toBe(false);
    expect(mid.asFrequency).toBe('about 400 in 1000');
    const extreme = readProbabilityWheel(0.02);
    expect(extreme.inCompressionZone).toBe(true);
    expect(extreme.warnings.join(' ')).toMatch(/compress/);
    expect(extreme.exactness).toBe('assumed');
  });
});

describe('elicitation: maximum-entropy completion of a partial judgement', () => {
  it('returns the exponential when only a mean is stated on a positive support', () => {
    const mean = 4;
    const result = maximumEntropyCompletion({ support: 'positive-halfline', mean });
    // Textbook answer: rate 1/mean.
    expect(result.closedForm).toBeDefined();
    expect(result.closedForm?.distributionId).toBe('exponential');
    expect(result.closedForm?.params.lambda).toBeCloseTo(1 / mean, 12);
    // The grid solution must reproduce the REGISTRY's exponential density.
    const exponential = getDistribution('exponential');
    const params = { lambda: 1 / mean };
    for (const x of [0.5, 1, 2, 4, 8, 12]) {
      const i = result.solution.support.findIndex((s, k) =>
        k + 1 === result.solution.support.length ? true : Math.abs(s - x) <= Math.abs(result.solution.support[k + 1] - x),
      );
      const exact = exponential.pdf(result.solution.support[i], params);
      // A midpoint grid is second-order accurate in the grid width, so the
      // comparison must be RELATIVE: over [0, 160] with 4000 points the
      // observed worst relative error against the registry's own exponential
      // density is ~1e-4, and 1e-3 bounds it without admitting a wrong family.
      expect(Math.abs(result.solution.density[i] - exact) / exact).toBeLessThan(1e-3);
    }
    expect(result.closedFormAgreement as number).toBeLessThan(1e-3);
    expect(result.gridMean).toBeCloseTo(mean, 8);
    expect(result.exactness).toBe('assumed');
  });

  it('returns the normal when a mean and a variance are stated on the whole line', () => {
    const mean = 10;
    const variance = 9;
    const result = maximumEntropyCompletion({ support: 'reals', mean, variance });
    expect(result.closedForm?.distributionId).toBe('normal');
    expect(result.closedForm?.params.mu).toBeCloseTo(mean, 12);
    expect(result.closedForm?.params.sigma).toBeCloseTo(Math.sqrt(variance), 12);
    // Against the registry's own normal density.
    for (const x of [4, 7, 10, 13, 16]) {
      const i = result.solution.support.reduce(
        (best, s, k) => (Math.abs(s - x) < Math.abs(result.solution.support[best] - x) ? k : best),
        0,
      );
      const exact = NORMAL.pdf(result.solution.support[i], { mu: mean, sigma: Math.sqrt(variance) });
      expect(result.solution.density[i]).toBeCloseTo(exact, 9);
    }
    // The observed worst relative error is ~1e-12; 1e-6 is a generous bound.
    expect(result.closedFormAgreement as number).toBeLessThan(1e-6);
    expect(result.gridMean).toBeCloseTo(mean, 8);
    expect(result.gridVariance).toBeCloseTo(variance, 6);
  });

  it('returns the uniform when only a bounded range is stated', () => {
    const result = maximumEntropyCompletion({ support: 'bounded', range: { lower: 2, upper: 7 } });
    expect(result.closedForm?.distributionId).toBe('uniform');
    expect(result.closedForm?.params.a).toBe(2);
    expect(result.closedForm?.params.b).toBe(7);
    // Uniform density is exactly 1/5 everywhere inside.
    for (const d of result.solution.density) expect(d).toBeCloseTo(0.2, 12);
  });

  it('honours a quantile constraint', () => {
    const result = maximumEntropyCompletion({
      support: 'bounded',
      range: { lower: 0, upper: 100 },
      quantiles: [{ level: 0.25, value: 30 }],
    });
    // The solver reports its own constraint mismatch; it must be negligible.
    expect(result.solution.maxMomentError).toBeLessThan(1e-8);
    const below = stableSum(
      result.solution.support.map((x, i) => (x <= 30 ? result.solution.probabilities[i] : 0)),
    );
    // The grid cannot place a breakpoint exactly at 30, so the realised
    // cumulative probability is accurate to one grid cell (100/4000 = 0.025 in
    // x, which at the solution's density is ~3e-4 in probability).
    expect(below).toBeCloseTo(0.25, 3);
  });
});

describe('elicitation: imprecise judgements stay imprecise', () => {
  it('turns interval-valued probabilities into a credal set', () => {
    const result = elicitImpreciseProbabilities([
      { label: 'low', lower: 0.1, upper: 0.3 },
      { label: 'mid', lower: 0.3, upper: 0.6 },
      { label: 'high', lower: 0.2, upper: 0.4 },
    ]);
    expect(result.totalImprecision).toBeCloseTo(0.2 + 0.3 + 0.2, 12);
    expect(result.widest.label).toBe('mid');
    expect(result.credal.vertices.length).toBeGreaterThan(0);
    // Every vertex is a probability vector.
    for (const v of result.credal.vertices) {
      expect(stableSum(v)).toBeCloseTo(1, 9);
      for (const p of v) expect(p).toBeGreaterThanOrEqual(-1e-9);
    }
    // The reachable bounds can only be tighter than, or equal to, what was said.
    result.reachable.lower.forEach((l, i) => expect(l).toBeGreaterThanOrEqual(result.judgements[i].lower - 1e-12));
    result.reachable.upper.forEach((u, i) => expect(u).toBeLessThanOrEqual(result.judgements[i].upper + 1e-12));
    expect(result.exactness).toBe('assumed');
  });

  it('turns interval-valued quantiles into a p-box that brackets every consistent CDF', () => {
    const result = elicitImpreciseQuantiles(
      [
        { level: 0.1, lower: 8, upper: 12 },
        { level: 0.5, lower: 20, upper: 26 },
        { level: 0.9, lower: 40, upper: 55 },
      ],
      { steps: 200, supportLower: 0, supportUpper: 200 },
    );
    // The box must be non-degenerate where the judge expressed a range.
    expect(result.widthAtStatedLevels.map((w) => w.width)).toEqual([4, 6, 15]);
    // At a stated level the lower CDF bound must not exceed the level, and the
    // upper bound must not fall below it: the judge's own statement is inside.
    for (const j of result.judgements) {
      expect(cdfUpper(result.pbox, j.upper)).toBeGreaterThanOrEqual(j.level - 1 / 200 - 1e-9);
      expect(cdfLower(result.pbox, j.lower)).toBeLessThanOrEqual(j.level + 1 / 200 + 1e-9);
    }
    // The box has positive width somewhere, i.e. it did not collapse to a point.
    let anyWidth = false;
    for (let i = 0; i < result.pbox.n; i++) if (result.pbox.hi[i] > result.pbox.lo[i]) anyWidth = true;
    expect(anyWidth).toBe(true);
    expect(result.exactness).toBe('assumed');
    expect(result.labelled.provenance.exactness).toBe('assumed');
  });
});

describe('elicitation: coherence is reported, never silently repaired', () => {
  const stated = [
    { label: 'A', probability: 0.4 },
    { label: 'B', probability: 0.35 },
    { label: 'C', probability: 0.32 },
  ];

  it('reports a partition summing to 1.07 as incoherent, naming the excess, and changes nothing', () => {
    const result = checkPartitionCoherence(stated);
    expect(result.sum).toBeCloseTo(1.07, 12);
    expect(result.excess).toBeCloseTo(0.07, 12);
    expect(result.coherent).toBe(false);
    const violation = result.violations.find((v) => v.code === 'partition-sum');
    expect(violation).toBeDefined();
    expect(violation?.amount).toBeCloseTo(0.07, 12);
    expect(violation?.message).toMatch(/EXCESS is 0\.07/);
    // NOTHING was renormalised, because nothing was asked for.
    expect(result.adjustment).toBeUndefined();
    expect(result.stated.map((s) => s.probability)).toEqual([0.4, 0.35, 0.32]);
    expect(result.warnings.join(' ')).toMatch(/has NOT been repaired/);
  });

  it('produces the minimum-adjustment coherent set only on request, and it is provably closest', () => {
    const result = checkPartitionCoherence(stated, { adjust: 'least-squares' });
    const adjustment = result.adjustment;
    expect(adjustment).toBeDefined();
    const adjusted = (adjustment as { adjusted: number[] }).adjusted;
    // Sums to exactly 1 and is non-negative.
    expect(stableSum(adjusted)).toBeCloseTo(1, 12);
    for (const p of adjusted) expect(p).toBeGreaterThanOrEqual(0);
    // The Euclidean projection shifts every element by the same amount here
    // (no component is clipped), so each falls by exactly 0.07/3.
    for (let i = 0; i < 3; i++) expect(adjusted[i]).toBeCloseTo(stated[i].probability - 0.07 / 3, 12);
    const distanceTo = (v: readonly number[]): number =>
      Math.sqrt(stableSum(v.map((x, i) => (x - stated[i].probability) ** 2)));
    const best = distanceTo(adjusted);
    expect(best).toBeCloseTo((adjustment as { distance: number }).distance, 12);
    // Verify optimality directly: every nearby coherent vector is FURTHER away.
    // Each perturbation keeps the sum at 1 and stays non-negative, so it is a
    // legitimate competitor.
    const perturbations: number[][] = [
      [adjusted[0] + 0.01, adjusted[1] - 0.01, adjusted[2]],
      [adjusted[0] - 0.01, adjusted[1] + 0.01, adjusted[2]],
      [adjusted[0], adjusted[1] + 0.02, adjusted[2] - 0.02],
      [adjusted[0] + 0.05, adjusted[1] - 0.025, adjusted[2] - 0.025],
      [adjusted[0] - 0.001, adjusted[1] - 0.001, adjusted[2] + 0.002],
    ];
    for (const p of perturbations) {
      expect(stableSum(p)).toBeCloseTo(1, 12);
      expect(Math.min(...p)).toBeGreaterThanOrEqual(0);
      expect(distanceTo(p)).toBeGreaterThan(best);
    }
    // The transformation is shown, not hidden.
    expect((adjustment as { delta: number[] }).delta.every((d) => Math.abs(d + 0.07 / 3) < 1e-12)).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/NOT what the judge said/);
  });

  it('offers the KL (proportional) adjustment as a different answer, and says so', () => {
    const ls = checkPartitionCoherence(stated, { adjust: 'least-squares' });
    const kl = checkPartitionCoherence(stated, { adjust: 'kl' });
    const lsAdjusted = (ls.adjustment as { adjusted: number[] }).adjusted;
    const klAdjusted = (kl.adjustment as { adjusted: number[] }).adjusted;
    expect(stableSum(klAdjusted)).toBeCloseTo(1, 12);
    // Proportional renormalisation preserves ratios; least squares does not.
    expect(klAdjusted[0] / klAdjusted[2]).toBeCloseTo(0.4 / 0.32, 12);
    expect(lsAdjusted[0] / lsAdjusted[2]).not.toBeCloseTo(0.4 / 0.32, 6);
    // ...and the KL answer is strictly further away in Euclidean distance,
    // which is what makes the least-squares one the minimum ADJUSTMENT.
    expect((kl.adjustment as { distance: number }).distance).toBeGreaterThan(
      (ls.adjustment as { distance: number }).distance,
    );
  });

  it('leaves an already-coherent set exactly alone even when an adjustment is requested', () => {
    const result = checkPartitionCoherence(
      [
        { label: 'A', probability: 0.5 },
        { label: 'B', probability: 0.5 },
      ],
      { adjust: 'least-squares' },
    );
    expect(result.coherent).toBe(true);
    expect((result.adjustment as { maxAbsChange: number }).maxAbsChange).toBe(0);
  });

  it('flags a conjunction fallacy, naming both the conjunction and the part it exceeds', () => {
    const result = checkConjunction({
      labelA: 'the bank teller is a feminist',
      labelB: 'the bank teller is active in politics',
      probabilityA: 0.4,
      probabilityB: 0.2,
      probabilityAandB: 0.5,
    });
    expect(result.coherent).toBe(false);
    const conjunctionViolations = result.violations.filter((v) => v.code === 'conjunction');
    // It exceeds BOTH parts, so both are named.
    expect(conjunctionViolations.length).toBe(2);
    expect(conjunctionViolations[0].message).toMatch(/CONJUNCTION FALLACY/);
    expect(conjunctionViolations[0].involves).toContain('the bank teller is a feminist');
    expect(conjunctionViolations[0].amount).toBeCloseTo(0.1, 12);
    expect(conjunctionViolations[1].involves).toContain('the bank teller is active in politics');
    expect(conjunctionViolations[1].amount).toBeCloseTo(0.3, 12);
    // Fréchet bounds, with no independence assumed: max(0, 0.6−1)=0 to min=0.2.
    expect(result.conjunctionBound.lower).toBeCloseTo(0, 12);
    expect(result.conjunctionBound.upper).toBeCloseTo(0.2, 12);
    expect(result.productIfIndependent).toBeCloseTo(0.08, 12);
    expect(result.warnings.join(' ')).toMatch(/ONLY under independence/);
    expect(result.exactness).toBe('assumed');
  });

  it('flags a disjunction violation and an inclusion-exclusion failure', () => {
    const result = checkConjunction({
      labelA: 'A',
      labelB: 'B',
      probabilityA: 0.5,
      probabilityB: 0.3,
      probabilityAandB: 0.2,
      probabilityAorB: 0.25,
    });
    expect(result.violations.some((v) => v.code === 'disjunction')).toBe(true);
    // P(A)+P(B)−P(A∩B) = 0.6, not 0.25.
    const ie = result.violations.find((v) => v.code === 'monotonicity');
    expect(ie?.amount).toBeCloseTo(0.35, 10);
  });

  it('measures subadditivity when an event is unpacked', () => {
    const result = checkSubadditivity('the project is late', 0.3, [
      { label: 'late because of procurement', probability: 0.15 },
      { label: 'late because of staffing', probability: 0.15 },
      { label: 'late because of testing', probability: 0.2 },
    ]);
    expect(result.partsSum).toBeCloseTo(0.5, 12);
    expect(result.unpackingExcess).toBeCloseTo(0.2, 12);
    expect(result.subadditive).toBe(true);
    expect(result.violations[0].code).toBe('subadditivity');
    expect(result.violations[0].message).toMatch(/Unpacking INFLATED/);
    expect(result.warnings.join(' ')).toMatch(/Nothing has been reconciled/);
  });

  it('detects partition dependence when the same event is split more finely', () => {
    const result = detectPartitionDependence([
      {
        partitionName: 'two categories',
        categories: [
          { label: 'rises', probability: 0.4 },
          { label: 'does not rise', probability: 0.6 },
        ],
        targetCategories: ['rises'],
      },
      {
        partitionName: 'four categories',
        categories: [
          { label: 'rises a lot', probability: 0.25 },
          { label: 'rises a little', probability: 0.3 },
          { label: 'flat', probability: 0.25 },
          { label: 'falls', probability: 0.2 },
        ],
        targetCategories: ['rises a lot', 'rises a little'],
      },
    ]);
    expect(result.perPartition[0].targetProbability).toBeCloseTo(0.4, 12);
    expect(result.perPartition[1].targetProbability).toBeCloseTo(0.55, 12);
    expect(result.spread).toBeCloseTo(0.15, 12);
    expect(result.detected).toBe(true);
    expect(result.direction).toMatch(/MORE probability/);
    expect(result.warnings.join(' ')).toMatch(/PARTITION DEPENDENCE/);
  });

  it('detects anchoring as a non-zero slope of the judgement on the anchor', () => {
    // A judge pulled halfway toward whatever anchor they were shown: the
    // construction has a slope of exactly 0.5 by design.
    const anchors = [0, 100, 200, 300, 400, 500];
    const sequence = anchors.map((anchor) => ({ label: `q${anchor}`, anchor, judgement: 250 + 0.5 * (anchor - 250) }));
    const result = detectAnchoring(sequence);
    expect(result.anchorSlope).toBeCloseTo(0.5, 12);
    expect(result.anchorCorrelation).toBeCloseTo(1, 12);
    expect(result.detected).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/ANCHORING DETECTED/);
    // A judge who ignores the anchor gives a slope of 0.
    const immune = anchors.map((anchor, i) => ({ label: `q${anchor}`, anchor, judgement: 250 + (i % 2 === 0 ? 1 : -1) }));
    const clean = detectAnchoring(immune);
    expect(Math.abs(clean.anchorSlope)).toBeLessThan(0.05);
    expect(clean.detected).toBe(false);
    // Sample-size honesty is unconditional.
    expect(clean.warnings.join(' ')).toMatch(/rests on 6 judgements/);
  });

  it('reports format effects and recommends the frequency framing', () => {
    const result = compareProbabilityFormats([
      { format: 'percentage', probability: 0.1 },
      { format: 'natural-frequency', probability: 0.03 },
      { format: 'verbal', probability: 0.25 },
    ]);
    expect(result.spread).toBeCloseTo(0.22, 12);
    expect(result.detected).toBe(true);
    expect(result.recommendedFormat).toBe('natural-frequency');
    expect(result.recommendation).toMatch(/reduce error/);
    expect(result.warnings.join(' ')).toMatch(/FORMAT EFFECT/);
    expect(result.warnings.join(' ')).toMatch(/verbal/);
  });
});

describe('elicitation: calibration measured against known truth, in both directions', () => {
  it('finds ~zero calibration error and a flat PIT for a perfectly calibrated judge', () => {
    const rng = new Random('calibrated-judge');
    // Probabilities drawn from a small discrete set so that each distinct
    // forecast value has thousands of observations; outcomes generated FROM
    // those probabilities, so the judge is calibrated by construction.
    const values = [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95];
    const forecasts: number[] = [];
    const outcomes: number[] = [];
    const n = 30000;
    for (let i = 0; i < n; i++) {
      const p = values[rng.int(0, values.length - 1)];
      forecasts.push(p);
      outcomes.push(rng.uniform() < p ? 1 : 0);
    }
    const record = scoreBinaryRecord(forecasts, outcomes);
    // The reliability (calibration) term of the Murphy decomposition is a
    // weighted mean squared gap between forecast and observed frequency. Under
    // perfect calibration its expectation is Σ (n_k/n)·p_k(1−p_k)/n_k =
    // (Σ_k p_k(1−p_k))/n ≈ 0.2 × 10 / 30000 ≈ 6.7e-5 — sampling noise only.
    // 1e-3 is fifteen times that and far below any real miscalibration.
    expect(record.calibrationComponent).toBeLessThan(1e-3);
    // The decomposition must close exactly for distinct-value binning.
    expect(record.brier.decompositionResidual).toBeLessThan(1e-12);
    expect(record.brier.decompositionExact).toBe(true);
    // Resolution is real: these forecasts do separate the outcomes. The
    // variance of p over the 10 values is 0.0825, which is the expected
    // resolution of a calibrated judge.
    expect(record.resolutionComponent).toBeCloseTo(0.0825, 2);
    expect(record.brierSkill.skill).toBeGreaterThan(0.3);

    // The continuous counterpart: predictive normals whose outcomes are drawn
    // from those very normals, so the PIT is uniform by construction.
    const rng2 = new Random('calibrated-continuous');
    const predictive: { distributionId: string; params: Record<string, number> }[] = [];
    const ys: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const mu = rng2.normal() * 20;
      predictive.push({ distributionId: 'normal', params: { mu, sigma: 5 } });
      ys.push(mu + rng2.normal() * 5);
    }
    const continuous = scoreContinuousRecord(predictive, ys);
    // The histogram must be FLAT, asserted as a real test rather than against
    // a label: with 10 bins df = 9, and the 99.9th percentile of χ²_9 is
    // 27.877, so a calibrated judge fails χ² < 27.877 once in a thousand
    // records. (The module's own "consistent with uniform" label uses the much
    // stricter χ² ≤ df, which a perfectly calibrated judge fails about half the
    // time by construction, so it is not the right thing to assert here.)
    expect(continuous.pit.chiSquared).toBeLessThan(
      getDistribution('chiSquare').quantile(0.999, { k: 9 }),
    );
    expect(continuous.pit.degreesOfFreedom).toBe(9);
    // ...and crucially, none of the MISCALIBRATION diagnoses fires.
    expect(continuous.diagnosis).not.toBe('too narrow');
    expect(continuous.diagnosis).not.toBe('too wide');
    expect(continuous.diagnosis).not.toBe('biased high');
    expect(continuous.diagnosis).not.toBe('biased low');
    // The 90% intervals of a calibrated judge capture 90% of outcomes. The
    // binomial standard error at n = 2000 is √(0.9·0.1/2000) = 0.0067, so 4
    // standard errors is 0.027.
    expect(Math.abs(continuous.central90Coverage - 0.9)).toBeLessThan(0.027);
    // Every bin within 4 standard deviations of the expected 200. The count in
    // a bin is Binomial(2000, 0.1), sd = √(2000·0.1·0.9) = 13.4, so 4 sd = 54.
    for (const c of continuous.pit.counts) {
      expect(c).toBeGreaterThan(200 - 54);
      expect(c).toBeLessThan(200 + 54);
    }
    expect(continuous.meanPit).toBeCloseTo(0.5, 1);
    // Var of a uniform is 1/12 = 0.08333.
    expect(continuous.variancePit).toBeCloseTo(1 / 12, 2);
  });

  it('detects a judge whose intervals are too narrow by a KNOWN factor, and recovers that factor', () => {
    // The judge's true error sd is 10, but they state 90% intervals of
    // half-width z(0.95)·10/k, i.e. narrower by the factor k. The realised
    // coverage then has the closed form 2Φ(z(0.95)/k) − 1.
    for (const k of [1.5, 2, 3]) {
      const rng = new Random(`overconfident-${k}`);
      const half = (z(0.95) * 10) / k;
      const intervals: { lower: number; upper: number; nominalLevel: number }[] = [];
      const outcomes: number[] = [];
      const n = 2000;
      for (let i = 0; i < n; i++) {
        const centre = 100 + rng.normal() * 50;
        outcomes.push(centre + rng.normal() * 10);
        intervals.push({ lower: centre - half, upper: centre + half, nominalLevel: 0.9 });
      }
      const result = intervalCalibration(intervals, outcomes);
      const predictedCoverage = 2 * Phi(z(0.95) / k) - 1;
      // Binomial standard error at n = 2000 is at most √(0.25/2000) = 0.0112,
      // so 4 standard errors is 0.045. The tolerance is that, not a fudge.
      expect(result.hitRate).toBeCloseTo(predictedCoverage, 1);
      expect(Math.abs(result.hitRate - predictedCoverage)).toBeLessThan(0.045);
      // The shortfall is real and in the overconfident direction.
      expect(result.hitRate).toBeLessThan(0.9);
      expect(result.shortfall).toBeGreaterThan(0);
      expect(result.significantlyMiscalibrated).toBe(true);
      expect(result.diagnosis).toBe('too narrow');
      // The width correction must recover the factor the intervals were
      // narrowed by. Propagating the 0.045 coverage uncertainty through
      // z(0.9)/z(c) gives roughly 8% at k = 3, so 15% is a safe bound that
      // still excludes any wrong answer (k = 2 vs k = 3 differ by 50%).
      expect(result.correctedWidthMultiplier).toBeGreaterThan(k * 0.85);
      expect(result.correctedWidthMultiplier).toBeLessThan(k * 1.15);
      // Widening by the reported factor restores the nominal width (2·z(0.95)·10
      // = 32.90), to within the same 15% the multiplier itself is known to.
      const nominalWidth = 2 * z(0.95) * 10;
      expect(Math.abs(result.correctedIntervals[0].width - nominalWidth) / nominalWidth).toBeLessThan(0.15);
      expect(result.warnings.join(' ')).toMatch(/OVERCONFIDENCE/);
      expect(result.exactness).toBe('assumed');
    }
  });

  it('diagnoses a too-narrow continuous judge as U-shaped, and a too-wide one as hump-shaped', () => {
    const build = (statedSigma: number, seed: string) => {
      const rng = new Random(seed);
      const predictive: { distributionId: string; params: Record<string, number> }[] = [];
      const ys: number[] = [];
      for (let i = 0; i < 2000; i++) {
        const mu = rng.normal() * 30;
        predictive.push({ distributionId: 'normal', params: { mu, sigma: statedSigma } });
        // The truth always has sd 10, whatever the judge claims.
        ys.push(mu + rng.normal() * 10);
      }
      return scoreContinuousRecord(predictive, ys);
    };
    const narrow = build(4, 'narrow-judge');
    expect(narrow.diagnosis).toBe('too narrow');
    // A too-narrow judge pushes PIT mass to the ends, so its variance exceeds
    // the uniform's 1/12.
    expect(narrow.variancePit).toBeGreaterThan(1 / 12);
    // Stated central 90% intervals of half-width 1.645·4 = 6.58 against a true
    // sd of 10 cover 2Φ(0.658) − 1 = 0.49.
    expect(narrow.central90Coverage).toBeCloseTo(2 * Phi((z(0.95) * 4) / 10) - 1, 1);
    expect(narrow.warnings.join(' ')).toMatch(/OVERCONFIDENCE/);

    const wide = build(30, 'wide-judge');
    expect(wide.diagnosis).toBe('too wide');
    expect(wide.variancePit).toBeLessThan(1 / 12);
    expect(wide.warnings.join(' ')).toMatch(/too WIDE/);
  });

  it('reports a large calibration uncertainty from 12 questions that shrinks as the record grows', () => {
    const twelve = calibrationUncertainty(12);
    // The ECE a perfectly calibrated judge shows at n = 12 with 10 bins is
    // √(2·0.25/(π·1.2)) = 0.364 — larger than almost any miscalibration one
    // would want to detect.
    expect(twelve.eceNoiseFloor).toBeCloseTo(Math.sqrt((2 * 0.25) / (Math.PI * 1.2)), 10);
    expect(twelve.eceNoiseFloor).toBeGreaterThan(0.3);
    expect(twelve.sufficient).toBe(false);
    expect(twelve.verdict).toMatch(/noise floor/);
    expect(twelve.warnings.join(' ')).toMatch(/cannot establish calibration/);
    // It falls as 1/√n, exactly.
    const hundredTwenty = calibrationUncertainty(120);
    const twelveHundred = calibrationUncertainty(1200);
    expect(hundredTwenty.eceNoiseFloor).toBeCloseTo(twelve.eceNoiseFloor / Math.sqrt(10), 12);
    expect(twelveHundred.eceNoiseFloor).toBeCloseTo(twelve.eceNoiseFloor / 10, 12);
    expect(twelveHundred.eceNoiseFloor).toBeLessThan(0.05);
    expect(twelveHundred.sufficient).toBe(true);
    // Monotone decreasing in n.
    const floors = [12, 30, 60, 120, 300, 1200].map((n) => calibrationUncertainty(n).eceNoiseFloor);
    for (let i = 1; i < floors.length; i++) expect(floors[i]).toBeLessThan(floors[i - 1]);
    expect(twelve.exactness).toBe('assumed');
  });
});

describe('elicitation: combining several experts', () => {
  const disagreeing = [
    { expert: 'A', distributionId: 'normal', params: { mu: 0, sigma: 1 } },
    { expert: 'B', distributionId: 'normal', params: { mu: 6, sigma: 1 } },
  ];

  it('makes the linear pool wide and bimodal where the logarithmic pool is narrow', () => {
    const comparison = comparePools(disagreeing);
    // The equal mixture of N(0,1) and N(6,1) has variance 1 + 9 = 10, so
    // sd = √10 = 3.1623 exactly.
    expect(comparison.linear.sd).toBeCloseTo(Math.sqrt(10), 4);
    expect(comparison.linear.multimodal).toBe(true);
    expect(comparison.linear.modes.length).toBe(2);
    expect(comparison.linear.modes[0]).toBeCloseTo(0, 1);
    expect(comparison.linear.modes[1]).toBeCloseTo(6, 1);
    // The geometric mean of two equal-variance normals is normal with the same
    // variance as each: sd = 1, centred between them.
    expect(comparison.logarithmic.sd).toBeCloseTo(1, 4);
    expect(comparison.logarithmic.mean).toBeCloseTo(3, 4);
    expect(comparison.logarithmic.multimodal).toBe(false);
    // The log pool is NARROWER THAN EITHER EXPERT (both have sd 1 — equal here,
    // and far narrower than the honest mixture), which is the stated hazard.
    expect(comparison.sdRatio).toBeCloseTo(Math.sqrt(10), 3);
    expect(comparison.choiceMatters).toBe(true);
    expect(comparison.note.join(' ')).toMatch(/preserves disagreement/i);
    expect(comparison.exactness).toBe('assumed');
  });

  it('reduces both pools to the common distribution when the experts agree exactly', () => {
    const agreeing = [
      { expert: 'A', distributionId: 'normal', params: { mu: 2, sigma: 1.5 } },
      { expert: 'B', distributionId: 'normal', params: { mu: 2, sigma: 1.5 } },
      { expert: 'C', distributionId: 'normal', params: { mu: 2, sigma: 1.5 } },
    ];
    const linear = linearPool(agreeing);
    const logarithmic = logarithmicPool(agreeing);
    // Both must return N(2, 1.5). The grid is finite, so 3 decimals; the
    // observed error is ~2.4e-5 and comes from the trapezoid rule, not the pool.
    expect(linear.mean).toBeCloseTo(2, 6);
    expect(logarithmic.mean).toBeCloseTo(2, 6);
    expect(linear.sd).toBeCloseTo(1.5, 3);
    expect(logarithmic.sd).toBeCloseTo(1.5, 3);
    // The two pools agree with each other to numerical precision.
    expect(linear.sd).toBeCloseTo(logarithmic.sd, 10);
    // ...and with the registry's own density.
    for (let i = 0; i < linear.grid.length; i += 97) {
      const exact = NORMAL.pdf(linear.grid[i], { mu: 2, sigma: 1.5 });
      expect(linear.density[i]).toBeCloseTo(exact, 5);
      expect(logarithmic.density[i]).toBeCloseTo(exact, 5);
    }
  });

  it('attributes disagreement to the between-expert component', () => {
    const result = disagreementMeasures(disagreeing);
    // Means 0 and 6: between-expert variance is the population variance of
    // {0, 6} = 9. Within is the mean of {1, 1} = 1.
    expect(result.betweenExpertVariance).toBeCloseTo(9, 12);
    expect(result.withinExpertVariance).toBeCloseTo(1, 12);
    expect(result.totalVariance).toBeCloseTo(10, 12);
    expect(result.betweenShare).toBeCloseTo(0.9, 12);
    expect(result.largestStandardisedGap.gap).toBeCloseTo(6, 12);
    expect(result.interpretation).toMatch(/which expert is right/);
    expect(result.exactness).toBe('assumed');
  });

  it('shows that treating correlated experts as independent fabricates confidence', () => {
    const experts = [
      { expert: 'A', mean: 10, sd: 4 },
      { expert: 'B', mean: 14, sd: 4 },
    ];
    const independent = correlatedExpertAggregate(experts, 0);
    const correlated = correlatedExpertAggregate(experts, 0.9);
    // Independent: precision 2/16, so sd = 4/√2 = 2.8284.
    expect(independent.sd).toBeCloseTo(4 / Math.sqrt(2), 10);
    expect(independent.inflationFactor).toBeCloseTo(1, 10);
    expect(independent.effectiveNumberOfExperts).toBeCloseTo(2, 10);
    // Correlated: for two exchangeable experts the aggregate variance is
    // s²(1+ρ)/2 = 16·1.9/2 = 15.2, so sd = 3.8987.
    expect(correlated.sd).toBeCloseTo(Math.sqrt((16 * 1.9) / 2), 10);
    // The independence assumption would report a NARROWER answer: that is the
    // fabricated confidence.
    expect(independent.sd).toBeLessThan(correlated.sd);
    expect(correlated.inflationFactor).toBeCloseTo(correlated.sd / independent.sd, 10);
    expect(correlated.inflationFactor).toBeGreaterThan(1.3);
    // Two experts correlated at 0.9 are worth 2/1.9 ≈ 1.053 independent ones.
    expect(correlated.effectiveNumberOfExperts).toBeCloseTo(2 / 1.9, 10);
    expect(correlated.warnings.join(' ')).toMatch(/FABRICATED CONFIDENCE/);
    // The means coincide for an exchangeable structure with equal sds: the
    // correlation changes the WIDTH, not the centre, which is precisely why
    // ignoring it is so easy and so damaging.
    expect(correlated.mean).toBeCloseTo(12, 10);
    expect(independent.mean).toBeCloseTo(12, 10);
    expect(correlated.exactness).toBe('assumed');
  });

  it("gives Cooke's performance weight to the calibrated expert, and beats the worse one", () => {
    const rng = new Random('cooke-seeds');
    const quantileLevels = [0.05, 0.5, 0.95];
    const zs = quantileLevels.map(z);
    const realisations: { question: string; value: number }[] = [];
    const calibrated: { question: string; values: number[] }[] = [];
    const miscalibrated: { question: string; values: number[] }[] = [];
    for (let i = 0; i < 14; i++) {
      const centre = 100 + rng.normal() * 30;
      const truth = centre + rng.normal() * 10;
      realisations.push({ question: `q${i}`, value: truth });
      // Correct centre and correct width.
      calibrated.push({ question: `q${i}`, values: zs.map((v) => centre + v * 10) });
      // Biased by +25 and four times too narrow: wrong in both ways.
      miscalibrated.push({ question: `q${i}`, values: zs.map((v) => centre + 25 + v * 2.5) });
    }
    const experts = [
      { expert: 'calibrated', assessments: calibrated },
      { expert: 'miscalibrated', assessments: miscalibrated },
    ];
    const result = cookeClassicalMethod(experts, realisations);
    const good = result.experts.find((e) => e.expert === 'calibrated');
    const bad = result.experts.find((e) => e.expert === 'miscalibrated');
    expect(good).toBeDefined();
    expect(bad).toBeDefined();
    // The calibration score is a p-value: high for the calibrated expert, and
    // crushed for the one whose realisations never land where they said.
    expect((good as { calibration: number }).calibration).toBeGreaterThan(0.05);
    expect((bad as { calibration: number }).calibration).toBeLessThan(0.01);
    // So the calibrated expert gets much more weight.
    expect((good as { performanceWeight: number }).performanceWeight).toBeGreaterThan(
      (bad as { performanceWeight: number }).performanceWeight,
    );
    expect((good as { performanceWeight: number }).performanceWeight).toBeGreaterThan(0.9);
    // Equal weighting is reported alongside, always.
    expect((good as { equalWeight: number }).equalWeight).toBeCloseTo(0.5, 12);
    // The performance-weighted decision maker beats the worse expert on
    // Cooke's own combined score.
    const badCombined = (bad as { calibration: number; information: number });
    expect(result.performanceWeightedDecisionMaker.combined).toBeGreaterThan(
      badCombined.calibration * badCombined.information,
    );
    // The in-sample comparison is explicitly labelled as in-sample.
    expect(result.warnings.join(' ')).toMatch(/THIS IS IN-SAMPLE/);
    expect(result.exactness).toBe('assumed');
    expect(result.basis.caveats.join(' ')).toMatch(/EQUAL WEIGHTING IS THE BENCHMARK/);

    // Out of sample, with 14 seeds and one clearly better expert, performance
    // weighting does win — which is the honest other half of the story.
    const cv = crossValidateWeighting(experts, realisations);
    expect(cv.winner).toBe('performance');
    expect(cv.performanceWeighted).toBeLessThan(cv.equalWeighted);
  });

  it('confirms the caveat: equal weighting beats performance weighting with few seeds', () => {
    // A deliberate, deterministic construction. Expert B is very narrow, so its
    // INFORMATION score is high, and it happens to be accurate on three of the
    // five seeds. The fitted weights therefore favour it, and on the two seeds
    // where it is badly wrong its narrow distribution is punished heavily.
    const zs = [z(0.05), 0, z(0.95)];
    const truths = [100, 140, 180, 220, 260];
    const honestError = [6, -7, 5, -6, 7];
    const narrowError = [0.5, -0.4, 0.3, 40, -38];
    const realisations = truths.map((value, i) => ({ question: `q${i}`, value }));
    const experts = [
      {
        expert: 'honest',
        assessments: truths.map((t, i) => ({ question: `q${i}`, values: zs.map((v) => t + honestError[i] + v * 10) })),
      },
      {
        expert: 'narrow',
        assessments: truths.map((t, i) => ({ question: `q${i}`, values: zs.map((v) => t + narrowError[i] + v * 2) })),
      },
    ];
    const cooke = cookeClassicalMethod(experts, realisations);
    const narrow = cooke.experts.find((e) => e.expert === 'narrow');
    // The narrow expert earns the majority of the weight on its information
    // score, despite being the worse forecaster.
    expect((narrow as { performanceWeight: number }).performanceWeight).toBeGreaterThan(0.5);
    expect((narrow as { information: number }).information).toBeGreaterThan(
      (cooke.experts.find((e) => e.expert === 'honest') as { information: number }).information,
    );
    const cv = crossValidateWeighting(experts, realisations);
    // Out of sample, equal weighting wins. This CONFIRMS the stated caveat
    // rather than contradicting it.
    expect(cv.winner).toBe('equal');
    expect(cv.equalWeighted).toBeLessThan(cv.performanceWeighted);
    expect(cv.advantage).toBeLessThan(0);
    expect(cv.verdict).toMatch(/Equal weighting generalised better/);
    expect(cv.warnings.join(' ')).toMatch(/EQUAL WEIGHTING WON/);
    // The seed count is flagged as too small for performance weighting.
    expect(cooke.warnings.join(' ')).toMatch(/seed question/);
    expect(cv.exactness).toBe('assumed');
  });
});

describe('elicitation: every result carries the `assumed` exactness', () => {
  it('is true of every result-producing function in the module', () => {
    const rng = new Random('assumed-everywhere');
    const quantiles = statedFrom('normal', { mu: 100, sigma: 15 }, [0.1, 0.5, 0.9]);
    const forecasts: number[] = [];
    const outcomes: number[] = [];
    for (let i = 0; i < 400; i++) {
      const p = 0.1 + 0.8 * rng.uniform();
      forecasts.push(p);
      outcomes.push(rng.uniform() < p ? 1 : 0);
    }
    const intervals = Array.from({ length: 40 }, () => {
      const centre = 100 + rng.normal() * 20;
      return { lower: centre - 10, upper: centre + 10, nominalLevel: 0.9 };
    });
    const intervalOutcomes = intervals.map((iv) => (iv.lower + iv.upper) / 2 + rng.normal() * 9);
    const predictive = Array.from({ length: 60 }, () => {
      const mu = rng.normal() * 10;
      return { distributionId: 'normal', params: { mu, sigma: 4 } };
    });
    const predictiveOutcomes = predictive.map((p) => p.params.mu + rng.normal() * 4);
    const pooledExperts = [
      { expert: 'A', distributionId: 'normal', params: { mu: 0, sigma: 2 } },
      { expert: 'B', distributionId: 'normal', params: { mu: 3, sigma: 2 } },
    ];
    const zs = [z(0.05), 0, z(0.95)];
    const seedExperts = [
      { expert: 'A', assessments: [0, 1, 2, 3].map((i) => ({ question: `q${i}`, values: zs.map((v) => 10 * i + v * 3) })) },
      { expert: 'B', assessments: [0, 1, 2, 3].map((i) => ({ question: `q${i}`, values: zs.map((v) => 10 * i + 1 + v * 4) })) },
    ];
    const seedRealisations = [0, 1, 2, 3].map((i) => ({ question: `q${i}`, value: 10 * i + (i % 2 ? 2 : -2) }));

    const results: { name: string; value: { exactness: string; basis: { exactness: string; restsOn: string; method: string; caveats: string[] } } }[] = [
      { name: 'fitQuantilesToFamily is a QuantileFit inside a result, checked via fitElicitedQuantiles', value: fitElicitedQuantiles(quantiles, { families: ['normal', 'lognormal', 'logistic'] }) },
      {
        name: 'fitChipAllocation',
        value: fitChipAllocation(
          [
            { lower: 0, upper: 1, chips: 3 },
            { lower: 1, upper: 2, chips: 5 },
            { lower: 2, upper: 3, chips: 2 },
          ],
          { families: ['normal', 'gamma'] },
        ),
      },
      { name: 'nextBisectionQuestion', value: nextBisectionQuestion([{ level: 0.5, value: 10 }]) },
      { name: 'nextFixedIntervalQuestion', value: nextFixedIntervalQuestion([], { lower: 0, upper: 10 }) },
      {
        name: 'compareFramings',
        value: compareFramings([
          { framing: 'fixed-probability', quantiles: quantilesFromInterval(10, 8, 12) },
          { framing: 'fixed-value', quantiles: quantilesFromInterval(10, 4, 16) },
        ]),
      },
      { name: 'readProbabilityWheel', value: readProbabilityWheel(0.3) },
      { name: 'maximumEntropyCompletion', value: maximumEntropyCompletion({ support: 'positive-halfline', mean: 5 }) },
      {
        name: 'elicitImpreciseProbabilities',
        value: elicitImpreciseProbabilities([
          { label: 'x', lower: 0.2, upper: 0.5 },
          { label: 'y', lower: 0.4, upper: 0.7 },
        ]),
      },
      {
        name: 'elicitImpreciseQuantiles',
        value: elicitImpreciseQuantiles([
          { level: 0.1, lower: 1, upper: 2 },
          { level: 0.9, lower: 8, upper: 11 },
        ]),
      },
      {
        name: 'checkPartitionCoherence',
        value: checkPartitionCoherence([
          { label: 'a', probability: 0.5 },
          { label: 'b', probability: 0.6 },
        ]),
      },
      {
        name: 'checkConjunction',
        value: checkConjunction({ labelA: 'a', labelB: 'b', probabilityA: 0.5, probabilityB: 0.4, probabilityAandB: 0.3 }),
      },
      {
        name: 'checkSubadditivity',
        value: checkSubadditivity('whole', 0.4, [
          { label: 'p1', probability: 0.3 },
          { label: 'p2', probability: 0.3 },
        ]),
      },
      {
        name: 'detectPartitionDependence',
        value: detectPartitionDependence([
          {
            partitionName: 'coarse',
            categories: [
              { label: 'yes', probability: 0.3 },
              { label: 'no', probability: 0.7 },
            ],
            targetCategories: ['yes'],
          },
          {
            partitionName: 'fine',
            categories: [
              { label: 'yes soon', probability: 0.25 },
              { label: 'yes later', probability: 0.25 },
              { label: 'no', probability: 0.5 },
            ],
            targetCategories: ['yes soon', 'yes later'],
          },
        ]),
      },
      {
        name: 'detectAnchoring',
        value: detectAnchoring([
          { label: 'a', anchor: 0, judgement: 10 },
          { label: 'b', anchor: 50, judgement: 30 },
          { label: 'c', anchor: 100, judgement: 55 },
          { label: 'd', anchor: 150, judgement: 70 },
        ]),
      },
      {
        name: 'compareProbabilityFormats',
        value: compareProbabilityFormats([
          { format: 'percentage', probability: 0.2 },
          { format: 'natural-frequency', probability: 0.1 },
        ]),
      },
      { name: 'linearPool', value: linearPool(pooledExperts) },
      { name: 'logarithmicPool', value: logarithmicPool(pooledExperts) },
      { name: 'comparePools', value: comparePools(pooledExperts) },
      { name: 'disagreementMeasures', value: disagreementMeasures(pooledExperts) },
      { name: 'correlatedExpertAggregate', value: correlatedExpertAggregate([{ expert: 'A', mean: 1, sd: 1 }, { expert: 'B', mean: 2, sd: 1 }], 0.5) },
      { name: 'cookeClassicalMethod', value: cookeClassicalMethod(seedExperts, seedRealisations) },
      { name: 'crossValidateWeighting', value: crossValidateWeighting(seedExperts, seedRealisations) },
      { name: 'intervalCalibration', value: intervalCalibration(intervals, intervalOutcomes) },
      { name: 'calibrationUncertainty', value: calibrationUncertainty(40) },
      { name: 'scoreBinaryRecord', value: scoreBinaryRecord(forecasts, outcomes) },
      { name: 'scoreContinuousRecord', value: scoreContinuousRecord(predictive, predictiveOutcomes) },
    ];

    // Every exported result-producing function is represented here; if one is
    // added without being listed, this count fails and the omission is visible.
    expect(results.length).toBe(26);
    for (const { name, value } of results) {
      expect(value.exactness, `${name} must report the assumed exactness`).toBe('assumed');
      expect(value.basis.exactness, `${name}.basis must report the assumed exactness`).toBe('assumed');
      // ...and must name the judgement it rests on, so the exactness label is
      // backed by a statement of whose opinion produced the number.
      expect(value.basis.restsOn.length, `${name}.basis.restsOn must not be empty`).toBeGreaterThan(10);
      expect(value.basis.method.length, `${name}.basis.method must not be empty`).toBeGreaterThan(5);
      expect(value.basis.caveats.length, `${name} must carry caveats`).toBeGreaterThan(0);
      // The universal caveats are present on every single result.
      expect(value.basis.caveats.join(' '), `${name} must say it is an opinion`).toMatch(
        /an expressed opinion, not a measurement/,
      );
    }
  });

  it('reports the assumed exactness inside the explanation as well', () => {
    const result = fitElicitedQuantiles(statedFrom('normal', { mu: 5, sigma: 1 }, [0.1, 0.5, 0.9]), {
      families: ['normal', 'logistic'],
    });
    expect(result.explanation.exactness).toBe('assumed');
    expect(result.explanation.limitations.join(' ')).toMatch(/the input is an opinion/);
  });
});

describe('elicitation: refusals, each naming what is wrong', () => {
  it('refuses non-monotone elicited quantiles, naming the offending pair', () => {
    let message = '';
    try {
      validateElicitedQuantiles([
        { level: 0.1, value: 10 },
        { level: 0.5, value: 40 },
        { level: 0.9, value: 25 },
      ]);
    } catch (e) {
      expect(e).toBeInstanceOf(EngineError);
      message = (e as EngineError).message;
    }
    expect(message).toMatch(/not monotone/);
    // The specific offending pair is named: level 0.5 → 40 against 0.9 → 25.
    expect(message).toContain('level 0.5 was given the value 40');
    expect(message).toContain('higher level 0.9 was given the smaller value 25');
    expect(message).toMatch(/offending one/);
  });

  it('refuses a quantile level at or outside (0, 1)', () => {
    for (const level of [0, 1, -0.1, 1.5]) {
      expect(() => validateElicitedQuantiles([{ level, value: 10 }])).toThrow(EngineError);
      try {
        validateElicitedQuantiles([{ level, value: 10 }]);
      } catch (e) {
        expect((e as EngineError).message).toContain(String(level));
        expect((e as EngineError).message).toMatch(/outside the open interval \(0, 1\)/);
      }
    }
  });

  it('refuses a stated interval of zero width', () => {
    // Two distinct levels given the same value.
    expect(() =>
      validateElicitedQuantiles([
        { level: 0.1, value: 20 },
        { level: 0.9, value: 20 },
      ]),
    ).toThrow(/zero width/);
    // And a zero-width interval handed to the calibration measurement.
    expect(() => intervalCalibration([{ lower: 5, upper: 5, nominalLevel: 0.9 }], [5])).toThrow(/zero width/);
    // And a zero-width chip bin.
    expect(() =>
      fitChipAllocation([
        { lower: 0, upper: 0, chips: 5 },
        { lower: 0, upper: 1, chips: 5 },
      ]),
    ).toThrow(/zero or negative width/);
  });

  it('refuses a family with more parameters than there are stated quantiles', () => {
    const two: ElicitedQuantile[] = [
      { level: 0.25, value: 10 },
      { level: 0.75, value: 30 },
    ];
    let message = '';
    try {
      // Triangular has three parameters (a, c, b).
      fitQuantilesToFamily('triangular', two);
    } catch (e) {
      expect(e).toBeInstanceOf(EngineError);
      message = (e as EngineError).message;
    }
    expect(message).toMatch(/3 parameters but only 2 quantiles/);
    expect(message).toMatch(/underdetermined/);
    // The two-parameter normal is fine with the same two quantiles.
    expect(() => fitQuantilesToFamily('normal', two)).not.toThrow();
  });

  it('refuses zero experts', () => {
    expect(() => linearPool([])).toThrow(/No experts were supplied/);
    expect(() => logarithmicPool([])).toThrow(/No experts were supplied/);
    expect(() => correlatedExpertAggregate([], 0)).toThrow(/No experts were supplied/);
    expect(() => cookeClassicalMethod([], [{ question: 'q', value: 1 }])).toThrow(/No experts were supplied/);
    expect(() => disagreementMeasures([])).toThrow(/No experts were supplied/);
  });

  it('refuses a performance weighting with zero seed questions', () => {
    const zs = [z(0.05), 0, z(0.95)];
    const experts = [{ expert: 'A', assessments: [{ question: 'q0', values: zs }] }];
    let message = '';
    try {
      cookeClassicalMethod(experts, []);
    } catch (e) {
      expect(e).toBeInstanceOf(EngineError);
      message = (e as EngineError).message;
    }
    expect(message).toMatch(/No seed questions/);
    // It explicitly refuses to fall back to equal weights silently.
    expect(message).toMatch(/falling back to equal weights silently/);
    expect(() => crossValidateWeighting(experts, [])).toThrow(EngineError);
  });

  it('refuses an incoherent judgement asked for a point answer, and a degenerate record', () => {
    // An interval-valued probability table whose lower bounds already exceed 1
    // cannot be satisfied by any distribution.
    expect(() =>
      elicitImpreciseProbabilities([
        { label: 'a', lower: 0.6, upper: 0.8 },
        { label: 'b', lower: 0.6, upper: 0.8 },
      ]),
    ).toThrow(EngineError);
    // A crossed interval.
    expect(() =>
      elicitImpreciseProbabilities([
        { label: 'a', lower: 0.8, upper: 0.2 },
        { label: 'b', lower: 0.1, upper: 0.3 },
      ]),
    ).toThrow(/exceeds its upper bound/);
    // A record in which every outcome is the same cannot identify calibration,
    // and no skill score exists against a perfect baseline.
    expect(() => scoreBinaryRecord([0.3, 0.4, 0.5], [1, 1, 1])).toThrow(/base rate/);
    // Not one interval hit: no finite width correction exists.
    expect(() =>
      intervalCalibration(
        [
          { lower: 0, upper: 1, nominalLevel: 0.9 },
          { lower: 0, upper: 1, nominalLevel: 0.9 },
        ],
        [10, 20],
      ),
    ).toThrow(/no finite correction factor exists/);
  });

  it('refuses the other degenerate inputs, each with its own reason', () => {
    // A variance stated without a mean.
    expect(() => maximumEntropyCompletion({ support: 'reals', variance: 4 })).toThrow(/without a mean/);
    // Nothing stated at all on an unbounded support.
    expect(() => maximumEntropyCompletion({ support: 'reals' })).toThrow(/Nothing was stated/);
    // A correlation of exactly 1 is a singular covariance matrix.
    expect(() =>
      correlatedExpertAggregate([{ expert: 'A', mean: 1, sd: 1 }, { expert: 'B', mean: 2, sd: 1 }], 1),
    ).toThrow(/singular/);
    // A stated sd of 0 would give that expert infinite weight.
    expect(() =>
      correlatedExpertAggregate([{ expert: 'A', mean: 1, sd: 0 }, { expert: 'B', mean: 2, sd: 1 }], 0),
    ).toThrow(/greater than 0/);
    // Disjoint supports make the logarithmic pool undefined, and it says so
    // rather than returning a normalised zero.
    expect(() =>
      logarithmicPool([
        { expert: 'A', distributionId: 'uniform', params: { a: 0, b: 1 } },
        { expert: 'B', distributionId: 'uniform', params: { a: 10, b: 11 } },
      ]),
    ).toThrow(/logarithmic pool is undefined/);
    // A single framing cannot reveal a framing effect.
    expect(() => compareFramings([{ framing: 'fixed-value', quantiles: quantilesFromInterval(1, 0, 2) }])).toThrow(
      /at least two framings/,
    );
    // Anchoring from two points is the line through two points.
    expect(() =>
      detectAnchoring([
        { label: 'a', anchor: 0, judgement: 1 },
        { label: 'b', anchor: 1, judgement: 2 },
      ]),
    ).toThrow(/at least 3 judgements/);
    // An unvarying anchor cannot separate the anchor from the opinion.
    expect(() =>
      detectAnchoring([
        { label: 'a', anchor: 5, judgement: 1 },
        { label: 'b', anchor: 5, judgement: 2 },
        { label: 'c', anchor: 5, judgement: 3 },
      ]),
    ).toThrow(/same anchor/);
    // No chips allocated means nothing was stated.
    expect(() =>
      fitChipAllocation([
        { lower: 0, upper: 1, chips: 0 },
        { lower: 1, upper: 2, chips: 0 },
      ]),
    ).toThrow(/No chips were allocated/);
    // Non-contiguous bins are not a distribution.
    expect(() =>
      fitChipAllocation([
        { lower: 0, upper: 1, chips: 5 },
        { lower: 2, upper: 3, chips: 5 },
      ]),
    ).toThrow(/not contiguous/);
    // A probability of exactly 1 in a fixed-interval answer.
    expect(() => quantilesFromFixedInterval([{ value: 10, probability: 1 }])).toThrow(/statement of certainty/);
    // Mixed nominal levels cannot share one hit rate.
    expect(() =>
      intervalCalibration(
        [
          { lower: 0, upper: 1, nominalLevel: 0.9 },
          { lower: 0, upper: 1, nominalLevel: 0.5 },
        ],
        [0.5, 0.5],
      ),
    ).toThrow(/mix the nominal levels/);
  });
});
