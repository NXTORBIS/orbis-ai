/**
 * Tests for the discrete-event simulation engine.
 *
 * Every reference value is computed independently of this engine: from the
 * closed-form queueing results written out explicitly in the test, from the
 * analytic module in `src/engine/queueing`, from a Markov chain solved by hand
 * in a comment, or from the exact normal tail. Nothing is asserted against
 * this code's own output.
 *
 * Where a quantity is estimated, the assertion is that the simulation's OWN
 * confidence interval contains the exact value, rather than that the estimate
 * is within some tolerance chosen after the fact. Interval coverage is the
 * real test: it checks the reported uncertainty as well as the estimate.
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from '../core/result';
import { Random, Xoshiro128 } from '../random/rng';
import { normalQuantile, normalSf } from '../special/gamma';
import { analyseMmc } from '../queueing/models';
import { EventHeap, type DesEvent } from './heap';
import { Kernel } from './kernel';
import { Tally, TimeWeighted } from './statistics';
import { StreamSet } from './streams';
import {
  batchMeans,
  commonRandomNumbersReport,
  lag1IndependenceTest,
  mser5,
  multipleComparisons,
  pairedTComparison,
  regenerativeAnalysis,
  replicationAnalysis,
  replicationsForPrecision,
  welchWarmup,
} from './analysis';
import {
  DES_MODELS,
  getDesModel,
  productionLineModel,
  runQueueStation,
  type QueueStationConfig,
} from './library';
import { get, hold, put, release, seize, serve, Simulation } from './simulation';
import { desSteps, runDes } from './run';
import { exponentialDelay, source } from './flow';
import { validateQueueAgainstTheory } from './validate';
import {
  crossEntropyMethod,
  importanceSplitting,
  normalTailAdvance,
  plainMonteCarloRareEvent,
  subsetSimulation,
} from './rareevent';

// ---------------------------------------------------------------------------
// The future-event list
// ---------------------------------------------------------------------------

describe('future-event list', () => {
  it('pops in non-decreasing time order, matching an independently sorted array', () => {
    const rng = new Random(new Xoshiro128('heap-order'));
    const heap = new EventHeap();
    const inserted: { time: number; seq: number }[] = [];
    const count = 4000;
    for (let i = 0; i < count; i++) {
      // Times drawn from a small grid so that equal timestamps are common,
      // which is the case a heap gets wrong without an explicit tie-break.
      const time = Math.round(rng.uniform() * 200) / 2;
      heap.push({ time, seq: i, cancelled: false, action: () => {}, label: `e${i}` });
      inserted.push({ time, seq: i });
    }
    // Independent reference: sort a copy by (time, insertion order).
    const reference = [...inserted].sort((a, b) => a.time - b.time || a.seq - b.seq);
    const popped: { time: number; seq: number }[] = [];
    for (;;) {
      const next = heap.pop();
      if (!next) break;
      popped.push({ time: next.time, seq: next.seq });
    }
    expect(popped.length).toBe(count);
    expect(popped).toEqual(reference);
    for (let i = 1; i < popped.length; i++) {
      expect(popped[i].time).toBeGreaterThanOrEqual(popped[i - 1].time);
    }
  });

  it('pops equal timestamps in insertion order', () => {
    const heap = new EventHeap();
    for (let i = 0; i < 500; i++) {
      heap.push({ time: 7, seq: i, cancelled: false, action: () => {}, label: `e${i}` });
    }
    const order: number[] = [];
    for (;;) {
      const next = heap.pop();
      if (!next) break;
      order.push(next.seq);
    }
    expect(order).toEqual(Array.from({ length: 500 }, (_, i) => i));
  });

  it('skips cancelled events', () => {
    const heap = new EventHeap();
    const events: DesEvent[] = [];
    for (let i = 0; i < 10; i++) {
      const event: DesEvent = { time: i, seq: i, cancelled: false, action: () => {}, label: `e${i}` };
      events.push(event);
      heap.push(event);
    }
    events[3].cancelled = true;
    events[7].cancelled = true;
    const live: number[] = [];
    for (;;) {
      const next = heap.pop();
      if (!next) break;
      if (!next.cancelled) live.push(next.seq);
    }
    expect(live).toEqual([0, 1, 2, 4, 5, 6, 8, 9]);
  });
});

// ---------------------------------------------------------------------------
// Kernel guards
// ---------------------------------------------------------------------------

describe('kernel guards', () => {
  it('refuses an event scheduled in the past, reporting both times', () => {
    const kernel = new Kernel();
    kernel.schedule(10, () => {}, 'first');
    kernel.step();
    expect(kernel.now).toBe(10);
    let error: unknown;
    try {
      kernel.scheduleAt(4, () => {}, 'late arrival');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(EngineError);
    const message = (error as EngineError).message;
    expect(message).toContain('4');
    expect(message).toContain('10');
    expect(message).toMatch(/past/i);
  });

  it('refuses a negative delay', () => {
    const kernel = new Kernel();
    expect(() => kernel.schedule(-0.5, () => {}, 'backwards')).toThrow(EngineError);
    expect(() => kernel.schedule(-0.5, () => {}, 'backwards')).toThrow(/negative delay/i);
  });

  it('refuses a non-finite delay rather than treating it as a large one', () => {
    const kernel = new Kernel();
    expect(() => kernel.schedule(Number.NaN, () => {})).toThrow(EngineError);
    expect(() => kernel.schedule(Number.POSITIVE_INFINITY, () => {})).toThrow(EngineError);
  });

  it('refuses to exceed the event limit instead of truncating silently', () => {
    const kernel = new Kernel({ limits: { maxEvents: 50 } });
    const tick = (): void => {
      kernel.schedule(1, tick, 'tick');
    };
    kernel.schedule(1, tick, 'tick');
    let error: unknown;
    try {
      for (let i = 0; i < 1000; i++) kernel.step();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(EngineError);
    expect((error as EngineError).message).toMatch(/event limit/i);
    expect((error as EngineError).issues[0].code).toBe('limit');
  });

  it('refuses an event beyond the simulated-time limit', () => {
    const kernel = new Kernel({ limits: { maxSimulatedTime: 100 } });
    expect(() => kernel.schedule(1000, () => {}, 'far future')).toThrow(/simulated-time limit/i);
  });

  it('detects a zero-delay loop in the event list rather than freezing', () => {
    const kernel = new Kernel({ limits: { maxEventsPerTimestamp: 500 } });
    const spin = (): void => {
      kernel.schedule(0, spin, 'spin');
    };
    kernel.schedule(0, spin, 'spin');
    let error: unknown;
    try {
      for (let i = 0; i < 100_000; i++) kernel.step();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(EngineError);
    expect((error as EngineError).issues[0].code).toBe('zero-delay-loop');
    expect((error as EngineError).message).toMatch(/clock advancing|without the clock/i);
  });

  it('detects a process that never suspends', () => {
    const sim = new Simulation({ seed: 'spin', maxCommandsPerResumption: 500 });
    // A process runs as soon as it is activated, so a process that never
    // suspends is caught there rather than inside the run loop. Either way it
    // is reported, which is the point: without this guard the tab freezes.
    expect(() =>
      sim.activate(function* spinner() {
        for (;;) yield hold(0);
      }, 'spinner'),
    ).toThrow(/zero-delay loop/i);
  });

  it('refuses a negative or fractional resource capacity', () => {
    const sim = new Simulation({ seed: 'cap' });
    expect(() => sim.resource('bad', { capacity: -1 })).toThrow(EngineError);
    expect(() => sim.resource('bad2', { capacity: -1 })).toThrow(/capacity/i);
    expect(() => sim.resource('bad3', { capacity: 1.5 })).toThrow(EngineError);
  });

  it('refuses a request for more units than a resource can ever provide', () => {
    const sim = new Simulation({ seed: 'cap2' });
    const r = sim.resource('desk', { capacity: 2 });
    expect(() => r.request({ amount: 3, onGrant: () => {} })).toThrow(/deadlock/i);
  });

  it('reports a deadlock instead of a finished run', () => {
    const sim = new Simulation({ seed: 'deadlock' });
    const first = sim.resource('first', { capacity: 1 });
    const second = sim.resource('second', { capacity: 1 });
    sim.activate(function* a() {
      const got = yield seize(first);
      yield hold(1);
      yield seize(second);
      yield release(got.request!);
    }, 'A');
    sim.activate(function* b() {
      const got = yield seize(second);
      yield hold(1);
      yield seize(first);
      yield release(got.request!);
    }, 'B');
    let error: unknown;
    try {
      runDes(sim, { until: 100 });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(EngineError);
    expect((error as EngineError).issues[0].code).toBe('deadlock');
    expect((error as EngineError).message).toMatch(/waiting for resource/i);
  });

  it('refuses a warm-up period that would discard the whole run', () => {
    const sim = new Simulation({ seed: 'warm' });
    expect(() => runDes(sim, { until: 100, warmupTime: 100 })).toThrow(/warm-up/i);
  });
});

// ---------------------------------------------------------------------------
// Time-weighted versus naive averaging
// ---------------------------------------------------------------------------

describe('time-weighted statistics', () => {
  it('averages a persistent state variable over time, not over observations', () => {
    // A queue of length 10 for 1% of each unit of time and 0 for the other
    // 99%. The time-weighted average is exactly 0.1·10 = 0.1 ... precisely
    // 0.01 × 10 = 0.1. A per-observation average sees roughly as many 10s as
    // 0s and lands near 5, which is 50 times wrong.
    const stat = new TimeWeighted('queueLength');
    const cycles = 100;
    for (let c = 0; c < cycles; c++) {
      stat.set(c, 10);
      stat.set(c + 0.01, 0);
    }
    const report = stat.report(cycles);
    expect(report.timeWeightedMean).toBeCloseTo(0.1, 12);
    // The naive mean is materially different: not a rounding difference but a
    // different answer entirely.
    expect(report.naiveObservationMean).toBeGreaterThan(4.9);
    expect(report.naiveObservationMean / report.timeWeightedMean).toBeGreaterThan(40);
    expect(report.kind).toBe('time-weighted');
    expect(report.max).toBe(10);
    const tenState = report.timeInState?.find((s) => s.value === 10);
    expect(tenState?.fraction).toBeCloseTo(0.01, 12);
  });

  it('reports the time-weighted mean, not the naive one, as the engine answer', () => {
    const lambda = 0.8;
    const mu = 1;
    const run = runQueueStation(
      { arrival: { kind: 'exponential', rate: lambda }, service: { kind: 'exponential', rate: mu }, servers: 1 },
      { seed: 'tw-vs-naive', until: 50_000, warmupTime: 2_000 },
    );
    const state = run.report.states.find((s) => s.name === 'numberInSystem');
    expect(state).toBeDefined();
    // L comes from the time integral.
    expect(run.L).toBe(state!.timeWeightedMean);
    // And it differs from the naive per-change average, which here is biased
    // upwards because changes cluster when the queue is long.
    expect(Math.abs(state!.naiveObservationMean - state!.timeWeightedMean)).toBeGreaterThan(0.1);
    // The exact answer is 4; only the time-weighted one is near it.
    expect(Math.abs(run.L - 4)).toBeLessThan(Math.abs(state!.naiveObservationMean - 4));
  });

  it('refuses a time-weighted average over a window of zero length', () => {
    const stat = new TimeWeighted('empty');
    expect(() => stat.report(0)).toThrow(EngineError);
    expect(() => stat.report(0)).toThrow(/zero length|no simulated time/i);
  });

  it('refuses to integrate backwards in time', () => {
    const stat = new TimeWeighted('backwards');
    stat.set(10, 3);
    expect(() => stat.set(5, 1)).toThrow(/integrate backwards|before its last update/i);
  });
});

describe('tally statistics', () => {
  it('refuses a statistic with no observations rather than reporting zero', () => {
    const tally = new Tally('waitingTime');
    expect(() => tally.report()).toThrow(EngineError);
    expect(() => tally.report()).toThrow(/no observations/i);
    expect(() => tally.mean).toThrow(/no observations/i);
  });

  it('separates the interval for the mean from the percentiles of the values', () => {
    const rng = new Random(new Xoshiro128('tally'));
    const tally = new Tally('serviceTime');
    for (let i = 0; i < 20_000; i++) tally.push(rng.exponential(1));
    const report = tally.report();
    // Exponential(1): mean 1, median ln 2 ≈ 0.6931, 95th percentile
    // −ln(0.05) ≈ 2.9957. Computed here from the closed forms, not from code.
    expect(report.mean).toBeCloseTo(1, 1);
    const median = report.percentiles!.find((p) => p.p === 0.5)!.value;
    const p95 = report.percentiles!.find((p) => p.p === 0.95)!.value;
    expect(median).toBeCloseTo(Math.LN2, 1);
    expect(p95).toBeCloseTo(-Math.log(0.05), 0);
    // The interval for the mean is far narrower than the spread of values:
    // they are different statements and must not be confused.
    const halfWidth = (report.meanInterval.high - report.meanInterval.low) / 2;
    expect(halfWidth).toBeLessThan(0.05);
    expect(p95 - median).toBeGreaterThan(1);
    expect(report.note).toMatch(/independent/i);
  });

  it('refuses a non-finite observation', () => {
    const tally = new Tally('bad');
    expect(() => tally.push(Number.NaN)).toThrow(EngineError);
  });
});

// ---------------------------------------------------------------------------
// Determinism and independent substreams
// ---------------------------------------------------------------------------

describe('determinism', () => {
  const base: QueueStationConfig = {
    arrival: { kind: 'exponential', rate: 0.8 },
    service: { kind: 'exponential', rate: 1 },
    servers: 1,
  };

  it('reproduces an identical event trace from the same seed', () => {
    const first = runQueueStation(base, { seed: 'determinism', until: 2_000, collectTrace: true });
    const second = runQueueStation(base, { seed: 'determinism', until: 2_000, collectTrace: true });
    expect(first.report.trace).not.toBeNull();
    expect(first.report.trace!.length).toBeGreaterThan(1_000);
    expect(JSON.stringify(second.report.trace)).toBe(JSON.stringify(first.report.trace));
    expect(second.L).toBe(first.L);
    expect(second.Wq).toBe(first.Wq);
  });

  it('produces a different trace from a different seed', () => {
    const first = runQueueStation(base, { seed: 'seed-a', until: 2_000, collectTrace: true });
    const other = runQueueStation(base, { seed: 'seed-b', until: 2_000, collectTrace: true });
    expect(JSON.stringify(other.report.trace)).not.toBe(JSON.stringify(first.report.trace));
    expect(other.Wq).not.toBe(first.Wq);
  });

  it('leaves the arrival times untouched when only the service distribution changes', () => {
    const arrivalTimes = (config: QueueStationConfig): number[] =>
      runQueueStation(config, { seed: 'substreams', until: 3_000, collectTrace: true })
        .report.trace!.filter((entry) => entry.label === 'arrival source: hold')
        .map((entry) => entry.time);

    const exponentialService = arrivalTimes(base);
    const slowerExponential = arrivalTimes({ ...base, service: { kind: 'exponential', rate: 0.9 } });
    const deterministicService = arrivalTimes({ ...base, service: { kind: 'constant', value: 1 } });
    const gammaService = arrivalTimes({ ...base, service: { kind: 'distribution', id: 'gamma', params: { k: 4, theta: 0.25 } } });

    expect(exponentialService.length).toBeGreaterThan(2_000);
    // Independent substreams: the arrival process is driven by its own
    // generator, so it cannot be perturbed by anything the service process
    // does. With a single shared generator every one of these would differ.
    expect(slowerExponential).toEqual(exponentialService);
    expect(deterministicService).toEqual(exponentialService);
    expect(gammaService).toEqual(exponentialService);
  });

  it('gives a named substream the same values whatever else exists', () => {
    const a = new StreamSet('fixed');
    const firstDraws = Array.from({ length: 5 }, () => a.stream('arrivals').uniform());
    const b = new StreamSet('fixed');
    b.stream('service');
    b.stream('patience');
    const secondDraws = Array.from({ length: 5 }, () => b.stream('arrivals').uniform());
    expect(secondDraws).toEqual(firstDraws);
    expect(b.stream('service').uniform()).not.toBe(b.stream('arrivals').uniform());
  });
});

// ---------------------------------------------------------------------------
// Against queueing theory
// ---------------------------------------------------------------------------

describe('agreement with analytic queueing theory', () => {
  for (const rho of [0.5, 0.8]) {
    it(`matches the exact M/M/1 results at rho = ${rho}`, () => {
      const mu = 1;
      const lambda = rho * mu;
      // Closed forms written out here, independently of the engine and of the
      // queueing module: L = rho/(1-rho), Lq = rho^2/(1-rho),
      // W = 1/(mu-lambda), Wq = rho/(mu-lambda).
      const exact = {
        L: rho / (1 - rho),
        Lq: (rho * rho) / (1 - rho),
        W: 1 / (mu - lambda),
        Wq: rho / (mu - lambda),
      };
      const report = validateQueueAgainstTheory({
        family: 'mm1',
        arrivalRate: lambda,
        serviceRate: mu,
        seed: `mm1-${rho}`,
        until: 200_000,
        warmupTime: 5_000,
        batchCount: 30,
        // A 95% interval misses the truth one time in twenty BY CONSTRUCTION,
        // and this file checks two dozen intervals, so at 95% about one of
        // them would be expected to miss on any given seed. A test that must
        // pass deterministically therefore checks a 99.9% interval — i.e.
        // that the error is within 3.3 of the simulation's own reported
        // standard errors — which tests the standard error just as directly
        // while leaving no room for a chance failure. The relative-error
        // bounds below keep the test demanding about the estimate itself.
        level: 0.999,
      });
      // The queueing module must agree with the hand-written closed forms.
      for (const check of report.checks) {
        expect(check.analytic).toBeCloseTo(exact[check.metric as 'L' | 'Lq' | 'W' | 'Wq'], 10);
      }
      // The real test: the simulation's own 95% interval contains the truth.
      for (const check of report.checks) {
        expect(
          check.covers,
          `${check.metric}: exact ${check.analytic}, simulated ${check.simulated}, interval [${check.interval.low}, ${check.interval.high}]`,
        ).toBe(true);
      }
      expect(report.allIntervalsCover).toBe(true);
      // The estimates must also be close in absolute terms, not merely inside
      // a wide interval: 5% of the exact value over this run length.
      for (const check of report.checks) expect(Math.abs(check.relativeError)).toBeLessThan(0.05);
      // And the batches used for those intervals must themselves be
      // uncorrelated, or the intervals mean nothing.
      for (const check of report.checks) expect(check.batchIndependencePassed).toBe(true);
      expect(report.utilisation).toBeCloseTo(rho, 2);
    }, 120_000);
  }

  it("satisfies Little's law within the simulation's own statistics", () => {
    const report = validateQueueAgainstTheory({
      family: 'mm1',
      arrivalRate: 0.7,
      serviceRate: 1,
      seed: 'littles-law',
      until: 150_000,
      warmupTime: 5_000,
    });
    // L = lambda*W is an identity along the sample path, so the only slack is
    // from customers present at the window boundaries: O(L/N), about 3e-5
    // here. A tight relative tolerance therefore catches real
    // statistics-collection bugs rather than sampling noise.
    expect(report.littlesLaw.relativeResidual).toBeLessThan(1e-3);
    expect(report.littlesLaw.holds).toBe(true);
    expect(Math.abs(report.littlesLaw.Lq - report.littlesLaw.lambdaWq) / report.littlesLaw.Lq).toBeLessThan(1e-3);
  }, 120_000);

  it('matches the exact M/M/c results', () => {
    const lambda = 2.4;
    const mu = 1;
    const servers = 3;
    const analysis = analyseMmc({ arrivalRate: lambda, serviceRate: mu, servers });
    const report = validateQueueAgainstTheory({
      family: 'mmc',
      arrivalRate: lambda,
      serviceRate: mu,
      servers,
      seed: 'mmc',
      until: 150_000,
      warmupTime: 5_000,
      batchCount: 30,
      // See the note on the M/M/1 test for why a 99.9% interval is checked.
      level: 0.999,
    });
    expect(report.kendall).toContain('M/M/c');
    for (const check of report.checks) {
      expect(
        check.covers,
        `${check.metric}: exact ${check.analytic}, interval [${check.interval.low}, ${check.interval.high}]`,
      ).toBe(true);
    }
    // Erlang C cross-check: Lq = C(c,a)·rho/(1-rho) with a = lambda/mu.
    const a = lambda / mu;
    const rho = a / servers;
    let sum = 0;
    let term = 1;
    for (let n = 0; n < servers; n++) {
      if (n > 0) term *= a / n;
      sum += term;
    }
    const lastTerm = term * (a / servers);
    const erlangC = (lastTerm / (1 - rho)) / (sum + lastTerm / (1 - rho));
    expect(analysis.metrics.Lq).toBeCloseTo((erlangC * rho) / (1 - rho), 8);
  }, 120_000);

  it("matches M/D/1 and reproduces the exact halving of M/M/1's queue", () => {
    const lambda = 0.75;
    const mu = 1;
    const rho = lambda / mu;
    // Pollaczek-Khinchine: Lq = rho^2(1+cs^2)/(2(1-rho)). With cs^2 = 0 for
    // deterministic service that is exactly half the M/M/1 value (cs^2 = 1).
    const mm1Lq = (rho * rho) / (1 - rho);
    const md1Lq = (rho * rho) / (2 * (1 - rho));
    expect(md1Lq).toBeCloseTo(mm1Lq / 2, 12);
    const report = validateQueueAgainstTheory({
      family: 'md1',
      arrivalRate: lambda,
      serviceRate: mu,
      seed: 'md1',
      until: 200_000,
      warmupTime: 5_000,
      batchCount: 30,
      // See the note on the M/M/1 test for why a 99.9% interval is checked.
      level: 0.999,
    });
    const lq = report.checks.find((c) => c.metric === 'Lq')!;
    expect(lq.analytic).toBeCloseTo(md1Lq, 8);
    for (const check of report.checks) {
      expect(
        check.covers,
        `${check.metric}: exact ${check.analytic}, interval [${check.interval.low}, ${check.interval.high}]`,
      ).toBe(true);
    }
    // The simulated M/D/1 queue must itself be about half the M/M/1 queue.
    expect(lq.simulated).toBeGreaterThan(0.35 * mm1Lq);
    expect(lq.simulated).toBeLessThan(0.65 * mm1Lq);
  }, 120_000);

  it('matches the exact M/G/1 result for a gamma service time', () => {
    const report = validateQueueAgainstTheory({
      family: 'mg1',
      arrivalRate: 0.7,
      serviceRate: 1,
      serviceScv: 0.25,
      seed: 'mg1',
      until: 200_000,
      warmupTime: 5_000,
      batchCount: 30,
      // See the note on the M/M/1 test for why a 99.9% interval is checked.
      level: 0.999,
    });
    for (const check of report.checks) {
      expect(
        check.covers,
        `${check.metric}: exact ${check.analytic}, interval [${check.interval.low}, ${check.interval.high}]`,
      ).toBe(true);
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Warm-up detection
// ---------------------------------------------------------------------------

describe('warm-up detection', () => {
  it('detects initialisation bias from a deliberately loaded start and removes it', () => {
    const lambda = 0.8;
    const mu = 1;
    const exactWq = lambda / (mu - lambda) / mu; // rho/(mu - lambda) = 4
    expect(exactWq).toBeCloseTo(4, 12);
    const customers = 4_000;
    const replications = 30;
    const series: number[][] = [];
    for (let r = 0; r < replications; r++) {
      const run = runQueueStation(
        {
          arrival: { kind: 'exponential', rate: lambda },
          service: { kind: 'exponential', rate: mu },
          servers: 1,
          // Fifty customers already queued: the system starts far above its
          // steady state, so the first few hundred waits are badly inflated.
          initialCustomers: 50,
          arrivalLimit: customers,
        },
        { seed: `warmup-${r}` },
      );
      series.push([...run.waitingSeries].slice(0, customers));
    }
    const welch = welchWarmup(series, { window: 40 });
    // (a) the bias must be found, and a non-zero period discarded
    expect(welch.biasDetected).toBe(true);
    expect(welch.truncation).toBeGreaterThan(0);
    expect(welch.message).toMatch(/discard/i);
    // (b) after discarding, the estimate matches theory; before, it does not
    expect(Math.abs(welch.truncatedMean - exactWq)).toBeLessThan(0.5);
    expect(welch.untruncatedMean - exactWq).toBeGreaterThan(0.5);
    expect(Math.abs(welch.untruncatedMean - exactWq)).toBeGreaterThan(Math.abs(welch.truncatedMean - exactWq));

    // MSER-5 reaches the same verdict from a single replication.
    const single = mser5(series[0]);
    expect(single.truncation).toBeGreaterThan(0);
    expect(Math.abs(single.truncatedMean - exactWq)).toBeLessThan(
      Math.abs(single.untruncatedMean - exactWq),
    );
  }, 120_000);

  it("refuses Welch's method with a single replication", () => {
    expect(() => welchWarmup([[1, 2, 3]])).toThrow(/at least 2 replications/i);
  });

  it('refuses MSER on a series too short to choose a truncation point', () => {
    expect(() => mser5([1, 2, 3, 4, 5])).toThrow(/at least 100 observations/i);
  });
});

// ---------------------------------------------------------------------------
// Batch means
// ---------------------------------------------------------------------------

describe('batch means', () => {
  it('fires the correlation check for short batches and passes it for long ones', () => {
    const lambda = 0.8;
    const run = runQueueStation(
      { arrival: { kind: 'exponential', rate: lambda }, service: { kind: 'exponential', rate: 1 }, servers: 1 },
      { seed: 'batch-correlation', until: 150_000, warmupTime: 5_000 },
    );
    const series = run.waitingSeries;
    expect(series.length).toBeGreaterThan(100_000);
    // Deliberately short batches: successive waits in an M/M/1 at rho = 0.8
    // are correlated over hundreds of customers, so batches of ~50 cannot be
    // independent and the check must say so.
    const short = batchMeans(series, { batchSize: 50 });
    expect(short.independence.passed).toBe(false);
    expect(short.independence.lag1).toBeGreaterThan(0);
    expect(short.warnings.join(' ')).toMatch(/too narrow/i);
    // Long batches: the check passes and no warning is raised.
    const long = batchMeans(series, { batchCount: 20 });
    expect(long.batchSize).toBeGreaterThan(4_000);
    expect(long.independence.passed).toBe(true);
    // The correlated interval is narrower than the honest one, which is
    // exactly why an untested batch-means interval is dangerous.
    expect(short.halfWidth).toBeLessThan(long.halfWidth);
  }, 120_000);

  it('gives approximately nominal coverage of the known analytic mean', () => {
    const lambda = 0.5;
    const mu = 1;
    const exactWq = lambda / (mu * (mu - lambda)); // rho/(mu-lambda) = 1
    expect(exactWq).toBeCloseTo(1, 12);
    const runs = 60;
    let covered = 0;
    for (let r = 0; r < runs; r++) {
      const run = runQueueStation(
        { arrival: { kind: 'exponential', rate: lambda }, service: { kind: 'exponential', rate: mu }, servers: 1 },
        { seed: `coverage-${r}`, until: 20_000, warmupTime: 500 },
      );
      const bm = batchMeans(run.waitingSeries, { batchCount: 20 });
      if (exactWq >= bm.meanInterval.low && exactWq <= bm.meanInterval.high) covered++;
    }
    // Binomial(60, 0.95) has mean 57 and standard deviation 1.7, so anything
    // from 51 up is consistent with nominal coverage; well below that means
    // the variance estimate is wrong, which is the point of the test.
    expect(covered).toBeGreaterThanOrEqual(51);
    expect(covered).toBeLessThanOrEqual(runs);
  }, 160_000);

  it('refuses too few batches rather than reporting a meaningless interval', () => {
    const series = Array.from({ length: 1_000 }, (_, i) => i % 7);
    expect(() => batchMeans(series, { batchCount: 5 })).toThrow(EngineError);
    expect(() => batchMeans(series, { batchCount: 5 })).toThrow(/at least 10 batches/i);
  });

  it('refuses batch means on an empty series', () => {
    expect(() => batchMeans([])).toThrow(/no observations/i);
  });

  it('detects correlation in a deliberately correlated sequence', () => {
    // AR(1) with phi = 0.8: lag-1 correlation 0.8, unmistakably positive.
    const rng = new Random(new Xoshiro128('ar1'));
    const values: number[] = [];
    let x = 0;
    for (let i = 0; i < 500; i++) {
      x = 0.8 * x + rng.normal();
      values.push(x);
    }
    const test = lag1IndependenceTest(values);
    expect(test.lag1).toBeGreaterThan(0.6);
    expect(test.passed).toBe(false);
    // Independent draws pass.
    const independent = Array.from({ length: 500 }, () => rng.normal());
    expect(lag1IndependenceTest(independent).passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Replication analysis
// ---------------------------------------------------------------------------

describe('replication analysis', () => {
  it('covers a known analytic mean about 95% of the time across 300 sets', () => {
    // Terminating M/M/infinity over [0, T] starting empty. E[N(t)] =
    // (lambda/mu)(1 - e^{-mu t}), so the expected TIME-AVERAGE over [0, T] is
    // (lambda/mu)[1 - (1 - e^{-mu T})/(mu T)]. Exact, and independent of this
    // engine.
    const lambda = 5;
    const mu = 1;
    const T = 10;
    const exact = (lambda / mu) * (1 - (1 - Math.exp(-mu * T)) / (mu * T));
    const sets = 300;
    const replications = 10;
    let covered = 0;
    for (let s = 0; s < sets; s++) {
      const values: number[] = [];
      for (let r = 0; r < replications; r++) {
        const run = runQueueStation(
          {
            arrival: { kind: 'exponential', rate: lambda },
            // 200 servers is effectively infinite here: the mean number in
            // system is 5, so a queue never forms.
            service: { kind: 'exponential', rate: mu },
            servers: 200,
          },
          { seed: `rep-${s}-${r}`, until: T },
        );
        values.push(run.L);
      }
      const report = replicationAnalysis(values);
      if (exact >= report.meanInterval.low && exact <= report.meanInterval.high) covered++;
    }
    const rate = covered / sets;
    // Binomial(300, 0.95): mean 285, sd 3.8. The t interval with 9 degrees of
    // freedom on a mildly skewed statistic undercovers slightly, so the band
    // allows for that while still failing a genuinely broken variance.
    expect(rate).toBeGreaterThan(0.9);
    expect(rate).toBeLessThanOrEqual(1);
  }, 160_000);

  it('refuses to report an interval from a single replication', () => {
    expect(() => replicationAnalysis([4.2])).toThrow(EngineError);
    expect(() => replicationAnalysis([4.2])).toThrow(/at least 2 independent replications/i);
    expect(() => replicationAnalysis([])).toThrow(/no replications/i);
  });

  it('says how many replications a target precision needs', () => {
    const rng = new Random(new Xoshiro128('precision'));
    const values = Array.from({ length: 20 }, () => 10 + 2 * rng.normal());
    const report = replicationAnalysis(values);
    const plan = replicationsForPrecision(report, report.halfWidth / 2);
    // Halving the half-width needs roughly four times the replications.
    expect(plan.requiredReplications).toBeGreaterThan(3 * report.replications);
    expect(plan.requiredReplications).toBeLessThan(6 * report.replications);
    expect(plan.additionalReplications).toBe(plan.requiredReplications - report.replications);
  });

  it('separates the interval for the mean from the spread of replications', () => {
    const rng = new Random(new Xoshiro128('separate'));
    const values = Array.from({ length: 50 }, () => 10 + 3 * rng.normal());
    const report = replicationAnalysis(values);
    const p95 = report.replicationPercentiles.find((p) => p.p === 0.95)!.value;
    expect(report.halfWidth).toBeLessThan(1.2);
    expect(p95 - report.mean).toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------------------
// Comparing alternatives
// ---------------------------------------------------------------------------

describe('comparing alternatives', () => {
  it('reduces the variance of an estimated difference with common random numbers', () => {
    const configFor = (serviceRate: number): QueueStationConfig => ({
      arrival: { kind: 'exponential', rate: 0.8 },
      service: { kind: 'exponential', rate: serviceRate },
      servers: 1,
    });
    const wq = (serviceRate: number, seed: string): number =>
      runQueueStation(configFor(serviceRate), { seed, until: 4_000, warmupTime: 400 }).Wq;

    const pairs = 40;
    const crnA: number[] = [];
    const crnB: number[] = [];
    const independentA: number[] = [];
    const independentB: number[] = [];
    for (let i = 0; i < pairs; i++) {
      // Common random numbers: both configurations share the seed, so they
      // share the arrival stream exactly.
      crnA.push(wq(1.0, `crn-${i}`));
      crnB.push(wq(1.1, `crn-${i}`));
      independentA.push(wq(1.0, `ind-a-${i}`));
      independentB.push(wq(1.1, `ind-b-${i}`));
    }
    const report = commonRandomNumbersReport({ crnA, crnB, independentA, independentB, labelA: 'mu = 1.0', labelB: 'mu = 1.1' });
    expect(report.effective).toBe(true);
    // The arrival process dominates the variability of Wq, and common random
    // numbers removes all of it, so the reduction is large rather than
    // marginal.
    expect(report.varianceReductionFactor).toBeGreaterThan(3);
    expect(report.varianceWithCrn).toBeLessThan(report.varianceIndependent);
    // Slower service must give a longer wait; with CRN the difference is
    // resolved, while independent streams may not resolve it at all.
    expect(report.paired.meanDifference).toBeGreaterThan(0);
    expect(report.paired.significant).toBe(true);
    expect(report.paired.differenceInterval.high - report.paired.differenceInterval.low).toBeLessThan(
      report.independent.differenceInterval.high - report.independent.differenceInterval.low,
    );
  }, 160_000);

  it('refuses a paired comparison on unequal numbers of runs', () => {
    expect(() => pairedTComparison([1, 2, 3], [1, 2])).toThrow(/same number of observations/i);
  });

  it('widens each interval so several comparisons hold together', () => {
    const rng = new Random(new Xoshiro128('multi'));
    const configs = [0, 0.2, 0.4, 0.6].map((shift, i) => ({
      name: `config ${i}`,
      values: Array.from({ length: 30 }, () => shift + rng.normal()),
    }));
    const report = multipleComparisons(configs, { familyLevel: 0.95 });
    expect(report.comparisonCount).toBe(6);
    expect(report.perComparisonLevel).toBeCloseTo(1 - 0.05 / 6, 12);
    const single = pairedTComparison(configs[0].values, configs[3].values, { level: 0.95 });
    const adjusted = report.comparisons.find((c) => c.labelA === 'config 0' && c.labelB === 'config 3')!;
    // The simultaneous interval must be wider than the single one.
    expect(adjusted.differenceInterval.high - adjusted.differenceInterval.low).toBeGreaterThan(
      single.differenceInterval.high - single.differenceInterval.low,
    );
    expect(report.best.name).toBe('config 0');
  });

  it('refuses a baseline that is not among the configurations', () => {
    expect(() =>
      multipleComparisons([{ name: 'a', values: [1, 2, 3] }, { name: 'b', values: [2, 3, 4] }], { baseline: 'c' }),
    ).toThrow(/not among the configurations/i);
  });
});

// ---------------------------------------------------------------------------
// The regenerative method
// ---------------------------------------------------------------------------

describe('regenerative method', () => {
  it('estimates the M/M/1 mean number in system from genuine regeneration cycles', () => {
    // An arrival to an EMPTY M/M/1 system is a true regeneration point: from
    // there the future is independent of the past. The cycles between such
    // points are therefore independent by construction, so the ratio
    // estimator needs no warm-up removal and no batching assumption.
    const lambda = 0.6;
    const mu = 1;
    const exactL = lambda / (mu - lambda);
    expect(exactL).toBeCloseTo(1.5, 12);
    const sim = new Simulation({ seed: 'regenerative' });
    const server = sim.resource('server', { capacity: 1 });
    const cycles: { sum: number; length: number }[] = [];
    const tracker = { n: 0, area: 0, lastTime: 0, cycleStart: null as number | null };
    const accumulate = (): void => {
      tracker.area += tracker.n * (sim.now - tracker.lastTime);
      tracker.lastTime = sim.now;
    };
    sim.activate(
      source({
        stream: 'arrivals',
        interarrival: exponentialDelay(lambda),
        entity: () =>
          function* customer(s) {
            accumulate();
            if (tracker.n === 0) {
              // A cycle runs from one regeneration point to the NEXT, so it
              // includes the idle period that follows the busy period. Closing
              // it when the system empties instead would divide the integral
              // by the busy period alone, which estimates the mean number in
              // system GIVEN the server is busy — a different quantity, larger
              // by a factor of 1/rho.
              if (tracker.cycleStart !== null) {
                cycles.push({ sum: tracker.area, length: s.now - tracker.cycleStart });
                tracker.area = 0;
              }
              tracker.cycleStart = s.now;
            }
            tracker.n++;
            const got = yield seize(server);
            yield hold(s.stream('service').exponential(mu));
            yield release(got.request!);
            accumulate();
            tracker.n--;
          },
      }),
      'arrival source',
    );
    runDes(sim, { until: 300_000 });
    // Mean cycle length is 1/lambda + (1/mu)/(1-rho) = 1.667 + 2.5 = 4.167, so
    // a run of 300,000 time units gives about 72,000 independent cycles.
    expect(cycles.length).toBeGreaterThan(50_000);
    const report = regenerativeAnalysis(cycles, { level: 0.999 });
    expect(report.meanInterval.low).toBeLessThanOrEqual(exactL);
    expect(report.meanInterval.high).toBeGreaterThanOrEqual(exactL);
    // Agreement is demanded in units of the engine's OWN reported standard
    // error, which is the same statement as the coverage assertion above and
    // avoids a hand-picked tolerance. The second assertion keeps the test
    // meaningful by requiring that standard error to be small in the first
    // place: a method that reported a huge uncertainty would otherwise pass.
    expect(Math.abs(report.estimate - exactL)).toBeLessThanOrEqual(3.3 * report.standardError);
    expect(report.standardError).toBeLessThan(0.03);
    expect(report.estimate).toBeGreaterThan(1.4);
    expect(report.estimate).toBeLessThan(1.6);
    expect(report.meanCycleLength).toBeCloseTo(1 / lambda + 1 / (mu - lambda), 0);
    expect(report.note).toMatch(/regeneration point/i);
  }, 120_000);

  it('refuses too few cycles', () => {
    expect(() => regenerativeAnalysis([{ sum: 1, length: 1 }, { sum: 2, length: 1 }])).toThrow(/at least 10/i);
  });

  it('refuses a cycle of non-positive length', () => {
    const cycles = Array.from({ length: 12 }, () => ({ sum: 1, length: 1 }));
    cycles[3] = { sum: 1, length: 0 };
    expect(() => regenerativeAnalysis(cycles)).toThrow(/positive length/i);
  });
});

// ---------------------------------------------------------------------------
// Reneging and balking
// ---------------------------------------------------------------------------

describe('reneging and balking', () => {
  it('abandons more often as the load rises', () => {
    const rates: number[] = [];
    for (const lambda of [0.5, 0.8, 0.95]) {
      const run = runQueueStation(
        {
          arrival: { kind: 'exponential', rate: lambda },
          service: { kind: 'exponential', rate: 1 },
          servers: 1,
          patience: 5,
        },
        { seed: `renege-${lambda}`, until: 60_000, warmupTime: 1_000 },
      );
      const served = run.report.counters.find((c) => c.name === 'served')!.value;
      const reneged = run.report.counters.find((c) => c.name === 'reneged')!.value;
      expect(reneged).toBeGreaterThan(0);
      rates.push(reneged / (served + reneged));
    }
    expect(rates[1]).toBeGreaterThan(rates[0]);
    expect(rates[2]).toBeGreaterThan(rates[1]);
  }, 120_000);

  it('reproduces the no-reneging run exactly when patience is infinite', () => {
    const base: QueueStationConfig = {
      arrival: { kind: 'exponential', rate: 0.8 },
      service: { kind: 'exponential', rate: 1 },
      servers: 1,
    };
    const withoutReneging = runQueueStation(base, { seed: 'patience', until: 20_000, collectTrace: true });
    const infinitePatience = runQueueStation(
      { ...base, patience: Number.POSITIVE_INFINITY },
      { seed: 'patience', until: 20_000, collectTrace: true },
    );
    // Not merely close: an infinite patience must schedule no timer at all, so
    // the event traces are identical event for event.
    expect(JSON.stringify(infinitePatience.report.trace)).toBe(JSON.stringify(withoutReneging.report.trace));
    expect(infinitePatience.Wq).toBe(withoutReneging.Wq);
    expect(infinitePatience.report.counters.find((c) => c.name === 'reneged')!.value).toBe(0);
  }, 60_000);

  it('turns customers away when the queue is already long', () => {
    const run = runQueueStation(
      {
        arrival: { kind: 'exponential', rate: 0.9 },
        service: { kind: 'exponential', rate: 1 },
        servers: 1,
        balkAt: 3,
      },
      { seed: 'balk', until: 40_000, warmupTime: 1_000 },
    );
    const balked = run.report.counters.find((c) => c.name === 'balked')!.value;
    expect(balked).toBeGreaterThan(0);
    // With a balking threshold of 3, the queue can never exceed 3 waiting.
    const queue = run.report.resources[0].queueLength;
    expect(queue.max).toBeLessThanOrEqual(3);
    // An M/M/1/4 queue (3 waiting plus 1 in service) has an exact mean number
    // in system: L = sum n*p_n with p_n = rho^n (1-rho)/(1-rho^{K+1}), K = 4.
    const rho = 0.9;
    const K = 4;
    let norm = 0;
    let weighted = 0;
    for (let n = 0; n <= K; n++) {
      const p = Math.pow(rho, n);
      norm += p;
      weighted += n * p;
    }
    const exactL = weighted / norm;
    expect(run.L).toBeCloseTo(exactL, 1);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Finite buffer and blocking
// ---------------------------------------------------------------------------

describe('finite buffer blocking', () => {
  it('blocks exactly as the analytic two-station result predicts', () => {
    // Saturated two-station line, zero buffer, exponential processing. The
    // three-state Markov chain (station 1 working / both working / station 1
    // blocked) gives throughput = m1 m2 (m1 + m2) / (m1^2 + m1 m2 + m2^2).
    // For equal rates that is 2/3 of the nominal capacity: the third is lost
    // purely to blocking.
    const m1 = 1;
    const m2 = 1;
    const exact = (m1 * m2 * (m1 + m2)) / (m1 * m1 + m1 * m2 + m2 * m2);
    expect(exact).toBeCloseTo(2 / 3, 12);
    const config = { meanProcessing: [1 / m1, 1 / m2] as [number, number], bufferCapacity: 0, saturated: true };
    expect(productionLineModel.theoretical!(config)[0].value).toBeCloseTo(exact, 12);

    const throughputs: number[] = [];
    for (let r = 0; r < 20; r++) {
      const sim = productionLineModel.build(config, `line-${r}`);
      const report = runDes(sim, { until: 20_000, warmupTime: 500 });
      const produced = report.counters.find((c) => c.name === 'produced')!.value;
      throughputs.push(produced / (report.endTime - report.warmup!.discardedUntil));
    }
    const analysis = replicationAnalysis(throughputs);
    expect(analysis.meanInterval.low).toBeLessThanOrEqual(exact);
    expect(analysis.meanInterval.high).toBeGreaterThanOrEqual(exact);
    // A larger buffer must raise throughput towards the nominal rate.
    const buffered: number[] = [];
    for (let r = 0; r < 10; r++) {
      const sim = productionLineModel.build({ ...config, bufferCapacity: 5 }, `buffered-${r}`);
      const report = runDes(sim, { until: 20_000, warmupTime: 500 });
      const produced = report.counters.find((c) => c.name === 'produced')!.value;
      buffered.push(produced / (report.endTime - report.warmup!.discardedUntil));
    }
    const bufferedAnalysis = replicationAnalysis(buffered);
    expect(bufferedAnalysis.mean).toBeGreaterThan(analysis.mean);
    expect(bufferedAnalysis.mean).toBeLessThan(1);
  }, 160_000);
});

// ---------------------------------------------------------------------------
// Rare events
// ---------------------------------------------------------------------------

describe('rare events', () => {
  // P(Z > b) = 1e-6 exactly, with b from the standard normal quantile and the
  // reference probability from the complementary error function.
  const b = normalQuantile(1 - 1e-6);
  const exact = normalSf(b);

  it('reports "not observed" with an upper bound instead of a probability of zero', () => {
    const trials = 200_000;
    const report = plainMonteCarloRareEvent({ trials, seed: 'plain-rare', indicator: (rng) => rng.normal() > b });
    // At 1e-6 and 200,000 trials the expected count is 0.2, so plain Monte
    // Carlo almost always sees nothing.
    expect(report.occurrences).toBe(0);
    expect(report.observed).toBe(false);
    // The headline honesty requirement: no estimate at all, never zero.
    expect(report.estimate).toBeNull();
    expect(report.standardError).toBeNull();
    expect(report.message).toMatch(/not observed in|was not observed/i);
    expect(report.message).toMatch(/NOT 0|not 0/);
    // The bound it does support must be valid and non-trivial.
    expect(report.upperBound).toBeCloseTo(1 - Math.pow(0.05, 1 / trials), 12);
    expect(report.upperBound).toBeGreaterThan(exact);
    expect(report.upperBound).toBeLessThan(1e-4);
    expect(report.interval.low).toBe(0);
    expect(report.interval.high).toBeGreaterThan(exact);
  });

  it('recovers the known probability by importance splitting', () => {
    // Six nested levels at the exact 10^-k quantiles, so every conditional
    // probability is 0.1 and the product is 1e-6.
    const levels = [1, 2, 3, 4, 5, 6].map((k) => normalQuantile(1 - Math.pow(10, -k)));
    levels[5] = b;
    const result = importanceSplitting<number>({
      levels,
      initial: (rng) => rng.normal(),
      levelOf: (x) => x,
      advance: normalTailAdvance,
      particlesPerLevel: 150_000,
      seed: 'splitting',
      level: 0.999,
    });
    // With exact conditional sampling the per-level estimates are independent
    // binomials, so the coefficient of variation is exactly
    // sqrt(sum (1-p)/(p N)) = sqrt(6 x 9 / 150000) = 1.9%. The tolerance below
    // is 2.5 standard errors of the estimator the engine itself reports, which
    // is a statement about the method rather than a hand-picked number.
    expect(result.coefficientOfVariation).toBeLessThan(0.021);
    expect(Math.abs(result.estimate / exact - 1)).toBeLessThan(0.05);
    expect(Math.abs(result.estimate / exact - 1)).toBeLessThan(2.5 * result.coefficientOfVariation);
    expect(result.interval.low).toBeLessThanOrEqual(exact);
    expect(result.interval.high).toBeGreaterThanOrEqual(exact);
    expect(result.effectiveSampleSize).toBeGreaterThan(1e8);
    for (const level of result.levels) {
      expect(level.conditionalProbability).toBeGreaterThan(0.05);
      expect(level.conditionalProbability).toBeLessThan(0.2);
    }
  }, 60_000);

  it('recovers the known probability by subset simulation', () => {
    const result = subsetSimulation({
      dimension: 1,
      performance: (x) => x[0],
      threshold: b,
      samplesPerLevel: 10_000,
      seed: 'subset',
    });
    // Subset simulation's Markov-chain samples are correlated, so its
    // coefficient of variation is several times larger than the splitting
    // estimator's at the same sample size. The demand is therefore interval
    // coverage plus agreement within a few standard errors, not a tight
    // tolerance that would only be passing by luck.
    expect(result.interval.low).toBeLessThanOrEqual(exact);
    expect(result.interval.high).toBeGreaterThanOrEqual(exact);
    expect(Math.abs(result.estimate / exact - 1)).toBeLessThan(2.5 * result.coefficientOfVariation);
    expect(result.levels.length).toBeGreaterThanOrEqual(6);
    // The correlation factor must be reported, and must be non-zero for the
    // chain-sampled levels: claiming independence there would be false.
    expect(result.levels[0].correlationFactor).toBe(0);
    expect(result.levels[1].correlationFactor).toBeGreaterThan(0);
  }, 60_000);

  it('recovers the known probability by the cross-entropy method', () => {
    const result = crossEntropyMethod({
      dimension: 1,
      performance: (x) => x[0],
      threshold: b,
      samplesPerIteration: 2_000,
      finalSamples: 20_000,
      seed: 'cross-entropy',
    });
    expect(result.coefficientOfVariation).toBeLessThan(0.05);
    expect(Math.abs(result.estimate / exact - 1)).toBeLessThan(0.05);
    expect(result.interval.low).toBeLessThanOrEqual(exact);
    expect(result.interval.high).toBeGreaterThanOrEqual(exact);
    // The fitted tilt must have moved close to the threshold; that is the
    // whole mechanism.
    const finalMean = result.iterations[result.iterations.length - 1].mean[0];
    expect(finalMean).toBeGreaterThan(b - 1);
  }, 60_000);

  it('refuses rather than reporting a product with a zero factor', () => {
    expect(() =>
      importanceSplitting<number>({
        // A single level far beyond anything the initial draw can reach.
        levels: [12],
        initial: (rng) => rng.normal(),
        levelOf: (x) => x,
        advance: normalTailAdvance,
        particlesPerLevel: 100,
        seed: 'extinct',
      }),
    ).toThrow(/entire population|probability 0/i);
  });

  it('refuses non-monotone splitting levels', () => {
    expect(() =>
      importanceSplitting<number>({
        levels: [1, 3, 2],
        initial: (rng) => rng.normal(),
        levelOf: (x) => x,
        advance: normalTailAdvance,
        particlesPerLevel: 100,
        seed: 'bad-levels',
      }),
    ).toThrow(/strictly increasing/i);
  });

  it('refuses a cross-entropy run that never reaches the threshold', () => {
    expect(() =>
      crossEntropyMethod({
        dimension: 1,
        // A bounded performance function can never exceed the threshold.
        performance: (x) => Math.tanh(x[0]),
        threshold: 5,
        samplesPerIteration: 200,
        maxIterations: 6,
        seed: 'unreachable',
      }),
    ).toThrow(EngineError);
  });
});

// ---------------------------------------------------------------------------
// Queue disciplines and resources
// ---------------------------------------------------------------------------

describe('queue disciplines', () => {
  it('leaves the mean waiting time unchanged but changes its spread', () => {
    const results = (['fifo', 'lifo', 'spt'] as const).map((discipline) => {
      const run = runQueueStation(
        {
          arrival: { kind: 'exponential', rate: 0.8 },
          service: { kind: 'exponential', rate: 1 },
          servers: 1,
          discipline,
        },
        { seed: 'discipline', until: 60_000, warmupTime: 2_000 },
      );
      const tally = run.report.tallies.find((t) => t.name === 'waitingTime')!;
      return { discipline, mean: tally.mean, sd: tally.sd, p95: tally.percentiles!.find((p) => p.p === 0.95)!.value };
    });
    const fifo = results.find((r) => r.discipline === 'fifo')!;
    const lifo = results.find((r) => r.discipline === 'lifo')!;
    const spt = results.find((r) => r.discipline === 'spt')!;
    // Work conservation: for a single server the MEAN wait is the same under
    // any discipline that does not look at the service times, exactly
    // rho/(mu-lambda) = 4 here. FIFO and LIFO qualify.
    expect(fifo.mean).toBeCloseTo(4, 0);
    expect(lifo.mean).toBeCloseTo(4, 0);
    // The spread is not conserved: LIFO leaves some customers waiting a very
    // long time while serving most quickly.
    expect(lifo.sd).toBeGreaterThan(fifo.sd);
    expect(lifo.p95).toBeGreaterThan(fifo.p95);
    // Shortest processing time first DOES look at the service times, so it is
    // not work-conserving in this sense and genuinely lowers the mean wait.
    expect(spt.mean).toBeLessThan(0.8 * fifo.mean);
  }, 120_000);

  it('refuses a shortest-processing-time queue with no declared service time', () => {
    const sim = new Simulation({ seed: 'spt' });
    const resource = sim.resource('machine', { capacity: 1, discipline: 'spt' });
    expect(() => resource.request({ onGrant: () => {} })).toThrow(/shortest-processing-time/i);
  });

  it('serves a priority queue in priority order', () => {
    const sim = new Simulation({ seed: 'priority' });
    const desk = sim.resource('desk', { capacity: 1, discipline: 'priority' });
    const order: number[] = [];
    sim.activate(function* blocker() {
      const got = yield seize(desk);
      yield hold(10);
      yield release(got.request!);
    }, 'blocker');
    for (const priority of [3, 1, 2]) {
      sim.activate(function* customer() {
        const got = yield seize(desk, { priority });
        order.push(priority);
        yield hold(1);
        yield release(got.request!);
      }, `priority ${priority}`);
    }
    runDes(sim, { until: 100 });
    expect(order).toEqual([1, 2, 3]);
  });

  it('preempts a less urgent job and resumes its remaining work', () => {
    const sim = new Simulation({ seed: 'preempt' });
    const machine = sim.resource('machine', { capacity: 1, preemptive: true });
    const events: string[] = [];
    sim.activate(function* lowPriority() {
      const got = yield seize(machine, { priority: 5, preemptible: true });
      let remaining = 10;
      let request = got.request!;
      for (;;) {
        const done = yield serve(request, remaining);
        if (done.ok) break;
        events.push(`preempted with ${done.remaining} left at ${sim.now}`);
        remaining = done.remaining;
        const again = yield seize(machine, { priority: 5, preemptible: true });
        request = again.request!;
      }
      events.push(`finished at ${sim.now}`);
      yield release(request);
    }, 'low');
    sim.activate(function* urgent() {
      yield hold(3);
      const got = yield seize(machine, { priority: 0 });
      events.push(`urgent started at ${sim.now}`);
      yield hold(4);
      yield release(got.request!);
    }, 'urgent');
    runDes(sim, { until: 100 });
    // Both the preemption and the urgent job's start happen at time 3; the
    // interesting content is that the interrupted job keeps its REMAINING 7
    // units of work and finishes at 3 + 4 (the urgent job) + 7 = 14, rather
    // than restarting from 10.
    expect(events).toContain('preempted with 7 left at 3');
    expect(events).toContain('urgent started at 3');
    expect(events[events.length - 1]).toBe('finished at 14');
    expect(machine.preemptions.value).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The runner contract
// ---------------------------------------------------------------------------

describe('runner contract', () => {
  it('yields between chunks so a long run can be cancelled', () => {
    const sim = new Simulation({ seed: 'cancel' });
    sim.activate(function* ticker() {
      for (;;) yield hold(1);
    }, 'ticker');
    const steps = desSteps(sim, { until: 1_000_000, chunkEvents: 100 });
    let yields = 0;
    let step = steps.next();
    while (!step.done && yields < 3) {
      yields++;
      step = steps.next();
    }
    expect(yields).toBe(3);
    expect(sim.kernel.eventsExecuted).toBeGreaterThanOrEqual(300);
    // Cancelling between chunks stops the run and says so.
    const cancelled = desSteps(sim, { until: 1_000_000, chunkEvents: 100, hooks: { isCancelled: () => true } });
    let next = cancelled.next();
    while (!next.done) next = cancelled.next();
    expect(next.value.cancelled).toBe(true);
    expect(next.value.terminatedBy).toBe('cancelled');
  });

  it('reports the warm-up period it discarded', () => {
    const run = runQueueStation(
      { arrival: { kind: 'exponential', rate: 0.5 }, service: { kind: 'exponential', rate: 1 }, servers: 1 },
      { seed: 'warmup-report', until: 10_000, warmupTime: 1_000 },
    );
    expect(run.report.warmup).not.toBeNull();
    expect(run.report.warmup!.discardedUntil).toBe(1_000);
    expect(run.report.warmup!.method).toMatch(/discarded/i);
    expect(run.report.states[0].start).toBe(1_000);
    expect(run.report.exactness).toBe('empirical');
  });

  it('names statistics with no observations instead of reporting zero for them', () => {
    const sim = new Simulation({ seed: 'empty-stats' });
    sim.resource('idle-desk', { capacity: 1 });
    sim.activate(function* waiter() {
      yield hold(5);
    }, 'waiter');
    const report = runDes(sim, { until: 10 });
    expect(report.emptyStatistics).toContain('idle-desk.waitingTime');
    expect(report.resources[0].waitingTime).toBeNull();
    expect(report.resources[0].served).toBe(0);
  });

  it('refuses a run shorter than its own start time', () => {
    const sim = new Simulation({ seed: 'short', startTime: 100 });
    expect(() => runDes(sim, { until: 50 })).toThrow(EngineError);
  });
});

// ---------------------------------------------------------------------------
// Model library
// ---------------------------------------------------------------------------

describe('model library', () => {
  it('exposes six models, each of which validates and runs', () => {
    expect(DES_MODELS.length).toBe(6);
    for (const model of DES_MODELS) {
      expect(model.validate(model.defaults)).toEqual([]);
      const suggestion = model.suggestedRun(model.defaults);
      const sim = model.build(model.defaults, `library-${model.id}`);
      const report = runDes(sim, {
        // A short run: this checks that the models work, not that they are
        // precise. Precision is the business of the analysis tests above.
        until: Math.min(suggestion.until, suggestion.warmupTime + 2_000),
        warmupTime: suggestion.warmupTime,
      });
      const metrics = model.summarise(report);
      expect(metrics.length).toBeGreaterThan(0);
      for (const metric of metrics) {
        expect(Number.isFinite(metric.value), `${model.id}/${metric.key} is ${metric.value}`).toBe(true);
      }
      expect(report.exactness).toBe('empirical');
    }
  }, 160_000);

  it('matches the exact M/M/c result for the service desk model', () => {
    const config = { arrivalRate: 9, serviceRate: 5, servers: 2 };
    const theory = getDesModel('mmc-service-desk').theoretical!(config);
    const analysis = analyseMmc(config);
    expect(theory.find((t) => t.key === 'L')!.value).toBeCloseTo(analysis.metrics.L, 12);
    const run = runQueueStation(
      {
        arrival: { kind: 'exponential', rate: config.arrivalRate },
        service: { kind: 'exponential', rate: config.serviceRate },
        servers: config.servers,
      },
      { seed: 'service-desk', until: 20_000, warmupTime: 500 },
    );
    const bm = batchMeans(run.waitingSeries, { batchCount: 20 });
    expect(bm.meanInterval.low).toBeLessThanOrEqual(analysis.metrics.Wq);
    expect(bm.meanInterval.high).toBeGreaterThanOrEqual(analysis.metrics.Wq);
  }, 120_000);

  it('matches the exact machine-repair result with no spares', () => {
    const config = { machines: 8, spares: 0, meanTimeToFailure: 50, meanRepairTime: 5, repairCrews: 2 };
    const model = getDesModel('repair-shop');
    const theory = model.theoretical!(config);
    const expected = theory.find((t) => t.key === 'machinesRunning')!.value;
    const values: number[] = [];
    for (let r = 0; r < 12; r++) {
      const sim = model.build(config, `repair-${r}`);
      const report = runDes(sim, { until: 40_000, warmupTime: 1_000 });
      values.push(report.states.find((s) => s.name === 'machinesRunning')!.timeWeightedMean);
    }
    const analysis = replicationAnalysis(values);
    expect(analysis.meanInterval.low).toBeLessThanOrEqual(expected);
    expect(analysis.meanInterval.high).toBeGreaterThanOrEqual(expected);
  }, 160_000);

  it('refuses an unknown model id', () => {
    expect(() => getDesModel('no-such-model')).toThrow(/Unknown discrete-event model/);
  });

  it('collects validation issues without throwing', () => {
    const issues = getDesModel('mmc-service-desk').validate({ arrivalRate: -1, serviceRate: 0, servers: 0 });
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) expect(issue.message.length).toBeGreaterThan(10);
  });

  it('reports the exactness label on every result', () => {
    const run = runQueueStation(
      { arrival: { kind: 'exponential', rate: 0.5 }, service: { kind: 'exponential', rate: 1 }, servers: 1 },
      { seed: 'exactness', until: 2_000 },
    );
    expect(run.report.exactness).toBe('empirical');
    for (const state of run.report.states) expect(state.exactness).toBe('empirical');
    for (const tally of run.report.tallies) expect(tally.exactness).toBe('empirical');
  });
});

// ---------------------------------------------------------------------------
// Stores, batching and shift schedules
// ---------------------------------------------------------------------------

describe('stores and batching', () => {
  it('blocks a putter when the store is full and releases it when space appears', () => {
    const sim = new Simulation({ seed: 'store' });
    const buffer = sim.store<number>('buffer', { capacity: 1 });
    const log: string[] = [];
    sim.activate(function* producer() {
      for (let i = 0; i < 3; i++) {
        yield put(buffer, i);
        log.push(`stored ${i} at ${sim.now}`);
      }
    }, 'producer');
    sim.activate(function* consumer() {
      for (let i = 0; i < 3; i++) {
        yield hold(5);
        const taken = yield get(buffer);
        log.push(`took ${taken.item} at ${sim.now}`);
      }
    }, 'consumer');
    runDes(sim, { until: 100 });
    // Item 0 is stored at once; item 1 waits in the putter's hands until the
    // consumer frees the single place at time 5.
    expect(log[0]).toBe('stored 0 at 0');
    expect(log).toContain('took 0 at 5');
    expect(log).toContain('took 2 at 15');
    expect(buffer.count).toBe(0);
  });

  it('refuses a negative store capacity', () => {
    const sim = new Simulation({ seed: 'store-bad' });
    expect(() => sim.store('bad', { capacity: -2 })).toThrow(/capacity/i);
  });
});
