/**
 * What practitioners actually ask of queueing theory: how many servers do I
 * need, what does the last slice of utilisation cost me, and what staffing
 * minimises total cost?
 */
import { EngineError, type Issue } from '../core/result';
import { linspace } from '../core/numeric';
import { analyseMmc, analyseMmcc } from './models';
import { STANDARD_LIMITATIONS } from './support';
import type { QueueAnalysis } from './types';

export const MAX_PLANNING_SERVERS = 5000;

export type CapacityTarget =
  /** Mean wait before service at most `value`. */
  | { kind: 'meanWait'; value: number }
  /** P(wait > t) at most `value`. */
  | { kind: 'waitTail'; t: number; value: number }
  /** Blocking probability at most `value` (loss system). */
  | { kind: 'blocking'; value: number }
  /** Server utilisation at most `value`. */
  | { kind: 'utilisation'; value: number };

export interface CapacityPlanConfig {
  arrivalRate: number;
  serviceRate: number;
  target: CapacityTarget;
  /** 'queue' = M/M/c with waiting room (default); 'loss' = M/M/c/c. */
  system?: 'queue' | 'loss';
  maxServers?: number;
}

export interface CapacityPlan {
  /** Smallest number of servers meeting the target. */
  servers: number;
  /** The achieved value of the targeted metric at `servers`. */
  metric: number;
  target: CapacityTarget;
  /** The metric at one fewer server, which must fail the target. */
  previous: { servers: number; metric: number | null; reason: string } | null;
  analysis: QueueAnalysis;
  searchedUpTo: number;
  notes: string[];
}

function targetLabel(t: CapacityTarget): string {
  switch (t.kind) {
    case 'meanWait':
      return `mean wait Wq ≤ ${t.value}`;
    case 'waitTail':
      return `P(wait > ${t.t}) ≤ ${t.value}`;
    case 'blocking':
      return `blocking probability ≤ ${t.value}`;
    case 'utilisation':
      return `utilisation ρ ≤ ${t.value}`;
  }
}

function metricFor(target: CapacityTarget, analysis: QueueAnalysis): number {
  switch (target.kind) {
    case 'meanWait':
      return analysis.metrics.Wq;
    case 'waitTail': {
      const wait = analysis.queueWait;
      if (!wait) {
        throw new EngineError(
          'This system has no closed-form waiting-time distribution, so a P(wait > t) target cannot be evaluated for it.',
          'unsupported',
        );
      }
      return wait.tail(target.t);
    }
    case 'blocking': {
      const b = analysis.metrics.blockingProbability;
      if (b === null) {
        throw new EngineError(
          'A blocking target needs a system where arrivals can be turned away. Use system: "loss" (M/M/c/c) or a finite-capacity queue.',
          'unsupported',
        );
      }
      return b;
    }
    case 'utilisation':
      return analysis.metrics.utilisation;
  }
}

function validateTarget(target: CapacityTarget): void {
  const issues: Issue[] = [];
  if (!target || typeof target.kind !== 'string') {
    throw new EngineError([{ code: 'required', field: 'target', message: 'A capacity target is required.' }]);
  }
  if (!Number.isFinite(target.value) || target.value <= 0) {
    issues.push({ code: 'range', field: 'target.value', message: 'The target value must be a finite number greater than 0.' });
  }
  if ((target.kind === 'waitTail' || target.kind === 'blocking' || target.kind === 'utilisation') && target.value > 1) {
    issues.push({ code: 'range', field: 'target.value', message: 'A probability or utilisation target must be at most 1.' });
  }
  if (target.kind === 'waitTail' && (!Number.isFinite(target.t) || target.t < 0)) {
    issues.push({ code: 'range', field: 'target.t', message: 'The time t in a P(wait > t) target must be a finite number, 0 or greater.' });
  }
  if (issues.length) throw new EngineError(issues);
}

/**
 * Smallest number of servers meeting the target, found by searching upward.
 * The search starts at the smallest feasible c (for a queue, the smallest c
 * with ρ < 1) and the result records that c − 1 fails, which is what makes the
 * answer a minimum rather than merely sufficient.
 */
export function planCapacity(config: CapacityPlanConfig): CapacityPlan {
  if (!Number.isFinite(config?.arrivalRate) || config.arrivalRate <= 0) {
    throw new EngineError([{ code: 'range', field: 'arrivalRate', message: 'Arrival rate λ must be greater than 0.' }]);
  }
  if (!Number.isFinite(config?.serviceRate) || config.serviceRate <= 0) {
    throw new EngineError([{ code: 'range', field: 'serviceRate', message: 'Service rate μ must be greater than 0.' }]);
  }
  validateTarget(config.target);
  const system = config.system ?? 'queue';
  const maxServers = config.maxServers ?? MAX_PLANNING_SERVERS;
  if (!Number.isInteger(maxServers) || maxServers < 1 || maxServers > MAX_PLANNING_SERVERS) {
    throw new EngineError(
      [{ code: 'range', field: 'maxServers', message: `maxServers must be a whole number between 1 and ${MAX_PLANNING_SERVERS}.` }],
    );
  }
  if (system === 'loss' && config.target.kind !== 'blocking') {
    throw new EngineError(
      'A loss system (M/M/c/c) has no waiting room, so only a blocking target applies to it.',
      'unsupported',
    );
  }
  if (system === 'queue' && config.target.kind === 'blocking') {
    throw new EngineError(
      'A queue with unlimited waiting room never blocks anybody, so a blocking target cannot be met by adding servers. Use system: "loss".',
      'unsupported',
    );
  }
  const a = config.arrivalRate / config.serviceRate;
  const analyse = (c: number): QueueAnalysis =>
    system === 'loss'
      ? analyseMmcc({ arrivalRate: config.arrivalRate, serviceRate: config.serviceRate, servers: c })
      : analyseMmc({ arrivalRate: config.arrivalRate, serviceRate: config.serviceRate, servers: c });
  const minServers = system === 'loss' ? 1 : Math.floor(a) + 1;
  if (minServers > maxServers) {
    throw new EngineError(
      `The offered load is ${a.toPrecision(6)} erlangs, so at least ${minServers} servers are needed for a stable queue — more than the ${maxServers} allowed by maxServers.`,
      'unsatisfiable',
    );
  }
  let previousMetric: number | null = null;
  for (let c = minServers; c <= maxServers; c++) {
    const analysis = analyse(c);
    const metric = metricFor(config.target, analysis);
    if (metric <= config.target.value) {
      const notes = [
        `Searched upward from c = ${minServers}; c = ${c} is the smallest number of servers meeting ${targetLabel(config.target)}.`,
        STANDARD_LIMITATIONS.nearSaturation,
      ];
      if (system === 'queue') {
        notes.push(
          `A queue needs c > a = ${a.toPrecision(6)} erlangs to be stable at all, so c = ${minServers} is the first value worth testing.`,
        );
      }
      return {
        servers: c,
        metric,
        target: config.target,
        previous:
          c === minServers
            ? {
                servers: c - 1,
                metric: null,
                reason:
                  system === 'loss'
                    ? 'Zero servers serve nobody.'
                    : `With ${c - 1} server(s) the offered load (${a.toPrecision(6)} erlangs) is not below capacity, so the queue has no steady state at all.`,
              }
            : { servers: c - 1, metric: previousMetric, reason: `${targetLabel(config.target)} is not met at c = ${c - 1}.` },
        analysis,
        searchedUpTo: c,
        notes,
      };
    }
    previousMetric = metric;
  }
  throw new EngineError(
    [
      {
        code: 'unsatisfiable',
        field: 'target',
        message:
          `No number of servers up to ${maxServers} meets ${targetLabel(config.target)} at λ = ${config.arrivalRate}, μ = ${config.serviceRate}. ` +
          (previousMetric !== null ? `At ${maxServers} servers the metric is still ${previousMetric.toPrecision(6)}. ` : '') +
          'Adding servers cannot fix a target that service speed makes impossible — for example a mean wait target below zero-queue levels, or a wait-time target shorter than the service time itself. Reconsider the target, the service rate, or raise maxServers deliberately.',
      },
    ],
  );
}

// ---------------------------------------------------------------------------
// Sensitivity to utilisation
// ---------------------------------------------------------------------------

export interface UtilisationPoint {
  utilisation: number;
  arrivalRate: number;
  Wq: number;
  W: number;
  Lq: number;
  L: number;
  /** Wq relative to its value at the lowest utilisation on the curve. */
  waitRelativeToStart: number;
}

export interface UtilisationCurve {
  servers: number;
  serviceRate: number;
  points: UtilisationPoint[];
  /** What the last slice of utilisation costs in waiting time. */
  lastSlice: {
    fromUtilisation: number;
    toUtilisation: number;
    wqFrom: number;
    wqTo: number;
    /** How many times longer the wait becomes. */
    ratio: number;
    note: string;
  };
  assumptions: string[];
  limitations: string[];
  exactness: 'exact';
}

/**
 * How waiting time behaves as ρ → 1. Wq contains a factor 1/(1−ρ), so the
 * curve is a hyperbola: the wait is not "somewhat worse" at high utilisation,
 * it is unbounded. The `lastSlice` figure prices the final stretch of
 * utilisation, which is the single most useful piece of intuition in the field.
 */
export function utilisationCurve(config: {
  serviceRate: number;
  servers?: number;
  utilisations?: number[];
  fromUtilisation?: number;
  toUtilisation?: number;
}): UtilisationCurve {
  if (!Number.isFinite(config?.serviceRate) || config.serviceRate <= 0) {
    throw new EngineError([{ code: 'range', field: 'serviceRate', message: 'Service rate μ must be greater than 0.' }]);
  }
  const c = config.servers ?? 1;
  if (!Number.isInteger(c) || c < 1) {
    throw new EngineError([{ code: 'range', field: 'servers', message: 'Servers c must be a whole number, at least 1.' }]);
  }
  const rhos = config.utilisations ?? [...linspace(0.05, 0.9, 18), 0.92, 0.95, 0.97, 0.98, 0.99, 0.995];
  for (const rho of rhos) {
    if (!Number.isFinite(rho) || rho <= 0 || rho >= 1) {
      throw new EngineError(
        [
          {
            code: 'range',
            field: 'utilisations',
            message: `Every utilisation on the curve must lie strictly between 0 and 1; received ${rho}. At ρ = 1 the wait is infinite, not merely large, so there is no point to plot there.`,
          },
        ],
      );
    }
  }
  const sorted = [...rhos].sort((x, y) => x - y);
  const points: UtilisationPoint[] = sorted.map((rho) => {
    const lambda = rho * c * config.serviceRate;
    const m = analyseMmc({ arrivalRate: lambda, serviceRate: config.serviceRate, servers: c }).metrics;
    return { utilisation: rho, arrivalRate: lambda, Wq: m.Wq, W: m.W, Lq: m.Lq, L: m.L, waitRelativeToStart: 0 };
  });
  const base = points[0].Wq;
  for (const p of points) p.waitRelativeToStart = base > 0 ? p.Wq / base : NaN;
  const from = config.fromUtilisation ?? 0.9;
  const to = config.toUtilisation ?? 0.99;
  if (!(from > 0 && from < to && to < 1)) {
    throw new EngineError(
      'The utilisation slice needs 0 < fromUtilisation < toUtilisation < 1.',
      'range',
    );
  }
  const wqAt = (rho: number): number =>
    analyseMmc({ arrivalRate: rho * c * config.serviceRate, serviceRate: config.serviceRate, servers: c }).metrics.Wq;
  const wqFrom = wqAt(from);
  const wqTo = wqAt(to);
  return {
    servers: c,
    serviceRate: config.serviceRate,
    points,
    lastSlice: {
      fromUtilisation: from,
      toUtilisation: to,
      wqFrom,
      wqTo,
      ratio: wqTo / wqFrom,
      note:
        `Pushing utilisation from ${(from * 100).toFixed(1)}% to ${(to * 100).toFixed(1)}% multiplies the mean wait by ${(wqTo / wqFrom).toPrecision(4)}. ` +
        'The gain in throughput is a few per cent; the cost in waiting is a multiple. This is why high-utilisation targets are expensive, and why the wait cannot be "managed" at ρ = 1 — there is no finite value to manage.',
    },
    assumptions: [
      'Each point is an exact M/M/c steady state at that utilisation, with the service rate and server count held fixed and the arrival rate varied.',
      'Steady state at every point: a system that only briefly touches high utilisation does not reach these waits.',
    ],
    limitations: [
      STANDARD_LIMITATIONS.nearSaturation,
      'The curve is drawn for Poisson arrivals and exponential service. More variable processes are worse at every utilisation; more regular ones are better. The shape — a 1/(1−ρ) blow-up — is the same in all of them.',
    ],
    exactness: 'exact',
  };
}

// ---------------------------------------------------------------------------
// Economic optimisation
// ---------------------------------------------------------------------------

export interface CostConfig {
  arrivalRate: number;
  serviceRate: number;
  /** Cost of one server per unit time. */
  serverCost: number;
  /** Cost of one customer waiting, per unit time. */
  waitingCost: number;
  /** Charge waiting cost for customers in the system (default) or only those queueing. */
  basis?: 'inSystem' | 'inQueue';
  maxServers?: number;
}

export interface CostRow {
  servers: number;
  utilisation: number;
  serverCost: number;
  waitingCost: number;
  totalCost: number;
}

export interface CostOptimum {
  servers: number;
  totalCost: number;
  rows: CostRow[];
  basis: 'inSystem' | 'inQueue';
  assumptions: string[];
  limitations: string[];
  exactness: 'exact';
}

/**
 * Minimise server cost + waiting cost over the number of servers. Total cost
 * falls steeply while servers are scarce and rises linearly once waiting is
 * cheap, so the minimum is found by scanning upward and stopping once the
 * server cost alone exceeds the best total found — no further c can win.
 */
export function optimiseServerCount(config: CostConfig): CostOptimum {
  const issues: Issue[] = [];
  if (!Number.isFinite(config?.arrivalRate) || config.arrivalRate <= 0) {
    issues.push({ code: 'range', field: 'arrivalRate', message: 'Arrival rate λ must be greater than 0.' });
  }
  if (!Number.isFinite(config?.serviceRate) || config.serviceRate <= 0) {
    issues.push({ code: 'range', field: 'serviceRate', message: 'Service rate μ must be greater than 0.' });
  }
  if (!Number.isFinite(config?.serverCost) || config.serverCost < 0) {
    issues.push({ code: 'range', field: 'serverCost', message: 'Server cost per unit time must be a finite number, 0 or greater.' });
  }
  if (!Number.isFinite(config?.waitingCost) || config.waitingCost < 0) {
    issues.push({ code: 'range', field: 'waitingCost', message: 'Waiting cost per customer per unit time must be a finite number, 0 or greater.' });
  }
  if (issues.length) throw new EngineError(issues);
  if (config.serverCost === 0 && config.waitingCost === 0) {
    throw new EngineError(
      'Both cost rates are zero, so every staffing level costs the same and there is no optimum to report.',
      'unsatisfiable',
    );
  }
  const basis = config.basis ?? 'inSystem';
  const maxServers = config.maxServers ?? 1000;
  if (!Number.isInteger(maxServers) || maxServers < 1 || maxServers > MAX_PLANNING_SERVERS) {
    throw new EngineError([{ code: 'range', field: 'maxServers', message: `maxServers must be between 1 and ${MAX_PLANNING_SERVERS}.` }]);
  }
  const a = config.arrivalRate / config.serviceRate;
  const minServers = Math.floor(a) + 1;
  if (minServers > maxServers) {
    throw new EngineError(
      `At least ${minServers} servers are needed for a stable queue at ${a.toPrecision(6)} erlangs, which exceeds maxServers = ${maxServers}.`,
      'unsatisfiable',
    );
  }
  const rows: CostRow[] = [];
  let best: CostRow | null = null;
  for (let c = minServers; c <= maxServers; c++) {
    const serverCost = c * config.serverCost;
    if (best && serverCost >= best.totalCost) {
      // Waiting cost is non-negative, so no larger c can beat the best found.
      break;
    }
    const m = analyseMmc({ arrivalRate: config.arrivalRate, serviceRate: config.serviceRate, servers: c }).metrics;
    const queueing = basis === 'inSystem' ? m.L : m.Lq;
    const waitingCost = config.waitingCost * queueing;
    const row: CostRow = { servers: c, utilisation: m.utilisation, serverCost, waitingCost, totalCost: serverCost + waitingCost };
    rows.push(row);
    if (!best || row.totalCost < best.totalCost) best = row;
  }
  if (!best) {
    throw new EngineError('No stable staffing level could be evaluated within maxServers.', 'unsatisfiable');
  }
  const chosen: CostRow = best;
  // Make sure the neighbour above the optimum is present for comparison.
  if (chosen.servers + 1 <= maxServers && !rows.some((r) => r.servers === chosen.servers + 1)) {
    const c = chosen.servers + 1;
    const m = analyseMmc({ arrivalRate: config.arrivalRate, serviceRate: config.serviceRate, servers: c }).metrics;
    const queueing = basis === 'inSystem' ? m.L : m.Lq;
    rows.push({
      servers: c,
      utilisation: m.utilisation,
      serverCost: c * config.serverCost,
      waitingCost: config.waitingCost * queueing,
      totalCost: c * config.serverCost + config.waitingCost * queueing,
    });
  }
  return {
    servers: chosen.servers,
    totalCost: chosen.totalCost,
    rows,
    basis,
    assumptions: [
      'The underlying queue is M/M/c: Poisson arrivals, exponential service, one shared unlimited queue.',
      basis === 'inSystem'
        ? 'Waiting cost is charged per customer IN THE SYSTEM per unit time (time in service counts as cost).'
        : 'Waiting cost is charged per customer IN THE QUEUE per unit time (time in service is free).',
      'Server cost is linear in the number of servers, and both cost rates are constant over time.',
      'Only the number of servers is varied; the arrival rate and service rate are fixed.',
    ],
    limitations: [
      'The answer is only as good as the cost of waiting, which is usually the least certain input. Report the cost curve, not just the optimum: the total is often nearly flat across two or three staffing levels.',
      'Integer staffing only; shift patterns, part-time servers and time-varying demand are outside this model.',
      STANDARD_LIMITATIONS.nearSaturation,
    ],
    exactness: 'exact',
  };
}
