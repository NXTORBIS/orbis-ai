/**
 * Tests for the extreme value theory module.
 *
 * Reference values are independent of the implementation:
 *  - closed-form Gumbel / exponential expressions written out inline here;
 *  - textbook analytic facts (Gumbel median −ln ln 2, mean γ, variance π²/6;
 *    GPD mean σ/(1−ξ); the Fisher–Tippett limit of exponential maxima);
 *  - analytic return levels and VaR computed from the TRUE parameters;
 *  - sampling done with inverse-transform formulas written out in the test,
 *    not with the module's own samplers, for the recovery tests.
 *
 * Every Monte Carlo tolerance is justified where it is used.
 */
import { describe, expect, it } from 'vitest';
import { Random } from '../random/rng';
import {
  blockMaxima,
  evtRiskMeasures,
  fitGev,
  fitGevBlockMaxima,
  fitGpdPot,
  gevCdf,
  gevMean,
  gevMedian,
  gevPdf,
  gevQuantile,
  gevReturnLevel,
  gevReturnPeriod,
  gevSupport,
  gevVariance,
  gpdCdf,
  gpdDiagnostics,
  gevDiagnostics,
  gpdMean,
  gpdPdf,
  gpdQuantile,
  gpdReturnLevel,
  gpdReturnLevelYears,
  gpdReturnPeriod,
  gpdSupport,
  hillEstimator,
  hillPlot,
  meanResidualLifePlot,
  nelderMead,
  parameterStabilityPlot,
  pickandsEstimator,
  runsDecluster,
  suggestThreshold,
} from './index';

// ---------------------------------------------------------------------------
// Independent closed forms, written here so the tests do not check the module
// against itself.
// ---------------------------------------------------------------------------

/** Gumbel cdf exp(−exp(−(x−μ)/σ)). */
const gumbelCdf = (x: number, mu: number, sigma: number): number => Math.exp(-Math.exp(-(x - mu) / sigma));
/** Gumbel density. */
const gumbelPdf = (x: number, mu: number, sigma: number): number => {
  const z = (x - mu) / sigma;
  return (1 / sigma) * Math.exp(-z - Math.exp(-z));
};
/** Gumbel quantile μ − σ ln(−ln p). */
const gumbelQuantile = (p: number, mu: number, sigma: number): number => mu - sigma * Math.log(-Math.log(p));
/** Exponential cdf with scale σ. */
const expCdf = (y: number, sigma: number): number => 1 - Math.exp(-y / sigma);
/** Inverse-transform GPD sample, written out independently of the module. */
const gpdInverse = (u: number, sigma: number, xi: number): number =>
  xi === 0 ? -sigma * Math.log(1 - u) : (sigma / xi) * (Math.pow(1 - u, -xi) - 1);
/** Analytic m-observation return level of a GPD with ζ = 1. */
const analyticGpdReturnLevel = (m: number, sigma: number, xi: number, u = 0): number =>
  u + (sigma / xi) * (Math.pow(m, xi) - 1);

const EULER = 0.5772156649015329;

describe('GEV distribution', () => {
  it('matches the independent Gumbel closed form at ξ = 0', () => {
    for (const x of [-2, -0.5, 0, 0.3665, 1, 2.5, 6]) {
      expect(gevCdf(x, { location: 0, scale: 1, shape: 0 })).toBeCloseTo(gumbelCdf(x, 0, 1), 14);
      expect(gevPdf(x, { location: 0, scale: 1, shape: 0 })).toBeCloseTo(gumbelPdf(x, 0, 1), 14);
      expect(gevCdf(x, { location: 3, scale: 2.5, shape: 0 })).toBeCloseTo(gumbelCdf(x, 3, 2.5), 14);
    }
    for (const p of [0.01, 0.25, 0.5, 0.9, 0.999]) {
      expect(gevQuantile(p, { location: 0, scale: 1, shape: 0 })).toBeCloseTo(gumbelQuantile(p, 0, 1), 12);
    }
  });

  it('round-trips cdf and quantile in all three shape regimes, ξ = 0 included', () => {
    const shapes = [0.4, 0.2, 0, -0.2, -0.45];
    const probs = [1e-6, 0.01, 0.2, 0.5, 0.8, 0.99, 1 - 1e-6];
    for (const shape of shapes) {
      const params = { location: 7, scale: 3, shape };
      for (const p of probs) {
        const x = gevQuantile(p, params);
        expect(gevCdf(x, params)).toBeCloseTo(p, 10);
      }
    }
  });

  it('is continuous at ξ → 0: ξ = 1e-10 agrees with the Gumbel form', () => {
    // This is the divide-by-zero trap: (1+ξz)^(−1/ξ) must be evaluated in logs.
    const tiny = { location: 1.5, scale: 2, shape: 1e-10 };
    for (const x of [-4, 0, 1.5, 3, 8, 15]) {
      expect(gevCdf(x, tiny)).toBeCloseTo(gumbelCdf(x, 1.5, 2), 10);
      expect(gevPdf(x, tiny)).toBeCloseTo(gumbelPdf(x, 1.5, 2), 10);
    }
    for (const p of [0.05, 0.5, 0.95, 0.999]) {
      // Relative agreement to ~1e-6, as required.
      const a = gevQuantile(p, tiny);
      const b = gumbelQuantile(p, 1.5, 2);
      expect(Math.abs(a - b) / Math.max(1, Math.abs(b))).toBeLessThan(1e-6);
    }
    // And from the other side of zero.
    expect(gevCdf(2, { location: 1.5, scale: 2, shape: -1e-10 })).toBeCloseTo(gumbelCdf(2, 1.5, 2), 10);
  });

  it('reproduces the analytic Gumbel median, mean and variance', () => {
    const standard = { location: 0, scale: 1, shape: 0 };
    expect(gevMedian(standard)).toBeCloseTo(-Math.log(Math.log(2)), 12); // 0.3665129...
    expect(gevMedian(standard)).toBeCloseTo(0.36651292058166435, 12);
    expect(gevMean(standard).value).toBeCloseTo(EULER, 12);
    expect(gevVariance(standard).value).toBeCloseTo((Math.PI * Math.PI) / 6, 12);
    expect(gevVariance(standard).value).toBeCloseTo(1.6449340668482264, 12);
  });

  it('reports an undefined mean for ξ ≥ 1 and an undefined variance for ξ ≥ 1/2', () => {
    const heavy = { location: 0, scale: 1, shape: 1 };
    const mean = gevMean(heavy);
    expect(mean.value).toBeNull();
    expect(mean.undefinedReason).toMatch(/infinite/);
    const variance = gevVariance({ location: 0, scale: 1, shape: 0.5 });
    expect(variance.value).toBeNull();
    // Nothing is substituted for the missing value.
    expect(Number.isNaN(mean.value as unknown as number)).toBe(false);
  });

  it('enforces exact support boundaries', () => {
    // ξ < 0: hard upper bound μ − σ/ξ = 0 − 1/(−0.25) = 4.
    const bounded = { location: 0, scale: 1, shape: -0.25 };
    expect(gevSupport(bounded).upper).toBe(4);
    expect(gevCdf(4, bounded)).toBe(1);
    expect(gevCdf(4.000001, bounded)).toBe(1);
    expect(gevCdf(1e9, bounded)).toBe(1);
    expect(gevPdf(4.5, bounded)).toBe(0);
    expect(gevQuantile(1, bounded)).toBe(4);
    for (const p of [0.9, 0.999, 1 - 1e-15]) expect(gevQuantile(p, bounded)).toBeLessThanOrEqual(4);
    // ξ > 0: hard lower bound μ − σ/ξ = −2.
    const heavy = { location: 0, scale: 1, shape: 0.5 };
    expect(gevSupport(heavy).lower).toBe(-2);
    expect(gevCdf(-2, heavy)).toBe(0);
    expect(gevCdf(-5, heavy)).toBe(0);
    expect(gevPdf(-3, heavy)).toBe(0);
    for (const p of [1e-12, 0.001]) expect(gevQuantile(p, heavy)).toBeGreaterThanOrEqual(-2);
  });
});

describe('GPD distribution', () => {
  it('matches the independent exponential closed form at ξ = 0', () => {
    for (const y of [0, 0.5, 1, 3, 10]) {
      expect(gpdCdf(5 + y, { scale: 2, shape: 0, threshold: 5 })).toBeCloseTo(expCdf(y, 2), 14);
      expect(gpdPdf(5 + y, { scale: 2, shape: 0, threshold: 5 })).toBeCloseTo((1 / 2) * Math.exp(-y / 2), 14);
    }
    // Mean of the ξ = 0 GPD is u + σ, i.e. the exponential mean σ above u.
    expect(gpdMean({ scale: 2, shape: 0, threshold: 5 }).value).toBeCloseTo(7, 12);
  });

  it('is continuous at ξ → 0: ξ = 1e-10 agrees with the exponential form', () => {
    const tiny = { scale: 2, shape: 1e-10, threshold: 0 };
    for (const y of [0.1, 1, 4, 20]) {
      expect(gpdCdf(y, tiny)).toBeCloseTo(expCdf(y, 2), 10);
      expect(gpdPdf(y, tiny)).toBeCloseTo((1 / 2) * Math.exp(-y / 2), 10);
    }
    for (const p of [0.01, 0.5, 0.99, 0.9999]) {
      const a = gpdQuantile(p, tiny);
      const b = -2 * Math.log(1 - p);
      expect(Math.abs(a - b) / Math.max(1, Math.abs(b))).toBeLessThan(1e-6);
    }
  });

  it('round-trips cdf and quantile in all three shape regimes', () => {
    for (const shape of [0.6, 0.25, 0, -0.3, -0.8]) {
      const params = { scale: 1.7, shape, threshold: 4 };
      for (const p of [1e-8, 0.05, 0.5, 0.95, 1 - 1e-8]) {
        expect(gpdCdf(gpdQuantile(p, params), params)).toBeCloseTo(p, 10);
      }
    }
  });

  it('has mean σ/(1−ξ) above the threshold, and no mean at all for ξ ≥ 1', () => {
    expect(gpdMean({ scale: 3, shape: 0.5, threshold: 0 }).value).toBeCloseTo(6, 12);
    expect(gpdMean({ scale: 3, shape: -0.5, threshold: 10 }).value).toBeCloseTo(12, 12);
    for (const shape of [1, 1.3, 2]) {
      const m = gpdMean({ scale: 3, shape, threshold: 0 });
      expect(m.value).toBeNull();
      expect(m.undefinedReason).toMatch(/infinite/);
    }
  });

  it('enforces the exact upper endpoint when ξ < 0', () => {
    const bounded = { scale: 2, shape: -0.5, threshold: 1 };
    expect(gpdSupport(bounded).upper).toBe(5); // u − σ/ξ = 1 + 4
    expect(gpdCdf(5, bounded)).toBe(1);
    expect(gpdCdf(5.0001, bounded)).toBe(1);
    expect(gpdPdf(6, bounded)).toBe(0);
    expect(gpdQuantile(1, bounded)).toBe(5);
    for (const p of [0.99, 1 - 1e-15]) expect(gpdQuantile(p, bounded)).toBeLessThanOrEqual(5);
    expect(gpdCdf(0.5, bounded)).toBe(0); // below the threshold
  });
});

describe('maximum likelihood recovery', () => {
  // 20,000 draws from a known GPD, generated by inverse transform written out
  // in this file (independent of the module's sampler).
  const rng = new Random('evt-gpd-recovery-seed');
  const trueScale = 2;
  const trueShape = 0.3;
  const sample: number[] = [];
  for (let i = 0; i < 20000; i++) sample.push(gpdInverse(rng.uniformOpen(), trueScale, trueShape));

  it('recovers a known GPD (σ = 2, ξ = 0.3) within the standard errors it computes', () => {
    const fit = fitGpdPot(sample, { threshold: 0 });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    const { params, estimates, diagnostics } = fit.value;
    expect(diagnostics.converged).toBe(true);
    expect(diagnostics.observationsUsed).toBe(20000);
    expect(diagnostics.iterations).toBeGreaterThan(0);
    const seScale = estimates[0].standardError;
    const seShape = estimates[1].standardError;
    expect(seScale).not.toBeNull();
    expect(seShape).not.toBeNull();
    // Within 3 standard errors: a 99.7% statement under the asymptotic normal
    // approximation, so a fixed seed passing it is not luck.
    expect(Math.abs(params.scale - trueScale)).toBeLessThan(3 * (seScale as number));
    expect(Math.abs(params.shape - trueShape)).toBeLessThan(3 * (seShape as number));
    // The standard errors themselves must be of the right order: the
    // asymptotic value for ξ is (1+ξ)/√n = 1.3/141 ≈ 0.0092.
    expect(seShape as number).toBeGreaterThan(0.004);
    expect(seShape as number).toBeLessThan(0.02);
  });

  it('gives a profile-likelihood interval for ξ that contains the true value', () => {
    const fit = fitGpdPot(sample, { threshold: 0 });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    const { lower, upper } = fit.value.shapeInterval;
    expect(lower).not.toBeNull();
    expect(upper).not.toBeNull();
    expect(lower as number).toBeLessThan(trueShape);
    expect(upper as number).toBeGreaterThan(trueShape);
    // A 95% profile interval on 20,000 points should be narrow (≈ ±0.02).
    expect((upper as number) - (lower as number)).toBeLessThan(0.1);
  });

  it('matches the analytic return level computed from the true parameters', () => {
    const fit = fitGpdPot(sample, { threshold: 0 });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    const m = 10000;
    const truth = analyticGpdReturnLevel(m, trueScale, trueShape); // closed form
    const rl = gpdReturnLevel(fit.value, m);
    expect(rl.ok).toBe(true);
    if (!rl.ok) return;
    expect(rl.value.standardError).not.toBeNull();
    // Within 3 delta-method standard errors of the analytic truth.
    expect(Math.abs(rl.value.level - truth)).toBeLessThan(3 * (rl.value.standardError as number));
    expect(rl.value.profileInterval.lower as number).toBeLessThan(truth);
    expect(rl.value.profileInterval.upper as number).toBeGreaterThan(truth);
    expect(rl.value.explanation.exactness).toBe('numerical');
    expect(rl.value.explanation.limitations.join(' ')).toMatch(/judgement call/);
  });

  it('recovers the Fisher–Tippett limit: maxima of n Exp(1) are Gumbel with σ = 1, μ = ln n', () => {
    // Classic analytic result: for X_i ~ Exp(1), max of n has cdf
    // (1−e^{−x})^n → exp(−e^{−(x−ln n)}), i.e. Gumbel(ln n, 1).
    const r = new Random('evt-gumbel-limit-seed');
    const blockSize = 200;
    const blocks = 400;
    const data: number[] = [];
    for (let i = 0; i < blockSize * blocks; i++) data.push(-Math.log(r.uniformOpen())); // Exp(1), inline
    const fit = fitGevBlockMaxima(data, { blockSize });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    const { params, estimates, diagnostics } = fit.value;
    expect(diagnostics.converged).toBe(true);
    expect(diagnostics.observationsUsed).toBe(blocks);
    const seLoc = estimates[0].standardError as number;
    const seScale = estimates[1].standardError as number;
    const seShape = estimates[2].standardError as number;
    // 3 standard errors again. The limit is approached at rate O(1/ln n), so a
    // small bias in ξ is expected; with 400 maxima se(ξ) ≈ 0.04, and the known
    // finite-n bias of blocked exponentials is well inside 3 se.
    expect(Math.abs(params.location - Math.log(blockSize))).toBeLessThan(3 * seLoc);
    expect(Math.abs(params.scale - 1)).toBeLessThan(3 * seScale);
    expect(Math.abs(params.shape - 0)).toBeLessThan(3 * seShape);
    expect(fit.value.shapeInterval.lower as number).toBeLessThan(0);
    expect(fit.value.shapeInterval.upper as number).toBeGreaterThan(0);
  });

  it('recovers a heavy-tailed GEV from block maxima of Pareto data', () => {
    // Maxima of Pareto(α) are Fréchet with ξ = 1/α. Here α = 2.5 → ξ = 0.4.
    const r = new Random('evt-frechet-seed');
    const alpha = 2.5;
    const blockSize = 50;
    const blocks = 600;
    const data: number[] = [];
    for (let i = 0; i < blockSize * blocks; i++) data.push(Math.pow(r.uniformOpen(), -1 / alpha)); // Pareto, inline
    const fit = fitGevBlockMaxima(data, { blockSize });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    const seShape = fit.value.estimates[2].standardError as number;
    expect(Math.abs(fit.value.params.shape - 1 / alpha)).toBeLessThan(3 * seShape);
    expect(fit.value.blockSize).toBe(blockSize);
  });
});

describe('honest refusals', () => {
  it('refuses a GPD fit with too few exceedances, saying how many there are and how many are needed', () => {
    const data = Array.from({ length: 200 }, (_v, i) => i / 100); // 0 … 1.99
    const fit = fitGpdPot(data, { threshold: 1.95 }); // only a handful above
    expect(fit.ok).toBe(false);
    if (fit.ok) return;
    const message = fit.errors.map((e) => e.message).join(' ');
    expect(message).toMatch(/Too few exceedances/);
    expect(message).toMatch(/4 of 200/);
    expect(message).toMatch(/[Aa]t least 10 are needed/);
  });

  it('refuses a GEV fit with too few block maxima', () => {
    const fit = fitGev([1, 2, 3, 4, 5]);
    expect(fit.ok).toBe(false);
    if (fit.ok) return;
    expect(fit.errors[0].message).toMatch(/Too few block maxima/);
    expect(fit.errors[0].message).toMatch(/5 available/);
  });

  it('refuses degenerate data rather than returning a scale of 0', () => {
    const fit = fitGev(new Array<number>(40).fill(3));
    expect(fit.ok).toBe(false);
    if (fit.ok) return;
    expect(fit.errors[0].message).toMatch(/identical/);
  });

  it('reports non-convergence instead of presenting the last iterate as a fit', () => {
    // Rosenbrock from far away with a budget of 3 iterations cannot converge.
    const rosenbrock = (x: number[]): number =>
      Math.pow(1 - x[0], 2) + 100 * Math.pow(x[1] - x[0] * x[0], 2);
    const run = nelderMead(rosenbrock, [-3, 8], { maxIterations: 3, restarts: 0 });
    expect(run.converged).toBe(false);
    expect(run.reason).toBe('max-iterations');
    // And it does converge when given room, so the test is about the budget.
    const good = nelderMead(rosenbrock, [-3, 8], { maxIterations: 4000 });
    expect(good.converged).toBe(true);
    expect(good.x[0]).toBeCloseTo(1, 4);
    expect(good.x[1]).toBeCloseTo(1, 4);
  });

  it('refuses a start point where the likelihood is infinite', () => {
    const run = nelderMead(() => Infinity, [0, 0]);
    expect(run.converged).toBe(false);
    expect(run.reason).toBe('invalid-start');
  });

  it('refuses a return period shorter than the threshold exceedance rate', () => {
    const r = new Random('evt-short-period-seed');
    const data = Array.from({ length: 2000 }, () => -Math.log(r.uniformOpen()));
    const fit = fitGpdPot(data, { threshold: 1.5 });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    const rl = gpdReturnLevel(fit.value, 2);
    expect(rl.ok).toBe(false);
    if (rl.ok) return;
    expect(rl.errors[0].message).toMatch(/not above the threshold/);
  });

  it('refuses a finite return period for a level above a negative-shape upper bound', () => {
    const r = new Random('evt-bounded-seed');
    // Uniform(0,1) data: the exceedance distribution has ξ = −1 with a hard bound at 1.
    const data = Array.from({ length: 3000 }, () => r.uniform());
    const fit = fitGpdPot(data, { threshold: 0.8 });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.value.params.shape).toBeLessThan(0);
    const period = gpdReturnPeriod(fit.value, 5);
    expect(period.ok).toBe(false);
    if (period.ok) return;
    expect(period.errors[0].message).toMatch(/upper bound|exactly 0/);
  });
});

describe('return levels and periods', () => {
  const r = new Random('evt-return-level-seed');
  const data = Array.from({ length: 6000 }, () => gpdInverse(r.uniformOpen(), 1.5, 0.2));

  it('is self-consistent: the return period of a return level is that period', () => {
    const fit = fitGpdPot(data, { threshold: 1 });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    const rl = gpdReturnLevel(fit.value, 50000, { skipProfile: true });
    expect(rl.ok).toBe(true);
    if (!rl.ok) return;
    const back = gpdReturnPeriod(fit.value, rl.value.level);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.value.returnPeriod).toBeCloseTo(50000, 2);
    expect(rl.value.extrapolatedBeyondData).toBe(true);
  });

  it('converts observations to years with the supplied observation rate', () => {
    const fit = fitGpdPot(data, { threshold: 1 });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    const perYear = 365;
    const years = gpdReturnLevelYears(fit.value, 100, perYear, { level: 0.95 });
    const obs = gpdReturnLevel(fit.value, 100 * perYear, { skipProfile: true });
    expect(years.ok && obs.ok).toBe(true);
    if (!years.ok || !obs.ok) return;
    expect(years.value.level).toBeCloseTo(obs.value.level, 10);
    expect(years.value.periodUnit).toBe('years');
    expect(years.value.returnPeriod).toBe(100);
  });

  it('gives a GEV return level consistent with its own return period, in blocks', () => {
    const rr = new Random('evt-gev-return-seed');
    const raw = Array.from({ length: 40000 }, () => -Math.log(rr.uniformOpen()));
    const fit = fitGevBlockMaxima(raw, { blockSize: 100 });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    const rl = gevReturnLevel(fit.value, 100);
    expect(rl.ok).toBe(true);
    if (!rl.ok) return;
    const back = gevReturnPeriod(fit.value, rl.value.level);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.value.returnPeriod).toBeCloseTo(100, 4);
    expect(rl.value.deltaInterval).not.toBeNull();
    expect(rl.value.profileInterval.lower as number).toBeLessThan(rl.value.level);
    expect(rl.value.profileInterval.upper as number).toBeGreaterThan(rl.value.level);
    // The profile interval is asymmetric upwards, which is why it is preferred.
    expect(rl.value.explanation.limitations.join(' ')).toMatch(/profile-likelihood/);
  });
});

describe('EVT value at risk and expected shortfall', () => {
  const r = new Random('evt-var-seed');
  const trueScale = 2;
  const trueShape = 0.25;
  const sample = Array.from({ length: 30000 }, () => gpdInverse(r.uniformOpen(), trueScale, trueShape));

  it('matches the analytic VaR and ES of the true distribution at 99.9% and 99.99%', () => {
    const fit = fitGpdPot(sample, { threshold: 0 });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    for (const level of [0.999, 0.9999]) {
      const risk = evtRiskMeasures(fit.value, level);
      expect(risk.ok).toBe(true);
      if (!risk.ok) continue;
      // Analytic: VaR = (σ/ξ)((1/(1−p))^ξ − 1); ES = (VaR + σ)/(1 − ξ) with u = 0.
      const trueVar = (trueScale / trueShape) * (Math.pow(1 / (1 - level), trueShape) - 1);
      const trueEs = (trueVar + trueScale) / (1 - trueShape);
      // Within 3 delta-method standard errors of the analytic value.
      expect(Math.abs(risk.value.valueAtRisk - trueVar)).toBeLessThan(
        3 * (risk.value.valueAtRiskStandardError as number),
      );
      // ES has no standard error here, so it is checked on a relative scale:
      // 8% at a 1-in-10,000 level with 30,000 draws is comfortably inside
      // sampling error for a ξ = 0.25 tail (ES error scales like the VaR error
      // divided by 1 − ξ).
      expect(Math.abs((risk.value.expectedShortfall as number) - trueEs) / trueEs).toBeLessThan(0.08);
      expect(risk.value.expectedShortfall as number).toBeGreaterThan(risk.value.valueAtRisk);
    }
  });

  it('reports no expected shortfall when the fitted tail has an infinite mean', () => {
    const heavy = new Random('evt-infinite-mean-seed');
    // ξ = 1.5 ⇒ infinite mean. 4,000 draws is plenty to fit ξ > 1.
    const sampleHeavy = Array.from({ length: 4000 }, () => gpdInverse(heavy.uniformOpen(), 1, 1.5));
    const fit = fitGpdPot(sampleHeavy, { threshold: 0 });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.value.params.shape).toBeGreaterThan(1);
    const risk = evtRiskMeasures(fit.value, 0.999);
    expect(risk.ok).toBe(true);
    if (!risk.ok) return;
    expect(risk.value.expectedShortfall).toBeNull();
    expect(risk.value.expectedShortfallUndefinedReason).toMatch(/infinite mean/);
    expect(risk.value.valueAtRisk).toBeGreaterThan(0);
  });

  it('refuses a risk level that is not in the tail the fit describes', () => {
    const fit = fitGpdPot(sample, { threshold: 5 });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    const risk = evtRiskMeasures(fit.value, 0.5);
    expect(risk.ok).toBe(false);
    if (risk.ok) return;
    expect(risk.errors[0].message).toMatch(/not in the tail/);
  });
});

describe('tail index estimators', () => {
  it('Hill recovers 1/α = 0.5 on exact Pareto(α = 2) data', () => {
    const r = new Random('evt-hill-pareto-seed');
    const n = 50000;
    const data = Array.from({ length: n }, () => Math.pow(r.uniformOpen(), -1 / 2)); // Pareto(2), inline
    const k = 2000;
    const e = hillEstimator(data, k);
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    // For exact Pareto data the Hill estimator is unbiased with standard
    // deviation ξ/√k = 0.5/√2000 ≈ 0.0112, so 4 sd ≈ 0.045.
    expect(Math.abs(e.value.tailIndex - 0.5)).toBeLessThan(0.045);
    expect(e.value.paretoExponent as number).toBeCloseTo(2, 0);
    expect(e.value.lower as number).toBeLessThan(0.5);
    expect(e.value.upper as number).toBeGreaterThan(0.5);
  });

  it('Pickands recovers the tail index on Pareto data and refuses when 4k > n', () => {
    const r = new Random('evt-pickands-seed');
    const data = Array.from({ length: 40000 }, () => Math.pow(r.uniformOpen(), -1 / 2));
    const e = pickandsEstimator(data, 500);
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    // Pickands uses three order statistics only; its asymptotic sd at k = 500
    // is about ξ·1.17/√k ≈ 0.026, so 4 sd ≈ 0.11.
    expect(Math.abs(e.value.tailIndex - 0.5)).toBeLessThan(0.11);
    const refused = pickandsEstimator(data, 20000);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.errors[0].message).toMatch(/4k ≤ n/);
  });

  it('refuses the Hill estimator on data whose tail is not positive', () => {
    const data = Array.from({ length: 100 }, (_v, i) => -i - 1);
    const e = hillEstimator(data, 10);
    expect(e.ok).toBe(false);
    if (e.ok) return;
    expect(e.errors[0].message).toMatch(/strictly positive/);
  });

  it('produces a Hill plot that is level around the true index for Pareto data', () => {
    const r = new Random('evt-hillplot-seed');
    const data = Array.from({ length: 20000 }, () => Math.pow(r.uniformOpen(), -1 / 2));
    const plot = hillPlot(data, { kMin: 200, kMax: 4000 });
    expect(plot.ok).toBe(true);
    if (!plot.ok) return;
    expect(plot.value.points.length).toBe(3801);
    const values = plot.value.points.map((p) => p.tailIndex);
    const average = values.reduce((a, b) => a + b, 0) / values.length;
    // Averaged over k the Hill plot sits on 0.5 for exact Pareto data; the
    // points are heavily dependent, so 0.03 is the tolerance, not ξ/√k.
    expect(Math.abs(average - 0.5)).toBeLessThan(0.03);
  });
});

describe('threshold choice diagnostics', () => {
  const r = new Random('evt-threshold-seed');
  // Exponential body with a GPD tail above 2 — a series with a real threshold.
  const data = Array.from({ length: 5000 }, () => {
    const u = r.uniformOpen();
    return u < 0.9 ? -Math.log(1 - u / 0.9) * 0.8 : 2 + gpdInverse(r.uniformOpen(), 1.2, 0.25);
  });

  it('builds a mean residual life plot that is linear above a GPD threshold', () => {
    const plot = meanResidualLifePlot(data, { from: 2, to: 8, points: 30 });
    expect(plot.ok).toBe(true);
    if (!plot.ok) return;
    expect(plot.value.points.length).toBeGreaterThan(5);
    // Counts must fall as the threshold rises, and the mean excess must rise
    // for a positive shape (slope ξ/(1−ξ) > 0).
    for (let i = 1; i < plot.value.points.length; i++) {
      expect(plot.value.points[i].count).toBeLessThanOrEqual(plot.value.points[i - 1].count);
    }
    expect(plot.value.points[plot.value.points.length - 1].meanExcess).toBeGreaterThan(
      plot.value.points[0].meanExcess,
    );
    expect(plot.value.explanation.limitations.join(' ')).toMatch(/judgement/);
  });

  it('builds a parameter stability plot and states that the choice is a judgement', () => {
    const plot = parameterStabilityPlot(data, { quantileFrom: 0.85, quantileTo: 0.97, points: 8 });
    expect(plot.ok).toBe(true);
    if (!plot.ok) return;
    expect(plot.value.points.length).toBeGreaterThan(3);
    for (const point of plot.value.points) {
      expect(Number.isFinite(point.shape)).toBe(true);
      expect(Number.isFinite(point.modifiedScale)).toBe(true);
    }
    expect(plot.value.explanation.limitations.join(' ')).toMatch(/judgement/);
  });

  it('suggests a threshold and says in as many words that the choice is a judgement call', () => {
    const suggestion = suggestThreshold(data, { minExceedances: 100 });
    expect(suggestion.ok).toBe(true);
    if (!suggestion.ok) return;
    expect(suggestion.value.exceedances).toBeGreaterThanOrEqual(100);
    expect(suggestion.value.threshold).toBeGreaterThan(0);
    const text = [...suggestion.value.explanation.limitations, ...suggestion.warnings].join(' ');
    expect(text).toMatch(/judgement call/);
    expect(text).toMatch(/materially changes/);
  });

  it('refuses to suggest a threshold from too short a record', () => {
    const suggestion = suggestThreshold([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(suggestion.ok).toBe(false);
  });
});

describe('declustering', () => {
  it('reduces the exceedance count on artificially clustered data', () => {
    // 10 clusters of 3 consecutive exceedances, separated by quiet stretches.
    const series: number[] = [];
    for (let c = 0; c < 10; c++) {
      series.push(5 + c, 6 + c, 5.5 + c);
      for (let q = 0; q < 6; q++) series.push(0.1 * q);
    }
    const result = runsDecluster(series, { threshold: 4, runLength: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.exceedanceCount).toBe(30);
    expect(result.value.clusters.length).toBe(10);
    expect(result.value.clusterMaxima.length).toBe(10);
    expect(result.value.clusterMaxima.length).toBeLessThan(result.value.exceedanceCount);
    expect(result.value.extremalIndex).toBeCloseTo(1 / 3, 12);
    expect(result.value.meanClusterSize).toBeCloseTo(3, 12);
    // Each cluster maximum is the largest of its three values.
    expect(result.value.clusterMaxima[0]).toBe(6);
    expect(result.value.clusters[0].peakIndex).toBe(1);
  });

  it('leaves independent exceedances alone (θ ≈ 1)', () => {
    const r = new Random('evt-decluster-iid-seed');
    const series = Array.from({ length: 4000 }, () => -Math.log(r.uniformOpen()));
    const result = runsDecluster(series, { threshold: 3, runLength: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // For an i.i.d. series θ = 1 exactly. With run length 1 only *adjacent*
    // exceedances merge, and P(X > 3) = e^(−3) ≈ 0.0498, so the expected
    // fraction of merged exceedances is about 0.05 and θ̂ ≈ 1/(1 + 0.05) ≈ 0.95.
    // Its standard deviation over ~200 exceedances is about 0.015, so 0.9 is
    // roughly three standard deviations below the expected value.
    expect(result.value.extremalIndex).toBeGreaterThan(0.9);
    expect(result.value.extremalIndex).toBeLessThanOrEqual(1);
  });

  it('refuses when nothing exceeds the threshold', () => {
    const result = runsDecluster([1, 2, 3], { threshold: 10 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].message).toMatch(/No observation/);
  });
});

describe('block maxima extraction', () => {
  it('takes the maximum of each complete block and reports what it discarded', () => {
    const data = [1, 9, 2, 3, 8, 4, 5, 7]; // two blocks of 3, two left over
    const result = blockMaxima(data, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.maxima).toEqual([9, 8]);
    expect(result.value.blocksUsed).toBe(2);
    expect(result.value.observationsDiscarded).toBe(2);
    expect(result.value.discardReason).toMatch(/trailing incomplete block/);
  });

  it('refuses a block size that leaves no complete block', () => {
    const result = blockMaxima([1, 2, 3], 10);
    expect(result.ok).toBe(false);
  });

  it('counts non-finite values as discarded rather than using them', () => {
    const result = blockMaxima([1, NaN, 2, 3, Infinity, 4, 5, 6], 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.maxima).toEqual([3, 6]);
    expect(result.value.observationsDiscarded).toBe(2);
  });
});

describe('diagnostics data', () => {
  const r = new Random('evt-diagnostics-seed');
  const data = Array.from({ length: 4000 }, () => gpdInverse(r.uniformOpen(), 1.5, 0.15));

  it('returns probability, quantile, density and return level arrays for a GPD fit', () => {
    const fit = fitGpdPot(data, { threshold: 1 });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    const d = gpdDiagnostics(fit.value);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.value.probabilityPlot.length).toBe(fit.value.exceedances.length);
    expect(d.value.quantilePlot.length).toBe(fit.value.exceedances.length);
    expect(d.value.densityComparison.length).toBeGreaterThan(3);
    expect(d.value.returnLevelPlot.length).toBe(40);
    // A good fit means the probability plot hugs y = x; the mean absolute
    // deviation from the diagonal on 4,000-point data should be under 0.02.
    const deviation =
      d.value.probabilityPlot.reduce((a, p) => a + Math.abs(p.model - p.empirical), 0) /
      d.value.probabilityPlot.length;
    expect(deviation).toBeLessThan(0.02);
    for (const point of d.value.returnLevelPlot) {
      expect(Number.isFinite(point.level)).toBe(true);
      expect(point.returnPeriod).toBeGreaterThan(0);
    }
  });

  it('returns the same four arrays for a GEV fit', () => {
    const rr = new Random('evt-gev-diagnostics-seed');
    const raw = Array.from({ length: 20000 }, () => -Math.log(rr.uniformOpen()));
    const fit = fitGevBlockMaxima(raw, { blockSize: 100 });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    const d = gevDiagnostics(fit.value);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.value.probabilityPlot.length).toBe(200);
    expect(d.value.quantilePlot.length).toBe(200);
    expect(d.value.returnLevelPlot.length).toBe(40);
    const deviation =
      d.value.probabilityPlot.reduce((a, p) => a + Math.abs(p.model - p.empirical), 0) /
      d.value.probabilityPlot.length;
    expect(deviation).toBeLessThan(0.03);
  });
});

describe('exactness labels and accounting', () => {
  it('labels closed-form distribution results as exact and fits as numerical', () => {
    const r = new Random('evt-labels-seed');
    const data = Array.from({ length: 3000 }, () => gpdInverse(r.uniformOpen(), 1, 0.2));
    const fit = fitGpdPot(data, { threshold: 0.5 });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.value.explanation.exactness).toBe('numerical');
    expect(fit.value.diagnostics.optimiser).toMatch(/Nelder/);
    expect(fit.value.diagnostics.converged).toBe(true);
    expect(fit.value.diagnostics.iterations).toBeGreaterThan(0);
    expect(fit.value.diagnostics.functionEvaluations).toBeGreaterThan(0);
    // Used + not used accounts for the whole series.
    expect(fit.value.diagnostics.observationsUsed + fit.value.diagnostics.observationsDiscarded).toBe(3000);
    expect(fit.value.explanation.limitations.join(' ')).toMatch(/judgement call/);
  });
});
