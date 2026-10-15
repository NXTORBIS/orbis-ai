/**
 * Analytic queue models. Each is a `QueueModelDef`, so the same code path
 * serves the interface, the capacity planner and the tests.
 *
 * Exactness: the M/M/* families and the Pollaczek–Khinchine results for M/G/1
 * and M/D/1 are closed-form and reported as 'exact'. The Kingman /
 * Allen–Cunneen result for G/G/c is reported as 'numerical' and always carries
 * a limitation saying it is an approximation.
 */
import { EngineError, type Issue } from '../core/result';
import { logFactorial } from '../special/gamma';
import {
  STANDARD_ASSUMPTIONS,
  STANDARD_LIMITATIONS,
  assertMetricsFinite,
  buildExplanation,
  checkLittlesLaw,
  momentsFromDistribution,
  requireFinitePositive,
  unstableError,
} from './support';
import { MAX_SERVERS, erlangB, erlangC, mmcStateProbabilities, truncatedStateProbabilities } from './erlang';
import type { QueueAnalysis, QueueMetrics, QueueModelDef, StateProbability, WaitingTimeDistribution } from './types';

/** How many states of an unbounded distribution to report. */
const DISTRIBUTION_STATES = 40;

function states(p: number[]): StateProbability[] {
  return p.map((v, n) => ({ n, p: v }));
}

/**
 * A waiting time that is 0 with probability `atom` and otherwise exponential
 * with the given rate — the exact law for the queueing delay in M/M/c.
 */
function atomPlusExponential(args: {
  quantity: 'queueWait' | 'systemTime';
  atom: number;
  rate: number;
  description: string;
}): WaitingTimeDistribution {
  const { atom, rate } = args;
  const mass = 1 - atom;
  return {
    quantity: args.quantity,
    mean: mass / rate,
    atomAtZero: atom,
    description: args.description,
    tail(t: number): number {
      if (!Number.isFinite(t) || t < 0) {
        throw new EngineError('The time t in P(wait > t) must be a finite number, 0 or greater.', 'range');
      }
      return mass * Math.exp(-rate * t);
    },
    quantile(p: number): number {
      if (!Number.isFinite(p) || p < 0 || p >= 1) {
        throw new EngineError(
          'A waiting-time quantile needs a probability in [0, 1): the wait is unbounded, so there is no finite 100th percentile.',
          'range',
        );
      }
      if (p <= atom) return 0;
      const t = -Math.log((1 - p) / mass) / rate;
      return t > 0 ? t : 0; // avoid reporting -0 just above the atom
    },
  };
}

/** A wait that is exactly zero: no queueing is possible in this system. */
function noWait(description: string): WaitingTimeDistribution {
  return {
    quantity: 'queueWait',
    mean: 0,
    atomAtZero: 1,
    description,
    tail(t: number): number {
      if (!Number.isFinite(t) || t < 0) {
        throw new EngineError('The time t in P(wait > t) must be a finite number, 0 or greater.', 'range');
      }
      return 0;
    },
    quantile(p: number): number {
      if (!Number.isFinite(p) || p < 0 || p >= 1) {
        throw new EngineError('A waiting-time quantile needs a probability in [0, 1).', 'range');
      }
      return 0;
    },
  };
}

function rateIssues(c: { arrivalRate: number; serviceRate: number }): Issue[] {
  const issues: Issue[] = [];
  if (!Number.isFinite(c?.arrivalRate) || c.arrivalRate <= 0) {
    issues.push({ code: 'range', field: 'arrivalRate', message: 'Arrival rate λ must be a finite number greater than 0.' });
  }
  if (!Number.isFinite(c?.serviceRate) || c.serviceRate <= 0) {
    issues.push({ code: 'range', field: 'serviceRate', message: 'Service rate μ must be a finite number greater than 0.' });
  }
  return issues;
}

function serverIssues(servers: number): Issue[] {
  if (!Number.isInteger(servers) || servers < 1 || servers > MAX_SERVERS) {
    return [
      {
        code: 'range',
        field: 'servers',
        message: `Number of servers c must be a whole number between 1 and ${MAX_SERVERS}; a queue with fewer than one server can never serve anybody.`,
      },
    ];
  }
  return [];
}

const RATE_PARAMS = [
  {
    key: 'arrivalRate',
    label: 'Arrival rate λ',
    kind: 'rate' as const,
    description: 'Mean number of arrivals per unit time.',
    min: 0,
  },
  {
    key: 'serviceRate',
    label: 'Service rate μ',
    kind: 'rate' as const,
    description: 'Mean number of customers one busy server completes per unit time (so mean service time is 1/μ).',
    min: 0,
  },
];

const SERVER_PARAM = {
  key: 'servers',
  label: 'Servers c',
  kind: 'count' as const,
  description: 'Number of identical parallel servers.',
  min: 1,
  integer: true,
};

// ---------------------------------------------------------------------------
// M/M/1
// ---------------------------------------------------------------------------

export interface Mm1Config {
  arrivalRate: number;
  serviceRate: number;
}

export function analyseMm1(config: Mm1Config): QueueAnalysis {
  requireFinitePositive(config.arrivalRate, 'arrivalRate', 'Arrival rate λ');
  requireFinitePositive(config.serviceRate, 'serviceRate', 'Service rate μ');
  const lambda = config.arrivalRate;
  const mu = config.serviceRate;
  const rho = lambda / mu;
  if (rho >= 1) {
    throw unstableError({ kendall: 'M/M/1', arrivalRate: lambda, capacityRate: mu, utilisation: rho });
  }
  const L = rho / (1 - rho);
  const Lq = (rho * rho) / (1 - rho);
  const W = 1 / (mu - lambda);
  const Wq = rho / (mu - lambda);
  const p: number[] = [];
  for (let n = 0; n <= DISTRIBUTION_STATES; n++) p.push((1 - rho) * Math.pow(rho, n));
  const metrics: QueueMetrics = {
    arrivalRate: lambda,
    effectiveArrivalRate: lambda,
    serviceRate: mu,
    meanServiceTime: 1 / mu,
    servers: 1,
    capacity: null,
    population: null,
    offeredLoad: rho,
    utilisation: rho,
    blockingProbability: null,
    throughput: lambda,
    L,
    Lq,
    W,
    Wq,
    probabilityOfWaiting: rho,
    distribution: states(p),
    distributionTruncated: true,
    littlesLaw: checkLittlesLaw({ effectiveArrivalRate: lambda, L, W, Lq, Wq, usesEffectiveRate: false }),
  };
  assertMetricsFinite(metrics, 'M/M/1');
  return {
    modelId: 'mm1',
    modelName: mm1Model.name,
    kendall: 'M/M/1',
    metrics,
    queueWait: atomPlusExponential({
      quantity: 'queueWait',
      atom: 1 - rho,
      rate: mu - lambda,
      description:
        'Queueing delay: zero with probability 1 − ρ (the system is empty on arrival), otherwise exponential with rate μ − λ. So P(wait > t) = ρ·e^(−(μ−λ)t).',
    }),
    systemTime: atomPlusExponential({
      quantity: 'systemTime',
      atom: 0,
      rate: mu - lambda,
      description:
        'Total time in system is exactly exponential with rate μ − λ under FCFS, so P(T > t) = e^(−(μ−λ)t) and the mean is 1/(μ−λ).',
    }),
    explanation: buildExplanation({
      method: 'M/M/1 steady-state formulas (birth–death chain with constant rates λ and μ)',
      formula: 'ρ = λ/μ, P(n) = (1−ρ)ρⁿ, L = ρ/(1−ρ), Lq = ρ²/(1−ρ), W = 1/(μ−λ), Wq = ρ/(μ−λ)',
      steps: [
        { label: 'Utilisation', expression: 'ρ = λ/μ', value: rho.toPrecision(6) },
        { label: 'Mean number in system', expression: 'L = ρ/(1−ρ)', value: L.toPrecision(6) },
        { label: 'Mean number waiting', expression: 'Lq = ρ²/(1−ρ)', value: Lq.toPrecision(6) },
        { label: 'Mean time in system', expression: 'W = 1/(μ−λ)', value: W.toPrecision(6) },
        { label: 'Mean wait before service', expression: 'Wq = ρ/(μ−λ)', value: Wq.toPrecision(6) },
        { label: 'Little’s law check', expression: 'L = λW', value: `residual ${metrics.littlesLaw.systemResidual.toExponential(2)}` },
      ],
      assumptions: mm1Model.assumptions,
      limitations: mm1Model.limitations,
      exactness: 'exact',
    }),
  };
}

export const mm1Model: QueueModelDef<Mm1Config> = {
  id: 'mm1',
  name: 'M/M/1 — single server, unlimited queue',
  description:
    'Poisson arrivals, exponential service, one server, unlimited waiting room. The reference model of queueing theory and the source of the "waiting explodes as utilisation approaches 1" result.',
  kendall: 'M/M/1',
  params: RATE_PARAMS,
  assumptions: [
    STANDARD_ASSUMPTIONS.poissonArrivals,
    STANDARD_ASSUMPTIONS.exponentialService,
    'A single server.',
    STANDARD_ASSUMPTIONS.fcfs,
    STANDARD_ASSUMPTIONS.infiniteQueue,
    STANDARD_ASSUMPTIONS.steadyState,
    STANDARD_ASSUMPTIONS.homogeneousPopulation,
  ],
  limitations: [STANDARD_LIMITATIONS.realArrivals, STANDARD_LIMITATIONS.noAbandonment, STANDARD_LIMITATIONS.nearSaturation],
  validate: (c) => rateIssues(c),
  analyse: analyseMm1,
};

// ---------------------------------------------------------------------------
// M/M/c
// ---------------------------------------------------------------------------

export interface MmcConfig {
  arrivalRate: number;
  serviceRate: number;
  servers: number;
}

export function analyseMmc(config: MmcConfig): QueueAnalysis {
  requireFinitePositive(config.arrivalRate, 'arrivalRate', 'Arrival rate λ');
  requireFinitePositive(config.serviceRate, 'serviceRate', 'Service rate μ');
  const issues = serverIssues(config.servers);
  if (issues.length) throw new EngineError(issues);
  const { arrivalRate: lambda, serviceRate: mu, servers: c } = config;
  const a = lambda / mu;
  const rho = a / c;
  if (rho >= 1) {
    throw unstableError({
      kendall: 'M/M/c',
      arrivalRate: lambda,
      capacityRate: c * mu,
      utilisation: rho,
      detail: `With ${c} server(s) at rate ${mu} the system can clear at most ${c * mu} customers per unit time.`,
    });
  }
  const C = erlangC(a, c);
  const Lq = (C * rho) / (1 - rho);
  const Wq = Lq / lambda;
  const W = Wq + 1 / mu;
  const L = lambda * W;
  const { p } = mmcStateProbabilities(a, c, Math.max(DISTRIBUTION_STATES, c + 10));
  const metrics: QueueMetrics = {
    arrivalRate: lambda,
    effectiveArrivalRate: lambda,
    serviceRate: mu,
    meanServiceTime: 1 / mu,
    servers: c,
    capacity: null,
    population: null,
    offeredLoad: a,
    utilisation: rho,
    blockingProbability: null,
    throughput: lambda,
    L,
    Lq,
    W,
    Wq,
    probabilityOfWaiting: C,
    distribution: states(p),
    distributionTruncated: true,
    littlesLaw: checkLittlesLaw({ effectiveArrivalRate: lambda, L, W, Lq, Wq, usesEffectiveRate: false }),
  };
  assertMetricsFinite(metrics, 'M/M/c');
  return {
    modelId: 'mmc',
    modelName: mmcModel.name,
    kendall: 'M/M/c',
    metrics,
    queueWait: atomPlusExponential({
      quantity: 'queueWait',
      atom: 1 - C,
      rate: c * mu - lambda,
      description:
        'Queueing delay: zero with probability 1 − C (a server is free on arrival), otherwise exponential with rate cμ − λ. So P(wait > t) = C·e^(−(cμ−λ)t).',
    }),
    explanation: buildExplanation({
      method: 'M/M/c steady state via the Erlang C formula, evaluated with the stable Erlang B recursion',
      formula: 'a = λ/μ, ρ = a/c, C = B/(1 − ρ(1−B)) with B(n) = a·B(n−1)/(n + a·B(n−1)), Lq = Cρ/(1−ρ)',
      steps: [
        { label: 'Offered load', expression: 'a = λ/μ', value: `${a.toPrecision(6)} erlangs` },
        { label: 'Utilisation per server', expression: 'ρ = a/c', value: rho.toPrecision(6) },
        { label: 'Erlang B', expression: 'B(c) by recursion', value: erlangB(a, c).toPrecision(6) },
        { label: 'Erlang C — P(wait > 0)', expression: 'C = B/(1 − ρ(1−B))', value: C.toPrecision(6) },
        { label: 'Mean number waiting', expression: 'Lq = Cρ/(1−ρ)', value: Lq.toPrecision(6) },
        { label: 'Mean wait', expression: 'Wq = Lq/λ = C/(cμ−λ)', value: Wq.toPrecision(6) },
        { label: 'Little’s law check', expression: 'L = λW', value: `residual ${metrics.littlesLaw.systemResidual.toExponential(2)}` },
      ],
      assumptions: mmcModel.assumptions,
      limitations: mmcModel.limitations,
      exactness: 'exact',
    }),
  };
}

export const mmcModel: QueueModelDef<MmcConfig> = {
  id: 'mmc',
  name: 'M/M/c — c parallel servers, one shared queue',
  description:
    'Poisson arrivals, exponential service, c identical servers drawing from one queue. The Erlang C model used for call-centre and help-desk staffing.',
  kendall: 'M/M/c',
  params: [...RATE_PARAMS, SERVER_PARAM],
  assumptions: [
    STANDARD_ASSUMPTIONS.poissonArrivals,
    STANDARD_ASSUMPTIONS.exponentialService,
    'A single shared queue feeds c identical servers; a waiting customer takes the first server to become free.',
    STANDARD_ASSUMPTIONS.independentServers,
    STANDARD_ASSUMPTIONS.fcfs,
    STANDARD_ASSUMPTIONS.infiniteQueue,
    STANDARD_ASSUMPTIONS.steadyState,
  ],
  limitations: [
    STANDARD_LIMITATIONS.realArrivals,
    STANDARD_LIMITATIONS.noAbandonment,
    STANDARD_LIMITATIONS.nearSaturation,
    'Erlang C is computed from the Erlang B recursion rather than the factorial form, because a^n/n! overflows in double precision for a few hundred servers. The recursion is an exact rearrangement, not an approximation.',
  ],
  validate: (c) => [...rateIssues(c), ...serverIssues(c?.servers)],
  analyse: analyseMmc,
};

// ---------------------------------------------------------------------------
// M/M/c/K (finite capacity) and M/M/1/K
// ---------------------------------------------------------------------------

export interface MmcKConfig {
  arrivalRate: number;
  serviceRate: number;
  servers: number;
  capacity: number;
}

function capacityIssues(capacity: number, servers: number): Issue[] {
  const issues: Issue[] = [];
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1_000_000) {
    issues.push({
      code: 'range',
      field: 'capacity',
      message: 'System capacity K must be a whole number of customers, at least 1.',
    });
    return issues;
  }
  if (Number.isInteger(servers) && capacity < servers) {
    issues.push({
      code: 'range',
      field: 'capacity',
      message: `System capacity K (${capacity}) cannot be smaller than the number of servers c (${servers}): servers that can never be occupied are not part of the system.`,
    });
  }
  return issues;
}

export function analyseMmcK(config: MmcKConfig): QueueAnalysis {
  requireFinitePositive(config.arrivalRate, 'arrivalRate', 'Arrival rate λ');
  requireFinitePositive(config.serviceRate, 'serviceRate', 'Service rate μ');
  const issues = [...serverIssues(config.servers), ...capacityIssues(config.capacity, config.servers)];
  if (issues.length) throw new EngineError(issues);
  const { arrivalRate: lambda, serviceRate: mu, servers: c, capacity: K } = config;
  const a = lambda / mu;
  const p = truncatedStateProbabilities(a, c, K);
  const blocking = p[K];
  const lambdaEff = lambda * (1 - blocking);
  if (!(lambdaEff > 0)) {
    throw new EngineError(
      'M/M/c/K: the effective arrival rate came out as zero, so no mean time in system exists. Check the arrival rate and capacity.',
      'numerical',
    );
  }
  const { L, Lq } = momentsFromDistribution(p, c);
  const W = L / lambdaEff;
  const Wq = Lq / lambdaEff;
  const utilisation = lambdaEff / (c * mu);
  const metrics: QueueMetrics = {
    arrivalRate: lambda,
    effectiveArrivalRate: lambdaEff,
    serviceRate: mu,
    meanServiceTime: 1 / mu,
    servers: c,
    capacity: K,
    population: null,
    offeredLoad: a,
    utilisation,
    blockingProbability: blocking,
    throughput: lambdaEff,
    L,
    Lq,
    W,
    Wq,
    probabilityOfWaiting: null,
    distribution: states(p),
    distributionTruncated: false,
    littlesLaw: checkLittlesLaw({ effectiveArrivalRate: lambdaEff, L, W, Lq, Wq, usesEffectiveRate: true }),
  };
  assertMetricsFinite(metrics, 'M/M/c/K');
  const isSingle = c === 1;
  return {
    modelId: isSingle ? 'mm1k' : 'mmck',
    modelName: isSingle ? mm1KModel.name : mmcKModel.name,
    kendall: isSingle ? 'M/M/1/K' : 'M/M/c/K',
    metrics,
    explanation: buildExplanation({
      method: 'Finite-capacity birth–death chain, normalised over the K+1 reachable states',
      formula:
        'p_n ∝ aⁿ/n! for n ≤ c and aⁿ/(c!·c^(n−c)) for c < n ≤ K; P_block = p_K; λ_eff = λ(1−P_block); W = L/λ_eff',
      steps: [
        { label: 'Offered load', expression: 'a = λ/μ', value: `${a.toPrecision(6)} erlangs` },
        { label: 'Blocking probability', expression: 'P_block = p_K', value: blocking.toPrecision(6) },
        { label: 'Effective arrival rate', expression: 'λ_eff = λ(1 − P_block)', value: lambdaEff.toPrecision(6) },
        { label: 'Throughput', expression: 'X = λ_eff', value: lambdaEff.toPrecision(6) },
        { label: 'Mean number in system', expression: 'L = Σ n·p_n', value: L.toPrecision(6) },
        { label: 'Mean time in system', expression: 'W = L/λ_eff', value: W.toPrecision(6) },
        {
          label: 'Little’s law check (effective rate)',
          expression: 'L = λ_eff·W',
          value: `residual ${metrics.littlesLaw.systemResidual.toExponential(2)}`,
        },
      ],
      assumptions: isSingle ? mm1KModel.assumptions : mmcKModel.assumptions,
      limitations: isSingle ? mm1KModel.limitations : mmcKModel.limitations,
      exactness: 'exact',
    }),
  };
}

const FINITE_ASSUMPTIONS = [
  STANDARD_ASSUMPTIONS.poissonArrivals,
  STANDARD_ASSUMPTIONS.exponentialService,
  'The system holds at most K customers including those in service; an arrival finding it full is turned away and never returns (lost, not queued elsewhere).',
  STANDARD_ASSUMPTIONS.fcfs,
  STANDARD_ASSUMPTIONS.steadyState,
];

const FINITE_LIMITATIONS = [
  STANDARD_LIMITATIONS.realArrivals,
  'Blocked arrivals are assumed lost. If they retry, the effective load is higher than modelled here and waiting times are understated.',
  'A finite waiting room is always stable, even at ρ ≥ 1: the overload shows up as blocking, not as an infinite queue. Read the blocking probability, not just the wait.',
];

export const mmcKModel: QueueModelDef<MmcKConfig> = {
  id: 'mmck',
  name: 'M/M/c/K — c servers, finite waiting room',
  description:
    'Poisson arrivals, exponential service, c servers, and room for at most K customers in total. Arrivals that find the system full are turned away, so the system is stable at any load — overload appears as blocking.',
  kendall: 'M/M/c/K',
  params: [
    ...RATE_PARAMS,
    SERVER_PARAM,
    {
      key: 'capacity',
      label: 'System capacity K',
      kind: 'count',
      description: 'Maximum customers in the system, including those in service. Must be at least c.',
      min: 1,
      integer: true,
    },
  ],
  assumptions: FINITE_ASSUMPTIONS,
  limitations: FINITE_LIMITATIONS,
  validate: (c) => [...rateIssues(c), ...serverIssues(c?.servers), ...capacityIssues(c?.capacity, c?.servers)],
  analyse: analyseMmcK,
};

export interface Mm1KConfig {
  arrivalRate: number;
  serviceRate: number;
  capacity: number;
}

export function analyseMm1K(config: Mm1KConfig): QueueAnalysis {
  return analyseMmcK({ ...config, servers: 1 });
}

export const mm1KModel: QueueModelDef<Mm1KConfig> = {
  id: 'mm1k',
  name: 'M/M/1/K — single server, finite waiting room',
  description:
    'The single-server special case of M/M/c/K: one server and room for K customers. Stable at any arrival rate, because excess demand is turned away rather than queued.',
  kendall: 'M/M/1/K',
  params: [
    ...RATE_PARAMS,
    {
      key: 'capacity',
      label: 'System capacity K',
      kind: 'count',
      description: 'Maximum customers in the system, including the one in service.',
      min: 1,
      integer: true,
    },
  ],
  assumptions: FINITE_ASSUMPTIONS,
  limitations: FINITE_LIMITATIONS,
  validate: (c) => [...rateIssues(c), ...capacityIssues(c?.capacity, 1)],
  analyse: analyseMm1K,
};

// ---------------------------------------------------------------------------
// M/M/c/c — Erlang loss
// ---------------------------------------------------------------------------

export interface MmccConfig {
  arrivalRate: number;
  serviceRate: number;
  servers: number;
}

export function analyseMmcc(config: MmccConfig): QueueAnalysis {
  requireFinitePositive(config.arrivalRate, 'arrivalRate', 'Arrival rate λ');
  requireFinitePositive(config.serviceRate, 'serviceRate', 'Service rate μ');
  const issues = serverIssues(config.servers);
  if (issues.length) throw new EngineError(issues);
  const { arrivalRate: lambda, serviceRate: mu, servers: c } = config;
  const a = lambda / mu;
  const blocking = erlangB(a, c);
  const lambdaEff = lambda * (1 - blocking);
  const L = a * (1 - blocking); // mean number of busy servers
  const W = 1 / mu;
  const metrics: QueueMetrics = {
    arrivalRate: lambda,
    effectiveArrivalRate: lambdaEff,
    serviceRate: mu,
    meanServiceTime: 1 / mu,
    servers: c,
    capacity: c,
    population: null,
    offeredLoad: a,
    utilisation: L / c,
    blockingProbability: blocking,
    throughput: lambdaEff,
    L,
    Lq: 0,
    W,
    Wq: 0,
    probabilityOfWaiting: 0,
    distribution: states(truncatedStateProbabilities(a, c, c)),
    distributionTruncated: false,
    littlesLaw: checkLittlesLaw({ effectiveArrivalRate: lambdaEff, L, W, Lq: 0, Wq: 0, usesEffectiveRate: true }),
  };
  assertMetricsFinite(metrics, 'M/M/c/c');
  return {
    modelId: 'mmcc',
    modelName: mmccModel.name,
    kendall: 'M/M/c/c',
    metrics,
    queueWait: noWait('There is no waiting room: an arrival is either served at once or turned away, so the queueing delay is identically zero.'),
    explanation: buildExplanation({
      method: 'Erlang loss system (Erlang B), evaluated with the stable recursion B(0)=1, B(n)=a·B(n−1)/(n + a·B(n−1))',
      formula: 'B(c, a) = blocking probability; λ_eff = λ(1−B); L = a(1−B) busy servers; Wq = 0',
      steps: [
        { label: 'Offered load', expression: 'a = λ/μ', value: `${a.toPrecision(6)} erlangs` },
        { label: 'Blocking probability', expression: 'B(c, a)', value: blocking.toPrecision(6) },
        { label: 'Carried load', expression: 'a(1−B)', value: L.toPrecision(6) },
        { label: 'Throughput', expression: 'λ_eff = λ(1−B)', value: lambdaEff.toPrecision(6) },
        {
          label: 'Little’s law check (effective rate)',
          expression: 'L = λ_eff·W with W = 1/μ',
          value: `residual ${metrics.littlesLaw.systemResidual.toExponential(2)}`,
        },
      ],
      assumptions: mmccModel.assumptions,
      limitations: mmccModel.limitations,
      exactness: 'exact',
    }),
  };
}

export const mmccModel: QueueModelDef<MmccConfig> = {
  id: 'mmcc',
  name: 'M/M/c/c — Erlang loss (no waiting room)',
  description:
    'c servers and no queue at all: an arrival that finds every server busy is lost. The classic telephony trunk-sizing model; blocking is given by Erlang B.',
  kendall: 'M/M/c/c',
  params: [...RATE_PARAMS, SERVER_PARAM],
  assumptions: [
    STANDARD_ASSUMPTIONS.poissonArrivals,
    STANDARD_ASSUMPTIONS.exponentialService,
    'There is no waiting room: an arrival finding all c servers busy is lost immediately and does not retry.',
    STANDARD_ASSUMPTIONS.independentServers,
    STANDARD_ASSUMPTIONS.steadyState,
  ],
  limitations: [
    STANDARD_LIMITATIONS.realArrivals,
    'Blocked customers are assumed not to retry. Retrials raise the effective offered load, which Erlang B underestimates (the Engset and retrial models address this).',
    'Erlang B depends on the service-time distribution only through its mean, which is a genuine property of the loss system and not an approximation.',
  ],
  validate: (c) => [...rateIssues(c), ...serverIssues(c?.servers)],
  analyse: analyseMmcc,
};

// ---------------------------------------------------------------------------
// M/M/∞
// ---------------------------------------------------------------------------

export interface MmInfConfig {
  arrivalRate: number;
  serviceRate: number;
}

export function analyseMmInfinity(config: MmInfConfig): QueueAnalysis {
  requireFinitePositive(config.arrivalRate, 'arrivalRate', 'Arrival rate λ');
  requireFinitePositive(config.serviceRate, 'serviceRate', 'Service rate μ');
  const lambda = config.arrivalRate;
  const mu = config.serviceRate;
  const a = lambda / mu;
  // Number in system is exactly Poisson(a); computed in log space.
  const p: number[] = [];
  const upTo = Math.max(DISTRIBUTION_STATES, Math.ceil(a + 10 * Math.sqrt(a + 1)));
  for (let n = 0; n <= upTo; n++) p.push(Math.exp(n * Math.log(a) - a - logFactorial(n)));
  const metrics: QueueMetrics = {
    arrivalRate: lambda,
    effectiveArrivalRate: lambda,
    serviceRate: mu,
    meanServiceTime: 1 / mu,
    servers: Number.POSITIVE_INFINITY,
    capacity: null,
    population: null,
    offeredLoad: a,
    utilisation: 0,
    blockingProbability: 0,
    throughput: lambda,
    L: a,
    Lq: 0,
    W: 1 / mu,
    Wq: 0,
    probabilityOfWaiting: 0,
    distribution: states(p),
    distributionTruncated: true,
    littlesLaw: checkLittlesLaw({ effectiveArrivalRate: lambda, L: a, W: 1 / mu, Lq: 0, Wq: 0, usesEffectiveRate: false }),
  };
  assertMetricsFinite(metrics, 'M/M/∞');
  return {
    modelId: 'mminf',
    modelName: mmInfinityModel.name,
    kendall: 'M/M/∞',
    metrics,
    queueWait: noWait('A server is always available, so the queueing delay is identically zero.'),
    systemTime: atomPlusExponential({
      quantity: 'systemTime',
      atom: 0,
      rate: mu,
      description: 'Time in system is just the service time: exponential with rate μ.',
    }),
    explanation: buildExplanation({
      method: 'Infinite-server queue: the number in system is exactly Poisson with mean λ/μ',
      formula: 'P(n) = e^(−a)·aⁿ/n! with a = λ/μ; L = a; W = 1/μ; Lq = Wq = 0',
      steps: [
        { label: 'Offered load', expression: 'a = λ/μ', value: a.toPrecision(6) },
        { label: 'Mean number in system', expression: 'L = a', value: a.toPrecision(6) },
        { label: 'Mean time in system', expression: 'W = 1/μ', value: (1 / mu).toPrecision(6) },
        { label: 'Little’s law check', expression: 'L = λW', value: `residual ${metrics.littlesLaw.systemResidual.toExponential(2)}` },
      ],
      assumptions: mmInfinityModel.assumptions,
      limitations: mmInfinityModel.limitations,
      exactness: 'exact',
    }),
  };
}

export const mmInfinityModel: QueueModelDef<MmInfConfig> = {
  id: 'mminf',
  name: 'M/M/∞ — unlimited servers (self-service)',
  description:
    'Every arrival is served immediately: nobody ever waits. The number in system is exactly Poisson(λ/μ). A good model for self-service, concurrent downloads, or "how many are in progress right now".',
  kendall: 'M/M/∞',
  params: RATE_PARAMS,
  assumptions: [
    STANDARD_ASSUMPTIONS.poissonArrivals,
    STANDARD_ASSUMPTIONS.exponentialService,
    'Capacity is unlimited: every arrival begins service immediately, with no contention between customers.',
    STANDARD_ASSUMPTIONS.steadyState,
  ],
  limitations: [
    STANDARD_LIMITATIONS.realArrivals,
    'Unlimited capacity is an idealisation. Any real system has a limit, and near that limit the Poisson result understates congestion badly.',
  ],
  validate: (c) => rateIssues(c),
  analyse: analyseMmInfinity,
};

// ---------------------------------------------------------------------------
// M/G/1 (Pollaczek–Khinchine) and M/D/1
// ---------------------------------------------------------------------------

export interface Mg1Config {
  arrivalRate: number;
  /** Service rate μ = 1/E[S]. */
  serviceRate: number;
  /** Squared coefficient of variation of service time, Var[S]/E[S]². */
  serviceScv?: number;
  /** Variance of service time; used when serviceScv is not given. */
  serviceVariance?: number;
}

function resolveScv(config: Mg1Config): number {
  const hasScv = config.serviceScv !== undefined && config.serviceScv !== null;
  const hasVar = config.serviceVariance !== undefined && config.serviceVariance !== null;
  if (hasScv && hasVar) {
    const implied = (config.serviceVariance as number) * config.serviceRate * config.serviceRate;
    if (Math.abs(implied - (config.serviceScv as number)) > 1e-9 * Math.max(1, implied)) {
      throw new EngineError(
        'M/G/1: the service-time variance and the squared coefficient of variation disagree. Supply one of them, not both.',
        'conflict',
      );
    }
  }
  if (hasScv) {
    const scv = config.serviceScv as number;
    if (!Number.isFinite(scv) || scv < 0) {
      throw new EngineError(
        [{ code: 'range', field: 'serviceScv', message: 'The service-time squared coefficient of variation must be a finite number, 0 or greater.' }],
      );
    }
    return scv;
  }
  if (hasVar) {
    const v = config.serviceVariance as number;
    if (!Number.isFinite(v) || v < 0) {
      throw new EngineError([{ code: 'range', field: 'serviceVariance', message: 'The service-time variance must be a finite number, 0 or greater.' }]);
    }
    return v * config.serviceRate * config.serviceRate;
  }
  throw new EngineError(
    [
      {
        code: 'required',
        field: 'serviceScv',
        message:
          'M/G/1 needs the variability of the service time as well as its mean: supply either the squared coefficient of variation (Var[S]/E[S]²) or the variance. Service-time variability, not just the mean, drives the waiting time, so there is no sensible default.',
      },
    ],
  );
}

export function analyseMg1(config: Mg1Config): QueueAnalysis {
  requireFinitePositive(config.arrivalRate, 'arrivalRate', 'Arrival rate λ');
  requireFinitePositive(config.serviceRate, 'serviceRate', 'Service rate μ');
  const scv = resolveScv(config);
  const lambda = config.arrivalRate;
  const mu = config.serviceRate;
  const Es = 1 / mu;
  const rho = lambda * Es;
  if (rho >= 1) {
    throw unstableError({
      kendall: 'M/G/1',
      arrivalRate: lambda,
      capacityRate: mu,
      utilisation: rho,
      detail: 'The Pollaczek–Khinchine formula divides by (1 − ρ), which is zero or negative here.',
    });
  }
  // Pollaczek–Khinchine: Lq = ρ²(1 + C_s²) / (2(1 − ρ)).
  const Lq = (rho * rho * (1 + scv)) / (2 * (1 - rho));
  const Wq = Lq / lambda;
  const W = Wq + Es;
  const L = lambda * W;
  const isDeterministic = scv === 0;
  const metrics: QueueMetrics = {
    arrivalRate: lambda,
    effectiveArrivalRate: lambda,
    serviceRate: mu,
    meanServiceTime: Es,
    servers: 1,
    capacity: null,
    population: null,
    offeredLoad: rho,
    utilisation: rho,
    blockingProbability: null,
    throughput: lambda,
    L,
    Lq,
    W,
    Wq,
    probabilityOfWaiting: rho,
    distribution: [],
    distributionTruncated: false,
    littlesLaw: checkLittlesLaw({ effectiveArrivalRate: lambda, L, W, Lq, Wq, usesEffectiveRate: false }),
  };
  assertMetricsFinite(metrics, 'M/G/1');
  return {
    modelId: isDeterministic ? 'md1' : 'mg1',
    modelName: isDeterministic ? md1Model.name : mg1Model.name,
    kendall: isDeterministic ? 'M/D/1' : 'M/G/1',
    metrics,
    explanation: buildExplanation({
      method: 'Pollaczek–Khinchine formula for the M/G/1 queue',
      formula: 'Lq = ρ²(1 + C_s²) / (2(1 − ρ)), equivalently Wq = λ·E[S²] / (2(1 − ρ))',
      steps: [
        { label: 'Mean service time', expression: 'E[S] = 1/μ', value: Es.toPrecision(6) },
        { label: 'Service variability', expression: 'C_s² = Var[S]/E[S]²', value: scv.toPrecision(6) },
        { label: 'Utilisation', expression: 'ρ = λ·E[S]', value: rho.toPrecision(6) },
        { label: 'Mean number waiting', expression: 'Lq = ρ²(1+C_s²)/(2(1−ρ))', value: Lq.toPrecision(6) },
        { label: 'Mean wait', expression: 'Wq = Lq/λ', value: Wq.toPrecision(6) },
        {
          label: 'Effect of variability',
          expression: 'Wq ∝ (1 + C_s²)',
          value: `at C_s² = ${scv.toPrecision(4)} the wait is ${((1 + scv) / 2).toPrecision(4)}× the deterministic-service wait at the same mean`,
        },
        { label: 'Little’s law check', expression: 'L = λW', value: `residual ${metrics.littlesLaw.systemResidual.toExponential(2)}` },
      ],
      assumptions: isDeterministic ? md1Model.assumptions : mg1Model.assumptions,
      limitations: isDeterministic ? md1Model.limitations : mg1Model.limitations,
      exactness: 'exact',
    }),
  };
}

export const mg1Model: QueueModelDef<Mg1Config> = {
  id: 'mg1',
  name: 'M/G/1 — one server, any service-time distribution',
  description:
    'Poisson arrivals, one server, and service times with a known mean and variance but any shape. The Pollaczek–Khinchine formula shows that the queue is driven by service-time VARIABILITY as much as by the mean: holding the mean fixed and doubling 1 + C_s² doubles the mean queue.',
  kendall: 'M/G/1',
  params: [
    ...RATE_PARAMS,
    {
      key: 'serviceScv',
      label: 'Service-time squared coefficient of variation C_s²',
      kind: 'scv',
      description:
        'Var[S]/E[S]². 0 for constant service times, 1 for exponential, above 1 for highly variable service. Supply this or the variance.',
      min: 0,
      optional: true,
    },
    {
      key: 'serviceVariance',
      label: 'Service-time variance Var[S]',
      kind: 'variance',
      description: 'Alternative to C_s²; converted using C_s² = Var[S]·μ².',
      min: 0,
      optional: true,
    },
  ],
  assumptions: [
    STANDARD_ASSUMPTIONS.poissonArrivals,
    STANDARD_ASSUMPTIONS.generalService,
    'A single server, unlimited waiting room, work-conserving service (nobody is idle while work waits).',
    STANDARD_ASSUMPTIONS.fcfs,
    STANDARD_ASSUMPTIONS.steadyState,
  ],
  limitations: [
    STANDARD_LIMITATIONS.realArrivals,
    'Only the mean and variance of the service time enter the formula. The mean queue is exact, but the distribution of individual waits depends on the whole service-time law and is not given here.',
    STANDARD_LIMITATIONS.nearSaturation,
  ],
  validate: (c) => {
    const issues = rateIssues(c);
    const hasScv = c?.serviceScv !== undefined && c?.serviceScv !== null;
    const hasVar = c?.serviceVariance !== undefined && c?.serviceVariance !== null;
    if (!hasScv && !hasVar) {
      issues.push({
        code: 'required',
        field: 'serviceScv',
        message: 'Supply the service-time squared coefficient of variation or its variance: M/G/1 waiting depends on service-time variability.',
      });
    }
    if (hasScv && (!Number.isFinite(c.serviceScv as number) || (c.serviceScv as number) < 0)) {
      issues.push({ code: 'range', field: 'serviceScv', message: 'C_s² must be a finite number, 0 or greater.' });
    }
    if (hasVar && (!Number.isFinite(c.serviceVariance as number) || (c.serviceVariance as number) < 0)) {
      issues.push({ code: 'range', field: 'serviceVariance', message: 'Var[S] must be a finite number, 0 or greater.' });
    }
    return issues;
  },
  analyse: analyseMg1,
};

export interface Md1Config {
  arrivalRate: number;
  serviceRate: number;
}

export function analyseMd1(config: Md1Config): QueueAnalysis {
  return analyseMg1({ ...config, serviceScv: 0 });
}

export const md1Model: QueueModelDef<Md1Config> = {
  id: 'md1',
  name: 'M/D/1 — one server, constant service time',
  description:
    'The zero-variance special case of M/G/1: every service takes exactly 1/μ. Its mean queue is exactly half the M/M/1 queue at the same λ and μ — the cleanest demonstration that variability, not load alone, creates waiting.',
  kendall: 'M/D/1',
  params: RATE_PARAMS,
  assumptions: [
    STANDARD_ASSUMPTIONS.poissonArrivals,
    'Service takes exactly 1/μ for every customer: no variability at all.',
    'A single server, unlimited waiting room, first-come first-served.',
    STANDARD_ASSUMPTIONS.steadyState,
  ],
  limitations: [
    STANDARD_LIMITATIONS.realArrivals,
    'Exactly constant service is itself an idealisation; any real variability pushes results back towards M/M/1.',
  ],
  validate: (c) => rateIssues(c),
  analyse: analyseMd1,
};

// ---------------------------------------------------------------------------
// G/G/c — Kingman / Allen–Cunneen APPROXIMATION
// ---------------------------------------------------------------------------


export interface GgcConfig {
  arrivalRate: number;
  serviceRate: number;
  /** Squared coefficient of variation of the inter-arrival time. */
  arrivalScv: number;
  /** Squared coefficient of variation of the service time. */
  serviceScv: number;
  /** Number of servers; 1 gives the Kingman form. */
  servers?: number;
}

function scvIssues(value: number, field: string, label: string): Issue[] {
  if (value === undefined || value === null || !Number.isFinite(value) || value < 0) {
    return [{ code: 'range', field, message: `${label} must be a finite number, 0 or greater.` }];
  }
  return [];
}

/**
 * Kingman's heavy-traffic approximation (c = 1) and its Allen–Cunneen
 * extension (c > 1). This is an APPROXIMATION: it is exact for M/M/c
 * (C_a² = C_s² = 1), good within a few percent at high utilisation, and can be
 * off by tens of percent at low utilisation or with highly variable arrivals.
 */
export function analyseGgc(config: GgcConfig): QueueAnalysis {
  requireFinitePositive(config.arrivalRate, 'arrivalRate', 'Arrival rate λ');
  requireFinitePositive(config.serviceRate, 'serviceRate', 'Service rate μ');
  const c = config.servers ?? 1;
  const issues = [
    ...serverIssues(c),
    ...scvIssues(config.arrivalScv, 'arrivalScv', 'The inter-arrival squared coefficient of variation C_a²'),
    ...scvIssues(config.serviceScv, 'serviceScv', 'The service-time squared coefficient of variation C_s²'),
  ];
  if (issues.length) throw new EngineError(issues);
  const { arrivalRate: lambda, serviceRate: mu, arrivalScv: ca2, serviceScv: cs2 } = config;
  const a = lambda / mu;
  const rho = a / c;
  if (rho >= 1) {
    throw unstableError({
      kendall: c === 1 ? 'G/G/1' : 'G/G/c',
      arrivalRate: lambda,
      capacityRate: c * mu,
      utilisation: rho,
      detail: 'The Kingman / Allen–Cunneen approximation divides by (1 − ρ) and says nothing about an unstable queue.',
    });
  }
  const variability = (ca2 + cs2) / 2;
  // Allen–Cunneen: Wq ≈ (C_erlang/(cμ − λ)) · (C_a² + C_s²)/2, which for c = 1
  // reduces to Kingman's Wq ≈ (ρ/(1−ρ))·((C_a²+C_s²)/2)·E[S].
  const waitProbability = erlangC(a, c);
  const mmcWq = waitProbability / (c * mu - lambda);
  const Wq = mmcWq * variability;
  const W = Wq + 1 / mu;
  const Lq = lambda * Wq;
  const L = lambda * W;
  const metrics: QueueMetrics = {
    arrivalRate: lambda,
    effectiveArrivalRate: lambda,
    serviceRate: mu,
    meanServiceTime: 1 / mu,
    servers: c,
    capacity: null,
    population: null,
    offeredLoad: a,
    utilisation: rho,
    blockingProbability: null,
    throughput: lambda,
    L,
    Lq,
    W,
    Wq,
    probabilityOfWaiting: null,
    distribution: [],
    distributionTruncated: false,
    littlesLaw: checkLittlesLaw({ effectiveArrivalRate: lambda, L, W, Lq, Wq, usesEffectiveRate: false }),
  };
  assertMetricsFinite(metrics, c === 1 ? 'G/G/1' : 'G/G/c');
  return {
    modelId: 'ggc',
    modelName: ggcModel.name,
    kendall: c === 1 ? 'G/G/1' : 'G/G/c',
    metrics,
    explanation: buildExplanation({
      method:
        c === 1
          ? 'Kingman approximation for G/G/1 (APPROXIMATION, not a closed-form result)'
          : 'Allen–Cunneen approximation for G/G/c (APPROXIMATION, not a closed-form result)',
      formula:
        c === 1
          ? 'Wq ≈ (ρ/(1−ρ))·((C_a² + C_s²)/2)·E[S]'
          : 'Wq ≈ (C(c,a)/(cμ−λ))·((C_a² + C_s²)/2)',
      steps: [
        { label: 'Utilisation', expression: 'ρ = λ/(cμ)', value: rho.toPrecision(6) },
        { label: 'Variability factor', expression: '(C_a² + C_s²)/2', value: variability.toPrecision(6) },
        { label: 'M/M/c wait at the same load', expression: 'C/(cμ−λ)', value: mmcWq.toPrecision(6) },
        { label: 'Approximate mean wait', expression: 'Wq ≈ variability × M/M/c wait', value: Wq.toPrecision(6) },
        {
          label: 'Status',
          value: 'APPROXIMATION — exact only when C_a² = C_s² = 1, where it reproduces M/M/c.',
        },
      ],
      assumptions: ggcModel.assumptions,
      limitations: ggcModel.limitations,
      exactness: 'numerical',
    }),
  };
}

export const ggcModel: QueueModelDef<GgcConfig> = {
  id: 'ggc',
  name: 'G/G/c — general arrivals and service (Kingman / Allen–Cunneen approximation)',
  description:
    'An APPROXIMATION for queues whose arrival and service processes are described only by a mean and a coefficient of variation. No exact closed form exists for G/G/1, so this result is an estimate, not a theorem.',
  kendall: 'G/G/c',
  params: [
    ...RATE_PARAMS,
    {
      key: 'arrivalScv',
      label: 'Inter-arrival squared coefficient of variation C_a²',
      kind: 'scv',
      description: '0 for perfectly scheduled arrivals, 1 for Poisson, above 1 for bursty traffic.',
      min: 0,
    },
    {
      key: 'serviceScv',
      label: 'Service-time squared coefficient of variation C_s²',
      kind: 'scv',
      description: '0 for constant service, 1 for exponential, above 1 for highly variable service.',
      min: 0,
    },
    { ...SERVER_PARAM, optional: true },
  ],
  assumptions: [
    'Arrivals form a renewal process with the stated mean rate and inter-arrival variability; service times are independent with the stated mean and variability.',
    'Unlimited waiting room, work-conserving FCFS service, c identical servers.',
    STANDARD_ASSUMPTIONS.steadyState,
  ],
  limitations: [
    'This is an APPROXIMATION, not an exact result. There is no general closed form for the G/G/1 waiting time.',
    'It is exact when C_a² = C_s² = 1 (where it reproduces M/M/c) and asymptotically exact as ρ → 1. At low to moderate utilisation, or with C_a² far from 1, errors of tens of percent are normal, and it tends to overstate the wait for C_a² < 1.',
    'Only the first two moments are used; two processes with the same mean and variance but different shapes can queue differently.',
    STANDARD_LIMITATIONS.nearSaturation,
  ],
  validate: (c) => [
    ...rateIssues(c),
    ...serverIssues(c?.servers ?? 1),
    ...scvIssues(c?.arrivalScv, 'arrivalScv', 'C_a²'),
    ...scvIssues(c?.serviceScv, 'serviceScv', 'C_s²'),
  ],
  analyse: analyseGgc,
};

// ---------------------------------------------------------------------------
// M/M/c//N — finite calling population (machine repair)
// ---------------------------------------------------------------------------

export interface FinitePopulationConfig {
  /** Failure rate of ONE unit while it is working (not the aggregate rate). */
  arrivalRate: number;
  serviceRate: number;
  /** Number of units in the calling population N. */
  population: number;
  /** Number of repair channels; defaults to 1. */
  servers?: number;
}

/**
 * log of the unnormalised weight of state n (units down) in the machine-repair
 * model: C(N,n)·aⁿ for n ≤ c, and C(N,n)·n!/(c!·c^(n−c))·aⁿ for n > c.
 */
function logFiniteWeight(a: number, N: number, c: number, n: number): number {
  const logChooseTerm = logFactorial(N) - logFactorial(n) - logFactorial(N - n);
  const base = logChooseTerm + n * Math.log(a);
  if (n <= c) return base;
  return base + logFactorial(n) - logFactorial(c) - (n - c) * Math.log(c);
}

export function analyseFinitePopulation(config: FinitePopulationConfig): QueueAnalysis {
  requireFinitePositive(config.arrivalRate, 'arrivalRate', 'Per-unit arrival (failure) rate λ');
  requireFinitePositive(config.serviceRate, 'serviceRate', 'Service (repair) rate μ');
  const c = config.servers ?? 1;
  const N = config.population;
  const issues = [...serverIssues(c)];
  if (!Number.isInteger(N) || N < 1 || N > 100_000) {
    issues.push({ code: 'range', field: 'population', message: 'The calling population N must be a whole number of units, at least 1.' });
  } else if (Number.isInteger(c) && c > N) {
    issues.push({
      code: 'range',
      field: 'servers',
      message: `There are more servers (${c}) than units in the population (${N}); servers beyond N can never be used.`,
    });
  }
  if (issues.length) throw new EngineError(issues);
  const lambda = config.arrivalRate;
  const mu = config.serviceRate;
  const a = lambda / mu;
  const logs: number[] = [];
  for (let n = 0; n <= N; n++) logs.push(logFiniteWeight(a, N, c, n));
  const maxLog = Math.max(...logs);
  let total = 0;
  for (const l of logs) total += Math.exp(l - maxLog);
  const p = logs.map((l) => Math.exp(l - maxLog) / total);
  const { L, Lq } = momentsFromDistribution(p, c);
  // Each of the (N − L) units that are up generates arrivals at rate λ.
  const lambdaEff = lambda * (N - L);
  if (!(lambdaEff > 0)) {
    throw new EngineError(
      'Finite-population queue: the effective arrival rate came out as zero, so no mean time in system exists.',
      'numerical',
    );
  }
  const W = L / lambdaEff;
  const Wq = Lq / lambdaEff;
  const metrics: QueueMetrics = {
    arrivalRate: lambda,
    effectiveArrivalRate: lambdaEff,
    serviceRate: mu,
    meanServiceTime: 1 / mu,
    servers: c,
    capacity: N,
    population: N,
    offeredLoad: N * a,
    utilisation: lambdaEff / (c * mu),
    blockingProbability: null,
    throughput: lambdaEff,
    L,
    Lq,
    W,
    Wq,
    probabilityOfWaiting: null,
    distribution: states(p),
    distributionTruncated: false,
    littlesLaw: checkLittlesLaw({ effectiveArrivalRate: lambdaEff, L, W, Lq, Wq, usesEffectiveRate: true }),
  };
  assertMetricsFinite(metrics, 'M/M/c//N');
  return {
    modelId: 'finitepop',
    modelName: finitePopulationModel.name,
    kendall: c === 1 ? 'M/M/1//N' : 'M/M/c//N',
    metrics,
    explanation: buildExplanation({
      method: 'Finite calling population (machine repair / Engset-type) birth–death chain',
      steps: [
        { label: 'Per-unit load', expression: 'a = λ/μ', value: a.toPrecision(6) },
        { label: 'Mean units in the system', expression: 'L = Σ n·p_n', value: L.toPrecision(6) },
        { label: 'Effective arrival rate', expression: 'λ_eff = λ(N − L)', value: lambdaEff.toPrecision(6) },
        { label: 'Mean time in system', expression: 'W = L/λ_eff', value: W.toPrecision(6) },
        {
          label: 'Little’s law check (effective rate)',
          expression: 'L = λ_eff·W',
          value: `residual ${metrics.littlesLaw.systemResidual.toExponential(2)}`,
        },
      ],
      formula: 'p_n ∝ C(N,n)·aⁿ (n ≤ c), C(N,n)·n!/(c!·c^(n−c))·aⁿ (n > c); λ_eff = λ(N − L)',
      assumptions: finitePopulationModel.assumptions,
      limitations: finitePopulationModel.limitations,
      exactness: 'exact',
    }),
  };
}

export const finitePopulationModel: QueueModelDef<FinitePopulationConfig> = {
  id: 'finitepop',
  name: 'M/M/c//N — finite calling population (machine repair)',
  description:
    'A fixed population of N units, each of which generates an arrival at rate λ only while it is NOT already in the system. Because the arrival rate falls as the queue grows, this system is stable at any λ and μ. The classic machine-repair model.',
  kendall: 'M/M/c//N',
  params: [
    {
      key: 'arrivalRate',
      label: 'Per-unit arrival rate λ',
      kind: 'rate',
      description: 'Rate at which ONE unit generates an arrival while it is up and outside the system.',
      min: 0,
    },
    {
      key: 'serviceRate',
      label: 'Service rate μ',
      kind: 'rate',
      description: 'Rate at which one busy server completes a repair.',
      min: 0,
    },
    {
      key: 'population',
      label: 'Population N',
      kind: 'count',
      description: 'Number of units that can call on the system.',
      min: 1,
      integer: true,
    },
    { ...SERVER_PARAM, optional: true },
  ],
  assumptions: [
    'Each of the N units generates arrivals as a Poisson process at rate λ, but only while it is outside the system — this is what makes the arrival rate state-dependent.',
    STANDARD_ASSUMPTIONS.exponentialService,
    STANDARD_ASSUMPTIONS.independentServers,
    STANDARD_ASSUMPTIONS.steadyState,
  ],
  limitations: [
    'The self-limiting arrival rate means this model is always stable; comparing its ρ to 1 is not a meaningful stability test.',
    'All N units are assumed statistically identical and independent.',
    STANDARD_LIMITATIONS.meanOnly,
  ],
  validate: (cfg) => {
    const issues: Issue[] = [];
    if (!Number.isFinite(cfg?.arrivalRate) || cfg.arrivalRate <= 0) {
      issues.push({ code: 'range', field: 'arrivalRate', message: 'Per-unit arrival rate λ must be greater than 0.' });
    }
    if (!Number.isFinite(cfg?.serviceRate) || cfg.serviceRate <= 0) {
      issues.push({ code: 'range', field: 'serviceRate', message: 'Service rate μ must be greater than 0.' });
    }
    if (!Number.isInteger(cfg?.population) || cfg.population < 1) {
      issues.push({ code: 'range', field: 'population', message: 'Population N must be a whole number, at least 1.' });
    }
    issues.push(...serverIssues(cfg?.servers ?? 1));
    return issues;
  },
  analyse: analyseFinitePopulation,
};

// ---------------------------------------------------------------------------
// Non-preemptive priority M/M/1
// ---------------------------------------------------------------------------

export interface PriorityClass {
  label: string;
  arrivalRate: number;
  serviceRate: number;
}

export interface PriorityConfig {
  /** Classes in priority order, highest priority first. */
  classes: PriorityClass[];
}

export interface PriorityClassResult {
  label: string;
  arrivalRate: number;
  serviceRate: number;
  utilisation: number;
  /** Mean wait before service for this class. */
  Wq: number;
  /** Mean time in system for this class. */
  W: number;
  Lq: number;
  L: number;
}

export interface PriorityAnalysis extends QueueAnalysis {
  classes: PriorityClassResult[];
}

/**
 * Non-preemptive head-of-line priority at a single server, exponential service
 * per class (Cobham's formula):
 *   Wq_k = R / ((1 − σ_{k−1})(1 − σ_k)),  R = Σ_i λ_i·E[S_i²]/2 = Σ_i λ_i/μ_i²
 * where σ_k = Σ_{i ≤ k} ρ_i. A customer in service is never interrupted.
 */
export function analysePriority(config: PriorityConfig): PriorityAnalysis {
  const classes = config?.classes;
  if (!Array.isArray(classes) || classes.length < 2) {
    throw new EngineError(
      [{ code: 'required', field: 'classes', message: 'A priority queue needs at least two customer classes, listed highest priority first.' }],
    );
  }
  if (classes.length > 20) {
    throw new EngineError([{ code: 'range', field: 'classes', message: 'At most 20 priority classes are supported.' }]);
  }
  const issues: Issue[] = [];
  classes.forEach((k, i) => {
    if (!Number.isFinite(k?.arrivalRate) || k.arrivalRate <= 0) {
      issues.push({ code: 'range', field: `classes.${i}.arrivalRate`, message: `Class ${i + 1}: arrival rate must be greater than 0.` });
    }
    if (!Number.isFinite(k?.serviceRate) || k.serviceRate <= 0) {
      issues.push({ code: 'range', field: `classes.${i}.serviceRate`, message: `Class ${i + 1}: service rate must be greater than 0.` });
    }
  });
  if (issues.length) throw new EngineError(issues);
  const lambda = classes.reduce((s, k) => s + k.arrivalRate, 0);
  const rhos = classes.map((k) => k.arrivalRate / k.serviceRate);
  const rho = rhos.reduce((s, r) => s + r, 0);
  if (rho >= 1) {
    throw unstableError({
      kendall: 'M/M/1 with priorities',
      arrivalRate: lambda,
      capacityRate: lambda / rho,
      utilisation: rho,
      detail:
        'Priority rules decide WHO waits, not how much total work the server can do: the total utilisation Σ λ_i/μ_i must be below 1 for any class to have a finite wait.',
    });
  }
  // Mean residual work R = Σ λ_i E[S_i²]/2; exponential service ⇒ E[S²] = 2/μ².
  const R = classes.reduce((s, k) => s + k.arrivalRate / (k.serviceRate * k.serviceRate), 0);
  const cumulative: number[] = [];
  let acc = 0;
  for (const r of rhos) {
    acc += r;
    cumulative.push(acc);
  }
  const results: PriorityClassResult[] = classes.map((k, i) => {
    const prior = i === 0 ? 0 : cumulative[i - 1];
    const Wq = R / ((1 - prior) * (1 - cumulative[i]));
    const W = Wq + 1 / k.serviceRate;
    return {
      label: k.label,
      arrivalRate: k.arrivalRate,
      serviceRate: k.serviceRate,
      utilisation: rhos[i],
      Wq,
      W,
      Lq: k.arrivalRate * Wq,
      L: k.arrivalRate * W,
    };
  });
  const Lq = results.reduce((s, r) => s + r.Lq, 0);
  const L = results.reduce((s, r) => s + r.L, 0);
  const Wq = Lq / lambda;
  const W = L / lambda;
  const metrics: QueueMetrics = {
    arrivalRate: lambda,
    effectiveArrivalRate: lambda,
    serviceRate: lambda / rho, // aggregate rate implied by the mixed service times
    meanServiceTime: rho / lambda,
    servers: 1,
    capacity: null,
    population: null,
    offeredLoad: rho,
    utilisation: rho,
    blockingProbability: null,
    throughput: lambda,
    L,
    Lq,
    W,
    Wq,
    probabilityOfWaiting: null,
    distribution: [],
    distributionTruncated: false,
    littlesLaw: checkLittlesLaw({ effectiveArrivalRate: lambda, L, W, Lq, Wq, usesEffectiveRate: false }),
  };
  assertMetricsFinite(metrics, 'M/M/1 priority');
  return {
    modelId: 'priority',
    modelName: priorityModel.name,
    kendall: 'M/M/1 with non-preemptive priorities',
    metrics,
    classes: results,
    explanation: buildExplanation({
      method: 'Cobham’s non-preemptive head-of-line priority formula at a single server',
      formula: 'Wq_k = R/((1 − σ_{k−1})(1 − σ_k)) with R = Σ λ_i/μ_i² and σ_k = Σ_{i≤k} ρ_i',
      steps: [
        { label: 'Total utilisation', expression: 'ρ = Σ λ_i/μ_i', value: rho.toPrecision(6) },
        { label: 'Mean residual work', expression: 'R = Σ λ_i·E[S_i²]/2', value: R.toPrecision(6) },
        ...results.map((r, i) => ({
          label: `Class ${i + 1} (${r.label}) mean wait`,
          expression: `R/((1−σ_${i})(1−σ_${i + 1}))`,
          value: r.Wq.toPrecision(6),
        })),
        {
          label: 'Conservation',
          expression: 'Σ λ_k Wq_k / λ',
          value: `${Wq.toPrecision(6)} — equals the FCFS wait when all classes share one service-time distribution`,
        },
      ],
      assumptions: priorityModel.assumptions,
      limitations: priorityModel.limitations,
      exactness: 'exact',
    }),
  };
}

export const priorityModel: QueueModelDef<PriorityConfig> = {
  id: 'priority',
  name: 'M/M/1 with non-preemptive priorities',
  description:
    'One server, several customer classes, and a strict priority order. A service in progress is never interrupted. Priority changes who waits, not the total amount of waiting: the weighted average wait is unchanged when all classes have the same service-time distribution.',
  kendall: 'M/M/1 priority',
  params: [
    {
      key: 'classes',
      label: 'Classes (highest priority first)',
      kind: 'count',
      description: 'Each class has its own arrival rate and service rate.',
    },
  ],
  assumptions: [
    'Each class arrives as an independent Poisson process with exponential service times at its own rate.',
    'Strict non-preemptive priority: a waiting high-priority customer goes ahead of all lower classes, but never interrupts a service already in progress.',
    'A single server, unlimited waiting room, work-conserving service.',
    STANDARD_ASSUMPTIONS.steadyState,
  ],
  limitations: [
    'Stability depends on the TOTAL utilisation Σ λ_i/μ_i, not on any one class.',
    'The lowest class is the most sensitive: its wait blows up first as the total load rises.',
    'Preemptive priority gives different (smaller for the top class) waits and is not computed here.',
    STANDARD_LIMITATIONS.meanOnly,
  ],
  validate: (cfg) => {
    const issues: Issue[] = [];
    if (!Array.isArray(cfg?.classes) || cfg.classes.length < 2) {
      issues.push({ code: 'required', field: 'classes', message: 'List at least two priority classes, highest priority first.' });
      return issues;
    }
    cfg.classes.forEach((k, i) => {
      if (!Number.isFinite(k?.arrivalRate) || k.arrivalRate <= 0) {
        issues.push({ code: 'range', field: `classes.${i}.arrivalRate`, message: `Class ${i + 1}: arrival rate must be greater than 0.` });
      }
      if (!Number.isFinite(k?.serviceRate) || k.serviceRate <= 0) {
        issues.push({ code: 'range', field: `classes.${i}.serviceRate`, message: `Class ${i + 1}: service rate must be greater than 0.` });
      }
    });
    return issues;
  },
  analyse: analysePriority,
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** A model definition whose configuration type is erased for registry use. */
export type AnyQueueModel = {
  id: string;
  name: string;
  description: string;
  kendall: string;
  params: QueueModelDef<never>['params'];
  assumptions: string[];
  limitations: string[];
  validate(config: unknown): Issue[];
  analyse(config: unknown): QueueAnalysis;
};

function erase<C>(def: QueueModelDef<C>): AnyQueueModel {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    kendall: def.kendall,
    params: def.params,
    assumptions: def.assumptions,
    limitations: def.limitations,
    validate: (config: unknown) => def.validate(config as C),
    analyse: (config: unknown) => def.analyse(config as C),
  };
}

export const QUEUE_MODELS: AnyQueueModel[] = [
  erase(mm1Model),
  erase(mmcModel),
  erase(mmcKModel),
  erase(mm1KModel),
  erase(mmccModel),
  erase(mmInfinityModel),
  erase(mg1Model),
  erase(md1Model),
  erase(ggcModel),
  erase(finitePopulationModel),
  erase(priorityModel),
];

const BY_ID = new Map(QUEUE_MODELS.map((m) => [m.id, m]));

export function getQueueModel(id: string): AnyQueueModel {
  const m = BY_ID.get(id);
  if (!m) {
    throw new EngineError(
      `Unknown queue model "${id}". Available models: ${QUEUE_MODELS.map((q) => q.id).join(', ')}.`,
      'unknown',
    );
  }
  return m;
}

export function hasQueueModel(id: string): boolean {
  return BY_ID.has(id);
}
