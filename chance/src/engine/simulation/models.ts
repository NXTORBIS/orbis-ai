/**
 * Built-in simulation models. Each one validates its own configuration and
 * declares the exact ("theoretical") value of its outputs where a closed form
 * exists, so simulated estimates can be compared with the truth.
 */
import type { Issue } from '../core/result';
import { getDistribution, hasDistribution, validateParams } from '../distributions/registry';
import type { Params } from '../distributions/types';
import type { SimulationModelDef, PreparedModel } from './types';
import { matPow } from '../stats/linalg';

/** Monte Carlo estimation of π by sampling points in the unit square. */
export interface PiConfig {
  /** 'quarter-circle' uses the unit square; 'buffon' uses Buffon's needle. */
  method: 'quarter-circle';
}

export const piModel: SimulationModelDef<PiConfig> = {
  id: 'pi-estimation',
  name: 'Estimating π by random sampling',
  description:
    'Points are drawn uniformly from the unit square. The proportion landing inside the quarter circle of radius 1 estimates π/4, because the quarter circle has area π/4 and the square has area 1.',
  validate: () => [],
  prepare: (): PreparedModel => ({
    outputs: [
      { key: 'inside', label: 'Point lands inside the quarter circle', kind: 'indicator' },
      { key: 'piEstimate', label: 'Running estimate of π (4 × indicator)', kind: 'continuous' },
    ],
    theoretical: {
      inside: { probability: Math.PI / 4, mean: Math.PI / 4, source: 'Area of the quarter circle ÷ area of the square = π/4' },
      piEstimate: { mean: Math.PI, source: 'Four times the probability above equals π' },
    },
    assumptions: ['Points are drawn from a uniform distribution over the unit square using a pseudorandom generator.'],
    procedure: 'Each trial draws x and y uniformly from [0, 1) and records whether x² + y² ≤ 1.',
    runTrial(rng, out) {
      const x = rng.uniform();
      const y = rng.uniform();
      const inside = x * x + y * y <= 1 ? 1 : 0;
      out[0] = inside;
      out[1] = 4 * inside;
    },
  }),
};

/** Sum of several dice / dice-like discrete uniform variables. */
export interface DiceSumConfig {
  diceCount: number;
  faces: number;
  /** Threshold for the "at least" indicator output. */
  threshold: number;
}

export const diceSumModel: SimulationModelDef<DiceSumConfig> = {
  id: 'dice-sum',
  name: 'Sum of dice',
  description: 'Rolls several fair dice and records their total, comparing the simulated distribution with the exact one.',
  validate: (c) => {
    const issues: Issue[] = [];
    if (!Number.isInteger(c?.diceCount) || c.diceCount < 1 || c.diceCount > 200) {
      issues.push({ code: 'range', field: 'diceCount', message: 'Number of dice must be a whole number between 1 and 200.' });
    }
    if (!Number.isInteger(c?.faces) || c.faces < 2 || c.faces > 1000) {
      issues.push({ code: 'range', field: 'faces', message: 'Number of faces must be a whole number between 2 and 1000.' });
    }
    if (!Number.isFinite(c?.threshold)) {
      issues.push({ code: 'finite', field: 'threshold', message: 'Threshold must be a number.' });
    }
    return issues;
  },
  prepare: (c): PreparedModel => {
    const n = c.diceCount;
    const f = c.faces;
    const mean = (n * (f + 1)) / 2;
    const variance = (n * (f * f - 1)) / 12;
    return {
      outputs: [
        { key: 'total', label: `Total of ${n} d${f}`, kind: 'discrete' },
        { key: 'atLeast', label: `Total ≥ ${c.threshold}`, kind: 'indicator' },
      ],
      theoretical: {
        total: { mean, variance, source: `n(f+1)/2 = ${mean} and n(f²−1)/12 = ${variance} for ${n} fair ${f}-sided dice` },
      },
      assumptions: [`Each die is fair: every one of the ${f} faces has probability 1/${f}.`, 'Dice are rolled independently.'],
      procedure: `Each trial rolls ${n} independent fair ${f}-sided dice and records the total.`,
      runTrial(rng, out) {
        let s = 0;
        for (let i = 0; i < n; i++) s += rng.int(1, f);
        out[0] = s;
        out[1] = s >= c.threshold ? 1 : 0;
      },
    };
  },
};

/** Project schedule: tasks in sequence and/or parallel with uncertain durations. */
export interface ProjectTask {
  id: string;
  name: string;
  distributionId: string;
  params: Params;
  /** Task ids that must finish before this one starts. */
  dependsOn: string[];
}

export interface ProjectConfig {
  tasks: ProjectTask[];
  /** Deadline used for the "finished on time" indicator. */
  deadline: number;
  unit: string;
}

export const projectModel: SimulationModelDef<ProjectConfig> = {
  id: 'project-schedule',
  name: 'Project completion time',
  description:
    'Each task has an uncertain duration. Tasks start when all of their dependencies have finished, so the project finish time is the longest path through the network for that trial.',
  validate: (c) => {
    const issues: Issue[] = [];
    if (!Array.isArray(c?.tasks) || c.tasks.length === 0) {
      return [{ code: 'required', field: 'tasks', message: 'Add at least one task.' }];
    }
    if (c.tasks.length > 300) issues.push({ code: 'limit', field: 'tasks', message: 'At most 300 tasks are supported.' });
    const ids = new Set(c.tasks.map((t) => t.id));
    for (const t of c.tasks) {
      if (!hasDistribution(t.distributionId)) {
        issues.push({ code: 'unknown', field: `task:${t.id}`, message: `${t.name}: choose a duration distribution.` });
        continue;
      }
      const def = getDistribution(t.distributionId);
      issues.push(...validateParams(def, t.params).map((i) => ({ ...i, field: `task:${t.id}`, message: `${t.name}: ${i.message}` })));
      const support = def.support(t.params);
      if (support.min < 0) {
        issues.push({
          code: 'unsupported',
          field: `task:${t.id}`,
          message: `${t.name}: the chosen distribution allows negative durations. Pick a distribution supported on non-negative values, or set bounds that exclude negatives.`,
        });
      }
      for (const d of t.dependsOn ?? []) {
        if (!ids.has(d)) issues.push({ code: 'unknown', field: `task:${t.id}`, message: `${t.name}: unknown dependency "${d}".` });
      }
    }
    if (!Number.isFinite(c.deadline) || c.deadline <= 0) {
      issues.push({ code: 'range', field: 'deadline', message: 'Deadline must be a positive number.' });
    }
    // Cycle detection
    const state = new Map<string, 0 | 1 | 2>();
    const byId = new Map(c.tasks.map((t) => [t.id, t]));
    const visit = (id: string, path: string[]): boolean => {
      const s = state.get(id) ?? 0;
      if (s === 2) return true;
      if (s === 1) {
        issues.push({ code: 'cycle', field: 'tasks', message: `Tasks form a circular dependency: ${[...path.slice(path.indexOf(id)), id].join(' → ')}.` });
        return false;
      }
      state.set(id, 1);
      for (const d of byId.get(id)?.dependsOn ?? []) if (byId.has(d) && !visit(d, [...path, id])) return false;
      state.set(id, 2);
      return true;
    };
    for (const t of c.tasks) if (!visit(t.id, [])) break;
    return issues;
  },
  prepare: (c): PreparedModel => {
    // Topological order of tasks.
    const byId = new Map(c.tasks.map((t) => [t.id, t]));
    const order: string[] = [];
    const seen = new Set<string>();
    const visit = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      for (const d of byId.get(id)?.dependsOn ?? []) if (byId.has(d)) visit(d);
      order.push(id);
    };
    c.tasks.forEach((t) => visit(t.id));
    const slot = new Map(c.tasks.map((t, i) => [t.id, i]));
    const plan = order.map((id) => {
      const t = byId.get(id)!;
      return { i: slot.get(id)!, def: getDistribution(t.distributionId), params: t.params, deps: (t.dependsOn ?? []).map((d) => slot.get(d)!) };
    });
    const finish = new Float64Array(c.tasks.length);
    return {
      outputs: [
        { key: 'completion', label: `Project completion time (${c.unit})`, kind: 'continuous', unit: c.unit },
        { key: 'onTime', label: `Finished by the deadline of ${c.deadline} ${c.unit}`, kind: 'indicator' },
        { key: 'overrun', label: `Days past the deadline (0 if on time)`, kind: 'continuous', unit: c.unit },
      ],
      assumptions: [
        'Task durations are drawn independently unless the model says otherwise. Shared causes of delay (one team working on several tasks, a common supplier) would make real durations correlated and the finish time more variable than this model shows.',
        'A task starts the moment all of its dependencies finish; no resource limits, queueing or rework are modelled.',
      ],
      procedure: `Each trial draws a duration for each of the ${c.tasks.length} task(s) and propagates finish times through the dependency network. The project completion time is the largest finish time.`,
      runTrial(rng, out) {
        let maxFinish = 0;
        for (const p of plan) {
          let start = 0;
          for (const d of p.deps) if (finish[d] > start) start = finish[d];
          const dur = p.def.sample(rng, p.params);
          finish[p.i] = start + dur;
          if (finish[p.i] > maxFinish) maxFinish = finish[p.i];
        }
        out[0] = maxFinish;
        out[1] = maxFinish <= c.deadline ? 1 : 0;
        out[2] = Math.max(0, maxFinish - c.deadline);
      },
    };
  },
};

/** M/M/1-style single-server queue simulated by discrete events. */
export interface QueueConfig {
  arrivalRate: number;
  serviceRate: number;
  customers: number;
}

export const queueModel: SimulationModelDef<QueueConfig> = {
  id: 'queue',
  name: 'Single-server queue',
  description:
    'Customers arrive at random (exponential gaps) and are served one at a time with exponential service times — the classic M/M/1 queue. Records waiting times and queue length.',
  validate: (c) => {
    const issues: Issue[] = [];
    if (!(c?.arrivalRate > 0) || !Number.isFinite(c.arrivalRate)) {
      issues.push({ code: 'range', field: 'arrivalRate', message: 'Arrival rate must be greater than 0.' });
    }
    if (!(c?.serviceRate > 0) || !Number.isFinite(c.serviceRate)) {
      issues.push({ code: 'range', field: 'serviceRate', message: 'Service rate must be greater than 0.' });
    }
    if (!Number.isInteger(c?.customers) || c.customers < 1 || c.customers > 20000) {
      issues.push({ code: 'range', field: 'customers', message: 'Customers per trial must be a whole number between 1 and 20,000.' });
    }
    return issues;
  },
  prepare: (c): PreparedModel => {
    const rho = c.arrivalRate / c.serviceRate;
    const stable = rho < 1;
    // Steady-state M/M/1 results, valid only when ρ < 1.
    const theoretical: PreparedModel['theoretical'] = stable
      ? {
          meanWait: {
            mean: rho / (c.serviceRate - c.arrivalRate),
            source: `M/M/1 steady state: W_q = ρ / (μ − λ) with ρ = ${rho.toPrecision(4)}`,
          },
        }
      : undefined;
    const assumptions = [
      'Arrivals follow a Poisson process (exponential gaps between arrivals) and service times are exponential — both memoryless.',
      'One server, unlimited waiting room, first-come first-served.',
    ];
    if (!stable) {
      assumptions.push(
        `The arrival rate (${c.arrivalRate}) is not below the service rate (${c.serviceRate}), so the queue grows without limit. There is no steady state, and the averages below depend on how many customers are simulated rather than converging to a fixed value.`,
      );
    } else {
      assumptions.push(
        `Each trial simulates ${c.customers} customers starting from an empty system, so the averages include an initial warm-up period and are slightly below the long-run steady-state values.`,
      );
    }
    return {
      outputs: [
        { key: 'meanWait', label: 'Average wait before service (per trial)', kind: 'continuous', unit: 'time' },
        { key: 'maxWait', label: 'Longest wait in the trial', kind: 'continuous', unit: 'time' },
        { key: 'anyWaitOverFive', label: 'Some customer waited longer than 5 time units', kind: 'indicator' },
      ],
      theoretical,
      assumptions,
      procedure: `Each trial simulates ${c.customers} arrivals through a single server using exponential inter-arrival and service times.`,
      runTrial(rng, out) {
        let clock = 0;
        let serverFree = 0;
        let totalWait = 0;
        let maxWait = 0;
        for (let i = 0; i < c.customers; i++) {
          clock += rng.exponential(c.arrivalRate);
          const start = Math.max(clock, serverFree);
          const wait = start - clock;
          totalWait += wait;
          if (wait > maxWait) maxWait = wait;
          serverFree = start + rng.exponential(c.serviceRate);
        }
        out[0] = totalWait / c.customers;
        out[1] = maxWait;
        out[2] = maxWait > 5 ? 1 : 0;
      },
    };
  },
};

/** Markov chain path simulation. */
export interface MarkovConfig {
  states: string[];
  /** Row-stochastic transition matrix. */
  matrix: number[][];
  initialState: number;
  steps: number;
  /** Index of the state whose first-passage time is recorded, or -1. */
  targetState: number;
}

export function validateTransitionMatrix(states: string[], matrix: number[][]): Issue[] {
  const issues: Issue[] = [];
  const n = states?.length ?? 0;
  if (n < 2) return [{ code: 'required', field: 'states', message: 'Define at least two states.' }];
  if (n > 200) return [{ code: 'limit', field: 'states', message: 'At most 200 states are supported.' }];
  if (!Array.isArray(matrix) || matrix.length !== n) {
    return [{ code: 'shape', field: 'matrix', message: `The transition matrix must have one row per state (${n} rows).` }];
  }
  for (let i = 0; i < n; i++) {
    const row = matrix[i];
    if (!Array.isArray(row) || row.length !== n) {
      issues.push({ code: 'shape', field: `matrix:${i}`, message: `Row ${i + 1} must have ${n} entries.` });
      continue;
    }
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const v = row[j];
      if (!Number.isFinite(v) || v < 0 || v > 1) {
        issues.push({ code: 'range', field: `matrix:${i}:${j}`, message: `Row ${i + 1}, column ${j + 1}: probability must be between 0 and 1.` });
      } else sum += v;
    }
    if (Math.abs(sum - 1) > 1e-9) {
      issues.push({
        code: 'sum',
        field: `matrix:${i}`,
        message: `Row ${i + 1} (${states[i]}) sums to ${sum.toPrecision(6)}, not 1. Each row must give the probabilities of every destination from that state.`,
      });
    }
  }
  return issues;
}

export const markovModel: SimulationModelDef<MarkovConfig> = {
  id: 'markov-chain',
  name: 'Markov chain path',
  description:
    'Simulates a path through a finite set of states where the next state depends only on the current one (the Markov property). Records the state after n steps, time spent in each state, and the first time the target state is reached.',
  validate: (c) => {
    const issues = validateTransitionMatrix(c?.states ?? [], c?.matrix ?? []);
    if (!Number.isInteger(c?.steps) || c.steps < 1 || c.steps > 1_000_000) {
      issues.push({ code: 'range', field: 'steps', message: 'Steps per trial must be a whole number between 1 and 1,000,000.' });
    }
    const n = c?.states?.length ?? 0;
    if (!Number.isInteger(c?.initialState) || c.initialState < 0 || c.initialState >= n) {
      issues.push({ code: 'range', field: 'initialState', message: 'Choose a valid starting state.' });
    }
    if (c?.targetState !== -1 && (!Number.isInteger(c?.targetState) || c.targetState < -1 || c.targetState >= n)) {
      issues.push({ code: 'range', field: 'targetState', message: 'Choose a valid target state, or none.' });
    }
    return issues;
  },
  prepare: (c): PreparedModel => {
    const n = c.states.length;
    // Cumulative rows for O(log n) sampling.
    const cum = c.matrix.map((row) => {
      const out = new Float64Array(n);
      let acc = 0;
      for (let j = 0; j < n; j++) {
        acc += row[j];
        out[j] = acc;
      }
      out[n - 1] = 1;
      return out;
    });
    const outputs: PreparedModel['outputs'] = [
      { key: 'finalState', label: `State after ${c.steps} step(s)`, kind: 'discrete' },
    ];
    for (let i = 0; i < n; i++) {
      outputs.push({ key: `fraction:${i}`, label: `Fraction of steps in ${c.states[i]}`, kind: 'continuous' });
    }
    if (c.targetState >= 0) {
      outputs.push({ key: 'reachedTarget', label: `Reached ${c.states[c.targetState]} within ${c.steps} step(s)`, kind: 'indicator' });
      outputs.push({ key: 'firstPassage', label: `Steps until first reaching ${c.states[c.targetState]} (blank if never)`, kind: 'continuous' });
    }
    const counts = new Float64Array(n);
    // Exact n-step distribution for comparison, by repeated squaring so that
    // any step count is reachable in O(log steps) multiplications.
    //
    // This previously stepped the distribution forward one multiplication at a
    // time, capped at 100,000 iterations — while the tool's own input allows a
    // million steps. Past the cap the label still read "Exact N-step
    // distribution", so for an alternating chain at 100,001 steps the
    // interface reported the chain was certainly in state A when it is
    // certainly in state B, and drew that wrong value as the exact reference
    // line against the simulation. The user would conclude the simulation was
    // broken. A mislabelled number is worse than a missing one.
    const nStep = matPow(c.matrix, c.steps);
    const dist = nStep[c.initialState];
    const theoretical: PreparedModel['theoretical'] = {
      finalState: {
        mean: dist.reduce((acc, p, i) => acc + p * i, 0),
        source: `Exact ${c.steps}-step distribution computed from the transition matrix by repeated squaring (state indices weighted by probability)`,
      },
    };
    return {
      outputs,
      theoretical,
      assumptions: [
        'The Markov property: the probability of the next state depends only on the current state, not on the earlier history.',
        'Transition probabilities are constant over time (a time-homogeneous chain).',
      ],
      procedure: `Each trial starts in ${c.states[c.initialState]} and takes ${c.steps} step(s), choosing the next state from the current row of the transition matrix.`,
      runTrial(rng, out) {
        counts.fill(0);
        let state = c.initialState;
        let firstPassage = -1;
        if (state === c.targetState) firstPassage = 0;
        for (let s = 0; s < c.steps; s++) {
          state = rng.categorical(cum[state]);
          counts[state]++;
          if (firstPassage < 0 && state === c.targetState) firstPassage = s + 1;
        }
        out[0] = state;
        for (let i = 0; i < n; i++) out[1 + i] = counts[i] / c.steps;
        if (c.targetState >= 0) {
          out[1 + n] = firstPassage >= 0 ? 1 : 0;
          out[2 + n] = firstPassage >= 0 ? firstPassage : NaN;
        }
      },
    };
  },
};

/** Aggregate risk: frequency × severity (a compound/collective risk model). */
export interface RiskAggregateConfig {
  /** Distribution for the number of events in the period. */
  frequency: { distributionId: string; params: Params };
  /** Distribution for the loss of a single event. */
  severity: { distributionId: string; params: Params };
  /** Threshold used for the exceedance probability output. */
  threshold: number;
  unit: string;
  /** Optional cap applied to each individual loss (e.g. insurance limit). */
  perEventCap?: number;
}

export const riskAggregateModel: SimulationModelDef<RiskAggregateConfig> = {
  id: 'risk-aggregate',
  name: 'Aggregate loss (frequency × severity)',
  description:
    'A compound model: the number of events in a period is random, and each event causes a random loss. Total loss is the sum. This is the standard collective risk model.',
  validate: (c) => {
    const issues: Issue[] = [];
    for (const [name, part] of [['frequency', c?.frequency], ['severity', c?.severity]] as const) {
      if (!part || !hasDistribution(part.distributionId)) {
        issues.push({ code: 'unknown', field: name, message: `Choose a ${name} distribution.` });
        continue;
      }
      const def = getDistribution(part.distributionId);
      issues.push(...validateParams(def, part.params).map((i) => ({ ...i, field: name, message: `${name === 'frequency' ? 'Event count' : 'Loss per event'}: ${i.message}` })));
      if (name === 'frequency' && def.kind !== 'discrete') {
        issues.push({ code: 'unsupported', field: 'frequency', message: 'The number of events must come from a discrete distribution (for example Poisson or binomial).' });
      }
      if (name === 'severity' && def.support(part.params).min < 0) {
        issues.push({ code: 'unsupported', field: 'severity', message: 'The loss distribution must not allow negative losses. Choose a distribution supported on non-negative values.' });
      }
    }
    if (!Number.isFinite(c?.threshold)) issues.push({ code: 'finite', field: 'threshold', message: 'Threshold must be a number.' });
    if (c?.perEventCap !== undefined && !(c.perEventCap > 0)) {
      issues.push({ code: 'range', field: 'perEventCap', message: 'Per-event cap must be greater than 0 when supplied.' });
    }
    return issues;
  },
  prepare: (c): PreparedModel => {
    const freq = getDistribution(c.frequency.distributionId);
    const sev = getDistribution(c.severity.distributionId);
    const fMean = freq.mean(c.frequency.params);
    const sMean = sev.mean(c.severity.params);
    const fVar = freq.variance(c.frequency.params);
    const sVar = sev.variance(c.severity.params);
    const capped = c.perEventCap !== undefined;
    const theoretical: PreparedModel['theoretical'] = {};
    if (!capped && fMean.defined && sMean.defined) {
      theoretical.total = {
        mean: fMean.value * sMean.value,
        // Compound variance: E[N]·Var(S) + Var(N)·E[S]²
        variance: fVar.defined && sVar.defined && Number.isFinite(sVar.value) ? fMean.value * sVar.value + fVar.value * sMean.value ** 2 : undefined,
        source: 'Compound model: E[total] = E[N]·E[S]; Var(total) = E[N]·Var(S) + Var(N)·E[S]²',
      };
    }
    const MAX_EVENTS = 2_000_000;
    return {
      outputs: [
        { key: 'total', label: `Total loss (${c.unit})`, kind: 'continuous', unit: c.unit },
        { key: 'count', label: 'Number of events', kind: 'discrete' },
        { key: 'largest', label: `Largest single loss (${c.unit})`, kind: 'continuous', unit: c.unit },
        { key: 'exceeds', label: `Total loss exceeds ${c.threshold} ${c.unit}`, kind: 'indicator' },
      ],
      theoretical,
      assumptions: [
        'The number of events and the size of each loss are independent, and individual losses are independent of one another.',
        'The frequency and severity distributions are modelling choices supplied by you; the results inherit any error in those choices.',
        ...(capped ? [`Each individual loss is capped at ${c.perEventCap} ${c.unit}.`] : []),
      ],
      procedure: `Each trial draws the number of events from the ${freq.name} distribution, then one loss per event from the ${sev.name} distribution, and sums them.`,
      runTrial(rng, out) {
        const n = freq.sample(rng, c.frequency.params);
        if (!Number.isFinite(n) || n > MAX_EVENTS) {
          out[0] = NaN;
          out[1] = n;
          out[2] = NaN;
          out[3] = NaN;
          return;
        }
        let total = 0;
        let largest = 0;
        for (let i = 0; i < n; i++) {
          let loss = sev.sample(rng, c.severity.params);
          if (capped && loss > c.perEventCap!) loss = c.perEventCap!;
          total += loss;
          if (loss > largest) largest = loss;
        }
        out[0] = total;
        out[1] = n;
        out[2] = n > 0 ? largest : 0;
        out[3] = total > c.threshold ? 1 : 0;
      },
    };
  },
};

/** Sampling distribution of a statistic — illustrates the central limit theorem. */
export interface SamplingConfig {
  distributionId: string;
  params: Params;
  sampleSize: number;
  statistic: 'mean' | 'median' | 'max' | 'sd';
}

export const samplingModel: SimulationModelDef<SamplingConfig> = {
  id: 'sampling-distribution',
  name: 'Sampling variation',
  description:
    'Draws a fresh sample of size n from a chosen distribution in every trial and records a statistic of that sample, showing how much the statistic varies from sample to sample.',
  validate: (c) => {
    const issues: Issue[] = [];
    if (!hasDistribution(c?.distributionId)) {
      return [{ code: 'unknown', field: 'distributionId', message: 'Choose a distribution to sample from.' }];
    }
    issues.push(...validateParams(getDistribution(c.distributionId), c.params));
    if (!Number.isInteger(c?.sampleSize) || c.sampleSize < 1 || c.sampleSize > 100000) {
      issues.push({ code: 'range', field: 'sampleSize', message: 'Sample size must be a whole number between 1 and 100,000.' });
    }
    if (!['mean', 'median', 'max', 'sd'].includes(c?.statistic)) {
      issues.push({ code: 'unknown', field: 'statistic', message: 'Choose a statistic.' });
    }
    return issues;
  },
  prepare: (c): PreparedModel => {
    const def = getDistribution(c.distributionId);
    const n = c.sampleSize;
    const buf = new Float64Array(n);
    const dMean = def.mean(c.params);
    const dVar = def.variance(c.params);
    const theoretical: PreparedModel['theoretical'] = {};
    if (c.statistic === 'mean' && dMean.defined && dVar.defined && Number.isFinite(dVar.value)) {
      theoretical.statistic = {
        mean: dMean.value,
        variance: dVar.value / n,
        source: `The sample mean is unbiased: E[X̄] = μ = ${dMean.value.toPrecision(6)}, and Var(X̄) = σ²/n = ${(dVar.value / n).toPrecision(6)}`,
      };
    }
    const assumptions = [`Every trial draws ${n} independent values from the ${def.name} distribution.`];
    if (!dMean.defined) {
      assumptions.push(`The ${def.name} distribution has no mean, so the sample mean does not converge as n grows — the law of large numbers does not apply here.`);
    }
    return {
      outputs: [
        { key: 'statistic', label: `Sample ${c.statistic === 'sd' ? 'standard deviation' : c.statistic} (n = ${n})`, kind: 'continuous' },
      ],
      theoretical,
      assumptions,
      procedure: `Each trial draws ${n} independent values and records the sample ${c.statistic}.`,
      runTrial(rng, out) {
        for (let i = 0; i < n; i++) buf[i] = def.sample(rng, c.params);
        switch (c.statistic) {
          case 'mean': {
            let s = 0;
            for (let i = 0; i < n; i++) s += buf[i];
            out[0] = s / n;
            break;
          }
          case 'max': {
            let m = -Infinity;
            for (let i = 0; i < n; i++) if (buf[i] > m) m = buf[i];
            out[0] = m;
            break;
          }
          case 'median': {
            const copy = buf.slice();
            copy.sort();
            out[0] = n % 2 ? copy[(n - 1) / 2] : (copy[n / 2 - 1] + copy[n / 2]) / 2;
            break;
          }
          case 'sd': {
            let s = 0;
            for (let i = 0; i < n; i++) s += buf[i];
            const m = s / n;
            let ss = 0;
            for (let i = 0; i < n; i++) ss += (buf[i] - m) ** 2;
            out[0] = n > 1 ? Math.sqrt(ss / (n - 1)) : NaN;
            break;
          }
        }
      },
    };
  },
};
