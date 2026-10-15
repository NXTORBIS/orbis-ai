/**
 * Model library: real systems, expressed as processes.
 *
 * Every model is a serialisable configuration plus a builder, so the same
 * description runs on the main thread, in a worker and in tests. The first one
 * — the general single-queue station — is also the engine's own yardstick: it
 * covers M/M/1, M/M/c, M/D/1 and M/G/1, all of which queueing theory answers
 * exactly, so the simulation can be checked against the truth rather than
 * against itself.
 */
import { EngineError, type Issue } from '../core/result';
import type { Params } from '../distributions/types';
import { getDistribution, validateParams } from '../distributions/registry';
import type { Seed } from '../random/rng';
import {
  analyseFinitePopulation,
  analyseMg1,
  analyseMmc,
} from '../queueing/models';
import type { QueueDiscipline } from './resources';
import type { DesRunReport } from './run';
import { runDes } from './run';
import {
  get,
  hold,
  put,
  release,
  seize,
  serve,
  Simulation,
  type ProcessBody,
  type ProcessGenerator,
} from './simulation';
import {
  constantDelay,
  distributionDelay,
  exponentialDelay,
  failureProcess,
  shiftSchedule,
  shouldBalk,
  source,
  type DelaySampler,
} from './flow';

// ---------------------------------------------------------------------------
// Delay specifications
// ---------------------------------------------------------------------------

export type DelaySpec =
  | { kind: 'exponential'; rate: number }
  | { kind: 'constant'; value: number }
  | { kind: 'distribution'; id: string; params: Params };

export function delaySampler(spec: DelaySpec): DelaySampler {
  switch (spec.kind) {
    case 'exponential':
      return exponentialDelay(spec.rate);
    case 'constant':
      return constantDelay(spec.value);
    case 'distribution':
      return distributionDelay(spec.id, spec.params);
  }
}

export function delaySpecIssues(spec: DelaySpec | undefined, field: string): Issue[] {
  if (!spec) return [{ code: 'required', field, message: `A ${field} specification is required.` }];
  switch (spec.kind) {
    case 'exponential':
      return spec.rate > 0 && Number.isFinite(spec.rate)
        ? []
        : [{ code: 'range', field, message: `The ${field} rate must be a finite positive number (got ${spec.rate}).` }];
    case 'constant':
      return spec.value >= 0 && Number.isFinite(spec.value)
        ? []
        : [{ code: 'range', field, message: `The ${field} value must be a finite number, 0 or greater (got ${spec.value}).` }];
    case 'distribution': {
      try {
        const def = getDistribution(spec.id);
        return validateParams(def, spec.params).map((i) => ({ ...i, field: `${field}.${i.field ?? 'params'}` }));
      } catch {
        return [{ code: 'unknown', field, message: `Unknown distribution "${spec.id}" for the ${field}.` }];
      }
    }
  }
}

/** Mean of a delay specification, where it is known exactly. */
export function delaySpecMean(spec: DelaySpec): number {
  switch (spec.kind) {
    case 'exponential':
      return 1 / spec.rate;
    case 'constant':
      return spec.value;
    case 'distribution': {
      const def = getDistribution(spec.id);
      const m = def.mean(spec.params);
      if (!m.defined) {
        throw new EngineError(
          `The mean of "${def.name}" is not defined for these parameters (${m.reason}), so the offered load cannot be computed. A queue whose mean service time does not exist has no steady state to report.`,
          'undefined-moment',
        );
      }
      return m.value;
    }
  }
}

// ---------------------------------------------------------------------------
// Report helpers
// ---------------------------------------------------------------------------

/** Time-weighted mean of a named state variable, or a refusal. */
export function stateMean(report: DesRunReport, name: string): number {
  const found = report.states.find((s) => s.name === name) ?? report.resources.flatMap((r) => [r.busyUnits, r.queueLength]).find((s) => s.name === name);
  if (!found) {
    throw new EngineError(
      `The run recorded no time-weighted statistic named "${name}". Available: ${[...report.states.map((s) => s.name), ...report.resources.flatMap((r) => [r.busyUnits.name, r.queueLength.name])].join(', ') || '(none)'}.`,
      'unknown',
    );
  }
  return found.timeWeightedMean;
}

/** Tally mean of a named per-entity statistic, or a refusal. */
export function tallyMean(report: DesRunReport, name: string): number {
  const found = report.tallies.find((t) => t.name === name) ?? report.resources.map((r) => r.waitingTime).find((t) => t !== null && t.name === name);
  if (!found) {
    if (report.emptyStatistics.includes(name)) {
      throw new EngineError(
        `The statistic "${name}" was requested but had no observations in this run. Its mean is not 0; there simply is no mean. Check that entities reached this point and that the warm-up period did not discard every observation.`,
        'no-observations',
      );
    }
    throw new EngineError(`The run recorded no tally statistic named "${name}".`, 'unknown');
  }
  return found.mean;
}

export function counterValue(report: DesRunReport, name: string): number {
  const found = report.counters.find((c) => c.name === name);
  if (!found) throw new EngineError(`The run recorded no counter named "${name}".`, 'unknown');
  return found.value;
}

// ---------------------------------------------------------------------------
// The general single-queue station: M/M/1, M/M/c, M/D/1, M/G/1, G/G/c
// ---------------------------------------------------------------------------

export interface QueueStationConfig {
  arrival: DelaySpec;
  service: DelaySpec;
  servers: number;
  discipline?: QueueDiscipline;
  /**
   * Constant patience before abandoning the queue. Null, or Infinity, means no
   * reneging — and produces exactly the same run as a model without it.
   */
  patience?: number | null;
  /** Balk on arrival when at least this many are already waiting. */
  balkAt?: number | null;
  /** Customers already present at time 0, for studying initialisation bias. */
  initialCustomers?: number;
  /** Length of each time batch for batch means on the state variables. */
  batchDuration?: number;
  /** Stop after this many arrivals (a terminating model). */
  arrivalLimit?: number;
}

export const QUEUE_STATION_STATS = {
  numberInSystem: 'numberInSystem',
  queueLength: 'server.queueLength',
  busyUnits: 'server.busyUnits',
  timeInSystem: 'timeInSystem',
  waitingTime: 'waitingTime',
} as const;

export function queueStationIssues(config: QueueStationConfig): Issue[] {
  const issues: Issue[] = [
    ...delaySpecIssues(config.arrival, 'arrival'),
    ...delaySpecIssues(config.service, 'service'),
  ];
  if (!Number.isInteger(config.servers) || config.servers < 1) {
    issues.push({ code: 'range', field: 'servers', message: `The number of servers must be a whole number of at least 1 (got ${config.servers}).` });
  }
  if (config.patience !== undefined && config.patience !== null && !(config.patience >= 0)) {
    issues.push({ code: 'range', field: 'patience', message: `The patience time must be 0 or greater, or null for customers who never abandon (got ${config.patience}).` });
  }
  if (config.balkAt !== undefined && config.balkAt !== null && (!Number.isInteger(config.balkAt) || config.balkAt < 0)) {
    issues.push({ code: 'range', field: 'balkAt', message: `The balking threshold must be a whole number of waiting customers, 0 or greater (got ${config.balkAt}).` });
  }
  if (config.initialCustomers !== undefined && (!Number.isInteger(config.initialCustomers) || config.initialCustomers < 0)) {
    issues.push({ code: 'range', field: 'initialCustomers', message: `The initial number of customers must be a whole number, 0 or greater (got ${config.initialCustomers}).` });
  }
  return issues;
}

/**
 * Build a single-queue station.
 *
 * The arrival process and the service process draw from separate substreams
 * ("arrivals" and "service"), so changing the service distribution leaves the
 * arrival times untouched — which is what makes two configurations comparable
 * and common random numbers worth using.
 */
export function buildQueueStation(config: QueueStationConfig, seed: Seed): Simulation {
  const issues = queueStationIssues(config);
  if (issues.length) throw new EngineError(issues);
  const discipline = config.discipline ?? 'fifo';
  const interarrival = delaySampler(config.arrival);
  const serviceTime = delaySampler(config.service);
  const patience = config.patience ?? null;
  const balkAt = config.balkAt ?? null;

  const sim = new Simulation({ seed, batchDuration: config.batchDuration });
  const server = sim.resource('server', { capacity: config.servers, discipline });
  const inSystem = sim.state(QUEUE_STATION_STATS.numberInSystem);
  const timeInSystem = sim.tally(QUEUE_STATION_STATS.timeInSystem);
  const waitingTime = sim.tally(QUEUE_STATION_STATS.waitingTime);
  sim.counter('arrivals');
  sim.counter('admitted');
  sim.counter('served');
  sim.counter('balked');
  sim.counter('reneged');

  const customer = (): ProcessBody =>
    function* customerProcess(s: Simulation): ProcessGenerator {
      const arrivedAt = s.now;
      if (balkAt !== null && shouldBalk(server, balkAt)) {
        server.balks.increment();
        s.counter('balked').increment();
        return;
      }
      inSystem.add(s.now, 1);
      s.counter('admitted').increment();
      // A shortest-processing-time queue must know the service time to order
      // itself, so it is drawn before the request rather than after.
      const declared = discipline === 'spt' ? serviceTime(s.stream('service')) : null;
      const got = yield seize(server, { patience, processingTime: declared });
      if (!got.ok || got.request === null) {
        s.counter('reneged').increment();
        inSystem.add(s.now, -1);
        return;
      }
      waitingTime.push(got.waited);
      yield hold(declared ?? serviceTime(s.stream('service')));
      yield release(got.request);
      timeInSystem.push(s.now - arrivedAt);
      inSystem.add(s.now, -1);
      s.counter('served').increment();
    };

  // Customers already present at time 0: the usual way to start a model far
  // from steady state on purpose, so warm-up detection has something to find.
  const initial = config.initialCustomers ?? 0;
  for (let i = 0; i < initial; i++) sim.activate(customer(), `initial customer ${i}`);

  sim.activate(
    source({
      stream: 'arrivals',
      interarrival,
      entity: () => customer(),
      limit: config.arrivalLimit,
      name: 'customer',
    }),
    'arrival source',
  );
  return sim;
}

export interface QueueRunOptions {
  seed: Seed;
  until?: number;
  warmupTime?: number;
  collectTrace?: boolean;
  chunkEvents?: number;
}

export interface QueueStationRun {
  report: DesRunReport;
  /** Mean number in system L (time-weighted). */
  L: number;
  /** Mean number waiting Lq (time-weighted). */
  Lq: number;
  /** Mean time in system W (tally over completed customers). */
  W: number;
  /** Mean waiting time Wq (tally over customers who entered service). */
  Wq: number;
  utilisation: number;
  /** Arrival rate actually admitted during the measured window. */
  effectiveArrivalRate: number;
  /** Per-customer waiting times in observation order, for batch means. */
  waitingSeries: readonly number[];
  /** Per-customer times in system in observation order. */
  systemSeries: readonly number[];
  /** Per-time-batch time-weighted means of the number in system. */
  numberInSystemBatches: readonly number[] | null;
  simulation: Simulation;
}

/** Run a single-queue station and pull out the standard queueing metrics. */
export function runQueueStation(config: QueueStationConfig, options: QueueRunOptions): QueueStationRun {
  const sim = buildQueueStation(config, options.seed);
  const report = runDes(sim, {
    until: options.until,
    warmupTime: options.warmupTime,
    collectTrace: options.collectTrace,
    chunkEvents: options.chunkEvents,
  });
  const windowLength = report.endTime - (report.warmup ? report.warmup.discardedUntil : report.startTime);
  const admitted = counterValue(report, 'admitted');
  const inSystemReport = report.states.find((s) => s.name === QUEUE_STATION_STATS.numberInSystem);
  if (!inSystemReport) throw new EngineError('The run did not record the number in system.', 'unknown');
  const serverReport = report.resources.find((r) => r.name === 'server');
  if (!serverReport) throw new EngineError('The run did not record the server resource.', 'unknown');
  return {
    report,
    L: inSystemReport.timeWeightedMean,
    Lq: serverReport.queueLength.timeWeightedMean,
    W: tallyMean(report, QUEUE_STATION_STATS.timeInSystem),
    Wq: tallyMean(report, QUEUE_STATION_STATS.waitingTime),
    utilisation: serverReport.utilisation,
    effectiveArrivalRate: admitted / windowLength,
    waitingSeries: sim.getTally(QUEUE_STATION_STATS.waitingTime).values(),
    systemSeries: sim.getTally(QUEUE_STATION_STATS.timeInSystem).values(),
    numberInSystemBatches: inSystemReport.batchMeans,
    simulation: sim,
  };
}

// ---------------------------------------------------------------------------
// Model definitions
// ---------------------------------------------------------------------------

export interface DesMetric {
  key: string;
  label: string;
  value: number;
  kind: 'time-weighted' | 'tally' | 'count' | 'rate' | 'proportion';
}

export interface DesTheoretical {
  key: string;
  value: number;
  source: string;
}

export interface DesModelDef<C> {
  id: string;
  name: string;
  description: string;
  defaults: C;
  assumptions: string[];
  limitations: string[];
  validate(config: C): Issue[];
  build(config: C, seed: Seed): Simulation;
  suggestedRun(config: C): { until: number; warmupTime: number; batchDuration: number };
  summarise(report: DesRunReport): DesMetric[];
  /** Exact values from queueing theory, where this model has them. */
  theoretical?(config: C): DesTheoretical[];
}

// --- 1. M/M/c service desk ------------------------------------------------

export interface ServiceDeskConfig {
  arrivalRate: number;
  serviceRate: number;
  servers: number;
}

export const serviceDeskModel: DesModelDef<ServiceDeskConfig> = {
  id: 'mmc-service-desk',
  name: 'Service desk (M/M/c)',
  description:
    'Customers arrive at random, join one queue, and are served by the first free clerk. The textbook multi-server queue, and the one case where the simulation can be checked against an exact answer — which is why it is here.',
  defaults: { arrivalRate: 9, serviceRate: 5, servers: 2 },
  assumptions: [
    'Arrivals are a Poisson process: completely random in time, at a constant average rate.',
    'Service times are exponential and independent of each other and of the queue.',
    'One queue feeds all servers, first come first served, and nobody balks or abandons.',
  ],
  limitations: [
    'Real arrival rates vary by hour; a constant rate understates the queues at the peak.',
    'Exponential service assumes a few very long services; measure the real spread before trusting the tail.',
  ],
  validate: (config) =>
    queueStationIssues({
      arrival: { kind: 'exponential', rate: config.arrivalRate },
      service: { kind: 'exponential', rate: config.serviceRate },
      servers: config.servers,
    }),
  build: (config, seed) =>
    buildQueueStation(
      {
        arrival: { kind: 'exponential', rate: config.arrivalRate },
        service: { kind: 'exponential', rate: config.serviceRate },
        servers: config.servers,
        batchDuration: 200 / config.arrivalRate,
      },
      seed,
    ),
  suggestedRun: (config) => ({
    until: 20_000 / config.arrivalRate,
    warmupTime: 1_000 / config.arrivalRate,
    batchDuration: 200 / config.arrivalRate,
  }),
  summarise: (report) => [
    { key: 'L', label: 'Mean number in system', value: stateMean(report, QUEUE_STATION_STATS.numberInSystem), kind: 'time-weighted' },
    { key: 'Lq', label: 'Mean number waiting', value: stateMean(report, QUEUE_STATION_STATS.queueLength), kind: 'time-weighted' },
    { key: 'W', label: 'Mean time in system', value: tallyMean(report, QUEUE_STATION_STATS.timeInSystem), kind: 'tally' },
    { key: 'Wq', label: 'Mean waiting time', value: tallyMean(report, QUEUE_STATION_STATS.waitingTime), kind: 'tally' },
    { key: 'utilisation', label: 'Server utilisation', value: report.resources[0].utilisation, kind: 'proportion' },
  ],
  theoretical: (config) => {
    const analysis = analyseMmc({ arrivalRate: config.arrivalRate, serviceRate: config.serviceRate, servers: config.servers });
    const source = `Exact M/M/c steady-state formulas (Erlang C), from src/engine/queueing`;
    return [
      { key: 'L', value: analysis.metrics.L, source },
      { key: 'Lq', value: analysis.metrics.Lq, source },
      { key: 'W', value: analysis.metrics.W, source },
      { key: 'Wq', value: analysis.metrics.Wq, source },
      { key: 'utilisation', value: analysis.metrics.utilisation, source },
    ];
  },
};

// --- 2. Clinic with triage priorities and reneging -------------------------

export interface ClinicConfig {
  arrivalRate: number;
  /** Share of arrivals in each triage class, most urgent first. */
  classShares: number[];
  /** Mean consultation time for each class. */
  meanConsultation: number[];
  /** Mean patience before a patient leaves without being seen, per class. */
  meanPatience: number[];
  clinicians: number;
  /** Let an urgent patient interrupt a less urgent consultation. */
  preemptive: boolean;
}

export const clinicModel: DesModelDef<ClinicConfig> = {
  id: 'clinic-triage',
  name: 'Clinic with triage and walkouts',
  description:
    'Patients arrive, are triaged into urgency classes, and wait for a clinician. The urgent go first; everyone has a limit to their patience and some leave without being seen. The walkout rate is usually the number that matters, and it is invisible to an average-waiting-time calculation.',
  defaults: {
    arrivalRate: 6,
    classShares: [0.15, 0.35, 0.5],
    meanConsultation: [0.6, 0.4, 0.25],
    meanPatience: [4, 2, 1],
    clinicians: 3,
    preemptive: false,
  },
  assumptions: [
    'Triage class is drawn independently for each patient from the stated shares.',
    'Patience is exponential, so a few patients wait a very long time and most leave sooner.',
    'A patient who walks out does not return later, and is counted as a walkout rather than quietly dropped.',
  ],
  limitations: [
    'Real triage depends on the condition, which correlates with consultation time; here they are independent by class only.',
    'There is no analytic answer for this model: priorities, reneging and multiple servers together have no closed form, which is precisely why it is simulated.',
  ],
  validate: (config) => {
    const issues: Issue[] = [];
    if (!(config.arrivalRate > 0)) issues.push({ code: 'range', field: 'arrivalRate', message: 'The arrival rate must be a positive number of patients per unit time.' });
    const k = config.classShares?.length ?? 0;
    if (k < 1) issues.push({ code: 'required', field: 'classShares', message: 'At least one triage class is required.' });
    if (config.meanConsultation?.length !== k || config.meanPatience?.length !== k) {
      issues.push({ code: 'shape', field: 'meanConsultation', message: `Each of the ${k} triage classes needs a mean consultation time and a mean patience.` });
    }
    const total = (config.classShares ?? []).reduce((a, b) => a + b, 0);
    if (k >= 1 && Math.abs(total - 1) > 1e-9) {
      issues.push({ code: 'sum', field: 'classShares', message: `The triage class shares must add up to 1 (they add up to ${total}).` });
    }
    for (let i = 0; i < k; i++) {
      if (!(config.meanConsultation[i] > 0)) issues.push({ code: 'range', field: `meanConsultation.${i}`, message: `Mean consultation time for class ${i + 1} must be positive.` });
      if (!(config.meanPatience[i] > 0)) issues.push({ code: 'range', field: `meanPatience.${i}`, message: `Mean patience for class ${i + 1} must be positive.` });
    }
    if (!Number.isInteger(config.clinicians) || config.clinicians < 1) {
      issues.push({ code: 'range', field: 'clinicians', message: 'The number of clinicians must be a whole number of at least 1.' });
    }
    return issues;
  },
  build: (config, seed) => {
    const issues = clinicModel.validate(config);
    if (issues.length) throw new EngineError(issues);
    const sim = new Simulation({ seed });
    const clinicians = sim.resource('clinicians', {
      capacity: config.clinicians,
      discipline: 'priority',
      preemptive: config.preemptive,
    });
    const inClinic = sim.state('patientsPresent');
    const cumulative = config.classShares.reduce<number[]>((acc, share) => {
      acc.push((acc.length ? acc[acc.length - 1] : 0) + share);
      return acc;
    }, []);
    for (let c = 0; c < config.classShares.length; c++) {
      sim.tally(`class${c + 1}.waitingTime`);
      sim.counter(`class${c + 1}.seen`);
      sim.counter(`class${c + 1}.walkouts`);
    }
    const patient = (): ProcessBody =>
      function* patientProcess(s: Simulation): ProcessGenerator {
        const triageRng = s.stream('triage');
        const cls = triageRng.categorical(cumulative);
        const label = `class${cls + 1}`;
        inClinic.add(s.now, 1);
        const patience = s.stream(`patience.${label}`).exponential(1 / config.meanPatience[cls]);
        const got = yield seize(clinicians, { priority: cls, patience, preemptible: config.preemptive });
        if (!got.ok || got.request === null) {
          s.counter(`${label}.walkouts`).increment();
          s.counter('walkouts').increment();
          inClinic.add(s.now, -1);
          return;
        }
        s.getTally(`${label}.waitingTime`).push(got.waited);
        let remaining = s.stream(`consultation.${label}`).exponential(1 / config.meanConsultation[cls]);
        let request = got.request;
        for (;;) {
          const done = yield serve(request, remaining);
          if (done.ok) break;
          // Interrupted by a more urgent patient: the consultation resumes
          // where it stopped, after re-acquiring a clinician.
          remaining = done.remaining;
          s.counter(`${label}.interrupted`).increment();
          const again = yield seize(clinicians, { priority: cls, preemptible: config.preemptive });
          if (!again.ok || again.request === null) {
            inClinic.add(s.now, -1);
            return;
          }
          request = again.request;
        }
        yield release(request);
        s.counter(`${label}.seen`).increment();
        s.counter('seen').increment();
        inClinic.add(s.now, -1);
      };
    sim.activate(
      source({ stream: 'arrivals', interarrival: exponentialDelay(config.arrivalRate), entity: () => patient(), name: 'patient' }),
      'arrival source',
    );
    return sim;
  },
  suggestedRun: (config) => ({
    until: 5_000 / config.arrivalRate * 10,
    warmupTime: 500 / config.arrivalRate,
    batchDuration: 200 / config.arrivalRate,
  }),
  summarise: (report) => {
    const seen = counterValue(report, 'seen');
    const walkouts = counterValue(report, 'walkouts');
    return [
      { key: 'patientsPresent', label: 'Mean patients in the clinic', value: stateMean(report, 'patientsPresent'), kind: 'time-weighted' },
      { key: 'seen', label: 'Patients seen', value: seen, kind: 'count' },
      { key: 'walkouts', label: 'Patients who left without being seen', value: walkouts, kind: 'count' },
      {
        key: 'walkoutRate',
        label: 'Share of arrivals who walked out',
        value: seen + walkouts > 0 ? walkouts / (seen + walkouts) : Number.NaN,
        kind: 'proportion',
      },
      { key: 'utilisation', label: 'Clinician utilisation', value: report.resources[0].utilisation, kind: 'proportion' },
    ];
  },
};

// --- 3. Two-stage production line with a finite buffer and failures --------

export interface ProductionLineConfig {
  /** Mean processing time at each station. */
  meanProcessing: [number, number];
  /** Places in the buffer between the stations; 0 means the line blocks. */
  bufferCapacity: number;
  /**
   * True when raw material is always available, so station 1 never starves.
   * This is the case queueing theory answers exactly for a zero buffer.
   */
  saturated: boolean;
  /** Arrival rate of raw parts, used when not saturated. */
  arrivalRate?: number;
  /** Mean time to failure and mean repair time per station; null for no failures. */
  failures?: [{ meanUptime: number; meanRepair: number } | null, { meanUptime: number; meanRepair: number } | null];
}

interface Part {
  id: number;
  startedAt: number;
}

export const productionLineModel: DesModelDef<ProductionLineConfig> = {
  id: 'production-line',
  name: 'Two-stage production line with a finite buffer',
  description:
    'Two machines in series with a buffer between them. When the buffer fills, the first machine is blocked and stops — the effect that makes a line slower than its slowest machine. With no buffer and no failures the throughput has an exact answer, so this model doubles as a check on the blocking logic.',
  defaults: {
    meanProcessing: [1, 1],
    bufferCapacity: 0,
    saturated: true,
  },
  assumptions: [
    'Processing times are exponential and independent.',
    'A blocked machine holds its finished part and does nothing else until the buffer frees up.',
    'A failure interrupts the part in progress and it resumes where it stopped once the machine is repaired.',
  ],
  limitations: [
    'Two stations only. Longer lines interact in ways that do not follow from the two-station result.',
    'The exact throughput formula below applies only to the saturated, zero-buffer, failure-free case.',
  ],
  validate: (config) => {
    const issues: Issue[] = [];
    if (!config.meanProcessing || config.meanProcessing.length !== 2) {
      issues.push({ code: 'shape', field: 'meanProcessing', message: 'Exactly two mean processing times are required, one per station.' });
    } else {
      for (let i = 0; i < 2; i++) {
        if (!(config.meanProcessing[i] > 0)) {
          issues.push({ code: 'range', field: `meanProcessing.${i}`, message: `Station ${i + 1}'s mean processing time must be positive.` });
        }
      }
    }
    if (!Number.isInteger(config.bufferCapacity) || config.bufferCapacity < 0) {
      issues.push({ code: 'range', field: 'bufferCapacity', message: `The buffer capacity must be a whole number of places, 0 or greater (got ${config.bufferCapacity}).` });
    }
    if (!config.saturated && !(config.arrivalRate !== undefined && config.arrivalRate > 0)) {
      issues.push({ code: 'required', field: 'arrivalRate', message: 'A line that is not saturated needs an arrival rate for raw parts.' });
    }
    return issues;
  },
  build: (config, seed) => {
    const issues = productionLineModel.validate(config);
    if (issues.length) throw new EngineError(issues);
    const sim = new Simulation({ seed });
    const buffer = sim.store<Part>('buffer', { capacity: config.bufferCapacity });
    const finished = sim.tally('leadTime');
    const anyFailures = (config.failures ?? [null, null]).some((f) => f !== null);
    const stations = [0, 1].map((i) =>
      sim.resource(`station${i + 1}`, { capacity: 1, preemptive: anyFailures }),
    );
    sim.counter('produced');
    sim.counter('blockedEvents');

    // Station 1: take (or create) a part, process it, put it in the buffer.
    // The `put` blocks when the buffer is full — that is the blocking.
    const station1: ProcessBody = function* (s: Simulation): ProcessGenerator {
      const rng = s.stream('processing.1');
      const blocked = s.state('station1.blocked');
      let id = 0;
      for (;;) {
        const got = yield seize(stations[0], { preemptible: anyFailures });
        if (!got.ok || got.request === null) return;
        let remaining = rng.exponential(1 / config.meanProcessing[0]);
        let request = got.request;
        for (;;) {
          const done = yield serve(request, remaining);
          if (done.ok) break;
          remaining = done.remaining;
          const again = yield seize(stations[0], { preemptible: anyFailures });
          if (!again.ok || again.request === null) return;
          request = again.request;
        }
        yield release(request);
        const part: Part = { id: id++, startedAt: s.now };
        const before = s.now;
        blocked.set(s.now, buffer.count >= buffer.capacity ? 1 : 0);
        yield put(buffer, part);
        if (s.now > before) s.counter('blockedEvents').increment();
        blocked.set(s.now, 0);
      }
    };

    // Station 2: take a part from the buffer and process it.
    const station2: ProcessBody = function* (s: Simulation): ProcessGenerator {
      const rng = s.stream('processing.2');
      for (;;) {
        const taken = yield get(buffer);
        const part = taken.item as Part;
        const got = yield seize(stations[1], { preemptible: anyFailures });
        if (!got.ok || got.request === null) return;
        let remaining = rng.exponential(1 / config.meanProcessing[1]);
        let request = got.request;
        for (;;) {
          const done = yield serve(request, remaining);
          if (done.ok) break;
          remaining = done.remaining;
          const again = yield seize(stations[1], { preemptible: anyFailures });
          if (!again.ok || again.request === null) return;
          request = again.request;
        }
        yield release(request);
        finished.push(s.now - part.startedAt);
        s.counter('produced').increment();
      }
    };

    sim.activate(station1, 'station 1');
    sim.activate(station2, 'station 2');
    const failures = config.failures ?? [null, null];
    for (let i = 0; i < 2; i++) {
      const spec = failures[i];
      if (!spec) continue;
      sim.activate(
        failureProcess(stations[i], {
          uptime: exponentialDelay(1 / spec.meanUptime),
          repair: exponentialDelay(1 / spec.meanRepair),
          uptimeStream: `uptime.${i + 1}`,
          repairStream: `repair.${i + 1}`,
        }),
        `station ${i + 1} failures`,
      );
    }
    return sim;
  },
  suggestedRun: (config) => {
    const slowest = Math.max(config.meanProcessing[0], config.meanProcessing[1]);
    return { until: 50_000 * slowest, warmupTime: 500 * slowest, batchDuration: 1_000 * slowest };
  },
  summarise: (report) => [
    { key: 'produced', label: 'Parts produced', value: counterValue(report, 'produced'), kind: 'count' },
    {
      key: 'throughput',
      label: 'Throughput (parts per unit time)',
      value: counterValue(report, 'produced') / (report.endTime - (report.warmup ? report.warmup.discardedUntil : report.startTime)),
      kind: 'rate',
    },
    { key: 'station1Utilisation', label: 'Station 1 utilisation', value: report.resources[0].utilisation, kind: 'proportion' },
    { key: 'station2Utilisation', label: 'Station 2 utilisation', value: report.resources[1].utilisation, kind: 'proportion' },
    { key: 'bufferContents', label: 'Mean parts in the buffer', value: report.stores[0].contents.timeWeightedMean, kind: 'time-weighted' },
  ],
  theoretical: (config) => {
    const hasFailures = (config.failures ?? [null, null]).some((f) => f !== null);
    if (!config.saturated || config.bufferCapacity !== 0 || hasFailures) return [];
    // Three-state continuous-time Markov chain for two exponential stations
    // with no buffer and unlimited raw material: station 1 working with
    // station 2 idle, both working, and station 1 blocked.
    const m1 = 1 / config.meanProcessing[0];
    const m2 = 1 / config.meanProcessing[1];
    const throughput = (m1 * m2 * (m1 + m2)) / (m1 * m1 + m1 * m2 + m2 * m2);
    return [
      {
        key: 'throughput',
        value: throughput,
        source:
          'Exact: throughput = μ₁μ₂(μ₁+μ₂)/(μ₁²+μ₁μ₂+μ₂²), from the three-state Markov chain of a saturated two-station line with zero buffer. For equal rates it gives 2μ/3, so blocking costs a third of the nominal capacity.',
      },
    ];
  },
};

// --- 4. (s, S) inventory system -------------------------------------------

export interface InventoryConfig {
  /** Reorder point: order when the inventory position reaches this or below. */
  reorderPoint: number;
  /** Order up to this level. */
  orderUpTo: number;
  /** Mean time between customer demands. */
  meanDemandInterval: number;
  /** Mean size of each demand (geometric, at least 1). */
  meanDemandSize: number;
  /** Mean delivery lead time. */
  meanLeadTime: number;
  /** Starting stock on hand. */
  initialStock?: number;
}

export const inventoryModel: DesModelDef<InventoryConfig> = {
  id: 'inventory-ss',
  name: '(s, S) inventory with stockouts',
  description:
    'Demand arrives at random, stock is reordered up to S whenever the inventory position falls to s, and deliveries take time. Demand that arrives with no stock is lost. The trade-off between holding stock and losing sales is the whole question, and it depends on the variability, not on the averages.',
  defaults: {
    reorderPoint: 20,
    orderUpTo: 60,
    meanDemandInterval: 0.1,
    meanDemandSize: 2,
    meanLeadTime: 2,
    initialStock: 60,
  },
  assumptions: [
    'Demands arrive as a Poisson process and their sizes are independent.',
    'Demand that cannot be met from stock is lost, not backordered.',
    'The inventory position (stock on hand plus stock on order) drives reordering, so one outstanding order does not trigger another.',
  ],
  limitations: [
    'Lead times are independent of order size and never cross; real suppliers do both.',
    'No analytic answer: lost sales with a stochastic lead time has no usable closed form.',
  ],
  validate: (config) => {
    const issues: Issue[] = [];
    if (!Number.isInteger(config.reorderPoint) || config.reorderPoint < 0) {
      issues.push({ code: 'range', field: 'reorderPoint', message: 'The reorder point must be a whole number of units, 0 or greater.' });
    }
    if (!Number.isInteger(config.orderUpTo) || config.orderUpTo <= config.reorderPoint) {
      issues.push({ code: 'range', field: 'orderUpTo', message: `The order-up-to level must be a whole number greater than the reorder point (${config.reorderPoint}).` });
    }
    if (!(config.meanDemandInterval > 0)) issues.push({ code: 'range', field: 'meanDemandInterval', message: 'The mean time between demands must be positive.' });
    if (!(config.meanDemandSize >= 1)) issues.push({ code: 'range', field: 'meanDemandSize', message: 'The mean demand size must be at least 1 unit.' });
    if (!(config.meanLeadTime > 0)) issues.push({ code: 'range', field: 'meanLeadTime', message: 'The mean lead time must be positive.' });
    return issues;
  },
  build: (config, seed) => {
    const issues = inventoryModel.validate(config);
    if (issues.length) throw new EngineError(issues);
    const sim = new Simulation({ seed });
    const initial = config.initialStock ?? config.orderUpTo;
    const onHand = sim.state('stockOnHand', { initial });
    const position = { value: initial };
    sim.counter('demands');
    sim.counter('unitsSold');
    sim.counter('unitsLost');
    sim.counter('stockouts');
    sim.counter('orders');
    const p = 1 / config.meanDemandSize;

    const replenish = (quantity: number): ProcessBody =>
      function* order(s: Simulation): ProcessGenerator {
        yield hold(s.stream('leadTime').exponential(1 / config.meanLeadTime));
        onHand.add(s.now, quantity);
      };

    const demand: ProcessBody = function* (s: Simulation): ProcessGenerator {
      const sizeRng = s.stream('demandSize');
      for (;;) {
        yield hold(s.stream('demandArrivals').exponential(1 / config.meanDemandInterval));
        s.counter('demands').increment();
        const size = 1 + sizeRng.geometricFailures(p);
        const filled = Math.min(size, onHand.value);
        if (filled < size) {
          s.counter('stockouts').increment();
          s.counter('unitsLost').increment(size - filled);
        }
        if (filled > 0) {
          onHand.add(s.now, -filled);
          s.counter('unitsSold').increment(filled);
          position.value -= filled;
        }
        if (position.value <= config.reorderPoint) {
          const quantity = config.orderUpTo - position.value;
          position.value += quantity;
          s.counter('orders').increment();
          s.activate(replenish(quantity), 'replenishment order');
        }
      }
    };
    sim.activate(demand, 'demand process');
    return sim;
  },
  suggestedRun: (config) => ({
    until: 20_000 * config.meanDemandInterval,
    warmupTime: 500 * config.meanDemandInterval,
    batchDuration: 1_000 * config.meanDemandInterval,
  }),
  summarise: (report) => {
    const demands = counterValue(report, 'demands');
    const stockouts = counterValue(report, 'stockouts');
    const sold = counterValue(report, 'unitsSold');
    const lost = counterValue(report, 'unitsLost');
    return [
      { key: 'stockOnHand', label: 'Mean stock on hand', value: stateMean(report, 'stockOnHand'), kind: 'time-weighted' },
      { key: 'serviceLevel', label: 'Share of demands fully met', value: demands > 0 ? 1 - stockouts / demands : Number.NaN, kind: 'proportion' },
      { key: 'fillRate', label: 'Share of units supplied', value: sold + lost > 0 ? sold / (sold + lost) : Number.NaN, kind: 'proportion' },
      { key: 'orders', label: 'Replenishment orders placed', value: counterValue(report, 'orders'), kind: 'count' },
      { key: 'unitsLost', label: 'Units of demand lost', value: lost, kind: 'count' },
    ];
  },
};

// --- 5. Call centre with abandonment and shifts ----------------------------

export interface CallCentreConfig {
  arrivalRate: number;
  meanCallDuration: number;
  /** Agents on the payroll; shifts decide how many are actually on. */
  agents: number;
  meanPatience: number;
  /** Windows within each cycle, and how many agents are on in each. */
  shifts: { from: number; to: number; staff: number }[];
  /** Length of the repeating schedule. */
  cycle: number;
}

export const callCentreModel: DesModelDef<CallCentreConfig> = {
  id: 'call-centre',
  name: 'Call centre with abandonment and shifts',
  description:
    'Callers wait on hold and hang up if they wait too long, while the number of agents changes through the day. Abandonment and a changing staff level together put this outside every closed form, and the abandonment rate is what customers actually experience.',
  defaults: {
    arrivalRate: 40,
    meanCallDuration: 0.1,
    agents: 8,
    meanPatience: 0.05,
    shifts: [
      { from: 0, to: 8, staff: 2 },
      { from: 8, to: 18, staff: 8 },
      { from: 18, to: 24, staff: 4 },
    ],
    cycle: 24,
  },
  assumptions: [
    'Calls arrive as a Poisson process at a constant rate through the whole cycle.',
    'Patience is exponential; a caller who hangs up does not call back.',
    'Off-shift agents are modelled as unavailable capacity, so utilisation is always measured against the full payroll.',
  ],
  limitations: [
    'A constant arrival rate across the cycle is unrealistic for a call centre; vary it before using the numbers for staffing.',
    'Callers who hang up and redial are a large effect in practice and are not modelled.',
  ],
  validate: (config) => {
    const issues: Issue[] = [];
    if (!(config.arrivalRate > 0)) issues.push({ code: 'range', field: 'arrivalRate', message: 'The call arrival rate must be positive.' });
    if (!(config.meanCallDuration > 0)) issues.push({ code: 'range', field: 'meanCallDuration', message: 'The mean call duration must be positive.' });
    if (!(config.meanPatience > 0)) issues.push({ code: 'range', field: 'meanPatience', message: 'The mean patience must be positive.' });
    if (!Number.isInteger(config.agents) || config.agents < 1) issues.push({ code: 'range', field: 'agents', message: 'The number of agents must be a whole number of at least 1.' });
    if (!(config.cycle > 0)) issues.push({ code: 'range', field: 'cycle', message: 'The schedule cycle must be positive.' });
    if (!config.shifts?.length) issues.push({ code: 'required', field: 'shifts', message: 'At least one shift window is required.' });
    return issues;
  },
  build: (config, seed) => {
    const issues = callCentreModel.validate(config);
    if (issues.length) throw new EngineError(issues);
    const sim = new Simulation({ seed });
    const agents = sim.resource('agents', { capacity: config.agents, discipline: 'fifo', preemptive: true });
    const onHold = sim.state('callersOnHold');
    const answeredWait = sim.tally('answered.waitingTime');
    const abandonedWait = sim.tally('abandoned.waitingTime');
    sim.counter('answered');
    sim.counter('abandoned');

    const caller = (): ProcessBody =>
      function* callerProcess(s: Simulation): ProcessGenerator {
        onHold.add(s.now, 1);
        const patience = s.stream('patience').exponential(1 / config.meanPatience);
        const got = yield seize(agents, { patience });
        onHold.add(s.now, -1);
        if (!got.ok || got.request === null) {
          abandonedWait.push(got.waited);
          s.counter('abandoned').increment();
          return;
        }
        answeredWait.push(got.waited);
        yield hold(s.stream('callDuration').exponential(1 / config.meanCallDuration));
        yield release(got.request);
        s.counter('answered').increment();
      };

    sim.activate(source({ stream: 'arrivals', interarrival: exponentialDelay(config.arrivalRate), entity: () => caller(), name: 'call' }), 'call source');
    sim.activate(shiftSchedule(agents, config.shifts, { cycle: config.cycle }), 'shift schedule');
    return sim;
  },
  suggestedRun: (config) => ({ until: 60 * config.cycle, warmupTime: 2 * config.cycle, batchDuration: config.cycle }),
  summarise: (report) => {
    const answered = counterValue(report, 'answered');
    const abandoned = counterValue(report, 'abandoned');
    const waiting = report.tallies.find((t) => t.name === 'answered.waitingTime');
    return [
      { key: 'callersOnHold', label: 'Mean callers on hold', value: stateMean(report, 'callersOnHold'), kind: 'time-weighted' },
      { key: 'answered', label: 'Calls answered', value: answered, kind: 'count' },
      { key: 'abandoned', label: 'Calls abandoned', value: abandoned, kind: 'count' },
      {
        key: 'abandonmentRate',
        label: 'Share of calls abandoned',
        value: answered + abandoned > 0 ? abandoned / (answered + abandoned) : Number.NaN,
        kind: 'proportion',
      },
      { key: 'meanWaitAnswered', label: 'Mean wait of answered calls', value: waiting ? waiting.mean : Number.NaN, kind: 'tally' },
    ];
  },
};

// --- 6. Repair shop with a spares pool ------------------------------------

export interface RepairShopConfig {
  /** Machines that must stay running. */
  machines: number;
  /** Spare machines that can be swapped in. */
  spares: number;
  /** Mean operating time until a machine fails. */
  meanTimeToFailure: number;
  meanRepairTime: number;
  repairCrews: number;
}

export const repairShopModel: DesModelDef<RepairShopConfig> = {
  id: 'repair-shop',
  name: 'Repair shop with a spares pool',
  description:
    'A fixed set of machines fails and is repaired by a limited crew, with spares to swap in meanwhile. The arrival rate of work falls as more machines are already broken, so the usual infinite-population queueing intuition does not apply — this is the machine-repair problem, and with no spares it has an exact answer.',
  defaults: { machines: 10, spares: 2, meanTimeToFailure: 100, meanRepairTime: 8, repairCrews: 2 },
  assumptions: [
    'Operating times and repair times are exponential.',
    'A failed machine is replaced by a spare instantly when one is available.',
    'Repair crews are interchangeable and work on one machine each.',
  ],
  limitations: [
    'Swap time is zero here; a real swap takes long enough to matter when spares are plentiful.',
    'The exact comparison below holds only for the no-spares case, which is the classical finite-population queue.',
  ],
  validate: (config) => {
    const issues: Issue[] = [];
    if (!Number.isInteger(config.machines) || config.machines < 1) issues.push({ code: 'range', field: 'machines', message: 'The number of machines must be a whole number of at least 1.' });
    if (!Number.isInteger(config.spares) || config.spares < 0) issues.push({ code: 'range', field: 'spares', message: 'The number of spares must be a whole number, 0 or greater.' });
    if (!Number.isInteger(config.repairCrews) || config.repairCrews < 1) issues.push({ code: 'range', field: 'repairCrews', message: 'The number of repair crews must be a whole number of at least 1.' });
    if (!(config.meanTimeToFailure > 0)) issues.push({ code: 'range', field: 'meanTimeToFailure', message: 'The mean time to failure must be positive.' });
    if (!(config.meanRepairTime > 0)) issues.push({ code: 'range', field: 'meanRepairTime', message: 'The mean repair time must be positive.' });
    return issues;
  },
  build: (config, seed) => {
    const issues = repairShopModel.validate(config);
    if (issues.length) throw new EngineError(issues);
    const sim = new Simulation({ seed });
    const crews = sim.resource('repairCrews', { capacity: config.repairCrews });
    const sparePool = sim.store<number>('spares', { capacity: config.machines + config.spares });
    const running = sim.state('machinesRunning', { initial: config.machines });
    const downForLackOfSpare = sim.state('awaitingSpare');
    const repairWait = sim.tally('repairWaitingTime');
    const downtime = sim.tally('machineDowntime');
    sim.counter('failures');
    sim.counter('repairs');

    // Fill the spares pool before anything runs.
    for (let i = 0; i < config.spares; i++) {
      sim.activate(function* seedSpares(s: Simulation): ProcessGenerator {
        yield put(sparePool, -1 - i);
        void s;
      }, `spare ${i}`);
    }

    const machine = (id: number): ProcessBody =>
      function* machineProcess(s: Simulation): ProcessGenerator {
        for (;;) {
          yield hold(s.stream(`operating.${id % 8}`).exponential(1 / config.meanTimeToFailure));
          const failedAt = s.now;
          running.add(s.now, -1);
          s.counter('failures').increment();
          // Swap in a spare if one is free, so production continues.
          let swapped = false;
          if (sparePool.count > 0) {
            yield get(sparePool);
            running.add(s.now, 1);
            swapped = true;
          } else {
            downForLackOfSpare.add(s.now, 1);
          }
          const got = yield seize(crews);
          if (!got.ok || got.request === null) return;
          repairWait.push(got.waited);
          yield hold(s.stream(`repair.${id % 8}`).exponential(1 / config.meanRepairTime));
          yield release(got.request);
          s.counter('repairs').increment();
          downtime.push(s.now - failedAt);
          if (swapped) {
            // The repaired machine becomes the spare.
            yield put(sparePool, id);
          } else {
            downForLackOfSpare.add(s.now, -1);
            running.add(s.now, 1);
          }
        }
      };

    for (let i = 0; i < config.machines; i++) sim.activate(machine(i), `machine ${i}`);
    return sim;
  },
  suggestedRun: (config) => ({
    until: 2_000 * config.meanTimeToFailure,
    warmupTime: 20 * config.meanTimeToFailure,
    batchDuration: 100 * config.meanTimeToFailure,
  }),
  summarise: (report) => [
    { key: 'machinesRunning', label: 'Mean machines running', value: stateMean(report, 'machinesRunning'), kind: 'time-weighted' },
    { key: 'crewUtilisation', label: 'Repair crew utilisation', value: report.resources[0].utilisation, kind: 'proportion' },
    { key: 'meanDowntime', label: 'Mean downtime per failure', value: tallyMean(report, 'machineDowntime'), kind: 'tally' },
    { key: 'failures', label: 'Failures', value: counterValue(report, 'failures'), kind: 'count' },
    { key: 'awaitingSpare', label: 'Mean machines down with no spare', value: stateMean(report, 'awaitingSpare'), kind: 'time-weighted' },
  ],
  theoretical: (config) => {
    if (config.spares !== 0) return [];
    const analysis = analyseFinitePopulation({
      population: config.machines,
      arrivalRate: 1 / config.meanTimeToFailure,
      serviceRate: 1 / config.meanRepairTime,
      servers: config.repairCrews,
    });
    return [
      {
        key: 'machinesRunning',
        value: config.machines - analysis.metrics.L,
        source: 'Exact M/M/c//N machine-repair (finite population) result, from src/engine/queueing. Valid only with no spares.',
      },
      {
        key: 'crewUtilisation',
        value: analysis.metrics.utilisation,
        source: 'Exact M/M/c//N machine-repair result, from src/engine/queueing.',
      },
    ];
  },
};

// --- registry -------------------------------------------------------------

export type AnyDesModel = {
  id: string;
  name: string;
  description: string;
  assumptions: string[];
  limitations: string[];
  validate(config: unknown): Issue[];
  build(config: unknown, seed: Seed): Simulation;
  suggestedRun(config: unknown): { until: number; warmupTime: number; batchDuration: number };
  summarise(report: DesRunReport): DesMetric[];
  theoretical?(config: unknown): DesTheoretical[];
  defaults: unknown;
};

function erase<C>(model: DesModelDef<C>): AnyDesModel {
  return model as unknown as AnyDesModel;
}

export const DES_MODELS: AnyDesModel[] = [
  erase(serviceDeskModel),
  erase(clinicModel),
  erase(productionLineModel),
  erase(inventoryModel),
  erase(callCentreModel),
  erase(repairShopModel),
];

export function getDesModel(id: string): AnyDesModel {
  const found = DES_MODELS.find((m) => m.id === id);
  if (!found) {
    throw new EngineError(`Unknown discrete-event model "${id}". Available models: ${DES_MODELS.map((m) => m.id).join(', ')}.`, 'unknown');
  }
  return found;
}

export function hasDesModel(id: string): boolean {
  return DES_MODELS.some((m) => m.id === id);
}

/** Exact M/G/1 reference values, used by the validation helper. */
export function mg1Reference(arrivalRate: number, serviceRate: number, serviceScv: number): { L: number; Lq: number; W: number; Wq: number } {
  const analysis = analyseMg1({ arrivalRate, serviceRate, serviceScv });
  return { L: analysis.metrics.L, Lq: analysis.metrics.Lq, W: analysis.metrics.W, Wq: analysis.metrics.Wq };
}
