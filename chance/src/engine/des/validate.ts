/**
 * Validation against analytic queueing theory.
 *
 * A simulation engine that cannot reproduce a known answer is not trustworthy,
 * and the only way to know is to check. M/M/1, M/M/c, M/D/1 and M/G/1 all have
 * exact steady-state results, computed independently in `src/engine/queueing`
 * from the Pollaczek–Khinchine formula and the Erlang C formula. This module
 * runs the simulation and reports, for each metric, whether the simulation's
 * OWN confidence interval contains the exact value.
 *
 * That is the right test, and a loose tolerance is not. A tolerance says "the
 * answer was close enough for my taste"; interval coverage says "the
 * simulation's stated uncertainty is honest". A run whose interval misses the
 * exact value has either a bug or an understated variance, and both matter.
 */
import { EngineError } from '../core/result';
import type { Interval } from '../stats/descriptive';
import { analyseMg1, analyseMm1, analyseMmc } from '../queueing/models';
import type { QueueAnalysis } from '../queueing/types';
import { batchMeans, type BatchMeansReport } from './analysis';
import { runQueueStation, type DelaySpec, type QueueStationConfig } from './library';
import type { Seed } from '../random/rng';

export type ValidationFamily = 'mm1' | 'mmc' | 'md1' | 'mg1';

export interface ValidationRequest {
  family: ValidationFamily;
  arrivalRate: number;
  serviceRate: number;
  /** Servers; only M/M/c uses more than 1. */
  servers?: number;
  /** Squared coefficient of variation of the service time; M/G/1 only. */
  serviceScv?: number;
  seed: Seed;
  /** Simulated time to run for, including the warm-up. */
  until: number;
  /** Simulated time to discard before collecting statistics. */
  warmupTime: number;
  /** Batches used for the confidence intervals. */
  batchCount?: number;
  level?: number;
}

export interface TheoryCheck {
  metric: 'L' | 'Lq' | 'W' | 'Wq' | 'utilisation';
  label: string;
  analytic: number;
  simulated: number;
  /** Monte Carlo standard error of the simulated value. */
  standardError: number;
  /** The simulation's own interval for the long-run mean. */
  interval: Interval;
  /** True when the interval contains the exact value. */
  covers: boolean;
  relativeError: number;
  /** Error in units of the simulation's own standard error. */
  errorInStandardErrors: number;
  method: string;
  batchIndependencePassed: boolean;
}

export interface LittlesLawCheckEmpirical {
  arrivalRate: number;
  L: number;
  lambdaW: number;
  residual: number;
  relativeResidual: number;
  Lq: number;
  lambdaWq: number;
  queueResidual: number;
  tolerance: number;
  holds: boolean;
  note: string;
}

export interface ValidationReport {
  family: ValidationFamily;
  kendall: string;
  utilisation: number;
  runLength: number;
  warmupDiscarded: number;
  customersObserved: number;
  checks: TheoryCheck[];
  allIntervalsCover: boolean;
  littlesLaw: LittlesLawCheckEmpirical;
  warnings: string[];
  message: string;
  exactness: 'empirical';
}

/** Service-time specification with a given mean and squared coefficient of variation. */
export function serviceSpecFor(family: ValidationFamily, serviceRate: number, serviceScv: number | undefined): DelaySpec {
  switch (family) {
    case 'mm1':
    case 'mmc':
      return { kind: 'exponential', rate: serviceRate };
    case 'md1':
      return { kind: 'constant', value: 1 / serviceRate };
    case 'mg1': {
      if (serviceScv === undefined || !(serviceScv > 0)) {
        throw new EngineError(
          `An M/G/1 validation needs a positive squared coefficient of variation for the service time (got ${String(serviceScv)}). For a deterministic service use the M/D/1 family instead.`,
          'required',
        );
      }
      // Gamma with shape 1/scv and scale mean·scv has exactly this mean and scv.
      return { kind: 'distribution', id: 'gamma', params: { k: 1 / serviceScv, theta: serviceScv / serviceRate } };
    }
  }
}

function analytic(request: ValidationRequest): QueueAnalysis {
  switch (request.family) {
    case 'mm1':
      return analyseMm1({ arrivalRate: request.arrivalRate, serviceRate: request.serviceRate });
    case 'mmc':
      return analyseMmc({
        arrivalRate: request.arrivalRate,
        serviceRate: request.serviceRate,
        servers: request.servers ?? 1,
      });
    case 'md1':
      return analyseMg1({ arrivalRate: request.arrivalRate, serviceRate: request.serviceRate, serviceScv: 0 });
    case 'mg1':
      return analyseMg1({
        arrivalRate: request.arrivalRate,
        serviceRate: request.serviceRate,
        serviceScv: request.serviceScv as number,
      });
  }
}

/**
 * Run the simulation and compare every metric with the exact result.
 *
 * Intervals come from batch means: per-customer waiting times for W and Wq,
 * and per-time-batch time-weighted means for L and Lq. Using the naive tally
 * standard error here would be wrong — successive waits in a queue are
 * strongly correlated, so that interval is far too narrow and would "pass"
 * even when the simulation was biased.
 */
export function validateQueueAgainstTheory(request: ValidationRequest): ValidationReport {
  const level = request.level ?? 0.95;
  const batchCount = request.batchCount ?? 30;
  const servers = request.family === 'mmc' ? (request.servers ?? 1) : 1;
  if (request.family !== 'mmc' && request.servers !== undefined && request.servers !== 1) {
    throw new EngineError(
      `The ${request.family.toUpperCase()} family has exactly one server, but ${request.servers} were requested. Use the "mmc" family for a multi-server queue.`,
      'configuration',
    );
  }
  const reference = analytic(request);
  const service = serviceSpecFor(request.family, request.serviceRate, request.serviceScv);
  // One time batch per ~200 arrivals keeps the batch count near `batchCount`
  // while leaving each batch long enough to decorrelate.
  const measuredLength = request.until - request.warmupTime;
  const batchDuration = measuredLength / (batchCount * 4);
  const config: QueueStationConfig = {
    arrival: { kind: 'exponential', rate: request.arrivalRate },
    service,
    servers,
    batchDuration,
  };
  const run = runQueueStation(config, { seed: request.seed, until: request.until, warmupTime: request.warmupTime });

  const batches = run.numberInSystemBatches;
  if (!batches || batches.length < batchCount) {
    throw new EngineError(
      `The run produced ${batches ? batches.length : 0} time batches for the state variables but ${batchCount} are needed for an interval. Run for longer, or ask for fewer batches.`,
      'insufficient-data',
    );
  }
  const queueBatches = run.report.resources[0].queueLength.batchMeans;
  if (!queueBatches) {
    throw new EngineError('The run did not record time batches for the queue length, so no interval can be formed for Lq.', 'insufficient-data');
  }

  const bmL = batchMeans(batches, { batchCount, level });
  const bmLq = batchMeans(queueBatches, { batchCount, level });
  const bmW = batchMeans(run.systemSeries, { batchCount, level });
  const bmWq = batchMeans(run.waitingSeries, { batchCount, level });

  const check = (
    metric: TheoryCheck['metric'],
    label: string,
    analyticValue: number,
    bm: BatchMeansReport,
    method: string,
  ): TheoryCheck => ({
    metric,
    label,
    analytic: analyticValue,
    simulated: bm.mean,
    standardError: bm.standardError,
    interval: bm.meanInterval,
    covers: analyticValue >= bm.meanInterval.low && analyticValue <= bm.meanInterval.high,
    relativeError: analyticValue !== 0 ? (bm.mean - analyticValue) / analyticValue : Number.NaN,
    errorInStandardErrors: bm.standardError > 0 ? (bm.mean - analyticValue) / bm.standardError : Number.NaN,
    method,
    batchIndependencePassed: bm.independence.passed,
  });

  const checks: TheoryCheck[] = [
    check('L', 'Mean number in system L', reference.metrics.L, bmL, 'Time-weighted mean of the number in system, batched over equal time windows'),
    check('Lq', 'Mean number waiting Lq', reference.metrics.Lq, bmLq, 'Time-weighted mean queue length, batched over equal time windows'),
    check('W', 'Mean time in system W', reference.metrics.W, bmW, 'Tally over completed customers, batched in observation order'),
    check('Wq', 'Mean waiting time Wq', reference.metrics.Wq, bmWq, 'Tally over customers who entered service, batched in observation order'),
  ];

  const lambdaEff = run.effectiveArrivalRate;
  const lambdaW = lambdaEff * run.W;
  const lambdaWq = lambdaEff * run.Wq;
  const tolerance = 0.01 * Math.max(1, run.L);
  const littlesLaw: LittlesLawCheckEmpirical = {
    arrivalRate: lambdaEff,
    L: run.L,
    lambdaW,
    residual: Math.abs(run.L - lambdaW),
    relativeResidual: run.L !== 0 ? Math.abs(run.L - lambdaW) / run.L : Number.NaN,
    Lq: run.Lq,
    lambdaWq,
    queueResidual: Math.abs(run.Lq - lambdaWq),
    tolerance,
    holds: Math.abs(run.L - lambdaW) <= tolerance && Math.abs(run.Lq - lambdaWq) <= tolerance,
    note: 'Little\'s law is an identity along the sample path, so it must hold in the collected statistics themselves, not merely on average. The only slack is from customers in the system at the window boundaries, which shrinks as the run lengthens. A residual larger than that is a statistics-collection bug, not sampling error.',
  };

  const allIntervalsCover = checks.every((c) => c.covers);
  const warnings: string[] = [];
  for (const c of checks) {
    if (!c.batchIndependencePassed) {
      warnings.push(
        `The batch means for ${c.metric} are still positively correlated, so its interval is narrower than it should be. Increase the run length (which increases the batch size) before relying on the stated precision.`,
      );
    }
  }
  if (!littlesLaw.holds) {
    warnings.push(
      `Little's law does not hold in this run's own statistics (L = ${littlesLaw.L.toPrecision(6)} against λW = ${littlesLaw.lambdaW.toPrecision(6)}). That is an internal inconsistency in the collected statistics and must be fixed before any output is used.`,
    );
  }

  const missed = checks.filter((c) => !c.covers);
  return {
    family: request.family,
    kendall: reference.kendall,
    utilisation: run.utilisation,
    runLength: request.until,
    warmupDiscarded: request.warmupTime,
    customersObserved: run.waitingSeries.length,
    checks,
    allIntervalsCover,
    littlesLaw,
    warnings,
    message: allIntervalsCover
      ? `All four ${reference.kendall} metrics agree with the exact result: each of the simulation's own ${(level * 100).toFixed(0)}% intervals contains the analytic value, with errors of ${checks.map((c) => `${c.metric} ${(100 * c.relativeError).toFixed(2)}%`).join(', ')} over ${run.waitingSeries.length.toLocaleString('en-US')} customers after discarding the first ${request.warmupTime} time units.`
      : `The simulation does NOT agree with the exact ${reference.kendall} result for ${missed.map((c) => c.metric).join(', ')}: the analytic value lies outside the simulation's own interval (${missed.map((c) => `${c.metric}: exact ${c.analytic.toPrecision(5)}, interval [${c.interval.low.toPrecision(5)}, ${c.interval.high.toPrecision(5)}], ${c.errorInStandardErrors.toFixed(1)} standard errors out`).join('; ')}). One interval in twenty is expected to miss by chance at the 95% level, but a large miss means a bug or an understated variance.`,
    exactness: 'empirical',
  };
}
