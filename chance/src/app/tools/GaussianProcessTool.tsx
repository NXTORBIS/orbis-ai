/**
 * Gaussian processes and Bayesian optimisation.
 *
 * Every other regression in this application asks the user to choose a
 * functional form first. A Gaussian process does not: it places a
 * distribution over FUNCTIONS, and the width of its predictive distribution
 * grows where there is no data. That is the property the screen is built
 * around, so the prediction card shows the two intervals side by side and the
 * prediction grid deliberately extends past the data, where the uncertainty
 * has to widen.
 *
 * Two intervals, never merged: the credible interval for the latent function
 * f(x) and the predictive interval for a new noisy observation y(x) = f(x) + ε
 * differ by the observation-noise variance and answer different questions.
 * The engine returns both; this screen draws and labels both.
 *
 * Performance: exact GP inference is O(n³) and multi-restart hyperparameter
 * fitting runs the whole factorisation many times per restart, so the default
 * dataset is 30 points and nothing beyond conditioning, prediction, sampling
 * and leave-one-out cross-validation runs on open. The hyperparameter fit,
 * the sparse approximations and the Bayesian-optimisation loop are behind
 * buttons, and the optimisation loop is driven through the engine's generator
 * so it can be cancelled.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { EngineError, type Explanation } from '../../engine/core/result';
import { normalQuantile } from '../../engine/special/gamma';
import {
  ACQUISITION_NOTES,
  BRANIN,
  GP_LIMITS,
  KERNEL_DEFS,
  KERNEL_IDS,
  INTERVAL_LABEL,
  ardReport,
  bayesOptSteps,
  buildKernel,
  conditionGp,
  covarianceMemoryBytes,
  describeBytes,
  expectedImprovement,
  fitSparseGp,
  looCrossValidation,
  lowerConfidenceBound,
  predictGp,
  probabilityOfImprovement,
  samplePosteriorFunctions,
  samplePriorFunctions,
  ucbBeta,
  type AcquisitionSpec,
  type ArdReport,
  type BayesOptProgress,
  type BayesOptResult,
  type Box,
  type FitReport,
  type GpModel,
  type GpPredictionSet,
  type Kernel,
  type KernelId,
  type KernelSpec,
  type MeanSpec,
  type RestartOutcome,
  type SparseMethod,
  type SparseModel,
} from '../../engine/gp';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  Disclosure,
  KeyValueList,
  Notice,
  NumberField,
  RunningState,
  SelectField,
  TextField,
  type ColumnDef,
} from '../../ui/primitives';
import { LineChart, ScatterChart } from '../../ui/charts/charts';
import { FanChart, QQChart } from '../../ui/charts/advanced';
import { formatValue } from '../../ui/charts/scale';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { useEngineJob } from '../shared/useEngineJob';
import { EngineJobPanel } from '../shared/EngineJobPanel';
import { useApp } from '../store';

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

export type GpAcquisitionKind = AcquisitionSpec['kind'];

export interface GaussianProcessConfig {
  /** The data as typed or pasted: one observation per line, inputs then the target. */
  dataText: string;
  /** Primary kernel. */
  kernelId: KernelId;
  /** Composition: a single kernel, or a sum or product with the second one. */
  composition: 'single' | 'sum' | 'product';
  secondKernelId: KernelId;
  /** Outer scaling factor, or null for no scaling wrapper. */
  scaleVariance: number | null;
  /**
   * Kernel parameters by the engine's flat slot name (for example
   * "k.sum0.lengthScale[0]"). Any slot missing here keeps the kernel's own
   * default, so the record stays small and survives a change of kernel.
   */
  kernelParams: Record<string, number>;
  noiseVariance: number;
  meanKind: 'zero' | 'constant-unknown' | 'polynomial';
  polynomialDegree: number;
  /** Central mass of both intervals. */
  level: number;
  /** Test points across the plotted range. */
  gridPoints: number;
  /** How far past the data the grid extends, as a fraction of the data range. */
  extrapolation: number;
  /** Sampled functions drawn from the prior and from the posterior. */
  sampleCount: number;
  sampleSeed: string;
  /** Hyperparameter fitting is expensive, so it is asked for. */
  runFit: boolean;
  fitRestarts: number;
  fitNoise: boolean;
  /** Sparse approximations are off until asked for. */
  showSparse: boolean;
  sparseMethod: SparseMethod;
  inducingCount: number;
  /** Acquisition function, shared by the plot and the optimisation loop. */
  acquisition: GpAcquisitionKind;
  /** Improvement threshold ξ for expected and probability of improvement. */
  acquisitionXi: number;
  ucbBetaMode: 'schedule' | 'fixed';
  ucbBetaFixed: number;
  /** The optimisation loop is expensive, so it is asked for. */
  runOptimisation: boolean;
  boObjective: 'sine-1d' | 'branin';
  boIterations: number;
  boNoiseVariance: number;
  boSeed: string;
}

/**
 * Built-in demonstration data: 30 noisy observations of
 * sin(x) + 0.35·cos(2.1x) on [0, 10] with a deliberate gap between x = 4 and
 * x = 6. The gap is the point of the dataset — it is where the posterior has
 * to admit that it does not know. Generated by a fixed linear congruential
 * sequence so the figures are identical on every machine, and labelled as
 * synthetic wherever it is used.
 */
const BUILT_IN_DATA_TEXT: string = (() => {
  let state = 20260312;
  const uniform = (): number => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const rows: string[] = ['# x, y — synthetic demonstration data (see the note in the Data card)'];
  for (let i = 0; i < 30; i++) {
    const x = (i / 29) * 10;
    if (x > 4 && x < 6) continue; // the gap
    // Irwin–Hall(8) centred: an adequate approximately-normal error here.
    let u = 0;
    for (let k = 0; k < 8; k++) u += uniform();
    const noise = 0.09 * (u - 4);
    const y = Math.sin(x) + 0.35 * Math.cos(2.1 * x) + noise;
    rows.push(`${x.toFixed(3)}, ${y.toFixed(4)}`);
  }
  return rows.join('\n');
})();

export const GAUSSIAN_PROCESS_DEFAULT: GaussianProcessConfig = {
  dataText: BUILT_IN_DATA_TEXT,
  // Matérn 5/2 rather than the RBF kernel: twice-differentiable paths instead
  // of an assertion of analyticity. This is the engine's own recommendation.
  kernelId: 'matern52',
  composition: 'single',
  secondKernelId: 'periodic',
  scaleVariance: null,
  kernelParams: { 'k.variance': 0.8, 'k.lengthScale[0]': 1.1 },
  noiseVariance: 0.01,
  meanKind: 'zero',
  polynomialDegree: 1,
  level: 0.95,
  gridPoints: 140,
  extrapolation: 0.25,
  sampleCount: 5,
  sampleSeed: 'orbis',
  runFit: false,
  fitRestarts: 6,
  fitNoise: true,
  showSparse: false,
  sparseMethod: 'fitc',
  inducingCount: 8,
  acquisition: 'expected-improvement',
  acquisitionXi: 0,
  ucbBetaMode: 'schedule',
  ucbBetaFixed: 2,
  runOptimisation: false,
  boObjective: 'sine-1d',
  boIterations: 12,
  boNoiseVariance: 0.01,
  boSeed: 'bo-1',
};

/** Upper bound on pasted rows, so a stray paste cannot lock up the parser. */
const MAX_ROWS = 4000;

/* ------------------------------------------------------------------ *
 * Parsing — pasted data is untrusted and never rendered as markup
 * ------------------------------------------------------------------ */

interface SkippedLine {
  line: number;
  text: string;
  reason: string;
}

interface ParsedData {
  X: number[][];
  y: number[];
  dimension: number;
  skipped: SkippedLine[];
  truncated: number;
}

function clip(s: string, max = 44): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * One observation per line: every field but the last is an input coordinate,
 * the last is the target. Every line that cannot be read is reported with its
 * line number and the reason; nothing is dropped silently.
 */
function parseData(text: string): ParsedData {
  const X: number[][] = [];
  const y: number[] = [];
  const skipped: SkippedLine[] = [];
  let truncated = 0;
  let dimension = 0;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) continue; // blank lines and comments are not data
    if (X.length >= MAX_ROWS) {
      truncated++;
      continue;
    }
    const fields = trimmed.split(/[\s,;]+/).filter(Boolean);
    if (fields.length < 2) {
      skipped.push({ line: i + 1, text: clip(trimmed), reason: 'a line needs at least one input and a target, separated by a comma or a space' });
      continue;
    }
    const numbers = fields.map(Number);
    const badIndex = numbers.findIndex((v) => !Number.isFinite(v));
    if (badIndex >= 0) {
      skipped.push({
        line: i + 1,
        text: clip(trimmed),
        reason: `field ${badIndex + 1}, "${clip(fields[badIndex], 20)}", is not a finite number${X.length === 0 ? ' (a header line?)' : ''}`,
      });
      continue;
    }
    const d = numbers.length - 1;
    if (dimension === 0) dimension = d;
    if (d !== dimension) {
      skipped.push({ line: i + 1, text: clip(trimmed), reason: `${d} input${d === 1 ? '' : 's'} here but ${dimension} on the first data line` });
      continue;
    }
    X.push(numbers.slice(0, d));
    y.push(numbers[d]);
  }
  return { X, y, dimension: Math.max(dimension, 1), skipped, truncated };
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

type Attempt<T> = { ok: true; value: T } | { ok: false; error: string };

/** Run an engine call, turning an EngineError into its own message. */
function attempt<T>(fn: () => T): Attempt<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    if (e instanceof EngineError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Ranges for the knobs that drive a loop count, a matrix size or a draw
 * count. A `NumberField` reports whatever was typed and shows its own
 * out-of-range message beside the field, but it does not clamp — so a typed
 * "1e9" would otherwise reach the engine and freeze the tab for the rest of
 * its life. Every such knob is read through `withinRange` below, the fields
 * declare the same limits, and when a value is outside them the screen says
 * which limit the run actually used rather than quietly using it.
 */
const KNOB_LIMITS = {
  gridPoints: { min: 8, max: 2000, label: 'Test points across the range' },
  sampleCount: { min: 1, max: 20, label: 'Sampled functions' },
  polynomialDegree: { min: 0, max: 3, label: 'Polynomial drift degree' },
  fitRestarts: { min: 1, max: 32, label: 'Restarts' },
  boIterations: { min: 1, max: 60, label: 'Iterations' },
} as const;

type KnobName = keyof typeof KNOB_LIMITS;

/** The value to compute with: the typed one, or the limit it exceeded. */
function withinRange(name: KnobName, value: number): number {
  const { min, max } = KNOB_LIMITS[name];
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** One sentence per knob that was outside its range, naming what was used. */
function rangeNotes(config: GaussianProcessConfig): string[] {
  const notes: string[] = [];
  for (const name of Object.keys(KNOB_LIMITS) as KnobName[]) {
    const typed = config[name];
    const used = withinRange(name, typed);
    if (used !== typed) {
      const { min, max, label } = KNOB_LIMITS[name];
      notes.push(`“${label}” is ${Number.isFinite(typed) ? typed.toLocaleString('en-US') : String(typed)}, outside its range ${min}–${max}. Everything below used ${used.toLocaleString('en-US')}.`);
    }
  }
  return notes;
}

function kernelSpecOf(
  kernelId: KernelId,
  composition: GaussianProcessConfig['composition'],
  secondKernelId: KernelId,
  scaleVariance: number | null,
): KernelSpec {
  const base: KernelSpec = { kind: 'base', id: kernelId };
  const composed: KernelSpec =
    composition === 'single' ? base : { kind: composition, terms: [base, { kind: 'base', id: secondKernelId }] };
  return scaleVariance === null ? composed : { kind: 'scale', variance: scaleVariance, term: composed };
}

function meanSpecOf(meanKind: GaussianProcessConfig['meanKind'], polynomialDegree: number): MeanSpec {
  if (meanKind === 'constant-unknown') return { kind: 'constant' };
  if (meanKind === 'polynomial') return { kind: 'polynomial', degree: polynomialDegree };
  return { kind: 'zero' };
}

/** A readable label for one of the engine's flat parameter slots. */
function slotLabel(kernel: Kernel, index: number): string {
  const slot = kernel.slots[index];
  if (slot.kernelId === 'scale') return 'Outer scale variance';
  const def = KERNEL_DEFS[slot.kernelId as KernelId];
  const spec = def?.params.find((p) => p.name === slot.base);
  const dim = slot.dimension === null ? '' : ` — input ${slot.dimension + 1}`;
  return `${def ? `${def.name}: ` : ''}${spec?.label ?? slot.base}${dim}`;
}

const MEAN_OPTIONS: { value: GaussianProcessConfig['meanKind']; label: string }[] = [
  { value: 'zero', label: 'Zero mean (the textbook GP; reverts to 0 away from data)' },
  { value: 'constant-unknown', label: 'Unknown constant mean, estimated (ordinary kriging)' },
  { value: 'polynomial', label: 'Polynomial drift, estimated (universal kriging)' },
];

const ACQUISITION_OPTIONS: { value: GpAcquisitionKind; label: string }[] = [
  { value: 'expected-improvement', label: 'Expected improvement' },
  { value: 'probability-of-improvement', label: 'Probability of improvement' },
  { value: 'lower-confidence-bound', label: 'Lower confidence bound (UCB)' },
  { value: 'thompson', label: 'Thompson sampling' },
  { value: 'knowledge-gradient', label: 'Knowledge gradient' },
];

/**
 * Built-in test objectives for the optimisation loop. They are functions, so
 * they live here and not in the configuration, which has to survive
 * `structuredClone` and a Zod validation on import.
 */
const BO_OBJECTIVES: Record<
  GaussianProcessConfig['boObjective'],
  { label: string; bounds: Box; evaluate(x: readonly number[]): number; knownOptimum: number | null; note: string }
> = {
  'sine-1d': {
    label: 'One-dimensional test function: sin(3x) + 0.3x²',
    bounds: [[-3, 3]],
    evaluate: (x) => Math.sin(3 * x[0]) + 0.3 * x[0] * x[0],
    knownOptimum: null,
    note: 'A one-dimensional objective with several local minima, so the acquisition has a real choice to make.',
  },
  branin: {
    label: 'Branin–Hoo (two inputs, three global minima)',
    bounds: BRANIN.bounds,
    evaluate: (x) => BRANIN.evaluate(x),
    knownOptimum: BRANIN.optimum,
    note: 'The standard two-dimensional benchmark. Its optimum is known, so the simple regret is reported against it.',
  },
};

type BoState =
  | { status: 'idle' }
  | { status: 'running'; done: number; total: number; latest: BayesOptProgress | null }
  | { status: 'done'; result: BayesOptResult }
  | { status: 'cancelled'; done: number }
  | { status: 'error'; message: string };

/* ------------------------------------------------------------------ *
 * The screen
 * ------------------------------------------------------------------ */

export function GaussianProcessTool({ config }: { config: GaussianProcessConfig }) {
  const app = useApp();
  const set = (patch: Partial<GaussianProcessConfig>) => app.updateConfig({ ...config, ...patch });

  // Loop- and size-driving knobs, read through their declared range. See
  // KNOB_LIMITS: the fields show the out-of-range message, this keeps the
  // engine from being handed the typed value.
  const gridPoints = withinRange('gridPoints', config.gridPoints);
  const sampleCount = withinRange('sampleCount', config.sampleCount);
  const polynomialDegree = withinRange('polynomialDegree', config.polynomialDegree);
  const fitRestarts = withinRange('fitRestarts', config.fitRestarts);
  const boIterations = withinRange('boIterations', config.boIterations);
  const outOfRange = rangeNotes(config);

  /* -------------------------------------------------- data and the model */

  const parsed = useMemo(() => parseData(config.dataText), [config.dataText]);
  const n = parsed.X.length;
  const d = parsed.dimension;

  const spec = useMemo(
    () => kernelSpecOf(config.kernelId, config.composition, config.secondKernelId, config.scaleVariance),
    [config.kernelId, config.composition, config.secondKernelId, config.scaleVariance],
  );
  const mean = useMemo(() => meanSpecOf(config.meanKind, polynomialDegree), [config.meanKind, polynomialDegree]);

  // The compiled kernel is also the source of the parameter editors: the slot
  // list depends on the composition and on the input dimension, so it is read
  // from the engine rather than duplicated here.
  // The kernel is compiled on its own, so the parameter editors exist before
  // there is any data to condition on.
  const probe = useMemo(() => attempt(() => buildKernel(spec, d)), [spec, d]);
  const kernelValues = useMemo(() => {
    if (!probe.ok) return null;
    return probe.value.slots.map((slot, i) => {
      const stored = config.kernelParams[slot.name];
      return typeof stored === 'number' && Number.isFinite(stored) ? stored : probe.value.values[i];
    });
  }, [probe, config.kernelParams]);

  const model = useMemo((): Attempt<GpModel> | null => {
    if (n === 0 || !kernelValues) return null;
    return attempt(() =>
      conditionGp({ X: parsed.X, y: parsed.y, kernel: spec, kernelValues, noiseVariance: config.noiseVariance, mean }),
    );
  }, [n, parsed.X, parsed.y, spec, kernelValues, config.noiseVariance, mean]);

  const fitted: GpModel | null = model && model.ok ? model.value : null;

  /* -------------------------------------------------- prediction */

  // Only a one-dimensional input can be drawn as a curve. With more inputs the
  // predictions are shown at the training inputs instead, and the screen says
  // so rather than plotting a slice that looks like the whole function.
  const grid = useMemo(() => {
    if (d !== 1 || n === 0) return null;
    const xs = parsed.X.map((row) => row[0]);
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    const span = hi - lo || 1;
    const pad = span * config.extrapolation;
    const count = gridPoints;
    return Array.from({ length: count }, (_, i) => [lo - pad + ((span + 2 * pad) * i) / (count - 1)]);
  }, [d, n, parsed.X, config.extrapolation, gridPoints]);

  const prediction = useMemo((): Attempt<GpPredictionSet> | null => {
    if (!fitted) return null;
    const points = grid ?? fitted.X;
    return attempt(() => predictGp(fitted, points, { level: config.level }));
  }, [fitted, grid, config.level]);

  /* -------------------------------------------------- sampled functions */

  const sampleGrid = useMemo(() => (grid ? grid.filter((_, i) => i % Math.ceil(grid.length / 120) === 0) : null), [grid]);

  const priorSamples = useMemo(() => {
    if (!sampleGrid || !kernelValues) return null;
    return attempt(() => samplePriorFunctions(spec, 1, sampleGrid, sampleCount, config.sampleSeed, kernelValues, mean));
  }, [sampleGrid, kernelValues, spec, sampleCount, config.sampleSeed, mean]);

  const posteriorSamples = useMemo(() => {
    if (!fitted || !sampleGrid) return null;
    return attempt(() => samplePosteriorFunctions(fitted, sampleGrid, sampleCount, config.sampleSeed));
  }, [fitted, sampleGrid, sampleCount, config.sampleSeed]);

  /* -------------------------------------------------- calibration */

  const loo = useMemo(() => (fitted ? attempt(() => looCrossValidation(fitted)) : null), [fitted]);

  const looQq = useMemo(() => {
    if (!loo || !loo.ok) return null;
    const sorted = [...loo.value.standardisedResiduals].sort((a, b) => a - b);
    return sorted.map((sample, i) => ({ theoretical: normalQuantile((i + 0.5) / sorted.length), sample }));
  }, [loo]);

  /* -------------------------------------------------- hyperparameters (gated) */

  /**
   * The multi-restart marginal-likelihood fit runs in the engine-job worker:
   * every optimiser step rebuilds and factorises the n×n covariance matrix, so
   * a fit is hundreds of O(n³) factorisations. Off the main thread the page
   * stays usable, progress counts completed restarts, and Cancel stops it.
   *
   * The worker returns the fitted parameter VALUES, not a `GpModel`: a model
   * carries a compiled kernel with methods on it, which cannot cross a
   * `postMessage` boundary. The model is rebuilt here with one `conditionGp`
   * call — a single factorisation, nothing beside the fit itself — so the
   * numbers below are the same ones the optimiser reached.
   */
  const fitJob = useEngineJob('gp.fit-hyperparameters');
  const fitStart = fitJob.start;
  const fitReset = fitJob.reset;
  useEffect(() => {
    if (!config.runFit) {
      fitReset();
      return;
    }
    if (n === 0 || !kernelValues) return;
    fitStart({
      request: { X: parsed.X, y: parsed.y, kernel: spec, kernelValues, noiseVariance: config.noiseVariance, mean },
      options: { restarts: fitRestarts, fitNoise: config.fitNoise && config.noiseVariance > 0, seed: config.sampleSeed },
    });
  }, [config.runFit, n, parsed.X, parsed.y, spec, kernelValues, config.noiseVariance, mean, fitRestarts, config.fitNoise, config.sampleSeed, fitStart, fitReset]);

  const fitResult = fitJob.state.result;
  const fit = useMemo((): Attempt<{ fit: FitReport; model: GpModel; names: readonly string[] }> | null => {
    if (!fitResult) return null;
    return attempt(() => {
      const model = conditionGp({
        X: parsed.X,
        y: parsed.y,
        kernel: spec,
        kernelValues: fitResult.kernelValues,
        noiseVariance: fitResult.noiseVariance,
        mean,
      });
      return { fit: fitResult.fit, model, names: fitResult.names };
    });
  }, [fitResult, parsed.X, parsed.y, spec, mean]);

  const ard = useMemo((): ArdReport | null => {
    const source = fit && fit.ok ? fit.value.model : fitted;
    return source ? ardReport(source) : null;
  }, [fit, fitted]);

  /* -------------------------------------------------- sparse (gated) */

  const sparse = useMemo((): Attempt<{ sparse: SparseModel; prediction: GpPredictionSet }> | null => {
    if (!config.showSparse || n === 0 || !kernelValues) return null;
    return attempt(() => {
      const approx = fitSparseGp({
        X: parsed.X,
        y: parsed.y,
        kernel: spec,
        kernelValues,
        noiseVariance: config.noiseVariance,
        method: config.sparseMethod,
        inducingCount: Math.min(config.inducingCount, n),
        selection: 'farthest-point',
        seed: config.sampleSeed,
      });
      return { sparse: approx, prediction: approx.predict(grid ?? parsed.X, config.level) };
    });
  }, [config.showSparse, n, parsed.X, parsed.y, spec, kernelValues, config.noiseVariance, config.sparseMethod, config.inducingCount, config.sampleSeed, grid, config.level]);

  /* -------------------------------------------------- acquisition curve */

  const incumbent = useMemo(() => (n > 0 ? Math.min(...parsed.y) : null), [n, parsed.y]);

  /**
   * The acquisition over the plotted range, for the CURRENT posterior: this is
   * where the next evaluation would go and why. Expected improvement,
   * probability of improvement and the lower confidence bound are closed-form
   * in the posterior mean and standard deviation. Thompson sampling needs one
   * posterior draw, which the engine provides. The knowledge gradient needs
   * the full predictive covariance against every candidate and is O(m² log m)
   * per point, so it is not drawn here — it is still available inside the
   * optimisation loop below.
   */
  const acquisitionCurve = useMemo(() => {
    if (!prediction || !prediction.ok || !grid || incumbent === null) return null;
    const preds = prediction.value.predictions;
    if (config.acquisition === 'knowledge-gradient') return null;
    if (config.acquisition === 'thompson') {
      if (!posteriorSamples || !posteriorSamples.ok || !sampleGrid) return null;
      const draw = posteriorSamples.value.samples[0];
      return {
        label: 'One posterior draw (Thompson sampling goes to its minimum)',
        minimise: true,
        points: sampleGrid.map((x, i) => ({ x: x[0], y: draw[i] })),
      };
    }
    if (config.acquisition === 'lower-confidence-bound') {
      const beta = config.ucbBetaMode === 'fixed' ? config.ucbBetaFixed : ucbBeta(Math.max(1, n), d);
      return {
        label: `Lower confidence bound μ − √β·σ with β = ${formatValue(beta, 4)} (the suggestion is its minimum)`,
        minimise: true,
        points: preds.map((p) => ({ x: p.x[0], y: lowerConfidenceBound({ mean: p.mean, sd: p.latentSd, incumbent }, beta) })),
      };
    }
    const fn = config.acquisition === 'expected-improvement' ? expectedImprovement : probabilityOfImprovement;
    return {
      label: config.acquisition === 'expected-improvement' ? 'Expected improvement (maximised)' : 'Probability of improvement (maximised)',
      minimise: false,
      points: preds.map((p) => ({ x: p.x[0], y: fn({ mean: p.mean, sd: p.latentSd, incumbent }, config.acquisitionXi) })),
    };
  }, [prediction, grid, incumbent, config.acquisition, config.acquisitionXi, config.ucbBetaMode, config.ucbBetaFixed, n, d, posteriorSamples, sampleGrid]);

  const acquisitionArg = useMemo(() => {
    if (!acquisitionCurve || !acquisitionCurve.points.length) return null;
    return acquisitionCurve.points.reduce((best, p) =>
      acquisitionCurve.minimise ? (p.y < best.y ? p : best) : p.y > best.y ? p : best,
    );
  }, [acquisitionCurve]);

  /* -------------------------------------------------- Bayesian optimisation */

  const [bo, setBo] = useState<BoState>({ status: 'idle' });
  const boToken = useRef<{ cancelled: boolean } | null>(null);
  // Stop a loop still running when the user leaves the screen: nothing would
  // display its result and it would keep occupying the main thread.
  useEffect(() => () => {
    if (boToken.current) boToken.current.cancelled = true;
  }, []);

  const startOptimisation = () => {
    if (boToken.current) boToken.current.cancelled = true;
    const token = { cancelled: false };
    boToken.current = token;
    const objective = BO_OBJECTIVES[config.boObjective];
    const acquisition: AcquisitionSpec =
      config.acquisition === 'lower-confidence-bound'
        ? config.ucbBetaMode === 'fixed'
          ? { kind: 'lower-confidence-bound', beta: config.ucbBetaFixed }
          : { kind: 'lower-confidence-bound' }
        : config.acquisition === 'expected-improvement' || config.acquisition === 'probability-of-improvement'
          ? { kind: config.acquisition, xi: config.acquisitionXi }
          : { kind: config.acquisition };
    let generator: Generator<BayesOptProgress, BayesOptResult, void>;
    try {
      generator = bayesOptSteps({
        objective: (x) => objective.evaluate(x),
        bounds: objective.bounds,
        iterations: boIterations,
        seed: config.boSeed,
        acquisition,
        kernel: spec,
        noiseVariance: config.boNoiseVariance,
        knownOptimum: objective.knownOptimum ?? undefined,
      });
    } catch (e) {
      setBo({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      return;
    }
    setBo({ status: 'running', done: 0, total: boIterations, latest: null });
    // The engine's loop is a generator that yields once per iteration, so the
    // run is pumped a slice at a time and a cancel can land between slices.
    const pump = () => {
      if (token.cancelled) return;
      const started = Date.now();
      try {
        for (;;) {
          const step = generator.next();
          if (step.done) {
            setBo({ status: 'done', result: step.value });
            return;
          }
          setBo({ status: 'running', done: step.value.iteration, total: step.value.iterations, latest: step.value });
          if (Date.now() - started > 40) break;
        }
      } catch (e) {
        setBo({ status: 'error', message: e instanceof Error ? e.message : String(e) });
        return;
      }
      window.setTimeout(pump, 0);
    };
    window.setTimeout(pump, 0);
  };

  const cancelOptimisation = () => {
    if (boToken.current) boToken.current.cancelled = true;
    setBo((prev) => ({ status: 'cancelled', done: prev.status === 'running' ? prev.done : 0 }));
  };

  /* -------------------------------------------------- explanation */

  const explanation = useMemo((): Explanation => {
    const kernelLabel = probe.ok ? probe.value.label : 'the selected kernel';
    return {
      method: `Exact Gaussian-process regression with the ${kernelLabel} kernel`,
      formula: 'mean = k*ᵀ(K + σ²I)⁻¹y   ·   Var[f(x*)] = k** − k*ᵀ(K + σ²I)⁻¹k*   ·   Var[y(x*)] = Var[f(x*)] + σ²',
      steps: [
        { label: 'Covariance matrix and one Cholesky factorisation', expression: 'K_y = K(X, X) + σ²I = L·Lᵀ', value: n > 0 ? `n = ${n}, ${describeBytes(covarianceMemoryBytes(n))} for the matrix and its factor` : 'no data' },
        { label: 'Predictive distribution at each test input', expression: 'f(x*) | y ~ N(k*ᵀα, k** − vᵀv)', value: 'exact: a closed-form Gaussian conditional given the hyperparameters' },
        { label: 'Interval for a new noisy observation', expression: 'y(x*) | y ~ N(k*ᵀα, k** − vᵀv + σ²)', value: `wider than the latent interval by σ² = ${formatValue(config.noiseVariance, 4)}` },
        { label: 'Leave-one-out cross-validation', expression: 'μ₋ᵢ = yᵢ − αᵢ/cᵢ,  σ²₋ᵢ = 1/cᵢ', value: 'exact, and free given the factorisation already computed' },
      ],
      assumptions: [
        'The function is a draw from the Gaussian process defined by the kernel. The kernel is the whole prior, and its smoothness assumption is the most consequential part of it.',
        'The observation noise is Gaussian, additive and of the stated variance, equal at every input.',
        'The hyperparameters are taken as given for the predictive distribution. A fitted hyperparameter is a point estimate and the predictive intervals shown do not include uncertainty about it.',
      ],
      limitations: [
        'Given the hyperparameters the predictive mean and variance are exact. Hyperparameter fits and acquisition maximisation are numerical: they are iterative optimisations of a multimodal objective.',
        'Sampled functions are empirical — each is one draw, and the spread of a finite set of draws is a Monte Carlo estimate. Use the intervals for any quantitative statement.',
        'Sparse approximations are numerical and biased in a documented direction, stated with each one.',
        'A stationary kernel assumes the same roughness everywhere in the input space, which is rarely checked and often wrong.',
      ],
      exactness: 'exact',
    };
  }, [probe, n, config.noiseVariance]);

  /* -------------------------------------------------- derived display bits */

  const kernelDefs = useMemo(() => (probe.ok ? probe.value.defs : []), [probe]);
  const nearLimit = n > GP_LIMITS.maxExactN * 0.7;
  const trainingPoints = useMemo(() => (d === 1 ? parsed.X.map((row, i) => ({ x: row[0], y: parsed.y[i] })) : []), [d, parsed.X, parsed.y]);
  const objective = BO_OBJECTIVES[config.boObjective];

  return (
    <>
      <ToolHeader toolId="gaussian-process" />
      <div className="oc-workspace">
        <div className="oc-stack">
          {outOfRange.length > 0 && (
            <Notice tone="warning" title="A setting is outside the range its field allows" items={outOfRange} />
          )}
          {/* -------------------------------------------------- 1. Data */}
          <Card title="Data" hint="One observation per line: the input coordinates, then the target.">
            <TextField
              label="Observations (inputs then target, comma or space separated)"
              value={config.dataText}
              onChange={(dataText) => set({ dataText })}
              multiline
              rows={10}
              monospace
              maxLength={400_000}
              hint="Lines beginning with # are ignored. With two or more inputs per line the fit is multi-dimensional and the length scales rank the inputs."
            />
            <div className="oc-btn-row">
              <Button icon="reset" onClick={() => set({ dataText: BUILT_IN_DATA_TEXT })}>
                Load the built-in dataset
              </Button>
            </div>
            <KeyValueList
              items={[
                { label: 'Observations used', value: `${n.toLocaleString('en-US')}` },
                { label: 'Input dimensions', value: `${d}` },
                { label: 'Exact-inference limit', value: `n = ${GP_LIMITS.maxExactN} (absolute cap ${GP_LIMITS.absoluteMaxN})` },
                { label: 'Covariance matrix and factor', value: n > 0 ? describeBytes(covarianceMemoryBytes(n)) : 'nothing to store' },
              ]}
            />
            {config.dataText === BUILT_IN_DATA_TEXT && (
              <Notice tone="info" title="This is synthetic demonstration data">
                <p style={{ margin: 0 }}>
                  30 noisy observations of sin(x) + 0.35·cos(2.1x) on [0, 10] with the interval between x = 4 and x = 6 left out. The gap is deliberate: it is
                  where the posterior has to widen, which is the property this screen exists to show. Replace it with your own data at any time.
                </p>
              </Notice>
            )}
            {nearLimit && (
              <Notice tone="warning" title="Approaching the exact-inference limit">
                <p style={{ margin: 0 }}>
                  Exact inference needs an n×n matrix and its Cholesky factor, O(n³) work and O(n²) memory. At n = {n} that is{' '}
                  {describeBytes(covarianceMemoryBytes(n))}. Above n = {GP_LIMITS.maxExactN} the engine refuses rather than freezing the page; use the sparse
                  approximations below, which are labelled with their bias direction.
                </p>
              </Notice>
            )}
            {parsed.truncated > 0 && (
              <Notice tone="warning">
                {parsed.truncated.toLocaleString('en-US')} line(s) past the first {MAX_ROWS.toLocaleString('en-US')} were not read. Nothing was averaged or
                summarised: they were simply not used.
              </Notice>
            )}
            {parsed.skipped.length > 0 && (
              <Notice tone="warning" title={`${parsed.skipped.length} line(s) could not be read`}>
                <ul style={{ margin: 0, paddingLeft: 'var(--s4)', fontSize: 12.5 }}>
                  {parsed.skipped.slice(0, 12).map((s) => (
                    <li key={s.line}>
                      Line {s.line}: {s.reason} — <span style={{ fontFamily: 'var(--font-mono)' }}>{s.text}</span>
                    </li>
                  ))}
                  {parsed.skipped.length > 12 && <li>…and {parsed.skipped.length - 12} more.</li>}
                </ul>
              </Notice>
            )}
            {n === 0 && <Notice tone="error">There are no usable observations, so there is nothing to condition on. A GP with no data is its prior.</Notice>}
          </Card>

          {/* -------------------------------------------------- 2. Kernel */}
          <Card title="Kernel" hint="The kernel is the entire prior over functions, and its smoothness assumption is the strongest thing in it.">
            <SelectField
              label="Kernel"
              value={config.kernelId}
              onChange={(kernelId) => set({ kernelId: kernelId as KernelId, kernelParams: {} })}
              options={KERNEL_IDS.map((id) => ({ value: id, label: KERNEL_DEFS[id].name }))}
            />
            <SelectField
              label="Composition"
              value={config.composition}
              onChange={(composition) => set({ composition: composition as GaussianProcessConfig['composition'], kernelParams: {} })}
              options={[
                { value: 'single', label: 'A single kernel' },
                { value: 'sum', label: 'Sum of two kernels (additive structure: trend + seasonality)' },
                { value: 'product', label: 'Product of two kernels (interaction: a periodic term that decays)' },
              ]}
              hint="Composition is where a GP becomes expressive enough to say something structural about the function."
            />
            {config.composition !== 'single' && (
              <SelectField
                label="Second kernel"
                value={config.secondKernelId}
                onChange={(secondKernelId) => set({ secondKernelId: secondKernelId as KernelId, kernelParams: {} })}
                options={KERNEL_IDS.map((id) => ({ value: id, label: KERNEL_DEFS[id].name }))}
              />
            )}
            <Checkbox
              checked={config.scaleVariance !== null}
              onChange={(on) => set({ scaleVariance: on ? 1 : null, kernelParams: {} })}
              label="Wrap the kernel in an outer scaling factor"
              description="Sets the overall amplitude separately from the kernel's own signal variance."
            />
            {config.scaleVariance !== null && (
              <NumberField label="Outer scale variance" value={config.scaleVariance} onChange={(scaleVariance) => set({ scaleVariance })} min={1e-9} />
            )}

            {!probe.ok && <Notice tone="error">{probe.error}</Notice>}
            {probe.ok && kernelValues && (
              <>
                <p className="oc-chart-note">Compiled kernel: {probe.value.label}</p>
                {probe.value.slots.map((slot, i) => (
                  <NumberField
                    key={slot.name}
                    label={slotLabel(probe.value, i)}
                    value={kernelValues[i]}
                    onChange={(v) => set({ kernelParams: { ...config.kernelParams, [slot.name]: v } })}
                    min={slot.positive ? 1e-9 : undefined}
                    hint={slot.trainable ? slot.name : `${slot.name} — held fixed, not fitted`}
                  />
                ))}
              </>
            )}

            <NumberField
              label="Observation-noise variance σ²"
              value={config.noiseVariance}
              onChange={(noiseVariance) => set({ noiseVariance })}
              min={0}
              hint="0 means noise-free interpolation: the posterior mean passes through every target and the two intervals coincide."
            />
            <SelectField label="Mean function" value={config.meanKind} onChange={(meanKind) => set({ meanKind: meanKind as GaussianProcessConfig['meanKind'] })} options={MEAN_OPTIONS} />
            {config.meanKind === 'polynomial' && (
              <NumberField label="Polynomial drift degree" value={config.polynomialDegree} onChange={(polynomialDegree) => set({ polynomialDegree })} min={0} max={3} integer />
            )}

            {kernelDefs.map((def) => (
              <Disclosure key={def.id} title={`${def.name}: what it assumes`} icon="info">
                <p style={{ fontSize: 12.5 }}>{def.description}</p>
                <div className="oc-explanation__formula">{def.formula}</div>
                <p style={{ fontSize: 12.5 }}>
                  <strong>Smoothness.</strong> {def.smoothness}
                </p>
                <p style={{ fontSize: 12.5 }}>
                  Mean-square differentiable sample paths: {def.meanSquareDerivatives === null ? 'infinitely many, or not a finite count' : def.meanSquareDerivatives}
                  {' · '}
                  {def.stationary ? 'stationary' : 'not stationary'}
                </p>
                {def.guidance && (
                  <Notice tone={def.id === 'matern52' ? 'success' : 'warning'} title={def.id === 'matern52' ? 'Recommended' : 'Discouraged as a default'}>
                    <p style={{ margin: 0 }}>{def.guidance}</p>
                  </Notice>
                )}
                <ul className="oc-assumption-list">
                  {def.limitations.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </Disclosure>
            ))}
          </Card>

          <Card title="Display" variant="inset">
            <NumberField label="Interval level" value={config.level} onChange={(level) => set({ level })} min={0.5} max={0.999} step={0.01} hint="Central mass of both intervals." />
            <NumberField label="Test points across the range" value={config.gridPoints} onChange={(gridPoints) => set({ gridPoints })} min={8} max={2000} integer />
            <NumberField
              label="Extrapolation past the data"
              value={config.extrapolation}
              onChange={(extrapolation) => set({ extrapolation })}
              min={0}
              max={2}
              step={0.05}
              hint="As a fraction of the data range, on each side. Leave some: how fast the uncertainty grows out there is the most informative part of the plot."
            />
            <NumberField label="Sampled functions" value={config.sampleCount} onChange={(sampleCount) => set({ sampleCount })} min={1} max={20} integer />
            <TextField label="Random seed for sampling" value={config.sampleSeed} onChange={(sampleSeed) => set({ sampleSeed })} maxLength={64} monospace />
          </Card>

          <AiAssistPanel
            capability="explainUncertainty"
            context="The two intervals below answer different questions: the credible interval is for the latent function f(x), the predictive interval is for a new noisy observation. They differ by the observation-noise variance you set in the Kernel card."
          />
        </div>

        <div className="oc-stack">
          {/* -------------------------------------------------- 3. Prediction */}
          <Card title="Prediction" hint="The headline: the posterior mean with both intervals, which are different statements.">
            {!model && <Notice tone="info">Enter at least one observation to condition the process.</Notice>}
            {model && !model.ok && <Notice tone="error">{model.error}</Notice>}
            {prediction && !prediction.ok && <Notice tone="error">{prediction.error}</Notice>}
            {fitted && prediction && prediction.ok && (
              <>
                <Notice tone="info" title="Two intervals, and they are not interchangeable">
                  <p style={{ marginTop: 0 }}>
                    <strong>Credible interval for the latent function f(x)</strong> — where the unknown function itself lies, given the data and the kernel.
                  </p>
                  <p style={{ marginBottom: 0 }}>
                    <strong>Predictive interval for a new observation y(x) = f(x) + ε</strong> — where the next measurement would fall. It is wider by exactly
                    the noise variance σ² = {formatValue(config.noiseVariance, 4)}, and it is the one to use for a statement about a future reading.
                  </p>
                </Notice>
                {grid && (
                  <>
                    <div style={{ overflowX: 'auto' }}>
                      <LineChart
                        title={`Posterior mean with the ${Math.round(config.level * 100)}% latent and predictive intervals`}
                        description="The solid pair of edges is the credible interval for the latent function; the dashed pair is the predictive interval for a new noisy observation, wider by the noise variance. Training observations are marked."
                        series={[
                          { label: 'Posterior mean', points: prediction.value.predictions.map((p) => ({ x: p.x[0], y: p.mean })) },
                          { label: `Latent f(x), lower (${Math.round(config.level * 100)}%)`, points: prediction.value.predictions.map((p) => ({ x: p.x[0], y: p.latentInterval.lower })) },
                          { label: `Latent f(x), upper (${Math.round(config.level * 100)}%)`, points: prediction.value.predictions.map((p) => ({ x: p.x[0], y: p.latentInterval.upper })) },
                          { label: `New observation y(x), lower (${Math.round(config.level * 100)}%)`, dashed: true, points: prediction.value.predictions.map((p) => ({ x: p.x[0], y: p.predictiveInterval.lower })) },
                          { label: `New observation y(x), upper (${Math.round(config.level * 100)}%)`, dashed: true, points: prediction.value.predictions.map((p) => ({ x: p.x[0], y: p.predictiveInterval.upper })) },
                        ]}
                        markers={trainingPoints.map((p) => ({ x: p.x, y: p.y, label: 'Training observation' }))}
                        xLabel="Input x"
                        yLabel="Output"
                        note="The interval edges are labelled, and the two kinds are additionally drawn solid and dashed, so the distinction does not depend on colour."
                      />
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <FanChart
                        title={`Credible interval for the latent function, shaded (${Math.round(config.level * 100)}%)`}
                        description="The same latent interval as a shaded band, so the widening away from the data is visible at a glance. The band is about the function, not about a single future observation."
                        x={prediction.value.predictions.map((p) => p.x[0])}
                        bands={[
                          {
                            label: `Latent f(x), ${Math.round(config.level * 100)}%`,
                            lower: prediction.value.predictions.map((p) => p.latentInterval.lower),
                            upper: prediction.value.predictions.map((p) => p.latentInterval.upper),
                          },
                        ]}
                        center={{ label: 'Posterior mean', values: prediction.value.predictions.map((p) => p.mean) }}
                        bandMeaning="mean-uncertainty"
                        observed={{ label: 'Training observations (in input order)', points: [...trainingPoints].sort((a, b) => a.x - b.x) }}
                        xLabel="Input x"
                        yLabel="Output"
                        note="For a new noisy observation the band would be wider by the noise variance; that interval is drawn in the chart above."
                      />
                    </div>
                  </>
                )}
                {!grid && (
                  <>
                    <Notice tone="info" title="More than one input">
                      <p style={{ margin: 0 }}>
                        With {d} inputs the posterior is a surface, not a curve, so it is not drawn as one. The predictions at the training inputs are tabulated
                        below, and the fitted length scales in the hyperparameter card rank the inputs.
                      </p>
                    </Notice>
                    <div style={{ overflowX: 'auto' }}>
                      <DataTable
                        caption="Predictions at the training inputs"
                        maxHeight={320}
                        columns={predictionColumns(d, config.level)}
                        rows={prediction.value.predictions.slice(0, 200).map((p) => p)}
                      />
                    </div>
                  </>
                )}
                <KeyValueList
                  items={[
                    { label: 'Log marginal likelihood', value: formatValue(fitted.logMarginalLikelihood, 6) },
                    { label: 'Widest latent interval', value: formatValue(Math.max(...prediction.value.predictions.map((p) => p.latentInterval.upper - p.latentInterval.lower)), 4) },
                    { label: 'Narrowest latent interval', value: formatValue(Math.min(...prediction.value.predictions.map((p) => p.latentInterval.upper - p.latentInterval.lower)), 4) },
                    { label: 'Exactness', value: <Badge variant={prediction.value.exactness}>{prediction.value.exactness}</Badge> },
                  ]}
                />
                {prediction.value.notes.length > 0 && <Notice tone="info" items={[...prediction.value.notes]} />}
                {prediction.value.warnings.length > 0 && <Notice tone="warning" items={[...prediction.value.warnings]} />}
              </>
            )}
          </Card>

          {/* -------------------------------------------------- 4. Sampled functions */}
          <Card title="Sampled functions" hint="What is being inferred is a function, not a parameter. These are whole functions drawn from the prior and from the posterior.">
            {!sampleGrid && <Notice tone="info">Sampled functions are drawn for a single input dimension.</Notice>}
            {priorSamples && !priorSamples.ok && <Notice tone="error">{priorSamples.error}</Notice>}
            {priorSamples && priorSamples.ok && sampleGrid && (
              <div style={{ overflowX: 'auto' }}>
                <LineChart
                  title={`${sampleCount} functions drawn from the PRIOR`}
                  description="Before any data. These are what the kernel believes a function looks like; if they look nothing like the process you are modelling, the kernel is wrong."
                  series={priorSamples.value.samples.map((s, i) => ({ label: `Prior draw ${i + 1}`, points: sampleGrid.map((x, j) => ({ x: x[0], y: s[j] })) }))}
                  xLabel="Input x"
                  yLabel="Output"
                  note={priorSamples.value.note}
                />
              </div>
            )}
            {posteriorSamples && !posteriorSamples.ok && <Notice tone="error">{posteriorSamples.error}</Notice>}
            {posteriorSamples && posteriorSamples.ok && sampleGrid && (
              <div style={{ overflowX: 'auto' }}>
                <LineChart
                  title={`${sampleCount} functions drawn from the POSTERIOR`}
                  description="After conditioning. The draws are pinned together where there is data and fan out where there is none — each one is a complete function that is consistent with the observations."
                  series={posteriorSamples.value.samples.map((s, i) => ({ label: `Posterior draw ${i + 1}`, points: sampleGrid.map((x, j) => ({ x: x[0], y: s[j] })) }))}
                  markers={trainingPoints.map((p) => ({ x: p.x, y: p.y, label: 'Training observation' }))}
                  xLabel="Input x"
                  yLabel="Output"
                  note={posteriorSamples.value.note}
                />
              </div>
            )}
            {posteriorSamples && posteriorSamples.ok && (
              <Notice tone="info" title="These draws are empirical">
                <p style={{ margin: 0 }}>
                  A finite set of draws is a Monte Carlo picture of the posterior, not a quantitative statement about it. The intervals in the prediction card
                  are the exact statement; a different seed gives different draws.
                </p>
              </Notice>
            )}
          </Card>

          {/* -------------------------------------------------- 5. Hyperparameters */}
          <Card title="Hyperparameters" hint="Multi-restart marginal-likelihood fitting. Every restart is reported, because a single one hides a multimodal objective.">
            <NumberField label="Restarts" value={config.fitRestarts} onChange={(fitRestarts) => set({ fitRestarts })} min={1} max={32} integer />
            <Checkbox
              checked={config.fitNoise}
              onChange={(fitNoise) => set({ fitNoise })}
              label="Fit the noise variance as well"
              description="Needs a positive starting value: log 0 is not a number, so with σ² = 0 the noise is held fixed."
            />
            {!config.runFit ? (
              <>
                <Notice tone="info" title="The hyperparameter fit is not run automatically">
                  <p style={{ marginTop: 0 }}>
                    Each restart runs a quasi-Newton optimisation whose every step rebuilds the n×n covariance matrix, factorises it and forms the gradient
                    matrices. With n = {n} and {fitRestarts} restarts that is a few hundred O(n³) factorisations, which is why it runs in a
                    background worker and only when you ask for it: the page stays usable while it runs and the fit can be cancelled.
                  </p>
                  <p style={{ marginBottom: 0 }}>
                    Until then the predictions above use the hyperparameters you set by hand, and they are exact given those values.
                  </p>
                </Notice>
                <div className="oc-btn-row">
                  <Button icon="play" variant="primary" disabled={n === 0 || !probe.ok} onClick={() => set({ runFit: true })}>
                    Fit the hyperparameters
                  </Button>
                </div>
              </>
            ) : (
              <EngineJobPanel
                job={fitJob}
                onClear={() => set({ runFit: false })}
                clearLabel="Stop fitting"
                unitLabel="restarts"
                errorTitle="The hyperparameter fit failed"
                testId="gp-fit"
              >
                {!fit ? (
                  <Notice tone="info">There is nothing to fit yet.</Notice>
                ) : !fit.ok ? (
                  <Notice tone="error" title="The fitted model could not be rebuilt">
                    {fit.error}
                  </Notice>
                ) : (
              <>
                <Notice tone={fit.value.fit.identifiable ? 'success' : 'warning'} title={fit.value.fit.identifiable ? 'The fit appears identified' : 'The hyperparameters are NOT identified by this data'}>
                  <p style={{ margin: 0 }}>{fit.value.fit.note}</p>
                </Notice>
                <KeyValueList
                  items={[
                    { label: 'Restarts run', value: `${fit.value.fit.restarts}` },
                    { label: 'Restarts that converged', value: `${fit.value.fit.convergedRestarts}` },
                    { label: 'Best log marginal likelihood', value: formatValue(fit.value.fit.best.logMarginalLikelihood, 6) },
                    { label: 'Range across converged restarts', value: `${formatValue(fit.value.fit.logMarginalLikelihoodRange[0], 6)} to ${formatValue(fit.value.fit.logMarginalLikelihoodRange[1], 6)}` },
                    { label: 'Standard deviation across restarts', value: formatValue(fit.value.fit.logMarginalLikelihoodSd, 4) },
                    { label: 'Identified', value: fit.value.fit.identifiable ? 'Yes — restarts agree' : 'No — restarts reached different optima' },
                    { label: 'Exactness', value: <Badge variant={fit.value.fit.exactness}>{fit.value.fit.exactness}</Badge> },
                  ]}
                />
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Every restart of the marginal-likelihood optimiser"
                    maxHeight={300}
                    columns={restartColumns()}
                    rows={[...fit.value.fit.outcomes]}
                  />
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Fitted hyperparameters at the best optimum"
                    columns={[
                      { key: 'name', header: 'Parameter', render: (r) => (r as { name: string }).name },
                      { key: 'value', header: 'Fitted value', numeric: true, render: (r) => formatValue((r as { value: number }).value, 6) },
                    ]}
                    rows={fit.value.model.kernel.slots.map((slot, i) => ({ name: slot.name, value: fit.value.model.kernel.values[i] })).concat(
                      config.fitNoise && config.noiseVariance > 0 ? [{ name: 'noiseVariance', value: fit.value.model.noiseVariance }] : [],
                    )}
                  />
                </div>
                <div className="oc-btn-row">
                  <Button
                    icon="check"
                    variant="primary"
                    onClick={() => {
                      const next: Record<string, number> = { ...config.kernelParams };
                      fit.value.model.kernel.slots.forEach((slot, i) => {
                        next[slot.name] = fit.value.model.kernel.values[i];
                      });
                      set({
                        kernelParams: next,
                        noiseVariance: config.fitNoise && config.noiseVariance > 0 ? fit.value.model.noiseVariance : config.noiseVariance,
                        runFit: false,
                      });
                    }}
                  >
                    Use these hyperparameters
                  </Button>
                  <Button onClick={() => set({ runFit: false })}>Keep my own values</Button>
                </div>
                {!fit.value.fit.identifiable && (
                  <Notice tone="warning" title="Why one number would be misleading here">
                    <p style={{ margin: 0 }}>
                      The marginal likelihood of a GP is typically multimodal: one optimum explains the data as signal with a short length scale, another as
                      noise with a long one. The restarts above reached materially different optima, so a single fitted value is a choice among them, not an
                      estimate the data supports.
                    </p>
                  </Notice>
                )}
              </>
                )}
              </EngineJobPanel>
            )}

            {ard && (
              <Disclosure title="Automatic relevance determination: which inputs matter" icon="sensitivity" defaultOpen={d > 1}>
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Fitted length scales and the input ranking they imply"
                    columns={[
                      { key: 'dim', header: 'Input', numeric: true, render: (r) => `${(r as ArdReport['entries'][number]).dimension + 1}` },
                      { key: 'ls', header: 'Length scale ℓ', numeric: true, render: (r) => formatValue((r as ArdReport['entries'][number]).lengthScale, 5) },
                      { key: 'rel', header: 'Relevance 1/ℓ', numeric: true, render: (r) => formatValue((r as ArdReport['entries'][number]).relevance, 5) },
                      { key: 'share', header: 'Share of relevance', numeric: true, render: (r) => `${((r as ArdReport['entries'][number]).relevanceShare * 100).toFixed(1)}%` },
                      { key: 'rank', header: 'Rank', numeric: true, render: (r) => `${(r as ArdReport['entries'][number]).rank}` },
                    ]}
                    rows={[...ard.entries]}
                  />
                </div>
                <p style={{ fontSize: 12.5 }}>{ard.note}</p>
                <ul className="oc-assumption-list">
                  {ard.limitations.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
                <Badge variant={ard.exactness}>{ard.exactness}</Badge>
              </Disclosure>
            )}
          </Card>

          {/* -------------------------------------------------- 6. Jitter */}
          <Card title="Jitter and conditioning" hint="Close or duplicate inputs make the covariance matrix numerically singular. Any jitter added is reported, not hidden.">
            {!fitted && <Notice tone="info">No factorisation has been attempted yet.</Notice>}
            {fitted && (
              <>
                <KeyValueList
                  items={[
                    { label: 'Jitter needed', value: fitted.jitter.needed ? 'Yes' : 'No' },
                    { label: 'Jitter added to the diagonal', value: fitted.jitter.added === 0 ? 'none' : fitted.jitter.added.toExponential(3) },
                    { label: 'Jitter values tried', value: fitted.jitter.attempts.length === 0 ? 'none needed' : fitted.jitter.attempts.map((a) => a.toExponential(1)).join(', ') },
                  ]}
                />
                <Notice tone={fitted.jitter.needed ? 'warning' : 'success'} title={fitted.jitter.needed ? 'Jitter was added, so this is not the model as specified' : 'No jitter was needed'}>
                  <p style={{ margin: 0 }}>{fitted.jitter.note}</p>
                </Notice>
                {fitted.warnings.length > 0 && <Notice tone="warning" items={[...fitted.warnings]} />}
                <p className="oc-chart-note">
                  If no amount of jitter restores positive definiteness the engine refuses and names the smallest eigenvalue of the matrix, rather than
                  returning numbers from a factorisation that did not succeed. That refusal appears as an error above the chart.
                </p>
              </>
            )}
          </Card>

          {/* -------------------------------------------------- 7. Calibration */}
          <Card title="Is the uncertainty calibrated?" hint="Leave-one-out cross-validation, exact and free from the Cholesky factor already computed.">
            {!loo && <Notice tone="info">Condition the process first.</Notice>}
            {loo && !loo.ok && <Notice tone="warning">{loo.error}</Notice>}
            {loo && loo.ok && (
              <>
                <KeyValueList
                  items={[
                    { label: 'Log predictive density (higher is better)', value: formatValue(loo.value.logPredictiveDensity, 6) },
                    { label: 'Mean squared error', value: formatValue(loo.value.meanSquaredError, 6) },
                    { label: 'Variance of the standardised residuals', value: formatValue(variance(loo.value.standardisedResiduals), 4) },
                    { label: 'Exactness', value: <Badge variant={loo.value.exactness}>{loo.value.exactness}</Badge> },
                  ]}
                />
                <Notice tone={Math.abs(variance(loo.value.standardisedResiduals) - 1) < 0.35 ? 'success' : 'warning'} title="How to read this">
                  <p style={{ marginTop: 0 }}>
                    A standardised leave-one-out residual is (yᵢ − μ₋ᵢ)/σ₋ᵢ. If the uncertainty is honest their variance is about 1. Much above 1 means the
                    intervals are too narrow — the model is overconfident. Much below 1 means they are needlessly wide.
                  </p>
                  <p style={{ marginBottom: 0 }}>{loo.value.note}</p>
                </Notice>
                {looQq && (
                  <div style={{ overflowX: 'auto' }}>
                    <QQChart
                      title="Normal Q–Q plot of the standardised leave-one-out residuals"
                      description="Points on the 45° line mean the leave-one-out predictive distributions have the right shape as well as the right scale. A systematic S-shape means the kernel's smoothness assumption is wrong."
                      points={looQq}
                      referenceLine={{ slope: 1, intercept: 0, label: 'Standard normal reference' }}
                    />
                  </div>
                )}
                {d === 1 && (
                  <div style={{ overflowX: 'auto' }}>
                    <ScatterChart
                      title="Standardised leave-one-out residual against the input"
                      description="A pattern here means the misfit depends on where you are in the input space, which a stationary kernel cannot represent."
                      points={parsed.X.map((row, i) => ({ x: row[0], y: loo.value.standardisedResiduals[i] }))}
                      xLabel="Input x"
                      yLabel="Standardised LOO residual"
                    />
                  </div>
                )}
              </>
            )}
          </Card>

          {/* -------------------------------------------------- 8. Bayesian optimisation */}
          <Card title="Bayesian optimisation" hint="Where the next evaluation goes, and why.">
            <SelectField
              label="Acquisition function"
              value={config.acquisition}
              onChange={(acquisition) => set({ acquisition: acquisition as GpAcquisitionKind })}
              options={ACQUISITION_OPTIONS}
            />
            <Notice tone="info" title="What this acquisition does">
              <p style={{ margin: 0 }}>{ACQUISITION_NOTES[config.acquisition]}</p>
            </Notice>
            {(config.acquisition === 'expected-improvement' || config.acquisition === 'probability-of-improvement') && (
              <NumberField label="Improvement threshold ξ" value={config.acquisitionXi} onChange={(acquisitionXi) => set({ acquisitionXi })} min={0} step={0.01} hint="Requires an improvement of at least ξ before a point counts as better. Larger ξ explores more." />
            )}
            {config.acquisition === 'lower-confidence-bound' && (
              <>
                <SelectField
                  label="β schedule"
                  value={config.ucbBetaMode}
                  onChange={(ucbBetaMode) => set({ ucbBetaMode: ucbBetaMode as GaussianProcessConfig['ucbBetaMode'] })}
                  options={[
                    { value: 'schedule', label: 'Growing schedule β_t = 2·log(t^(d/2+2)·π²/3δ) (Srinivas et al. 2010)' },
                    { value: 'fixed', label: 'Fixed β' },
                  ]}
                  hint="The regret bound requires β to grow with the iteration count. A fixed β explores harder early and less later."
                />
                {config.ucbBetaMode === 'fixed' && (
                  <NumberField label="Fixed β" value={config.ucbBetaFixed} onChange={(ucbBetaFixed) => set({ ucbBetaFixed })} min={0} step={0.5} hint="β = 2 is roughly two standard deviations." />
                )}
              </>
            )}

            {acquisitionCurve && grid && prediction && prediction.ok && (
              <div style={{ overflowX: 'auto' }}>
                <LineChart
                  title="The acquisition beside the posterior it is computed from"
                  description="The acquisition is a function of the posterior mean and standard deviation at each input, so it is high where the mean is low, where the uncertainty is large, or both. Its extremum is where the next evaluation goes."
                  series={[
                    { label: 'Posterior mean', points: prediction.value.predictions.map((p) => ({ x: p.x[0], y: p.mean })) },
                    { label: acquisitionCurve.label, dashed: true, area: true, points: acquisitionCurve.points },
                  ]}
                  markers={acquisitionArg ? [{ x: acquisitionArg.x, y: acquisitionArg.y, label: 'Next evaluation' }] : undefined}
                  referenceLines={acquisitionArg ? [{ value: acquisitionArg.x, label: `Next evaluation at x = ${formatValue(acquisitionArg.x, 4)}`, axis: 'x' }] : undefined}
                  xLabel="Input x"
                  yLabel="Posterior mean and acquisition"
                  note={`Incumbent (lowest target in the data above): ${incumbent === null ? 'none' : formatValue(incumbent, 5)}. This panel uses the dataset at the top of the screen as if it were an optimisation history, which is what makes the acquisition visible beside the posterior.`}
                />
              </div>
            )}
            {config.acquisition === 'knowledge-gradient' && (
              <Notice tone="info" title="The knowledge gradient is not drawn here">
                <p style={{ margin: 0 }}>
                  It needs the full predictive covariance between each candidate and every other, at O(m² log m) per point, so plotting it over a grid costs
                  more than the whole rest of this screen. It is available in the loop below, where it is evaluated over the candidate set only.
                </p>
              </Notice>
            )}

            <SelectField
              label="Test objective"
              value={config.boObjective}
              onChange={(boObjective) => set({ boObjective: boObjective as GaussianProcessConfig['boObjective'] })}
              options={Object.entries(BO_OBJECTIVES).map(([value, o]) => ({ value, label: o.label }))}
              hint={objective.note}
            />
            <NumberField label="Iterations" value={config.boIterations} onChange={(boIterations) => set({ boIterations })} min={1} max={60} integer />
            <NumberField label="Objective noise variance" value={config.boNoiseVariance} onChange={(boNoiseVariance) => set({ boNoiseVariance })} min={0} step={0.005} hint="With noise above 0 the recommendation is the best posterior mean rather than the best observed value." />
            <TextField label="Seed for the optimisation" value={config.boSeed} onChange={(boSeed) => set({ boSeed })} maxLength={64} monospace />

            {!config.runOptimisation ? (
              <>
                <Notice tone="info" title="The optimisation loop is not run automatically">
                  <p style={{ marginTop: 0 }}>
                    Every iteration refits the surrogate GP and maximises the acquisition over a low-discrepancy candidate set, so {boIterations}{' '}
                    iterations are {boIterations} GP fits and acquisition searches. That is seconds of work, which is why it is behind this button, and
                    it runs through the engine's generator so it can be cancelled part-way.
                  </p>
                  <p style={{ marginBottom: 0 }}>
                    Bayesian optimisation gives <strong>no guarantee</strong> of finding a global optimum in a finite number of evaluations. It is a strategy
                    for spending a limited budget well, not a proof.
                  </p>
                </Notice>
                <div className="oc-btn-row">
                  <Button
                    icon="play"
                    variant="primary"
                    onClick={() => {
                      set({ runOptimisation: true });
                      startOptimisation();
                    }}
                  >
                    Run the optimisation
                  </Button>
                </div>
              </>
            ) : (
              <>
                {bo.status === 'running' && (
                  <>
                    <RunningState completed={bo.done} total={bo.total} unitLabel="iterations" onCancel={cancelOptimisation} />
                    {bo.latest && (
                      <KeyValueList
                        items={[
                          { label: 'Evaluations so far', value: `${bo.latest.evaluations}` },
                          { label: 'Best observed value', value: formatValue(bo.latest.bestObserved.y, 6) },
                          { label: 'Best posterior mean', value: `${formatValue(bo.latest.bestPosteriorMean.mean, 6)} (sd ${formatValue(bo.latest.bestPosteriorMean.sd, 4)})` },
                          { label: 'Surrogate log marginal likelihood', value: formatValue(bo.latest.logMarginalLikelihood, 5) },
                        ]}
                      />
                    )}
                  </>
                )}
                {bo.status === 'cancelled' && (
                  <Notice tone="warning" title="The run was cancelled">
                    <p style={{ margin: 0 }}>
                      It stopped after {bo.done} iteration(s) and no final result is reported for a cancelled run: a partial trace is not an optimisation
                      result. Run it again to get one.
                    </p>
                  </Notice>
                )}
                {bo.status === 'error' && <Notice tone="error">{bo.message}</Notice>}
                {bo.status === 'done' && <BayesOptReport result={bo.result} />}
                <div className="oc-btn-row">
                  <Button icon="play" variant="primary" disabled={bo.status === 'running'} onClick={startOptimisation}>
                    {bo.status === 'idle' ? 'Run the optimisation' : 'Run again'}
                  </Button>
                  <Button disabled={bo.status === 'running'} onClick={() => { setBo({ status: 'idle' }); set({ runOptimisation: false }); }}>
                    Put this away
                  </Button>
                </div>
              </>
            )}
          </Card>

          {/* -------------------------------------------------- 9. Sparse */}
          <Card title="Sparse approximations" hint="For an n beyond exact inference. Each one is an approximation, and each errs in a documented direction.">
            <Checkbox
              checked={config.showSparse}
              onChange={(showSparse) => set({ showSparse })}
              label="Compute a sparse approximation"
              description="Off by default so that opening the screen only does the exact work."
            />
            {config.showSparse && (
              <>
                <SelectField
                  label="Method"
                  value={config.sparseMethod}
                  onChange={(sparseMethod) => set({ sparseMethod: sparseMethod as SparseMethod })}
                  options={[
                    { value: 'subset-of-data', label: 'Subset of data — an exact GP on m points' },
                    { value: 'fitc', label: 'FITC — fully independent training conditional' },
                    { value: 'sor', label: 'SoR — subset of regressors (not recommended)' },
                  ]}
                />
                <NumberField label="Inducing points / retained observations m" value={config.inducingCount} onChange={(inducingCount) => set({ inducingCount })} min={1} max={Math.max(1, n)} integer />
                {sparse && !sparse.ok && <Notice tone="error">{sparse.error}</Notice>}
                {sparse && sparse.ok && (
                  <>
                    <Notice tone="warning" title="This is an approximation, and here is which way it errs">
                      <p style={{ margin: 0 }}>{sparse.value.sparse.biasDirection}</p>
                    </Notice>
                    <KeyValueList
                      items={[
                        { label: 'Method', value: sparse.value.sparse.method },
                        { label: 'Observations n', value: `${sparse.value.sparse.n}` },
                        { label: 'Inducing points m', value: `${sparse.value.sparse.m}` },
                        { label: 'Approximate log marginal likelihood', value: sparse.value.sparse.approximateLogMarginalLikelihood === null ? 'not defined for this method (it is exact on its own subset)' : formatValue(sparse.value.sparse.approximateLogMarginalLikelihood, 6) },
                        { label: 'Exactness', value: <Badge variant={sparse.value.sparse.exactness}>{sparse.value.sparse.exactness}</Badge> },
                      ]}
                    />
                    {grid && prediction && prediction.ok && (
                      <div style={{ overflowX: 'auto' }}>
                        <LineChart
                          title="The approximation against the exact GP"
                          description="The approximate mean and latent interval drawn over the exact ones. Where the approximate interval is narrower than the exact one, the approximation is claiming more certainty than the model has."
                          series={[
                            { label: 'Exact posterior mean', points: prediction.value.predictions.map((p) => ({ x: p.x[0], y: p.mean })) },
                            { label: 'Exact latent lower', points: prediction.value.predictions.map((p) => ({ x: p.x[0], y: p.latentInterval.lower })) },
                            { label: 'Exact latent upper', points: prediction.value.predictions.map((p) => ({ x: p.x[0], y: p.latentInterval.upper })) },
                            { label: 'Approximate mean', dashed: true, points: sparse.value.prediction.predictions.map((p) => ({ x: p.x[0], y: p.mean })) },
                            { label: 'Approximate latent lower', dashed: true, points: sparse.value.prediction.predictions.map((p) => ({ x: p.x[0], y: p.latentInterval.lower })) },
                            { label: 'Approximate latent upper', dashed: true, points: sparse.value.prediction.predictions.map((p) => ({ x: p.x[0], y: p.latentInterval.upper })) },
                          ]}
                          xLabel="Input x"
                          yLabel="Output"
                          note="Approximate series are dashed and labelled, so the comparison does not rely on colour."
                        />
                      </div>
                    )}
                    <ul className="oc-assumption-list">
                      {sparse.value.sparse.limitations.map((l, i) => (
                        <li key={i}>{l}</li>
                      ))}
                    </ul>
                    {sparse.value.prediction.notes.length > 0 && <Notice tone="info" items={[...sparse.value.prediction.notes]} />}
                  </>
                )}
              </>
            )}
          </Card>

          {/* -------------------------------------------------- 10. Explanation */}
          <Card title="How this result was produced">
            <ExplanationPanel explanation={explanation} defaultOpen />
            <Notice tone="info" title="Which parts are exact and which are not">
              <ul style={{ margin: 0, paddingLeft: 'var(--s4)' }}>
                <li>
                  <strong>Exact</strong> — the predictive mean and both variances given the hyperparameters, and the leave-one-out identity.
                </li>
                <li>
                  <strong>Numerical</strong> — hyperparameter fits, acquisition maximisation, and the sparse approximations, which additionally carry a bias.
                </li>
                <li>
                  <strong>Empirical</strong> — sampled functions and the Bayesian-optimisation trace: a different seed gives a different answer.
                </li>
              </ul>
            </Notice>
          </Card>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Sub-components and small pure helpers
 * ------------------------------------------------------------------ */

/** The Bayesian-optimisation result, with the two honesty points made plainly. */
function BayesOptReport({ result }: { result: BayesOptResult }) {
  const firstDim = result.observations.every((o) => o.x.length === 1);
  return (
    <>
      <Notice tone="info" title="The recommendation is not the best observation">
        <p style={{ marginTop: 0 }}>
          <strong>Recommended input:</strong> ({result.recommendation.x.map((v) => formatValue(v, 5)).join(', ')}), value{' '}
          {formatValue(result.recommendation.value, 6)}. {result.recommendation.basis}
        </p>
        <p style={{ marginBottom: 0 }}>
          Under noise the lowest value actually measured is usually a lucky draw, so the input with the lowest posterior mean is the honest recommendation. Both
          are shown below so the difference is visible.
        </p>
      </Notice>
      <KeyValueList
        items={[
          { label: 'Best observed value', value: `${formatValue(result.bestObserved.y, 6)} at (${result.bestObserved.x.map((v) => formatValue(v, 5)).join(', ')})` },
          { label: 'Best posterior mean', value: `${formatValue(result.bestPosteriorMean.mean, 6)} at (${result.bestPosteriorMean.x.map((v) => formatValue(v, 5)).join(', ')}), sd ${formatValue(result.bestPosteriorMean.sd, 4)}` },
          { label: 'Objective evaluations', value: `${result.evaluations}` },
          { label: 'Acquisition', value: result.acquisition },
          { label: 'Simple regret against the known optimum', value: result.simpleRegret === null ? 'no known optimum was supplied' : formatValue(result.simpleRegret, 6) },
          { label: 'Exactness', value: <Badge variant={result.exactness}>{result.exactness}</Badge> },
        ]}
      />
      {result.stoppedEarly && (
        <Notice tone="warning" title={`The loop stopped at iteration ${result.stoppedEarly.iteration}`}>
          <p style={{ margin: 0 }}>{result.stoppedEarly.reason}</p>
        </Notice>
      )}
      <div style={{ overflowX: 'auto' }}>
        <LineChart
          title="Best so far: observed value against best posterior mean"
          description="The observed trace is optimistic under noise and the posterior-mean trace is not, which is why they separate."
          series={[
            { label: 'Best observed value', points: result.history.map((h) => ({ x: h.iteration, y: h.bestObserved })) },
            { label: 'Best posterior mean', dashed: true, points: result.history.map((h) => ({ x: h.iteration, y: h.bestPosteriorMean })) },
          ]}
          xLabel="Iteration"
          yLabel="Objective value"
        />
      </div>
      {firstDim && (
        <div style={{ overflowX: 'auto' }}>
          <ScatterChart
            title="Where the evaluations went"
            description="Clustering around one region is exploitation; scattered points are exploration. Which pattern you see is the acquisition function's doing."
            points={result.observations.map((o) => ({ x: o.x[0], y: o.y }))}
            xLabel="Input x"
            yLabel="Objective value"
          />
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <DataTable
          caption="Every objective evaluation"
          maxHeight={300}
          columns={[
            { key: 'it', header: 'Iteration', numeric: true, render: (r) => `${(r as BayesOptResult['observations'][number]).iteration}` },
            { key: 'x', header: 'Input', render: (r) => (r as BayesOptResult['observations'][number]).x.map((v) => formatValue(v, 5)).join(', ') },
            { key: 'y', header: 'Value', numeric: true, render: (r) => formatValue((r as BayesOptResult['observations'][number]).y, 6) },
            { key: 'src', header: 'Chosen by', render: (r) => (r as BayesOptResult['observations'][number]).source },
          ]}
          rows={[...result.observations]}
        />
      </div>
      <p style={{ fontSize: 12.5 }}>{result.acquisitionNote}</p>
      {result.warnings.length > 0 && <Notice tone="warning" items={[...result.warnings]} />}
      <ul className="oc-assumption-list">
        {result.limitations.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </>
  );
}

function variance(values: readonly number[]): number {
  if (values.length < 2) return Number.NaN;
  const m = values.reduce((s, v) => s + v, 0) / values.length;
  return values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
}

function predictionColumns(d: number, level: number): ColumnDef<GpPredictionSet['predictions'][number]>[] {
  const pct = Math.round(level * 100);
  return [
    { key: 'x', header: d === 1 ? 'Input' : 'Inputs', render: (r) => r.x.map((v) => formatValue(v, 5)).join(', ') },
    { key: 'mean', header: 'Posterior mean', numeric: true, render: (r) => formatValue(r.mean, 5) },
    { key: 'lsd', header: 'Latent sd', numeric: true, render: (r) => formatValue(r.latentSd, 5) },
    { key: 'lat', header: `Latent f(x) ${pct}%`, numeric: true, render: (r) => `${formatValue(r.latentInterval.lower, 4)} to ${formatValue(r.latentInterval.upper, 4)}`, title: INTERVAL_LABEL['latent-credible'] },
    { key: 'psd', header: 'Predictive sd', numeric: true, render: (r) => formatValue(r.predictiveSd, 5) },
    { key: 'pred', header: `New observation y(x) ${pct}%`, numeric: true, render: (r) => `${formatValue(r.predictiveInterval.lower, 4)} to ${formatValue(r.predictiveInterval.upper, 4)}`, title: INTERVAL_LABEL.predictive },
  ];
}

function restartColumns(): ColumnDef<RestartOutcome>[] {
  return [
    { key: 'r', header: 'Restart', numeric: true, render: (r) => `${r.restart + 1}` },
    { key: 'lml', header: 'Log marginal likelihood', numeric: true, render: (r) => (Number.isFinite(r.logMarginalLikelihood) ? formatValue(r.logMarginalLikelihood, 6) : 'not finite') },
    { key: 'conv', header: 'Converged', render: (r) => (r.converged ? 'Yes' : 'No') },
    { key: 'it', header: 'Iterations', numeric: true, render: (r) => `${r.iterations}` },
    { key: 'why', header: 'Optimiser outcome', render: (r) => r.reason },
    { key: 'theta', header: 'Final log-parameters', render: (r) => r.finalLog.map((v) => formatValue(v, 4)).join(', ') },
  ];
}
