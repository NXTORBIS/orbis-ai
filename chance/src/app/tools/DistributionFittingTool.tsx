/**
 * Distribution fitting: which family describes this data, and how well?
 *
 * This screen is the bridge between imported data and every simulation tool:
 * a fitted family with honest uncertainty can be used as a simulation input,
 * but only if the fit is actually defensible. So the headline is not a single
 * "best distribution" — it is the ranking, the goodness-of-fit battery, the
 * Q–Q envelope and the non-parametric fallback shown together, because any one
 * of them alone is routinely over-read.
 *
 * Every number here comes from `src/engine/fitting/`. Nothing is estimated in
 * this file beyond formatting and the per-line parse of the text area.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  andersonDarling,
  chiSquareFitTest,
  compareMleAndMoments,
  cdfComparisonData,
  cramerVonMises,
  ecdfWithDkwBand,
  fitDistribution,
  fitRightCensored,
  histogramOverlayData,
  jarqueBera,
  kernelDensity,
  ksGoodnessOfFit,
  parametricBootstrapSteps,
  ppPlotData,
  profileLikelihoodInterval,
  qqEnvelopeSteps,
  qqPlotData,
  selectGaussianMixture,
  selectDistribution,
  shapiroWilk,
  WALD_LIMITATION,
  type BootstrapResult,
  type EstimatorComparison,
  type GaussianComponent,
  type CensoredObservation,
  type FitResult,
  type GofResult,
  type QqEnvelopeResult,
  type RankedFit,
  type SkipReason,
} from '../../engine/fitting';
import { EXACTNESS_LABEL, EngineError } from '../../engine/core/result';
import { DISTRIBUTIONS, getDistribution } from '../../engine/distributions/registry';
import type { DistributionDef } from '../../engine/distributions/types';
import { excessKurtosis, skewness, summarizeSample } from '../../engine/stats/descriptive';
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
  Segmented,
  SliderField,
  TextField,
  type ColumnDef,
} from '../../ui/primitives';
import { HistogramChart, LineChart } from '../../ui/charts/charts';
import { PpChart, QQChart, StepChart } from '../../ui/charts/advanced';
import { formatValue } from '../../ui/charts/scale';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { useApp } from '../store';

/* ------------------------------------------------------------------ config */

export interface DistributionFittingConfig {
  /** Raw text as typed. Parsed in a memo so the config stays small and serialisable. */
  dataText: string;
  /** Distribution id to report in detail; '' means "whichever AIC ranks first". */
  chosenFamily: string;
  /**
   * Whether to fit every compatible family and rank them. Off by default:
   * `selectDistribution` runs a multi-start maximum-likelihood fit for each of
   * 28 families, which blocked the main thread for 14 seconds on the built-in
   * dataset. Opening a tool should not freeze the tab, so the comparison is
   * something you ask for; a single named family is fitted until then.
   */
  runComparison: boolean;
  /** Confidence level for Wald, profile-likelihood and bootstrap intervals. */
  level: number;
  /** Treat values suffixed with '+' as right-censored and fit by censored MLE. */
  treatCensored: boolean;
  /** 0 means let the engine choose the bin count from n. */
  chiSquareBins: number;
  bandwidthRule: 'silverman' | 'scott' | 'manual';
  manualBandwidth: number;
  /** Tell the KDE the quantity cannot be negative, so it applies boundary reflection. */
  kdeNonNegative: boolean;
  /** Largest mixture component count BIC may choose (1 to 5). */
  mixtureMaxComponents: number;
  bootstrapReplicates: number;
  envelopeReplicates: number;
}

/**
 * Proschan (1963), intervals in hours between successive failures of the
 * air-conditioning system of a Boeing 720 aircraft (plane 7914). A published
 * dataset rather than invented numbers, and a genuinely interesting one: it is
 * strongly right-skewed, so the normal family is beaten decisively while
 * exponential, gamma, Weibull and log-normal are hard to separate — which is
 * exactly the situation the ranking caveats are about.
 */
const AIRCONDITIONING = [
  1, 3, 5, 7, 11, 11, 11, 12, 14, 14, 14, 16, 16, 20, 21, 23, 42, 47, 52, 62, 71, 71, 87, 90, 95, 120, 120, 225, 246, 261,
];

export const DISTRIBUTION_FITTING_DEFAULT: DistributionFittingConfig = {
  dataText: AIRCONDITIONING.join('\n'),
  chosenFamily: 'lognormal',
  runComparison: false,
  level: 0.95,
  treatCensored: false,
  chiSquareBins: 0,
  bandwidthRule: 'silverman',
  manualBandwidth: 20,
  kdeNonNegative: true,
  mixtureMaxComponents: 3,
  bootstrapReplicates: 300,
  envelopeReplicates: 200,
};

/* ------------------------------------------------------------------ parsing */

interface ParsedData {
  values: number[];
  observations: CensoredObservation[];
  censoredCount: number;
  /** One entry per line that could not be read, with the line number. */
  lineErrors: { line: number; text: string; reason: string }[];
}

/**
 * Pasted data is untrusted: every token is checked, and anything unreadable is
 * reported with its line number rather than dropped. A silent drop here would
 * change n and therefore every interval downstream.
 */
function parseData(text: string): ParsedData {
  const values: number[] = [];
  const observations: CensoredObservation[] = [];
  const lineErrors: ParsedData['lineErrors'] = [];
  let censoredCount = 0;
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const tokens = line.split(/[,;\s]+/).filter(Boolean);
    for (const token of tokens) {
      const censored = token.endsWith('+');
      const body = censored ? token.slice(0, -1) : token;
      const value = Number(body);
      if (body === '' || !Number.isFinite(value)) {
        // Truncated so a long pasted line cannot dominate the message. Rendered
        // as text by React, never as markup.
        lineErrors.push({ line: i + 1, text: token.slice(0, 40), reason: `"${token.slice(0, 40)}" is not a finite number.` });
        continue;
      }
      values.push(value);
      observations.push({ time: value, censored });
      if (censored) censoredCount++;
    }
  });
  return { values, observations, censoredCount, lineErrors };
}

/* --------------------------------------------------------- generator driver */

/**
 * Drive one of the engine's generators in chunks, returning a cancel function.
 * The `setTimeout` between `next()` calls is the whole point: it hands control
 * back to the event loop so the Cancel button can actually be clicked, the
 * same reason the simulation runner yields between chunks of trials.
 */
function driveGenerator<R>(
  gen: Generator<number, R, void>,
  handlers: { onProgress(done: number): void; onDone(result: R): void; onError(error: unknown): void },
): () => void {
  let cancelled = false;
  const tick = (): void => {
    if (cancelled) return;
    try {
      const step = gen.next();
      if (step.done) {
        handlers.onDone(step.value);
        return;
      }
      handlers.onProgress(step.value);
      window.setTimeout(tick, 0);
    } catch (e) {
      handlers.onError(e);
    }
  };
  window.setTimeout(tick, 0);
  return () => {
    cancelled = true;
  };
}

/* ----------------------------------------------------------------- helpers */

type SortKey = 'aic' | 'aicc' | 'bic' | 'weight' | 'logLikelihood' | 'name';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'aic', label: 'AIC' },
  { value: 'aicc', label: 'AICc' },
  { value: 'bic', label: 'BIC' },
  { value: 'weight', label: 'Akaike weight' },
  { value: 'logLikelihood', label: 'Log-likelihood' },
  { value: 'name', label: 'Name' },
];

function sortValue(row: RankedFit, key: SortKey): number | string {
  switch (key) {
    case 'aic':
      return row.fit.aic;
    case 'aicc':
      return row.fit.aicc;
    case 'bic':
      return row.fit.bic;
    case 'weight':
      return -row.akaikeWeight;
    case 'logLikelihood':
      return -row.fit.logLikelihood;
    case 'name':
      return row.fit.distributionName;
  }
}

function num(value: number | null | undefined, digits = 5): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'not available';
  return formatValue(value, digits);
}

function pValueText(g: GofResult): string {
  if (g.pValue === null) return 'no p-value (critical values only)';
  if (g.pValue < 1e-4) return '< 0.0001';
  return formatValue(g.pValue, 4);
}

const BASIS_LABEL: Record<GofResult['pValueBasis'], string> = {
  exact: 'exact null distribution',
  'case-specific-table': 'tabulated critical values for this estimated-parameter case',
  asymptotic: 'asymptotic approximation',
  none: 'no p-value route available',
};

/** Fit quality is never signalled by colour alone: the word is always present. */
function verdict(g: GofResult): string {
  if (g.rejectedAt05 === null) return 'No decision at the 5% level';
  return g.rejectedAt05 ? 'Rejected at the 5% level' : 'Not rejected at the 5% level';
}


const SKIPPED_COLUMNS: ColumnDef<SkipReason>[] = [
  { key: 'n', header: 'Distribution', render: (r) => r.distributionName },
  { key: 'r', header: 'Why it was not fitted', render: (r) => r.reason },
];

const CRITICAL_VALUE_COLUMNS: ColumnDef<{ level: number; value: number }>[] = [
  { key: 'l', header: 'Level', numeric: true, render: (r) => num(r.level, 3) },
  { key: 'v', header: 'Critical value', numeric: true, render: (r) => num(r.value, 5) },
];

const COMPONENT_COLUMNS: ColumnDef<GaussianComponent>[] = [
  { key: 'i', header: 'Component', numeric: true, render: (_r, i) => i + 1 },
  { key: 'w', header: 'Weight', numeric: true, render: (r) => num(r.weight, 4) },
  { key: 'm', header: 'Mean', numeric: true, render: (r) => num(r.mean) },
  { key: 's', header: 'Standard deviation', numeric: true, render: (r) => num(r.sd) },
];

/* ------------------------------------------------------------------- screen */

export function DistributionFittingTool({ config }: { config: DistributionFittingConfig }) {
  const app = useApp();
  const set = (patch: Partial<DistributionFittingConfig>) => app.updateConfig({ ...config, ...patch });

  const [sortKey, setSortKey] = useState<SortKey>('aic');
  const [showAllCandidates, setShowAllCandidates] = useState(false);
  const [bootstrap, setBootstrap] = useState<BootstrapResult | null>(null);
  const [envelope, setEnvelope] = useState<QqEnvelopeResult | null>(null);
  const [running, setRunning] = useState<{ job: 'bootstrap' | 'envelope'; done: number; total: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  // A run left going after the user navigates away computes a result nothing
  // will display, so it is cancelled on unmount.
  useEffect(() => () => cancelRef.current?.(), []);

  const parsed = useMemo(() => parseData(config.dataText), [config.dataText]);
  const censoredActive = config.treatCensored && parsed.censoredCount > 0;

  const summary = useMemo(() => {
    if (parsed.values.length < 2) return null;
    return {
      ...summarizeSample(parsed.values),
      skew: skewness(parsed.values),
      kurt: excessKurtosis(parsed.values),
    };
  }, [parsed.values]);

  /** The ranking: every registry family fitted or skipped with a stated reason. */
  const selection = useMemo(() => {
    if (!config.runComparison) {
      return { ok: false as const, error: 'NOT_REQUESTED' };
    }
    if (parsed.values.length < 3) {
      return { ok: false as const, error: 'Enter at least 3 numbers before anything can be fitted.' };
    }
    try {
      return { ok: true as const, value: selectDistribution(parsed.values, { level: config.level }) };
    } catch (e) {
      return { ok: false as const, error: e instanceof EngineError ? e.message : String(e) };
    }
  }, [parsed.values, config.level, config.runComparison]);

  const rankedById = useMemo(() => {
    if (!selection.ok) return new Map<string, RankedFit>();
    return new Map(selection.value.ranked.map((r) => [r.fit.distributionId, r]));
  }, [selection]);

  const chosenId = useMemo(() => {
    if (config.chosenFamily && rankedById.has(config.chosenFamily)) return config.chosenFamily;
    if (config.chosenFamily && !selection.ok) return config.chosenFamily;
    return selection.ok ? selection.value.ranked[0].fit.distributionId : config.chosenFamily;
  }, [config.chosenFamily, rankedById, selection]);

  const chosenDef = useMemo((): DistributionDef | null => {
    if (!chosenId) return null;
    try {
      return getDistribution(chosenId);
    } catch {
      return null;
    }
  }, [chosenId]);

  /** The detailed fit for the chosen family, censored or not. */
  const chosen = useMemo(() => {
    if (!chosenDef) return { ok: false as const, error: 'No distribution has been chosen yet.' };
    try {
      const fit = censoredActive
        ? fitRightCensored(chosenDef, parsed.observations, { level: config.level })
        : fitDistribution(chosenDef, parsed.values, { level: config.level });
      return { ok: true as const, value: fit };
    } catch (e) {
      return { ok: false as const, error: e instanceof EngineError ? e.message : String(e) };
    }
  }, [chosenDef, censoredActive, parsed.observations, parsed.values, config.level]);

  /** Profile-likelihood limits, one parameter at a time: each may fail alone. */
  const profiles = useMemo(() => {
    if (!chosenDef || !chosen.ok || censoredActive) return [];
    return chosen.value.uncertainty.map((u) => {
      try {
        return { key: u.key, interval: profileLikelihoodInterval(chosenDef, parsed.values, chosen.value, u.key, config.level), error: null };
      } catch (e) {
        return { key: u.key, interval: null, error: e instanceof EngineError ? e.message : String(e) };
      }
    });
  }, [chosenDef, chosen, censoredActive, parsed.values, config.level]);

  const comparison = useMemo(() => {
    if (!chosenDef || parsed.values.length < 3) return { ok: false as const, error: 'Not enough data for a moment comparison.' };
    try {
      return { ok: true as const, value: compareMleAndMoments(chosenDef, parsed.values, { level: config.level }) };
    } catch (e) {
      return { ok: false as const, error: e instanceof EngineError ? e.message : String(e) };
    }
  }, [chosenDef, parsed.values, config.level]);

  /** Six tests, each allowed to fail on its own terms and say why. */
  const gof = useMemo(() => {
    if (!chosenDef || !chosen.ok) return [];
    const fit = chosen.value;
    const ctx = { parametersEstimated: true, estimatedParams: fit.estimatedParams };
    const cdf = (x: number): number => chosenDef.cdf(x, fit.params);
    const family = chosenDef.id === 'normal' ? ('normal' as const) : chosenDef.id === 'exponential' ? ('exponential' as const) : ('other' as const);
    const attempts: { label: string; run: () => GofResult }[] = [
      { label: 'Kolmogorov–Smirnov', run: () => ksGoodnessOfFit(parsed.values, cdf, ctx) },
      { label: 'Anderson–Darling', run: () => andersonDarling(parsed.values, cdf, { ...ctx, family }) },
      { label: 'Cramér–von Mises', run: () => cramerVonMises(parsed.values, cdf, ctx) },
      {
        label: 'Chi-square',
        run: () => chiSquareFitTest(parsed.values, chosenDef, fit.params, ctx, config.chiSquareBins > 0 ? config.chiSquareBins : undefined),
      },
      { label: 'Shapiro–Wilk (normality)', run: () => shapiroWilk(parsed.values) },
      { label: 'Jarque–Bera (normality)', run: () => jarqueBera(parsed.values) },
    ];
    return attempts.map((a) => {
      try {
        return { label: a.label, result: a.run(), error: null as string | null };
      } catch (e) {
        return { label: a.label, result: null, error: e instanceof EngineError ? e.message : String(e) };
      }
    });
  }, [chosenDef, chosen, parsed.values, config.chiSquareBins]);

  const plots = useMemo(() => {
    if (!chosenDef || !chosen.ok) return null;
    const p = chosen.value.params;
    try {
      const qq = qqPlotData(parsed.values, chosenDef, p);
      const pp = ppPlotData(parsed.values, chosenDef, p);
      const cdfs = cdfComparisonData(parsed.values, chosenDef, p);
      const hist = histogramOverlayData(parsed.values, chosenDef, p);
      const n = parsed.values.length;
      return { ok: true as const, qq, pp, cdfs, hist, n };
    } catch (e) {
      return { ok: false as const, error: e instanceof EngineError ? e.message : String(e) };
    }
  }, [chosenDef, chosen, parsed.values]);

  const kde = useMemo(() => {
    if (parsed.values.length < 3) return { ok: false as const, error: 'Kernel density estimation needs at least 3 observations.' };
    try {
      return {
        ok: true as const,
        value: kernelDensity(parsed.values, {
          rule: config.bandwidthRule === 'manual' ? 'silverman' : config.bandwidthRule,
          bandwidth: config.bandwidthRule === 'manual' ? config.manualBandwidth : undefined,
          bounds: config.kdeNonNegative ? { min: 0 } : undefined,
        }),
      };
    } catch (e) {
      return { ok: false as const, error: e instanceof EngineError ? e.message : String(e) };
    }
  }, [parsed.values, config.bandwidthRule, config.manualBandwidth, config.kdeNonNegative]);

  const ecdf = useMemo(() => {
    if (parsed.values.length < 2) return { ok: false as const, error: 'An empirical distribution function needs at least 2 observations.' };
    try {
      return { ok: true as const, value: ecdfWithDkwBand(parsed.values, config.level) };
    } catch (e) {
      return { ok: false as const, error: e instanceof EngineError ? e.message : String(e) };
    }
  }, [parsed.values, config.level]);

  const mixture = useMemo(() => {
    if (parsed.values.length < 10) return { ok: false as const, error: 'A Gaussian mixture needs at least 10 observations to be worth fitting.' };
    try {
      return { ok: true as const, value: selectGaussianMixture(parsed.values, { min: 1, max: config.mixtureMaxComponents }) };
    } catch (e) {
      return { ok: false as const, error: e instanceof EngineError ? e.message : String(e) };
    }
  }, [parsed.values, config.mixtureMaxComponents]);

  const sortedCandidates = useMemo(() => {
    if (!selection.ok) return [];
    const rows = [...selection.value.ranked];
    rows.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv));
      return av - bv;
    });
    return showAllCandidates ? rows : rows.slice(0, 12);
  }, [selection, sortKey, showAllCandidates]);

  /* ------------------------------------------------------------ run actions */

  const startRun = (job: 'bootstrap' | 'envelope'): void => {
    if (!chosenDef || !chosen.ok) return;
    cancelRef.current?.();
    setRunError(null);
    const total = job === 'bootstrap' ? config.bootstrapReplicates : config.envelopeReplicates;
    setRunning({ job, done: 0, total });
    const finish = (): void => {
      setRunning(null);
      cancelRef.current = null;
    };
    const onError = (e: unknown): void => {
      setRunError(e instanceof EngineError ? e.message : String(e));
      finish();
    };
    if (job === 'bootstrap') {
      setBootstrap(null);
      const gen = parametricBootstrapSteps(chosenDef, chosen.value, { replicates: config.bootstrapReplicates, level: config.level });
      cancelRef.current = driveGenerator(gen, {
        onProgress: (done) => setRunning({ job, done, total }),
        onDone: (result) => {
          setBootstrap(result);
          finish();
        },
        onError,
      });
    } else {
      setEnvelope(null);
      const gen = qqEnvelopeSteps(parsed.values, chosenDef, chosen.value.params, { replicates: config.envelopeReplicates, level: config.level });
      cancelRef.current = driveGenerator(gen, {
        onProgress: (done) => setRunning({ job, done, total }),
        onDone: (result) => {
          setEnvelope(result);
          finish();
        },
        onError,
      });
    }
  };

  const cancelRun = (): void => {
    cancelRef.current?.();
    cancelRef.current = null;
    setRunning(null);
  };

  // Results from a previous family or dataset would be silently mislabelled, so
  // they are cleared whenever the fit they belong to changes.
  const fitKey = `${chosenId}|${parsed.values.length}|${censoredActive}|${config.level}|${chosen.ok ? chosen.value.logLikelihood : 'none'}`;
  const lastFitKey = useRef(fitKey);
  useEffect(() => {
    if (lastFitKey.current !== fitKey) {
      lastFitKey.current = fitKey;
      cancelRef.current?.();
      cancelRef.current = null;
      setRunning(null);
      setBootstrap(null);
      setEnvelope(null);
      setRunError(null);
    }
  }, [fitKey]);

  /* ---------------------------------------------------------------- columns */

  const comparisonColumns: ColumnDef<EstimatorComparison['differences'][number]>[] = [
    { key: 'p', header: 'Parameter', render: (r) => chosenDef?.params.find((s) => s.key === r.key)?.label ?? r.key },
    { key: 'm', header: 'Maximum likelihood', numeric: true, render: (r) => num(r.mle) },
    { key: 'o', header: 'Method of moments', numeric: true, render: (r) => num(r.moments) },
    { key: 'd', header: 'Difference', numeric: true, render: (r) => num(r.absolute) },
    { key: 's', header: 'In standard errors', numeric: true, render: (r) => (r.inStandardErrors === null ? 'no standard error' : num(r.inStandardErrors, 3)) },
  ];

  const candidateColumns: ColumnDef<RankedFit>[] = [
    { key: 'rank', header: '#', numeric: true, render: (r) => r.rank },
    {
      key: 'name',
      header: 'Distribution',
      render: (r) => (
        <span>
          {r.fit.distributionName}
          {r.fit.distributionId === chosenId ? ' (shown in detail)' : ''}
        </span>
      ),
    },
    { key: 'k', header: 'k', numeric: true, title: 'Parameters estimated from the data', render: (r) => r.fit.estimatedParams },
    { key: 'll', header: 'ln L', numeric: true, render: (r) => num(r.fit.logLikelihood, 6) },
    { key: 'aic', header: 'AIC', numeric: true, render: (r) => num(r.fit.aic, 6) },
    { key: 'daic', header: 'ΔAIC', numeric: true, render: (r) => num(r.deltaAic, 4) },
    { key: 'aicc', header: 'AICc', numeric: true, render: (r) => num(r.fit.aicc, 6) },
    { key: 'bic', header: 'BIC', numeric: true, render: (r) => num(r.fit.bic, 6) },
    { key: 'w', header: 'Akaike weight', numeric: true, render: (r) => num(r.akaikeWeight, 4) },
    { key: 'er', header: 'Evidence ratio', numeric: true, title: 'Relative likelihood of the best candidate against this one', render: (r) => num(r.evidenceRatio, 4) },
    { key: 'ex', header: 'Exactness', render: (r) => <Badge variant={r.fit.exactness}>{EXACTNESS_LABEL[r.fit.exactness]}</Badge> },
    {
      key: 'pick',
      header: 'Report',
      render: (r) => (
        <Button size="sm" variant="ghost" onClick={() => set({ chosenFamily: r.fit.distributionId })} disabled={r.fit.distributionId === chosenId}>
          Choose
        </Button>
      ),
    },
  ];

  /* ----------------------------------------------------------------- render */

  return (
    <>
      <ToolHeader toolId="distribution-fitting" />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="Data">
            <TextField
              label="Observations (one or more numbers per line)"
              value={config.dataText}
              onChange={(dataText) => set({ dataText })}
              multiline
              rows={12}
              monospace
              hint="Numbers separated by spaces, commas or newlines. A trailing + marks a right-censored observation (the value is at least this). Lines starting with # are ignored."
            />
            <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
              <Button size="sm" icon="fitting" onClick={() => set({ dataText: AIRCONDITIONING.join('\n') })}>
                Load the built-in dataset
              </Button>
            </div>
            <p className="oc-chart-note">
              The built-in dataset is Proschan (1963): {AIRCONDITIONING.length} intervals, in hours, between successive failures of the air-conditioning system
              of one Boeing 720 aircraft. It is a published dataset, not a generated one.
            </p>

            {parsed.lineErrors.length > 0 && (
              <Notice tone="warning" title={`${parsed.lineErrors.length} value(s) could not be read and are NOT included in n`}>
                <ul className="oc-assumption-list">
                  {parsed.lineErrors.slice(0, 12).map((e, i) => (
                    <li key={i}>
                      Line {e.line}: {e.reason}
                    </li>
                  ))}
                </ul>
                {parsed.lineErrors.length > 12 && <p>And {parsed.lineErrors.length - 12} more. Fix or remove them; nothing here is silently discarded.</p>}
              </Notice>
            )}

            {summary ? (
              <KeyValueList
                items={[
                  { label: 'n (values read)', value: summary.n.toLocaleString('en-US') },
                  { label: 'Values rejected', value: parsed.lineErrors.length.toLocaleString('en-US') },
                  { label: 'Marked censored (+)', value: parsed.censoredCount.toLocaleString('en-US') },
                  { label: 'Minimum', value: num(summary.min) },
                  { label: 'Maximum', value: num(summary.max) },
                  { label: 'Mean', value: num(summary.mean) },
                  { label: 'Standard deviation (n − 1)', value: num(summary.sd) },
                  { label: 'Skewness', value: num(summary.skew, 4) },
                  { label: 'Excess kurtosis', value: num(summary.kurt, 4) },
                ]}
              />
            ) : (
              <Notice tone="info">Enter at least 2 numbers to see the sample summary.</Notice>
            )}
          </Card>

          <Card title="Fitting options">
            <SelectField
              label="Family reported in detail"
              value={config.chosenFamily}
              onChange={(chosenFamily) => set({ chosenFamily })}
              options={[
                { value: '', label: 'Whichever AIC ranks first' },
                ...DISTRIBUTIONS.map((d) => ({ value: d.id, label: `${d.name}${rankedById.has(d.id) ? '' : ' — not fitted to this data'}` })),
              ]}
              hint="Choosing a family here does not make it correct: read the goodness-of-fit section and the Q–Q envelope before using it."
            />
            <NumberField
              label="Confidence level for intervals"
              value={config.level}
              onChange={(level) => set({ level })}
              min={0.5}
              max={0.999}
              step={0.01}
              hint="Applies to the Wald, profile-likelihood, bootstrap and DKW intervals."
            />
            <NumberField
              label="Chi-square bins (0 = chosen from n)"
              value={config.chiSquareBins}
              onChange={(chiSquareBins) => set({ chiSquareBins })}
              min={0}
              max={60}
              integer
              hint="Equiprobable bins. Fewer bins lose detail; more bins drive the expected counts below the point where the approximation holds."
            />
            <Checkbox
              checked={config.treatCensored}
              onChange={(treatCensored) => set({ treatCensored })}
              label="Treat values suffixed with + as right-censored"
              description="A right-censored observation says only that the value is at least this. Ignoring that biases every estimate downwards."
            />
          </Card>

          <AiAssistPanel
            capability="suggestMethod"
            context="Which family to fit is a modelling decision, not a computation. The ranking, the goodness-of-fit battery and the Q–Q envelope on this screen are the evidence; nothing here is produced by a language model."
          />
        </div>

        <div className="oc-stack">
          {!selection.ok && selection.error === 'NOT_REQUESTED' && (
            <Card title="Model selection" hint="Compare every compatible family and rank them by information criteria.">
              <Notice tone="info" title="The full comparison is not run automatically">
                <p style={{ marginTop: 0 }}>
                  Ranking the families means running a multi-start maximum-likelihood fit for each of them. Across the registry that is long enough to make the
                  page unresponsive while it runs, so it is run only when you ask for it. Until then the single family selected below is fitted, and everything
                  on this screen describes that one.
                </p>
                <p style={{ marginBottom: 0 }}>
                  Bear in mind what the ranking can and cannot say: it compares only the families implemented here, and a gap of less than about 2 in AIC is not
                  a meaningful preference.
                </p>
              </Notice>
              <div className="oc-btn-row">
                <Button icon="play" variant="primary" onClick={() => set({ runComparison: true })}>
                  Compare every family
                </Button>
              </div>
            </Card>
          )}

          {!selection.ok && selection.error !== 'NOT_REQUESTED' && <Notice tone="error" title="Nothing could be fitted">{selection.error}</Notice>}

          {selection.ok && (
            <Card
              title="Model selection"
              hint={`${selection.value.ranked.length} families fitted, ${selection.value.skipped.length} skipped, n = ${selection.value.n}.`}
            >
              <Segmented label="Sort the candidates by" value={sortKey} onChange={(v) => setSortKey(v)} options={SORT_OPTIONS} />
              {/* Many rows and twelve columns: the horizontal scroll keeps the
                  page itself from overflowing at 390px, a hard project rule. */}
              <div style={{ overflowX: 'auto' }}>
                <DataTable caption="Candidate distributions ranked by information criterion" columns={candidateColumns} rows={sortedCandidates} />
              </div>
              {selection.value.ranked.length > 12 && (
                <Button size="sm" variant="ghost" onClick={() => setShowAllCandidates(!showAllCandidates)}>
                  {showAllCandidates ? 'Show only the leading 12' : `Show all ${selection.value.ranked.length} fitted families`}
                </Button>
              )}
              <Notice tone="info" title="What this ranking does and does not say" items={selection.value.statements} />
              {selection.value.skipped.length > 0 && (
                <Disclosure title={`${selection.value.skipped.length} families were skipped, with reasons`} icon="info">
                  <DataTable
                    caption="Families not fitted, and why"
                    columns={SKIPPED_COLUMNS}
                    rows={selection.value.skipped}
                  />
                  <p className="oc-chart-note">
                    A skipped family is not a failed fit: it is a family that cannot describe this data at any parameter values — a discrete family on
                    fractional data, or a bounded family on values outside its support.
                  </p>
                </Disclosure>
              )}
            </Card>
          )}

          {!chosen.ok && chosenDef && <Notice tone="error" title={`The ${chosenDef.name} distribution could not be fitted`}>{chosen.error}</Notice>}

          {chosen.ok && chosenDef && (
            <>
              <Card title={`Chosen fit: ${chosen.value.distributionName}`}>
                <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--s3)' }}>
                  <Badge variant={chosen.value.exactness}>{EXACTNESS_LABEL[chosen.value.exactness]}</Badge>
                  <span style={{ fontSize: 12.5 }}>{chosenDef.formula}</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Fitted parameters with standard errors and intervals"
                    columns={[
                      { key: 'p', header: 'Parameter', render: (r: ParamRow) => `${r.label} (${r.symbol})` },
                      { key: 'e', header: 'Estimate', numeric: true, render: (r: ParamRow) => num(r.estimate) },
                      { key: 's', header: 'Standard error', numeric: true, render: (r: ParamRow) => (r.standardError === null ? 'see note' : num(r.standardError)) },
                      { key: 'w', header: `Wald ${(config.level * 100).toFixed(0)}%`, render: (r: ParamRow) => (r.wald ? `${num(r.wald.low)} to ${num(r.wald.high)}` : 'see note') },
                      {
                        key: 'pr',
                        header: `Profile likelihood ${(config.level * 100).toFixed(0)}%`,
                        render: (r: ParamRow) => (r.profile ? `${num(r.profile.low)} to ${num(r.profile.high)}` : r.profileError ?? 'not computed'),
                      },
                      {
                        key: 'b',
                        header: `Bootstrap ${(config.level * 100).toFixed(0)}%`,
                        render: (r: ParamRow) =>
                          r.bootstrap ? `${num(r.bootstrap.low)} to ${num(r.bootstrap.high)}` : 'run the bootstrap below',
                      },
                    ]}
                    rows={chosen.value.uncertainty.map((u): ParamRow => {
                      const spec = chosenDef.params.find((s) => s.key === u.key);
                      const prof = profiles.find((p) => p.key === u.key);
                      return {
                        label: spec?.label ?? u.key,
                        symbol: spec?.symbol ?? u.key,
                        estimate: u.estimate,
                        standardError: u.standardError,
                        wald: u.wald,
                        profile: prof?.interval ?? null,
                        profileError: prof?.error ?? null,
                        bootstrap: bootstrap?.intervals[u.key] ?? null,
                        unavailableReason: u.unavailableReason ?? null,
                      };
                    })}
                  />
                </div>

                {chosen.value.uncertainty
                  .filter((u) => u.standardError === null)
                  .map((u) => (
                    <Notice key={u.key} tone="warning" title={`No standard error for ${chosenDef.params.find((s) => s.key === u.key)?.label ?? u.key}`}>
                      <p>{u.unavailableReason ?? 'The observed information does not apply to this parameter.'}</p>
                      <p>
                        This is not a missing number that could be filled in: the usual theory does not apply here, so the parametric bootstrap below is the
                        route to an interval for this parameter.
                      </p>
                    </Notice>
                  ))}

                {profiles
                  .filter((p) => p.error)
                  .map((p) => (
                    <Notice key={p.key} tone="warning" title={`No profile-likelihood limit for ${p.key}`}>
                      {p.error}
                    </Notice>
                  ))}

                <KeyValueList
                  items={[
                    { label: 'Observations used', value: chosen.value.n.toLocaleString('en-US') },
                    { label: 'Observations discarded', value: chosen.value.nDiscarded.toLocaleString('en-US') },
                    { label: 'Why they were discarded', value: chosen.value.discardReasons.length ? chosen.value.discardReasons.join(' ') : 'None were discarded.' },
                    { label: 'Parameters estimated', value: String(chosen.value.estimatedParams) },
                    { label: 'Log-likelihood', value: num(chosen.value.logLikelihood, 8) },
                    { label: 'Estimator', value: chosen.value.method },
                    { label: 'Converged', value: chosen.value.convergence.converged ? 'Yes' : 'No' },
                    { label: 'Iterations', value: chosen.value.convergence.iterations.toLocaleString('en-US') },
                    { label: 'Optimiser message', value: chosen.value.convergence.message },
                  ]}
                />
                <Notice tone="info" title="Which interval to prefer">
                  {WALD_LIMITATION}
                </Notice>
                {chosen.value.warnings.length > 0 && <Notice tone="warning" title="Warnings from the fit" items={chosen.value.warnings} />}
                <ExplanationPanel explanation={chosen.value.explanation} />
              </Card>

              <Card title="Uncertainty by parametric bootstrap" hint="An independent route to intervals, and the only one for a support endpoint.">
                <NumberField
                  label="Bootstrap resamples"
                  value={config.bootstrapReplicates}
                  onChange={(bootstrapReplicates) => set({ bootstrapReplicates })}
                  min={50}
                  max={5000}
                  integer
                  hint="Each resample is drawn from the fitted distribution and refitted, so this measures the estimator's own behaviour at n = this sample size."
                />
                {running?.job === 'bootstrap' ? (
                  <RunningState completed={running.done} total={running.total} unitLabel="resamples" onCancel={cancelRun} />
                ) : (
                  <Button icon="play" variant="primary" onClick={() => startRun('bootstrap')} disabled={running !== null}>
                    Run the bootstrap
                  </Button>
                )}
                {runError && <Notice tone="error">{runError}</Notice>}
                {bootstrap && (
                  <>
                    <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', alignItems: 'center', margin: 'var(--s3) 0' }}>
                      <Badge variant="empirical">{EXACTNESS_LABEL.empirical}</Badge>
                      <span style={{ fontSize: 12.5 }}>
                        {bootstrap.completed.toLocaleString('en-US')} resamples completed, {bootstrap.failures.toLocaleString('en-US')} could not be refitted.
                      </span>
                    </div>
                    <KeyValueList
                      items={Object.keys(bootstrap.intervals).map((key) => ({
                        label: `${chosenDef.params.find((s) => s.key === key)?.label ?? key} — bias of the estimator`,
                        value: num(bootstrap.bias[key], 4),
                      }))}
                    />
                    {bootstrap.warnings.length > 0 && <Notice tone="warning" title="What the bootstrap does and does not cover" items={bootstrap.warnings} />}
                  </>
                )}
              </Card>

              <Card title="Maximum likelihood against method of moments">
                {!comparison.ok && <Notice tone="error">{comparison.error}</Notice>}
                {comparison.ok && (
                  <>
                    <div style={{ overflowX: 'auto' }}>
                      <DataTable
                        caption="Maximum likelihood and method-of-moments estimates side by side"
                        columns={comparisonColumns}
                        rows={comparison.value.differences}
                        emptyMessage="No per-parameter comparison is available for this family."
                      />
                    </div>
                    <Notice
                      tone={comparison.value.materialDisagreement ? 'warning' : 'info'}
                      title={comparison.value.materialDisagreement ? 'The two estimators disagree materially' : 'The two estimators agree'}
                      items={comparison.value.statements}
                    />
                    {comparison.value.momentsUnavailableReason && <Notice tone="warning">{comparison.value.momentsUnavailableReason}</Notice>}
                  </>
                )}
              </Card>

              <Card title="Goodness of fit">
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Goodness-of-fit tests with their statistics, p-values and p-value routes"
                    columns={[
                      { key: 'n', header: 'Test', render: (r: GofRow) => r.label },
                      { key: 's', header: 'Statistic', render: (r: GofRow) => (r.result ? `${r.result.statisticName} = ${num(r.result.statistic)}` : 'not computed') },
                      { key: 'p', header: 'p-value', numeric: true, render: (r: GofRow) => (r.result ? pValueText(r.result) : '—') },
                      { key: 'b', header: 'p-value route', render: (r: GofRow) => (r.result ? BASIS_LABEL[r.result.pValueBasis] : '—') },
                      {
                        key: 'd',
                        header: 'Degrees of freedom',
                        numeric: true,
                        render: (r: GofRow) => (r.result?.degreesOfFreedom === null || r.result === null ? 'not applicable' : String(r.result.degreesOfFreedom)),
                      },
                      { key: 'v', header: 'At the 5% level', render: (r: GofRow) => (r.result ? verdict(r.result) : r.error ?? '—') },
                    ]}
                    rows={gof}
                  />
                </div>
                <Notice tone="warning" title="How to read every one of these">
                  <p>
                    A test that fails to reject is NOT evidence that the distribution is correct. It means the data are not inconsistent enough with it to be
                    detected at this sample size, and many other families would survive the same test.
                  </p>
                  <p>
                    The parameters above were estimated from the same data being tested, so each test is conservative: the p-value is too large and rejection
                    is harder than the nominal level suggests.
                  </p>
                  <p>
                    Anderson–Darling weights the tails far more heavily than Kolmogorov–Smirnov, which is driven by the largest single gap near the middle. The
                    tails are what matter for risk, so a large A² with a small D is the case to take seriously, not to average away.
                  </p>
                </Notice>
                {gof.map((row) => (
                  <Disclosure key={row.label} title={`${row.label}: the statements that come with it`} icon="info">
                    {row.error && <Notice tone="warning">{row.error}</Notice>}
                    {row.result && (
                      <>
                        <ul className="oc-assumption-list">
                          {row.result.notes.map((nt, i) => (
                            <li key={`n${i}`}>{nt}</li>
                          ))}
                          {row.result.caveats.map((c, i) => (
                            <li key={`c${i}`}>{c}</li>
                          ))}
                        </ul>
                        {row.result.criticalValues && (
                          <DataTable
                            caption={`Tabulated critical values for ${row.label}`}
                            columns={CRITICAL_VALUE_COLUMNS}
                            rows={row.result.criticalValues}
                          />
                        )}
                      </>
                    )}
                  </Disclosure>
                ))}
              </Card>

              <Card title="Diagnostic plots">
                {plots && !plots.ok && <Notice tone="error">{plots.error}</Notice>}
                {plots?.ok && (
                  <>
                    <NumberField
                      label="Simulated samples for the Q–Q envelope"
                      value={config.envelopeReplicates}
                      onChange={(envelopeReplicates) => set({ envelopeReplicates })}
                      min={50}
                      max={2000}
                      integer
                      hint="Samples of the same size are drawn from the fitted distribution; the envelope is the spread of each order statistic across them."
                    />
                    {running?.job === 'envelope' ? (
                      <RunningState completed={running.done} total={running.total} unitLabel="simulated samples" onCancel={cancelRun} />
                    ) : (
                      <Button icon="play" onClick={() => startRun('envelope')} disabled={running !== null}>
                        Compute the Q–Q envelope
                      </Button>
                    )}
                    <QQChart
                      title={`Q–Q plot against the fitted ${chosen.value.distributionName}`}
                      description={`Theoretical quantiles of the fitted ${chosen.value.distributionName} against the ${plots.n} sorted observations, with the identity reference line${envelope ? ' and a bootstrap envelope' : ''}.`}
                      points={plots.qq.points.map((p) => ({ theoretical: p.x, sample: p.y }))}
                      referenceLine={plots.qq.referenceLine}
                      envelope={envelope ? envelope.points.map((p) => ({ theoretical: p.theoretical, lower: p.low, upper: p.high })) : null}
                      note={plots.qq.note}
                    />
                    {envelope ? (
                      <Notice tone="info" title={`Envelope: ${(envelope.outsideFraction * 100).toFixed(1)}% of points fall outside it`} items={[envelope.method, ...envelope.caveats]} />
                    ) : (
                      <Notice tone="warning" title="Without an envelope a Q–Q plot is a Rorschach test">
                        Every finite sample wanders from the line in the tails. Until the envelope is computed there is no way to tell an ordinary wander from a
                        real misfit.
                      </Notice>
                    )}
                    <PpChart
                      title="P–P plot"
                      description={`Fitted cumulative probability at each observation against its empirical position, for ${plots.n} observations.`}
                      points={plots.pp.points.map((p) => ({ theoretical: p.x, sample: p.y }))}
                      note={plots.pp.note}
                    />
                    <StepChart
                      title="Empirical against fitted distribution function"
                      description={`The empirical distribution function of ${plots.n} observations as a step function, with the fitted continuous curve for comparison.`}
                      series={[
                        { label: 'Empirical (step)', points: plots.cdfs.empirical },
                        { label: `Fitted ${chosen.value.distributionName}`, points: plots.cdfs.fitted, dashed: true },
                      ]}
                      xLabel="Value"
                      yLabel="Cumulative probability"
                      note={`The largest vertical gap is ${num(plots.cdfs.largestGap.gap, 4)} at x = ${num(plots.cdfs.largestGap.x)} — this gap is the Kolmogorov–Smirnov statistic above.`}
                    />
                    <HistogramChart
                      title="Histogram with the fitted density"
                      description={`Histogram of ${plots.n} observations with the fitted ${chosen.value.distributionName} density drawn over it.`}
                      bins={plots.hist.bins.map((b) => ({ ...b, proportion: b.count / plots.n }))}
                      xLabel="Value"
                      overlay={{ label: `Fitted ${chosen.value.distributionName}`, points: plots.hist.density }}
                      note={plots.hist.note}
                    />
                  </>
                )}
              </Card>
            </>
          )}

          <Card title="Non-parametric alternatives">
            <p style={{ fontSize: 12.5, marginTop: 0 }}>
              If no family fits, the honest answer is to describe the data without one. These two make no distributional assumption at all.
            </p>
            <Segmented
              label="Kernel bandwidth"
              value={config.bandwidthRule}
              onChange={(bandwidthRule) => set({ bandwidthRule })}
              options={[
                { value: 'silverman', label: 'Silverman' },
                { value: 'scott', label: 'Scott' },
                { value: 'manual', label: 'Manual' },
              ]}
            />
            {config.bandwidthRule === 'manual' && (
              <SliderField
                label="Bandwidth"
                symbol="h"
                value={config.manualBandwidth}
                onChange={(manualBandwidth) => set({ manualBandwidth })}
                min={0.01}
                max={Math.max(1, summary ? summary.sd * 2 : 100)}
                step={0.01}
                hint="A smaller bandwidth shows more structure and more noise. Compare several before believing a second mode."
              />
            )}
            <Checkbox
              checked={config.kdeNonNegative}
              onChange={(kdeNonNegative) => set({ kdeNonNegative })}
              label="The quantity cannot be negative"
              description="Applies boundary reflection at 0, so the kernel does not leak probability below a bound the quantity cannot cross."
            />
            {!kde.ok && <Notice tone="error">{kde.error}</Notice>}
            {kde.ok && (
              <>
                <LineChart
                  title="Kernel density estimate"
                  description={`Gaussian kernel density estimate of ${kde.value.n} observations at bandwidth ${num(kde.value.bandwidth, 4)}.`}
                  series={[{ label: 'Kernel density estimate', points: kde.value.points, area: true }]}
                  xLabel="Value"
                  yLabel="Density"
                  note={kde.value.method}
                />
                <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', alignItems: 'center', margin: 'var(--s3) 0' }}>
                  <Badge variant="empirical">{EXACTNESS_LABEL.empirical}</Badge>
                  <span style={{ fontSize: 12.5 }}>Bandwidth {num(kde.value.bandwidth, 5)} ({kde.value.bandwidthSource})</span>
                </div>
                {kde.value.warnings.length > 0 && <Notice tone="warning" items={kde.value.warnings} />}
                <Notice tone="info" title="Limits of a kernel density estimate" items={kde.value.limitations} />
              </>
            )}
            {!ecdf.ok && <Notice tone="error">{ecdf.error}</Notice>}
            {ecdf.ok && (
              <>
                <StepChart
                  title="Empirical distribution function with its confidence band"
                  description={`Empirical distribution function of ${ecdf.value.n} observations with a simultaneous Dvoretzky–Kiefer–Wolfowitz band at the ${(ecdf.value.level * 100).toFixed(0)}% level.`}
                  series={[
                    {
                      label: 'Empirical distribution function',
                      points: ecdf.value.points.map((p) => ({ x: p.x, y: p.ecdf })),
                      band: ecdf.value.points.map((p) => ({ x: p.x, lower: p.low, upper: p.high })),
                    },
                  ]}
                  xLabel="Value"
                  yLabel="Cumulative probability"
                  note={ecdf.value.method}
                />
                <Notice tone="info" title="What the band means" items={ecdf.value.caveats} />
              </>
            )}
          </Card>

          <Card title="Gaussian mixture">
            <NumberField
              label="Largest component count BIC may choose"
              value={config.mixtureMaxComponents}
              onChange={(mixtureMaxComponents) => set({ mixtureMaxComponents })}
              min={1}
              max={5}
              integer
              hint="Every count from 1 up to this is fitted by expectation–maximisation, and BIC picks among them."
            />
            {!mixture.ok && <Notice tone="warning">{mixture.error}</Notice>}
            {mixture.ok && (
              <>
                <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--s3)' }}>
                  <Badge variant="numerical">{EXACTNESS_LABEL.numerical}</Badge>
                  <span style={{ fontSize: 12.5 }}>
                    {mixture.value.best.components.length} component(s) selected; log-likelihood {num(mixture.value.best.logLikelihood, 7)}
                  </span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Components of the selected Gaussian mixture"
                    columns={COMPONENT_COLUMNS}
                    rows={mixture.value.best.components}
                  />
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Every component count that was fitted"
                    columns={[
                      { key: 'm', header: 'Components', numeric: true, render: (r) => r.components.length },
                      { key: 'k', header: 'Free parameters', numeric: true, render: (r) => r.parameterCount },
                      { key: 'l', header: 'ln L', numeric: true, render: (r) => num(r.logLikelihood, 7) },
                      { key: 'a', header: 'AIC', numeric: true, render: (r) => num(r.aic, 7) },
                      { key: 'b', header: 'BIC', numeric: true, render: (r) => num(r.bic, 7) },
                      { key: 'c', header: 'Converged', render: (r) => (r.converged ? 'Yes' : 'No') },
                      { key: 'i', header: 'Iterations', numeric: true, render: (r) => r.iterations.toLocaleString('en-US') },
                      {
                        key: 'mo',
                        header: 'Log-likelihood non-decreasing',
                        title: 'Expectation–maximisation guarantees this; a violation is a defect, not a rounding detail',
                        render: (r) => (r.monotone ? 'Yes' : 'No — reported as a defect'),
                      },
                    ]}
                    rows={mixture.value.fits}
                  />
                </div>
                {mixture.value.rejected.length > 0 && (
                  <Notice
                    tone="warning"
                    title="Component counts that could not be fitted"
                    items={mixture.value.rejected.map((r) => `${r.components} component(s): ${r.reason}`)}
                  />
                )}
                {mixture.value.best.warnings.length > 0 && <Notice tone="warning" title="Warnings from the selected fit" items={mixture.value.best.warnings} />}
                <Notice tone="info" title="What a mixture fit can and cannot tell you" items={mixture.value.statements} />
              </>
            )}
          </Card>

          <Card title="Censored observations">
            <p style={{ fontSize: 12.5, marginTop: 0 }}>
              A right-censored observation says only that the value is at least the number recorded — the unit was still working when observation stopped.
              Treating it as the event time biases every estimate downwards, which is the most common error in lifetime data. Mark such values with a trailing
              + in the data box and turn the toggle on.
            </p>
            <KeyValueList
              items={[
                { label: 'Values marked censored', value: parsed.censoredCount.toLocaleString('en-US') },
                { label: 'Censored likelihood in use', value: censoredActive ? 'Yes — fitted by censored maximum likelihood' : 'No — every value is treated as an observed event' },
              ]}
            />
            {config.treatCensored && parsed.censoredCount === 0 && (
              <Notice tone="info">
                The toggle is on but no value carries a trailing +, so the censored likelihood reduces to the ordinary one. Nothing is being corrected.
              </Notice>
            )}
            {!config.treatCensored && parsed.censoredCount > 0 && (
              <Notice tone="warning" title={`${parsed.censoredCount} value(s) are marked censored but are being fitted as events`}>
                Every estimate above is biased downwards while this is the case. Turn the toggle on in the fitting options.
              </Notice>
            )}
            {censoredActive && chosen.ok && (
              <Notice tone="info" title="Assumption the censored fit rests on" items={chosen.value.explanation.assumptions} />
            )}
          </Card>

          <Card title="How to read this screen" variant="inset">
            <ul className="oc-assumption-list">
              <li>
                A closed-form maximum likelihood estimate is <strong>exact</strong> given the data: the formula is evaluated, not searched for. A fit that went
                through the optimiser is <strong>numerical</strong>. Bootstrap intervals, the kernel density estimate and the Q–Q envelope are{' '}
                <strong>empirical</strong> — they come from a finite number of simulated samples and would differ slightly on another run.
              </li>
              <li>
                Each result above carries its own exactness label, from the engine rather than from this screen. Where a label is missing, the result is
                missing too.
              </li>
              <li>
                The ranking, the tests and the plots answer different questions. AIC says which of the implemented families is relatively best; the tests say
                whether the leading one is defensible in absolute terms; the Q–Q envelope says where it goes wrong. A fitted distribution is only worth feeding
                to a simulation once all three agree.
              </li>
            </ul>
            {chosen.ok && <ExplanationPanel explanation={chosen.value.explanation} defaultOpen />}
          </Card>
        </div>
      </div>
    </>
  );
}

interface ParamRow {
  label: string;
  symbol: string;
  estimate: number;
  standardError: number | null;
  wald: FitResult['uncertainty'][number]['wald'];
  profile: { low: number; high: number } | null;
  profileError: string | null;
  bootstrap: { low: number; high: number } | null;
  unavailableReason: string | null;
}

interface GofRow {
  label: string;
  result: GofResult | null;
  error: string | null;
}
