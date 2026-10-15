/**
 * Extreme value analysis: how bad can the worst case get?
 *
 * Monte Carlo percentiles cannot answer that, because they cannot reach past
 * the range they sampled. The two extreme value models can — block maxima via
 * the GEV, threshold exceedances via the GPD — at the price of trusting a
 * limit theorem and, for peaks over threshold, of a threshold choice that is a
 * judgement call rather than an estimate. Every panel here reports which of
 * those it is leaning on, and the threshold panel is deliberately the largest
 * one on the screen.
 */
import { useMemo } from 'react';
import {
  type GevFit,
  type GpdFit,
  evtRiskMeasures,
  fitGevBlockMaxima,
  fitGpdPot,
  gevDiagnostics,
  gevReturnLevel,
  gevReturnLevelCurve,
  gevReturnPeriod,
  gpdDiagnostics,
  gpdReturnLevelCurve,
  gpdReturnLevelYears,
  gpdReturnPeriod,
  hillEstimator,
  hillPlot,
  meanResidualLifePlot,
  parameterStabilityPlot,
  pickandsEstimator,
  runsDecluster,
  suggestThreshold,
} from '../../engine/extremes';
import { type EngineResult, EngineError } from '../../engine/core/result';
import { mean, quantile } from '../../engine/stats/descriptive';
import { Random } from '../../engine/random/rng';
import {
  Badge,
  Card,
  DataTable,
  Disclosure,
  KeyValueList,
  Notice,
  NumberField,
  Segmented,
  SliderField,
  TextField,
} from '../../ui/primitives';
import { LineChart, ScatterChart } from '../../ui/charts/charts';
import { QQChart } from '../../ui/charts/advanced';
import { formatPercent, formatValue } from '../../ui/charts/scale';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { useApp } from '../store';

export interface ExtremesConfig {
  /** Observations as typed text; parsed on every render so nothing is lost. */
  observations: string;
  method: 'block-maxima' | 'peaks-over-threshold';
  /** Observations per block for the GEV route. */
  blockSize: number;
  /** null means "use the engine's automatic suggestion", so the default is alive. */
  thresholdOverride: number | null;
  /** Observations below the threshold needed to separate two clusters. */
  runLength: number;
  /** Upper order statistics used by the Hill and Pickands estimators. */
  tailK: number;
  returnPeriodYears: number;
  observationsPerYear: number;
  /** GEV return period, counted in blocks. */
  returnPeriodBlocks: number;
  /** The level whose return period the inverse question asks about. */
  queryLevel: number;
  confidenceLevel: number;
}

/**
 * The built-in series: 400 simulated weekly peak flows, generated here with a
 * fixed seed rather than written out by hand. It is autocorrelated on the log
 * scale, so exceedances cluster and the declustering panel has something real
 * to show, and it carries an occasional heavy-tailed surge.
 */
function buildExampleSeries(): string {
  const rng = new Random('orbis-extremes-weekly-peak-flow');
  const base = Math.log(40);
  let log = base;
  const values: number[] = [];
  for (let i = 0; i < 400; i++) {
    log = base + 0.72 * (log - base) + 0.22 * rng.normal();
    let value = Math.exp(log);
    // A storm week: a Pareto surge on top of the baseline, which is what gives
    // the series a tail worth extrapolating.
    if (rng.bernoulli(0.05)) value += 25 * (Math.pow(rng.uniformOpen(), -0.4) - 1);
    values.push(Math.round(value * 10) / 10);
  }
  const lines: string[] = [];
  for (let i = 0; i < values.length; i += 10) lines.push(values.slice(i, i + 10).join(', '));
  return lines.join('\n');
}

export const EXTREMES_DEFAULT: ExtremesConfig = {
  observations: buildExampleSeries(),
  method: 'peaks-over-threshold',
  blockSize: 10,
  thresholdOverride: null,
  runLength: 3,
  tailK: 40,
  returnPeriodYears: 100,
  observationsPerYear: 52,
  returnPeriodBlocks: 100,
  queryLevel: 120,
  confidenceLevel: 0.95,
};

interface SkippedLine {
  line: number;
  text: string;
  reason: string;
}

interface ParsedObservations {
  values: number[];
  skipped: SkippedLine[];
}

/**
 * Parse the text area. Pasted text is untrusted: every token that is not a
 * finite number is reported with its line number and never silently dropped.
 */
function parseObservations(text: string): ParsedObservations {
  const values: number[] = [];
  const skipped: SkippedLine[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, index) => {
    const lineNumber = index + 1;
    const withoutComment = raw.replace(/[#;].*$/, '');
    const tokens = withoutComment.split(/[\s,\t]+/).filter((t) => t.length > 0);
    if (tokens.length === 0) {
      // A blank line (or a line that was only a comment) is not lost data.
      if (raw.trim().length > 0 && withoutComment.trim().length === 0) return;
      return;
    }
    for (const token of tokens) {
      const value = Number(token);
      if (!Number.isFinite(value)) {
        skipped.push({ line: lineNumber, text: token, reason: 'not a finite number' });
      } else {
        values.push(value);
      }
    }
  });
  return { values, skipped };
}

function errorText<T>(result: EngineResult<T>): string {
  return result.ok ? '' : result.errors.map((e) => e.message).join(' ');
}

/** The tail class implied by the fitted shape, in words as well as a badge. */
function tailClass(shape: number): { label: string; detail: string } {
  if (shape > 0.02) {
    return {
      label: 'Heavy tail (Fréchet type)',
      detail:
        'ξ > 0: the tail decays as a power law, there is no upper bound, and the largest values observed so far are not close to the worst the model allows.',
    };
  }
  if (shape < -0.02) {
    return {
      label: 'Bounded above (Weibull type)',
      detail:
        'ξ < 0: the fitted distribution has a hard finite upper bound. That bound is a strong claim about the process, and it rests on the fit.',
    };
  }
  return {
    label: 'Light tail (Gumbel type)',
    detail:
      'ξ is close to 0: the tail decays exponentially. Unbounded, but far less extreme than a power-law tail at long return periods.',
  };
}

const NUMBER_FORMAT = (v: number): string => formatValue(v, 5);

export function ExtremesTool({ config }: { config: ExtremesConfig }) {
  const app = useApp();
  const set = (patch: Partial<ExtremesConfig>) => app.updateConfig({ ...config, ...patch });

  const parsed = useMemo(() => parseObservations(config.observations), [config.observations]);
  const values = parsed.values;

  const summary = useMemo(() => {
    if (values.length === 0) return null;
    return {
      n: values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      average: mean(values),
      median: quantile(values, 0.5),
    };
  }, [values]);

  const mrl = useMemo(() => (values.length ? meanResidualLifePlot(values) : null), [values]);
  const stability = useMemo(() => (values.length ? parameterStabilityPlot(values) : null), [values]);
  const suggestion = useMemo(() => (values.length ? suggestThreshold(values) : null), [values]);

  /** The threshold actually used: the user's choice, else the suggestion. */
  const threshold = useMemo(() => {
    if (config.thresholdOverride !== null) return config.thresholdOverride;
    if (suggestion && suggestion.ok) return suggestion.value.threshold;
    return null;
  }, [config.thresholdOverride, suggestion]);

  const exceedanceCount = useMemo(
    () => (threshold === null ? 0 : values.filter((x) => x > threshold).length),
    [values, threshold],
  );

  const fit = useMemo((): EngineResult<GpdFit> | EngineResult<GevFit> | null => {
    if (values.length === 0) return null;
    try {
      if (config.method === 'block-maxima') {
        return fitGevBlockMaxima(values, { blockSize: config.blockSize, level: config.confidenceLevel });
      }
      if (threshold === null) return null;
      return fitGpdPot(values, { threshold, level: config.confidenceLevel });
    } catch (e) {
      // Engine validation throws rather than returning for a few inputs.
      if (e instanceof EngineError) return { ok: false, errors: e.issues };
      throw e;
    }
  }, [values, config.method, config.blockSize, config.confidenceLevel, threshold]);

  const gpdFit = fit && fit.ok && fit.value.kind === 'gpd' ? fit.value : null;
  const gevFit = fit && fit.ok && fit.value.kind === 'gev' ? fit.value : null;

  const returnLevel = useMemo(() => {
    try {
      if (gpdFit) {
        return gpdReturnLevelYears(gpdFit, config.returnPeriodYears, config.observationsPerYear, {
          level: config.confidenceLevel,
        });
      }
      if (gevFit) {
        return gevReturnLevel(gevFit, config.returnPeriodBlocks, { level: config.confidenceLevel });
      }
      return null;
    } catch (e) {
      if (e instanceof EngineError) return { ok: false as const, errors: e.issues };
      throw e;
    }
  }, [gpdFit, gevFit, config.returnPeriodYears, config.observationsPerYear, config.returnPeriodBlocks, config.confidenceLevel]);

  const returnCurve = useMemo(() => {
    try {
      if (gpdFit) {
        const curve = gpdReturnLevelCurve(gpdFit, { level: config.confidenceLevel });
        return curve.ok ? { points: curve.value.points, error: null } : { points: [], error: errorText(curve) };
      }
      if (gevFit) return { points: gevReturnLevelCurve(gevFit, { level: config.confidenceLevel }), error: null };
      return null;
    } catch (e) {
      if (e instanceof EngineError) return { points: [], error: e.message };
      throw e;
    }
  }, [gpdFit, gevFit, config.confidenceLevel]);

  const inverse = useMemo(() => {
    try {
      if (gpdFit) return gpdReturnPeriod(gpdFit, config.queryLevel, { observationsPerYear: config.observationsPerYear });
      if (gevFit) return gevReturnPeriod(gevFit, config.queryLevel);
      return null;
    } catch (e) {
      if (e instanceof EngineError) return { ok: false as const, errors: e.issues };
      throw e;
    }
  }, [gpdFit, gevFit, config.queryLevel, config.observationsPerYear]);

  const riskLevels = useMemo(() => [0.999, 0.9999], []);

  const risk = useMemo(() => {
    if (!gpdFit) return null;
    return riskLevels.map((level) => {
      let result: EngineResult<ReturnType<typeof evtRiskMeasures> extends EngineResult<infer R> ? R : never>;
      try {
        result = evtRiskMeasures(gpdFit, level, { confidenceLevel: config.confidenceLevel });
      } catch (e) {
        if (e instanceof EngineError) result = { ok: false, errors: e.issues };
        else throw e;
      }
      // The empirical quantile at the same level, for the contrast: with n
      // observations it is a function of at most n(1 − p) order statistics,
      // and of none at all once n(1 − p) < 1.
      const expectedBeyond = values.length * (1 - level);
      return {
        level,
        result,
        empirical: values.length ? quantile(values, level) : null,
        expectedBeyond,
        reachable: expectedBeyond >= 1,
      };
    });
  }, [gpdFit, riskLevels, values, config.confidenceLevel]);

  const hill = useMemo(() => (values.length ? hillEstimator(values, config.tailK, { level: config.confidenceLevel }) : null), [values, config.tailK, config.confidenceLevel]);
  const pickands = useMemo(() => (values.length ? pickandsEstimator(values, config.tailK) : null), [values, config.tailK]);
  const hillCurve = useMemo(() => (values.length ? hillPlot(values, { level: config.confidenceLevel }) : null), [values, config.confidenceLevel]);

  const decluster = useMemo(() => {
    if (threshold === null || values.length === 0) return null;
    try {
      return runsDecluster(values, { threshold, runLength: config.runLength });
    } catch (e) {
      if (e instanceof EngineError) return { ok: false as const, errors: e.issues };
      throw e;
    }
  }, [values, threshold, config.runLength]);

  const declusteredFit = useMemo(() => {
    if (!decluster || !decluster.ok || threshold === null) return null;
    try {
      // Only the cluster maxima are exceedances now, but the exceedance rate
      // must still be relative to the whole record, not to the cluster count.
      return fitGpdPot(decluster.value.clusterMaxima, {
        threshold,
        level: config.confidenceLevel,
        totalObservations: values.length,
      });
    } catch (e) {
      if (e instanceof EngineError) return { ok: false as const, errors: e.issues };
      throw e;
    }
  }, [decluster, threshold, values.length, config.confidenceLevel]);

  const diagnostics = useMemo(() => {
    try {
      if (gpdFit) return gpdDiagnostics(gpdFit);
      if (gevFit) return gevDiagnostics(gevFit);
      return null;
    } catch (e) {
      if (e instanceof EngineError) return { ok: false as const, errors: e.issues };
      throw e;
    }
  }, [gpdFit, gevFit]);

  const sliderBounds = useMemo(() => {
    if (!summary) return { min: 0, max: 1, step: 0.1 };
    const lo = quantile(values, 0.4);
    const hi = quantile(values, 0.995);
    const span = hi - lo;
    return { min: lo, max: hi, step: span > 0 ? span / 200 : 0.1 };
  }, [summary, values]);

  const shape = gpdFit ? gpdFit.params.shape : gevFit ? gevFit.params.shape : null;
  const upperBound =
    gpdFit && gpdFit.params.shape < 0
      ? gpdFit.params.threshold - gpdFit.params.scale / gpdFit.params.shape
      : gevFit && gevFit.params.shape < 0
        ? gevFit.params.location - gevFit.params.scale / gevFit.params.shape
        : null;

  const fitForExplanation = fit && fit.ok ? fit.value.explanation : null;
  const isPot = config.method === 'peaks-over-threshold';

  return (
    <>
      <ToolHeader toolId="extremes" />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="Observations" hint="One series, in time order. Values may be separated by commas, spaces or new lines.">
            <TextField
              label="Observed values"
              value={config.observations}
              onChange={(observations) => set({ observations })}
              multiline
              rows={10}
              monospace
              maxLength={200000}
              hint="The built-in example is 400 simulated weekly peak flows, generated in your browser from a fixed seed. Text after # or ; on a line is treated as a comment."
            />
            {summary ? (
              <KeyValueList
                items={[
                  { label: 'Observations used (n)', value: summary.n.toLocaleString('en-US') },
                  { label: 'Minimum', value: NUMBER_FORMAT(summary.min) },
                  { label: 'Maximum', value: NUMBER_FORMAT(summary.max) },
                  { label: 'Mean', value: NUMBER_FORMAT(summary.average) },
                  { label: 'Median', value: NUMBER_FORMAT(summary.median) },
                ]}
              />
            ) : (
              <Notice tone="warning">No usable observation was found in the text above, so nothing can be fitted.</Notice>
            )}
            {parsed.skipped.length > 0 && (
              <Notice tone="warning" title={`${parsed.skipped.length} entr${parsed.skipped.length === 1 ? 'y was' : 'ies were'} not read as a number`}>
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Entries that could not be parsed, with their line numbers"
                    maxHeight={200}
                    columns={[
                      { key: 'line', header: 'Line', numeric: true, render: (r) => String((r as SkippedLine).line) },
                      { key: 'text', header: 'Text', render: (r) => <code>{(r as SkippedLine).text}</code> },
                      { key: 'reason', header: 'Why it was skipped', render: (r) => (r as SkippedLine).reason },
                    ]}
                    rows={parsed.skipped}
                  />
                </div>
                <p style={{ fontSize: 12.5, margin: 0 }}>
                  These entries are excluded from every number on this page. They are listed rather than dropped so you can see exactly what was lost.
                </p>
              </Notice>
            )}
          </Card>

          <Card title="Method">
            <Segmented
              label="Extreme value model"
              value={config.method}
              onChange={(method) => set({ method })}
              options={[
                { value: 'peaks-over-threshold', label: 'Peaks over threshold (GPD)' },
                { value: 'block-maxima', label: 'Block maxima (GEV)' },
              ]}
            />
            <p style={{ fontSize: 12.5 }}>
              {isPot
                ? 'Every value above a threshold is used, and a generalised Pareto distribution is fitted to the exceedances. This uses far more of the record than block maxima — at the cost of having to choose the threshold, which is a judgement call.'
                : 'The record is cut into blocks of equal length and a generalised extreme value distribution is fitted to the block maxima. No threshold is needed, but every large value other than each block maximum is discarded.'}
            </p>
            {!isPot && (
              <NumberField
                label="Block size"
                symbol="observations per block"
                value={config.blockSize}
                onChange={(blockSize) => set({ blockSize })}
                min={2}
                max={Math.max(2, values.length)}
                integer
                hint={`${values.length ? Math.floor(values.length / config.blockSize) : 0} complete blocks from ${values.length} observations. A larger block makes the GEV limit a better approximation but leaves fewer maxima to fit.`}
              />
            )}
            <NumberField
              label="Confidence level for every interval"
              value={config.confidenceLevel}
              onChange={(confidenceLevel) => set({ confidenceLevel })}
              min={0.5}
              max={0.999}
              step={0.01}
            />
          </Card>

          <AiAssistPanel
            capability="explainUncertainty"
            context="Extreme value results are extrapolations: the threshold or block size, and the assumption that the limit model holds, matter more than the arithmetic."
          />
        </div>

        <div className="oc-stack">
          <Card
            title="Threshold choice"
            hint="For peaks over threshold this is the decision that matters most: it changes the shape, the scale and every return level taken from them."
          >
            {!isPot && (
              <Notice tone="info">
                Block maxima are selected now, so no threshold enters the fit. The plots below still describe the data and are worth reading before switching
                methods.
              </Notice>
            )}
            {suggestion && !suggestion.ok && <Notice tone="error">{errorText(suggestion)}</Notice>}
            {suggestion && suggestion.ok && (
              <>
                <KeyValueList
                  items={[
                    { label: 'Automatic suggestion', value: NUMBER_FORMAT(suggestion.value.threshold) },
                    { label: 'Rule used', value: suggestion.value.rule === 'shape-stability' ? 'Shape stability across refitted thresholds' : 'Fallback to a fixed data quantile (no candidate was stable)' },
                    { label: 'Data quantile it corresponds to', value: formatPercent(suggestion.value.dataQuantile, 3) },
                    { label: 'Exceedances above it', value: suggestion.value.exceedances.toLocaleString('en-US') },
                  ]}
                />
                <Notice tone="warning" title="A suggestion, not a result">
                  {suggestion.warnings.length > 0 ? suggestion.warnings[0] : 'Threshold choice is a judgement call. Read the two plots below before accepting it.'}
                </Notice>
              </>
            )}

            <SliderField
              label="Threshold in use"
              symbol="u"
              value={threshold ?? sliderBounds.min}
              onChange={(thresholdOverride) => set({ thresholdOverride })}
              min={sliderBounds.min}
              max={sliderBounds.max}
              step={sliderBounds.step}
              hint={
                config.thresholdOverride === null
                  ? 'Currently following the automatic suggestion. Moving the slider replaces it with your own choice.'
                  : 'Your own choice. Every fitted number below is conditional on it.'
              }
            />

            <div className="oc-result-hero">
              <span className="oc-result-hero__label">Exceedances above the threshold</span>
              <span className="oc-result-hero__value">{exceedanceCount.toLocaleString('en-US')}</span>
              <span className="oc-result-hero__detail">
                of {values.length.toLocaleString('en-US')} observations
                {threshold === null ? '' : ` · u = ${NUMBER_FORMAT(threshold)}`}
              </span>
            </div>
            {isPot && exceedanceCount < 10 && (
              <Notice tone="error" title="Too few exceedances to fit">
                The generalised Pareto fit needs at least 10 exceedances and about 50 for the shape to be worth quoting. There {exceedanceCount === 1 ? 'is' : 'are'}{' '}
                {exceedanceCount}. Lower the threshold or use a longer record.
              </Notice>
            )}
            {isPot && exceedanceCount >= 10 && exceedanceCount < 50 && (
              <Notice tone="warning">
                {exceedanceCount} exceedances is enough to fit but not enough to pin down the shape. Treat the interval for ξ, not its point estimate, as the
                answer.
              </Notice>
            )}

            {mrl && !mrl.ok && <Notice tone="error">{errorText(mrl)}</Notice>}
            {mrl && mrl.ok && (
              <div style={{ overflowX: 'auto' }}>
                <LineChart
                  title="Mean residual life plot"
                  description="Mean excess above a threshold against the threshold, with normal-approximation confidence limits. Read it for the lowest threshold above which the curve is straight."
                  xLabel="Threshold v"
                  yLabel="Mean excess above v"
                  series={[
                    { label: 'Mean excess', points: mrl.value.points.map((p) => ({ x: p.threshold, y: p.meanExcess })) },
                    { label: `Lower ${formatPercent(mrl.value.level)} limit`, points: mrl.value.points.filter((p) => p.lower !== null).map((p) => ({ x: p.threshold, y: p.lower as number })), dashed: true },
                    { label: `Upper ${formatPercent(mrl.value.level)} limit`, points: mrl.value.points.filter((p) => p.upper !== null).map((p) => ({ x: p.threshold, y: p.upper as number })), dashed: true },
                  ]}
                  referenceLines={threshold === null ? undefined : [{ value: threshold, label: 'Threshold in use', axis: 'x' }]}
                  note="For a generalised Pareto tail the mean excess is linear in the threshold. Neighbouring points share almost all their data, so the curve is far smoother than independent error bars would suggest."
                />
              </div>
            )}

            {stability && !stability.ok && <Notice tone="error">{errorText(stability)}</Notice>}
            {stability && stability.ok && (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <LineChart
                    title="Parameter stability: shape ξ"
                    description="The GPD shape refitted at a range of thresholds. It should settle to a horizontal line once the threshold is high enough."
                    xLabel="Threshold u"
                    yLabel="Fitted shape ξ"
                    series={[
                      { label: 'Shape ξ', points: stability.value.points.map((p) => ({ x: p.threshold, y: p.shape })) },
                      {
                        label: 'Lower 2 s.e.',
                        points: stability.value.points.filter((p) => p.shapeStandardError !== null).map((p) => ({ x: p.threshold, y: p.shape - 2 * (p.shapeStandardError as number) })),
                        dashed: true,
                      },
                      {
                        label: 'Upper 2 s.e.',
                        points: stability.value.points.filter((p) => p.shapeStandardError !== null).map((p) => ({ x: p.threshold, y: p.shape + 2 * (p.shapeStandardError as number) })),
                        dashed: true,
                      },
                    ]}
                    referenceLines={threshold === null ? undefined : [{ value: threshold, label: 'Threshold in use', axis: 'x' }]}
                    note="Standard errors are missing for any threshold where the observed information could not be inverted; those points are left out of the dashed lines rather than filled in."
                  />
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <LineChart
                    title="Parameter stability: modified scale σ* = σ − ξu"
                    description="The modified scale is free of the threshold once the limit model holds, so it too should become horizontal."
                    xLabel="Threshold u"
                    yLabel="Modified scale σ*"
                    series={[{ label: 'σ*', points: stability.value.points.map((p) => ({ x: p.threshold, y: p.modifiedScale })) }]}
                    referenceLines={threshold === null ? undefined : [{ value: threshold, label: 'Threshold in use', axis: 'x' }]}
                  />
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <ScatterChart
                    title="Exceedances left at each candidate threshold"
                    description="How much data remains above each threshold tried. The bias/variance trade-off in threshold choice is exactly this curve against the two above."
                    xLabel="Threshold u"
                    yLabel="Exceedances"
                    points={stability.value.points.map((p) => ({ x: p.threshold, y: p.exceedances }))}
                  />
                </div>
                {stability.value.skipped.length > 0 && (
                  <Disclosure title={`${stability.value.skipped.length} candidate threshold(s) could not be fitted`}>
                    <div style={{ overflowX: 'auto' }}>
                      <DataTable
                        caption="Thresholds the engine refused, with the reason"
                        maxHeight={220}
                        columns={[
                          { key: 'u', header: 'Threshold', numeric: true, render: (r) => NUMBER_FORMAT((r as { threshold: number }).threshold) },
                          { key: 'why', header: 'Reason', render: (r) => (r as { reason: string }).reason },
                        ]}
                        rows={stability.value.skipped}
                      />
                    </div>
                  </Disclosure>
                )}
                <ExplanationPanel explanation={stability.value.explanation} />
              </>
            )}
          </Card>

          <Card title="Fit">
            {fit === null && <Notice tone="info">Enter observations, and a threshold if peaks over threshold is selected, to fit a model.</Notice>}
            {fit && !fit.ok && <Notice tone="error" title="The fit was refused">{errorText(fit)}</Notice>}
            {fit && fit.ok && (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Fitted parameters with standard errors"
                    columns={[
                      { key: 'name', header: 'Parameter', render: (r) => (r as { name: string }).name },
                      { key: 'est', header: 'Estimate', numeric: true, render: (r) => NUMBER_FORMAT((r as { estimate: number }).estimate) },
                      {
                        key: 'se',
                        header: 'Standard error',
                        numeric: true,
                        render: (r) => {
                          const se = (r as { standardError: number | null }).standardError;
                          return se === null ? 'not available — the observed information matrix could not be inverted' : NUMBER_FORMAT(se);
                        },
                      },
                    ]}
                    rows={fit.value.estimates}
                  />
                </div>

                <KeyValueList
                  items={[
                    {
                      label: `Profile-likelihood ${formatPercent(fit.value.shapeInterval.level)} interval for ξ`,
                      value:
                        fit.value.shapeInterval.lower === null || fit.value.shapeInterval.upper === null
                          ? `${fit.value.shapeInterval.lower === null ? 'lower' : 'upper'} limit could not be bracketed${fit.value.shapeInterval.notes.length ? ` — ${fit.value.shapeInterval.notes.join(' ')}` : ''}`
                          : `${NUMBER_FORMAT(fit.value.shapeInterval.lower)} to ${NUMBER_FORMAT(fit.value.shapeInterval.upper)}`,
                    },
                    {
                      label: 'Wald interval for ξ, for comparison',
                      value: fit.value.shapeWaldInterval === null ? 'not available without standard errors' : `${NUMBER_FORMAT(fit.value.shapeWaldInterval.lower)} to ${NUMBER_FORMAT(fit.value.shapeWaldInterval.upper)}`,
                    },
                    { label: 'Converged', value: fit.value.diagnostics.converged ? 'yes' : 'no' },
                    { label: 'Iterations', value: `${fit.value.diagnostics.iterations.toLocaleString('en-US')} (${fit.value.diagnostics.functionEvaluations.toLocaleString('en-US')} function evaluations)` },
                    { label: 'Log-likelihood at the optimum', value: NUMBER_FORMAT(fit.value.diagnostics.logLikelihood) },
                    { label: 'Observations used', value: `${fit.value.diagnostics.observationsUsed.toLocaleString('en-US')} (${fit.value.diagnostics.observationsDiscarded.toLocaleString('en-US')} not used: ${fit.value.diagnostics.discardReason})` },
                    { label: 'Optimiser', value: fit.value.diagnostics.optimiser },
                  ]}
                />
                <p style={{ fontSize: 12.5 }}>
                  The likelihood in ξ is skewed, so the profile-likelihood interval is the one to quote; the symmetric Wald interval is shown only for
                  comparison.
                </p>

                {shape !== null && (
                  <div className="oc-result-hero">
                    <span className="oc-result-hero__label">Tail class implied by the fitted shape</span>
                    <span className="oc-result-hero__value" style={{ fontSize: 20 }}>
                      {tailClass(shape).label}
                    </span>
                    <span className="oc-result-hero__detail">
                      <Badge variant="numerical">ξ = {NUMBER_FORMAT(shape)}</Badge> {tailClass(shape).detail}
                    </span>
                  </div>
                )}
                {upperBound !== null && (
                  <Notice tone="info" title="The fit implies a hard upper bound">
                    <p style={{ margin: 0 }}>
                      With ξ &lt; 0 the fitted distribution stops at {NUMBER_FORMAT(upperBound)}: the model assigns probability exactly 0 to anything above it,
                      so no finite return period exists beyond that point. That is a strong claim from a negative shape estimate — check whether ξ &lt; 0 across
                      the parameter stability plot before relying on it, and look at whether the interval for ξ includes 0.
                    </p>
                  </Notice>
                )}
                {fit.warnings.length > 0 && <Notice tone="warning" title="Warnings from the fit" items={fit.warnings} />}
                <ExplanationPanel explanation={fit.value.explanation} />
              </>
            )}
          </Card>

          <Card title="Return levels" hint="The headline output: the level exceeded once per return period on average.">
            {isPot ? (
              <>
                <NumberField label="Return period" symbol="years" value={config.returnPeriodYears} onChange={(returnPeriodYears) => set({ returnPeriodYears })} min={0.01} max={100000} />
                <NumberField
                  label="Observations per year in this record"
                  value={config.observationsPerYear}
                  onChange={(observationsPerYear) => set({ observationsPerYear })}
                  min={0.01}
                  max={100000}
                  hint="The example is weekly, so 52. A wrong rate rescales the return period directly."
                />
              </>
            ) : (
              <NumberField label="Return period" symbol="blocks" value={config.returnPeriodBlocks} onChange={(returnPeriodBlocks) => set({ returnPeriodBlocks })} min={1.01} max={100000} />
            )}

            {returnLevel && !returnLevel.ok && <Notice tone="error">{errorText(returnLevel)}</Notice>}
            {returnLevel && returnLevel.ok && (
              <>
                <div className="oc-result-hero">
                  <span className="oc-result-hero__label">
                    {formatValue(returnLevel.value.returnPeriod, 4)}-{returnLevel.value.periodUnit === 'years' ? 'year' : returnLevel.value.periodUnit === 'blocks' ? 'block' : 'observation'} return level
                  </span>
                  <span className="oc-result-hero__value">{NUMBER_FORMAT(returnLevel.value.level)}</span>
                  <span className="oc-result-hero__detail">
                    <Badge variant={returnLevel.value.explanation.exactness}>Numerical approximation</Badge>{' '}
                    {returnLevel.value.extrapolatedBeyondData
                      ? 'This level is above every value observed, so it is an extrapolation justified by the extreme value limit, not by data.'
                      : 'This level lies inside the observed range.'}
                  </span>
                </div>
                <KeyValueList
                  items={[
                    {
                      label: `Profile-likelihood ${formatPercent(returnLevel.value.confidenceLevel)} interval (preferred)`,
                      value:
                        returnLevel.value.profileInterval.lower === null || returnLevel.value.profileInterval.upper === null
                          ? `could not be bracketed on ${returnLevel.value.profileInterval.lower === null ? 'the lower' : 'the upper'} side${returnLevel.value.profileInterval.notes.length ? ` — ${returnLevel.value.profileInterval.notes.join(' ')}` : ''}`
                          : `${NUMBER_FORMAT(returnLevel.value.profileInterval.lower)} to ${NUMBER_FORMAT(returnLevel.value.profileInterval.upper)}`,
                    },
                    {
                      label: `Delta-method ${formatPercent(returnLevel.value.confidenceLevel)} interval`,
                      value: returnLevel.value.deltaInterval === null ? 'not available — the covariance matrix could not be formed' : `${NUMBER_FORMAT(returnLevel.value.deltaInterval.lower)} to ${NUMBER_FORMAT(returnLevel.value.deltaInterval.upper)}`,
                    },
                    {
                      label: 'Delta-method standard error',
                      value: returnLevel.value.standardError === null ? 'not available — the covariance matrix could not be formed' : NUMBER_FORMAT(returnLevel.value.standardError),
                    },
                  ]}
                />
                <p style={{ fontSize: 12.5 }}>
                  The delta-method interval is symmetric and is usually too narrow on the upper side for a heavy tail. Both intervals cover parameter
                  uncertainty only: neither includes the possibility that the limit model{isPot ? ', or the threshold,' : ', or the block size,'} is wrong.
                </p>
                {returnLevel.warnings.length > 0 && <Notice tone="warning" items={returnLevel.warnings} />}
                <ExplanationPanel explanation={returnLevel.value.explanation} />
              </>
            )}

            {returnCurve && returnCurve.error && <Notice tone="error">{returnCurve.error}</Notice>}
            {returnCurve && returnCurve.points.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <LineChart
                  title="Return level curve"
                  description="Return level against return period, with its confidence band. Once the return period passes the length of the record the curve is a straight extrapolation whose slope is the fitted shape."
                  xLabel={isPot ? 'Return period (observations)' : 'Return period (blocks)'}
                  yLabel="Return level"
                  series={[
                    { label: 'Return level', points: returnCurve.points.map((p) => ({ x: p.returnPeriod, y: p.level })) },
                    { label: 'Lower limit', points: returnCurve.points.filter((p) => p.lower !== null).map((p) => ({ x: p.returnPeriod, y: p.lower as number })), dashed: true },
                    { label: 'Upper limit', points: returnCurve.points.filter((p) => p.upper !== null).map((p) => ({ x: p.returnPeriod, y: p.upper as number })), dashed: true },
                  ]}
                  referenceLines={summary ? [{ value: summary.max, label: 'Largest value observed', axis: 'y' }] : undefined}
                  note="Limits are profile-likelihood where they could be bracketed and delta-method otherwise; points where neither was available are omitted rather than interpolated."
                />
              </div>
            )}

            <h3 style={{ marginTop: 'var(--s4)' }}>The inverse question: how often is a given level exceeded?</h3>
            <NumberField label="Level to ask about" value={config.queryLevel} onChange={(queryLevel) => set({ queryLevel })} min={-1e12} max={1e12} />
            {inverse && !inverse.ok && <Notice tone="error">{errorText(inverse)}</Notice>}
            {inverse && inverse.ok && (
              <>
                <KeyValueList
                  items={[
                    { label: 'Exceedance probability per observation', value: inverse.value.exceedanceProbability.toExponential(4) },
                    { label: `Return period (${inverse.value.periodUnit})`, value: formatValue(inverse.value.returnPeriod, 6) },
                    { label: 'Return period in years', value: inverse.value.returnPeriodYears === null ? 'not available — no observation rate applies to this model' : formatValue(inverse.value.returnPeriodYears, 6) },
                  ]}
                />
                <ExplanationPanel explanation={inverse.value.explanation} />
              </>
            )}
          </Card>

          <Card title="EVT risk measures" hint="Value at Risk and expected shortfall where an empirical quantile has no data to stand on.">
            {!isPot && <Notice tone="info">These measures are computed from a peaks-over-threshold fit. Switch the method to peaks over threshold to see them.</Notice>}
            {isPot && !gpdFit && <Notice tone="info">They need a converged generalised Pareto fit; see the fit panel above.</Notice>}
            {risk &&
              risk.map((row) => (
                <div key={row.level} style={{ marginBottom: 'var(--s4)' }}>
                  <h3>At {formatPercent(row.level, 4)}</h3>
                  {!row.result.ok && <Notice tone="error">{errorText(row.result)}</Notice>}
                  {row.result.ok && (
                    <KeyValueList
                      items={[
                        { label: 'Value at Risk (EVT)', value: NUMBER_FORMAT(row.result.value.valueAtRisk) },
                        {
                          label: 'VaR standard error (delta method)',
                          value: row.result.value.valueAtRiskStandardError === null ? 'not available — the covariance matrix could not be formed' : NUMBER_FORMAT(row.result.value.valueAtRiskStandardError),
                        },
                        {
                          label: `VaR profile-likelihood ${formatPercent(row.result.value.valueAtRiskInterval.level)} interval`,
                          value:
                            row.result.value.valueAtRiskInterval.lower === null || row.result.value.valueAtRiskInterval.upper === null
                              ? `could not be bracketed on ${row.result.value.valueAtRiskInterval.lower === null ? 'the lower' : 'the upper'} side`
                              : `${NUMBER_FORMAT(row.result.value.valueAtRiskInterval.lower)} to ${NUMBER_FORMAT(row.result.value.valueAtRiskInterval.upper)}`,
                        },
                        {
                          label: 'Expected shortfall (EVT)',
                          value:
                            row.result.value.expectedShortfall === null
                              ? (row.result.value.expectedShortfallUndefinedReason ?? 'not reported, and no reason was given by the engine')
                              : NUMBER_FORMAT(row.result.value.expectedShortfall),
                        },
                        { label: 'Empirical quantile at the same level', value: row.empirical === null ? 'no observations' : NUMBER_FORMAT(row.empirical) },
                        {
                          label: 'Observations that far out',
                          value: row.reachable
                            ? `about ${formatValue(row.expectedBeyond, 3)} observation(s) are expected beyond this level in a record of ${values.length.toLocaleString('en-US')}`
                            : `none — a record of ${values.length.toLocaleString('en-US')} observations would need about ${Math.ceil(1 / (1 - row.level)).toLocaleString('en-US')} to place one observation at this level`,
                        },
                        { label: 'Observations above the fitted VaR', value: row.result.value.empiricalExceedances.toLocaleString('en-US') },
                      ]}
                    />
                  )}
                  {row.result.ok && (
                    <p style={{ fontSize: 12.5 }}>
                      {row.reachable
                        ? 'The empirical quantile here rests on a handful of order statistics, so it is extremely noisy even where it exists.'
                        : 'The empirical quantile at this level cannot reach this far: there is no observation out here, so the number shown for it is the largest value in the record by interpolation convention, not an estimate of the quantile. The EVT figure is an extrapolation from the fitted tail shape — that is precisely what it is for, and it is still an extrapolation.'}
                    </p>
                  )}
                  {row.result.ok && row.result.warnings.length > 0 && <Notice tone="warning" items={row.result.warnings} />}
                  {row.result.ok && <ExplanationPanel explanation={row.result.value.explanation} />}
                </div>
              ))}
          </Card>

          <Card title="Tail index" hint="Semi-parametric estimates of ξ from the largest observations only.">
            <NumberField
              label="Upper order statistics used"
              symbol="k"
              value={config.tailK}
              onChange={(tailK) => set({ tailK })}
              min={2}
              max={Math.max(2, values.length - 1)}
              integer
              hint="Small k is noisy, large k is biased. There is no automatic choice; the plot below is there to be read."
            />
            {hill && !hill.ok && <Notice tone="error" title="Hill estimator">{errorText(hill)}</Notice>}
            {hill && hill.ok && (
              <KeyValueList
                items={[
                  { label: 'Hill ξ̂', value: NUMBER_FORMAT(hill.value.tailIndex) },
                  { label: 'Pareto exponent α̂ = 1/ξ̂', value: hill.value.paretoExponent === null ? 'undefined for ξ̂ ≤ 0 — the Hill estimator cannot describe a light or bounded tail' : NUMBER_FORMAT(hill.value.paretoExponent) },
                  { label: 'Standard error ξ̂/√k', value: hill.value.standardError === null ? 'not computed for this estimator' : NUMBER_FORMAT(hill.value.standardError) },
                  {
                    label: `Asymptotic ${formatPercent(config.confidenceLevel)} interval`,
                    value: hill.value.lower === null || hill.value.upper === null ? 'not available for this estimator' : `${NUMBER_FORMAT(hill.value.lower)} to ${NUMBER_FORMAT(hill.value.upper)}`,
                  },
                ]}
              />
            )}
            {pickands && !pickands.ok && <Notice tone="error" title="Pickands estimator">{errorText(pickands)}</Notice>}
            {pickands && pickands.ok && (
              <KeyValueList
                items={[
                  { label: 'Pickands ξ̂', value: NUMBER_FORMAT(pickands.value.tailIndex) },
                  { label: 'Pickands standard error', value: pickands.value.standardError === null ? 'none is computed here, rather than a plausible-looking one being supplied' : NUMBER_FORMAT(pickands.value.standardError) },
                ]}
              />
            )}
            <p style={{ fontSize: 12.5 }}>
              The Hill estimator assumes ξ &gt; 0 by construction and needs positive values in the tail, so a small Hill estimate is not evidence of a light
              tail. The Pickands estimator works for any sign of ξ but uses only three order statistics, so it is much noisier.
            </p>
            {hillCurve && !hillCurve.ok && <Notice tone="error">{errorText(hillCurve)}</Notice>}
            {hillCurve && hillCurve.ok && (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <LineChart
                    title="Hill plot"
                    description="The Hill estimate of ξ against the number of upper order statistics k, with asymptotic limits."
                    xLabel="k (upper order statistics used)"
                    yLabel="Hill ξ̂"
                    series={[
                      { label: 'Hill ξ̂', points: hillCurve.value.points.map((p) => ({ x: p.k, y: p.tailIndex })) },
                      { label: 'Lower limit', points: hillCurve.value.points.filter((p) => p.lower !== null).map((p) => ({ x: p.k, y: p.lower as number })), dashed: true },
                      { label: 'Upper limit', points: hillCurve.value.points.filter((p) => p.upper !== null).map((p) => ({ x: p.k, y: p.upper as number })), dashed: true },
                    ]}
                    referenceLines={[{ value: config.tailK, label: 'k in use', axis: 'x' }]}
                    note="The level region has to be chosen by eye: there is no automatic rule for k. Successive points share nearly all their data, so the curve is smooth by construction and small wiggles carry no information."
                  />
                </div>
                {hillCurve.value.skipped.length > 0 && (
                  <Notice tone="info">
                    {hillCurve.value.skipped.length} value(s) of k produced no Hill estimate and were left out of the plot. First reason:{' '}
                    {hillCurve.value.skipped[0].reason}
                  </Notice>
                )}
                <ExplanationPanel explanation={hillCurve.value.explanation} />
              </>
            )}
          </Card>

          <Card title="Declustering" hint="Clustered extremes break the independence the fit assumes.">
            <NumberField
              label="Run length separating two clusters"
              value={config.runLength}
              onChange={(runLength) => set({ runLength })}
              min={1}
              max={Math.max(1, values.length)}
              integer
              hint="Observations that must fall below the threshold before a new extreme event is counted. Counted in observations, not in time."
            />
            {decluster === null && <Notice tone="info">Declustering needs a threshold; set one in the threshold panel.</Notice>}
            {decluster && !decluster.ok && <Notice tone="error">{errorText(decluster)}</Notice>}
            {decluster && decluster.ok && (
              <>
                <KeyValueList
                  items={[
                    { label: 'Exceedances before declustering', value: decluster.value.exceedanceCount.toLocaleString('en-US') },
                    { label: 'Exceedances after declustering (cluster maxima)', value: decluster.value.clusterMaxima.length.toLocaleString('en-US') },
                    { label: 'Extremal index θ̂ (runs estimator)', value: NUMBER_FORMAT(decluster.value.extremalIndex) },
                    { label: 'Mean cluster size 1/θ̂', value: NUMBER_FORMAT(decluster.value.meanClusterSize) },
                    { label: 'Largest cluster', value: `${Math.max(...decluster.value.clusters.map((c) => c.size))} exceedance(s)` },
                  ]}
                />
                <p style={{ fontSize: 12.5 }}>
                  θ̂ = 1 means no clustering. Below 1, treating every exceedance as a separate extreme event overstates how often extremes happen and understates
                  how uncertain the fit is. Declustering discards data on purpose: only each cluster maximum survives, so the intervals widen — that is the
                  honest consequence of dependence, not a cost to avoid.
                </p>
                {declusteredFit && !declusteredFit.ok && <Notice tone="warning" title="The declustered series could not be refitted">{errorText(declusteredFit)}</Notice>}
                {declusteredFit && declusteredFit.ok && (
                  <>
                    <h3>The same GPD fitted to the cluster maxima</h3>
                    <div style={{ overflowX: 'auto' }}>
                      <DataTable
                        caption="Parameters fitted to the declustered exceedances"
                        columns={[
                          { key: 'name', header: 'Parameter', render: (r) => (r as { name: string }).name },
                          { key: 'est', header: 'Estimate', numeric: true, render: (r) => NUMBER_FORMAT((r as { estimate: number }).estimate) },
                          { key: 'se', header: 'Standard error', numeric: true, render: (r) => { const se = (r as { standardError: number | null }).standardError; return se === null ? 'not available' : NUMBER_FORMAT(se); } },
                        ]}
                        rows={declusteredFit.value.estimates}
                      />
                    </div>
                    <p style={{ fontSize: 12.5 }}>
                      Compare these with the fit above, which used every exceedance. Where they differ, the dependence in the series was doing the work.
                    </p>
                  </>
                )}
                <ExplanationPanel explanation={decluster.value.explanation} />
              </>
            )}
          </Card>

          <Card title="Diagnostics" hint="Whether the fitted model matches the extremes it was fitted to.">
            {diagnostics === null && <Notice tone="info">Diagnostics need a converged fit.</Notice>}
            {diagnostics && !diagnostics.ok && <Notice tone="error">{errorText(diagnostics)}</Notice>}
            {diagnostics && diagnostics.ok && (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <ScatterChart
                    title="Probability plot"
                    description="Model cumulative probability at each ordered observation against its empirical plotting position i/(n+1). A good fit lies on the 45° line."
                    xLabel="Empirical plotting position"
                    yLabel="Model cumulative probability"
                    points={diagnostics.value.probabilityPlot.map((p) => ({ x: p.empirical, y: p.model }))}
                    trendLine={{ slope: 1, intercept: 0, label: 'Perfect fit (y = x)' }}
                  />
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <QQChart
                    title="Quantile plot"
                    description="Model quantile at each plotting position against the ordered observation. Systematic curvature matters; a single outlying point at the top end usually does not."
                    points={diagnostics.value.quantilePlot.map((p) => ({ theoretical: p.model, sample: p.empirical }))}
                    referenceLine={{ slope: 1, intercept: 0, label: 'Perfect fit (y = x)' }}
                    xLabel="Model quantile"
                    yLabel="Observed value"
                  />
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <LineChart
                    title="Density comparison"
                    description="Histogram density of the fitted data against the fitted density at each bin centre."
                    xLabel="Value"
                    yLabel="Density"
                    series={[
                      { label: 'Empirical (histogram)', points: diagnostics.value.densityComparison.map((p) => ({ x: p.x, y: p.empiricalDensity })), area: true },
                      { label: 'Fitted model', points: diagnostics.value.densityComparison.map((p) => ({ x: p.x, y: p.modelDensity })) },
                    ]}
                  />
                </div>
                <p style={{ fontSize: 12.5 }}>
                  The parameters were estimated from these same points, so the plots flatter the fit slightly and cannot be read as an independent test.
                  {isPot ? ' They can only show whether the GPD matches the exceedances above the threshold you chose; they say nothing about whether that threshold was high enough.' : ''}
                </p>
                <ExplanationPanel explanation={diagnostics.value.explanation} />
              </>
            )}
          </Card>

          <Card title="What this analysis is claiming">
            <p style={{ fontSize: 12.5 }}>
              The GEV and GPD distribution functions themselves are exact formulas. Everything fitted from them here — the maximum-likelihood parameters, the
              standard errors, the profile-likelihood intervals, the return levels, the risk measures and the tail index estimates — is numerical: produced by a
              simplex search, a numerical Hessian and root finding. Each panel carries its own exactness label.
            </p>
            {isPot && (
              <Notice tone="warning" title="Everything below the headline rests on the threshold">
                {threshold === null
                  ? 'No threshold is in use yet.'
                  : `The threshold u = ${NUMBER_FORMAT(threshold)} is a judgement call, not an estimate. Moving it changes σ, ξ, every return level and both risk measures, and no interval on this page includes the uncertainty in choosing it. The mean residual life and parameter stability plots above are how that choice is defended.`}
              </Notice>
            )}
            {!isPot && (
              <Notice tone="warning" title="Everything below the headline rests on the block size">
                A block size of {config.blockSize} is a modelling choice. A larger block makes the GEV limit a better approximation but leaves fewer maxima to
                fit, and the answer changes with it. No interval here includes that choice.
              </Notice>
            )}
            {fitForExplanation && <ExplanationPanel explanation={fitForExplanation} defaultOpen />}
          </Card>
        </div>
      </div>
    </>
  );
}
