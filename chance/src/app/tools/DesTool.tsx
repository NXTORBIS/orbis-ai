/**
 * General discrete-event simulation.
 *
 * The simulation tool elsewhere in the app runs a fixed set of Monte Carlo
 * models; this screen drives the event-scheduling engine in `src/engine/des`,
 * so a real system — a clinic, a line, a call centre — can be expressed,
 * measured and then checked against theory.
 *
 * Two rules shape the whole layout. First, nothing runs on open: a
 * steady-state run is seconds of synchronous work, so every run sits behind a
 * button and is driven through the engine's `desSteps` generator, which yields
 * between chunks of events and is what makes the Cancel button real. Second,
 * no mean is shown without the machinery that makes it a statement: the
 * time-weighted/tally distinction, the Monte Carlo standard error, the warm-up
 * that was discarded, and the batch independence test the interval depends on.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DES_MODELS,
  batchMeans,
  commonRandomNumbersReport,
  desSteps,
  getDesModel,
  mser5,
  plainMonteCarloRareEvent,
  replicationAnalysis,
  subsetSimulation,
  validateQueueAgainstTheory,
  welchWarmup,
  type AnyDesModel,
  type BatchMeansReport,
  type CrnReport,
  type DesMetric,
  type DesRunReport,
  type PlainRareEventReport,
  type ReplicationReport,
  type SubsetSimulationResult,
  type TallyReport,
  type ValidationFamily,
  type ValidationReport,
  type WarmupReport,
  type WelchReport,
} from '../../engine/des';
import { EngineError, type Explanation, type Issue } from '../../engine/core/result';
import type { Interval } from '../../engine/stats/descriptive';
import { normalSf } from '../../engine/special/gamma';
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
  ProgressBar,
  RunningState,
  SelectField,
  TextField,
} from '../../ui/primitives';
import { LineChart } from '../../ui/charts/charts';
import { formatPercent, formatValue } from '../../ui/charts/scale';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { useApp } from '../store';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Model parameters are held in the engine's own shape rather than flattened,
 * so they can be handed to `build` untouched. The type is restricted to JSON
 * values because the config is persisted to IndexedDB and cloned.
 */
export type DesParamValue = number | boolean | null | DesParamValue[] | { [key: string]: DesParamValue };

export type DesParams = Record<string, DesParamValue>;

export interface DesConfig {
  /** Model id from the engine's registry (`DES_MODELS`). */
  modelId: string;
  params: DesParams;
  run: {
    /** Simulated time at which the run stops, including the warm-up. */
    until: number;
    /** Simulated time whose statistics are discarded, keeping the state. */
    warmupTime: number;
    replications: number;
    /** Batches used for the steady-state intervals. */
    batchCount: number;
    /** Events per chunk; control returns to the page between chunks. */
    chunkEvents: number;
    level: number;
  };
  seed: string;
  /** Metric key from the model's own summary, used by the analyses below. */
  focusMetric: string;
  /** The second configuration in the comparison panel. */
  alternative: DesParams;
  comparison: { replications: number; until: number };
  validation: {
    family: ValidationFamily;
    arrivalRate: number;
    serviceRate: number;
    servers: number;
    serviceScv: number;
    until: number;
    warmupTime: number;
    batchCount: number;
  };
  rareEvent: { dimension: number; threshold: number; trials: number; samplesPerLevel: number };
}

/**
 * The M/M/2 service desk at 90% utilisation: busy enough to have a queue worth
 * reporting, and the one model in the library whose answer is known exactly,
 * so the screen can show the theory column before anything has been run.
 */
export const DES_DEFAULT: DesConfig = {
  modelId: 'mmc-service-desk',
  params: { arrivalRate: 9, serviceRate: 5, servers: 2 },
  run: { until: 1200, warmupTime: 120, replications: 5, batchCount: 20, chunkEvents: 5000, level: 0.95 },
  seed: 'orbis-des-1',
  focusMetric: 'Wq',
  alternative: { arrivalRate: 9, serviceRate: 5, servers: 3 },
  comparison: { replications: 6, until: 600 },
  validation: { family: 'mm1', arrivalRate: 0.9, serviceRate: 1, servers: 1, serviceScv: 2, until: 4000, warmupTime: 400, batchCount: 30 },
  rareEvent: { dimension: 2, threshold: 4.5, trials: 20_000, samplesPerLevel: 2000 },
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function messageOf(e: unknown): string {
  if (e instanceof EngineError) return e.issues.map((i) => i.message).join(' ');
  return e instanceof Error ? e.message : String(e);
}

function fv(x: number, digits = 4): string {
  return Number.isFinite(x) ? formatValue(x, digits) : 'not available';
}

function ciText(interval: Interval): string {
  return `[${fv(interval.low)}, ${fv(interval.high)}] at ${(interval.level * 100).toFixed(0)}%`;
}

/** camelCase parameter keys into something readable in a label. */
function humanise(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function isParams(value: unknown): value is DesParams {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A model's `defaults` are typed `unknown` in the registry, so they are walked
 * into the JSON-only parameter shape rather than cast: anything that would not
 * survive `structuredClone` (a function, `undefined`) is dropped, and the
 * model's own validator then reports whatever is missing.
 */
function toParamValue(value: unknown): DesParamValue | undefined {
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value === null) return null;
  if (Array.isArray(value)) {
    const out: DesParamValue[] = [];
    for (const item of value) {
      const converted = toParamValue(item);
      if (converted !== undefined) out.push(converted);
    }
    return out;
  }
  if (isParams(value)) return toParams(value);
  return undefined;
}

function toParams(value: unknown): DesParams {
  const out: DesParams = {};
  if (!isParams(value)) return out;
  for (const [key, item] of Object.entries(value)) {
    const converted = toParamValue(item);
    if (converted !== undefined) out[key] = converted;
  }
  return out;
}

const KIND_LABEL: Record<DesMetric['kind'], string> = {
  'time-weighted': 'Time-weighted',
  tally: 'Per-entity tally',
  count: 'Count',
  rate: 'Rate',
  proportion: 'Proportion',
};

function metricValueText(metric: DesMetric): string {
  return metric.kind === 'proportion' ? formatPercent(metric.value, 4) : fv(metric.value);
}

function yieldToPage(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

// ---------------------------------------------------------------------------
// Parameter editing
// ---------------------------------------------------------------------------

function ParamField({ label, value, onChange }: { label: string; value: DesParamValue; onChange(next: DesParamValue): void }) {
  if (typeof value === 'number') {
    return <NumberField label={label} value={value} onChange={onChange} />;
  }
  if (typeof value === 'boolean') {
    return <Checkbox label={label} checked={value} onChange={onChange} />;
  }
  if (value === null) {
    return (
      <p className="oc-field__hint" style={{ marginTop: 0 }}>
        {label}: not set. The model uses its documented behaviour for this option; it cannot be edited from here.
      </p>
    );
  }
  if (Array.isArray(value)) {
    return (
      <fieldset className="oc-fieldset">
        <legend>{label}</legend>
        {value.map((item, index) => (
          <ParamField
            // Positional keys are correct here: these arrays are fixed-length
            // parameter vectors (one entry per class, station or shift).
            key={index}
            label={`${label} — ${index + 1}`}
            value={item}
            onChange={(next) => {
              const copy = value.slice();
              copy[index] = next;
              onChange(copy);
            }}
          />
        ))}
      </fieldset>
    );
  }
  return (
    <fieldset className="oc-fieldset">
      <legend>{label}</legend>
      <ParamFields params={value} onChange={onChange} prefix={label} />
    </fieldset>
  );
}

function ParamFields({ params, onChange, prefix }: { params: DesParams; onChange(next: DesParams): void; prefix?: string }) {
  const entries = Object.entries(params);
  if (!entries.length) {
    return <p className="oc-field__hint">This model takes no editable parameters.</p>;
  }
  return (
    <>
      {entries.map(([key, value]) => (
        <ParamField
          key={key}
          label={prefix ? `${prefix} — ${humanise(key)}` : humanise(key)}
          value={value}
          onChange={(next) => onChange({ ...params, [key]: next })}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Run results
// ---------------------------------------------------------------------------

interface SeriesAnalysis {
  label: string;
  source: string;
  batch: BatchMeansReport | null;
  error: string | null;
}

interface MetricAcrossReplications {
  metric: DesMetric;
  report: ReplicationReport | null;
  error: string | null;
  values: number[];
}

interface RunOutcome {
  model: AnyDesModel;
  reports: DesRunReport[];
  /** Summary metrics of the first replication, for the per-run display. */
  firstMetrics: DesMetric[];
  across: MetricAcrossReplications[];
  series: SeriesAnalysis[];
  welch: WelchReport | null;
  welchError: string | null;
  mser: WarmupReport | null;
  mserError: string | null;
  focusTally: TallyReport | null;
  focusBatchSeries: number[] | null;
  theoretical: { key: string; value: number; source: string }[] | null;
  wallClockMs: number;
}

const OVERFLOW: React.CSSProperties = { overflowX: 'auto' };

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export function DesTool({ config }: { config: DesConfig }) {
  const app = useApp();
  const set = (patch: Partial<DesConfig>) => app.updateConfig({ ...config, ...patch });

  const cancelRef = useRef(false);
  // A run abandoned by navigating away must not keep burning the main thread.
  useEffect(
    () => () => {
      cancelRef.current = true;
    },
    [],
  );

  const [status, setStatus] = useState<'idle' | 'running'>('idle');
  const [progress, setProgress] = useState({ replication: 0, now: 0, until: 0, events: 0 });
  const [runError, setRunError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);

  const [comparison, setComparison] = useState<CrnReport | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);

  const [validation, setValidation] = useState<ValidationReport | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [rare, setRare] = useState<{ plain: PlainRareEventReport; subset: SubsetSimulationResult; exact: number } | null>(null);
  const [rareError, setRareError] = useState<string | null>(null);

  /** The model and its static description. Cheap: no simulation is built. */
  const model = useMemo<{ ok: true; value: AnyDesModel } | { ok: false; error: string }>(() => {
    try {
      return { ok: true, value: getDesModel(config.modelId) };
    } catch (e) {
      return { ok: false, error: messageOf(e) };
    }
  }, [config.modelId]);

  const paramIssues = useMemo<Issue[]>(() => {
    if (!model.ok) return [];
    try {
      return model.value.validate(config.params);
    } catch (e) {
      return [{ code: 'invalid', message: messageOf(e) }];
    }
  }, [model, config.params]);

  const alternativeIssues = useMemo<Issue[]>(() => {
    if (!model.ok) return [];
    try {
      return model.value.validate(config.alternative);
    } catch (e) {
      return [{ code: 'invalid', message: messageOf(e) }];
    }
  }, [model, config.alternative]);

  /** Exact values the model has, shown before and alongside any run. */
  const theory = useMemo(() => {
    if (!model.ok || !model.value.theoretical) return null;
    try {
      return model.value.theoretical(config.params);
    } catch {
      // A parameter set outside the analytic model's domain (an unstable
      // queue, say) has no exact answer. That is reported by the parameter
      // validator above, not papered over with a number here.
      return null;
    }
  }, [model, config.params]);

  const suggested = useMemo(() => {
    if (!model.ok) return null;
    try {
      return model.value.suggestedRun(config.params);
    } catch {
      return null;
    }
  }, [model, config.params]);

  const blocked = !model.ok || paramIssues.length > 0;

  // -- the main run ---------------------------------------------------------

  const runModel = () => {
    if (!model.ok) return;
    const chosen = model.value;
    setRunError(null);
    setOutcome(null);
    setStatus('running');
    cancelRef.current = false;
    setProgress({ replication: 0, now: 0, until: config.run.until, events: 0 });
    void (async () => {
      const started = Date.now();
      const reports: DesRunReport[] = [];
      const stateBatchSeries: number[][] = [];
      let focusValues: readonly number[] = [];
      let focusTallyName: string | null = null;
      try {
        for (let r = 0; r < config.run.replications; r++) {
          const sim = chosen.build(config.params, `${config.seed}|rep${r + 1}`);
          const steps = desSteps(sim, {
            until: config.run.until,
            warmupTime: config.run.warmupTime,
            chunkEvents: config.run.chunkEvents,
            hooks: { isCancelled: () => cancelRef.current },
          });
          for (;;) {
            const step = steps.next();
            if (step.done) {
              reports.push(step.value);
              break;
            }
            setProgress({ replication: r, now: step.value.now, until: step.value.until, events: step.value.eventsExecuted });
            // Hand the page back so it can paint and so Cancel can be pressed.
            await yieldToPage();
          }
          if (cancelRef.current) {
            setRunError('The run was cancelled, so no results are reported. A partial set of replications has no interval.');
            setStatus('idle');
            return;
          }
          const report = reports[reports.length - 1];
          const batched = report.states.find((s) => s.batchMeans !== null && s.batchMeans.length > 0);
          if (batched?.batchMeans) stateBatchSeries.push(batched.batchMeans);
          if (r === 0) {
            // Per-entity series are only kept for the first replication; the
            // config never stores them, and neither does this state.
            const names = sim.tallyNames();
            focusTallyName = names.find((n) => n.toLowerCase().includes('wait')) ?? names[0] ?? null;
            if (focusTallyName) focusValues = sim.getTally(focusTallyName).values().slice();
          }
          setProgress({ replication: r + 1, now: report.endTime, until: config.run.until, events: report.eventsExecuted });
          await yieldToPage();
        }

        const firstMetrics = chosen.summarise(reports[0]);
        const across: MetricAcrossReplications[] = firstMetrics.map((metric, index) => {
          const values = reports.map((report) => chosen.summarise(report)[index].value);
          try {
            return { metric, report: replicationAnalysis(values, { level: config.run.level }), error: null, values };
          } catch (e) {
            return { metric, report: null, error: messageOf(e), values };
          }
        });

        const series: SeriesAnalysis[] = [];
        const addSeries = (label: string, source: string, values: readonly number[]) => {
          try {
            series.push({ label, source, batch: batchMeans(values, { batchCount: config.run.batchCount, level: config.run.level }), error: null });
          } catch (e) {
            series.push({ label, source, batch: null, error: messageOf(e) });
          }
        };
        for (const state of reports[0].states) {
          if (state.batchMeans && state.batchMeans.length) {
            addSeries(state.name, `Time-weighted means of ${state.batchMeans.length} equal time windows of ${fv(state.batchDuration ?? 0)} time units`, state.batchMeans);
          }
        }
        if (focusTallyName && focusValues.length) {
          addSeries(focusTallyName, `Per-entity observations in order, ${focusValues.length.toLocaleString('en-US')} of them`, focusValues);
        }

        let welch: WelchReport | null = null;
        let welchError: string | null = null;
        if (stateBatchSeries.length >= 2) {
          const common = Math.min(...stateBatchSeries.map((s) => s.length));
          try {
            welch = welchWarmup(stateBatchSeries.map((s) => s.slice(0, common)));
          } catch (e) {
            welchError = messageOf(e);
          }
        } else {
          welchError = "Welch's method needs at least 2 replications of a model that records time batches; this run has fewer.";
        }

        let mser: WarmupReport | null = null;
        let mserError: string | null = null;
        if (focusValues.length) {
          try {
            mser = mser5(focusValues);
          } catch (e) {
            mserError = messageOf(e);
          }
        } else {
          mserError = 'No per-entity series was recorded in the first replication, so MSER-5 has nothing to analyse.';
        }

        const focusTally = focusTallyName ? (reports[0].tallies.find((t) => t.name === focusTallyName) ?? null) : null;
        const focusBatch = series.find((s) => s.batch !== null)?.batch?.batchMeans ?? null;

        setOutcome({
          model: chosen,
          reports,
          firstMetrics,
          across,
          series,
          welch,
          welchError,
          mser,
          mserError,
          focusTally,
          focusBatchSeries: focusBatch,
          theoretical: theory,
          wallClockMs: Date.now() - started,
        });
        setStatus('idle');
      } catch (e) {
        setRunError(messageOf(e));
        setStatus('idle');
      }
    })();
  };

  // -- comparison with common random numbers --------------------------------

  const runComparison = () => {
    if (!model.ok) return;
    const chosen = model.value;
    setComparison(null);
    setComparisonError(null);
    setComparing(true);
    cancelRef.current = false;
    void (async () => {
      try {
        const metricOf = async (params: DesParams, seed: string): Promise<number> => {
          const sim = chosen.build(params, seed);
          const steps = desSteps(sim, {
            until: config.comparison.until,
            warmupTime: Math.min(config.run.warmupTime, config.comparison.until / 4),
            chunkEvents: config.run.chunkEvents,
            hooks: { isCancelled: () => cancelRef.current },
          });
          let step = steps.next();
          while (!step.done) {
            step = steps.next();
            await yieldToPage();
          }
          const metrics = chosen.summarise(step.value);
          const found = metrics.find((m) => m.key === config.focusMetric);
          if (!found) {
            throw new EngineError(
              `The model does not report a metric called "${config.focusMetric}". It reports: ${metrics.map((m) => m.key).join(', ')}.`,
              'unknown',
            );
          }
          return found.value;
        };
        const n = config.comparison.replications;
        const crnA: number[] = [];
        const crnB: number[] = [];
        const independentA: number[] = [];
        const independentB: number[] = [];
        for (let r = 0; r < n; r++) {
          // Common random numbers: the same seed drives both configurations,
          // so the two runs share their randomness and the paired difference
          // removes the variation they have in common.
          const shared = `${config.seed}|crn${r + 1}`;
          crnA.push(await metricOf(config.params, shared));
          crnB.push(await metricOf(config.alternative, shared));
          independentA.push(await metricOf(config.params, `${config.seed}|indA${r + 1}`));
          independentB.push(await metricOf(config.alternative, `${config.seed}|indB${r + 1}`));
          if (cancelRef.current) {
            setComparisonError('The comparison was cancelled before every pair was run, so no interval is reported.');
            setComparing(false);
            return;
          }
        }
        setComparison(
          commonRandomNumbersReport({
            crnA,
            crnB,
            independentA,
            independentB,
            level: config.run.level,
            labelA: 'current parameters',
            labelB: 'alternative',
          }),
        );
        setComparing(false);
      } catch (e) {
        setComparisonError(messageOf(e));
        setComparing(false);
      }
    })();
  };

  // -- validation against queueing theory -----------------------------------

  const runValidation = () => {
    setValidation(null);
    setValidationError(null);
    try {
      setValidation(
        validateQueueAgainstTheory({
          family: config.validation.family,
          arrivalRate: config.validation.arrivalRate,
          serviceRate: config.validation.serviceRate,
          servers: config.validation.family === 'mmc' ? config.validation.servers : undefined,
          serviceScv: config.validation.family === 'mg1' ? config.validation.serviceScv : undefined,
          seed: `${config.seed}|validate`,
          until: config.validation.until,
          warmupTime: config.validation.warmupTime,
          batchCount: config.validation.batchCount,
          level: config.run.level,
        }),
      );
    } catch (e) {
      setValidationError(messageOf(e));
    }
  };

  // -- rare events ----------------------------------------------------------

  const runRareEvent = () => {
    setRare(null);
    setRareError(null);
    const d = config.rareEvent.dimension;
    const threshold = config.rareEvent.threshold;
    const root = Math.sqrt(d);
    try {
      const plain = plainMonteCarloRareEvent({
        trials: config.rareEvent.trials,
        seed: `${config.seed}|rare`,
        level: config.run.level,
        indicator: (rng) => {
          let sum = 0;
          for (let j = 0; j < d; j++) sum += rng.normal();
          return sum / root > threshold;
        },
      });
      const subset = subsetSimulation({
        dimension: d,
        performance: (x) => {
          let sum = 0;
          for (let j = 0; j < x.length; j++) sum += x[j];
          return sum / root;
        },
        threshold,
        samplesPerLevel: config.rareEvent.samplesPerLevel,
        seed: `${config.seed}|subset`,
        level: config.run.level,
      });
      // The normalised sum of d independent standard normals is itself
      // standard normal, so this failure probability has an exact value to
      // judge both estimators against.
      setRare({ plain, subset, exact: normalSf(threshold) });
    } catch (e) {
      setRareError(messageOf(e));
    }
  };

  // -- explanation ----------------------------------------------------------

  const explanation = useMemo<Explanation>(() => {
    const name = model.ok ? model.value.name : config.modelId;
    const steps = [
      { label: 'Model', expression: config.modelId, value: name },
      { label: 'Run length', expression: 'until − warm-up', value: `${fv(config.run.until)} − ${fv(config.run.warmupTime)} simulated time units` },
      { label: 'Replications', value: String(config.run.replications) },
      { label: 'Seed', value: config.seed },
    ];
    if (outcome) {
      const first = outcome.reports[0];
      steps.push({ label: 'Events executed (first replication)', value: first.eventsExecuted.toLocaleString('en-US') });
      steps.push({
        label: 'Warm-up discarded',
        value: first.warmup ? `statistics discarded at simulated time ${fv(first.warmup.discardedUntil)}` : 'none: every observation was kept',
      });
      steps.push({ label: 'Termination', value: first.terminatedBy });
      const batched = outcome.series.find((s) => s.batch);
      if (batched?.batch) {
        steps.push({
          label: 'Batching',
          expression: batched.batch.method,
          value: batched.batch.independence.passed
            ? 'the lag-one independence test passed, so the interval is usable'
            : 'the lag-one test FAILED: the batches are correlated and the interval is too narrow',
        });
      }
      if (outcome.mser) steps.push({ label: 'MSER-5 truncation', value: `${outcome.mser.truncation} observations` });
    }
    return {
      method: `Discrete-event simulation of "${name}" with ${config.run.replications} independent replications; state variables measured by time integral, per-entity values by tally`,
      formula: 'time-weighted mean = (1/T)∫x(t)dt; tally mean = (1/n)Σxᵢ',
      steps,
      assumptions: model.ok ? model.value.assumptions : [],
      limitations: [
        ...(model.ok ? model.value.limitations : []),
        'Every number on this screen is empirical: it comes from a finite number of simulated events and would differ with another seed. The standard error and interval beside each value are the only statements of how much.',
        'An interval for a long-run mean says where the expected value lies; percentiles of the observed distribution say where individual outcomes lie. They are never interchangeable.',
      ],
      exactness: 'empirical',
    };
  }, [model, config.modelId, config.run.until, config.run.warmupTime, config.run.replications, config.seed, outcome]);

  const focusOptions = outcome ? outcome.firstMetrics : theory ? theory.map((t) => ({ key: t.key, label: t.key, value: t.value, kind: 'tally' as const })) : [];
  // Which metrics a model reports is only known once a run has produced a
  // report to summarise, so the focus metric is checked against the run rather
  // than assumed to exist.
  const focusValid = !outcome || outcome.firstMetrics.some((m) => m.key === config.focusMetric);

  return (
    <>
      <ToolHeader toolId="des" />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="Model">
            <SelectField
              label="System to model"
              value={config.modelId}
              onChange={(modelId) => {
                const next = getDesModel(modelId);
                const params = toParams(next.defaults);
                const run = next.suggestedRun(params);
                set({
                  modelId,
                  params,
                  alternative: params,
                  focusMetric: next.theoretical ? (next.theoretical(params)[0]?.key ?? config.focusMetric) : config.focusMetric,
                  run: { ...config.run, until: run.until, warmupTime: run.warmupTime },
                });
                setOutcome(null);
                setComparison(null);
                setRunError(null);
              }}
              options={DES_MODELS.map((m) => ({ value: m.id, label: m.name }))}
              hint={model.ok ? model.value.description : undefined}
            />
            {!model.ok && <Notice tone="error">{model.error}</Notice>}
            {model.ok && (
              <>
                <h3 style={{ fontSize: 13, marginBottom: 'var(--s2)' }}>Parameters</h3>
                <ParamFields params={config.params} onChange={(params) => set({ params })} />
                {paramIssues.length > 0 && <Notice tone="error" title="These parameters cannot be run" items={paramIssues.map((i) => i.message)} />}
                <Disclosure title="Assumptions and limitations of this model">
                  <h3 style={{ fontSize: 13 }}>Assumptions</h3>
                  <ul className="oc-list">
                    {model.value.assumptions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                  <h3 style={{ fontSize: 13 }}>Limitations</h3>
                  <ul className="oc-list">
                    {model.value.limitations.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                </Disclosure>
              </>
            )}
          </Card>

          <Card title="Run controls" hint="Nothing is simulated until you press Run, because a steady-state run is seconds of work.">
            <NumberField
              label="Run until simulated time"
              value={config.run.until}
              onChange={(until) => set({ run: { ...config.run, until } })}
              min={1}
              hint={suggested ? `The model suggests ${fv(suggested.until)} for this parameter set.` : undefined}
            />
            <NumberField
              label="Warm-up period discarded"
              value={config.run.warmupTime}
              onChange={(warmupTime) => set({ run: { ...config.run, warmupTime } })}
              min={0}
              hint={
                suggested
                  ? `Statistics are cleared at this time and the system state is kept. The model suggests ${fv(suggested.warmupTime)}; the panel below reports what the engine detects.`
                  : 'Statistics are cleared at this time and the system state is kept.'
              }
            />
            <NumberField
              label="Independent replications"
              value={config.run.replications}
              onChange={(replications) => set({ run: { ...config.run, replications } })}
              min={2}
              max={200}
              integer
              hint="At least 2: one run gives a number but no way to say how precise it is."
            />
            <NumberField
              label="Batches for the steady-state interval"
              value={config.run.batchCount}
              onChange={(batchCount) => set({ run: { ...config.run, batchCount } })}
              min={10}
              max={500}
              integer
              hint="At least 10 batches before the between-batch variance means anything."
            />
            <NumberField
              label="Events per chunk"
              value={config.run.chunkEvents}
              onChange={(chunkEvents) => set({ run: { ...config.run, chunkEvents } })}
              min={100}
              max={200_000}
              integer
              hint="The runner yields to the page after this many events, which is what lets Cancel take effect."
            />
            <NumberField
              label="Confidence level"
              value={config.run.level}
              onChange={(level) => set({ run: { ...config.run, level } })}
              min={0.5}
              max={0.999}
              step={0.01}
            />
            <TextField label="Seed" value={config.seed} onChange={(seed) => set({ seed })} monospace hint="The same seed reproduces the run exactly." />
            {suggested && (
              <Button
                onClick={() => set({ run: { ...config.run, until: suggested.until, warmupTime: suggested.warmupTime } })}
              >
                Use the model&apos;s suggested run length
              </Button>
            )}
            <div className="oc-btn-row" style={{ marginTop: 'var(--s3)' }}>
              <Button variant="primary" icon="simulation" onClick={runModel} disabled={blocked || status === 'running'}>
                Run {config.run.replications} replications
              </Button>
            </div>
            {status === 'running' && (
              <>
                <RunningState
                  completed={progress.replication}
                  total={config.run.replications}
                  unitLabel="replications"
                  onCancel={() => {
                    cancelRef.current = true;
                  }}
                />
                <ProgressBar
                  value={Number.isFinite(progress.now) ? progress.now : 0}
                  max={progress.until}
                  label={`Replication ${progress.replication + 1}: simulated time ${fv(progress.now)} of ${fv(progress.until)}, ${progress.events.toLocaleString('en-US')} events executed`}
                />
              </>
            )}
            {runError && <Notice tone="error">{runError}</Notice>}
          </Card>

          <AiAssistPanel
            capability="interpretStatistics"
            context="Which of these outputs is a statement about a long-run mean and which is a statement about the spread of individual outcomes."
          />
        </div>

        <div className="oc-stack">
          {theory && (
            <Card title="Analytic reference for these parameters" hint="Shown before any run, so the simulation has something to be wrong against.">
              <div style={OVERFLOW}>
                <DataTable
                  caption="Exact steady-state values from queueing theory"
                  columns={[
                    { key: 'k', header: 'Metric', render: (r) => r.key },
                    { key: 'v', header: 'Exact value', numeric: true, render: (r) => fv(r.value) },
                    { key: 's', header: 'Source', render: (r) => r.source },
                  ]}
                  rows={theory}
                />
              </div>
              <p className="oc-chart-note">
                <Badge variant="exact">Exact</Badge> These follow from the formulas, not from a run. Where a model has no closed form this card is absent, which
                is the usual case and the reason the simulation exists.
              </p>
            </Card>
          )}

          {!outcome && status === 'idle' && !runError && (
            <Card title="Results">
              <Notice tone="info" title="No run yet">
                <p>
                  The model, its parameters and the analytic reference above are all computed without simulating anything. Press <strong>Run</strong> to execute
                  the event list; the results, their Monte Carlo error, the warm-up the engine detects and the batch independence test then appear here.
                </p>
              </Notice>
            </Card>
          )}

          {outcome && <ResultsCards outcome={outcome} level={config.run.level} />}

          {outcome && (
            <Card title="Which output the comparisons use">
              <SelectField
                label="Focus metric"
                value={config.focusMetric}
                onChange={(focusMetric) => set({ focusMetric })}
                options={focusOptions.map((m) => ({ value: m.key, label: `${m.label} (${m.key})` }))}
                hint="Used by the comparison panel below."
              />
              {!focusValid && (
                <Notice tone="warning">
                  This model does not report a metric called &ldquo;{config.focusMetric}&rdquo;. Choose one of its own outputs above before comparing.
                </Notice>
              )}
            </Card>
          )}

          <Card
            title="Validation against queueing theory"
            hint="Does the engine reproduce an answer that is already known exactly?"
          >
            <SelectField
              label="Queue family with an exact answer"
              value={config.validation.family}
              onChange={(family) => set({ validation: { ...config.validation, family } })}
              options={[
                { value: 'mm1', label: 'M/M/1 — Poisson arrivals, exponential service, one server' },
                { value: 'mmc', label: 'M/M/c — several servers, one queue (Erlang C)' },
                { value: 'md1', label: 'M/D/1 — constant service time' },
                { value: 'mg1', label: 'M/G/1 — general service time (Pollaczek–Khinchine)' },
              ]}
            />
            <NumberField label="Arrival rate λ" value={config.validation.arrivalRate} onChange={(arrivalRate) => set({ validation: { ...config.validation, arrivalRate } })} min={0.0001} />
            <NumberField label="Service rate μ per server" value={config.validation.serviceRate} onChange={(serviceRate) => set({ validation: { ...config.validation, serviceRate } })} min={0.0001} />
            {config.validation.family === 'mmc' && (
              <NumberField label="Servers c" value={config.validation.servers} onChange={(servers) => set({ validation: { ...config.validation, servers } })} min={1} max={200} integer />
            )}
            {config.validation.family === 'mg1' && (
              <NumberField
                label="Squared coefficient of variation of the service time"
                value={config.validation.serviceScv}
                onChange={(serviceScv) => set({ validation: { ...config.validation, serviceScv } })}
                min={0.0001}
                hint="1 is exponential; above 1 is more variable, and the waiting time grows with it."
              />
            )}
            <NumberField label="Validation run length" value={config.validation.until} onChange={(until) => set({ validation: { ...config.validation, until } })} min={10} />
            <NumberField label="Warm-up discarded" value={config.validation.warmupTime} onChange={(warmupTime) => set({ validation: { ...config.validation, warmupTime } })} min={0} />
            <NumberField label="Batches" value={config.validation.batchCount} onChange={(batchCount) => set({ validation: { ...config.validation, batchCount } })} min={10} max={200} integer />
            <div className="oc-btn-row" style={{ marginTop: 'var(--s3)' }}>
              <Button variant="primary" icon="queue" onClick={runValidation}>
                Check the engine against theory
              </Button>
            </div>
            {validationError && <Notice tone="error">{validationError}</Notice>}
            {validation && <ValidationCardBody report={validation} />}
            {!validation && !validationError && (
              <p className="oc-chart-note">
                The check runs its own M/M/c or M/G/1 station, then asks whether the simulation&apos;s own confidence interval contains the exact value. That is
                a stronger test than &ldquo;close enough&rdquo;: it tests whether the stated uncertainty is honest.
              </p>
            )}
          </Card>

          <Card title="Rare events" hint="A small failure probability, estimated honestly and then properly.">
            <NumberField label="Dimension of the input vector" value={config.rareEvent.dimension} onChange={(dimension) => set({ rareEvent: { ...config.rareEvent, dimension } })} min={1} max={200} integer />
            <NumberField
              label="Failure threshold"
              value={config.rareEvent.threshold}
              onChange={(threshold) => set({ rareEvent: { ...config.rareEvent, threshold } })}
              min={0.1}
              max={9}
              step={0.1}
              hint="Failure is the normalised sum of the inputs exceeding this. The normalised sum is standard normal, so the exact probability is known and both estimators can be judged against it."
            />
            <NumberField label="Plain Monte Carlo trials" value={config.rareEvent.trials} onChange={(trials) => set({ rareEvent: { ...config.rareEvent, trials } })} min={100} max={2_000_000} integer />
            <NumberField
              label="Samples per level (subset simulation)"
              value={config.rareEvent.samplesPerLevel}
              onChange={(samplesPerLevel) => set({ rareEvent: { ...config.rareEvent, samplesPerLevel } })}
              min={100}
              max={50_000}
              integer
              hint="The level probability is 0.1, so this must be a multiple of 10."
            />
            <div className="oc-btn-row" style={{ marginTop: 'var(--s3)' }}>
              <Button variant="primary" icon="simulation" onClick={runRareEvent}>
                Estimate the failure probability
              </Button>
            </div>
            {rareError && <Notice tone="error">{rareError}</Notice>}
            {rare && <RareEventCardBody plain={rare.plain} subset={rare.subset} exact={rare.exact} />}
          </Card>

          <Card title="Comparing two configurations" hint="Is A better than B? — an easier question than what A is, and common random numbers is the tool for it.">
            <p className="oc-field__hint" style={{ marginTop: 0 }}>
              The alternative below uses the same model with different parameters. Each pair of runs shares a seed, so the two configurations see the same
              randomness and the paired difference removes the noise they have in common.
            </p>
            <ParamFields params={config.alternative} onChange={(alternative) => set({ alternative })} />
            {alternativeIssues.length > 0 && <Notice tone="error" title="The alternative cannot be run" items={alternativeIssues.map((i) => i.message)} />}
            <NumberField label="Paired replications" value={config.comparison.replications} onChange={(replications) => set({ comparison: { ...config.comparison, replications } })} min={2} max={100} integer />
            <NumberField label="Run length per comparison run" value={config.comparison.until} onChange={(until) => set({ comparison: { ...config.comparison, until } })} min={10} />
            <div className="oc-btn-row" style={{ marginTop: 'var(--s3)' }}>
              <Button
                variant="primary"
                icon="simulation"
                onClick={runComparison}
                disabled={blocked || alternativeIssues.length > 0 || comparing || status === 'running' || !focusValid}
              >
                Compare on {config.focusMetric}
              </Button>
            </div>
            {comparing && (
              <RunningState
                completed={0}
                total={config.comparison.replications * 4}
                unitLabel="runs (paired and independent)"
                onCancel={() => {
                  cancelRef.current = true;
                }}
              />
            )}
            {comparisonError && <Notice tone="error">{comparisonError}</Notice>}
            {comparison && <ComparisonCardBody report={comparison} metric={config.focusMetric} />}
          </Card>

          <Card title="Explanation">
            <ExplanationPanel explanation={explanation} />
          </Card>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function ResultsCards({ outcome, level }: { outcome: RunOutcome; level: number }) {
  const first = outcome.reports[0];
  const materialGaps = outcome.reports[0].states.filter(
    (s) => Math.abs(s.naiveObservationMean - s.timeWeightedMean) > 0.05 * Math.max(1e-12, Math.abs(s.timeWeightedMean)),
  );
  return (
    <>
      <Card title="Results of the first replication" hint={`${first.eventsExecuted.toLocaleString('en-US')} events over simulated time ${fv(first.startTime)} to ${fv(first.endTime)}.`}>
        <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', marginBottom: 'var(--s3)' }}>
          <Badge variant="empirical">Empirical</Badge>
          <Badge>{first.warmup ? `warm-up discarded to ${fv(first.warmup.discardedUntil)}` : 'no warm-up discarded'}</Badge>
          <Badge>{`terminated by ${first.terminatedBy}`}</Badge>
          <Badge>{`${outcome.wallClockMs.toLocaleString('en-US')} ms of real time for all replications`}</Badge>
        </div>

        <h3 style={{ fontSize: 13 }}>Model summary</h3>
        <div style={OVERFLOW}>
          <DataTable
            caption="Metrics the model reports, with how each one is averaged"
            columns={[
              { key: 'l', header: 'Metric', render: (m) => m.label },
              { key: 'v', header: 'Value', numeric: true, render: (m) => metricValueText(m) },
              { key: 'k', header: 'Averaged how', render: (m) => KIND_LABEL[m.kind] },
            ]}
            rows={outcome.firstMetrics}
          />
        </div>

        <h3 style={{ fontSize: 13, marginTop: 'var(--s4)' }}>State variables — time-weighted</h3>
        <p className="oc-chart-note" style={{ marginTop: 0 }}>
          A queue length or a utilisation persists through time, so its average is the time integral divided by the window length. The naive column is the
          arithmetic mean of the recorded values ignoring how long each lasted; it is shown only so the discrepancy is visible, and it is never the answer.
        </p>
        <div style={OVERFLOW}>
          <DataTable
            caption="Time-weighted statistics for state variables"
            columns={[
              { key: 'n', header: 'Variable', render: (s) => s.name },
              { key: 'tw', header: 'Time-weighted mean', numeric: true, render: (s) => fv(s.timeWeightedMean) },
              { key: 'nv', header: 'Naive per-observation mean (wrong)', numeric: true, render: (s) => fv(s.naiveObservationMean), title: 'Arithmetic mean of the recorded values, ignoring duration. Not the answer.' },
              {
                key: 'g',
                header: 'Gap',
                numeric: true,
                render: (s) =>
                  Math.abs(s.timeWeightedMean) > 1e-12
                    ? `${((100 * (s.naiveObservationMean - s.timeWeightedMean)) / s.timeWeightedMean).toFixed(1)}%`
                    : 'not comparable',
              },
              { key: 'r', header: 'Min / max / final', render: (s) => `${fv(s.min, 3)} / ${fv(s.max, 3)} / ${fv(s.final, 3)}` },
              { key: 'd', header: 'Window', numeric: true, render: (s) => fv(s.duration) },
            ]}
            rows={first.states}
          />
        </div>
        {materialGaps.length > 0 && (
          <Notice tone="warning" title="The two averages differ materially here">
            <p>
              For {materialGaps.map((s) => s.name).join(', ')} the naive mean differs from the time-weighted mean by more than 5%. A state that is rarely
              extreme but recorded often — a queue of 10 for 1% of the time — has a time-weighted mean of 0.1 and a naive mean several times larger. Only the
              time-weighted column answers &ldquo;how long is the queue on average&rdquo;.
            </p>
          </Notice>
        )}

        <h3 style={{ fontSize: 13, marginTop: 'var(--s4)' }}>Per-entity values — tallies</h3>
        {first.tallies.length === 0 ? (
          <p className="oc-chart-note">This replication recorded no per-entity values.</p>
        ) : (
          <div style={OVERFLOW}>
            <DataTable
              caption="Tally statistics for values observed once per entity"
              columns={[
                { key: 'n', header: 'Value', render: (t) => t.name },
                { key: 'c', header: 'Observations', numeric: true, render: (t) => t.n.toLocaleString('en-US') },
                { key: 'm', header: 'Mean', numeric: true, render: (t) => fv(t.mean) },
                { key: 'se', header: 'Nominal standard error', numeric: true, render: (t) => fv(t.standardError) },
                { key: 'ci', header: 'Interval for the long-run mean', render: (t) => ciText(t.meanInterval) },
                { key: 'p', header: 'Percentiles of individual values (p50 / p90 / p95)', render: (t) => percentileText(t) },
              ]}
              rows={first.tallies}
            />
          </div>
        )}
        {first.tallies.length > 0 && (
          <Notice tone="warning" title="The nominal standard error on a tally is not the whole story">
            <p>{first.tallies[0].note}</p>
            <p>
              Successive waiting times in a queue are strongly correlated, so that standard error is too small. The batch-means interval in the output analysis
              below is the one to use for a long-run mean. The percentile column is a different claim again: it describes the spread of individual outcomes, not
              the precision of the mean.
            </p>
          </Notice>
        )}

        {first.resources.length > 0 && (
          <>
            <h3 style={{ fontSize: 13, marginTop: 'var(--s4)' }}>Resources</h3>
            <div style={OVERFLOW}>
              <DataTable
                caption="Resource utilisation, queueing and losses"
                columns={[
                  { key: 'n', header: 'Resource', render: (r) => r.name },
                  { key: 'c', header: 'Capacity', numeric: true, render: (r) => String(r.capacity) },
                  { key: 'u', header: 'Utilisation (time-weighted)', numeric: true, render: (r) => formatPercent(r.utilisation, 4) },
                  { key: 'q', header: 'Mean queue length (time-weighted)', numeric: true, render: (r) => fv(r.queueLength.timeWeightedMean) },
                  { key: 'w', header: 'Mean wait (tally)', numeric: true, render: (r) => (r.waitingTime ? fv(r.waitingTime.mean) : 'no observations') },
                  { key: 's', header: 'Served', numeric: true, render: (r) => r.served.toLocaleString('en-US') },
                  { key: 'b', header: 'Balked / reneged / preempted', render: (r) => `${r.balks} / ${r.reneges} / ${r.preemptions}` },
                ]}
                rows={first.resources}
              />
            </div>
          </>
        )}

        {first.counters.length > 0 && (
          <>
            <h3 style={{ fontSize: 13, marginTop: 'var(--s4)' }}>Counters</h3>
            <KeyValueList items={first.counters.map((c) => ({ label: c.name, value: c.value.toLocaleString('en-US') }))} />
          </>
        )}

        {first.emptyStatistics.length > 0 && (
          <Notice tone="info" title="Statistics with no observations">
            <p>
              {first.emptyStatistics.join(', ')} recorded nothing in this run. They are named rather than reported as 0, because 0 would be a different claim
              from &ldquo;this never happened&rdquo;.
            </p>
          </Notice>
        )}
        {first.waiting.length > 0 && (
          <Notice tone="info" title="Entities still in the system at the end">
            <p>
              {first.processesRemaining} process(es) were unfinished: {first.waiting.map((w) => `${w.count} waiting for ${w.waitingOn}`).join('; ')}. Their
              times in system are not in the tallies, which is the usual end-of-run truncation and shrinks as the run lengthens.
            </p>
          </Notice>
        )}
      </Card>

      <Card title="Output analysis" hint="One run is one sample from a random process. This is what turns it into a statement.">
        <h3 style={{ fontSize: 13, marginTop: 0 }}>Across {outcome.reports.length} independent replications</h3>
        <div style={OVERFLOW}>
          <DataTable
            caption="Replication means with Monte Carlo standard error and confidence intervals"
            columns={[
              { key: 'm', header: 'Metric', render: (r) => r.metric.label },
              { key: 'k', header: 'Averaged how', render: (r) => KIND_LABEL[r.metric.kind] },
              { key: 'v', header: 'Mean of replications', numeric: true, render: (r) => (r.report ? fv(r.report.mean) : fv(r.metric.value)) },
              { key: 'se', header: 'Monte Carlo standard error', numeric: true, render: (r) => (r.report ? fv(r.report.standardError) : 'not available') },
              { key: 'ci', header: 'Interval for the long-run mean', render: (r) => (r.report ? ciText(r.report.meanInterval) : (r.error ?? 'not available')) },
              {
                key: 'p',
                header: 'Relative precision',
                numeric: true,
                render: (r) => (r.report && r.report.relativePrecision !== null ? `±${(100 * r.report.relativePrecision).toFixed(1)}%` : 'not defined at a zero mean'),
              },
              {
                key: 'rp',
                header: 'Spread of replication means (p5 / p50 / p95)',
                render: (r) =>
                  r.report
                    ? r.report.replicationPercentiles
                        .filter((p) => p.p === 0.05 || p.p === 0.5 || p.p === 0.95)
                        .map((p) => fv(p.value, 3))
                        .join(' / ')
                    : 'not available',
              },
            ]}
            rows={outcome.across}
          />
        </div>
        <p className="oc-chart-note">
          The interval column is a statement about where the long-run mean lies. The last column describes how one replication&apos;s average varies, which is
          a wider spread and a different claim; neither describes the spread of individual entities, which is in the percentile column further up.
        </p>
        {outcome.across.some((a) => a.error) && (
          <Notice tone="warning" title="Some metrics have no interval" items={outcome.across.filter((a) => a.error).map((a) => `${a.metric.label}: ${a.error ?? ''}`)} />
        )}

        <h3 style={{ fontSize: 13, marginTop: 'var(--s4)' }}>Warm-up: what was discarded, and what the engine detects</h3>
        <KeyValueList
          items={[
            { label: 'Warm-up applied to this run', value: first.warmup ? `${fv(first.warmup.discardedUntil)} simulated time units discarded` : 'none' },
            { label: 'Method', value: first.warmup ? first.warmup.method : 'Statistics were collected from time zero, so any initialisation bias is still in them.' },
          ]}
        />
        {outcome.welch ? (
          <Notice tone={outcome.welch.biasDetected ? 'warning' : 'success'} title={`Welch's method across ${outcome.welch.replications} replications`}>
            <p>{outcome.welch.message}</p>
            <p>
              Truncation point {outcome.welch.truncation} of {outcome.welch.observations} time batches; mean after truncation {fv(outcome.welch.truncatedMean)}{' '}
              against {fv(outcome.welch.untruncatedMean)} for the whole retained series. This is applied to the series that survived the warm-up above, so it is
              a check for bias the configured warm-up did not remove.
            </p>
          </Notice>
        ) : (
          outcome.welchError && <Notice tone="info" title="Welch's method was not applied">{outcome.welchError}</Notice>
        )}
        {outcome.mser ? (
          <Notice tone={outcome.mser.biasDetected ? 'warning' : 'success'} title="MSER-5 on the per-entity series">
            <p>{outcome.mser.message}</p>
          </Notice>
        ) : (
          outcome.mserError && <Notice tone="info" title="MSER-5 was not applied">{outcome.mserError}</Notice>
        )}

        <h3 style={{ fontSize: 13, marginTop: 'var(--s4)' }}>Batch means, with the independence test the interval depends on</h3>
        <div style={OVERFLOW}>
          <DataTable
            caption="Batch-means intervals and the lag-one independence test"
            columns={[
              { key: 'n', header: 'Series', render: (s) => s.label },
              { key: 'src', header: 'What it is', render: (s) => s.source },
              { key: 'b', header: 'Batches × size', render: (s) => (s.batch ? `${s.batch.batchCount} × ${s.batch.batchSize}` : 'not available') },
              { key: 'm', header: 'Mean', numeric: true, render: (s) => (s.batch ? fv(s.batch.mean) : '—') },
              { key: 'se', header: 'Standard error', numeric: true, render: (s) => (s.batch ? fv(s.batch.standardError) : '—') },
              { key: 'ci', header: 'Interval for the long-run mean', render: (s) => (s.batch ? ciText(s.batch.meanInterval) : (s.error ?? '—')) },
              { key: 'l1', header: 'Lag-1 correlation', numeric: true, render: (s) => (s.batch ? s.batch.independence.lag1.toFixed(3) : '—') },
              {
                key: 'ok',
                header: 'Independence test',
                render: (s) => (s.batch ? (s.batch.independence.passed ? 'passed — interval usable' : 'FAILED — interval too narrow') : '—'),
              },
            ]}
            rows={outcome.series}
          />
        </div>
        {outcome.series.map((s) =>
          s.batch && !s.batch.independence.passed ? (
            <Notice key={s.label} tone="error" title={`The batches for ${s.label} are correlated`}>
              <p>{s.batch.independence.message}</p>
              <p>{s.batch.warnings.join(' ')}</p>
            </Notice>
          ) : null,
        )}
        {outcome.series.every((s) => !s.batch || s.batch.independence.passed) && outcome.series.some((s) => s.batch) && (
          <Notice tone="success" title="Every batch-means interval passed the independence test">
            <p>
              Positive correlation between batches is the commonest silent error in steady-state simulation: it shrinks the interval and makes a wrong answer
              look precise. The test above is one-sided on the lag-one autocorrelation for exactly that reason.
            </p>
          </Notice>
        )}
        {outcome.focusBatchSeries && outcome.focusBatchSeries.length > 1 && (
          <div style={OVERFLOW}>
            <LineChart
              title="Batch means in order"
              description="Each point is the mean of one batch. A trend at the start is leftover initialisation bias; a visible run-to-run persistence is the correlation the test above measures."
              series={[{ label: 'Batch mean', points: outcome.focusBatchSeries.map((y, i) => ({ x: i + 1, y })) }]}
              xLabel="Batch"
              yLabel="Batch mean"
              height={200}
              note={`Interval level ${(level * 100).toFixed(0)}%. Points are batch means, not individual observations.`}
            />
          </div>
        )}
      </Card>
    </>
  );
}

function percentileText(t: TallyReport): string {
  if (!t.percentiles) return 'not retained';
  const pick = (p: number) => t.percentiles?.find((x) => x.p === p);
  return [0.5, 0.9, 0.95]
    .map((p) => {
      const found = pick(p);
      return found ? fv(found.value, 3) : '—';
    })
    .join(' / ');
}

// ---------------------------------------------------------------------------
// Validation, rare events, comparison
// ---------------------------------------------------------------------------

function ValidationCardBody({ report }: { report: ValidationReport }) {
  return (
    <>
      <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', margin: 'var(--s3) 0' }}>
        <Badge variant="empirical">Simulated</Badge>
        <Badge variant="exact">{report.kendall}</Badge>
        <Badge>{`utilisation ${formatPercent(report.utilisation, 3)}`}</Badge>
        <Badge>{`${report.customersObserved.toLocaleString('en-US')} customers after discarding ${fv(report.warmupDiscarded)}`}</Badge>
      </div>
      <Notice tone={report.allIntervalsCover ? 'success' : 'error'} title={report.allIntervalsCover ? 'The engine reproduces the exact answer' : 'The engine does NOT reproduce the exact answer'}>
        <p>{report.message}</p>
      </Notice>
      <div style={OVERFLOW}>
        <DataTable
          caption="Exact against simulated, with interval coverage"
          columns={[
            { key: 'm', header: 'Metric', render: (c) => c.label },
            { key: 'a', header: 'Exact', numeric: true, render: (c) => fv(c.analytic) },
            { key: 's', header: 'Simulated', numeric: true, render: (c) => fv(c.simulated) },
            { key: 'se', header: 'Standard error', numeric: true, render: (c) => fv(c.standardError) },
            { key: 'i', header: "Simulation's own interval", render: (c) => ciText(c.interval) },
            { key: 'c', header: 'Covers the exact value?', render: (c) => (c.covers ? 'yes — covered' : 'NO — not covered') },
            { key: 'e', header: 'Error', numeric: true, render: (c) => `${(100 * c.relativeError).toFixed(2)}% (${c.errorInStandardErrors.toFixed(1)} SE)` },
            { key: 'b', header: 'Batch independence', render: (c) => (c.batchIndependencePassed ? 'passed' : 'FAILED') },
          ]}
          rows={report.checks}
        />
      </div>
      <h3 style={{ fontSize: 13, marginTop: 'var(--s4)' }}>Little&apos;s law inside the run&apos;s own statistics</h3>
      <KeyValueList
        items={[
          { label: 'Effective arrival rate λ', value: fv(report.littlesLaw.arrivalRate) },
          { label: 'L against λW', value: `${fv(report.littlesLaw.L)} against ${fv(report.littlesLaw.lambdaW)} — residual ${fv(report.littlesLaw.residual)}` },
          { label: 'Lq against λWq', value: `${fv(report.littlesLaw.Lq)} against ${fv(report.littlesLaw.lambdaWq)} — residual ${fv(report.littlesLaw.queueResidual)}` },
          { label: 'Tolerance', value: fv(report.littlesLaw.tolerance) },
          { label: 'Holds?', value: report.littlesLaw.holds ? 'yes — the collected statistics are internally consistent' : 'NO — a statistics-collection fault' },
        ]}
      />
      <p className="oc-chart-note">{report.littlesLaw.note}</p>
      {report.warnings.length > 0 && <Notice tone="warning" title="Warnings from the check" items={report.warnings} />}
    </>
  );
}

function RareEventCardBody({ plain, subset, exact }: { plain: PlainRareEventReport; subset: SubsetSimulationResult; exact: number }) {
  return (
    <>
      <h3 style={{ fontSize: 13, marginTop: 'var(--s3)' }}>1. Plain Monte Carlo, reported honestly</h3>
      <Notice tone={plain.observed ? 'info' : 'warning'} title={plain.observed ? `${plain.occurrences} occurrence(s) in ${plain.trials.toLocaleString('en-US')} runs` : `Not observed in ${plain.trials.toLocaleString('en-US')} runs`}>
        <p>{plain.message}</p>
      </Notice>
      <KeyValueList
        items={[
          { label: 'Estimate', value: plain.estimate === null ? 'none — the event was never observed, and 0 is not an estimate of a positive probability' : plain.estimate.toExponential(3) },
          { label: 'One-sided upper bound', value: plain.upperBound.toExponential(3) },
          { label: 'Exact interval', value: `[${plain.interval.low.toExponential(3)}, ${plain.interval.high.toExponential(3)}] at ${(plain.interval.level * 100).toFixed(0)}%` },
          { label: 'Runs needed for ten occurrences', value: plain.trialsForTenOccurrences === null ? 'unknown without an estimate' : plain.trialsForTenOccurrences.toLocaleString('en-US') },
        ]}
      />
      <h3 style={{ fontSize: 13, marginTop: 'var(--s4)' }}>2. Subset simulation, which recovers the value</h3>
      <KeyValueList
        items={[
          { label: 'Estimate', value: subset.estimate.toExponential(3) },
          { label: 'Standard error', value: subset.standardError.toExponential(3) },
          { label: 'Coefficient of variation', value: formatPercent(subset.coefficientOfVariation, 3) },
          { label: 'Interval', value: `[${subset.interval.low.toExponential(3)}, ${subset.interval.high.toExponential(3)}] at ${(subset.interval.level * 100).toFixed(0)}%` },
          { label: 'Effective sample size', value: fv(subset.effectiveSampleSize, 5) },
          { label: 'Samples used in total', value: subset.totalSamples.toLocaleString('en-US') },
          { label: 'Reached the threshold?', value: subset.reachedThreshold ? 'yes' : 'no — the estimate is for the last level reached, not the threshold' },
          { label: 'Exact value for this problem', value: exact.toExponential(3) },
        ]}
      />
      <p className="oc-chart-note">{subset.message}</p>
      <div style={OVERFLOW}>
        <DataTable
          caption="Subset simulation levels"
          columns={[
            { key: 'l', header: 'Level', numeric: true, render: (l) => String(l.level) },
            { key: 't', header: 'Intermediate threshold', numeric: true, render: (l) => fv(l.intermediateThreshold) },
            { key: 'p', header: 'Conditional probability', numeric: true, render: (l) => fv(l.conditionalProbability, 4) },
            { key: 'a', header: 'Acceptance rate', numeric: true, render: (l) => formatPercent(l.acceptanceRate, 3) },
            { key: 'g', header: 'Correlation factor γ', numeric: true, render: (l) => fv(l.correlationFactor, 4) },
            { key: 'n', header: 'Samples', numeric: true, render: (l) => l.samples.toLocaleString('en-US') },
          ]}
          rows={subset.levels}
        />
      </div>
      <p className="oc-chart-note">
        The exact value is shown because this particular failure region has one; a real model does not, which is why the effective sample size and the
        correlation factor γ matter — they are what keeps the interval honest when there is nothing to check against.
      </p>
    </>
  );
}

function ComparisonCardBody({ report, metric }: { report: CrnReport; metric: string }) {
  const rows: { label: string; body: ReactNode }[] = [
    { label: 'Paired-t with common random numbers', body: comparisonLines(report.paired) },
    { label: 'Welch on independent runs', body: comparisonLines(report.independent) },
  ];
  return (
    <>
      <h3 style={{ fontSize: 13, marginTop: 'var(--s3)' }}>Difference in {metric}</h3>
      {rows.map((r) => (
        <div key={r.label} style={{ marginBottom: 'var(--s3)' }}>
          <h4 style={{ fontSize: 12.5, margin: '0 0 var(--s2)' }}>{r.label}</h4>
          {r.body}
        </div>
      ))}
      <Notice tone={report.effective ? 'success' : 'warning'} title={report.effective ? 'Common random numbers reduced the variance' : 'Common random numbers did not help here'}>
        <p>{report.message}</p>
      </Notice>
      <KeyValueList
        items={[
          { label: 'Variance of the difference with CRN', value: fv(report.varianceWithCrn) },
          { label: 'Variance with independent streams', value: fv(report.varianceIndependent) },
          { label: 'Variance reduction factor', value: `${report.varianceReductionFactor.toFixed(2)}×` },
          { label: 'Variance removed', value: `${report.percentVarianceRemoved.toFixed(1)}%` },
        ]}
      />
      <p className="oc-chart-note">
        &ldquo;Is A better than B?&rdquo; is answered by the interval for the difference, which is narrower than either configuration&apos;s own interval.
        Neither comparison says what A is; the output analysis above does that.
      </p>
    </>
  );
}

function comparisonLines(report: CrnReport['paired']): ReactNode {
  return (
    <>
      <KeyValueList
        items={[
          { label: 'Method', value: report.method },
          { label: `Mean for ${report.labelA}`, value: fv(report.meanA) },
          { label: `Mean for ${report.labelB}`, value: fv(report.meanB) },
          { label: 'Estimated difference A − B', value: fv(report.meanDifference) },
          { label: 'Standard error of the difference', value: fv(report.standardError) },
          { label: 'Interval for the difference', value: ciText(report.differenceInterval) },
          { label: 'Degrees of freedom', value: fv(report.degreesOfFreedom, 3) },
          { label: 'Excludes zero?', value: report.significant ? 'yes' : 'no' },
        ]}
      />
      <p className="oc-chart-note">{report.conclusion}</p>
    </>
  );
}
