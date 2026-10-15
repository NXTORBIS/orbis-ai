/**
 * Sensitivity analysis.
 *
 * Four methods are implemented, each with its own validity conditions. The
 * engine refuses to apply a method outside its conditions rather than
 * returning a number that looks meaningful.
 *
 *  1. One-at-a-time sweep — re-runs the model with one parameter varied across
 *     a range while the others stay at baseline. Exact for the model, but it
 *     explores only the axes through the baseline point, so it misses
 *     interactions.
 *
 *  2. Tornado chart — the low/high outcome for each parameter at chosen
 *     percentile or absolute endpoints, sorted by the width of the swing. Uses
 *     the same one-at-a-time runs, so the same caveat applies.
 *
 *  3. Rank correlation on an existing Monte Carlo sample — Spearman
 *     correlation between each sampled input and the output. This is a measure
 *     of monotonic association, not of causation and not of variance share.
 *     Requires the inputs to have been tracked and to be non-constant.
 *
 *  4. Variance-based Sobol indices (Saltelli estimator) — first-order index
 *     S₁ᵢ is the share of output variance explained by input i alone; the
 *     total index Sᵢᵗᵒᵗ adds that input's share of every interaction. These
 *     require independent inputs and a dedicated sampling design
 *     (N·(k+2) model evaluations), so they are computed by their own runner,
 *     not from an ordinary simulation sample.
 */
import { EngineError, type Issue } from '../core/result';
import { Random, Xoshiro128 } from '../random/rng';
import { getSimulationModel } from '../simulation/registry';
import { runSimulation } from '../simulation/runner';
import type { SimulationResult } from '../simulation/types';
import { mean, pearson, spearman, variance } from '../stats/descriptive';

export interface SweepPoint {
  parameterValue: number;
  /** Summary of the output at this parameter value. */
  outputMean: number;
  outputLow: number;
  outputHigh: number;
  /** Standard error of the mean at this point. */
  standardError: number;
}

export interface SweepResult {
  parameterLabel: string;
  parameterPath: string;
  outputKey: string;
  baselineValue: number;
  baselineOutput: number;
  points: SweepPoint[];
  /** Change in output per unit change in the parameter, around the baseline. */
  localGradient: number | null;
  /** Elasticity: % change in output per % change in parameter, at baseline. */
  elasticity: number | null;
  method: string;
  limitations: string[];
}

/** Read/write a numeric value inside a plain config object by dotted path. */
export function getByPath(obj: unknown, path: string): number {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') throw new EngineError(`Path "${path}" does not exist in the configuration.`, 'unknown');
    cur = (cur as Record<string, unknown>)[part];
  }
  if (typeof cur !== 'number' || !Number.isFinite(cur)) {
    throw new EngineError(`Path "${path}" does not point to a finite number.`, 'invalid');
  }
  return cur;
}

export function setByPath<T>(obj: T, path: string, value: number): T {
  const clone = structuredClone(obj) as Record<string, unknown>;
  const parts = path.split('.');
  let cur: Record<string, unknown> = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]];
    if (next === null || typeof next !== 'object') throw new EngineError(`Path "${path}" does not exist in the configuration.`, 'unknown');
    cur = next as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
  return clone as T;
}

export interface SweepRequest {
  modelId: string;
  baseConfig: unknown;
  parameterPath: string;
  parameterLabel: string;
  outputKey: string;
  min: number;
  max: number;
  steps: number;
  trialsPerPoint: number;
  seed: string;
}

export const SENSITIVITY_LIMITS = { maxSteps: 60, maxTrialsPerPoint: 200000, maxParameters: 30, maxSobolSamples: 100000 };

export function validateSweep(req: SweepRequest): Issue[] {
  const issues: Issue[] = [];
  if (!Number.isFinite(req.min) || !Number.isFinite(req.max)) {
    issues.push({ code: 'finite', field: 'range', message: 'The parameter range must be two finite numbers.' });
  } else if (req.max <= req.min) {
    issues.push({ code: 'range', field: 'max', message: 'The upper end of the range must be greater than the lower end.' });
  }
  if (!Number.isInteger(req.steps) || req.steps < 2 || req.steps > SENSITIVITY_LIMITS.maxSteps) {
    issues.push({ code: 'range', field: 'steps', message: `Number of steps must be a whole number between 2 and ${SENSITIVITY_LIMITS.maxSteps}.` });
  }
  if (!Number.isInteger(req.trialsPerPoint) || req.trialsPerPoint < 1 || req.trialsPerPoint > SENSITIVITY_LIMITS.maxTrialsPerPoint) {
    issues.push({ code: 'range', field: 'trialsPerPoint', message: `Trials per point must be a whole number between 1 and ${SENSITIVITY_LIMITS.maxTrialsPerPoint.toLocaleString('en-US')}.` });
  }
  if (!issues.length) {
    // Check every endpoint produces a valid configuration before running.
    const model = getSimulationModel(req.modelId);
    for (const v of [req.min, req.max]) {
      const cfg = setByPath(req.baseConfig, req.parameterPath, v);
      const bad = model.validate(cfg);
      if (bad.length) {
        issues.push({
          code: 'invalid-range',
          field: 'range',
          message: `With ${req.parameterLabel} = ${v} the model is invalid: ${bad[0].message} Narrow the range.`,
        });
        break;
      }
    }
  }
  return issues;
}

export interface SweepHooks {
  onProgress?(done: number, total: number): void;
  isCancelled?(): boolean;
}

/**
 * Each analysis is exposed both as a function and as a generator that yields
 * between model evaluations.
 *
 * The generator is what the Web Worker drives: a worker executing a long
 * synchronous loop cannot receive the `cancel` message, so without a yield the
 * cancel button does nothing. (The SharedArrayBuffer flag only works on a
 * cross-origin-isolated page, which this is not.) The plain functions below
 * drive the generator to completion and are used on the main thread and in
 * tests.
 */
export function runSweep(req: SweepRequest, hooks: SweepHooks = {}): SweepResult {
  const steps = sweepSteps(req, hooks);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function* sweepSteps(req: SweepRequest, hooks: SweepHooks = {}): Generator<number, SweepResult, void> {
  const issues = validateSweep(req);
  if (issues.length) throw new EngineError(issues);
  const model = getSimulationModel(req.modelId);
  const baselineValue = getByPath(req.baseConfig, req.parameterPath);
  const points: SweepPoint[] = [];
  const step = (req.max - req.min) / (req.steps - 1);
  for (let i = 0; i < req.steps; i++) {
    yield i;
    if (hooks.isCancelled?.()) break;
    const value = i === req.steps - 1 ? req.max : req.min + i * step;
    const cfg = setByPath(req.baseConfig, req.parameterPath, value);
    const bad = model.validate(cfg);
    if (bad.length) continue; // interior invalid point: skip rather than fabricate
    // A per-point seed keeps each point reproducible while varying the stream.
    const r = runSimulation({ modelId: req.modelId, config: cfg, trials: req.trialsPerPoint, seed: `${req.seed}:${i}` });
    const o = r.outputs.find((x) => x.spec.key === req.outputKey);
    if (!o) throw new EngineError(`Output "${req.outputKey}" is not produced by this model.`, 'unknown');
    points.push({
      parameterValue: value,
      outputMean: o.summary.mean,
      outputLow: o.estimateInterval.low,
      outputHigh: o.estimateInterval.high,
      standardError: o.summary.standardError,
    });
    hooks.onProgress?.(i + 1, req.steps);
  }
  if (points.length < 2) {
    throw new EngineError('Fewer than two valid points were produced, so no sensitivity can be reported. Check the parameter range.', 'insufficient');
  }
  // Baseline run for the gradient.
  const baseRun = runSimulation({ modelId: req.modelId, config: req.baseConfig, trials: req.trialsPerPoint, seed: `${req.seed}:base` });
  const baseOut = baseRun.outputs.find((x) => x.spec.key === req.outputKey)!;
  // Local gradient by central difference between the points bracketing the baseline.
  let gradient: number | null = null;
  const sorted = [...points].sort((a, b) => a.parameterValue - b.parameterValue);
  const after = sorted.find((p) => p.parameterValue > baselineValue);
  const before = [...sorted].reverse().find((p) => p.parameterValue < baselineValue);
  if (after && before) gradient = (after.outputMean - before.outputMean) / (after.parameterValue - before.parameterValue);
  const elasticity =
    gradient !== null && baselineValue !== 0 && baseOut.summary.mean !== 0
      ? (gradient * baselineValue) / baseOut.summary.mean
      : null;
  return {
    parameterLabel: req.parameterLabel,
    parameterPath: req.parameterPath,
    outputKey: req.outputKey,
    baselineValue,
    baselineOutput: baseOut.summary.mean,
    points: sorted,
    localGradient: gradient,
    elasticity,
    method: `One-at-a-time sweep: ${req.parameterLabel} varied across ${points.length} value(s) with ${req.trialsPerPoint.toLocaleString('en-US')} trials each; every other parameter held at its baseline.`,
    limitations: [
      'Only this parameter was varied. If parameters interact, their combined effect is not shown here.',
      'Each point carries Monte Carlo error; the interval around each point shows how much. Differences smaller than those intervals are not meaningful.',
      ...(points.length < req.steps ? [`${req.steps - points.length} point(s) in the requested range produced an invalid model and were skipped rather than estimated.`] : []),
    ],
  };
}

export interface TornadoEntry {
  parameterLabel: string;
  parameterPath: string;
  low: number;
  high: number;
  lowOutput: number;
  highOutput: number;
  /** |highOutput − lowOutput| — the bar length. */
  swing: number;
  /** True when the output rises with the parameter. */
  increasing: boolean;
}

export interface TornadoRequest {
  modelId: string;
  baseConfig: unknown;
  outputKey: string;
  parameters: { path: string; label: string; low: number; high: number }[];
  trialsPerPoint: number;
  seed: string;
}

export interface TornadoResult {
  baselineOutput: number;
  entries: TornadoEntry[];
  method: string;
  limitations: string[];
}

export function runTornado(req: TornadoRequest, hooks: SweepHooks = {}): TornadoResult {
  const steps = tornadoSteps(req, hooks);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function* tornadoSteps(req: TornadoRequest, hooks: SweepHooks = {}): Generator<number, TornadoResult, void> {
  if (!req.parameters.length) throw new EngineError('Select at least one parameter to vary.', 'required');
  if (req.parameters.length > SENSITIVITY_LIMITS.maxParameters) {
    throw new EngineError(`At most ${SENSITIVITY_LIMITS.maxParameters} parameters can be compared at once.`, 'limit');
  }
  const model = getSimulationModel(req.modelId);
  const base = runSimulation({ modelId: req.modelId, config: req.baseConfig, trials: req.trialsPerPoint, seed: `${req.seed}:base` });
  const baseOut = base.outputs.find((o) => o.spec.key === req.outputKey);
  if (!baseOut) throw new EngineError(`Output "${req.outputKey}" is not produced by this model.`, 'unknown');
  const entries: TornadoEntry[] = [];
  const skipped: string[] = [];
  for (const [i, p] of req.parameters.entries()) {
    yield i;
    if (hooks.isCancelled?.()) break;
    const results: number[] = [];
    let valid = true;
    for (const [j, v] of [p.low, p.high].entries()) {
      const cfg = setByPath(req.baseConfig, p.path, v);
      const bad = model.validate(cfg);
      if (bad.length) {
        skipped.push(`${p.label} (${bad[0].message})`);
        valid = false;
        break;
      }
      const r = runSimulation({ modelId: req.modelId, config: cfg, trials: req.trialsPerPoint, seed: `${req.seed}:${i}:${j}` });
      results.push(r.outputs.find((o) => o.spec.key === req.outputKey)!.summary.mean);
    }
    if (!valid) continue;
    entries.push({
      parameterLabel: p.label,
      parameterPath: p.path,
      low: p.low,
      high: p.high,
      lowOutput: results[0],
      highOutput: results[1],
      swing: Math.abs(results[1] - results[0]),
      increasing: results[1] >= results[0],
    });
    hooks.onProgress?.(i + 1, req.parameters.length);
  }
  entries.sort((a, b) => b.swing - a.swing);
  return {
    baselineOutput: baseOut.summary.mean,
    entries,
    method: `Each parameter was set to its low and high value in turn, with the others held at baseline, using ${req.trialsPerPoint.toLocaleString('en-US')} trials per run. Bars are sorted by the size of the resulting swing.`,
    limitations: [
      'The ranking depends entirely on the low and high values you chose. A parameter given a wider range will appear more influential.',
      'Only one parameter changes at a time, so interactions between parameters are not represented.',
      'Bar lengths carry Monte Carlo error. Treat small differences in ranking as unresolved.',
      ...(skipped.length ? [`Skipped parameters whose endpoints made the model invalid: ${skipped.join('; ')}.`] : []),
    ],
  };
}

export interface RankCorrelationEntry {
  inputKey: string;
  inputLabel: string;
  spearman: number;
  pearson: number;
  /** Share of the sum of squared Spearman coefficients — a descriptive share only. */
  relativeImportance: number;
  note?: string;
}

export interface RankCorrelationResult {
  outputKey: string;
  entries: RankCorrelationEntry[];
  method: string;
  limitations: string[];
}

/**
 * Spearman rank correlation between each tracked input and an output of an
 * existing simulation result. Requires `keepSamples` and tracked inputs.
 */
export function rankCorrelations(result: SimulationResult, outputKey: string): RankCorrelationResult {
  if (!result.samples) {
    throw new EngineError('Rank correlation needs the raw samples. Re-run the simulation with sample retention enabled.', 'missing-data');
  }
  const y = result.samples[outputKey];
  if (!y) throw new EngineError(`Output "${outputKey}" is not present in this result.`, 'unknown');
  const inputs = result.outputs.filter((o) => o.spec.role === 'input');
  if (!inputs.length) {
    throw new EngineError(
      'No inputs were tracked in this run. Mark the variables you want to analyse as tracked, then re-run.',
      'missing-data',
    );
  }
  const raw = inputs.map((o) => {
    const x = result.samples![o.spec.key];
    const vx = variance(x);
    if (!(vx > 0)) {
      return { inputKey: o.spec.key, inputLabel: o.spec.label, spearman: NaN, pearson: NaN, relativeImportance: NaN, note: 'This input did not vary in the run, so no correlation can be computed.' };
    }
    return {
      inputKey: o.spec.key,
      inputLabel: o.spec.label,
      spearman: spearman(x, y),
      pearson: pearson(x, y),
      relativeImportance: NaN,
    };
  });
  const sumSq = raw.reduce((a, e) => a + (Number.isFinite(e.spearman) ? e.spearman ** 2 : 0), 0);
  for (const e of raw) e.relativeImportance = sumSq > 0 && Number.isFinite(e.spearman) ? e.spearman ** 2 / sumSq : NaN;
  raw.sort((a, b) => (Math.abs(b.spearman) || -1) - (Math.abs(a.spearman) || -1));
  return {
    outputKey,
    entries: raw,
    method: `Spearman rank correlation between each tracked input and ${outputKey}, computed from ${y.length.toLocaleString('en-US')} simulated trials.`,
    limitations: [
      'Rank correlation measures monotonic association within this model. It does not establish that changing an input causes the output to change in the real system being modelled.',
      'The "relative importance" column rescales squared rank correlations so they sum to 1. It is a descriptive ordering, not a decomposition of variance — for that, use Sobol indices.',
      'Inputs that are correlated with each other share credit in an arbitrary way under this method.',
    ],
  };
}

export interface SobolRequest {
  modelId: string;
  config: unknown;
  outputKey: string;
  /** Paths of the independent inputs whose influence is being decomposed. */
  parameters: { path: string; label: string; low: number; high: number }[];
  /** Base sample size N; total model runs are N·(k+2). */
  samples: number;
  trialsPerEvaluation: number;
  seed: string;
}

export interface SobolEntry {
  parameterLabel: string;
  parameterPath: string;
  /** First-order index: variance share from this input alone. */
  firstOrder: number;
  /** Total index: this input's share including all interactions. */
  total: number;
  /** total − firstOrder: the part attributable to interactions. */
  interaction: number;
}

export interface SobolResult {
  entries: SobolEntry[];
  outputVariance: number;
  modelRuns: number;
  /** Sum of first-order indices; well below 1 indicates strong interactions. */
  firstOrderSum: number;
  method: string;
  limitations: string[];
}

/**
 * Variance-based sensitivity indices using the Saltelli estimators:
 *   S₁ᵢ  = (1/N) Σ f(B)ⱼ (f(A_B^i)ⱼ − f(A)ⱼ) / Var(f)
 *   Sᵀᵢ  = (1/2N) Σ (f(A)ⱼ − f(A_B^i)ⱼ)² / Var(f)
 * where A and B are independent sample matrices and A_B^i is A with column i
 * taken from B. (Saltelli et al. 2010, estimators (b) and (f).)
 *
 * Each model evaluation is itself a simulation of `trialsPerEvaluation`
 * trials; use 1 for deterministic models.
 */
export function runSobol(req: SobolRequest, hooks: SweepHooks = {}): SobolResult {
  const steps = sobolSteps(req, hooks);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function* sobolSteps(req: SobolRequest, hooks: SweepHooks = {}): Generator<number, SobolResult, void> {
  const k = req.parameters.length;
  if (k < 2) throw new EngineError('Variance-based indices need at least two inputs.', 'required');
  if (k > SENSITIVITY_LIMITS.maxParameters) throw new EngineError(`At most ${SENSITIVITY_LIMITS.maxParameters} inputs are supported.`, 'limit');
  if (!Number.isInteger(req.samples) || req.samples < 16 || req.samples > SENSITIVITY_LIMITS.maxSobolSamples) {
    throw new EngineError(`Base sample size must be a whole number between 16 and ${SENSITIVITY_LIMITS.maxSobolSamples.toLocaleString('en-US')}.`, 'range');
  }
  for (const p of req.parameters) {
    if (!(p.high > p.low)) throw new EngineError(`${p.label}: the upper bound must exceed the lower bound.`, 'range');
  }
  const model = getSimulationModel(req.modelId);
  const rng = new Random(new Xoshiro128(`${req.seed}:design`));
  const N = req.samples;

  const sampleRow = () => req.parameters.map((p) => p.low + rng.uniform() * (p.high - p.low));
  const A: number[][] = Array.from({ length: N }, sampleRow);
  const B: number[][] = Array.from({ length: N }, sampleRow);

  const evaluate = (row: number[], tag: string): number => {
    let cfg = req.config;
    req.parameters.forEach((p, i) => {
      cfg = setByPath(cfg, p.path, row[i]);
    });
    const bad = model.validate(cfg);
    if (bad.length) return NaN;
    const r = runSimulation({ modelId: req.modelId, config: cfg, trials: req.trialsPerEvaluation, seed: `${req.seed}:${tag}` });
    const o = r.outputs.find((x) => x.spec.key === req.outputKey);
    if (!o) throw new EngineError(`Output "${req.outputKey}" is not produced by this model.`, 'unknown');
    return o.summary.mean;
  };

  const totalRuns = N * (k + 2);
  let done = 0;
  const tick = () => {
    done++;
    if (done % Math.max(1, Math.floor(totalRuns / 100)) === 0) hooks.onProgress?.(done, totalRuns);
  };

  const fA = new Float64Array(N);
  const fB = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    yield done;
    if (hooks.isCancelled?.()) throw new EngineError('Sensitivity analysis was cancelled.', 'cancelled');
    fA[j] = evaluate(A[j], `A${j}`);
    tick();
    fB[j] = evaluate(B[j], `B${j}`);
    tick();
  }
  const allF = Float64Array.from([...fA, ...fB].filter((v) => Number.isFinite(v)));
  const varF = variance(allF);
  if (!(varF > 0)) {
    throw new EngineError(
      'The output did not vary across the sampled inputs, so no variance can be decomposed. Widen the input ranges or check that the output depends on them.',
      'insufficient',
    );
  }
  const entries: SobolEntry[] = [];
  for (let i = 0; i < k; i++) {
    const s1 = new Float64Array(N);
    const st = new Float64Array(N);
    let used = 0;
    for (let j = 0; j < N; j++) {
      yield done;
      if (hooks.isCancelled?.()) throw new EngineError('Sensitivity analysis was cancelled.', 'cancelled');
      const row = [...A[j]];
      row[i] = B[j][i];
      const fABi = evaluate(row, `AB${i}_${j}`);
      tick();
      if (!Number.isFinite(fABi) || !Number.isFinite(fA[j]) || !Number.isFinite(fB[j])) continue;
      s1[used] = fB[j] * (fABi - fA[j]);
      st[used] = (fA[j] - fABi) ** 2;
      used++;
    }
    const first = used ? mean(s1.subarray(0, used)) / varF : NaN;
    const total = used ? mean(st.subarray(0, used)) / (2 * varF) : NaN;
    entries.push({
      parameterLabel: req.parameters[i].label,
      parameterPath: req.parameters[i].path,
      firstOrder: first,
      total,
      interaction: total - first,
    });
  }
  const firstOrderSum = entries.reduce((a, e) => a + (Number.isFinite(e.firstOrder) ? e.firstOrder : 0), 0);
  const limitations = [
    'Sobol indices assume the inputs are varied independently. If the real inputs move together, these shares misattribute influence.',
    'Each index is a Monte Carlo estimate. With a small base sample size, first-order indices can come out slightly negative; that indicates sampling noise around a small true value, not a negative contribution.',
    `Inputs were varied uniformly across the ranges you supplied, so the indices describe sensitivity over those ranges, not over the inputs' actual distributions.`,
  ];
  if (firstOrderSum < 0.8) {
    limitations.push(
      `The first-order indices sum to ${firstOrderSum.toFixed(3)}, well below 1, so a substantial part of the output variance comes from interactions between inputs rather than from any single input. Compare each total index with its first-order index to see where.`,
    );
  }
  return {
    entries,
    outputVariance: varF,
    modelRuns: totalRuns,
    firstOrderSum,
    method: `Saltelli variance decomposition with base sample size N = ${N.toLocaleString('en-US')} and ${k} input(s), requiring N·(k+2) = ${totalRuns.toLocaleString('en-US')} model evaluations.`,
    limitations,
  };
}
