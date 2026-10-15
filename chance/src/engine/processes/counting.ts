/**
 * Counting processes: Poisson (homogeneous and not), compound Poisson and
 * general renewal processes.
 *
 * Exactness conventions used here:
 *  - the law of N(t), interarrival laws, the waiting-time law and the compound
 *    aggregate moments are closed forms → 'exact' (the regularised incomplete
 *    gamma used to evaluate the Gamma CDF is itself a documented numerical
 *    series, so CDF values are labelled 'numerical');
 *  - the expected count of a non-homogeneous process is a numerical integral
 *    of the supplied intensity → 'numerical';
 *  - anything from simulated paths → 'empirical'.
 */
import { EngineError, Validator } from '../core/result';
import { logFactorial, incompleteGamma } from '../special/gamma';
import { stableSum } from '../core/numeric';
import type { Random } from '../random/rng';
import { getDistribution } from '../distributions/registry';
import type { Params } from '../distributions/types';
import { ensembleSteps } from './ensemble';
import { quantity, type ProcessDefinition, type Quantity, type RunHooks } from './types';

/* ------------------------------------------------------------------ *
 * Homogeneous Poisson process
 * ------------------------------------------------------------------ */

export const poissonProcessDefinition: ProcessDefinition = {
  id: 'poisson-process',
  name: 'Homogeneous Poisson process',
  category: 'counting',
  description:
    'Counts events that arrive completely at random at a constant average rate: the number in any window depends only on the length of the window, and disjoint windows are independent.',
  formula: 'N(t) ~ Poisson(λt);  interarrival times T_i ~ Exponential(λ) i.i.d.',
  stateSpaceText: 'N(t) ∈ {0, 1, 2, …} for t ≥ 0, non-decreasing with jumps of size 1',
  params: [
    {
      key: 'rate',
      label: 'Event rate',
      symbol: 'λ',
      description: 'Expected number of events per unit time.',
      defaultValue: 1,
      min: 0,
      minExclusive: true,
    },
  ],
  assumptions: [
    'The rate is constant in time (no trend, no seasonality, no time of day effect).',
    'Events in disjoint time intervals are independent.',
    'Events arrive one at a time; simultaneous events have probability zero.',
    'The past does not affect the future: the waiting time to the next event is memoryless.',
  ],
  limitations: [
    'Real arrivals are usually clustered or seasonal. If the observed variance of counts exceeds the mean, this process is the wrong model — use a non-homogeneous or a renewal process, or a Cox process.',
    'Because interarrivals are memoryless, the time already waited carries no information. Equipment that wears out or queues that build up violate this.',
    'The process has no upper limit on the count in a window.',
  ],
  exactResults: [
    'P(N(t) = k) = e^{−λt}(λt)^k / k!',
    'E[N(t)] = Var[N(t)] = λt',
    'Interarrival times are Exponential(λ) with mean 1/λ',
    'Waiting time to the n-th event ~ Gamma(shape n, scale 1/λ), mean n/λ, variance n/λ²',
  ],
};

function requireRate(rate: number, field = 'rate'): void {
  const v = new Validator();
  v.positive(rate, field, 'Event rate λ');
  v.throwIfInvalid();
}

function requireTime(t: number, field = 't', label = 'Time t'): void {
  const v = new Validator();
  v.nonNegative(t, field, label);
  v.throwIfInvalid();
}

/** Exact P(N(t) = k). */
export function poissonCountPmf(rate: number, t: number, k: number): Quantity {
  requireRate(rate);
  requireTime(t);
  const v = new Validator();
  v.integer(k, 'k', 'Event count k', 0);
  v.throwIfInvalid();
  const mu = rate * t;
  if (mu === 0) {
    return quantity(`P(N(${t}) = ${k})`, k === 0 ? 1 : 0, 'exact', { formula: 'λt = 0, so N(t) = 0 with probability 1' });
  }
  const value = Math.exp(-mu + k * Math.log(mu) - logFactorial(k));
  return quantity(`P(N(${t}) = ${k})`, value, 'exact', { formula: 'e^{−λt}(λt)^k / k!' });
}

/** Exact P(N(t) ≥ k) by summing the complement (k is small in practice). */
export function poissonCountSf(rate: number, t: number, k: number): Quantity {
  requireRate(rate);
  requireTime(t);
  const v = new Validator();
  v.integer(k, 'k', 'Event count k', 0);
  v.throwIfInvalid();
  if (k === 0) return quantity(`P(N(${t}) ≥ 0)`, 1, 'exact');
  // P(N ≥ k) = P(S_k ≤ t) where S_k ~ Gamma(k, 1/λ): regularised incomplete gamma.
  const value = incompleteGamma(k, rate * t).lower;
  return quantity(`P(N(${t}) ≥ ${k})`, value, 'numerical', {
    formula: 'P(N(t) ≥ k) = P(S_k ≤ t) = P(k, λt), the regularised lower incomplete gamma',
    note: 'Evaluated with a series/continued-fraction expansion accurate to about 1e-15 relative.',
  });
}

export interface PoissonCountSummary {
  mean: Quantity;
  variance: Quantity;
  pmf: { k: number; p: number }[];
  pmfMassShown: number;
  exactness: 'exact';
}

/** Exact mean, variance and the pmf of N(t) up to kMax. */
export function poissonCountSummary(rate: number, t: number, kMax = 40): PoissonCountSummary {
  requireRate(rate);
  requireTime(t);
  const v = new Validator();
  v.integer(kMax, 'kMax', 'Largest count shown', 0);
  v.throwIfInvalid();
  const mu = rate * t;
  const pmf: { k: number; p: number }[] = [];
  for (let k = 0; k <= kMax; k++) pmf.push({ k, p: poissonCountPmf(rate, t, k).value });
  return {
    mean: quantity('E[N(t)]', mu, 'exact', { formula: 'λt' }),
    variance: quantity('Var[N(t)]', mu, 'exact', { formula: 'λt (equal to the mean: this is the Poisson signature)' }),
    pmf,
    pmfMassShown: stableSum(pmf.map((r) => r.p)),
    exactness: 'exact',
  };
}

export interface WaitingTimeLaw {
  n: number;
  distribution: string;
  mean: Quantity;
  variance: Quantity;
  /** P(S_n ≤ t). */
  cdf(t: number): Quantity;
}

/** Exact law of the waiting time to the n-th event: Gamma(n, 1/λ). */
export function poissonWaitingTime(rate: number, n: number): WaitingTimeLaw {
  requireRate(rate);
  const v = new Validator();
  v.integer(n, 'n', 'Event index n', 1);
  v.throwIfInvalid();
  return {
    n,
    distribution: `Gamma(shape ${n}, scale ${1 / rate})`,
    mean: quantity(`E[S_${n}]`, n / rate, 'exact', { formula: 'n/λ' }),
    variance: quantity(`Var[S_${n}]`, n / (rate * rate), 'exact', { formula: 'n/λ²' }),
    cdf: (t: number) => {
      requireTime(t);
      return quantity(`P(S_${n} ≤ ${t})`, incompleteGamma(n, rate * t).lower, 'numerical', {
        formula: 'P(n, λt), the regularised lower incomplete gamma',
      });
    },
  };
}

/** Exact interarrival law: Exponential(λ). */
export function poissonInterarrivalLaw(rate: number): { distribution: string; mean: Quantity; variance: Quantity } {
  requireRate(rate);
  return {
    distribution: `Exponential(rate ${rate})`,
    mean: quantity('E[T]', 1 / rate, 'exact', { formula: '1/λ' }),
    variance: quantity('Var[T]', 1 / (rate * rate), 'exact', { formula: '1/λ²' }),
  };
}

export const MAX_EVENTS_PER_PATH = 5_000_000;

/**
 * Simulate event times on [0, horizon] by accumulating Exponential(λ)
 * interarrivals — the construction, not an approximation of it.
 */
export function samplePoissonEventTimes(rng: Random, rate: number, horizon: number): number[] {
  requireRate(rate);
  requireTime(horizon, 'horizon', 'Horizon');
  const times: number[] = [];
  let t = rng.exponential(rate);
  while (t <= horizon) {
    times.push(t);
    if (times.length > MAX_EVENTS_PER_PATH) {
      throw new EngineError(
        `The simulation produced more than ${MAX_EVENTS_PER_PATH.toLocaleString('en-US')} events on one path (λ=${rate}, horizon=${horizon}). Reduce the rate or the horizon.`,
        'limit',
      );
    }
    t += rng.exponential(rate);
  }
  return times;
}

/** Counting path N(t) evaluated on a time grid, from simulated event times. */
export function samplePoissonCountPath(rng: Random, rate: number, times: number[]): number[] {
  const horizon = times.length ? times[times.length - 1] : 0;
  const events = samplePoissonEventTimes(rng, rate, horizon);
  return countsOnGrid(events, times);
}

/** Step function: number of event times ≤ each grid time. */
export function countsOnGrid(eventTimes: number[], times: number[]): number[] {
  const out = new Array<number>(times.length);
  let idx = 0;
  for (let j = 0; j < times.length; j++) {
    while (idx < eventTimes.length && eventTimes[idx] <= times[j]) idx++;
    out[j] = idx;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Non-homogeneous Poisson process
 * ------------------------------------------------------------------ */

export type Intensity = (t: number) => number;

export const nonHomogeneousPoissonDefinition: ProcessDefinition = {
  id: 'nhpp',
  name: 'Non-homogeneous Poisson process',
  category: 'counting',
  description:
    'A Poisson process whose rate changes with time: busy periods and quiet periods, with independence between disjoint intervals retained.',
  formula: 'N(t) ~ Poisson(Λ(t)) with Λ(t) = ∫₀ᵗ λ(s) ds',
  stateSpaceText: 'N(t) ∈ {0, 1, 2, …}, non-decreasing',
  params: [
    { key: 'horizon', label: 'Horizon', symbol: 'T', description: 'End of the simulated interval.', defaultValue: 10, min: 0, minExclusive: true },
    { key: 'bound', label: 'Intensity bound', symbol: 'λ*', description: 'A value that λ(t) never exceeds on the interval. Required by the thinning algorithm.', defaultValue: 1, min: 0, minExclusive: true },
  ],
  assumptions: [
    'The intensity function λ(t) is known, non-negative and finite on the whole interval.',
    'Events in disjoint intervals remain independent; only the rate varies.',
    'The supplied bound λ* satisfies λ(t) ≤ λ* for every t in the interval. Simulation by thinning is wrong without it.',
  ],
  limitations: [
    'Thinning needs the bound. If the supplied bound is violated anywhere the process generated would be the wrong one, so this module refuses rather than returning paths.',
    'The expected count is a numerical integral: its accuracy depends on the smoothness of λ and the number of nodes. A λ with jumps or spikes needs the interval split at those points.',
    'Variation in the rate is deterministic here. If the rate itself is random, this is a Cox process instead and the counts are over-dispersed relative to Poisson.',
  ],
  exactResults: [
    'N(t) ~ Poisson(Λ(t)) given Λ',
    'E[N(t)] = Var[N(t)] = Λ(t)',
  ],
};

/**
 * Λ(t1) − Λ(t0) = ∫ λ by composite Simpson's rule.
 *
 * Simpson is exact for cubics and has error O(h⁴·max|λ⁗|); `nodes` is forced
 * even so the rule applies. The result is 'numerical', never 'exact'.
 */
export function integrateIntensity(intensity: Intensity, t0: number, t1: number, nodes = 2048): Quantity {
  const v = new Validator();
  v.finite(t0, 't0', 'Interval start');
  v.finite(t1, 't1', 'Interval end');
  v.integer(nodes, 'nodes', 'Integration nodes', 2);
  if (v.valid && !(t1 >= t0)) v.add('The interval end must not be before its start.', 't1', 'order');
  v.throwIfInvalid();
  if (t1 === t0) return quantity('Λ(t1) − Λ(t0)', 0, 'exact', { formula: 'empty interval' });
  const n = nodes % 2 === 0 ? nodes : nodes + 1;
  const h = (t1 - t0) / n;
  const terms: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + i * h;
    const lam = intensity(t);
    if (!Number.isFinite(lam)) {
      throw new EngineError(`The intensity function returned ${lam} at t=${t}. λ(t) must be finite everywhere on the interval.`, 'finite');
    }
    if (lam < 0) {
      throw new EngineError(`The intensity function returned a negative value ${lam} at t=${t}. An intensity cannot be negative.`, 'range');
    }
    const w = i === 0 || i === n ? 1 : i % 2 === 1 ? 4 : 2;
    terms.push(w * lam);
  }
  return quantity('Λ(t1) − Λ(t0)', (h / 3) * stableSum(terms), 'numerical', {
    formula: '∫ λ(s) ds by composite Simpson',
    note: `Composite Simpson with ${n} subintervals; error is O(h⁴). Increase the node count or split the interval at kinks in λ for more accuracy.`,
  });
}

/** Expected count on [0, t] of a non-homogeneous process. */
export function nhppExpectedCount(intensity: Intensity, t: number, nodes = 2048): Quantity {
  requireTime(t);
  const integral = integrateIntensity(intensity, 0, t, nodes);
  return quantity(`E[N(${t})]`, integral.value, 'numerical', {
    formula: 'Λ(t) = ∫₀ᵗ λ(s) ds, by composite Simpson',
    note: integral.note,
  });
}

/**
 * Simulate event times by thinning (Lewis & Shedler 1979): generate a
 * homogeneous process at the bound λ*, keep each candidate with probability
 * λ(t)/λ*.
 *
 * The bound is checked at every candidate point AND on a scan grid before
 * starting. A violated bound makes thinning produce the wrong process, so this
 * raises an `EngineError` rather than returning paths.
 */
export function sampleNhppEventTimes(
  rng: Random,
  intensity: Intensity,
  horizon: number,
  bound: number,
  scanNodes = 512,
): number[] {
  requireTime(horizon, 'horizon', 'Horizon');
  const v = new Validator();
  v.positive(bound, 'bound', 'Intensity bound λ*');
  v.integer(scanNodes, 'scanNodes', 'Bound scan nodes', 0);
  v.throwIfInvalid();
  assertIntensityBound(intensity, 0, horizon, bound, scanNodes);

  const times: number[] = [];
  let t = rng.exponential(bound);
  while (t <= horizon) {
    const lam = intensityAt(intensity, t, bound);
    if (rng.uniform() < lam / bound) {
      times.push(t);
      if (times.length > MAX_EVENTS_PER_PATH) {
        throw new EngineError(
          `The simulation produced more than ${MAX_EVENTS_PER_PATH.toLocaleString('en-US')} events on one path. Reduce the bound or the horizon.`,
          'limit',
        );
      }
    }
    t += rng.exponential(bound);
  }
  return times;
}

function intensityAt(intensity: Intensity, t: number, bound: number): number {
  const lam = intensity(t);
  if (!Number.isFinite(lam) || lam < 0) {
    throw new EngineError(`The intensity function returned ${lam} at t=${t}. λ(t) must be finite and non-negative.`, 'range');
  }
  if (lam > bound) {
    throw new EngineError(
      `The supplied intensity bound λ* = ${bound} is violated: λ(${t}) = ${lam}. Thinning with too small a bound silently generates a different process, so no path was produced. Raise the bound to at least ${lam}.`,
      'bound',
    );
  }
  return lam;
}

/** Scan the interval and refuse up front if the bound is already violated. */
export function assertIntensityBound(
  intensity: Intensity,
  t0: number,
  t1: number,
  bound: number,
  scanNodes = 512,
): void {
  if (scanNodes < 1 || t1 <= t0) return;
  for (let i = 0; i <= scanNodes; i++) {
    intensityAt(intensity, t0 + ((t1 - t0) * i) / scanNodes, bound);
  }
}

export function sampleNhppCountPath(
  rng: Random,
  intensity: Intensity,
  bound: number,
  times: number[],
): number[] {
  const horizon = times.length ? times[times.length - 1] : 0;
  // The scan already ran once per path would be wasteful on every path, but
  // correctness comes first: a violated bound must never produce a path.
  const events = sampleNhppEventTimes(rng, intensity, horizon, bound);
  return countsOnGrid(events, times);
}

/* ------------------------------------------------------------------ *
 * Compound Poisson process
 * ------------------------------------------------------------------ */

export const compoundPoissonDefinition: ProcessDefinition = {
  id: 'compound-poisson',
  name: 'Compound Poisson process',
  category: 'counting',
  description:
    'Aggregates a random amount per event: claims with sizes, outages with durations, orders with values. Events arrive as a Poisson process and each carries an independent draw from a jump-size distribution.',
  formula: 'X(t) = Σ_{i=1}^{N(t)} J_i,  N(t) ~ Poisson(λt),  J_i i.i.d. independent of N',
  stateSpaceText: 'X(t) ∈ ℝ (or ℝ₊ for non-negative jumps), piecewise constant with jumps',
  params: [
    { key: 'rate', label: 'Event rate', symbol: 'λ', description: 'Expected events per unit time.', defaultValue: 1, min: 0, minExclusive: true },
  ],
  assumptions: [
    'Event times follow a homogeneous Poisson process.',
    'Jump sizes are independent of each other and of the event times — the severity does not depend on how many events happened or when.',
    'The jump-size distribution has a finite second moment, otherwise the variance below does not exist.',
  ],
  limitations: [
    'In insurance and operations the independence between frequency and severity is often false (a storm causes many large claims at once). The exact moments below are then wrong, and this module cannot detect it from the parameters.',
    'Heavy-tailed jump sizes make simulated quantiles converge very slowly; the empirical tail of an ensemble will understate the real tail.',
  ],
  exactResults: [
    'E[X(t)] = λt·E[J]',
    'Var[X(t)] = λt·E[J²]  (note: the second MOMENT, not the variance, of J)',
  ],
};

export interface CompoundMoments {
  mean: Quantity;
  variance: Quantity;
  sd: Quantity;
  note: string;
}

/**
 * Exact aggregate moments. Var[X(t)] = λt·E[J²] follows from the law of total
 * variance: λt·Var[J] + Var[N]·E[J]² = λt·Var[J] + λt·E[J]² = λt·E[J²].
 */
export function compoundPoissonMoments(
  rate: number,
  t: number,
  jumpMean: number,
  jumpSecondMoment: number,
): CompoundMoments {
  requireRate(rate);
  requireTime(t);
  const v = new Validator();
  v.finite(jumpMean, 'jumpMean', 'Mean jump size E[J]');
  v.nonNegative(jumpSecondMoment, 'jumpSecondMoment', 'Second moment E[J²]');
  if (v.valid && jumpSecondMoment < jumpMean * jumpMean - 1e-12) {
    v.add(
      `E[J²] = ${jumpSecondMoment} is smaller than E[J]² = ${jumpMean * jumpMean}, which is impossible (it would imply a negative variance). Check the jump-size inputs.`,
      'jumpSecondMoment',
      'inconsistent',
    );
  }
  v.throwIfInvalid();
  const variance = rate * t * jumpSecondMoment;
  return {
    mean: quantity('E[X(t)]', rate * t * jumpMean, 'exact', { formula: 'λt·E[J]' }),
    variance: quantity('Var[X(t)]', variance, 'exact', { formula: 'λt·E[J²]' }),
    sd: quantity('SD[X(t)]', Math.sqrt(variance), 'exact', { formula: '√(λt·E[J²])' }),
    note: 'The variance uses the second moment of the jump size, not its variance. Both the randomness in how many events occur and in how large each is contribute.',
  };
}

export type JumpSampler = (rng: Random) => number;

/** Jump sampler from a distribution in the registry (e.g. 'lognormal'). */
export function jumpSamplerFromDistribution(id: string, params: Params): JumpSampler {
  const def = getDistribution(id);
  return (rng: Random) => def.sample(rng, params);
}

/** Aggregate path X(t) on a time grid. */
export function sampleCompoundPoissonPath(
  rng: Random,
  rate: number,
  jump: JumpSampler,
  times: number[],
): number[] {
  const horizon = times.length ? times[times.length - 1] : 0;
  const events = samplePoissonEventTimes(rng, rate, horizon);
  const sizes = events.map(() => jump(rng));
  const out = new Array<number>(times.length);
  let idx = 0;
  let total = 0;
  for (let j = 0; j < times.length; j++) {
    while (idx < events.length && events[idx] <= times[j]) {
      total += sizes[idx];
      idx++;
    }
    out[j] = total;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Renewal process
 * ------------------------------------------------------------------ */

export const renewalProcessDefinition: ProcessDefinition = {
  id: 'renewal-process',
  name: 'Renewal process',
  category: 'counting',
  description:
    'Events separated by independent waiting times from any non-negative distribution — the Poisson process is the special case where that distribution is exponential. Models replacement of a component that wears out, or arrivals that are more (or less) regular than random.',
  formula: 'S_n = Σ_{i=1}^{n} T_i with T_i i.i.d. ≥ 0;  N(t) = max{n : S_n ≤ t};  m(t) = E[N(t)]',
  stateSpaceText: 'N(t) ∈ {0, 1, 2, …}, non-decreasing',
  params: [],
  assumptions: [
    'Interarrival times are independent and identically distributed.',
    'The interarrival distribution is non-negative with a finite, positive mean μ.',
    'The process starts with a fresh interval at time 0 (an ordinary, not a stationary/delayed, renewal process).',
  ],
  limitations: [
    'The renewal function m(t) has no closed form for a general interarrival law, so it is estimated by simulation here and is empirical.',
    'The elementary renewal theorem m(t)/t → 1/μ is a limit. At small t the ratio is noticeably below it for distributions less variable than the exponential, so do not use 1/μ·t as a short-horizon count.',
    'A delayed or equilibrium renewal process (one already running at time 0) has a different m(t); the first interval here is a full fresh one.',
  ],
  exactResults: [
    'Elementary renewal theorem: m(t)/t → 1/μ as t → ∞',
    'Strong law: N(t)/t → 1/μ almost surely',
  ],
};

export type InterarrivalSampler = (rng: Random) => number;

export function sampleRenewalEventTimes(
  rng: Random,
  interarrival: InterarrivalSampler,
  horizon: number,
): number[] {
  requireTime(horizon, 'horizon', 'Horizon');
  const times: number[] = [];
  let t = 0;
  for (;;) {
    const gap = interarrival(rng);
    if (!Number.isFinite(gap) || gap < 0) {
      throw new EngineError(`The interarrival sampler produced ${gap}. Interarrival times must be finite and non-negative.`, 'range');
    }
    if (gap === 0) {
      throw new EngineError('The interarrival sampler produced 0, which would generate infinitely many events at the same instant.', 'range');
    }
    t += gap;
    if (t > horizon) return times;
    times.push(t);
    if (times.length > MAX_EVENTS_PER_PATH) {
      throw new EngineError(
        `The simulation produced more than ${MAX_EVENTS_PER_PATH.toLocaleString('en-US')} renewals on one path. Reduce the horizon or increase the mean interarrival time.`,
        'limit',
      );
    }
  }
}

export function sampleRenewalCountPath(
  rng: Random,
  interarrival: InterarrivalSampler,
  times: number[],
): number[] {
  const horizon = times.length ? times[times.length - 1] : 0;
  return countsOnGrid(sampleRenewalEventTimes(rng, interarrival, horizon), times);
}

/** 1/μ, the long-run rate from the elementary renewal theorem. */
export function elementaryRenewalRate(meanInterarrival: number): Quantity {
  const v = new Validator();
  v.positive(meanInterarrival, 'meanInterarrival', 'Mean interarrival time μ');
  v.throwIfInvalid();
  return quantity('lim m(t)/t', 1 / meanInterarrival, 'exact', {
    formula: 'elementary renewal theorem: m(t)/t → 1/μ',
    note: 'A limit as t → ∞. It is not the value of m(t)/t at finite t.',
  });
}

export interface RenewalFunctionEstimate {
  times: number[];
  /** Estimated m(t) = E[N(t)] at each grid time. */
  renewalFunction: number[];
  /** m(t)/t, which should approach 1/μ. Null at t = 0, where the ratio is undefined. */
  ratio: (number | null)[];
  limit: Quantity;
  pathsUsed: number;
  partial: boolean;
  exactness: 'empirical';
  warnings: string[];
}

/**
 * Estimate the renewal function m(t) = E[N(t)] by simulation, yielding
 * between chunks of paths so a worker can be cancelled.
 *
 * `meanInterarrival` is used only to report the elementary-renewal limit for
 * comparison; it is not used in the simulation.
 */
export function* renewalFunctionSteps(
  interarrival: InterarrivalSampler,
  meanInterarrival: number,
  times: number[],
  paths: number,
  seed: string,
  hooks: RunHooks = {},
): Generator<number, RenewalFunctionEstimate, void> {
  const limit = elementaryRenewalRate(meanInterarrival);
  const ensemble = yield* ensembleSteps(
    (rng, grid) => sampleRenewalCountPath(rng, interarrival, grid),
    times,
    paths,
    seed,
    hooks,
  );
  const n = ensemble.pathsCompleted;
  const m = ensemble.times.map((_, j) => stableSum(ensemble.paths.map((p) => p[j])) / n);
  const warnings: string[] = [];
  if (ensemble.partial) {
    warnings.push(
      `Partial result: ${n.toLocaleString('en-US')} of ${paths.toLocaleString('en-US')} paths completed before the run stopped. m(t) below is estimated from those paths only.`,
    );
  }
  return {
    times: [...ensemble.times],
    renewalFunction: m,
    ratio: ensemble.times.map((t, j) => (t > 0 ? m[j] / t : null)),
    limit,
    pathsUsed: n,
    partial: ensemble.partial,
    exactness: 'empirical',
    warnings,
  };
}
