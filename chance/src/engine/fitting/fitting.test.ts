/**
 * Tests for the fitting module.
 *
 * Reference values are independent of the implementation: they are either
 * computed directly in the test from the definition (sample mean, biased
 * variance, AIC arithmetic), known closed forms (the exponential standard
 * error λ/√n, the n = 3 Shapiro–Wilk p-value), the parameters a sample was
 * generated from, or calibration properties that must hold for any correct
 * implementation (p-value uniformity under the null, interval coverage,
 * EM monotonicity, a density integrating to 1).
 *
 * Every seed is fixed, so every number here is reproducible.
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from '../core/result';
import { getDistribution } from '../distributions/registry';
import { Random, Xoshiro128 } from '../random/rng';
import {
  andersonDarling,
  cdfComparisonData,
  censoredLogLikelihood,
  chiSquareFitTest,
  compareMleAndMoments,
  cramerVonMises,
  ecdfWithDkwBand,
  fitDistribution,
  fitGaussianMixture,
  fitRightCensored,
  histogramOverlayData,
  integrateCurve,
  jarqueBera,
  kernelDensity,
  ksGoodnessOfFit,
  logLikelihood,
  momentEstimates,
  multiStartNelderMead,
  nelderMead,
  paramBound,
  parametricBootstrapSteps,
  ppPlotData,
  profileLikelihoodInterval,
  qqEnvelopeSteps,
  qqPlotData,
  selectDistribution,
  selectGaussianMixture,
  shapiroWilk,
} from './index';

const normalDef = getDistribution('normal');
const expDef = getDistribution('exponential');
const poissonDef = getDistribution('poisson');
const lognormalDef = getDistribution('lognormal');
const uniformDef = getDistribution('uniform');
const gammaDef = getDistribution('gamma');
const weibullDef = getDistribution('weibull');
const betaDef = getDistribution('beta');

function rngFor(seed: string): Random {
  return new Random(new Xoshiro128(seed));
}

function sample(def: ReturnType<typeof getDistribution>, params: Record<string, number>, n: number, seed: string): number[] {
  const rng = rngFor(seed);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = def.sample(rng, params);
  return out;
}

/** Sample mean, computed here so the test does not depend on engine code. */
function meanOf(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** MLE (biased, divide by n) variance, computed here independently. */
function biasedVar(xs: readonly number[]): number {
  const m = meanOf(xs);
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
}

describe('analytic maximum likelihood estimates', () => {
  // Tolerance 1e-12: these are the same arithmetic done twice in double
  // precision, so only summation-order rounding separates them.
  const TOL = 1e-12;

  it('normal: the MLE is the sample mean and the variance that divides by n', () => {
    const data = sample(normalDef, { mu: 3, sigma: 2 }, 500, 'normal-analytic');
    const fit = fitDistribution(normalDef, data);
    const m = meanOf(data);
    const vBiased = biasedVar(data);
    const vUnbiased = data.reduce((a, b) => a + (b - m) ** 2, 0) / (data.length - 1);
    expect(fit.params.mu).toBeCloseTo(m, 12);
    expect(Math.abs(fit.params.sigma - Math.sqrt(vBiased))).toBeLessThan(TOL);
    // The n − 1 version is a different estimator and must NOT have been used.
    expect(Math.abs(fit.params.sigma - Math.sqrt(vUnbiased))).toBeGreaterThan(1e-6);
    expect(fit.method).toBe('analytic-mle');
    expect(fit.exactness).toBe('exact');
    expect(fit.convergence.converged).toBe(true);
    expect(fit.n).toBe(500);
    expect(fit.nDiscarded).toBe(0);
    expect(Number.isFinite(fit.logLikelihood)).toBe(true);
  });

  it('exponential: λ̂ = 1/x̄ exactly', () => {
    const data = sample(expDef, { lambda: 0.4 }, 400, 'exp-analytic');
    const fit = fitDistribution(expDef, data);
    expect(Math.abs(fit.params.lambda - 1 / meanOf(data))).toBeLessThan(TOL);
  });

  it('Poisson: λ̂ = x̄ exactly', () => {
    const data = sample(poissonDef, { lambda: 4.5 }, 400, 'poisson-analytic');
    const fit = fitDistribution(poissonDef, data);
    expect(Math.abs(fit.params.lambda - meanOf(data))).toBeLessThan(TOL);
  });

  it('uniform: (min, max) exactly', () => {
    const data = sample(uniformDef, { a: -2, b: 7 }, 300, 'uniform-analytic');
    const fit = fitDistribution(uniformDef, data);
    expect(fit.params.a).toBe(Math.min(...data));
    expect(fit.params.b).toBe(Math.max(...data));
    // The endpoints are order statistics: no Hessian standard error is honest here.
    for (const u of fit.uncertainty) {
      expect(u.standardError).toBeNull();
      expect(u.unavailableReason).toMatch(/endpoint/);
    }
  });

  it('log-normal: mean and biased variance of the LOGS', () => {
    const data = sample(lognormalDef, { mu: 0.5, sigma: 0.8 }, 400, 'lognormal-analytic');
    const fit = fitDistribution(lognormalDef, data);
    const logs = data.map(Math.log);
    expect(Math.abs(fit.params.mu - meanOf(logs))).toBeLessThan(TOL);
    expect(Math.abs(fit.params.sigma - Math.sqrt(biasedVar(logs)))).toBeLessThan(TOL);
  });
});

describe('the numerical optimiser against known closed-form answers', () => {
  // 1e-6 relative: Nelder–Mead is told to converge to 1e-11 on the transformed
  // simplex, which maps to roughly this accuracy in the natural parameters.
  const run = (def: ReturnType<typeof getDistribution>, data: number[]): Record<string, number> => {
    const specs = def.params;
    const objective = (v: number[]): number => {
      const p: Record<string, number> = {};
      specs.forEach((s, i) => (p[s.key] = v[i]));
      return -logLikelihood(def, p, data);
    };
    const start = specs.map((s) => s.defaultValue);
    const out = multiStartNelderMead(objective, [start, start.map((x) => x * 2 || 1)], specs.map(paramBound), {
      maxIterations: 5000,
      tol: 1e-13,
    });
    expect(out.converged).toBe(true);
    const p: Record<string, number> = {};
    specs.forEach((s, i) => (p[s.key] = out.x[i]));
    return p;
  };

  it('lands on the analytic normal MLE', () => {
    const data = sample(normalDef, { mu: -1.5, sigma: 3 }, 300, 'nm-normal');
    const p = run(normalDef, data);
    expect(p.mu).toBeCloseTo(meanOf(data), 6);
    expect(p.sigma / Math.sqrt(biasedVar(data))).toBeCloseTo(1, 6);
  });

  it('lands on the analytic exponential MLE', () => {
    const data = sample(expDef, { lambda: 2.5 }, 300, 'nm-exp');
    const p = run(expDef, data);
    expect(p.lambda / (1 / meanOf(data))).toBeCloseTo(1, 6);
  });

  it('lands on the analytic log-normal MLE', () => {
    const data = sample(lognormalDef, { mu: 1, sigma: 0.4 }, 300, 'nm-lognormal');
    const logs = data.map(Math.log);
    const p = run(lognormalDef, data);
    expect(p.mu).toBeCloseTo(meanOf(logs), 6);
    expect(p.sigma / Math.sqrt(biasedVar(logs))).toBeCloseTo(1, 6);
  });

  it('lands on the analytic Poisson MLE', () => {
    const data = sample(poissonDef, { lambda: 3 }, 300, 'nm-poisson');
    const p = run(poissonDef, data);
    expect(p.lambda / meanOf(data)).toBeCloseTo(1, 6);
  });

  it('reports non-convergence instead of returning the last iterate', () => {
    const data = sample(gammaDef, { k: 3, theta: 2 }, 200, 'nm-stop');
    const objective = (v: number[]): number => -logLikelihood(gammaDef, { k: v[0], theta: v[1] }, data);
    const out = nelderMead(objective, [20, 20], gammaDef.params.map(paramBound), { maxIterations: 3 });
    expect(out.converged).toBe(false);
    expect(out.message).toMatch(/did not converge/);
  });
});

describe('parameter recovery and standard errors', () => {
  it('recovers gamma(3, 2) from 20,000 samples within the reported standard errors', () => {
    const data = sample(gammaDef, { k: 3, theta: 2 }, 20_000, 'recover-gamma');
    const fit = fitDistribution(gammaDef, data);
    expect(fit.method).toBe('numerical-mle');
    expect(fit.exactness).toBe('numerical');
    for (const [key, truth] of [['k', 3], ['theta', 2]] as const) {
      const u = fit.uncertainty.find((x) => x.key === key);
      expect(u?.standardError).toBeGreaterThan(0);
      // 4 standard errors: a fixed-seed single sample, so this is a sanity
      // bound on the estimate and the Hessian scale, not a coverage claim.
      expect(Math.abs(fit.params[key] - truth)).toBeLessThan(4 * (u?.standardError ?? 0));
    }
  });

  it('recovers Weibull(shape 2, scale 5) and beta(2, 5)', () => {
    const w = fitDistribution(weibullDef, sample(weibullDef, { k: 2, lambda: 5 }, 20_000, 'recover-weibull'));
    for (const [key, truth] of [['k', 2], ['lambda', 5]] as const) {
      const se = w.uncertainty.find((x) => x.key === key)?.standardError ?? 0;
      expect(se).toBeGreaterThan(0);
      expect(Math.abs(w.params[key] - truth)).toBeLessThan(4 * se);
    }
    const b = fitDistribution(betaDef, sample(betaDef, { alpha: 2, beta: 5 }, 20_000, 'recover-beta'));
    for (const [key, truth] of [['alpha', 2], ['beta', 5]] as const) {
      const se = b.uncertainty.find((x) => x.key === key)?.standardError ?? 0;
      expect(se).toBeGreaterThan(0);
      expect(Math.abs(b.params[key] - truth)).toBeLessThan(4 * se);
    }
  });

  it('Wald intervals from the numerical Hessian cover the truth about 95% of the time', () => {
    // Coverage test: the real check on the Hessian. The exponential is used
    // because its MLE is closed form and its true standard error is λ/√n, so
    // 200 fits of n = 500 run in well under a second.
    const truth = 2;
    const n = 500;
    const reps = 200;
    const rng = rngFor('coverage');
    let covered = 0;
    let seSum = 0;
    for (let r = 0; r < reps; r++) {
      const data = new Array<number>(n);
      for (let i = 0; i < n; i++) data[i] = expDef.sample(rng, { lambda: truth });
      const fit = fitDistribution(expDef, data);
      const u = fit.uncertainty.find((x) => x.key === 'lambda');
      expect(u?.wald).not.toBeNull();
      seSum += u?.standardError ?? 0;
      if (u?.wald && u.wald.low <= truth && truth <= u.wald.high) covered++;
    }
    const coverage = covered / reps;
    // Binomial standard error of a 0.95 coverage estimate over 200 reps is
    // √(0.95·0.05/200) ≈ 0.0154, so ±3 SE is about [0.90, 1.00]; a broken
    // Hessian (wrong by a factor) lands far outside this.
    expect(coverage).toBeGreaterThan(0.9);
    expect(coverage).toBeLessThanOrEqual(1);
    // The numerical standard error must match the known closed form λ/√n to 1%.
    expect(seSum / reps / (truth / Math.sqrt(n))).toBeCloseTo(1, 2);
  });

  it('profile-likelihood intervals agree with Wald for a large, well-behaved sample', () => {
    const data = sample(expDef, { lambda: 1.5 }, 2000, 'profile');
    const fit = fitDistribution(expDef, data);
    const prof = profileLikelihoodInterval(expDef, data, fit, 'lambda');
    const wald = fit.uncertainty[0].wald;
    expect(wald).not.toBeNull();
    expect(prof.low).toBeLessThan(fit.params.lambda);
    expect(prof.high).toBeGreaterThan(fit.params.lambda);
    // With n = 2000 the likelihood is nearly quadratic, so the two agree to ~1%.
    expect(prof.low / (wald?.low ?? NaN)).toBeCloseTo(1, 2);
    expect(prof.high / (wald?.high ?? NaN)).toBeCloseTo(1, 2);
    expect(prof.method).toMatch(/small samples/);
  });
});

describe('information criteria and model selection', () => {
  it('AIC, AICc and BIC match the formulas recomputed from the reported log-likelihood', () => {
    const data = sample(gammaDef, { k: 2, theta: 1.5 }, 300, 'ic');
    const fit = fitDistribution(gammaDef, data);
    const k = fit.estimatedParams;
    expect(k).toBe(2);
    const aic = 2 * k - 2 * fit.logLikelihood;
    const bic = k * Math.log(fit.n) - 2 * fit.logLikelihood;
    expect(fit.aic).toBe(aic);
    expect(fit.bic).toBe(bic);
    expect(fit.aicc).toBe(aic + (2 * k * (k + 1)) / (fit.n - k - 1));
  });

  it('ranks the normal above the exponential on symmetric data, and explains the limits of the ranking', () => {
    const data = sample(normalDef, { mu: 20, sigma: 2 }, 600, 'selection');
    const result = selectDistribution(data, { ids: ['normal', 'exponential', 'lognormal', 'gamma'] });
    expect(result.ranked[0].fit.distributionId).toBe('normal');
    expect(result.ranked[0].akaikeWeight).toBeGreaterThan(0.5);
    const exponential = result.ranked.find((r) => r.fit.distributionId === 'exponential');
    expect(exponential?.deltaAic).toBeGreaterThan(100);
    expect(result.statements.join(' ')).toMatch(/only among the distributions implemented here/);
    expect(result.statements.join(' ')).toMatch(/cannot say whether the leading distribution fits well/);
    const weightSum = result.ranked.reduce((a, r) => a + r.akaikeWeight, 0);
    expect(weightSum).toBeCloseTo(1, 10);
  });

  it('skips incompatible distributions with a stated reason rather than fitting nonsense', () => {
    const data = sample(normalDef, { mu: 0, sigma: 1 }, 200, 'selection-skip');
    const result = selectDistribution(data);
    const ids = result.ranked.map((r) => r.fit.distributionId);
    expect(ids).not.toContain('poisson');
    expect(ids).not.toContain('exponential');
    const poisson = result.skipped.find((s) => s.distributionId === 'poisson');
    expect(poisson?.reason).toMatch(/whole-number/);
    const exponential = result.skipped.find((s) => s.distributionId === 'exponential');
    expect(exponential?.reason).toMatch(/outside every possible support/);
    const binomial = result.skipped.find((s) => s.distributionId === 'binomial');
    expect(binomial?.reason).toBeTruthy();
  });
});

describe('goodness-of-fit tests', () => {
  it('Shapiro–Wilk does not reject clean normal data and does reject exponential data', () => {
    const normalData = sample(normalDef, { mu: 0, sigma: 1 }, 200, 'sw-normal');
    const sw = shapiroWilk(normalData);
    expect(sw.pValue).toBeGreaterThan(0.05);
    expect(sw.statistic).toBeGreaterThan(0.97);
    const expData = sample(expDef, { lambda: 1 }, 200, 'sw-exp');
    const swExp = shapiroWilk(expData);
    expect(swExp.pValue).toBeLessThan(0.01);
    expect(swExp.rejectedAt05).toBe(true);
  });

  it('Shapiro–Wilk W is invariant to location and scale, and matches the exact n = 3 formula', () => {
    // Both are properties of the definition, independent of this implementation.
    const data = sample(normalDef, { mu: 0, sigma: 1 }, 40, 'sw-invariance');
    const a = shapiroWilk(data).statistic;
    const b = shapiroWilk(data.map((x) => 7 + 3 * x)).statistic;
    expect(b).toBeCloseTo(a, 10);
    const three = [1, 2, 6];
    const sw3 = shapiroWilk(three);
    const exact = (6 / Math.PI) * (Math.asin(Math.sqrt(sw3.statistic)) - Math.asin(Math.sqrt(0.75)));
    expect(sw3.pValue).toBeCloseTo(exact, 12);
  });

  it('Anderson–Darling rejects exponential data tested for normality and passes normal data', () => {
    const normalData = sample(normalDef, { mu: 5, sigma: 2 }, 300, 'ad-normal');
    const nFit = fitDistribution(normalDef, normalData);
    const adNormal = andersonDarling(normalData, (x) => normalDef.cdf(x, nFit.params), {
      parametersEstimated: true,
      estimatedParams: 2,
      family: 'normal',
    });
    expect(adNormal.pValue).toBeGreaterThan(0.05);

    const expData = sample(expDef, { lambda: 1 }, 300, 'ad-exp');
    const asNormal = fitDistribution(normalDef, expData);
    const adExp = andersonDarling(expData, (x) => normalDef.cdf(x, asNormal.params), {
      parametersEstimated: true,
      estimatedParams: 2,
      family: 'normal',
    });
    expect(adExp.pValue).toBeLessThan(0.01);
    expect(adExp.rejectedAt05).toBe(true);
    // And the same data against the right family is not rejected.
    const eFit = fitDistribution(expDef, expData);
    const adRight = andersonDarling(expData, (x) => expDef.cdf(x, eFit.params), {
      parametersEstimated: true,
      estimatedParams: 1,
      family: 'exponential',
    });
    expect(adRight.pValue).toBeGreaterThan(0.05);
    expect(adRight.caveats.join(' ')).toMatch(/not evidence that this distribution is correct/);
  });

  it('Anderson–Darling beats KS on a tail-contaminated sample', () => {
    // 500 standard normal observations with the most extreme 2% pushed out to
    // ±6 and beyond: the centre is untouched, only the tails are wrong. KS looks at the
    // largest vertical gap (near the middle) and barely notices.
    const base = sample(normalDef, { mu: 0, sigma: 1 }, 500, 'tail-contam');
    const contaminated = base.slice().sort((a, b) => a - b);
    for (let i = 0; i < 10; i++) {
      contaminated[i] = -6 - i * 0.4;
      contaminated[contaminated.length - 1 - i] = 6 + i * 0.4;
    }
    const cdf = (x: number): number => normalDef.cdf(x, { mu: 0, sigma: 1 });
    const ad = andersonDarling(contaminated, cdf, { parametersEstimated: false, estimatedParams: 0 });
    const ks = ksGoodnessOfFit(contaminated, cdf, { parametersEstimated: false, estimatedParams: 0 });
    expect(ad.pValue ?? 1).toBeLessThan(ks.pValue ?? 1);
    expect(ad.rejectedAt05).toBe(true);
    expect(ks.rejectedAt05).toBe(false);
    const cvm = cramerVonMises(contaminated, cdf, { parametersEstimated: false, estimatedParams: 0 });
    expect(cvm.statistic).toBeGreaterThan(0);
  });

  it('chi-square reduces the degrees of freedom by the number of estimated parameters', () => {
    const data = sample(normalDef, { mu: 0, sigma: 1 }, 500, 'chisq');
    const fit = fitDistribution(normalDef, data);
    const bins = 10;
    const estimated = chiSquareFitTest(data, normalDef, fit.params, { parametersEstimated: true, estimatedParams: 2 }, bins);
    expect(estimated.degreesOfFreedom).toBe(bins - 1 - 2);
    // The specific bug: df must NOT be bins − 1 when parameters were estimated.
    expect(estimated.degreesOfFreedom).not.toBe(bins - 1);
    const known = chiSquareFitTest(data, normalDef, { mu: 0, sigma: 1 }, { parametersEstimated: false, estimatedParams: 0 }, bins);
    expect(known.degreesOfFreedom).toBe(bins - 1);
    // Equiprobable bins: every expected count is n/bins.
    for (const b of estimated.bins) expect(b.expected).toBeCloseTo(500 / bins, 6);
    expect(estimated.caveats.join(' ')).toMatch(/reduced by the number of estimated parameters/);
    expect(() => chiSquareFitTest(data, normalDef, fit.params, { parametersEstimated: true, estimatedParams: 2 }, 3)).toThrow(EngineError);
  });

  it('KS p-values are uniform under the null when the parameters are known', () => {
    // The calibration check: with truly known parameters, P(p < 0.05) = 0.05.
    const reps = 300;
    const n = 100;
    const rng = rngFor('ks-uniformity');
    let below = 0;
    let belowHalf = 0;
    for (let r = 0; r < reps; r++) {
      const data = new Array<number>(n);
      for (let i = 0; i < n; i++) data[i] = expDef.sample(rng, { lambda: 1 });
      const p = ksGoodnessOfFit(data, (x) => expDef.cdf(x, { lambda: 1 }), { parametersEstimated: false, estimatedParams: 0 }).pValue ?? 1;
      if (p < 0.05) below++;
      if (p < 0.5) belowHalf++;
    }
    // Binomial SE of a 0.05 rate over 300 draws is √(0.05·0.95/300) ≈ 0.0126,
    // so ±3 SE gives about [0.012, 0.088].
    expect(below / reps).toBeGreaterThan(0.012);
    expect(below / reps).toBeLessThan(0.09);
    // The median of a uniform p-value is 0.5; ±3 SE ≈ ±0.087.
    expect(Math.abs(belowHalf / reps - 0.5)).toBeLessThan(0.09);
  });

  it('Jarque–Bera rejects skewed data and not normal data', () => {
    expect(jarqueBera(sample(normalDef, { mu: 0, sigma: 1 }, 500, 'jb-normal')).pValue ?? 0).toBeGreaterThan(0.05);
    expect(jarqueBera(sample(expDef, { lambda: 1 }, 500, 'jb-exp')).pValue ?? 1).toBeLessThan(0.001);
  });
});

describe('bootstrap, diagnostics and estimator comparison', () => {
  it('the parametric bootstrap yields between resamples and brackets the estimate', () => {
    const data = sample(expDef, { lambda: 1.2 }, 300, 'boot');
    const fit = fitDistribution(expDef, data);
    const steps = parametricBootstrapSteps(expDef, fit, { replicates: 200, seed: 'boot-rep', chunk: 20 });
    let yields = 0;
    let next = steps.next();
    while (!next.done) {
      yields++;
      next = steps.next();
    }
    expect(yields).toBe(10);
    const result = next.value;
    expect(result.failures).toBe(0);
    const ci = result.intervals.lambda;
    expect(ci.low).toBeLessThan(fit.params.lambda);
    expect(ci.high).toBeGreaterThan(fit.params.lambda);
    // The bootstrap interval must be the same order of width as the Wald one.
    const wald = fit.uncertainty[0].wald;
    const ratio = (ci.high - ci.low) / ((wald?.high ?? 0) - (wald?.low ?? 1));
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1.4);
  });

  it('the Q–Q envelope contains most points for a correct fit and flags a wrong one', () => {
    const data = sample(normalDef, { mu: 0, sigma: 1 }, 200, 'qq');
    const fit = fitDistribution(normalDef, data);
    const steps = qqEnvelopeSteps(data, normalDef, fit.params, { replicates: 100, seed: 'qq-env', chunk: 25 });
    let yields = 0;
    let next = steps.next();
    while (!next.done) {
      yields++;
      next = steps.next();
    }
    expect(yields).toBe(4);
    const env = next.value;
    expect(env.points).toHaveLength(200);
    // A pointwise 95% band: a correct fit leaves well under 20% outside.
    expect(env.outsideFraction).toBeLessThan(0.2);
    expect(env.caveats.join(' ')).toMatch(/POINTWISE/);

    const skewed = sample(lognormalDef, { mu: 0, sigma: 1 }, 200, 'qq-wrong');
    const wrong = fitDistribution(normalDef, skewed);
    const bad = qqEnvelopeSteps(skewed, normalDef, wrong.params, { replicates: 100, seed: 'qq-env2', chunk: 50 });
    let b = bad.next();
    while (!b.done) b = bad.next();
    expect(b.value.outsideFraction).toBeGreaterThan(env.outsideFraction);
  });

  it('produces Q–Q, P–P, CDF and histogram overlay point arrays', () => {
    const data = sample(gammaDef, { k: 2, theta: 2 }, 150, 'plots');
    const fit = fitDistribution(gammaDef, data);
    const qq = qqPlotData(data, gammaDef, fit.params);
    expect(qq.points).toHaveLength(150);
    expect(qq.referenceLine.slope).toBe(1);
    const pp = ppPlotData(data, gammaDef, fit.params);
    expect(Math.min(...pp.points.map((p) => p.x))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...pp.points.map((p) => p.x))).toBeLessThanOrEqual(1);
    const cdf = cdfComparisonData(data, gammaDef, fit.params);
    expect(cdf.largestGap.gap).toBeGreaterThan(0);
    expect(cdf.largestGap.gap).toBeLessThan(0.2);
    const hist = histogramOverlayData(data, gammaDef, fit.params);
    expect(hist.bins.length).toBeGreaterThan(2);
    expect(Math.min(...hist.density.map((p) => p.y))).toBeGreaterThanOrEqual(0);
  });

  it('compares maximum likelihood with method of moments and flags disagreement', () => {
    const data = sample(gammaDef, { k: 3, theta: 2 }, 2000, 'compare');
    const agree = compareMleAndMoments(gammaDef, data);
    expect(agree.moments).not.toBeNull();
    expect(agree.materialDisagreement).toBe(false);
    // The MLE log-likelihood can never be below the moment fit's.
    expect(agree.mle.logLikelihood).toBeGreaterThanOrEqual(agree.momentsLogLikelihood ?? -Infinity);

    // Gamma fitted to log-normal data: the moments are dominated by the tail.
    const wrong = sample(lognormalDef, { mu: 0, sigma: 1.4 }, 2000, 'compare-wrong');
    const disagree = compareMleAndMoments(gammaDef, wrong);
    expect(disagree.materialDisagreement).toBe(true);
    expect(disagree.statements.join(' ')).toMatch(/warning about the FAMILY/);
  });

  it('method of moments refuses the Cauchy, which has no moments', () => {
    const data = sample(getDistribution('cauchy'), { x0: 0, gamma: 1 }, 100, 'cauchy');
    expect(() => momentEstimates(getDistribution('cauchy'), data)).toThrow(/no finite mean or variance/);
  });
});

describe('censored data', () => {
  it('the censored-aware fit beats the naive fit that ignores censoring', () => {
    const truth = 0.5;
    const censorAt = 1.5;
    const rng = rngFor('censored');
    const obs: { time: number; censored: boolean }[] = [];
    for (let i = 0; i < 600; i++) {
      const t = expDef.sample(rng, { lambda: truth });
      obs.push(t > censorAt ? { time: censorAt, censored: true } : { time: t, censored: false });
    }
    const censoredFit = fitRightCensored(expDef, obs);
    // Control: treat every observed time as a failure time.
    const naiveFit = fitDistribution(expDef, obs.map((o) => o.time));
    expect(Math.abs(censoredFit.params.lambda - truth)).toBeLessThan(Math.abs(naiveFit.params.lambda - truth));
    // Ignoring censoring must overstate the failure rate.
    expect(naiveFit.params.lambda).toBeGreaterThan(truth);
    expect(censoredFit.method).toBe('censored-mle');
    expect(censoredFit.exactness).toBe('exact');
    // Closed form: λ̂ = events / total time on test, recomputed here.
    const events = obs.filter((o) => !o.censored).length;
    const total = obs.reduce((a, o) => a + o.time, 0);
    expect(censoredFit.params.lambda).toBeCloseTo(events / total, 12);
    expect(censoredFit.uncertainty[0].standardError).toBeGreaterThan(0);
  });

  it('fits a Weibull to censored data numerically and uses the survival function', () => {
    const rng = rngFor('censored-weibull');
    const obs: { time: number; censored: boolean }[] = [];
    for (let i = 0; i < 800; i++) {
      const t = weibullDef.sample(rng, { k: 2, lambda: 5 });
      obs.push(t > 6 ? { time: 6, censored: true } : { time: t, censored: false });
    }
    const fit = fitRightCensored(weibullDef, obs);
    expect(fit.convergence.converged).toBe(true);
    // 4 standard errors, as in the recovery tests above.
    for (const [key, truth] of [['k', 2], ['lambda', 5]] as const) {
      const se = fit.uncertainty.find((u) => u.key === key)?.standardError ?? 0;
      expect(Math.abs(fit.params[key] - truth)).toBeLessThan(4 * se);
    }
    // The censored likelihood must differ from the uncensored one on this data.
    const asEvents = logLikelihood(weibullDef, fit.params, obs.map((o) => o.time));
    expect(censoredLogLikelihood(weibullDef, fit.params, obs)).not.toBeCloseTo(asEvents, 3);
  });

  it('refuses when there are too few actual events to identify the parameters', () => {
    const obs = Array.from({ length: 50 }, () => ({ time: 1, censored: true }));
    obs.push({ time: 0.5, censored: false });
    expect(() => fitRightCensored(weibullDef, obs)).toThrow(/events/);
  });
});

describe('Gaussian mixtures by EM', () => {
  it('never decreases the log-likelihood and recovers a known two-component mixture', () => {
    const rng = rngFor('gmm');
    const data: number[] = [];
    for (let i = 0; i < 2000; i++) {
      data.push(rng.uniform() < 0.35 ? normalDef.sample(rng, { mu: -3, sigma: 1 }) : normalDef.sample(rng, { mu: 4, sigma: 1.5 }));
    }
    const fit = fitGaussianMixture(data, 2, { seed: 'gmm-fit', restarts: 6 });
    expect(fit.monotone).toBe(true);
    for (let i = 1; i < fit.logLikelihoodPath.length; i++) {
      // EM's guarantee, checked at every iteration.
      expect(fit.logLikelihoodPath[i]).toBeGreaterThanOrEqual(fit.logLikelihoodPath[i - 1] - 1e-8 * (1 + Math.abs(fit.logLikelihoodPath[i - 1])));
    }
    expect(fit.converged).toBe(true);
    // Components are returned sorted by mean, so label switching cannot bite.
    // 0.3 absolute: the standard error of each component mean here is ~0.04,
    // and the mixture adds assignment uncertainty on top.
    expect(fit.components[0].mean).toBeCloseTo(-3, 1);
    expect(Math.abs(fit.components[1].mean - 4)).toBeLessThan(0.3);
    expect(fit.components[0].weight).toBeCloseTo(0.35, 1);
    expect(fit.caveats.join(' ')).toMatch(/label switching/i);
    expect(fit.parameterCount).toBe(5);
    expect(fit.bic).toBeCloseTo(fit.parameterCount * Math.log(fit.n) - 2 * fit.logLikelihood, 10);
  });

  it('BIC prefers two components for two-component data over one', () => {
    const rng = rngFor('gmm-select');
    const data: number[] = [];
    for (let i = 0; i < 1500; i++) {
      data.push(rng.uniform() < 0.5 ? normalDef.sample(rng, { mu: -4, sigma: 1 }) : normalDef.sample(rng, { mu: 4, sigma: 1 }));
    }
    const sel = selectGaussianMixture(data, { min: 1, max: 3, restarts: 4, seed: 'gmm-sel' });
    expect(sel.best.components.length).toBeGreaterThanOrEqual(2);
    const one = sel.fits.find((f) => f.components.length === 1);
    expect(one?.bic ?? 0).toBeGreaterThan(sel.best.bic);
    expect(sel.statements.join(' ')).toMatch(/not evidence that the groups exist/);
  });
});

describe('non-parametric alternatives', () => {
  it('the KDE integrates to 1, is non-negative, and converges to the true density', () => {
    const err = (n: number, seed: string): number => {
      const data = sample(normalDef, { mu: 0, sigma: 1 }, n, seed);
      const kde = kernelDensity(data, { rule: 'silverman', points: 1024, range: { min: -6, max: 6 } });
      expect(Math.min(...kde.points.map((p) => p.y))).toBeGreaterThanOrEqual(0);
      // Over [-6, 6] a standard normal holds all but 2e-9 of its mass.
      expect(integrateCurve(kde.points)).toBeCloseTo(1, 2);
      return Math.max(...kde.points.map((p) => Math.abs(p.y - normalDef.pdf(p.x, { mu: 0, sigma: 1 }))));
    };
    const small = err(200, 'kde-200');
    const large = err(5000, 'kde-5000');
    expect(large).toBeLessThan(small);
    expect(large).toBeLessThan(0.02);
  });

  it("Scott's and Silverman's bandwidths differ and a user bandwidth is honoured", () => {
    const data = sample(normalDef, { mu: 0, sigma: 1 }, 400, 'kde-bw');
    const s = kernelDensity(data, { rule: 'silverman' });
    const sc = kernelDensity(data, { rule: 'scott' });
    expect(sc.bandwidth).toBeGreaterThan(s.bandwidth);
    const user = kernelDensity(data, { bandwidth: 0.5 });
    expect(user.bandwidth).toBe(0.5);
    expect(user.bandwidthSource).toBe('user');
  });

  it('boundary reflection keeps mass inside a known bound', () => {
    const data = sample(expDef, { lambda: 1 }, 2000, 'kde-bound');
    const plain = kernelDensity(data, { points: 512, range: { min: 0, max: 8 } });
    const reflected = kernelDensity(data, { bounds: { min: 0 }, points: 512, range: { min: 0, max: 8 } });
    // The exponential density at 0 is λ = 1; the uncorrected estimate leaks
    // mass below 0 and so undershoots there, the reflected one does not.
    const at0 = (k: typeof plain): number => k.points[0].y;
    expect(at0(plain)).toBeLessThan(0.8);
    expect(at0(reflected)).toBeGreaterThan(at0(plain) * 1.5);
    expect(reflected.reflected.min).toBe(true);
    expect(integrateCurve(reflected.points)).toBeCloseTo(1, 1);
  });

  it('DKW bands contain the true CDF at least as often as the stated level', () => {
    const reps = 500;
    const n = 50;
    const rng = rngFor('dkw');
    let contained = 0;
    for (let r = 0; r < reps; r++) {
      const data = new Array<number>(n);
      for (let i = 0; i < n; i++) data[i] = rng.uniform();
      const band = ecdfWithDkwBand(data, 0.95);
      // sup|F̂ − F| for a uniform sample is attained at the observations.
      const sorted = [...data].sort((a, b) => a - b);
      let sup = 0;
      for (let i = 0; i < n; i++) {
        sup = Math.max(sup, Math.abs((i + 1) / n - sorted[i]), Math.abs(i / n - sorted[i]));
      }
      if (sup <= band.epsilon) contained++;
    }
    // Massart's inequality makes the true coverage at least 0.95, so the
    // estimate over 500 replications has binomial SE √(0.95·0.05/500) ≈ 0.0097;
    // 0.95 − 3 SE ≈ 0.92 is the honest bound to assert.
    expect(contained / reps).toBeGreaterThan(0.92);
    // And the half-width must equal the DKW formula, computed here.
    expect(ecdfWithDkwBand([1, 2, 3, 4], 0.95).epsilon).toBeCloseTo(Math.sqrt(Math.log(40) / 8), 12);
  });
});

describe('refusals', () => {
  it('refuses a sample too small for the parameter count', () => {
    expect(() => fitDistribution(gammaDef, [1, 2])).toThrow(/free parameter/);
    expect(() => fitDistribution(normalDef, [1, 2])).toThrow(EngineError);
  });

  it('refuses negative data for a positive-support distribution', () => {
    expect(() => fitDistribution(gammaDef, [1, 2, -3, 4, 5])).toThrow(/outside every possible support/);
    expect(() => fitDistribution(lognormalDef, [1, 2, -3, 4, 5])).toThrow(/outside every possible support/);
  });

  it('refuses non-integer data for a discrete distribution', () => {
    expect(() => fitDistribution(poissonDef, [1, 2, 2.5, 3, 4])).toThrow(/whole-number values/);
  });

  it('refuses to invent a value for constant data', () => {
    expect(() => fitDistribution(normalDef, [5, 5, 5, 5, 5])).toThrow(/no maximum over σ/);
    expect(() => fitDistribution(uniformDef, [2, 2, 2, 2])).toThrow(/identical/);
  });

  it('refuses to estimate design constants such as a binomial n, but fits p when n is given', () => {
    const binomial = getDistribution('binomial');
    const data = sample(binomial, { n: 20, p: 0.3 }, 300, 'binomial');
    expect(() => fitDistribution(binomial, data)).toThrow(/design constants/);
    const fit = fitDistribution(binomial, data, { fixed: { n: 20 } });
    expect(fit.estimatedParams).toBe(1);
    // The binomial MLE with n known is p̂ = x̄/n, computed independently here.
    expect(fit.params.p).toBeCloseTo(meanOf(data) / 20, 6);
  });

  it('reports discarded observations rather than silently dropping them', () => {
    const data = [...sample(expDef, { lambda: 1 }, 100, 'discard'), NaN, Infinity];
    const fit = fitDistribution(expDef, data);
    expect(fit.n).toBe(100);
    expect(fit.nDiscarded).toBe(2);
    expect(fit.discardReasons.join(' ')).toMatch(/not a finite number/);
  });
});
