/**
 * Statistics collection for discrete-event simulation.
 *
 * Two kinds of quantity, collected two different ways. Conflating them is the
 * single most common defect in simulation software:
 *
 *  - A **state variable** persists over time: the number in a queue, the
 *    number of busy servers, the inventory on hand. Its average is the
 *    TIME-WEIGHTED average (1/T)∫x(t)dt. The arithmetic mean of the recorded
 *    values is not an estimate of anything, because the values do not last
 *    equally long. `TimeWeighted` integrates; it also records the naive
 *    per-observation mean, but only so the interface can show how far wrong it
 *    is.
 *
 *  - A **per-entity value** is observed once per entity: a waiting time, a
 *    time in system. Its average is an ordinary (tally) mean. `Tally` collects
 *    those.
 *
 * Both reports separate a confidence interval for the long-run MEAN from
 * percentiles of the OBSERVED DISTRIBUTION. They answer different questions and
 * are labelled separately. Both also state plainly that their nominal standard
 * error assumes independent observations, which successive waiting times in a
 * queue are not: for a trustworthy interval use the batch-means or replication
 * analysis in `analysis.ts`.
 */
import { EngineError } from '../core/result';
import {
  histogram,
  quantileSorted,
  sortedCopy,
  tConfidenceInterval,
  type HistogramBin,
  type Interval,
} from '../stats/descriptive';

export const DEFAULT_PERCENTILES = [0.05, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99];

export interface TimeInState {
  value: number;
  duration: number;
  fraction: number;
}

export interface TimeWeightedReport {
  name: string;
  kind: 'time-weighted';
  /** (1/T)∫x(t)dt — the average of a quantity that persists over time. */
  timeWeightedMean: number;
  /** ∫x(t)dt over the observed window. */
  area: number;
  /** Length of the observed window T. */
  duration: number;
  start: number;
  end: number;
  min: number;
  max: number;
  /** Value of the state variable at the end of the window. */
  final: number;
  /** Number of recorded changes of value. */
  changes: number;
  /**
   * Arithmetic mean of the recorded values, ignoring how long each one lasted.
   * This is the WRONG average for a persistent state variable and is reported
   * only so an interface can show the discrepancy. Never present it as the
   * answer.
   */
  naiveObservationMean: number;
  /** Fraction of time spent at each distinct value, when few enough. */
  timeInState: TimeInState[] | null;
  /** Per-batch time-weighted means, when time batching was enabled. */
  batchMeans: number[] | null;
  batchDuration: number | null;
  exactness: 'empirical';
}

/**
 * Time-integral accumulator for a state variable.
 *
 * Call `set` or `add` whenever the value changes, and `update` to carry the
 * current value forward to a later time. The integral is maintained exactly;
 * nothing is approximated.
 */
export class TimeWeighted {
  readonly name: string;
  private startTime: number;
  private lastTime: number;
  private current: number;
  private area = 0;
  private minValue: number;
  private maxValue: number;
  private changeCount = 0;
  private observationSum: number;
  private observationCount = 1;
  private readonly stateDurations = new Map<number, number>();
  private stateTrackingEnabled = true;
  private readonly maxDistinctStates: number;
  private batchDuration: number | null = null;
  private batchArea = 0;
  private batchStart: number;
  private readonly batches: number[] = [];

  constructor(
    name: string,
    options: { startTime?: number; initial?: number; maxDistinctStates?: number } = {},
  ) {
    const start = options.startTime ?? 0;
    const initial = options.initial ?? 0;
    if (!Number.isFinite(start)) throw new EngineError(`Statistic "${name}" was given a non-finite start time.`, 'finite');
    if (!Number.isFinite(initial)) throw new EngineError(`Statistic "${name}" was given a non-finite initial value.`, 'finite');
    this.name = name;
    this.startTime = start;
    this.lastTime = start;
    this.batchStart = start;
    this.current = initial;
    this.minValue = initial;
    this.maxValue = initial;
    this.observationSum = initial;
    this.maxDistinctStates = options.maxDistinctStates ?? 4096;
  }

  /** Record per-batch time-weighted means over windows of `duration`. */
  enableTimeBatches(duration: number): void {
    if (!(duration > 0) || !Number.isFinite(duration)) {
      throw new EngineError(`Statistic "${this.name}": the batch duration must be a finite positive number of time units.`, 'range');
    }
    if (this.lastTime !== this.startTime) {
      throw new EngineError(`Statistic "${this.name}": time batching must be enabled before the first observation.`, 'order');
    }
    this.batchDuration = duration;
  }

  get value(): number {
    return this.current;
  }

  get time(): number {
    return this.lastTime;
  }

  /** Carry the current value forward to `time` without changing it. */
  update(time: number): void {
    this.accumulateTo(time);
  }

  set(time: number, value: number): void {
    if (!Number.isFinite(value)) {
      throw new EngineError(`Statistic "${this.name}" was given a non-finite value (${value}) at time ${time}.`, 'finite');
    }
    this.accumulateTo(time);
    this.current = value;
    this.changeCount++;
    this.observationSum += value;
    this.observationCount++;
    if (value < this.minValue) this.minValue = value;
    if (value > this.maxValue) this.maxValue = value;
  }

  add(time: number, delta: number): void {
    this.set(time, this.current + delta);
  }

  /**
   * Discard everything accumulated so far and restart the window at `time`,
   * keeping the current value. This is how a warm-up period is removed from a
   * time-weighted statistic.
   */
  resetAt(time: number): void {
    this.accumulateTo(time);
    this.area = 0;
    this.changeCount = 0;
    this.observationSum = this.current;
    this.observationCount = 1;
    this.minValue = this.current;
    this.maxValue = this.current;
    this.stateDurations.clear();
    this.batches.length = 0;
    this.batchArea = 0;
    this.batchStart = time;
    this.startTime = time;
  }

  private accumulateTo(time: number): void {
    if (!Number.isFinite(time)) {
      throw new EngineError(`Statistic "${this.name}" was updated at a non-finite time (${time}).`, 'finite');
    }
    if (time < this.lastTime) {
      throw new EngineError(
        `Statistic "${this.name}" was updated at simulated time ${time}, which is before its last update at ${this.lastTime}. A time-weighted statistic cannot integrate backwards.`,
        'causality',
      );
    }
    const span = time - this.lastTime;
    if (span === 0) {
      this.lastTime = time;
      return;
    }
    this.area += this.current * span;
    if (this.stateTrackingEnabled) {
      const prior = this.stateDurations.get(this.current);
      if (prior === undefined) {
        if (this.stateDurations.size >= this.maxDistinctStates) {
          this.stateTrackingEnabled = false;
          this.stateDurations.clear();
        } else {
          this.stateDurations.set(this.current, span);
        }
      } else {
        this.stateDurations.set(this.current, prior + span);
      }
    }
    if (this.batchDuration !== null) {
      // Split the interval across batch boundaries so each batch mean is a
      // genuine time-weighted mean over its own window.
      let cursor = this.lastTime;
      let boundary = this.batchStart + this.batchDuration;
      while (boundary <= time) {
        this.batchArea += this.current * (boundary - cursor);
        this.batches.push(this.batchArea / this.batchDuration);
        this.batchArea = 0;
        cursor = boundary;
        this.batchStart = boundary;
        boundary = this.batchStart + this.batchDuration;
      }
      this.batchArea += this.current * (time - cursor);
    }
    this.lastTime = time;
  }

  report(endTime?: number): TimeWeightedReport {
    if (endTime !== undefined) this.accumulateTo(endTime);
    const end = this.lastTime;
    const duration = end - this.startTime;
    if (!(duration > 0)) {
      throw new EngineError(
        `Time-weighted statistic "${this.name}" was requested over a window of zero length (from ${this.startTime} to ${end}). A time-weighted average is undefined when no simulated time has elapsed; run the model for longer, or check that the warm-up period is shorter than the run.`,
        'no-observations',
      );
    }
    const timeInState =
      this.stateTrackingEnabled && this.stateDurations.size > 0
        ? [...this.stateDurations.entries()]
            .map(([value, d]) => ({ value, duration: d, fraction: d / duration }))
            .sort((a, b) => a.value - b.value)
        : null;
    return {
      name: this.name,
      kind: 'time-weighted',
      timeWeightedMean: this.area / duration,
      area: this.area,
      duration,
      start: this.startTime,
      end,
      min: this.minValue,
      max: this.maxValue,
      final: this.current,
      changes: this.changeCount,
      naiveObservationMean: this.observationSum / this.observationCount,
      timeInState,
      batchMeans: this.batchDuration === null ? null : [...this.batches],
      batchDuration: this.batchDuration,
      exactness: 'empirical',
    };
  }
}

export interface TallyReport {
  name: string;
  kind: 'tally';
  n: number;
  mean: number;
  variance: number;
  sd: number;
  /** Monte Carlo standard error of the mean, assuming independent values. */
  standardError: number;
  min: number;
  max: number;
  sum: number;
  /**
   * Confidence interval for the long-run MEAN. A statement about where the
   * expected value lies, not about where individual values lie.
   */
  meanInterval: Interval;
  /**
   * Percentiles of the OBSERVED DISTRIBUTION. A statement about the spread of
   * individual values, not about the precision of the mean. These two are
   * different claims and are never merged.
   */
  percentiles: { p: number; value: number }[] | null;
  histogram: HistogramBin[];
  /** True when every observation was retained, so percentiles are exact. */
  percentilesFromAllObservations: boolean;
  exactness: 'empirical';
  /** States what the nominal standard error does and does not account for. */
  note: string;
}

/** Tally (per-observation) accumulator for values observed once per entity. */
export class Tally {
  readonly name: string;
  private count = 0;
  private runningMean = 0;
  private m2 = 0;
  private total = 0;
  private minValue = Number.POSITIVE_INFINITY;
  private maxValue = Number.NEGATIVE_INFINITY;
  private readonly kept: number[] | null;
  private readonly keepLimit: number;
  private overflowed = false;

  constructor(name: string, options: { keepValues?: boolean; keepLimit?: number } = {}) {
    this.name = name;
    this.keepLimit = options.keepLimit ?? 2_000_000;
    this.kept = options.keepValues === false ? null : [];
  }

  push(x: number): void {
    if (!Number.isFinite(x)) {
      throw new EngineError(
        `Statistic "${this.name}" was given a non-finite observation (${x}). A tally never silently absorbs NaN or infinity, because the resulting mean would be meaningless.`,
        'finite',
      );
    }
    this.count++;
    const d = x - this.runningMean;
    this.runningMean += d / this.count;
    this.m2 += d * (x - this.runningMean);
    this.total += x;
    if (x < this.minValue) this.minValue = x;
    if (x > this.maxValue) this.maxValue = x;
    if (this.kept !== null) {
      if (this.kept.length < this.keepLimit) this.kept.push(x);
      else this.overflowed = true;
    }
  }

  get n(): number {
    return this.count;
  }

  /** Discard every observation so far (used to remove a warm-up period). */
  reset(): void {
    this.count = 0;
    this.runningMean = 0;
    this.m2 = 0;
    this.total = 0;
    this.minValue = Number.POSITIVE_INFINITY;
    this.maxValue = Number.NEGATIVE_INFINITY;
    this.overflowed = false;
    if (this.kept !== null) this.kept.length = 0;
  }

  get mean(): number {
    if (this.count === 0) {
      throw new EngineError(
        `The mean of "${this.name}" was requested but no observations were recorded. There is no mean of nothing; 0 is not the answer.`,
        'no-observations',
      );
    }
    return this.runningMean;
  }

  /** Recorded values in observation order, for batch-means analysis. */
  values(): readonly number[] {
    if (this.kept === null) {
      throw new EngineError(`Statistic "${this.name}" was configured not to retain values, so the observation series is unavailable.`, 'unavailable');
    }
    return this.kept;
  }

  report(options: { level?: number; percentiles?: number[] } = {}): TallyReport {
    if (this.count === 0) {
      throw new EngineError(
        `Statistics for "${this.name}" were requested but no observations were recorded. A mean, a standard error and a percentile all require at least one observation; none of them is 0 by default. Check that entities actually reached this point in the model, and that the warm-up period did not discard every observation.`,
        'no-observations',
      );
    }
    const level = options.level ?? 0.95;
    const variance = this.count > 1 ? this.m2 / (this.count - 1) : Number.NaN;
    const sd = Math.sqrt(variance);
    const standardError = this.count > 1 ? sd / Math.sqrt(this.count) : Number.NaN;
    const ps = options.percentiles ?? DEFAULT_PERCENTILES;
    let percentiles: { p: number; value: number }[] | null = null;
    let bins: HistogramBin[] = [];
    if (this.kept !== null && this.kept.length > 0) {
      const sorted = sortedCopy(this.kept);
      percentiles = ps.map((p) => ({ p, value: quantileSorted(sorted, p) }));
      bins = histogram(sorted);
    }
    return {
      name: this.name,
      kind: 'tally',
      n: this.count,
      mean: this.runningMean,
      variance,
      sd,
      standardError,
      min: this.minValue,
      max: this.maxValue,
      sum: this.total,
      meanInterval:
        this.count > 1
          ? tConfidenceInterval(this.runningMean, sd, this.count, level)
          : { low: Number.NaN, high: Number.NaN, level, method: 'Undefined for a single observation' },
      percentiles,
      histogram: bins,
      percentilesFromAllObservations: this.kept !== null && !this.overflowed,
      exactness: 'empirical',
      note:
        'The standard error and interval above assume the observations are independent. Successive values from one simulation run usually are not: a long wait is followed by another long wait. Treat this interval as a lower bound on the real uncertainty and use the batch-means or replication analysis for an interval that accounts for autocorrelation.',
    };
  }
}

/** A counter of discrete occurrences (balks, renege events, stockouts). */
export class Counter {
  readonly name: string;
  private count = 0;

  constructor(name: string) {
    this.name = name;
  }

  increment(by = 1): void {
    this.count += by;
  }

  get value(): number {
    return this.count;
  }

  reset(): void {
    this.count = 0;
  }
}
