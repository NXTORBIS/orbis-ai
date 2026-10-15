/**
 * Tests for src/engine/processes.
 *
 * Reference values are independent of the implementation. They are either
 *  (a) closed forms evaluated inside the test from the parameters by hand,
 *  (b) numbers computed in Python (math module only, no SciPy needed) and
 *      pasted here with their provenance, or
 *  (c) a second, structurally different computation (a tridiagonal linear
 *      solve for gambler's-ruin durations, a bisection for the branching
 *      fixed point, a truncated matrix series for the matrix exponential).
 *
 * Monte Carlo tolerances: every one is justified in a comment in terms of the
 * standard error of the statistic being checked. The usual budget is four
 * standard errors, which fails by chance about once in 15,000 per assertion
 * with the fixed seeds used here.
 */
import { describe, expect, it } from 'vitest';
import { Random, Xoshiro128 } from '../random/rng';
import { EngineError } from '../core/result';
import {
  // counting
  poissonCountPmf,
  poissonCountSummary,
  poissonInterarrivalLaw,
  poissonWaitingTime,
  samplePoissonCountPath,
  samplePoissonEventTimes,
  compoundPoissonMoments,
  sampleCompoundPoissonPath,
  nhppExpectedCount,
  sampleNhppEventTimes,
  sampleNhppCountPath,
  renewalFunctionSteps,
  elementaryRenewalRate,
  countsOnGrid,
  // diffusions
  brownianMarginal,
  brownianCovariance,
  brownianRunningMaxSf,
  brownianMarginalSf,
  brownianFirstPassage,
  sampleBrownianPath,
  gbmMarginal,
  gbmFromLogDrift,
  gbmFirstPassageProbability,
  sampleGbmPath,
  ouTransition,
  ouStationary,
  sampleOuPath,
  jumpDiffusionMean,
  sampleJumpDiffusionPath,
  sampleEulerMaruyamaPath,
  // discrete
  gamblersRuin,
  gamblersRuinSimulationSteps,
  randomWalkMoments,
  sampleRandomWalkPath,
  ar1Stationary,
  ar1Conditional,
  sampleAr1Path,
  extinctionProbability,
  poissonOffspring,
  offspringPmfGeneratingFunction,
  branchingSimulationSteps,
  branchingExpectedSize,
  // ctmc
  validateGenerator,
  matrixExponential,
  ctmcTransient,
  ctmcStationary,
  ctmcHittingTimes,
  twoStateTransition,
  sampleCtmcTrajectory,
  occupancyTimes,
  ctmcGillespieSteps,
  ctmcStateSummary,
  // ensemble
  runEnsemble,
  ensembleSteps,
  fanChart,
  firstPassageFromEnsemble,
  PROCESS_DEFINITIONS,
  getProcessDefinition,
} from './index';
import type { Matrix } from '../stats/linalg';

/* ---------------------------- test helpers ---------------------------- */

const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const sampleVar = (xs: number[]): number => {
  const m = avg(xs);
  return xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
};
const corr = (xs: number[], ys: number[]): number => {
  const mx = avg(xs);
  const my = avg(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
};
const column = (paths: number[][], j: number): number[] => paths.map((p) => p[j]);
/** Run a generator to completion and report how many times it yielded. */
function drain<T>(gen: Generator<number, T, void>): { value: T; yields: number } {
  let yields = 0;
  let next = gen.next();
  while (!next.done) {
    yields++;
    next = gen.next();
  }
  return { value: next.value, yields };
}

/* ====================================================================== *
 * Definitions
 * ====================================================================== */

describe('process definitions', () => {
  it('every process carries a description, formula, assumptions and limitations', () => {
    expect(PROCESS_DEFINITIONS.length).toBe(12);
    for (const d of PROCESS_DEFINITIONS) {
      expect(d.description.length).toBeGreaterThan(40);
      expect(d.formula.length).toBeGreaterThan(5);
      expect(d.assumptions.length).toBeGreaterThan(1);
      expect(d.limitations.length).toBeGreaterThan(1);
      expect(d.exactResults.length).toBeGreaterThan(0);
      expect(getProcessDefinition(d.id)).toBe(d);
    }
  });

  it('refuses an unknown process id and lists the known ones', () => {
    expect(() => getProcessDefinition('wiener-sausage')).toThrow(EngineError);
    expect(() => getProcessDefinition('wiener-sausage')).toThrow(/Available processes/);
  });
});

/* ====================================================================== *
 * Homogeneous Poisson process
 * ====================================================================== */

describe('homogeneous Poisson process', () => {
  // Reference: Python, math module only:
  //   [math.exp(-2.5)*2.5**k/math.factorial(k) for k in range(9)]
  const PMF_2_5 = [
    0.0820849986238988, 0.20521249655974699, 0.25651562069968376, 0.21376301724973645,
    0.13360188578108528, 0.066800942890542642, 0.02783372620439277, 0.0099406165015688466,
    0.0031064426567402642,
  ];

  it('exact pmf matches an independently computed Poisson(λt)', () => {
    for (let k = 0; k < PMF_2_5.length; k++) {
      const q = poissonCountPmf(2.5, 1, k);
      expect(q.value).toBeCloseTo(PMF_2_5[k], 15);
      expect(q.exactness).toBe('exact');
    }
    // λ and t enter only through their product.
    expect(poissonCountPmf(0.5, 5, 3).value).toBeCloseTo(PMF_2_5[3], 15);
  });

  it('mean equals variance equals λt', () => {
    const s = poissonCountSummary(1.25, 2, 60);
    expect(s.mean.value).toBeCloseTo(2.5, 12);
    expect(s.variance.value).toBeCloseTo(2.5, 12);
    expect(s.pmfMassShown).toBeCloseTo(1, 12);
  });

  it('simulated N(t) matches the exact pmf per k, and by chi-square', () => {
    const n = 40000;
    const rate = 2.5;
    const ens = runEnsemble((rng, times) => samplePoissonCountPath(rng, rate, times), [1], n, 'poisson-counts');
    const counts = column(ens.paths, 0);
    const observed = new Array<number>(PMF_2_5.length).fill(0);
    let tail = 0;
    for (const c of counts) {
      if (c < PMF_2_5.length) observed[c]++;
      else tail++;
    }
    let chi2 = 0;
    for (let k = 0; k < PMF_2_5.length; k++) {
      const p = PMF_2_5[k];
      const expected = n * p;
      // Four standard errors of a binomial proportion, as a frequency.
      const tol = 4 * Math.sqrt((p * (1 - p)) / n);
      expect(Math.abs(observed[k] / n - p)).toBeLessThan(tol);
      chi2 += (observed[k] - expected) ** 2 / expected;
    }
    const pTail = 1 - PMF_2_5.reduce((a, b) => a + b, 0);
    chi2 += (tail - n * pTail) ** 2 / (n * pTail);
    // 10 cells, 0 fitted parameters → chi-square with 9 df. The 0.999 point
    // is 27.88 (Python: statistics not needed, standard table value), so this
    // fails by chance once in a thousand runs; the seed is fixed.
    expect(chi2).toBeLessThan(27.88);
    // Mean and variance of the simulated counts: SE of the mean is
    // sqrt(λt/n) = 0.0079, so four SE is 0.032.
    expect(Math.abs(avg(counts) - 2.5)).toBeLessThan(0.032);
  });

  it('simulated interarrival times are Exponential(λ) with mean 1/λ and variance 1/λ²', () => {
    const rate = 4;
    const rng = new Random(new Xoshiro128('interarrivals'));
    const events = samplePoissonEventTimes(rng, rate, 5000);
    const gaps: number[] = [];
    let prev = 0;
    for (const t of events) {
      gaps.push(t - prev);
      prev = t;
    }
    const law = poissonInterarrivalLaw(rate);
    expect(law.mean.value).toBe(0.25);
    expect(law.variance.value).toBeCloseTo(1 / 16, 15);
    // n ≈ 20,000 gaps; SE of the mean is (1/λ)/√n ≈ 0.0018, four SE ≈ 0.007.
    expect(gaps.length).toBeGreaterThan(19000);
    expect(Math.abs(avg(gaps) - 0.25)).toBeLessThan(0.007);
    // SE of the variance of an exponential sample is var·√(20/n) ≈ 0.0020
    // (kurtosis 9 → Var(s²) = var²(κ−1)/n = var²·8/n); four SE ≈ 0.008.
    expect(Math.abs(sampleVar(gaps) - 1 / 16)).toBeLessThan(0.008);
    // The memoryless property: P(gap > 2/λ) = e^{-2} = 0.1353.
    const frac = gaps.filter((g) => g > 0.5).length / gaps.length;
    expect(Math.abs(frac - Math.exp(-2))).toBeLessThan(4 * Math.sqrt((0.1353 * 0.8647) / gaps.length));
  });

  it('waiting time to the n-th event is Gamma(n, 1/λ) with the right moments and CDF', () => {
    const w = poissonWaitingTime(2, 5);
    expect(w.mean.value).toBe(2.5);
    expect(w.variance.value).toBe(1.25);
    expect(w.distribution).toContain('Gamma');
    // Reference: P(S_5 ≤ 2.5) for λ=2 is the regularised P(5, 5).
    // Python: 1 - sum(math.exp(-5)*5**k/math.factorial(k) for k in range(5))
    //       = 0.5595067149347874
    expect(w.cdf(2.5).value).toBeCloseTo(0.5595067149347874, 12);
    // Simulated: mean time to the 5th event.
    const rng = new Random(new Xoshiro128('waiting'));
    const fifth: number[] = [];
    for (let i = 0; i < 20000; i++) {
      let t = 0;
      for (let k = 0; k < 5; k++) t += rng.exponential(2);
      fifth.push(t);
    }
    // SE = sqrt(1.25/20000) = 0.0079; four SE = 0.032.
    expect(Math.abs(avg(fifth) - 2.5)).toBeLessThan(0.032);
  });

  it('refuses a non-positive rate and a negative time rather than returning a number', () => {
    expect(() => poissonCountPmf(0, 1, 0)).toThrow(EngineError);
    expect(() => poissonCountPmf(-1, 1, 0)).toThrow(/greater than 0/);
    expect(() => poissonCountPmf(1, -1, 0)).toThrow(/0 or greater/);
    expect(() => poissonCountPmf(1, 1, 1.5)).toThrow(/whole number/);
  });

  it('counts on a grid are a right-continuous step function of the event times', () => {
    expect(countsOnGrid([0.5, 1.5, 1.5, 3], [0, 1, 2, 3])).toEqual([0, 1, 3, 4]);
  });
});

/* ====================================================================== *
 * Non-homogeneous Poisson process
 * ====================================================================== */

describe('non-homogeneous Poisson process', () => {
  // λ(t) = 2 + 1.5·sin(t). Over [0, 2π] the sine integrates to 0, so
  // Λ(2π) = 2·2π = 4π = 12.566370614359172 exactly.
  const intensity = (t: number) => 2 + 1.5 * Math.sin(t);
  const horizon = 2 * Math.PI;

  it('expected count integrates the intensity numerically', () => {
    const q = nhppExpectedCount(intensity, horizon, 4096);
    expect(q.exactness).toBe('numerical');
    expect(q.value).toBeCloseTo(4 * Math.PI, 10);
  });

  it('thinning reproduces the expected count', () => {
    const n = 4000;
    const ens = runEnsemble(
      (rng, times) => sampleNhppCountPath(rng, intensity, 3.5, times),
      [horizon],
      n,
      'nhpp',
    );
    const counts = column(ens.paths, 0);
    // N(2π) ~ Poisson(4π): SE of the mean is sqrt(4π/4000) = 0.056, four SE = 0.22.
    expect(Math.abs(avg(counts) - 4 * Math.PI)).toBeLessThan(0.22);
    // Poisson signature: variance equals the mean. SE of the variance is
    // var·sqrt(2/n) ≈ 0.28 for a Poisson of this size, four SE ≈ 1.1.
    expect(Math.abs(sampleVar(counts) - 4 * Math.PI)).toBeLessThan(1.1);
  });

  it('a violated thinning bound is refused, not silently thinned to a different process', () => {
    const rng = new Random(new Xoshiro128('bad-bound'));
    expect(() => sampleNhppEventTimes(rng, intensity, horizon, 1)).toThrow(EngineError);
    expect(() => sampleNhppEventTimes(rng, intensity, horizon, 1)).toThrow(/bound λ\* = 1 is violated/);
    // A bound that is only just large enough is accepted (max λ = 3.5).
    expect(() => sampleNhppEventTimes(rng, intensity, horizon, 3.5)).not.toThrow();
  });

  it('a negative or non-finite intensity is refused', () => {
    expect(() => nhppExpectedCount((t) => t - 1, 2)).toThrow(/negative/);
    expect(() => nhppExpectedCount(() => NaN, 2)).toThrow(/finite/);
  });
});

/* ====================================================================== *
 * Compound Poisson
 * ====================================================================== */

describe('compound Poisson process', () => {
  it('exact aggregate mean and variance use E[J] and E[J²]', () => {
    // λ=2, t=3, J ~ Exponential(rate 0.5): E[J] = 2, E[J²] = 2·scale² = 8.
    const m = compoundPoissonMoments(2, 3, 2, 8);
    expect(m.mean.value).toBe(12); // λt·E[J] = 6·2
    expect(m.variance.value).toBe(48); // λt·E[J²] = 6·8
    expect(m.mean.exactness).toBe('exact');
    expect(m.sd.value).toBeCloseTo(Math.sqrt(48), 12);
  });

  it('simulated aggregate matches the exact mean and variance', () => {
    const n = 40000;
    const ens = runEnsemble(
      (rng, times) => sampleCompoundPoissonPath(rng, 2, (r) => r.exponential(0.5), times),
      [3],
      n,
      'compound',
    );
    const x = column(ens.paths, 0);
    // SE of the mean is sqrt(48/40000) = 0.0346; four SE = 0.14.
    expect(Math.abs(avg(x) - 12)).toBeLessThan(0.14);
    // The aggregate has excess kurtosis of roughly 1.6 here, so the SE of the
    // sample variance is var·sqrt((κ−1)/n) ≈ 48·0.011 ≈ 0.52; four SE ≈ 2.1.
    expect(Math.abs(sampleVar(x) - 48)).toBeLessThan(2.1);
  });

  it('refuses a second moment below the squared mean', () => {
    expect(() => compoundPoissonMoments(1, 1, 3, 4)).toThrow(/impossible/);
  });
});

/* ====================================================================== *
 * Renewal process
 * ====================================================================== */

describe('renewal process', () => {
  it('m(t)/t approaches 1/μ (elementary renewal theorem)', () => {
    // Interarrival Gamma(shape 2, scale 0.5): μ = 1, σ² = 0.5.
    const interarrival = (rng: Random) => rng.gamma(2) * 0.5;
    const limit = elementaryRenewalRate(1);
    expect(limit.value).toBe(1);
    const { value, yields } = drain(
      renewalFunctionSteps(interarrival, 1, [10, 50, 200], 2000, 'renewal'),
    );
    expect(yields).toBeGreaterThan(1);
    expect(value.exactness).toBe('empirical');
    const ratios = value.ratio as number[];
    // Independent reference: the renewal-theory expansion
    //   m(t) = t/μ + (σ² − μ²)/(2μ²) + o(1) = t − 0.25 for this law.
    // Var N(t) ≈ tσ²/μ³ = 0.5t, so SD of N(200) is 10 and the SE of m(200)
    // with 2000 paths is 0.224; four SE is 0.9.
    expect(Math.abs(value.renewalFunction[2] - 199.75)).toBeLessThan(1.0);
    // At t = 10 the same expansion gives 9.75, with SE 0.05.
    expect(Math.abs(value.renewalFunction[0] - 9.75)).toBeLessThan(0.5);
    // The ratio m(t)/t is within 0.01 of the elementary-renewal limit 1/μ = 1
    // at t = 200 (the remaining gap is the −0.25/t term plus 4 SE = 0.0045).
    expect(Math.abs(ratios[2] - 1)).toBeLessThan(0.01);
    // The ratio at t = 10 is clearly further from the limit than at t = 200:
    // the limit is an asymptotic statement, not a short-horizon one.
    expect(Math.abs(ratios[0] - 1)).toBeGreaterThan(Math.abs(ratios[2] - 1));
    expect(ratios[0]).toBeLessThan(1);
  });

  it('a Poisson process is the exponential-interarrival renewal process', () => {
    const { value } = drain(
      renewalFunctionSteps((rng) => rng.exponential(2), 0.5, [20], 600, 'renewal-exp'),
    );
    // m(t) = λt = 40 exactly for the Poisson case. SD of N(20) is sqrt(40),
    // SE = sqrt(40/600) = 0.258, four SE = 1.03.
    expect(Math.abs(value.renewalFunction[0] - 40)).toBeLessThan(1.03);
  });

  it('refuses a zero or negative interarrival time', () => {
    const rng = new Random(new Xoshiro128('bad-renewal'));
    expect(() => drain(renewalFunctionSteps(() => 0, 1, [1], 2, 's'))).toThrow(/0/);
    expect(() => drain(renewalFunctionSteps(() => -1, 1, [1], 2, 's'))).toThrow(EngineError);
    expect(() => elementaryRenewalRate(0)).toThrow(/greater than 0/);
    expect(rng).toBeDefined();
  });
});

/* ====================================================================== *
 * Brownian motion
 * ====================================================================== */

describe('Brownian motion', () => {
  it('exact marginal and covariance', () => {
    const p = { x0: 1, drift: 0.5, volatility: 2 };
    const law = brownianMarginal(p, 3);
    expect(law.mean).toBe(1 + 1.5);
    expect(law.variance).toBe(4 * 3);
    expect(law.exactness).toBe('exact');
    expect(brownianCovariance(p, 2, 5).value).toBe(4 * 2); // σ²·min(s,t)
    expect(brownianCovariance(p, 5, 2).value).toBe(4 * 2);
  });

  it('simulated marginal variance equals σ²t and the mean equals μt', () => {
    const n = 40000;
    const p = { x0: 0, drift: 0.4, volatility: 2 };
    const ens = runEnsemble((rng, times) => sampleBrownianPath(rng, p, times), [1, 3], n, 'bm-marginal');
    const x3 = column(ens.paths, 1);
    // σ²t = 4·3 = 12. SE of the sample variance of a normal sample is
    // var·sqrt(2/n) = 12·0.00707 = 0.085; four SE = 0.34.
    expect(Math.abs(sampleVar(x3) - 12)).toBeLessThan(0.34);
    // Mean μt = 1.2; SE = sqrt(12/n) = 0.0173, four SE = 0.07.
    expect(Math.abs(avg(x3) - 1.2)).toBeLessThan(0.07);
    // Covariance Cov(X(1), X(3)) = σ²·1 = 4. SE of a covariance here is
    // roughly sqrt((v1·v3 + c²)/n) = sqrt((4·12+16)/40000) = 0.04; 4 SE = 0.16.
    const x1 = column(ens.paths, 0);
    const cov = corr(x1, x3) * Math.sqrt(sampleVar(x1) * sampleVar(x3));
    expect(Math.abs(cov - 4)).toBeLessThan(0.16);
  });

  it('the reflection principle gives P(max > a) = 2·P(X(t) > a) without drift', () => {
    const p = { x0: 0, drift: 0, volatility: 1 };
    const maxSf = brownianRunningMaxSf(p, 2, 4);
    const marginalSf = brownianMarginalSf(p, 2, 4);
    expect(maxSf.exactness).toBe('exact');
    // Independent reference, Python: 2*0.5*erfc(1/sqrt(2)) = 0.31731050786291415
    expect(maxSf.value).toBeCloseTo(0.31731050786291415, 14);
    expect(maxSf.value).toBeCloseTo(2 * marginalSf.value, 14);
  });

  it('the reflection principle with drift matches the Bachelier–Lévy formula', () => {
    // Independent reference, Python with μ=0.3, σ=1, t=4, a=2:
    //   Phi((0.3*4-2)/2) + exp(2*0.3*2)*Phi((-2-1.2)/2) = 0.52651831411535477
    const q = brownianRunningMaxSf({ x0: 0, drift: 0.3, volatility: 1 }, 2, 4);
    expect(q.value).toBeCloseTo(0.52651831411535477, 13);
    // Shifting the start by 1 is the same as lowering the level by 1.
    const shifted = brownianRunningMaxSf({ x0: 1, drift: 0.3, volatility: 1 }, 3, 4);
    expect(shifted.value).toBeCloseTo(q.value, 15);
    // A level at or below the start is hit immediately.
    expect(brownianRunningMaxSf({ x0: 1, drift: 0, volatility: 1 }, 1, 4).value).toBe(1);
  });

  it('simulated running maximum matches the exact reflection-principle law', () => {
    // The maximum is monitored on a grid, so the simulated crossing frequency
    // is a LOWER bound on the continuous-time probability. With 1000 steps on
    // [0,4] the discrete-monitoring bias in the level is about
    // 0.5826·σ·√Δ = 0.0369, and the density of the maximum at a = 2 is
    // 2φ(1)/2 = 0.242, so the expected shortfall is about 0.0089.
    const n = 10000;
    const steps = 1000;
    const times = Array.from({ length: steps }, (_, i) => (4 * (i + 1)) / steps);
    const p = { x0: 0, drift: 0, volatility: 1 };
    const ens = runEnsemble((rng, grid) => sampleBrownianPath(rng, p, grid), times, n, 'bm-max');
    const crossed = ens.paths.filter((path) => path.some((x) => x >= 2)).length / n;
    const exact = 0.31731050786291415;
    // SE of the frequency is sqrt(p(1−p)/n) = 0.0047.
    expect(crossed).toBeLessThan(exact + 3 * 0.0047);
    expect(exact - crossed).toBeLessThan(0.03); // bias 0.0089 + 4 SE
    expect(crossed).toBeGreaterThan(exact - 0.03);
  });

  it('first-passage probability from simulation matches the closed form (with drift)', () => {
    const p = { x0: 0, drift: 0.3, volatility: 1 };
    const fp = brownianFirstPassage(p, 2);
    expect(fp.mean.defined).toBe(true);
    if (fp.mean.defined) expect(fp.mean.value).toBeCloseTo(2 / 0.3, 12);
    const exact = fp.cdf(4).value;
    expect(exact).toBeCloseTo(0.52651831411535477, 13);

    const n = 10000;
    const steps = 1000;
    const times = Array.from({ length: steps }, (_, i) => (4 * (i + 1)) / steps);
    const ens = runEnsemble((rng, grid) => sampleBrownianPath(rng, p, grid), times, n, 'bm-fp');
    const est = firstPassageFromEnsemble(ens, 2, 'above');
    expect(est.exactness).toBe('empirical');
    // Same discrete-monitoring argument as above: a lower bound within about
    // 0.01 of the exact value, plus 4 SE = 0.02.
    expect(est.probability).toBeLessThan(exact + 3 * 0.005);
    expect(exact - est.probability).toBeLessThan(0.03);
    expect(est.notes.join(' ')).toMatch(/lower bound/);
    // The conditional crossing-time median must lie inside the horizon.
    const median = est.crossingTimeQuantiles.find((q) => q.p === 0.5);
    expect(median && median.t > 0 && median.t <= 4).toBe(true);
  });

  it('reports an infinite mean first-passage time as undefined, not as a number', () => {
    const zeroDrift = brownianFirstPassage({ x0: 0, drift: 0, volatility: 1 }, 1);
    expect(zeroDrift.mean.defined).toBe(false);
    if (!zeroDrift.mean.defined) expect(zeroDrift.mean.reason).toMatch(/infinite/);
    const negative = brownianFirstPassage({ x0: 0, drift: -0.5, volatility: 1 }, 1);
    expect(negative.mean.defined).toBe(false);
    // With negative drift the total crossing probability is exp(2μa/σ²).
    expect(negative.cdf(1e6).value).toBeCloseTo(Math.exp(-1), 6);
    expect(() => brownianFirstPassage({ x0: 0, drift: 1, volatility: 1 }, -1)).toThrow(/at or below/);
  });

  it('the first-passage density integrates to the first-passage probability', () => {
    // Independent check by the trapezium rule on the analytic density.
    const p = { x0: 0, drift: 0.3, volatility: 1 };
    const fp = brownianFirstPassage(p, 2);
    const steps = 200000;
    const h = 4 / steps;
    let sum = 0;
    for (let i = 1; i <= steps; i++) {
      const t = i * h;
      sum += fp.density(t).value * h;
    }
    expect(sum).toBeCloseTo(fp.cdf(4).value, 4);
  });

  it('refuses invalid parameters', () => {
    expect(() => brownianMarginal({ x0: 0, drift: 0, volatility: 0 }, 1)).toThrow(/greater than 0/);
    expect(() => brownianMarginal({ x0: 0, drift: NaN, volatility: 1 }, 1)).toThrow(/finite/);
    expect(() => brownianRunningMaxSf({ x0: 0, drift: 0, volatility: 1 }, 1, 0)).toThrow(/greater than 0/);
  });
});

/* ====================================================================== *
 * Geometric Brownian motion
 * ====================================================================== */

describe('geometric Brownian motion', () => {
  const p = { s0: 100, drift: 0.07, volatility: 0.3 };

  it('states its parameterisation and the Itô correction explicitly', () => {
    const m = gbmMarginal(p, 2);
    // Convention: μ is the drift of dS/S, so E[S(t)] = S₀e^{μt} and log S
    // drifts at μ − σ²/2. The Itô correction is NEGATIVE.
    expect(m.itoCorrection.value).toBeCloseTo(-0.045, 15); // −σ²/2 = −0.09/2
    expect(m.itoCorrection.value).toBeLessThan(0);
    expect(m.logLaw.mean).toBeCloseTo((0.07 - 0.045) * 2, 15); // 0.05
    expect(m.logLaw.variance).toBeCloseTo(0.09 * 2, 15);
    expect(m.mean.value).toBeCloseTo(100 * Math.exp(0.14), 12);
    expect(m.median.value).toBeCloseTo(100 * Math.exp(0.05), 12);
    // The median is strictly below the mean whenever σ > 0 — the whole point
    // of the correction. A sign error here would reverse this.
    expect(m.median.value).toBeLessThan(m.mean.value);
    expect(m.parameterisation).toMatch(/expected return/);
    // Var[S(t)] = S₀²e^{2μt}(e^{σ²t}−1).
    expect(m.variance.value).toBeCloseTo(1e4 * Math.exp(0.28) * (Math.exp(0.18) - 1), 8);
  });

  it('converts a log-return drift into the dS/S convention', () => {
    const q = gbmFromLogDrift(100, 0.05, 0.3);
    expect(q.drift).toBeCloseTo(0.095, 15); // m + σ²/2
    // With that μ, log S drifts at exactly the requested 0.05.
    expect(gbmMarginal(q, 1).logLaw.mean).toBeCloseTo(0.05, 15);
  });

  it('simulated E[S(t)] matches S₀e^{μt} and log(S/S₀) is Normal with the analytic moments', () => {
    const n = 60000;
    const ens = runEnsemble((rng, times) => sampleGbmPath(rng, p, times), [2], n, 'gbm');
    const s = column(ens.paths, 0);
    const logs = s.map((x) => Math.log(x / 100));
    // Analytic log mean 0.05, log variance 0.18.
    // SE of the log mean is sqrt(0.18/60000) = 0.00173; four SE = 0.0069.
    expect(Math.abs(avg(logs) - 0.05)).toBeLessThan(0.0069);
    // SE of the log variance is 0.18·sqrt(2/n) = 0.00104; four SE = 0.0042.
    expect(Math.abs(sampleVar(logs) - 0.18)).toBeLessThan(0.0042);
    // E[S(2)] = 100e^{0.14} = 115.027. SD[S(2)] = 115.027·sqrt(e^{0.18}−1)
    // = 51.0, so SE = 0.208 and four SE = 0.84. Note that this assertion is
    // only passed with the Itô correction present AND with the right sign:
    // dropping it would give a simulated mean near 100e^{0.05} = 105.1, and
    // flipping it would give about 126.
    expect(Math.abs(avg(s) - 100 * Math.exp(0.14))).toBeLessThan(0.84);
    expect(Math.abs(avg(s) - 100 * Math.exp(0.05))).toBeGreaterThan(5);
    // More than half the paths finish below the mean (log-normal skew).
    const below = s.filter((x) => x < 100 * Math.exp(0.14)).length / n;
    expect(below).toBeGreaterThan(0.5);
  });

  it('first passage uses the Itô-corrected drift of log S', () => {
    // Crossing 150 by t=2 must equal the Brownian running-max probability for
    // log S, which drifts at μ − σ²/2 = 0.025 with volatility 0.3.
    const q = gbmFirstPassageProbability(p, 150, 2);
    const viaLog = brownianRunningMaxSf({ x0: 0, drift: 0.025, volatility: 0.3 }, Math.log(1.5), 2);
    expect(q.value).toBeCloseTo(viaLog.value, 15);
    const n = 10000;
    const steps = 1000;
    const times = Array.from({ length: steps }, (_, i) => (2 * (i + 1)) / steps);
    const ens = runEnsemble((rng, grid) => sampleGbmPath(rng, p, grid), times, n, 'gbm-fp');
    const est = firstPassageFromEnsemble(ens, 150, 'above');
    // Discrete monitoring again gives a lower bound; 4 SE ≈ 0.02.
    expect(q.value - est.probability).toBeLessThan(0.035);
    expect(est.probability).toBeLessThan(q.value + 0.02);
  });

  it('refuses a non-positive start or volatility', () => {
    expect(() => gbmMarginal({ s0: 0, drift: 0.1, volatility: 0.2 }, 1)).toThrow(/greater than 0/);
    expect(() => gbmMarginal({ s0: 100, drift: 0.1, volatility: 0 }, 1)).toThrow(/greater than 0/);
  });
});

/* ====================================================================== *
 * Ornstein–Uhlenbeck
 * ====================================================================== */

describe('Ornstein–Uhlenbeck process', () => {
  const p = { x0: 5, meanLevel: 2, reversionRate: 1.5, volatility: 0.8 };

  it('exact stationary law, autocorrelation and half-life', () => {
    const s = ouStationary(p);
    expect(s.law.mean).toBe(2);
    expect(s.law.variance).toBeCloseTo(0.64 / 3, 15); // σ²/(2κ)
    expect(s.halfLife.value).toBeCloseTo(Math.LN2 / 1.5, 15);
    expect(s.autocorrelation(1).value).toBeCloseTo(Math.exp(-1.5), 15);
    expect(s.autocorrelation(2).value).toBeCloseTo(Math.exp(-3), 15);
    // The half-life does not depend on σ.
    expect(ouStationary({ ...p, volatility: 5 }).halfLife.value).toBeCloseTo(s.halfLife.value, 15);
  });

  it('the exact transition sampler reproduces the analytic Gaussian transition', () => {
    const dt = 0.3;
    const law = ouTransition(p, p.x0, dt);
    // Analytic, computed here from the parameters: mean θ + (x−θ)e^{−κΔ},
    // variance σ²(1−e^{−2κΔ})/(2κ).
    const e = Math.exp(-1.5 * dt);
    expect(law.mean).toBeCloseTo(2 + 3 * e, 15);
    expect(law.variance).toBeCloseTo((0.64 * (1 - e * e)) / 3, 15);

    const n = 40000;
    const ens = runEnsemble((rng, times) => sampleOuPath(rng, p, times), [dt], n, 'ou-step');
    const x = column(ens.paths, 0);
    // SE of the mean is sqrt(var/n) = sqrt(0.1259/40000) = 0.00177; 4 SE = 0.0071.
    expect(Math.abs(avg(x) - law.mean)).toBeLessThan(0.0071);
    // SE of the variance is var·sqrt(2/n) = 0.00089; four SE = 0.0036.
    expect(Math.abs(sampleVar(x) - law.variance)).toBeLessThan(0.0036);
  });

  it('simulated stationary variance is σ²/(2κ) and lag-k autocorrelation is exp(−κ·lag)', () => {
    // t = 10 is more than 20 half-lives, so the marginal is stationary to
    // within e^{-15} ≈ 3e-7 of the limit — far below Monte Carlo error.
    const n = 40000;
    const ens = runEnsemble((rng, times) => sampleOuPath(rng, p, times), [10, 11, 12], n, 'ou-stationary');
    const a = column(ens.paths, 0);
    const b = column(ens.paths, 1);
    const c = column(ens.paths, 2);
    const varStat = 0.64 / 3;
    // SE of the variance is var·sqrt(2/n) = 0.0015; four SE = 0.006.
    expect(Math.abs(sampleVar(a) - varStat)).toBeLessThan(0.006);
    expect(Math.abs(avg(a) - 2)).toBeLessThan(4 * Math.sqrt(varStat / n));
    // Lag 1 and lag 2 autocorrelations. SE of a correlation is
    // (1−ρ²)/√n ≈ 0.0048 at ρ = 0.22; four SE = 0.02.
    expect(Math.abs(corr(a, b) - Math.exp(-1.5))).toBeLessThan(0.02);
    expect(Math.abs(corr(a, c) - Math.exp(-3))).toBeLessThan(0.02);
  });

  it('refuses a non-positive reversion rate', () => {
    expect(() => ouStationary({ ...p, reversionRate: 0 })).toThrow(/greater than 0/);
    expect(() => ouStationary({ ...p, reversionRate: -1 })).toThrow(EngineError);
  });
});

/* ====================================================================== *
 * Jump diffusion and Euler–Maruyama
 * ====================================================================== */

describe('Merton jump diffusion', () => {
  const p = {
    s0: 100,
    drift: 0.05,
    volatility: 0.2,
    jumpRate: 0.8,
    jumpLogMean: -0.1,
    jumpLogSd: 0.15,
  };

  it('exact mean includes the jump compensator', () => {
    const q = jumpDiffusionMean(p, 2);
    const jumpFactor = Math.exp(-0.1 + 0.15 ** 2 / 2) - 1;
    expect(q.value).toBeCloseTo(100 * Math.exp(0.05 * 2 + 0.8 * 2 * jumpFactor), 10);
    expect(jumpFactor).toBeLessThan(0); // downward jumps on average
  });

  it('simulated mean matches the exact mean, and jumps fatten the tails', () => {
    const n = 40000;
    const ens = runEnsemble((rng, times) => sampleJumpDiffusionPath(rng, p, times), [2], n, 'merton');
    const s = column(ens.paths, 0);
    const exact = jumpDiffusionMean(p, 2).value;
    // SD of S(2) here is about 33 (dominated by the diffusion), so the SE of
    // the mean is 0.17 and four SE is about 0.7. Use 1.0 for the heavier tail.
    expect(Math.abs(avg(s) - exact)).toBeLessThan(1.0);
    // With λ=0.8 the probability of no jump by t=2 is e^{−1.6} = 0.2019.
    const noJumpFraction = Math.exp(-1.6);
    expect(noJumpFraction).toBeCloseTo(0.20189651799465538, 12);
    // Log returns are more peaked and fatter-tailed than the pure diffusion:
    // the sample excess kurtosis of log S must be clearly positive.
    const logs = s.map((x) => Math.log(x / 100));
    const m = avg(logs);
    const v = sampleVar(logs);
    const k4 = avg(logs.map((x) => (x - m) ** 4)) / (v * v) - 3;
    expect(k4).toBeGreaterThan(0.1);
  });

  it('a zero jump rate reduces exactly to geometric Brownian motion', () => {
    const noJumps = { ...p, jumpRate: 0 };
    expect(jumpDiffusionMean(noJumps, 2).value).toBeCloseTo(
      gbmMarginal({ s0: 100, drift: 0.05, volatility: 0.2 }, 2).mean.value,
      10,
    );
  });
});

describe('Euler–Maruyama', () => {
  it('is labelled a discretisation and converges to the exact law as the step shrinks', () => {
    // dX = μX dt + σX dW is GBM, whose exact mean at t=1 is S₀e^{μ}.
    const sde = {
      drift: (_t: number, x: number) => 0.1 * x,
      diffusion: (_t: number, x: number) => 0.25 * x,
      x0: 1,
    };
    const rng = new Random(new Xoshiro128('euler'));
    const one = sampleEulerMaruyamaPath(rng, sde, 1, 50);
    expect(one.exactness).toBe('numerical');
    expect(one.stepSize).toBeCloseTo(0.02, 15);
    expect(one.limitations[0]).toMatch(/strong order 1\/2/);
    expect(one.values.length).toBe(51);

    const exactMean = Math.exp(0.1);
    const meanWith = (steps: number, seed: string): number => {
      const r = new Random(new Xoshiro128(seed));
      const ends: number[] = [];
      for (let i = 0; i < 8000; i++) ends.push(sampleEulerMaruyamaPath(r, sde, 1, steps).values[steps]);
      return avg(ends);
    };
    // Weak order 1: the bias in the mean is O(h). SE of the mean is
    // sd/√n ≈ 0.26/89 ≈ 0.003, so with 8000 paths both estimates sit within
    // about 0.012 of their own limit; the fine-step estimate must be within
    // 4 SE of the exact mean.
    const fine = meanWith(400, 'euler-fine');
    expect(Math.abs(fine - exactMean)).toBeLessThan(0.013);
  });

  it('refuses a diverging path and non-finite coefficients instead of returning NaN', () => {
    const rng = new Random(new Xoshiro128('diverge'));
    expect(() =>
      sampleEulerMaruyamaPath(rng, { drift: (_t, x) => x * x * 1e300, diffusion: () => 1, x0: 10 }, 1, 10),
    ).toThrow(EngineError);
    expect(() =>
      sampleEulerMaruyamaPath(rng, { drift: () => NaN, diffusion: () => 1, x0: 0 }, 1, 10),
    ).toThrow(/not finite/);
  });
});

/* ====================================================================== *
 * Random walk and gambler's ruin — the sharpest test in the module
 * ====================================================================== */

describe("random walk and gambler's ruin", () => {
  /**
   * Independent reference: expected duration by solving the tridiagonal
   * system D_k = 1 + p·D_{k+1} + q·D_{k−1}, D_0 = D_N = 0, by Gaussian
   * elimination written here in the test. This shares no code with the
   * closed form under test.
   */
  function durationsByLinearSystem(p: number, N: number): number[] {
    const q = 1 - p;
    const n = N - 1;
    const M: number[][] = [];
    for (let i = 1; i <= n; i++) {
      const row = new Array<number>(n + 1).fill(0);
      row[i - 1] = -1;
      if (i + 1 <= n) row[i] = p;
      if (i - 1 >= 1) row[i - 2] = q;
      row[n] = -1;
      M.push(row);
    }
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      for (let r = 0; r < n; r++) {
        if (r === c || M[r][c] === 0) continue;
        const f = M[r][c] / M[c][c];
        for (let cc = c; cc <= n; cc++) M[r][cc] -= f * M[c][cc];
      }
    }
    const out = new Array<number>(N + 1).fill(0);
    for (let i = 1; i <= n; i++) out[i] = M[i - 1][n] / M[i - 1][i - 1];
    return out;
  }

  /** Independent reference: win probabilities by the same kind of solve. */
  function winProbabilitiesByLinearSystem(p: number, N: number): number[] {
    const q = 1 - p;
    const n = N - 1;
    const M: number[][] = [];
    for (let i = 1; i <= n; i++) {
      const row = new Array<number>(n + 1).fill(0);
      row[i - 1] = -1;
      if (i + 1 <= n) row[i] = p;
      if (i - 1 >= 1) row[i - 2] = q;
      row[n] = i + 1 === N ? -p : 0; // P(win from N) = 1
      M.push(row);
    }
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      for (let r = 0; r < n; r++) {
        if (r === c || M[r][c] === 0) continue;
        const f = M[r][c] / M[c][c];
        for (let cc = c; cc <= n; cc++) M[r][cc] -= f * M[c][cc];
      }
    }
    const out = new Array<number>(N + 1).fill(0);
    out[N] = 1;
    for (let i = 1; i <= n; i++) out[i] = M[i - 1][n] / M[i - 1][i - 1];
    return out;
  }

  it('closed forms agree with an independent linear-system solve for every start', () => {
    for (const p of [0.45, 0.5, 0.55, 0.3]) {
      const N = 15;
      const dur = durationsByLinearSystem(p, N);
      const win = winProbabilitiesByLinearSystem(p, N);
      for (let k = 1; k < N; k++) {
        const g = gamblersRuin(p, k, N);
        expect(g.winProbability.value).toBeCloseTo(win[k], 10);
        expect(g.expectedDuration.value).toBeCloseTo(dur[k], 8);
        expect(g.ruinProbability.value).toBeCloseTo(1 - win[k], 10);
        expect(g.winProbability.exactness).toBe('exact');
      }
    }
  });

  it('matches the textbook formulas numerically', () => {
    // Python reference, p=0.45, k=5, N=15, r=q/p:
    //   (r**5-1)/(r**15-1)                      = 0.08955603314647384
    //   5/(q-p) - (15/(q-p))*(1-r**5)/(1-r**15) = 36.566595028028914
    const g = gamblersRuin(0.45, 5, 15);
    expect(g.winProbability.value).toBeCloseTo(0.08955603314647384, 12);
    expect(g.expectedDuration.value).toBeCloseTo(36.566595028028914, 9);
    // Fair game: k/N and k(N−k).
    const fair = gamblersRuin(0.5, 3, 10);
    expect(fair.winProbability.value).toBeCloseTo(0.3, 15);
    expect(fair.ruinProbability.value).toBeCloseTo(0.7, 15);
    expect(fair.expectedDuration.value).toBe(21);
  });

  it('simulated ruin probability and duration match the closed forms', () => {
    // Biased case p = 0.45, k = 5, N = 15.
    const { value: biased, yields } = drain(
      gamblersRuinSimulationSteps(0.45, 5, 15, 40000, 'ruin-biased'),
    );
    expect(yields).toBeGreaterThan(1);
    expect(biased.unresolved).toBe(0);
    const exactWin = 0.08955603314647384;
    // SE of the frequency is sqrt(p(1−p)/n) = 0.00143; four SE = 0.0057.
    expect(Math.abs(biased.winFrequency - exactWin)).toBeLessThan(0.0057);
    expect(Math.abs(1 - biased.winFrequency - (1 - exactWin))).toBeLessThan(0.0057);
    expect(biased.winInterval.low).toBeLessThan(exactWin);
    expect(biased.winInterval.high).toBeGreaterThan(exactWin);
    // The duration has SD about 29 for these parameters (checked empirically
    // below), so the SE of the mean is 29/200 = 0.145 and four SE is 0.6.
    expect(biased.meanDuration).not.toBeNull();
    expect(Math.abs((biased.meanDuration as number) - 36.566595028028914)).toBeLessThan(0.8);

    // Fair case p = 0.5, k = 3, N = 10: win 0.3, duration 21.
    const { value: fair } = drain(gamblersRuinSimulationSteps(0.5, 3, 10, 40000, 'ruin-fair'));
    // SE of the frequency is sqrt(0.3·0.7/40000) = 0.0023; four SE = 0.0092.
    expect(Math.abs(fair.winFrequency - 0.3)).toBeLessThan(0.0092);
    // The duration SD for a fair walk with these barriers is about 19, so the
    // SE of the mean is 0.095 and four SE is 0.38; allow 0.6.
    expect(Math.abs((fair.meanDuration as number) - 21)).toBeLessThan(0.6);
  });

  it('reports walks that hit the step cap separately instead of guessing their outcome', () => {
    // From k = 3 with a 10-step cap, ruin happens often but the target 60 is
    // unreachable, so most walks are unresolved and a few are ruined.
    const { value } = drain(gamblersRuinSimulationSteps(0.5, 3, 60, 1000, 'ruin-cap', 10));
    expect(value.unresolved).toBeGreaterThan(500);
    expect(value.ruined).toBeGreaterThan(50);
    expect(value.reachedTarget).toBe(0);
    expect(value.warnings.join(' ')).toMatch(/step cap/);
  });

  it('exact moments of the walk and a simulated path agree', () => {
    const params = { p: 0.6, start: 0 };
    const m = randomWalkMoments(params, 100);
    expect(m.mean.value).toBeCloseTo(20, 12); // n(2p−1)
    expect(m.variance.value).toBeCloseTo(4 * 100 * 0.6 * 0.4, 12); // 96
    const n = 20000;
    const ens = runEnsemble((rng, times) => sampleRandomWalkPath(rng, params, times), [100], n, 'walk');
    const x = column(ens.paths, 0);
    // SE of the mean is sqrt(96/20000) = 0.069; four SE = 0.28.
    expect(Math.abs(avg(x) - 20)).toBeLessThan(0.28);
    // SE of the variance is roughly var·sqrt(2/n) = 0.96; four SE ≈ 3.9.
    expect(Math.abs(sampleVar(x) - 96)).toBeLessThan(3.9);
  });

  it('refuses degenerate and out-of-range ruin problems', () => {
    expect(() => gamblersRuin(1, 5, 15)).toThrow(/deterministic/);
    expect(() => gamblersRuin(0, 5, 15)).toThrow(/deterministic/);
    expect(() => gamblersRuin(0.5, 20, 15)).toThrow(/cannot exceed/);
    expect(() => gamblersRuin(0.5, 5, 1)).toThrow(/at least 2/);
    expect(() => sampleRandomWalkPath(new Random(new Xoshiro128('x')), { p: 0.5, start: 0 }, [0.5])).toThrow(
      /whole step counts/,
    );
  });
});

/* ====================================================================== *
 * AR(1)
 * ====================================================================== */

describe('AR(1)', () => {
  const p = { phi: 0.8, intercept: 0.4, noiseSd: 1, x0: 0 };

  it('exact stationary mean, variance and autocorrelation', () => {
    const s = ar1Stationary(p);
    expect(s.mean.value).toBeCloseTo(0.4 / 0.2, 15); // c/(1−φ) = 2
    // σ²/(1−φ²) = 1/0.36 = 2.7777…; 14 digits, since the two expressions
    // differ in the last bit of double precision.
    expect(s.variance.value).toBeCloseTo(1 / (1 - 0.64), 14);
    expect(s.sd.value).toBeCloseTo(Math.sqrt(1 / 0.36), 15);
    expect(s.autocorrelation(1).value).toBeCloseTo(0.8, 15);
    expect(s.autocorrelation(3).value).toBeCloseTo(0.512, 15);
    // Half-life: ln(0.5)/ln(0.8) = 3.106 periods.
    expect(s.halfLife.defined).toBe(true);
    if (s.halfLife.defined) expect(s.halfLife.value).toBeCloseTo(3.1062837195546, 10);
  });

  it('the k-step conditional law tends to the stationary law', () => {
    const c0 = ar1Conditional(p, 10, 0);
    expect(c0.mean).toBe(10);
    expect(c0.variance).toBe(0);
    const far = ar1Conditional(p, 10, 200);
    const s = ar1Stationary(p);
    expect(far.mean).toBeCloseTo(s.mean.value, 12);
    expect(far.variance).toBeCloseTo(s.variance.value, 12);
    // One step ahead: c + φx with variance σ².
    const one = ar1Conditional(p, 10, 1);
    expect(one.mean).toBeCloseTo(0.4 + 8, 15);
    expect(one.variance).toBeCloseTo(1, 15);
  });

  it('simulated stationary variance is σ²/(1−φ²) and autocorrelation is φ^k', () => {
    // Burn in to t = 120: φ^120 = 1.4e-12, so the start value is irrelevant.
    const n = 40000;
    const ens = runEnsemble((rng, times) => sampleAr1Path(rng, p, times), [120, 121, 123], n, 'ar1');
    const a = column(ens.paths, 0);
    const b = column(ens.paths, 1);
    const c = column(ens.paths, 2);
    const varStat = 1 / 0.36;
    // SE of the variance is var·sqrt(2/n) = 0.0196; four SE = 0.079.
    expect(Math.abs(sampleVar(a) - varStat)).toBeLessThan(0.079);
    expect(Math.abs(avg(a) - 2)).toBeLessThan(4 * Math.sqrt(varStat / n));
    // SE of a correlation is (1−ρ²)/√n: 0.0018 at ρ=0.8, 0.0037 at ρ=0.512.
    expect(Math.abs(corr(a, b) - 0.8)).toBeLessThan(0.008);
    expect(Math.abs(corr(a, c) - 0.512)).toBeLessThan(0.015);
  });

  it('drawing the start from the stationary law needs no burn-in', () => {
    const n = 40000;
    const ens = runEnsemble((rng, times) => sampleAr1Path(rng, p, times, true), [0, 1], n, 'ar1-stat');
    const a = column(ens.paths, 0);
    expect(Math.abs(sampleVar(a) - 1 / 0.36)).toBeLessThan(0.079);
    expect(Math.abs(corr(a, column(ens.paths, 1)) - 0.8)).toBeLessThan(0.008);
  });

  it('refuses |φ| ≥ 1 and explains that the process is non-stationary', () => {
    for (const phi of [1, -1, 1.2, -1.5]) {
      expect(() => ar1Stationary({ ...p, phi })).toThrow(EngineError);
      expect(() => ar1Stationary({ ...p, phi })).toThrow(/not stationary/);
      expect(() => ar1Conditional({ ...p, phi }, 0, 5)).toThrow(/not stationary/);
      expect(() => sampleAr1Path(new Random(new Xoshiro128('s')), { ...p, phi }, [1], true)).toThrow(
        /not stationary/,
      );
    }
    // A unit-root path can still be simulated when the stationary law is not
    // requested — it simply has no stationary distribution to report.
    expect(() => sampleAr1Path(new Random(new Xoshiro128('s')), { ...p, phi: 1 }, [10])).not.toThrow();
  });
});

/* ====================================================================== *
 * Branching process
 * ====================================================================== */

describe('Galton–Watson branching process', () => {
  /** Independent reference: smallest root of G(s) = s by bisection. */
  function extinctionByBisection(gf: (s: number) => number): number {
    let lo = 0;
    let hi = 1 - 1e-12;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (gf(mid) - mid > 0) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  it('supercritical extinction probability is the smallest fixed point of G', () => {
    const offspring = poissonOffspring(1.5);
    const r = extinctionProbability(offspring.gf, offspring.mean);
    expect(r.regime).toBe('supercritical');
    expect(r.exactness).toBe('numerical');
    // Independent bisection inside the test, and a Python reference for the
    // root of s = exp(1.5(s−1)): 0.41718835613418848
    expect(r.probability).toBeCloseTo(extinctionByBisection(offspring.gf), 10);
    expect(r.probability).toBeCloseTo(0.41718835613418848, 10);
    // It really is a fixed point.
    expect(offspring.gf(r.probability)).toBeCloseTo(r.probability, 12);
  });

  it('extinction is certain exactly when the mean offspring is at most 1', () => {
    const critical = poissonOffspring(1);
    const atOne = extinctionProbability(critical.gf, critical.mean);
    expect(atOne.probability).toBe(1);
    expect(atOne.regime).toBe('critical');
    expect(atOne.exactness).toBe('exact');
    const sub = poissonOffspring(0.6);
    const below = extinctionProbability(sub.gf, sub.mean);
    expect(below.probability).toBe(1);
    expect(below.regime).toBe('subcritical');
    // Just above 1 the extinction probability drops below 1 continuously.
    const above = poissonOffspring(1.05);
    const r = extinctionProbability(above.gf, above.mean, { tol: 1e-10 });
    expect(r.probability).toBeLessThan(1);
    expect(r.probability).toBeGreaterThan(0.9);
    expect(r.probability).toBeCloseTo(extinctionByBisection(above.gf), 6);
  });

  it('handles a pmf-specified offspring law and the degenerate X ≡ 1 case', () => {
    // p0 = 0.25, p1 = 0.25, p2 = 0.5 → mean 1.25, G(s) = 0.25 + 0.25s + 0.5s².
    // Fixed point: 0.5s² − 0.75s + 0.25 = 0 → s = 0.5 or 1, so q = 0.5 exactly.
    const { gf, mean } = offspringPmfGeneratingFunction([0.25, 0.25, 0.5]);
    expect(mean).toBeCloseTo(1.25, 15);
    expect(extinctionProbability(gf, mean).probability).toBeCloseTo(0.5, 9);
    // X ≡ 1: the population never changes, so extinction is impossible even
    // though the mean is exactly 1.
    const degenerate = offspringPmfGeneratingFunction([0, 1]);
    const d = extinctionProbability(degenerate.gf, degenerate.mean);
    expect(d.probability).toBe(0);
    expect(d.note).toMatch(/degenerate/);
  });

  it('simulated extinction frequency matches the analytic fixed point', () => {
    const offspring = poissonOffspring(1.5);
    const analytic = 0.41718835613418848;
    // The population cap of 500 keeps the run cheap: a supercritical line that
    // reaches 500 individuals has extinction probability q^500 < 1e-190, so
    // stopping there instead of at generation 40 costs nothing in accuracy.
    const { value, yields } = drain(
      branchingSimulationSteps((rng) => rng.poisson(1.5), 1, 40, 4000, 'branching', 500),
    );
    expect(yields).toBeGreaterThan(1);
    // SE of the frequency is sqrt(0.417·0.583/4000) = 0.0078; four SE = 0.031.
    expect(Math.abs(value.extinctionFrequency - analytic)).toBeLessThan(0.035);
    expect(value.extinctionInterval.low).toBeLessThan(analytic);
    expect(value.extinctionInterval.high).toBeGreaterThan(analytic);
    expect(value.warnings.join(' ')).toMatch(/LOWER bound/);
    expect(offspring.mean).toBe(1.5);
  });

  it('exact expected population size is z₀·mⁿ, including in the critical case', () => {
    expect(branchingExpectedSize(1, 1.5, 10).value).toBeCloseTo(Math.pow(1.5, 10), 10);
    expect(branchingExpectedSize(5, 1, 1000).value).toBe(5);
    expect(branchingExpectedSize(5, 1, 1000).note).toMatch(/critical/);
  });

  it('refuses a non-convergent iteration and an invalid generating function', () => {
    const offspring = poissonOffspring(1.5);
    expect(() => extinctionProbability(offspring.gf, offspring.mean, { maxIter: 3 })).toThrow(
      /did not converge/,
    );
    expect(() => extinctionProbability(() => 2, 2)).toThrow(/\[0, ?1\]/);
    expect(() => offspringPmfGeneratingFunction([0.5, 0.2])).toThrow(/not 1/);
    expect(() => poissonOffspring(-1)).toThrow(/0 or greater/);
  });
});

/* ====================================================================== *
 * Continuous-time Markov chains
 * ====================================================================== */

describe('continuous-time Markov chain', () => {
  // A three-state chain: 0 ⇄ 1 ⇄ 2.
  const Q: Matrix = [
    [-1, 1, 0],
    [2, -3, 1],
    [0, 1.5, -1.5],
  ];

  it('validates the generator and names the offending row', () => {
    expect(() => validateGenerator(Q)).not.toThrow();
    expect(() =>
      validateGenerator([
        [-1, 1, 0],
        [2, -2.5, 1],
        [0, 1.5, -1.5],
      ]),
    ).toThrow(/Row 2 .* sums to/);
    expect(() =>
      validateGenerator([
        [-1, 1],
        [-2, 2],
      ]),
    ).toThrow(/cannot be negative/);
    expect(() =>
      validateGenerator([
        [1, -1],
        [1, -1],
      ]),
    ).toThrow(/cannot be positive/);
    expect(() =>
      validateGenerator([
        [-1, 1, 0],
        [0, 0],
        [0, 0, 0],
      ]),
    ).toThrow(/Row 2 .* must have 3/);
  });

  it('matrix exponential at small t matches the series I + Qt + (Qt)²/2 + …', () => {
    const t = 1e-3;
    const A = Q.map((row) => row.map((v) => v * t));
    const P = matrixExponential(A);
    // Independent truncated series, built here with plain loops.
    function seriesExp(M: Matrix, terms: number): Matrix {
      const n = M.length;
      let term: Matrix = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
      const acc = term.map((r) => [...r]);
      for (let k = 1; k <= terms; k++) {
        const next: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            let s = 0;
            for (let l = 0; l < n; l++) s += term[i][l] * M[l][j];
            next[i][j] = s / k;
          }
        }
        term = next;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) acc[i][j] += term[i][j];
      }
      return acc;
    }
    // Three terms: ‖Qt‖ = 0.005, so the first omitted term is of size
    // 0.005³/6 ≈ 2e-8. Agreement to 1e-7 therefore pins down I + Qt + (Qt)²/2.
    const three = seriesExp(A, 2);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) expect(P[i][j]).toBeCloseTo(three[i][j], 7);
    }
    // Eight terms is converged to machine precision.
    const eight = seriesExp(A, 8);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) expect(P[i][j]).toBeCloseTo(eight[i][j], 15);
    }
  });

  it('P(t) is a stochastic matrix and satisfies the Chapman–Kolmogorov identity', () => {
    const p1 = ctmcTransient(Q, 0.7);
    expect(p1.exactness).toBe('numerical');
    expect(p1.rowSumError).toBeLessThan(1e-12);
    const p2 = ctmcTransient(Q, 1.4).matrix;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        let s = 0;
        for (let l = 0; l < 3; l++) s += p1.matrix[i][l] * p1.matrix[l][j];
        expect(s).toBeCloseTo(p2[i][j], 12);
      }
    }
    expect(ctmcTransient(Q, 0).matrix[1][1]).toBeCloseTo(1, 15);
    // An initial distribution propagates to the right marginal.
    const dist = ctmcTransient(Q, 0.7, [1, 0, 0]).distribution as number[];
    expect(dist[0]).toBeCloseTo(p1.matrix[0][0], 12);
    expect(dist.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(() => ctmcTransient(Q, 1, [0.5, 0.2, 0.1])).toThrow(/not 1/);
  });

  it('the two-state chain matches its closed-form P(t)', () => {
    const alpha = 0.7;
    const beta = 1.3;
    const twoState: Matrix = [
      [-alpha, alpha],
      [beta, -beta],
    ];
    for (const t of [0.1, 1, 5]) {
      const exact = twoStateTransition(alpha, beta, t);
      expect(exact.exactness).toBe('exact');
      const numeric = ctmcTransient(twoState, t).matrix;
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) expect(numeric[i][j]).toBeCloseTo(exact.matrix[i][j], 13);
      }
      // Closed form, written out independently here:
      // P_00(t) = (β + αe^{−(α+β)t})/(α+β).
      const e = Math.exp(-(alpha + beta) * t);
      expect(exact.matrix[0][0]).toBeCloseTo((beta + alpha * e) / (alpha + beta), 15);
    }
    // Stationary distribution of the two-state chain is (β, α)/(α+β).
    const stat = ctmcStationary(twoState).distribution;
    expect(stat[0]).toBeCloseTo(beta / (alpha + beta), 14);
    expect(stat[1]).toBeCloseTo(alpha / (alpha + beta), 14);
  });

  it('stationary distribution satisfies πQ = 0 to 1e-12 and matches P(t) for large t', () => {
    const s = ctmcStationary(Q);
    expect(s.residual).toBeLessThan(1e-12);
    for (let j = 0; j < 3; j++) {
      let acc = 0;
      for (let i = 0; i < 3; i++) acc += s.distribution[i] * Q[i][j];
      expect(Math.abs(acc)).toBeLessThan(1e-12);
    }
    expect(s.distribution.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 14);
    // Every row of P(t) converges to π for large t.
    const far = ctmcTransient(Q, 60).matrix;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) expect(far[i][j]).toBeCloseTo(s.distribution[j], 10);
    }
  });

  it('refuses a reducible chain rather than returning one of many solutions', () => {
    // Two closed classes {0,1} and {2,3}.
    const reducible: Matrix = [
      [-1, 1, 0, 0],
      [1, -1, 0, 0],
      [0, 0, -2, 2],
      [0, 0, 3, -3],
    ];
    expect(() => ctmcStationary(reducible)).toThrow(EngineError);
    expect(() => ctmcStationary(reducible)).toThrow(/reducible/);
  });

  it('expected hitting times match an independent calculation', () => {
    // A pure forward chain 0 → 1 → 2: the hitting time of state 2 from 0 is
    // the sum of two independent exponential holding times, so its mean is
    // 1/1 + 1/2 = 1.5 by elementary reasoning, with no linear algebra.
    const forward: Matrix = [
      [-1, 1, 0],
      [0, -2, 2],
      [0, 0, 0],
    ];
    const h = ctmcHittingTimes(forward, [2]);
    expect(h.expected[0]).toBeCloseTo(1.5, 12);
    expect(h.expected[1]).toBeCloseTo(0.5, 12);
    expect(h.expected[2]).toBe(0);
    expect(h.exactness).toBe('numerical');

    // Reversible chain: check against Gillespie simulation.
    const target = ctmcHittingTimes(Q, [2]);
    const rng = new Random(new Xoshiro128('hitting'));
    const samples: number[] = [];
    for (let i = 0; i < 5000; i++) {
      const jumps = sampleCtmcTrajectory(rng, Q, 0, 60);
      const hit = jumps.find((j) => j.state === 2);
      if (hit) samples.push(hit.time);
    }
    // The mean hitting time is about 2.2, so by t = 60 every trajectory has
    // hit state 2 (the chance of not having done so is below 1e-10).
    expect(samples.length).toBe(5000);
    // The hitting time is close to exponential, so its SD is of the order of
    // its mean; the SE of the mean is then ≈ 0.031 and four SE ≈ 0.13.
    expect(Math.abs(avg(samples) - target.expected[0])).toBeLessThan(0.15);
  });

  it('refuses an unreachable target instead of reporting a finite time', () => {
    const absorbing: Matrix = [
      [-1, 1, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    expect(() => ctmcHittingTimes(absorbing, [2])).toThrow(EngineError);
    expect(() => ctmcHittingTimes(Q, [])).toThrow(/At least one target/);
    expect(() => ctmcHittingTimes(Q, [7])).toThrow(/between 0 and 2/);
  });

  it('exact holding time and embedded jump probabilities', () => {
    const s = ctmcStateSummary(Q, 1);
    expect(s.holdingRate.value).toBe(3);
    expect(s.meanHoldingTime.value).toBeCloseTo(1 / 3, 15);
    expect(s.jumpProbabilities).toEqual([2 / 3, 0, 1 / 3]);
    expect(() =>
      ctmcStateSummary(
        [
          [-1, 1],
          [0, 0],
        ],
        1,
      ),
    ).toThrow(/absorbing/);
  });

  it("Gillespie occupancy matches the stationary distribution", () => {
    // Chunk size 10 so the generator yields several times during the run.
    const { value, yields } = drain(ctmcGillespieSteps(Q, 0, 4000, 40, 'gillespie', {}, 10));
    expect(yields).toBeGreaterThan(1);
    expect(value.exactness).toBe('empirical');
    const stat = ctmcStationary(Q).distribution;
    // Total simulated time is 160,000 and the slowest relaxation time of this
    // generator is about 0.3, giving roughly 500,000 effectively independent
    // samples' worth; occupancy fractions should be within a few 1e-3.
    expect(value.stationaryComparison).toBeDefined();
    expect(value.stationaryComparison?.maxAbsoluteDifference).toBeLessThan(0.01);
    for (let i = 0; i < 3; i++) expect(Math.abs(value.occupancy[i] - stat[i])).toBeLessThan(0.01);
    expect(value.occupancy.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('a trajectory has exponential holding times with the right mean', () => {
    const rng = new Random(new Xoshiro128('holding'));
    const jumps = sampleCtmcTrajectory(rng, Q, 1, 20000);
    const holds: number[] = [];
    for (let i = 0; i + 1 < jumps.length; i++) {
      if (jumps[i].state === 1) holds.push(jumps[i + 1].time - jumps[i].time);
    }
    // Mean holding time in state 1 is 1/3. With n ≈ 10,000 holds the SE is
    // (1/3)/√n ≈ 0.0033; four SE ≈ 0.014.
    expect(holds.length).toBeGreaterThan(5000);
    expect(Math.abs(avg(holds) - 1 / 3)).toBeLessThan(0.014);
    // Occupancy of a single long trajectory also matches π.
    const occ = occupancyTimes(jumps, 3, 20000);
    const total = occ.reduce((a, b) => a + b, 0);
    const stat = ctmcStationary(Q).distribution;
    for (let i = 0; i < 3; i++) expect(Math.abs(occ[i] / total - stat[i])).toBeLessThan(0.02);
  });

  it('an absorbing state ends the trajectory without error', () => {
    const rng = new Random(new Xoshiro128('absorb'));
    const jumps = sampleCtmcTrajectory(
      rng,
      [
        [-1, 1],
        [0, 0],
      ],
      0,
      1e6,
    );
    expect(jumps[jumps.length - 1].state).toBe(1);
    expect(jumps.length).toBe(2);
  });

  it('refuses a matrix exponential of a non-square or non-finite matrix', () => {
    expect(() => matrixExponential([[1, 2], [3]])).toThrow(/square/);
    expect(() => matrixExponential([[NaN]])).toThrow(/non-finite/);
  });
});

/* ====================================================================== *
 * Ensembles, fan charts and generators
 * ====================================================================== */

describe('path ensembles', () => {
  const p = { x0: 0, drift: 0.2, volatility: 1 };
  const times = [1, 2, 3, 4, 5];

  it('separates a confidence band for the mean path from a band containing paths', () => {
    const ens = runEnsemble((rng, grid) => sampleBrownianPath(rng, p, grid), times, 4000, 'fan');
    const fan = fanChart(ens, 0.9);
    expect(fan.exactness).toBe('empirical');
    expect(fan.meanBand.meaning).toMatch(/MEAN/);
    expect(fan.pathBand.meaning).toMatch(/PATHS/);
    expect(fan.meanBand.meaning).not.toBe(fan.pathBand.meaning);
    for (let j = 0; j < times.length; j++) {
      // The mean path follows μt.
      expect(Math.abs(fan.meanPath[j] - 0.2 * times[j])).toBeLessThan(4 * Math.sqrt(times[j] / 4000));
      // The band for the mean is narrower than the band for the paths by a
      // factor of about √n = 63 — that is the whole distinction.
      const meanWidth = fan.meanBand.high[j] - fan.meanBand.low[j];
      const pathWidth = fan.pathBand.high[j] - fan.pathBand.low[j];
      expect(pathWidth / meanWidth).toBeGreaterThan(30);
      // The 90% path band of a Normal(μt, t) is μt ± 1.6449√t.
      expect(Math.abs(pathWidth - 2 * 1.6449 * Math.sqrt(times[j]))).toBeLessThan(0.25 * Math.sqrt(times[j]));
    }
    // About 90% of path values at a given time lie inside the path band.
    const inside =
      column(ens.paths, 2).filter((x) => x >= fan.pathBand.low[2] && x <= fan.pathBand.high[2]).length / 4000;
    expect(Math.abs(inside - 0.9)).toBeLessThan(0.01);
  });

  it('refuses a fan chart from fewer than two paths and an invalid grid', () => {
    const one = runEnsemble((rng, grid) => sampleBrownianPath(rng, p, grid), times, 1, 'one');
    expect(() => fanChart(one)).toThrow(/at least 2/i);
    expect(() => runEnsemble((_r, grid) => grid.map(() => 0), [1, 1], 10, 's')).toThrow(/strictly increasing/);
    expect(() => runEnsemble((_r, grid) => grid.map(() => 0), [-1], 10, 's')).toThrow(/0 or later/);
    expect(() => runEnsemble(() => [1, 2], [1], 10, 's')).toThrow(/returned 2 values/);
    expect(() => runEnsemble((_r, grid) => grid.map(() => 0), [1], 0, 's')).toThrow(/at least 1/);
    expect(() => runEnsemble((_r, grid) => grid.map(() => 0), [1], 10, '')).toThrow(/seed is required/);
  });

  it('the generator yields more than once and a cancelled run is marked partial', () => {
    let completed = 0;
    const progress: number[] = [];
    const gen = ensembleSteps(
      (rng, grid) => sampleBrownianPath(rng, p, grid),
      times,
      1000,
      'cancel',
      {
        onProgress: (prog) => progress.push(prog.completed),
        isCancelled: () => completed >= 400,
      },
      100,
    );
    let yields = 0;
    let next = gen.next();
    while (!next.done) {
      yields++;
      completed = next.value;
      next = gen.next();
    }
    expect(yields).toBeGreaterThan(1);
    expect(progress.length).toBe(yields);
    const result = next.value;
    expect(result.partial).toBe(true);
    expect(result.pathsCompleted).toBe(400);
    expect(result.pathsRequested).toBe(1000);
    expect(result.paths.length).toBe(400);
    // A partial ensemble still yields statistics, clearly marked as partial.
    const fan = fanChart(result, 0.9);
    expect(fan.partial).toBe(true);
    expect(fan.warnings.join(' ')).toMatch(/stopped early/);
    const fp = firstPassageFromEnsemble(result, 2);
    expect(fp.warnings.join(' ')).toMatch(/Partial run/);
  });

  it('a completed run is not marked partial', () => {
    const ens = runEnsemble((rng, grid) => sampleBrownianPath(rng, p, grid), times, 300, 'full', 100);
    expect(ens.partial).toBe(false);
    expect(ens.pathsCompleted).toBe(300);
    expect(fanChart(ens).warnings.join(' ')).not.toMatch(/stopped early/);
  });

  it('is deterministic: the same seed gives the same paths', () => {
    const a = runEnsemble((rng, grid) => sampleBrownianPath(rng, p, grid), times, 50, 'seed-A');
    const b = runEnsemble((rng, grid) => sampleBrownianPath(rng, p, grid), times, 50, 'seed-A');
    const c = runEnsemble((rng, grid) => sampleBrownianPath(rng, p, grid), times, 50, 'seed-B');
    expect(b.paths).toEqual(a.paths);
    expect(c.paths).not.toEqual(a.paths);
    // Chunk size must not change the stream.
    const d = runEnsemble((rng, grid) => sampleBrownianPath(rng, p, grid), times, 50, 'seed-A', 7);
    expect(d.paths).toEqual(a.paths);
    // Every process sampler is deterministic under a fixed seed.
    const gbm1 = runEnsemble((rng, grid) => sampleGbmPath(rng, { s0: 10, drift: 0.1, volatility: 0.3 }, grid), times, 20, 'g');
    const gbm2 = runEnsemble((rng, grid) => sampleGbmPath(rng, { s0: 10, drift: 0.1, volatility: 0.3 }, grid), times, 20, 'g');
    expect(gbm2.paths).toEqual(gbm1.paths);
    const r1 = drain(gamblersRuinSimulationSteps(0.48, 4, 12, 200, 'det'));
    const r2 = drain(gamblersRuinSimulationSteps(0.48, 4, 12, 200, 'det'));
    expect(r2.value).toEqual(r1.value);
  });

  it('first-passage below a level works the same way', () => {
    const ens = runEnsemble(
      (rng, grid) => sampleBrownianPath(rng, { x0: 0, drift: 0, volatility: 1 }, grid),
      Array.from({ length: 400 }, (_, i) => (4 * (i + 1)) / 400),
      8000,
      'fp-below',
    );
    const below = firstPassageFromEnsemble(ens, -2, 'below');
    // By symmetry this is the same 0.3173 as the upward crossing, minus the
    // discrete-monitoring bias (larger here with only 400 steps: the level
    // bias is 0.5826·√0.01 = 0.058, worth about 0.014 of probability).
    expect(below.probability).toBeGreaterThan(0.27);
    expect(below.probability).toBeLessThan(0.3173 + 0.015);
    expect(below.direction).toBe('below');
  });
});
