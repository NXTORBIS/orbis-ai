/**
 * Cross-cutting pieces every queue in this module shares: Little's law as a
 * first-class identity, the stability refusal, and the standard assumption and
 * limitation texts.
 */
import { EngineError, type Explanation, type Exactness, type ExplanationStep } from '../core/result';
import type { LittlesLawCheck, QueueMetrics } from './types';

export const LITTLE_TOLERANCE = 1e-9;

/**
 * Little's law, L = λW, as a separately callable identity. Supply exactly two
 * of the three quantities and the third is returned. The law holds for any
 * stable system regardless of distributions or service discipline, so it is
 * stated here independently of any model.
 */
export function littlesLaw(input: {
  arrivalRate?: number;
  numberInSystem?: number;
  timeInSystem?: number;
}): { arrivalRate: number; numberInSystem: number; timeInSystem: number; solvedFor: string } {
  const given = (['arrivalRate', 'numberInSystem', 'timeInSystem'] as const).filter(
    (k) => input[k] !== undefined && input[k] !== null,
  );
  for (const k of given) {
    const v = input[k] as number;
    if (!Number.isFinite(v) || v < 0) {
      throw new EngineError(`Little's law needs ${k} to be a finite number, 0 or greater.`, 'range');
    }
  }
  if (given.length !== 2) {
    throw new EngineError(
      "Little's law (L = λW) needs exactly two of the three quantities — arrival rate, number in system, time in system — to solve for the third.",
      'required',
    );
  }
  const lambda = input.arrivalRate;
  const L = input.numberInSystem;
  const W = input.timeInSystem;
  if (lambda !== undefined && W !== undefined) {
    return { arrivalRate: lambda, timeInSystem: W, numberInSystem: lambda * W, solvedFor: 'numberInSystem' };
  }
  if (lambda !== undefined && L !== undefined) {
    if (lambda === 0) {
      throw new EngineError(
        "Little's law cannot give the time in system when the arrival rate is 0: no customers arrive, so there is no average time to report.",
        'range',
      );
    }
    return { arrivalRate: lambda, numberInSystem: L, timeInSystem: L / lambda, solvedFor: 'timeInSystem' };
  }
  const l = L as number;
  const w = W as number;
  if (w === 0) {
    throw new EngineError(
      "Little's law cannot give the arrival rate when the time in system is 0.",
      'range',
    );
  }
  return { arrivalRate: l / w, numberInSystem: l, timeInSystem: w, solvedFor: 'arrivalRate' };
}

/**
 * Build the internal consistency check reported with every model's result.
 * `effectiveArrivalRate` must be the rate of customers actually admitted:
 * using the offered rate for a finite-capacity or finite-population queue is a
 * classic error and would make the check pass on a wrong number.
 */
export function checkLittlesLaw(args: {
  effectiveArrivalRate: number;
  L: number;
  W: number;
  Lq: number;
  Wq: number;
  usesEffectiveRate: boolean;
}): LittlesLawCheck {
  const { effectiveArrivalRate: lam, L, W, Lq, Wq } = args;
  const lambdaW = lam * W;
  const lambdaWq = lam * Wq;
  const scale = Math.max(1, Math.abs(L), Math.abs(Lq));
  const systemResidual = Math.abs(L - lambdaW);
  const queueResidual = Math.abs(Lq - lambdaWq);
  const tolerance = LITTLE_TOLERANCE * scale;
  return {
    arrivalRate: lam,
    L,
    lambdaW,
    systemResidual,
    Lq,
    lambdaWq,
    queueResidual,
    tolerance,
    holds: systemResidual <= tolerance && queueResidual <= tolerance,
    note: args.usesEffectiveRate
      ? 'Little’s law is applied with the effective arrival rate (arrivals actually admitted), because blocked or absent arrivals never enter the system.'
      : 'Little’s law is applied with the offered arrival rate, which equals the admitted rate because nothing is blocked.',
  };
}

/** The refusal for an infinite-capacity queue that has no steady state. */
export function unstableError(args: {
  kendall: string;
  arrivalRate: number;
  capacityRate: number;
  utilisation: number;
  detail?: string;
}): EngineError {
  const { kendall, arrivalRate, capacityRate, utilisation } = args;
  return new EngineError(
    [
      {
        code: 'unstable',
        field: 'arrivalRate',
        message:
          `${kendall} has no steady state at these settings: the arrival rate (${arrivalRate}) is not below the total service capacity (${capacityRate}), ` +
          `so the utilisation is ρ = ${utilisation.toPrecision(6)} ≥ 1. The queue grows without bound — the mean queue length and waiting time are infinite, not large. ` +
          (args.detail ? `${args.detail} ` : '') +
          'Reduce the arrival rate, speed up service, add servers, or model a finite waiting room (M/M/c/K), which is always stable because excess arrivals are turned away.',
      },
    ],
  );
}

export const STANDARD_ASSUMPTIONS = {
  poissonArrivals:
    'Arrivals follow a Poisson process: inter-arrival times are independent and exponential, and arrivals are not scheduled, batched or correlated.',
  exponentialService:
    'Service times are independent and exponentially distributed with the stated mean (memoryless: time already spent in service says nothing about time remaining).',
  generalService:
    'Service times are independent and identically distributed with the stated mean and variance; no other feature of their shape is used.',
  fcfs: 'Service is first-come first-served; the order does not affect the mean number in system, but it does affect the spread of individual waits.',
  infiniteQueue: 'The waiting room is unlimited: no arrival is ever turned away or balks, and nobody abandons the queue while waiting.',
  steadyState:
    'The results are long-run steady-state averages. A system that is opened, closed, or driven by a time-of-day arrival pattern never reaches them.',
  independentServers: 'Servers are identical, independent, and always available — no breaks, failures or slow-down under load.',
  homogeneousPopulation: 'All customers are statistically identical and arrive independently of the state of the system.',
};

export const STANDARD_LIMITATIONS = {
  realArrivals:
    'Real arrival streams are rarely Poisson: appointment systems are more regular (which shortens queues) and bursty traffic is more variable (which lengthens them).',
  noAbandonment:
    'Abandonment (customers giving up) is not modelled. Where it happens, these formulas overstate waiting times and queue lengths.',
  meanOnly: 'Means describe the long run; individual waits are far more variable than the average suggests.',
  nearSaturation:
    'Close to ρ = 1 the results are extremely sensitive to the inputs: a 1% error in the arrival rate can change the predicted wait by tens of percent.',
};

export interface ExplanationInput {
  method: string;
  formula?: string;
  steps: ExplanationStep[];
  assumptions: string[];
  limitations: string[];
  exactness: Exactness;
}

export function buildExplanation(input: ExplanationInput): Explanation {
  return {
    method: input.method,
    formula: input.formula,
    steps: input.steps,
    assumptions: input.assumptions,
    limitations: input.limitations,
    exactness: input.exactness,
  };
}

/** Mean number in system / queue from a finite state distribution. */
export function momentsFromDistribution(p: number[], servers: number): { L: number; Lq: number; Ls: number } {
  let L = 0;
  let Lq = 0;
  let Ls = 0;
  for (let n = 0; n < p.length; n++) {
    L += n * p[n];
    if (n > servers) Lq += (n - servers) * p[n];
    Ls += Math.min(n, servers) * p[n];
  }
  return { L, Lq, Ls };
}

/** Guard every rate/count that reaches a formula; throws with named fields. */
export function requireFinitePositive(value: number, field: string, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new EngineError([{ code: 'finite', field, message: `${label} must be a finite number.` }]);
  }
  if (value <= 0) {
    throw new EngineError([{ code: 'range', field, message: `${label} must be greater than 0.` }]);
  }
}

export function assertMetricsFinite(m: QueueMetrics, kendall: string): void {
  const entries: [string, number][] = [
    ['L', m.L],
    ['Lq', m.Lq],
    ['W', m.W],
    ['Wq', m.Wq],
    ['utilisation', m.utilisation],
    ['throughput', m.throughput],
  ];
  for (const [name, v] of entries) {
    if (!Number.isFinite(v)) {
      throw new EngineError(
        `${kendall}: ${name} could not be computed as a finite number from these inputs. No substitute value is reported.`,
        'numerical',
      );
    }
  }
}
