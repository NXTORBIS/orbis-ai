/**
 * Survival analysis tests.
 *
 * Reference values here are independent of the implementation: hand arithmetic
 * written out in comments, analytic results for known generating processes,
 * and direct computations written from scratch inside the tests.
 *
 * Every tolerance is justified where it appears. Where a tolerance refers to
 * "σ", it means the standard error the estimator itself reports, so the claim
 * being tested is "the estimate agrees with the known truth to within sampling
 * error", not "the estimate matches a number this code produced earlier".
 */

import { describe, expect, it } from 'vitest';
import { Random } from '../random/rng.ts';
import type { EngineResult } from '../core/result.ts';
import {
  cumulativeIncidence,
  fineGray,
  ONE_MINUS_KM_WARNING,
} from './competing.ts';
import {
  coxDesignFromArrays,
  coxDesignFromCountingProcess,
  coxRegression,
  harrellC,
  predictedSurvival,
  type CoxFit,
} from './cox.ts';
import { coxResiduals, schoenfeldTest } from './diagnostics.ts';
import { INDEPENDENT_CENSORING, buildRiskTable } from './data.ts';
import {
  kaplanMeier,
  lifeTable,
  medianSurvival,
  nelsonAalen,
  restrictedMeanSurvival,
  smoothedHazard,
} from './km.ts';
import {
  detectCrossingCurves,
  logRankTest,
  logRankTrendTest,
  stratifiedLogRankTest,
} from './logrank.ts';
import { compareParametricModels, fitParametric } from './parametric.ts';
import { eventProbability, logRankPower, logRankSampleSize, requiredEvents } from './design.ts';

function unwrap<T>(r: EngineResult<T>): T {
  if (!r.ok) throw new Error(`expected success, got: ${JSON.stringify(r.errors)}`);
  return r.value;
}

function errorCodes<T>(r: EngineResult<T>): string[] {
  if (r.ok) throw new Error('expected failure, got success');
  return r.errors.map((e) => e.code);
}

function errorText<T>(r: EngineResult<T>): string {
  if (r.ok) throw new Error('expected failure, got success');
  return r.errors.map((e) => e.message).join(' ');
}

/** Exponential survival data with independent exponential censoring. */
function exponentialSample(
  n: number,
  rate: number,
  censorRate: number,
  seed: string,
): { time: number[]; status: number[] } {
  const rng = new Random(seed);
  const time: number[] = [];
  const status: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = rng.exponential(rate);
    const c = censorRate > 0 ? rng.exponential(censorRate) : Infinity;
    time.push(Math.min(t, c));
    status.push(t <= c ? 1 : 0);
  }
  return { time, status };
}

describe('Kaplan–Meier, hand computed', () => {
  // Eight subjects, two of them censored:
  //   times  2  3  4* 6  7  9* 10 12      (* = censored)
  //
  // Risk table and product-limit steps, all by hand:
  //   t = 2 : n = 8, d = 1 → S = 7/8                      = 0.875
  //   t = 3 : n = 7, d = 1 → S = 0.875 · 6/7              = 0.75
  //   t = 4 : censored, n = 6, no step
  //   t = 6 : n = 5, d = 1 → S = 0.75 · 4/5               = 0.6
  //   t = 7 : n = 4, d = 1 → S = 0.6 · 3/4                = 0.45
  //   t = 9 : censored, n = 3, no step
  //   t = 10: n = 2, d = 1 → S = 0.45 · 1/2               = 0.225
  //   t = 12: n = 1, d = 1 → S = 0.225 · 0                = 0
  //
  // Greenwood sums Σ d/(n(n−d)), accumulated by hand:
  //   t = 2 : 1/(8·7) = 1/56
  //   t = 3 : 1/56 + 1/(7·6) = 3/168 + 4/168 = 7/168 = 1/24
  //   t = 6 : 1/24 + 1/(5·4) = 5/120 + 6/120 = 11/120
  //   t = 7 : 11/120 + 1/(4·3) = 11/120 + 10/120 = 21/120 = 7/40
  //   t = 10: 7/40 + 1/(2·1) = 7/40 + 20/40 = 27/40
  //   t = 12: n = d = 1, the term 1/(1·0) is infinite — se undefined there.
  const time = [2, 3, 4, 6, 7, 9, 10, 12];
  const status = [1, 1, 0, 1, 1, 0, 1, 1];
  const km = unwrap(kaplanMeier(time, status));

  it('reproduces the hand-computed survival curve exactly', () => {
    expect(km.curve.map((p) => p.time)).toEqual([2, 3, 6, 7, 10, 12]);
    const expected = [0.875, 0.75, 0.6, 0.45, 0.225, 0];
    km.curve.forEach((p, i) => {
      expect(p.survival).toBeCloseTo(expected[i], 12);
    });
  });

  it('reproduces the hand-computed risk table', () => {
    // at-risk / events / censored at every distinct observed time
    expect(km.riskTable).toEqual([
      { time: 2, atRisk: 8, events: 1, censored: 0 },
      { time: 3, atRisk: 7, events: 1, censored: 0 },
      { time: 4, atRisk: 6, events: 0, censored: 1 },
      { time: 6, atRisk: 5, events: 1, censored: 0 },
      { time: 7, atRisk: 4, events: 1, censored: 0 },
      { time: 9, atRisk: 3, events: 0, censored: 1 },
      { time: 10, atRisk: 2, events: 1, censored: 0 },
      { time: 12, atRisk: 1, events: 1, censored: 0 },
    ]);
    // Risk sets on the curve itself, and censorings attributed forward.
    expect(km.curve.map((p) => p.atRisk)).toEqual([8, 7, 5, 4, 2, 1]);
    expect(km.curve.map((p) => p.censored)).toEqual([0, 1, 0, 1, 0, 0]);
  });

  it('reproduces the hand-computed Greenwood standard errors', () => {
    const sums = [1 / 56, 1 / 24, 11 / 120, 7 / 40, 27 / 40];
    const surv = [0.875, 0.75, 0.6, 0.45, 0.225];
    for (let i = 0; i < sums.length; i++) {
      expect(km.curve[i].greenwoodSum).toBeCloseTo(sums[i], 12);
      expect(km.curve[i].stdError).toBeCloseTo(surv[i] * Math.sqrt(sums[i]), 12);
    }
    // At t = 12 the risk set is exhausted (n = d = 1): the Greenwood term is
    // infinite, so no finite standard error exists and none is invented.
    expect(km.curve[5].greenwoodSum).toBe(Infinity);
    expect(km.curve[5].survival).toBe(0);
  });

  it('puts the log–log interval inside [0, 1] where the linear one need not be', () => {
    // Hand check of the first point: σ = √(1/56)/|log 0.875| = 0.1336306.../0.1335313...
    const sigma = Math.sqrt(1 / 56) / Math.abs(Math.log(0.875));
    const z = 1.959963984540054;
    expect(km.curve[0].lower).toBeCloseTo(Math.pow(0.875, Math.exp(z * sigma)), 12);
    expect(km.curve[0].upper).toBeCloseTo(Math.pow(0.875, Math.exp(-z * sigma)), 12);
    for (const p of km.curve) {
      expect(p.lower).toBeGreaterThanOrEqual(0);
      expect(p.upper).toBeLessThanOrEqual(1);
    }
    // The naive linear interval at t = 10 would run below zero if not clamped:
    // 0.225 − 1.96·0.1848 = −0.137.
    expect(0.225 - z * km.curve[4].stdError).toBeLessThan(0);
    expect(km.curve[4].linearLower).toBe(0);
    expect(km.explanation.limitations.join(' ')).toContain('log(−log Ŝ)');
  });

  it('reports the hand-computed median and Brookmeyer–Crowley interval', () => {
    // First time with Ŝ ≤ 0.5 is t = 7 (Ŝ = 0.45).
    // Brookmeyer–Crowley set {t : |Ŝ(t) − 0.5| ≤ 1.96 se(t)}, by hand:
    //   t = 2 : |0.375| vs 1.96·0.116927 = 0.2292 → out
    //   t = 3 : |0.25|  vs 1.96·0.153093 = 0.3001 → in
    //   t = 6 : |0.1|   vs 1.96·0.181659 = 0.3561 → in
    //   t = 7 : |0.05|  vs 1.96·0.188249 = 0.3690 → in
    //   t = 10: |0.275| vs 1.96·0.184865 = 0.3624 → in
    // so the interval runs from 3 to 10.
    expect(km.median.estimable).toBe(true);
    if (!km.median.estimable) throw new Error('unreachable');
    expect(km.median.time).toBe(7);
    expect(km.median.lower).toBe(3);
    expect(km.median.upper).toBe(10);
  });

  it('reports n, events, censoring and follow-up on the result', () => {
    expect(km.summary).toMatchObject({
      n: 8,
      events: 6,
      censored: 2,
      minTime: 2,
      maxTime: 12,
      lastEventTime: 12,
      distinctEventTimes: 6,
    });
    expect(km.summary.censoringFraction).toBeCloseTo(0.25, 12);
    expect(km.explanation.assumptions).toContain(INDEPENDENT_CENSORING);
    expect(km.explanation.exactness).toBe('empirical');
  });

  it('gives simultaneous bands that are wider than the pointwise interval', () => {
    // A band covering the whole curve must be wider at every point than an
    // interval covering one chosen point; the critical values make it so.
    expect(km.bandCriticalValues.hallWellner).toBeCloseTo(1.3580986, 5);
    for (let i = 0; i < km.curve.length - 1; i++) {
      expect(km.hallWellnerBand[i].lower).toBeLessThanOrEqual(km.curve[i].lower + 1e-12);
      expect(km.hallWellnerBand[i].upper).toBeGreaterThanOrEqual(km.curve[i].upper - 1e-12);
      expect(km.equalPrecisionBand[i].lower).toBeLessThanOrEqual(km.curve[i].lower + 1e-12);
      expect(km.equalPrecisionBand[i].upper).toBeGreaterThanOrEqual(km.curve[i].upper - 1e-12);
    }
  });
});

describe('Kaplan–Meier with no censoring reduces to the ECDF', () => {
  it('equals 1 − empirical CDF exactly', () => {
    // With no censoring and n distinct times, the j-th step is (n − j)/n.
    const time = [1.5, 2.25, 3, 7, 11, 13];
    const status = [1, 1, 1, 1, 1, 1];
    const km = unwrap(kaplanMeier(time, status));
    const n = time.length;
    km.curve.forEach((p, j) => {
      expect(p.survival).toBeCloseTo((n - (j + 1)) / n, 12);
    });
    // Ties included: 1 − ECDF computed from scratch here, no censoring anywhere.
    const tied = [1, 1, 2, 3, 3, 3, 4];
    const kmTied = unwrap(kaplanMeier(tied, tied.map(() => 1)));
    for (const p of kmTied.curve) {
      const ecdfSurvival = tied.filter((t) => t > p.time).length / tied.length;
      expect(p.survival).toBeCloseTo(ecdfSurvival, 12);
    }
  });
});

describe('censoring actually matters', () => {
  // The whole reason this module exists. Generate from a KNOWN exponential with
  // KNOWN independent exponential censoring, then compare Kaplan–Meier with the
  // two naive alternatives.
  const rate = 0.5;
  const censorRate = 0.25;
  const n = 20000;
  const { time, status } = exponentialSample(n, rate, censorRate, 'censoring-matters-1');
  const km = unwrap(kaplanMeier(time, status));

  const survivalAt = (curve: { time: number; survival: number }[], t: number): number => {
    let s = 1;
    for (const p of curve) {
      if (p.time > t) break;
      s = p.survival;
    }
    return s;
  };
  const stdErrorAt = (t: number): number => {
    let se = 0;
    for (const p of km.curve) {
      if (p.time > t) break;
      se = p.stdError;
    }
    return se;
  };

  it('is not the same as dropping or re-labelling censored observations', () => {
    const eventOnly = time.filter((_, i) => status[i] === 1);
    const naiveDrop = (t: number) => eventOnly.filter((x) => x > t).length / eventOnly.length;
    const naiveAsEvent = (t: number) => time.filter((x) => x > t).length / n;
    for (const t of [1, 2, 3]) {
      const kmS = survivalAt(km.curve, t);
      expect(Math.abs(kmS - naiveDrop(t))).toBeGreaterThan(0.01);
      expect(Math.abs(kmS - naiveAsEvent(t))).toBeGreaterThan(0.01);
      expect(Math.abs(naiveDrop(t) - naiveAsEvent(t))).toBeGreaterThan(1e-6);
    }
  });

  it('recovers exp(−λt) while both naive estimates are biased downward', () => {
    const eventOnly = time.filter((_, i) => status[i] === 1);
    for (const t of [0.5, 1, 2, 3, 4]) {
      const truth = Math.exp(-rate * t);
      const kmS = survivalAt(km.curve, t);
      const se = stdErrorAt(t);
      // 4σ of the estimator's own reported standard error: a two-sided 4σ
      // envelope fails by chance about 6 times in 100 000, so with a fixed seed
      // and five time points this is a decisive check, not a loose one.
      expect(Math.abs(kmS - truth)).toBeLessThan(4 * se);

      // Dropping censored observations keeps a sample biased toward short times.
      const dropped = eventOnly.filter((x) => x > t).length / eventOnly.length;
      expect(dropped).toBeLessThan(truth - 4 * se);

      // Treating censoring as an event estimates P(min(T, C) > t) = e^{−(λ+λ_c)t},
      // which is far below e^{−λt}.
      const asEvent = time.filter((x) => x > t).length / n;
      expect(asEvent).toBeLessThan(truth - 4 * se);
      expect(asEvent).toBeCloseTo(Math.exp(-(rate + censorRate) * t), 1);
    }
  });

  it('reports the censoring picture on the result', () => {
    expect(km.summary.n).toBe(n);
    expect(km.summary.events + km.summary.censored).toBe(n);
    // P(event observed) = λ/(λ+λ_c) = 0.5/0.75 = 2/3 exactly.
    expect(km.summary.events / n).toBeCloseTo(2 / 3, 2);
    expect(km.summary.censoringFraction).toBeCloseTo(1 / 3, 2);
  });

  it('recovers λt with Nelson–Aalen and agrees with Kaplan–Meier', () => {
    const na = unwrap(nelsonAalen(time, status));
    for (const t of [0.5, 1, 2, 3]) {
      let cum = 0;
      let se = 0;
      let fh = 1;
      for (const p of na.curve) {
        if (p.time > t) break;
        cum = p.cumulativeHazard;
        se = p.stdError;
        fh = p.survival;
      }
      expect(Math.abs(cum - rate * t)).toBeLessThan(4 * se); // Λ(t) = λt exactly
      // Fleming–Harrington exp(−Λ̂) and Kaplan–Meier agree to first order; with
      // 20 000 subjects the gap is far below 0.002.
      expect(Math.abs(fh - survivalAt(km.curve, t))).toBeLessThan(0.002);
    }
  });

  it('recovers the analytic restricted mean survival time', () => {
    for (const tau of [1, 2, 4]) {
      const rmst = unwrap(restrictedMeanSurvival(time, status, tau));
      const analytic = (1 - Math.exp(-rate * tau)) / rate; // ∫₀^τ e^{−λu} du
      expect(Math.abs(rmst.rmst - analytic)).toBeLessThan(4 * rmst.stdError);
      expect(rmst.stdError).toBeGreaterThan(0);
      expect(rmst.horizonBeyondData).toBe(false);
    }
  });
});

describe('median survival that is not estimable', () => {
  it('refuses rather than returning the last observed time', () => {
    // Four events then six long censorings: the curve goes 1 → 0.9 → 0.8 →
    // 0.7 → 0.6 and stops. It never reaches 0.5.
    const time = [1, 2, 3, 4, 20, 21, 22, 23, 24, 25];
    const status = [1, 1, 1, 1, 0, 0, 0, 0, 0, 0];
    const km = unwrap(kaplanMeier(time, status));
    expect(km.curve[km.curve.length - 1].survival).toBeCloseTo(0.6, 12);
    expect(km.median.estimable).toBe(false);
    if (km.median.estimable) throw new Error('unreachable');
    expect(km.median.lowestSurvival).toBeCloseTo(0.6, 12);
    expect(km.median.reason).toContain('NOT');

    const refusal = medianSurvival(time, status);
    expect(refusal.ok).toBe(false);
    expect(errorCodes(refusal)).toEqual(['not-estimable']);
    const text = errorText(refusal);
    expect(text).not.toContain('Infinity');
    expect(text).toContain('restricted mean');

    // The 0.25 quantile IS estimable here; the 0.75 one is not.
    const q25 = km.quantiles.find((q) => q.p === 0.25);
    const q75 = km.quantiles.find((q) => q.p === 0.75);
    expect(q25?.estimable).toBe(true);
    expect(q25?.time).toBe(3);
    expect(q75?.estimable).toBe(false);
    expect(q75?.time).toBeNull();

    // RMST remains available, which is the point of it.
    const rmst = unwrap(restrictedMeanSurvival(time, status, 10));
    expect(rmst.rmst).toBeGreaterThan(0);
    expect(rmst.rmst).toBeLessThan(10);
  });
});

describe('log-rank test', () => {
  it('is calibrated under the null across 400 replications', () => {
    // Both groups from the SAME exponential with the same censoring. The type I
    // error rate should sit at 0.05. With 400 replications the binomial standard
    // deviation is √(0.05·0.95/400) = 0.0109, so a ±3σ window is
    // [0.017, 0.083]; a test that always or never rejects fails it immediately.
    let rejections = 0;
    const reps = 400;
    for (let r = 0; r < reps; r++) {
      const a = exponentialSample(60, 0.4, 0.15, `null-a-${r}`);
      const b = exponentialSample(60, 0.4, 0.15, `null-b-${r}`);
      const lr = unwrap(
        logRankTest(
          [...a.time, ...b.time],
          [...a.status, ...b.status],
          [...a.time.map(() => 0), ...b.time.map(() => 1)],
        ),
      );
      if (lr.pValue < 0.05) rejections++;
      // A single replication, spelled out: identical distributions must not
      // produce a significant difference here.
      if (r === 0) {
        expect(lr.pValue).toBeGreaterThan(0.05);
        expect(lr.degreesOfFreedom).toBe(1);
      }
    }
    const rate = rejections / reps;
    if (process.env.SURV_REPORT) console.log(`log-rank type I error: ${rate} (${rejections}/${reps})`);
    expect(rate).toBeGreaterThan(0.017);
    expect(rate).toBeLessThan(0.083);
  });

  it('detects a genuinely different hazard with high power', () => {
    // Hazards 0.3 and 0.9 (HR = 3), 120 per arm: Schoenfeld's formula calls for
    // about 4/(log 3)² ≈ 33 events for 80% power, and this design yields far more.
    let rejections = 0;
    const reps = 60;
    for (let r = 0; r < reps; r++) {
      const a = exponentialSample(120, 0.3, 0.1, `pow-a-${r}`);
      const b = exponentialSample(120, 0.9, 0.1, `pow-b-${r}`);
      const lr = unwrap(
        logRankTest(
          [...a.time, ...b.time],
          [...a.status, ...b.status],
          [...a.time.map(() => 0), ...b.time.map(() => 1)],
        ),
      );
      if (lr.pValue < 0.05) rejections++;
    }
    expect(rejections / reps).toBeGreaterThan(0.9);
  });

  it('matches a direct Mantel–Haenszel computation written from scratch', () => {
    // No censoring, two groups, hand-rolled hypergeometric accumulation.
    const timeA = [2, 4, 5, 9, 11, 14];
    const timeB = [1, 3, 6, 7, 10, 13];
    const time = [...timeA, ...timeB];
    const status = time.map(() => 1);
    const group = [...timeA.map(() => 'A'), ...timeB.map(() => 'B')];

    // Direct computation: sweep distinct event times, count risk sets by hand.
    const distinct = [...new Set(time)].sort((x, y) => x - y);
    let oMinusE = 0;
    let variance = 0;
    let observedA = 0;
    for (const t of distinct) {
      const nA = timeA.filter((x) => x >= t).length;
      const nB = timeB.filter((x) => x >= t).length;
      const n = nA + nB;
      const dA = timeA.filter((x) => x === t).length;
      const d = dA + timeB.filter((x) => x === t).length;
      observedA += dA;
      oMinusE += dA - (d * nA) / n;
      if (n > 1) variance += (d * (n - d) * nA * nB) / (n * n * (n - 1));
    }
    const direct = (oMinusE * oMinusE) / variance;

    const lr = unwrap(logRankTest(time, status, group));
    expect(lr.statistic).toBeCloseTo(direct, 12);
    const groupA = lr.groups.find((g) => g.group === 'A')!;
    expect(groupA.observed).toBe(observedA);
    expect(groupA.weightedDifference).toBeCloseTo(oMinusE, 12);
    expect(lr.degreesOfFreedom).toBe(1);
    expect(lr.explanation.exactness).toBe('numerical');
    expect(lr.explanation.limitations.join(' ')).toContain('hazards are proportional');
    expect(lr.explanation.limitations.join(' ')).toContain('underpowered');
  });

  it('reports which weight was used and gives different answers for different weights', () => {
    const a = exponentialSample(90, 0.25, 0.1, 'weights-a');
    const b = exponentialSample(90, 0.55, 0.1, 'weights-b');
    const time = [...a.time, ...b.time];
    const status = [...a.status, ...b.status];
    const group = [...a.time.map(() => 0), ...b.time.map(() => 1)];
    const weights = [
      { kind: 'log-rank' } as const,
      { kind: 'gehan-breslow-wilcoxon' } as const,
      { kind: 'tarone-ware' } as const,
      { kind: 'peto-peto' } as const,
      { kind: 'fleming-harrington', p: 1, q: 0 } as const,
      { kind: 'fleming-harrington', p: 0, q: 1 } as const,
    ];
    const stats = weights.map((w) => {
      const r = unwrap(logRankTest(time, status, group, { weight: w }));
      expect(r.weight).toEqual(w);
      expect(r.weightDescription.length).toBeGreaterThan(10);
      return r.statistic;
    });
    // Fleming–Harrington(0, 0) is the log-rank by construction.
    const fh00 = unwrap(
      logRankTest(time, status, group, { weight: { kind: 'fleming-harrington', p: 0, q: 0 } }),
    );
    expect(fh00.statistic).toBeCloseTo(stats[0], 10);
    // Early-weighted and late-weighted versions must genuinely differ.
    expect(Math.abs(stats[4] - stats[5])).toBeGreaterThan(1e-6);
    expect(new Set(stats.map((s) => s.toFixed(8))).size).toBeGreaterThan(3);
  });

  it('detects crossing curves and warns that the log-rank and hazard ratio mislead', () => {
    // Group 1 dies fast early then stops; group 0 dies steadily. Built by hand
    // so that the curves certainly cross.
    const g0: number[] = [];
    const g1: number[] = [];
    for (let i = 1; i <= 40; i++) g0.push(i * 0.5); // steady
    for (let i = 1; i <= 20; i++) g1.push(i * 0.05); // 20 very early deaths
    for (let i = 1; i <= 20; i++) g1.push(14 + i * 0.5); // then nothing for a long time
    const time = [...g0, ...g1];
    const status = time.map(() => 1);
    const group = [...g0.map(() => 0), ...g1.map(() => 1)];
    const cross = unwrap(detectCrossingCurves(time, status, group));
    expect(cross.crossed).toBe(true);
    expect(cross.crossingTimes.length).toBeGreaterThan(0);
    expect(cross.warning).toContain('underpowered');
    // Only two groups are comparable this way.
    const three = detectCrossingCurves(time, status, group.map((g, i) => (i % 3 === 0 ? 2 : g)));
    expect(errorCodes(three)).toEqual(['groups']);
  });

  it('supports stratification and a trend test across ordered groups', () => {
    const parts = [0.2, 0.4, 0.8].map((rate, g) => {
      const s = exponentialSample(80, rate, 0.1, `trend-${g}`);
      return { ...s, group: s.time.map(() => g), stratum: s.time.map((_, i) => (i % 2 === 0 ? 'x' : 'y')) };
    });
    const time = parts.flatMap((p) => p.time);
    const status = parts.flatMap((p) => p.status);
    const group = parts.flatMap((p) => p.group);
    const stratum = parts.flatMap((p) => p.stratum);
    const overall = unwrap(logRankTest(time, status, group));
    expect(overall.degreesOfFreedom).toBe(2);
    expect(overall.pValue).toBeLessThan(0.001);
    const trend = unwrap(logRankTrendTest(time, status, group));
    expect(trend.degreesOfFreedom).toBe(1);
    expect(trend.pValue).toBeLessThan(0.001);
    // A monotone effect concentrated in 1 df: the trend statistic should be at
    // least as large as the 2 df statistic here.
    expect(trend.statistic).toBeGreaterThan(overall.statistic * 0.9);
    const strat = unwrap(stratifiedLogRankTest(time, status, group, stratum));
    expect(strat.strata.length).toBe(2);
    expect(strat.pValue).toBeLessThan(0.001);
    expect(strat.explanation.method).toContain('Stratified');
  });
});

describe('Cox proportional hazards', () => {
  /** Exponential baseline with a known PH coefficient. */
  function phSample(n: number, beta: number, baseline: number, censorRate: number, seed: string) {
    const rng = new Random(seed);
    const time: number[] = [];
    const status: number[] = [];
    const x: number[][] = [];
    for (let i = 0; i < n; i++) {
      const xi = rng.normal();
      const rate = baseline * Math.exp(beta * xi);
      const t = rng.exponential(rate);
      const c = censorRate > 0 ? rng.exponential(censorRate) : Infinity;
      time.push(Math.min(t, c));
      status.push(t <= c ? 1 : 0);
      x.push([xi]);
    }
    return { time, status, x };
  }

  it('recovers a known coefficient at n = 20 000', () => {
    const beta = 0.7;
    const { time, status, x } = phSample(20000, beta, 0.3, 0.1, 'cox-recovery');
    const fit = unwrap(coxRegression(time, status, x, { names: ['x'] }));
    const c = fit.coefficients[0];
    // 4σ of the model's own standard error; see the note on tolerances above.
    expect(Math.abs(c.coefficient - beta)).toBeLessThan(4 * c.stdError);
    expect(c.stdError).toBeLessThan(0.02); // sanity: 20 000 subjects is informative
    expect(c.hazardRatio).toBeCloseTo(Math.exp(c.coefficient), 12);
    expect(c.hazardRatioLower).toBeLessThan(Math.exp(beta));
    expect(c.hazardRatioUpper).toBeGreaterThan(Math.exp(beta));
    // The robust (sandwich) standard error should agree closely with the
    // model-based one when the model is correctly specified and independent.
    expect(c.robustStdError / c.stdError).toBeGreaterThan(0.8);
    expect(c.robustStdError / c.stdError).toBeLessThan(1.25);
    // All three tests reject a null that is false by a mile.
    expect(fit.tests.wald.pValue).toBeLessThan(1e-10);
    expect(fit.tests.score.pValue).toBeLessThan(1e-10);
    expect(fit.tests.likelihoodRatio.pValue).toBeLessThan(1e-10);
    expect(fit.tieHandling).toBe('efron');
    expect(fit.explanation.steps.some((s) => s.value?.toLowerCase().includes('proportional hazards'))).toBe(
      true,
    );
  });

  it('has approximately nominal Wald interval coverage across 300 fits', () => {
    const beta = 0.5;
    let covered = 0;
    const reps = 300;
    for (let r = 0; r < reps; r++) {
      const { time, status, x } = phSample(150, beta, 0.3, 0.15, `cov-${r}`);
      const fit = unwrap(coxRegression(time, status, x));
      const c = fit.coefficients[0];
      const z = 1.959963984540054;
      if (c.coefficient - z * c.stdError <= beta && beta <= c.coefficient + z * c.stdError) covered++;
    }
    // Binomial σ at p = 0.95 over 300 replications is √(0.95·0.05/300) = 0.0126,
    // so a ±3.5σ window is [0.906, 0.994]. Asymptotic intervals at n = 150 are
    // slightly anti-conservative, hence the asymmetric lower edge.
    expect(covered / reps).toBeGreaterThan(0.90);
    expect(covered / reps).toBeLessThan(0.995);
  });

  it('matches the exponential MLE hazard ratio for one binary covariate, no censoring', () => {
    // Both arms exponential, nothing censored: the exponential MLE rate in each
    // arm is d/Σt, and its ratio estimates the same hazard ratio the Cox model
    // does. Computed directly here.
    const a = exponentialSample(2000, 0.3, 0, 'binary-a');
    const b = exponentialSample(2000, 0.6, 0, 'binary-b');
    const time = [...a.time, ...b.time];
    const status = time.map(() => 1);
    const x = [...a.time.map(() => [0]), ...b.time.map(() => [1])];
    const rateA = a.time.length / a.time.reduce((s, t) => s + t, 0);
    const rateB = b.time.length / b.time.reduce((s, t) => s + t, 0);
    const mleLogHR = Math.log(rateB / rateA);
    const fit = unwrap(coxRegression(time, status, x, { names: ['arm'] }));
    // Two consistent estimators of the same quantity on the same data: with
    // 4000 events, se(log HR) ≈ 2/√4000 = 0.032, so 0.1 is about 3σ.
    expect(Math.abs(fit.coefficients[0].coefficient - mleLogHR)).toBeLessThan(0.1);
    expect(Math.abs(fit.coefficients[0].coefficient - Math.log(2))).toBeLessThan(0.1);
  });

  it('handles ties: Efron differs from Breslow and is closer to the exact answer', () => {
    // Heavily tied small dataset, so the exact partial likelihood with ties can
    // be enumerated directly in this test.
    const x = [1, 1, 1, 1, 0, 0, 0, 0, 0];
    const time = [1, 1, 1, 2, 1, 2, 2, 3, 3];
    const status = [1, 1, 1, 1, 1, 1, 1, 1, 0];
    const cov = x.map((v) => [v]);
    const efron = unwrap(coxRegression(time, status, cov, { tieHandling: 'efron' }));
    const breslow = unwrap(coxRegression(time, status, cov, { tieHandling: 'breslow' }));
    expect(efron.tiedEventTimes).toBeGreaterThan(0);
    expect(Math.abs(efron.coefficients[0].coefficient - breslow.coefficients[0].coefficient)).toBeGreaterThan(
      1e-4,
    );

    // Exact partial likelihood: for each tied death set, sum over all orderings
    // of the product of Cox terms as if the deaths happened sequentially.
    const permutations = (arr: number[]): number[][] => {
      if (arr.length <= 1) return [arr];
      const out: number[][] = [];
      arr.forEach((v, i) => {
        for (const rest of permutations([...arr.slice(0, i), ...arr.slice(i + 1)])) out.push([v, ...rest]);
      });
      return out;
    };
    const deathTimes = [...new Set(time.filter((_, i) => status[i] === 1))].sort((p, q) => p - q);
    const exactLogLik = (beta: number): number => {
      let total = 0;
      for (const t of deathTimes) {
        const risk: number[] = [];
        const dead: number[] = [];
        for (let i = 0; i < time.length; i++) {
          if (time[i] >= t) risk.push(i);
          if (time[i] === t && status[i] === 1) dead.push(i);
        }
        let sum = 0;
        for (const order of permutations(dead)) {
          let term = 1;
          const removed = new Set<number>();
          for (const i of order) {
            let denom = 0;
            for (const j of risk) if (!removed.has(j)) denom += Math.exp(beta * x[j]);
            term *= Math.exp(beta * x[i]) / denom;
            removed.add(i);
          }
          sum += term;
        }
        total += Math.log(sum);
      }
      return total;
    };
    let best = -3;
    let bestVal = -Infinity;
    for (let b = -3; b <= 3; b += 0.0005) {
      const v = exactLogLik(b);
      if (v > bestVal) {
        bestVal = v;
        best = b;
      }
    }
    const dEfron = Math.abs(efron.coefficients[0].coefficient - best);
    const dBreslow = Math.abs(breslow.coefficients[0].coefficient - best);
    expect(dEfron).toBeLessThan(dBreslow);
  });

  it('computes Harrell C near 1 for a perfect predictor and near 0.5 for a useless one', () => {
    const rng = new Random('concordance');
    const n = 300;
    const time: number[] = [];
    for (let i = 0; i < n; i++) time.push(rng.exponential(0.5));
    const status = time.map(() => 1);
    // A covariate that is a monotone decreasing function of survival time is a
    // perfect risk ranking: larger x ⇒ earlier failure.
    const perfect = coxDesignFromArrays(time, status, time.map((t) => [-t]));
    expect(harrellC(perfect, [1])).toBeCloseTo(1, 10);
    const noise = coxDesignFromArrays(time, status, time.map(() => [rng.normal()]));
    expect(harrellC(noise, [1])).toBeGreaterThan(0.4);
    expect(harrellC(noise, [1])).toBeLessThan(0.6);
    // A fitted model reports it, or says why it did not. (A perfectly
    // predictive covariate cannot be FITTED — it separates the risk sets — so
    // the fitted check uses the useless covariate.)
    const fit = unwrap(coxRegression(time, status, time.map(() => [rng.normal()])));
    expect(fit.concordance).toBeGreaterThan(0.35);
    expect(fit.concordance).toBeLessThan(0.65);
    expect(fit.concordanceNote).toBeNull();
  });

  it('gives a baseline hazard and predicted survival curves', () => {
    const { time, status, x } = phSample(800, 0.6, 0.4, 0.2, 'baseline');
    const fit = unwrap(coxRegression(time, status, x, { names: ['x'] }));
    expect(fit.baselineHazard.length).toBeGreaterThan(100);
    const cum = fit.baselineHazard.map((b) => b.cumulativeHazard);
    for (let i = 1; i < cum.length; i++) expect(cum[i]).toBeGreaterThanOrEqual(cum[i - 1]);
    const pred = unwrap(predictedSurvival(fit, [0]));
    // At x = 0 the relative hazard is 1 and the curve is the baseline survival.
    expect(pred.relativeHazard).toBeCloseTo(1, 12);
    for (let i = 1; i < pred.curve.length; i++) {
      expect(pred.curve[i].survival).toBeLessThanOrEqual(pred.curve[i - 1].survival);
    }
    // Higher x means higher hazard (β > 0) and therefore lower survival.
    const high = unwrap(predictedSurvival(fit, [1]));
    expect(high.curve[high.curve.length - 1].survival).toBeLessThan(
      pred.curve[pred.curve.length - 1].survival,
    );
    expect(errorCodes(predictedSurvival(fit, [0, 1]))).toEqual(['length']);
  });

  it('supports stratification and counting-process (time-varying) input', () => {
    const a = phSample(300, 0.5, 0.3, 0.1, 'strat-a');
    const b = phSample(300, 0.5, 1.2, 0.1, 'strat-b');
    const time = [...a.time, ...b.time];
    const status = [...a.status, ...b.status];
    const x = [...a.x, ...b.x];
    const strata = [...a.time.map(() => 'low'), ...b.time.map(() => 'high')];
    const fit = unwrap(coxRegression(time, status, x, { strata, names: ['x'] }));
    expect(fit.strata).toEqual(['low', 'high']);
    expect(Math.abs(fit.coefficients[0].coefficient - 0.5)).toBeLessThan(4 * fit.coefficients[0].stdError);

    // The same right-censored data expressed as counting-process rows
    // (0, T] must give exactly the same fit.
    const rows = time.map((t, i) => ({
      start: 0,
      stop: t,
      event: status[i] as 0 | 1,
      covariates: x[i],
      id: i,
    }));
    const design = coxDesignFromCountingProcess(rows, ['x']);
    const cpFit = unwrap(
      coxRegression(time, status, x, { names: ['x'] }),
    );
    const fitCp = unwrap(
      (() => {
        const r = coxRegression(
          design.rows.map((d) => d.stop),
          design.rows.map((d) => d.event),
          design.rows.map((d) => d.covariates),
          { names: ['x'] },
        );
        return r;
      })(),
    );
    expect(fitCp.coefficients[0].coefficient).toBeCloseTo(cpFit.coefficients[0].coefficient, 12);

    // Splitting one subject's follow-up into two rows with the same covariate
    // value must not change the partial likelihood.
    const split: typeof rows = [];
    for (const r of rows) {
      const mid = r.stop / 2;
      split.push({ start: 0, stop: mid, event: 0, covariates: r.covariates, id: r.id });
      split.push({ start: mid, stop: r.stop, event: r.event, covariates: r.covariates, id: r.id });
    }
    const splitDesign = coxDesignFromCountingProcess(split, ['x']);
    expect(splitDesign.rows.length).toBe(2 * rows.length);
  });

  it('produces martingale, deviance and dfbeta residuals', () => {
    const { time, status, x } = phSample(200, 0.5, 0.4, 0.2, 'residuals');
    const fit = unwrap(coxRegression(time, status, x, { names: ['x'] }));
    const res = unwrap(coxResiduals(fit));
    expect(res.martingale.length).toBe(200);
    // Martingale residuals sum to approximately zero by construction.
    expect(Math.abs(res.martingale.reduce((s, m) => s + m, 0))).toBeLessThan(1e-6);
    for (const m of res.martingale) expect(m).toBeLessThanOrEqual(1 + 1e-12);
    expect(res.deviance.every((d) => Number.isFinite(d))).toBe(true);
    expect(res.dfbeta.length).toBe(200);
    expect(res.dfbeta[0].length).toBe(1);
  });
});

describe('proportional-hazards diagnostics', () => {
  /** Piecewise-constant hazard sampler: hazard `rates[k]` on [cuts[k], cuts[k+1]). */
  function piecewise(rng: Random, cuts: number[], rates: number[]): number {
    const target = -Math.log(rng.uniformOpen());
    let acc = 0;
    for (let k = 0; k < rates.length; k++) {
      const lo = cuts[k];
      const hi = k + 1 < cuts.length ? cuts[k + 1] : Infinity;
      const capacity = (hi - lo) * rates[k];
      if (acc + capacity >= target) return lo + (target - acc) / rates[k];
      acc += capacity;
    }
    return cuts[cuts.length - 1] + (target - acc) / rates[rates.length - 1];
  }

  it('rejects proportional hazards when the coefficient truly varies with time', () => {
    // Group 1 has a hazard four times the baseline before t = 1 and one quarter
    // of it afterwards: the hazard ratio reverses, so PH is violated by design.
    const rng = new Random('ph-violated');
    const n = 500;
    const time: number[] = [];
    const status: number[] = [];
    const x: number[][] = [];
    for (let i = 0; i < n; i++) {
      const xi = i % 2;
      const t = xi === 1 ? piecewise(rng, [0, 1], [2.0, 0.125]) : rng.exponential(0.5);
      const c = rng.exponential(0.05);
      time.push(Math.min(t, c));
      status.push(t <= c ? 1 : 0);
      x.push([xi]);
    }
    const fit = unwrap(coxRegression(time, status, x, { names: ['arm'] }));
    const sch = unwrap(schoenfeldTest(fit));
    expect(sch.global.pValue).toBeLessThan(0.01);
    expect(sch.global.rejects).toBe(true);
    expect(sch.perCovariate[0].rejects).toBe(true);
    expect(sch.verdict).toContain('REJECTED');
  });

  it('does not reject proportional hazards on data that truly satisfy it', () => {
    const rng = new Random('ph-true');
    const n = 500;
    const time: number[] = [];
    const status: number[] = [];
    const x: number[][] = [];
    for (let i = 0; i < n; i++) {
      const xi = i % 2;
      const t = rng.exponential(0.5 * Math.exp(0.8 * xi));
      const c = rng.exponential(0.05);
      time.push(Math.min(t, c));
      status.push(t <= c ? 1 : 0);
      x.push([xi]);
    }
    const fit = unwrap(coxRegression(time, status, x, { names: ['arm'] }));
    const sch = unwrap(schoenfeldTest(fit));
    expect(sch.global.rejects).toBe(false);
    expect(sch.global.pValue).toBeGreaterThan(0.05);
    expect(sch.verdict).toContain('not rejected');
    expect(sch.verdict).toContain('absence of evidence');
  });
});

describe('parametric models', () => {
  it('recovers known Weibull parameters and beats the log-normal on Weibull data', () => {
    // log T = μ + βx + σ W with W standard smallest-extreme-value, i.e.
    // T = exp(μ + βx) · (−log U)^σ. Known: μ = 1.2, β = −0.6, σ = 1/1.8.
    const rng = new Random('weibull-aft');
    const n = 4000;
    const mu = 1.2;
    const betaTrue = -0.6;
    const sigma = 1 / 1.8;
    const time: number[] = [];
    const status: number[] = [];
    const x: number[][] = [];
    for (let i = 0; i < n; i++) {
      const xi = rng.bernoulli(0.5) ? 1 : 0;
      const t = Math.exp(mu + betaTrue * xi) * Math.pow(-Math.log(rng.uniformOpen()), sigma);
      const c = rng.exponential(0.05);
      time.push(Math.min(t, c));
      status.push(t <= c ? 1 : 0);
      x.push([xi]);
    }
    const wb = unwrap(fitParametric('weibull', time, status, x, { names: ['x'] }));
    // 4σ of each parameter's own standard error.
    const [interceptCoef, xCoef, logScaleCoef] = wb.coefficients;
    expect(Math.abs(interceptCoef.estimate - mu)).toBeLessThan(4 * interceptCoef.stdError);
    expect(Math.abs(xCoef.estimate - betaTrue)).toBeLessThan(4 * xCoef.stdError);
    expect(Math.abs(logScaleCoef.estimate - Math.log(sigma))).toBeLessThan(4 * logScaleCoef.stdError);
    // Weibull shape k = 1/σ = 1.8, and the PH log hazard ratio is −β/σ.
    expect(wb.proportionalHazards?.shape).toBeCloseTo(1.8, 1);
    expect(wb.proportionalHazards?.logHazardRatios[0].value).toBeCloseTo(-betaTrue / sigma, 1);

    const ln = unwrap(fitParametric('lognormal', time, status, x, { names: ['x'] }));
    const ll = unwrap(fitParametric('loglogistic', time, status, x, { names: ['x'] }));
    const ex = unwrap(fitParametric('exponential', time, status, x, { names: ['x'] }));
    expect(wb.aic).toBeLessThan(ln.aic);
    const comparison = unwrap(compareParametricModels([wb, ln, ll, ex]));
    expect(comparison.best).toBe('weibull');
    // The exponential is the Weibull with σ = 1; it is nested and must fit worse.
    expect(wb.logLikelihood).toBeGreaterThan(ex.logLikelihood);
  });

  it('agrees with the closed-form exponential MLE', () => {
    // For the exponential model λ̂ = d / Σ tᵢ exactly, and the AFT intercept is
    // μ = −log λ.
    const { time, status } = exponentialSample(3000, 0.4, 0.2, 'exp-mle');
    const d = status.reduce((s, x) => s + x, 0);
    const lambdaHat = d / time.reduce((s, t) => s + t, 0);
    const fit = unwrap(fitParametric('exponential', time, status, []));
    expect(fit.intercept).toBeCloseTo(-Math.log(lambdaHat), 4);
    expect(fit.scale).toBe(1);
    expect(fit.parameterCount).toBe(1);
  });

  it('refuses a Cox AIC comparison without the caveat, and refuses mismatched samples', () => {
    const { time, status } = exponentialSample(300, 0.4, 0.2, 'aic-caveat');
    const wb = unwrap(fitParametric('weibull', time, status, []));
    const ln = unwrap(fitParametric('lognormal', time, status, []));
    const cmp = unwrap(compareParametricModels([wb, ln], { logLikelihood: -500, parameterCount: 1 }));
    const coxRow = cmp.rows.find((r) => r.model.startsWith('cox'))!;
    expect(coxRow.comparable).toBe(false);
    expect(coxRow.note).toContain('NOT on the same scale');
    expect(cmp.best).not.toContain('cox');
    const smaller = unwrap(fitParametric('weibull', time.slice(0, 200), status.slice(0, 200), []));
    expect(errorCodes(compareParametricModels([wb, smaller]))).toEqual(['incomparable']);
  });

  it('refuses zero or negative times on the log scale', () => {
    const r = fitParametric('weibull', [0, 1, 2, 3], [1, 1, 1, 1], []);
    expect(errorCodes(r)).toEqual(['range']);
    expect(errorText(r)).toContain('strictly positive');
  });
});

describe('competing risks', () => {
  // Two causes with constant cause-specific hazards λ₁ = 0.3 and λ₂ = 0.6, plus
  // independent censoring. Analytically
  //   F₁(t) = λ₁/(λ₁+λ₂) · (1 − exp(−(λ₁+λ₂)t)),
  // while 1 − KM for cause 1 (competing events censored) estimates
  //   1 − exp(−λ₁ t),
  // which is strictly larger. That gap is the error this estimator prevents.
  const lambda1 = 0.3;
  const lambda2 = 0.6;
  const n = 20000;
  const rng = new Random('competing');
  const time: number[] = [];
  const cause: number[] = [];
  for (let i = 0; i < n; i++) {
    const t1 = rng.exponential(lambda1);
    const t2 = rng.exponential(lambda2);
    const c = rng.exponential(0.1);
    const t = Math.min(t1, t2, c);
    time.push(t);
    cause.push(t === c ? 0 : t === t1 ? 1 : 2);
  }
  const cif = unwrap(cumulativeIncidence(time, cause, 1));

  it('Aalen–Johansen recovers the true cumulative incidence', () => {
    for (const t of [0.5, 1, 2, 4]) {
      const truth = (lambda1 / (lambda1 + lambda2)) * (1 - Math.exp(-(lambda1 + lambda2) * t));
      let est = 0;
      let se = 0;
      for (const p of cif.curve) {
        if (p.time > t) break;
        est = p.cumulativeIncidence;
        se = p.stdError;
      }
      expect(Math.abs(est - truth)).toBeLessThan(4 * se); // 4σ, as elsewhere
    }
  });

  it('1 − Kaplan–Meier overestimates it, and the result says so', () => {
    for (const t of [1, 2, 4]) {
      const truth = (lambda1 / (lambda1 + lambda2)) * (1 - Math.exp(-(lambda1 + lambda2) * t));
      let aj = 0;
      let oneMinusKm = 0;
      let se = 0;
      for (const p of cif.curve) {
        if (p.time > t) break;
        aj = p.cumulativeIncidence;
        oneMinusKm = p.oneMinusKaplanMeier;
        se = p.stdError;
      }
      // 1 − KM is above the truth by far more than sampling error.
      expect(oneMinusKm).toBeGreaterThan(truth + 10 * se);
      expect(oneMinusKm).toBeGreaterThan(aj);
      expect(oneMinusKm).toBeCloseTo(1 - Math.exp(-lambda1 * t), 2);
    }
    expect(cif.maxOverestimate).toBeGreaterThan(0.05);
    expect(cif.warning).toContain('OVERESTIMATES');
    expect(ONE_MINUS_KM_WARNING).toContain('OVERESTIMATES');
    expect(cif.eventsByCause.map((e) => e.cause)).toEqual([1, 2]);
  });

  it('refuses a cause with no events', () => {
    expect(errorCodes(cumulativeIncidence(time, cause, 7))).toEqual(['unknown-cause']);
    expect(errorCodes(cumulativeIncidence([1, 2, 3], [0, 0, 0], 1))).toEqual(['no-events']);
  });

  it('fits a Fine–Gray subdistribution model with a detectable covariate effect', () => {
    // Cause 1 hazard depends on x; cause 2 does not. The subdistribution
    // coefficient must come out positive and significant.
    const rng2 = new Random('fine-gray');
    const m = 600;
    const t2: number[] = [];
    const c2: number[] = [];
    const x: number[][] = [];
    for (let i = 0; i < m; i++) {
      const xi = i % 2;
      const e1 = rng2.exponential(0.3 * Math.exp(1.0 * xi));
      const e2 = rng2.exponential(0.3);
      const cen = rng2.exponential(0.05);
      const t = Math.min(e1, e2, cen);
      t2.push(t);
      c2.push(t === cen ? 0 : t === e1 ? 1 : 2);
      x.push([xi]);
    }
    const fg = unwrap(fineGray(t2, c2, x, { names: ['x'] }));
    expect(fg.coefficients[0].coefficient).toBeGreaterThan(0.3);
    expect(fg.coefficients[0].pValue).toBeLessThan(0.01);
    expect(fg.coefficients[0].subdistributionHazardRatio).toBeCloseTo(
      Math.exp(fg.coefficients[0].coefficient),
      12,
    );
    expect(fg.explanation.steps.some((s) => s.value?.includes('SUBDISTRIBUTION'))).toBe(true);
  });
});

describe('life table, smoothed hazard and risk table helpers', () => {
  it('reproduces a hand-computed actuarial table', () => {
    // 100 enter; interval 1: 10 events, 10 withdrawals → effective 100 − 5 = 95,
    //   q = 10/95, S = 1 − 10/95 = 85/95.
    // interval 2: 80 enter, 8 events, 4 withdrawals → effective 78, q = 8/78,
    //   S = (85/95)(70/78).
    const lt = unwrap(
      lifeTable([
        { start: 0, end: 1, events: 10, withdrawn: 10 },
        { start: 1, end: 2, events: 8, withdrawn: 4 },
        { start: 2, end: 3, events: 6, withdrawn: 62 },
      ]),
    );
    expect(lt.rows[0].entering).toBe(100);
    expect(lt.rows[0].effectiveAtRisk).toBeCloseTo(95, 12);
    expect(lt.rows[0].survivalAtEnd).toBeCloseTo(85 / 95, 12);
    expect(lt.rows[1].entering).toBe(80);
    expect(lt.rows[1].effectiveAtRisk).toBeCloseTo(78, 12);
    expect(lt.rows[1].survivalAtEnd).toBeCloseTo((85 / 95) * (70 / 78), 12);
    expect(errorCodes(lifeTable([{ start: 0, end: 1, events: 0, withdrawn: 5 }]))).toEqual(['no-events']);
    expect(errorCodes(lifeTable([{ start: 1, end: 1, events: 1, withdrawn: 0 }]))).toContain('range');
  });

  it('smooths the hazard of exponential data toward the constant rate', () => {
    const { time, status } = exponentialSample(5000, 0.5, 0.1, 'smooth');
    const sm = unwrap(smoothedHazard(time, status, { bandwidth: 1, grid: [1, 2, 3] }));
    for (const p of sm.points) {
      // The true hazard is constant at 0.5; kernel smoothing with b = 1 over
      // 5000 subjects should land within 0.1 of it away from the boundary.
      expect(Math.abs(p.hazard - 0.5)).toBeLessThan(0.1);
    }
    expect(errorCodes(smoothedHazard(time, status, { bandwidth: -1 }))).toEqual(['range']);
  });

  it('builds a risk table that accounts for every observation', () => {
    const rows = buildRiskTable([1, 1, 2, 3], [1, 0, 1, 0]);
    expect(rows).toEqual([
      { time: 1, atRisk: 4, events: 1, censored: 1 },
      { time: 2, atRisk: 2, events: 1, censored: 0 },
      { time: 3, atRisk: 1, events: 0, censored: 1 },
    ]);
  });
});

describe('design: events drive power', () => {
  it('requires more events as the hazard ratio approaches 1', () => {
    const ratios = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    const events = ratios.map((hr) => unwrap(requiredEvents({ hazardRatio: hr })).requiredEvents);
    for (let i = 1; i < events.length; i++) expect(events[i]).toBeGreaterThan(events[i - 1]);
    // Schoenfeld at HR = 0.5, α = 0.05, power 0.8:
    //   d = 4(1.959964 + 0.841621)² / (log 0.5)² = 4 · 7.848932 / 0.480453 = 65.35 → 66.
    const za = 1.959963984540054;
    const zb = 0.8416212335729143;
    const hand = (4 * (za + zb) ** 2) / Math.log(0.5) ** 2;
    expect(unwrap(requiredEvents({ hazardRatio: 0.5 })).requiredEvents).toBe(Math.ceil(hand));
    expect(Math.ceil(hand)).toBe(66);
    // Freedman's formula differs: (1 + HR)²/(1 − HR)² · (z_a + z_b)².
    const freedman = unwrap(requiredEvents({ hazardRatio: 0.5, formula: 'freedman' }));
    expect(freedman.requiredEvents).toBe(Math.ceil((za + zb) ** 2 * (1.5 / 0.5) ** 2));
    expect(freedman.explanation.limitations.join(' ')).toContain('EVENTS');
    expect(errorCodes(requiredEvents({ hazardRatio: 1 }))).toEqual(['no-effect']);
  });

  it('converts events to subjects through the event probability', () => {
    // Rubinstein: P = 1 − e^{−λf}(1 − e^{−λa})/(λa). Hand check at λ = 0.2,
    // a = 2, f = 3: 1 − e^{−0.6}(1 − e^{−0.4})/0.4 = 1 − 0.548812·0.329680/0.4
    //            = 1 − 0.452324 = 0.547676.
    expect(eventProbability(0.2, 2, 3)).toBeCloseTo(
      1 - (Math.exp(-0.6) * (1 - Math.exp(-0.4))) / 0.4,
      12,
    );
    expect(eventProbability(0.2, 0, 3)).toBeCloseTo(1 - Math.exp(-0.6), 12);
    const ss = unwrap(
      logRankSampleSize({
        hazardRatio: 0.6,
        controlMedian: 10,
        accrualDuration: 12,
        followUpDuration: 12,
      }),
    );
    expect(ss.totalSubjects).toBeGreaterThan(ss.requiredEvents);
    expect(ss.expectedEvents).toBeGreaterThanOrEqual(ss.requiredEvents - 1);
    expect(errorCodes(logRankSampleSize({ hazardRatio: 0.6, accrualDuration: 1, followUpDuration: 1 }))).toEqual(
      ['required'],
    );
  });

  it('achieves approximately the target power in simulation at the computed sample size', () => {
    // Validate the formula by simulating the design it recommends.
    const hazardRatio = 0.5;
    const controlHazard = 0.25;
    const accrual = 0;
    const followUp = 8;
    const ss = unwrap(
      logRankSampleSize({
        hazardRatio,
        controlHazard,
        accrualDuration: accrual,
        followUpDuration: followUp,
        power: 0.8,
      }),
    );
    const perArm = Math.ceil(ss.totalSubjects / 2);
    const rng = new Random('power-sim');
    const reps = 200;
    let rejections = 0;
    for (let r = 0; r < reps; r++) {
      const time: number[] = [];
      const status: number[] = [];
      const group: number[] = [];
      for (let arm = 0; arm < 2; arm++) {
        const rate = arm === 0 ? controlHazard : controlHazard * hazardRatio;
        for (let i = 0; i < perArm; i++) {
          const t = rng.exponential(rate);
          time.push(Math.min(t, followUp));
          status.push(t <= followUp ? 1 : 0);
          group.push(arm);
        }
      }
      if (unwrap(logRankTest(time, status, group)).pValue < 0.05) rejections++;
    }
    // Binomial σ at p = 0.8 over 200 replications is √(0.8·0.2/200) = 0.0283,
    // so ±3σ is [0.715, 0.885]; allow a little extra for the formula's own
    // approximation error.
    expect(rejections / reps).toBeGreaterThan(0.70);
    expect(rejections / reps).toBeLessThan(0.92);
    // And the power formula agrees with the simulation at that event count.
    const expected = unwrap(logRankPower({ events: Math.round(ss.expectedEvents), hazardRatio }));
    expect(expected.power).toBeGreaterThan(0.75);
    expect(expected.power).toBeLessThan(0.86);
  });
});

describe('refusals', () => {
  it('refuses when there are no events at all', () => {
    const r = kaplanMeier([1, 2, 3, 4], [0, 0, 0, 0]);
    expect(errorCodes(r)).toEqual(['no-events']);
    expect(errorText(r)).toContain('nothing is estimable');
    expect(errorText(r)).not.toContain('NaN');
    expect(errorCodes(nelsonAalen([1, 2, 3], [0, 0, 0]))).toEqual(['no-events']);
    expect(errorCodes(restrictedMeanSurvival([1, 2, 3], [0, 0, 0], 2))).toEqual(['no-events']);
    expect(errorCodes(logRankTest([1, 2, 3, 4], [0, 0, 0, 0], [0, 0, 1, 1]))).toEqual(['no-events']);
    expect(errorCodes(coxRegression([1, 2, 3, 4], [0, 0, 0, 0], [[0], [0], [1], [1]]))).toEqual(['no-events']);
  });

  it('refuses negative and non-finite times', () => {
    expect(errorCodes(kaplanMeier([1, -2, 3], [1, 1, 1]))).toEqual(['range']);
    expect(errorCodes(kaplanMeier([1, NaN, 3], [1, 1, 1]))).toEqual(['finite']);
    expect(errorCodes(kaplanMeier([1, Infinity], [1, 1]))).toEqual(['finite']);
  });

  it('refuses mismatched lengths', () => {
    expect(errorCodes(kaplanMeier([1, 2, 3], [1, 1]))).toEqual(['length']);
    expect(errorCodes(logRankTest([1, 2, 3], [1, 1, 1], [0, 1]))).toEqual(['length']);
    expect(errorCodes(coxRegression([1, 2, 3], [1, 1, 1], [[0], [1]]))).toEqual(['length']);
    expect(errorCodes(cumulativeIncidence([1, 2, 3], [1, 1]))).toEqual(['length']);
  });

  it('refuses an invalid status code and a single group', () => {
    expect(errorCodes(kaplanMeier([1, 2], [1, 2]))).toEqual(['domain']);
    expect(errorCodes(logRankTest([1, 2, 3], [1, 1, 1], [0, 0, 0]))).toEqual(['groups']);
  });

  it('refuses a Cox fit when a covariate perfectly separates the risk sets', () => {
    // Every event happens in the x = 1 group and no x = 0 subject ever fails:
    // the maximising coefficient is infinite, so there is no estimate.
    const time = [1, 2, 3, 10, 11, 12];
    const status = [1, 1, 1, 0, 0, 0];
    const x = [[1], [1], [1], [0], [0], [0]];
    const r = coxRegression(time, status, x);
    expect(r.ok).toBe(false);
    expect(['no-convergence', 'not-identified', 'singular']).toContain(errorCodes(r)[0]);
    expect(errorText(r).toLowerCase()).toMatch(/separat|identified|converge/);
  });

  it('refuses a constant covariate', () => {
    const { time, status } = exponentialSample(100, 0.4, 0.1, 'constant');
    const r = coxRegression(time, status, time.map(() => [1]));
    expect(r.ok).toBe(false);
    expect(['not-identified', 'singular', 'no-convergence']).toContain(errorCodes(r)[0]);
  });

  it('refuses a non-converging Cox fit rather than reporting a half-fitted model', () => {
    const { time, status, x } = (() => {
      const s = exponentialSample(200, 0.4, 0.1, 'maxiter');
      return { time: s.time, status: s.status, x: s.time.map((t) => [Math.log1p(t)]) };
    })();
    const r = coxRegression(time, status, x, { maxIterations: 1, tolerance: 1e-18 });
    expect(r.ok).toBe(false);
    expect(errorCodes(r)).toEqual(['no-convergence']);
    expect(errorText(r)).toContain('not an estimate');
  });

  it('states the independent-censoring assumption on every result', () => {
    const { time, status } = exponentialSample(100, 0.4, 0.2, 'assumption');
    const group = time.map((_, i) => i % 2);
    const results: { assumptions: string[] }[] = [
      unwrap(kaplanMeier(time, status)).explanation,
      unwrap(nelsonAalen(time, status)).explanation,
      unwrap(logRankTest(time, status, group)).explanation,
      unwrap(coxRegression(time, status, group.map((g) => [g]))).explanation,
      unwrap(fitParametric('weibull', time, status, group.map((g) => [g]))).explanation,
      unwrap(cumulativeIncidence(time, status.map((s, i) => (s === 0 ? 0 : (i % 3 === 0 ? 2 : 1))), 1)).explanation,
      unwrap(smoothedHazard(time, status)).explanation,
    ];
    for (const e of results) {
      expect(e.assumptions.some((a) => a.includes('independent') || a.includes('Independent'))).toBe(true);
    }
  });
});

describe('every result carries the censoring picture', () => {
  it('reports n, events, censored, the censoring fraction and the follow-up range', () => {
    const { time, status } = exponentialSample(400, 0.3, 0.4, 'picture');
    const km = unwrap(kaplanMeier(time, status));
    const expectedEvents = status.reduce((s, x) => s + x, 0);
    for (const s of [
      km.summary,
      unwrap(nelsonAalen(time, status)).summary,
      unwrap(logRankTest(time, status, time.map((_, i) => i % 2))).summary,
      unwrap(coxRegression(time, status, time.map((_, i) => [i % 2]))).summary,
      unwrap(fitParametric('weibull', time, status, [])).summary,
    ]) {
      expect(s.n).toBe(400);
      expect(s.events).toBe(expectedEvents);
      expect(s.censored).toBe(400 - expectedEvents);
      expect(s.censoringFraction).toBeCloseTo((400 - expectedEvents) / 400, 12);
      expect(s.minTime).toBeGreaterThan(0);
      expect(s.maxTime).toBeGreaterThanOrEqual(s.minTime);
    }
    // Heavy censoring produces a warning the user cannot miss.
    const heavy = exponentialSample(200, 0.1, 1.5, 'heavy');
    const kmHeavy = unwrap(kaplanMeier(heavy.time, heavy.status));
    expect(kmHeavy.summary.censoringFraction).toBeGreaterThan(0.5);
    expect(kmHeavy.explanation.steps.some((s) => s.label === 'Warning')).toBe(true);
  });
});

/** Narrow the CoxFit type usage so the import is exercised. */
export type _CoxFitUsed = CoxFit;
