/**
 * Tests for the analytic queueing engine.
 *
 * Every reference value is independent of this implementation: hand-computed
 * closed forms (shown in comments), analytic identities between models
 * (M/G/1 with C_s² = 1 must BE M/M/1; M/D/1 must be exactly half of M/M/1),
 * standard telephony table values for Erlang B, and a direct factorial
 * evaluation used to validate the stable recursion before it is trusted at
 * large c.
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from '../core/result';
import {
  QUEUE_MODELS,
  analyseFinitePopulation,
  analyseGgc,
  analyseJacksonNetwork,
  analyseMd1,
  analyseMg1,
  analyseMm1,
  analyseMm1K,
  analyseMmc,
  analyseMmcK,
  analyseMmcc,
  analyseMmInfinity,
  analysePriority,
  compareWithSimulation,
  erlangB,
  erlangBDirect,
  erlangC,
  getQueueModel,
  littlesLaw,
  optimiseServerCount,
  planCapacity,
  utilisationCurve,
} from './index';
import type { QueueAnalysis } from './types';

const TIGHT = 1e-12;
const LITTLE = 1e-10;

function expectLittlesLaw(a: QueueAnalysis, label: string): void {
  const { metrics } = a;
  // L = λW and Lq = λWq, with the EFFECTIVE arrival rate.
  expect(Math.abs(metrics.L - metrics.effectiveArrivalRate * metrics.W), `${label}: L = λW`).toBeLessThan(LITTLE);
  expect(Math.abs(metrics.Lq - metrics.effectiveArrivalRate * metrics.Wq), `${label}: Lq = λWq`).toBeLessThan(LITTLE);
  expect(metrics.littlesLaw.holds, `${label}: reported check`).toBe(true);
  expect(metrics.littlesLaw.arrivalRate).toBeCloseTo(metrics.effectiveArrivalRate, 12);
}

describe('M/M/1', () => {
  // Hand computation, λ = 8, μ = 10:
  //   ρ = 8/10 = 0.8
  //   L  = ρ/(1−ρ)  = 0.8/0.2 = 4
  //   Lq = ρ²/(1−ρ) = 0.64/0.2 = 3.2
  //   W  = 1/(μ−λ)  = 1/2 = 0.5
  //   Wq = ρ/(μ−λ)  = 0.8/2 = 0.4
  it('matches the hand-computed worked example', () => {
    const { metrics } = analyseMm1({ arrivalRate: 8, serviceRate: 10 });
    expect(metrics.utilisation).toBeCloseTo(0.8, 12);
    expect(Math.abs(metrics.utilisation - 0.8)).toBeLessThan(TIGHT);
    expect(Math.abs(metrics.L - 4)).toBeLessThan(TIGHT);
    expect(Math.abs(metrics.Lq - 3.2)).toBeLessThan(TIGHT);
    expect(Math.abs(metrics.W - 0.5)).toBeLessThan(TIGHT);
    expect(Math.abs(metrics.Wq - 0.4)).toBeLessThan(TIGHT);
  });

  it('reports the geometric number-in-system distribution', () => {
    const { metrics } = analyseMm1({ arrivalRate: 8, serviceRate: 10 });
    // P(n) = (1−ρ)ρⁿ: P(0) = 0.2, P(1) = 0.16, P(2) = 0.128.
    expect(Math.abs(metrics.distribution[0].p - 0.2)).toBeLessThan(TIGHT);
    expect(Math.abs(metrics.distribution[1].p - 0.16)).toBeLessThan(TIGHT);
    expect(Math.abs(metrics.distribution[2].p - 0.128)).toBeLessThan(TIGHT);
  });

  it('gives the exact waiting-time distribution', () => {
    const a = analyseMm1({ arrivalRate: 8, serviceRate: 10 });
    const queueWait = a.queueWait;
    const systemTime = a.systemTime;
    if (!queueWait || !systemTime) throw new Error('expected both waiting-time laws');
    // Total wait is exponential with rate μ − λ = 2: P(T > 1) = e^(−2).
    expect(Math.abs(systemTime.tail(1) - Math.exp(-2))).toBeLessThan(TIGHT);
    expect(Math.abs(systemTime.mean - 0.5)).toBeLessThan(TIGHT);
    // Queue wait: P(Wq > t) = ρ·e^(−2t); P(Wq > 0) = ρ = 0.8.
    expect(Math.abs(queueWait.tail(0) - 0.8)).toBeLessThan(TIGHT);
    expect(Math.abs(queueWait.tail(1.5) - 0.8 * Math.exp(-3))).toBeLessThan(TIGHT);
    // Its mean equals Wq.
    expect(Math.abs(queueWait.mean - a.metrics.Wq)).toBeLessThan(TIGHT);
    // Mass at zero is 1 − ρ.
    expect(Math.abs(queueWait.atomAtZero - 0.2)).toBeLessThan(TIGHT);
  });

  it('numerically integrates P(wait > t) back to the mean wait', () => {
    const a = analyseMm1({ arrivalRate: 8, serviceRate: 10 });
    const wait = a.queueWait;
    if (!wait) throw new Error('expected a queue-wait law');
    // E[Wq] = ∫₀^∞ P(Wq > t) dt, by Simpson's rule on [0, 40] (tail < 1e-34).
    const n = 20000;
    const h = 40 / n;
    let sum = wait.tail(0) + wait.tail(40);
    for (let i = 1; i < n; i++) sum += (i % 2 === 0 ? 2 : 4) * wait.tail(i * h);
    expect((sum * h) / 3).toBeCloseTo(a.metrics.Wq, 10);
  });

  it('inverts its own tail at the quantiles', () => {
    const wait = analyseMm1({ arrivalRate: 8, serviceRate: 10 }).queueWait;
    if (!wait) throw new Error('expected a queue-wait law');
    for (const p of [0.1, 0.2, 0.5, 0.9, 0.99]) {
      const q = wait.quantile(p);
      if (p <= 0.2) {
        expect(q).toBe(0); // atom at zero holds 1 − ρ = 0.2 of the mass
      } else {
        expect(1 - wait.tail(q)).toBeCloseTo(p, 12);
      }
    }
    // The 95th percentile of the total wait: −ln(0.05)/2.
    const systemTime = analyseMm1({ arrivalRate: 8, serviceRate: 10 }).systemTime;
    if (!systemTime) throw new Error('expected a system-time law');
    expect(systemTime.quantile(0.95)).toBeCloseTo(-Math.log(0.05) / 2, 12);
    expect(() => systemTime.quantile(1)).toThrow(EngineError);
  });

  it('refuses an unstable configuration instead of returning a number', () => {
    for (const [lambda, mu] of [
      [10, 10],
      [12, 10],
    ]) {
      expect(() => analyseMm1({ arrivalRate: lambda, serviceRate: mu })).toThrow(EngineError);
      try {
        analyseMm1({ arrivalRate: lambda, serviceRate: mu });
        throw new Error('should not reach here');
      } catch (e) {
        expect(e).toBeInstanceOf(EngineError);
        const err = e as EngineError;
        expect(err.message).toMatch(/grows without bound/);
        expect(err.message).toMatch(/no steady state/);
        expect(err.issues[0].code).toBe('unstable');
      }
    }
  });

  it('refuses negative or zero rates', () => {
    expect(() => analyseMm1({ arrivalRate: -1, serviceRate: 10 })).toThrow(EngineError);
    expect(() => analyseMm1({ arrivalRate: 1, serviceRate: 0 })).toThrow(EngineError);
    expect(() => analyseMm1({ arrivalRate: Number.NaN, serviceRate: 10 })).toThrow(EngineError);
  });

  it('states its assumptions and reports exactness', () => {
    const a = analyseMm1({ arrivalRate: 8, serviceRate: 10 });
    expect(a.explanation.exactness).toBe('exact');
    expect(a.explanation.assumptions.join(' ')).toMatch(/Poisson/);
    expect(a.explanation.assumptions.join(' ')).toMatch(/exponential/i);
    expect(a.explanation.assumptions.join(' ')).toMatch(/first-come first-served/);
    expect(a.explanation.assumptions.join(' ')).toMatch(/steady-state|steady state/);
  });
});

describe('M/M/c', () => {
  it('reduces exactly to M/M/1 at c = 1', () => {
    for (const [lambda, mu] of [
      [8, 10],
      [1, 3],
      [0.5, 0.75],
      [99, 100],
    ]) {
      const one = analyseMm1({ arrivalRate: lambda, serviceRate: mu }).metrics;
      const c1 = analyseMmc({ arrivalRate: lambda, serviceRate: mu, servers: 1 }).metrics;
      expect(Math.abs(c1.L - one.L)).toBeLessThan(TIGHT * Math.max(1, one.L));
      expect(Math.abs(c1.Lq - one.Lq)).toBeLessThan(TIGHT * Math.max(1, one.Lq));
      expect(Math.abs(c1.W - one.W)).toBeLessThan(TIGHT * Math.max(1, one.W));
      expect(Math.abs(c1.Wq - one.Wq)).toBeLessThan(TIGHT * Math.max(1, one.Wq));
      expect(Math.abs((c1.probabilityOfWaiting ?? 0) - one.utilisation)).toBeLessThan(TIGHT);
    }
  });

  it('matches a hand-computed M/M/2 example', () => {
    // λ = 3, μ = 2, c = 2 ⇒ a = 1.5, ρ = 0.75.
    // p0 = [1 + 1.5 + 1.5²/(2!·(1−0.75))]⁻¹ = [1 + 1.5 + 4.5]⁻¹ = 1/7.
    // C = (a^c/(c!(1−ρ)))·p0 = (2.25/(2·0.25))·(1/7) = 4.5/7 = 9/14.
    // Lq = Cρ/(1−ρ) = (9/14)(3) = 27/14; Wq = Lq/λ = 9/14.
    const a = analyseMmc({ arrivalRate: 3, serviceRate: 2, servers: 2 });
    expect(a.metrics.distribution[0].p).toBeCloseTo(1 / 7, 12);
    expect(a.metrics.probabilityOfWaiting ?? 0).toBeCloseTo(9 / 14, 12);
    expect(a.metrics.Lq).toBeCloseTo(27 / 14, 12);
    expect(a.metrics.Wq).toBeCloseTo(9 / 14, 12);
    expect(a.metrics.W).toBeCloseTo(9 / 14 + 0.5, 12);
  });

  it('gives P(wait > t) = C·e^(−(cμ−λ)t) with mean Wq', () => {
    const a = analyseMmc({ arrivalRate: 3, serviceRate: 2, servers: 2 });
    const wait = a.queueWait;
    if (!wait) throw new Error('expected a queue-wait law');
    expect(wait.tail(0)).toBeCloseTo(9 / 14, 12);
    expect(wait.tail(2)).toBeCloseTo((9 / 14) * Math.exp(-1 * 2), 12); // cμ − λ = 1
    expect(wait.mean).toBeCloseTo(a.metrics.Wq, 12);
  });

  it('refuses λ ≥ cμ', () => {
    expect(() => analyseMmc({ arrivalRate: 20, serviceRate: 10, servers: 2 })).toThrow(EngineError);
    try {
      analyseMmc({ arrivalRate: 25, serviceRate: 10, servers: 2 });
      throw new Error('should not reach here');
    } catch (e) {
      const err = e as EngineError;
      expect(err.message).toMatch(/grows without bound/);
      expect(err.issues[0].code).toBe('unstable');
    }
  });

  it('refuses fewer than one server', () => {
    expect(() => analyseMmc({ arrivalRate: 1, serviceRate: 10, servers: 0 })).toThrow(EngineError);
    expect(() => analyseMmc({ arrivalRate: 1, serviceRate: 10, servers: 2.5 })).toThrow(EngineError);
    expect(() => analyseMmc({ arrivalRate: 1, serviceRate: 10, servers: -3 })).toThrow(EngineError);
  });
});

describe('Erlang B and C', () => {
  it('matches the standard telephony table value B(10, 10) ≈ 0.2146', () => {
    // Standard Erlang B table: 10 erlangs offered to 10 servers blocks 21.46%.
    expect(erlangB(10, 10)).toBeCloseTo(0.2146, 4);
  });

  it('matches further table values', () => {
    // B(1, 1) = a/(1+a) = 0.5 exactly.
    expect(erlangB(1, 1)).toBeCloseTo(0.5, 12);
    // B(2, 1) = 2/3 exactly.
    expect(erlangB(2, 1)).toBeCloseTo(2 / 3, 12);
    // B(2, 2) = (a²/2)/(1 + a + a²/2) = 2/5 = 0.4 exactly.
    expect(erlangB(2, 2)).toBeCloseTo(0.4, 12);
    // Table value: 5 erlangs on 10 servers ≈ 0.018 (1.8%).
    expect(erlangB(5, 10)).toBeCloseTo(0.018385, 5);
  });

  it('is monotonically decreasing in c and increasing in a', () => {
    let previous = 1;
    for (let c = 1; c <= 60; c++) {
      const b = erlangB(20, c);
      expect(b).toBeLessThan(previous);
      previous = b;
    }
    let last = 0;
    for (const a of [0.5, 1, 2, 5, 10, 20, 50, 100]) {
      const b = erlangB(a, 10);
      expect(b).toBeGreaterThan(last);
      last = b;
    }
  });

  it('agrees with a direct factorial evaluation where that still works', () => {
    // Proves the recursion before it is trusted at large c.
    for (const a of [0.5, 1, 3, 7.5, 12]) {
      for (const c of [1, 2, 5, 10, 20, 50]) {
        expect(erlangB(a, c)).toBeCloseTo(erlangBDirect(a, c), 12);
      }
    }
    // The direct form has already failed at c = 200, which is why the
    // recursion exists.
    expect(Number.isFinite(erlangBDirect(180, 200))).toBe(false);
  });

  it('Erlang C equals ρ exactly at c = 1', () => {
    for (const a of [0.1, 0.5, 0.8, 0.95, 0.999]) {
      expect(Math.abs(erlangC(a, 1) - a)).toBeLessThan(TIGHT);
    }
  });

  it('stays finite and in (0, 1) for c = 200, a = 180', () => {
    const b = erlangB(180, 200);
    const c = erlangC(180, 200);
    for (const v of [b, c]) {
      expect(Number.isNaN(v)).toBe(false);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
    // Erlang C ≥ Erlang B always (waiting is at least as likely as blocking).
    expect(c).toBeGreaterThanOrEqual(b);
  });

  it('analyses M/M/c with c = 200 without NaN or Infinity', () => {
    const a = analyseMmc({ arrivalRate: 180, serviceRate: 1, servers: 200 });
    for (const v of [a.metrics.L, a.metrics.Lq, a.metrics.W, a.metrics.Wq, a.metrics.probabilityOfWaiting ?? 0]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(a.metrics.utilisation).toBeCloseTo(0.9, 12);
    expect(a.metrics.Wq).toBeGreaterThan(0);
    expectLittlesLaw(a, 'M/M/c c=200');
    // State probabilities still sum sensibly (truncated tail is tiny here).
    const total = a.metrics.distribution.reduce((s, d) => s + d.p, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(1 + 1e-12);
  });

  it('survives even larger server counts', () => {
    const b = erlangB(4500, 5000);
    expect(Number.isFinite(b)).toBe(true);
    expect(b).toBeGreaterThan(0);
    expect(b).toBeLessThan(1);
  });

  it('refuses Erlang C at ρ ≥ 1', () => {
    expect(() => erlangC(10, 10)).toThrow(EngineError);
    expect(() => erlangC(12, 10)).toThrow(/no steady state/);
  });
});

describe('M/M/c/K and M/M/1/K', () => {
  it('matches a hand-computed M/M/1/3 example', () => {
    // λ = μ = 1 ⇒ a = 1, so all four states are equally likely: p_n = 1/4.
    // P_block = 1/4; λ_eff = 3/4; L = (0+1+2+3)/4 = 1.5; W = L/λ_eff = 2.
    const a = analyseMm1K({ arrivalRate: 1, serviceRate: 1, capacity: 3 });
    expect(a.metrics.blockingProbability ?? -1).toBeCloseTo(0.25, 12);
    expect(a.metrics.effectiveArrivalRate).toBeCloseTo(0.75, 12);
    expect(a.metrics.L).toBeCloseTo(1.5, 12);
    expect(a.metrics.W).toBeCloseTo(2, 12);
    // Lq = Σ (n−1)p_n for n ≥ 1 = (0+1+2)/4 = 0.75; Wq = 0.75/0.75 = 1.
    expect(a.metrics.Lq).toBeCloseTo(0.75, 12);
    expect(a.metrics.Wq).toBeCloseTo(1, 12);
    expect(a.metrics.throughput).toBeCloseTo(0.75, 12);
  });

  it('is stable at λ > μ and reports blocking instead of refusing', () => {
    const a = analyseMm1K({ arrivalRate: 30, serviceRate: 10, capacity: 5 });
    expect(Number.isFinite(a.metrics.L)).toBe(true);
    expect(Number.isFinite(a.metrics.W)).toBe(true);
    expect(a.metrics.blockingProbability ?? 0).toBeGreaterThan(0.5);
    expect(a.metrics.effectiveArrivalRate).toBeLessThan(30);
    expect(a.metrics.throughput).toBeLessThanOrEqual(10);
    expectLittlesLaw(a, 'M/M/1/K overloaded');
    // Capacity is the binding constraint: throughput = μ(1 − p0).
    expect(a.metrics.throughput).toBeCloseTo(10 * (1 - a.metrics.distribution[0].p), 12);
  });

  it('converges to M/M/1 as K grows', () => {
    const infinite = analyseMm1({ arrivalRate: 8, serviceRate: 10 }).metrics;
    const finite = analyseMm1K({ arrivalRate: 8, serviceRate: 10, capacity: 400 }).metrics;
    expect(finite.L).toBeCloseTo(infinite.L, 10);
    expect(finite.Lq).toBeCloseTo(infinite.Lq, 10);
    expect(finite.W).toBeCloseTo(infinite.W, 10);
    expect(finite.Wq).toBeCloseTo(infinite.Wq, 10);
    expect(finite.blockingProbability ?? 1).toBeLessThan(1e-30);
  });

  it('M/M/c/K converges to M/M/c as K grows', () => {
    const infinite = analyseMmc({ arrivalRate: 7, serviceRate: 2, servers: 5 }).metrics;
    const finite = analyseMmcK({ arrivalRate: 7, serviceRate: 2, servers: 5, capacity: 400 }).metrics;
    expect(finite.L).toBeCloseTo(infinite.L, 10);
    expect(finite.Wq).toBeCloseTo(infinite.Wq, 10);
  });

  it('refuses K < c', () => {
    expect(() => analyseMmcK({ arrivalRate: 1, serviceRate: 1, servers: 4, capacity: 3 })).toThrow(EngineError);
    try {
      analyseMmcK({ arrivalRate: 1, serviceRate: 1, servers: 4, capacity: 3 });
      throw new Error('should not reach here');
    } catch (e) {
      expect((e as EngineError).message).toMatch(/cannot be smaller than the number of servers/);
    }
  });

  it('uses the effective arrival rate in Little’s law, not the offered rate', () => {
    const a = analyseMm1K({ arrivalRate: 30, serviceRate: 10, capacity: 5 }).metrics;
    expect(Math.abs(a.L - a.effectiveArrivalRate * a.W)).toBeLessThan(LITTLE);
    // The offered rate would NOT satisfy the identity — that is the classic bug.
    expect(Math.abs(a.L - a.arrivalRate * a.W)).toBeGreaterThan(1);
    expect(a.littlesLaw.note).toMatch(/effective arrival rate/);
  });
});

describe('M/M/c/c (Erlang loss)', () => {
  it('reports Erlang B blocking, zero wait, and carried load', () => {
    const a = analyseMmcc({ arrivalRate: 10, serviceRate: 1, servers: 10 });
    expect(a.metrics.blockingProbability ?? -1).toBeCloseTo(0.2146, 4);
    expect(a.metrics.Wq).toBe(0);
    expect(a.metrics.Lq).toBe(0);
    // L = a(1 − B) busy servers.
    expect(a.metrics.L).toBeCloseTo(10 * (1 - erlangB(10, 10)), 12);
    expect(a.metrics.W).toBeCloseTo(1, 12);
    expectLittlesLaw(a, 'M/M/c/c');
  });

  it('agrees with M/M/c/K at K = c', () => {
    const loss = analyseMmcc({ arrivalRate: 7, serviceRate: 2, servers: 4 }).metrics;
    const truncated = analyseMmcK({ arrivalRate: 7, serviceRate: 2, servers: 4, capacity: 4 }).metrics;
    expect(truncated.blockingProbability ?? -1).toBeCloseTo(loss.blockingProbability ?? -2, 12);
    expect(truncated.L).toBeCloseTo(loss.L, 12);
    expect(truncated.W).toBeCloseTo(loss.W, 12);
  });

  it('is stable at any load', () => {
    const a = analyseMmcc({ arrivalRate: 1000, serviceRate: 1, servers: 3 });
    expect(Number.isFinite(a.metrics.L)).toBe(true);
    expect(a.metrics.blockingProbability ?? 0).toBeGreaterThan(0.99);
  });
});

describe('M/M/∞', () => {
  it('matches an independently computed Poisson(λ/μ) distribution', () => {
    const lambda = 7;
    const mu = 2;
    const a = lambda / mu; // 3.5
    const { metrics } = analyseMmInfinity({ arrivalRate: lambda, serviceRate: mu });
    // Independent Poisson pmf by the recurrence p_0 = e^(−a), p_n = p_{n−1}·a/n.
    let p = Math.exp(-a);
    for (let n = 0; n <= 25; n++) {
      expect(metrics.distribution[n].p).toBeCloseTo(p, 12);
      p = (p * a) / (n + 1);
    }
    expect(Math.abs(metrics.L - a)).toBeLessThan(TIGHT);
    expect(Math.abs(metrics.W - 1 / mu)).toBeLessThan(TIGHT);
    expect(metrics.Lq).toBe(0);
    expect(metrics.Wq).toBe(0);
    // The distribution's mean and variance both equal a (Poisson).
    const mean = metrics.distribution.reduce((s, d) => s + d.n * d.p, 0);
    const second = metrics.distribution.reduce((s, d) => s + d.n * d.n * d.p, 0);
    expect(mean).toBeCloseTo(a, 10);
    expect(second - mean * mean).toBeCloseTo(a, 10);
  });

  it('never refuses a high load, because nobody queues', () => {
    const a = analyseMmInfinity({ arrivalRate: 1000, serviceRate: 1 });
    expect(a.metrics.L).toBeCloseTo(1000, 9);
    expect(a.metrics.Wq).toBe(0);
  });
});

describe('M/G/1 (Pollaczek–Khinchine)', () => {
  it('reduces exactly to M/M/1 when C_s² = 1', () => {
    for (const [lambda, mu] of [
      [8, 10],
      [1, 4],
      [0.9, 1],
      [45, 50],
    ]) {
      const mm1 = analyseMm1({ arrivalRate: lambda, serviceRate: mu }).metrics;
      const mg1 = analyseMg1({ arrivalRate: lambda, serviceRate: mu, serviceScv: 1 }).metrics;
      expect(Math.abs(mg1.Lq - mm1.Lq)).toBeLessThan(TIGHT * Math.max(1, mm1.Lq));
      expect(Math.abs(mg1.Wq - mm1.Wq)).toBeLessThan(TIGHT * Math.max(1, mm1.Wq));
      expect(Math.abs(mg1.L - mm1.L)).toBeLessThan(TIGHT * Math.max(1, mm1.L));
      expect(Math.abs(mg1.W - mm1.W)).toBeLessThan(TIGHT * Math.max(1, mm1.W));
    }
  });

  it('accepts a variance instead of a C_s², consistently', () => {
    // Exponential service with μ = 10 has Var[S] = 1/μ² = 0.01 ⇒ C_s² = 1.
    const byVariance = analyseMg1({ arrivalRate: 8, serviceRate: 10, serviceVariance: 0.01 }).metrics;
    const byScv = analyseMg1({ arrivalRate: 8, serviceRate: 10, serviceScv: 1 }).metrics;
    expect(Math.abs(byVariance.Wq - byScv.Wq)).toBeLessThan(TIGHT);
  });

  it('refuses to guess the service-time variability', () => {
    expect(() => analyseMg1({ arrivalRate: 8, serviceRate: 10 })).toThrow(EngineError);
    try {
      analyseMg1({ arrivalRate: 8, serviceRate: 10 });
      throw new Error('should not reach here');
    } catch (e) {
      expect((e as EngineError).message).toMatch(/variability/);
    }
  });

  it('shows that variability, not the mean, drives waiting', () => {
    // Same mean service time (1/10), three variabilities. P-K says Wq scales
    // exactly with (1 + C_s²): 1, 2 and 5 times the deterministic case.
    const base = analyseMg1({ arrivalRate: 8, serviceRate: 10, serviceScv: 0 }).metrics.Wq;
    const expo = analyseMg1({ arrivalRate: 8, serviceRate: 10, serviceScv: 1 }).metrics.Wq;
    const wild = analyseMg1({ arrivalRate: 8, serviceRate: 10, serviceScv: 4 }).metrics.Wq;
    expect(expo / base).toBeCloseTo(2, 12);
    expect(wild / base).toBeCloseTo(5, 12);
    // Hand check: λ=8, μ=10, C_s²=0 ⇒ Lq = 0.64/(2·0.2) = 1.6, Wq = 0.2.
    expect(base).toBeCloseTo(0.2, 12);
  });

  it('refuses ρ ≥ 1', () => {
    expect(() => analyseMg1({ arrivalRate: 10, serviceRate: 10, serviceScv: 0.5 })).toThrow(/no steady state/);
  });

  it('is labelled exact', () => {
    expect(analyseMg1({ arrivalRate: 8, serviceRate: 10, serviceScv: 2 }).explanation.exactness).toBe('exact');
  });
});

describe('M/D/1', () => {
  it('has exactly half the M/M/1 queue length and wait', () => {
    for (const [lambda, mu] of [
      [8, 10],
      [1, 2],
      [9.5, 10],
      [0.25, 7],
    ]) {
      const mm1 = analyseMm1({ arrivalRate: lambda, serviceRate: mu }).metrics;
      const md1 = analyseMd1({ arrivalRate: lambda, serviceRate: mu }).metrics;
      expect(Math.abs(md1.Lq - mm1.Lq / 2)).toBeLessThan(TIGHT * Math.max(1, mm1.Lq));
      expect(Math.abs(md1.Wq - mm1.Wq / 2)).toBeLessThan(TIGHT * Math.max(1, mm1.Wq));
      // L and W are NOT halved: the service time itself is unchanged.
      expect(Math.abs(md1.L - (mm1.Lq / 2 + lambda / mu))).toBeLessThan(TIGHT * Math.max(1, md1.L));
    }
  });

  it('reports M/D/1 in its Kendall notation', () => {
    expect(analyseMd1({ arrivalRate: 8, serviceRate: 10 }).kendall).toBe('M/D/1');
  });
});

describe('G/G/1 — Kingman approximation', () => {
  it('reproduces M/M/1 when both SCVs are 1', () => {
    const mm1 = analyseMm1({ arrivalRate: 8, serviceRate: 10 }).metrics;
    const gg1 = analyseGgc({ arrivalRate: 8, serviceRate: 10, arrivalScv: 1, serviceScv: 1 }).metrics;
    // Kingman is exact in this case; allow the approximation's own slack.
    expect(gg1.Wq / mm1.Wq).toBeCloseTo(1, 6);
    expect(gg1.Wq).toBeCloseTo(mm1.Wq, 12);
  });

  it('reproduces M/M/c when both SCVs are 1', () => {
    const mmc = analyseMmc({ arrivalRate: 7, serviceRate: 2, servers: 5 }).metrics;
    const ggc = analyseGgc({ arrivalRate: 7, serviceRate: 2, arrivalScv: 1, serviceScv: 1, servers: 5 }).metrics;
    expect(ggc.Wq).toBeCloseTo(mmc.Wq, 12);
  });

  it('is labelled an approximation, never exact', () => {
    const a = analyseGgc({ arrivalRate: 8, serviceRate: 10, arrivalScv: 2, serviceScv: 0.5 });
    expect(a.explanation.exactness).toBe('numerical');
    expect(a.explanation.limitations.join(' ')).toMatch(/APPROXIMATION/);
    expect(a.explanation.method).toMatch(/APPROXIMATION/);
  });

  it('scales with the average of the two SCVs', () => {
    const mm1Wq = analyseMm1({ arrivalRate: 8, serviceRate: 10 }).metrics.Wq;
    const regular = analyseGgc({ arrivalRate: 8, serviceRate: 10, arrivalScv: 0, serviceScv: 0 }).metrics.Wq;
    const bursty = analyseGgc({ arrivalRate: 8, serviceRate: 10, arrivalScv: 3, serviceScv: 1 }).metrics.Wq;
    expect(regular).toBe(0);
    expect(bursty / mm1Wq).toBeCloseTo(2, 12);
  });

  it('refuses ρ ≥ 1', () => {
    expect(() => analyseGgc({ arrivalRate: 10, serviceRate: 10, arrivalScv: 1, serviceScv: 1 })).toThrow(/no steady state/);
  });
});

describe('finite calling population', () => {
  it('matches a hand-computed machine-repair example', () => {
    // N = 3 machines, λ = 1 failure per unit uptime, μ = 2, one repairman.
    // a = 0.5. Weights: n=0: 1; n=1: 3·0.5 = 1.5; n=2: 3·0.25·2!/1 = 1.5;
    // n=3: 1·0.125·3! = 0.75. Total = 4.75.
    const a = analyseFinitePopulation({ arrivalRate: 1, serviceRate: 2, population: 3 });
    const weights = [1, 1.5, 1.5, 0.75];
    const total = 4.75;
    weights.forEach((w, n) => expect(a.metrics.distribution[n].p).toBeCloseTo(w / total, 12));
    // L = (0·1 + 1·1.5 + 2·1.5 + 3·0.75)/4.75 = 6.75/4.75
    expect(a.metrics.L).toBeCloseTo(6.75 / 4.75, 12);
    // λ_eff = λ(N − L)
    expect(a.metrics.effectiveArrivalRate).toBeCloseTo(3 - 6.75 / 4.75, 12);
    expectLittlesLaw(a, 'machine repair');
  });

  it('is stable even when the per-unit load exceeds one', () => {
    const a = analyseFinitePopulation({ arrivalRate: 5, serviceRate: 1, population: 4 });
    expect(Number.isFinite(a.metrics.L)).toBe(true);
    expect(a.metrics.L).toBeLessThanOrEqual(4);
    expect(a.metrics.throughput).toBeLessThanOrEqual(1);
    expectLittlesLaw(a, 'machine repair overloaded');
  });

  it('approaches M/M/1 as the population grows with the aggregate rate held fixed', () => {
    // N units each failing at λ/N behave like a Poisson stream of rate λ.
    const mm1 = analyseMm1({ arrivalRate: 8, serviceRate: 10 }).metrics;
    const big = analyseFinitePopulation({ arrivalRate: 8 / 4000, serviceRate: 10, population: 4000 }).metrics;
    expect(big.L).toBeCloseTo(mm1.L, 1);
    expect(big.Wq / mm1.Wq).toBeCloseTo(1, 1);
  });

  it('refuses more servers than units', () => {
    expect(() => analyseFinitePopulation({ arrivalRate: 1, serviceRate: 2, population: 2, servers: 3 })).toThrow(EngineError);
  });
});

describe('non-preemptive priority', () => {
  it('preserves the aggregate wait when all classes share a service rate', () => {
    // Conservation law: Σ λ_k Wq_k / λ equals the FCFS M/M/1 wait.
    const classes = [
      { label: 'urgent', arrivalRate: 3, serviceRate: 10 },
      { label: 'routine', arrivalRate: 5, serviceRate: 10 },
    ];
    const a = analysePriority({ classes });
    const fcfs = analyseMm1({ arrivalRate: 8, serviceRate: 10 }).metrics;
    expect(a.metrics.Wq).toBeCloseTo(fcfs.Wq, 12);
    expect(a.metrics.L).toBeCloseTo(fcfs.L, 12);
    // High priority waits less than FCFS, low priority more.
    expect(a.classes[0].Wq).toBeLessThan(fcfs.Wq);
    expect(a.classes[1].Wq).toBeGreaterThan(fcfs.Wq);
    expectLittlesLaw(a, 'priority');
  });

  it('matches Cobham’s formula computed by hand', () => {
    // λ1 = 3, μ1 = 10, λ2 = 5, μ2 = 10 ⇒ ρ1 = 0.3, ρ2 = 0.5, ρ = 0.8.
    // R = 3/100 + 5/100 = 0.08.
    // Wq1 = 0.08/((1)(0.7)) = 0.1142857142857…
    // Wq2 = 0.08/((0.7)(0.2)) = 0.5714285714285…
    const a = analysePriority({
      classes: [
        { label: 'high', arrivalRate: 3, serviceRate: 10 },
        { label: 'low', arrivalRate: 5, serviceRate: 10 },
      ],
    });
    expect(a.classes[0].Wq).toBeCloseTo(0.08 / 0.7, 12);
    expect(a.classes[1].Wq).toBeCloseTo(0.08 / (0.7 * 0.2), 12);
    expect(a.classes[0].W).toBeCloseTo(0.08 / 0.7 + 0.1, 12);
  });

  it('handles different service rates per class', () => {
    const a = analysePriority({
      classes: [
        { label: 'short jobs', arrivalRate: 4, serviceRate: 20 },
        { label: 'long jobs', arrivalRate: 1, serviceRate: 2 },
      ],
    });
    // ρ = 4/20 + 1/2 = 0.7; R = 4/400 + 1/4 = 0.26.
    expect(a.metrics.utilisation).toBeCloseTo(0.7, 12);
    expect(a.classes[0].Wq).toBeCloseTo(0.26 / (1 * 0.8), 12);
    expect(a.classes[1].Wq).toBeCloseTo(0.26 / (0.8 * 0.3), 12);
    expectLittlesLaw(a, 'priority mixed rates');
  });

  it('refuses when the total utilisation reaches 1', () => {
    expect(() =>
      analysePriority({
        classes: [
          { label: 'a', arrivalRate: 5, serviceRate: 10 },
          { label: 'b', arrivalRate: 5, serviceRate: 10 },
        ],
      }),
    ).toThrow(/grows without bound/);
  });

  it('refuses a single class', () => {
    expect(() => analysePriority({ classes: [{ label: 'only', arrivalRate: 1, serviceRate: 2 }] })).toThrow(EngineError);
  });
});

describe('Jackson networks', () => {
  it('matches independent M/M/1 results for a 2-node tandem network', () => {
    // All work enters node A and passes to node B, then leaves.
    // Traffic equations: λ_A = 5, λ_B = 5.
    const result = analyseJacksonNetwork({
      nodes: [
        { id: 'A', externalArrivalRate: 5, serviceRate: 8 },
        { id: 'B', externalArrivalRate: 0, serviceRate: 10 },
      ],
      routes: [{ from: 'A', to: 'B', probability: 1 }],
    });
    const a = analyseMm1({ arrivalRate: 5, serviceRate: 8 }).metrics;
    const b = analyseMm1({ arrivalRate: 5, serviceRate: 10 }).metrics;
    expect(result.nodes[0].arrivalRate).toBeCloseTo(5, 12);
    expect(result.nodes[1].arrivalRate).toBeCloseTo(5, 12);
    expect(result.nodes[0].analysis.metrics.L).toBeCloseTo(a.L, 12);
    expect(result.nodes[1].analysis.metrics.L).toBeCloseTo(b.L, 12);
    expect(result.nodes[0].analysis.metrics.Wq).toBeCloseTo(a.Wq, 12);
    expect(result.nodes[1].analysis.metrics.Wq).toBeCloseTo(b.Wq, 12);
    // Network totals: L adds up, and W = L/λ by Little's law.
    expect(result.L).toBeCloseTo(a.L + b.L, 12);
    expect(result.W).toBeCloseTo((a.L + b.L) / 5, 12);
    expect(result.littlesLaw.holds).toBe(true);
    expect(result.exactness).toBe('exact');
  });

  it('solves feedback routing', () => {
    // Node A: external 4; half of its output returns to A.
    // λ_A = 4 + 0.5 λ_A ⇒ λ_A = 8.
    const result = analyseJacksonNetwork({
      nodes: [{ id: 'A', externalArrivalRate: 4, serviceRate: 10 }],
      routes: [{ from: 'A', to: 'A', probability: 0.5 }],
    });
    expect(result.nodes[0].arrivalRate).toBeCloseTo(8, 12);
    expect(result.nodes[0].analysis.metrics.L).toBeCloseTo(4, 12); // M/M/1 at ρ = 0.8
    expect(result.nodes[0].departureProbability).toBeCloseTo(0.5, 12);
    // A customer passes through twice on average, so W is twice the node's W.
    expect(result.W).toBeCloseTo(4 / 4, 12);
  });

  it('refuses a network with an unstable node, naming it', () => {
    expect(() =>
      analyseJacksonNetwork({
        nodes: [
          { id: 'fast', externalArrivalRate: 9, serviceRate: 10 },
          { id: 'bottleneck', externalArrivalRate: 0, serviceRate: 6 },
        ],
        routes: [{ from: 'fast', to: 'bottleneck', probability: 1 }],
      }),
    ).toThrow(/"bottleneck" is unstable/);
  });

  it('spots instability created by feedback alone', () => {
    // λ_A = 4 + 0.9 λ_A ⇒ λ_A = 40 > μ = 10.
    expect(() =>
      analyseJacksonNetwork({
        nodes: [{ id: 'A', externalArrivalRate: 4, serviceRate: 10 }],
        routes: [{ from: 'A', to: 'A', probability: 0.9 }],
      }),
    ).toThrow(/unstable/);
  });

  it('refuses routing probabilities that leave a node with total above 1', () => {
    expect(() =>
      analyseJacksonNetwork({
        nodes: [
          { id: 'A', externalArrivalRate: 1, serviceRate: 10 },
          { id: 'B', externalArrivalRate: 0, serviceRate: 10 },
        ],
        routes: [
          { from: 'A', to: 'B', probability: 0.8 },
          { from: 'A', to: 'A', probability: 0.5 },
        ],
      }),
    ).toThrow(/more than 1/);
  });

  it('refuses an unknown node in a route and a closed network', () => {
    expect(() =>
      analyseJacksonNetwork({
        nodes: [{ id: 'A', externalArrivalRate: 1, serviceRate: 10 }],
        routes: [{ from: 'A', to: 'ghost', probability: 1 }],
      }),
    ).toThrow(/unknown node/);
    expect(() =>
      analyseJacksonNetwork({
        nodes: [
          { id: 'A', externalArrivalRate: 1, serviceRate: 10 },
          { id: 'B', externalArrivalRate: 0, serviceRate: 10 },
        ],
        routes: [
          { from: 'A', to: 'B', probability: 1 },
          { from: 'B', to: 'A', probability: 1 },
        ],
      }),
    ).toThrow(EngineError);
  });

  it('supports multi-server nodes', () => {
    const result = analyseJacksonNetwork({
      nodes: [
        { id: 'A', externalArrivalRate: 9, serviceRate: 10 },
        { id: 'B', externalArrivalRate: 0, serviceRate: 4, servers: 3 },
      ],
      routes: [{ from: 'A', to: 'B', probability: 1 }],
    });
    const b = analyseMmc({ arrivalRate: 9, serviceRate: 4, servers: 3 }).metrics;
    expect(result.nodes[1].analysis.metrics.Wq).toBeCloseTo(b.Wq, 12);
  });
});

describe('Little’s law as a standalone identity', () => {
  it('solves for each of the three quantities', () => {
    expect(littlesLaw({ arrivalRate: 8, timeInSystem: 0.5 }).numberInSystem).toBeCloseTo(4, 12);
    expect(littlesLaw({ arrivalRate: 8, numberInSystem: 4 }).timeInSystem).toBeCloseTo(0.5, 12);
    expect(littlesLaw({ numberInSystem: 4, timeInSystem: 0.5 }).arrivalRate).toBeCloseTo(8, 12);
  });

  it('refuses an under- or over-determined request', () => {
    expect(() => littlesLaw({ arrivalRate: 8 })).toThrow(EngineError);
    expect(() => littlesLaw({ arrivalRate: 8, numberInSystem: 4, timeInSystem: 0.5 })).toThrow(EngineError);
    expect(() => littlesLaw({ arrivalRate: -1, timeInSystem: 1 })).toThrow(EngineError);
  });

  it('holds for every implemented model across a grid of parameters', () => {
    const checked: string[] = [];
    for (const mu of [0.5, 1, 7, 20]) {
      for (const rho of [0.1, 0.5, 0.85, 0.97]) {
        for (const c of [1, 2, 7]) {
          const lambda = rho * c * mu;
          expectLittlesLaw(analyseMmc({ arrivalRate: lambda, serviceRate: mu, servers: c }), `M/M/${c}`);
          expectLittlesLaw(analyseMmcc({ arrivalRate: lambda, serviceRate: mu, servers: c }), `M/M/${c}/${c}`);
          expectLittlesLaw(analyseMmcK({ arrivalRate: lambda, serviceRate: mu, servers: c, capacity: c + 5 }), 'M/M/c/K');
          if (c === 1) {
            expectLittlesLaw(analyseMm1({ arrivalRate: lambda, serviceRate: mu }), 'M/M/1');
            expectLittlesLaw(analyseMm1K({ arrivalRate: lambda, serviceRate: mu, capacity: 6 }), 'M/M/1/K');
            expectLittlesLaw(analyseMd1({ arrivalRate: lambda, serviceRate: mu }), 'M/D/1');
            for (const scv of [0, 0.3, 1, 2.5]) {
              expectLittlesLaw(analyseMg1({ arrivalRate: lambda, serviceRate: mu, serviceScv: scv }), 'M/G/1');
            }
          }
          expectLittlesLaw(
            analyseGgc({ arrivalRate: lambda, serviceRate: mu, arrivalScv: 1.5, serviceScv: 0.4, servers: c }),
            'G/G/c',
          );
          expectLittlesLaw(analyseMmInfinity({ arrivalRate: lambda, serviceRate: mu }), 'M/M/∞');
          expectLittlesLaw(
            analyseFinitePopulation({ arrivalRate: mu * rho, serviceRate: mu, population: 8, servers: c }),
            'M/M/c//N',
          );
          checked.push(`${mu}-${rho}-${c}`);
        }
      }
    }
    expect(checked.length).toBe(48);
  });

  it('holds for overloaded finite-capacity and finite-population queues specifically', () => {
    // These are the cases where using the OFFERED rate silently breaks the law.
    for (const K of [1, 2, 5, 20]) {
      const a = analyseMm1K({ arrivalRate: 50, serviceRate: 10, capacity: K });
      expectLittlesLaw(a, `M/M/1/${K} overloaded`);
      expect(a.metrics.effectiveArrivalRate).toBeLessThan(a.metrics.arrivalRate);
    }
    for (const N of [1, 3, 10, 50]) {
      const a = analyseFinitePopulation({ arrivalRate: 4, serviceRate: 1, population: N });
      expectLittlesLaw(a, `machine repair N=${N}`);
    }
    for (const c of [1, 4, 25]) {
      const a = analyseMmcc({ arrivalRate: 200, serviceRate: 1, servers: c });
      expectLittlesLaw(a, `M/M/${c}/${c} overloaded`);
    }
  });
});

describe('capacity planning', () => {
  it('returns the minimum c meeting a mean-wait target', () => {
    const plan = planCapacity({ arrivalRate: 40, serviceRate: 6, target: { kind: 'meanWait', value: 0.05 } });
    expect(plan.metric).toBeLessThanOrEqual(0.05);
    // c − 1 must FAIL: that is what makes the answer a minimum.
    expect(plan.previous).not.toBeNull();
    if (plan.previous && plan.previous.metric !== null) {
      expect(plan.previous.metric).toBeGreaterThan(0.05);
      expect(plan.previous.servers).toBe(plan.servers - 1);
    }
    // Independent re-check of both sides.
    const atTarget = analyseMmc({ arrivalRate: 40, serviceRate: 6, servers: plan.servers }).metrics.Wq;
    expect(atTarget).toBeLessThanOrEqual(0.05);
    const below = plan.servers - 1;
    if (below * 6 > 40) {
      expect(analyseMmc({ arrivalRate: 40, serviceRate: 6, servers: below }).metrics.Wq).toBeGreaterThan(0.05);
    } else {
      expect(() => analyseMmc({ arrivalRate: 40, serviceRate: 6, servers: below })).toThrow(EngineError);
    }
  });

  it('returns the minimum c meeting a P(wait > t) target', () => {
    const plan = planCapacity({ arrivalRate: 40, serviceRate: 6, target: { kind: 'waitTail', t: 0.1, value: 0.2 } });
    const wait = analyseMmc({ arrivalRate: 40, serviceRate: 6, servers: plan.servers }).queueWait;
    if (!wait) throw new Error('expected a queue-wait law');
    expect(wait.tail(0.1)).toBeLessThanOrEqual(0.2);
    const prevWait = analyseMmc({ arrivalRate: 40, serviceRate: 6, servers: plan.servers - 1 }).queueWait;
    if (!prevWait) throw new Error('expected a queue-wait law');
    expect(prevWait.tail(0.1)).toBeGreaterThan(0.2);
  });

  it('returns the minimum c meeting a blocking target in a loss system', () => {
    const plan = planCapacity({
      arrivalRate: 10,
      serviceRate: 1,
      system: 'loss',
      target: { kind: 'blocking', value: 0.01 },
    });
    expect(erlangB(10, plan.servers)).toBeLessThanOrEqual(0.01);
    expect(erlangB(10, plan.servers - 1)).toBeGreaterThan(0.01);
  });

  it('starts from the smallest stable c', () => {
    const plan = planCapacity({ arrivalRate: 40, serviceRate: 6, target: { kind: 'meanWait', value: 100 } });
    // a = 6.67 erlangs, so 7 servers is the first stable level.
    expect(plan.servers).toBe(7);
    expect(plan.previous?.metric).toBeNull();
    expect(plan.previous?.reason).toMatch(/no steady state/);
  });

  it('refuses a target no staffing level can meet', () => {
    expect(() =>
      planCapacity({ arrivalRate: 40, serviceRate: 6, target: { kind: 'meanWait', value: 1e-12 }, maxServers: 10 }),
    ).toThrow(/No number of servers up to 10/);
    // A utilisation target below a/maxServers cannot be met either.
    expect(() =>
      planCapacity({ arrivalRate: 40, serviceRate: 6, target: { kind: 'utilisation', value: 0.05 }, maxServers: 60 }),
    ).toThrow(/No number of servers up to 60/);
  });

  it('refuses mismatched system and target combinations', () => {
    expect(() => planCapacity({ arrivalRate: 1, serviceRate: 2, target: { kind: 'blocking', value: 0.01 } })).toThrow(
      /never blocks/,
    );
    expect(() =>
      planCapacity({ arrivalRate: 1, serviceRate: 2, system: 'loss', target: { kind: 'meanWait', value: 1 } }),
    ).toThrow(/no waiting room/);
  });

  it('refuses an impossible target value', () => {
    expect(() => planCapacity({ arrivalRate: 1, serviceRate: 2, target: { kind: 'meanWait', value: -1 } })).toThrow(EngineError);
    expect(() =>
      planCapacity({ arrivalRate: 1, serviceRate: 2, target: { kind: 'waitTail', t: -1, value: 0.5 } }),
    ).toThrow(EngineError);
  });
});

describe('sensitivity to utilisation', () => {
  it('shows the wait exploding as ρ → 1', () => {
    const curve = utilisationCurve({ serviceRate: 1 });
    expect(curve.points.length).toBeGreaterThan(10);
    for (let i = 1; i < curve.points.length; i++) {
      expect(curve.points[i].Wq).toBeGreaterThan(curve.points[i - 1].Wq);
      expect(curve.points[i].utilisation).toBeGreaterThan(curve.points[i - 1].utilisation);
    }
    // M/M/1 with μ = 1: Wq = ρ/(1−ρ), checked independently at each point.
    for (const p of curve.points) {
      expect(p.Wq).toBeCloseTo(p.utilisation / (1 - p.utilisation), 10);
    }
  });

  it('prices the last slice of utilisation', () => {
    const curve = utilisationCurve({ serviceRate: 1 });
    // Wq(0.99)/Wq(0.9) = (0.99/0.01)/(0.9/0.1) = 99/9 = 11 exactly for M/M/1.
    expect(curve.lastSlice.ratio).toBeCloseTo(11, 10);
    expect(curve.lastSlice.note).toMatch(/multiplies the mean wait/);
  });

  it('refuses a utilisation at or above 1', () => {
    expect(() => utilisationCurve({ serviceRate: 1, utilisations: [0.5, 1] })).toThrow(/strictly between 0 and 1/);
    expect(() => utilisationCurve({ serviceRate: 1, utilisations: [1.2] })).toThrow(EngineError);
  });
});

describe('economic optimisation', () => {
  it('returns a c that beats both neighbours', () => {
    const result = optimiseServerCount({
      arrivalRate: 40,
      serviceRate: 6,
      serverCost: 20,
      waitingCost: 100,
      basis: 'inSystem',
    });
    const cost = (c: number): number => {
      const m = analyseMmc({ arrivalRate: 40, serviceRate: 6, servers: c }).metrics;
      return 20 * c + 100 * m.L;
    };
    const best = cost(result.servers);
    expect(result.totalCost).toBeCloseTo(best, 10);
    expect(best).toBeLessThan(cost(result.servers + 1));
    const below = result.servers - 1;
    if (below * 6 > 40) {
      expect(best).toBeLessThan(cost(below));
    } else {
      expect(() => cost(below)).toThrow(EngineError);
    }
    expect(result.rows.some((r) => r.servers === result.servers + 1)).toBe(true);
  });

  it('beats both neighbours across a range of cost ratios', () => {
    for (const waitingCost of [1, 10, 100, 1000, 10000]) {
      const result = optimiseServerCount({ arrivalRate: 40, serviceRate: 6, serverCost: 20, waitingCost });
      const cost = (c: number): number =>
        20 * c + waitingCost * analyseMmc({ arrivalRate: 40, serviceRate: 6, servers: c }).metrics.L;
      expect(result.totalCost).toBeLessThan(cost(result.servers + 1) + 1e-9);
      if ((result.servers - 1) * 6 > 40) {
        expect(result.totalCost).toBeLessThan(cost(result.servers - 1) + 1e-9);
      }
    }
  });

  it('charges only queueing time when asked', () => {
    const inQueue = optimiseServerCount({
      arrivalRate: 40,
      serviceRate: 6,
      serverCost: 20,
      waitingCost: 100,
      basis: 'inQueue',
    });
    const inSystem = optimiseServerCount({ arrivalRate: 40, serviceRate: 6, serverCost: 20, waitingCost: 100 });
    // Charging for time in service too can only push staffing up, never down.
    expect(inQueue.servers).toBeLessThanOrEqual(inSystem.servers);
    expect(inQueue.basis).toBe('inQueue');
  });

  it('refuses degenerate cost inputs', () => {
    expect(() => optimiseServerCount({ arrivalRate: 1, serviceRate: 2, serverCost: 0, waitingCost: 0 })).toThrow(EngineError);
    expect(() => optimiseServerCount({ arrivalRate: 1, serviceRate: 2, serverCost: -1, waitingCost: 1 })).toThrow(EngineError);
  });
});

describe('theory versus simulation', () => {
  it('agrees with the app’s simulated M/M/1 queue', () => {
    const cmp = compareWithSimulation({
      arrivalRate: 4,
      serviceRate: 10,
      customers: 4000,
      trials: 200,
      seed: 'queue-cross-check',
    });
    // ρ = 0.4, Wq = 0.4/6 = 1/15 exactly.
    expect(cmp.exactWq).toBeCloseTo(1 / 15, 12);
    expect(cmp.relativeDifference).toBeLessThan(0.05);
    expect(cmp.caveats.join(' ')).toMatch(/biased below/);
    expect(cmp.verdict.length).toBeGreaterThan(0);
  });

  it('reports the warm-up bias rather than hiding it', () => {
    const cmp = compareWithSimulation({ arrivalRate: 9, serviceRate: 10, customers: 200, trials: 50, seed: 'short' });
    // With a short horizon at ρ = 0.9 the simulation must UNDER-report.
    expect(cmp.simulatedWq).toBeLessThan(cmp.exactWq);
    expect(cmp.caveats.length).toBeGreaterThan(2);
  });

  it('refuses an unstable comparison', () => {
    expect(() => compareWithSimulation({ arrivalRate: 10, serviceRate: 10 })).toThrow(/no steady state/);
  });
});

describe('model registry', () => {
  it('exposes every model with a uniform description', () => {
    expect(QUEUE_MODELS.length).toBe(11);
    for (const model of QUEUE_MODELS) {
      expect(model.id.length).toBeGreaterThan(0);
      expect(model.name.length).toBeGreaterThan(0);
      expect(model.description.length).toBeGreaterThan(0);
      expect(model.kendall.length).toBeGreaterThan(0);
      expect(model.params.length).toBeGreaterThan(0);
      expect(model.assumptions.length).toBeGreaterThan(0);
      expect(model.limitations.length).toBeGreaterThan(0);
      expect(getQueueModel(model.id)).toBe(model);
    }
  });

  it('validates configurations without throwing', () => {
    expect(getQueueModel('mm1').validate({ arrivalRate: -1, serviceRate: 0 }).length).toBe(2);
    expect(getQueueModel('mm1').validate({ arrivalRate: 1, serviceRate: 2 }).length).toBe(0);
    expect(getQueueModel('mg1').validate({ arrivalRate: 1, serviceRate: 2 }).length).toBe(1);
    expect(getQueueModel('mmck').validate({ arrivalRate: 1, serviceRate: 2, servers: 3, capacity: 2 }).length).toBe(1);
  });

  it('analyses through the registry and labels exactness', () => {
    const exact = getQueueModel('mm1').analyse({ arrivalRate: 8, serviceRate: 10 });
    expect(exact.metrics.L).toBeCloseTo(4, 12);
    expect(exact.explanation.exactness).toBe('exact');
    const approx = getQueueModel('ggc').analyse({ arrivalRate: 8, serviceRate: 10, arrivalScv: 2, serviceScv: 2 });
    expect(approx.explanation.exactness).toBe('numerical');
  });

  it('refuses an unknown model id', () => {
    expect(() => getQueueModel('mm42')).toThrow(/Unknown queue model/);
  });
});
