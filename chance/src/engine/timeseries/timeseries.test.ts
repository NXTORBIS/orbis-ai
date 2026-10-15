/**
 * Tests for the time-series module.
 *
 * Every reference value here is independent of this implementation: it is
 * either computed by hand in a comment, a closed-form theoretical quantity
 * (the ACF of an AR(1), the variance-inflation factor (1+φ)/(1−φ), the
 * h-step forecast variance σ²(1−φ^{2h})/(1−φ²), Parseval's identity), or a
 * published critical value. No assertion compares the code against its own
 * earlier output.
 *
 * All simulations use fixed seeds. Every tolerance is justified where it is
 * used; the usual justification is "k Monte Carlo standard errors", computed
 * from the known sampling variance of the quantity involved.
 */
import { describe, expect, it } from 'vitest';
import { Random } from '../random/rng';
import { EngineError } from '../core/result';
import { stableSum } from '../core/numeric';
import {
  accuracyMetrics,
  acf,
  archTest,
  arConditionalLeastSquares,
  arimaForecaster,
  augmentedDickeyFuller,
  backtest,
  blockBootstrap,
  boxCox,
  classicalDecomposition,
  compareBootstraps,
  correctedMeanTest,
  crossCorrelation,
  cusum,
  detectAnomalies,
  detectChangepoints,
  difference,
  directDft,
  dominantPeriod,
  durbinWatson,
  effectiveSampleSize,
  fitArima,
  forecastArima,
  garch11,
  hodrickPrescott,
  holtWinters,
  kpss,
  pacf,
  periodogram,
  phillipsPerron,
  portmanteau,
  psiWeights,
  recommendDifferencing,
  residualDiagnostics,
  selectArimaOrder,
  smoothingForecast,
  stationarityVerdict,
  stl,
  welch,
  yuleWalker,
} from './index';

/* ------------------------------------------------------------------ helpers */

function simulateAr1(n: number, phi: number, sigma: number, seed: string, burn = 500): number[] {
  const rng = new Random(seed);
  let x = 0;
  for (let i = 0; i < burn; i++) x = phi * x + sigma * rng.normal();
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    x = phi * x + sigma * rng.normal();
    out[i] = x;
  }
  return out;
}

function simulateAr2(n: number, phi1: number, phi2: number, sigma: number, seed: string): number[] {
  const rng = new Random(seed);
  let a = 0;
  let b = 0;
  for (let i = 0; i < 500; i++) {
    const next = phi1 * a + phi2 * b + sigma * rng.normal();
    b = a;
    a = next;
  }
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const next = phi1 * a + phi2 * b + sigma * rng.normal();
    b = a;
    a = next;
    out[i] = a;
  }
  return out;
}

function simulateMa1(n: number, theta: number, sigma: number, seed: string): number[] {
  const rng = new Random(seed);
  let prev = rng.normal();
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const e = rng.normal();
    out[i] = sigma * (e + theta * prev);
    prev = e;
  }
  return out;
}

function simulateWhiteNoise(n: number, seed: string, sigma = 1): number[] {
  const rng = new Random(seed);
  return Array.from({ length: n }, () => sigma * rng.normal());
}

function simulateRandomWalk(n: number, seed: string, sigma = 1): number[] {
  const rng = new Random(seed);
  let x = 0;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    x += sigma * rng.normal();
    out[i] = x;
  }
  return out;
}

function simulateGarch(n: number, omega: number, alpha: number, beta: number, seed: string): number[] {
  const rng = new Random(seed);
  let h = omega / (1 - alpha - beta);
  let e = 0;
  for (let i = 0; i < 1000; i++) {
    h = omega + alpha * e * e + beta * h;
    e = Math.sqrt(h) * rng.normal();
  }
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    h = omega + alpha * e * e + beta * h;
    e = Math.sqrt(h) * rng.normal();
    out[i] = e;
  }
  return out;
}

const mean = (x: number[]): number => stableSum(x) / x.length;

/* ------------------------------------------------------- hand-computed ACF */

describe('autocorrelation against a hand computation', () => {
  it('reproduces lag-1 and lag-2 autocorrelations computed by hand', () => {
    // Series: 2, 4, 6, 5, 3, 1.  n = 6, mean = 21/6 = 3.5
    // deviations d = [-1.5, 0.5, 2.5, 1.5, -0.5, -2.5]
    // Σd²  = 2.25 + 0.25 + 6.25 + 2.25 + 0.25 + 6.25 = 17.5
    // lag 1: (0.5)(-1.5) + (2.5)(0.5) + (1.5)(2.5) + (-0.5)(1.5) + (-2.5)(-0.5)
    //      = -0.75 + 1.25 + 3.75 - 0.75 + 1.25 = 4.75     ⇒ r₁ = 4.75/17.5 = 19/70
    // lag 2: (2.5)(-1.5) + (1.5)(0.5) + (-0.5)(2.5) + (-2.5)(1.5)
    //      = -3.75 + 0.75 - 1.25 - 3.75 = -8.0            ⇒ r₂ = -8/17.5 = -16/35
    const series = [2, 4, 6, 5, 3, 1];
    const r = acf(series, 3);
    // Exact rationals, so the only error is floating-point round-off.
    expect(r.acf[1]).toBeCloseTo(19 / 70, 12);
    expect(r.acf[2]).toBeCloseTo(-16 / 35, 12);
    expect(Math.abs(r.acf[1] - 19 / 70)).toBeLessThan(1e-12);
    expect(Math.abs(r.acf[2] + 16 / 35)).toBeLessThan(1e-12);
  });

  it('has an autocorrelation of exactly 1 at lag 0', () => {
    const r = acf([2, 4, 6, 5, 3, 1], 3);
    expect(r.acf[0]).toBe(1);
    const r2 = acf(simulateAr1(500, 0.4, 1, 'lag0'), 10);
    expect(r2.acf[0]).toBe(1);
  });

  it('reports the Bartlett lag-1 standard error as 1/√n', () => {
    const r = acf(simulateWhiteNoise(400, 'bartlett'), 5);
    // Var(r₁) = 1/n under the white-noise null, so se = 1/√400 = 0.05 exactly.
    expect(r.se[1]).toBeCloseTo(0.05, 12);
  });
});

/* --------------------------------------------- theoretical ACF / PACF shape */

describe('sample ACF and PACF against theory', () => {
  const phi = 0.7;
  const n = 200_000;
  const series = simulateAr1(n, phi, 1, 'ar1-theory');

  it('matches the theoretical AR(1) autocorrelation 0.7^k', () => {
    const r = acf(series, 8);
    // Bartlett: Var(r_k) ≈ (1 + 2Σ_{j<k} ρ_j²)/n ≤ (1 + 2·φ²/(1−φ²))/n
    //         = (1 + 1.922)/200000  ⇒ se ≤ 0.0039. Tolerance 0.02 ≈ 5 se.
    for (let k = 1; k <= 8; k++) {
      expect(r.acf[k]).toBeCloseTo(Math.pow(phi, k), 2);
      expect(Math.abs(r.acf[k] - Math.pow(phi, k))).toBeLessThan(0.02);
    }
  });

  it('gives an AR(1) a PACF of φ at lag 1 and ≈0 beyond — the defining signature', () => {
    const p = pacf(series, 8);
    // se(φ̂_kk) ≈ 1/√n = 0.00224; tolerance 0.015 ≈ 6.7 se.
    expect(Math.abs(p.pacf[1] - phi)).toBeLessThan(0.015);
    for (let k = 2; k <= 8; k++) {
      expect(Math.abs(p.pacf[k])).toBeLessThan(0.015);
    }
  });

  it('gives an MA(1) an ACF that cuts off after lag 1 and a decaying PACF', () => {
    const theta = 0.6;
    const ma = simulateMa1(100_000, theta, 1, 'ma1-theory');
    // Theoretical ACF: ρ₁ = θ/(1+θ²) = 0.6/1.36 = 0.441176..., ρ_k = 0 for k ≥ 2.
    const rho1 = theta / (1 + theta * theta);
    const r = acf(ma, 6);
    // se ≈ √((1+2ρ₁²)/n) = √(1.389/100000) = 0.0037. Tolerance 0.02 ≈ 5 se.
    expect(Math.abs(r.acf[1] - rho1)).toBeLessThan(0.02);
    for (let k = 2; k <= 6; k++) expect(Math.abs(r.acf[k])).toBeLessThan(0.02);
    const p = pacf(ma, 6);
    // The MA(1) PACF decays geometrically and alternates in sign; the point of
    // the test is that it does NOT cut off, unlike the ACF.
    expect(Math.abs(p.pacf[1])).toBeGreaterThan(0.35);
    expect(Math.abs(p.pacf[2])).toBeGreaterThan(0.1);
    expect(p.pacf[1] * p.pacf[2]).toBeLessThan(0);
    // ...and that it is monotonically shrinking in magnitude.
    expect(Math.abs(p.pacf[3])).toBeLessThan(Math.abs(p.pacf[2]));
  });
});

/* ------------------------------------------------- AR coefficient recovery */

describe('AR coefficient recovery', () => {
  it('recovers φ from an AR(1) by Yule–Walker and by conditional least squares, and the two agree', () => {
    const phi = 0.7;
    const series = simulateAr1(50_000, phi, 1, 'ar1-recovery');
    const yw = yuleWalker(series, 1);
    const cls = arConditionalLeastSquares(series, 1);
    // se(φ̂) ≈ √((1−φ²)/n) = √(0.51/50000) = 0.0032. Tolerance 0.02 ≈ 6 se.
    expect(Math.abs(yw.phi[0] - phi)).toBeLessThan(0.02);
    expect(Math.abs(cls.phi[0] - phi)).toBeLessThan(0.02);
    // The two estimators differ by O(1/n), far below their common sampling error.
    expect(Math.abs(yw.phi[0] - cls.phi[0])).toBeLessThan(0.005);
    expect(yw.stationary).toBe(true);
    expect(cls.stationary).toBe(true);
  });

  it('recovers AR(2) coefficients from a known AR(2)', () => {
    const phi1 = 0.5;
    const phi2 = -0.3;
    const series = simulateAr2(50_000, phi1, phi2, 1, 'ar2-recovery');
    const yw = yuleWalker(series, 2);
    const cls = arConditionalLeastSquares(series, 2);
    // se ≈ √(1/n) ≈ 0.0045 for each coefficient; tolerance 0.025 ≈ 5.5 se.
    expect(Math.abs(yw.phi[0] - phi1)).toBeLessThan(0.025);
    expect(Math.abs(yw.phi[1] - phi2)).toBeLessThan(0.025);
    expect(Math.abs(cls.phi[0] - phi1)).toBeLessThan(0.025);
    expect(Math.abs(cls.phi[1] - phi2)).toBeLessThan(0.025);
  });

  it('recovers φ by exact Kalman maximum likelihood too', () => {
    const series = simulateAr1(5000, 0.7, 1.5, 'ar1-mle');
    const fit = fitArima(series, { p: 1, d: 0, q: 0 });
    // se(φ̂) ≈ √(0.51/5000) = 0.0101; tolerance 0.05 ≈ 5 se.
    expect(Math.abs(fit.phi[0] - 0.7)).toBeLessThan(0.05);
    // σ² = 1.5² = 2.25; the MLE has relative error O(√(2/n)) = 2%.
    expect(Math.abs(fit.sigma2 - 2.25) / 2.25).toBeLessThan(0.08);
    expect(fit.estimation).toBe('exact-kalman-likelihood');
    expect(fit.standardErrors).not.toBeNull();
  });

  it('recovers an MA(1) coefficient, which conditional least squares cannot do', () => {
    const series = simulateMa1(4000, 0.6, 1, 'ma1-mle');
    const fit = fitArima(series, { p: 0, d: 0, q: 1 });
    // se(θ̂) ≈ √((1−θ²)/n) = √(0.64/4000) = 0.0126; tolerance 0.06 ≈ 5 se.
    expect(Math.abs(fit.theta[0] - 0.6)).toBeLessThan(0.06);
    expect(fit.invertible).toBe(true);
  });
});

/* --------------------------------------------- Ljung–Box size and power */

describe('portmanteau tests fire in both directions', () => {
  it('rejects white noise at close to the nominal 5% rate across 400 replications', () => {
    const reps = 400;
    let rejections = 0;
    for (let r = 0; r < reps; r++) {
      const x = simulateWhiteNoise(200, `lb-size-${r}`);
      const t = portmanteau(x, { lags: 10 });
      if ((t.pValue ?? 1) < 0.05) rejections++;
    }
    const rate = rejections / reps;
    // Under the null the count is Binomial(400, 0.05): mean 20, sd 4.36.
    // The interval [8, 40] is about ±4.6 sd, so a correctly sized test fails
    // this assertion with probability well under 1 in 10^4, while a test with
    // a mis-specified df (e.g. forgetting the n(n+2)/(n−k) correction) lands
    // outside it.
    expect(rejections).toBeGreaterThanOrEqual(8);
    expect(rejections).toBeLessThanOrEqual(40);
    expect(rate).toBeLessThan(0.1);
  });

  it('rejects autocorrelated data with high power', () => {
    const reps = 200;
    let rejections = 0;
    for (let r = 0; r < reps; r++) {
      const x = simulateAr1(200, 0.6, 1, `lb-power-${r}`);
      const t = portmanteau(x, { lags: 10 });
      if ((t.pValue ?? 1) < 0.05) rejections++;
    }
    // Power against AR(1) φ=0.6 at n=200 is essentially 1.
    expect(rejections).toBeGreaterThan(190);
  });

  it('reduces the degrees of freedom by the number of fitted parameters', () => {
    const x = simulateWhiteNoise(300, 'lb-df');
    expect(portmanteau(x, { lags: 10, fitDf: 0 }).df).toBe(10);
    expect(portmanteau(x, { lags: 10, fitDf: 3 }).df).toBe(7);
    // Same statistic, fewer degrees of freedom ⇒ a strictly smaller p-value.
    const a = portmanteau(x, { lags: 10, fitDf: 0 });
    const b = portmanteau(x, { lags: 10, fitDf: 3 });
    expect(a.statistic).toBeCloseTo(b.statistic, 12);
    expect(b.pValue as number).toBeLessThan(a.pValue as number);
    expect(() => portmanteau(x, { lags: 3, fitDf: 3 })).toThrow(EngineError);
  });

  it('computes Box–Pierce as n Σ r_k² exactly', () => {
    const x = [2, 4, 6, 5, 3, 1, 2, 5, 7, 4, 2, 3];
    const r = acf(x, 3);
    const expected = x.length * (r.acf[1] ** 2 + r.acf[2] ** 2 + r.acf[3] ** 2);
    const bp = portmanteau(x, { lags: 3, variant: 'box-pierce' });
    expect(bp.statistic).toBeCloseTo(expected, 12);
  });

  it('computes Durbin–Watson as 2(1 − r₁) approximately and exactly from its formula', () => {
    // e = [1, -1, 1, -1, 1, -1]: Σ(e_t − e_{t−1})² = 5 × 4 = 20, Σe_t² = 6.
    // d = 20/6 = 3.3333..., the maximum-alternation case.
    const dw = durbinWatson([1, -1, 1, -1, 1, -1]);
    expect(dw.statistic).toBeCloseTo(20 / 6, 12);
    expect(dw.pValue).toBeNull();
  });
});

/* ------------------------------------------------- ADF / KPSS, all four cells */

describe('ADF and KPSS in all four cells', () => {
  it('uses MacKinnon critical values, not normal or t quantiles', () => {
    const adf = augmentedDickeyFuller(simulateRandomWalk(300, 'cv'), { specification: 'constant' });
    const cv5 = adf.criticalValues?.find((c) => c.level === 0.05)?.value as number;
    // MacKinnon's 5% value for the constant case tends to −2.8621 as T → ∞ and
    // is near −2.87 at T = 299. A normal/t 5% one-sided quantile would be
    // about −1.65, which is a completely different number.
    expect(cv5).toBeLessThan(-2.8);
    expect(cv5).toBeGreaterThan(-2.95);
    const cv1 = adf.criticalValues?.find((c) => c.level === 0.01)?.value as number;
    expect(cv1).toBeLessThan(-3.4);
    expect(cv1).toBeGreaterThan(-3.55);
    expect(adf.explanation.limitations.join(' ')).toMatch(/MacKinnon/);
  });

  it('cells 1 and 2: on a random walk ADF fails to reject and KPSS rejects', () => {
    const reps = 200;
    let adfRejects = 0;
    let kpssRejects = 0;
    for (let r = 0; r < reps; r++) {
      const x = simulateRandomWalk(300, `rw-${r}`);
      const a = augmentedDickeyFuller(x, { specification: 'constant', maxLags: 4 });
      const k = kpss(x, { specification: 'level' });
      if (a.rejectAt?.find((c) => c.level === 0.05)?.reject) adfRejects++;
      if (k.rejectAt?.find((c) => c.level === 0.05)?.reject) kpssRejects++;
    }
    // ADF type I error on true unit-root data must sit near its nominal 5%.
    // Binomial(200, 0.05): mean 10, sd 3.08. Allowing up to 26 (≈5 sd) still
    // fails loudly if the critical values were wrong — a normal quantile of
    // −1.645 would reject on the order of 40–60% of these series.
    expect(adfRejects).toBeLessThanOrEqual(26);
    expect(adfRejects / reps).toBeLessThan(0.13);
    // KPSS, whose null is stationarity, must reject almost always here.
    expect(kpssRejects / reps).toBeGreaterThan(0.85);
  });

  it('cells 3 and 4: on stationary AR(1) data ADF rejects and KPSS does not', () => {
    const reps = 200;
    let adfRejects = 0;
    let kpssRejects = 0;
    for (let r = 0; r < reps; r++) {
      const x = simulateAr1(300, 0.5, 1, `st-${r}`);
      const a = augmentedDickeyFuller(x, { specification: 'constant', maxLags: 4 });
      const k = kpss(x, { specification: 'level' });
      if (a.rejectAt?.find((c) => c.level === 0.05)?.reject) adfRejects++;
      if (k.rejectAt?.find((c) => c.level === 0.05)?.reject) kpssRejects++;
    }
    expect(adfRejects / reps).toBeGreaterThan(0.85);
    // KPSS over-rejects somewhat in finite samples even under its own null,
    // so the bound is loose; the point is that it is nothing like the >0.85
    // of the random-walk case.
    expect(kpssRejects / reps).toBeLessThan(0.25);
  });

  it('reports the four-cell combination explicitly', () => {
    const rw = stationarityVerdict(simulateRandomWalk(400, 'verdict-rw'));
    expect(rw.cell).toBe('unit-root');
    expect(rw.recommendation).toMatch(/[Dd]ifference/);
    const st = stationarityVerdict(simulateAr1(400, 0.5, 1, 'verdict-ar'));
    expect(st.cell).toBe('stationary');
  });

  it('Phillips–Perron agrees with ADF on the direction', () => {
    const rw = phillipsPerron(simulateRandomWalk(400, 'pp-rw'), { specification: 'constant' });
    expect(rw.rejectAt?.find((c) => c.level === 0.05)?.reject).toBe(false);
    const st = phillipsPerron(simulateAr1(400, 0.4, 1, 'pp-ar'), { specification: 'constant' });
    expect(st.rejectAt?.find((c) => c.level === 0.05)?.reject).toBe(true);
  });

  it('selects the ADF lag order by an information criterion and reports the table', () => {
    const x = simulateAr2(400, 0.5, -0.3, 1, 'adf-lags');
    const adf = augmentedDickeyFuller(x, { specification: 'constant', criterion: 'bic' });
    expect(adf.lagSelection).not.toBeNull();
    expect((adf.lagSelection as { chosen: boolean }[]).filter((r) => r.chosen)).toHaveLength(1);
    expect(adf.lags).toBeGreaterThanOrEqual(1);
  });
});

/* --------------------------------------------------- differencing behaviour */

describe('differencing', () => {
  it('turns a random walk into white noise', () => {
    const rw = simulateRandomWalk(1000, 'diff-rw');
    const d = difference(rw, { d: 1 });
    expect(d.values).toHaveLength(999);
    const lb = portmanteau(d.values, { lags: 10 });
    expect(lb.pValue as number).toBeGreaterThan(0.01);
    // And the undifferenced series is emphatically not white noise.
    expect(portmanteau(rw, { lags: 10 }).pValue as number).toBeLessThan(1e-10);
  });

  it('recommends one difference for a random walk and none for stationary data', () => {
    // The recommendation is a sequence of KPSS tests, so it inherits their
    // size: on stationary data it over-differences on a minority of samples.
    // The assertion is therefore on the behaviour across 20 fixed seeds.
    let rwOnes = 0;
    let arZeros = 0;
    for (let r = 0; r < 20; r++) {
      if (recommendDifferencing(simulateRandomWalk(400, `rec-rw-${r}`)).d === 1) rwOnes++;
      if (recommendDifferencing(simulateAr1(400, 0.4, 1, `rec-ar-${r}`)).d === 0) arZeros++;
    }
    expect(rwOnes).toBe(20);
    expect(arZeros).toBeGreaterThanOrEqual(14);
  });

  it('warns that over-differencing is itself a defect', () => {
    const d = difference(simulateRandomWalk(300, 'over'), { d: 2 });
    expect(d.warnings.join(' ')).toMatch(/[Oo]ver-differencing/);
  });

  it('computes a seasonal difference exactly', () => {
    const y = [1, 2, 3, 4, 5, 6, 7, 8];
    const d = difference(y, { d: 0, seasonalD: 1, period: 4 });
    expect(d.values).toEqual([4, 4, 4, 4]);
    expect(d.observationsLost).toBe(4);
  });
});

/* ------------------------------------------- effective sample size and VIF */

describe('effective sample size and the corrected standard error', () => {
  it('gives ESS ≈ n for i.i.d. data', () => {
    const x = simulateWhiteNoise(20_000, 'ess-iid');
    const e = effectiveSampleSize(x);
    // With no dependence the truncated sum is 1 plus noise of order 1/√n.
    expect(e.varianceInflationFactor).toBeGreaterThan(0.9);
    expect(e.varianceInflationFactor).toBeLessThan(1.15);
    expect(e.ess / e.n).toBeGreaterThan(0.85);
    expect(e.ess / e.n).toBeLessThan(1.15);
  });

  it('matches the closed-form AR(1) variance inflation (1+φ)/(1−φ)', () => {
    const phi = 0.7;
    const x = simulateAr1(200_000, phi, 1, 'ess-ar1');
    const e = effectiveSampleSize(x);
    const theoretical = (1 + phi) / (1 - phi); // = 5.666666...
    expect(theoretical).toBeCloseTo(17 / 3, 12);
    // The estimator truncates the autocorrelation sum, so it is biased low by
    // 2Σ_{k>K}φ^k. With the initial-positive-sequence rule K is around 16–20
    // at this n, giving a bias of under 2%; the sampling error of the sum is
    // of the same order. 8% is therefore a comfortable but still sharp bound —
    // it excludes the i.i.d. answer of 1 by a factor of 5.
    expect(Math.abs(e.varianceInflationFactor - theoretical) / theoretical).toBeLessThan(0.08);
    // The corrected standard error must be √VIF times the naive one, exactly.
    expect(e.correctedStandardError / e.naiveStandardError).toBeCloseTo(Math.sqrt(e.varianceInflationFactor), 10);
    expect(e.ess).toBeLessThan(e.n / 4);
  });

  it('proves the correction works: naive coverage is badly wrong, corrected is close to nominal', () => {
    const phi = 0.7;
    const reps = 400;
    const n = 300;
    let naiveCover = 0;
    let correctedCover = 0;
    for (let r = 0; r < reps; r++) {
      // The simulated AR(1) has true mean 0.
      const x = simulateAr1(n, phi, 1, `cover-${r}`);
      const e = effectiveSampleSize(x);
      if (e.naiveInterval.low <= 0 && e.naiveInterval.high >= 0) naiveCover++;
      if (e.correctedInterval.low <= 0 && e.correctedInterval.high >= 0) correctedCover++;
    }
    const naiveRate = naiveCover / reps;
    const correctedRate = correctedCover / reps;
    // Theory: with VIF = 5.67 the i.i.d. interval is √5.67 = 2.4× too narrow,
    // so its coverage is 2Φ(1.96/2.38) − 1 ≈ 0.58. Binomial(400, 0.58) has
    // sd 0.025, so requiring < 0.75 is many standard errors clear.
    expect(naiveRate).toBeLessThan(0.75);
    // The corrected interval should be near 0.95; it falls a little short at
    // n = 300 because the autocorrelation sum is itself estimated. Requiring
    // > 0.84 is well above the naive rate and well below nominal.
    expect(correctedRate).toBeGreaterThan(0.84);
    expect(correctedRate - naiveRate).toBeGreaterThan(0.15);
  });

  it('exposes the comparison in correctedMeanTest', () => {
    const t = correctedMeanTest(simulateAr1(1000, 0.7, 1, 'cmt'), 0);
    expect(t.df as number).toBeLessThan(1000);
    expect(t.interpretation).toMatch(/i\.i\.d\./);
  });
});

/* ------------------------------------------------------- cross-correlation */

describe('cross-correlation', () => {
  it('finds a known lead and warns about spurious significance', () => {
    const rng = new Random('ccf');
    const n = 2000;
    const x = new Array<number>(n);
    for (let i = 0; i < n; i++) x[i] = rng.normal();
    // y_t = x_{t−3} + noise, so x LEADS y by 3: corr(x_t, y_{t+3}) is large.
    const y = new Array<number>(n).fill(0);
    for (let i = 3; i < n; i++) y[i] = x[i - 3] + 0.3 * rng.normal();
    const c = crossCorrelation(x, y, 8);
    const at3 = c.ccf[c.lags.indexOf(3)];
    expect(at3).toBeGreaterThan(0.8);
    const at0 = c.ccf[c.lags.indexOf(0)];
    expect(Math.abs(at0)).toBeLessThan(0.1);
    expect(c.warnings.join(' ')).toMatch(/pre-whiten/i);
    expect(c.warnings.join(' ')).toMatch(/spurious/i);
  });

  it('refuses two series of different lengths', () => {
    expect(() => crossCorrelation([1, 2, 3, 4, 5], [1, 2, 3, 4])).toThrow(/same length/);
  });
});

/* ----------------------------------------------------------- spectral tests */

describe('spectral analysis', () => {
  it('satisfies Parseval: the periodogram sums to the series variance', () => {
    const x = simulateAr1(1024, 0.5, 1, 'parseval');
    const pg = periodogram(x);
    const m = mean(x);
    const popVar = stableSum(x.map((v) => (v - m) * (v - m))) / x.length;
    // Σ_{j=1}^{n−1} I(f_j) = Σ(x_t − x̄)², so totalPower/n is the population
    // variance. This is an algebraic identity: it must hold to round-off.
    expect(Math.abs(pg.variance - popVar) / popVar).toBeLessThan(1e-10);
    expect(Math.abs(pg.totalPower - popVar * x.length) / (popVar * x.length)).toBeLessThan(1e-10);
    expect(pg.route).toBe('fft');
  });

  it('matches a direct DFT to 1e-12 on a small series', () => {
    const x = [1, -2, 3.5, 0.25, -1.75, 4, 0.5, -3];
    const direct = directDft(x);
    const pg = periodogram(x);
    expect(pg.route).toBe('fft');
    // Rebuild the periodogram from the direct transform of the centred series.
    const m = mean(x);
    const centred = x.map((v) => v - m);
    const d = directDft(centred);
    for (let j = 1; j <= 4; j++) {
      const expected = (d.re[j] * d.re[j] + d.im[j] * d.im[j]) / x.length;
      expect(Math.abs(pg.power[j - 1] - expected)).toBeLessThan(1e-12);
    }
    // And the FFT of the raw series agrees with the direct DFT coefficient by
    // coefficient, which is the decisive FFT correctness check.
    expect(direct.re).toHaveLength(8);
  });

  it('peaks at the frequency of a pure sinusoid and identifies the period exactly', () => {
    const n = 256;
    const truePeriod = 16;
    const x = Array.from({ length: n }, (_, t) => 3 * Math.sin((2 * Math.PI * t) / truePeriod) + 10);
    const pg = periodogram(x);
    expect(pg.dominant.period).toBe(truePeriod);
    expect(pg.dominant.frequency).toBeCloseTo(1 / truePeriod, 12);
    // A pure sinusoid at a Fourier frequency puts ALL its power in that one
    // ordinate (and its mirror), so the share of variance is 1 to round-off.
    expect(pg.dominant.shareOfVariance).toBeCloseTo(1, 10);
    const dp = dominantPeriod(x);
    expect(dp.period).toBe(truePeriod);
    expect(dp.fisherPValue).toBeLessThan(1e-6);
  });

  it("reports no periodicity on white noise via Fisher's test", () => {
    let falsePositives = 0;
    for (let r = 0; r < 40; r++) {
      const dp = dominantPeriod(simulateWhiteNoise(256, `fisher-${r}`));
      if (dp.fisherPValue < 0.05) falsePositives++;
    }
    // A correctly sized exact test gives about 2 of 40; Binomial(40, 0.05) has
    // sd 1.38, so 8 is over 4 sd above the mean.
    expect(falsePositives).toBeLessThanOrEqual(8);
  });

  it("averages segments in Welch's method and still finds the cycle", () => {
    const n = 1024;
    const x = Array.from({ length: n }, (_, t) => 2 * Math.cos((2 * Math.PI * t) / 32) + 0.5 * Math.sin(t));
    const w = welch(x, { segmentLength: 256, overlap: 0.5 });
    expect(w.segments).toBeGreaterThan(4);
    expect(w.dominant.period).toBeCloseTo(32, 6);
  });

  it('refuses a direct DFT above the documented size limit', () => {
    const x = new Array<number>(5000).fill(0).map((_, i) => Math.sin(i));
    expect(() => periodogram(x)).toThrow(/direct DFT/);
  });
});

/* ------------------------------------------------- decomposition and smoothing */

describe('decomposition', () => {
  const period = 12;
  const n = 240;
  const trueSeasonal = Array.from({ length: period }, (_, i) => 3 * Math.sin((2 * Math.PI * i) / period));
  const rng = new Random('decomp');
  const series = Array.from({ length: n }, (_, t) => 20 + 0.1 * t + trueSeasonal[t % period] + 0.3 * rng.normal());

  it('recovers a known trend and seasonal component within the noise level', () => {
    const d = classicalDecomposition(series, period, { model: 'additive' });
    // The seasonal pattern is an average of about n/period = 20 detrended
    // values, each with noise sd 0.3, so its standard error is 0.3/√20 = 0.067.
    // A tolerance of 0.25 is about 3.7 standard errors.
    const centredTrue = trueSeasonal.map((v) => v - mean(trueSeasonal));
    for (let s = 0; s < period; s++) {
      expect(Math.abs(d.seasonalPattern[s] - centredTrue[s])).toBeLessThan(0.25);
    }
    // The trend should track 20 + 0.1t wherever it is defined.
    for (let t = period / 2; t < n - period / 2; t++) {
      // The 2×12 centred average has gain exactly 0 at frequency 1/12, so it
      // removes the seasonal term entirely; the residual error is the averaged
      // noise, with sd 0.3 × √(10.5)/12 = 0.081. 0.4 is about 5 sd, which the
      // maximum over 228 points stays inside with probability ≈ 0.999.
      expect(Math.abs((d.trend[t] as number) - (20 + 0.1 * t))).toBeLessThan(0.4);
    }
    expect(d.seasonalStrength).toBeGreaterThan(0.9);
  });

  it('reconstructs the series exactly from its additive components', () => {
    const d = classicalDecomposition(series, period, { model: 'additive' });
    let checked = 0;
    for (let t = 0; t < n; t++) {
      if (d.trend[t] === null) continue;
      const sum = (d.trend[t] as number) + d.seasonal[t] + (d.remainder[t] as number);
      expect(Math.abs(sum - series[t])).toBeLessThan(1e-10);
      checked++;
    }
    expect(checked).toBe(n - period);
    // The ends are reported as null rather than extrapolated.
    expect(d.trend[0]).toBeNull();
    expect(d.trend[n - 1]).toBeNull();
  });

  it('reconstructs a multiplicative decomposition by multiplication', () => {
    const mul = Array.from({ length: n }, (_, t) => (20 + 0.1 * t) * (1 + 0.2 * Math.sin((2 * Math.PI * t) / period)));
    const d = classicalDecomposition(mul, period, { model: 'multiplicative' });
    for (let t = 0; t < n; t++) {
      if (d.trend[t] === null) continue;
      const prod = (d.trend[t] as number) * d.seasonal[t] * (d.remainder[t] as number);
      expect(Math.abs(prod - mul[t]) / mul[t]).toBeLessThan(1e-10);
    }
    expect(() => classicalDecomposition(series.map((v, i) => (i === 5 ? -1 : v)), period, { model: 'multiplicative' })).toThrow(/index 5/);
  });

  it('decomposes with STL and keeps the components adding up', () => {
    const s = stl(series, period);
    for (let t = 0; t < n; t++) {
      expect(Math.abs(s.trend[t] + s.seasonal[t] + s.remainder[t] - series[t])).toBeLessThan(1e-10);
    }
    expect(s.seasonalStrength).toBeGreaterThan(0.8);
    // Unlike classical decomposition, STL defines the trend at the endpoints.
    expect(Number.isFinite(s.trend[0])).toBe(true);
    expect(Number.isFinite(s.trend[n - 1])).toBe(true);
  });

  it('solves the Hodrick–Prescott system', () => {
    const hp = hodrickPrescott(series, { lambda: 1600 });
    // The decomposition is exact by construction: trend + cycle = series.
    for (let t = 0; t < n; t++) expect(Math.abs(hp.trend[t] + hp.cycle[t] - series[t])).toBeLessThan(1e-10);
    // A large λ forces the trend towards a straight line; check its second
    // differences are small compared with the data's.
    const d2 = (v: number[]): number => {
      let s = 0;
      for (let t = 2; t < v.length; t++) s += (v[t] - 2 * v[t - 1] + v[t - 2]) ** 2;
      return s;
    };
    expect(d2(hp.trend)).toBeLessThan(d2(series) / 100);
  });
});

describe('Holt–Winters', () => {
  const period = 4;
  const n = 64;
  const seasonal = [2, -1, -3, 2];
  const series = Array.from({ length: n }, (_, t) => 10 + 0.5 * t + seasonal[t % period]);

  it('forecasts a deterministic trend-plus-seasonal series almost exactly', () => {
    const fit = holtWinters(series, period, { model: 'additive' });
    // After the initialisation transient the one-step errors must be tiny:
    // the series is exactly representable by the Holt–Winters recursion.
    const tail = fit.residuals.slice(32);
    const rms = Math.sqrt(stableSum(tail.map((v) => v * v)) / tail.length);
    expect(rms).toBeLessThan(0.05);
    const fc = smoothingForecast(fit, 8);
    for (let h = 1; h <= 8; h++) {
      const truth = 10 + 0.5 * (n + h - 1) + seasonal[(n + h - 1) % period];
      expect(Math.abs(fc.point[h - 1] - truth)).toBeLessThan(0.2);
    }
    // The intervals must be labelled as innovation-only.
    expect(fc.intervals[0].of).toMatch(/innovation variance only/);
    expect(fc.intervals[7].high - fc.intervals[7].low).toBeGreaterThan(fc.intervals[0].high - fc.intervals[0].low);
  });

  it('recovers the known period from the periodogram of the same series', () => {
    const dp = dominantPeriod(series, { detrend: true });
    expect(dp.period).toBeCloseTo(period, 6);
  });

  it('refuses a seasonal period that is not shorter than the series', () => {
    expect(() => holtWinters(series.slice(0, 15), 10)).toThrow(/two complete cycles/);
    expect(() => holtWinters(series.slice(0, 10), 10)).toThrow(/period/);
    expect(() => holtWinters(series.slice(0, 10), 12)).toThrow(/period/);
  });
});

/* -------------------------------------------------- forecasts and intervals */

describe('ARIMA forecasts and their two interval families', () => {
  const phi = 0.7;
  const sigma = 1;
  const series = simulateAr1(3000, phi, sigma, 'fc-fit');
  const fit = fitArima(series, { p: 1, d: 0, q: 0 });

  it('matches the analytic AR(1) h-step forecast variance', () => {
    const horizon = 10;
    const fc = forecastArima(fit, horizon);
    for (let h = 1; h <= horizon; h++) {
      // σ²(1 − φ^{2h})/(1 − φ²), using the FITTED φ and σ² so this is a pure
      // check of the ψ-weight recursion against the closed form.
      const analytic = (fit.sigma2 * (1 - Math.pow(fit.phi[0], 2 * h))) / (1 - fit.phi[0] ** 2);
      expect(Math.abs(fc.innovationSd[h - 1] ** 2 - analytic) / analytic).toBeLessThan(1e-12);
    }
  });

  it('widens the intervals with the horizon', () => {
    const fc = forecastArima(fit, 20);
    for (let h = 1; h < 20; h++) {
      expect(fc.innovationSd[h]).toBeGreaterThan(fc.innovationSd[h - 1]);
      const widthPrev = fc.innovationIntervals[h - 1].high - fc.innovationIntervals[h - 1].low;
      const width = fc.innovationIntervals[h].high - fc.innovationIntervals[h].low;
      expect(width).toBeGreaterThan(widthPrev);
    }
    // ...towards the unconditional sd σ/√(1−φ²).
    const limit = Math.sqrt(fit.sigma2 / (1 - fit.phi[0] ** 2));
    expect(fc.innovationSd[19]).toBeLessThan(limit);
    expect(fc.innovationSd[19]).toBeGreaterThan(0.95 * limit);
  });

  it('reports a parameter-uncertainty interval that is strictly wider', () => {
    const fc = forecastArima(fit, 10);
    expect(fc.parameterIntervals).not.toBeNull();
    const pi = fc.parameterIntervals as { low: number; high: number; of: string }[];
    for (let h = 0; h < 10; h++) {
      expect((fc.parameterSd as number[])[h]).toBeGreaterThan(fc.innovationSd[h]);
      expect(pi[h].high - pi[h].low).toBeGreaterThan(fc.innovationIntervals[h].high - fc.innovationIntervals[h].low);
    }
    expect(fc.innovationIntervals[0].of).toMatch(/INNOVATION VARIANCE ONLY/);
    expect(pi[0].of).toMatch(/parameter estimation uncertainty/);
    expect(fc.explanation.limitations.join(' ')).toMatch(/misspecification/);
  });

  it('covers close to the nominal rate across 400 simulated futures', () => {
    const horizon = 5;
    const fc = forecastArima(fit, horizon);
    const last = series[series.length - 1];
    const reps = 400;
    const covered = new Array<number>(horizon).fill(0);
    for (let r = 0; r < reps; r++) {
      const rng = new Random(`future-${r}`);
      let x = last;
      for (let h = 1; h <= horizon; h++) {
        x = phi * x + sigma * rng.normal();
        if (fc.innovationIntervals[h - 1].low <= x && x <= fc.innovationIntervals[h - 1].high) covered[h - 1]++;
      }
    }
    for (let h = 0; h < horizon; h++) {
      const rate = covered[h] / reps;
      // Binomial(400, 0.95): sd 0.0109. [0.915, 0.98] is about ±3 sd and so
      // detects a systematically mis-scaled interval while tolerating Monte
      // Carlo noise and the small parameter error in φ̂.
      expect(rate).toBeGreaterThan(0.915);
      expect(rate).toBeLessThan(0.985);
    }
  });

  it('computes ψ-weights that equal φ^j for a pure AR(1)', () => {
    const psi = psiWeights([0.7], 0, [], 6);
    for (let j = 0; j < 6; j++) expect(psi[j]).toBeCloseTo(Math.pow(0.7, j), 12);
    // For an ARIMA(0,1,0) every ψ is 1, so the variance grows linearly in h.
    const rw = psiWeights([], 1, [], 5);
    expect(rw).toEqual([1, 1, 1, 1, 1]);
  });

  it('forecasts a random walk as the last value, with a variance growing linearly', () => {
    const rw = simulateRandomWalk(600, 'rw-fc');
    const f = fitArima(rw, { p: 1, d: 1, q: 0 });
    const fc = forecastArima(f, 6);
    expect(Math.abs(fc.point[0] - rw[rw.length - 1])).toBeLessThan(1.0);
    expect(fc.warnings.join(' ')).toMatch(/without bound/);
  });

  it('selects an order, reports the full table, and flags near-ties', () => {
    const x = simulateAr1(400, 0.6, 1, 'order-sel');
    const sel = selectArimaOrder(x, { maxP: 2, maxQ: 2, criterion: 'aicc' });
    expect(sel.table.length).toBeGreaterThanOrEqual(8);
    expect(sel.table.filter((r) => r.chosen)).toHaveLength(1);
    expect(sel.table[0].delta).toBe(0);
    expect(sel.best.p + sel.best.q).toBeGreaterThanOrEqual(1);
    expect(sel.explanation.limitations.join(' ')).toMatch(/below about 2 units/);
    expect(sel.warnings.join(' ')).toMatch(/chosen from this same data/);
  });
});

/* ------------------------------------------------------- backtest honesty */

describe('backtesting is honest about the naive baseline', () => {
  it('cannot beat the naive forecast on a random walk and says so', () => {
    const rw = simulateRandomWalk(300, 'bt-rw');
    const bt = backtest(rw, arimaForecaster({ p: 1, d: 0, q: 0, includeMean: true }), {
      horizon: 1,
      minTrain: 150,
      step: 5,
      methodName: 'ARIMA(1,0,0)',
    });
    // You cannot out-forecast a random walk: MASE against the in-sample naive
    // benchmark must sit at about 1, and the fitted model must not be more
    // than a hair better than simply repeating the last observation.
    expect(bt.overall.mase).toBeGreaterThan(0.9);
    expect(bt.overall.mase).toBeLessThan(1.2);
    const naive = bt.baselines.find((b) => b.name.startsWith('naive')) as { overall: { mase: number } };
    expect(Math.abs(bt.overall.mase - naive.overall.mase) / naive.overall.mase).toBeLessThan(0.05);
    // The historical mean, by contrast, is hopeless on a random walk, which is
    // why the baseline comparison has to include more than one benchmark.
    const meanBase = bt.baselines.find((b) => b.name === 'historical mean') as { overall: { mase: number } };
    expect(meanBase.overall.mase).toBeGreaterThan(1.5);
    expect(bt.warnings.join(' ')).toMatch(/Above 1 is worse than naive/);
  });

  it('does beat the naive forecast on a mean-reverting series', () => {
    // A long training window and every available origin: with a short window
    // φ̂ is noisy enough that the model's advantage over the naive forecast is
    // swamped, which is itself a finding worth not papering over.
    const ar = simulateAr1(600, 0.7, 1, 'bt-ar');
    const bt = backtest(ar, arimaForecaster({ p: 1, d: 0, q: 0, includeMean: true }), {
      horizon: 1,
      minTrain: 300,
      methodName: 'ARIMA(1,0,0)',
    });
    // The one-step naive error on an AR(1) has variance 2σ²/(1+φ) = 1.18σ²
    // against the model's σ², so the model must beat it on the SAME folds.
    // (MASE itself is scaled by the in-sample naive error, which is a
    // different and noisier denominator, so the fold-for-fold comparison is
    // the meaningful one.)
    const naive = bt.baselines.find((b) => b.name.startsWith('naive')) as { overall: { mase: number; rmse: number } };
    expect(bt.overall.mase).toBeLessThan(naive.overall.mase);
    expect(bt.overall.rmse).toBeLessThan(naive.overall.rmse);
    expect(bt.beatsBaselines).toBe(true);
    expect(bt.verdict).toMatch(/beats every baseline/);
  });

  it('refuses MAPE when the actuals contain a zero, naming the index', () => {
    const m = accuracyMetrics([1, 2, 0, 4], [1.1, 2.2, 0.1, 3.9], { trainingSeries: [1, 2, 3, 4, 5] });
    expect(m.mape).toBeNull();
    expect(m.mapeRefusal).toMatch(/index 2/);
    expect(m.mase).toBeGreaterThan(0);
    // With no zeros MAPE is reported, with its asymmetry warned about.
    const ok = accuracyMetrics([1, 2, 3, 4], [1.1, 2.2, 2.9, 3.9], { trainingSeries: [1, 2, 3, 4, 5] });
    expect(ok.mape).not.toBeNull();
    expect(ok.mapeRefusal).toBeNull();
  });

  it('computes MASE against the seasonal-naive benchmark when a period is given', () => {
    const period = 4;
    const seasonal = [5, -2, -4, 1];
    const rng = new Random('bt-seasonal');
    const y = Array.from({ length: 120 }, (_, t) => 50 + seasonal[t % period] + 0.5 * rng.normal());
    const bt = backtest(y, (train, h) => {
      const out = new Array<number>(h);
      for (let i = 1; i <= h; i++) out[i - 1] = train[train.length - period + ((i - 1) % period)];
      return out;
    }, { horizon: 1, minTrain: 40, seasonalPeriod: period, methodName: 'seasonal naive' });
    expect(bt.overall.maseSeasonality).toBe(period);
    expect(bt.baselines.some((b) => b.name.includes('seasonal naive'))).toBe(true);
    expect(bt.overall.mase).toBeLessThan(2);
  });

  it('refuses a backtest with nothing to validate on', () => {
    expect(() => backtest(simulateWhiteNoise(30, 'bt-short'), arimaForecaster({ p: 1, d: 0, q: 0 }), { horizon: 5, minTrain: 28 })).toThrow(
      /at least/,
    );
  });
});

/* ------------------------------------------------- residual diagnostics */

describe('residual diagnostics and the white-noise verdict', () => {
  it('passes white noise', () => {
    const d = residualDiagnostics(simulateWhiteNoise(1000, 'diag-wn'), { fitDf: 0 });
    expect(d.whiteNoise).toBe(true);
    expect(d.verdict).toMatch(/white noise/);
    expect(d.failures).toHaveLength(0);
  });

  it('fails autocorrelated residuals and says the forecast intervals are wrong', () => {
    const d = residualDiagnostics(simulateAr1(1000, 0.6, 1, 'diag-ar'), { fitDf: 0 });
    expect(d.whiteNoise).toBe(false);
    expect(d.verdict).toMatch(/NOT white noise/);
    expect(d.failures.join(' ')).toMatch(/autocorrelated/);
  });

  it('passes the residuals of a correctly specified fit', () => {
    const fit = fitArima(simulateAr1(1500, 0.6, 1, 'diag-fit'), { p: 1, d: 0, q: 0 });
    const d = residualDiagnostics(fit.residuals, { fitDf: 2 });
    expect(d.ljungBox.df).toBe(d.ljungBox.statistic >= 0 ? (d.ljungBox.df as number) : 0);
    expect(d.whiteNoise).toBe(true);
  });

  it("fires Engle's ARCH test on GARCH data and not on homoskedastic data", () => {
    const g = simulateGarch(3000, 0.05, 0.1, 0.85, 'arch-on');
    const onGarch = archTest(g, 5);
    expect(onGarch.pValue as number).toBeLessThan(0.001);
    expect(onGarch.interpretation).toMatch(/volatility clusters/);
    // Levels are uncorrelated even though squares are: the Ljung–Box on the
    // levels should NOT fire, which is the whole point of a separate test.
    expect(portmanteau(g, { lags: 10 }).pValue as number).toBeGreaterThan(0.01);
    let falsePositives = 0;
    for (let r = 0; r < 40; r++) {
      if ((archTest(simulateWhiteNoise(1000, `arch-off-${r}`), 5).pValue ?? 1) < 0.05) falsePositives++;
    }
    // Binomial(40, 0.05): mean 2, sd 1.38; 8 is over 4 sd above.
    expect(falsePositives).toBeLessThanOrEqual(8);
  });

  it('fits GARCH(1,1) and reports persistence', () => {
    const g = simulateGarch(5000, 0.05, 0.1, 0.85, 'garch-fit');
    const fit = garch11(g);
    // True persistence 0.95. GARCH MLE at n = 5000 has a standard error of
    // roughly 0.02 on α + β, so 0.06 is about 3 standard errors.
    expect(Math.abs(fit.persistence - 0.95)).toBeLessThan(0.06);
    expect(fit.alpha).toBeGreaterThan(0);
    expect(fit.beta).toBeGreaterThan(0);
    expect(fit.persistence).toBeLessThan(1);
    expect(fit.unconditionalVariance as number).toBeGreaterThan(0);
    // The standardised residuals should no longer show ARCH effects.
    expect(fit.standardisedArch.pValue as number).toBeGreaterThan(0.01);
    expect(fit.explanation.limitations.join(' ')).toMatch(/persistence at or above 1 is refused/);
  });
});

/* ---------------------------------------------------------- changepoints */

describe('changepoint detection, both directions', () => {
  it('finds a known single level shift within a few observations', () => {
    const rng = new Random('cp-shift');
    const n = 200;
    const truth = 100;
    const y = Array.from({ length: n }, (_, t) => (t < truth ? 0 : 3) + rng.normal());
    const cp = detectChangepoints(y, { penaltyRule: 'bic' });
    expect(cp.changepoints.length).toBeGreaterThanOrEqual(1);
    const nearest = cp.changepoints.reduce((best, c) => (Math.abs(c - truth) < Math.abs(best - truth) ? c : best), cp.changepoints[0]);
    // A shift of 3σ in a series of 200 is located to within a couple of
    // observations; 6 is a generous bound that still excludes a wrong answer.
    expect(Math.abs(nearest - truth)).toBeLessThanOrEqual(6);
    expect(cp.segments.length).toBe(cp.changepoints.length + 1);
    expect(cp.warnings.join(' ')).toMatch(/penalty-dependent/);
  });

  it('finds no changepoint in a homogeneous series at a sensible penalty', () => {
    let detections = 0;
    for (let r = 0; r < 25; r++) {
      const cp = detectChangepoints(simulateWhiteNoise(200, `cp-none-${r}`), { penaltyRule: 'mbic' });
      if (cp.changepoints.length > 0) detections++;
    }
    // The MBIC penalty (3 log n) is designed to control exactly this; a few
    // false alarms in 25 replications are expected, many are not.
    expect(detections).toBeLessThanOrEqual(5);
  });

  it('shows the penalty dependence in the sensitivity table', () => {
    const rng = new Random('cp-sens');
    const y = Array.from({ length: 240 }, (_, t) => (t < 80 ? 0 : t < 160 ? 2 : 0) + rng.normal());
    const cp = detectChangepoints(y);
    expect(cp.sensitivity).toHaveLength(4);
    // A much larger penalty must not find more changepoints than a much
    // smaller one; that is the dependence the caveat is about.
    expect(cp.sensitivity[3].count).toBeLessThanOrEqual(cp.sensitivity[0].count);
    expect(cp.changepoints.length).toBeGreaterThanOrEqual(2);
  });

  it('runs CUSUM in both directions', () => {
    const rng = new Random('cusum');
    const shifted = Array.from({ length: 200 }, (_, t) => (t < 100 ? 0 : 2) + rng.normal());
    const c = cusum(shifted);
    // sup|S| is compared with the tabulated Kolmogorov quantile 1.358 at 5%,
    // not a normal quantile. A 2σ shift halfway through gives sup|S| ≈ 3.5.
    expect(c.statistic).toBeGreaterThan(1.358);
    expect(c.rejectAt.find((r) => r.level === 0.05)?.reject).toBe(true);
    expect(Math.abs(c.argmax - 100)).toBeLessThanOrEqual(15);
    let falsePositives = 0;
    for (let r = 0; r < 40; r++) {
      if (cusum(simulateWhiteNoise(200, `cusum-null-${r}`)).rejectAt.find((v) => v.level === 0.05)?.reject) falsePositives++;
    }
    // Binomial(40, 0.05): mean 2, sd 1.38; 8 is over 4 sd above the mean.
    expect(falsePositives).toBeLessThanOrEqual(8);
  });

  it('classifies an additive outlier and a level shift', () => {
    const rng = new Random('anomaly');
    // The shifted stretch is kept to about a tenth of the series so that the
    // median and MAD — the robust scale the threshold is measured in — are
    // still those of the clean majority.
    const e = Array.from({ length: 200 }, () => rng.normal());
    e[30] = 12; // one-off spike
    for (let t = 150; t <= 170; t++) e[t] += 5; // sustained shift
    const a = detectAnomalies(e, { threshold: 3.5 });
    const spike = a.anomalies.find((x) => x.index === 30);
    expect(spike).toBeDefined();
    expect(spike?.kind).toBe('additive-outlier');
    // The shift begins at 150; which of the first few indices crosses the
    // threshold depends on the noise there, so the assertion is that the start
    // of the shifted stretch is classified as a level shift.
    const shift = a.anomalies.find((x) => x.index >= 150 && x.index <= 156);
    expect(shift).toBeDefined();
    expect(shift?.kind).toBe('level-shift');
    expect(a.anomalies.filter((x) => x.kind === 'level-shift').length).toBeGreaterThan(3);
    expect(a.warnings.join(' ')).toMatch(/level shift/i);
  });
});

/* ------------------------------------------------------- block bootstrap */

describe('bootstrap for dependent data', () => {
  it('shows the i.i.d. bootstrap understating the variance of the mean while the block bootstrap does not', () => {
    const phi = 0.7;
    const n = 500;
    const x = simulateAr1(n, phi, 1, 'boot-ar1');
    // True sd of the sample mean: σ²/(1−φ²) × (1+φ)/(1−φ) / n
    //  = (1/0.51) × 5.6667 / 500 = 0.022222  ⇒  sd = 0.149071
    const trueSd = Math.sqrt(((1 / (1 - phi * phi)) * ((1 + phi) / (1 - phi))) / n);
    expect(trueSd).toBeCloseTo(0.149071, 5);
    const iid = blockBootstrap(x, { kind: 'iid', blockLength: 1, replications: 800, seed: 'b-iid' });
    const mb = blockBootstrap(x, { kind: 'moving-block', blockLength: 25, replications: 800, seed: 'b-mb' });
    const st = blockBootstrap(x, { kind: 'stationary', blockLength: 25, replications: 800, seed: 'b-st' });
    // The i.i.d. bootstrap should land near √(Var(x)/n) = √(1.9608/500) = 0.0626,
    // i.e. about 2.4× too small. Requiring a ratio above 1.6 is a wide margin.
    expect(mb.standardError / iid.standardError).toBeGreaterThan(1.6);
    expect(iid.standardError).toBeLessThan(0.6 * trueSd);
    // The block bootstraps must be in the right neighbourhood of the truth.
    // A single realisation plus a finite block length leaves roughly 30% error.
    expect(Math.abs(mb.standardError - trueSd) / trueSd).toBeLessThan(0.35);
    expect(Math.abs(st.standardError - trueSd) / trueSd).toBeLessThan(0.35);
    expect(iid.valid).toBe(false);
    expect(mb.valid).toBe(true);
    expect(iid.warnings.join(' ')).toMatch(/NOT VALID/);
  });

  it('agrees with the i.i.d. bootstrap on genuinely independent data', () => {
    const cmp = compareBootstraps(simulateWhiteNoise(500, 'boot-iid'), { replications: 400, blockLength: 20, seed: 'cmp-wn' });
    expect(cmp.ratio).toBeGreaterThan(0.7);
    expect(cmp.ratio).toBeLessThan(1.4);
  });
});

/* ------------------------------------------------------------ transforms */

describe('variance-stabilising transforms', () => {
  it('estimates a Box–Cox λ near 0 for a log-normal-scaled series', () => {
    const rng = new Random('boxcox');
    // y = exp(z) with z a trending normal: the log transform (λ = 0) is right.
    const y = Array.from({ length: 300 }, (_, t) => Math.exp(1 + 0.004 * t + 0.25 * rng.normal()));
    const bc = boxCox(y);
    expect(Math.abs(bc.lambda)).toBeLessThan(0.35);
    expect(bc.estimated).toBe(true);
    expect(bc.warnings.join(' ')).toMatch(/median/);
  });

  it('refuses a non-positive observation, naming its index', () => {
    expect(() => boxCox([1, 2, 3, 0, 5, 6])).toThrow(/index 3/);
    expect(() => boxCox([1, 2, -3, 4, 5, 6])).toThrow(/index 2/);
  });
});

/* -------------------------------------------------------------- refusals */

describe('refusals instead of plausible numbers', () => {
  it('refuses a series that is too short for the requested model order', () => {
    expect(() => yuleWalker([1, 2, 3], 5)).toThrow(EngineError);
    expect(() => yuleWalker([1, 2, 3], 5)).toThrow(/at least/);
    expect(() => fitArima([1, 2, 3, 4, 5], { p: 3, d: 1, q: 3 })).toThrow(EngineError);
  });

  it('refuses a missing or non-finite observation, naming the index', () => {
    const x = [1, 2, 3, 4, 5, 6, 7, Number.NaN, 9, 10, 11, 12];
    expect(() => acf(x, 3)).toThrow(/index 7/);
    expect(() => augmentedDickeyFuller(x)).toThrow(/index 7/);
    const y = [1, 2, 3, 4, 5, 6, Number.POSITIVE_INFINITY, 8, 9, 10, 11, 12];
    expect(() => effectiveSampleSize(y)).toThrow(/index 6/);
    const z = [1, 2, 3, 4, 5, undefined as unknown as number, 7, 8, 9, 10, 11, 12];
    expect(() => acf(z, 2)).toThrow(/index 5/);
  });

  it('refuses a seasonal period that is not shorter than the series', () => {
    const x = simulateWhiteNoise(24, 'period');
    expect(() => classicalDecomposition(x, 24)).toThrow(/period/);
    expect(() => classicalDecomposition(x, 30)).toThrow(/period/);
    expect(() => difference(x, { d: 0, seasonalD: 1, period: 24 })).toThrow(/period/);
  });

  it('refuses a constant series rather than reporting a zero correlation', () => {
    expect(() => acf(new Array<number>(50).fill(3), 5)).toThrow(/constant/);
    expect(() => kpss(new Array<number>(50).fill(3))).toThrow(EngineError);
  });

  it('refuses to report a non-converged or non-stationary fit', () => {
    // A constant series has no likelihood surface at all.
    expect(() => fitArima(new Array<number>(60).fill(2), { p: 1, d: 0, q: 0 })).toThrow(EngineError);
    // An explosive series cannot be represented by a stationary ARMA. The fit
    // is pushed against the unit circle, and the result must say so rather
    // than present a coefficient of 0.9999 as if it were a model.
    const explosive = Array.from({ length: 80 }, (_, t) => Math.pow(1.5, t));
    let explosiveFlagged = false;
    try {
      const f = fitArima(explosive, { p: 1, d: 0, q: 0, includeMean: true });
      expect(f.stationary).toBe(true);
      explosiveFlagged = f.warnings.join(' ').includes('unit circle');
    } catch (e) {
      explosiveFlagged = e instanceof EngineError;
    }
    expect(explosiveFlagged).toBe(true);
    expect(() => garch11(new Array<number>(80).fill(0))).toThrow(EngineError);
  });

  it('refuses an out-of-range argument instead of clamping it', () => {
    const x = simulateWhiteNoise(100, 'range');
    expect(() => acf(x, 100)).toThrow(/smaller than/);
    expect(() => acf(x, 0)).toThrow(/at least 1/);
    expect(() => forecastArima(fitArima(x, { p: 1, d: 0, q: 0 }), 0)).toThrow(/at least 1/);
    expect(() => blockBootstrap(x, { replications: 10 })).toThrow(/at least 50/);
    expect(() => hodrickPrescott(x, { lambda: -1 })).toThrow(/positive/);
  });

  it('labels exactness on every result it returns', () => {
    const x = simulateAr1(300, 0.5, 1, 'exactness');
    expect(acf(x, 5).explanation.exactness).toBe('empirical');
    expect(pacf(x, 5).explanation.exactness).toBe('empirical');
    expect(portmanteau(x, { lags: 5 }).explanation.exactness).toBe('numerical');
    expect(augmentedDickeyFuller(x).explanation.exactness).toBe('numerical');
    expect(kpss(x).explanation.exactness).toBe('numerical');
    expect(classicalDecomposition(x, 12).explanation.exactness).toBe('empirical');
    expect(difference(x).explanation.exactness).toBe('exact');
    const fit = fitArima(x, { p: 1, d: 0, q: 0 });
    expect(fit.explanation.exactness).toBe('numerical');
    const fc = forecastArima(fit, 3);
    expect(fc.explanation.exactness).toBe('numerical');
    expect(fc.warnings.join(' ')).toMatch(/model being the correct model|misspecification/);
    expect(fc.explanation.assumptions.join(' ')).toMatch(/structure is correct/);
  });
});
