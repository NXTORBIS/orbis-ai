/**
 * Monte Carlo runner.
 *
 * Executes a prepared model trial by trial with a seeded RNG, storing every
 * output value so that quantiles, histograms, risk metrics and sensitivity
 * analysis can be computed from the actual samples. Work is processed in
 * chunks so the caller can report progress and honour cancellation; running
 * inside a Web Worker keeps the UI responsive.
 *
 * Monte Carlo error: the reported interval for an expected value is the normal
 * -approximation interval mean ± z·s/√n. For an indicator output (a 0/1
 * variable) the Wilson score interval is used instead, which stays valid when
 * the estimated probability is near 0 or 1. Both are confidence intervals for
 * the model's own expectation — they describe sampling error only, not whether
 * the model itself is right.
 */
import { EngineError, type Issue } from '../core/result';
import { Random, Xoshiro128 } from '../random/rng';
import {
  ecdfPoints,
  histogram,
  meanConfidenceInterval,
  frequencyTable,
  sortedCopy,
  summarizeSample,
  wilsonInterval,
  RunningStats,
} from '../stats/descriptive';
import { getSimulationModel } from './registry';
import {
  SIMULATION_LIMITS,
  type ConvergencePoint,
  type OutputResult,
  type RunProgress,
  type SimulationRequest,
  type SimulationResult,
} from './types';

export interface RunHooks {
  onProgress?(p: RunProgress): void;
  /** Checked between chunks; returning true stops the run. */
  isCancelled?(): boolean;
}

export function validateRequest(req: SimulationRequest): Issue[] {
  const issues: Issue[] = [];
  if (!Number.isInteger(req.trials) || req.trials < 1) {
    issues.push({ code: 'range', field: 'trials', message: 'Number of trials must be a whole number of at least 1.' });
  } else if (req.trials > SIMULATION_LIMITS.maxTrials) {
    issues.push({
      code: 'limit',
      field: 'trials',
      message: `Number of trials exceeds the supported maximum of ${SIMULATION_LIMITS.maxTrials.toLocaleString('en-US')}. Reduce the trial count.`,
    });
  }
  if (typeof req.seed !== 'string' || !req.seed.length) {
    issues.push({ code: 'required', field: 'seed', message: 'A seed is required so the run can be reproduced.' });
  }
  let model;
  try {
    model = getSimulationModel(req.modelId);
  } catch {
    issues.push({ code: 'unknown', field: 'modelId', message: `Unknown simulation model "${req.modelId}".` });
    return issues;
  }
  issues.push(...model.validate(req.config));
  if (!issues.length) {
    const outputs = model.prepare(req.config).outputs.length;
    if (outputs * req.trials > SIMULATION_LIMITS.maxStoredValues) {
      issues.push({
        code: 'limit',
        field: 'trials',
        message: `This model records ${outputs} values per trial; ${req.trials.toLocaleString('en-US')} trials would exceed the memory limit. Reduce the trial count to at most ${Math.floor(SIMULATION_LIMITS.maxStoredValues / outputs).toLocaleString('en-US')}.`,
      });
    }
  }
  return issues;
}

/**
 * Drive a simulation chunk by chunk.
 *
 * The loop is exposed as a generator so the caller controls when each chunk
 * runs. That matters inside a Web Worker: JavaScript is single-threaded, so a
 * worker executing a long synchronous loop cannot receive the `cancel`
 * message. Awaiting a macrotask between chunks lets the worker's message queue
 * drain, which is what makes cancellation work without SharedArrayBuffer —
 * unavailable unless the page is cross-origin isolated.
 *
 * It yields after each chunk with the number of completed trials, and returns
 * the finished result.
 */
export function runSimulation(req: SimulationRequest, hooks: RunHooks = {}): SimulationResult {
  const steps = simulationSteps(req, hooks);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function* simulationSteps(req: SimulationRequest, hooks: RunHooks = {}): Generator<number, SimulationResult, void> {
  const issues = validateRequest(req);
  if (issues.length) throw new EngineError(issues);
  const model = getSimulationModel(req.modelId);
  const prepared = model.prepare(req.config);
  const outputs = prepared.outputs;
  const k = outputs.length;
  const rng = new Random(new Xoshiro128(req.seed));
  const started = Date.now();

  const columns = outputs.map(() => new Float64Array(req.trials));
  const scratch = new Float64Array(k);
  const running = outputs.map(() => new RunningStats());
  const nonFinite = new Array<number>(k).fill(0);

  // Convergence checkpoints spaced geometrically so early behaviour is visible.
  const checkpoints = convergenceCheckpoints(req.trials, SIMULATION_LIMITS.convergencePoints);
  const convergence: ConvergencePoint[][] = outputs.map(() => []);
  let nextCheckpoint = 0;

  let completed = 0;
  let cancelled = false;
  let stoppedEarly = false;

  outer: while (completed < req.trials) {
    const chunkEnd = Math.min(req.trials, completed + SIMULATION_LIMITS.chunkSize);
    for (; completed < chunkEnd; completed++) {
      scratch.fill(NaN);
      prepared.runTrial(rng, scratch);
      for (let j = 0; j < k; j++) {
        const v = scratch[j];
        columns[j][completed] = v;
        if (Number.isFinite(v)) running[j].push(v);
        else nonFinite[j]++;
      }
      const n = completed + 1;
      if (nextCheckpoint < checkpoints.length && n === checkpoints[nextCheckpoint]) {
        for (let j = 0; j < k; j++) convergence[j].push(convergencePoint(outputs[j].kind, running[j], n));
        nextCheckpoint++;
      }
    }
    hooks.onProgress?.({ completed, total: req.trials });
    // Hand control back to the caller so a worker can service its message
    // queue (and therefore observe a cancellation) between chunks.
    yield completed;
    if (hooks.isCancelled?.()) {
      cancelled = true;
      break;
    }
    if (req.targetPrecision && req.targetPrecision > 0 && completed >= 1000) {
      const widest = Math.max(
        ...outputs.map((s, j) => {
          if (s.role === 'input') return 0;
          const st = running[j];
          const half = Math.sqrt(st.variance / st.n);
          return Number.isFinite(half) ? half : Infinity;
        }),
      );
      if (widest <= req.targetPrecision) {
        stoppedEarly = true;
        break outer;
      }
    }
  }

  const results: OutputResult[] = outputs.map((spec, j) => {
    const raw = columns[j].subarray(0, completed);
    const finite = nonFinite[j] === 0 ? raw : raw.filter((v) => Number.isFinite(v));
    const sorted = sortedCopy(finite);
    const summary = summarizeSample(finite, sorted);
    const warnings: string[] = [];
    if (nonFinite[j] > 0) {
      warnings.push(
        `${nonFinite[j].toLocaleString('en-US')} of ${completed.toLocaleString('en-US')} trials produced a value that is not a finite number (for example a division by zero). Those trials are excluded from the statistics below.`,
      );
    }
    if (completed < 1000) {
      warnings.push(`Only ${completed.toLocaleString('en-US')} trials were run; Monte Carlo error is large. Increase the trial count for a more precise estimate.`);
    }
    const estimateInterval =
      spec.kind === 'indicator'
        ? wilsonInterval(Math.round(summary.mean * summary.n), summary.n)
        : meanConfidenceInterval(summary.mean, summary.standardError);
    if (spec.kind === 'indicator') {
      const successes = Math.round(summary.mean * summary.n);
      if (successes === 0) {
        warnings.push('The event did not occur in any trial. That does not make it impossible — it means the probability is small relative to the number of trials. The interval above gives the range consistent with the observed data.');
      } else if (successes < 10) {
        warnings.push(`The event occurred in only ${successes} trial(s), so the estimated probability is imprecise.`);
      }
    }
    const freqs = spec.kind === 'continuous' ? null : frequencyTable(finite, 500);
    return {
      spec,
      summary,
      estimateInterval,
      histogram: spec.kind === 'continuous' || !freqs ? histogram(sorted) : [],
      ecdf: ecdfPoints(sorted),
      frequencies: freqs,
      convergence: convergence[j],
      theoretical: prepared.theoretical?.[spec.key],
      nonFinite: nonFinite[j],
      warnings,
    };
  });

  const warnings: string[] = [];
  if (cancelled) warnings.push(`The run was cancelled after ${completed.toLocaleString('en-US')} of ${req.trials.toLocaleString('en-US')} trials. Results below use the completed trials only.`);
  if (stoppedEarly) warnings.push(`The run stopped early at ${completed.toLocaleString('en-US')} trials because the requested precision was reached.`);

  const result: SimulationResult = {
    modelId: req.modelId,
    config: req.config,
    seed: req.seed,
    trialsRequested: req.trials,
    trialsCompleted: completed,
    cancelled,
    stoppedEarly,
    durationMs: Date.now() - started,
    outputs: results,
    assumptions: prepared.assumptions,
    procedure: prepared.procedure,
    warnings,
  };
  if (req.keepSamples) {
    result.samples = Object.fromEntries(outputs.map((s, j) => [s.key, columns[j].slice(0, completed)]));
  }
  return result;
}

function convergencePoint(kind: string, st: RunningStats, n: number): ConvergencePoint {
  if (kind === 'indicator') {
    const i = wilsonInterval(Math.round(st.mean * st.n), st.n);
    return { n, estimate: st.mean, low: i.low, high: i.high };
  }
  const se = Math.sqrt(st.variance / st.n);
  const i = meanConfidenceInterval(st.mean, se);
  return { n, estimate: st.mean, low: i.low, high: i.high };
}

/** Geometrically spaced checkpoints (always including 1 and `trials`). */
export function convergenceCheckpoints(trials: number, count: number): number[] {
  if (trials <= count) return Array.from({ length: trials }, (_, i) => i + 1);
  const out = new Set<number>([1, trials]);
  const logMin = Math.log(1);
  const logMax = Math.log(trials);
  for (let i = 0; i < count; i++) {
    const n = Math.round(Math.exp(logMin + ((logMax - logMin) * i) / (count - 1)));
    out.add(Math.max(1, Math.min(trials, n)));
  }
  return [...out].sort((a, b) => a - b);
}
