import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  analyseTwoEvents,
  bayes,
  describeProbability,
  diagnostic,
  oddsToProbability,
  parseProbability,
  relativeFrequency,
  totalProbability,
  validateTwoEvents,
} from './basic';
import { analyseRepeated, runProbability } from './repeated';
import { updateBayesian } from './bayesian';
import { combinations, combinationsWithRepetition, factorial, formatCount, multinomial, permutations, permutationsWithRepetition } from '../combinatorics/counting';
import { Rational } from '../core/rational';

describe('probability parsing and representation', () => {
  it('parses decimals, percentages and fractions exactly', () => {
    expect(parseProbability('0.25').exact.toFractionString()).toBe('1/4');
    expect(parseProbability('25%').exact.toFractionString()).toBe('1/4');
    expect(parseProbability('1/4').exact.toFractionString()).toBe('1/4');
    expect(parseProbability(' 2.5e-3 ').value).toBeCloseTo(0.0025, 15);
    expect(parseProbability('1/3').exact.toFractionString()).toBe('1/3');
    expect(() => parseProbability('1.5')).toThrow(/between 0 and 1/);
    expect(() => parseProbability('abc')).toThrow(/not a number/);
    expect(() => parseProbability('-0.1')).toThrow(/between 0 and 1/);
  });
  it('shows complement, percentage, odds and "1 in N"', () => {
    const r = describeProbability({ p: 0.25 });
    expect(r.probability.fraction).toBe('1/4');
    expect(r.probability.percent).toBe('25%');
    expect(r.probability.oneIn).toBe('about 1 in 4');
    expect(r.complement.fraction).toBe('3/4');
    expect(r.oddsFor).toBe('1 : 3');
    expect(r.oddsAgainst).toBe('3 : 1');
    expect(r.explanation.limitations.join(' ')).toMatch(/does not mean exactly one success in every four/);
  });
  it('exact rational arithmetic round-trips', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 1, max: 1000 }), (a, b) => {
        const r = Rational.of(Math.min(a, b), b);
        const c = Rational.ONE.sub(r);
        return Math.abs(r.add(c).toNumber() - 1) < 1e-15 && r.add(c).equals(Rational.ONE);
      }),
    );
  });
});

describe('two-event analysis', () => {
  it('applies the independence multiplication rule', () => {
    const r = analyseTwoEvents({ pA: 0.5, pB: 0.4, relationship: 'independent' });
    expect(r.intersection!.p).toBeCloseTo(0.2, 15);
    expect(r.union!.p).toBeCloseTo(0.7, 15);
    expect(r.intersection!.fraction).toBe('1/5');
    expect(r.bGivenA!.p).toBeCloseTo(0.4, 12);
    expect(r.explanation.assumptions.join(' ')).toMatch(/This was your choice/);
  });
  it('applies the addition rule for mutually exclusive events and flags dependence', () => {
    const r = analyseTwoEvents({ pA: 0.3, pB: 0.2, relationship: 'mutually-exclusive' });
    expect(r.intersection!.p).toBe(0);
    expect(r.union!.p).toBeCloseTo(0.5, 15);
    expect(r.warnings.join(' ')).toMatch(/never independent/);
  });
  it('gives only bounds when the relationship is unknown', () => {
    const r = analyseTwoEvents({ pA: 0.7, pB: 0.6, relationship: 'unknown' });
    expect(r.intersection).toBeNull();
    expect(r.intersectionBounds.low).toBeCloseTo(0.3, 12);
    expect(r.intersectionBounds.high).toBeCloseTo(0.6, 12);
    expect(r.unionBounds.low).toBeCloseTo(0.7, 12);
    expect(r.unionBounds.high).toBeCloseTo(1, 12);
    expect(r.warnings.join(' ')).toMatch(/no single value/);
  });
  it('detects inconsistent inputs', () => {
    expect(validateTwoEvents({ pA: 0.2, pB: 0.3, relationship: 'given-intersection', pAnd: 0.25 })[0].message).toMatch(/cannot exceed the smaller/);
    expect(validateTwoEvents({ pA: 0.8, pB: 0.9, relationship: 'given-intersection', pAnd: 0.1 })[0].message).toMatch(/must overlap by at least/);
    expect(validateTwoEvents({ pA: 0.7, pB: 0.6, relationship: 'mutually-exclusive' })[0].message).toMatch(/summing to more than 1/);
    expect(validateTwoEvents({ pA: 0.2, pB: 0.1, relationship: 'given-conditional', pBGivenA: 0.9 })[0].message).toMatch(/inconsistent/);
  });
  it('reports association when the overlap is supplied', () => {
    const pos = analyseTwoEvents({ pA: 0.5, pB: 0.5, relationship: 'given-intersection', pAnd: 0.4 });
    expect(pos.independenceCheck!.independent).toBe(false);
    expect(pos.warnings.join(' ')).toMatch(/positively associated/);
    const ind = analyseTwoEvents({ pA: 0.5, pB: 0.5, relationship: 'given-intersection', pAnd: 0.25 });
    expect(ind.independenceCheck!.independent).toBe(true);
    const neg = analyseTwoEvents({ pA: 0.5, pB: 0.5, relationship: 'given-intersection', pAnd: 0.1 });
    expect(neg.warnings.join(' ')).toMatch(/negatively associated/);
  });
  it('flags undefined conditionals when a condition has probability zero', () => {
    const r = analyseTwoEvents({ pA: 0, pB: 0.5, relationship: 'independent' });
    expect(r.bGivenA).toBeNull();
    expect(r.warnings.join(' ')).toMatch(/undefined because P\(A\) = 0/);
  });
  it('partition probabilities are checked for completeness', () => {
    expect(() => totalProbability([{ label: 'A', prior: 0.5, likelihood: 0.5 }, { label: 'B', prior: 0.3, likelihood: 0.2 }])).toThrow(/sum to 0.8/);
    const r = totalProbability([
      { label: 'Factory A', prior: 0.6, likelihood: 0.02 },
      { label: 'Factory B', prior: 0.4, likelihood: 0.05 },
    ]);
    expect(r.evidenceProbability.p).toBeCloseTo(0.032, 15);
    expect(r.contributions[0].share).toBeCloseTo(0.012 / 0.032, 12);
  });
});

describe("Bayes' theorem", () => {
  it('computes posteriors for the classic disease-testing figures', () => {
    // Prevalence 1%, sensitivity 99%, specificity 99% → PPV = 50%
    const d = diagnostic({ prevalence: 0.01, sensitivity: 0.99, specificity: 0.99 });
    expect(d.positivePredictiveValue).toBeCloseTo(0.5, 12);
    expect(d.negativePredictiveValue).toBeCloseTo(0.9998979, 6);
    expect(d.per100k.truePositive).toBeCloseTo(990, 6);
    expect(d.per100k.falsePositive).toBeCloseTo(990, 6);
    expect(d.explanation.limitations.join(' ')).toMatch(/not medical advice/);
  });
  it('matches hand-computed multi-hypothesis posteriors', () => {
    const r = bayes([
      { label: 'Urn A', prior: 0.5, likelihood: 0.3 },
      { label: 'Urn B', prior: 0.3, likelihood: 0.6 },
      { label: 'Urn C', prior: 0.2, likelihood: 0.1 },
    ]);
    expect(r.evidenceProbability).toBeCloseTo(0.15 + 0.18 + 0.02, 15);
    expect(r.posteriors[0].posterior).toBeCloseTo(0.15 / 0.35, 12);
    expect(r.posteriors[1].posterior).toBeCloseTo(0.18 / 0.35, 12);
    expect(r.posteriors.reduce((a, p) => a + p.posterior, 0)).toBeCloseTo(1, 12);
  });
  it('rejects priors that do not form a partition and impossible evidence', () => {
    expect(() => bayes([{ label: 'A', prior: 0.5, likelihood: 0.5 }, { label: 'B', prior: 0.2, likelihood: 0.5 }])).toThrow(/sum to 0.7/);
    expect(() => bayes([{ label: 'A', prior: 0.5, likelihood: 0 }, { label: 'B', prior: 0.5, likelihood: 0 }])).toThrow(/probability of the evidence is 0/);
    expect(() => bayes([{ label: 'A', prior: 1, likelihood: 0.5 }])).toThrow(/at least two hypotheses/);
  });
  it('warns about the base-rate effect', () => {
    const r = bayes([
      { label: 'Rare condition', prior: 0.001, likelihood: 0.95 },
      { label: 'No condition', prior: 0.999, likelihood: 0.05 },
    ]);
    expect(r.posteriors[0].posterior).toBeLessThan(0.02);
    expect(r.warnings.join(' ')).toMatch(/base-rate effect/);
  });
});

describe('repeated trials', () => {
  it('at least one success uses the complement rule accurately for tiny p', () => {
    const r = analyseRepeated({ question: 'at-least-one', trials: 1000, p: 1e-6 });
    // 1 − (1 − 1e-6)^1000 ≈ 9.995e-4
    // Reference value from Python: -expm1(1000·log1p(-1e-6)) = 9.995006661255913e-4
    expect(r.probability!).toBeCloseTo(9.995006661255913e-4, 15);
    // The naive form 1 − (1−p)^n loses precision here; ours must not.
    expect(r.probability!).not.toBe(1 - Math.pow(1 - 1e-6, 1000));
  });
  it('exact and cumulative binomial probabilities match hand calculations', () => {
    expect(analyseRepeated({ question: 'exactly-k', trials: 10, p: 0.5, k: 5 }).probability!).toBeCloseTo(252 / 1024, 14);
    expect(analyseRepeated({ question: 'none', trials: 6, p: 1 / 6 }).probability!).toBeCloseTo((5 / 6) ** 6, 14);
    expect(analyseRepeated({ question: 'at-least-k', trials: 6, p: 1 / 6, k: 1 }).probability!).toBeCloseTo(1 - (5 / 6) ** 6, 14);
    expect(analyseRepeated({ question: 'at-most-k', trials: 4, p: 0.5, k: 2 }).probability!).toBeCloseTo(11 / 16, 14);
  });
  it('reports impossible targets as zero rather than erroring', () => {
    const r = analyseRepeated({ question: 'exactly-k', trials: 3, p: 0.5, k: 5 });
    expect(r.probability).toBe(0);
    expect(r.warnings.join(' ')).toMatch(/impossible/);
  });
  it('expected value explains what "expected" means', () => {
    const r = analyseRepeated({ question: 'expected', trials: 10, p: 0.3 });
    expect(r.expectedValue).toBeCloseTo(3, 14);
    expect(r.warnings.join(' ')).toMatch(/long-run average/);
  });
  it('geometric waiting times and medians', () => {
    const r = analyseRepeated({ question: 'trials-until-success', p: 1 / 6 });
    expect(r.expectedValue).toBeCloseTo(6, 12);
    expect(r.warnings.join(' ')).toMatch(/median is 4 trials/);
    expect(analyseRepeated({ question: 'first-success-on-trial', p: 0.5, k: 3 }).probability!).toBeCloseTo(0.125, 14);
    expect(() => analyseRepeated({ question: 'trials-until-success', p: 0 })).toThrow(/never occurs/);
  });
  it('negative binomial expected failures', () => {
    const r = analyseRepeated({ question: 'failures-before-rth-success', p: 0.4, k: 3 });
    expect(r.expectedValue).toBeCloseTo((3 * 0.6) / 0.4, 12);
  });
  it('required trials for a target probability never claims certainty', () => {
    const r = analyseRepeated({ question: 'trials-for-probability', p: 1 / 6, targetProbability: 0.95 });
    // ln(0.05)/ln(5/6) = 16.43 → 17
    expect(r.requiredTrials).toBe(17);
    expect(r.warnings.join(' ')).toMatch(/No finite number of trials reaches 100%/);
  });
  it('run probability matches exhaustive enumeration', () => {
    // Enumerate all 2^n sequences for small n and compare.
    for (const [n, r] of [[8, 3], [10, 4], [6, 2]] as const) {
      for (const p of [0.3, 0.5, 0.75]) {
        let total = 0;
        for (let mask = 0; mask < 1 << n; mask++) {
          let run = 0;
          let maxRun = 0;
          let prob = 1;
          for (let i = 0; i < n; i++) {
            const success = (mask >> i) & 1;
            prob *= success ? p : 1 - p;
            run = success ? run + 1 : 0;
            if (run > maxRun) maxRun = run;
          }
          if (maxRun >= r) total += prob;
        }
        expect(runProbability(n, p, r)).toBeCloseTo(total, 12);
      }
    }
  });
  it('run probability edge cases', () => {
    expect(runProbability(3, 0.5, 5)).toBe(0);
    expect(runProbability(5, 1, 3)).toBe(1);
    expect(runProbability(5, 0, 1)).toBe(0);
    expect(runProbability(1, 0.4, 1)).toBeCloseTo(0.4, 15);
  });
  it('uses the hypergeometric distribution when sampling without replacement', () => {
    const r = analyseRepeated({
      question: 'at-least-one',
      trials: 5,
      p: 4 / 52,
      k: 1,
      withoutReplacement: { populationSize: 52, successesInPopulation: 4 },
    });
    // P(at least one ace in 5 cards) = 1 − C(48,5)/C(52,5) = 0.341...
    expect(r.probability!).toBeCloseTo(1 - 1712304 / 2598960, 12);
    expect(r.warnings.join(' ')).toMatch(/would understate the variability/);
    expect(() => analyseRepeated({ question: 'at-least-one', trials: 60, p: 0.1, withoutReplacement: { populationSize: 52, successesInPopulation: 4 } })).toThrow(/cannot make 60 draws/);
  });
});

describe('combinatorics', () => {
  it('computes exact factorials, permutations and combinations', () => {
    expect(factorial(10).exact).toBe(3628800n);
    expect(factorial(0).exact).toBe(1n);
    expect(permutations(10, 3).exact).toBe(720n);
    expect(combinations(52, 5).exact).toBe(2598960n);
    expect(combinations(49, 6).exact).toBe(13983816n);
    // C(100, 50) exactly
    expect(combinations(100, 50).exact).toBe(100891344545564193334812497256n);
    expect(permutationsWithRepetition(10, 4).exact).toBe(10000n);
    expect(combinationsWithRepetition(5, 3).exact).toBe(35n);
    expect(multinomial([1, 4, 4, 2]).exact).toBe(34650n); // MISSISSIPPI
  });
  it('returns 0 for impossible selections with an explanation', () => {
    const c = combinations(3, 5);
    expect(c.exact).toBe(0n);
    expect(c.note).toMatch(/cannot choose 5 items from only 3/);
  });
  it('handles very large inputs without overflow or hanging', () => {
    const f = factorial(100000);
    expect(f.exact).toBeNull();
    expect(f.digits).toBeGreaterThan(450000);
    expect(f.note).toMatch(/beyond the exact limit/);
    const big = combinations(1000, 500);
    expect(big.exact).not.toBeNull();
    expect(big.digits).toBe(300);
    expect(formatCount(big)).toMatch(/× 10\^299/);
  });
  it('rejects invalid inputs', () => {
    expect(() => factorial(-1)).toThrow(/0 or more/);
    expect(() => factorial(2.5)).toThrow(/whole numbers/);
    expect(() => combinations(5.5, 2)).toThrow(/whole number/);
  });
  it('log value is consistent with the exact value', () => {
    for (const [n, k] of [[52, 5], [100, 50], [1000, 3], [30, 15]] as const) {
      const c = combinations(n, k);
      expect(Math.abs(Math.log(Number(c.exact)) - c.logValue)).toBeLessThan(1e-9 * Math.abs(c.logValue));
    }
  });
});

describe('relative frequency and odds', () => {
  it('estimates from counts with honest warnings', () => {
    const r = relativeFrequency({ successes: 7, trials: 20 });
    expect(r.estimate.p).toBeCloseTo(0.35, 15);
    expect(r.estimate.fraction).toBe('7/20');
    expect(r.warnings.join(' ')).toMatch(/only 20 observations/);
    const allSame = relativeFrequency({ successes: 0, trials: 10 });
    expect(allSame.warnings.join(' ')).toMatch(/does not mean the true probability is exactly/);
    expect(() => relativeFrequency({ successes: 11, trials: 10 })).toThrow(/cannot exceed/);
  });
  it('converts odds to probability', () => {
    expect(oddsToProbability(1, 3).p).toBeCloseTo(0.25, 15);
    expect(oddsToProbability(2, 5).p).toBeCloseTo(2 / 7, 15);
    expect(() => oddsToProbability(0, 0)).toThrow(/greater than 0/);
  });
});

describe('Bayesian conjugate updating', () => {
  it('Beta-Binomial posterior matches the analytic result', () => {
    const r = updateBayesian({ family: 'beta-binomial', priorAlpha: 2, priorBeta: 2, successes: 7, failures: 3 });
    expect(r.params).toEqual({ alpha: 9, beta: 5 });
    expect(r.mean).toBeCloseTo(9 / 14, 15);
    expect(r.mode).toBeCloseTo(8 / 12, 15);
    expect(r.sd).toBeCloseTo(Math.sqrt((9 * 5) / (14 * 14 * 15)), 14);
    // 95% credible interval for Beta(9,5), checked against SciPy: (0.385738, 0.861421)
    expect(r.credibleInterval.low).toBeCloseTo(0.3857383382492956, 9);
    expect(r.credibleInterval.high).toBeCloseTo(0.8614206611098394, 9);
    expect(r.predictive!.value).toBe((9 / 14).toPrecision(6));
    expect(r.explanation.limitations.join(' ')).toMatch(/not a confidence interval/);
  });
  it('flags the uniform prior as a choice', () => {
    const r = updateBayesian({ family: 'beta-binomial', priorAlpha: 1, priorBeta: 1, successes: 3, failures: 1 });
    expect(r.warnings.join(' ')).toMatch(/is a choice, not a neutral fact/);
    expect(r.mean).toBeCloseTo(4 / 6, 15);
  });
  it('Gamma-Poisson posterior and overdispersed predictive', () => {
    const r = updateBayesian({ family: 'gamma-poisson', priorShape: 2, priorRate: 1, events: 10, exposure: 4 });
    expect(r.params.k).toBe(12);
    expect(r.params.theta).toBeCloseTo(1 / 5, 15);
    expect(r.mean).toBeCloseTo(12 / 5, 15);
    expect(r.sd).toBeCloseTo(Math.sqrt(12) / 5, 14);
    expect(r.predictive!.detail).toMatch(/more spread out than a Poisson/);
  });
  it('Normal-Normal posterior is the precision-weighted average', () => {
    const r = updateBayesian({ family: 'normal-normal', priorMean: 100, priorSd: 10, observationSd: 15, sampleMean: 130, sampleSize: 9 });
    const priorPrec = 1 / 100;
    const dataPrec = 9 / 225;
    const expectedMean = (priorPrec * 100 + dataPrec * 130) / (priorPrec + dataPrec);
    expect(r.mean).toBeCloseTo(expectedMean, 12);
    expect(r.sd).toBeCloseTo(Math.sqrt(1 / (priorPrec + dataPrec)), 12);
    expect(r.warnings.join(' ')).toMatch(/80.0% of the weight/);
    expect(r.predictive!.detail).toMatch(/more variable than the mean/);
  });
  it('no data leaves the posterior equal to the prior', () => {
    const r = updateBayesian({ family: 'beta-binomial', priorAlpha: 3, priorBeta: 4, successes: 0, failures: 0 });
    expect(r.mean).toBe(r.prior.mean);
    expect(r.warnings.join(' ')).toMatch(/posterior equals the prior/);
  });
  it('rejects invalid prior parameters', () => {
    expect(() => updateBayesian({ family: 'beta-binomial', priorAlpha: 0, priorBeta: 1, successes: 1, failures: 1 })).toThrow(/greater than 0/);
    expect(() => updateBayesian({ family: 'normal-normal', priorMean: 0, priorSd: -1, observationSd: 1, sampleMean: 0, sampleSize: 1 })).toThrow(/greater than 0/);
  });
});
